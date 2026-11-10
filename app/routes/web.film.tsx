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
  const { LIVE_FILM_TEMPLATES } = await import("../lib/film-engine.server");
  const templates = LIVE_FILM_TEMPLATES.map((t) => ({
    key: t.key, name: t.name, brief: t.brief, defaultScenes: t.defaultScenes, minScenes: t.minScenes, maxScenes: t.maxScenes, needsProduct: !!t.needsProduct, dialogue: !!t.dialogue,
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
    // Swappable render engine (Test Movie): Kling 3 Omni is the DEFAULT (owner A/B win —
    // cheaper, quality held); "veo" switches to premium Veo 3. Only Test Movie reads it.
    const dialogueEngine = ((form.get("dialogueEngine") as string) || "").trim() === "veo" ? "veo" : "kling3";
    const filmAspectRaw = ((form.get("filmAspect") as string) || "").trim();
    const filmAspect = filmAspectRaw === "16:9" || filmAspectRaw === "1:1" ? filmAspectRaw : "9:16";
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

type Scene = { visual: string; caption?: string; where?: string; shot?: string; tone?: string };
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
  const [filmAspect, setFilmAspect] = useState<"9:16" | "16:9" | "1:1">("9:16");
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
          {portraitFetcher.data?.error && <p className="fs-err">{portraitFetcher.data.error}</p>}
        </div>
        );
      })()}

      {/* Step 3 — generate (the only paid step) */}
      <div className="fs-card fs-go-card">
        <div className="fs-lbl"><span className="fs-n">3</span> {t("Generate")}</div>
        {/* Test Movie only: choose which engine renders the spoken dialogue. */}
        {isStoryboard && (
          <div className="fs-engine" role="group" aria-label={t("Render engine")}>
            <span className="fs-engine-cap">{t("Render engine")}</span>
            <div className="fs-engine-seg">
              <button type="button" className={`fs-engine-opt${dialogueEngine === "veo" ? " on" : ""}`}
                aria-pressed={dialogueEngine === "veo"} onClick={() => setDialogueEngine("veo")}>
                {t("Veo 3")}<small>{t("premium")}</small>
              </button>
              <button type="button" className={`fs-engine-opt${dialogueEngine === "kling3" ? " on" : ""}`}
                aria-pressed={dialogueEngine === "kling3"} onClick={() => setDialogueEngine("kling3")}>
                {t("Kling 3")}<small>{t("cheaper · default")}</small>
              </button>
            </div>
            <p className="fs-engine-note">{t("Same film, different AI. Run both and compare — each is tagged by model in your Archive.")}</p>
          </div>
        )}
        {isStoryboard && (
          <div className="fs-engine" role="group" aria-label={t("Aspect ratio")}>
            <span className="fs-engine-cap">{t("Shape")}</span>
            <div className="fs-engine-seg">
              <button type="button" className={`fs-engine-opt${filmAspect === "9:16" ? " on" : ""}`}
                aria-pressed={filmAspect === "9:16"} onClick={() => setFilmAspect("9:16")}>
                {t("Vertical")}<small>{t("9:16 · TikTok")}</small>
              </button>
              <button type="button" className={`fs-engine-opt${filmAspect === "16:9" ? " on" : ""}`}
                aria-pressed={filmAspect === "16:9"} onClick={() => setFilmAspect("16:9")}>
                {t("Wide")}<small>{t("16:9 · YouTube")}</small>
              </button>
              <button type="button" className={`fs-engine-opt${filmAspect === "1:1" ? " on" : ""}`}
                aria-pressed={filmAspect === "1:1"} onClick={() => setFilmAspect("1:1")}>
                {t("Square")}<small>{t("1:1 · feed")}</small>
              </button>
            </div>
            <p className="fs-engine-note">{t("Vertical for Shorts & Reels; Wide for YouTube, TV episodes and roomier multi-character scenes.")}</p>
          </div>
        )}
        <Form method="post">
          <input type="hidden" name="intent" value="film" />
          <input type="hidden" name="template" value={template} />
          {isStoryboard && <input type="hidden" name="dialogueEngine" value={dialogueEngine} />}
          {isStoryboard && <input type="hidden" name="filmAspect" value={filmAspect} />}
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
/* Cinematic hero — a dark "movie theatre" band with a gold spotlight + underline. */
/* Green hero band — SOFTENED so it sits in the page (light shadow + a crisp inner
   edge + slimmer) instead of a floating slab. Gold rosette, the still bleeds in. */
.fs-head{position:relative;z-index:1;border-radius:18px;padding:20px 24px;margin-bottom:14px;min-height:130px;display:flex;align-items:center;}
.fs-head-bg{position:absolute;inset:0;z-index:0;border-radius:18px;overflow:hidden;background:radial-gradient(135% 130% at 8% -25%,#38815C 0%,#265F45 46%,#1C4E33 100%);box-shadow:0 8px 22px rgba(11,20,15,.16),inset 0 0 0 1px rgba(255,255,255,.1);}
.fs-head-rose{position:absolute;background:center/contain no-repeat;mix-blend-mode:screen;pointer-events:none;will-change:transform;}
.fs-head-rose.b{left:-130px;bottom:-170px;width:350px;height:350px;background-image:url(/gstyle-rosette.svg);opacity:.3;animation:fsspinB 115s linear infinite;}
@keyframes fsspinB{to{transform:rotate(-360deg);}}
.fs-head-media{position:absolute;right:0;top:0;bottom:0;width:54%;-webkit-mask-image:linear-gradient(90deg,transparent,#000 44%);mask-image:linear-gradient(90deg,transparent,#000 44%);}
.fs-head-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;animation:fsstill .55s cubic-bezier(.2,.7,.2,1);}
@keyframes fsstill{from{opacity:0;transform:scale(1.06);}to{opacity:1;transform:scale(1);}}
.fs-head-copy{position:relative;z-index:1;flex:1 1 auto;min-width:0;max-width:52%;}
.fs-head-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:800;color:var(--fs-gold-lt,#E7C879);text-transform:uppercase;letter-spacing:.08em;}
.fs-head-copy b{display:block;font-family:Poppins,sans-serif;font-weight:800;font-size:26px;letter-spacing:-.02em;color:#fff;margin-top:7px;line-height:1.1;animation:fsFadeUp .45s cubic-bezier(.2,.7,.2,1);}
@keyframes fsFadeUp{from{opacity:0;transform:translateY(7px);}to{opacity:1;transform:translateY(0);}}
.fs-head-copy>span{display:block;font-size:13px;color:rgba(255,255,255,.74);margin-top:7px;max-width:320px;line-height:1.5;}
.fs-beta{font-size:9.5px;font-weight:800;color:#2A1C00;background:linear-gradient(135deg,var(--fs-gold-lt),var(--fs-gold));border-radius:999px;padding:2px 8px;text-transform:uppercase;letter-spacing:.06em;box-shadow:0 2px 8px rgba(199,154,58,.35);}
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
/* Dialogue-engine picker (Test Movie only) — a compact segmented control. */
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
.fs-rface.on{border-color:var(--green,#0C7A46);box-shadow:0 0 0 2px rgba(12,122,70,.18);}
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
`;
