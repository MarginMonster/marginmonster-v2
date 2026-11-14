/* Film Studio — EasyMode's premium long-form tier. Music Video + Kids Cartoon +
 * Skit (members of the shared Film engine). Flow: pick a template → (Skit: pick
 * your product) → write the treatment FREE (no tokens) → read/edit/Randomize →
 * see the live per-scene cost → Generate. Metered by scene count (plan-config.
 * estimateFilmTokens — the SAME function quotes and charges). Gated at
 * "creatorvideo" (all plans). */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Ico } from "../lib/icons";
import { useT } from "../lib/ui-lang";
import { estimateSpeakSeconds, clipFill, secondsLabel, CLIP_MAX_SECONDS } from "../lib/speech-meter";
import { requireWebIdentity } from "../lib/web-auth.server";
import { readUiLang, tr } from "../lib/ui-i18n";
import { normalizeContentLang } from "../lib/content-lang";
import { db } from "../db.server";
import { planTrialing, refundTokens, spendTokens, tokensRemainingLive } from "../lib/tokens.server";
import { capabilitiesFor } from "../lib/capabilities.server";
import { enqueueJob } from "../lib/job-queue.server";
import { estimateFilmTokens, FILM_PER_SCENE, FILM_BASE } from "../lib/plan-config";
import { externalOrigin } from "../lib/origin.server";
import { AVATAR_VOICES } from "../lib/avatar-voice-catalog";
import { LIVE_AVATARS, avatarImg } from "../lib/avatars";

