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

export const meta: MetaFunction = () => [{ title: "Film Studio · EASYMODE" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const { LIVE_FILM_TEMPLATES } = await import("../lib/film-engine.server");
  const templates = LIVE_FILM_TEMPLATES.map((t) => ({
    key: t.key, name: t.name, brief: t.brief, defaultScenes: t.defaultScenes, minScenes: t.minScenes, maxScenes: t.maxScenes, needsProduct: !!t.needsProduct,
  }));
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
  return json({
    tokens: tokensRemainingLive(shop.activePlan),
    hasPlan: !!shop.activePlan?.active,
    trialing: planTrialing(shop.activePlan),
    canFilm: capabilitiesFor(shop.activePlan).has("creatorvideo"),
    outputLang: normalizeContentLang(shop.contentLang),
    templates,
    products,
    gallery,
    voices: AVATAR_VOICES.map((v) => ({ id: v.id, label: v.label, blurb: v.blurb, gender: v.gender })),
    perScene: FILM_PER_SCENE,
    base: FILM_BASE,
  });
};

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
    try {
      const treatment = await previewFilmTreatment({ shopId: shop.id, template: tmpl.key, topic, sceneCount: scenes, contentLang: shop.contentLang, productTitle, productDescription });
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
      const portraitUrl = await renderActorPortrait(castDesc);
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

type Scene = { visual: string; caption?: string };
type Treatment = { title?: string; scenes: Scene[]; musicMood: string; cast?: string[] };
// A locked "actor": one character's reusable face + pinned voice, cast once and
// reused as the identity reference for every shot they appear in.
type CastMember = { name: string; desc: string; faceUrl: string | null; voiceId: string | null };

export default function FilmStudio() {
  const d = useLoaderData<typeof loader>();
  const t = useT();
  const nav = useNavigation();
  const actionData = useActionData<typeof action>() as { ok?: boolean; queued?: string; cost?: number; error?: string } | undefined;
  const treatmentFetcher = useFetcher<{ treatment?: Treatment; error?: string }>();
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
  const deriveCast = (tr2: Treatment): CastMember[] =>
    (Array.isArray(tr2.cast) ? tr2.cast : []).slice(0, 8).map((entry) => {
      const name = ((entry.split(/[,:—–-]/)[0] || entry).trim() || entry).slice(0, 60);
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
  const isStoryboard = template === "testmovie";
  const [topic, setTopic] = useState("");
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
  const pickCatalog = (idx: number) => {
    const p = d.products[idx];
    if (!p) return;
    setProdTitle(p.title || ""); setProdImage(p.imageUrl || ""); setProdDesc(p.description || "");
    setTreatment(null); setFrames([]); setCast([]);
  };
  const writeTreatment = () => {
    treatmentFetcher.submit(
      { intent: "previewFilmTreatment", template, filmTopic: topic, filmScenes: String(scenes), filmProductTitle: prodTitle, filmProductImageUrl: prodImage, filmProductDescription: prodDesc },
      { method: "post" }
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
    const styleRef = frames.slice(0, i).reverse().find(Boolean) || "";
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
      { intent: "previewFilmPortrait", castDesc: c.desc, castIndex: String(i) },
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

  return (
    <div className="fs-wrap">
      <style>{FS_STYLE}</style>

      <div className="fs-head">
        <span className="fs-head-bg" aria-hidden="true">
          <span className="fs-head-rose a" />
          <span className="fs-head-rose b" />
          <span className="fs-head-media">
            <img key={tmpl?.key} className="fs-head-img" src={`/landing/film-still-${tmpl?.key || "shortfilm"}.jpg?v=1`} alt=""
              onError={(e) => { const el = e.currentTarget; if (!el.dataset.fb) { el.dataset.fb = "1"; el.src = "/landing/film-hero.jpg?v=5"; } }} />
          </span>
        </span>
        <div className="fs-head-copy">
          <span className="fs-head-eyebrow"><Ico n="film" size={13} /> {t("Film Studio")} <span className="fs-beta">{t("new")}</span></span>
          <b key={tmpl?.key}>{tmpl?.name || t("Film Studio")}</b>
          <span>{t("Pick a format — we write it free, you only spend to render.")}</span>
        </div>
      </div>

      {/* Template row */}
      <div className="fs-tmpls">
        {d.templates.map((x) => (
          <button type="button" key={x.key} className={`fs-tmpl${template === x.key ? " on" : ""}`}
            aria-pressed={template === x.key} onClick={() => switchTemplate(x.key)}>
            <span className="fs-tmpl-ico" aria-hidden="true"><Ico n="film" size={20} /></span>
            <b>{t(x.name)}</b>
            <span className="fs-tmpl-sub">{t(x.brief)}</span>
          </button>
        ))}
        <div className="fs-tmpl soon" aria-hidden="true">
          <span className="fs-tmpl-ico"><Ico n="wand" size={20} /></span>
          <b>{t("TV Shows · Episodes")}</b>
          <span className="fs-tmpl-sub">{t("Coming next — talking characters + a recurring cast across episodes")}</span>
        </div>
      </div>

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
      <div className="fs-card">
        <div className="fs-lbl"><span className="fs-n">1</span> {tmpl?.needsProduct ? t("What's the gag?") : t("What's it about?")}</div>
        <textarea className="fs-ta" rows={3} value={topic} onChange={(e) => setTopic(e.target.value)}
          placeholder={tmpl?.needsProduct ? t("the joke, the vibe, who's in it… or leave blank and we'll write one") : t("a theme, a story, a mood… or leave blank and we'll surprise you")} maxLength={300} />
        <div className="fs-len">
          <span>{t("Scenes")}</span>
          <div className="fs-stepper">
            <button type="button" onClick={() => bump(-1)} disabled={scenes <= tmpl.minScenes} aria-label={t("Fewer scenes")}>−</button>
            <b>{scenes}</b>
            <button type="button" onClick={() => bump(1)} disabled={scenes >= tmpl.maxScenes} aria-label={t("More scenes")}>+</button>
          </div>
          <span className="fs-len-note">{t("≈ {sec}s · {n} AI clips", { sec: scenes * 5, n: scenes })}</span>
        </div>
      </div>

      {/* Step 2 — write the treatment FREE */}
      <div className="fs-card">
        <div className="fs-lbl"><span className="fs-n">2</span> {t("Write the treatment")} <span className="fs-free">{t("free")}</span></div>
        <p className="fs-hint">{t("We draft every scene + the hook. Read it, tweak the lines, re-roll — no tokens spent until you Generate.")}</p>
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
                  <input className="fs-scene-cap" value={s.caption || ""} onChange={(e) => editCaption(i, e.target.value)}
                    placeholder={t("on-screen line (optional)")} maxLength={80} />
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

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
                    <b className="fs-actor-name">{c.name}</b>
                    <span className="fs-actor-desc">{c.desc}</span>
                    <div className="fs-actor-voice">
                      <select aria-label={t("Voice for {name}", { name: c.name })} value={c.voiceId || ""} disabled={castingIndex !== null} onChange={(e) => setCastVoice(i, e.target.value)}>
                        <option value="">{t("Pick a voice")}</option>
                        {d.voices.map((v) => <option key={v.id} value={v.id}>{v.label} · {v.blurb}</option>)}
                      </select>
                      <button type="button" className="fs-voice-play" disabled={!c.voiceId} onClick={() => playVoice(c.voiceId)} aria-label={t("Hear this voice")} title={t("Hear this voice")}><Ico n="sound" size={14} /></button>
                    </div>
                    <div className="fs-actor-opts">
                      {c.faceUrl && <button type="button" className="fs-actor-recast" disabled={castingIndex !== null} onClick={() => makePortrait(i)}><Ico n="refresh" size={11} /> {t("Re-cast")}</button>}
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
          {portraitFetcher.data?.error && <p className="fs-err">{portraitFetcher.data.error}</p>}
        </div>
        );
      })()}

      {treatment && isStoryboard && (
        <div className="fs-card">
          <div className="fs-lbl"><span className="fs-n"><Ico n="camera" size={13} /></span> {t("Storyboard")} <span className="fs-free">{t("free")}</span></div>
          <p className="fs-hint">{t("Make the photo for each shot, refine it until it's right, then Generate. Every shot animates from the frame you lock — all right here, no jumping around.")}</p>
          <div className="fs-board">
            {treatment.scenes.map((s, i) => {
              const busy = framingIndex === i;
              const set = !!frames[i];
              return (
              <div className={`fs-shot${set ? " set" : ""}`} key={i}>
                <div className="fs-shot-frame">
                  {set
                    ? <img src={frames[i] as string} alt={t("Shot {n}", { n: i + 1 })} loading="lazy" />
                    : <span className="fs-shot-empty"><Ico n="camera" size={26} />{t("No photo yet")}</span>}
                  {busy && <span className="fs-shot-spin" aria-hidden="true" />}
                  <span className="fs-shot-tag">{set && <Ico n="check" size={11} />} {t("Shot {n}", { n: i + 1 })}</span>
                </div>
                <div className="fs-shot-main">
                  <textarea className="fs-shot-desc" rows={2} value={s.visual} onChange={(e) => editVisual(i, e.target.value)} maxLength={1500}
                    placeholder={t("Describe the shot — camera inside, the child in front, the figure at the window outside…")} />
                  {!set ? (
                    <button type="button" className="fs-shot-make" disabled={framingIndex !== null} onClick={() => makeFrame(i)}>
                      {busy ? <>… {t("Making the photo")}</> : <><Ico n="camera" size={14} /> {t("Make the photo")}</>}
                    </button>
                  ) : (
                    <>
                      <div className="fs-shot-refine">
                        <input className="fs-shot-edit" value={editDraft[i] || ""} disabled={framingIndex !== null} maxLength={300}
                          placeholder={t("Describe a change — make it night, add the mum at the window, make her face wrong…")}
                          onChange={(e) => setEditDraft((p) => ({ ...p, [i]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyEdit(i); } }} />
                        <button type="button" className="fs-shot-apply" disabled={framingIndex !== null || !(editDraft[i] || "").trim()} onClick={() => applyEdit(i)}>{busy ? "…" : t("Apply")}</button>
                      </div>
                      <button type="button" className="fs-shot-reroll" disabled={framingIndex !== null} onClick={() => makeFrame(i)}><Ico n="refresh" size={12} /> {t("Re-roll from the description")}</button>
                    </>
                  )}
                  <details className="fs-shot-own">
                    <summary>{t("Use an image I already made")}</summary>
                    {d.gallery.length > 0 ? (
                      <div className="fs-shot-gallery" role="list" aria-label={t("Your images")}>
                        {d.gallery.map((g) => (
                          <button type="button" role="listitem" key={g.id} className={`fs-gthumb${frames[i] === g.url ? " on" : ""}`}
                            disabled={framingIndex !== null} title={g.title || t("Use this image")} onClick={() => useFrameUrl(i, g.url)}>
                            <img src={g.url} alt={g.title || t("Your image")} loading="lazy" />
                            {frames[i] === g.url && <span className="fs-gthumb-chk" aria-hidden="true"><Ico n="check" size={12} /></span>}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="fs-gempty">{t("Images you make in Creator show up here to pick from.")}</p>
                    )}
                    <input className="fs-shot-url" type="url" maxLength={2000} defaultValue="" placeholder={t("…or paste an image URL")} onChange={(e) => useFrameUrl(i, e.target.value)} />
                  </details>
                </div>
              </div>
              );
            })}
          </div>
          {previewFrameFetcher.data?.error && <p className="fs-err">{previewFrameFetcher.data.error}</p>}
          <p className="fs-hint" style={{ margin: "12px 0 0" }}>{t("Shots you don't set auto-generate — just lock the ones that matter.")}</p>
        </div>
      )}

      {/* Step 3 — generate (the only paid step) */}
      <div className="fs-card fs-go-card">
        <div className="fs-lbl"><span className="fs-n">3</span> {t("Generate")}</div>
        <Form method="post">
          <input type="hidden" name="intent" value="film" />
          <input type="hidden" name="template" value={template} />
          <input type="hidden" name="filmTopic" value={topic} />
          <input type="hidden" name="filmScenes" value={String(scenes)} />
          {tmpl?.needsProduct && <input type="hidden" name="filmProductTitle" value={prodTitle} />}
          {tmpl?.needsProduct && <input type="hidden" name="filmProductImageUrl" value={prodImage} />}
          {tmpl?.needsProduct && <input type="hidden" name="filmProductDescription" value={prodDesc} />}
          {treatment && <input type="hidden" name="approvedTreatment" value={JSON.stringify(treatment)} />}
          {isStoryboard && frames.some(Boolean) && <input type="hidden" name="approvedFrames" value={JSON.stringify(frames)} />}
          {isStoryboard && cast.some((c) => c.faceUrl || c.voiceId) && <input type="hidden" name="cast" value={JSON.stringify(cast.map((c) => ({ name: c.name, faceUrl: c.faceUrl, voiceId: c.voiceId })))} />}
          <button type="submit" className="fs-go" disabled={!canGo}>
            {generating ? <>… {t("Starting your film")}</> : <><Ico n="film" size={16} /> {cost > 0 ? t("Generate {name} · {cost} Tokens", { name: t(tmpl?.name || "Film"), cost }) : t("Generate {name} · Free", { name: t(tmpl?.name || "Film") })}</>}
          </button>
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
    </div>
  );
}

const FS_STYLE = `
.fs-wrap{max-width:760px;margin:0 auto;--fs-gold:#C79A3A;--fs-gold-lt:#E7C879;}
/* ── EXPERIMENT (scoped to /web/film only): dark page canvas + lighter gold
      ambient rosettes. Reverts the moment you leave the Film page. ── */
.wb{background:radial-gradient(72% 52% at 50% -8%,rgba(18,168,94,.16),transparent 62%),radial-gradient(54% 40% at 98% 64%,rgba(199,154,58,.12),transparent 68%),#0B140F !important;}
.wb::before{opacity:.22 !important;mix-blend-mode:screen;background-image:url(/gstyle-rosette.svg) !important;}
.wb::after{opacity:.16 !important;mix-blend-mode:screen;background-image:url(/gstyle-rosette.svg) !important;}
.wb-brand{color:#EBF2EC !important;}
.wb-tab{color:#AEBBB2 !important;}
.wb-tab:hover:not(.on){color:#fff !important;background:rgba(255,255,255,.07) !important;}
/* Cinematic hero — a dark "movie theatre" band with a gold spotlight + underline. */
/* Cinematic DARK hero, broken up + "leveled" with the app's own light rosettes so
   it belongs with the airy rest of the app. Holds a film still + the film Helpurr. */
.fs-head{position:relative;z-index:2;border-radius:22px;padding:24px 26px;margin-bottom:14px;min-height:152px;display:flex;align-items:center;}
/* dark bg + spinning rosettes + the bleeding still all clip to the rounded band */
.fs-head-bg{position:absolute;inset:0;z-index:0;border-radius:22px;overflow:hidden;background:radial-gradient(135% 130% at 8% -25%,#234735 0%,#14241A 46%,#0A130E 100%);box-shadow:0 22px 54px rgba(11,20,15,.42),inset 0 1px 0 rgba(255,255,255,.08);}
.fs-head-rose{position:absolute;background:center/contain no-repeat;mix-blend-mode:screen;pointer-events:none;will-change:transform;}
.fs-head-rose.a{right:-120px;top:-150px;width:400px;height:400px;background-image:url(/gstyle-rosette.svg);opacity:.34;animation:fsspinA 80s linear infinite;}
.fs-head-rose.b{left:-140px;bottom:-180px;width:360px;height:360px;background-image:url(/gstyle-rosette.svg);opacity:.32;animation:fsspinB 115s linear infinite;}
@keyframes fsspinA{to{transform:rotate(360deg);}}
@keyframes fsspinB{to{transform:rotate(-360deg);}}
/* the still bleeds in from the right and fades into the dark — woven in, not pasted */
.fs-head-media{position:absolute;right:0;top:0;bottom:0;width:56%;-webkit-mask-image:linear-gradient(90deg,transparent,#000 44%);mask-image:linear-gradient(90deg,transparent,#000 44%);}
.fs-head-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;animation:fsstill .55s cubic-bezier(.2,.7,.2,1);}
@keyframes fsstill{from{opacity:0;transform:scale(1.06);}to{opacity:1;transform:scale(1);}}
.fs-head-copy{position:relative;z-index:1;flex:1 1 auto;min-width:0;max-width:52%;}
.fs-head-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:800;color:var(--fs-gold-lt,#E7C879);text-transform:uppercase;letter-spacing:.08em;}
.fs-head-copy b{display:block;font-family:Poppins,sans-serif;font-weight:800;font-size:27px;letter-spacing:-.02em;color:#fff;margin-top:8px;line-height:1.1;animation:fsFadeUp .45s cubic-bezier(.2,.7,.2,1);}
@keyframes fsFadeUp{from{opacity:0;transform:translateY(7px);}to{opacity:1;transform:translateY(0);}}
.fs-head-copy>span{display:block;font-size:13px;color:rgba(255,255,255,.74);margin-top:8px;max-width:320px;line-height:1.5;}
.fs-beta{font-size:9.5px;font-weight:800;color:#2A1C00;background:linear-gradient(135deg,var(--fs-gold-lt),var(--fs-gold));border-radius:999px;padding:2px 8px;text-transform:uppercase;letter-spacing:.06em;box-shadow:0 2px 10px rgba(199,154,58,.4);}
.fs-head-cat{position:absolute;z-index:3;right:16px;bottom:-22px;width:98px;height:auto;filter:drop-shadow(0 12px 18px rgba(0,0,0,.48));pointer-events:none;}
.fs-tmpls{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0 6px;}
.fs-tmpl{flex:1 1 200px;min-width:0;text-align:left;border:1px solid var(--line,#E4DFCF);background:linear-gradient(180deg,#fff,#FCFAF3);border-radius:18px;padding:15px 16px 14px;cursor:pointer;transition:transform .18s cubic-bezier(.2,.7,.2,1),box-shadow .18s,border-color .18s;display:block;box-shadow:0 1px 2px rgba(20,32,26,.04);}
.fs-tmpl:hover{transform:translateY(-4px);box-shadow:0 16px 32px rgba(20,32,26,.14);border-color:var(--green2,#1FA463);}
.fs-tmpl.on{border-color:var(--green,#0C7A46);box-shadow:0 0 0 1.5px var(--green,#0C7A46),0 16px 32px rgba(12,122,70,.18);background:linear-gradient(180deg,#fff,#F2FAF5);}
.fs-tmpl.soon{opacity:.5;cursor:default;}
.fs-tmpl.soon:hover{transform:none;box-shadow:0 1px 2px rgba(20,32,26,.04);border-color:var(--line,#E4DFCF);}
.fs-tmpl-ico{display:inline-grid;place-items:center;width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--green,#0C7A46),var(--green2,#1FA463));color:#fff;margin-bottom:10px;box-shadow:0 5px 14px rgba(12,122,70,.3);}
.fs-tmpl.on .fs-tmpl-ico{box-shadow:0 5px 16px rgba(12,122,70,.45);}
.fs-tmpl b{font-family:Poppins,sans-serif;font-weight:800;font-size:15px;color:var(--ink,#14201A);display:block;}
.fs-tmpl-sub{display:block;font-size:12px;color:var(--ink2,#4A554E);margin-top:3px;line-height:1.4;}
.fs-card{background:linear-gradient(180deg,#fff,#FDFCF8);border:1px solid var(--line,#E4DFCF);border-radius:20px;padding:18px 20px;margin:14px 0;box-shadow:0 2px 4px rgba(20,32,26,.03),0 14px 32px rgba(20,32,26,.05);}
.fs-go-card{border-color:transparent;box-shadow:0 0 0 1.5px var(--green,#0C7A46),0 18px 40px rgba(12,122,70,.12);}
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
@media(max-width:640px){.fs-head{padding:20px;min-height:140px;}.fs-head-copy{max-width:64%;}.fs-head-copy b{font-size:22px;}.fs-head-media{width:50%;}.fs-head-cat{width:78px;right:8px;bottom:-16px;}.fs-tmpl{flex:1 1 100%;}.fs-shot{flex-direction:column;}.fs-shot-frame{width:100%;max-width:160px;align-self:center;}}
`;