export const meta: MetaFunction = () => [{ title: "Film Studio · EASYMODE" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const { LIVE_FILM_TEMPLATES, GENRES, PROPS } = await import("../lib/film-engine.server");
  const templates = LIVE_FILM_TEMPLATES.map((t) => ({
    key: t.key, name: t.name, brief: t.brief, defaultScenes: t.defaultScenes, minScenes: t.minScenes, maxScenes: t.maxScenes, needsProduct: !!t.needsProduct, dialogue: !!t.dialogue, lipSyncSinger: !!t.lipSyncSinger, cartoon: !!t.cartoon,
  }));
  const genres = Object.entries(GENRES).map(([key, g]) => ({ key, label: g.label }));
  // name = the label with its leading emoji stripped ("🐯 Tiger" -> "Tiger"); the picker shows a real
  // generated photo (/propimg/:key) + this clean name instead of an emoji.
  const props = Object.entries(PROPS).map(([key, p]) => ({ key, label: p.label, name: p.label.replace(/^[^\p{L}]+/u, "").trim() || p.label }));
  // The merchant's own catalogue — only products WITH a photo can seed a skit.
  const products = (await db.catalogProduct.findMany({
    where: { shopId: shop.id, imageUrl: { not: null } },
    orderBy: { position: "asc" },
    take: 80,
    select: { title: true, imageUrl: true, description: true },
  })).map((p) => ({ title: p.title, imageUrl: p.imageUrl as string, description: (p.description || "").slice(0, 300) }));
  // The merchant's own Creator-made images — any one can seed a storyboard shot.
  // (The breakthrough path: animating a frame you already made keeps the staging
  // locked in and sidesteps text-to-image refusals on tricky content.)
  const origin = externalOrigin(request);
  const gallery = (await db.asset.findMany({
    where: { shopId: shop.id, type: "IMAGE_AD", status: { not: "FAILED" } },
    orderBy: { createdAt: "desc" },
    take: 24,
    select: { id: true, title: true, bodyJson: true },
  })).map((a) => {
    let url = "";
    try { const b = JSON.parse(a.bodyJson || "{}") as { imageUrl?: string; url?: string }; url = b.imageUrl || b.url || ""; } catch { /* ignore */ }
    if (!url) return null;
    const abs = /^https?:\/\//.test(url) ? url : origin + (url.startsWith("/") ? url : "/" + url);
    return { id: a.id, title: (a.title || "").slice(0, 80), url: abs };
  }).filter((x): x is { id: string; title: string; url: string } => !!x).slice(0, 18);
  // The merchant's PRESENTER ROSTER (same faces as /web/presenters) — any one can be
  // cast as a character's locked face in a dialogue film. Their forged customs first,
  // then the premium-voiced built-in presenters.
  const { customCastFor } = await import("../lib/custom-avatars.server");
  const custom = await customCastFor(shop.id);
  const roster = [
    ...custom.filter((c) => !!c.img && c.status !== "failed").map((c) => ({ id: c.id, name: c.name, img: c.img, custom: true })),
    ...LIVE_AVATARS.map((a) => ({ id: a.id, name: a.name, img: avatarImg(a.id, 0), custom: false })),
  ].slice(0, 60);
  return json({
    tokens: tokensRemainingLive(shop.activePlan),
    roster,
    hasPlan: !!shop.activePlan?.active,
    trialing: planTrialing(shop.activePlan),
    canFilm: capabilitiesFor(shop.activePlan).has("creatorvideo"),
    outputLang: normalizeContentLang(shop.contentLang),
    templates,
    genres,
    props,
    products,
    gallery,
    voices: AVATAR_VOICES.map((v) => ({ id: v.id, label: v.label, blurb: v.blurb, gender: v.gender })),
    perScene: FILM_PER_SCENE,
    base: FILM_BASE,
  });
};

// Parse the merchant's custom props (AI-made or their own photos) from a form field: [{key,label,img}].
// Only http(s) image URLs, capped at 6 — so a malformed field can never inject anything odd downstream.
function parseCustomProps(raw: string | null): Array<{ key: string; label: string; img: string }> {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c) => c && typeof c.key === "string" && typeof c.img === "string" && /^https?:\/\//i.test(c.img))
      .map((c) => ({ key: String(c.key).slice(0, 48), label: String(c.label || "prop").slice(0, 60), img: String(c.img).slice(0, 2000) }))
      .slice(0, 6);
  } catch { return []; }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const lang = await readUiLang(request);
  const { shop } = await requireWebIdentity(request);
  const form = await request.formData();
  const intent = ((form.get("intent") as string) || "").trim();
  const { filmTemplate, previewFilmTreatment } = await import("../lib/film-engine.server");

  if (!shop.activePlan?.active) return json({ error: tr(lang, "Pick a plan on the Dashboard first — film runs on tokens.") });
  if (!capabilitiesFor(shop.activePlan).has("creatorvideo")) {
    return json({ error: tr(lang, "Your plan doesn't include video yet — upgrade to make films.") });
  }

  const tmpl = filmTemplate((form.get("template") as string) || undefined);
  const topic = ((form.get("filmTopic") as string) || "").trim().slice(0, 300);
  const clampScenes = (n: number) => Math.max(tmpl.minScenes, Math.min(tmpl.maxScenes, Math.round(n || tmpl.defaultScenes)));

  // Product (skit): title + photo required for product templates.
  const productTitle = ((form.get("filmProductTitle") as string) || "").trim().slice(0, 120);
  const productImageUrl = ((form.get("filmProductImageUrl") as string) || "").trim().slice(0, 2000);
  const productDescription = ((form.get("filmProductDescription") as string) || "").trim().slice(0, 500);
  if (tmpl.needsProduct && !productImageUrl) {
    return json({ error: tr(lang, "Add your product first — pick one from your store or paste a product image URL.") });
  }

  // FREE — write/re-write the treatment as plain text (no token spend).
  if (intent === "previewFilmTreatment") {
    const scenes = clampScenes(parseInt((form.get("filmScenes") as string) || "", 10) || tmpl.defaultScenes);
    const genre = ((form.get("filmGenre") as string) || "").trim();
    const artistName = ((form.get("filmArtistName") as string) || "").trim().slice(0, 60);
    try {
      const treatment = await previewFilmTreatment({ shopId: shop.id, template: tmpl.key, topic, sceneCount: scenes, contentLang: shop.contentLang, productTitle, productDescription, genre, artistName });
      return json({ treatment });
    } catch (e) {
      return json({ error: tr(lang, "Couldn't write that treatment — give it another go, or tweak the premise a little (for Horror, a spookier / less-graphic angle writes more reliably)."), detail: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }

  // FREE — render ONE scene's storyboard photo so the merchant can approve / steer
  // the composition before spending on the video. Uses the SAME prompt the render uses.
  if (intent === "previewFilmFrame") {
    const sceneVisual = ((form.get("sceneVisual") as string) || "").trim().slice(0, 1500);
    const castText = ((form.get("castText") as string) || "").trim().slice(0, 800);
    const styleRefUrl = ((form.get("styleRefUrl") as string) || "").trim().slice(0, 2000) || null;
    const sceneIndex = parseInt((form.get("sceneIndex") as string) || "0", 10) || 0;
    // Locked cast faces for the characters in this shot (compose the frame from them).
    // Must be ABSOLUTE — Replicate can't fetch a relative /renders URL, and portrait
    // faces come back relative (persistRemote), so absolutize each one here.
    let castRefUrls: string[] | undefined;
    const castRefsRaw = ((form.get("castRefs") as string) || "").trim();
    if (castRefsRaw) {
      try {
        const a = JSON.parse(castRefsRaw);
        if (Array.isArray(a)) castRefUrls = a
          .filter((x) => typeof x === "string" && x)
          .slice(0, 3)
          .map((u: string) => (/^https?:\/\//i.test(u) ? u : `${externalOrigin(request)}${u.startsWith("/") ? "" : "/"}${u}`));
      } catch { /* ignore */ }
    }
    if (!sceneVisual) return json({ error: tr(lang, "Describe the shot first."), sceneIndex });
    try {
      const { previewFilmSceneFrame } = await import("../lib/film-dialogue.server");
      const frameUrl = await previewFilmSceneFrame({ template: tmpl.key, sceneVisual, castText, styleRefUrl, castRefUrls });
      if (!frameUrl) return json({ error: tr(lang, "Couldn't render that frame — tweak the shot and try again."), sceneIndex });
      return json({ frameUrl, sceneIndex });
    } catch (e) {
      return json({ error: tr(lang, "Couldn't render that frame — try again."), sceneIndex, detail: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }

  // FREE — cast an actor: render a clean, reusable casting portrait for one
  // character, which then locks their face across every shot (the "cast member"
  // primitive). Same free, no-token path as the storyboard frames.
  if (intent === "previewFilmPortrait") {
    const castDesc = ((form.get("castDesc") as string) || "").trim().slice(0, 600);
    const castIndex = parseInt((form.get("castIndex") as string) || "0", 10) || 0;
    if (!castDesc) return json({ error: tr(lang, "Describe the character first."), castIndex });
    try {
      const { renderActorPortrait } = await import("../lib/film-dialogue.server");
      const portraitUrl = await renderActorPortrait(castDesc, tmpl.cartoon ? "cartoon" : "realistic");
      if (!portraitUrl) return json({ error: tr(lang, "Couldn't cast that actor — tweak the description and try again."), castIndex });
      return json({ portraitUrl, castIndex });
    } catch (e) {
      return json({ error: tr(lang, "Couldn't cast that actor — try again."), castIndex, detail: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }

  // FREE — edit ONE storyboard frame in place with Creator's photo-edit engine, so
  // the merchant refines a shot ("make it night", "add the mum at the window", "make
  // her face wrong") without ever leaving Film.
  if (intent === "editFilmFrame") {
    const frameUrl = ((form.get("frameUrl") as string) || "").trim().slice(0, 2000);
    const edit = ((form.get("edit") as string) || "").trim().slice(0, 300);
    const sceneIndex = parseInt((form.get("sceneIndex") as string) || "0", 10) || 0;
    if (!frameUrl || !edit) return json({ error: tr(lang, "Pick a frame and describe the change first."), sceneIndex });
    const absUrl = /^https?:\/\//i.test(frameUrl) ? frameUrl : `${externalOrigin(request)}${frameUrl.startsWith("/") ? "" : "/"}${frameUrl}`;
    try {
      const { editImage } = await import("../lib/image-generation.server");
      const edited = await editImage({ shopId: shop.id, sourceImageUrl: absUrl, editOp: "describe", prompt: edit });
      return json({ frameUrl: edited, sceneIndex });
    } catch (e) {
      return json({ error: tr(lang, "Couldn't apply that edit — try rewording it."), sceneIndex, detail: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }

  // FREE — PRE-SEED the Music Video: generate every scene's STILL (props placed) so the owner can
  // check accuracy + confirm the prop lands per scene BEFORE paying for the ~40-min render. The
  // approved stills ride back into the render as approvedSceneImgs, so what you see IS what renders
  // (the "limit the surprise" ask). No token spend here — just the seed images.
  // FREE — make a custom PROP from a description: a clean studio photo the merchant can weave in.
  if (intent === "makeProp") {
    const desc = ((form.get("propDesc") as string) || "").trim().slice(0, 120);
    if (!desc) return json({ error: tr(lang, "Describe your prop first.") });
    try {
      const { renderCreativeSeed } = await import("../lib/image-generation.server");
      const img = await renderCreativeSeed(`A professional studio product photo of ${desc}: a single subject centered on a clean light grey seamless background, soft even studio lighting, photorealistic, crisp high detail, no people, no text, no watermark.`, "1:1");
      if (!img) return json({ error: tr(lang, "Couldn't make that prop — try a different description.") });
      return json({ img: /^https?:\/\//i.test(img) ? img : `${externalOrigin(request)}${img.startsWith("/") ? "" : "/"}${img}` });
    } catch (e) {
      return json({ error: tr(lang, "Couldn't make that prop — give it another go."), detail: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }

  // FREE — make a custom ARTIST from a description: a realistic portrait to star in the video.
  if (intent === "makeArtist") {
    const desc = ((form.get("artistDesc") as string) || "").trim().slice(0, 120);
    if (!desc) return json({ error: tr(lang, "Describe your artist first.") });
    try {
      const { renderCreativeSeed } = await import("../lib/image-generation.server");
      const img = await renderCreativeSeed(`A realistic head-and-shoulders portrait of ${desc}: a real person looking at camera, natural genuine expression, soft studio lighting, photorealistic, sharp detailed face, plain neutral background, no text, no watermark.`, "9:16");
      if (!img) return json({ error: tr(lang, "Couldn't make that avatar — try a different description.") });
      return json({ img: /^https?:\/\//i.test(img) ? img : `${externalOrigin(request)}${img.startsWith("/") ? "" : "/"}${img}` });
    } catch (e) {
      return json({ error: tr(lang, "Couldn't make that avatar — give it another go."), detail: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }

  if (intent === "previewFilmScenes") {
    const genre = ((form.get("filmGenre") as string) || "").trim();
    let filmProps: string[] | undefined;
    const propsRaw = ((form.get("filmProps") as string) || "").trim();
    if (propsRaw) { try { const p = JSON.parse(propsRaw); if (Array.isArray(p)) filmProps = p.filter((x) => typeof x === "string").slice(0, 12); } catch { /* ignore malformed */ } }
    const customProps = parseCustomProps(form.get("filmCustomProps") as string);
    let approvedTreatment: Treatment | undefined;
    const approvedRaw = ((form.get("approvedTreatment") as string) || "").trim();
    if (approvedRaw) { try { const tObj = JSON.parse(approvedRaw); if (tObj && Array.isArray(tObj.scenes) && tObj.scenes.length) approvedTreatment = tObj; } catch { /* ignore malformed */ } }
    const scenes = clampScenes(parseInt((form.get("filmScenes") as string) || "", 10) || tmpl.defaultScenes);
    const heroUrl = ((form.get("filmHeroUrl") as string) || "").trim().slice(0, 2000) || undefined;
    try {
      if (tmpl.lipSyncSinger) {
        // Music Video engine: artist hero (merchant-picked avatar or auto-cast) + props.
        const { previewMusicVideoScenes } = await import("../lib/music-video-pipeline.server");
        const r = await previewMusicVideoScenes({ shopId: shop.id, topic, genre, sceneCount: scenes, props: filmProps, customProps, heroUrl, treatment: approvedTreatment as unknown as Parameters<typeof previewMusicVideoScenes>[0]["treatment"] });
        const sceneImgs = (r.sceneImgs || []).map((u) => u || null);
        if (!sceneImgs.some(Boolean)) return json({ error: tr(lang, "Couldn't preview the scenes — try again in a moment.") });
        return json({ ok: true, sceneImgs, treatment: r.treatment, propForScene: r.propForScene, artistRef: r.artistRef });
      }
      // generateFilm engine (Kids Music Video / narrated story formats) — cast-locked scene seeds.
      const { previewFilmSceneSeeds } = await import("../lib/film-engine.server");
      const r = await previewFilmSceneSeeds({ shopId: shop.id, template: tmpl.key, topic, sceneCount: scenes, treatment: approvedTreatment as unknown as Parameters<typeof previewFilmSceneSeeds>[0]["treatment"], product: tmpl.needsProduct ? { title: productTitle, imageUrl: productImageUrl, description: productDescription } : undefined });
      const sceneImgs = (r.sceneImgs || []).map((u) => u || null);
      if (!sceneImgs.some(Boolean)) return json({ error: tr(lang, "Couldn't preview the scenes — try again in a moment.") });
      return json({ ok: true, sceneImgs, treatment: r.treatment, propForScene: {}, castRef: r.castRef });
    } catch (e) {
      return json({ error: tr(lang, "Couldn't preview the scenes — try again."), detail: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }

  // FREE — RE-ROLL one storyboard scene (reusing the artist hero) when it came back wrong (prop
  // missing / an uninvited character). Fast — just that one still, not the whole batch.
  if (intent === "rerollFilmScene") {
    const artistRef = ((form.get("artistRef") as string) || "").trim().slice(0, 2000);
    const castRef = ((form.get("castRef") as string) || "").trim().slice(0, 2000);
    const sceneVisual = ((form.get("sceneVisual") as string) || "").trim().slice(0, 1500);
    const sceneIndex = parseInt((form.get("sceneIndex") as string) || "0", 10) || 0;
    const propKey = ((form.get("propKey") as string) || "").trim() || undefined;
    const genre = ((form.get("filmGenre") as string) || "").trim();
    if (!sceneVisual) return json({ error: tr(lang, "Preview the scenes first."), sceneIndex });
    try {
      let img: string | null = null;
      if (tmpl.lipSyncSinger) {
        if (!artistRef) return json({ error: tr(lang, "Preview the scenes first."), sceneIndex });
        const { rerollMusicVideoScene } = await import("../lib/music-video-pipeline.server");
        img = await rerollMusicVideoScene({ artistRef, sceneVisual, sceneIndex, propKey, genre });
      } else {
        const { rerollFilmSceneSeed } = await import("../lib/film-engine.server");
        img = await rerollFilmSceneSeed({ template: tmpl.key, sceneVisual, castRef: castRef || undefined });
      }
      if (!img) return json({ error: tr(lang, "Couldn't re-roll that scene — try again."), sceneIndex });
      return json({ ok: true, sceneIndex, img });
    } catch (e) {
      return json({ error: tr(lang, "Couldn't re-roll that scene — try again."), sceneIndex, detail: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }

  // PAID — enqueue the render. Charge by the ACTUAL scene count (the approved
  // treatment's length if one was approved, else the slider), so the quote the
  // merchant saw == the debit. The queue's refundPrepaidOnce returns chargedTokens
  // on terminal failure; this catch covers a charge that never gets a job row.
  if (intent === "film") {
    const approvedRaw = ((form.get("approvedTreatment") as string) || "").trim();
    let approvedTreatment: string | undefined;
    let scenes = clampScenes(parseInt((form.get("filmScenes") as string) || "", 10) || tmpl.defaultScenes);
    if (approvedRaw) {
      try {
        const t = JSON.parse(approvedRaw) as { scenes?: unknown[] };
        const n = Array.isArray(t.scenes) ? t.scenes.length : 0;
        if (n > 0) { approvedTreatment = approvedRaw; scenes = clampScenes(n); }
      } catch { /* malformed — fall back to the slider count + engine-written treatment */ }
    }
    // Per-scene APPROVED storyboard frames (Test Movie) — index-aligned with scenes;
    // an entry overrides that scene's auto-seed so it lands as the merchant staged it.
    let approvedFrames: (string | null)[] | undefined;
    const framesRaw = ((form.get("approvedFrames") as string) || "").trim();
    if (framesRaw) {
      try { const f = JSON.parse(framesRaw); if (Array.isArray(f)) approvedFrames = f.map((x) => (typeof x === "string" && x ? x : null)); } catch { /* ignore malformed */ }
    }
    // Locked cast (name + face + voice per character) the merchant cast in the UI —
    // drives per-shot identity conditioning and the voice pin in the render.
    let cast: Array<{ name: string; faceUrl: string | null; voiceId: string | null }> | undefined;
    const castRaw = ((form.get("cast") as string) || "").trim();
    if (castRaw) {
      try {
        const c = JSON.parse(castRaw);
        if (Array.isArray(c)) {
          const mapped = c
            .filter((x) => x && typeof x.name === "string" && x.name.trim())
            .map((x) => ({ name: String(x.name).slice(0, 80), faceUrl: x.faceUrl ? String(x.faceUrl).slice(0, 2000) : null, voiceId: x.voiceId ? String(x.voiceId).slice(0, 80) : null }))
            .slice(0, 8);
          if (mapped.length) cast = mapped;
        }
      } catch { /* ignore malformed */ }
    }
    // Swappable render engine (Test Movie): Kling 3 Omni is the DEFAULT (owner A/B win —
    // cheaper, quality held); "veo" switches to premium Veo 3. Only Test Movie reads it.
    const dialogueEngine = ((form.get("dialogueEngine") as string) || "").trim() === "veo" ? "veo" : "kling3";
    const filmAspectRaw = ((form.get("filmAspect") as string) || "").trim();
    const filmAspect = filmAspectRaw === "16:9" || filmAspectRaw === "1:1" ? filmAspectRaw : "9:16";
    // Music Video genre (rap/pop/rock/rnb/country) — only the lip-sync Music Video reads it.
    const filmGenre = ((form.get("filmGenre") as string) || "").trim();
    // BYO-song: a merchant-uploaded track URL (from /api/film-song-upload) used INSTEAD of generating one.
    const filmSongUrl = ((form.get("filmSongUrl") as string) || "").trim();
    // Artist (Music Video) — the merchant picked one of their avatars to BE the star (empty = auto-cast).
    const filmHeroUrl = ((form.get("filmHeroUrl") as string) || "").trim().slice(0, 2000);
    // Props (Music Video) — keys the merchant picked, woven into the scenes. JSON array of strings.
    let filmProps: string[] | undefined;
    const propsRaw = ((form.get("filmProps") as string) || "").trim();
    if (propsRaw) { try { const p = JSON.parse(propsRaw); if (Array.isArray(p)) filmProps = p.filter((x) => typeof x === "string").slice(0, 12); } catch { /* ignore malformed */ } }
    // Custom props (AI-made or the merchant's own photo) — each carries its own image to seed from.
    const filmCustomProps = parseCustomProps(form.get("filmCustomProps") as string);
    // Pre-approved per-scene STILLS (Music Video storyboard) — render these EXACT images, no re-seed.
    // Keep positions (a null = that scene seeds fresh), so the index stays aligned with the scenes.
    let approvedSceneImgs: (string | null)[] | undefined;
    const seedsRaw = ((form.get("approvedSceneImgs") as string) || "").trim();
    if (seedsRaw) { try { const s = JSON.parse(seedsRaw); if (Array.isArray(s) && s.length) approvedSceneImgs = s.map((x) => (typeof x === "string" && x ? x.slice(0, 2000) : null)); } catch { /* ignore malformed */ } }
    const cost = estimateFilmTokens(scenes);

    let unbacked = 0, unbackedFromExtra = 0;
    try {
      const { fromExtra } = await spendTokens(shop.id, cost);
      unbacked = cost; unbackedFromExtra = fromExtra;
      await enqueueJob(shop.id, "GENERATE_VIDEO_AD", {
        section: "creator", contentType: "film",
        filmTemplate: tmpl.key, filmTopic: topic, filmScenes: scenes,
        approvedTreatment,
        ...(approvedFrames ? { approvedFrames } : {}),
        ...(cast ? { cast } : {}),
        ...(filmGenre ? { filmGenre } : {}),
        ...(filmSongUrl ? { filmSongUrl } : {}),
        ...(filmHeroUrl ? { filmHeroUrl } : {}),
        ...(filmProps?.length ? { filmProps } : {}),
        ...(filmCustomProps.length ? { filmCustomProps } : {}),
        ...(approvedSceneImgs?.length ? { approvedSceneImgs } : {}),
        dialogueEngine, filmAspect,
        ...(tmpl.needsProduct ? { filmProductTitle: productTitle, filmProductImageUrl: productImageUrl, filmProductDescription: productDescription } : {}),
        productTitle: (productTitle || topic || tmpl.name).slice(0, 60),
        prePaid: true, chargedTokens: cost, chargedFromExtra: fromExtra, initiator: "web",
      });
      unbacked = 0;
      return json({ ok: true, queued: "film", cost, scenes });
    } catch (e) {
      if (unbacked > 0) {
        try { await refundTokens(shop.id, unbacked, unbackedFromExtra); } catch { /* owed-refund path logs inside */ }
      }
      const name = e instanceof Error ? e.name : "";
      if (name === "InsufficientTokensError") return json({ error: e instanceof Error ? e.message : tr(lang, "Not enough tokens.") });
      console.error("[film] enqueue failed:", e instanceof Error ? e.message : e);
      return json({ error: tr(lang, "Couldn't start the render — try again in a moment.") });
    }
  }

  return json({ error: tr(lang, "Unknown action.") });
};

type Scene = { visual: string; caption?: string; where?: string; shot?: string; tone?: string; kind?: "perform" | "broll" };
type Treatment = { title?: string; scenes: Scene[]; musicMood: string; cast?: string[] };
// A locked "actor": one character's reusable face + pinned voice, cast once and
// reused as the identity reference for every shot they appear in.
type CastMember = { name: string; desc: string; faceUrl: string | null; voiceId: string | null };

// Backdrop presets — like the avatar-AI backdrop picker: tap one to set a scene's
// location (the `where`), or type your own. `key` is matched against the where text
// to light the active chip.
const FILM_BACKDROPS: Array<{ key: string; label: string; where: string }> = [
  { key: "diner", label: "Diner", where: "a warm dim diner at night, rain on the windows" },
  { key: "street", label: "Street", where: "a rain-soaked city street at night, neon reflections on the wet asphalt" },
  { key: "office", label: "Office", where: "a quiet modern office after hours, city lights through the glass" },
  { key: "kitchen", label: "Kitchen", where: "a stainless-steel restaurant kitchen late at night, one lamp burning" },
  { key: "car", label: "Car", where: "inside a parked car at night, streetlights sliding past the windows" },
  { key: "living", label: "Living room", where: "a cozy living room in the evening, warm lamplight" },
  { key: "bar", label: "Bar", where: "a moody, dimly lit bar at night" },
  { key: "park", label: "Park", where: "a quiet park bench at dusk, soft golden light" },
  { key: "warehouse", label: "Warehouse", where: "a cold empty warehouse at night, shafts of moonlight" },
];

export default function FilmStudio() {
  const d = useLoaderData<typeof loader>();
  const t = useT();
  const nav = useNavigation();
  const actionData = useActionData<typeof action>() as { ok?: boolean; queued?: string; cost?: number; error?: string } | undefined;
  const treatmentFetcher = useFetcher<{ treatment?: Treatment; error?: string }>();
  // Music Video STORYBOARD: pre-seed every scene's still (props placed) BEFORE paying for the video,
  // so the owner checks accuracy + the prop per scene and the render uses those EXACT stills (no surprise).
  const sceneSeedsFetcher = useFetcher<{ ok?: boolean; sceneImgs?: (string | null)[]; treatment?: Treatment; propForScene?: Record<number, string>; artistRef?: string | null; castRef?: string | null; error?: string }>();
  const rerollSceneFetcher = useFetcher<{ ok?: boolean; sceneIndex?: number; img?: string; error?: string }>();
  // Make-your-own prop: describe it → we generate a studio photo of it (free).
  const propMakerFetcher = useFetcher<{ img?: string; error?: string }>();
  // Make-your-own artist: describe a face → we generate a portrait (free), like the presenter forge.
  const artistMakerFetcher = useFetcher<{ img?: string; error?: string }>();
  const [seeds, setSeeds] = useState<{ imgs: (string | null)[]; treatment: Treatment; propForScene: Record<number, string>; artistRef: string | null; castRef: string | null } | null>(null);
  const [rerollingScene, setRerollingScene] = useState<number | null>(null);
  // Storyboard (dialogue): per-scene approved frames + which scene is rendering now.
  const previewFrameFetcher = useFetcher<{ frameUrl?: string; sceneIndex?: number; error?: string }>();
  const [frames, setFrames] = useState<(string | null)[]>([]);
  const [framingIndex, setFramingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Record<number, string>>({});
  // Cast (dialogue): the locked actors + which one is being cast right now.
  const portraitFetcher = useFetcher<{ portraitUrl?: string; castIndex?: number; error?: string }>();
  const [cast, setCast] = useState<CastMember[]>([]);
  const [castingIndex, setCastingIndex] = useState<number | null>(null);
  // Build the cast from the treatment's character list: parse a name, keep the
  // description, and auto-pick a gender-appropriate voice the merchant can change.
  // The SPEAKING name — the single word the captions use (e.g. "Dominic" from
  // "Chef Dominic Kane, a tall…"). Strip a leading title so the cast name matches
  // the caption's speaker by first token (the engine + flow both key off that).
  const TITLE_WORD = /^(chef|dr|doctor|mr|mrs|ms|miss|sir|madam|officer|detective|det|captain|capt|sergeant|sgt|professor|prof|coach|agent|father|mother|aunt|uncle|grandma|grandpa|king|queen|prince|princess|lord|lady|sister|brother|nurse|judge|mayor|pastor|reverend|rev)\.?$/i;
  const speakName = (entry: string) => {
    const head = (entry.split(/[,:—–]/)[0] || entry).trim();
    const words = head.split(/\s+/).filter(Boolean);
    return ((words.find((w) => !TITLE_WORD.test(w)) || words[0] || head) || "").slice(0, 40);
  };
  const deriveCast = (tr2: Treatment): CastMember[] =>
    (Array.isArray(tr2.cast) ? tr2.cast : []).slice(0, 8).map((entry) => {
      const name = speakName(entry) || entry.slice(0, 40);
      const low = entry.toLowerCase();
      const fem = /\b(she|her|hers|woman|women|girl|mother|mom|mum|daughter|sister|lady|businesswoman|actress|queen|wife|aunt|grandmother|female)\b/.test(low);
      const masc = /\b(he|him|his|man|men|boy|father|dad|son|brother|guy|businessman|actor|king|husband|uncle|grandfather|male)\b/.test(low);
      const g = fem && !masc ? "f" : masc && !fem ? "m" : null;
      const v = g ? d.voices.find((x) => x.gender === g) : null;
      return { name, desc: entry.trim().slice(0, 300), faceUrl: null, voiceId: v ? v.id : null };
    });

  const [template, setTemplate] = useState(d.templates[0]?.key || "musicvideo");
  const tmpl = d.templates.find((x) => x.key === template) || d.templates[0];
  // The Veo dialogue pipeline supports the per-scene storyboard (approve each frame).
  const isStoryboard = !!tmpl?.dialogue; // any dialogue card (Short Film, Moral, Horror) → the chat-flow UI + dialogue engine
  // Test Movie can render its spoken dialogue on either engine: Veo (default,
  // short cinematic beats) or Kling 3 Omni (longer single takes, native lip-sync).
  // Only submitted for testmovie; the action ignores it for every other template.
  const [dialogueEngine, setDialogueEngine] = useState<"veo" | "kling3">("kling3");
  const [filmAspect, setFilmAspect] = useState<"9:16" | "16:9" | "1:1">("16:9");
  // Music Video genre (lip-sync lane only) — drives the song + the artist/settings.
  const [filmGenre, setFilmGenre] = useState<string>(d.genres?.[0]?.key || "rap");
  // BYO-song (Music Video): "write" = auto-generate the song, "upload" = merchant's own track.
  const [songSource, setSongSource] = useState<"write" | "upload">("write");
  const [filmSongUrl, setFilmSongUrl] = useState("");
  const [songName, setSongName] = useState("");
  const [songBusy, setSongBusy] = useState(false);
  const songInputRef = useRef<HTMLInputElement | null>(null);
  const uploadSong = async (file?: File | null) => {
    if (!file) return;
    setSongBusy(true);
    try {
      const fd = new FormData(); fd.set("song", file);
      const r = await fetch("/api/film-song-upload", { method: "POST", body: fd });
      const j = await r.json();
      if (j?.songUrl) { setFilmSongUrl(j.songUrl); setSongName(j.name || file.name); }
      else alert(j?.error || "Couldn't upload that track.");
    } catch { alert("Couldn't upload that track."); }
    finally { setSongBusy(false); }
  };
  // Props (Music Video) — up to 6 "cool shit" items woven into the scenes.
  const [filmProps, setFilmProps] = useState<string[]>([]);
  const toggleProp = (k: string) => setFilmProps((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length < 6 ? [...p, k] : p));
  // Custom props the merchant made — AI-generated from a description, or their own uploaded photo.
  // Each carries its own image so it seeds the render directly (no "generate a tiger" guesswork).
  const [customProps, setCustomProps] = useState<Array<{ key: string; label: string; img: string }>>([]);
  const [propMakerOpen, setPropMakerOpen] = useState(false);
  const [propDesc, setPropDesc] = useState("");
  const [propPhotoBusy, setPropPhotoBusy] = useState(false);
  const propPhotoRef = useRef<HTMLInputElement | null>(null);
  const propPendingRef = useRef(false);
  const makingProp = propMakerFetcher.state !== "idle";
  const newPropKey = () => `custom-${(typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10))}`;
  const addCustomProp = (label: string, img: string) => {
    const key = newPropKey();
    setCustomProps((p) => [...p, { key, label: label.slice(0, 40) || "My prop", img }]);
    setFilmProps((p) => (p.length < 6 && !p.includes(key) ? [...p, key] : p)); // auto-select the new prop
  };
  // The photo for a prop key (catalog → generated /propimg, custom → the merchant's own image).
  const propThumb = (k: string) => { const cp = customProps.find((c) => c.key === k); return cp ? cp.img : `/propimg/${k}`; };
  const makeAiProp = () => {
    const desc = propDesc.trim();
    if (!desc || makingProp) return;
    propPendingRef.current = true;
    propMakerFetcher.submit({ intent: "makeProp", propDesc: desc }, { method: "post" });
  };
  const uploadPropPhoto = async (file?: File | null) => {
    if (!file) return;
    setPropPhotoBusy(true);
    try {
      const fd = new FormData(); fd.set("productPhoto", file);
      const r = await fetch("/api/buddy-upload", { method: "POST", body: fd });
      const j = await r.json();
      if (j?.frameUrl) addCustomProp((file.name || "My prop").replace(/\.[^.]+$/, ""), j.frameUrl);
      else alert(j?.error || "Couldn't add that photo.");
    } catch { alert("Couldn't add that photo."); }
    finally { setPropPhotoBusy(false); }
  };
  // When the AI prop photo comes back, add it to the picker (auto-selected) and reset the maker.
  useEffect(() => {
    if (propMakerFetcher.state !== "idle" || !propPendingRef.current) return;
    const img = propMakerFetcher.data?.img;
    if (img) { propPendingRef.current = false; addCustomProp(propDesc.trim(), img); setPropDesc(""); setPropMakerOpen(false); }
    else if (propMakerFetcher.data?.error) { propPendingRef.current = false; }
  }, [propMakerFetcher.state, propMakerFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // ARTIST maker — create a face from a description, or upload your own. Mirrors the presenter picker
  // (custom-generate + upload) so the artist chooser looks like the avatar selectors elsewhere.
  const [customArtists, setCustomArtists] = useState<Array<{ img: string; name: string }>>([]);
  const [artistMakerOpen, setArtistMakerOpen] = useState(false);
  const [artistDesc, setArtistDesc] = useState("");
  const [artistPhotoBusy, setArtistPhotoBusy] = useState(false);
  const artistPhotoRef = useRef<HTMLInputElement | null>(null);
  const artistPendingRef = useRef(false);
  const makingArtist = artistMakerFetcher.state !== "idle";
  const makeAiArtist = () => {
    const desc = artistDesc.trim();
    if (!desc || makingArtist) return;
    artistPendingRef.current = true;
    artistMakerFetcher.submit({ intent: "makeArtist", artistDesc: desc }, { method: "post" });
  };
  const uploadArtistPhoto = async (file?: File | null) => {
    if (!file) return;
    setArtistPhotoBusy(true);
    try {
      const fd = new FormData(); fd.set("productPhoto", file);
      const r = await fetch("/api/buddy-upload", { method: "POST", body: fd });
      const j = await r.json();
      if (j?.frameUrl) { setCustomArtists((a) => [...a, { img: j.frameUrl, name: (file.name || "My avatar").replace(/\.[^.]+$/, "").slice(0, 24) }]); setArtistPick(j.frameUrl); }
      else alert(j?.error || "Couldn't add that photo.");
    } catch { alert("Couldn't add that photo."); }
    finally { setArtistPhotoBusy(false); }
  };
  useEffect(() => {
    if (artistMakerFetcher.state !== "idle" || !artistPendingRef.current) return;
    const img = artistMakerFetcher.data?.img;
    if (img) { artistPendingRef.current = false; const name = artistDesc.trim().slice(0, 24) || "Custom"; setCustomArtists((a) => [...a, { img, name }]); setArtistPick(img); setArtistDesc(""); setArtistMakerOpen(false); }
    else if (artistMakerFetcher.data?.error) { artistPendingRef.current = false; }
  }, [artistMakerFetcher.state, artistMakerFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Music Video card-builder: which summary step is expanded for editing (null = all collapsed).
  type CardKey = "artist" | "genre" | "song" | "props" | "length";
  const [openCard, setOpenCard] = useState<CardKey | null>(null);
  // A numbered step flow: each step turns green once you've set it, so you move through 1→5 like a
  // guided checklist. Opening a step (and it already has a smart default) counts it as done.
  const [stepsDone, setStepsDone] = useState<Record<string, boolean>>({});
  const tapCard = (key: CardKey) => {
    setOpenCard((cur) => (cur === key ? null : key));
    setStepsDone((d) => (d[key] ? d : { ...d, [key]: true }));
  };
  const [topic, setTopic] = useState("");
  // The merchant can PICK one of their avatars to BE the artist ("" = auto-cast one for the genre).
  const [artistPick, setArtistPick] = useState<string>("");
  const artistName = artistPick ? (d.roster.find((r) => r.img === artistPick)?.name || "") : "";
  const [scenes, setScenes] = useState(tmpl?.defaultScenes || 6);
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  // Product (skit): title + photo + (catalog) description.
  const [prodTitle, setProdTitle] = useState("");
  const [prodImage, setProdImage] = useState("");
  const [prodDesc, setProdDesc] = useState("");

  // When a fresh treatment arrives, adopt it (and lock the scene count to it) + cast.
  useEffect(() => {
    const tr2 = treatmentFetcher.data?.treatment;
    if (tr2 && tr2.scenes?.length) { setTreatment(tr2); setScenes(tr2.scenes.length); setFrames([]); setCast(deriveCast(tr2)); }
  }, [treatmentFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Store each actor's portrait as it's cast; clear the busy flag.
  useEffect(() => {
    if (portraitFetcher.state !== "idle") return;
    const data = portraitFetcher.data;
    if (data && data.portraitUrl && typeof data.castIndex === "number") {
      const idx = data.castIndex, url = data.portraitUrl;
      setCast((prev) => prev.map((c, j) => (j === idx ? { ...c, faceUrl: url } : c)));
    }
    setCastingIndex(null);
  }, [portraitFetcher.state, portraitFetcher.data]);

  // Store each storyboard frame as it arrives; clear the busy flag.
  useEffect(() => {
    if (previewFrameFetcher.state !== "idle") return;
    const data = previewFrameFetcher.data;
    if (data && data.frameUrl && typeof data.sceneIndex === "number") {
      const idx = data.sceneIndex, url = data.frameUrl;
      setFrames((prev) => { const next = prev.slice(); next[idx] = url; return next; });
    }
    setFramingIndex(null);
  }, [previewFrameFetcher.state, previewFrameFetcher.data]);

  const writing = treatmentFetcher.state !== "idle";
  const generating = nav.state !== "idle" && nav.formData?.get("intent") === "film";
  const cost = estimateFilmTokens(scenes);
  const affordable = d.tokens >= cost;
  const productReady = !tmpl?.needsProduct || !!prodImage.trim();
  const canGo = d.hasPlan && d.canFilm && affordable && productReady && !generating;

  const bump = (delta: number) => {
    const n = Math.max(tmpl.minScenes, Math.min(tmpl.maxScenes, scenes + delta));
    setScenes(n);
    if (treatment && treatment.scenes.length !== n) { setTreatment(null); setFrames([]); setCast([]); }
  };
  const switchTemplate = (key: string) => {
    const nt = d.templates.find((x) => x.key === key);
    setTemplate(key); setScenes(nt?.defaultScenes || 6); setTreatment(null); setFrames([]); setCast([]);
  };
  // Cinematic format entry: you land on the poster GRID; tap a card and IT zooms in while the
  // other cards are thrown away, then it becomes that format's builder. Back reverses it.
  const [entered, setEntered] = useState(false);
  const [zoomKey, setZoomKey] = useState<string | null>(null);
  const [zoomStyle, setZoomStyle] = useState<{ transform: string } | undefined>(undefined);
  const [anim, setAnim] = useState<"" | "in" | "out">("");
  const enterFormat = (key: string, ev?: { currentTarget?: HTMLElement }) => {
    // Fly the tapped card to the center of the VISIBLE band (between the grid's top and just above
    // the bottom nav), not the grid center — the grid is taller than the screen, so grid-center
    // dropped the zoom below the fold. This keeps it on-screen wherever the card or scroll sits.
    const btn = ev?.currentTarget;
    const grid = btn?.parentElement;
    const reduce = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (btn && grid && typeof window !== "undefined" && !reduce) {
      const br = btn.getBoundingClientRect();
      const gr = grid.getBoundingClientRect();
      const topBound = Math.max(gr.top, 8);
      const botBound = window.innerHeight - 92;
      const cx = window.innerWidth / 2;
      const cy = (topBound + botBound) / 2;
      const dx = Math.round(cx - (br.left + br.width / 2));
      const dy = Math.round(cy - (br.top + br.height / 2));
      setZoomStyle({ transform: `translate(${dx}px, ${dy}px) scale(1.42)` });
    }
    setZoomKey(key); setAnim("in");
    window.setTimeout(() => { switchTemplate(key); setEntered(true); setAnim(""); setZoomKey(null); setZoomStyle(undefined); }, 420);
  };
  const exitFormat = () => {
    setAnim("out");
    window.setTimeout(() => { setEntered(false); setAnim(""); }, 300);
  };
  const pickCatalog = (idx: number) => {
    const p = d.products[idx];
    if (!p) return;
    setProdTitle(p.title || ""); setProdImage(p.imageUrl || ""); setProdDesc(p.description || "");
    setTreatment(null); setFrames([]); setCast([]);
  };
  const writeTreatment = () => {
    treatmentFetcher.submit(
      { intent: "previewFilmTreatment", template, filmTopic: topic, filmScenes: String(scenes), filmGenre, filmProductTitle: prodTitle, filmProductImageUrl: prodImage, filmProductDescription: prodDesc, ...(artistName ? { filmArtistName: artistName } : {}) },
      { method: "post" }
    );
  };
  // Pre-seed the storyboard: render every scene's still (props placed) for approval before paying.
  const firePreviewScenes = (tr?: Treatment | null) => {
    const useTr = tr || treatment;
    sceneSeedsFetcher.submit(
      { intent: "previewFilmScenes", template, filmTopic: topic, filmScenes: String(scenes), filmGenre, ...(filmProps.length ? { filmProps: JSON.stringify(filmProps) } : {}), ...(customProps.length ? { filmCustomProps: JSON.stringify(customProps) } : {}), ...(artistPick ? { filmHeroUrl: artistPick } : {}), ...(useTr ? { approvedTreatment: JSON.stringify(useTr) } : {}) },
      { method: "post" }
    );
  };
  const previewScenes = () => firePreviewScenes();
  const seedBusy = sceneSeedsFetcher.state !== "idle";
  // ONE button that does BOTH — write the song, then build the scenes (owner: "same thing, one
  // button, do both"). We chain two fast calls so the song's words AUTOPOPULATE the filmstrip in
  // seconds, then the stills fill in — instead of one long silent wait. A BYO track skips the write.
  const [chainToScenes, setChainToScenes] = useState(false);
  const makeStoryboard = () => {
    if (writing || seedBusy) return;
    if (songSource === "upload" && filmSongUrl) { previewScenes(); return; } // own track — no song to write
    if (treatment && !seeds) { previewScenes(); return; }                    // song already written — add visuals
    if (seeds) { setSeeds(null); }                                           // start over — fresh song + scenes
    setChainToScenes(true);
    writeTreatment();
  };
  // When the song lands during a chain, auto-continue into the stills (with the fresh treatment).
  useEffect(() => {
    if (!chainToScenes || writing) return;
    const tr2 = treatmentFetcher.data?.treatment;
    if (tr2 && tr2.scenes?.length) { setChainToScenes(false); firePreviewScenes(tr2); }
  }, [treatmentFetcher.data, writing, chainToScenes]); // eslint-disable-line react-hooks/exhaustive-deps
  // Capture the previewed stills + the hero; the render then uses these EXACT images (no surprise),
  // and the hero lets a single scene be re-rolled without changing the artist.
  useEffect(() => {
    const sd = sceneSeedsFetcher.data;
    if (sd?.ok && sd.sceneImgs && sd.treatment) setSeeds({ imgs: sd.sceneImgs, treatment: sd.treatment, propForScene: sd.propForScene || {}, artistRef: sd.artistRef || null, castRef: sd.castRef || null });
  }, [sceneSeedsFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Re-roll ONE storyboard scene (reusing the hero / cast ref) when it came back wrong; swap that still.
  const rerollScene = (i: number) => {
    if (!seeds || (!seeds.artistRef && !seeds.castRef)) return;
    setRerollingScene(i);
    rerollSceneFetcher.submit(
      { intent: "rerollFilmScene", template, filmGenre, artistRef: seeds.artistRef || "", castRef: seeds.castRef || "", sceneVisual: seeds.treatment.scenes[i]?.visual || "", sceneIndex: String(i), ...(seeds.propForScene[i] ? { propKey: seeds.propForScene[i] } : {}) },
      { method: "post" }
    );
  };
  useEffect(() => {
    const rd = rerollSceneFetcher.data;
    if (rerollSceneFetcher.state === "idle" && rd) {
      if (rd.ok && typeof rd.sceneIndex === "number" && rd.img) {
        const idx = rd.sceneIndex, nimg = rd.img;
        setSeeds((prev) => (prev ? { ...prev, imgs: prev.imgs.map((u, j) => (j === idx ? nimg : u)) } : prev));
      }
      setRerollingScene(null);
    }
  }, [rerollSceneFetcher.state, rerollSceneFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Any setup change invalidates the preview — the stills would no longer match the new settings
  // (the artist too: a different face means the stills show the wrong person).
  useEffect(() => { setSeeds(null); }, [filmGenre, JSON.stringify(filmProps), topic, scenes, songSource, filmSongUrl, artistPick]); // eslint-disable-line react-hooks/exhaustive-deps
  // Click-to-edit the storyboard text — polish a scene's "what happens" or its words in place; the
  // render reads the edited treatment. Editing the VISUAL marks the still stale (re-roll to match).
  // Writes to the stills' snapshot once they exist, otherwise to the autopopulated story treatment.
  const editSceneText = (i: number, field: "visual" | "caption", value: string) => {
    if (seeds) {
      setSeeds((prev) => (prev ? { ...prev, treatment: { ...prev.treatment, scenes: prev.treatment.scenes.map((s, j) => (j === i ? { ...s, [field]: value } : s)) } } : prev));
    } else if (treatment) {
      setTreatment({ ...treatment, scenes: treatment.scenes.map((s, j) => (j === i ? { ...s, [field]: value } : s)) });
    }
  };
  // Each scene is a PERFORMANCE shot (the artist sings, lip-synced) or a CUT SCENE / b-roll (cars,
  // props, dancing — no lip-sync). Default cadence mirrors the pipeline SHOTLIST (cycles every 8) so
  // the pre-editor shows a sensible type per scene; the merchant can flip any scene.
  const DEFAULT_ROLES: Array<"perform" | "broll"> = ["broll", "perform", "broll", "perform", "broll", "broll", "perform", "broll"];
  const sceneKind = (sc: Scene, i: number): "perform" | "broll" => sc?.kind || DEFAULT_ROLES[i % DEFAULT_ROLES.length];
  const setSceneKind = (i: number, kind: "perform" | "broll") => {
    if (seeds) setSeeds((prev) => (prev ? { ...prev, treatment: { ...prev.treatment, scenes: prev.treatment.scenes.map((s, j) => (j === i ? { ...s, kind } : s)) } } : prev));
    else if (treatment) setTreatment({ ...treatment, scenes: treatment.scenes.map((s, j) => (j === i ? { ...s, kind } : s)) });
  };
  // Add / reorder / delete scenes in the pre-editor. Structural edits keep the stills (imgs) and the
  // per-scene prop map index-aligned to the scenes array, so nothing shifts out from under a still.
  const structEditScenes = (fn: (cur: { scenes: Scene[]; imgs: (string | null)[]; prop: Record<number, string> }) => { scenes: Scene[]; imgs: (string | null)[]; prop: Record<number, string> }) => {
    if (seeds) {
      setSeeds((prev) => {
        if (!prev) return prev;
        const r = fn({ scenes: prev.treatment.scenes, imgs: prev.imgs, prop: prev.propForScene });
        return { ...prev, treatment: { ...prev.treatment, scenes: r.scenes }, imgs: r.imgs, propForScene: r.prop };
      });
    } else if (treatment) {
      const r = fn({ scenes: treatment.scenes, imgs: [], prop: {} });
      setTreatment({ ...treatment, scenes: r.scenes });
    }
  };
  const reindexProp = (prop: Record<number, string>, removed: number) => {
    const out: Record<number, string> = {};
    Object.keys(prop).forEach((k) => { const n = +k; if (n < removed) out[n] = prop[n]; else if (n > removed) out[n - 1] = prop[n]; });
    return out;
  };
  const sbAddScene = () => structEditScenes(({ scenes, imgs, prop }) => ({ scenes: [...scenes, { visual: "", caption: "", kind: "broll" }], imgs: [...imgs, null], prop }));
  const sbRemoveScene = (i: number) => structEditScenes(({ scenes, imgs, prop }) => ({ scenes: scenes.filter((_, j) => j !== i), imgs: imgs.filter((_, j) => j !== i), prop: reindexProp(prop, i) }));

  // The storyboard: ONE collapsed button → a swipeable filmstrip of the actual scene stills (each
  // re-rollable, text click-to-edit), so you approve what will render before paying. Reused by BOTH
  // the Music Video card-builder and the film flow — one row, so it never turns a page into a doom-scroll.
  // The Make-the-scenes button (Music Video): one button that writes the song AND builds the scenes.
  // Lives in the final "make & generate" card, next to Generate — not floating in the filmstrip.
  // Loading as a PROCESS (not an all-at-once "sketching"): a determinate bar + "scene N of M" + ETA
  // that advances while the stills render, so the wait reads like Archive loading, with an end in sight.
  const [seedPct, setSeedPct] = useState(0);
  useEffect(() => {
    if (!seedBusy) { setSeedPct(0); return; }
    const estMs = Math.max(14, Math.ceil(scenes / 3) * 9) * 1000;
    const start = Date.now();
    const id = window.setInterval(() => {
      const el = Date.now() - start;
      setSeedPct(Math.min(92, (1 - Math.exp(-el / (estMs * 0.6))) * 100));
    }, 350);
    return () => window.clearInterval(id);
  }, [seedBusy, scenes]);
  const seedProgressUI = () => {
    const estSec = Math.max(14, Math.ceil(scenes / 3) * 9);
    const cur = Math.min(scenes, Math.floor((seedPct / 100) * scenes) + 1);
    const left = Math.max(3, Math.ceil((1 - seedPct / 100) * estSec));
    return (
      <div className="mm-sb-prog" role="status" aria-live="polite">
        <div className="mm-sb-prog-top"><span><span className="mm-sb-prog-spin" aria-hidden="true" /> {t("Drawing your scenes")}</span><span className="mm-sb-prog-eta">{t("about {n}s left", { n: left })}</span></div>
        <div className="mm-sb-prog-track"><div className="mm-sb-prog-fill" style={{ width: `${Math.round(seedPct)}%` }} /></div>
        <div className="mm-sb-prog-step">{t("Scene {cur} of {total} · rendering…", { cur, total: scenes })}</div>
      </div>
    );
  };
  const makeBtn = () => {
    const hasStills = !!seeds;
    const busy = writing || seedBusy || chainToScenes;
    return (<>
      <button type="button" className="mm-preview-btn" onClick={makeStoryboard} disabled={busy || !d.hasPlan}>
        {busy ? (writing ? <>… {t("Writing your song")}</> : <>… {t("Building the scenes")}</>)
          : hasStills ? <><Ico n="refresh" size={13} /> {t("Start over — new song + scenes")}</>
          : <><Ico n="wand" size={14} /> {t("Make the scenes — free")}</>}
      </button>
      {sceneSeedsFetcher.data?.error && <p className="fs-err">{sceneSeedsFetcher.data.error}</p>}
      {seedBusy && !hasStills && seedProgressUI()}
    </>);
  };
  const storyboard = (autofill = false, makeFn?: () => void, filmstripOnly = false) => {
    // AUTOPOPULATE (autofill flows, e.g. Music Video): the filmstrip fills from the STORY the moment
    // there's a treatment — each scene's "what happens" + words appear immediately (free, click-to-edit).
    // The STILLS fill in when you Preview; until then each frame is a placeholder. So the strip builds
    // itself from the story + song + artist you set, and you polish the words before spending on visuals.
    // Non-autofill flows keep their own story view and only reveal the filmstrip once stills exist.
    // filmstripOnly (Music Video) = render JUST the swipeable strip; the Make button lives in the gen card.
    const strip = seeds?.treatment || (autofill ? treatment : null);
    const hasStills = !!seeds;
    const busy = makeFn ? (writing || seedBusy || chainToScenes) : seedBusy;
    return (
    <div className="mm-storyboard">
      {!filmstripOnly && (<>
      <button type="button" className="mm-preview-btn" onClick={makeFn || previewScenes} disabled={busy || !d.hasPlan}>
        {busy ? (makeFn && writing ? <>… {t("Writing your song")}</> : <>… {t("Building the scenes")}</>)
          : hasStills ? <><Ico n="refresh" size={13} /> {makeFn ? t("Start over — new song + scenes") : t("Re-roll the scenes")}</>
          : strip ? <><Ico n="image" size={13} /> {t("Add the visuals — free")}</>
          : makeFn ? <><Ico n="wand" size={14} /> {t("Make the scenes — free")}</>
          : <><Ico n="film" size={13} /> {t("Preview the scenes — free")}</>}
      </button>
      {sceneSeedsFetcher.data?.error && <p className="fs-err">{sceneSeedsFetcher.data.error}</p>}
      {seedBusy && !hasStills && seedProgressUI()}
      </>)}
      {strip && (() => {
        const isMv = !!tmpl?.lipSyncSinger;
        return (
        <>
          <div className="mm-sb-head"><Ico n="check" size={13} /> {isMv
            ? t("Here's your video, shot by shot — every scene's right here. Tap any line to change it. A green Performance is sung to camera; a purple Cut scene breaks to props or scenery with no singing (tap the pill to switch). Happy with it? Hit Generate.")
            : (hasStills
              ? t("Swipe through your story — this is exactly what renders. Re-roll any scene that's off, then Generate.")
              : t("Here's your story, scene by scene — tap any line to polish it. Add the visuals to see each scene come to life."))}</div>
          {/* Pre-editor: a vertical list of scene cards (not a cramped strip) — each with its still, an
              editable "what we see" + "words", and a Performance/Cut-scene type you can flip. */}
          <div className={`mm-sb-list${isMv ? " is-mv" : ""}`}>
            {strip.scenes.map((sc, i) => {
              const u = seeds?.imgs[i] ?? null;
              const pk = seeds?.propForScene[i];
              const pl = pk ? ((d.props || []).find((pp) => pp.key === pk)?.label || pk) : "";
              const perform = !isMv || sceneKind(sc, i) === "perform";
              return (
                <div className={`mm-sc${isMv ? (perform ? " is-perform" : " is-broll") : ""}`} key={i}>
                  <div className="mm-sc-frame">
                    {u ? <img src={u} alt={t("Scene {n}", { n: i + 1 })} loading="lazy" /> : <span className="mm-sc-load wb-cookimg" aria-hidden="true"><span className="wb-bufwrap"><span className="wb-spin" /></span></span>}
                    {rerollingScene === i && <span className="mm-sb-busy"><span className="mm-sb-spin" /></span>}
                    <span className="mm-sb-num">{i + 1}</span>
                    <button type="button" className="mm-sc-x" onClick={() => sbRemoveScene(i)} disabled={strip.scenes.length <= 1} title={t("Remove this scene")} aria-label={t("Remove scene {n}", { n: i + 1 })}>✕</button>
                    {seeds && (seeds.artistRef || seeds.castRef) && <button type="button" className="mm-sb-reroll" onClick={() => rerollScene(i)} disabled={rerollingScene !== null} title={t("Re-roll this scene")} aria-label={t("Re-roll scene {n}", { n: i + 1 })}><Ico n="refresh" size={12} /></button>}
                  </div>
                  <div className="mm-sc-bd">
                    {isMv
                      ? <button type="button" className="mm-sc-type" onClick={() => setSceneKind(i, perform ? "broll" : "perform")} title={t("Performance = sung to camera (lip-synced). Cut scene = b-roll, no singing. Tap to switch.")} aria-label={t("Scene {n} is a {type} — tap to switch", { n: i + 1, type: perform ? t("Performance") : t("Cut scene") })}><span className="mm-sc-dot" aria-hidden="true" /> {perform ? t("Performance") : t("Cut scene")} <Ico n="refresh" size={10} /></button>
                      : <span className="mm-sc-num">{t("Scene {n}", { n: i + 1 })}</span>}
                    <textarea className="mm-sc-what" value={sc?.visual || ""} onChange={(e) => editSceneText(i, "visual", e.target.value)} rows={2} maxLength={400} placeholder={t("what we see in this scene…")} aria-label={t("Scene {n} — what we see", { n: i + 1 })} />
                    {isMv
                      ? (perform
                        ? <textarea className="mm-sc-words" value={sc?.caption || ""} onChange={(e) => editSceneText(i, "caption", e.target.value)} rows={1} maxLength={300} placeholder={t("the lyric lines sung here…")} aria-label={t("Scene {n} — the words", { n: i + 1 })} />
                        : <span className="mm-sc-note">{t("Cut scene — no singing; cuts to props or scenery.")}</span>)
                      : ((sc?.caption != null) && <textarea className="mm-sc-words" value={sc?.caption || ""} onChange={(e) => editSceneText(i, "caption", e.target.value)} rows={1} maxLength={300} placeholder={t("the words / lyrics…")} aria-label={t("Scene {n} — the words", { n: i + 1 })} />)}
                    {((isMv && perform && artistName) || pl) && (
                      <div className="mm-sc-chips">
                        {isMv && perform && artistName && <span className="mm-sc-chip mm-chip-av">{artistPick ? <img src={artistPick} alt="" /> : null}{artistName}</span>}
                        {pl && <span className="mm-sc-chip mm-chip-pr">{t(pl)}</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button type="button" className="mm-sc-add" onClick={sbAddScene}>+ {t("Add a scene")}</button>
        </>
        );
      })()}
    </div>
    );
  };
  const editCaption = (i: number, v: string) => {
    if (!treatment) return;
    setTreatment({ ...treatment, scenes: treatment.scenes.map((s, j) => (j === i ? { ...s, caption: v } : s)) });
  };
  const editVisual = (i: number, v: string) => {
    if (!treatment) return;
    setTreatment({ ...treatment, scenes: treatment.scenes.map((s, j) => (j === i ? { ...s, visual: v } : s)) });
  };

  // ---- FLOW editor (location + camera-angle storyboard) --------------------
  // Each beat carries where (location) + shot (camera angle). GROUP the flat scenes
  // into locations → angles → beats for the flow view; edits write straight back to
  // the flat array, so the existing submit (approvedTreatment = treatment) carries the
  // whole structure to the engine. Inside a location it renders seamless; a new
  // location is a scene-change cut (cast carried); a new shot is a same-room angle cut.
  const WIDE = "wide two-shot";
  const parseBeat = (cap?: string): { speaker: string; line: string } => {
    const m = (cap || "").match(/^\s*([^:]{1,40}):\s*([\s\S]*)$/);
    return m ? { speaker: m[1].trim(), line: m[2].trim() } : { speaker: "", line: (cap || "").trim() };
  };
  const whereOf = (s: Scene, prev: string) => (s.where || "").trim() || prev || (s.visual || "").split(/[.;]/)[0].trim().slice(0, 80) || "A cinematic location";
  type FlowBeat = { idx: number; speaker: string; line: string };
  type FlowAngle = { shot: string; beats: FlowBeat[]; lastIdx: number };
  type FlowLoc = { where: string; firstIdx: number; lastIdx: number; angles: FlowAngle[] };
  const flow: FlowLoc[] = (() => {
    const locs: FlowLoc[] = []; let prevWhere = "";
    (treatment?.scenes || []).forEach((s, idx) => {
      const where = whereOf(s, prevWhere); prevWhere = where;
      const shot = (s.shot || "").trim() || WIDE;
      let loc = locs[locs.length - 1];
      if (!loc || loc.where !== where) { loc = { where, firstIdx: idx, lastIdx: idx, angles: [] }; locs.push(loc); }
      loc.lastIdx = idx;
      let ang = loc.angles[loc.angles.length - 1];
      if (!ang || ang.shot !== shot) { ang = { shot, beats: [], lastIdx: idx }; loc.angles.push(ang); }
      ang.lastIdx = idx;
      const { speaker, line } = parseBeat(s.caption);
      ang.beats.push({ idx, speaker, line });
    });
    return locs;
  })();
  const firstTok = (n: string) => (n || "").toLowerCase().split(/[\s,]/)[0];
  const speakerNames: string[] = (() => {
    const seen = new Set<string>(); const out: string[] = [];
    const add = (nm: string) => { const k = firstTok(nm); if (nm && k && !seen.has(k)) { seen.add(k); out.push(nm); } };
    cast.forEach((c) => c.name && add(c.name)); // prefer the cast's proper-case names
    (treatment?.scenes || []).forEach((s) => { const sp = parseBeat(s.caption).speaker; if (sp) add(sp); });
    return out;
  })();
  const displayName = (sp: string) => speakerNames.find((n) => firstTok(n) === firstTok(sp)) || sp;
  const faceOf = (name: string) => cast.find((c) => c.name && name && firstTok(c.name) === firstTok(name))?.faceUrl || null;
  const mutateScenes = (fn: (scenes: Scene[]) => Scene[]) => {
    if (!treatment) return;
    const next = fn(treatment.scenes.slice());
    setTreatment({ ...treatment, scenes: next }); setScenes(next.length);
  };
  const setBeatLine = (idx: number, line: string) => mutateScenes((ss) => ss.map((s, j) => (j === idx ? { ...s, caption: `${parseBeat(s.caption).speaker || speakerNames[0] || "Name"}: ${line}` } : s)));
  const setBeatSpeaker = (idx: number, name: string) => mutateScenes((ss) => ss.map((s, j) => (j === idx ? { ...s, caption: `${name}: ${parseBeat(s.caption).line}` } : s)));
  const nextSpeaker = (cur: string) => { if (!speakerNames.length) return cur; const i = speakerNames.findIndex((n) => firstTok(n) === firstTok(cur)); return speakerNames[((i < 0 ? -1 : i) + 1) % speakerNames.length]; };
  const insertAt = (ss: Scene[], at: number, s: Scene) => { const out = ss.slice(); out.splice(Math.min(Math.max(0, at), out.length), 0, s); return out; };
  const addBeat = (loc: FlowLoc, ang: FlowAngle) => mutateScenes((ss) => {
    const base = ss[loc.firstIdx];
    const prevSpk = ang.beats[ang.beats.length - 1]?.speaker || speakerNames[0] || "";
    return insertAt(ss, ang.lastIdx + 1, { visual: base?.visual || loc.where, where: loc.where, shot: ang.shot, caption: `${nextSpeaker(prevSpk)}: ` });
  });
  const addAngle = (loc: FlowLoc) => mutateScenes((ss) => {
    const base = ss[loc.firstIdx];
    const who = speakerNames[0] || "Name";
    return insertAt(ss, loc.lastIdx + 1, { visual: base?.visual || loc.where, where: loc.where, shot: `close-up on ${who}`, caption: `${who}: ` });
  });
  const addScene = () => mutateScenes((ss) => [...ss, { visual: "A new location", where: "A new location", shot: WIDE, caption: `${speakerNames[0] || "Name"}: ` }]);
  const setWhere = (loc: FlowLoc, where: string) => mutateScenes((ss) => ss.map((s, j) => (j >= loc.firstIdx && j <= loc.lastIdx ? { ...s, where, visual: s.visual && s.visual !== loc.where ? s.visual : where } : s)));
  const setAngleShot = (ang: FlowAngle, shot: string) => mutateScenes((ss) => ss.map((s, j) => (ang.beats.some((b) => b.idx === j) ? { ...s, shot } : s)));
  // Remove an angle CHANGE: fold this angle's beats back into the location's FIRST shot,
  // so they rejoin the one seamless take (the only things that keep a cut are the user's
  // explicit "cut to a close-up" and a new scene).
  const removeAngle = (loc: FlowLoc, ang: FlowAngle) => mutateScenes((ss) => {
    const base = loc.angles[0]?.shot || WIDE;
    return ss.map((s, j) => (ang.beats.some((b) => b.idx === j) ? { ...s, shot: base } : s));
  });
  const removeBeat = (idx: number) => mutateScenes((ss) => (ss.length > 1 ? ss.filter((_, j) => j !== idx) : ss));
  // Render (or re-roll) one scene's storyboard photo. Reuses a prior approved frame
  // as the style reference so faces + wardrobe stay consistent across shots.
  // The locked cast faces for the characters whose name appears in a shot — so the
  // frame is composed from the exact same actors every time (the consistency lever).
  const shotCastRefs = (s: Scene): string[] => {
    const hay = `${s.visual} ${s.caption || ""}`.toLowerCase();
    return cast
      .filter((c) => c.faceUrl && c.name && hay.includes(c.name.toLowerCase().split(/[\s,]/)[0]))
      .map((c) => c.faceUrl as string)
      .slice(0, 3);
  };
  const makeFrame = (i: number) => {
    if (!treatment || framingIndex !== null) return;
    const s = treatment.scenes[i];
    if (!s?.visual.trim()) return;
    const castText = (treatment.cast || []).join("; ");
    // Anchor every shot to the ESTABLISHING frame (the first one set), not the most
    // recent — chaining shot→shot let the room drift a little each time and it compounded.
    // One fixed anchor keeps all shots in the same set (same booth, new angles).
    const styleRef = frames.find((f, j) => !!f && j !== i) || "";
    setFramingIndex(i);
    previewFrameFetcher.submit(
      { intent: "previewFilmFrame", template, sceneVisual: s.visual, castText, styleRefUrl: styleRef, sceneIndex: String(i), castRefs: JSON.stringify(shotCastRefs(s)) },
      { method: "post" }
    );
  };
  // Use an image the merchant already made (e.g. in Creator) as this scene's frame.
  const useFrameUrl = (i: number, url: string) => {
    const u = url.trim();
    if (u !== "" && !/^(https?:\/\/|\/)/.test(u)) return; // wait for a plausible URL
    setFrames((prev) => { const next = prev.slice(); next[i] = u || null; return next; });
  };
  // ── Cast handlers: lock a face (render a portrait / pick a made image), pick a voice.
  const makePortrait = (i: number) => {
    if (castingIndex !== null) return;
    const c = cast[i];
    if (!c || !c.desc.trim()) return;
    setCastingIndex(i);
    portraitFetcher.submit(
      { intent: "previewFilmPortrait", castDesc: c.desc, castIndex: String(i), template },
      { method: "post" }
    );
  };
  const useCastFace = (i: number, url: string) => {
    const u = url.trim();
    if (u !== "" && !/^(https?:\/\/|\/)/.test(u)) return;
    setCast((prev) => prev.map((c, j) => (j === i ? { ...c, faceUrl: u || null } : c)));
  };
  const setCastVoice = (i: number, voiceId: string) => {
    setCast((prev) => prev.map((c, j) => (j === i ? { ...c, voiceId: voiceId || null } : c)));
  };
  // Make the cast editable + buildable — rename, re-describe, add your own character, or remove one.
  // This is how you "create" a cast member (a cartoon character for Kids Cartoon, an actor for a film):
  // add one, describe it, then Cast a face (cartoon-styled for cartoon templates).
  const setCastName = (i: number, name: string) => setCast((prev) => prev.map((c, j) => (j === i ? { ...c, name } : c)));
  const setCastDesc = (i: number, desc: string) => setCast((prev) => prev.map((c, j) => (j === i ? { ...c, desc } : c)));
  const addCastMember = () => setCast((prev) => (prev.length >= 8 ? prev : [...prev, { name: "", desc: "", faceUrl: null, voiceId: null }]));
  const removeCastMember = (i: number) => setCast((prev) => prev.filter((_, j) => j !== i));
  // Hear an actor's voice — the real MiniMax sample (public/voice-samples/<id>.mp3).
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const playVoice = (voiceId: string | null) => {
    if (!voiceId) return;
    try {
      if (voiceAudioRef.current) { voiceAudioRef.current.pause(); }
      const a = new Audio(`/voice-samples/${voiceId}.mp3`);
      voiceAudioRef.current = a;
      a.play().catch(() => { /* autoplay / missing sample — fine */ });
    } catch { /* no Audio — fine */ }
  };
  // Edit the current frame in place (Creator's photo-edit engine) — refine without leaving.
  const applyEdit = (i: number) => {
    if (framingIndex !== null) return;
    const cur = frames[i]; const edit = (editDraft[i] || "").trim();
    if (!cur || !edit) return;
    setFramingIndex(i);
    previewFrameFetcher.submit(
      { intent: "editFilmFrame", frameUrl: cur, edit, sceneIndex: String(i) },
      { method: "post" }
    );
  };

  // Per-format identity for the picker — accent tint, a one-word "kicker", and a
  // length/voice chip. The cover is the format's real AI still (/landing/film-still-*).
  const FMT: Record<string, { tint: string; kick: string; meta: string }> = {
    musicvideo: { tint: "t-mv", kick: "Sings on camera", meta: "~2 min · lip-synced" },
    moral: { tint: "t-moral", kick: "They talk it out", meta: "~45 sec · spoken" },
    horror: { tint: "t-horror", kick: "Builds the dread", meta: "~45 sec · spoken" },
    testmovie: { tint: "t-film", kick: "The flagship", meta: "~1 min · spoken" },
    kidstv: { tint: "t-kids", kick: "Peppa / Bluey", meta: "~40 sec · G-rated" },
    kidsmusicvideo: { tint: "t-kmv", kick: "CoComelon", meta: "~30 sec · sings" },
  };
  const fmtIcon = (key: string) => {
    if (key === "musicvideo" || key === "kidsmusicvideo") return <svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>;
    if (key === "moral") return <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
    if (key === "horror") return <svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7v12l2.5-2 2.5 2 2-2 2 2 2.5-2 2.5 2V9a7 7 0 0 0-7-7z" /><circle cx="9.5" cy="10" r="1" /><circle cx="14.5" cy="10" r="1" /></svg>;
    if (key === "kidstv") return <svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8" /><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="9.5" cy="12" r="1" /><circle cx="14.5" cy="12" r="1" /><path d="M9 16c1 1 5 1 6 0" /></svg>;
    return <svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2.5" /><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 7h5M17 17h5" /></svg>;
  };

  return (
    <div className="fs-wrap">
      <style>{FS_STYLE}</style>

      <div className="fs-head">
        <video className="fs-head-vid" autoPlay muted loop playsInline poster="/landing/film-hero.jpg?v=5" aria-hidden="true">
          <source src="/landing/film-hero.mp4" type="video/mp4" />
        </video>
        <span className="fs-head-scrim" aria-hidden="true" />
        <div className="fs-head-copy">
          <span className="fs-head-eyebrow"><span className="fs-head-dot" aria-hidden="true" /> {t("Easymode Studio")}</span>
          <b>{t("Make a movie.")} <em>{t("Just describe it.")}</em></b>
          <span>{t("Pick a format, tell us the idea — we write it and film it. You just press go.")}</span>
        </div>
      </div>

      {/* ───────── Pick a format, cinematic ─────────
          Land on a 2-up grid of poster cards. Tap one → the letterbox sweeps shut and it opens, like a
          title card, into THAT format's builder (no doom-scroll past tiles you aren't using). */}
      <div className="fs-switch">
        {!entered && (
          <div className={`fs-fmtgrid${anim === "in" ? " throw" : ""}`} role="tablist" aria-label={t("Movie formats")}>
            {d.templates.map((x) => {
              const m = FMT[x.key] || { tint: "t-film", kick: "", meta: "" };
              return (
                <button type="button" role="tab" key={x.key} className={`fs-fmt${zoomKey === x.key ? " zoom" : ""}`}
                  style={zoomKey === x.key ? zoomStyle : undefined}
                  aria-selected={template === x.key} onClick={(e) => enterFormat(x.key, e)}>
                  <span className="fs-fmt-cover">
                    <img src={`/landing/film-still-${x.key}.jpg?v=3`} alt="" loading="lazy"
                      onError={(e) => { const el = e.currentTarget; if (!el.dataset.fb) { el.dataset.fb = "1"; el.src = "/landing/film-hero.jpg?v=5"; } }} />
                    <span className={`fs-fmt-ico ${m.tint}`} aria-hidden="true">{fmtIcon(x.key)}</span>
                    <span className="fs-fmt-label"><b>{t(x.name)}</b></span>
                  </span>
                  {m.kick ? <span className="fs-fmt-sub">{t(m.kick)}{m.meta ? <em> · {t(m.meta)}</em> : null}</span> : null}
                </button>
              );
            })}
          </div>
        )}

        {entered && (
          <div className={`fs-stage${anim === "out" ? " out" : ""}`}>
            <div className="fs-hero">
              <img className="fs-hero-art" src={`/landing/film-still-${template}.jpg?v=3`} alt=""
                onError={(e) => { const el = e.currentTarget; if (!el.dataset.fb) { el.dataset.fb = "1"; el.src = "/landing/film-hero.jpg?v=5"; } }} />
              <div className="fs-hero-scrim" aria-hidden="true" />
              <button type="button" className="fs-hero-back" onClick={exitFormat}><span aria-hidden="true">‹</span> {t("Formats")}</button>
              <div className="fs-hero-ttl">{t(tmpl?.name || "Film")}</div>
              <div className="fs-hero-sub">{t(FMT[template]?.kick || "")}{FMT[template]?.meta ? ` · ${t(FMT[template].meta)}` : ""}</div>
            </div>
            <div className="fs-stepsin" key={template}>

      {/* ───────── Music Video — the card builder (elegant, Studio-style) ─────────
          One topic field + four summary cards you tap to edit, then Generate.
          Replaces the long-scroll form for the sing lanes only. */}
      {tmpl?.lipSyncSinger && (
        <div className="mm">
          <div className="mm-topic">
            <label htmlFor="mm-topic-in">{t("What's your video about?")}</label>
            <input id="mm-topic-in" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300}
              placeholder={t("e.g. grinding from nothing, staying loyal, winning big")} />
          </div>

          <div className="mm-hint"><span aria-hidden="true">✎</span> {t("Tap each step to set it — we've filled in smart defaults, so you can breeze through and just Make it.")}</div>

          {/* A numbered 1→5 step flow, two across — each box goes green as you set it. */}
          <div className="mm-grid">
            {/* 1 · Artist — pick one of your avatars to STAR, or let us cast one */}
            <button type="button" style={{ order: 1 }} className={`mm-card${openCard === "artist" ? " on" : ""}${stepsDone.artist ? " done" : ""}`} onClick={() => tapCard("artist")}>
              <span className="mm-step" aria-hidden="true">{stepsDone.artist ? <Ico n="check" size={13} /> : 1}</span>
              <span className="mm-card-top">
                {artistPick
                  ? <span className="mm-card-face" style={{ backgroundImage: `url(${artistPick})` }} aria-hidden="true" />
                  : <span className="mm-card-ico c5"><Ico n="presenter" size={20} /></span>}
                <span className="mm-card-ttl"><span className="mm-card-kick">{t("The star")}</span><b>{t("Artist")}</b></span>
              </span>
              <span className="mm-val">{artistPick ? <><Ico n="check" size={12} /> {artistName || t("Your avatar")}</> : t("We cast one · or pick your avatar")}</span>
            </button>
            {/* 2 · Genre */}
            <button type="button" style={{ order: 3 }} className={`mm-card${openCard === "genre" ? " on" : ""}${stepsDone.genre ? " done" : ""}`} onClick={() => tapCard("genre")}>
              <span className="mm-step" aria-hidden="true">{stepsDone.genre ? <Ico n="check" size={13} /> : 2}</span>
              <span className="mm-card-top"><span className="mm-card-face" style={{ backgroundImage: `url(/genreimg/${filmGenre})` }} aria-hidden="true" /><span className="mm-card-ttl"><span className="mm-card-kick">{t("The beat")}</span><b>{t("Genre")}</b></span></span>
              <span className="mm-val">{t((d.genres || []).find((g) => g.key === filmGenre)?.label || "Rap / Hip-Hop")}</span>
            </button>
            {/* 3 · Song */}
            <button type="button" style={{ order: 5 }} className={`mm-card${openCard === "song" ? " on" : ""}${stepsDone.song ? " done" : ""}`} onClick={() => tapCard("song")}>
              <span className="mm-step" aria-hidden="true">{stepsDone.song ? <Ico n="check" size={13} /> : 3}</span>
              <span className="mm-card-top"><span className="mm-card-ico c2"><Ico n="sound" size={20} /></span><span className="mm-card-ttl"><span className="mm-card-kick">{t("The song")}</span><b>{songSource === "upload" ? t("Your track") : t("Write me one")}</b></span></span>
              <span className="mm-val">{songSource === "upload" ? (filmSongUrl ? <><Ico n="check" size={12} /> {songName || t("Song uploaded")}</> : t("Upload your own track")) : <>{t("We write + produce it ·")} <b className="mm-free">{t("free")}</b></>}</span>
            </button>
            {/* 4 · Props */}
            <button type="button" style={{ order: 7 }} className={`mm-card${openCard === "props" ? " on" : ""}${stepsDone.props ? " done" : ""}`} onClick={() => tapCard("props")}>
              <span className="mm-step" aria-hidden="true">{stepsDone.props ? <Ico n="check" size={13} /> : 4}</span>
              <span className="mm-card-top">{filmProps.length > 0 ? <span className="mm-card-face" style={{ backgroundImage: `url(${propThumb(filmProps[0])})` }} aria-hidden="true" /> : <span className="mm-card-ico c3"><Ico n="gem" size={20} /></span>}<span className="mm-card-ttl"><span className="mm-card-kick">{t("Cool shit")}</span><b>{t("Props")}</b></span></span>
              {filmProps.length > 0 ? (
                <span className="mm-vchips">{filmProps.slice(0, 3).map((k) => { const p = (d.props || []).find((x) => x.key === k); const cp = customProps.find((x) => x.key === k); return <span className="mm-chip" key={k}>{cp ? cp.label : t(p?.name || k)}</span>; })}{filmProps.length > 3 && <span className="mm-chip">+{filmProps.length - 3}</span>}</span>
              ) : <span className="mm-val mm-muted">{t("none yet · tap to add tigers, cars, chains…")}</span>}
            </button>
            {/* 5 · Length (spans the row — it's the last, simple step) */}
            <button type="button" style={{ order: 9 }} className={`mm-card mm-card-wide${openCard === "length" ? " on" : ""}${stepsDone.length ? " done" : ""}`} onClick={() => tapCard("length")}>
              <span className="mm-step" aria-hidden="true">{stepsDone.length ? <Ico n="check" size={13} /> : 5}</span>
              <span className="mm-card-top"><span className="mm-card-ico c4"><Ico n="film" size={20} /></span><span className="mm-card-ttl"><span className="mm-card-kick">{t("The cut")}</span><b>{t("Length")}</b></span></span>
              <span className="mm-val">{t("{n} scenes · ~{sec}s · director's shots", { n: scenes, sec: scenes * 5 })}</span>
            </button>

            {/* Each step's options live INSIDE the grid, full-width right after its own card (via CSS
                `order`), so tapping a step opens its options AT the card — never buried down the page. */}
          {openCard === "artist" && (
            <div className="mm-opts mm-opts-grid" style={{ order: 2 }}>
              <div className="mm-opts-h">{t("Who's the artist?")}</div>
              <div className="mm-opts-sub">{t("Swipe to pick who stars — your avatars, or make a new one. That exact face performs every scene.")}</div>
              <input ref={artistPhotoRef} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden onChange={(e) => { uploadArtistPhoto(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
              <div className="mm-artistpick">
                <button type="button" className={`fs-rface mm-autoface${artistPick === "" ? " on" : ""}`} onClick={() => setArtistPick("")} title={t("Auto-cast")}>
                  <span className="fs-rface-img mm-autoface-img" aria-hidden="true"><Ico n="wand" size={20} /></span>
                  {artistPick === "" && <span className="fs-rface-chk" aria-hidden="true"><Ico n="check" size={11} /></span>}
                  <span className="fs-rface-name">{t("Auto-cast")}</span>
                </button>
                <button type="button" className={`fs-rface mm-newface${artistMakerOpen ? " on" : ""}`} onClick={() => setArtistMakerOpen((v) => !v)} title={t("Create an avatar")}>
                  <span className="fs-rface-img mm-newface-img" aria-hidden="true"><Ico n="wand" size={18} /></span>
                  <span className="fs-rface-name">{t("Create")}</span>
                </button>
                <button type="button" className="fs-rface mm-newface" onClick={() => artistPhotoRef.current?.click()} title={t("Upload a face")}>
                  <span className="fs-rface-img mm-newface-img" aria-hidden="true">{artistPhotoBusy ? <span className="mm-ptile-spin" /> : <Ico n="camera" size={18} />}</span>
                  <span className="fs-rface-name">{artistPhotoBusy ? t("Adding…") : t("Upload")}</span>
                </button>
                {customArtists.map((ca, i) => (
                  <button type="button" key={`ca${i}`} className={`fs-rface${artistPick === ca.img ? " on" : ""}`} title={ca.name} onClick={() => setArtistPick(ca.img)}>
                    <span className="fs-rface-img" style={{ backgroundImage: `url(${ca.img})` }} />
                    {artistPick === ca.img && <span className="fs-rface-chk" aria-hidden="true"><Ico n="check" size={11} /></span>}
                    <span className="fs-rface-name">{ca.name}</span>
                  </button>
                ))}
                {d.roster.map((r) => (
                  <button type="button" key={r.id} className={`fs-rface${artistPick === r.img ? " on" : ""}`} title={r.name} onClick={() => setArtistPick(r.img)}>
                    <span className="fs-rface-img" style={{ backgroundImage: `url(${r.img})` }} />
                    {artistPick === r.img && <span className="fs-rface-chk" aria-hidden="true"><Ico n="check" size={11} /></span>}
                    <span className="fs-rface-name">{r.name}</span>
                  </button>
                ))}
              </div>
              {artistMakerOpen && (
                <div className="mm-propmaker">
                  <input value={artistDesc} onChange={(e) => setArtistDesc(e.target.value)} maxLength={120} placeholder={t("e.g. a young woman with curly red hair; a bearded man in a leather jacket")}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); makeAiArtist(); } }} />
                  <button type="button" onClick={makeAiArtist} disabled={!artistDesc.trim() || makingArtist}>
                    {makingArtist ? <>… {t("Making")}</> : <><Ico n="wand" size={13} /> {t("Make it — free")}</>}
                  </button>
                </div>
              )}
              {artistMakerFetcher.data?.error && <p className="fs-err">{artistMakerFetcher.data.error}</p>}
            </div>
          )}
          {openCard === "genre" && (
            <div className="mm-opts mm-opts-grid" style={{ order: 4 }}>
              <div className="mm-opts-h">{t("Pick the genre")}</div>
              <div className="mm-opts-sub">{t("Swipe the genres — sets the song and the whole look. One artist performs it across your scenes.")}</div>
              <div className="mm-genrepick">
                {(d.genres || []).map((gr) => (
                  <button type="button" key={gr.key} className={`mm-gtile${filmGenre === gr.key ? " on" : ""}`} onClick={() => { setFilmGenre(gr.key); setTreatment(null); }} title={t(gr.label)}>
                    <span className="mm-gtile-img" style={{ backgroundImage: `url(/genreimg/${gr.key})` }} />
                    {filmGenre === gr.key && <span className="mm-ptile-chk" aria-hidden="true"><Ico n="check" size={11} /></span>}
                    <span className="mm-gtile-name">{t(gr.label)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {openCard === "song" && (
            <div className="mm-opts mm-opts-grid" style={{ order: 6 }}>
              <div className="mm-opts-h">{t("Your song")}</div>
              <div className="mm-opts-sub">{t("We write AND produce the whole song, free — and you can swap in your own lyrics on the next step. Only upload if you already have a finished recording (an MP3).")}</div>
              <div className="fs-songsrc-seg">
                <button type="button" className={`fs-songsrc-opt${songSource === "write" ? " on" : ""}`} onClick={() => setSongSource("write")}>{t("We produce it")}<small>{t("free · your lyrics ok")}</small></button>
                <button type="button" className={`fs-songsrc-opt${songSource === "upload" ? " on" : ""}`} onClick={() => setSongSource("upload")}>{t("I have a track")}<small>{t("a finished MP3")}</small></button>
              </div>
              {songSource === "upload" && (
                <div className="fs-songup" style={{ marginTop: 12 }}>
                  <input ref={songInputRef} type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/mp4,audio/x-m4a,audio/aac,.mp3,.wav,.m4a,.aac" hidden onChange={(e) => uploadSong(e.currentTarget.files?.[0])} />
                  <button type="button" className="fs-songup-btn" onClick={() => songInputRef.current?.click()} disabled={songBusy}>
                    {songBusy ? <>… {t("Uploading")}</> : filmSongUrl ? <><Ico n="check" size={14} /> {songName || t("Song uploaded")}</> : <><Ico n="music" size={14} /> {t("Choose a song file")}</>}
                  </button>
                  {filmSongUrl && <p className="fs-hint">{t("We'll build the whole video around your track — artist, director's shots and lip-sync.")}</p>}
                </div>
              )}
            </div>
          )}
          {openCard === "props" && (
            <div className="mm-opts mm-opts-grid" style={{ order: 8 }}>
              <div className="mm-opts-h">{t("Pick your props")}</div>
              <div className="mm-opts-sub">{t("Tap to add — we weave them into the scenes, tasteful not cheesy. Up to 6, or make your own.")}</div>
              <input ref={propPhotoRef} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden onChange={(e) => { uploadPropPhoto(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
              <div className="mm-proppick">
                {/* Make your own — AI from a description, or upload your own photo */}
                <button type="button" className={`mm-ptile mm-ptile-new${propMakerOpen ? " on" : ""}`} onClick={() => setPropMakerOpen((v) => !v)} title={t("Create an AI prop")}>
                  <span className="mm-ptile-img mm-ptile-newimg"><Ico n="wand" size={20} /></span>
                  <span className="mm-ptile-name">{t("Create AI prop")}</span>
                </button>
                <button type="button" className="mm-ptile mm-ptile-new" onClick={() => propPhotoRef.current?.click()} title={t("Add your own photo")}>
                  <span className="mm-ptile-img mm-ptile-newimg">{propPhotoBusy ? <span className="mm-ptile-spin" aria-hidden="true" /> : <Ico n="camera" size={20} />}</span>
                  <span className="mm-ptile-name">{propPhotoBusy ? t("Adding…") : t("Add a photo")}</span>
                </button>
                {/* Custom props the merchant made (their photo / AI prop) */}
                {customProps.map((cp) => (
                  <button type="button" key={cp.key} className={`mm-ptile${filmProps.includes(cp.key) ? " on" : ""}`} onClick={() => toggleProp(cp.key)} title={cp.label}>
                    <span className="mm-ptile-img" style={{ backgroundImage: `url(${cp.img})` }} />
                    {filmProps.includes(cp.key) && <span className="mm-ptile-chk" aria-hidden="true"><Ico n="check" size={11} /></span>}
                    <span className="mm-ptile-name">{cp.label}</span>
                  </button>
                ))}
                {/* Catalog props — real generated photos, not emoji */}
                {(d.props || []).map((pr) => (
                  <button type="button" key={pr.key} className={`mm-ptile${filmProps.includes(pr.key) ? " on" : ""}`} onClick={() => toggleProp(pr.key)} title={pr.name}>
                    <span className="mm-ptile-img" style={{ backgroundImage: `url(/propimg/${pr.key})` }} />
                    {filmProps.includes(pr.key) && <span className="mm-ptile-chk" aria-hidden="true"><Ico n="check" size={11} /></span>}
                    <span className="mm-ptile-name">{t(pr.name)}</span>
                  </button>
                ))}
              </div>
              {propMakerOpen && (
                <div className="mm-propmaker">
                  <input value={propDesc} onChange={(e) => setPropDesc(e.target.value)} maxLength={120} placeholder={t("e.g. a vintage gold microphone, a pet wolf, a neon skateboard")}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); makeAiProp(); } }} />
                  <button type="button" onClick={makeAiProp} disabled={!propDesc.trim() || makingProp}>
                    {makingProp ? <>… {t("Making")}</> : <><Ico n="wand" size={13} /> {t("Make it — free")}</>}
                  </button>
                </div>
              )}
              {propMakerFetcher.data?.error && <p className="fs-err">{propMakerFetcher.data.error}</p>}
            </div>
          )}
          {openCard === "length" && (
            <div className="mm-opts mm-opts-grid" style={{ order: 10 }}>
              <div className="mm-opts-h">{t("How long?")}</div>
              <div className="mm-opts-sub">{t("Each scene is a director's shot — about 5 seconds.")}</div>
              <div className="fs-len" style={{ marginTop: 4 }}>
                <span>{t("Scenes")}</span>
                <div className="fs-stepper">
                  <button type="button" onClick={() => bump(-1)} disabled={scenes <= tmpl.minScenes} aria-label={t("Fewer scenes")}>−</button>
                  <b>{scenes}</b>
                  <button type="button" onClick={() => bump(1)} disabled={scenes >= tmpl.maxScenes} aria-label={t("More scenes")}>+</button>
                </div>
                <span className="fs-len-note">{t("≈ {sec}s · {n} AI clips", { sec: scenes * 5, n: scenes })}</span>
              </div>
            </div>
          )}
          </div>{/* /mm-grid — cards + their inline option panels */}

          {/* ONE button does it all (below) — writes the song AND builds the scenes. Here we just show
              the song's title + mood once it's written, as a little header above the filmstrip. */}
          {treatment && (treatment.title || treatment.musicMood) && (
            <div className="mm-preview">
              <div className="fs-treat">
                {treatment.title && <div className="fs-treat-ttl">{treatment.title}</div>}
                {treatment.musicMood && <div className="fs-treat-mood"><Ico n="music" size={12} /> {treatment.musicMood}</div>}
              </div>
            </div>
          )}
          {treatmentFetcher.data?.error && <p className="fs-err">{treatmentFetcher.data.error}</p>}

          {/* The swipeable storyboard filmstrip ONLY (the sideways flow) — autopopulated, re-rollable,
              click-to-edit. The button that builds it lives in the "make & generate" step below. */}
          {storyboard(true, undefined, true)}

          {/* FINAL STEP — Make the scenes + Generate, combined in one box. */}
          <div className="mm-gen mm-makegen">
            <div className="mm-makegen-h">{t("Make & generate your video")}</div>
            {makeBtn()}
            <Form method="post">
              <input type="hidden" name="intent" value="film" />
              <input type="hidden" name="template" value={template} />
              <input type="hidden" name="filmGenre" value={filmGenre} />
              {songSource === "upload" && filmSongUrl && <input type="hidden" name="filmSongUrl" value={filmSongUrl} />}
              {filmProps.length > 0 && <input type="hidden" name="filmProps" value={JSON.stringify(filmProps)} />}
              {customProps.length > 0 && <input type="hidden" name="filmCustomProps" value={JSON.stringify(customProps)} />}
              {artistPick && <input type="hidden" name="filmHeroUrl" value={artistPick} />}
              <input type="hidden" name="filmTopic" value={topic} />
              <input type="hidden" name="filmScenes" value={String(scenes)} />
              {(seeds?.treatment || treatment) && <input type="hidden" name="approvedTreatment" value={JSON.stringify(seeds?.treatment || treatment)} />}
              {seeds && <input type="hidden" name="approvedSceneImgs" value={JSON.stringify(seeds.imgs)} />}
              {/* Generating is GATED on making the scenes first — you must script + preview the
                  storyboard (above) before you can spend tokens on the render. */}
              <button type="submit" className="mm-go" disabled={!canGo || !seeds}>
                {generating ? <>… {t("Starting your video")}</>
                  : !seeds ? <><Ico n="wand" size={17} /> {t("Make the scenes first ↑")}</>
                  : <><Ico n="film" size={17} /> {cost > 0 ? t("Render these scenes · {cost} Tokens", { cost }) : t("Render these scenes")}</>}
              </button>
            </Form>
            {!seeds && <p className="mm-note mm-note-req"><Ico n="wand" size={12} /> {t("Script out your scenes first — tap “Make the scenes” above, check the storyboard, then render.")}</p>}
            <div className="mm-eta"><span aria-hidden="true">⏱</span> {t("Est. render time")} <b>{filmEta({ lipSyncSinger: true, dialogue: false, scenes, engine: dialogueEngine })}</b></div>
            <p className="mm-note">{cost > 0 ? <>{t("{base} + {per}/scene × {n} = {cost} Tokens", { base: d.base, per: d.perScene, n: scenes, cost })} · <span className={affordable ? "fs-bal" : "fs-bal low"}>{t("you have {n}", { n: d.tokens })}</span></> : t("Free while we dial this in — pricing comes later.")}</p>
            {!d.hasPlan && <p className="fs-err">{t("Pick a plan on the Dashboard first — film runs on tokens.")}</p>}
            {d.hasPlan && !affordable && <p className="fs-err">{t("Not enough tokens for this length — shorten it, or top up on the Plans page.")}</p>}
            {actionData?.error && <p className="fs-err">{actionData.error}</p>}
            {actionData?.ok && <p className="fs-ok"><Ico n="check" size={14} /> {t("Rolling! Your video is rendering — it'll land in your Gallery in a few minutes. You can keep working.")}</p>}
          </div>
        </div>
      )}

      {/* The classic long-form flow — every format except the Music Video sing lanes. */}
      {!tmpl?.lipSyncSinger && (<>
      {/* Skit only — your product (kept pin-sharp in every scene) */}
      {tmpl?.needsProduct && (
        <div className="fs-card">
          <div className="fs-lbl"><Ico n="camera" size={16} /> {t("Your product")} <span className="fs-free">{t("stays pin-sharp")}</span></div>
          <p className="fs-hint">{t("The real product is the hero of the gag — it's composited into every scene and kept exactly as photographed.")}</p>
          {d.products.length > 0 && (
            <select className="fs-sel" defaultValue="" onChange={(e) => { if (e.target.value !== "") pickCatalog(Number(e.target.value)); }}>
              <option value="">{t("Pick from your store…")}</option>
              {d.products.map((p, i) => <option key={i} value={i}>{p.title}</option>)}
            </select>
          )}
          <div className="fs-prow">
            {prodImage ? <span className="fs-pthumb" style={{ backgroundImage: `url(${prodImage})` }} role="img" aria-label={prodTitle || "product"} /> : <span className="fs-pthumb empty"><Ico n="camera" size={18} /></span>}
            <div className="fs-pfields">
              <input className="fs-in" value={prodTitle} onChange={(e) => setProdTitle(e.target.value)} placeholder={t("Product name")} maxLength={120} />
              <input className="fs-in" value={prodImage} onChange={(e) => { setProdImage(e.target.value); setProdDesc(""); setTreatment(null); }} placeholder={t("or paste a product image URL")} maxLength={2000} />
            </div>
          </div>
        </div>
      )}

      {/* Step 1 — the vibe + length */}
      {/* Describe-first entry — same premium look as the Music Video builder's topic box. */}
      <div className="mm-topic mm-topic-film">
        <label htmlFor="fs-topic-in">{tmpl?.needsProduct ? t("What's the gag?") : t("What's your movie about?")}</label>
        <textarea id="fs-topic-in" rows={3} value={topic} onChange={(e) => setTopic(e.target.value)}
          placeholder={tmpl?.needsProduct ? t("the joke, the vibe, who's in it… or leave blank and we'll write one") : t("a theme, a story, a mood… or leave blank and we'll surprise you")} maxLength={300} />
        <div className="fs-len fs-len-topic">
          <span>{t("Scenes")}</span>
          <div className="fs-stepper">
            <button type="button" onClick={() => bump(-1)} disabled={scenes <= tmpl.minScenes} aria-label={t("Fewer scenes")}>−</button>
            <b>{scenes}</b>
            <button type="button" onClick={() => bump(1)} disabled={scenes >= tmpl.maxScenes} aria-label={t("More scenes")}>+</button>
          </div>
          <span className="fs-len-note">{t("≈ {sec}s · {n} AI clips", { sec: scenes * 5, n: scenes })}</span>
        </div>
      </div>
      <div className="mm-hint"><span aria-hidden="true">✎</span> {t("Tell us the idea — we write it and film it. Set anything below, or just hit the button.")}</div>

      {/* Step 2 — write + edit the scene FREE. Dialogue (Test Movie) gets the COMBINED
          conversation flow (one place, chat-style); other templates keep the classic
          treatment preview. */}
      {isStoryboard ? (
        <div className="fs-card fs-scenecard">
          <div className="fs-lbl"><span className="fs-n">2</span> {t("Your scene")} <span className="fs-free">{t("free")}</span>{treatment && treatment.scenes.length > 0 && (() => { const fs = treatment.scenes.reduce((a, s) => a + estimateSpeakSeconds(parseBeat(s.caption).line), 0); return fs > 0 ? <span className="fs-filmlen" title={t("Estimated spoken length of the whole film")}>≈ {secondsLabel(fs)} {t("film")}</span> : null; })()}</div>
          {!treatment ? (
            <>
              <p className="fs-hint">{t("We'll write the dialogue — then edit it like a text thread: tweak lines, swap who talks, add a scene. No tokens until you Generate.")}</p>
              <button type="button" className="fs-write" onClick={writeTreatment} disabled={writing}>
                {writing ? <>… {t("Writing")}</> : <><Ico n="wand" size={14} /> {t("Write the dialogue — free")}</>}
              </button>
              {treatmentFetcher.data?.error && <p className="fs-err">{treatmentFetcher.data.error}</p>}
            </>
          ) : (
            <>
              <div className="fs-scenetop">
                <span className="fs-scenetop-hint">{t("Edit any line. Tap a name to swap who talks. Lines in a scene play as one seamless take.")}</span>
                <button type="button" className="fs-rewrite" onClick={writeTreatment} disabled={writing}>{writing ? "…" : <><Ico n="refresh" size={13} /> {t("Rewrite")}</>}</button>
              </div>
              <div className="fs-flow">
                {flow.map((loc, li) => (
                  <div key={li}>
                    {li > 0 && <div className="fs-scenecut"><Ico n="scissors" size={13} /> {t("scene change · the cast walks in")}</div>}
                    <div className="fs-loc">
                      <div className="fs-loc-head">
                        <span className="fs-loc-pin" aria-hidden="true">📍</span>
                        <input className="fs-loc-where" value={loc.where} maxLength={120} onChange={(e) => setWhere(loc, e.target.value)} placeholder={t("Where does this scene happen?")} />
                        <span className="fs-loc-scene">{t("scene {n}", { n: li + 1 })}</span>
                        {speakerNames.length > 0 && (
                          <span className="fs-loc-who">
                            {speakerNames.slice(0, 4).map((nm, k) => { const f = faceOf(nm); return <span key={k} className="fs-who" title={nm} style={f ? { backgroundImage: `url(${f})` } : undefined}>{!f && (nm || "?").slice(0, 1).toUpperCase()}</span>; })}
                          </span>
                        )}
                      </div>
                      <div className="fs-backdrops" role="group" aria-label={t("Backdrop")}>
                        <span className="fs-backdrops-lbl">{t("backdrop")}</span>
                        {FILM_BACKDROPS.map((bd) => (
                          <button type="button" key={bd.key} className={`fs-bchip${loc.where.toLowerCase().includes(bd.key) ? " on" : ""}`} onClick={() => setWhere(loc, bd.where)}>{t(bd.label)}</button>
                        ))}
                      </div>
                      {loc.angles.map((ang, ai) => (
                        <div key={ai}>
                          {ai > 0 && (
                            <div className="fs-anglecut">
                              <Ico n="video" size={12} />
                              <input className="fs-anglecut-in" value={ang.shot} maxLength={60} onChange={(e) => setAngleShot(ang, e.target.value)} placeholder={t("close-up on …")} />
                              <button type="button" className="fs-anglecut-x" onClick={() => removeAngle(loc, ang)} aria-label={t("Remove this angle change")}><Ico n="trash" size={11} /></button>
                            </div>
                          )}
                          <div className="fs-chat">
                            {ang.beats.map((b) => {
                              const f = faceOf(b.speaker);
                              const side = !!speakerNames[1] && firstTok(b.speaker) === firstTok(speakerNames[1]) ? "right" : "left";
                              const secs = estimateSpeakSeconds(b.line);
                              const over = secs > CLIP_MAX_SECONDS;
                              const meterState = over ? "over" : secs > CLIP_MAX_SECONDS * 0.92 ? "warn" : "";
                              return (
                                <div className={`fs-msg ${side}`} key={b.idx}>
                                  <span className="fs-msg-face" title={b.speaker} style={f ? { backgroundImage: `url(${f})` } : undefined}>{!f && (b.speaker || "?").slice(0, 1).toUpperCase()}</span>
                                  <div className="fs-msg-col">
                                    {speakerNames.length > 1 && <button type="button" className="fs-msg-spk" onClick={() => setBeatSpeaker(b.idx, nextSpeaker(b.speaker))} title={t("Tap to switch who speaks")}>{displayName(b.speaker)} <Ico n="refresh" size={9} /></button>}
                                    <textarea className="fs-msg-bubble" rows={2} value={b.line} maxLength={400} onChange={(e) => setBeatLine(b.idx, e.target.value)} placeholder={t("What do they say?")} />
                                    <div className={`fs-meter ${meterState}`} title={t("How long this line takes to say — one clip holds about 10 seconds. Keep it under the cap so it isn't cut off or padded.")}>
                                      <span className="fs-meter-bar"><i style={{ width: `${Math.min(100, clipFill(b.line) * 100)}%` }} /></span>
                                      <span className="fs-meter-num">{secondsLabel(secs)}{over ? ` · over ${CLIP_MAX_SECONDS}s` : ` / ${CLIP_MAX_SECONDS}s`}</span>
                                    </div>
                                  </div>
                                  {treatment.scenes.length > 1 && <button type="button" className="fs-msg-x" onClick={() => removeBeat(b.idx)} aria-label={t("Remove this line")}><Ico n="trash" size={11} /></button>}
                                </div>
                              );
                            })}
                            <div className="fs-chat-acts">
                              <button type="button" className="fs-beat-add" onClick={() => addBeat(loc, ang)}>＋ {t("add a line")}</button>
                              {ai === loc.angles.length - 1 && <button type="button" className="fs-loc-addangle" onClick={() => addAngle(loc)}><Ico n="video" size={12} /> {t("cut to a close-up")}</button>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <button type="button" className="fs-addscene" onClick={addScene}><span aria-hidden="true">📍</span> {t("new scene — move them somewhere else")}</button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="fs-card">
          {tmpl?.lipSyncSinger && (
            <div className="fs-genrebox">
              <div className="fs-lbl"><Ico n="music" size={16} /> {t("Genre")} <span className="fs-free">{t("sets the song + the look")}</span></div>
              <p className="fs-hint">{t("One artist sings a full ~2-minute song and performs it on camera across your scenes.")}</p>
              <div className="fs-genres">
                {(d.genres || []).map((gr) => (
                  <button type="button" key={gr.key} className={`fs-genre${filmGenre === gr.key ? " on" : ""}`}
                    aria-pressed={filmGenre === gr.key} onClick={() => { setFilmGenre(gr.key); setTreatment(null); }}>
                    {t(gr.label)}
                  </button>
                ))}
              </div>
              <div className="fs-songsrc">
                <span className="fs-songsrc-cap">{t("The song")}</span>
                <div className="fs-songsrc-seg">
                  <button type="button" className={`fs-songsrc-opt${songSource === "write" ? " on" : ""}`} aria-pressed={songSource === "write"} onClick={() => setSongSource("write")}>{t("Write me one")}<small>{t("free")}</small></button>
                  <button type="button" className={`fs-songsrc-opt${songSource === "upload" ? " on" : ""}`} aria-pressed={songSource === "upload"} onClick={() => setSongSource("upload")}>{t("Upload my own")}<small>{t("your track")}</small></button>
                </div>
              </div>
              {songSource === "upload" && (
                <div className="fs-songup">
                  <input ref={songInputRef} type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/mp4,audio/x-m4a,audio/aac,.mp3,.wav,.m4a,.aac" hidden onChange={(e) => uploadSong(e.currentTarget.files?.[0])} />
                  <button type="button" className="fs-songup-btn" onClick={() => songInputRef.current?.click()} disabled={songBusy}>
                    {songBusy ? <>… {t("Uploading")}</> : filmSongUrl ? <><Ico n="check" size={14} /> {songName || t("Song uploaded")}</> : <><Ico n="music" size={14} /> {t("Choose a song file")}</>}
                  </button>
                  {filmSongUrl && <p className="fs-hint">{t("We'll build the whole video around your track — artist, director's shots and lip-sync.")}</p>}
                </div>
              )}
              <div className="fs-propsbox">
                <span className="fs-songsrc-cap">{t("Props")} <span className="fs-free" style={{ marginLeft: 4 }}>{t("optional")}</span></span>
                <p className="fs-hint" style={{ margin: "6px 0 0" }}>{t("Cool shit to weave into the scenes — pick a few.")}</p>
                <div className="fs-genres" style={{ marginTop: 9 }}>
                  {(d.props || []).map((pr) => (
                    <button type="button" key={pr.key} className={`fs-genre${filmProps.includes(pr.key) ? " on" : ""}`}
                      aria-pressed={filmProps.includes(pr.key)} onClick={() => toggleProp(pr.key)}>
                      {t(pr.label)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="fs-lbl"><span className="fs-n">2</span> {tmpl?.lipSyncSinger ? t("Write the song") : t("Write the treatment")} <span className="fs-free">{t("free")}</span></div>
          <p className="fs-hint">{tmpl?.lipSyncSinger ? t("We write the full song + the scenes. Read the lyrics, re-roll — no tokens until you Generate.") : t("We draft every scene + the hook. Read it, tweak the lines, re-roll — no tokens spent until you Generate.")}</p>
          <button type="button" className="fs-write" onClick={writeTreatment} disabled={writing || !productReady}>
            {writing ? <>… {t("Writing")}</> : treatment ? <><Ico n="refresh" size={14} /> {t("Randomize")}</> : <><Ico n="wand" size={14} /> {t("Write the treatment — free")}</>}
          </button>
          {tmpl?.needsProduct && !productReady && <p className="fs-hint">{t("Add your product above first.")}</p>}
          {treatmentFetcher.data?.error && <p className="fs-err">{treatmentFetcher.data.error}</p>}
          {treatment && (
            <div className="fs-treat">
              {treatment.title && <div className="fs-treat-ttl">{treatment.title}</div>}
              <div className="fs-treat-mood"><Ico n="music" size={12} /> {treatment.musicMood}</div>
              <ol className="fs-scenes">
                {treatment.scenes.map((s, i) => (
                  <li key={i} className="fs-scene">
                    <span className="fs-scene-vis">{s.visual}</span>
                    <input className="fs-scene-cap" value={s.caption || ""} onChange={(e) => editCaption(i, e.target.value)} placeholder={t("on-screen line (optional)")} maxLength={80} />
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Step 2.5 — storyboard: approve a photo per scene before paying (dialogue only) */}
      {treatment && isStoryboard && cast.length > 0 && (() => {
        const castCount = cast.filter((c) => c.faceUrl).length;
        const allCast = castCount === cast.length;
        return (
        <div className="fs-card fs-caststage">
          <div className="fs-cast-head">
            <div className="fs-lbl"><span className="fs-n"><Ico n="film" size={13} /></span> {t("Cast your movie")} <span className="fs-free">{t("free")}</span></div>
            <span className={`fs-cast-prog${allCast ? " done" : ""}`}>
              {allCast ? <><Ico n="check" size={13} /> {t("Cast locked")}</> : t("{done}/{total} cast", { done: castCount, total: cast.length })}
            </span>
          </div>
          <p className="fs-hint">{allCast ? t("Every shot now stars the same faces — nobody morphs. Roll camera. 🎬") : t("Give each character a face and a voice once — every shot reuses them. Tap a frame to cast it.")}</p>
          <div className="fs-cast">
            {cast.map((c, i) => {
              const cbusy = castingIndex === i;
              return (
                <div className={`fs-actor${c.faceUrl ? " set" : ""}`} key={i}>
                  {c.faceUrl ? (
                    <div className="fs-actor-face">
                      <img src={c.faceUrl} alt={c.name} loading="lazy" />
                      {cbusy && <span className="fs-shot-spin" aria-hidden="true" />}
                      {!cbusy && <span className="fs-actor-badge" aria-hidden="true"><Ico n="check" size={13} /></span>}
                    </div>
                  ) : (
                    <button type="button" className="fs-actor-face fs-actor-cast" disabled={castingIndex !== null} onClick={() => makePortrait(i)} aria-label={t("Cast {name}", { name: c.name })}>
                      <span className="fs-actor-empty"><Ico n="camera" size={22} /><b>{cbusy ? t("Casting…") : t("Cast a face")}</b></span>
                      {cbusy && <span className="fs-shot-spin" aria-hidden="true" />}
                    </button>
                  )}
                  <div className="fs-actor-main">
                    <input className="fs-actor-name fs-actor-name-in" value={c.name} onChange={(e) => setCastName(i, e.target.value)} placeholder={t("Character name")} maxLength={40} disabled={castingIndex !== null} aria-label={t("Character name")} />
                    <textarea className="fs-actor-desc fs-actor-desc-in" value={c.desc} onChange={(e) => setCastDesc(i, e.target.value)} placeholder={tmpl?.cartoon ? t("Describe this cartoon character — look, colors, personality") : t("Describe this character — look, age, vibe")} rows={2} maxLength={400} disabled={castingIndex !== null} aria-label={t("Character description")} />
                    <div className="fs-actor-voice">
                      <select aria-label={t("Voice for {name}", { name: c.name })} value={c.voiceId || ""} disabled={castingIndex !== null} onChange={(e) => setCastVoice(i, e.target.value)}>
                        <option value="">{t("Pick a voice")}</option>
                        {d.voices.map((v) => <option key={v.id} value={v.id}>{v.label} · {v.blurb}</option>)}
                      </select>
                      <button type="button" className="fs-voice-play" disabled={!c.voiceId} onClick={() => playVoice(c.voiceId)} aria-label={t("Hear this voice")} title={t("Hear this voice")}><Ico n="sound" size={14} /></button>
                    </div>
                    <div className="fs-actor-opts">
                      {c.faceUrl && <button type="button" className="fs-actor-recast" disabled={castingIndex !== null} onClick={() => makePortrait(i)}><Ico n="refresh" size={11} /> {t("Re-cast")}</button>}
                      {cast.length > 1 && <button type="button" className="fs-actor-del" disabled={castingIndex !== null} onClick={() => removeCastMember(i)} title={t("Remove this character")}>✕ {t("Remove")}</button>}
                      {d.roster.length > 0 && (
                        <details className="fs-shot-own fs-actor-roster">
                          <summary><Ico n="presenter" size={13} /> {t("Pick a presenter")}</summary>
                          <div className="fs-roster" role="list" aria-label={t("Your presenters")}>
                            {d.roster.map((r) => (
                              <button type="button" role="listitem" key={r.id} className={`fs-rface${c.faceUrl === r.img ? " on" : ""}`}
                                disabled={castingIndex !== null} title={r.name} onClick={() => useCastFace(i, r.img)}>
                                <span className="fs-rface-img" style={{ backgroundImage: `url(${r.img})` }} />
                                {c.faceUrl === r.img && <span className="fs-rface-chk" aria-hidden="true"><Ico n="check" size={11} /></span>}
                                <span className="fs-rface-name">{r.name}</span>
                              </button>
                            ))}
                          </div>
                        </details>
                      )}
                      <details className="fs-shot-own fs-actor-own">
                        <summary>{t("Use my own photo")}</summary>
                        {d.gallery.length > 0 ? (
                          <div className="fs-shot-gallery" role="list" aria-label={t("Your images")}>
                            {d.gallery.map((g) => (
                              <button type="button" role="listitem" key={g.id} className={`fs-gthumb${c.faceUrl === g.url ? " on" : ""}`}
                                disabled={castingIndex !== null} title={g.title || t("Use this image")} onClick={() => useCastFace(i, g.url)}>
                                <img src={g.url} alt={g.title || t("Your image")} loading="lazy" />
                                {c.faceUrl === g.url && <span className="fs-gthumb-chk" aria-hidden="true"><Ico n="check" size={12} /></span>}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="fs-gempty">{t("Images you make in Creator show up here to pick from.")}</p>
                        )}
                        <input className="fs-shot-url" type="url" maxLength={2000} defaultValue="" placeholder={t("…or paste an image URL")} onChange={(e) => useCastFace(i, e.target.value)} />
                      </details>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <button type="button" className="fs-cast-add" onClick={addCastMember} disabled={cast.length >= 8 || castingIndex !== null}>
            <span aria-hidden="true">＋</span> {tmpl?.cartoon ? t("Add a cartoon character") : t("Add a character")}
          </button>
          {portraitFetcher.data?.error && <p className="fs-err">{portraitFetcher.data.error}</p>}
        </div>
        );
      })()}

      {/* STORYBOARD for the sung / narrated film formats (Kids Music Video, etc.) — the dialogue
          films already have their own per-scene approval, and the product skit doesn't need it. ONE
          collapsed button → grid, right before Generate, so the page stays short. */}
      {!isStoryboard && !tmpl?.needsProduct && (
        <div className="fs-card"><div className="fs-lbl"><Ico n="film" size={16} /> {t("See your scenes")} <span className="fs-free">{t("free")}</span></div>{storyboard()}</div>
      )}

      {/* Step 3 — generate (the only paid step) */}
      <div className="fs-card fs-go-card">
        <div className="fs-lbl"><span className="fs-n">3</span> {t("Generate")}</div>
        {/* Test Movie only: choose which engine renders the spoken dialogue. */}
        {isStoryboard && (
          <div className="fs-engine" role="group" aria-label={t("Render engine")}>
            <span className="fs-engine-cap">{t("Render engine")}</span>
            <div className="fs-engine-seg">
              <button type="button" className={`fs-engine-opt${dialogueEngine === "kling3" ? " on" : ""}`}
                aria-pressed={dialogueEngine === "kling3"} onClick={() => setDialogueEngine("kling3")}>
                {t("Kling 3")}<small>{t("recommended · default")}</small>
              </button>
              <button type="button" className={`fs-engine-opt${dialogueEngine === "veo" ? " on" : ""}`}
                aria-pressed={dialogueEngine === "veo"} onClick={() => setDialogueEngine("veo")}>
                {t("Veo 3")}<small>{t("premium · pricier")}</small>
              </button>
            </div>
            <p className="fs-engine-note">{t("Same film, different AI. Run both and compare — each is tagged by model in your Archive.")}</p>
          </div>
        )}
        {isStoryboard && (
          <div className="fs-engine" role="group" aria-label={t("Aspect ratio")}>
            <span className="fs-engine-cap">{t("Shape")}</span>
            <div className="fs-engine-seg">
              <button type="button" className={`fs-engine-opt${filmAspect === "16:9" ? " on" : ""}`}
                aria-pressed={filmAspect === "16:9"} onClick={() => setFilmAspect("16:9")}>
                {t("Wide")}<small>{t("16:9 · default")}</small>
              </button>
              <button type="button" className={`fs-engine-opt${filmAspect === "9:16" ? " on" : ""}`}
                aria-pressed={filmAspect === "9:16"} onClick={() => setFilmAspect("9:16")}>
                {t("Vertical")}<small>{t("9:16 · mobile")}</small>
              </button>
              <button type="button" className={`fs-engine-opt${filmAspect === "1:1" ? " on" : ""}`}
                aria-pressed={filmAspect === "1:1"} onClick={() => setFilmAspect("1:1")}>
                {t("Square")}<small>{t("1:1 · feed")}</small>
              </button>
            </div>
            <p className="fs-engine-note">{t("Wide for YouTube, TV episodes and roomier multi-character scenes; Vertical for mobile Shorts & Reels.")}</p>
          </div>
        )}
        <Form method="post">
          <input type="hidden" name="intent" value="film" />
          <input type="hidden" name="template" value={template} />
          {isStoryboard && <input type="hidden" name="dialogueEngine" value={dialogueEngine} />}
          {isStoryboard && <input type="hidden" name="filmAspect" value={filmAspect} />}
          {tmpl?.lipSyncSinger && <input type="hidden" name="filmGenre" value={filmGenre} />}
          {tmpl?.lipSyncSinger && songSource === "upload" && filmSongUrl && <input type="hidden" name="filmSongUrl" value={filmSongUrl} />}
          {tmpl?.lipSyncSinger && filmProps.length > 0 && <input type="hidden" name="filmProps" value={JSON.stringify(filmProps)} />}
          <input type="hidden" name="filmTopic" value={topic} />
          <input type="hidden" name="filmScenes" value={String(scenes)} />
          {tmpl?.needsProduct && <input type="hidden" name="filmProductTitle" value={prodTitle} />}
          {tmpl?.needsProduct && <input type="hidden" name="filmProductImageUrl" value={prodImage} />}
          {tmpl?.needsProduct && <input type="hidden" name="filmProductDescription" value={prodDesc} />}
          {(seeds?.treatment || treatment) && <input type="hidden" name="approvedTreatment" value={JSON.stringify(seeds?.treatment || treatment)} />}
          {!isStoryboard && seeds && <input type="hidden" name="approvedSceneImgs" value={JSON.stringify(seeds.imgs)} />}
          {isStoryboard && frames.some(Boolean) && <input type="hidden" name="approvedFrames" value={JSON.stringify(frames)} />}
          {isStoryboard && cast.some((c) => c.faceUrl || c.voiceId) && <input type="hidden" name="cast" value={JSON.stringify(cast.map((c) => ({ name: c.name, faceUrl: c.faceUrl, voiceId: c.voiceId })))} />}
          <button type="submit" className="fs-go" disabled={!canGo}>
            {generating ? <>… {t("Starting your film")}</> : <><Ico n="film" size={16} /> {cost > 0 ? t("Generate {name} · {cost} Tokens", { name: t(tmpl?.name || "Film"), cost }) : t("Generate {name} · Free", { name: t(tmpl?.name || "Film") })}</>}
          </button>
          <div className="fs-eta" aria-live="polite" title={t("A rough estimate — longer films and lip-sync take more time.")}>
            <span aria-hidden="true">⏱</span> {t("Est. render time")} <b>{filmEta({ lipSyncSinger: tmpl?.lipSyncSinger, dialogue: isStoryboard, scenes, engine: dialogueEngine })}</b>
          </div>
        </Form>
        <p className="fs-cost">
          {cost > 0
            ? <>{t("{base} + {per}/scene × {n} = {cost} Tokens", { base: d.base, per: d.perScene, n: scenes, cost })}{" · "}<span className={affordable ? "fs-bal" : "fs-bal low"}>{t("you have {n}", { n: d.tokens })}</span></>
            : t("Free while we get this section dialed in — pricing comes later")}
        </p>
        {!treatment && <p className="fs-hint">{t("Tip: write the treatment above first so you see exactly what renders — but you can Generate straight away and we'll script it for you.")}</p>}
        {!d.hasPlan && <p className="fs-err">{t("Pick a plan on the Dashboard first — film runs on tokens.")}</p>}
        {d.hasPlan && !affordable && <p className="fs-err">{t("Not enough tokens for this length — shorten it, or top up on the Plans page.")}</p>}
        {d.hasPlan && tmpl?.needsProduct && !productReady && <p className="fs-err">{t("Add your product above to generate a skit.")}</p>}
        {actionData?.error && <p className="fs-err">{actionData.error}</p>}
        {actionData?.ok && (
          <p className="fs-ok"><Ico n="check" size={14} /> {t("Rolling! Your film is rendering — it'll land in your Gallery in a few minutes. You can keep working.")}</p>
        )}
      </div>
      </>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Rough render-time estimate shown beside Generate so the wait is expected. Buckets
 *  by engine: lip-sync Music Video (OmniHuman, ~2 clips at a time — the slow lane),
 *  dialogue films (per-beat Kling/Veo clips), and sung/other (parallel i2v). Returns a
 *  friendly range string; recomputed live from scene count + template + engine. */
function filmEta(opts: { lipSyncSinger?: boolean; dialogue?: boolean; scenes: number; engine: "veo" | "kling3" }): string {
  const n = Math.max(1, opts.scenes || 1);
  let lo: number, hi: number;
  if (opts.lipSyncSinger) {
    const waves = Math.ceil(n / 2);            // OmniHuman lip-sync runs ~2 at a time
    lo = 6 + waves * 6; hi = 9 + waves * 9;     // + song + artist + scene-image overhead
  } else if (opts.dialogue) {
    const per = opts.engine === "veo" ? 4 : 3.5;
    lo = Math.round(3 + n * per * 0.8); hi = Math.round(5 + n * per * 1.3);
  } else {
    lo = Math.round(4 + n * 1.2); hi = Math.round(7 + n * 2); // sung / other (parallel scenes)
  }
  return lo === hi ? `~${lo} min` : `~${lo}–${hi} min`;
}

const FS_STYLE = `
.fs-wrap{max-width:760px;margin:0 auto;--fs-gold:#C79A3A;--fs-gold-lt:#E7C879;}
.fs-eta{display:flex;align-items:center;justify-content:center;gap:6px;margin:8px 0 0;font-size:12.5px;font-weight:700;color:var(--ink2,#4A554E);}
.fs-eta b{font-weight:800;color:var(--ink,#14201A);}
/* Cinematic hero — a dark "movie theatre" band with a gold spotlight + underline. */
/* Green hero band — SOFTENED so it sits in the page (light shadow + a crisp inner
   edge + slimmer) instead of a floating slab. Gold rosette, the still bleeds in. */
.fs-head{position:relative;overflow:hidden;border-radius:20px;margin-bottom:16px;min-height:200px;display:flex;align-items:center;box-shadow:0 20px 48px -24px rgba(8,62,39,.55);}
.fs-head-vid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;}
.fs-head-scrim{position:absolute;inset:0;z-index:1;background:radial-gradient(130% 120% at 85% 10%,rgba(12,122,70,.1) 0%,rgba(8,55,34,.72) 48%,rgba(7,42,27,.94) 100%),linear-gradient(90deg,rgba(7,42,27,.92) 10%,rgba(7,42,27,.42) 66%,transparent);}
.fs-head-dot{width:6px;height:6px;border-radius:50%;background:var(--fs-gold-lt,#E7C879);box-shadow:0 0 10px var(--fs-gold-lt,#E7C879);}
.fs-head-bg{position:absolute;inset:0;z-index:0;border-radius:18px;overflow:hidden;background:radial-gradient(135% 130% at 8% -25%,#38815C 0%,#265F45 46%,#1C4E33 100%);box-shadow:0 8px 22px rgba(11,20,15,.16),inset 0 0 0 1px rgba(255,255,255,.1);}
.fs-head-rose{position:absolute;background:center/contain no-repeat;mix-blend-mode:screen;pointer-events:none;will-change:transform;}
.fs-head-rose.b{left:-130px;bottom:-170px;width:350px;height:350px;background-image:url(/gstyle-rosette.svg);opacity:.3;animation:fsspinB 115s linear infinite;}
@keyframes fsspinB{to{transform:rotate(-360deg);}}
.fs-head-media{position:absolute;right:0;top:0;bottom:0;width:54%;-webkit-mask-image:linear-gradient(90deg,transparent,#000 44%);mask-image:linear-gradient(90deg,transparent,#000 44%);}
.fs-head-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;animation:fsstill .55s cubic-bezier(.2,.7,.2,1);}
@keyframes fsstill{from{opacity:0;transform:scale(1.06);}to{opacity:1;transform:scale(1);}}
.fs-head-copy{position:relative;z-index:2;flex:1 1 auto;min-width:0;padding:26px 30px;max-width:560px;}
.fs-head-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:800;color:var(--fs-gold-lt,#E7C879);text-transform:uppercase;letter-spacing:.08em;}
.fs-head-copy b{display:block;font-family:Poppins,sans-serif;font-weight:800;font-size:33px;letter-spacing:-.02em;color:#fff;margin-top:11px;line-height:1.04;text-shadow:0 2px 18px rgba(0,0,0,.4);}
.fs-head-copy b em{font-style:normal;color:#8FE9BC;}
@keyframes fsFadeUp{from{opacity:0;transform:translateY(7px);}to{opacity:1;transform:translateY(0);}}
.fs-head-copy>span{display:block;font-size:13.5px;color:rgba(255,255,255,.85);margin-top:10px;max-width:400px;line-height:1.5;text-shadow:0 1px 10px rgba(0,0,0,.4);}
.fs-beta{font-size:9.5px;font-weight:800;color:#2A1C00;background:linear-gradient(135deg,var(--fs-gold-lt),var(--fs-gold));border-radius:999px;padding:2px 8px;text-transform:uppercase;letter-spacing:.06em;box-shadow:0 2px 8px rgba(199,154,58,.35);}
.fs-head-cat{position:absolute;z-index:3;right:16px;bottom:-22px;width:98px;height:auto;filter:drop-shadow(0 12px 18px rgba(0,0,0,.48));pointer-events:none;}
/* slim format bar — the collapsed state of the picker so you don't scroll past 7 big cards */
/* Format picker — a COMPACT horizontal strip of small poster tiles you swipe through, so every format
   is visible at a glance with NO vertical doom-scroll of big cards. */
.fs-fmtrow{display:flex;gap:11px;overflow-x:auto;overflow-y:hidden;margin:18px 0 4px;padding:3px 2px 12px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;scrollbar-width:thin;}
.fs-fmtrow::-webkit-scrollbar{height:6px;}
.fs-fmtrow::-webkit-scrollbar-thumb{background:#D4E3DA;border-radius:3px;}
.fs-fmtrow::-webkit-scrollbar-track{background:transparent;}
.fs-tmpl{flex:1 1 200px;min-width:0;text-align:left;border:1px solid var(--line,#E4DFCF);background:linear-gradient(180deg,#fff,#FCFAF3);border-radius:18px;padding:15px 16px 14px;cursor:pointer;transition:transform .18s cubic-bezier(.2,.7,.2,1),box-shadow .18s,border-color .18s;display:block;box-shadow:0 1px 2px rgba(20,32,26,.04);}
.fs-tmpl:hover{transform:translateY(-4px);box-shadow:0 16px 32px rgba(20,32,26,.14);border-color:var(--green2,#1FA463);}
.fs-tmpl.on{border-color:var(--green,#0C7A46);box-shadow:0 0 0 1.5px var(--green,#0C7A46),0 16px 32px rgba(12,122,70,.18);background:linear-gradient(180deg,#fff,#F2FAF5);}
.fs-tmpl.soon{opacity:.5;cursor:default;}
.fs-tmpl.soon:hover{transform:none;box-shadow:0 1px 2px rgba(20,32,26,.04);border-color:var(--line,#E4DFCF);}
.fs-tmpl-ico{display:inline-grid;place-items:center;width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--green,#0C7A46),var(--green2,#1FA463));color:#fff;margin-bottom:10px;box-shadow:0 5px 14px rgba(12,122,70,.3);}
.fs-tmpl.on .fs-tmpl-ico{box-shadow:0 5px 16px rgba(12,122,70,.45);}
.fs-tmpl b{font-family:Poppins,sans-serif;font-weight:800;font-size:15px;color:var(--ink,#14201A);display:block;}
.fs-tmpl-sub{display:block;font-size:12px;color:var(--ink2,#4A554E);margin-top:3px;line-height:1.4;}
/* Format picker v2 — each card is the format's real AI still (cover) + accent identity. */
/* ───────── Cinematic: poster card ZOOMS IN, others thrown away, becomes the builder ─────────
   Tap a card and it scales up (zoom) while its siblings fade + shrink away; then the stage it
   lands on scales in from large and settles — reading as the card becoming the section. Back
   shrinks the stage away and the grid fades back. (No black letterbox blink.) */
.fs-switch{position:relative;}
.fs-fmtgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:18px 0 6px;animation:fsgridin .4s ease both;}
/* Tablet / desktop: cap the stage width and show 3 columns so posters stay poster-sized
   instead of ballooning to half the screen on a wide monitor. Phones keep the 2-up grid. */
@media (min-width:640px){
  .fs-switch{max-width:760px;margin-left:auto;margin-right:auto;}
  .fs-fmtgrid{grid-template-columns:repeat(3,minmax(0,1fr));}
}
@keyframes fsgridin{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
.fs-fmtgrid .fs-fmt{flex:none;width:auto;transform-origin:center;}
.fs-fmtgrid.throw .fs-fmt{opacity:0;transform:scale(.72) translateY(26px);transition:opacity .32s ease,transform .36s ease;pointer-events:none;}
.fs-fmtgrid.throw .fs-fmt.zoom{opacity:1;z-index:6;will-change:transform;transition:transform .44s cubic-bezier(.34,.62,.2,1),box-shadow .44s ease;box-shadow:0 36px 72px -22px rgba(10,20,15,.6);}
.fs-fmt-sub{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;padding:8px 11px 12px;font-size:11.5px;font-weight:700;color:var(--ink2,#55605A);line-height:1.32;}
.fs-fmt-sub em{font-style:normal;font-weight:600;color:var(--ink3,#9AA39B);}
.fs-hero{position:relative;height:150px;border-radius:16px;overflow:hidden;margin:16px 0 4px;background:#20302A;}
.fs-hero-art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;animation:fsken 16s ease-in-out infinite alternate;}
@keyframes fsken{from{transform:scale(1.03)}to{transform:scale(1.15)}}
.fs-hero::before,.fs-hero::after{content:"";position:absolute;left:0;right:0;height:11px;background:#0A140F;z-index:2;}
.fs-hero::before{top:0;}
.fs-hero::after{bottom:0;}
.fs-hero-scrim{position:absolute;inset:0;z-index:1;background:linear-gradient(to top,rgba(8,16,12,.76) 0%,rgba(8,16,12,.1) 54%,rgba(8,16,12,.3) 100%);}
.fs-hero-back{position:absolute;top:19px;left:12px;z-index:4;display:inline-flex;align-items:center;gap:4px;font-family:Poppins,sans-serif;font-size:12.5px;font-weight:700;color:#fff;background:rgba(10,20,15,.46);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:6px 13px 6px 10px;cursor:pointer;}
.fs-hero-back span{font-size:16px;line-height:1;margin-top:-1px;}
.fs-hero-back:hover{background:rgba(10,20,15,.66);}
.fs-hero-ttl{position:absolute;left:16px;bottom:27px;z-index:3;font-family:Poppins,sans-serif;font-size:25px;font-weight:800;letter-spacing:-.01em;color:#fff;text-shadow:0 2px 16px rgba(0,0,0,.5);}
.fs-hero-sub{position:absolute;left:16px;bottom:14px;z-index:3;font-size:12.5px;font-weight:600;color:rgba(255,255,255,.86);text-shadow:0 1px 8px rgba(0,0,0,.5);}
.fs-stage{animation:fsstagein .46s cubic-bezier(.2,.7,.2,1) both;transform-origin:center top;}
@keyframes fsstagein{from{opacity:0;transform:scale(1.12)}to{opacity:1;transform:none}}
.fs-stage.out{animation:fsstageout .3s ease forwards;transform-origin:center top;}
@keyframes fsstageout{from{opacity:1;transform:none}to{opacity:0;transform:scale(.9)}}
.fs-stepsin{animation:fsrise .52s cubic-bezier(.2,.7,.2,1) .04s both;}
@keyframes fsrise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){
  .fs-fmtgrid,.fs-stage,.fs-stepsin{animation:none;}
  .fs-fmtgrid.throw .fs-fmt,.fs-fmtgrid.throw .fs-fmt.zoom{transition:none;opacity:1;transform:none;}
  .fs-stage.out{animation:none;opacity:1;transform:none;}
  .fs-hero-art{animation:none;}
}
.fs-fmt{position:relative;flex:0 0 130px;scroll-snap-align:start;text-align:left;cursor:pointer;border:1.5px solid var(--line,#E4DFCF);background:#fff;border-radius:15px;padding:0;overflow:hidden;transition:transform .16s,box-shadow .16s,border-color .16s;box-shadow:0 1px 2px rgba(20,32,26,.05);}
.fs-fmt:hover{transform:translateY(-3px);box-shadow:0 12px 26px -16px rgba(20,32,26,.28);}
.fs-fmt:hover .fs-fmt-cover img{transform:scale(1.06);}
.fs-fmt.on{border-color:var(--green,#0C7A46);box-shadow:0 0 0 2px var(--green,#0C7A46),0 20px 40px -20px rgba(12,122,70,.5);}
.fs-fmt-cover{position:relative;display:block;aspect-ratio:4/5;overflow:hidden;background:#20302A;}
.fs-fmt-cover img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .4s cubic-bezier(.2,.7,.2,1);}
.fs-fmt-cover::after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(10,20,15,.82) 0%,rgba(10,20,15,.12) 46%,transparent 100%);}
.fs-fmt-ico{position:absolute;z-index:2;top:8px;left:8px;width:28px;height:28px;border-radius:9px;display:grid;place-items:center;box-shadow:0 5px 14px -5px rgba(0,0,0,.6);}
.fs-fmt-ico svg{width:15px;height:15px;stroke:#fff;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;}
.fs-fmt-check{position:absolute;z-index:2;top:10px;right:10px;width:23px;height:23px;border-radius:50%;background:var(--green,#0C7A46);display:grid;place-items:center;box-shadow:0 4px 10px -3px rgba(0,0,0,.5);}
.fs-fmt-check svg{width:12px;height:12px;stroke:#fff;stroke-width:3;fill:none;}
.fs-fmt-label{position:absolute;z-index:2;left:9px;right:9px;bottom:9px;}
.fs-fmt-kick{display:block;font-size:10px;font-weight:800;color:#A7F0C8;text-transform:uppercase;letter-spacing:.07em;}
.fs-fmt-label b{display:block;font-family:Poppins,sans-serif;font-size:12.5px;font-weight:800;letter-spacing:-.01em;color:#fff;line-height:1.12;text-shadow:0 1px 10px rgba(0,0,0,.6);}
.fs-fmt-body{display:block;padding:12px 14px 14px;}
.fs-fmt-desc{display:block;font-size:12.5px;line-height:1.42;color:var(--ink2,#4A554E);}
.fs-fmt-meta{display:inline-flex;align-items:center;gap:5px;margin-top:10px;font-size:11px;font-weight:800;color:var(--green,#0C7A46);background:var(--mint,#EAF6EF);border:1px solid #D4EBDD;border-radius:999px;padding:4px 10px;}
.fs-fmt.soon{opacity:.72;cursor:default;}
.fs-fmt.soon:hover{transform:none;box-shadow:0 1px 2px rgba(20,32,26,.05);}
.fs-fmt.soon:hover .fs-fmt-cover img{transform:none;}
.fs-fmt-soon{position:absolute;z-index:2;inset:0;display:grid;place-items:center;}
.fs-fmt-soon span{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);color:#fff;font-size:11.5px;font-weight:800;border-radius:999px;padding:7px 15px;letter-spacing:.02em;}
.t-mv{background:linear-gradient(135deg,#C2487E,#8E2F5C);}
.t-moral{background:linear-gradient(135deg,#1EA85C,#0C7A46);}
.t-horror{background:linear-gradient(135deg,#5A4B8A,#342A57);}
.t-film{background:linear-gradient(135deg,#3E4C5E,#222C38);}
.t-kids{background:linear-gradient(135deg,#E8A43C,#CE7C18);}
.t-kmv{background:linear-gradient(135deg,#2FA8A0,#167C77);}
.fs-card{background:linear-gradient(180deg,#fff,#FDFCF8);border:1px solid var(--line,#E4DFCF);border-radius:20px;padding:18px 20px;margin:14px 0;box-shadow:0 2px 4px rgba(20,32,26,.03),0 14px 32px rgba(20,32,26,.05);}
.fs-go-card{border-color:transparent;box-shadow:0 0 0 1.5px var(--green,#0C7A46),0 18px 40px rgba(12,122,70,.12);}
/* Dialogue-engine picker (Test Movie only) — a compact segmented control. */
.fs-genrebox{margin:0 0 16px;padding:0 0 15px;border-bottom:1px solid var(--line,#E4DFCF);}
.fs-genres{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0;}
.fs-genre{border:1.5px solid var(--line,#E4DFCF);background:#fff;border-radius:999px;padding:8px 15px;cursor:pointer;font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:var(--ink,#14201A);transition:background .15s,border-color .15s,color .15s,transform .1s;}
.fs-genre:hover{border-color:var(--green,#0C7A46);}
.fs-genre.on{background:var(--green,#0C7A46);border-color:var(--green,#0C7A46);color:#fff;}
.fs-propsbox{margin:16px 0 0;padding:14px 0 0;border-top:1px dashed var(--line,#E4DFCF);}
.fs-songsrc{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:14px 0 0;}
.fs-songsrc-cap{font-size:12.5px;font-weight:700;color:var(--ink2,#4A554E);}
.fs-songsrc-seg{display:inline-flex;gap:6px;background:#F3EFE2;border:1px solid var(--line,#E4DFCF);border-radius:12px;padding:4px;}
.fs-songsrc-opt{display:flex;flex-direction:column;align-items:flex-start;gap:1px;border:0;background:transparent;border-radius:9px;padding:7px 14px;cursor:pointer;font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:var(--ink,#14201A);line-height:1.12;white-space:nowrap;}
.fs-songsrc-opt small{font-weight:600;font-size:10px;color:var(--ink2,#6B756E);}
.fs-songsrc-opt.on{background:#fff;box-shadow:0 1px 3px rgba(20,32,26,.14),inset 0 0 0 1px rgba(12,122,70,.5);color:var(--green,#0C7A46);}
.fs-songsrc-opt.on small{color:var(--green,#0C7A46);opacity:.82;}
.fs-songup{margin:12px 0 0;}
.fs-songup-btn{display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#fff,var(--mint,#EAF6EF));color:var(--green,#0C7A46);border:1.5px solid var(--green,#0C7A46);border-radius:999px;padding:10px 20px;font-weight:800;font-size:13.5px;cursor:pointer;font-family:inherit;}
.fs-songup-btn:disabled{opacity:.6;cursor:default;}
.fs-engine{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 14px;}
.fs-engine-cap{font-size:12.5px;font-weight:700;color:var(--ink2,#4A554E);}
.fs-engine-note{flex:1 1 100%;font-size:11.5px;color:var(--ink2,#4A554E);margin:4px 0 0;line-height:1.4;}
.fs-engine-seg{display:inline-flex;gap:6px;max-width:100%;background:#F3EFE2;border:1px solid var(--line,#E4DFCF);border-radius:12px;padding:4px;}
.fs-engine-opt{display:flex;flex-direction:column;align-items:flex-start;gap:1px;border:0;background:transparent;border-radius:9px;padding:7px 14px;cursor:pointer;font-family:Poppins,sans-serif;font-weight:800;font-size:13.5px;color:var(--ink,#14201A);line-height:1.12;white-space:nowrap;transition:background .15s,box-shadow .15s,color .15s;}
.fs-engine-opt small{font-weight:600;font-size:10.5px;color:var(--ink2,#6B756E);letter-spacing:.01em;}
.fs-engine-opt.on{background:#fff;box-shadow:0 1px 3px rgba(20,32,26,.14),inset 0 0 0 1px rgba(12,122,70,.5);color:var(--green,#0C7A46);}
.fs-engine-opt.on small{color:var(--green,#0C7A46);opacity:.82;}
.fs-engine-opt:not(.on):hover{background:rgba(255,255,255,.55);}
.fs-lbl{display:flex;align-items:center;gap:9px;font-family:Poppins,sans-serif;font-weight:800;font-size:15px;color:var(--ink,#14201A);margin-bottom:11px;letter-spacing:-.01em;}
.fs-n{display:inline-grid;place-items:center;width:25px;height:25px;border-radius:999px;background:linear-gradient(135deg,var(--green,#0C7A46),var(--green2,#1FA463));color:#fff;font-size:13px;box-shadow:0 3px 9px rgba(12,122,70,.3);}
.fs-free{font-size:10.5px;font-weight:800;color:var(--green,#0C7A46);background:var(--mint,#EAF6EF);border-radius:999px;padding:3px 10px;text-transform:uppercase;letter-spacing:.04em;}
.fs-ta{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#E4DFCF);border-radius:12px;padding:11px 13px;font-size:14px;font-family:inherit;color:var(--ink,#14201A);resize:vertical;line-height:1.45;}
.fs-ta:focus,.fs-in:focus,.fs-sel:focus{outline:none;border-color:var(--green,#0C7A46);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.fs-sel{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#E4DFCF);border-radius:10px;padding:10px 12px;font-size:13.5px;font-family:inherit;color:var(--ink,#14201A);background:#fff;margin-bottom:10px;}
.fs-prow{display:flex;gap:12px;align-items:stretch;}
.fs-pthumb{flex:0 0 auto;width:66px;height:66px;border-radius:12px;background-size:cover;background-position:center;background-color:var(--mint,#EAF6EF);border:1.5px solid var(--line,#E4DFCF);}
.fs-pthumb.empty{display:grid;place-items:center;color:var(--green,#0C7A46);}
.fs-pfields{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:8px;}
.fs-in{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#E4DFCF);border-radius:10px;padding:9px 12px;font-size:13.5px;font-family:inherit;color:var(--ink,#14201A);}
.fs-len{display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap;}
.fs-len>span:first-child{font-weight:700;font-size:13px;color:var(--ink,#14201A);}
.fs-stepper{display:inline-flex;align-items:center;gap:0;border:1.5px solid var(--line,#E4DFCF);border-radius:999px;overflow:hidden;}
.fs-stepper button{width:34px;height:34px;border:0;background:var(--mint,#EAF6EF);color:var(--green,#0C7A46);font-size:19px;font-weight:800;cursor:pointer;line-height:1;}
.fs-stepper button:disabled{opacity:.4;cursor:default;}
.fs-stepper b{min-width:34px;text-align:center;font-size:15px;color:var(--ink,#14201A);}
.fs-len-note{font-size:12px;color:var(--ink2,#4A554E);}
.fs-hint{font-size:12.5px;color:var(--ink2,#4A554E);margin:0 0 10px;line-height:1.45;}
.fs-write{display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#fff,var(--mint,#EAF6EF));color:var(--green,#0C7A46);border:1.5px solid var(--green,#0C7A46);border-radius:999px;padding:11px 22px;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 5px 14px rgba(12,122,70,.14);transition:transform .14s,box-shadow .14s;}
.fs-write:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 10px 22px rgba(12,122,70,.2);}
.fs-write:disabled{opacity:.6;cursor:default;box-shadow:none;}
.fs-treat{margin-top:14px;border-top:1px dashed var(--line,#E4DFCF);padding-top:12px;}
.fs-treat-ttl{font-family:Poppins,sans-serif;font-weight:800;font-size:16px;color:var(--ink,#14201A);}
.fs-treat-mood{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--ink2,#4A554E);margin:3px 0 10px;}
.fs-scenes{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px;counter-reset:sc;}
.fs-scene{counter-increment:sc;position:relative;padding:10px 12px 10px 38px;background:var(--cream,#FBF6E6);border-radius:11px;}
.fs-scene::before{content:counter(sc);position:absolute;left:10px;top:10px;width:20px;height:20px;border-radius:999px;background:var(--green,#0C7A46);color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center;}
.fs-scene-vis{display:block;font-size:13px;color:var(--ink,#14201A);line-height:1.45;}
.fs-scene-cap{display:block;width:100%;box-sizing:border-box;margin-top:7px;border:1.5px solid var(--line,#E4DFCF);border-radius:8px;padding:6px 9px;font-size:12.5px;font-weight:700;color:var(--green,#0C7A46);background:#fff;font-family:inherit;}
.fs-scene-cap:focus{outline:none;border-color:var(--green,#0C7A46);}
.fs-go{position:relative;overflow:hidden;width:100%;display:inline-flex;align-items:center;justify-content:center;gap:9px;background:linear-gradient(135deg,#0C7A46 0%,#12A85E 55%,#1FA463 100%);color:#fff;border:0;border-radius:14px;padding:16px;font-family:Poppins,sans-serif;font-weight:800;font-size:16.5px;letter-spacing:-.01em;cursor:pointer;box-shadow:0 12px 28px rgba(12,122,70,.36),inset 0 1px 0 rgba(255,255,255,.22);transition:transform .15s,box-shadow .15s;}
.fs-go:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 18px 38px rgba(12,122,70,.46),inset 0 1px 0 rgba(255,255,255,.28);}
.fs-go:disabled{opacity:.5;cursor:default;box-shadow:none;}
.fs-go>*{position:relative;z-index:1;}
.fs-go::after{content:"";position:absolute;top:0;left:-65%;width:45%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.4),transparent);transform:skewX(-18deg);animation:fssheen 5s ease-in-out infinite;pointer-events:none;z-index:0;}
.fs-go:disabled::after{display:none;}
@keyframes fssheen{0%,55%{left:-65%}78%,100%{left:125%}}
.fs-cost{font-size:12.5px;color:var(--ink2,#4A554E);margin:10px 0 0;text-align:center;}
.fs-bal{font-weight:700;color:var(--green,#0C7A46);}
.fs-bal.low{color:#B3421E;}
.fs-err{font-size:12.5px;color:#B3421E;margin:8px 0 0;font-weight:600;}
.fs-ok{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--green,#0C7A46);font-weight:700;margin:10px 0 0;}
.fs-board{display:flex;flex-direction:column;gap:14px;margin-top:8px;}
.fs-shot{display:flex;gap:14px;align-items:flex-start;padding:12px;border:1.5px solid var(--line,#E4DFCF);border-radius:14px;background:var(--cream,#FBF6E6);transition:border-color .15s,box-shadow .15s;}
.fs-shot.set{border-color:var(--green2,#1FA463);background:#fff;box-shadow:0 4px 14px rgba(20,32,26,.06);}
.fs-shot-frame{position:relative;flex:0 0 auto;width:104px;aspect-ratio:9/16;border-radius:11px;overflow:hidden;background:#fff;border:1px solid var(--line,#E4DFCF);display:grid;place-items:center;}
.fs-shot-frame img{width:100%;height:100%;object-fit:cover;display:block;}
.fs-shot-empty{display:flex;flex-direction:column;align-items:center;gap:6px;color:var(--green,#0C7A46);opacity:.5;font-size:10.5px;font-weight:600;text-align:center;padding:0 6px;}
.fs-shot-spin{position:absolute;inset:0;background:rgba(255,255,255,.66);}
.fs-shot-spin::after{content:"";position:absolute;top:50%;left:50%;width:24px;height:24px;margin:-12px 0 0 -12px;border:2.5px solid var(--green,#0C7A46);border-top-color:transparent;border-radius:50%;animation:fsspin .7s linear infinite;}
@keyframes fsspin{to{transform:rotate(360deg);}}
.fs-shot-tag{position:absolute;left:6px;top:6px;display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:800;color:#fff;background:rgba(12,122,70,.88);border-radius:999px;padding:2px 9px;letter-spacing:.02em;}
.fs-shot-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:9px;}
.fs-shot-desc{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#E4DFCF);border-radius:10px;padding:9px 12px;font-size:13px;font-family:inherit;color:var(--ink,#14201A);resize:vertical;line-height:1.5;background:#fff;}
.fs-shot-desc:focus{outline:none;border-color:var(--green,#0C7A46);}
.fs-shot-make{align-self:flex-start;display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,var(--green,#0C7A46),var(--green2,#1FA463));color:#fff;border:0;border-radius:11px;padding:11px 21px;font-weight:800;font-size:13.5px;cursor:pointer;font-family:inherit;box-shadow:0 6px 16px rgba(12,122,70,.26);transition:transform .14s,box-shadow .14s;}
.fs-shot-make:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 10px 22px rgba(12,122,70,.34);}
.fs-shot-make:disabled{opacity:.5;cursor:default;box-shadow:none;}
.fs-shot-refine{display:flex;gap:7px;align-items:stretch;}
.fs-shot-edit{flex:1 1 auto;min-width:0;box-sizing:border-box;border:1.5px solid var(--line,#E4DFCF);border-radius:10px;padding:9px 12px;font-size:12.5px;font-family:inherit;color:var(--ink,#14201A);}
.fs-shot-edit:focus{outline:none;border-color:var(--green,#0C7A46);}
.fs-shot-edit:disabled{opacity:.6;}
.fs-shot-apply{flex:0 0 auto;background:var(--green,#0C7A46);color:#fff;border:0;border-radius:10px;padding:9px 18px;font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;}
.fs-shot-apply:disabled{opacity:.45;cursor:default;}
.fs-shot-reroll{align-self:flex-start;display:inline-flex;align-items:center;gap:5px;background:none;border:0;color:var(--ink2,#4A554E);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;padding:1px 0;}
.fs-shot-reroll:hover:not(:disabled){color:var(--green,#0C7A46);}
.fs-shot-reroll:disabled{opacity:.5;cursor:default;}
.fs-shot-own{margin-top:1px;}
.fs-shot-own summary{font-size:11.5px;color:var(--ink2,#4A554E);cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:4px;}
.fs-shot-own summary::-webkit-details-marker{display:none;}
.fs-shot-own summary::before{content:"+";font-weight:800;font-size:13px;}
.fs-shot-own[open] summary::before{content:"–";}
.fs-shot-url{width:100%;box-sizing:border-box;margin-top:7px;border:1.5px dashed var(--line,#E4DFCF);border-radius:9px;padding:8px 11px;font-size:12px;font-family:inherit;color:var(--ink,#14201A);}
.fs-shot-url:focus{outline:none;border-color:var(--green,#0C7A46);border-style:solid;}
/* Pick a Creator-made image as this shot's seed frame (the breakthrough path). */
.fs-shot-gallery{display:flex;gap:7px;overflow-x:auto;padding:8px 1px 4px;scrollbar-width:none;-webkit-overflow-scrolling:touch;}
.fs-shot-gallery::-webkit-scrollbar{display:none;}
.fs-gthumb{position:relative;flex:0 0 auto;width:52px;aspect-ratio:9/16;border-radius:8px;overflow:hidden;border:1.5px solid var(--line,#E4DFCF);background:#fff;padding:0;cursor:pointer;transition:border-color .12s,box-shadow .12s;}
.fs-gthumb img{width:100%;height:100%;object-fit:cover;display:block;}
.fs-gthumb:hover:not(:disabled){border-color:var(--green,#0C7A46);}
.fs-gthumb.on{border-color:var(--green2,#1FA463);box-shadow:0 0 0 2px rgba(31,164,99,.3);}
.fs-gthumb:disabled{opacity:.5;cursor:default;}
.fs-gthumb-chk{position:absolute;right:3px;top:3px;width:18px;height:18px;border-radius:50%;background:var(--green2,#1FA463);color:#fff;display:grid;place-items:center;box-shadow:0 1px 3px rgba(20,32,26,.3);}
.fs-gempty{font-size:11.5px;color:var(--ink2,#4A554E);opacity:.85;margin:8px 0 0;}
/* Cast panel — "cast your movie": one locked actor (face + voice) per character. */
.fs-cast-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
.fs-cast-prog{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;color:var(--ink2,#4A554E);background:var(--cream,#FBF6E6);border:1.5px solid var(--line,#E4DFCF);border-radius:999px;padding:4px 12px;letter-spacing:.01em;transition:background .2s,color .2s,border-color .2s;}
.fs-cast-prog.done{color:#fff;background:var(--green,#0C7A46);border-color:var(--green,#0C7A46);}
.fs-cast{display:flex;flex-direction:column;gap:12px;margin-top:10px;}
.fs-actor{display:flex;gap:14px;align-items:flex-start;padding:12px;border:1.5px solid var(--line,#E4DFCF);border-radius:16px;background:var(--cream,#FBF6E6);transition:border-color .18s,box-shadow .18s;}
.fs-actor.set{border-color:var(--green2,#1FA463);background:#fff;box-shadow:0 6px 18px rgba(20,32,26,.07);}
.fs-actor-face{position:relative;flex:0 0 auto;width:98px;aspect-ratio:3/4;border-radius:13px;overflow:hidden;background:#fff;border:1px solid var(--line,#E4DFCF);display:grid;place-items:center;padding:0;}
.fs-actor-face img{width:100%;height:100%;object-fit:cover;display:block;}
.fs-actor-cast{cursor:pointer;border:2px dashed var(--green,#0C7A46);background:rgba(12,122,70,.05);font-family:inherit;transition:background .15s,transform .15s,box-shadow .15s;}
.fs-actor-cast:hover:not(:disabled){background:rgba(12,122,70,.1);transform:translateY(-2px);box-shadow:0 8px 18px rgba(12,122,70,.16);}
.fs-actor-cast:disabled{opacity:.55;cursor:default;}
.fs-actor-empty{display:flex;flex-direction:column;align-items:center;gap:7px;color:var(--green,#0C7A46);font-size:11px;font-weight:800;text-align:center;padding:0 6px;line-height:1.2;}
.fs-actor-badge{position:absolute;right:6px;top:6px;width:22px;height:22px;border-radius:50%;background:var(--green2,#1FA463);color:#fff;display:grid;place-items:center;box-shadow:0 2px 6px rgba(20,32,26,.25);}
.fs-actor-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:8px;}
.fs-actor-name{font-size:15px;color:var(--ink,#14201A);letter-spacing:-.01em;}
.fs-actor-desc{font-size:12px;line-height:1.45;color:var(--ink2,#4A554E);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
/* editable cast (rename / re-describe / add / remove your own characters) */
.fs-actor-name-in{width:100%;box-sizing:border-box;border:1.5px solid transparent;border-radius:8px;background:transparent;font-family:Poppins,sans-serif;font-weight:800;font-size:14.5px;color:var(--ink,#14201A);padding:4px 7px;transition:background .12s,border-color .12s;}
.fs-actor-name-in:hover{background:rgba(12,122,70,.05);}
.fs-actor-name-in:focus{outline:0;background:#fff;border-color:var(--green2,#1EA85C);}
.fs-actor-name-in::placeholder{color:var(--ink3,#9AA39B);font-weight:700;}
.fs-actor-desc-in{width:100%;box-sizing:border-box;border:1.5px solid transparent;border-radius:8px;background:transparent;resize:none;font-family:Poppins,sans-serif;font-size:12px;line-height:1.4;color:var(--ink2,#4A554E);padding:4px 7px;transition:background .12s,border-color .12s;}
.fs-actor-desc-in:hover{background:rgba(12,122,70,.05);}
.fs-actor-desc-in:focus{outline:0;background:#fff;border-color:var(--green2,#1EA85C);}
.fs-actor-desc-in::placeholder{color:var(--ink3,#9AA39B);}
.fs-actor-del{border:0;background:transparent;color:#B0564B;font-weight:800;font-size:11px;cursor:pointer;padding:5px 9px;border-radius:7px;font-family:Poppins,sans-serif;}
.fs-actor-del:hover:not(:disabled){background:#FBECEA;}
.fs-cast-add{display:inline-flex;align-items:center;gap:8px;margin:13px 0 2px;border:1.5px dashed var(--green,#0C7A46);background:rgba(12,122,70,.05);color:var(--green,#0C7A46);border-radius:13px;padding:12px 17px;font-family:Poppins,sans-serif;font-weight:800;font-size:13px;cursor:pointer;transition:background .14s;}
.fs-cast-add:hover:not(:disabled){background:rgba(12,122,70,.1);}
.fs-cast-add:disabled{opacity:.5;cursor:default;}
.fs-cast-add span{font-size:17px;line-height:1;font-weight:700;}
.fs-actor-voice{display:flex;gap:7px;align-items:stretch;}
.fs-actor-voice select{flex:1 1 auto;min-width:0;box-sizing:border-box;border:1.5px solid var(--line,#E4DFCF);border-radius:10px;padding:8px 11px;font-size:12.5px;font-family:inherit;color:var(--ink,#14201A);background:#fff;cursor:pointer;}
.fs-actor-voice select:focus{outline:none;border-color:var(--green,#0C7A46);}
.fs-actor-voice select:disabled{opacity:.6;}
.fs-voice-play{flex:0 0 auto;width:38px;display:grid;place-items:center;border:1.5px solid var(--line,#E4DFCF);border-radius:10px;background:#fff;color:var(--green,#0C7A46);cursor:pointer;transition:background .12s,border-color .12s;}
.fs-voice-play:hover:not(:disabled){background:rgba(12,122,70,.08);border-color:var(--green,#0C7A46);}
.fs-voice-play:disabled{opacity:.4;cursor:default;}
.fs-actor-opts{display:flex;gap:14px;align-items:center;flex-wrap:wrap;}
.fs-actor-recast{display:inline-flex;align-items:center;gap:4px;background:none;border:0;color:var(--ink2,#4A554E);font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;padding:0;}
.fs-actor-recast:hover:not(:disabled){color:var(--green,#0C7A46);}
.fs-actor-recast:disabled{opacity:.5;cursor:default;}
.fs-actor-own{margin:0;}
@media(prefers-reduced-motion:reduce){.fs-go::after{display:none;}.fs-tmpl,.fs-shot-make,.fs-write,.fs-go,.fs-actor-cast{transition:none;}.fs-head-img,.fs-head-copy b,.fs-head-rose{animation:none;}}
@media(max-width:640px){.fs-head{padding:18px;min-height:114px;}.fs-head-copy{max-width:60%;}.fs-head-copy b{font-size:21px;}.fs-head-media{width:52%;}.fs-tmpl{flex:1 1 100%;}.fs-shot{flex-direction:column;}.fs-shot-frame{width:100%;max-width:160px;align-self:center;}}
/* ---- Story flow (location + camera-angle storyboard) ---- */
.fs-flegend{display:flex;flex-wrap:wrap;gap:14px;margin:2px 0 12px;font-size:11.5px;color:var(--ink2,#4A554E);}
.fs-flegend span{display:inline-flex;align-items:center;gap:6px;}
.fs-dot{width:9px;height:9px;border-radius:50%;display:inline-block;}
.fs-dot.seam{background:#12A85E;}
.fs-dot.ang{background:#7F77DD;}
.fs-dot.loc{background:#E3A531;}
.fs-flow{display:flex;flex-direction:column;gap:4px;}
.fs-loc{border:1.5px solid #9CCBB1;border-radius:18px;background:var(--card,#FDFCF7);box-shadow:0 9px 24px rgba(20,32,26,.10);padding:12px 13px 13px;}
.fs-loc-head{display:flex;align-items:center;gap:9px;margin-bottom:11px;flex-wrap:wrap;}
.fs-loc-pin{font-size:16px;line-height:1;flex:none;}
.fs-loc-where{flex:1 1 180px;min-width:120px;border:0;border-bottom:1.5px solid transparent;background:transparent;font-family:Poppins,sans-serif;font-weight:800;font-size:15px;color:var(--ink,#14201A);padding:3px 2px;border-radius:0;transition:border-color .14s;}
.fs-loc-where:focus{outline:0;border-bottom-color:var(--green,#0C7A46);}
.fs-loc-scene{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6F8A7C;background:#EAF6EF;padding:3px 8px;border-radius:7px;flex:none;}
.fs-loc-who{display:inline-flex;align-items:center;flex:none;}
.fs-who{width:28px;height:28px;border-radius:50%;background:#EAF6EF center/cover no-repeat;border:1.5px solid var(--card,#FDFCF7);box-shadow:0 0 0 1px #9CCBB1;display:grid;place-items:center;font-size:11px;font-weight:800;color:#0F6E56;margin-left:-7px;}
.fs-loc-who .fs-who:first-child{margin-left:0;}
.fs-shotblk{border:1px solid var(--line,#E4DFCF);border-radius:12px;background:#FCFBF5;padding:9px 10px;}
.fs-shotblk-head{display:flex;align-items:center;gap:6px;color:var(--ink2,#4A554E);margin-bottom:8px;}
.fs-shot-angle{flex:1;min-width:0;border:0;background:transparent;font-family:Poppins,sans-serif;font-weight:700;font-size:12px;color:var(--ink2,#4A554E);padding:2px;}
.fs-shot-angle:focus{outline:0;color:var(--ink,#14201A);}
.fs-beats{display:flex;flex-direction:column;gap:7px;}
.fs-beat{display:flex;align-items:flex-start;gap:9px;}
.fs-beat-face{width:30px;height:30px;flex:none;border-radius:50%;background:#EAF6EF center/cover no-repeat;box-shadow:0 0 0 1.5px #9CCBB1;display:grid;place-items:center;font-size:12px;font-weight:800;color:#0F6E56;margin-top:2px;}
.fs-beat-body{flex:1;min-width:0;}
.fs-beat-spk{display:inline-flex;align-items:center;gap:4px;border:0;background:transparent;color:var(--green,#0C7A46);font-family:Poppins,sans-serif;font-weight:800;font-size:11.5px;padding:0 0 2px;cursor:pointer;}
.fs-beat-line{width:100%;border:1.5px solid var(--line,#E4DFCF);border-radius:10px;background:#fff;font-family:Poppins,sans-serif;font-size:13px;color:var(--ink,#14201A);padding:7px 9px;resize:vertical;line-height:1.4;box-sizing:border-box;transition:border-color .14s,box-shadow .14s;}
.fs-beat-line:focus{outline:0;border-color:var(--green,#0C7A46);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.fs-beat-x{flex:none;border:0;background:transparent;color:#C0B9A6;cursor:pointer;padding:6px 2px;border-radius:7px;transition:color .14s,background .14s;}
.fs-beat-x:hover{color:#C2410C;background:#FBEAE3;}
.fs-beat-add{align-self:flex-start;margin-top:2px;border:1px dashed #9CCBB1;background:#F3F9F4;color:var(--green,#0C7A46);font-family:Poppins,sans-serif;font-weight:800;font-size:11.5px;padding:5px 11px;border-radius:9px;cursor:pointer;transition:background .14s;}
.fs-beat-add:hover{background:#EAF6EF;}
.fs-anglecut{display:flex;align-items:center;gap:6px;margin:8px 0;font-size:11px;font-weight:700;color:#4A4397;}
.fs-anglecut::before,.fs-anglecut::after{content:"";flex:1;border-top:1px dashed #C6C2EE;}
.fs-loc-addangle{margin-top:10px;display:inline-flex;align-items:center;gap:6px;border:1px solid #C6C2EE;background:#F3F2FD;color:#4A4397;font-family:Poppins,sans-serif;font-weight:800;font-size:11.5px;padding:6px 12px;border-radius:9px;cursor:pointer;transition:background .14s;}
.fs-loc-addangle:hover{background:#EEEDFB;}
.fs-scenecut{display:flex;align-items:center;justify-content:center;gap:7px;margin:3px 0;padding:7px 12px;font-size:11.5px;font-weight:800;color:#8A5A12;background:#FBEFD6;border-radius:10px;}
.fs-addscene{margin-top:8px;width:100%;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1.5px dashed #9CCBB1;background:#F3F9F4;color:var(--green,#0C7A46);font-family:Poppins,sans-serif;font-weight:800;font-size:13px;padding:11px;border-radius:14px;cursor:pointer;transition:background .14s,border-color .14s;}
.fs-addscene:hover{background:#EAF6EF;border-color:var(--green,#0C7A46);}
/* Cast roster picker (pick a presenter / avatar as a character's face) */
.fs-actor-roster summary{display:inline-flex;align-items:center;gap:5px;}
.fs-roster{display:grid;grid-template-columns:repeat(auto-fill,minmax(66px,1fr));gap:8px;margin:9px 0 2px;max-height:238px;overflow-y:auto;padding:2px;}
.fs-rface{position:relative;border:1.5px solid var(--line,#E4DFCF);border-radius:12px;background:var(--card,#FDFCF7);padding:5px 5px 6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;transition:border-color .14s,box-shadow .14s;}
.fs-rface:hover:not(:disabled){border-color:#9CCBB1;box-shadow:0 4px 12px rgba(20,32,26,.12);}
.fs-rface.on{border-color:var(--green,#0C7A46);box-shadow:0 0 0 2.5px var(--green,#0C7A46),0 0 20px -2px rgba(18,168,94,.6),0 8px 22px -6px rgba(12,122,70,.5);}
.fs-rface-img{width:100%;aspect-ratio:1/1;border-radius:9px;background:#EAF6EF center/cover no-repeat;}
.fs-rface-name{font-size:10px;font-weight:700;color:var(--ink2,#4A554E);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.1;}
.fs-rface-chk{position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;background:var(--green,#0C7A46);color:#fff;display:grid;place-items:center;box-shadow:0 1px 4px rgba(0,0,0,.25);}
/* Combined "Your scene" card + chat-style conversation */
.fs-scenetop{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;}
.fs-scenetop-hint{font-size:12px;color:var(--ink2,#4A554E);line-height:1.4;flex:1;}
.fs-rewrite{flex:none;display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--green,#0C7A46);font-family:Poppins,sans-serif;font-weight:800;font-size:12px;border-radius:999px;padding:6px 13px;cursor:pointer;transition:background .14s,border-color .14s;}
.fs-rewrite:hover:not(:disabled){background:#EAF6EF;border-color:#9CCBB1;}
.fs-backdrops{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 13px;}
.fs-backdrops-lbl{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--ink2,#4A554E);opacity:.7;margin-right:2px;}
.fs-bchip{border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink2,#4A554E);font-family:Poppins,sans-serif;font-weight:700;font-size:11.5px;border-radius:999px;padding:4px 11px;cursor:pointer;transition:background .14s,border-color .14s,color .14s;}
.fs-bchip:hover{border-color:#9CCBB1;background:#F3F9F4;}
.fs-bchip.on{background:#E1F5EE;border-color:#1D9E75;color:#0F6E56;}
.fs-chat{display:flex;flex-direction:column;gap:11px;padding:4px 0 2px;}
.fs-msg{display:flex;align-items:flex-end;gap:8px;}
.fs-msg.right{flex-direction:row-reverse;}
.fs-msg-face{width:34px;height:34px;flex:none;border-radius:50%;background:#EAF6EF center/cover no-repeat;box-shadow:0 0 0 1.5px #9CCBB1;display:grid;place-items:center;font-size:13px;font-weight:800;color:#0F6E56;}
.fs-msg-col{min-width:0;max-width:78%;display:flex;flex-direction:column;gap:3px;flex:1;}
.fs-msg.right .fs-msg-col{align-items:flex-end;}
.fs-msg-spk{align-self:flex-start;display:inline-flex;align-items:center;gap:4px;border:0;background:transparent;color:var(--green,#0C7A46);font-family:Poppins,sans-serif;font-weight:800;font-size:11px;padding:0 0 0 4px;cursor:pointer;}
.fs-msg.right .fs-msg-spk{align-self:flex-end;padding:0 4px 0 0;}
.fs-msg-bubble{width:100%;border:1.5px solid var(--line,#E4DFCF);background:#FCFBF5;border-radius:16px 16px 16px 5px;font-family:Poppins,sans-serif;font-size:13px;color:var(--ink,#14201A);padding:9px 13px;resize:vertical;line-height:1.45;box-sizing:border-box;transition:border-color .14s,box-shadow .14s;}
.fs-msg.right .fs-msg-bubble{background:#EAF6EF;border-color:#B7DCC8;border-radius:16px 16px 5px 16px;}
.fs-msg-bubble:focus{outline:0;border-color:var(--green,#0C7A46);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.fs-meter{display:flex;align-items:center;gap:7px;margin-top:4px;padding:0 2px;}
.fs-msg.right .fs-meter{flex-direction:row-reverse;}
.fs-meter-bar{position:relative;flex:1;max-width:120px;height:4px;border-radius:3px;background:#E7EFEA;overflow:hidden;}
.fs-meter-bar i{position:absolute;top:0;left:0;bottom:0;border-radius:3px;background:var(--green2,#1FA463);transition:width .12s ease;}
.fs-meter-num{font-size:10px;font-weight:700;color:#6A8577;letter-spacing:.2px;white-space:nowrap;font-variant-numeric:tabular-nums;}
.fs-meter.warn .fs-meter-bar i{background:#D59A2A;}
.fs-meter.warn .fs-meter-num{color:#B07D16;}
.fs-meter.over .fs-meter-bar i{background:#D6563F;}
.fs-meter.over .fs-meter-num{color:#C0392B;font-weight:800;}
.fs-filmlen{display:inline-flex;align-items:center;font-size:11px;font-weight:800;color:var(--green,#0C7A46);background:var(--mint,#EAF6EF);border:1px solid #CDE8DA;border-radius:999px;padding:2px 9px;margin-left:2px;font-variant-numeric:tabular-nums;}
.fs-msg-x{flex:none;align-self:center;border:0;background:transparent;color:#C0B9A6;cursor:pointer;padding:5px;border-radius:7px;transition:color .14s,background .14s;}
.fs-msg-x:hover{color:#C2410C;background:#FBEAE3;}
.fs-chat-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:5px;padding-left:42px;}
.fs-anglecut{display:flex;align-items:center;gap:7px;margin:12px 0 10px;color:#4A4397;}
.fs-anglecut-in{flex:1;min-width:0;border:0;border-bottom:1px dashed #C6C2EE;background:transparent;font-family:Poppins,sans-serif;font-weight:700;font-size:11.5px;color:#4A4397;padding:2px;}
.fs-anglecut-in:focus{outline:0;border-bottom-color:#7F77DD;}
.fs-anglecut-x{flex:none;border:0;background:transparent;color:#C6C2EE;cursor:pointer;padding:3px;border-radius:6px;}
.fs-anglecut-x:hover{color:#7F77DD;background:#EEEDFB;}

/* ───────── Music Video — the card builder ───────── */
.mm{margin:2px 0 0;}
.mm-vhead{display:flex;align-items:center;gap:14px;background:linear-gradient(145deg,#0E6B41,#083E27);border-radius:20px;padding:16px 20px;box-shadow:0 16px 40px -22px rgba(8,62,39,.6);}
.mm-vhead-ico{width:46px;height:46px;border-radius:13px;background:rgba(255,255,255,.12);display:grid;place-items:center;flex:none;}
.mm-vhead-ico svg{width:24px;height:24px;stroke:#8FE9BC;stroke-width:1.9;fill:none;stroke-linecap:round;stroke-linejoin:round;}
.mm-vhead-copy{min-width:0;}
.mm-vhead-copy b{font-family:Fraunces,Poppins,serif;font-weight:700;font-size:22px;color:#fff;letter-spacing:-.01em;display:block;line-height:1.1;}
.mm-vhead-copy span{font-size:12.5px;color:rgba(255,255,255,.75);}
.mm-back{margin-left:auto;flex:none;font-size:12px;font-weight:800;color:#A7F0C8;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:7px 13px;cursor:pointer;font-family:Poppins,sans-serif;transition:background .14s;}
.mm-back:hover{background:rgba(255,255,255,.18);}
.mm-topic{margin:16px 0 0;background:var(--panel,#FDFBF4);border:1.5px solid var(--line,#E4DFCF);border-radius:18px;padding:16px 18px;box-shadow:0 2px 4px rgba(20,32,26,.03);}
.mm-topic label{font-size:13px;font-weight:800;color:var(--ink,#14201A);display:block;margin-bottom:8px;}
.mm-topic input,.mm-topic textarea{width:100%;border:1.5px solid var(--line,#E4DFCF);border-radius:12px;padding:12px 14px;font-size:14.5px;font-family:Poppins,sans-serif;color:var(--ink,#14201A);background:#fff;box-sizing:border-box;}
.mm-topic textarea{resize:vertical;min-height:62px;line-height:1.45;}
.mm-topic input:focus,.mm-topic textarea:focus{outline:0;border-color:var(--green,#0C7A46);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.mm-topic input::placeholder,.mm-topic textarea::placeholder{color:var(--ink3,#9AA39B);}
/* scene-count row that lives under the describe-first box in the classic (non-MV) builder */
.fs-len-topic{display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line,#E4DFCF);font-size:13px;font-weight:700;color:var(--ink2,#55605A);flex-wrap:wrap;}
.mm-hint{font-size:12.5px;color:var(--ink2,#4A554E);margin:18px 4px 10px;display:flex;align-items:center;gap:7px;}
/* The cards are a horizontal SLIDER (swipe through them like a wheel) — one row, so tapping a card
   opens its options directly beneath the row (adjacent), never buried under the other cards. */
/* A numbered 1-5 step flow, two across — each step turns green once set. An open step's options
   panel is a full-width grid item placed right after its card (via the order property); dense flow
   backfills so the 2-up cards never leave an empty gap next to the open step. */
.mm-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;grid-auto-flow:row dense;}
.mm-card{position:relative;text-align:left;cursor:pointer;background:#fff;border:1.5px solid var(--line,#E4DFCF);border-radius:18px;padding:15px 16px;box-shadow:0 1px 2px rgba(20,32,26,.04);transition:transform .16s cubic-bezier(.2,.7,.2,1),box-shadow .16s,border-color .16s,background .2s;font-family:Poppins,sans-serif;}
.mm-card-wide{grid-column:1 / -1;}
.mm-card:hover{border-color:var(--green2,#1EA85C);box-shadow:0 10px 26px -18px rgba(20,32,26,.26);}
.mm-card.on{border-color:var(--green,#0C7A46);box-shadow:0 0 0 1.5px var(--green,#0C7A46),0 14px 30px -20px rgba(12,122,70,.4);}
/* a step's options open full-width right after its card (the order property places it there), so the
   options always appear AT the card you tapped — never down at the bottom of the grid */
.mm-opts-grid{grid-column:1 / -1;margin:0;}
.mm-card.done{border-color:#7FC9A1 !important;background:linear-gradient(180deg,#EDF8F1,#fff) !important;}
.mm-card.done.on{border-color:#0C7A46 !important;}
/* step badge: the number, then a green check once the step is set */
.mm-step{position:absolute;top:12px;right:12px;width:25px;height:25px;border-radius:50%;background:#EFF1EE;color:var(--ink3,#9AA39B);font-weight:800;font-size:12.5px;display:grid;place-items:center;font-family:Poppins,sans-serif;transition:background .2s,color .2s;}
.mm-card.done .mm-step{background:#0C7A46 !important;color:#fff !important;}
.mm-card.done .mm-step svg{stroke:#fff;stroke-width:2.6;fill:none;stroke-linecap:round;stroke-linejoin:round;}
@media (max-width:300px){.mm-grid{grid-template-columns:1fr;}.mm-card-wide{grid-column:auto;}}
.mm-card-top{display:flex;align-items:center;gap:11px;}
.mm-card-ico{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;flex:none;box-shadow:0 6px 14px -6px rgba(0,0,0,.35);}
.mm-card-ico svg{stroke:#fff;stroke-width:1.9;fill:none;stroke-linecap:round;stroke-linejoin:round;}
.mm-card-ico.c1{background:linear-gradient(135deg,#C2487E,#8E2F5C);}
.mm-card-ico.c2{background:linear-gradient(135deg,#1EA85C,#0C7A46);}
.mm-card-ico.c3{background:linear-gradient(135deg,#E8A43C,#CE7C18);}
.mm-card-ico.c4{background:linear-gradient(135deg,#3E6FB0,#274C86);}
.mm-card-ico.c5{background:linear-gradient(135deg,#7E57C2,#53389E);}
.mm-card-face{width:40px;height:40px;border-radius:12px;flex:none;background:#EAF6EF center/cover no-repeat;box-shadow:0 6px 14px -6px rgba(0,0,0,.35),0 0 0 2px #fff;}
.mm-card-ttl{display:block;min-width:0;}
.mm-card-kick{display:block;font-size:10.5px;font-weight:800;color:var(--ink3,#9AA39B);text-transform:uppercase;letter-spacing:.06em;}
.mm-card-ttl b{display:block;font-size:15.5px;font-weight:800;letter-spacing:-.01em;color:var(--ink,#14201A);line-height:1.15;}
.mm-card-edit{position:absolute;top:13px;right:13px;width:26px;height:26px;border-radius:50%;background:var(--mint,#EAF6EF);color:var(--green,#0C7A46);display:grid;place-items:center;border:1px solid #D4EBDD;}
.mm-card-edit svg{stroke:currentColor;stroke-width:2;fill:none;}
.mm-val{display:block;margin:13px 0 0;font-size:13px;color:var(--ink2,#4A554E);line-height:1.4;}
.mm-val .mm-free{color:var(--green,#0C7A46);font-weight:800;}
.mm-muted{color:var(--ink3,#9AA39B);}
.mm-vchips{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 0;}
.mm-chip{font-size:11.5px;font-weight:800;color:var(--green-d,#0A5E37);background:var(--mint,#EAF6EF);border:1px solid #D4EBDD;border-radius:999px;padding:4px 10px;}
.mm-opts{margin:13px 0 0;background:var(--panel,#FDFBF4);border:1.5px solid var(--green,#0C7A46);border-radius:18px;padding:16px 18px;box-shadow:0 0 0 1px rgba(12,122,70,.12),0 16px 36px -24px rgba(12,122,70,.4);}
.mm-opts-h{font-size:13.5px;font-weight:800;color:var(--ink,#14201A);margin-bottom:4px;}
.mm-opts-sub{font-size:12px;color:var(--ink2,#4A554E);margin-bottom:12px;line-height:1.4;}
.mm-props{display:flex;flex-wrap:wrap;gap:9px;}
.mm-prop{display:inline-flex;align-items:center;gap:6px;border:1.5px solid var(--line,#E4DFCF);background:#fff;border-radius:999px;padding:8px 14px;font-size:13px;font-weight:800;color:var(--ink,#14201A);cursor:pointer;font-family:Poppins,sans-serif;transition:background .14s,border-color .14s,color .14s;}
.mm-prop:hover{border-color:var(--green,#0C7A46);}
.mm-prop.on{background:var(--green,#0C7A46);border-color:var(--green,#0C7A46);color:#fff;}
/* HORIZONTAL scroll strip — the same premium avatar picker used elsewhere (swipe through faces). */
.mm-artistpick{display:flex;gap:9px;overflow-x:auto;overflow-y:hidden;padding:2px 2px 10px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;scrollbar-width:thin;}
.mm-artistpick::-webkit-scrollbar{height:6px;}
.mm-artistpick::-webkit-scrollbar-thumb{background:#D4E3DA;border-radius:3px;}
.mm-artistpick::-webkit-scrollbar-track{background:transparent;}
.mm-artistpick .fs-rface{flex:0 0 78px;scroll-snap-align:start;}
.mm-autoface-img{display:grid;place-items:center;background:linear-gradient(135deg,#EFEAFB,#DDD3F3)!important;}
.mm-autoface-img svg{stroke:#6C4FB0;stroke-width:1.9;fill:none;stroke-linecap:round;stroke-linejoin:round;}
/* Props picker — real PHOTO tiles (not emoji), plus "Create AI prop" + "Add a photo" makers. */
/* HORIZONTAL scroll strip (swipe sideways through the props), premium mobile feel. */
.mm-proppick{display:flex;gap:10px;overflow-x:auto;overflow-y:hidden;padding:2px 2px 10px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;scrollbar-width:thin;}
.mm-proppick::-webkit-scrollbar{height:6px;}
.mm-proppick::-webkit-scrollbar-thumb{background:#D4E3DA;border-radius:3px;}
.mm-proppick::-webkit-scrollbar-track{background:transparent;}
.mm-proppick .mm-ptile{flex:0 0 88px;scroll-snap-align:start;}
.mm-ptile{position:relative;border:1.5px solid var(--line,#E4DFCF);border-radius:13px;background:var(--card,#FDFCF7);padding:5px 5px 7px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px;font-family:Poppins,sans-serif;transition:border-color .14s,box-shadow .14s,transform .14s;}
.mm-ptile:hover{border-color:var(--green2,#1EA85C);transform:translateY(-2px);}
.mm-ptile.on{border-color:var(--green,#0C7A46);box-shadow:0 0 0 2.5px var(--green,#0C7A46),0 0 20px -2px rgba(18,168,94,.6),0 8px 22px -6px rgba(12,122,70,.5);}
.mm-ptile-img{width:100%;aspect-ratio:1/1;border-radius:10px;background:#EFF4F1 center/cover no-repeat;display:grid;place-items:center;}
.mm-ptile-name{font-size:10.5px;font-weight:800;color:var(--ink2,#4A554E);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.15;text-align:center;}
/* selection is shown by the GREEN GLOW on the tile (not a check badge) — owner's call */
.mm-ptile-chk,.fs-rface-chk{display:none !important;}
.mm-ptile-new{border-style:dashed;border-color:#C9D7CE;}
.mm-ptile-new .mm-ptile-name{color:var(--green,#0C7A46);}
.mm-ptile-newimg{background:linear-gradient(135deg,#EAF6EF,#D7ECE0)!important;}
.mm-ptile-newimg svg{stroke:var(--green,#0C7A46);stroke-width:1.9;fill:none;stroke-linecap:round;stroke-linejoin:round;}
.mm-ptile-spin{width:18px;height:18px;border-radius:50%;border:2.5px solid #BFE0CD;border-top-color:var(--green,#0C7A46);animation:mmspin .7s linear infinite;}
@keyframes mmspin{to{transform:rotate(360deg);}}
.mm-propmaker{display:flex;gap:8px;margin:11px 0 0;flex-wrap:wrap;}
.mm-propmaker input{flex:1;min-width:180px;border:1.5px solid var(--line,#E4DFCF);border-radius:11px;padding:11px 13px;font-size:13.5px;font-family:Poppins,sans-serif;color:var(--ink,#14201A);background:#fff;}
.mm-propmaker input:focus{outline:0;border-color:var(--green,#0C7A46);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.mm-propmaker>button{flex:none;display:inline-flex;align-items:center;gap:6px;border:0;border-radius:11px;background:var(--green,#0C7A46);color:#fff;font-weight:800;font-size:13px;padding:0 16px;cursor:pointer;font-family:Poppins,sans-serif;}
.mm-propmaker>button:disabled{opacity:.5;cursor:default;}
.mm-propmaker>button svg{stroke:#fff;stroke-width:2;fill:none;}
/* Artist "Create / Upload" tiles — dashed, match the prop makers */
.mm-newface{border-style:dashed!important;border-color:#C9D7CE!important;}
.mm-newface .fs-rface-name{color:var(--green,#0C7A46);}
.mm-newface-img{display:grid!important;place-items:center;background:linear-gradient(135deg,#EAF6EF,#D7ECE0)!important;}
.mm-newface-img svg{stroke:var(--green,#0C7A46);stroke-width:1.9;fill:none;stroke-linecap:round;stroke-linejoin:round;}
/* Genre picker — HORIZONTAL scroll strip of genre cover PICTURES (not text pills). */
.mm-genrepick{display:flex;gap:10px;overflow-x:auto;overflow-y:hidden;padding:2px 2px 10px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;scrollbar-width:thin;}
.mm-genrepick::-webkit-scrollbar{height:6px;}
.mm-genrepick::-webkit-scrollbar-thumb{background:#D4E3DA;border-radius:3px;}
.mm-genrepick::-webkit-scrollbar-track{background:transparent;}
.mm-gtile{position:relative;flex:0 0 118px;scroll-snap-align:start;border:1.5px solid var(--line,#E4DFCF);border-radius:14px;background:var(--card,#FDFCF7);padding:0;cursor:pointer;overflow:hidden;font-family:Poppins,sans-serif;transition:border-color .14s,box-shadow .14s,transform .14s;}
.mm-gtile:hover{border-color:var(--green2,#1EA85C);transform:translateY(-2px);}
.mm-gtile.on{border-color:var(--green,#0C7A46);box-shadow:0 0 0 2.5px var(--green,#0C7A46),0 0 20px -2px rgba(18,168,94,.6),0 8px 22px -6px rgba(12,122,70,.5);}
.mm-gtile-img{display:block;width:100%;aspect-ratio:16/10;background:#EFF4F1 center/cover no-repeat;}
.mm-gtile-name{display:block;font-size:11.5px;font-weight:800;color:var(--ink,#14201A);padding:7px 9px 8px;text-align:left;line-height:1.2;white-space:normal;}
.mm-gtile .mm-ptile-chk{top:7px;right:7px;}
.mm-preview{margin:16px 0 0;}
.mm-preview-btn{display:inline-flex;align-items:center;gap:7px;border:1.5px dashed var(--green,#0C7A46);background:#fff;color:var(--green,#0C7A46);border-radius:12px;padding:10px 16px;font-family:Poppins,sans-serif;font-weight:800;font-size:13px;cursor:pointer;transition:background .14s;}
.mm-preview-btn:hover:not(:disabled){background:var(--mint,#EAF6EF);}
.mm-preview-btn:disabled{opacity:.6;cursor:default;}
.mm-preview-btn svg{stroke:currentColor;stroke-width:2;fill:none;}
.mm-storyboard{margin:16px 0 0;}
.mm-sb-wait{display:flex;align-items:center;gap:11px;font-size:13px;font-weight:700;color:var(--green-d,#0A5E37);background:rgba(12,122,70,.06);border:1px solid #CDE8D9;border-radius:12px;padding:12px 14px;margin:11px 0 0;line-height:1.35;}
.mm-sb-wait::before{content:"";width:18px;height:18px;border-radius:50%;border:2.5px solid #BFE0CD;border-top-color:var(--green,#0C7A46);animation:mmspin .7s linear infinite;flex:none;}
.mm-sb-head{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:800;color:var(--green,#0C7A46);margin:14px 2px 10px;line-height:1.3;}
.mm-sb-head svg{stroke:currentColor;stroke-width:2.4;fill:none;flex:none;}
/* Horizontal, swipeable FILMSTRIP — each scene's still + what-happens + words, like a video editor.
   Compact vertically so it never turns the page into a doom-scroll. */
.mm-sb-strip{display:flex;gap:12px;overflow-x:auto;padding:2px 2px 12px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;scrollbar-width:thin;}
.mm-sb-shot{flex:0 0 auto;width:150px;scroll-snap-align:start;display:flex;flex-direction:column;gap:7px;}
.mm-sb-frame{position:relative;border-radius:13px;overflow:hidden;background:#20302A;aspect-ratio:9/16;box-shadow:0 2px 8px rgba(20,32,26,.16);}
.mm-sb-frame img{width:100%;height:100%;object-fit:cover;display:block;}
/* a SOFT, shimmering placeholder (not a dark "broken"-looking box) while the still is being drawn */
.mm-sb-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#6E8B7C;text-align:center;padding:10px;background:linear-gradient(140deg,#EEF6F1,#DCECE3);overflow:hidden;}
.mm-sb-empty::before{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 25%,rgba(255,255,255,.65) 50%,transparent 75%);background-size:220% 100%;animation:mmshimmer 1.5s linear infinite;}
@keyframes mmshimmer{to{background-position:-220% 0;}}
.mm-sb-empty svg{stroke:#7FA994;stroke-width:1.8;fill:none;position:relative;}
.mm-sb-empty small{font-size:10px;font-weight:800;color:#5E8070;line-height:1.25;max-width:118px;position:relative;letter-spacing:.01em;}
.mm-sb-num{position:absolute;left:7px;top:7px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:rgba(10,20,15,.66);color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center;}
.mm-sb-desc{display:flex;flex-direction:column;gap:7px;padding:2px 1px 0;}
/* Click-to-edit: the description + words are textareas that read as plain text until you tap them. */
.mm-sb-what,.mm-sb-words{width:100%;display:block;box-sizing:border-box;border:1px solid transparent;border-radius:8px;background:transparent;resize:none;font-family:Poppins,sans-serif;padding:4px 6px;margin:0;cursor:text;transition:background .12s,border-color .12s,box-shadow .12s;}
.mm-sb-what:hover,.mm-sb-words:hover{background:rgba(12,122,70,.06);}
.mm-sb-what:focus,.mm-sb-words:focus{outline:0;background:#fff;border-color:var(--green2,#1EA85C);box-shadow:0 0 0 2px rgba(12,122,70,.1);}
.mm-sb-what::placeholder,.mm-sb-words::placeholder{color:var(--ink3,#9AA39B);font-style:normal;}
.mm-sb-what{font-size:11.5px;line-height:1.4;color:var(--ink2,#4A554E);font-weight:500;}
.mm-sb-words{font-size:11.5px;line-height:1.38;color:var(--green-d,#0A5E37);font-style:italic;font-weight:600;border-left:2.5px solid #BFE0CD!important;border-radius:0 8px 8px 0;background:rgba(12,122,70,.045);}
.mm-sb-words:hover{background:rgba(12,122,70,.09);}
.mm-sb-prop{align-self:flex-start;font-size:10px;font-weight:800;color:var(--green-d,#0A5E37);background:var(--mint,#EAF6EF);border:1px solid #D4EBDD;border-radius:999px;padding:2px 8px;}
.mm-sb-reroll{position:absolute;top:6px;right:6px;width:30px;height:30px;border-radius:50%;border:0;background:rgba(10,20,15,.62);color:#fff;display:grid;place-items:center;cursor:pointer;opacity:.92;transition:background .14s;z-index:3;}
.mm-sb-reroll:hover:not(:disabled){background:var(--green,#0C7A46);}
.mm-sb-reroll:disabled{opacity:.4;cursor:default;}
.mm-sb-reroll svg{stroke:#fff;stroke-width:2;fill:none;}
/* ── Scene PRE-EDITOR: a 2-up GRID of REVIEWABLE cards (big still + editable text); the loading
     state reuses the Archive's rosette-green cook tile (.wb-cookimg/.wb-bufwrap/.wb-spin). ── */
.mm-sb-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:2px 0 4px;}
@media(min-width:640px){.mm-sb-list{grid-template-columns:repeat(3,minmax(0,1fr));}}
.mm-sc{display:flex;flex-direction:column;border:1.5px solid var(--line,#E4DFCF);border-radius:14px;background:#fff;overflow:hidden;box-shadow:0 1px 3px rgba(20,32,26,.06);}
.mm-sc.is-perform{border-color:#A6DCC0;}
.mm-sc.is-broll{border-color:#CBC6F2;}
.mm-sc-frame{position:relative;width:100%;aspect-ratio:4/5;background:#20302A;}
.mm-sc-frame img{width:100%;height:100%;object-fit:cover;display:block;}
.mm-sc-load{position:absolute;inset:0;}
.mm-sc .wb-cookimg{position:absolute;inset:0;width:100%;height:100%;aspect-ratio:auto;}
.mm-sc .wb-spin{width:52px;height:52px;}
.mm-sc .wb-bufwrap::before{width:118px;height:118px;}
.mm-sc-x{position:absolute;top:6px;right:6px;z-index:3;width:25px;height:25px;border-radius:50%;border:none;background:rgba(10,20,15,.6);color:#fff;font-size:13px;line-height:1;cursor:pointer;display:grid;place-items:center;transition:background .14s;}
.mm-sc-x:hover:not(:disabled){background:#B4463A;}
.mm-sc-x:disabled{display:none;}
.mm-sc .mm-sb-reroll{top:auto;bottom:6px;right:6px;width:28px;height:28px;}
.mm-sc-bd{display:flex;flex-direction:column;gap:5px;padding:8px 9px 9px;}
.mm-sc-num{font-size:12px;font-weight:800;color:var(--ink,#14201A);}
.mm-sc-type{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line,#E4DFCF);background:#F7FAF8;border-radius:999px;padding:3px 9px;font-size:11px;font-weight:700;color:var(--ink2,#4A554E);cursor:pointer;transition:background .14s,border-color .14s;}
.mm-sc-type:hover{background:#EEF6F1;border-color:#BFE0CD;}
.mm-sc-type svg{stroke:currentColor;stroke-width:2;fill:none;opacity:.5;}
.mm-sc-dot{width:8px;height:8px;border-radius:50%;flex:none;}
.is-perform .mm-sc-dot{background:#1EA85C;}
.is-broll .mm-sc-dot{background:#7F77DD;}
.mm-sc-what,.mm-sc-words{width:100%;display:block;box-sizing:border-box;border:1px solid #ECE7D9;border-radius:8px;background:#FCFBF7;resize:none;font-family:Poppins,sans-serif;padding:5px 8px;margin:0;cursor:text;transition:background .12s,border-color .12s,box-shadow .12s;}
.mm-sc-what:focus,.mm-sc-words:focus{outline:0;background:#fff;border-color:var(--green2,#1EA85C);box-shadow:0 0 0 2px rgba(12,122,70,.1);}
.mm-sc-what::placeholder,.mm-sc-words::placeholder{color:var(--ink3,#9AA39B);}
.mm-sc-what{font-size:12px;line-height:1.36;color:var(--ink,#14201A);font-weight:500;}
.mm-sc-words{font-size:12px;line-height:1.34;color:var(--green-d,#0A5E37);font-style:italic;font-weight:600;border-left:2.5px solid #BFE0CD;}
.mm-sc-note{font-size:11px;color:var(--ink2,#55605A);background:#F3F1FB;border:1px solid #E3DFF6;border-radius:8px;padding:5px 8px;line-height:1.34;}
.mm-sc-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px;}
.mm-sc-chip{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;border-radius:999px;padding:2px 8px 2px 3px;border:1px solid;}
.mm-sc-chip img{width:17px;height:17px;border-radius:50%;object-fit:cover;flex:none;}
.mm-chip-av{background:#EAF2FB;border-color:#D4E4F5;color:#1A4E85;}
.mm-chip-pr{background:#F0F8F3;border-color:#CFE8DB;color:#0A5E37;padding-left:8px;}
.mm-sc-add{width:100%;display:flex;align-items:center;justify-content:center;gap:6px;font-size:13px;font-weight:800;color:var(--green,#0C7A46);background:#fff;border:1.5px dashed #BFE0CD;border-radius:13px;padding:11px;margin-top:3px;cursor:pointer;transition:background .14s;}
.mm-sc-add:hover{background:#F0F8F3;}
/* Loading as a PROCESS: determinate bar + scene N of M + ETA (replaces the all-at-once "sketching"). */
.mm-sb-prog{background:#fff;border:1.5px solid var(--line,#E4DFCF);border-radius:14px;padding:13px 14px;margin:10px 0 4px;box-shadow:0 1px 2px rgba(20,32,26,.04);}
.mm-sb-prog-top{display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:800;color:var(--ink,#14201A);}
.mm-sb-prog-spin{display:inline-block;width:13px;height:13px;border:2px solid #C7E3D3;border-top-color:var(--green,#0C7A46);border-radius:50%;vertical-align:-2px;margin-right:6px;animation:fsspin .8s linear infinite;}
@keyframes fsspin{to{transform:rotate(360deg)}}
.mm-sb-prog-eta{font-size:12px;font-weight:600;color:var(--ink3,#9AA39B);}
.mm-sb-prog-track{height:7px;background:#EEF3F0;border-radius:5px;margin:10px 0 7px;overflow:hidden;}
.mm-sb-prog-fill{height:100%;background:var(--green,#0C7A46);border-radius:5px;transition:width .4s ease;min-width:4px;}
.mm-sb-prog-step{font-size:12px;color:var(--ink2,#55605A);font-weight:600;}
.mm-sb-busy{position:absolute;inset:0;background:rgba(10,20,15,.55);display:grid;place-items:center;z-index:2;}
.mm-sb-spin{width:28px;height:28px;border-radius:50%;border:3px solid rgba(255,255,255,.3);border-top-color:#fff;animation:mm-sb-rot .8s linear infinite;}
@keyframes mm-sb-rot{to{transform:rotate(360deg)}}
.mm-gen{margin:18px 0 0;background:var(--panel,#FDFBF4);border:1.5px solid transparent;border-radius:20px;padding:18px;box-shadow:0 0 0 1.5px var(--green,#0C7A46),0 22px 48px -26px rgba(12,122,70,.5);}
/* the combined MAKE + GENERATE final step box */
.mm-makegen{display:flex;flex-direction:column;gap:12px;}
.mm-makegen-h{font-size:13px;font-weight:800;color:var(--ink,#14201A);letter-spacing:-.01em;}
.mm-makegen .mm-preview-btn{width:100%;justify-content:center;padding:13px 16px;font-size:14px;}
.mm-makegen .mm-eta,.mm-makegen .mm-note{margin-top:0;}
.mm-go{position:relative;overflow:hidden;width:100%;display:inline-flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,#0C7A46,#15B165 55%,#1EA85C);color:#fff;border:0;border-radius:15px;padding:16px;font-family:Poppins,sans-serif;font-weight:800;font-size:16.5px;letter-spacing:-.01em;cursor:pointer;box-shadow:0 14px 30px -14px rgba(12,122,70,.7),inset 0 1px 0 rgba(255,255,255,.25);}
.mm-go:disabled{filter:grayscale(.55) brightness(.9);opacity:.75;cursor:default;box-shadow:none;}
.mm-go svg{stroke:#fff;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;}
.mm-go::after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.45),transparent);transform:skewX(-18deg);animation:mm-sheen 4.5s ease-in-out infinite;}
.mm-go:disabled::after{display:none;}
@keyframes mm-sheen{0%,58%{left:-60%}80%,100%{left:130%}}
.mm-eta{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:12px;font-size:13px;font-weight:700;color:var(--ink2,#4A554E);}
.mm-eta b{color:var(--ink,#14201A);}
.mm-note{text-align:center;font-size:12.5px;color:var(--ink2,#4A554E);margin-top:8px;}
.mm-note-req{display:flex;align-items:center;justify-content:center;gap:7px;text-align:center;font-size:12.5px;font-weight:700;color:var(--green-d,#0A5E37);background:rgba(12,122,70,.07);border:1px solid #CDE8D9;border-radius:11px;padding:10px 13px;margin-top:0;}
.mm-note-req svg{stroke:var(--green,#0C7A46);stroke-width:2;fill:none;flex:none;}
@media (prefers-reduced-motion:reduce){.mm-go::after{animation:none;}.mm-card{transition:none;}}
`;
