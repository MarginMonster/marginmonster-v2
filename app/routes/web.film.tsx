/* Film Studio — EasyMode's premium long-form tier. Music Video + Kids Cartoon +
 * Skit (members of the shared Film engine). Flow: pick a template → (Skit: pick
 * your product) → write the treatment FREE (no tokens) → read/edit/Randomize →
 * see the live per-scene cost → Generate. Metered by scene count (plan-config.
 * estimateFilmTokens — the SAME function quotes and charges). Gated at
 * "creatorvideo" (all plans). */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction, type SerializeFrom } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigate, useNavigation } from "@remix-run/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { lookLabel } from "../lib/avatar-looks";
import { createPortal } from "react-dom";
import { Ico } from "../lib/icons";
import { useT } from "../lib/ui-lang";
import { estimateSpeakSeconds, clipFill, secondsLabel, CLIP_MAX_SECONDS, TYPICAL_SHOT_SECONDS } from "../lib/speech-meter";
import { requireWebIdentity } from "../lib/web-auth.server";
import { readUiLang, tr } from "../lib/ui-i18n";
import { CONTENT_LANG_NATIVE, askedContentLang, normalizeContentLang } from "../lib/content-lang";
import { LangToggle } from "../components/LangToggle";
import { db } from "../db.server";
import { isAdminEmail } from "../lib/admin.server";
import { planTrialing, refundTokens, spendTokens, tokensRemainingLive } from "../lib/tokens.server";
import { capabilitiesFor } from "../lib/capabilities.server";
import { enqueueJob } from "../lib/job-queue.server";
import { estimateFilmTokens, FILM_PER_SCENE, FILM_BASE } from "../lib/plan-config";
import { externalOrigin } from "../lib/origin.server";
import { AVATAR_VOICES, AVATAR_VOICE_IDS, autoCastVoices } from "../lib/avatar-voice-catalog";
import { CHARACTER_VOICES, characterVoice, characterVoiceSample, isCharacterVoice } from "../lib/character-voices";
import { GENRE_PACE, MV_DEFAULT_SECONDS, MV_MAX_SECONDS, MV_SECONDS, PACES, PACE_KEYS, cutCount, defaultRole, isPace, lengthLabel, mvBillScenes, paceFor, sceneCountFor, sceneSecondsFor, sceneSecondsOf, shotSlot, type Pace } from "../lib/mv-pace";
import { MAX_COSTARS, sceneCast, singerOf } from "../lib/mv-cast";
import { FEATURE_MIN_SECONDS } from "../lib/mv-feature";
import type { Recast } from "../lib/mv-recast";
import { MV_DRAFT_KEY, draftScenes, packDraft, readDraft, type MvDraft } from "../lib/mv-draft";
import { FILM_HEROES, heroById, heroesFor } from "../lib/film-heroes";
import { CAPTION_STYLES, captionStyleOf, entryName, namedIn, type CaptionStyle } from "../lib/narrated-core";
import { DESIGNED_VOICES, LIVE_AVATARS, OUTFITS, STOCK_CHARACTERS, avatarImg, type Avatar } from "../lib/avatars";
import { stockCut, stockLooks, stockSpin, type Spin } from "../lib/presenter-kits";
import { CastFigure, CastHoverCard, CastIdCard, CAST_ID_CSS, castAgeText, castSentence, idCardOf, useCastPeek, type CastCardSource } from "../components/CastIdCard";
import { SPIN_STAGE_CSS } from "../components/SpinStage";
import { useModalA11y } from "../lib/use-modal-a11y";
import { favouritesFirst } from "../lib/favourites";
import { nameTok } from "../lib/character-prompts";
// (2026-11-24) the slate that claps when a film is sent off
import { slateTitle } from "../lib/film-slate";
// (2026-11-24) an acted film made in one press is cast with the people picked on the Cast card
import { pickedAsCast } from "../lib/dialogue-cast";
// (2026-11-24) the posters stand on three shelves: told · acted · sung
import { heroShelves } from "../lib/film-heroes";
// (2026-11-24) THE LYRIC VIDEO: a member's own song, its words on screen — a poster on the sung shelf, its own builder
import { LYRIC_HERO } from "../lib/film-heroes";
// (2026-11-24) FOUND FOOTAGE has its own builder (web.found-footage.tsx): a door to it on the Films shelf, operators only
import { FOUND_FOOTAGE_DOOR } from "../lib/film-heroes";
import { LYRIC_LOOKS, RIGHTS_ASK, RIGHTS_LINE, RIGHTS_NOTE, lyricEtaMinutes, songTitleOf, type LyricLook, type LyricShape } from "../lib/lyric-video";
import { castFromJobPayloads, episodeCardFor, latestEpisode, nextEpisodeCards, seriesBriefOf, seriesKeyOf, type NextEpisodeCard, type SeriesBrief } from "../lib/film-series";
import type { StoryToEdit } from "../lib/story-edit";
import { editCarryFor, storyToEdit } from "../lib/story-edit.server";
// (2026-11-23) a story's pictures move — what that takes is said beside Generate
import { storyPicturesOf, storyTypicalSeconds, type StoryPictures } from "../lib/story-motion";
import { IDEA_MAX } from "../lib/premise-rules";
import { storyMotionOn } from "../lib/story-motion.server";
// (2026-11-23) THE STORY'S OWN CAST: a portrait for every character a story invents — shown, and kept
import { castCardsOf, castToken, keepGuess, placesOf, readCastToken, type StoryCastRef } from "../lib/story-picture";
// (2026-11-24) KEEP IN MY CAST: a story's own character joins the maker's cast — the one character dialog
import { CharacterForge, FORGE_CSS, type ForgeSeed } from "../components/CharacterForge";
import { VOICE_UI_CSS } from "../components/VoicePicker";
// (2026-11-24) LIGHT BY DEFAULT, DARK BY CHOICE: the Movie Maker's dark side is a movie theater (FS_THEATER)
import { themeOf } from "../lib/theme";
import { useTheme } from "../lib/use-theme";
// (2026-11-24) THE SHELL'S OWN DARK — what any page that is dark under the theme mounts while it is dark —
// is shared (lib/theater-shell.ts); this page's own dark rules (FS_THEATER) follow it in the same <style>
import { THEATER_SHELL_CSS } from "../lib/theater-shell";
// (2026-11-25) THE GENRES ARE MOVIE CATEGORIES — each genre's own places for a scene (the page kept three lists
// of its own; there are eleven genres now, and the table is film-genres.ts) — and its starter ideas, dealt
// under the idea box so the writer is never handed nothing (the film kit's StarterNudges)
import { backdropsOf, dealStarters } from "../lib/film-genres";
import { StarterNudges } from "../components/film/StarterNudges";
import { FILM_KIT_CSS } from "../components/film/film-kit-style";

// (theme-color: in the DARK theme the Movie Maker is a theater — FS_THEATER, at the foot of this file — and
//  a phone's own bar goes dark with it instead of framing it in white. The shell's loader knows the theme.)
export const meta: MetaFunction = ({ matches }) => {
  const shell = matches.find((m) => m.id === "routes/web")?.data as { theme?: unknown } | undefined;
  return [{ title: "Movie Maker · EasyMode" }, ...(themeOf(shell?.theme) === "dark" ? [{ name: "theme-color", content: "#0A1C13" }] : [])];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, account } = await requireWebIdentity(request);
  const { LIVE_FILM_TEMPLATES, GENRES, PROPS } = await import("../lib/film-engine.server");
  const templates = LIVE_FILM_TEMPLATES.map((t) => ({
    key: t.key, name: t.name, brief: t.brief, defaultScenes: t.defaultScenes, minScenes: t.minScenes, maxScenes: t.maxScenes, needsProduct: !!t.needsProduct, dialogue: !!t.dialogue, lipSyncSinger: !!t.lipSyncSinger, cartoon: !!t.cartoon, sung: !!t.sung,
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
  const { customCastFor, stockVoicesFor, favouritesFor } = await import("../lib/custom-avatars.server");
  const custom = await customCastFor(shop.id);
  // the presenters and characters this shop starred (Presenters → ☆) lead the roster
  const favs = await favouritesFor(shop.id);
  // A stock presenter the shop gave a voice of its own (Presenters → open one → Voice) brings that
  // voice into the part, exactly like a custom presenter does; otherwise the film auto-casts a voice.
  const stockVoice = await stockVoicesFor(shop.id);
  // `kind` — a person, or one of the stock CHARACTERS (cartoon characters, monsters). The characters
  // are offered only where a character belongs: the cast step of the story formats (see rosterFor).
  // `sing` — can this one be given a FEATURED VERSE in a music video (sing part of the song in their own
  // voice)? A built-in presenter can: they were cast with a voice. One of the shop's own can if a voice
  // was picked for them. Only a yes/no goes to the page — WHICH voice is decided on the server when the
  // video is made (mv-voices.server.ts).
  const { builtInCanSing } = await import("../lib/mv-voices.server");
  // the looks saved for this shop's presenters (outfits made in the wardrobe, here or on another device)
  const { avatarLooksFor } = await import("../lib/avatar-looks.server");
  const savedLooks = await avatarLooksFor(shop.id);
  // the shop's own cloned voices ("My voices") — offered in the cast's voice menu above the stock ones
  const myVoices = await (await import("../lib/voice-clone.server")).shopVoiceClones(shop.id);
  // THE ID CARD of each built-in face (app/components/CastIdCard.tsx): what the Presenters section's card
  // says, from the same source — the cast's own record, the voice the shop gave them, their kit. Text and
  // counts only: no pictures but the cut-out, and of the turning figure only where its frames are (they
  // load when a card is shown, never before). A face the shop made itself has no card here.
  const cardOf = (a: Avatar): (Omit<CastCardSource, "id" | "name" | "kind" | "custom" | "signature"> & { signature: boolean; cut: string | null; spin: Spin | null }) => {
    const vid = stockVoice[a.id] || a.voiceId || "";
    const own = myVoices.find((v) => v.voiceId === vid);
    const outfits = Math.min(OUTFITS.length, stockLooks(a.id));
    return {
      vibe: a.vibe, about: castSentence(a.desc), age: castAgeText(a.desc), energy: a.energy,
      voice: own ? own.label : characterVoice(vid)?.label || AVATAR_VOICES.find((v) => v.id === vid)?.label || "",
      voiceOwn: !!own, signature: DESIGNED_VOICES.has(a.id),
      outfits: outfits + (savedLooks[a.id] || []).length,
      has3d: Array.from({ length: outfits }, (_, v) => stockSpin(a.id, v)).some(Boolean),
      cut: stockCut(a.id, 0), spin: stockSpin(a.id, 0),
    };
  };
  const roster = favouritesFirst([
    ...custom.filter((c) => !!c.img && c.status !== "failed").map((c) => ({ id: c.id, name: c.name, img: c.img, custom: true, gender: c.gender === "f" ? "f" : "m", voiceId: c.voiceId || null, sing: !!c.voiceId && !isCharacterVoice(c.voiceId), kind: (c.kind || "person") as "person" | "cartoon" | "monster", look: (c.desc || "").slice(0, 220), card: null })),
    ...LIVE_AVATARS.map((a) => ({ id: a.id, name: a.name, img: avatarImg(a.id, 0), custom: false, gender: a.gender, voiceId: stockVoice[a.id] || null, sing: builtInCanSing(a), kind: "person" as const, look: (a.desc || "").slice(0, 220), card: cardOf(a) })),
    ...STOCK_CHARACTERS.map((a) => ({ id: a.id, name: a.name, img: avatarImg(a.id, 0), custom: false, gender: a.gender, voiceId: stockVoice[a.id] || a.voiceId || null, sing: false, kind: (a.kind || "person") as "person" | "cartoon" | "monster", look: (a.desc || "").slice(0, 220), card: cardOf(a) })),
  ], favs).slice(0, 70);
  // NEXT EPISODE (film-series.ts): this shop's most recent finished STORY films — one per series, by its
  // latest episode — each with what its next episode is set up as. (Only this shop's own films.)
  const storyFilms = await db.asset.findMany({
    where: { shopId: shop.id, type: "VIDEO_AD", status: { not: "FAILED" }, OR: [{ metaJson: { contains: '"kind":"narrated"' } }, { metaJson: { contains: '"kind":"testmovie"' } }] },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, title: true, metaJson: true, bodyJson: true, createdAt: true },
  });
  const nextEpisodes = nextEpisodeCards(storyFilms, 3);
  // A FILM MADE BEFORE FILMS KEPT THEIR CAST (film-series.ts → castFromJobPayloads) opened its next episode
  // with nobody cast, so episode 2 was played by invented faces. The job that rendered it still holds who
  // the maker picked: this shop's own finished render jobs from the minutes around the film's creation.
  // Read-only, at most three small lookups, and only for those older films; any miss leaves it as it was.
  type StoryFilm = (typeof storyFilms)[number];
  const castBack = async (card: NextEpisodeCard, films: StoryFilm[]) => {
    if (card.setup.cast.length) return;
    const film = films.find((r) => r.id === card.from);
    if (!film) return;
    try {
      const at = film.createdAt.getTime();
      const jobs = await db.job.findMany({
        where: { shopId: shop.id, type: "GENERATE_VIDEO_AD", status: "COMPLETED", processedAt: { gte: new Date(at - 2 * 60_000), lte: new Date(at + 10 * 60_000) } },
        select: { payload: true },
        take: 6,
      });
      card.setup.cast = castFromJobPayloads(film, jobs.map((j) => j.payload));
    } catch { /* nobody cast, as before */ }
  };
  for (const card of nextEpisodes) await castBack(card, storyFilms);
  // "NEXT EPISODE", ASKED FROM A FILM ITSELF — the Archive viewer's button lands here with ?episode=<that
  // film's id> (film-series.ts → episodeCardFor). The card opened is the one for the LATEST episode of
  // that film's series, so asking from episode 1 when episode 2 exists makes episode 3. Only this shop's
  // own films are ever read; an id that is not one of them opens the page as usual.
  let openEpisode: NextEpisodeCard | null = null;
  const askedEpisode = (new URL(request.url).searchParams.get("episode") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  if (askedEpisode) {
    let rows: StoryFilm[] = storyFilms;
    if (!rows.some((r) => r.id === askedEpisode)) {
      // older than the newest thirty: the film itself, and whatever later episodes its series has
      const pick = { id: true, title: true, metaJson: true, bodyJson: true, createdAt: true } as const;
      const one = await db.asset.findFirst({ where: { id: askedEpisode, shopId: shop.id, type: "VIDEO_AD", status: { not: "FAILED" } }, select: pick });
      if (one) {
        const later = await db.asset.findMany({
          where: { shopId: shop.id, type: "VIDEO_AD", status: { not: "FAILED" }, id: { not: one.id }, metaJson: { contains: `"id":"${seriesKeyOf(one).replace(/[^A-Za-z0-9_-]/g, "")}"` } },
          orderBy: { createdAt: "desc" }, take: 12, select: pick,
        });
        rows = [...later, one];
      }
    }
    openEpisode = episodeCardFor(askedEpisode, rows);
    if (openEpisode) await castBack(openEpisode, rows);
  }
  // "EDIT STORY", ASKED FROM A FINISHED NARRATED STORY — the Archive viewer's button lands here with
  // ?edit=<its id> (story-edit.ts). The storyboard is handed that story's words and the pictures it was
  // made with; only this shop's own stories are ever read, and an id that is not one opens the page as usual.
  let openStory: StoryToEdit | null = null;
  const askedEdit = (new URL(request.url).searchParams.get("edit") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  if (askedEdit && !openEpisode) { try { openStory = await storyToEdit(shop.id, askedEdit, shop.contentLang); } catch { openStory = null; } }
  return json({
    tokens: tokensRemainingLive(shop.activePlan),
    roster,
    nextEpisodes,
    openEpisode,
    openStory,
    savedLooks,
    // A TRIAL, for the owner's account only (the owner, 2026-11-22: "test monsters in a music video"): a
    // monster can be cast as a music video's star or co-star. Nobody else is offered them there until a
    // finished video has been watched — the music video was built around a real-looking singer.
    mvCreatures: isAdminEmail(account.email),
    // THE LYRIC VIDEO (lyric-video.ts): operators only until the owner sets a price (api.lyric-video.tsx says so too)
    lyricVideo: isAdminEmail(account.email),
    // FOUND FOOTAGE's door (its builder, web.found-footage.tsx, is operators-only too — it 404s for anyone else)
    foundFootage: isAdminEmail(account.email),
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
    myVoices,
    perScene: FILM_PER_SCENE,
    base: FILM_BASE,
    // NARRATED stories: which formats can be told by a narrator, and how long one may be
    narratable: (await import("../lib/film-engine.server")).NARRATABLE_KEYS,
    narratedScenes: { min: 3, max: 12, def: 6 },
    // a story's pictures move (story-motion.ts) — the estimate beside Generate says what that takes
    storyMotion: storyMotionOn(),
    defaultNarrator: (await import("../lib/narrated-story.server")).DEFAULT_NARRATOR,
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
// Extra cast members (beyond the lead artist) sent from the Music Video builder. Images may be
// relative roster paths OR absolute uploads; the pipeline's abs() resolves them. Cap at 2 (3-ref limit).
function parseCastExtra(raw: string | null): Array<{ img: string; name: string }> | undefined {
  if (!raw) return undefined;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return undefined;
    const out = arr
      .filter((m) => m && typeof m.img === "string" && m.img.trim())
      .map((m) => ({ img: String(m.img).slice(0, 2000), name: String(m.name || "").slice(0, 40) }))
      .slice(0, 2); // 1 star + 2 co-stars = the 3-ref compositing max; more breaks the render
    return out.length ? out : undefined;
  } catch { return undefined; }
}

/** A FEATURED VERSE (Music Video): the co-stars who sing a verse of their own, by NAME. Two at most.
 *  (Only who — the voice each sings in is decided on the server: mv-voices.server.ts.) */
function parseFeature(raw: string | null): Array<{ name: string }> {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.name === "string" && x.name.trim())
      .map((x) => ({ name: String(x.name).trim().slice(0, 40) }))
      .slice(0, 2);
  } catch { return []; }
}

/** Per-scene cast (owner edit): scene index → the cast IMAGES featured in that scene. */
function parseCastForScene(raw: string | null): Record<number, string[]> | undefined {
  if (!raw) return undefined;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return undefined;
    const out: Record<number, string[]> = {};
    for (const k of Object.keys(o)) {
      const n = parseInt(k, 10);
      if (!Number.isFinite(n)) continue;
      out[n] = Array.isArray(o[k]) ? o[k].filter((x: unknown) => typeof x === "string").map((x: string) => x.slice(0, 2000)).slice(0, 3) : [];
    }
    return Object.keys(out).length ? out : undefined;
  } catch { return undefined; }
}

/** Wardrobe (owner edit): cast member IMG → an outfit description. */
function parseOutfits(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return undefined;
    const out: Record<string, string> = {};
    for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === "string" && v.trim()) out[k.slice(0, 2000)] = v.trim().slice(0, 160); }
    return Object.keys(out).length ? out : undefined;
  } catch { return undefined; }
}

/** The approved PICTURE of each picked outfit (cast member img → the picture of them wearing it), as the
 *  wardrobe row made it — they are styled from it, so the look that was tapped is the look that is worn.
 *  Only pictures on our own render disk count: whatever host an address names, it is read as a site path
 *  under /renders/, so nothing else can be fetched through it. At most four (a star and their co-stars). */
/** WHO IS IN A SCENE NOW, by name — sent by the scene's Cast editor so the scene's words can follow its
 *  cast (mv-recast.ts). A short list of short names, whatever was sent; anything else is no list at all. */
function parseSceneWho(raw: string | null): Recast | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { names?: unknown; lead?: unknown; wasLead?: unknown; beside?: unknown } | null;
    if (!o || typeof o !== "object") return null;
    const nm = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 40) : "");
    const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(nm).filter(Boolean).slice(0, 6) : []);
    const names = list(o.names);
    return names.length ? { names, lead: nm(o.lead), wasLead: nm(o.wasLead), beside: list(o.beside) } : null;
  } catch { return null; }
}

function parseOutfitImgs(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return undefined;
    const out: Record<string, string> = {};
    for (const k of Object.keys(o).slice(0, 4)) {
      const v = o[k];
      if (typeof v !== "string") continue;
      let p = "";
      try { p = new URL(v.trim(), "https://site.invalid").pathname; } catch { continue; }
      if (/^\/renders\/[\w.-]+\.(?:jpe?g|png|webp)$/i.test(p)) out[k.slice(0, 2000)] = p;
    }
    return Object.keys(out).length ? out : undefined;
  } catch { return undefined; }
}

/** The cast the maker PICKED for a story (before a word was written): who they are, their picture, what
 *  kind of character they are and what they look like. At most 4; a face must be a site path or http(s). */
type StoryCastIn = { name: string; faceUrl: string | null; kind: "person" | "cartoon" | "monster"; look: string; voiceId: string | null };
function parseStoryCast(raw: string | null): StoryCastIn[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    if (!Array.isArray(a)) return [];
    return a
      .filter((x) => x && typeof x.name === "string" && x.name.trim())
      .map((x) => {
        const face = typeof x.faceUrl === "string" && /^(https?:\/\/|\/)/i.test(x.faceUrl.trim()) ? x.faceUrl.trim().slice(0, 2000) : null;
        const kind: StoryCastIn["kind"] = x.kind === "cartoon" || x.kind === "monster" ? x.kind : "person";
        return { name: String(x.name).trim().slice(0, 40), faceUrl: face, kind, look: typeof x.look === "string" ? x.look.replace(/\s+/g, " ").trim().slice(0, 220) : "", voiceId: typeof x.voiceId === "string" && x.voiceId ? x.voiceId.slice(0, 80) : null };
      })
      .slice(0, 4);
  } catch { return []; }
}

/** NEXT EPISODE (film-series.ts): the series a story continues, from the film it was started from. The
 *  page sends only that film's id; everything else — the series, the episode number, the recap — is read
 *  here from the film's own row, and ONLY from this shop's own films. A film that has been deleted (or is
 *  another shop's, or another format's) means no series: an ordinary new film. */
async function seriesBriefFor(shopId: string, fromId: string, want: { template: string; narrated: boolean }): Promise<{ brief: SeriesBrief; /** the last episode's own cast, as a token (story-picture.ts) — "" when it kept none */ ownCast: string } | null> {
  const id = (fromId || "").trim().slice(0, 64);
  if (!id) return null;
  const pick = { id: true, title: true, metaJson: true, bodyJson: true } as const;
  const prev = await db.asset.findFirst({ where: { id, shopId, type: "VIDEO_AD" }, select: pick });
  if (!prev) return null;
  // (THE SERIES' OWN CAST: the characters the last episode invented come back with the portraits they were
  //  drawn from, so episode 2's watchman is episode 1's — read from that film's own row, never the page)
  // A SERIES NEVER FORKS. The page names the series' latest episode — but if an older one is named (a stale
  // tab, a hand-made request), the episode still continues from the LATEST finished one (film-series.ts →
  // latestEpisode). Only this shop's own films; a failed lookup continues from the film that was named.
  let from = prev;
  try {
    const later = await db.asset.findMany({
      where: { shopId, type: "VIDEO_AD", status: { not: "FAILED" }, id: { not: prev.id }, metaJson: { contains: `"id":"${seriesKeyOf(prev).replace(/[^A-Za-z0-9_-]/g, "")}"` } },
      orderBy: { createdAt: "desc" }, take: 12, select: pick,
    });
    from = latestEpisode(prev, [...later, prev]);
  } catch { /* continue from the film that was named */ }
  const brief = seriesBriefOf(from, want);
  return brief ? { brief, ownCast: want.narrated ? castToken(castCardsOf(from.metaJson), placesOf(from.metaJson)) : "" } : null;
}

/** The lead's gender (drives the sung voice + casting) and each named co-star's known gender. */
function parseArtistGender(raw: string | null): "m" | "f" | undefined { return raw === "f" ? "f" : raw === "m" ? "m" : undefined; }
function parseCastGenders(raw: string | null): Array<{ name: string; gender: "m" | "f" }> | undefined {
  if (!raw) return undefined;
  try {
    const a = JSON.parse(raw);
    if (!Array.isArray(a)) return undefined;
    const out = a.filter((x) => x && typeof x.name === "string" && (x.gender === "m" || x.gender === "f")).map((x) => ({ name: String(x.name).slice(0, 40), gender: x.gender as "m" | "f" })).slice(0, 4);
    return out.length ? out : undefined;
  } catch { return undefined; }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const lang = await readUiLang(request);
  const { shop, account } = await requireWebIdentity(request);
  const form = await request.formData();
  const intent = ((form.get("intent") as string) || "").trim();
  const { FILM_TEMPLATES, filmTemplate, previewFilmTreatment, canNarrate, clampNarrated } = await import("../lib/film-engine.server");

  // THE CAST CHECK, ASKED BY HAND — admin only, and it reads only pictures on our own render disk or among
  // the built-in avatars. The question the storyboard asks about a cast still, put to the same reader with
  // the same pictures: to explain a flag, or to try a change to the question on real stills before it
  // ships. Nothing is made, charged or saved.
  if (intent === "readCastStill") {
    if (!isAdminEmail(account.email)) return json({ error: "Not found" }, { status: 404 });
    const own = (v: unknown): string | null => {
      if (typeof v !== "string" || !v.trim()) return null;
      let p = "";
      try { p = new URL(v.trim(), "https://site.invalid").pathname; } catch { return null; }
      return /^\/(?:renders|avatars)\/[\w.-]+\.(?:jpe?g|png|webp)$/i.test(p) ? p : null;
    };
    const img = own(form.get("img"));
    let refs: string[] = [];
    try { const a = JSON.parse(((form.get("refs") as string) || "[]").trim()); if (Array.isArray(a)) refs = a.map(own).filter((x): x is string => !!x).slice(0, 3); } catch { /* no references */ }
    if (!img) return json({ error: "img must be a picture under /renders/ or /avatars/" }, { status: 400 });
    const { readCastStillByHand } = await import("../lib/music-video-pipeline.server");
    try {
      return json({ ok: true, img, refs, ...(await readCastStillByHand({ img, refs, prop: ((form.get("prop") as string) || "").trim().slice(0, 40) || undefined, question: ((form.get("question") as string) || "").trim() || undefined })) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message.slice(0, 200) : String(e) }, { status: 502 });
    }
  }

  if (!shop.activePlan?.active) return json({ error: tr(lang, "Pick a plan on the Dashboard first — film runs on tokens.") });
  if (!capabilitiesFor(shop.activePlan).has("creatorvideo")) {
    return json({ error: tr(lang, "Your plan doesn't include video yet — upgrade to make films.") });
  }

  // A FORMAT THAT IS NAMED MUST EXIST. filmTemplate() answers a key it does not know with the Music Video —
  // right for a page that sends none, wrong for one that sends a WRONG one: a one-press request for
  // "shortstory" (the hero's id on the page, not the engine's key) was taken on 2026-11-24 and a twenty-minute
  // music video nobody asked for was rendered from a story idea. A key that is not a format is refused.
  const templateKey = ((form.get("template") as string) || "").trim();
  if (templateKey && !Object.prototype.hasOwnProperty.call(FILM_TEMPLATES, templateKey)) {
    return json({ error: tr(lang, "That film format doesn't exist — pick one in the Movie Maker."), detail: `unknown template "${templateKey.slice(0, 40)}"` }, { status: 400 });
  }
  const tmpl = filmTemplate(templateKey || undefined);
  // (an idea is the member's whole story — it was cut at 300 characters, and a tester's came to the writer
  //  ending "…built around the roots of a big tr": IDEA_MAX, premise-rules.ts)
  const topic = ((form.get("filmTopic") as string) || "").trim().slice(0, IDEA_MAX);
  // NARRATED: a storyteller's voice over pictures instead of the cast acting it (story formats only).
  const narrated = ((form.get("filmMode") as string) || "").trim() === "narrated" && canNarrate(tmpl.key);
  // MUSIC VIDEO: the length is picked in seconds and the pace decides how long a scene is — 5 or 10
  // seconds (mv-pace.ts). Anything else, and every older form, is 10.
  const filmSceneSeconds = tmpl.lipSyncSinger ? sceneSecondsOf(((form.get("filmSceneSeconds") as string) || "").trim()) : 10;
  const maxScenes = tmpl.lipSyncSinger ? Math.min(tmpl.maxScenes, Math.floor(MV_MAX_SECONDS / filmSceneSeconds)) : tmpl.maxScenes;
  const clampScenes = (n: number) => (narrated ? clampNarrated(n) : Math.max(tmpl.minScenes, Math.min(maxScenes, Math.round(n || tmpl.defaultScenes))));
  // The cast the maker picked before the script was written (story formats).
  const storyCast = tmpl.lipSyncSinger ? [] : parseStoryCast(form.get("filmCast") as string);
  // THE LANGUAGE IT IS TOLD IN — the story formats' "Told in" (the account's content language, set from the
  // page as it is picked): sent with every write and with the render, so a story is never written in one
  // language and voiced in another while that setting is still on its way. Unknown or absent: the shop's.
  const askedLang = tmpl.lipSyncSinger || tmpl.sung ? null : askedContentLang(form.get("filmLang"));
  const writeLang = askedLang || shop.contentLang;
  // NEXT EPISODE: the series this story continues (story formats only — never a music video)
  const seriesFrom = ((form.get("seriesFrom") as string) || "").trim();
  const seriesHit = seriesFrom && tmpl.dialogue && !tmpl.lipSyncSinger && !tmpl.sung && (intent === "previewFilmTreatment" || intent === "previewFilmScenes" || intent === "film")
    ? await seriesBriefFor(shop.id, seriesFrom, { template: tmpl.key, narrated })
    : null;
  const series = seriesHit?.brief || null;
  // THE STORY'S OWN CAST as it comes in: what the page hands back (the storyboard's own portraits), else the
  // last episode's. Read through the token's own check — only portraits on our own renders disk survive it.
  const castRefIn = (name: string): string => { const t = readCastToken(((form.get(name) as string) || "").trim().slice(0, 4000)); return castToken(t.refs, t.places); };
  const seriesCastRef = seriesHit?.ownCast || "";

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
    let castNames: string[] | undefined;
    const castNamesRaw = ((form.get("filmCastNames") as string) || "").trim();
    if (castNamesRaw) { try { const a = JSON.parse(castNamesRaw); if (Array.isArray(a)) castNames = a.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 40)).slice(0, 4); } catch { /* ignore */ } }
    try {
      const args = { shopId: shop.id, template: tmpl.key, topic, sceneCount: scenes, sceneSeconds: filmSceneSeconds, contentLang: writeLang, productTitle, productDescription, genre, artistName, castNames, artistGender: parseArtistGender(form.get("filmArtistGender") as string), castGenders: parseCastGenders(form.get("filmCastGenders") as string), ...(tmpl.lipSyncSinger ? { featureNames: parseFeature(form.get("filmFeature") as string).map((f) => f.name) } : {}), ...(narrated ? { mode: "narrated" as const } : {}), ...(storyCast.length ? { cast: storyCast.map((c) => ({ name: c.name, desc: c.look, kind: c.kind })) } : {}), ...(series ? { series } : {}) };
      let treatment;
      // One more go before the maker is told it failed: the first write after a restart failed once on
      // the live site (2026-11-21) and the very same request then succeeded twelve times running.
      try { treatment = await previewFilmTreatment(args); }
      catch (first) {
        console.error(`[film] treatment write failed, trying once more: ${first instanceof Error ? first.message.slice(0, 200) : first}`);
        await new Promise((r) => setTimeout(r, 1200));
        treatment = await previewFilmTreatment(args);
      }
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
      const frameUrl = await previewFilmSceneFrame({ template: tmpl.key, sceneVisual, castText, styleRefUrl, castRefUrls, creatureCast: ((form.get("creatureCast") as string) || "") === "1" });
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

  // FREE — WARDROBE: generate the SAME avatar wearing a chosen outfit (identity locked). The merchant
  // saves it as that avatar's "style"; the picked outfit also rides the render as a description.
  // LOOKS THIS BROWSER MADE BEFORE LOOKS WERE KEPT ON THE PRESENTER (they lived in its storage only):
  // handed over once, so they show on the presenter's card too. Nothing is generated or charged.
  if (intent === "adoptOutfitLooks") {
    let list: unknown = [];
    try { list = JSON.parse(((form.get("looks") as string) || "[]").slice(0, 60_000)); } catch { /* nothing to adopt */ }
    const { saveAvatarLook } = await import("../lib/avatar-looks.server");
    const { LOOKS_PER_REQUEST } = await import("../lib/avatar-looks");
    let kept = 0;
    for (const x of (Array.isArray(list) ? list : []).slice(0, LOOKS_PER_REQUEST)) {
      const o = (x && typeof x === "object" ? x : {}) as { avatarId?: unknown; desc?: unknown; img?: unknown };
      if (await saveAvatarLook(shop.id, o.avatarId, o.desc, o.img)) kept++;
    }
    return json({ ok: true, kept });
  }
  if (intent === "styleOutfit") {
    const src = ((form.get("outfitImg") as string) || "").trim().slice(0, 2000);
    const desc = ((form.get("outfitDesc") as string) || "").trim().slice(0, 160);
    // WHO it is for (their id in the roster): the look is kept on that presenter
    const outfitAvatarId = ((form.get("outfitAvatarId") as string) || "").trim();
    if (!src || !desc) return json({ error: tr(lang, "Pick an avatar and an outfit first.") });
    try {
      const { editSubjectIntoScene } = await import("../lib/image-generation.server");
      const absSrc = /^https?:\/\//i.test(src) ? src : `${externalOrigin(request)}${src.startsWith("/") ? "" : "/"}${src}`;
      const img = await editSubjectIntoScene(absSrc, `Keep this EXACT person identical — same face, hair, skin, build and identity; do NOT swap them for a different person. Change ONLY their clothing: dress them in ${desc}. A clean waist-up portrait looking at camera, soft studio lighting, photorealistic, sharp detailed face, plain neutral background, no text, no watermark.`);
      if (!img) return json({ error: tr(lang, "Couldn't make that outfit — try another.") });
      // Archive the generated outfit so it's saved alongside the merchant's other work.
      try {
        await db.asset.create({ data: {
          shopId: shop.id, type: "IMAGE_AD", status: "PENDING",
          title: `Wardrobe — ${desc.slice(0, 50)}`,
          bodyJson: JSON.stringify({ imageUrl: img, url: img, style: "WARDROBE", outfit: desc }),
          metaJson: JSON.stringify({ kind: "wardrobe", section: "creator", outfit: desc.slice(0, 120) }),
        } });
      } catch { /* archive is best-effort — never fail the gen on it */ }
      // …and KEPT ON THE PRESENTER: it shows on their card in Presenters and is offered again wherever
      // they are dressed (avatar-looks.ts). A look that cannot be kept never costs the picture.
      if (outfitAvatarId) { const { saveAvatarLook } = await import("../lib/avatar-looks.server"); await saveAvatarLook(shop.id, outfitAvatarId, desc, img); }
      return json({ img: /^https?:\/\//i.test(img) ? img : `${externalOrigin(request)}${img.startsWith("/") ? "" : "/"}${img}` });
    } catch (e) {
      return json({ error: tr(lang, "Couldn't make that outfit — give it another go."), detail: e instanceof Error ? e.message.slice(0, 160) : String(e) });
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
    const castExtra = parseCastExtra(form.get("filmCastExtra") as string);
    const castForScene = parseCastForScene(form.get("filmCastForScene") as string);
    const outfits = parseOutfits(form.get("filmOutfits") as string);
    const outfitImgs = parseOutfitImgs(form.get("filmOutfitImgs") as string);
    const pvArtistName = ((form.get("filmArtistName") as string) || "").trim().slice(0, 60);
    let pvCastNames: string[] | undefined;
    const pvCastRaw = ((form.get("filmCastNames") as string) || "").trim();
    if (pvCastRaw) { try { const a = JSON.parse(pvCastRaw); if (Array.isArray(a)) pvCastNames = a.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 40)).slice(0, 4); } catch { /* ignore */ } }
    const filmAspect = ((form.get("filmAspect") as string) || "").trim();
    try {
      if (narrated) {
        // NARRATED: one picture a scene; picked cast are drawn from their own pictures.
        let tr0 = approvedTreatment as unknown as import("../lib/film-engine.server").FilmTreatment | undefined;
        if (!tr0) tr0 = await previewFilmTreatment({ shopId: shop.id, template: tmpl.key, topic, sceneCount: scenes, contentLang: writeLang, mode: "narrated", cast: storyCast.map((c) => ({ name: c.name, desc: c.look, kind: c.kind })), series });
        const { narratedSceneSeeds } = await import("../lib/narrated-story.server");
        // (the story's own cast is drawn here — a portrait each — unless it is the next episode of a series,
        //  which opens with the faces the last one had)
        const r = await narratedSceneSeeds({ template: tmpl.key, treatment: tr0, cast: storyCast, aspect: filmAspect, castRef: seriesCastRef || null });
        if (!r.sceneImgs.some(Boolean)) return json({ error: tr(lang, "Couldn't preview the scenes — try again in a moment.") });
        // (sceneFaults / sceneChecks: a picture kept with someone still missing is flagged on its card)
        return json({ ok: true, sceneImgs: r.sceneImgs, sceneFaults: r.sceneFaults, sceneChecks: r.sceneChecks, treatment: tr0, propForScene: {}, castRef: r.castRef, castCards: r.castCards });
      }
      if (tmpl.lipSyncSinger) {
        // Music Video engine: artist hero (merchant-picked avatar or auto-cast) + extra cast + props.
        const { previewMusicVideoScenes } = await import("../lib/music-video-pipeline.server");
        const r = await previewMusicVideoScenes({ shopId: shop.id, topic, genre, sceneCount: scenes, sceneSeconds: filmSceneSeconds, props: filmProps, customProps, heroUrl, castExtra, castForScene, outfits, outfitImgs, artistName: pvArtistName, castNames: pvCastNames, artistGender: parseArtistGender(form.get("filmArtistGender") as string), castGenders: parseCastGenders(form.get("filmCastGenders") as string), featureNames: parseFeature(form.get("filmFeature") as string).map((f) => f.name), aspect: filmAspect, treatment: approvedTreatment as unknown as Parameters<typeof previewMusicVideoScenes>[0]["treatment"] });
        const sceneImgs = (r.sceneImgs || []).map((u) => u || null);
        if (!sceneImgs.some(Boolean)) return json({ error: tr(lang, "Couldn't preview the scenes — try again in a moment.") });
        // sceneFaults: how each cast picture fared when it was looked at (0 = right, more = worth a re-roll)
        // sceneChecks: what the check read off each kept picture (null = it was not looked at)
        return json({ ok: true, sceneImgs, sceneFaults: r.sceneFaults, sceneChecks: r.sceneChecks, treatment: r.treatment, propForScene: r.propForScene, artistRef: r.artistRef, castRefs: r.castRefs });
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
    const castRef = ((form.get("castRef") as string) || "").trim().slice(0, 4000);
    const sceneVisual = ((form.get("sceneVisual") as string) || "").trim().slice(0, 1500);
    const sceneIndex = parseInt((form.get("sceneIndex") as string) || "0", 10) || 0;
    const propKey = ((form.get("propKey") as string) || "").trim() || undefined;
    const genre = ((form.get("filmGenre") as string) || "").trim();
    const rerollAspect = ((form.get("filmAspect") as string) || "").trim();
    let sceneCastRefs: string[] = [];
    const scrRaw = ((form.get("sceneCastRefs") as string) || "").trim();
    if (scrRaw) { try { const a = JSON.parse(scrRaw); if (Array.isArray(a)) sceneCastRefs = a.filter((x) => typeof x === "string").slice(0, 2); } catch { /* ignore */ } }
    const rerollCustomProps = parseCustomProps(form.get("filmCustomProps") as string);
    // The scene's CURRENT type + the video's scene count, so the re-roll frames the shot for what it is now.
    const rerollKindRaw = ((form.get("sceneKind") as string) || "").trim();
    const rerollKind = rerollKindRaw === "perform" || rerollKindRaw === "broll" ? rerollKindRaw : undefined;
    const rerollSceneCount = parseInt((form.get("sceneCount") as string) || "", 10) || undefined;
    // A featured verse: the co-star who LEADS this scene (their own performance), as their styled picture.
    const rerollLeadRef = ((form.get("sceneLeadRef") as string) || "").trim().slice(0, 2000) || undefined;
    if (!sceneVisual) return json({ error: tr(lang, "Preview the scenes first."), sceneIndex });
    try {
      let img: string | null = null;
      let faults: number | null = null;
      // what the check read off the picture (a music video's cast still) — null = it was not looked at
      let check: unknown = null;
      // the scene's words as they are drawn (rewritten below when its cast was just changed)
      let visualNow = sceneVisual;
      // a told story's own cast after this draw (a character first seen in THIS scene gets its portrait now)
      let ownCast: { castRef: string | null; castCards: StoryCastRef[] } | null = null;
      if (narrated) {
        // the scene as it reads NOW (the maker may have edited the words), drawn again on its own
        let scenesNow: Array<{ visual: string; caption?: string }> = [];
        let castBible: string[] = [];
        // (the story's PLACES ride with its treatment: a scene drawn again is set where it was — story-picture.ts)
        let placeBible: string[] = [];
        try { const tObj = JSON.parse(((form.get("approvedTreatment") as string) || "").trim() || "{}"); if (Array.isArray(tObj.scenes)) scenesNow = tObj.scenes; if (Array.isArray(tObj.cast)) castBible = tObj.cast.filter((x: unknown) => typeof x === "string"); if (Array.isArray(tObj.places)) placeBible = tObj.places.filter((x: unknown) => typeof x === "string").slice(0, 2); } catch { /* fall back to the one scene */ }
        if (!scenesNow[sceneIndex]) { scenesNow = []; scenesNow[sceneIndex] = { visual: sceneVisual }; for (let k = 0; k < sceneIndex; k++) scenesNow[k] = { visual: "" }; }
        else scenesNow[sceneIndex] = { ...scenesNow[sceneIndex], visual: sceneVisual };
        const { narratedSceneSeeds } = await import("../lib/narrated-story.server");
        const r = await narratedSceneSeeds({ template: tmpl.key, treatment: { title: "", musicMood: "", cast: castBible, places: placeBible, scenes: scenesNow.map((x) => ({ visual: String(x?.visual || ""), caption: String(x?.caption || "") })) }, cast: storyCast, aspect: rerollAspect, only: sceneIndex, castRef: castRef || null });
        img = r.sceneImgs[sceneIndex] || null;
        ownCast = { castRef: r.castRef, castCards: r.castCards };
        faults = r.sceneFaults[sceneIndex] ?? null; check = r.sceneChecks[sceneIndex] ?? null;
      } else if (tmpl.lipSyncSinger) {
        if (!artistRef) return json({ error: tr(lang, "Preview the scenes first."), sceneIndex });
        // THE WORDS FOLLOW THE CAST (mv-recast.ts): the scene's Cast editor says who is in the scene now.
        // Words that would be wrong for them — another lead, or the name of someone who has left it — are
        // rewritten first; the picture is drawn from the NEW words, and they go back to the card.
        const who = parseSceneWho(form.get("sceneWho") as string);
        if (who) {
          const { recastSceneText } = await import("../lib/mv-recast.server");
          const rc = await recastSceneText(sceneVisual, who, rerollKind === "perform");
          visualNow = rc.visual;
          if (rc.by !== "kept") console.log(`[mv-recast] scene ${sceneIndex + 1} — its words were rewritten for its cast (by the ${rc.by})`);
        }
        const { rerollMusicVideoScene } = await import("../lib/music-video-pipeline.server");
        const r = await rerollMusicVideoScene({ artistRef, sceneIndex, propKey, genre, castRefs: sceneCastRefs, aspect: rerollAspect, customProps: rerollCustomProps, kind: rerollKind, sceneCount: rerollSceneCount, sceneSeconds: filmSceneSeconds, leadRef: rerollLeadRef,
          sceneVisual: visualNow,
        });
        img = r.img; faults = r.faults; check = r.reading ?? null;
      } else {
        const { rerollFilmSceneSeed } = await import("../lib/film-engine.server");
        // (2026-11-22) the cast in the writer's words and where the scene is ride along, so a re-rolled scene is
        // told who is who and where — as a first-drawn one is
        let castWords: string[] = [];
        try { const a = JSON.parse(((form.get("sceneCastWords") as string) || "[]").slice(0, 4000)); if (Array.isArray(a)) castWords = a.filter((x) => typeof x === "string").slice(0, 6); } catch { /* none sent */ }
        const sceneWhere = ((form.get("sceneWhere") as string) || "").trim().slice(0, 300);
        img = await rerollFilmSceneSeed({ template: tmpl.key, sceneVisual, castRef: castRef || undefined, cast: castWords, where: sceneWhere || undefined });
      }
      if (!img) return json({ error: tr(lang, "Couldn't re-roll that scene — try again."), sceneIndex });
      return json({ ok: true, sceneIndex, img, faults, check, ...(visualNow !== sceneVisual ? { visual: visualNow } : {}), ...(ownCast ? ownCast : {}) });
    } catch (e) {
      return json({ error: tr(lang, "Couldn't re-roll that scene — try again."), sceneIndex, detail: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }

  // FREE — DRAW ONE OF A TOLD STORY'S OWN CHARACTERS AGAIN (story-picture.ts): the maker does not like how
  // one of them came out. A new portrait, and every scene that names them drawn again from it — nobody else
  // changes, no other scene is touched, no word is rewritten.
  if (intent === "recastStoryCharacter") {
    const name = ((form.get("castName") as string) || "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!narrated || !name) return json({ error: tr(lang, "Preview the scenes first.") });
    let tObj: { scenes?: unknown; cast?: unknown; places?: unknown } = {};
    try { tObj = JSON.parse(((form.get("approvedTreatment") as string) || "").trim() || "{}"); } catch { /* nothing to draw from */ }
    const scenesNow = Array.isArray(tObj.scenes) ? (tObj.scenes as Array<{ visual?: unknown; caption?: unknown }>).slice(0, 12).map((x) => ({ visual: String(x?.visual || "").slice(0, 1500), caption: String(x?.caption || "") })) : [];
    const castBible = Array.isArray(tObj.cast) ? (tObj.cast as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 8) : [];
    const placeBible = Array.isArray(tObj.places) ? (tObj.places as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 2) : [];
    if (!scenesNow.length) return json({ error: tr(lang, "Preview the scenes first.") });
    try {
      const { recastStoryCharacter } = await import("../lib/narrated-story.server");
      const r = await recastStoryCharacter({ template: tmpl.key, treatment: { title: "", musicMood: "", cast: castBible, places: placeBible, scenes: scenesNow }, cast: storyCast, aspect: ((form.get("filmAspect") as string) || "").trim(), castRef: ((form.get("castRef") as string) || "").trim().slice(0, 4000) || null, name });
      if (!r || !r.scenes.some((i) => r.sceneImgs[i])) return json({ error: tr(lang, "Couldn't draw {name} again — try again.", { name }), recastName: name });
      return json({ ok: true, recastName: name, scenes: r.scenes, sceneImgs: r.sceneImgs, sceneFaults: r.sceneFaults, sceneChecks: r.sceneChecks, castRef: r.castRef, castCards: r.castCards });
    } catch (e) {
      return json({ error: tr(lang, "Couldn't draw {name} again — try again.", { name }), recastName: name, detail: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }

  // PAID — enqueue the render. Charge by the ACTUAL scene count (the approved
  // treatment's length if one was approved, else the slider), so the quote the
  // merchant saw == the debit. The queue's refundPrepaidOnce returns chargedTokens
  // on terminal failure; this catch covers a charge that never gets a job row.
  if (intent === "film") {
    // FREE FILMS, CAPPED — OFF until the owner turns it on. While films cost 0 tokens (plan-config
    // FILM_BASE / FILM_PER_SCENE), one account could render hundreds of dollars of acted films a day (Kling
    // ≈ $0.28 a second). FILM_FREE_DAILY_CAP=<n> in the environment limits each account to n films in any
    // 24 hours. Admins are never capped, and the cap stops applying the moment films have a price.
    const freeCap = parseInt(process.env.FILM_FREE_DAILY_CAP || "", 10);
    if (Number.isFinite(freeCap) && freeCap > 0 && estimateFilmTokens(1) === 0 && !isAdminEmail(account.email)) {
      const made = await db.job.count({
        where: { shopId: shop.id, type: "GENERATE_VIDEO_AD", createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, payload: { contains: '"contentType":"film"' } },
      });
      if (made >= freeCap) return json({ error: tr(lang, "You've made {n} films in the last 24 hours. Movie Maker is free while we finish it, so it's limited to {n} a day for now — come back tomorrow for more.", { n: freeCap }) });
    }
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
    let cast: Array<{ name: string; faceUrl: string | null; voiceId: string | null; kind?: "person" | "cartoon" | "monster"; look?: string }> | undefined;
    const castRaw = ((form.get("cast") as string) || "").trim();
    if (castRaw) {
      try {
        const c = JSON.parse(castRaw);
        if (Array.isArray(c)) {
          const mapped = c
            .filter((x) => x && typeof x.name === "string" && x.name.trim())
            .map((x) => ({
              name: String(x.name).slice(0, 80), faceUrl: x.faceUrl ? String(x.faceUrl).slice(0, 2000) : null, voiceId: x.voiceId ? String(x.voiceId).slice(0, 80) : null,
              // what a cast member IS, when it is not a person — with what it looks like, in the maker's own words
              ...(x.kind === "cartoon" || x.kind === "monster" ? { kind: x.kind as "cartoon" | "monster", look: typeof x.look === "string" ? x.look.replace(/\s+/g, " ").trim().slice(0, 220) : "" } : {}),
            }))
            .slice(0, 8);
          if (mapped.length) cast = mapped;
        }
      } catch { /* ignore malformed */ }
    }
    // A cast voice must be a stock voice or one of THIS shop's own voices — never an id the client made
    // up (which could be another shop's cloned voice).
    if (cast) {
      const { shopVoiceClones } = await import("../lib/voice-clone.server");
      const mine = new Set((await shopVoiceClones(shop.id)).map((v) => v.voiceId));
      cast = cast.map((c) => ({ ...c, voiceId: c.voiceId && (AVATAR_VOICE_IDS.has(c.voiceId) || isCharacterVoice(c.voiceId) || mine.has(c.voiceId)) ? c.voiceId : null }));
    }
    // NARRATED: who tells it, and how the words are put on screen. A narrator is a stock voice, a
    // character voice, or one of THIS shop's own voices — anything else falls back to the format's own.
    let filmNarrator = "";
    const filmCaptions: CaptionStyle = captionStyleOf(((form.get("filmCaptions") as string) || "").trim(), narrated ? "bold" : "off");
    if (narrated) {
      const want = ((form.get("filmNarrator") as string) || "").trim().slice(0, 80);
      if (want && (AVATAR_VOICE_IDS.has(want) || isCharacterVoice(want))) filmNarrator = want;
      else if (want) {
        const { shopVoiceClones } = await import("../lib/voice-clone.server");
        if ((await shopVoiceClones(shop.id)).some((v) => v.voiceId === want)) filmNarrator = want;
      }
    }
    // The picked cast rides along with what each one IS and looks like (a creature stays a creature).
    if (storyCast.length) {
      const byName = new Map(storyCast.map((c) => [nameTok(c.name), c]));
      if (cast) cast = cast.map((c) => { const p = c.kind ? undefined : byName.get(nameTok(c.name)); return p && p.kind !== "person" && c.faceUrl === p.faceUrl ? { ...c, kind: p.kind, look: p.look } : c; });
      else if (narrated) cast = storyCast.map((c) => ({ name: c.name, faceUrl: c.faceUrl, voiceId: null, kind: c.kind, look: c.look }));
      // AN ACTED FILM MADE IN ONE PRESS has no storyboard to cast it in: the people picked on the Cast card
      // ARE its cast — their pictures and their own voices (dialogue-cast.ts → pickedAsCast). They were sent
      // and dropped: a Short Film made on 2026-11-24 with OMAR + ROSA picked was acted by two strangers.
      // (With a storyboard the page sends the cast it shows, above — an emptied one stays empty.)
      else if (tmpl.dialogue && !approvedTreatment) {
        const { shopVoiceClones } = await import("../lib/voice-clone.server");
        const mine = new Set((await shopVoiceClones(shop.id)).map((v) => v.voiceId));
        const acted = pickedAsCast(storyCast, (v) => AVATAR_VOICE_IDS.has(v) || isCharacterVoice(v) || mine.has(v));
        if (acted.length) cast = acted;
      }
    }
    // "Lock these voices" (dialogue films): every character speaks in exactly the voice picked for them.
    const filmLockVoices = ((form.get("filmLockVoices") as string) || "") === "1";
    // Swappable render engine (Test Movie): Kling 3 Omni is the DEFAULT (owner A/B win —
    // cheaper, quality held); "veo" switches to premium Veo 3. Only Test Movie reads it.
    const dialogueEngine = ((form.get("dialogueEngine") as string) || "").trim() === "veo" ? "veo" : "kling3";
    const filmAspectRaw = ((form.get("filmAspect") as string) || "").trim();
    const filmAspect = filmAspectRaw === "16:9" || filmAspectRaw === "1:1" ? filmAspectRaw : "9:16";
    // Music Video genre (rap/pop/rock/rnb/country) — only the lip-sync Music Video reads it.
    const filmGenre = ((form.get("filmGenre") as string) || "").trim();
    // …and how fast it is CUT. Unset = the genre's own pace; anything that isn't a pace is dropped.
    const filmPaceRaw = ((form.get("filmPace") as string) || "").trim();
    const filmPace = isPace(filmPaceRaw) ? filmPaceRaw : "";
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
    // Extra cast (Music Video) — co-stars beyond the lead, composed into perform scenes.
    const filmCastExtra = parseCastExtra(form.get("filmCastExtra") as string);
    // Per-scene cast (Music Video owner edit) — scene index → the cast imgs featured in that scene.
    const filmCastForScene = parseCastForScene(form.get("filmCastForScene") as string);
    // Wardrobe (Music Video owner edit) — cast member img → an outfit description.
    const filmOutfits = parseOutfits(form.get("filmOutfits") as string);
    // …and the approved picture of each picked outfit: they are styled from it (the wardrobe is locked).
    const filmOutfitImgs = parseOutfitImgs(form.get("filmOutfitImgs") as string);
    // Names (Music Video) — the picked avatar + co-stars, so the writer never invents "AI slop" names.
    const genArtistName = ((form.get("filmArtistName") as string) || "").trim().slice(0, 60);
    let genCastNames: string[] | undefined;
    const genCastRaw = ((form.get("filmCastNames") as string) || "").trim();
    if (genCastRaw) { try { const a = JSON.parse(genCastRaw); if (Array.isArray(a)) genCastNames = a.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 40)).slice(0, 4); } catch { /* ignore */ } }
    const genArtistGender = parseArtistGender(form.get("filmArtistGender") as string);
    const genCastGenders = parseCastGenders(form.get("filmCastGenders") as string);
    // Avatar-voice singing (opt-in beta) — sing the song in the picked avatar's OWN voice (seed-vc).
    const genSingVoice = ((form.get("filmSingVoice") as string) || "") === "1";
    const genArtistVoiceId = ((form.get("filmArtistVoiceId") as string) || "").trim().slice(0, 80);
    // A FEATURED VERSE (Music Video) — the co-stars who sing a verse in their OWN voice. The page says
    // only WHO; whose voice that is, is decided here from the co-star's own picture (the voice they were
    // cast with, or the one this shop gave them — mv-voices.server.ts), never from an id the page sends.
    // The singer must be one of the co-stars actually in this video.
    let filmFeatureVoices: Array<{ name: string; voiceId: string; pitch: number; gender: "m" | "f" }> = [];
    if (tmpl.lipSyncSinger && filmCastExtra?.length) {
      const asked = parseFeature(form.get("filmFeature") as string);
      if (asked.length) {
        const { singVoiceForImg } = await import("../lib/mv-voices.server");
        for (const m of filmCastExtra) {
          if (!asked.some((f) => nameTok(f.name) === nameTok(m.name))) continue;
          const v = await singVoiceForImg(shop.id, m.img);
          if (v) filmFeatureVoices.push({ name: m.name, ...v });
        }
      }
    }
    // Pre-approved per-scene STILLS (Music Video storyboard) — render these EXACT images, no re-seed.
    // Keep positions (a null = that scene seeds fresh), so the index stays aligned with the scenes.
    let approvedSceneImgs: (string | null)[] | undefined;
    const seedsRaw = ((form.get("approvedSceneImgs") as string) || "").trim();
    if (seedsRaw) { try { const s = JSON.parse(seedsRaw); if (Array.isArray(s) && s.length) approvedSceneImgs = s.map((x) => (typeof x === "string" && x ? x.slice(0, 2000) : null)); } catch { /* ignore malformed */ } }
    // A music video is priced by its LENGTH: two five-second scenes are one ten-second scene's worth,
    // so the same 30 seconds costs the same whatever the pace (mvBillScenes — the builder quotes with it).
    const cost = estimateFilmTokens(tmpl.lipSyncSinger ? mvBillScenes(scenes, filmSceneSeconds) : scenes);
    // EDIT STORY (story-edit.ts): a narrated story opened from a finished one and told again carries over
    // what the page is not trusted to say — the language it is told in, the first story it is a telling
    // of, and its music bed. Read from THIS shop's own story; any other id is an ordinary new story.
    const editFrom = ((form.get("editFrom") as string) || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    const edited = narrated && editFrom ? await editCarryFor(shop.id, editFrom, shop.contentLang) : null;

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
        ...(cast && filmLockVoices ? { filmLockVoices: true } : {}),
        ...(narrated ? { filmMode: "narrated", ...(filmNarrator ? { filmNarrator } : {}) } : {}),
        // (…told in the language it was written in — an edited story's own, below, wins)
        ...(narrated && askedLang ? { filmLang: askedLang } : {}),
        // THE LADDER (story-motion.ts): a told story asked for over STILL pictures — nothing is spent on motion
        ...(narrated && storyPicturesOf(form.get("filmPictures")) === "still" ? { filmPictures: "still" } : {}),
        ...(filmCaptions !== "off" || narrated ? { filmCaptions } : {}),
        ...(filmGenre ? { filmGenre } : {}),
        ...(filmPace ? { filmPace } : {}),
        ...(tmpl.lipSyncSinger ? { filmSceneSeconds } : {}),
        ...(filmSongUrl ? { filmSongUrl } : {}),
        ...(filmHeroUrl ? { filmHeroUrl } : {}),
        ...(filmCastExtra ? { filmCastExtra } : {}),
        ...(filmCastForScene ? { filmCastForScene } : {}),
        ...(filmOutfits ? { filmOutfits } : {}),
        ...(filmOutfitImgs ? { filmOutfitImgs } : {}),
        ...(genArtistName ? { filmArtistName: genArtistName } : {}),
        ...(genCastNames?.length ? { filmCastNames: genCastNames } : {}),
        ...(genArtistGender ? { filmArtistGender: genArtistGender } : {}),
        ...(genCastGenders?.length ? { filmCastGenders: genCastGenders } : {}),
        ...(genSingVoice && genArtistVoiceId ? { filmSingVoice: true, filmArtistVoiceId: genArtistVoiceId } : {}),
        ...(filmFeatureVoices.length ? { filmFeatureVoices } : {}),
        ...(filmProps?.length ? { filmProps } : {}),
        ...(filmCustomProps.length ? { filmCustomProps } : {}),
        ...(approvedSceneImgs?.length ? { approvedSceneImgs } : {}),
        // THE STORY'S OWN CAST: the portraits the storyboard drew its scenes from (or, for the next episode
        // of a series made in one go, the last episode's) — a scene drawn by the job uses them, and the
        // finished story keeps who is in it
        ...(narrated && (castRefIn("filmCastRef") || seriesCastRef) ? { filmCastRef: castRefIn("filmCastRef") || seriesCastRef } : {}),
        // NEXT EPISODE: the series it continues, read from this shop's own film above — written onto the
        // new film's asset row when the pipeline creates it (meta.series)
        ...(series ? { filmSeries: series } : {}),
        ...(edited ? { filmLang: edited.lang, ...(edited.translatedFrom ? { filmTranslatedFrom: edited.translatedFrom } : {}), ...(edited.musicFile ? { ckMusic: edited.musicFile } : {}) } : {}),
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

// (`singer`: Music Video featured verse — the NAME of the co-star who sings this scene; absent = the artist)
type Scene = { visual: string; caption?: string; where?: string; shot?: string; tone?: string; kind?: "perform" | "broll"; singer?: string };
// (`nudge`: the starter the server dealt when the idea was under three words — film-genres.ts → nudgeFor — in
//  ENGLISH, as the dictionary keys it; the page puts it back in the idea box, said in the member's language)
type Treatment = { title?: string; scenes: Scene[]; musicMood: string; cast?: string[]; nudge?: string };

/** THE NUDGE COMES BACK (2026-11-25). An idea of a word or two is not written as typed: the server deals one of
 *  the genre's starters and writes from that (film-genres.ts → nudgeFor), and says which (`treatment.nudge`).
 *  The idea box then holds what the story was written from — the starter, in the member's language (`shown`) —
 *  so it can be read, changed and written again. What the member DID type is not thrown out of the box: unless
 *  the starter already says it (the server takes the starter that holds the typed word: "lighthouse" → the
 *  lighthouse one), it stays after the starter, in brackets. Pure — tests/film-builder-top.test.ts runs it. */
function nudgeFill(shown: string, english: string, sent: string): string {
  const typed = (sent || "").replace(/\s+/g, " ").trim();
  if (!typed || !/[\p{L}\p{N}]/u.test(typed)) return shown;
  const says = (s: string) => (s || "").toLowerCase().includes(typed.toLowerCase());
  return says(english) || says(shown) ? shown : `${shown} (${typed})`;
}
// A locked "actor": one character's reusable face + pinned voice, cast once and
// reused as the identity reference for every shot they appear in.
// autoVoice = the voice was picked FOR this character (not by the merchant, not brought by a presenter),
// so it may still be re-picked when the rest of the cast changes.
// kind / look = what a cast member IS and looks like when they came from the cast (a cartoon character
// and a monster are drawn and filmed as what they are, not as people).
/* THE SLATE. Pressing Generate is "action!" — so the page claps a slate, and it is THIS film's slate: its
 * title (the first words of the idea when nothing is written yet), its format, how many scenes, today's
 * date, and its director: you. One clap, no sound; with reduced motion it is simply shut. (The owner,
 * 2026-11-24: "genius level artistic detail additions that make the app feel alive".) */
function Slate({ title, format, scenes }: { title: string; format: string; scenes: number }) {
  const t = useT();
  // (the date is the member's own, so it is read once the page is theirs — never on the server)
  const [when, setWhen] = useState("");
  useEffect(() => { try { setWhen(new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })); } catch { setWhen(""); } }, []);
  return (
    <div className="fs-slate" role="img" aria-label={t("Slate: {title}", { title })}>
      <span className="fs-slate-stick" aria-hidden="true" />
      <div className="fs-slate-board" aria-hidden="true">
        <span className="fs-slate-bar" />
        <div className="fs-slate-prod"><i>{t("Production")}</i><b>{title}</b></div>
        <div className="fs-slate-cells">
          <span><i>{t("Director")}</i><b>{t("You")}</b></span>
          <span><i>{t("Scenes")}</i><b>{scenes}</b></span>
          <span><i>{t("Date")}</i><b>{when || "—"}</b></span>
        </div>
        <div className="fs-slate-fmt">{format}</div>
      </div>
    </div>
  );
}

type CastMember = { name: string; desc: string; faceUrl: string | null; voiceId: string | null; autoVoice?: boolean; kind?: "person" | "cartoon" | "monster"; look?: string };

/** WHAT THE CAST STEP'S CARD SAYS ONCE A SCRIPT EXISTS (2026-11-25): who is in the film and how many of
 *  them have a face yet — "Araceli · Tuan", "1/2 cast". The owner, of the page as it was: "It looks like
 *  there is two cast selection cards per story (Bottom one comes across as extra)". The second one is gone
 *  and the step's own card carries what it told him, at a glance, on a card half a phone wide:
 *   - `names`: the characters' names in the script's order, " · " between them — three at most, then "+2"
 *     (eight people are allowed; eight names are not a glance). A character still without a name is counted
 *     and not named.
 *   - `discs`: one per character, five at most (`more` = the rest): their picture when they have one, else
 *     the first letter of their name (a character added a moment ago, with no name yet: "?").
 *   - `done` / `total` / `all`: how many have a face — `all` only when there is somebody and every one does.
 *  Pure — no hook, nothing of the page — so tests/film-one-cast.test.ts RUNS it. */
const CAST_CARD_NAMES = 3;
const CAST_CARD_DISCS = 5;
function castCardSummary(cast: Array<{ name: string; faceUrl: string | null }>) {
  const named = cast.map((c) => (c.name || "").trim()).filter(Boolean);
  const names = named.slice(0, CAST_CARD_NAMES).join(" · ") + (named.length > CAST_CARD_NAMES ? ` +${named.length - CAST_CARD_NAMES}` : "");
  const discs = cast.slice(0, CAST_CARD_DISCS).map((c) => ({ name: (c.name || "").trim(), img: c.faceUrl || null, letter: (Array.from((c.name || "").trim())[0] || "?").toUpperCase() }));
  const done = cast.filter((c) => !!c.faceUrl).length;
  return { names, discs, more: Math.max(0, cast.length - CAST_CARD_DISCS), done, total: cast.length, all: cast.length > 0 && done === cast.length };
}

// Backdrop presets — like the avatar-AI backdrop picker: tap one to set a scene's location (the `where`), or
// type your own. Each story GENRE has its own nine (film-genres.ts → backdropsOf): one list offered everywhere
// asked a Kids Cartoon about a lost bandana whether it happens in a Bar, a Diner or a Warehouse, and offered a
// horror story an Office (seen making both as a customer, 2026-11-22). The page kept three lists of its own
// here until 2026-11-25, when the genres became movie categories and the table moved to film-genres.ts.
/** Is this the place a scene is in? Its key as a WHOLE WORD of the scene's `where` — a lighthouse lit up
 *  the "Old house" chip, and a carpark would have lit "Car" and "Park" (seen 2026-11-22). */
const backdropIs = (where: string, key: string): boolean => new RegExp(`(^|[^a-z])${key}([^a-z]|$)`, "i").test(where || "");

// The Music Video's EXACT-length tiers are picked in SECONDS (MV_SECONDS in mv-pace.ts); each scene is
// one generated clip of 5 or 10 seconds (the pace decides), and the engine fits the song to EXACTLY
// scenes × that — the picked length is what renders (and what's billed).

/* ---------- the landing's moving pictures ----------
 * Real renders made on this page — one short clip per format (public/landing/film-loop-<key>.mp4, a
 * 16:9 cut, a 4:5 "-tall" cut for phones, and a poster of its first frame). The hero plays them one
 * after another; each format card plays its own when you point at it. Cut by scratch tooling from the
 * founder's own archive; generated actors and cartoons only. Bump the versions when a file is replaced.
 *
 * Each clip is ONE continuous take with nothing blended into it. The first set (v1) ran through the
 * dissolves the film engine used to put between takes, and had its own tail cross-faded into its head
 * to loop "seamlessly" — both read as a glitch every few seconds, and the owner saw it at once. A clip
 * repeats with a plain jump; its in and out points were picked where the two frames are most alike.
 *
 * v3 (2026-11-18): Short Film and Moral Story were two people in side profile ("weak sauce flex", the
 * owner, 11-17). Their clips and covers are now from films made after the acted films' two-shot was
 * opened up — both faces toward the camera, the story's object in the picture (the neon OPEN sign, the
 * broken pocket watch) — and they have their own 4:5 covers, since a centre crop of a two-shot on a
 * phone card cut both faces in half.
 *
 * v4 (2026-11-22): the NARRATED heroes (film-heroes.ts) have posters of their own, cut from narrated
 * stories made that day with stock presenters and a stock character: three scenes side by side, each a
 * whole upright picture with its caption burned in — the poster looks like what the hero makes. Keyed by a
 * hero's `media` ("horrorstory", "shortstory", "moralstory"); the acted heroes keep the earlier files.
 * v5, same day: the WIDE posters of those three are made from the stories' clean stills instead — on a
 * desktop card the poster's name sits over the lower half, and burned-in captions under it were clutter.
 * The phone (4:5) posters keep the film frame with its caption, which sits above the name there. */
const LOOP_V = 5;
const STILL_V = 8;
const LOOP_KEYS = ["musicvideo", "testmovie", "shortstory", "kidstv", "moralstory", "moral", "horrorstory", "horror", "kidsmusicvideo"];
/** Formats whose cover has its own 4:5 picture for phones (the rest are one picture cropped both ways).
 *  (2026-11-25: the genres added that day each have one — a told Story's poster is a strip of three upright
 *  pictures, and a centre crop of it on a phone card was the middle panel alone. The sign-in lobby keeps the
 *  very same list: tests/auth-lobby.test.ts holds the two together.) */
const TALL_STILLS = new Set(["kidstv", "kidsmusicvideo", "testmovie", "moral", "horrorstory", "shortstory", "moralstory", "comedy", "comedystory", "thriller", "thrillerstory", "action", "romance", "romancestory", "scifi", "scifistory", "fantasy", "fantasystory", "mystery", "mysterystory"]);
const stillOf = (key: string) => `/landing/film-still-${key}.jpg?v=${STILL_V}`;
const stillFallback = (e: React.SyntheticEvent<HTMLImageElement>) => {
  const el = e.currentTarget;
  if (!el.dataset.fb) { el.dataset.fb = "1"; el.src = "/landing/film-hero.jpg?v=5"; }
};

/** One clip of the hero's reel. `key` is the format it shows off ("" for the opening clip). */
type ReelClip = { key: string; src: string; poster: string };
const HERO_REEL: ReelClip[] = [
  { key: "", src: "/landing/film-hero.mp4", poster: "/landing/film-hero.jpg?v=5" },
  ...LOOP_KEYS.map((key) => ({ key, src: `/landing/film-loop-${key}.mp4?v=${LOOP_V}`, poster: `/landing/film-loop-${key}.jpg?v=${LOOP_V}` })),
];

/** The hero's reel: real renders, one after another, cross-fading. Two players are stacked — the one in
 *  front plays its clip through once; the one behind already holds the next clip, so the hand-over is a
 *  fade and never a blank frame. A viewer who asked for reduced motion gets the first poster, still. */
function HeroReel({ clips, onShow }: { clips: ReelClip[]; onShow: (key: string) => void }) {
  const [slot, setSlot] = useState<[number, number]>([0, clips.length > 1 ? 1 : 0]);
  const [front, setFront] = useState(0);
  const vids = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null]);
  const live = useRef({ front: 0, slot: [0, 0] as [number, number], still: false, away: false });
  live.current.front = front;
  live.current.slot = slot;
  const swap = useRef<number | null>(null);

  const advance = (from: number) => {
    const st = live.current;
    if (from !== st.front || clips.length < 2 || st.still || st.away) return;
    const back = 1 - from;
    const v = vids.current[back];
    if (!v) return;
    try { v.currentTime = 0; } catch { /* not loaded yet — it starts from the top anyway */ }
    v.muted = true;
    v.play().catch(() => undefined);
    setFront(back);
    onShow(clips[st.slot[back]].key);
    // once the cross-fade is over, the player that just left takes the clip after the one now showing
    if (swap.current) window.clearTimeout(swap.current);
    swap.current = window.setTimeout(() => {
      setSlot((s) => { const next: [number, number] = [s[0], s[1]]; next[from] = (s[back] + 1) % clips.length; return next; });
    }, 1000);
  };

  useEffect(() => {
    live.current.still = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const first = vids.current[0];
    if (first && !live.current.still) { first.muted = true; first.play().catch(() => undefined); }
    onShow(clips[0].key);
    // it plays only while it can be seen: scrolled away, the clip in front is paused, and picks up on the way back
    const host = first?.closest(".fs-head") || null;
    let io: IntersectionObserver | null = null;
    if (host && typeof IntersectionObserver !== "undefined" && !live.current.still) {
      io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          live.current.away = !e.isIntersecting;
          const v = vids.current[live.current.front];
          if (!v) continue;
          if (e.isIntersecting) v.play().catch(() => undefined); else v.pause();
        }
      }, { threshold: 0.05 });
      io.observe(host);
    }
    return () => { if (swap.current) window.clearTimeout(swap.current); io?.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // a clip that never reports its end (it failed to load, or stalled) must not freeze the reel
  useEffect(() => {
    if (clips.length < 2) return;
    const id = window.setTimeout(() => advance(front), 12000);
    return () => window.clearTimeout(id);
  }, [front]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {[0, 1].map((k) => {
        const c = clips[slot[k]];
        return (
          <span key={k} className={`fs-reel${front === k ? " on" : ""}`} aria-hidden="true">
            <img className="fs-reel-amb" src={c.poster} alt="" />
            <video ref={(el) => { vids.current[k] = el; }} className="fs-head-vid" src={c.src} poster={c.poster}
              muted playsInline preload="auto" loop={clips.length < 2} onEnded={() => advance(k)} />
          </span>
        );
      })}
    </>
  );
}

/** A format card's cover: its still, and the format's loop playing over it while a pointer is on the card
 *  (or it has keyboard focus) — on a touch screen, while the card is on screen. The clip is fetched the
 *  first time it is needed, in the cut that fits the card (16:9 on a wide screen, 4:5 on a phone). */
function LoopCover({ k, loop, tall, still, clip }: { k: string; /** it has a loop and a phone cut though its key is not in LOOP_KEYS / TALL_STILLS (the Lyric Video's card) */ loop?: boolean; tall?: boolean; /** a cover not named after a film key — its picture and its clip by address, one cut for every screen (the Found Footage door) */ still?: string; clip?: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [on, setOn] = useState(false);
  const has = !!clip || (loop ?? LOOP_KEYS.includes(k));
  useEffect(() => {
    const v = ref.current;
    const card = v ? (v.closest(".fs-fmt") as HTMLElement | null) : null;
    if (!v || !card || !window.matchMedia) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = () => {
      if (clip && !v.getAttribute("src")) v.src = clip;
      if (!v.getAttribute("src")) v.src = `/landing/film-loop-${k}${window.matchMedia("(min-width:640px)").matches ? "" : "-tall"}.mp4?v=${LOOP_V}`;
      v.muted = true;
      v.play().catch(() => undefined);
    };
    const stop = () => { v.pause(); setOn(false); };
    if (window.matchMedia("(hover:hover) and (pointer:fine)").matches) {
      card.addEventListener("pointerenter", start);
      card.addEventListener("pointerleave", stop);
      card.addEventListener("focus", start);
      card.addEventListener("blur", stop);
      return () => {
        card.removeEventListener("pointerenter", start);
        card.removeEventListener("pointerleave", stop);
        card.removeEventListener("focus", start);
        card.removeEventListener("blur", stop);
      };
    }
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => { for (const e of entries) (e.isIntersecting ? start : stop)(); }, { threshold: 0.65 });
    io.observe(card);
    return () => io.disconnect();
  }, [k, clip]);
  return (
    <>
      {still ? <img src={still} alt="" loading="lazy" onError={stillFallback} /> : (tall ?? TALL_STILLS.has(k)) ? (
        <picture>
          <source media="(max-width:639px)" srcSet={`/landing/film-still-${k}-tall.jpg?v=${STILL_V}`} />
          <img src={stillOf(k)} alt="" loading="lazy" onError={stillFallback} />
        </picture>
      ) : (
        <img src={stillOf(k)} alt="" loading="lazy" onError={stillFallback} />
      )}
      {has && <video ref={ref} className={`fs-fmt-vid${on ? " on" : ""}`} muted loop playsInline preload="none" tabIndex={-1} aria-hidden="true" onPlaying={() => setOn(true)} />}
    </>
  );
}

/* ───────── THE LYRIC VIDEO BUILDER (lyric-video.ts) ─────────
 * The owner, 2026-11-24: "simple active exciting lyrics … input link and it converts to a Lyric Video". So the
 * whole builder is: drop a song or paste a YouTube link, tick that it's yours (or you have its owner's permission),
 * paste the lyrics if you want the words spot-on, pick a look and a shape, press one button. An upload goes where
 * a Music Video's own track goes (api.film-song-upload); a link is fetched to the same place (api.lyric-video.tsx →
 * songFromLink); the video is made by the queue (job "lyricvideo"). THE TICK — his word, 2026-11-24: "include
 * regulatory things like 'you must have permissions from song owner'" — is asked before a link is fetched and
 * before a video is made, and the server checks it too. Operators only until the owner sets a price. */
type LyricSong = { url: string; name: string; seconds: number | null; /** the YouTube address it was fetched from */ link?: string };
const clockOf = (s: number | null): string => (s && s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");
function LyricVideoBuilder({ t }: { t: ReturnType<typeof useT> }) {
  const [song, setSong] = useState<LyricSong | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [linkNote, setLinkNote] = useState("");
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyrics, setLyrics] = useState("");
  const [look, setLook] = useState<LyricLook>("bold");
  const [shape, setShape] = useState<LyricShape>("9:16");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  // whose song it is: ticked before a link is fetched and before a video is made
  const [rights, setRights] = useState(false);
  const [rightsNeed, setRightsNeed] = useState(false);
  const [fetching, setFetching] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const rightsRef = useRef<HTMLInputElement | null>(null);
  const minutes = lyricEtaMinutes(song?.seconds ?? 180);
  /** Asked for the tick and it isn't there: say so where they are, and bring them to the box. */
  const askRights = (where: "link" | "make") => {
    setRightsNeed(true);
    if (where === "link") setLinkNote(t(RIGHTS_ASK)); else setErr(t(RIGHTS_ASK));
    try { rightsRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); rightsRef.current?.focus({ preventScroll: true }); } catch { /* an old browser */ }
  };
  // anything changed after a video was sent is the start of the next one
  useEffect(() => { setSent(null); }, [song, title, lyrics, look, shape]);

  const take = async (file?: File | null) => {
    if (!file || busy || fetching) return;
    setErr(""); setLinkNote(""); setBusy(true);
    // how long the song is, read in the browser — for the time the video will take
    const seconds = await new Promise<number | null>((resolve) => {
      let settled = false;
      const done = (v: number | null) => { if (!settled) { settled = true; resolve(v); } };
      try {
        const u = URL.createObjectURL(file);
        const a = new Audio();
        a.preload = "metadata";
        a.onloadedmetadata = () => { done(Number.isFinite(a.duration) ? a.duration : null); URL.revokeObjectURL(u); };
        a.onerror = () => { done(null); URL.revokeObjectURL(u); };
        a.src = u;
        window.setTimeout(() => done(null), 6000);
      } catch { done(null); }
    });
    try {
      const fd = new FormData(); fd.set("song", file);
      const r = await fetch("/api/film-song-upload", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { songUrl?: string; name?: string; error?: string };
      if (j.songUrl) { const name = j.name || file.name; setSong({ url: j.songUrl, name, seconds }); setTitle(songTitleOf(name)); }
      else setErr(j.error || t("Couldn't upload that song — mind trying again?"));
    } catch { setErr(t("Couldn't upload that song — mind trying again?")); }
    finally { setBusy(false); }
  };
  const takeLink = async () => {
    const l = link.trim();
    if (!l || busy || fetching) return;
    if (!rights) { askRights("link"); return; }
    setLinkNote(""); setErr(""); setFetching(true);
    try {
      const fd = new FormData(); fd.set("intent", "link"); fd.set("link", l); fd.set("rights", "yes");
      const r = await fetch("/api/lyric-video", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { songUrl?: string; name?: string; title?: string; seconds?: number | null; source?: string; error?: string };
      if (j.songUrl) {
        setSong({ url: j.songUrl, name: j.name || j.title || l, seconds: typeof j.seconds === "number" && j.seconds > 0 ? j.seconds : null, link: j.source || undefined });
        setTitle((j.title || songTitleOf(j.name || "")).slice(0, 80));
        setLinkOpen(false); setLink("");
      } else setLinkNote(j.error || t("We couldn't fetch that song — try again, or upload the song file."));
    } catch { setLinkNote(t("We couldn't fetch that song — try again, or upload the song file.")); }
    finally { setFetching(false); }
  };
  const make = async () => {
    if (!song || sending) return;
    if (!rights) { askRights("make"); return; }
    setErr(""); setSending(true);
    try {
      const fd = new FormData();
      fd.set("intent", "make"); fd.set("songUrl", song.url); fd.set("songName", song.name); fd.set("title", title);
      fd.set("lyrics", lyrics); fd.set("look", look); fd.set("shape", shape); fd.set("rights", "yes");
      if (song.link) fd.set("songLink", song.link);
      const r = await fetch("/api/lyric-video", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (j.ok) setSent(minutes);
      else setErr(j.error || t("Couldn't start it — mind trying again?"));
    } catch { setErr(t("Couldn't start it — mind trying again?")); }
    finally { setSending(false); }
  };

  return (
    <div className="lv">
      <p className="lv-intro">{t("Drop in a song or paste a YouTube link — we catch every word, draw the pictures and cut them on the beat.")}</p>
      {/* 1 · THE SONG */}
      {song ? (
        <div className="lv-song">
          <span className="lv-song-ico" aria-hidden="true"><Ico n="music" size={20} /></span>
          <input className="lv-song-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={t("Song title")} aria-label={t("Song title")} />
          {song.link ? <span className="lv-song-src">{t("from YouTube")}</span> : null}
          {clockOf(song.seconds) ? <span className="lv-song-len">{clockOf(song.seconds)}</span> : null}
          {/* another song is another confirmation */}
          <button type="button" className="lv-song-x" onClick={() => { setSong(null); setTitle(""); setRights(false); setRightsNeed(false); }}>{t("Change")}</button>
        </div>
      ) : (
        <div className={`lv-drop${drag ? " drag" : ""}${busy ? " busy" : ""}`} role="button" tabIndex={0} aria-busy={busy}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files?.[0]); }}>
          <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg" hidden onChange={(e) => { take(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
          <span className="lv-drop-ico" aria-hidden="true">{busy ? <span className="mm-ptile-spin" /> : <Ico n="upload" size={24} />}</span>
          <b>{busy ? t("Uploading your song…") : t("Drop your song here")}</b>
          <span>{t("or tap to choose · MP3, WAV or M4A, up to 25 MB")}</span>
        </div>
      )}
      {song && (song.seconds || 0) > 360 && <p className="lv-note" role="status">{t("A song over 6 minutes is made into a 6-minute video, faded out at the end.")}</p>}
      {!song && (
        <div className="lv-linkrow">
          {linkOpen ? (
            <div className="lv-link">
              <input value={link} onChange={(e) => { setLink(e.target.value); setLinkNote(""); }} placeholder={t("Paste a YouTube link")} inputMode="url" maxLength={2000} readOnly={fetching}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); takeLink(); } }} aria-label={t("Paste a YouTube link")} />
              <button type="button" onClick={takeLink} disabled={!link.trim() || busy || fetching} aria-busy={fetching}>
                {fetching ? <><span className="mm-ptile-spin" aria-hidden="true" /> {t("Getting the song…")}</> : <><Ico n="link" size={14} /> {t("Use link")}</>}
              </button>
            </div>
          ) : (
            <button type="button" className="lv-linkbtn" onClick={() => setLinkOpen(true)}><Ico n="link" size={13} /> {t("Have a YouTube link?")}</button>
          )}
          {linkNote && <p className="lv-note" role="status">{linkNote}</p>}
        </div>
      )}

      {/* WHOSE SONG — ticked before a link is fetched and before a video is made (the owner, 2026-11-24: "you must
          have permissions from song owner"); the server checks it too, and the piece keeps it */}
      <label className={`lv-rights${rights ? " on" : ""}${rightsNeed && !rights ? " need" : ""}`}>
        <input ref={rightsRef} type="checkbox" checked={rights}
          onChange={(e) => { const on = e.currentTarget.checked; setRights(on); if (on && rightsNeed) { setRightsNeed(false); setLinkNote(""); setErr(""); } }} />
        <span className="lv-rights-txt">
          <b>{t(RIGHTS_LINE)}</b>
          <small>{t(RIGHTS_NOTE)} <a href="/terms#songs" target="_blank" rel="noopener noreferrer">{t("Terms")}</a></small>
        </span>
      </label>

      {/* 2 · THE WORDS (optional) */}
      <button type="button" className={`lv-lyr-toggle${lyricsOpen ? " on" : ""}`} aria-expanded={lyricsOpen} onClick={() => setLyricsOpen((v) => !v)}>
        <Ico n="pencil" size={14} /> <b>{t("Paste the lyrics")}</b> <em>{t("optional — for spot-on words")}</em>
      </button>
      {lyricsOpen && (
        <textarea className="lv-lyrics" rows={7} value={lyrics} onChange={(e) => setLyrics(e.target.value)} maxLength={12000}
          placeholder={t("One line of the song per line. Leave it empty and we'll listen for the words.")} />
      )}

      {/* 3 · THE LOOK — a real frame of each */}
      <div className="lv-h">{t("The look")}</div>
      <div className="lv-looks" role="radiogroup" aria-label={t("The look")}>
        {LYRIC_LOOKS.map((lk) => (
          <button type="button" role="radio" aria-checked={look === lk.key} key={lk.key} className={`lv-look is-${lk.key}${look === lk.key ? " on" : ""}`} onClick={() => setLook(lk.key)}>
            <span className="lv-look-pic"><img src={`/landing/lyric-look-${lk.key}.jpg?v=1`} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
              {look === lk.key && <span className="lv-look-chk" aria-hidden="true"><Ico n="check" size={12} /></span>}</span>
            <b>{t(lk.label)}</b>
            <span>{t(lk.blurb)}</span>
          </button>
        ))}
      </div>

      {/* 4 · THE SHAPE */}
      <div className="lv-h">{t("The shape")}</div>
      <div className="lv-seg" role="radiogroup" aria-label={t("The shape")}>
        <button type="button" role="radio" aria-checked={shape === "9:16"} className={shape === "9:16" ? "on" : ""} onClick={() => setShape("9:16")}>
          <i className="lv-seg-tall" aria-hidden="true" /> <b>{t("Vertical")}</b> <small>{t("for Reels, TikTok, Shorts")}</small>
        </button>
        <button type="button" role="radio" aria-checked={shape === "16:9"} className={shape === "16:9" ? "on" : ""} onClick={() => setShape("16:9")}>
          <i className="lv-seg-wide" aria-hidden="true" /> <b>{t("Wide")}</b> <small>{t("for YouTube")}</small>
        </button>
      </div>

      {/* 5 · ONE BUTTON */}
      <button type="button" className="mm-go lv-go" onClick={make} disabled={!song || sending || busy || fetching}>
        {sending ? <>… {t("Starting")}</> : <><Ico n="music" size={17} /> {t("Make my lyric video")}</>}
      </button>
      <div className="mm-eta"><span aria-hidden="true">⏱</span> {t("Ready in about {n} min · it lands in your Archive", { n: minutes })}</div>
      <p className="mm-note">{t("Free while we test it — pricing comes later.")}</p>
      {err && <p className="fs-err">{err}</p>}
      {sent !== null && (
        <p className="fs-ok" role="status"><Ico n="check" size={14} /> {t("Rolling! Your lyric video lands in your Archive in about {n} min.", { n: sent })} <a href="/web/archive">{t("Open the Archive")}</a></p>
      )}
    </div>
  );
}

/* The Lyric Video's styles: its card's badge on the shelf, and its builder. In the page's own colours (the theme's
 * variables), so it is right in the light and the dark alike; a phone first (two looks to a row), four looks to a
 * row on a wide screen. */
const LV_STYLE = `
.t-lyric{background:linear-gradient(135deg,#F2A93B,#C2487E);}
.t-ff{background:linear-gradient(135deg,#5B6B60,#1A2420);}
a.fs-fmt.fs-door{display:block;text-decoration:none;color:inherit;}
.lv{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;max-width:760px;margin:0 auto;padding:4px 0 28px;}
.lv-intro{margin:2px 0 4px;color:var(--ink2);font-size:14.5px;line-height:1.45;text-align:center;}
.lv-drop{display:grid;justify-items:center;gap:6px;padding:26px 18px;border:2px dashed var(--line);border-radius:18px;background:var(--card);cursor:pointer;text-align:center;transition:border-color .15s,background .15s,transform .15s;}
.lv-drop:hover,.lv-drop:focus-visible,.lv-drop.drag{border-color:var(--green);background:color-mix(in srgb,var(--green) 7%,var(--card));}
.lv-drop.drag{transform:scale(1.01);}
.lv-drop.busy{cursor:progress;opacity:.85;}
.lv-drop b{font-size:17px;color:var(--ink);}
.lv-drop span{font-size:13px;color:var(--ink3,#6E7A72);}
.lv-drop-ico{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:color-mix(in srgb,var(--green) 14%,transparent);color:var(--green);}
.lv-drop-ico svg{stroke:currentColor;}
.lv-song{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:16px;background:var(--card);}
.lv-song-ico{flex:0 0 auto;width:38px;height:38px;border-radius:11px;display:grid;place-items:center;background:linear-gradient(135deg,#F2A93B,#C2487E);color:#fff;}
.lv-song-ico svg{stroke:#fff;}
.lv-song-title{flex:1 1 0;width:0;min-width:0;border:0;background:transparent;color:var(--ink);font:700 16px Poppins,sans-serif;padding:6px 2px;border-bottom:1px dashed transparent;}
.lv-song-title:focus{outline:none;border-bottom-color:var(--green);}
.lv-song-len{flex:0 0 auto;font-size:13px;color:var(--ink3,#6E7A72);font-variant-numeric:tabular-nums;}
.lv-song-x{flex:0 0 auto;min-height:36px;border:1px solid var(--line);background:transparent;color:var(--ink2);border-radius:10px;padding:0 12px;font-weight:600;cursor:pointer;}
.lv-linkrow{display:grid;gap:6px;justify-items:center;}
.lv-linkbtn{border:0;background:transparent;color:var(--ink2);font-size:13px;font-weight:600;cursor:pointer;min-height:32px;display:inline-flex;align-items:center;gap:6px;}
.lv-linkbtn svg,.lv-link svg,.lv-lyr-toggle svg{stroke:currentColor;}
.lv-link{display:flex;gap:8px;width:100%;}
.lv-link input{flex:1;min-width:0;min-height:44px;border:1px solid var(--line);border-radius:12px;padding:0 12px;background:var(--card);color:var(--ink);font-size:14px;}
.lv-link button{flex:0 0 auto;min-height:44px;border:0;border-radius:12px;padding:0 14px;background:var(--green);color:#fff;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px;}
.lv-link button:disabled{opacity:.5;cursor:default;}
.lv-note{margin:0;font-size:13px;color:var(--ink2);text-align:center;}
.lv-lyr-toggle{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:46px;padding:10px 14px;border:1px solid var(--line);border-radius:14px;background:var(--card);color:var(--ink);cursor:pointer;text-align:left;}
.lv-lyr-toggle em{font-style:normal;font-size:12.5px;color:var(--ink3,#6E7A72);}
.lv-lyr-toggle.on{border-color:var(--green);}
.lv-lyrics{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:14px;padding:12px;background:var(--card);color:var(--ink);font:14px/1.5 Poppins,sans-serif;resize:vertical;}
.lv-h{margin-top:6px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3,#6E7A72);}
.lv-looks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
@media(min-width:640px){.lv-looks{grid-template-columns:repeat(4,minmax(0,1fr));}}
.lv-look{display:grid;gap:3px;padding:6px 6px 10px;border:2px solid var(--line);border-radius:16px;background:var(--card);color:var(--ink);text-align:left;cursor:pointer;transition:border-color .15s,transform .15s;}
.lv-look:hover{transform:translateY(-1px);}
.lv-look.on{border-color:var(--green);box-shadow:0 8px 22px -14px var(--green);}
.lv-look b{font-size:14px;padding:0 4px;}
.lv-look > span:not(.lv-look-pic){font-size:12px;line-height:1.3;color:var(--ink3,#6E7A72);padding:0 4px;}
.lv-look-pic{position:relative;display:block;aspect-ratio:4/5;border-radius:11px;overflow:hidden;background:linear-gradient(160deg,#1d1a2e,#0c0b14);margin-bottom:4px;}
.lv-look-pic img{width:100%;height:100%;object-fit:cover;display:block;}
.lv-look-chk{position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--green);}
.lv-look-chk svg{stroke:#fff;}
.lv-seg{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.lv-seg button{display:grid;grid-template-columns:auto 1fr;align-items:center;column-gap:10px;min-height:56px;padding:8px 12px;border:2px solid var(--line);border-radius:14px;background:var(--card);color:var(--ink);text-align:left;cursor:pointer;}
.lv-seg button.on{border-color:var(--green);}
.lv-seg b{font-size:14px;}
.lv-seg small{grid-column:2;font-size:11.5px;color:var(--ink3,#6E7A72);}
.lv-seg i{grid-row:span 2;display:block;border:2px solid currentColor;border-radius:4px;opacity:.7;}
.lv-seg-tall{width:14px;height:24px;}
.lv-seg-wide{width:26px;height:15px;}
.lv-go{margin-top:6px;}
.lv .fs-ok a{color:inherit;font-weight:700;margin-left:4px;}
.lv-link button .mm-ptile-spin{width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,.45);border-top-color:#fff;}
.lv-song-src{flex:0 0 auto;font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#C4302B;background:color-mix(in srgb,#C4302B 11%,transparent);border-radius:6px;padding:3px 7px;white-space:nowrap;}
.lv-rights{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:10px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--card);cursor:pointer;transition:border-color .15s,box-shadow .15s;}
.lv-rights input{width:20px;height:20px;margin:1px 0 0;accent-color:var(--green);cursor:pointer;}
.lv-rights-txt{display:grid;gap:3px;min-width:0;}
.lv-rights-txt b{font-size:14px;line-height:1.35;font-weight:600;color:var(--ink);}
.lv-rights-txt small{font-size:12px;line-height:1.45;color:var(--ink3,#6E7A72);}
.lv-rights-txt a{color:var(--green);font-weight:700;white-space:nowrap;}
.lv-rights.on{border-color:var(--green);}
.lv-rights.need{border-color:#D14343;box-shadow:0 0 0 3px color-mix(in srgb,#D14343 20%,transparent);}
.fs-theater .lv-intro,.fs-theater .lv-h,.fs-theater .lv-note,.fs-theater .lv-linkbtn,.fs-theater .lv-rights-txt small{color:#D8CFBA;}
.fs-theater .lv-drop,.fs-theater .lv-song,.fs-theater .lv-lyr-toggle,.fs-theater .lv-look:not(.on),.fs-theater .lv-seg button:not(.on),.fs-theater .lv-rights:not(.on):not(.need){box-shadow:0 0 0 1px rgba(231,200,121,.5);}
`;

/** One face of the roster, as the page has it. */
type RosterFace = SerializeFrom<typeof loader>["roster"][number];
/** A face a picker offers, as its ID card needs it: who they are, and what picking them does THERE. */
type PeekTarget = { r: RosterFace; picked: boolean; pick: () => void; disabled: boolean };

/** What a face's ID card shows — through idCardOf, the one mapping the Presenters section uses too. */
function peekCard(x: PeekTarget, t: ReturnType<typeof useT>) {
  const c = x.r.card;
  if (!c) return null;
  return {
    ...idCardOf({ ...c, id: x.r.id, name: x.r.name, kind: x.r.kind, custom: x.r.custom }, t),
    // their figure turning on the card — its frames load only now, when a card is shown
    figure: <CastFigure spin={c.spin} img={c.cut || x.r.img} name={x.r.name} />,
  };
}

/** THE CAST ID CARD of the Movie Maker's pickers: ONE layer for all of them (see `peek` in FilmStudio).
 *  With a mouse, the card floats beside the face pointed at; after a finger's hold, the same card opens
 *  as a sheet. Both portal themselves to <body>. */
function CastPeek({ peek, targets }: { peek: ReturnType<typeof useCastPeek>; targets: Record<string, PeekTarget> }) {
  const t = useT();
  const held = peek.held ? targets[peek.held.id] : undefined;
  const pointed = !held && peek.at ? targets[peek.at.id] : undefined;
  // the face that was held is not on the page any more (its picker closed under it): nothing to show
  useEffect(() => { if (peek.held && !held) peek.close(); });
  if (held) return <CastPeekSheet key={peek.held?.id} x={held} onClose={peek.close} />;
  const card = pointed ? peekCard(pointed, t) : null;
  return card && peek.at ? <CastHoverCard key={peek.at.id} anchor={peek.at.anchor}><CastIdCard size="mini" {...card} /></CastHoverCard> : null;
}

/** The card as a sheet over the page, for a finger: the card, a close button, and ONE button that picks
 *  them ("Picked" when they already are). */
function CastPeekSheet({ x, onClose }: { x: PeekTarget; onClose: () => void }) {
  const t = useT();
  const ref = useModalA11y<HTMLDivElement>(true, onClose);
  // The finger that opened this is still on the glass. Whatever its lifting does is not a choice made
  // HERE: nothing in the sheet answers a click until a press has started inside it (a keyboard's click,
  // detail 0, always counts).
  const armed = useRef(false);
  const card = peekCard(x, t);
  if (!card) return null;
  return createPortal(
    <div className="fs-peek" onPointerDownCapture={() => { armed.current = true; }}
      onClickCapture={(e) => { if (!armed.current && e.detail !== 0) { e.preventDefault(); e.stopPropagation(); } }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="fs-peek-sheet" role="dialog" aria-modal="true" aria-label={x.r.name}>
        <div className="fs-peek-head">
          <button type="button" className="fs-peek-x" onClick={onClose} aria-label={t("Close")}><span aria-hidden="true">✕</span></button>
        </div>
        <CastIdCard size="mini" {...card} />
        <button type="button" className={`fs-peek-pick${x.picked ? " on" : ""}`} disabled={x.picked || x.disabled} onClick={() => { x.pick(); onClose(); }}>
          {x.picked ? <><Ico n="check" size={14} /> {t("Picked")}</> : t("Pick {name}", { name: x.r.name })}
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default function FilmStudio() {
  const d = useLoaderData<typeof loader>();
  // LIGHT unless this member chose the dark — and then this page is a movie theater (FS_THEATER)
  const theme = useTheme();
  // Who can be cast where. The Music Video is built around a real-looking singer, so it is offered
  // people only. A story's cast step offers whoever belongs in that kind of film, the likeliest first:
  // cartoon characters lead a Kids Cartoon (and no monster is offered to a children's show), monsters
  // lead a Horror Story; a cartoon character is not offered to the live-action formats, which would
  // redraw it as a real animal.
  const people = d.roster.filter((r) => r.kind === "person");
  // (…and, on the owner's account while it is being tried, monsters too — `mvCreatures` in the loader)
  const mvRoster = d.mvCreatures ? d.roster.filter((r) => r.kind === "person" || r.kind === "monster") : people;
  const rosterFor = (format: string) => {
    const order: Array<"person" | "cartoon" | "monster"> = format === "kidstv" ? ["cartoon", "person"] : format === "horror" ? ["monster", "person"] : ["person", "monster"];
    return order.flatMap((k) => d.roster.filter((r) => r.kind === k));
  };
  const t = useT();
  const nav = useNavigation();
  const navigate = useNavigate();
  const actionData = useActionData<typeof action>() as { ok?: boolean; queued?: string; cost?: number; error?: string } | undefined;
  const treatmentFetcher = useFetcher<{ treatment?: Treatment; error?: string }>();
  // Music Video STORYBOARD: pre-seed every scene's still (props placed) BEFORE paying for the video,
  // so the owner checks accuracy + the prop per scene and the render uses those EXACT stills (no surprise).
  // (`castCards`: a told story's own cast — the characters it invented, each with the portrait every scene
  //  it is in is drawn from; `castRef` is the same thing as a token, handed back unread)
  const sceneSeedsFetcher = useFetcher<{ ok?: boolean; sceneImgs?: (string | null)[]; sceneFaults?: (number | null)[]; sceneChecks?: unknown[]; treatment?: Treatment; propForScene?: Record<number, string>; artistRef?: string | null; castRef?: string | null; castCards?: StoryCastRef[]; error?: string }>();
  // (`visual`: the scene's words as rewritten for who is in it now — only when the re-roll changed them)
  const rerollSceneFetcher = useFetcher<{ ok?: boolean; sceneIndex?: number; img?: string; faults?: number | null; check?: unknown; visual?: string; castRef?: string | null; castCards?: StoryCastRef[]; error?: string }>();
  // Make-your-own prop: describe it → we generate a studio photo of it (free).
  const propMakerFetcher = useFetcher<{ img?: string; error?: string }>();
  // Make-your-own artist: describe a face → we generate a portrait (free), like the presenter forge.
  const artistMakerFetcher = useFetcher<{ img?: string; error?: string }>();
  // Wardrobe: generate the SAME avatar wearing a chosen outfit (identity locked), saved as a style.
  const outfitFetcher = useFetcher<{ img?: string; error?: string }>();
  const lookSyncFetcher = useFetcher<{ ok?: boolean; kept?: number }>(); // hands this browser's older looks to the server, once
  // (`faults`: how each cast picture fared when it was looked at — more than 0 = something was still off
  //  in the best of the tries, and the scene is flagged as worth a re-roll)
  const [seeds, setSeeds] = useState<{ imgs: (string | null)[]; treatment: Treatment; propForScene: Record<number, string>; artistRef: string | null; castRef: string | null; castRefs: string[]; faults?: (number | null)[]; checks?: unknown[]; castCards?: StoryCastRef[] } | null>(null);
  // Per-scene CO-STAR edit (owner): scene index → the co-star imgs featured in that scene (the artist
  // always leads a perform scene). Unset scenes fall back to an intelligent default (one rotating
  // co-star per perform scene) so the roster isn't crammed into every card.
  const [castForScene, setCastForScene] = useState<Record<number, string[]>>({});
  const [sceneCastPick, setSceneCastPick] = useState<number | null>(null);
  const [sceneCastDraft, setSceneCastDraft] = useState<string[]>([]);
  // (true for a moment while a KEPT music video is being put back — mv-draft.ts. Putting it back sets the
  //  idea, the cast, the shape … all at once, and each of those, changed by hand, rightly starts the
  //  storyboard over; changed by the restore they must not.)
  const restoring = useRef(false);
  // EDIT STORY: the finished story this storyboard was opened from (story-edit.ts) — while it lasts
  const [editing, setEditing] = useState<{ from: string; title: string; kept: boolean } | null>(null);
  // …and WHO SINGS it, staged the same way: the name of the co-star whose scene it becomes ("" = the star)
  const [sceneSingerDraft, setSceneSingerDraft] = useState<string>("");
  // PER-SCENE WARDROBE: scene index → cast member img → what they wear in THAT scene ("" = their own
  // look; a description = one of their saved outfits). No entry = their look for the whole video.
  const [sceneOutfits, setSceneOutfits] = useState<Record<number, Record<string, string>>>({});
  const [sceneWearDraft, setSceneWearDraft] = useState<Record<string, string>>({});
  const [sceneWearText, setSceneWearText] = useState<Record<string, string>>({}); // describe-an-outfit text, per person
  const [sceneWearNewFor, setSceneWearNewFor] = useState<string | null>(null); // whose "New look" box is open
  // Wardrobe (owner edit): cast member IMG → an outfit description. Applied when they're styled into
  // the genre, so they wear it for the whole video. Empty = keep their own look. The render keys on
  // this desc; `outfitPreview` holds a GENERATED thumbnail of the avatar wearing it (display + "saved
  // as a style"). The picker opens on an avatar's wardrobe icon (not a doomscroll list).
  const [outfits, setOutfits] = useState<Record<string, string>>({});
  // Saved generated outfits per avatar (a gallery) — persists across open/close so a generated outfit
  // is still there when you click out + back. Each = {desc (drives the render), img (the thumbnail)}.
  const [outfitStyles, setOutfitStyles] = useState<Record<string, Array<{ desc: string; img: string }>>>({});
  const [wardrobeOpen, setWardrobeOpen] = useState<string | null>(null); // which CAST member's outfit slider is open (artist's always shows)
  const [outfitBusyFor, setOutfitBusyFor] = useState<{ img: string; desc: string } | null>(null);
  const [outfitDrafts, setOutfitDrafts] = useState<Record<string, string>>({}); // describe-an-outfit text, per avatar
  // Wardrobe PERSISTS across reloads (it's keyed by avatar img, which is stable) — otherwise a generated
  // costume vanished the moment the page reloaded ("didn't save on my character"). localStorage, client-only.
  const wardrobeFirstPersist = useRef(true);
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    let local: Record<string, Array<{ desc: string; img: string }>> = {};
    try { const o = JSON.parse(localStorage.getItem("mm-wardrobe-v1") || "{}"); if (o && typeof o === "object") { if (o.outfitStyles && typeof o.outfitStyles === "object") local = o.outfitStyles; if (o.outfits && typeof o.outfits === "object") setOutfits(o.outfits); } } catch { /* ignore */ }
    // SAVED LOOKS (kept on the presenter — avatar-looks.ts) join the ones this browser holds: a look made
    // on another device, or in the Presenters section's own cast, is here too. This browser's own that
    // the server has never seen are handed over once, so they show on the presenter's card.
    const merged: Record<string, Array<{ desc: string; img: string }>> = { ...local };
    const adopt: Array<{ avatarId: string; desc: string; img: string }> = [];
    for (const r of d.roster) {
      const mine = (merged[r.img] || []).filter((s) => s && typeof s.desc === "string" && typeof s.img === "string");
      const kept = (d.savedLooks || {})[r.id] || [];
      for (const s of mine) if (!kept.some((k) => k.desc === s.desc)) adopt.push({ avatarId: r.id, desc: s.desc, img: s.img });
      const extra = kept.filter((k) => !mine.some((s) => s.desc === k.desc));
      if (mine.length || extra.length) merged[r.img] = [...mine, ...extra];
    }
    setOutfitStyles(merged);
    if (adopt.length) lookSyncFetcher.submit({ intent: "adoptOutfitLooks", looks: JSON.stringify(adopt.slice(0, 40)) }, { method: "post" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (wardrobeFirstPersist.current) { wardrobeFirstPersist.current = false; return; } // skip the initial empty write (would clobber the restore)
    if (typeof localStorage === "undefined") return;
    try { localStorage.setItem("mm-wardrobe-v1", JSON.stringify({ outfits, outfitStyles })); } catch { /* quota / private mode */ }
  }, [outfits, outfitStyles]);
  const [rerollingScene, setRerollingScene] = useState<number | null>(null);
  // DRAW ONE CHARACTER AGAIN (a told story's own cast): who is being redrawn, and the scenes that follow them
  const [recasting, setRecasting] = useState<{ name: string; scenes: number[] } | null>(null);
  const recastFetcher = useFetcher<{ ok?: boolean; recastName?: string; scenes?: number[]; sceneImgs?: (string | null)[]; sceneFaults?: (number | null)[]; sceneChecks?: unknown[]; castRef?: string | null; castCards?: StoryCastRef[]; error?: string }>();
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
  const TITLE_WORD = /^(the|chef|dr|doctor|mr|mrs|ms|miss|sir|madam|officer|detective|det|captain|capt|sergeant|sgt|professor|prof|coach|agent|father|mother|aunt|uncle|grandma|grandpa|king|queen|prince|princess|lord|lady|sister|brother|nurse|judge|mayor|pastor|reverend|rev)\.?$/i;
  const speakName = (entry: string) => {
    const head = (entry.split(/[,:—–]/)[0] || entry).trim();
    const words = head.split(/\s+/).filter(Boolean);
    return ((words.find((w) => !TITLE_WORD.test(w)) || words[0] || head) || "").slice(0, 40);
  };
  const deriveCast = (tr2: Treatment): CastMember[] => {
    // Two characters of the same gender get DIFFERENT voices. They both used to get that gender's first
    // voice — harmless while the voice was only a hint, but with the voices locked it made two people in
    // one scene speak with a single voice.
    // …and the pick now reads the character's AGE as well as gender (a child gets the young voice, an
    // elder the mature one) — see autoCastVoices.
    const entries = (Array.isArray(tr2.cast) ? tr2.cast : []).slice(0, 8);
    const picks = autoCastVoices(entries.map((entry) => ({ desc: entry, voiceId: null, auto: true })));
    return entries.map((entry, k) => ({
      name: speakName(entry) || entry.slice(0, 40), desc: entry.trim().slice(0, 300), faceUrl: null,
      voiceId: picks[k], autoVoice: true,
    }));
  };
  /** Re-pick the voices that were chosen FOR characters, around the ones that were chosen BY someone. */
  const rebalanceVoices = (list: CastMember[]): CastMember[] => {
    const picks = autoCastVoices(list.map((c) => ({ desc: c.desc, voiceId: c.voiceId, auto: !!c.autoVoice })));
    return list.map((c, k) => (c.autoVoice ? { ...c, voiceId: picks[k] } : c));
  };

  const [template, setTemplate] = useState(d.templates[0]?.key || "musicvideo");
  const tmpl = d.templates.find((x) => x.key === template) || d.templates[0];
  // …and the HERO it was opened as (film-heroes.ts): the template plus the way it is told. The heroes this
  // account is offered are the ones whose template it has (and, for a narrated one, that can be narrated).
  const heroes = heroesFor(d.templates.map((x) => x.key), d.narratable || []);
  const [heroId, setHeroId] = useState(() => FILM_HEROES.find((h) => h.tmpl === (d.templates[0]?.key || "musicvideo"))?.id || "musicvideo");
  // THE LYRIC VIDEO is open (its own builder, not a film template's — so the format it was opened over stays as it was)
  const [lyricOn, setLyricOn] = useState(false);
  const hero = lyricOn ? LYRIC_HERO : heroById(heroId);
  // The Veo dialogue pipeline supports the per-scene storyboard (approve each frame).
  const isStoryboard = !!tmpl?.dialogue; // any dialogue card (Short Film, Moral, Horror) → the chat-flow UI + dialogue engine
  // Test Movie can render its spoken dialogue on either engine: Veo (default,
  // short cinematic beats) or Kling 3 Omni (longer single takes, native lip-sync).
  // Only submitted for testmovie; the action ignores it for every other template.
  const [dialogueEngine, setDialogueEngine] = useState<"veo" | "kling3">("kling3");
  const [filmAspect, setFilmAspect] = useState<"9:16" | "16:9" | "1:1">("16:9");
  // Music Video output shape — its OWN state (defaults to the owner-validated 9:16; the picker lets them
  // choose 16:9 / 1:1). Kept separate from the dialogue-flow filmAspect so neither changes the other.
  const [mvAspect, setMvAspect] = useState<"9:16" | "16:9" | "1:1">("9:16");
  // …ONCE THE SCENES ARE DRAWN the shape is not a free choice any more: the pictures are drawn IN a
  // shape, so another one draws them all again and the storyboard's edits (words, cast, outfits, props,
  // re-rolls) start over. The buttons sit right above "Render", and one tap used to wipe the storyboard
  // without a word (seen on the live site, 2026-11-22). The first tap now says so and the second does
  // it — the app's own "Tap again to …" way of asking. With no scenes drawn yet it is one tap, as before.
  const [shapeArm, setShapeArm] = useState<"" | "9:16" | "16:9" | "1:1">("");
  const seedsDrawn = !!seeds;
  useEffect(() => { setShapeArm(""); }, [seedsDrawn, mvAspect]);
  const pickMvAspect = (a: "9:16" | "16:9" | "1:1") => {
    if (a === mvAspect) { setShapeArm(""); return; }
    if (seedsDrawn && shapeArm !== a) { setShapeArm(a); return; }
    setMvAspect(a);
  };
  // Music Video genre (lip-sync lane only) — drives the song + the artist/settings.
  const [filmGenre, setFilmGenre] = useState<string>(d.genres?.[0]?.key || "rap");
  // PACE — how fast the video is cut. "" = whatever the genre is cut at (rap fast, country slow); picking
  // one here holds it, whatever genre is chosen afterwards.
  const [pacePick, setPacePick] = useState<Pace | "">("");
  const mvPace: Pace = paceFor(filmGenre, pacePick);
  // LENGTH — picked in SECONDS (the owner: "by seconds and not scenes — that way there could potentially
  // be many scenes to come out and it works better with pace"). How many scenes that is follows from the
  // pace: a slow video is made of ten-second scenes, a medium or fast one of five-second scenes.
  const [mvSeconds, setMvSeconds] = useState<number>(MV_DEFAULT_SECONDS);
  const mvSceneSec = sceneSecondsFor(mvPace);
  // LYRICS ON SCREEN for the music video. Off unless picked: the format is a performance video, not a
  // karaoke one (film-engine: captions:false) — the lyrics are an option the maker turns on.
  const [mvLyrics, setMvLyrics] = useState<CaptionStyle>("off");
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
  // The CAST LIBRARY — additional named cast beyond the lead artist (co-stars, a love interest,
  // dancers). Faces come from the same pool (roster / your custom avatars); each gets a name, and on
  // the scenes below you pick which appear in each shot. The lead (artistPick) stays the star/singer.
  const [castExtra, setCastExtra] = useState<Array<{ img: string; name: string }>>([]);
  const addCastMemberMv = (img: string, name: string) => setCastExtra((c) => (c.some((m) => m.img === img) ? c.filter((m) => m.img !== img) : (c.length >= 2 ? c : [...c, { img, name: (name || "").trim() || `Cast ${c.length + 1}` }])));
  const renameCastMemberMv = (img: string, name: string) => setCastExtra((c) => c.map((m) => (m.img === img ? { ...m, name } : m)));
  useEffect(() => {
    if (artistMakerFetcher.state !== "idle" || !artistPendingRef.current) return;
    const img = artistMakerFetcher.data?.img;
    if (img) { artistPendingRef.current = false; const name = artistDesc.trim().slice(0, 24) || "Custom"; setCustomArtists((a) => [...a, { img, name }]); setArtistPick(img); setArtistDesc(""); setArtistMakerOpen(false); }
    else if (artistMakerFetcher.data?.error) { artistPendingRef.current = false; }
  }, [artistMakerFetcher.state, artistMakerFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Music Video card-builder: which summary step is expanded for editing (null = all collapsed).
  type CardKey = "artist" | "genre" | "song" | "props" | "length" | "pace";
  const [openCard, setOpenCard] = useState<CardKey | null>(null);
  // A numbered step flow: each step turns green once you've set it, so you move through 1→5 like a
  // guided checklist. Opening a step (and it already has a smart default) counts it as done.
  const [stepsDone, setStepsDone] = useState<Record<string, boolean>>({});
  const tapCard = (key: CardKey) => {
    setOpenCard((cur) => (cur === key ? null : key));
    setStepsDone((d) => (d[key] ? d : { ...d, [key]: true }));
  };
  const [topic, setTopic] = useState("");
  // (the music video's idea box grows with its text — CSS `field-sizing` where the browser has it; sized
  //  by hand where it does not, so the idea is never a wrapped line hidden under a one-row box)
  useEffect(() => {
    if (typeof document === "undefined" || (typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content"))) return;
    const el = document.getElementById("mm-topic-in") as HTMLTextAreaElement | null;
    if (el && el.tagName === "TEXTAREA") { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [topic, template]);
  // The merchant can PICK one of their avatars to BE the artist ("" = auto-cast one for the genre).
  const [artistPick, setArtistPick] = useState<string>("");
  const artistName = artistPick ? (d.roster.find((r) => r.img === artistPick)?.name || customArtists.find((c) => c.img === artistPick)?.name || "") : "";
  const castNames = castExtra.map((m) => (m.name || "").trim()).filter(Boolean);
  // Gender drives BOTH the sung VOICE (a female avatar must sing in a female voice — the tester's main
  // bug: "female character sing in male voice") and how the writer casts each person (no man in a
  // "girlfriend" role). Seeded from the roster's known gender; a toggle lets the owner set it for an
  // UPLOADED face whose gender we can't know.
  const genderOfImg = (img: string): "m" | "f" | null => { const g = (d.roster.find((r) => r.img === img) as { gender?: string } | undefined)?.gender; return g === "f" || g === "m" ? g : null; };
  const [artistGender, setArtistGender] = useState<"m" | "f">("m");
  useEffect(() => { const g = genderOfImg(artistPick); if (g) setArtistGender(g); }, [artistPick]); // eslint-disable-line react-hooks/exhaustive-deps
  const castGenders = castExtra.map((m) => ({ name: (m.name || "").trim(), gender: genderOfImg(m.img) })).filter((c): c is { name: string; gender: "m" | "f" } => !!c.name && !!c.gender);
  // Avatar-voice singing (opt-in beta): only when the picked artist is a CUSTOM avatar that has its own
  // MiniMax voice — then the song can be sung in THAT voice (the re-voice step). Library avatars keep the sung voice.
  const artistVoiceId = (d.roster.find((r) => r.img === artistPick) as { voiceId?: string | null } | undefined)?.voiceId || "";
  const [singVoice, setSingVoice] = useState(false);
  // A star on YOUR OWN voice sings in it by default (that's what the voice is for); a star on a stock
  // voice starts with the toggle off, as before. Either way it stays a switch the merchant can flip.
  useEffect(() => { if (restoring.current) return; setSingVoice(!!artistVoiceId && d.myVoices.some((v) => v.voiceId === artistVoiceId)); }, [artistVoiceId]); // eslint-disable-line react-hooks/exhaustive-deps
  // A FEATURED VERSE — a co-star SINGS part of the song, in their own voice (the owner: "another cast
  // member sings that part of the song in their voice like real music"). The maker turns it on for a
  // co-star; the writer gives them a verse and marks its scenes; the render re-voices that stretch of the
  // song as them and puts them on camera for it (mv-feature.ts). A co-star can be featured when they have
  // a voice of their own — every presenter does; a face that was only uploaded or drawn has none.
  const [featPick, setFeatPick] = useState<string[]>([]);
  /** does the person in this picture have a voice of their own to sing in? (which voice is the server's business) */
  const canSingImg = (img: string): boolean => !!(d.roster.find((r) => r.img === img) as { sing?: boolean } | undefined)?.sing;
  /** who CAN sing a verse: a co-star with a name and a voice of their own */
  const singable = castExtra.filter((m) => canSingImg(m.img) && !!(m.name || "").trim());
  const featured = singable.filter((m) => featPick.includes(m.img));
  const featKey = featured.map((m) => m.img).join(",");
  const featureJson = JSON.stringify(featured.map((m) => ({ name: m.name.trim() })));
  const toggleFeat = (img: string) => setFeatPick((p) => (p.includes(img) ? p.filter((x) => x !== img) : [...p, img]));
  const [scenes, setScenes] = useState(tmpl?.defaultScenes || 6);
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  // MUSIC VIDEO: the scene count is the picked seconds ÷ the pace's scene length. A song written for a
  // different number of scenes is a different song, so it is cleared with the count (the stills go with
  // `scenes`, in the effect further down).
  const mvWant = sceneCountFor(mvSeconds, mvSceneSec);
  useEffect(() => {
    if (!tmpl?.lipSyncSinger) return;
    const n = sceneCountFor(mvSeconds, mvSceneSec);
    setScenes(n);
    setTreatment((cur) => (cur && cur.scenes.length !== n ? null : cur));
  }, [mvSeconds, mvSceneSec, tmpl?.lipSyncSinger]); // eslint-disable-line react-hooks/exhaustive-deps
  // …and it STAYS that until a song exists. (Opening the format card reset the count to the format's
  // default — three — while the picker still said 30 seconds: "15s · 3 scenes", seen live 2026-11-21.
  // Whatever sets the count, with no song written it is the picked length's.)
  useEffect(() => {
    if (tmpl?.lipSyncSinger && !treatment && !seeds && scenes !== mvWant) setScenes(mvWant);
  }, [tmpl?.lipSyncSinger, treatment, seeds, scenes, mvWant]);
  // Product (skit): title + photo + (catalog) description.
  const [prodTitle, setProdTitle] = useState("");
  const [prodImage, setProdImage] = useState("");
  const [prodDesc, setProdDesc] = useState("");

  // ───── The STORY builder (Short Film · Moral Story · Horror Story · Kids Cartoon) ─────
  // The same tap-a-card flow as the Music Video (the owner: "we need the other film creators to have
  // the same setup as music video with all of the bells and whistle pickers").
  type StoryCard = "cast" | "told" | "length" | "shape" | "captions" | "voice" | "motion";
  // THE LADDER's first two rungs (story-motion.ts): do a told story's pictures move? They do unless its maker
  // says otherwise — and the choice is only offered where the server can make them move at all.
  const [pictures, setPictures] = useState<StoryPictures>("moving");
  const [storyCard, setStoryCard] = useState<StoryCard | null>(null);
  const [storyDone, setStoryDone] = useState<Record<string, boolean>>({});
  const tapStory = (key: StoryCard) => { setStoryCard((cur) => (cur === key ? null : key)); setStoryDone((sd) => (sd[key] ? sd : { ...sd, [key]: true })); };
  // HOW IT'S TOLD: acted (the cast speak on camera) or narrated (a storyteller's voice over a picture
  // for every scene, the words on screen — quick, and the format story channels are built on).
  const [told, setTold] = useState<"acted" | "narrated">("acted");
  const canTell = !!tmpl?.dialogue && (d.narratable || []).includes(template);
  const narrated = canTell && told === "narrated";
  // WHO'S IN IT: picked from the cast BEFORE a word is written, so the story is written FOR them.
  const [storyPick, setStoryPick] = useState<string[]>([]);
  const maxPick = narrated ? 3 : 2; // three pictures is the most a scene can be drawn from; a spoken scene is two people
  const pickedCast = storyPick.map((id) => d.roster.find((r) => r.id === id)).filter((r): r is (typeof d.roster)[number] => !!r);
  const filmCastJson = JSON.stringify(pickedCast.map((r) => ({ name: r.name, faceUrl: r.img, kind: r.kind, look: r.look, voiceId: r.voiceId })));
  const toggleStoryPick = (id: string) => setStoryPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= maxPick ? p : [...p, id]));
  // THE NARRATOR ("" = the format's own: a hollow voice for horror, a warm one for a moral…)
  const [narrPick, setNarrPick] = useState("");
  const narratorId = narrPick || (d.defaultNarrator as Record<string, string>)[template] || "English_Trustworth_Man";
  const narratorName = CHARACTER_VOICES.find((v) => v.id === narratorId)?.label || d.voices.find((v) => v.id === narratorId)?.label || d.myVoices.find((v) => v.voiceId === narratorId)?.label || "";
  // CAPTIONS ("" = the usual for the way it is told: big words on a narrated story, none on an acted film)
  const [capPick, setCapPick] = useState<CaptionStyle | "">("");
  const captions: CaptionStyle = capPick || (narrated ? "bold" : "off");
  // NEXT EPISODE (film-series.ts): the film this one continues — its series' title and this episode's
  // number, shown above the idea box; only `from` (the earlier film's id) is sent, the server reads the
  // rest from that film itself. null = an ordinary new film.
  const [series, setSeries] = useState<{ from: string; title: string; episode: number } | null>(null);
  // …and the cast as that film had it (face + voice, by name): when the script comes back, each character
  // who is still in it by name gets the same face and the same voice again
  const [seriesCast, setSeriesCast] = useState<NextEpisodeCard["setup"]["cast"]>([]);
  // …and the characters the last episode INVENTED, who come back with the faces they had (a told story)
  const [seriesOwn, setSeriesOwn] = useState<NextEpisodeCard["setup"]["returning"]>([]);
  const castFromSeries = (list: CastMember[]): CastMember[] => {
    if (!series || !seriesCast.length) return list;
    return rebalanceVoices(list.map((c) => {
      const was = seriesCast.find((m) => nameTok(m.name) === nameTok(c.name));
      if (!was) return c;
      const face = !c.faceUrl && was.faceUrl ? { faceUrl: was.faceUrl, ...(was.kind ? { kind: was.kind, look: was.look } : {}) } : {};
      const voice = was.voiceId ? { voiceId: was.voiceId, autoVoice: false } : {};
      return { ...c, ...face, ...voice };
    }));
  };
  // a different cast, or a different way of telling it, is a different story: script and pictures start over
  useEffect(() => { setTreatment(null); setSeeds(null); setFrames([]); setCast([]); }, [told, storyPick.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tmpl?.dialogue) return;
    // (a next episode is opened with its own length, cast and shape: those are set with it)
    if (restoring.current) return;
    setScenes(told === "narrated" && canTell ? d.narratedScenes.def : (tmpl?.defaultScenes || 4));
    setStoryPick((p) => p.slice(0, told === "narrated" ? 3 : 2));
    // a narrated story is made for a phone, an acted film for a wide screen — until the maker picks a shape
    if (!storyDone.shape) setFilmAspect(told === "narrated" && canTell ? "9:16" : "16:9");
  }, [told]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The characters the maker picked arrive in the script's cast (the Cast step's panel) already wearing their own face and voice. */
  const castFromPicked = (list: CastMember[]): CastMember[] => {
    if (!pickedCast.length) return list;
    return rebalanceVoices(list.map((c) => {
      const p = pickedCast.find((r) => nameTok(r.name) === nameTok(c.name));
      return p ? { ...c, faceUrl: p.img, kind: p.kind, look: p.look, ...(p.voiceId ? { voiceId: p.voiceId, autoVoice: false } : {}) } : c;
    }));
  };
  const setStoryLen = (n: number) => { setScenes(n); if (treatment && treatment.scenes.length !== n) { setTreatment(null); setFrames([]); setCast([]); } };
  // A TAP THAT WOULD THROW THE STORY AWAY ASKS FIRST. Another face, another way of telling it, another
  // length or "Rewrite" starts the script over — rightly: it is a different story — but it did so on ONE
  // tap, with a written (and often hand-edited) script, its casting and its drawn pictures on the page, and
  // not a word said (audit of the story formats, 2026-11-22). The first tap now only says what it will do;
  // the second does it — the app's own "tap again" way of asking. With nothing written yet it is one tap.
  const [wipeArm, setWipeArm] = useState("");
  const storyHasWork = !tmpl?.lipSyncSinger && (!!treatment || !!seeds);
  useEffect(() => { setWipeArm(""); }, [storyCard, template, storyHasWork]);
  const orArm = (key: string, wipes: boolean, go: () => void) => {
    if (!wipes || !storyHasWork || wipeArm === key) { setWipeArm(""); go(); } else setWipeArm(key);
  };
  const wipeNote = (prefix: string) => (wipeArm.startsWith(prefix)
    ? <p className="mm-note mm-shape-warn" role="status">{t("That starts your script over — tap it again to go ahead.")}</p>
    : null);
  // ONE PLACE TO CAST A FILM (2026-11-25). The owner, with photos of the page: "It looks like there is two
  // cast selection cards per story (Bottom one comes across as extra)", and after trying a Moral Film: "again
  // moral film also expands the second cast option at the bottom, but we can do this in the top". The Cast
  // step picked who stars BEFORE a script existed, and once one was written a whole second section — "Cast
  // your movie" — opened lower down for the script's characters: two places for one decision. The STEP is
  // now the only one. Before a script its panel is what it was (we cast it, or pick who stars); once an
  // acted film HAS a script (`scripted`) the same panel holds the script's characters — a face, a look and
  // a voice each — and the card above it says who they are and how many have a face.
  const scripted = !!treatment && isStoryboard && !narrated && cast.length > 0;
  // "Start over with different stars": the picker of before the script, behind one quiet line. A pick there
  // writes a different story (the effect above wipes the script), so it is not laid beside the characters
  // it would throw away — it is opened on purpose, its faces still ask twice (`orArm`), and it closes
  // again with the script it replaced.
  const [castOver, setCastOver] = useState(false);
  useEffect(() => { if (!scripted) setCastOver(false); }, [scripted]);
  // THE CARD ASKS ONCE. A script that has just arrived pulses the Cast card once and puts one quiet line on
  // it — "tap to give them faces (optional)" — until the step HAS been opened once since (`castSeen`).
  // Nothing opens by itself and nothing waits on it: Generate invents a face for anyone left without one,
  // as it always did.
  const [castSeen, setCastSeen] = useState(false);
  useEffect(() => { if (!scripted) setCastSeen(false); else if (storyCard === "cast") setCastSeen(true); }, [scripted, storyCard]);
  // …and the pulse is kept for when the card can be SEEN (`castLit`): on a phone the script is written from
  // the card BELOW the steps, with this one scrolled off the top — a pulse nobody is looking at is no pulse.
  const castCardRef = useRef<HTMLButtonElement | null>(null);
  const [castLit, setCastLit] = useState(false);
  useEffect(() => {
    if (!scripted || castSeen) { setCastLit(false); return; }
    const el = castCardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { setCastLit(true); return; }
    const io = new IntersectionObserver((seen) => { if (seen.some((e) => e.isIntersecting)) { setCastLit(true); io.disconnect(); } }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, [scripted, castSeen]);
  // THE LANGUAGE A STORY IS TOLD IN (content-lang.ts) — written, spoken and captioned. It is the account's
  // content language (the Studio's "Writing in" is the same setting), picked here for the story formats and
  // sent with every write and with the render (the action → askedLang). A story already written in another
  // language starts over — its words ARE the story — asked first, like every other start-over. Not for a
  // sung format (its song's language is the music model's), nor for a finished story being edited (it keeps
  // its own).
  const langOn = isStoryboard && !tmpl?.lipSyncSinger && !tmpl?.sung && !editing;
  const langFetcher = useFetcher();
  const [storyLang, setStoryLang] = useState<string>(d.outputLang);
  const pickStoryLang = (code: string) => {
    if (code === storyLang) { setWipeArm(""); return; }
    orArm(`lang:${code}`, true, () => {
      setStoryLang(code);
      langFetcher.submit({ intent: "setLang", contentLang: code }, { method: "post", action: "/web" });
      setTreatment(null); setSeeds(null); setFrames([]); setCast([]);
    });
  };
  /** A REWRITE KEEPS ITS CASTING: whoever is still in the story BY NAME keeps the face and the voice the
   *  maker gave them (a rewrite used to hand back a blank cast, every portrait and voice to be picked again). */
  const keepCasting = (next: CastMember[], prev: CastMember[]): CastMember[] => {
    if (!prev.length) return next;
    return rebalanceVoices(next.map((c) => {
      const was = prev.find((p) => nameTok(p.name) === nameTok(c.name));
      if (!was) return c;
      const face = !c.faceUrl && was.faceUrl ? { faceUrl: was.faceUrl, kind: was.kind, look: was.look } : {};
      const voice = was.voiceId && was.autoVoice === false && c.autoVoice !== false ? { voiceId: was.voiceId, autoVoice: false } : {};
      return { ...c, ...face, ...voice };
    }));
  };
  // THE IDEA BOX DOES NOT THROW WORK AWAY. Typing in it wiped the drawn scenes on the first keystroke (and,
  // in a music video, the song with them): one stray letter cost a storyboard. What is made now stays until
  // the maker starts it over — a line under the box says so, and starting over uses the new idea.
  const [ideaChanged, setIdeaChanged] = useState(false);
  /* THE WRITER'S NUDGE (2026-11-25). The owner: "the "write your dialogue" button generates a random scene and
   * dialogue, atleast need a starter "nudge" couple sentences to hand to the writer". The box said "…or leave
   * blank and we'll surprise you", and a blank box got a film about nothing its maker had in mind. Now a story
   * format deals three of its genre's starters under the box (StarterNudges; "More ideas" deals three others),
   * and an EMPTY box never reaches the writer: "Write" and Generate put the cursor in the box instead, say so,
   * and stir the starters once (`nudgeUrge`).
   * EXCEPT A NEXT EPISODE: there an empty box is the normal case — the last episode's ending and its recap ARE
   * the idea (the owner: "need the ability to pick up where left off to continue") — so the writer is called.
   * (And a finished story opened to be edited has its own words; a sung format has no starters.) */
  const nudgeable = isStoryboard && !tmpl?.lipSyncSinger && !series && !editing && dealStarters(template, 0, 1).length > 0;
  const [nudgeSeed, setNudgeSeed] = useState(0);
  const [nudgeUrge, setNudgeUrge] = useState(false);
  // (a different hand of starters each visit — dealt in the browser, so the page the server drew is the same)
  useEffect(() => { setNudgeSeed(Math.floor(Math.random() * 1e6)); }, []);
  useEffect(() => { setNudgeUrge(false); }, [template, series?.from]);
  /** No idea in the box, and this format wants one: the box asks instead of the writer being called. */
  const noIdeaYet = () => {
    if (!nudgeable || topic.trim()) return false;
    // (urged again while it already was: the stir is played again)
    if (nudgeUrge) { setNudgeUrge(false); window.requestAnimationFrame(() => setNudgeUrge(true)); } else setNudgeUrge(true);
    const box = document.getElementById("fs-topic-in");
    if (box) {
      const reduce = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      box.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      box.focus({ preventScroll: true });
    }
    return true;
  };
  // the idea the writer was last sent, and the box as the server's starter filled it (THE NUDGE COMES BACK)
  const sentTopic = useRef("");
  const nudgeFilled = useRef<string | null>(null);

  // When a fresh treatment arrives, adopt it (and lock the scene count to it) + cast.
  useEffect(() => {
    const tr2 = treatmentFetcher.data?.treatment;
    if (tr2 && tr2.scenes?.length) { setTreatment(tr2); setScenes(tr2.scenes.length); setFrames([]); setCast((prev) => keepCasting(castFromSeries(castFromPicked(deriveCast(tr2))), prev)); setIdeaChanged(false); }
  }, [treatmentFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // THE NUDGE COMES BACK (nudgeFill): the server wrote from a starter it dealt — the box now holds it, said in
  // the member's language, to be read and changed. Only while the box is what was sent (typed since: theirs).
  useEffect(() => {
    const tr2 = treatmentFetcher.data?.treatment;
    if (!tr2?.nudge || !tr2.scenes?.length || topic !== sentTopic.current) return;
    const fill = nudgeFill(t(tr2.nudge), tr2.nudge, sentTopic.current);
    nudgeFilled.current = fill;
    setTopic(fill);
  }, [treatmentFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Store each actor's portrait as it's cast; clear the busy flag.
  useEffect(() => {
    if (portraitFetcher.state !== "idle") return;
    const data = portraitFetcher.data;
    if (data && data.portraitUrl && typeof data.castIndex === "number") {
      const idx = data.castIndex, url = data.portraitUrl;
      setCast((prev) => prev.map((c, j) => (j === idx ? { ...c, faceUrl: url, kind: undefined, look: undefined } : c)));
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
  // How many scenes the music video has RIGHT NOW: the storyboard's own count once it exists (the maker
  // can add and remove scenes there), else the song's, else what the picked length works out to.
  const mvSceneCount = seeds?.treatment.scenes.length || treatment?.scenes.length || scenes;
  // Everyone who SINGS a verse in the video as it stands — the co-stars asked for one, and any the maker
  // gave a scene to in the storyboard. Their voices ride with the render.
  const scenesNow: Scene[] = seeds?.treatment.scenes || treatment?.scenes || [];
  const singingNow = singable.filter((m) => featPick.includes(m.img) || scenesNow.some((s) => singerOf(s, [m.name]) === 0));
  const featureAllJson = JSON.stringify(singingNow.map((m) => ({ name: m.name.trim() })));
  /** a video this short has no room to share (the artist needs a turn too) */
  const tooShortToFeature = mvSceneCount * mvSceneSec < FEATURE_MIN_SECONDS;
  // (a music video is priced by its length: two five-second scenes are one ten-second scene's worth)
  const cost = estimateFilmTokens(tmpl?.lipSyncSinger ? mvBillScenes(mvSceneCount, mvSceneSec) : scenes);
  const affordable = d.tokens >= cost;
  const productReady = !tmpl?.needsProduct || !!prodImage.trim();
  const canGo = d.hasPlan && d.canFilm && affordable && productReady && !generating;
  // THE BUTTON SAYS IT WORKED. "Render these scenes" used to go straight back to itself, live, the moment
  // the render was queued — the only sign was a line under it, and a second tap queued the same video
  // again. It now stays "Rendering…" for the storyboard that was SENT, and comes back the moment anything
  // in it changes (a re-roll, a new line, another shape): that is a different video.
  const renderSig = seeds ? JSON.stringify([seeds.imgs, seeds.treatment, mvAspect, mvLyrics, mvPace]) : "";
  const sigAtSubmit = useRef("");
  const [sentSig, setSentSig] = useState("");
  useEffect(() => { if (actionData?.ok && sigAtSubmit.current) setSentSig(sigAtSubmit.current); }, [actionData]);
  const alreadySent = !!renderSig && sentSig === renderSig;

  // A MUSIC VIDEO IN THE MAKING IS KEPT (mv-draft.ts). The song, the pictures, who is in each and what
  // they wear lived only in the open page: a refresh lost them, and so did every update we shipped (the
  // next tap landed on "EasyMode just updated", and its reload came back to an empty Movie Maker).
  //  · written to this browser whenever a storyboard changes — never erased here: a kept video is
  //    replaced only by the next storyboard, or by its own age;
  //  · found on arrival and OFFERED (one card) — never put back unasked;
  //  · "Not now" only puts the card away.
  const [draft, setDraft] = useState<MvDraft | null>(null);
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    let kept: MvDraft | null = null;
    try { kept = readDraft(localStorage.getItem(MV_DRAFT_KEY), Date.now()); } catch { kept = null; }
    if (kept && d.templates.some((x) => x.key === kept!.template && x.lipSyncSinger)) setDraft(kept);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (typeof localStorage === "undefined" || !tmpl?.lipSyncSinger || !seeds) return;
    const text = packDraft({ template, topic, genre: filmGenre, pace: pacePick, seconds: mvSeconds, scenes, aspect: mvAspect, lyrics: mvLyrics, artist: artistPick, artistGender, singVoice, customArtists, cast: castExtra, feat: featPick, props: filmProps, customProps, songSource, songUrl: filmSongUrl, seeds, castForScene, sceneOutfits }, Date.now());
    if (!text) return;
    try { localStorage.setItem(MV_DRAFT_KEY, text); } catch { /* quota / private mode */ }
  }, [template, topic, filmGenre, pacePick, mvSeconds, scenes, mvAspect, mvLyrics, artistPick, artistGender, singVoice, customArtists, castExtra, featPick, filmProps, customProps, songSource, filmSongUrl, seeds, castForScene, sceneOutfits]); // eslint-disable-line react-hooks/exhaustive-deps
  const resumeDraft = () => {
    const k = draft;
    if (!k) return;
    restoring.current = true;
    window.setTimeout(() => { restoring.current = false; }, 600);
    setTemplate(k.template); setHeroId(FILM_HEROES.find((h) => h.tmpl === k.template)?.id || k.template); setEntered(true); setAnim(""); setZoomKey(null);
    setTopic(k.topic); if (k.genre) setFilmGenre(k.genre); setPacePick(isPace(k.pace) ? k.pace : ""); if (k.seconds) setMvSeconds(k.seconds); setScenes(k.scenes);
    setMvAspect(k.aspect); setMvLyrics(k.lyrics === "bold" || k.lyrics === "subtitles" ? k.lyrics : "off");
    setCustomArtists((cur) => [...cur, ...k.customArtists.filter((c) => !cur.some((x) => x.img === c.img))]);
    setArtistPick(k.artist); setArtistGender(k.artistGender); setSingVoice(k.singVoice);
    setCastExtra(k.cast); setFeatPick(k.feat); setFilmProps(k.props); setCustomProps(k.customProps); setSongSource(k.songSource); setFilmSongUrl(k.songUrl);
    setTreatment(k.seeds.treatment as unknown as Treatment);
    setSeeds(k.seeds as unknown as NonNullable<typeof seeds>);
    setCastForScene(k.castForScene); setSceneOutfits(k.sceneOutfits);
    setDraft(null);
  };

  const bump = (delta: number) => {
    const n = Math.max(tmpl.minScenes, Math.min(tmpl.maxScenes, scenes + delta));
    setScenes(n);
    if (treatment && treatment.scenes.length !== n) { setTreatment(null); setFrames([]); setCast([]); }
  };
  // A HERO is a format AS IT IS TOLD (film-heroes.ts): the way a story is told — acted, or narrated — is
  // part of what was picked on the grid, not a switch in here (the owner, 2026-11-22: "we don't use a
  // toggle but create a new hero"). Opening one sets the engine's template AND how it is told; the length
  // and the shape that go with that way of telling are set here too, since the effect that follows `told`
  // does not run when two heroes in a row are told the same way.
  const switchHero = (id: string) => {
    const h = heroById(id);
    if (!h) return;
    const nt = d.templates.find((x) => x.key === h.tmpl);
    const openNarrated = !!nt?.dialogue && h.told === "narrated" && (d.narratable || []).includes(h.tmpl);
    setHeroId(h.id);
    setTemplate(h.tmpl); setScenes(nt?.lipSyncSinger ? mvWant : openNarrated ? d.narratedScenes.def : (nt?.defaultScenes || 6)); setTreatment(null); setFrames([]); setCast([]);
    setTold(openNarrated ? "narrated" : "acted"); setStoryPick([]); setNarrPick(""); setCapPick(""); setStoryCard(null); setStoryDone({}); setPictures("moving");
    if (nt?.dialogue) setFilmAspect(openNarrated ? "9:16" : "16:9");
    // another format is an ordinary new film (a next episode sets its series again right after this)
    setSeries(null); setSeriesCast([]); setSeriesOwn([]);
  };
  // NEXT EPISODE — one tap on a card of the "Next episode" row (film-series.ts): open that film's format
  // with everything set as it was for that film — the same cast (same people, same order), length, shape,
  // captions, and narrator or camera and voices — an empty idea box, and the series it continues.
  const startEpisode = (c: NextEpisodeCard) => {
    const h = heroById(c.heroId);
    if (!h || !heroes.some((x) => x.id === h.id)) return;
    const reduce = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setAnim("in");
    window.setTimeout(() => {
      // (the hero's own defaults — its length and shape — must not land on top of the episode's)
      restoring.current = true;
      window.setTimeout(() => { restoring.current = false; }, 600);
      switchHero(h.id);
      const nt = d.templates.find((x) => x.key === h.tmpl);
      const isNarr = h.told === "narrated";
      const s = c.setup;
      const done: Record<string, boolean> = {};
      // the same roster members, in the same order (a face no longer in the roster is left out)
      const ids = s.cast.map((m) => (m.faceUrl ? d.roster.find((r) => r.img === m.faceUrl)?.id : undefined)).filter((x): x is string => !!x);
      const pick = ids.filter((x, k) => ids.indexOf(x) === k).slice(0, isNarr ? 3 : 2);
      if (pick.length) { setStoryPick(pick); done.cast = true; }
      setSeriesCast(s.cast);
      setSeriesOwn(isNarr ? (s.returning || []) : []);
      if (s.scenes) {
        setScenes(isNarr ? Math.max(d.narratedScenes.min, Math.min(d.narratedScenes.max, s.scenes)) : Math.max(nt?.minScenes || 1, Math.min(nt?.maxScenes || s.scenes, s.scenes)));
        done.length = true;
      }
      if (s.aspect) { setFilmAspect(s.aspect); done.shape = true; }
      const cap = CAPTION_STYLES.find((k) => k.key === s.captions);
      if (cap) { setCapPick(cap.key); done.captions = true; }
      if (isNarr && s.narrator && (CHARACTER_VOICES.some((v) => v.id === s.narrator) || d.voices.some((v) => v.id === s.narrator) || d.myVoices.some((v) => v.voiceId === s.narrator))) { setNarrPick(s.narrator); done.voice = true; }
      if (!isNarr && s.engine) { setDialogueEngine(s.engine); done.voice = true; }
      if (!isNarr) setLockVoices(s.lockVoices);
      setStoryDone(done);
      setTopic(""); setIdeaChanged(false);
      setSeries({ from: c.from, title: c.title, episode: c.episode });
      setEntered(true); setAnim(""); setZoomKey(null);
    }, reduce ? 0 : 400);
  };
  /** ✕ on the episode line: drop the link — an ordinary new film. (What was already written for the episode
   *  was written AS the episode, so it starts over — asked first, the page's own "tap again" way.) */
  const dropSeries = () => orArm("series:", storyHasWork, () => {
    setSeries(null); setSeriesCast([]); setSeriesOwn([]);
    if (storyHasWork) { setTreatment(null); setSeeds(null); setFrames([]); setCast([]); }
  });
  // "NEXT EPISODE", ASKED FROM THE FILM ITSELF: the Archive viewer's button opens this page with
  // ?episode=<that film's id>, and the loader hands back the card for its series' latest episode
  // (d.openEpisode). Its setup opens by itself, once — and the address is tidied THROUGH THE ROUTER, so a
  // refresh starts from the posters instead of opening the episode again. (Tidying it behind the router's
  // back with history.replaceState did not hold: the router put ?episode= back on its next navigation —
  // seen live the moment Generate was pressed.)
  const openedEpisode = useRef(false);
  useEffect(() => {
    if (!d.openEpisode || openedEpisode.current) return;
    openedEpisode.current = true;
    startEpisode(d.openEpisode);
    navigate("/web/film", { replace: true, preventScrollReset: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // EDIT STORY — a finished narrated story, opened in THIS storyboard (story-edit.ts). The Archive viewer's
  // button lands here with ?edit=<its id>; the loader hands back its words and the pictures it was made
  // with (d.openStory). It opens by itself, once; Generate then tells it again as a new piece, and only a
  // picture that is missing is drawn. Its format, shape, captions, narrator and cast are set as they were.
  const startEdit = (st: StoryToEdit) => {
    const h = heroById(st.heroId);
    if (!h || !heroes.some((x) => x.id === h.id)) return;
    const reduce = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setAnim("in");
    window.setTimeout(() => {
      // (the hero's own defaults — its length and shape — must not land on top of the story's)
      restoring.current = true;
      window.setTimeout(() => { restoring.current = false; }, 600);
      switchHero(h.id);
      const done: Record<string, boolean> = { length: true, shape: true, captions: true };
      const ids = st.cast.map((m) => (m.faceUrl ? d.roster.find((r) => r.img === m.faceUrl)?.id : undefined)).filter((x): x is string => !!x);
      const pick = ids.filter((x, k) => ids.indexOf(x) === k).slice(0, 3);
      if (pick.length) { setStoryPick(pick); done.cast = true; }
      setScenes(Math.max(d.narratedScenes.min, Math.min(d.narratedScenes.max, st.treatment.scenes.length)));
      setFilmAspect(st.aspect);
      setCapPick(st.captions);
      if (st.narrator && (CHARACTER_VOICES.some((v) => v.id === st.narrator) || d.voices.some((v) => v.id === st.narrator) || d.myVoices.some((v) => v.voiceId === st.narrator))) { setNarrPick(st.narrator); done.voice = true; }
      setStoryDone(done);
      setTopic(st.topic); setIdeaChanged(false);
      // The storyboard itself goes in a moment LATER: the effects that clear it when the way of telling,
      // the cast or the shape changes run on the changes just made, and would take it away again.
      window.setTimeout(() => {
        setTreatment(st.treatment);
        setSeeds({ imgs: st.pictures, treatment: st.treatment, propForScene: {}, artistRef: null, castRef: st.castRef || null, castRefs: [], faults: [], checks: [], castCards: st.ownCast || [] });
        setEditing({ from: st.from, title: st.title, kept: st.picturesKept });
        setIdeaChanged(false);
        setEntered(true); setAnim(""); setZoomKey(null);
      }, 160);
    }, reduce ? 0 : 400);
  };
  const openedStory = useRef(false);
  useEffect(() => {
    if (!d.openStory || openedStory.current) return;
    openedStory.current = true;
    startEdit(d.openStory);
    navigate("/web/film", { replace: true, preventScrollReset: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // …and the edit lasts as long as the storyboard it loaded: start over, another format or another way
  // of telling is an ordinary new story again
  useEffect(() => { if (!seeds) setEditing(null); }, [seeds]);
  // Cinematic format entry: you land on the poster GRID; tap a card and IT zooms in while the
  // other cards are thrown away, then it becomes that format's builder. Back reverses it.
  const [entered, setEntered] = useState(false);
  const [zoomKey, setZoomKey] = useState<string | null>(null);
  const [anim, setAnim] = useState<"" | "in" | "out">("");
  // which format the hero's reel is showing off right now ("" = its opening clip)
  const [reelKey, setReelKey] = useState("");
  const enterFormat = (key: string) => {
    // Clean, robust transition (the old fly-to-viewport-center math glitched the card up into the hero,
    // worse now the layout is full-bleed): the tapped card POPS in place + the others recede, then the
    // format's own banner + builder fade in where the hero was. No position math to get wrong.
    const reduce = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setZoomKey(key); setAnim("in");
    // (the Lyric Video is not a film hero — switchHero passes it by — so opening it is said here, and the format
    //  that was open before it is kept as it was)
    setLyricOn(key === LYRIC_HERO.id);
    // (going back to the posters and into the SAME format again keeps what was being made there: it used to
    //  come back blank — script, cast and pictures gone — because every entry reset the builder)
    // (`key` is a hero's id; two heroes can share a template — Horror Story and Horror Film — so the test
    //  is on the hero, not the template)
    window.setTimeout(() => { if (key !== heroId) switchHero(key); setEntered(true); setAnim(""); setZoomKey(null); }, reduce ? 0 : 400);
  };
  const exitFormat = () => {
    setAnim("out");
    window.setTimeout(() => { setEntered(false); setAnim(""); setLyricOn(false); }, 300);
  };
  /* A WIDE SCREEN'S ARROWS (FS_SHELF_GO, 2026-11-25): each shelf is told which way its row can still go
   * (data-moved: it has left its start; data-end: it is at its end) and where its pictures' middle is (--go-y,
   * from the shelf's top: the row's top, its air above the posters, half a picture) — on arrival, on every
   * scroll of a row, and when the window or the fonts change the layout. Only attributes of the shelf are
   * written; nothing here moves a row. */
  useEffect(() => {
    if (entered) return;
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".fs-shelf .fs-fmtgrid"));
    const ends = (row: HTMLElement) => {
      const shelf = row.parentElement;
      if (!shelf) return;
      const x = Math.abs(row.scrollLeft);
      shelf.toggleAttribute("data-moved", x > 2);
      shelf.toggleAttribute("data-end", x >= row.scrollWidth - row.clientWidth - 2);
    };
    const place = () => rows.forEach((row) => {
      const pic = row.querySelector<HTMLElement>(".fs-fmt-cover");
      if (pic && row.parentElement) row.parentElement.style.setProperty("--go-y", `${Math.round(row.offsetTop + (parseFloat(getComputedStyle(row).paddingTop) || 0) + pic.offsetHeight / 2)}px`);
      ends(row);
    });
    const onScroll = (e: Event) => ends(e.currentTarget as HTMLElement);
    rows.forEach((row) => row.addEventListener("scroll", onScroll, { passive: true }));
    window.addEventListener("resize", place);
    place();
    let live = true;
    document.fonts?.ready.then(() => { if (live) place(); }).catch(() => undefined);
    return () => { live = false; rows.forEach((row) => row.removeEventListener("scroll", onScroll)); window.removeEventListener("resize", place); };
  }, [entered, heroes.length, d.lyricVideo, d.foundFootage]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickCatalog = (idx: number) => {
    const p = d.products[idx];
    if (!p) return;
    setProdTitle(p.title || ""); setProdImage(p.imageUrl || ""); setProdDesc(p.description || "");
    setTreatment(null); setFrames([]); setCast([]);
  };
  const writeTreatment = () => {
    // (THE WRITER'S NUDGE: an empty box asks for an idea instead — but a next episode's is the last one's ending)
    if (noIdeaYet()) return;
    sentTopic.current = topic;
    treatmentFetcher.submit(
      { intent: "previewFilmTreatment", template, filmTopic: topic, filmScenes: String(scenes), ...(tmpl?.lipSyncSinger ? { filmSceneSeconds: String(mvSceneSec) } : {}), ...(tmpl?.lipSyncSinger && featured.length ? { filmFeature: featureJson } : {}), filmGenre, filmProductTitle: prodTitle, filmProductImageUrl: prodImage, filmProductDescription: prodDesc, ...(artistName ? { filmArtistName: artistName } : {}), ...(castNames.length ? { filmCastNames: JSON.stringify(castNames) } : {}), ...(artistGender ? { filmArtistGender: artistGender } : {}), ...(castGenders.length ? { filmCastGenders: JSON.stringify(castGenders) } : {}), ...(narrated ? { filmMode: "narrated" } : {}), ...(!tmpl?.lipSyncSinger && pickedCast.length ? { filmCast: filmCastJson } : {}), ...(series && isStoryboard ? { seriesFrom: series.from } : {}), ...(langOn ? { filmLang: storyLang } : {}) },
      { method: "post" }
    );
  };
  // Pre-seed the storyboard: render every scene's still (props placed) for approval before paying.
  const firePreviewScenes = (tr?: Treatment | null) => {
    const useTr = tr || treatment;
    sceneSeedsFetcher.submit(
      { intent: "previewFilmScenes", template, filmTopic: topic, filmScenes: String(scenes), ...(tmpl?.lipSyncSinger ? { filmSceneSeconds: String(mvSceneSec) } : {}), ...(tmpl?.lipSyncSinger && featured.length ? { filmFeature: featureJson } : {}), filmGenre, filmAspect: tmpl?.lipSyncSinger ? mvAspect : filmAspect, ...(narrated ? { filmMode: "narrated" } : {}), ...(!tmpl?.lipSyncSinger && pickedCast.length ? { filmCast: filmCastJson } : {}), ...(filmProps.length ? { filmProps: JSON.stringify(filmProps) } : {}), ...(customProps.length ? { filmCustomProps: JSON.stringify(customProps) } : {}), ...(artistPick ? { filmHeroUrl: artistPick } : {}), ...(castExtra.length ? { filmCastExtra: JSON.stringify(castExtra) } : {}), ...(useTr && castExtra.length ? { filmCastForScene: JSON.stringify(resolveCastMap(useTr.scenes)) } : {}), ...(Object.keys(outfits).length ? { filmOutfits: JSON.stringify(outfits) } : {}), ...(Object.keys(outfitImgs).length ? { filmOutfitImgs: JSON.stringify(outfitImgs) } : {}), ...(artistName ? { filmArtistName: artistName } : {}), ...(castNames.length ? { filmCastNames: JSON.stringify(castNames) } : {}), ...(artistGender ? { filmArtistGender: artistGender } : {}), ...(castGenders.length ? { filmCastGenders: JSON.stringify(castGenders) } : {}), ...(useTr ? { approvedTreatment: JSON.stringify(useTr) } : {}), ...(series && isStoryboard ? { seriesFrom: series.from } : {}), ...(langOn ? { filmLang: storyLang } : {}) },
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
    if (noIdeaYet()) return;                                                 // a story with no idea yet: the box asks first (nothing is thrown away)
    if (seeds) { setSeeds(null); }                                           // start over — fresh song + scenes
    setChainToScenes(true);
    writeTreatment();
  };
  // When the song lands during a chain, auto-continue into the stills (with the fresh treatment).
  // If the writer came back with an ERROR instead, the chain ends there and the button comes back: it
  // used to stay "Building the scenes…", disabled, until the page was reloaded — one failed write was a
  // dead end (seen on the live site, 2026-11-21).
  useEffect(() => {
    if (!chainToScenes || writing) return;
    const tr2 = treatmentFetcher.data?.treatment;
    if (tr2 && tr2.scenes?.length) { setChainToScenes(false); firePreviewScenes(tr2); }
    else if (treatmentFetcher.data?.error) setChainToScenes(false);
  }, [treatmentFetcher.data, writing, chainToScenes]); // eslint-disable-line react-hooks/exhaustive-deps
  // Capture the previewed stills + the hero; the render then uses these EXACT images (no surprise),
  // and the hero lets a single scene be re-rolled without changing the artist.
  useEffect(() => {
    const sd = sceneSeedsFetcher.data;
    const crefs = (sd as { castRefs?: string[] } | undefined)?.castRefs;
    if (sd?.ok && sd.sceneImgs && sd.treatment) setSeeds({ imgs: sd.sceneImgs, treatment: sd.treatment, propForScene: sd.propForScene || {}, artistRef: sd.artistRef || null, castRef: sd.castRef || null, castRefs: Array.isArray(crefs) ? crefs : [], castCards: Array.isArray(sd.castCards) ? sd.castCards : [], faults: Array.isArray(sd.sceneFaults) ? sd.sceneFaults : [], checks: Array.isArray(sd.sceneChecks) ? sd.sceneChecks : [] });
  }, [sceneSeedsFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Re-roll ONE storyboard scene (reusing the hero / cast ref) when it came back wrong; swap that still.
  // (`who` — the people in the scene BY NAME — rides only with the Cast editor's own re-roll: the scene's
  //  words are then rewritten for them first, mv-recast.ts. A plain re-roll keeps the maker's words.)
  const rerollScene = (i: number, propOverride?: string, castOverride?: string[], singerOverride?: string, wearOverride?: Record<string, string>, who?: Recast) => {
    if (!seeds || recasting || (!narrated && !seeds.artistRef && !seeds.castRef)) return;
    const pk = propOverride !== undefined ? propOverride : (seeds.propForScene[i] || "");
    // Resolve THIS scene's co-stars → their styled refs so the re-roll composes the right faces. (In a
    // co-star's own performance the list may hold the ARTIST — beside them — whose picture is the hero's.)
    const costarImgs = castOverride !== undefined ? castOverride : sceneCostars(seeds.treatment.scenes, i);
    // (each from the picture of what they wear IN THIS SCENE — sceneRefOf — which is their look for the
    //  video unless the scene has an outfit of its own)
    const sceneCastRefs = costarImgs.map((img) => sceneRefOf(i, img, img === artistPick ? seeds.artistRef : costarImgToRef(img), wearOverride)).filter(Boolean) as string[];
    const sceneArtistRef = artistPick ? sceneRefOf(i, artistPick, seeds.artistRef, wearOverride) : seeds.artistRef;
    // who LEADS it: the co-star whose verse it is, when it is a performance — else the artist
    const sc = singerOverride !== undefined ? { ...seeds.treatment.scenes[i], singer: singerOverride } : seeds.treatment.scenes[i];
    const leadImg = sceneLeadImg(sc, i, seeds.treatment.scenes.length);
    const leadRef = leadImg ? sceneRefOf(i, leadImg, costarImgToRef(leadImg), wearOverride) : null;
    setRerollingScene(i);
    rerollSceneFetcher.submit(
      { intent: "rerollFilmScene", template, filmGenre, ...(leadRef ? { sceneLeadRef: leadRef } : {}), ...(tmpl?.lipSyncSinger ? { filmSceneSeconds: String(mvSceneSec) } : {}), filmAspect: tmpl?.lipSyncSinger ? mvAspect : filmAspect, ...(narrated ? { filmMode: "narrated", approvedTreatment: JSON.stringify(seeds.treatment), ...(pickedCast.length ? { filmCast: filmCastJson } : {}) } : {}), artistRef: sceneArtistRef || "", castRef: seeds.castRef || "", sceneVisual: seeds.treatment.scenes[i]?.visual || "", sceneWhere: seeds.treatment.scenes[i]?.where || "", ...(seeds.treatment.cast?.length ? { sceneCastWords: JSON.stringify(seeds.treatment.cast) } : {}), sceneIndex: String(i), sceneKind: sceneKind(seeds.treatment.scenes[i], i, seeds.treatment.scenes.length), sceneCount: String(seeds.treatment.scenes.length), ...(pk ? { propKey: pk } : {}), ...(sceneCastRefs.length ? { sceneCastRefs: JSON.stringify(sceneCastRefs) } : {}), ...(customProps.length ? { filmCustomProps: JSON.stringify(customProps) } : {}), ...(who ? { sceneWho: JSON.stringify(who) } : {}) },
      { method: "post" }
    );
  };
  // DRAW ONE CHARACTER AGAIN — the ↻ on a face in a told story's "Starring" row. The maker does not like how
  // one of the story's own characters came out: a new portrait is drawn, and every scene that names them is
  // drawn again from it. Nobody else changes, no other scene is touched, no word is rewritten.
  const recastCharacter = (name: string) => {
    if (!seeds || !narrated || recasting || rerollingScene !== null) return;
    const entry = (seeds.treatment.cast || []).find((e) => entryName(e).trim().toLowerCase() === name.trim().toLowerCase());
    const theirs = entry ? seeds.treatment.scenes.map((s, i) => (namedIn(entryName(entry), s?.visual || "") ? i : -1)).filter((i) => i >= 0) : [];
    setRecasting({ name, scenes: theirs });
    recastFetcher.submit(
      { intent: "recastStoryCharacter", template, filmMode: "narrated", filmAspect, approvedTreatment: JSON.stringify(seeds.treatment), ...(pickedCast.length ? { filmCast: filmCastJson } : {}), castRef: seeds.castRef || "", castName: name },
      { method: "post" }
    );
  };
  useEffect(() => {
    const rd = recastFetcher.data;
    if (recastFetcher.state !== "idle" || !rd) return;
    if (rd.ok && Array.isArray(rd.scenes) && Array.isArray(rd.sceneImgs)) {
      const done = rd.scenes, imgs = rd.sceneImgs, nf = rd.sceneFaults || [], nc = rd.sceneChecks || [];
      const got = (j: number) => done.includes(j) && !!imgs[j];
      setSeeds((prev) => (prev ? { ...prev,
        ...(typeof rd.castRef === "string" && rd.castRef && Array.isArray(rd.castCards) ? { castRef: rd.castRef, castCards: rd.castCards } : {}),
        imgs: prev.imgs.map((u, j) => (got(j) ? imgs[j] : u)),
        faults: prev.imgs.map((_, j) => (got(j) ? nf[j] ?? null : (prev.faults || [])[j] ?? null)),
        checks: prev.imgs.map((_, j) => (got(j) ? nc[j] ?? null : (prev.checks || [])[j] ?? null)) } : prev));
    }
    setRecasting(null);
  }, [recastFetcher.state, recastFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  /** WHY a still is flagged, in two words — from what the check read off it (mv-cast.ts CastCheck). The
   *  flag used to say only "Worth a re-roll", with the reason in a tooltip a phone does not have. */
  const flagWhy = (i: number): string => {
    const c = ((seeds?.checks || [])[i] || null) as { seen?: boolean[]; twin?: boolean; twice?: boolean[]; extra?: boolean; outside?: boolean; lens?: string[]; grimy?: boolean; inset?: boolean; dressed?: boolean[]; odd?: boolean; mic?: string; bars?: boolean; panels?: boolean; who?: string[] } | null;
    if (!c) return t("Worth a re-roll");
    // (…or a smaller picture pasted into a corner of it — the same fault to a viewer: story-picture.ts)
    if (c.panels === true || c.inset === true) return t("Split picture");
    // (a told story knows WHO it looked for: "Marta is missing")
    const gone = (c.seen || []).map((x, k) => (x === false ? (c.who || [])[k] || "" : "")).filter(Boolean);
    // (…a short name: the flag sits on a third of a phone-wide card, and a long one filled half the picture)
    if (gone.length === 1 && gone[0].length <= 16 && (c.seen || []).filter((x) => x === false).length === 1) return t("{name} is missing", { name: gone[0] });
    if ((c.seen || []).some((x) => x === false)) return t("Missing someone");
    // (a told story's own looks — story-picture.ts: whoever looks out drawn standing outside with it, somebody
    //  its words do not put there, somebody drawn twice)
    if (c.outside === true) return t("Standing outside");
    if (c.extra === true) return t("A stranger in it");
    if (c.twin === true || (c.twice || []).some((x) => x === true)) return t("Someone doubled");
    if (Array.isArray(c.lens) && c.lens.length) return t("Staring at camera");
    if (c.grimy === true) return t("Looks run-down");
    if ((c.dressed || []).some((x) => x === false)) return t("Wrong clothes");
    if (c.odd === true) return t("Looks impossible");
    if (c.bars === true) return t("Bars round the picture");
    if (c.mic && c.mic !== "none") return t("Stray microphone");
    return t("Worth a re-roll");
  };
  // Tap a scene still to inspect it big (lightbox).
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  // KEEP IN MY CAST: a character the story invented, opened in the character dialog (CharacterForge) with
  // the portrait the story drew — from the big view of that portrait.
  const [keep, setKeep] = useState<ForgeSeed | null>(null);
  // THE CAST ID CARD in every picker where a face is chosen (the story's cast, the music video's star and
  // co-stars, a scene's "add to this scene", the acted film's roster): with a mouse it floats beside the
  // face pointed at, as in the Presenters section; with a finger, HOLD a face and it opens as a sheet
  // with one button that picks them. A tap still picks, exactly as before. ONE hook for all four, and ONE
  // layer (<CastPeek>, below the page) — each picker says, per face, what picking them does (`peekOn`).
  // Never over the enlarged scene still.
  const peek = useCastPeek(!zoomImg);
  const peekTargets: Record<string, PeekTarget> = {};
  const peekOn = (key: string, r: RosterFace | undefined, picked: boolean, pick: () => void, disabled = false) => {
    if (!r?.card) return undefined; // a face the shop made, or an uploaded photo: no card — as before
    peekTargets[key] = { r, picked, pick, disabled };
    return peek.bind(key);
  };
  // (a picker that keeps its faces by picture — a scene's cast — finds who they are in the roster)
  const faceOfImg = (img: string): RosterFace | undefined => (img ? d.roster.find((r) => r.img === img) : undefined);
  // …and how a finger learns it: one quiet line under the first picker of each flow, on a touch screen
  // only (the page's CSS shows it where nothing hovers)
  const peekHint = <p className="fs-peek-hint">{t("Hold a face to see their card.")}</p>;
  // Per-scene PROP edit (post-creation): STAGE a prop in a draft (no auto-regen), then an explicit
  // "Regenerate this scene" CTA re-rolls just that scene with it.
  const [scenePropPick, setScenePropPick] = useState<number | null>(null);
  const [scenePropDraft, setScenePropDraft] = useState<string>("");
  useEffect(() => {
    if (sceneCastPick === null && scenePropPick === null) return;
    const el = typeof document !== "undefined" ? document.querySelector(".mm-sc-drawer") : null;
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [sceneCastPick, scenePropPick]);
  const openScenePropPick = (i: number) => {
    if (scenePropPick === i) { setScenePropPick(null); return; }
    setSceneCastPick(null);
    setScenePropDraft(seeds?.propForScene[i] || "");
    setScenePropPick(i);
  };
  const confirmScenePropMv = (i: number) => {
    setSeeds((prev) => {
      if (!prev) return prev;
      const pf = { ...prev.propForScene };
      if (scenePropDraft) pf[i] = scenePropDraft; else delete pf[i];
      return { ...prev, propForScene: pf };
    });
    setScenePropPick(null);
    rerollScene(i, scenePropDraft);
  };
  useEffect(() => {
    const rd = rerollSceneFetcher.data;
    if (rerollSceneFetcher.state === "idle" && rd) {
      if (rd.ok && typeof rd.sceneIndex === "number" && rd.img) {
        const idx = rd.sceneIndex, nimg = rd.img, nf = rd.faults ?? null, nc = rd.check ?? null;
        // the scene's words, if the re-roll rewrote them for who is in it now: the card says what the picture shows
        const nv = typeof rd.visual === "string" && rd.visual.trim() ? rd.visual.trim().slice(0, 400) : null;
        // (a told story: a character first drawn in THIS scene has its portrait now — the cast is kept whole)
        const cast = typeof rd.castRef === "string" && rd.castRef && Array.isArray(rd.castCards) ? { castRef: rd.castRef, castCards: rd.castCards } : null;
        setSeeds((prev) => (prev ? { ...prev, ...(cast || {}),
          treatment: nv ? { ...prev.treatment, scenes: prev.treatment.scenes.map((s, j) => (j === idx ? { ...s, visual: nv } : s)) } : prev.treatment,
          imgs: prev.imgs.map((u, j) => (j === idx ? nimg : u)), faults: prev.imgs.map((_, j) => (j === idx ? nf : (prev.faults || [])[j] ?? null)), checks: prev.imgs.map((_, j) => (j === idx ? nc : (prev.checks || [])[j] ?? null)) } : prev));
      }
      setRerollingScene(null);
    }
  }, [rerollSceneFetcher.state, rerollSceneFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Any setup change invalidates the preview — the stills would no longer match the new settings
  // (the artist too: a different face means the stills show the wrong person).
  // (…and the LOOK picked for anyone: the wardrobe is locked, so stills drawn in the old look would be rendered in it)
  // (NOT the idea box: what is typed there is used the next time the maker starts over — see `ideaChanged`)
  useEffect(() => { if (restoring.current) return; setSeeds(null); setCastForScene({}); setSceneCastPick(null); setSceneOutfits({}); }, [filmGenre, JSON.stringify(filmProps), scenes, songSource, filmSongUrl, artistPick, mvAspect, featKey, JSON.stringify(outfits)]); // eslint-disable-line react-hooks/exhaustive-deps
  // (an acted film's approved frames too: they were drawn in the old shape, and were still sent as the shots' seeds)
  useEffect(() => { if (!tmpl?.lipSyncSinger) { setSeeds(null); setFrames([]); } }, [filmAspect]); // eslint-disable-line react-hooks/exhaustive-deps
  // Artist or cast CHANGED → clear the SCRIPT too so it re-writes with the picked names. Fixes the
  // "Kazon" AI-slop name persisting from a treatment that was written before the cast was set.
  // (…and so does who SINGS: a featured verse is written into the song)
  useEffect(() => { if (restoring.current) return; setTreatment(null); }, [artistPick, castExtra.map((m) => m.img).join(","), featKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // MUSIC VIDEO: a different idea is a different song. (Editing the idea cleared the stills but kept the
  // song, and "Make the scenes" then drew new pictures for the OLD song — "song already written".)
  // …but only while there are no pictures: once the scenes are drawn, the song and the storyboard both stay
  // (the note under the idea box says so) and "Start over" writes a new song from the new idea.
  useEffect(() => {
    if (restoring.current) return;
    // (the box filled with the starter a script was just written from is not a new idea — THE NUDGE COMES BACK)
    if (nudgeFilled.current !== null && topic === nudgeFilled.current) return;
    if (seeds || (treatment && !tmpl?.lipSyncSinger)) setIdeaChanged(true);
    else if (tmpl?.lipSyncSinger) setTreatment(null);
  }, [topic]); // eslint-disable-line react-hooks/exhaustive-deps
  // If the pictures then go another way (a new genre, a new star…), a music video's song goes with them —
  // it was written for the old idea — and the note has nothing left to be about.
  useEffect(() => {
    if (seeds || !ideaChanged) return;
    if (tmpl?.lipSyncSinger) setTreatment(null);
    if (tmpl?.lipSyncSinger || !treatment) setIdeaChanged(false);
  }, [!!seeds, !!treatment]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // props, dancing — no lip-sync). The default is the director's cadence the pipeline films by — ONE
  // function for both (mv-pace.ts defaultRole): a short video leads with the performance, a longer one
  // intercuts. The song writer now sets each scene's kind as it writes; the merchant can flip any scene.
  const defaultSceneRole = (i: number, n: number): "perform" | "broll" => defaultRole(i, n, mvSceneSec);
  const sceneKind = (sc: Scene, i: number, n: number): "perform" | "broll" => sc?.kind || defaultSceneRole(i, n);
  const setSceneKind = (i: number, kind: "perform" | "broll") => {
    // a scene that becomes a CUT SCENE is nobody's to sing: a co-star is heard only while they are seen
    // singing (mv-feature.ts voiceWindows), so the mark that made it theirs goes with the performance
    const as = (s: Scene): Scene => { if (kind === "perform") return { ...s, kind }; const { singer: _drop, ...rest } = s; return { ...rest, kind }; };
    if (seeds) setSeeds((prev) => (prev ? { ...prev, treatment: { ...prev.treatment, scenes: prev.treatment.scenes.map((s, j) => (j === i ? as(s) : s)) } } : prev));
    else if (treatment) setTreatment({ ...treatment, scenes: treatment.scenes.map((s, j) => (j === i ? as(s) : s)) });
  };
  // ---- Per-scene CO-STAR cast (owner edit) ---------------------------------
  // The default (mv-cast.ts defaultCostars — the SAME function the render uses when no cast is sent):
  // the artist leads every performance with EVERY picked co-star beside them, dancing; a cut scene has
  // the co-stars its words name, the dance cut scene has them all, and any other cut scene is the
  // artist's or the scenery's. (It used to put ONE co-star, in rotation, in each performance — so a
  // short video could never show the second: the tester's "they only show one back character".)
  // Owner overrides (castForScene) win.
  // A FEATURED VERSE changes one thing here: a PERFORMANCE in a co-star's own verse is LED by that
  // co-star (it is their voice, so their mouth), and by default they have the shot to themselves.
  const castNamesAll = castExtra.map((m) => m.name || "");
  /** The co-star (their picture) who leads scene i — a performance in their own verse — or "" for the artist. */
  const sceneLeadImg = (sc: Scene | undefined, i: number, n: number): string => {
    if (!sc || !castExtra.length || sceneKind(sc, i, n) !== "perform") return "";
    const k = singerOf(sc, castNamesAll);
    return k >= 0 ? castExtra[k]?.img || "" : "";
  };
  const costarsByDefault = (sc: Scene, i: number, n: number): string[] => {
    if (!castExtra.length) return [];
    const role = sceneKind(sc, i, n);
    return sceneCast({ scene: sc, role, slot: shotSlot(role, i), names: castNamesAll }).others.map((w) => (w < 0 ? artistPick : castExtra[w]?.img)).filter(Boolean);
  };
  const defaultSceneCostars = (scenesArr: Scene[], i: number): string[] => costarsByDefault(scenesArr[i], i, scenesArr.length);
  /** The same scene, sung by `name` (a co-star's name, or "" for the artist). */
  const sungBy = (s: Scene, name: string): Scene => { const { singer: _drop, ...rest } = s; return name ? { ...rest, singer: name } : rest; };
  /** Whose scene i is as it stands: the co-star's name, or "" for the artist. */
  const sceneSingerName = (sc: Scene | undefined, i: number, n: number): string => { const img = sceneLeadImg(sc, i, n); return img ? (castExtra.find((m) => m.img === img)?.name || "").trim() : ""; };
  /** Scene i as the OPEN EDITOR has it — sung by whoever is staged to sing it. */
  const draftScene = (scenesArr: Scene[], i: number): Scene => (sceneCastPick === i && scenesArr[i] ? sungBy(scenesArr[i], sceneSingerDraft) : scenesArr[i]);
  /** STAGE who sings scene i (a co-star's name, or "" for the artist) — nothing is drawn until
   *  "Regenerate scene". Whoever now leads is not also "beside" themselves, and a verse of one's own is
   *  a shot of one's own until people are added: the default the song's own featured verse gets
   *  (mv-cast.ts sceneCast). It used to be a row of pills that drew the scene again at once and closed
   *  the editor — throwing away an outfit picked in it a moment before. */
  const stageSceneSinger = (i: number, name: string) => {
    if (!seeds) return;
    setSceneSingerDraft(name);
    setSceneCastDraft(costarsByDefault(sungBy(seeds.treatment.scenes[i], name), i, seeds.treatment.scenes.length));
  };
  /** The name that hands a scene to this co-star — "" unless they have a voice of their own AND the
   *  name leads back to them (a scene is given by NAME: with two co-stars of one name it would go to
   *  the first, so the second is not offered a mic that would light someone else's row). */
  const micNameOf = (img: string): string => {
    const m = singable.find((x) => x.img === img);
    const name = (m?.name || "").trim();
    return m && castExtra[singerOf({ singer: name }, castNamesAll)]?.img === img ? name : "";
  };
  const sceneCostars = (scenesArr: Scene[], i: number): string[] => castForScene[i] ?? defaultSceneCostars(scenesArr, i);
  // The whole scene→co-stars map (defaults + overrides) — what the preview + the render receive.
  const resolveCastMap = (scenesArr: Scene[]): Record<number, string[]> => {
    const m: Record<number, string[]> = {};
    scenesArr.forEach((_, i) => { m[i] = sceneCostars(scenesArr, i); });
    return m;
  };
  // A co-star's source img → its styled ref (index-aligned: castExtra[k] ↔ seeds.castRefs[k]). A member
  // added AFTER the preview has no styled ref yet — fall back to their raw face so the re-roll still
  // composes them (the full GENERATE re-styles every member, so the final video is consistent).
  const costarImgToRef = (img: string): string | null => {
    const k = castExtra.findIndex((m) => m.img === img);
    if (k >= 0 && seeds?.castRefs?.[k]) return seeds.castRefs[k];
    return img || null;
  };
  const castMemberName = (img: string): string => (img === artistPick ? artistName : (castExtra.find((m) => m.img === img)?.name || ""));
  const openSceneCastPick = (i: number) => {
    if (sceneCastPick === i) { setSceneCastPick(null); return; }
    setScenePropPick(null);
    setSceneWearDraft({ ...(sceneOutfits[i] || {}) }); setSceneWearText({}); setSceneWearNewFor(null);
    setSceneCastDraft(seeds ? sceneCostars(seeds.treatment.scenes, i) : []);
    setSceneSingerDraft(seeds ? sceneSingerName(seeds.treatment.scenes[i], i, seeds.treatment.scenes.length) : "");
    setSceneCastPick(i);
  };
  // (a scene holds whoever leads it and MAX_COSTARS more. A full one is not changed by adding: it used to
  //  push the first co-star out, unasked, to let a third in — the editor says it is full instead)
  const toggleSceneCastDraft = (img: string) => setSceneCastDraft((prev) => (prev.includes(img) ? prev.filter((x) => x !== img) : prev.length >= MAX_COSTARS ? prev : [...prev, img]));
  // ONE button for the whole editor: who SINGS the scene, who is in it AND what each of them wears in it
  // (staged, then drawn once). Only people who are in the scene keep an outfit of their own for it.
  const confirmSceneCastMv = (i: number) => {
    if (!seeds) return;
    const scenesArr = seeds.treatment.scenes;
    const inScene = new Set(sceneDraftPeople(scenesArr, i));
    const wear: Record<string, string> = {};
    for (const k of Object.keys(sceneWearDraft)) if (inScene.has(k)) wear[k] = sceneWearDraft[k];
    // a new singer is written into the scene itself: the name rides with the song and the render
    const singer = sceneSingerDraft;
    const newSinger = singer !== sceneSingerName(scenesArr[i], i, scenesArr.length);
    if (newSinger) setSeeds((prev) => (prev ? { ...prev, treatment: { ...prev.treatment, scenes: prev.treatment.scenes.map((s, j) => (j === i ? sungBy(s, singer) : s)) } } : prev));
    setCastForScene((prev) => ({ ...prev, [i]: sceneCastDraft }));
    setSceneOutfits((prev) => { const n = { ...prev }; if (Object.keys(wear).length) n[i] = wear; else delete n[i]; return n; });
    setSceneCastPick(null);
    // THE WORDS FOLLOW THE CAST: who is in the scene now, by name. The scene's words are rewritten for
    // them before it is drawn (they used to stay "OMAR sings … VALENTINA dancing beside him" under a
    // picture of KEIKO — and the picture model drew the VALENTINA it was told about; mv-recast.ts).
    const who = { names: [artistName, ...castNamesAll].map((n) => (n || "").trim()).filter(Boolean), lead: singer || (artistName || "").trim(), wasLead: sceneSingerName(scenesArr[i], i, scenesArr.length) || (artistName || "").trim(), beside: sceneCastDraft.map((img) => castMemberName(img).trim()).filter(Boolean) };
    rerollScene(i, undefined, sceneCastDraft, newSinger ? singer : undefined, wear, who);
  };
  // ---- Wardrobe (owner edit) ------------------------------------------------
  // Folded INTO the avatar picker: select an avatar → an outfit slider opens under it (presets + your
  // SAVED generated outfits, which persist). Picking a preset/describing GENERATES the SAME avatar in
  // that outfit (identity locked) and saves it as a style; the chosen outfit also rides the render as a
  // description. You can still change it per-scene below.
  const OUTFIT_PRESETS: Array<{ k: string; label: string; desc: string }> = [
    { k: "suit", label: "Sharp suit", desc: "a sharp tailored suit" },
    { k: "street", label: "Streetwear", desc: "stylish modern streetwear" },
    { k: "glam", label: "Glam stage", desc: "a glamorous sequined stage outfit" },
    { k: "casual", label: "Casual", desc: "relaxed casual everyday clothes" },
    { k: "western", label: "Western", desc: "western country attire with denim and boots" },
    { k: "leather", label: "Leather", desc: "an edgy black leather jacket look" },
    { k: "allwhite", label: "All white", desc: "a clean all-white designer outfit" },
    { k: "formal", label: "Formal", desc: "elegant formal evening wear" },
  ];
  const styleFor = (img: string, desc: string): string | undefined => (outfitStyles[img] || []).find((s) => s.desc === desc)?.img;
  /** WHO a picture is, as the roster knows them ("" for a face that is not a presenter) — a look made
   *  for a presenter is kept on them (avatar-looks.ts). */
  const rosterIdOf = (img: string): string => d.roster.find((r) => r.img === img)?.id || "";
  // Select an outfit for an avatar (sets the render desc) and GENERATE it if not already saved. Clearing
  // returns to their own look. A generated outfit is appended to outfitStyles[img] so it stays saved.
  const applyOutfit = (img: string, desc: string) => {
    setOutfits((p) => { const n = { ...p }; if (desc) n[img] = desc; else delete n[img]; return n; });
    if (!desc) return;
    if (styleFor(img, desc)) return; // already generated + saved — selecting is enough
    setOutfitDrafts((d) => ({ ...d, [img]: "" }));
    setOutfitBusyFor({ img, desc });
    outfitFetcher.submit({ intent: "styleOutfit", outfitImg: img, outfitDesc: desc, outfitAvatarId: rosterIdOf(img) }, { method: "post" });
  };
  useEffect(() => {
    const r = outfitFetcher.data;
    if (outfitFetcher.state === "idle" && r && outfitBusyFor) {
      const { img, desc } = outfitBusyFor;
      if (r.img) { const im = r.img; setOutfitStyles((p) => ({ ...p, [img]: [...(p[img] || []).filter((s) => s.desc !== desc), { desc, img: im }] })); }
      if (r.img && sceneCastPick !== null) setSceneWearDraft((dd) => ({ ...dd, [img]: desc }));
      setOutfitBusyFor(null);
    }
  }, [outfitFetcher.state, outfitFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // The face to SHOW for an avatar — the thumbnail of its selected outfit if generated, else the original.
  const avatarFace = (img: string): string => styleFor(img, outfits[img] || "") || img;
  // THE WARDROBE IS LOCKED: the approved PICTURE of each picked outfit rides with its description, and
  // the cast is styled from it — the look that was tapped is the look that is worn, in every scene.
  const outfitImgs: Record<string, string> = {};
  for (const img of Object.keys(outfits)) { const pic = styleFor(img, outfits[img]); if (pic) outfitImgs[img] = pic; }
  // ---- PER-SCENE WARDROBE ------------------------------------------------------------------------
  // The owner, 2026-11-22: "need to make per scene outfit editable on the seed revision system before
  // final video generate cta" — and then: "leave the wardrobe stuff inside of the avatar edit option
  // (bundled them) no extra button". So it lives in the scene's CAST editor: who is in the scene, and
  // under them what each one wears in it. The wardrobe is locked for the whole video (above); here ONE
  // scene can break from it — a deliberate change of look, the way a real video has them. A scene is
  // drawn from each person's reference picture, so a scene's outfit is simply a different picture of
  // them: their own (Own look) or the saved picture of an outfit. Nothing else about the scene changes.
  const sceneWearOf = (i: number, img: string, draft?: Record<string, string>): string | undefined => (draft ?? sceneOutfits[i] ?? {})[img];
  /** The picture of a cast member a scene is drawn from: `videoRef` (their look for the whole video)
   *  unless this scene has an outfit of its own for them. */
  const sceneRefOf = (i: number, img: string, videoRef: string | null, draft?: Record<string, string>): string | null => {
    const w = sceneWearOf(i, img, draft);
    if (w === undefined) return videoRef;
    if (w === "") return img;
    return styleFor(img, w) || videoRef;
  };
  /** The face to show for them on a scene's card. */
  const sceneFace = (i: number, img: string): string => { const w = sceneWearOf(i, img); return w === undefined ? avatarFace(img) : w === "" ? img : (styleFor(img, w) || avatarFace(img)); };
  /** Who is in the scene AS THE EDITOR HAS IT NOW and has a picture to dress: whoever leads it, then
   *  whoever has been put beside them (the draft — so a co-star just added can be dressed at once). */
  const sceneDraftPeople = (scenesArr: Scene[], i: number): string[] => {
    const lead = sceneLeadImg(draftScene(scenesArr, i), i, scenesArr.length) || artistPick;
    return [...new Set([lead, ...sceneCastDraft].filter((x): x is string => !!x))];
  };
  const sceneWearChanged = (i: number): boolean => !!sceneOutfits[i] && Object.keys(sceneOutfits[i]).length > 0;
  const setWearDraft = (img: string, v: string | undefined) => setSceneWearDraft((d) => { const n = { ...d }; if (v === undefined) delete n[img]; else n[img] = v; return n; });
  // A NEW outfit made from a scene: generated and saved beside their other looks (it does NOT become
  // their look for the whole video), then picked for this scene.
  const makeSceneOutfit = (img: string, desc: string) => {
    const dsc = desc.replace(/\s+/g, " ").trim().slice(0, 160);
    if (!dsc || outfitBusyFor) return;
    setSceneWearText((d) => ({ ...d, [img]: "" }));
    setSceneWearNewFor(null);
    if (styleFor(img, dsc)) { setWearDraft(img, dsc); return; }
    setOutfitBusyFor({ img, desc: dsc });
    outfitFetcher.submit({ intent: "styleOutfit", outfitImg: img, outfitDesc: dsc, outfitAvatarId: rosterIdOf(img) }, { method: "post" });
  };
  const reindexWear = (m: Record<number, Record<string, string>>, removed: number): Record<number, Record<string, string>> => {
    const out: Record<number, Record<string, string>> = {};
    Object.keys(m).forEach((k) => { const n = +k; if (n < removed) out[n] = m[n]; else if (n > removed) out[n - 1] = m[n]; });
    return out;
  };
  const presetLabel = (desc: string): string | undefined => OUTFIT_PRESETS.find((o) => o.desc === desc)?.label;
  // The outfit SLIDER (opens under the selected avatar). SAVED looks (Own look + generated outfits, big
  // thumbnails side by side) on top; the preset "suggestions" below are just hints to generate (each
  // moves up into the saved row once made); a describe-your-own "Make it" row at the bottom.
  const outfitSlider = (img: string, name: string) => {
    const cur = outfits[img] || "";
    const draft = outfitDrafts[img] || "";
    const busyDesc = outfitBusyFor && outfitBusyFor.img === img ? outfitBusyFor.desc : null;
    const saved = outfitStyles[img] || [];
    const suggestions = OUTFIT_PRESETS.filter((o) => !saved.some((s) => s.desc === o.desc) && o.desc !== busyDesc);
    const look = (faceUrl: string, desc: string, label: string, own: boolean) => {
      const on = own ? !cur : cur === desc;
      return (
        <button type="button" key={own ? "own" : desc} className={`mm-wd2-look${on ? " on" : ""}`} onClick={() => applyOutfit(img, own ? "" : desc)} disabled={!!busyDesc} title={label}>
          <span className="mm-wd2-lookimg"><img src={faceUrl} alt="" />{on && <span className="mm-wd2-lookchk" aria-hidden="true"><Ico n="check" size={12} /></span>}</span>
          <span className="mm-wd2-lookname">{label}</span>
        </button>
      );
    };
    return (
      <div className="mm-wd2">
        <div className="mm-wd2-h"><Ico n="shirt" size={13} /> {t("{name}'s wardrobe", { name })}</div>
        <div className="mm-wd2-hint">{t("Tap a look to use it. Tap a suggestion to generate it — it saves here beside the others. Or describe your own below.")}</div>
        <div className="mm-wd2-lock"><Ico n="lock" size={11} /> {t("The look you pick is what they wear in every scene.")}</div>
        <div className="mm-wd2-saved">
          {look(img, "", t("Own look"), true)}
          {saved.map((s) => look(s.img, s.desc, presetLabel(s.desc) ? t(presetLabel(s.desc) as string) : (s.desc.length > 18 ? s.desc.slice(0, 18) + "…" : s.desc), false))}
          {busyDesc && (
            <span className="mm-wd2-look is-making" aria-live="polite">
              <span className="mm-wd2-lookimg wb-cookimg mm-wd2-cook"><span className="wb-bufwrap"><span className="wb-spin" /></span></span>
              <span className="mm-wd2-lookname">{presetLabel(busyDesc) ? t(presetLabel(busyDesc) as string) : t("Making…")}</span>
            </span>
          )}
        </div>
        {suggestions.length > 0 && (
          <div className="mm-wd2-sugs">
            <span className="mm-wd2-sugl">{t("Suggestions")}</span>
            {suggestions.map((o) => (
              <button type="button" key={o.k} className="mm-wd2-sug" onClick={() => applyOutfit(img, o.desc)} disabled={!!busyDesc}>+ {t(o.label)}</button>
            ))}
          </div>
        )}
        <div className="mm-wd2-make">
          <input className="mm-wardrobe-input" value={draft} onChange={(e) => setOutfitDrafts((d) => ({ ...d, [img]: e.target.value }))} placeholder={t("Describe an outfit — a red sequin dress, a varsity jacket…")} maxLength={160} onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { e.preventDefault(); applyOutfit(img, draft.trim()); } }} aria-label={t("Describe an outfit for {name}", { name })} />
          <button type="button" className="mm-wd2-gen" onClick={() => draft.trim() && applyOutfit(img, draft.trim())} disabled={!draft.trim() || !!busyDesc}><Ico n="wand" size={13} /> {t("Make it")}</button>
        </div>
      </div>
    );
  };
  // Add / reorder / delete scenes in the pre-editor. Structural edits keep the stills (imgs) and the
  // per-scene prop map index-aligned to the scenes array, so nothing shifts out from under a still.
  const structEditScenes = (fn: (cur: { scenes: Scene[]; imgs: (string | null)[]; prop: Record<number, string> }) => { scenes: Scene[]; imgs: (string | null)[]; prop: Record<number, string> }) => {
    // Adding / removing / reordering shifts scene indices — the per-scene cast overrides (keyed by
    // index) would misalign, so clear them back to the intelligent default rather than mismatch faces.
    setCastForScene({}); setSceneCastPick(null);
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
  const sbRemoveScene = (i: number) => {
    setSceneOutfits((prev) => reindexWear(prev, i));
    structEditScenes(({ scenes, imgs, prop }) => ({ scenes: scenes.filter((_, j) => j !== i), imgs: imgs.filter((_, j) => j !== i), prop: reindexProp(prop, i) }));
  };

  // The storyboard: ONE collapsed button → a swipeable filmstrip of the actual scene stills (each
  // re-rollable, text click-to-edit), so you approve what will render before paying. Reused by BOTH
  // the Music Video card-builder and the film flow — one row, so it never turns a page into a doom-scroll.
  // The Make-the-scenes button (Music Video): one button that writes the song AND builds the scenes.
  // Lives in the final "make & generate" card, next to Generate — not floating in the filmstrip.
  // Loading as a PROCESS (not an all-at-once "sketching"): a determinate bar + "scene N of M" + ETA
  // that advances while the stills render, so the wait reads like Archive loading, with an end in sight.
  const [seedPct, setSeedPct] = useState(0);
  // How long the stills take, roughly: dressing the cast for the genre first (the star, and the co-stars
  // beside them — measured on the live site at about half a minute), then three scenes at a time; a scene
  // with co-stars in it is drawn AND checked, and sometimes drawn again. (It said "about 3s left" for a
  // minute and a half on the first storyboard with two co-stars.)
  // MEASURED on the live site, 2026-11-21/22: six scenes with two co-stars ≈ 90 s; twenty-four upright
  // scenes of one artist ≈ 230 s (the upright picture is the slower, sharper kind: ~25 s a wave of three).
  const mvCast = !!tmpl?.lipSyncSinger && castExtra.length > 0;
  // (a told story: its cast's portraits first, then four pictures at a time, each drawn AND looked at —
  //  measured on the live site 2026-11-23: six scenes with two characters ≈ 45 s, with three ≈ 70 s)
  const seedWaveSec = narrated ? 24 : !tmpl?.lipSyncSinger ? 9 : mvCast ? 27 : mvAspect === "9:16" ? 25 : 12;
  const seedEstSec = Math.max(14, (tmpl?.lipSyncSinger ? (mvCast ? 30 : artistPick ? 25 : 12) : narrated ? 15 : 0) + Math.ceil(scenes / (narrated ? 4 : 3)) * seedWaveSec);
  useEffect(() => {
    if (!seedBusy) { setSeedPct(0); return; }
    const estMs = seedEstSec * 1000;
    const start = Date.now();
    const id = window.setInterval(() => {
      const el = Date.now() - start;
      setSeedPct(Math.min(92, (1 - Math.exp(-el / (estMs * 0.6))) * 100));
    }, 350);
    return () => window.clearInterval(id);
  }, [seedBusy, scenes, seedEstSec]);
  const seedProgressUI = () => {
    const estSec = seedEstSec;
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
        {busy ? (writing ? <>… {tmpl?.lipSyncSinger ? t("Writing your song") : t("Writing your story")}</> : <>… {tmpl?.lipSyncSinger ? t("Building the scenes") : t("Drawing the scenes")}</>)
          : hasStills ? <><Ico n="refresh" size={13} /> {tmpl?.lipSyncSinger ? t("Start over — new song + scenes") : t("Start over — a new story")}</>
          : tmpl?.lipSyncSinger ? <><Ico n="wand" size={14} /> {t("Make the scenes — free")}</>
          : <><Ico n="wand" size={14} /> {t("Write it and draw it — free")}</>}
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
      {zoomImg && typeof document !== "undefined" && createPortal(
        <div className="mm-lightbox" onClick={() => setZoomImg(null)} role="dialog" aria-label={t("Scene preview")}>
          <img src={zoomImg} alt="" onClick={(e) => e.stopPropagation()} />
          {(() => {
            // KEEP IN MY CAST: this picture is the portrait of one of the story's own characters
            const star = narrated ? (seeds?.castCards || []).find((c) => c.img === zoomImg) : undefined;
            return star ? (
              <button type="button" className="mm-lightbox-keep" onClick={(e) => { e.stopPropagation(); setKeep({ img: star.img, name: star.name, look: star.look, ...keepGuess(star.look) }); setZoomImg(null); }}>
                <Ico n="presenter" size={16} /> {t("Keep {name} in my cast", { name: star.name })}
              </button>
            ) : null;
          })()}
          <button type="button" className="mm-lightbox-x" onClick={() => setZoomImg(null)} aria-label={t("Close")}>✕</button>
        </div>,
        document.body,
      )}
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
            ? t("Here's your video, shot by shot. Tap any line to change it. A green Performance is sung to camera; a purple Cut scene breaks to props or scenery with no singing (tap the pill to switch).")
            : (hasStills
              ? t("Swipe through your story — this is exactly what renders. Re-roll any scene that's off, then Generate.")
              : t("Here's your story, scene by scene — tap any line to polish it. Add the visuals to see each scene come to life."))}{narrated && seeds ? <> {t("The narrator reads each scene's words over its picture.")}{d.storyMotion && pictures !== "still" ? <> {t("In the finished story every picture moves.")}</> : null}</> : null}</div>
          {/* THE STORY'S CAST, the way a film opens on its stars: who the maker picked (their own pictures) and
              every character the story invented — each with the ONE portrait every scene it is in is drawn
              from (story-picture.ts). Tap a face to see it whole. */}
          {narrated && seeds && (() => {
            const own = seeds.castCards || [];
            const stars = [
              ...pickedCast.map((r) => ({ name: r.name, look: r.kind && r.kind !== "person" ? (r.look || "") : "", img: r.img })),
              ...own.filter((c) => !pickedCast.some((r) => nameTok(r.name) === nameTok(c.name))),
            ].filter((c) => c.name && c.img);
            // THE STORY'S PLACES (story-picture.ts): what it keeps coming back to, drawn ONCE as a design sheet
            // that every scene set there is drawn from — the same ferry in scene 1 and in scene 6
            const places = readCastToken(seeds.castRef).places;
            if (!stars.length && !places.length) return null;
            return (
              <div className="mm-stars">
                <div className="mm-stars-h"><b>{t("Starring")}</b>{recasting
                  ? <span role="status">{t("Drawing {name} again — the scenes they are in follow.", { name: recasting.name })}</span>
                  : (own.length > 0 || places.length > 0) && <span>{places.length > 0 && own.length === 0 ? t("It looks like this in every scene.") : t("They look like this in every scene.")}</span>}</div>
                {recastFetcher.state === "idle" && recastFetcher.data?.error && <p className="fs-err">{recastFetcher.data.error}</p>}
                <div className="mm-stars-row">
                  {stars.map((c, k) => {
                    // (one of the story's OWN characters can be drawn again — ↻, the scenes' own control; a
                    //  presenter the maker picked is who they are)
                    const mine = own.some((o) => o.name === c.name && o.img === c.img);
                    return (
                      <div key={`${c.name}|${c.img}`} className="mm-star" style={{ ["--i" as string]: k }}>
                        <button type="button" className="mm-star-pic" onClick={() => setZoomImg(c.img)} title={c.look ? `${c.name} — ${c.look}` : c.name}>
                          <img src={c.img} alt={c.name} loading="lazy" />
                          {recasting?.name === c.name && <span className="mm-sb-busy mm-sb-busy-rose"><span className="wb-bufwrap"><span className="wb-spin" /></span></span>}
                        </button>
                        {mine && <button type="button" className="mm-sb-reroll" onClick={() => recastCharacter(c.name)} disabled={!!recasting || rerollingScene !== null} title={t("Draw {name} again — the scenes they are in are drawn again too", { name: c.name })} aria-label={t("Draw {name} again", { name: c.name })}><Ico n="refresh" size={12} /></button>}
                        <span className="mm-star-nm">{c.name}</span>
                        {c.look ? <span className="mm-star-lk">{c.look}</span> : null}
                      </div>
                    );
                  })}
                  {places.map((p, k) => (
                    <div key={`place|${p.img}`} className="mm-star is-place" style={{ ["--i" as string]: stars.length + k }}>
                      <button type="button" className="mm-star-pic" onClick={() => setZoomImg(p.img)} title={`${p.name} — ${p.look}`}>
                        <img src={p.img} alt={p.name} loading="lazy" />
                        <span className="mm-star-tag"><Ico n="image" size={10} /> {t("Place")}</span>
                      </button>
                      <span className="mm-star-nm">{p.name.charAt(0).toUpperCase() + p.name.slice(1)}</span>
                      {p.look ? <span className="mm-star-lk">{p.look}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          {/* Pre-editor: a vertical list of scene cards (not a cramped strip) — each with its still, an
              editable "what we see" + "words", and a Performance/Cut-scene type you can flip. */}
          <div className={`mm-sb-list${isMv ? " is-mv" : ""}${narrated ? " is-told" : ""}`}>
            {strip.scenes.map((sc, i) => {
              const u = seeds?.imgs[i] ?? null;
              const pk = seeds?.propForScene[i];
              const pl = pk ? ((d.props || []).find((pp) => pp.key === pk)?.label || customProps.find((c) => c.key === pk)?.label || pk) : "";
              const perform = !isMv || sceneKind(sc, i, strip.scenes.length) === "perform";
              // a featured verse: who leads this shot (a co-star, in their own performance) and whose
              // voice is heard over it
              const leadImg = isMv ? sceneLeadImg(sc, i, strip.scenes.length) : "";
              // …and as the OPEN EDITOR has it: a singer can be staged there before anything is drawn
              const draftLead = isMv && sceneCastPick === i ? sceneLeadImg(draftScene(strip.scenes, i), i, strip.scenes.length) : leadImg;
              // (there is a choice of singer only in a performance, and only with a co-star who has a voice)
              const canPickSinger = isMv && perform && singable.length > 0;
              // (a told story's pictures are looked at too: one kept with someone still missing is flagged)
              const flagged = (isMv || narrated) && !!seeds && ((seeds.faults || [])[i] || 0) > 0 && rerollingScene !== i;
              // one editor at a time, opened as a drawer that spans the whole row under this card
              const editing = isMv && !!seeds && (sceneCastPick === i || scenePropPick === i);
              return (
                <Fragment key={i}>
                <div className={`mm-sc${isMv ? (perform ? " is-perform" : " is-broll") : ""}${editing ? " is-editing" : ""}`} data-check={isMv && seeds && (seeds.checks || [])[i] != null ? JSON.stringify((seeds.checks || [])[i]) : undefined}>
                  <div className="mm-sc-frame" style={(isMv ? mvAspect : narrated ? filmAspect : "9:16") !== "9:16" ? { aspectRatio: (isMv ? mvAspect : filmAspect) === "16:9" ? "16 / 9" : "1 / 1" } : undefined}>
                    {u ? <img src={u} alt={t("Scene {n}", { n: i + 1 })} loading="lazy" className="mm-sc-zoomable" onClick={() => setZoomImg(u)} /> : <span className="mm-sc-load wb-cookimg" aria-hidden="true"><span className="wb-bufwrap"><span className="wb-spin" /></span></span>}
                    {(rerollingScene === i || !!recasting?.scenes.includes(i)) && <span className="mm-sb-busy mm-sb-busy-rose"><span className="wb-bufwrap"><span className="wb-spin" /></span></span>}
                    <span className="mm-sb-num">{i + 1}</span>
                    {/* the picture was looked at and something was still off (someone missing, doubled, or a stray microphone) */}
                    {flagged && <button type="button" className="mm-sb-flag" onClick={() => rerollScene(i)} disabled={rerollingScene !== null || !!recasting} title={narrated ? t("We checked this picture and something looks off. Tap to draw it again.") : t("We checked this picture and something looks off — someone missing or doubled, the wrong clothes, or a stray microphone. Tap to draw it again.")}><Ico n="refresh" size={11} /> {flagWhy(i)}</button>}
                    <button type="button" className="mm-sc-x" onClick={() => sbRemoveScene(i)} disabled={strip.scenes.length <= 1} title={t("Remove this scene")} aria-label={t("Remove scene {n}", { n: i + 1 })}>✕</button>
                    {seeds && (narrated || seeds.artistRef || seeds.castRef) && <button type="button" className="mm-sb-reroll" onClick={() => rerollScene(i)} disabled={rerollingScene !== null || !!recasting} title={t("Re-roll this scene")} aria-label={t("Re-roll scene {n}", { n: i + 1 })}><Ico n="refresh" size={12} /></button>}
                  </div>
                  <div className="mm-sc-bd">
                    {isMv
                      ? <button type="button" className="mm-sc-type" onClick={() => setSceneKind(i, perform ? "broll" : "perform")} title={t("Performance = sung to camera (lip-synced). Cut scene = b-roll, no singing. Tap to switch.")} aria-label={t("Scene {n} is a {type} — tap to switch", { n: i + 1, type: perform ? t("Performance") : t("Cut scene") })}><span className="mm-sc-dot" aria-hidden="true" /> {perform ? t("Performance") : t("Cut scene")} <Ico n="refresh" size={10} /></button>
                      : <span className="mm-sc-num">{t("Scene {n}", { n: i + 1 })}</span>}
                    <textarea className="mm-sc-what" value={sc?.visual || ""} onChange={(e) => editSceneText(i, "visual", e.target.value)} rows={2} maxLength={400} placeholder={t("what we see in this scene…")} aria-label={t("Scene {n} — what we see", { n: i + 1 })} />
                    {isMv
                      ? (perform && <div className="mm-sc-lyr"><span className="mm-sc-lyr-ico" aria-hidden="true">♪</span><textarea className="mm-sc-words" value={sc?.caption || ""} onChange={(e) => editSceneText(i, "caption", e.target.value)} rows={1} maxLength={300} placeholder={t("the words sung here…")} aria-label={t("Scene {n} — the words", { n: i + 1 })} /></div>)
                      : narrated
                      ? <div className="mm-sc-lyr mm-sc-told"><span className="mm-sc-lyr-ico" aria-hidden="true"><Ico n="mic" size={12} /></span><textarea className="mm-sc-words" value={sc?.caption || ""} onChange={(e) => editSceneText(i, "caption", e.target.value)} rows={4} maxLength={480} placeholder={t("what the narrator says over this picture…")} aria-label={t("Scene {n} — the narrator's words", { n: i + 1 })} /></div>
                      : ((sc?.caption != null) && <div className="mm-sc-lyr"><span className="mm-sc-lyr-ico" aria-hidden="true">♪</span><textarea className="mm-sc-words" value={sc?.caption || ""} onChange={(e) => editSceneText(i, "caption", e.target.value)} rows={1} maxLength={300} placeholder={t("the words / lyrics…")} aria-label={t("Scene {n} — the words", { n: i + 1 })} /></div>)}
                    {isMv ? (
                      <>
                        <div className="mm-sc-chips">
                          {leadImg
                            ? <span className="mm-sc-chip mm-chip-av mm-chip-lead mm-chip-sings" title={t("{name} sings this part — in their own voice", { name: castMemberName(leadImg) || t("Cast") })}><img src={sceneFace(i, leadImg)} alt="" /><Ico n="mic" size={10} /> {castMemberName(leadImg) || t("Cast")}</span>
                            : (artistName && <span className="mm-sc-chip mm-chip-av mm-chip-lead">{artistPick ? <img src={sceneFace(i, artistPick)} alt="" /> : null}{artistName}</span>)}
                          {sceneCostars(strip.scenes, i).filter((img) => img !== leadImg).map((img) => <span className="mm-sc-chip mm-chip-av" key={img} title={castMemberName(img) || t("Cast")}><img src={sceneFace(i, img)} alt="" /><span className="mm-chip-nm">{castMemberName(img) || t("Cast")}</span></span>)}
                        </div>
                        {/* EDIT THIS SCENE: who is in it (and what they wear), and what is in it — each opens a drawer under the row */}
                        {seeds && (
                          <div className="mm-sc-acts">
                            <button type="button" className={`mm-sc-act is-cast${sceneCastPick === i ? " open" : ""}`} onClick={() => openSceneCastPick(i)} disabled={rerollingScene !== null} aria-expanded={sceneCastPick === i} aria-label={t("Edit who's in this scene and what they wear")}><Ico n="star" size={12} /> {t("Cast")}{sceneWearChanged(i) ? <span className="mm-sc-act-tag" title={t("Outfit changed")}><Ico n="shirt" size={10} /></span> : null}</button>
                            <button type="button" className={`mm-sc-act is-prop${pl ? "" : " empty"}${scenePropPick === i ? " open" : ""}`} onClick={() => openScenePropPick(i)} disabled={rerollingScene !== null} aria-expanded={scenePropPick === i} aria-label={t("Props in this scene")}><Ico n="gem" size={12} /> {pl || t("No props")}</button>
                          </div>
                        )}
                      </>
                    ) : (pl && <div className="mm-sc-chips"><span className="mm-sc-chip mm-chip-pr">{t(pl)}</span></div>)}
                  </div>
                </div>
                {editing && (
                  <div className="mm-sc-drawer" role="group" aria-label={t("Edit scene {n}", { n: i + 1 })}>
                    <div className="mm-sd-head">
                      <span className="mm-sd-title"><span className="mm-sd-num">{i + 1}</span>{sceneCastPick === i ? t("Who's in this scene") : t("Props in this scene")}</span>
                      <button type="button" className="mm-sd-x" onClick={() => { setSceneCastPick(null); setScenePropPick(null); }} aria-label={t("Close")}>✕</button>
                    </div>
                        {seeds && sceneCastPick === i && (
                          <div className="mm-sc-castedit">
                            {/* THE PEOPLE IN THIS SCENE — one list: who is in it, who SINGS it, and beside each what
                                they wear in it (the owner: "leave the wardrobe stuff inside of the avatar edit
                                option … no extra button"). It used to be a row of "who sings" pills, a strip of
                                faces, and then the same people a third time as outfit rows. */}
                            <div className="mm-sw-people">
                              {sceneDraftPeople(strip.scenes, i).map((img) => {
                                const cur = sceneWearDraft[img]; // undefined = the look they have for the whole video
                                const videoDesc = outfits[img] || "";
                                const saved = (outfitStyles[img] || []).filter((s) => s.desc !== videoDesc);
                                const making = outfitBusyFor && outfitBusyFor.img === img ? outfitBusyFor.desc : null;
                                const text = sceneWearText[img] || "";
                                const nm = castMemberName(img) || t("Cast");
                                const leads = img === (draftLead || artistPick);
                                // WHO SINGS a performance — the star, or a co-star with a voice of their own (a
                                // featured verse): the mic on their own row. Staged like everything else here.
                                const micName = micNameOf(img);
                                return (
                                  <div className="mm-sw-row" key={img} role="group" aria-label={t("What {name} wears in this scene", { name: nm })}>
                                    <div className="mm-sw-name">
                                      <span>{nm}</span>
                                      {!canPickSinger
                                        ? (leads ? <span className="mm-sw-tag">{t("Lead")}</span> : null)
                                        : leads
                                          ? (draftLead
                                              ? <button type="button" className="mm-sw-mic on" aria-pressed={true} onClick={() => stageSceneSinger(i, "")} title={t("Give this scene back to {name}", { name: artistName || t("The star") })}><Ico n="mic" size={10} /> {t("Sings this scene")}</button>
                                              : <span className="mm-sw-tag"><Ico n="mic" size={10} /> {t("Sings this scene")}</span>)
                                          : img === artistPick
                                            ? <button type="button" className="mm-sw-mic" aria-pressed={false} onClick={() => stageSceneSinger(i, "")} title={t("Give this scene back to {name}", { name: nm })}><Ico n="mic" size={10} /> {t("Sing this scene")}</button>
                                            : micName
                                              ? <button type="button" className="mm-sw-mic" aria-pressed={false} onClick={() => stageSceneSinger(i, micName)} title={t("{name} sings this part — in their own voice", { name: nm })}><Ico n="mic" size={10} /> {t("Sing this scene")}</button>
                                              : null}
                                      {!leads && <button type="button" className="mm-sw-rm" onClick={() => toggleSceneCastDraft(img)} aria-label={t("Remove {name} from this scene", { name: nm })} title={t("Remove {name} from this scene", { name: nm })}>✕</button>}
                                    </div>
                                    <div className="mm-sw-looks">
                                      <button type="button" className={`mm-sw-look${cur === undefined ? " on" : ""}`} aria-pressed={cur === undefined} onClick={() => setWearDraft(img, undefined)} title={t("Video look")}><img src={avatarFace(img)} alt="" /><span>{t("Video look")}</span></button>
                                      {videoDesc && <button type="button" className={`mm-sw-look${cur === "" ? " on" : ""}`} aria-pressed={cur === ""} onClick={() => setWearDraft(img, "")} title={t("Own look")}><img src={img} alt="" /><span>{t("Own look")}</span></button>}
                                      {saved.map((s) => {
                                        const label = presetLabel(s.desc) ? t(presetLabel(s.desc) as string) : (lookLabel(s.desc) || s.desc);
                                        return <button type="button" key={s.desc} className={`mm-sw-look${cur === s.desc ? " on" : ""}`} aria-pressed={cur === s.desc} onClick={() => setWearDraft(img, s.desc)} title={label}><img src={s.img} alt="" /><span>{label}</span></button>;
                                      })}
                                      {making && <span className="mm-sw-look is-making" aria-live="polite"><span className="mm-sw-cook wb-cookimg"><span className="wb-bufwrap"><span className="wb-spin" /></span></span><span>{t("Making…")}</span></span>}
                                      {/* a look that does not exist yet: one tile, which opens the one box to describe it */}
                                      <button type="button" className={`mm-sw-look mm-sw-new${sceneWearNewFor === img ? " on" : ""}`} aria-expanded={sceneWearNewFor === img} onClick={() => setSceneWearNewFor(sceneWearNewFor === img ? null : img)} disabled={!!outfitBusyFor} title={t("New look")}><span className="mm-sw-plus" aria-hidden="true">＋</span><span>{t("New look")}</span></button>
                                    </div>
                                    {sceneWearNewFor === img && (
                                      <div className="mm-sw-make">
                                        <input className="mm-wardrobe-input" autoFocus value={text} onChange={(e) => setSceneWearText((d) => ({ ...d, [img]: e.target.value }))} placeholder={t("An outfit just for this scene — a white tux, a red dress…")} maxLength={160} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { e.preventDefault(); makeSceneOutfit(img, text); } }} aria-label={t("Describe an outfit for {name}", { name: nm })} />
                                        <button type="button" className="mm-wd2-gen" onClick={() => makeSceneOutfit(img, text)} disabled={!text.trim() || !!outfitBusyFor}><Ico n="wand" size={13} /> {t("Make it")}</button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="mm-cp-hint">{t("Only this scene changes. Everywhere else they keep the look you picked.")}</div>
                            {/* …and whoever is NOT in it yet: the rest of the cast first, then faces from the roster.
                                A scene holds whoever leads it and two more — a FULL one says so, instead of offering
                                faces that would push somebody out of it unasked. */}
                            {sceneCastDraft.length >= MAX_COSTARS ? (
                              <div className="mm-sw-add mm-sw-full"><div className="mm-cp-hint">{t("This scene is full. Take someone out to add another.")}</div></div>
                            ) : (
                            <div className="mm-sw-add">
                              <div className="mm-sw-name"><span>{t("Add to this scene")}</span></div>
                              <div className="mm-sc-castpick">
                                {/* in a co-star's own performance the STAR is someone who can stand beside them */}
                                {draftLead && artistPick && !sceneCastDraft.includes(artistPick) && (
                                  <button type="button" className="mm-cp-opt mm-cp-add" onClick={() => toggleSceneCastDraft(artistPick)} title={artistName}
                                    {...peekOn(`scene:${artistPick}`, faceOfImg(artistPick), false, () => toggleSceneCastDraft(artistPick))}>
                                    <span className="mm-cp-img" style={{ backgroundImage: `url(${artistPick})` }} aria-hidden="true" /><span className="mm-cp-plus" aria-hidden="true">＋</span>{artistName || t("The star")}
                                  </button>
                                )}
                                {castExtra.filter((m) => m.img !== draftLead && !sceneCastDraft.includes(m.img)).map((m) => (
                                  <button type="button" key={m.img} className="mm-cp-opt mm-cp-add" onClick={() => toggleSceneCastDraft(m.img)} title={m.name}
                                    {...peekOn(`scene:${m.img}`, faceOfImg(m.img), false, () => toggleSceneCastDraft(m.img))}>
                                    <span className="mm-cp-img" style={{ backgroundImage: `url(${m.img})` }} aria-hidden="true" /><span className="mm-cp-plus" aria-hidden="true">＋</span>{m.name || t("Cast")}
                                  </button>
                                ))}
                                {/* (a face from the roster JOINS the cast — so it is offered only while the cast has room:
                                    a third co-star is never added, and the tile used to put them in the picture anyway) */}
                                {(castExtra.length < MAX_COSTARS ? [...customArtists.map((c) => ({ img: c.img, name: c.name })), ...mvRoster.map((r) => ({ img: r.img, name: r.name }))] : []).filter((r) => r.img && !castExtra.some((m) => m.img === r.img)).slice(0, 14).map((r) => (
                                  <button type="button" key={`pool-${r.img}`} className="mm-cp-opt mm-cp-add" onClick={() => { addCastMemberMv(r.img, r.name); toggleSceneCastDraft(r.img); }} title={r.name}
                                    {...peekOn(`scene:${r.img}`, faceOfImg(r.img), false, () => { addCastMemberMv(r.img, r.name); toggleSceneCastDraft(r.img); })}>
                                    <span className="mm-cp-img" style={{ backgroundImage: `url(${r.img})` }} aria-hidden="true" /><span className="mm-cp-plus" aria-hidden="true">＋</span>{r.name}
                                  </button>
                                ))}
                              </div>
                              <div className="mm-cp-hint">{draftLead
                                ? t("{name} sings this one, so they lead the shot. Add who stands beside them — up to 2.", { name: castMemberName(draftLead) || t("This co-star") })
                                : t("The star always leads. Add up to 2 co-stars for this scene — or pick a face from your cast / the roster.")}</div>
                            </div>
                            )}
                            <div className="mm-sc-propcta">
                              <button type="button" className="mm-sp-confirm" onClick={() => confirmSceneCastMv(i)} disabled={rerollingScene !== null || !!outfitBusyFor}><Ico n="refresh" size={12} /> {t("Regenerate scene {n}", { n: i + 1 })}</button>
                              <button type="button" className="mm-sp-cancel" onClick={() => setSceneCastPick(null)}>{t("Cancel")}</button>
                            </div>
                          </div>
                        )}
                        {seeds && scenePropPick === i && (
                          <div className="mm-sc-propedit">
                            <div className="mm-sc-proppick">
                              <button type="button" className={`mm-sp-opt${!scenePropDraft ? " on" : ""}`} onClick={() => setScenePropDraft("")}>{t("None")}</button>
                              {(d.props || []).map((pp) => (
                                <button type="button" key={pp.key} className={`mm-sp-opt${scenePropDraft === pp.key ? " on" : ""}`} onClick={() => setScenePropDraft(pp.key)} title={t(pp.label)}>
                                  <span className="mm-sp-img" style={{ backgroundImage: `url(/propimg/${pp.key})` }} aria-hidden="true" />{t(pp.label)}
                                </button>
                              ))}
                              {customProps.map((c) => (
                                <button type="button" key={c.key} className={`mm-sp-opt${scenePropDraft === c.key ? " on" : ""}`} onClick={() => setScenePropDraft(c.key)} title={c.label}>
                                  <span className="mm-sp-img" style={{ backgroundImage: `url(${c.img})` }} aria-hidden="true" />{c.label}
                                </button>
                              ))}
                              <button type="button" className="mm-sp-opt mm-sp-new" onClick={() => setOpenCard("props")} title={t("Create or upload a prop")}>
                                <span className="mm-sp-img mm-sp-newimg" aria-hidden="true">＋</span>{t("New")}
                              </button>
                            </div>
                            <div className="mm-sc-propcta">
                              <button type="button" className="mm-sp-confirm" onClick={() => confirmScenePropMv(i)} disabled={rerollingScene !== null}><Ico n="refresh" size={12} /> {t("Regenerate scene {n}", { n: i + 1 })}</button>
                              <button type="button" className="mm-sp-cancel" onClick={() => setScenePropPick(null)}>{t("Cancel")}</button>
                            </div>
                          </div>
                        )}
                  </div>
                )}
                </Fragment>
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
  const firstTok = nameTok;
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
      .filter((c) => c.faceUrl && c.name && !!nameTok(c.name) && hay.includes(nameTok(c.name)))
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
      { intent: "previewFilmFrame", template, sceneVisual: s.visual, castText, styleRefUrl: styleRef, sceneIndex: String(i), castRefs: JSON.stringify(shotCastRefs(s)), ...(cast.some((c) => c.faceUrl && c.kind && c.kind !== "person") ? { creatureCast: "1" } : {}) },
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
    setCast((prev) => prev.map((c, j) => (j === i ? { ...c, faceUrl: u || null, kind: undefined, look: undefined } : c)));
  };
  const setCastVoice = (i: number, voiceId: string) => {
    setCast((prev) => rebalanceVoices(prev.map((c, j) => (j === i ? { ...c, voiceId: voiceId || null, autoVoice: false } : c))));
  };
  // Casting one of YOUR PRESENTERS brings their voice with them — only the face used to come across, so
  // a presenter you'd given a voice (or your own voice) showed up in the film sounding like someone else.
  const castPresenter = (i: number, r: { img: string; voiceId?: string | null; kind?: "person" | "cartoon" | "monster"; look?: string }) => {
    const u = (r.img || "").trim();
    if (u !== "" && !/^(https?:\/\/|\/)/.test(u)) return;
    // …and the others' automatic voices are re-picked around it, so the presenter's voice isn't also
    // on someone else in the scene.
    setCast((prev) => rebalanceVoices(prev.map((c, j) => (j === i ? { ...c, faceUrl: u || null, kind: r.kind || "person", look: r.look || "", ...(r.voiceId ? { voiceId: r.voiceId, autoVoice: false } : {}) } : c))));
  };
  // "Lock these voices" (dialogue films): each character speaks in exactly the voice picked for them.
  // Off by default — the video model voices the lines itself — and it switches itself ON the moment a
  // character is given one of your OWN voices, because picking that only means something if it's used.
  const [lockVoices, setLockVoices] = useState(false);
  const castHasOwnVoice = cast.some((c) => !!c.voiceId && d.myVoices.some((v) => v.voiceId === c.voiceId));
  useEffect(() => { if (castHasOwnVoice) setLockVoices(true); }, [castHasOwnVoice]);
  // THE OTHER FORMATS' GENERATE BUTTON SAYS IT WORKED, the way the music video's does (`alreadySent`): it
  // went straight back to a live "Generate …" the moment the film was queued, and a second tap queued the
  // same film again (audit of the story formats, 2026-11-22). It stays sent for the film that WAS sent and
  // comes back the moment anything in it changes — a line, a face, a shape: that is another film.
  // (the IDEA counts only while there is no script: once one is written IT is the film, and a letter typed
  //  in the idea box afterwards changes nothing that renders — it made the button live again, seen 11-22)
  const storySig = `story:${JSON.stringify([template, treatment ? "" : topic, scenes, told, storyPick, filmAspect, captions, narratorId, dialogueEngine, lockVoices, prodTitle, prodImage, treatment, frames, seeds?.imgs || null, cast.map((c) => [c.name, c.faceUrl, c.voiceId]), series?.from || ""])}`;
  const storySent = sentSig === storySig;
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
    // one of the shop's own voices plays its own preview line; stock voices play the bundled sample
    const own = d.myVoices.find((v) => v.voiceId === voiceId);
    if (own && !own.preview) return;
    try {
      if (voiceAudioRef.current) { voiceAudioRef.current.pause(); }
      // a performed character voice plays the take that was approved for it
      const a = new Audio(own ? own.preview : isCharacterVoice(voiceId) ? characterVoiceSample(voiceId) : `/voice-samples/${voiceId}.mp3`);
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

  // (Each poster's identity — name, line, note, tint, media — lives with its HERO in film-heroes.ts.
  //  What a poster says is in our own words: never another company's show, artist or rating system by
  //  name — two of them once said "Peppa / Bluey" and "CoComelon"; the owner, 2026-11-17: "they can't
  //  say those things".)
  const heroTitle = hero?.name || tmpl?.name || "Film";
  const fmtIcon = (key: string, told = false) => {
    if (told) return <svg viewBox="0 0 24 24"><path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H10a2 2 0 0 1 2 2v15a2 2 0 0 0-2-2H2z" /><path d="M22 5.5A2.5 2.5 0 0 0 19.5 3H14a2 2 0 0 0-2 2v15a2 2 0 0 1 2-2h8z" /></svg>;
    if (key === "musicvideo" || key === "kidsmusicvideo") return <svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>;
    if (key === "moral") return <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
    if (key === "horror") return <svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7v12l2.5-2 2.5 2 2-2 2 2 2.5-2 2.5 2V9a7 7 0 0 0-7-7z" /><circle cx="9.5" cy="10" r="1" /><circle cx="14.5" cy="10" r="1" /></svg>;
    if (key === "kidstv") return <svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8" /><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="9.5" cy="12" r="1" /><circle cx="14.5" cy="12" r="1" /><path d="M9 16c1 1 5 1 6 0" /></svg>;
    return <svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2.5" /><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 7h5M17 17h5" /></svg>;
  };
  /** A WIDE SCREEN'S ARROWS (FS_SHELF_GO): one click moves a shelf four posters, the way the arrow points (in
   *  a right-to-left page the row runs the other way). It glides — but not for anyone who asks for less motion. */
  const stepShelf = (el: HTMLElement, dir: -1 | 1) => {
    const row = el.closest(".fs-shelf")?.querySelector<HTMLElement>(".fs-fmtgrid");
    if (!row) return;
    const one = row.querySelector<HTMLElement>(".fs-fmt");
    const cs = getComputedStyle(row);
    const step = one ? 4 * (one.offsetWidth + (parseFloat(cs.columnGap) || 12)) : row.clientWidth * 0.8;
    const reduce = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    row.scrollBy({ left: dir * (cs.direction === "rtl" ? -1 : 1) * step, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div className={`fs-wrap${theme === "dark" ? " fs-theater" : ""}`} data-theme={theme}>
      <style dangerouslySetInnerHTML={{ __html: FS_STYLE }} />
      {/* THE FILM KIT (components/film): the starters under the idea box, the scene board — in both themes; it
          reads the theme from this root's data-theme, and its rules are its own (fk-) */}
      <style dangerouslySetInnerHTML={{ __html: FILM_KIT_CSS }} />
      {/* a wide screen's arrows on a shelf that runs on (FS_SHELF_GO) — only while the shelves are shown */}
      {!entered && <style dangerouslySetInnerHTML={{ __html: FS_SHELF_GO }} />}
      {/* the Lyric Video's card badge and builder, and the Found Footage door (LV_STYLE) — only where they are offered */}
      {(d.lyricVideo || d.foundFootage) && <style dangerouslySetInnerHTML={{ __html: LV_STYLE }} />}
      {/* THE THEATER: this section's DARK theme. Its own stylesheet, mounted only while the dark is chosen
          and only by this page — so the dark (the shell's too) arrives with the Movie Maker and leaves with
          it, and the light theme is the cream page it was. The shell's part is shared (lib/theater-shell.ts)
          and comes first; this page's own rules follow it — one sheet, the rules in the order they had. */}
      {theme === "dark" && <style dangerouslySetInnerHTML={{ __html: THEATER_SHELL_CSS + FS_THEATER }} />}
      {/* KEEP IN MY CAST — the one character dialog, opened on a story's own character (its styles ride in FS_STYLE) */}
      <CharacterForge open={!!keep} seed={keep} onClose={() => setKeep(null)} />
      {/* the ID card of the face pointed at (a mouse) or held (a finger) — for every picker on the page */}
      <CastPeek peek={peek} targets={peekTargets} />

      {/* The "Make a movie" hero shows only while picking a format — once a format is chosen, its own
          banner (fs-hero) REPLACES it so there aren't two stacked headers. */}
      {!entered && (
      <div className={`fs-head${anim === "in" ? " throw" : ""}`}>
        {/* A reel of real renders, one per format, instead of one clip on a loop. */}
        <HeroReel clips={HERO_REEL.filter((c) => !c.key || heroes.some((h) => h.media === c.key))} onShow={setReelKey} />
        <span className="fs-head-scrim" aria-hidden="true" />
        <div className="fs-head-copy">
          <span className="fs-head-eyebrow"><Ico n="film" size={13} /> {t("Easymode Studio")}</span>
          <b>{t("Make a movie.")} <em>{t("Just describe it.")}</em></b>
          <span>{t("Pick a format, tell us the idea — we write it and film it. You just press go.")}</span>
        </div>
        {/* what is playing — and a way straight into making one */}
        {(() => {
          // (a reel clip is keyed by its poster media; the hero it shows off is the one with that media)
          const playing = reelKey ? heroes.find((h) => h.media === reelKey) : null;
          return playing ? (
            <button type="button" className="fs-head-tag" key={reelKey} onClick={() => enterFormat(playing.id)}>
              <i aria-hidden="true" />{t(playing.name)}<em> · {t("made here")}</em>
            </button>
          ) : null;
        })()}
      </div>
      )}

      {/* ───────── Pick a format, cinematic ─────────
          Land on a 2-up grid of poster cards. Tap one → the letterbox sweeps shut and it opens, like a
          title card, into THAT format's builder (no doom-scroll past tiles you aren't using). */}
      {/* A MUSIC VIDEO IN THE MAKING IS KEPT (mv-draft.ts): found in this browser on arrival, offered back
          with one tap. "Not now" only puts the card away — nothing is thrown out. */}
      {draft && !seeds && (
        <div className="mm-kept" role="status">
          {draft.seeds.imgs.find(Boolean) ? <img className="mm-kept-pic" src={draft.seeds.imgs.find(Boolean) as string} alt="" /> : null}
          <div className="mm-kept-txt">
            <b>{t("Your music video is still here")}</b>
            <span>{t("{n} scenes drawn", { n: draftScenes(draft) })}{draft.topic ? ` · “${draft.topic}”` : ""}</span>
          </div>
          <button type="button" className="mm-kept-go" onClick={resumeDraft}>{t("Pick it up")}</button>
          <button type="button" className="mm-kept-x" onClick={() => setDraft(null)} aria-label={t("Not now")} title={t("Not now")}>✕</button>
        </div>
      )}
      {/* NEXT EPISODE (film-series.ts): the member's latest story films — one per series — each one tap from
          its next episode: the same format, cast, look and voices, and the writer knows what happened. */}
      {!entered && (() => {
        const eps = (d.nextEpisodes || []).filter((c) => heroes.some((h) => h.id === c.heroId));
        return eps.length ? (
          <section className={`fs-eps${anim === "in" ? " throw" : ""}`} aria-labelledby="fs-eps-h">
            <h2 id="fs-eps-h" className="fs-eps-h">{t("Next episode")}</h2>
            <div className="fs-eps-row">
              {eps.map((c) => (
                <button type="button" key={c.from} className="fs-ep-card" onClick={() => startEpisode(c)} aria-label={t("Make episode {n} of “{title}”", { n: c.episode, title: c.title })}>
                  {/* the film's own POSTER when it made one (story-poster.ts) — else its first frame, in the same shape */}
                  <img className="fs-ep-pic" src={c.poster || `/vthumb/${c.video.split("?")[0].split("/").pop()}`} alt="" loading="lazy" decoding="async"
                    onError={(e) => { const el = e.currentTarget; if (c.poster && el.dataset.fell !== "1") { el.dataset.fell = "1"; el.src = `/vthumb/${c.video.split("?")[0].split("/").pop()}`; } else el.style.visibility = "hidden"; }} />
                  <span className="fs-ep-txt">
                    <b>{c.title}</b>
                    <span><Ico n="film" size={12} /> {t("Episode {n}", { n: c.episode })}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null;
      })()}
      <div className="fs-switch">
        {!entered && (
          <div className={`fs-shelves${anim === "in" ? " throw" : ""}`}>
            {/* THE SHELVES (film-heroes.ts → heroShelves): what is TOLD by a narrator, what is ACTED on camera
                and what is SUNG each stand under their own heading, which says in a line what every poster
                on that shelf has in common — nobody has to open one to find out. */}
            {heroShelves(heroes).map((sh) => (
            <section key={sh.key} className={`fs-shelf is-${sh.key}`} aria-labelledby={`fs-shelf-${sh.key}`}>
              {/* the card's ENGRAVING (THE TICKET, in the stylesheet): a layer that covers the card and cuts
                  itself to the card's shape, so the card itself clips nothing — a picture only */}
              <span className="fs-shelf-wm" aria-hidden="true" />
              <header className="fs-shelf-h">
                <span className="fs-shelf-ico" aria-hidden="true"><Ico n={sh.key === "told" ? "book" : sh.key === "acted" ? "film" : "music"} size={18} /></span>
                <span className="fs-shelf-txt">
                  <h2 className="fs-shelf-name" id={`fs-shelf-${sh.key}`}>{t(sh.name)}</h2>
                  <span>{t(sh.line)}</span>
                </span>
                <em className="fs-shelf-tag">{t(sh.tag)}</em>
              </header>
          <div className={`fs-fmtgrid${anim === "in" ? " throw" : ""}`} role="tablist" aria-label={t(sh.name)}>
            {/* one poster per HERO (film-heroes.ts): a format as it is told. A narrated hero's poster is a
                strip of three upright pictures with their captions — it looks like what it makes. */}
            {/* THE POSTER SAYS THE MOVIE CATEGORY (2026-11-25 — the owner: "Our genres need to be movie categories
                (drama, horror, comedy, etch)"): "Comedy", not "Comedy Film" — the shelf it stands on says how it
                is told. Two posters now carry the same word, one per shelf, so a screen reader is told the whole
                name ("Comedy Film", "Comedy Story") with the line under it. */}
            {sh.heroes.map((h) => (
              <button type="button" role="tab" key={h.id} className={`fs-fmt${zoomKey === h.id ? " zoom" : ""}${h.told === "narrated" ? " is-told" : ""}`}
                aria-selected={heroId === h.id} aria-label={[t(h.name), h.kick ? t(h.kick) : "", h.meta ? t(h.meta) : ""].filter(Boolean).join(" · ")} onClick={() => enterFormat(h.id)}>
                <span className="fs-fmt-cover">
                  <LoopCover k={h.media} />
                  <span className={`fs-fmt-ico ${h.tint}`} aria-hidden="true">{fmtIcon(h.tmpl, h.told === "narrated")}</span>
                  <span className="fs-fmt-label"><b>{t(h.card)}</b></span>
                </span>
                {h.kick ? <span className="fs-fmt-sub">{t(h.kick)}{h.meta ? <em> · {t(h.meta)}</em> : null}</span> : null}
              </button>
            ))}
            {/* THE LYRIC VIDEO (film-heroes.ts → LYRIC_HERO): after the sung heroes — operators only until it has a price */}
            {sh.key === "sung" && d.lyricVideo && (
              <button type="button" role="tab" key={LYRIC_HERO.id} className={`fs-fmt${zoomKey === LYRIC_HERO.id ? " zoom" : ""}`}
                aria-selected={lyricOn} onClick={() => enterFormat(LYRIC_HERO.id)}>
                <span className="fs-fmt-cover">
                  <LoopCover k={LYRIC_HERO.media} loop tall />
                  <span className={`fs-fmt-ico ${LYRIC_HERO.tint}`} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 6h11M3 11h11M3 16h7" /><path d="M18 17V5l3 1" /><circle cx="16" cy="17" r="2" /></svg></span>
                  <span className="fs-fmt-label"><b>{t(LYRIC_HERO.name)}</b></span>
                </span>
                <span className="fs-fmt-sub">{t(LYRIC_HERO.kick)}<em> · {t(LYRIC_HERO.meta)}</em></span>
              </button>
            )}
            {/* THE WAY INTO FOUND FOOTAGE (film-heroes.ts → FOUND_FOOTAGE_DOOR): its own builder, at the end of the Films
                shelf — a door, not a hero this page builds. Operators only, like the builder it opens. */}
            {sh.key === "acted" && d.foundFootage && (
              <a role="tab" aria-selected={false} key={FOUND_FOOTAGE_DOOR.id} className="fs-fmt fs-door" href={FOUND_FOOTAGE_DOOR.href}>
                <span className="fs-fmt-cover">
                  <LoopCover k={FOUND_FOOTAGE_DOOR.id} still={FOUND_FOOTAGE_DOOR.still} clip={FOUND_FOOTAGE_DOOR.clip} />
                  <span className={`fs-fmt-ico ${FOUND_FOOTAGE_DOOR.tint}`} aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3" /><circle cx="6" cy="9.5" r="1" /></svg></span>
                  <span className="fs-fmt-label"><b>{t(FOUND_FOOTAGE_DOOR.name)}</b></span>
                </span>
                <span className="fs-fmt-sub">{t(FOUND_FOOTAGE_DOOR.kick)}<em> · {t(FOUND_FOOTAGE_DOOR.meta)}</em></span>
              </a>
            )}
          </div>
              {/* A WIDE SCREEN'S ARROWS (FS_SHELF_GO): a mouse's way along a shelf that runs on past four — shown
                  only where there is a mouse and room for four; nothing a keyboard or a screen reader steps through */}
              {sh.heroes.length + (sh.key === "sung" && d.lyricVideo ? 1 : 0) + (sh.key === "acted" && d.foundFootage ? 1 : 0) > 4 && (<>
                <span className="fs-shelf-arrow is-back" aria-hidden="true" onClick={(e) => stepShelf(e.currentTarget, -1)}><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg></span>
                <span className="fs-shelf-arrow is-on" aria-hidden="true" onClick={(e) => stepShelf(e.currentTarget, 1)}><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg></span>
              </>)}
            </section>
            ))}
          </div>
        )}

        {entered && (
          <div className={`fs-stage${anim === "out" ? " out" : ""}`}>
            <div className="fs-hero">
              <img className="fs-hero-blur" src={stillOf(hero?.media || template)} alt="" aria-hidden="true" onError={stillFallback} />
              <img className="fs-hero-art" src={stillOf(hero?.media || template)} alt="" onError={stillFallback} />
              <div className="fs-hero-scrim" aria-hidden="true" />
              <button type="button" className="fs-hero-back" onClick={exitFormat}><span aria-hidden="true">‹</span> {t("Formats")}</button>
              <div className="fs-hero-ttl">{t(heroTitle)}</div>
              <div className="fs-hero-sub">{t(hero?.kick || "")}{hero?.meta ? ` · ${t(hero.meta)}` : ""}</div>
            </div>
            <div className="fs-stepsin" key={lyricOn ? LYRIC_HERO.id : template}>
            {/* THE LYRIC VIDEO has its own builder (LyricVideoBuilder, below); every other format, the builders here */}
            {lyricOn ? <LyricVideoBuilder t={t} /> : (<>

      {/* ───────── Music Video — the card builder (elegant, Studio-style) ─────────
          One topic field + four summary cards you tap to edit, then Generate.
          Replaces the long-scroll form for the sing lanes only. */}
      {tmpl?.lipSyncSinger && (
        <div className="mm">
          <div className="mm-topic">
            <label htmlFor="mm-topic-in">{t("What's your video about?")}</label>
            {/* (a box that GROWS with the idea: it was one line, and a phone showed "late night drive through
                the city, two pe…" — the rest of the idea out of sight. Enter is not a new line; an idea is one.) */}
            <textarea id="mm-topic-in" className="mm-topic-grow" rows={1} value={topic} onChange={(e) => setTopic(e.target.value.replace(/[\r\n]+/g, " "))} maxLength={IDEA_MAX}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
              placeholder={t("e.g. grinding from nothing, staying loyal, winning big")} />
            {ideaChanged && seeds && <p className="mm-note mm-idea-kept" role="status">{t("What you've made stays as it is — start over to use the new idea.")}</p>}
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
                <span className="mm-card-ttl"><span className="mm-card-kick">{t("The lead")}</span><b>{t("Star")}</b></span>
              </span>
              <span className="mm-val">{artistPick ? <><Ico n="check" size={12} /> {artistName || t("Your avatar")}{castExtra.length > 0 ? t(" + {n} cast", { n: castExtra.length }) : ""}</> : t("We cast one · or pick your avatar")}</span>
              {castExtra.length > 0 && (
                <span className="mm-card-cast" aria-hidden="true">
                  {[{ img: artistPick, name: artistName }, ...castExtra].filter((m) => m.img).slice(0, 6).map((m, k) => (
                    <span key={`${m.img}-${k}`} className={`mm-card-castface${k === 0 ? " lead" : ""}`} style={{ backgroundImage: `url(${avatarFace(m.img || "")})` }} title={m.name} />
                  ))}
                </span>
              )}
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
              <span className="mm-card-top">{filmProps.length > 0 ? <span className="mm-card-face" style={{ backgroundImage: `url(${propThumb(filmProps[0])})` }} aria-hidden="true" /> : <span className="mm-card-ico c3"><Ico n="gem" size={20} /></span>}<span className="mm-card-ttl"><span className="mm-card-kick">{t("The extras")}</span><b>{t("Props")}</b></span></span>
              {filmProps.length > 0 ? (
                <span className="mm-vchips">{filmProps.slice(0, 3).map((k) => { const p = (d.props || []).find((x) => x.key === k); const cp = customProps.find((x) => x.key === k); return <span className="mm-chip" key={k}>{cp ? cp.label : t(p?.name || k)}</span>; })}{filmProps.length > 3 && <span className="mm-chip">+{filmProps.length - 3}</span>}</span>
              ) : <span className="mm-val mm-muted">{t("none yet · tap to add tigers, cars, chains…")}</span>}
            </button>
            {/* 5 · Length */}
            <button type="button" style={{ order: 9 }} className={`mm-card${openCard === "length" ? " on" : ""}${stepsDone.length ? " done" : ""}`} onClick={() => tapCard("length")}>
              <span className="mm-step" aria-hidden="true">{stepsDone.length ? <Ico n="check" size={13} /> : 5}</span>
              <span className="mm-card-top"><span className="mm-card-ico c4"><Ico n="film" size={20} /></span><span className="mm-card-ttl"><span className="mm-card-kick">{t("The cut")}</span><b>{t("Length")}</b></span></span>
              <span className="mm-val">{mvSceneCount === 1 ? t("{len} · 1 scene", { len: lengthLabel(mvSceneCount * mvSceneSec) }) : t("{len} · {n} scenes", { len: lengthLabel(mvSceneCount * mvSceneSec), n: mvSceneCount })}</span>
            </button>
            {/* 6 · Pace — how fast it is cut. Rap cuts fast, a country ballad lingers; the genre picks, you can overrule. */}
            <button type="button" style={{ order: 11 }} className={`mm-card${openCard === "pace" ? " on" : ""}${stepsDone.pace ? " done" : ""}`} onClick={() => tapCard("pace")}>
              <span className="mm-step" aria-hidden="true">{stepsDone.pace ? <Ico n="check" size={13} /> : 6}</span>
              <span className="mm-card-top"><span className="mm-card-ico c1"><Ico n="scissors" size={20} /></span><span className="mm-card-ttl"><span className="mm-card-kick">{t("The edit")}</span><b>{t("Pace")}</b></span></span>
              <span className="mm-val">{t(PACES[mvPace].label)} · {pacePick ? t("your pick") : t("set by the genre")}</span>
            </button>

            {/* Each step's options live INSIDE the grid, full-width right after its own card (via CSS
                `order`), so tapping a step opens its options AT the card — never buried down the page. */}
          {openCard === "artist" && (
            <div className="mm-opts mm-opts-grid" style={{ order: 2 }}>
              <div className="mm-opts-h">{t("Who's the star?")}</div>
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
                {mvRoster.map((r) => (
                  <button type="button" key={r.id} className={`fs-rface${artistPick === r.img ? " on" : ""}`} title={r.name} onClick={() => setArtistPick(r.img)}
                    {...peekOn(`star:${r.id}`, r, artistPick === r.img, () => setArtistPick(r.img))}>
                    <span className="fs-rface-img" style={{ backgroundImage: `url(${r.img})` }} />
                    {artistPick === r.img && <span className="fs-rface-chk" aria-hidden="true"><Ico n="check" size={11} /></span>}
                    <span className="fs-rface-name">{r.name}</span>
                  </button>
                ))}
              </div>
              {peekHint}
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
              {artistPick && (
                <div className="mm-gender">
                  <span className="mm-gender-lbl">{t("Voice")}</span>
                  <div className="mm-gender-seg">
                    <button type="button" className={`mm-gender-opt${artistGender === "m" ? " on" : ""}`} aria-pressed={artistGender === "m"} onClick={() => setArtistGender("m")}>{t("Male")}</button>
                    <button type="button" className={`mm-gender-opt${artistGender === "f" ? " on" : ""}`} aria-pressed={artistGender === "f"} onClick={() => setArtistGender("f")}>{t("Female")}</button>
                  </div>
                  <span className="mm-gender-hint">{t("Sets the singing voice — check it matches an uploaded face")}</span>
                </div>
              )}
              {artistPick && <div className="mm-artist-wd">{outfitSlider(artistPick, artistName || t("the star"))}</div>}
              {outfitFetcher.data?.error && <p className="fs-err">{outfitFetcher.data.error}</p>}
              {/* The CAST LIBRARY — optional extra people beyond the lead. Pick faces (your avatars or the
                  roster), name them; on the scenes below you choose who's in each shot. */}
              <div className="mm-castlib">
                <div className="mm-castlib-h">{t("The rest of your cast")} <span className="mm-castlib-badge">{t("optional")}</span></div>
                <div className="mm-opts-sub">{t("Add up to 2 co-stars — a love interest, a bandmate, a dancer. (The star + 2 keeps every face sharp; more than that and the AI starts warping them.) Name them, then pick who's in each scene below.")}</div>
                {castExtra.length > 0 && (
                  <div className="mm-castlib-list">
                    {castExtra.map((m) => (
                      <div className="mm-castmem-wrap" key={m.img}>
                        <div className="mm-castmem">
                          <button type="button" className={`mm-castmem-face mm-castmem-faceb${wardrobeOpen === m.img ? " on" : ""}`} style={{ backgroundImage: `url(${avatarFace(m.img)})` }} onClick={() => setWardrobeOpen(wardrobeOpen === m.img ? null : m.img)} title={t("Change outfit")} aria-label={t("Change {name}'s outfit", { name: m.name || t("co-star") })}>
                            <span className="mm-castmem-wd" aria-hidden="true"><Ico n="shirt" size={10} /></span>
                          </button>
                          <input className="mm-castmem-name" value={m.name} onChange={(e) => renameCastMemberMv(m.img, e.target.value)} maxLength={24} aria-label={t("Cast member name")} />
                          {/* WHO sings the verse — shown once "Two voices" (below) is on and there is a choice to make */}
                          {featured.length > 0 && singable.length > 1 && canSingImg(m.img)
                            ? <button type="button" className={`mm-castmem-feat${featPick.includes(m.img) ? " on" : ""}`} aria-pressed={featPick.includes(m.img)} disabled={tooShortToFeature && !featPick.includes(m.img)} onClick={() => toggleFeat(m.img)}
                                title={tooShortToFeature ? t("A verse needs a video of 20 seconds or more") : t("{name} sings a verse of the song in their own voice — like a featured artist", { name: m.name || t("This co-star") })}>
                                <Ico n="mic" size={12} /> {featPick.includes(m.img) ? t("Sings a verse") : t("Give a verse")}
                              </button>
                            : null}
                          <button type="button" className="mm-castmem-del" onClick={() => addCastMemberMv(m.img, m.name)} aria-label={t("Remove from cast")}>✕</button>
                        </div>
                        {wardrobeOpen === m.img && outfitSlider(m.img, m.name || t("co-star"))}
                      </div>
                    ))}
                  </div>
                )}
                {/* TWO VOICES — a plain switch, OFF unless the maker turns it on. Adding co-stars puts them
                    in the video; it never makes them sing. (The owner, 2026-11-22: "multiple presenter clips
                    should not mean automatic feature (two voices song) needs to be toggle".) */}
                {singable.length > 0 && (
                  <button type="button" role="switch" aria-checked={featured.length > 0} className={`mm-twovoice${featured.length > 0 ? " on" : ""}`} disabled={tooShortToFeature && featured.length === 0}
                    onClick={() => setFeatPick(featured.length > 0 ? [] : [singable[0].img])}>
                    <span className="mm-switch" aria-hidden="true" />
                    <span className="mm-twovoice-txt">
                      <b>{t("Two voices")}</b>
                      <span>{featured.length > 0
                        ? t("On — {name} sings one verse in their own voice, while they are on screen. {star} sings the rest.", { name: featured.map((m) => m.name.trim()).join(" & "), star: artistName || t("The star") })
                        : tooShortToFeature
                        ? t("A verse needs a video of 20 seconds or more")
                        : t("Off — {star} sings the whole song. Turn on to give a co-star a verse.", { star: artistName || t("The star") })}</span>
                    </span>
                  </button>
                )}
                <div className="mm-artistpick mm-castpick">
                  {customArtists.map((ca, i) => (
                    <button type="button" key={`cx${i}`} className={`fs-rface${castExtra.some((m) => m.img === ca.img) ? " on" : ""}`} title={ca.name} onClick={() => addCastMemberMv(ca.img, ca.name)}>
                      <span className="fs-rface-img" style={{ backgroundImage: `url(${ca.img})` }} />
                      {castExtra.some((m) => m.img === ca.img) && <span className="fs-rface-chk" aria-hidden="true"><Ico n="check" size={11} /></span>}
                      <span className="fs-rface-name">{ca.name}</span>
                    </button>
                  ))}
                  {mvRoster.map((r) => (
                    <button type="button" key={`cx-${r.id}`} className={`fs-rface${castExtra.some((m) => m.img === r.img) ? " on" : ""}`} title={r.name} onClick={() => addCastMemberMv(r.img, r.name)}
                      {...peekOn(`co:${r.id}`, r, castExtra.some((m) => m.img === r.img), () => addCastMemberMv(r.img, r.name), castExtra.length >= MAX_COSTARS)}>
                      <span className="fs-rface-img" style={{ backgroundImage: `url(${r.img})` }} />
                      {castExtra.some((m) => m.img === r.img) && <span className="fs-rface-chk" aria-hidden="true"><Ico n="check" size={11} /></span>}
                      <span className="fs-rface-name">{r.name}</span>
                    </button>
                  ))}
                </div>
              </div>
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
              <div className="mm-opts-sub">{t("Pick the exact length — your video comes out this long, to the second. How many scenes that is follows from the pace: the faster the cut, the more scenes.")}</div>
              <div className="mm-lenpick" role="group" aria-label={t("Video length")}>
                {MV_SECONDS.filter((s) => s <= MV_MAX_SECONDS).map((s) => {
                  const n = sceneCountFor(s, mvSceneSec);
                  return (
                    <button type="button" key={s} className={`mm-lenopt${mvSeconds === s ? " on" : ""}`} aria-pressed={mvSeconds === s} onClick={() => setMvSeconds(s)}>
                      <b>{lengthLabel(s)}</b>
                      <small>{n === 1 ? t("1 scene") : t("{n} scenes", { n })}</small>
                    </button>
                  );
                })}
              </div>
              <div className="mm-opts-sub mm-lentip">{t("Longer = more scenes to shoot, so it takes a bit longer to render (and will cost a little more once pricing's on).")}</div>
            </div>
          )}
          {openCard === "pace" && (() => {
            // what each pace makes of THIS video: how many scenes its length is, and how many times the
            // picture changes (the pace it is at now is counted from its scenes as they stand)
            const paceShape = (p: Pace): { n: number; cuts: number } => {
              const sec = sceneSecondsFor(p);
              const mine = sec === mvSceneSec && !!seeds;
              const n = mine && seeds ? seeds.treatment.scenes.length : sceneCountFor(mvSeconds, sec);
              const roles = Array.from({ length: n }, (_, i) => (mine && seeds ? sceneKind(seeds.treatment.scenes[i], i, n) : defaultRole(i, n, sec)));
              return { n, cuts: cutCount(roles, sec, p) };
            };
            return (
              <div className="mm-opts mm-opts-grid" style={{ order: 12 }}>
                <div className="mm-opts-h">{t("How fast should it cut?")}</div>
                <div className="mm-opts-sub">{t("The genre sets the pace — rap and pop cut fast, a country ballad lingers. Pick one to overrule it. A faster pace is more scenes in the same length.")}</div>
                <div className="mm-lenpick mm-pacepick" role="group" aria-label={t("Pace")}>
                  {PACE_KEYS.map((p) => {
                    const { n, cuts } = paceShape(p);
                    return (
                      <button type="button" key={p} className={`mm-lenopt${mvPace === p ? " on" : ""}`} aria-pressed={mvPace === p} onClick={() => setPacePick(p)}>
                        <b>{t(PACES[p].label)}</b>
                        <small>{t(PACES[p].blurb)}</small>
                        <small className="mm-pace-n">{n === 1 ? t("1 scene") : t("{n} scenes", { n })} · {cuts === 0 ? t("one shot") : cuts === 1 ? t("1 cut") : t("{n} cuts", { n: cuts })}{GENRE_PACE[filmGenre] === p ? ` · ${t("this genre's own")}` : ""}</small>
                      </button>
                    );
                  })}
                </div>
                {pacePick && <button type="button" className="mm-pace-auto" onClick={() => setPacePick("")}><Ico n="refresh" size={12} /> {t("Let the genre decide")}</button>}
                {seeds && <div className="mm-opts-sub mm-lentip">{t("Slow is made of longer scenes, so switching to or from Slow makes the scenes again. Medium and Fast share the same scenes.")}</div>}
              </div>
            );
          })()}
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
            <div className="mm-aspect" role="group" aria-label={t("Shape")}>
              <span className="mm-aspect-lbl">{t("Shape")}</span>
              <div className="mm-aspect-seg">
                {([["9:16", "Vertical"], ["16:9", "Wide"], ["1:1", "Square"]] as const).map(([a, name]) => (
                  <button type="button" key={a} className={`mm-aspect-opt${mvAspect === a ? " on" : ""}${shapeArm === a ? " arm" : ""}`} aria-pressed={mvAspect === a} onClick={() => pickMvAspect(a)}>{shapeArm === a ? t("Tap again to redraw") : t(name)}<small>{a}</small></button>
                ))}
              </div>
            </div>
            {/* (the scenes are drawn IN a shape: once they exist, another shape draws them all again) */}
            {shapeArm && <p className="mm-note mm-shape-warn" role="status">{t("A new shape draws every scene again, and your scene edits start over.")}</p>}
            {/* the song's own lyrics on screen, timed to the singing as it was sung */}
            <div className="mm-aspect" role="group" aria-label={t("Lyrics on screen")}>
              <span className="mm-aspect-lbl">{t("Lyrics on screen")}</span>
              <div className="mm-aspect-seg">
                {(["off", "bold", "subtitles"] as const).map((k) => (
                  <button type="button" key={k} className={`mm-aspect-opt${mvLyrics === k ? " on" : ""}`} aria-pressed={mvLyrics === k} onClick={() => setMvLyrics(k)}>
                    {k === "bold" ? t("Big words") : k === "subtitles" ? t("Subtitles") : t("Off")}
                    <small>{k === "bold" ? t("in time") : k === "subtitles" ? t("each line") : t("none")}</small>
                  </button>
                ))}
              </div>
            </div>
            {tmpl?.lipSyncSinger && artistPick && artistVoiceId && (
              <label className="mm-voicetog">
                <input type="checkbox" checked={singVoice} onChange={(e) => setSingVoice(e.target.checked)} />
                <span className="mm-voicetog-txt">
                  <b><Ico n="music" size={13} /> {t("Sing in {name}'s own voice", { name: artistName || t("your avatar") })} <span className="mm-beta">{t("beta")}</span></b>
                  <small>{t("Your avatar's own voice sings the song instead of a generic singer. The first video with a voice takes about 8 minutes longer while we learn it — after that, about a minute.")}</small>
                </span>
              </label>
            )}
            {/* ONE BUTTON FOR ONE STEP. Before there is a storyboard the big button MAKES it (it used to be a
                dashed button, a disabled "Make the scenes first ↑" under it, and a note saying so again).
                Once there is one, the big button renders it and "Start over" is the small one. */}
            {seeds ? makeBtn() : (<>
              {sceneSeedsFetcher.data?.error && <p className="fs-err">{sceneSeedsFetcher.data.error}</p>}
              {seedBusy && seedProgressUI()}
            </>)}
            <Form method="post" onSubmit={() => { sigAtSubmit.current = renderSig; }}>
              <input type="hidden" name="intent" value="film" />
              <input type="hidden" name="template" value={template} />
              <input type="hidden" name="filmGenre" value={filmGenre} />
              <input type="hidden" name="filmPace" value={mvPace} />
              <input type="hidden" name="filmSceneSeconds" value={String(mvSceneSec)} />
              <input type="hidden" name="filmCaptions" value={mvLyrics} />
              {songSource === "upload" && filmSongUrl && <input type="hidden" name="filmSongUrl" value={filmSongUrl} />}
              {filmProps.length > 0 && <input type="hidden" name="filmProps" value={JSON.stringify(filmProps)} />}
              {customProps.length > 0 && <input type="hidden" name="filmCustomProps" value={JSON.stringify(customProps)} />}
              {artistPick && <input type="hidden" name="filmHeroUrl" value={artistPick} />}
              {castExtra.length > 0 && <input type="hidden" name="filmCastExtra" value={JSON.stringify(castExtra)} />}
              {tmpl?.lipSyncSinger && seeds && castExtra.length > 0 && <input type="hidden" name="filmCastForScene" value={JSON.stringify(resolveCastMap(seeds.treatment.scenes))} />}
              {tmpl?.lipSyncSinger && Object.keys(outfits).length > 0 && <input type="hidden" name="filmOutfits" value={JSON.stringify(outfits)} />}
              {tmpl?.lipSyncSinger && Object.keys(outfitImgs).length > 0 && <input type="hidden" name="filmOutfitImgs" value={JSON.stringify(outfitImgs)} />}
              {tmpl?.lipSyncSinger && artistName && <input type="hidden" name="filmArtistName" value={artistName} />}
              {tmpl?.lipSyncSinger && castNames.length > 0 && <input type="hidden" name="filmCastNames" value={JSON.stringify(castNames)} />}
              {tmpl?.lipSyncSinger && <input type="hidden" name="filmArtistGender" value={artistGender} />}
              {tmpl?.lipSyncSinger && castGenders.length > 0 && <input type="hidden" name="filmCastGenders" value={JSON.stringify(castGenders)} />}
              {tmpl?.lipSyncSinger && <input type="hidden" name="filmAspect" value={mvAspect} />}
              {tmpl?.lipSyncSinger && singVoice && artistVoiceId && <input type="hidden" name="filmSingVoice" value="1" />}
              {tmpl?.lipSyncSinger && singVoice && artistVoiceId && <input type="hidden" name="filmArtistVoiceId" value={artistVoiceId} />}
              {tmpl?.lipSyncSinger && singingNow.length > 0 && <input type="hidden" name="filmFeature" value={featureAllJson} />}
              <input type="hidden" name="filmTopic" value={topic} />
              <input type="hidden" name="filmScenes" value={String(scenes)} />
              {(seeds?.treatment || treatment) && <input type="hidden" name="approvedTreatment" value={JSON.stringify(seeds?.treatment || treatment)} />}
              {seeds && <input type="hidden" name="approvedSceneImgs" value={JSON.stringify(seeds.imgs)} />}
              {/* Generating is GATED on making the scenes first — you must script + preview the
                  storyboard (above) before you can spend tokens on the render. */}
              {seeds ? (
                <button type="submit" className={`mm-go${alreadySent ? " is-sent" : ""}`} disabled={!canGo || alreadySent}>
                  {generating ? <>… {t("Starting your video")}</>
                    : alreadySent ? <><Ico n="check" size={17} /> {t("Rendering — it lands in your Archive")}</>
                    : <><Ico n="film" size={17} /> {cost > 0 ? t("Render these scenes · {cost} Tokens", { cost }) : t("Render these scenes")}</>}
                </button>
              ) : (
                <button type="button" className="mm-go" onClick={makeStoryboard} disabled={writing || seedBusy || chainToScenes || !d.hasPlan}>
                  {writing ? <>… {t("Writing your song")}</>
                    : (seedBusy || chainToScenes) ? <>… {t("Building the scenes")}</>
                    : <><Ico n="wand" size={17} /> {t("Make the scenes — free")}</>}
                </button>
              )}
            </Form>
            {!seeds && <p className="mm-note mm-note-req"><Ico n="check" size={12} /> {t("Free — you see and edit every scene before anything is rendered.")}</p>}
            <div className="mm-eta"><span aria-hidden="true">⏱</span> {t("Est. render time")} <b>{filmEta({ lipSyncSinger: true, dialogue: false, scenes: mvSceneCount, sceneSec: mvSceneSec, engine: dialogueEngine })}</b></div>
            <p className="mm-note">{cost > 0 ? <>{t("{base} + {per}/scene × {n} = {cost} Tokens", { base: d.base, per: d.perScene, n: mvBillScenes(mvSceneCount, mvSceneSec), cost })} · <span className={affordable ? "fs-bal" : "fs-bal low"}>{t("you have {n}", { n: d.tokens })}</span></> : t("Free while we dial this in — pricing comes later.")}</p>
            {!d.hasPlan && <p className="fs-err">{t("Pick a plan on the Dashboard first — film runs on tokens.")}</p>}
            {d.hasPlan && !affordable && <p className="fs-err">{t("Not enough tokens for this length — shorten it, or top up on the Plans page.")}</p>}
            {actionData?.error && <p className="fs-err">{actionData.error}</p>}
            {actionData?.ok && <p className="fs-ok"><Ico n="check" size={14} /> {t("Rolling! Your video is rendering — it'll land in your Archive when it's done. You can keep working.")}</p>}
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
        {/* EDIT STORY: the one line that says what this storyboard is, and what Generate will do */}
        {isStoryboard && narrated && editing && (
          <p className="fs-editline" role="status">
            <Ico n="pencil" size={14} />
            <span>{editing.kept
              ? t("Editing “{title}” — its pictures are kept. Change the words below, then Generate: it lands as a new piece.", { title: editing.title })
              : t("Editing “{title}” — its pictures were not kept, so they will be drawn again.", { title: editing.title })}</span>
          </p>
        )}
        {/* NEXT EPISODE: the one line that says what this is — ✕ makes it an ordinary new film */}
        {isStoryboard && series ? (
          <div className="fs-epline">
            <label htmlFor="fs-topic-in"><Ico n="film" size={14} /> {t("Episode {n} of “{title}”", { n: series.episode, title: series.title })}</label>
            <button type="button" className={`fs-epline-x${wipeArm === "series:" ? " is-arm" : ""}`} onClick={dropSeries} aria-label={t("Make an ordinary new film instead")} title={t("Make an ordinary new film instead")}><Ico n="x" size={14} /></button>
          </div>
        ) : (
          <label htmlFor="fs-topic-in">{tmpl?.needsProduct ? t("What's the gag?") : narrated ? t("What's your story about?") : tmpl?.sung ? t("What's your song about?") : t("What's your movie about?")}</label>
        )}
        {wipeNote("series:")}
        {/* (THE WRITER'S NUDGE: a story's box asks for who, where and what goes wrong — it no longer promises to
            "surprise you" with a blank; a next episode's may be left empty: it picks up where the last one ended) */}
        <textarea id="fs-topic-in" rows={3} value={topic} onChange={(e) => { setTopic(e.target.value); if (e.target.value.trim()) setNudgeUrge(false); }}
          placeholder={isStoryboard && series ? t("What happens next? (or leave it — we pick up where it ended)") : tmpl?.needsProduct ? t("the joke, the vibe, who's in it… or leave blank and we'll write one") : nudgeable ? t("a sentence or two: who, where, what goes wrong") : t("a theme, a story, a mood… or leave blank and we'll surprise you")} maxLength={IDEA_MAX} />
        {/* the genre's starters, under the box, until there is a script (or the box is asked about again) */}
        {nudgeable && (nudgeUrge || (!treatment && !seeds)) && (
          <StarterNudges starters={dealStarters(template, nudgeSeed, 3)} urge={nudgeUrge} disabled={writing}
            onPick={(text) => { setTopic(text); setNudgeUrge(false); if (window.matchMedia?.("(hover:hover) and (pointer:fine)").matches) document.getElementById("fs-topic-in")?.focus({ preventScroll: true }); }}
            onMore={() => setNudgeSeed((s) => s + 1)} t={t} />
        )}
        {/* …and when the SERVER dealt one (an idea of a word or two), the box holds it now: said once, under it */}
        {!!treatment && !ideaChanged && nudgeFilled.current !== null && topic === nudgeFilled.current && <p className="mm-note mm-idea-kept" role="status">{t("Written from a starter idea — change it and write again to make it yours.")}</p>}
        {ideaChanged && (seeds || treatment) && <p className="mm-note mm-idea-kept" role="status">{isStoryboard && !narrated ? t("Your script stays as it is — Rewrite to use the new idea.") : t("What you've made stays as it is — start over to use the new idea.")}</p>}
        {/* THE LANGUAGE IT IS TOLD IN — हिन्दी and اردو among them (2026-11-24, a tester in Pakistan) */}
        {langOn && (
          <div className="fs-toldin">
            <span>{t("Told in")}</span>
            <LangToggle value={storyLang} labels={CONTENT_LANG_NATIVE} align="left" onPick={pickStoryLang}
              title={t("The language the story is written, spoken and captioned in")} />
          </div>
        )}
        {langOn && wipeNote("lang:")}
        {!isStoryboard && (
        <div className="fs-len fs-len-topic">
          <span>{t("Scenes")}</span>
          <div className="fs-stepper">
            <button type="button" className={wipeArm === "bump:-1" ? "is-arm" : undefined} onClick={() => orArm("bump:-1", !!treatment, () => bump(-1))} disabled={scenes <= tmpl.minScenes} aria-label={t("Fewer scenes")}>−</button>
            <b>{scenes}</b>
            <button type="button" className={wipeArm === "bump:1" ? "is-arm" : undefined} onClick={() => orArm("bump:1", !!treatment, () => bump(1))} disabled={scenes >= tmpl.maxScenes} aria-label={t("More scenes")}>+</button>
          </div>
          <span className="fs-len-note">{t("≈ {sec}s · {n} AI clips", { sec: scenes * 5, n: scenes })}</span>
        </div>
        )}
        {wipeNote("bump:")}
      </div>
      <div className="mm-hint"><span aria-hidden="true">✎</span> {isStoryboard ? t("Tap each step to set it — we've filled in smart defaults, so you can breeze through and just make it.") : t("Tell us the idea — we write it and film it. Set anything below, or just hit the button.")}</div>

      {/* ───────── The STORY builder — the Music Video's card flow, for the story formats ───────── */}
      {isStoryboard && (() => {
        const lens = narrated ? [3, 4, 5, 6, 8, 10, 12] : Array.from({ length: Math.max(1, tmpl.maxScenes - tmpl.minScenes + 1) }, (_, k) => tmpl.minScenes + k);
        // a scene is two or three sentences: about ten seconds in an ordinary voice, more in a slow, performed one
        // (the first live story, told by the Hollow voice, ran 83 s for six scenes)
        const perScene = ({ "char:keeper": 14, "char:mary": 13, "char:coco": 12, "char:howl": 12 } as Record<string, number>)[narratorId] || 10;
        const secLabel = (sec: number) => { const r = Math.round(sec / 5) * 5; return r < 60 ? `${r}s` : `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`; };
        // (an acted shot is about five seconds, not eight — speech-meter.ts TYPICAL_SHOT_SECONDS)
        const lenLabel = (n: number) => (narrated ? `≈ ${secLabel(n * perScene)}` : `≈ ${n * TYPICAL_SHOT_SECONDS}s`);
        const shapeName = filmAspect === "16:9" ? t("Wide") : filmAspect === "9:16" ? t("Vertical") : t("Square");
        const capName = t(CAPTION_STYLES.find((c) => c.key === captions)?.label || "Off");
        // ONE PLACE TO CAST: what the Cast card and its panel say of a written script's characters
        const castSum = castCardSummary(cast);
        // …and whether the card still asks to be opened: a script has arrived, the step has not been opened since, and somebody has no face
        const castNudge = scripted && !castSeen && !castSum.all;
        const voiceTile = (id: string, label: string, blurb: string) => (
          <div className={`mm-vo${narratorId === id ? " on" : ""}`} key={id}>
            <button type="button" className="mm-vo-pick" aria-pressed={narratorId === id} onClick={() => setNarrPick(id)}><b>{label}</b><small>{blurb}</small></button>
            <button type="button" className="mm-vo-play" onClick={() => playVoice(id)} aria-label={t("Hear {name}", { name: label })} title={t("Hear this voice")}><Ico n="sound" size={15} /></button>
          </div>
        );
        return (
        <div className="mm mm-story">
          <div className="mm-grid">
            {/* 1 · Cast — the ONE place a film is cast. Before a script: who stars, or "we invent them". Once an
                acted film has its script the card is about the SCRIPT'S characters: their faces (a lettered
                disc for anyone not cast yet), their names, and how many have a face. */}
            {/* (…and until the step has been opened once it ASKS — one pulse when it is on screen, one line under
                the faces. It asks; it never opens itself, and Generate never waits on it.) */}
            <button type="button" ref={castCardRef} style={{ order: 1 }} className={`mm-card${storyCard === "cast" ? " on" : ""}${storyDone.cast ? " done" : ""}${castNudge && castLit ? " is-new" : ""}`} onClick={() => tapStory("cast")}>
              <span className="mm-step" aria-hidden="true">{storyDone.cast ? <Ico n="check" size={13} /> : 1}</span>
              {scripted ? (<>
                <span className="mm-card-top">
                  {cast[0]?.faceUrl
                    ? <span className="mm-card-face" style={{ backgroundImage: `url(${cast[0].faceUrl})`, backgroundPosition: "center top" }} aria-hidden="true" />
                    : <span className="mm-card-ico c5"><Ico n="presenter" size={20} /></span>}
                  <span className="mm-card-ttl"><span className="mm-card-kick">{t("The stars")}</span><b>{t("Cast")}</b></span>
                </span>
                <span className="mm-val mm-cast-names">{castSum.names}</span>
                <span className="mm-cast-line">
                  <span className="mm-card-cast" aria-hidden="true">
                    {castSum.discs.map((c, k) => (c.img
                      ? <span key={k} className={`mm-card-castface${k === 0 ? " lead" : ""}`} style={{ backgroundImage: `url(${c.img})`, backgroundPosition: "center top", ["--i" as string]: k }} title={c.name} />
                      : <span key={k} className="mm-card-castface is-open" style={{ ["--i" as string]: k }} title={c.name}>{c.letter}</span>))}
                    {castSum.more > 0 && <span className="mm-card-castface is-more" style={{ ["--i" as string]: castSum.discs.length }}>+{castSum.more}</span>}
                  </span>
                  <span className={`mm-cast-count${castSum.all ? " done" : ""}`}>{castSum.all ? <><Ico n="check" size={12} /> {t("Cast")}</> : t("{done}/{total} cast", { done: castSum.done, total: castSum.total })}</span>
                </span>
                {castNudge && <span className="mm-cast-nudge">{t("tap to give them faces (optional)")}</span>}
              </>) : (<>
              <span className="mm-card-top">
                {/* (the next episode of a told story: the characters it invented come BACK, with the faces they
                    had — the card says who, before a word is written. A full-length portrait is shown from the top.) */}
                {pickedCast[0]
                  ? <span className="mm-card-face" style={{ backgroundImage: `url(${pickedCast[0].img})` }} aria-hidden="true" />
                  : seriesOwn[0]
                  ? <span className="mm-card-face" style={{ backgroundImage: `url(${seriesOwn[0].img})`, backgroundPosition: "center top" }} aria-hidden="true" />
                  : <span className="mm-card-ico c5"><Ico n="presenter" size={20} /></span>}
                <span className="mm-card-ttl"><span className="mm-card-kick">{t("The stars")}</span><b>{t("Cast")}</b></span>
              </span>
              <span className="mm-val">{pickedCast.length ? <><Ico n="check" size={12} /> {pickedCast.map((r) => r.name).join(" + ")}</>
                : seriesOwn.length ? <><Ico n="check" size={12} /> {t("Back: {names}", { names: seriesOwn.map((r) => r.name).join(" + ") })}</>
                : t("We invent them · or pick your own")}</span>
              {pickedCast.length > 1 && (
                <span className="mm-card-cast" aria-hidden="true">
                  {pickedCast.map((r, k) => <span key={r.id} className={`mm-card-castface${k === 0 ? " lead" : ""}`} style={{ backgroundImage: `url(${r.img})` }} title={r.name} />)}
                </span>
              )}
              {!pickedCast.length && seriesOwn.length > 1 && (
                <span className="mm-card-cast" aria-hidden="true">
                  {seriesOwn.map((r, k) => <span key={`${r.name}|${r.img}`} className={`mm-card-castface${k === 0 ? " lead" : ""}`} style={{ backgroundImage: `url(${r.img})`, backgroundPosition: "center top" }} title={r.name} />)}
                </span>
              )}
              </>)}
            </button>
            {/* (How it's told is not a step any more: it is the HERO that was picked — film-heroes.ts) */}
            {/* 2 · Length */}
            <button type="button" style={{ order: 5 }} className={`mm-card${storyCard === "length" ? " on" : ""}${storyDone.length ? " done" : ""}`} onClick={() => tapStory("length")}>
              <span className="mm-step" aria-hidden="true">{storyDone.length ? <Ico n="check" size={13} /> : 2}</span>
              <span className="mm-card-top"><span className="mm-card-ico c4"><Ico n="film" size={20} /></span><span className="mm-card-ttl"><span className="mm-card-kick">{t("The cut")}</span><b>{t("Length")}</b></span></span>
              <span className="mm-val">{lenLabel(scenes)} · {narrated ? (scenes === 1 ? t("1 scene") : t("{n} scenes", { n: scenes })) : (scenes === 1 ? t("1 shot") : t("{n} shots", { n: scenes }))}</span>
            </button>
            {/* 3 · Shape */}
            <button type="button" style={{ order: 7 }} className={`mm-card${storyCard === "shape" ? " on" : ""}${storyDone.shape ? " done" : ""}`} onClick={() => tapStory("shape")}>
              <span className="mm-step" aria-hidden="true">{storyDone.shape ? <Ico n="check" size={13} /> : 3}</span>
              <span className="mm-card-top"><span className="mm-card-ico c3"><Ico n="expand" size={20} /></span><span className="mm-card-ttl"><span className="mm-card-kick">{t("The frame")}</span><b>{t("Shape")}</b></span></span>
              <span className="mm-val">{shapeName} · {filmAspect}</span>
            </button>
            {/* 4 · Captions */}
            <button type="button" style={{ order: 9 }} className={`mm-card${storyCard === "captions" ? " on" : ""}${storyDone.captions ? " done" : ""}`} onClick={() => tapStory("captions")}>
              <span className="mm-step" aria-hidden="true">{storyDone.captions ? <Ico n="check" size={13} /> : 4}</span>
              <span className="mm-card-top"><span className="mm-card-ico c1"><Ico n="article" size={20} /></span><span className="mm-card-ttl"><span className="mm-card-kick">{t("The words")}</span><b>{t("Captions")}</b></span></span>
              <span className="mm-val">{capName}{captions !== "off" ? <> · {t(captions === "bold" ? "big words, in time" : captions === "highlight" ? "the spoken word lights up" : "a line along the bottom")}</> : null}</span>
            </button>
            {/* 5 · Narrator (narrated) or Engine (acted) */}
            <button type="button" style={{ order: 11 }} className={`mm-card${storyCard === "voice" ? " on" : ""}${storyDone.voice ? " done" : ""}`} onClick={() => tapStory("voice")}>
              <span className="mm-step" aria-hidden="true">{storyDone.voice ? <Ico n="check" size={13} /> : 5}</span>
              {narrated
                ? <><span className="mm-card-top"><span className="mm-card-ico c5"><Ico n="headphones" size={20} /></span><span className="mm-card-ttl"><span className="mm-card-kick">{t("The voice")}</span><b>{t("Narrator")}</b></span></span>
                    <span className="mm-val">{narratorName ? t(narratorName) : t("Our pick")}{!narrPick ? <> · {t("our pick for this format")}</> : null}</span></>
                : <><span className="mm-card-top"><span className="mm-card-ico c5"><Ico n="sliders" size={20} /></span><span className="mm-card-ttl"><span className="mm-card-kick">{t("The lens")}</span><b>{t("Engine")}</b></span></span>
                    <span className="mm-val">{dialogueEngine === "veo" ? t("Veo 3 · premium") : t("Kling 3 · recommended")}</span></>}
            </button>
            {/* 6 · Motion — a told story only (the owner's ladder, 2026-11-24: "narrated with stills / simple,
                narrated with stills to video mid, and acted premium"): the pictures come to life, or the
                story is told over them as they are. Acted is another poster, not a setting. With it a told
                story's cards are six — two full rows of three, three full rows of two. */}
            {narrated && d.storyMotion && (
              <button type="button" style={{ order: 13 }} className={`mm-card${storyCard === "motion" ? " on" : ""}${storyDone.motion ? " done" : ""}`} onClick={() => tapStory("motion")}>
                <span className="mm-step" aria-hidden="true">{storyDone.motion ? <Ico n="check" size={13} /> : 6}</span>
                <span className="mm-card-top"><span className="mm-card-ico c2"><Ico n="play" size={20} /></span><span className="mm-card-ttl"><span className="mm-card-kick">{t("The pictures")}</span><b>{t("Motion")}</b></span></span>
                <span className="mm-val">{pictures === "still" ? t("Still · told over the pictures") : t("Moving · every picture comes to life")}</span>
              </button>
            )}
            {storyCard === "motion" && narrated && d.storyMotion && (
              <div className="mm-opts mm-opts-grid" style={{ order: 14 }}>
                <div className="mm-opts-h">{t("Do the pictures move?")}</div>
                <div className="mm-opts-sub">{t("Moving brings every scene's picture to life — the fuller film. Still tells the story over the pictures themselves: simpler, and ready sooner.")}</div>
                <div className="mm-lenpick mm-motionpick" role="group" aria-label={t("Motion")}>
                  {([["moving", "Moving", "every picture comes to life"], ["still", "Still", "told over the pictures · ready sooner"]] as const).map(([k, name, line]) => (
                    <button type="button" key={k} className={`mm-lenopt${pictures === k ? " on" : ""}`} aria-pressed={pictures === k} onClick={() => setPictures(k)}>
                      <b>{t(name)}</b>
                      <small>{t(line)}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* THE CAST STEP'S PANEL — the only cast UI on the page. With no script yet: we cast it, or pick who
                stars. Once an acted film has its script (`scripted`): the script's characters, one row each —
                everything the old "Cast your movie" section below the script did, here (the owner: "we can do
                this in the top"). The picker of before sits behind "Start over with different stars". */}
            {storyCard === "cast" && (
              <div className={`mm-opts mm-opts-grid${scripted ? " mm-castpanel" : ""}`} style={{ order: 2 }}>
                <div className="fs-cast-head">
                  <div className="mm-opts-h">{t("Who's in it?")}</div>
                  {scripted && (
                    <span className={`fs-cast-prog${castSum.all ? " done" : ""}`}>
                      {castSum.all ? <><Ico n="check" size={13} /> {t("Cast locked")}</> : t("{done}/{total} cast", { done: castSum.done, total: castSum.total })}
                    </span>
                  )}
                </div>
                {scripted && (<>
                  <div className="mm-opts-sub">{castSum.all ? t("Every shot now stars the same faces — nobody morphs. Roll camera. 🎬") : t("Give each character a face and a voice once — every shot reuses them. Tap a frame to cast it.")}</div>
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
                                {d.myVoices.length > 0 && (
                                  <optgroup label={t("My voices")}>
                                    {d.myVoices.map((v) => <option key={v.voiceId} value={v.voiceId}>{v.label} · {t("your own voice")}</option>)}
                                  </optgroup>
                                )}
                                {/* a cartoon's or a creature's own performed voice — and any character can wear one */}
                                <optgroup label={t("Character voices")}>
                                  {CHARACTER_VOICES.map((v) => <option key={v.id} value={v.id}>{t(v.label)} · {t(v.blurb)}</option>)}
                                </optgroup>
                                <optgroup label={t("People's voices")}>{d.voices.map((v) => <option key={v.id} value={v.id}>{v.label} · {v.blurb}</option>)}</optgroup>
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
                                    {rosterFor(template).map((r) => (
                                      <button type="button" role="listitem" key={r.id} className={`fs-rface${c.faceUrl === r.img ? " on" : ""}`}
                                        disabled={castingIndex !== null} title={r.name} onClick={() => castPresenter(i, r)}
                                        {...peekOn(`actor${i}:${r.id}`, r, c.faceUrl === r.img, () => castPresenter(i, r), castingIndex !== null)}>
                                        <span className="fs-rface-img" style={{ backgroundImage: `url(${r.img})` }} />
                                        {c.faceUrl === r.img && <span className="fs-rface-chk" aria-hidden="true"><Ico n="check" size={11} /></span>}
                                        <span className="fs-rface-name">{r.name}</span>
                                      </button>
                                    ))}
                                  </div>
                                  {i === 0 && peekHint}
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
                  {/* Lock these voices — ONE switch for the whole cast. Without it the video model voices each line
                      itself (the picked voice is only a hint, and it can drift between shots). */}
                  {cast.some((c) => c.voiceId) && (
                    <label className="fs-lockvoice">
                      <input type="checkbox" checked={lockVoices} onChange={(e) => setLockVoices(e.target.checked)} />
                      <span className="fs-lockvoice-txt">
                        <b><Ico n="mic" size={13} /> {t("Lock these voices")} <span className="fs-lockvoice-beta">{t("beta")}</span></b>
                        <small>{castHasOwnVoice
                          ? t("Your own voice is in this cast, so every character speaks in exactly the voice picked for them — in every shot.")
                          : t("Every character speaks in exactly the voice you picked, in every shot — instead of a voice the video model makes up. The first film with a voice takes a few minutes longer while we learn it.")}</small>
                      </span>
                    </label>
                  )}
                  {portraitFetcher.data?.error && <p className="fs-err">{portraitFetcher.data.error}</p>}
                  {/* (the stars the story was written for: changing them writes a different story, so the picker
                      is one line away — never beside the characters a tap in it would throw away. Not while a
                      face is being cast: the portrait lands by its row NUMBER, so a story started over under it
                      would hand it to somebody else's character.) */}
                  <button type="button" className={`mm-castover${castOver ? " on" : ""}`} aria-expanded={castOver} disabled={castingIndex !== null} onClick={() => { setCastOver((v) => !v); setWipeArm(""); }}>
                    <Ico n="refresh" size={13} /> {t("Start over with different stars")}
                  </button>
                </>)}
                {(!scripted || castOver) && (<>
                <div className="mm-opts-sub">{narrated
                  ? t("Pick up to 3 from your cast and the story is written for them — each one drawn from their own picture in every scene they are in. Pick nobody and we invent the characters.")
                  : t("Pick up to 2 from your cast and the story is written for them — their own face in every shot, and their own voice if they have one. Pick nobody and we invent the characters.")}</div>
                <div className="mm-artistpick">
                  <button type="button" className={`fs-rface mm-autoface${storyPick.length === 0 ? " on" : ""}${wipeArm === "cast:" ? " is-arm" : ""}`} onClick={() => orArm("cast:", storyPick.length > 0, () => setStoryPick([]))} title={t("We invent the characters")}>
                    <span className="fs-rface-img mm-autoface-img" aria-hidden="true"><Ico n="wand" size={20} /></span>
                    {storyPick.length === 0 && <span className="fs-rface-chk" aria-hidden="true"><Ico n="check" size={11} /></span>}
                    <span className="fs-rface-name">{t("We cast it")}</span>
                  </button>
                  {rosterFor(template).map((r) => {
                    const on = storyPick.includes(r.id);
                    return (
                      <button type="button" key={r.id} className={`fs-rface${on ? " on" : ""}${wipeArm === `cast:${r.id}` ? " is-arm" : ""}`} title={r.name} aria-pressed={on} disabled={!on && storyPick.length >= maxPick} onClick={() => orArm(`cast:${r.id}`, true, () => toggleStoryPick(r.id))}
                        {...peekOn(`story:${r.id}`, r, on, () => orArm(`cast:${r.id}`, true, () => toggleStoryPick(r.id)), !on && storyPick.length >= maxPick)}>
                        <span className="fs-rface-img" style={{ backgroundImage: `url(${r.img})` }} />
                        {on && <span className="fs-rface-chk" aria-hidden="true"><Ico n="check" size={11} /></span>}
                        <span className="fs-rface-name">{r.name}</span>
                      </button>
                    );
                  })}
                </div>
                {peekHint}
                {wipeNote("cast:")}
                <a className="mm-pace-auto" href="/web/presenters?forge=1"><Ico n="wand" size={12} /> {t("Create a new character")}</a>
                </>)}
              </div>
            )}
            {storyCard === "length" && (
              <div className="mm-opts mm-opts-grid" style={{ order: 6 }}>
                <div className="mm-opts-h">{t("How long?")}</div>
                <div className="mm-opts-sub">{narrated
                  ? t("Each scene is one picture and two or three spoken sentences — about ten seconds. A slow, spooky narrator takes a little longer.")
                  : t("Each shot is one spoken line on camera, up to about ten seconds. More shots, longer film — and a longer render.")}</div>
                <div className="mm-lenpick" role="group" aria-label={t("Length")}>
                  {lens.map((n) => (
                    <button type="button" key={n} className={`mm-lenopt${scenes === n ? " on" : ""}${wipeArm === `len:${n}` ? " is-arm" : ""}`} aria-pressed={scenes === n} onClick={() => orArm(`len:${n}`, !!treatment && treatment.scenes.length !== n, () => setStoryLen(n))}>
                      <b>{lenLabel(n)}</b>
                      <small>{narrated ? t("{n} scenes", { n }) : n === 1 ? t("1 shot") : t("{n} shots", { n })}</small>
                    </button>
                  ))}
                </div>
                {wipeNote("len:")}
              </div>
            )}
            {storyCard === "shape" && (
              <div className="mm-opts mm-opts-grid" style={{ order: 8 }}>
                <div className="mm-opts-h">{t("What shape?")}</div>
                <div className="mm-opts-sub">{t("Wide for YouTube and TV; Vertical for Shorts, Reels and TikTok; Square for a feed.")}</div>
                <div className="mm-lenpick mm-shapepick" role="group" aria-label={t("Shape")}>
                  {([["16:9", "Wide"], ["9:16", "Vertical"], ["1:1", "Square"]] as const).map(([a, name]) => (
                    <button type="button" key={a} className={`mm-lenopt${filmAspect === a ? " on" : ""}${wipeArm === `shape:${a}` ? " is-arm" : ""}`} aria-pressed={filmAspect === a} onClick={() => orArm(`shape:${a}`, filmAspect !== a && (!!seeds || frames.some(Boolean)), () => setFilmAspect(a))}>
                      <span className={`mm-shape s${a.replace(":", "x")}`} aria-hidden="true" />
                      <b>{t(name)}</b>
                      <small>{a}</small>
                    </button>
                  ))}
                </div>
                {wipeArm.startsWith("shape:") && <p className="mm-note mm-shape-warn" role="status">{t("A new shape draws every scene again, and your scene edits start over.")}</p>}
              </div>
            )}
            {storyCard === "captions" && (
              <div className="mm-opts mm-opts-grid" style={{ order: 10 }}>
                <div className="mm-opts-h">{t("Words on screen")}</div>
                <div className="mm-opts-sub">{narrated
                  ? t("Most people watch with the sound off — captions keep them watching. They say exactly what you wrote, in time with the voice.")
                  : t("Put the spoken lines on screen — exactly as you wrote them, in time with each voice.")}</div>
                <div className="mm-cappick" role="group" aria-label={t("Captions")}>
                  {CAPTION_STYLES.map((c) => (
                    <button type="button" key={c.key} className={`mm-cap${captions === c.key ? " on" : ""}`} aria-pressed={captions === c.key} onClick={() => setCapPick(c.key)}>
                      <span className="mm-cap-demo" style={{ backgroundImage: `linear-gradient(180deg,rgba(8,20,15,.15),rgba(8,20,15,.55)),url(${stillOf(template)})` }} aria-hidden="true">
                        {c.key === "bold" && <i className="bold">{t("the door opened")}</i>}
                        {/* the same big words, the last one lit — as it is while that word is being said */}
                        {c.key === "highlight" && (() => { const w = t("the door opened").split(" "); return <i className="bold">{w.slice(0, -1).join(" ")}{w.length > 1 ? " " : ""}<b className="lit">{w[w.length - 1]}</b></i>; })()}
                        {c.key === "subtitles" && <i className="sub">{t("The door opened before his hand came down.")}</i>}
                      </span>
                      <b>{t(c.label)}</b>
                      <small>{t(c.blurb)}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {storyCard === "voice" && narrated && (
              <div className="mm-opts mm-opts-grid" style={{ order: 12 }}>
                <div className="mm-opts-h">{t("Who tells it?")}</div>
                <div className="mm-opts-sub">{t("Tap a voice to pick it, the play button to hear it. A character voice is performed — a hollow whisper for a ghost story, a giggle for a bedtime one.")}</div>
                {/* (story-voice.ts: in Hindi and Urdu a people's voice is read by a native speaker of its own kind) */}
                {langOn && (storyLang === "hi" || storyLang === "ur") && <div className="mm-opts-sub">{t("Told in {lang}, a people's voice is read by a native speaker of the same kind — a man's by a man, a woman's by a woman. Character voices and your own voice speak it themselves.", { lang: CONTENT_LANG_NATIVE[storyLang] })}</div>}
                {d.myVoices.length > 0 && <><div className="mm-vo-h">{t("My voices")}</div><div className="mm-vopick">{d.myVoices.map((v) => voiceTile(v.voiceId, v.label, t("your own voice")))}</div></>}
                <div className="mm-vo-h">{t("Character voices")}</div>
                <div className="mm-vopick">{CHARACTER_VOICES.map((v) => voiceTile(v.id, t(v.label), t(v.blurb)))}</div>
                <div className="mm-vo-h">{t("People's voices")}</div>
                <div className="mm-vopick">{d.voices.map((v) => voiceTile(v.id, v.label, v.blurb))}</div>
                {narrPick && <button type="button" className="mm-pace-auto" onClick={() => setNarrPick("")}><Ico n="refresh" size={12} /> {t("Back to our pick for this format")}</button>}
              </div>
            )}
            {storyCard === "voice" && !narrated && (
              <div className="mm-opts mm-opts-grid" style={{ order: 12 }}>
                <div className="mm-opts-h">{t("Which camera?")}</div>
                <div className="mm-opts-sub">{t("Same film, a different AI behind the lens. Each one is tagged in your Archive, so you can run both and compare.")}</div>
                <div className="mm-toldpick" role="group" aria-label={t("Render engine")}>
                  <button type="button" className={`mm-told${dialogueEngine === "kling3" ? " on" : ""}`} aria-pressed={dialogueEngine === "kling3"} onClick={() => setDialogueEngine("kling3")}>
                    <b>{t("Kling 3")}</b><small>{t("Long single takes with natural lip-sync. What we recommend.")}</small><em>{t("recommended")}</em>
                  </button>
                  <button type="button" className={`mm-told${dialogueEngine === "veo" ? " on" : ""}`} aria-pressed={dialogueEngine === "veo"} onClick={() => setDialogueEngine("veo")}>
                    <b>{t("Veo 3")}</b><small>{t("Short, glossy, cinematic beats.")}</small><em>{t("premium")}</em>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* Step 2 — write + edit the scene FREE. Dialogue (Test Movie) gets the COMBINED
          conversation flow (one place, chat-style); other templates keep the classic
          treatment preview. */}
      {isStoryboard && narrated ? (
        <div className="fs-card fs-narr">
          <div className="fs-lbl"><span className="fs-n"><Ico n="pencil" size={13} /></span> {t("Your story")} <span className="fs-free">{t("free")}</span></div>
          <p className="fs-hint">{t("We write the story and draw a picture for every scene. Read it, change any line, re-draw any picture — nothing is spent until you Generate.")}</p>
          {makeBtn()}
          {treatmentFetcher.data?.error && <p className="fs-err">{treatmentFetcher.data.error}</p>}
          {treatment && treatment.title && (
            <div className="fs-treat">
              <div className="fs-treat-ttl">{treatment.title}</div>
              {treatment.musicMood && <div className="fs-treat-mood"><Ico n="music" size={12} /> {treatment.musicMood}</div>}
            </div>
          )}
          {storyboard(true, undefined, true)}
        </div>
      ) : isStoryboard ? (
        <div className="fs-card fs-scenecard">
          <div className="fs-lbl"><span className="fs-n"><Ico n="pencil" size={13} /></span> {t("Your scene")} <span className="fs-free">{t("free")}</span>{treatment && treatment.scenes.length > 0 && (() => { const fs = treatment.scenes.reduce((a, s) => a + estimateSpeakSeconds(parseBeat(s.caption).line), 0); return fs > 0 ? <span className="fs-filmlen" title={t("Estimated spoken length of the whole film")}>≈ {secondsLabel(fs)} {t("film")}</span> : null; })()}</div>
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
                <button type="button" className={`fs-rewrite${wipeArm === "rewrite" ? " is-arm" : ""}`} onClick={() => orArm("rewrite", true, writeTreatment)} disabled={writing}>{writing ? "…" : <><Ico n="refresh" size={13} /> {wipeArm === "rewrite" ? t("Tap again to rewrite") : t("Rewrite")}</>}</button>
              </div>
              {wipeArm === "rewrite" && <p className="mm-note mm-shape-warn" role="status">{t("A rewrite replaces every line, your edits too. The cast you picked stays.")}</p>}
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
                        {backdropsOf(template).map((bd) => (
                          <button type="button" key={bd.key} className={`fs-bchip${backdropIs(loc.where, bd.key) ? " on" : ""}`} onClick={() => setWhere(loc, bd.where)}>{t(bd.label)}</button>
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
                <p className="fs-hint" style={{ margin: "6px 0 0" }}>{t("Extras to weave into the scenes — pick a few.")}</p>
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
                    {/* (2026-11-22) in a sung format this line is the LYRIC sung over the scene — the film is cut to it */}
                    <input className="fs-scene-cap" value={s.caption || ""} onChange={(e) => editCaption(i, e.target.value)} placeholder={tmpl?.sung ? t("the line sung in this scene") : t("on-screen line (optional)")} aria-label={tmpl?.sung ? t("the line sung in this scene") : t("on-screen line (optional)")} maxLength={80} />
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* (THE SECOND CAST PLACE IS GONE, 2026-11-25. "Cast your movie" opened here, under the script, for the
          script's characters — the owner: "It looks like there is two cast selection cards per story (Bottom
          one comes across as extra)". Its rows, "Add a character" and "Lock these voices" are in the Cast
          STEP's panel above; what they set still reaches the form below as `cast` and `filmLockVoices`.) */}

      {/* STORYBOARD for the sung / narrated film formats (Kids Music Video, etc.) — the dialogue
          films already have their own per-scene approval, and the product skit doesn't need it. ONE
          collapsed button → grid, right before Generate, so the page stays short. */}
      {!isStoryboard && !tmpl?.needsProduct && (
        <div className="fs-card"><div className="fs-lbl"><Ico n="film" size={16} /> {t("See your scenes")} <span className="fs-free">{t("free")}</span></div>{storyboard()}</div>
      )}

      {/* Step 3 — generate (the only paid step) */}
      <div className="fs-card fs-go-card">
        <div className="fs-lbl"><span className="fs-n">{isStoryboard ? <Ico n="film" size={13} /> : 3}</span> {t("Generate")}</div>
        {/* (THE WRITER'S NUDGE: Generate with nothing written and an empty box would have the writer make one up —
            the box asks instead; with a script or a storyboard on the page, the writer is not called at all) */}
        <Form method="post" onSubmit={(e) => { if (!treatment && !seeds && noIdeaYet()) { e.preventDefault(); return; } sigAtSubmit.current = storySig; }}>
          <input type="hidden" name="intent" value="film" />
          <input type="hidden" name="template" value={template} />
          {isStoryboard && <input type="hidden" name="dialogueEngine" value={dialogueEngine} />}
          {isStoryboard && <input type="hidden" name="filmAspect" value={filmAspect} />}
          {narrated && <input type="hidden" name="filmMode" value="narrated" />}
          {narrated && seeds?.castRef && <input type="hidden" name="filmCastRef" value={seeds.castRef} />}
          {narrated && <input type="hidden" name="filmNarrator" value={narratorId} />}
          {narrated && langOn && <input type="hidden" name="filmLang" value={storyLang} />}
          {isStoryboard && <input type="hidden" name="filmCaptions" value={captions} />}
          {isStoryboard && pickedCast.length > 0 && <input type="hidden" name="filmCast" value={filmCastJson} />}
          {tmpl?.lipSyncSinger && <input type="hidden" name="filmGenre" value={filmGenre} />}
          {tmpl?.lipSyncSinger && songSource === "upload" && filmSongUrl && <input type="hidden" name="filmSongUrl" value={filmSongUrl} />}
          {tmpl?.lipSyncSinger && filmProps.length > 0 && <input type="hidden" name="filmProps" value={JSON.stringify(filmProps)} />}
          <input type="hidden" name="filmTopic" value={topic} />
          <input type="hidden" name="filmScenes" value={String(scenes)} />
          {tmpl?.needsProduct && <input type="hidden" name="filmProductTitle" value={prodTitle} />}
          {tmpl?.needsProduct && <input type="hidden" name="filmProductImageUrl" value={prodImage} />}
          {tmpl?.needsProduct && <input type="hidden" name="filmProductDescription" value={prodDesc} />}
          {(seeds?.treatment || treatment) && <input type="hidden" name="approvedTreatment" value={JSON.stringify(seeds?.treatment || treatment)} />}
          {(!isStoryboard || narrated) && seeds && <input type="hidden" name="approvedSceneImgs" value={JSON.stringify(seeds.imgs)} />}
          {isStoryboard && !narrated && frames.some(Boolean) && <input type="hidden" name="approvedFrames" value={JSON.stringify(frames)} />}
          {isStoryboard && !narrated && cast.some((c) => c.faceUrl || c.voiceId) && <input type="hidden" name="cast" value={JSON.stringify(cast.map((c) => ({ name: c.name, faceUrl: c.faceUrl, voiceId: c.voiceId, ...(c.faceUrl && c.kind && c.kind !== "person" ? { kind: c.kind, look: c.look || "" } : {}) })))} />}
          {isStoryboard && !narrated && lockVoices && cast.some((c) => c.voiceId) && <input type="hidden" name="filmLockVoices" value="1" />}
          {isStoryboard && series && <input type="hidden" name="seriesFrom" value={series.from} />}
          {isStoryboard && narrated && editing && <input type="hidden" name="editFrom" value={editing.from} />}
          {isStoryboard && narrated && pictures === "still" && <input type="hidden" name="filmPictures" value="still" />}
          <button type="submit" className={`fs-go${storySent ? " is-sent" : ""}`} disabled={!canGo || storySent}>
            {generating ? <>… {t("Starting your film")}</> : storySent ? <><Ico n="check" size={16} /> {t("Rendering — it lands in your Archive")}</> : <><Ico n="film" size={16} /> {cost > 0 ? t("Generate {name} · {cost} Tokens", { name: t(heroTitle), cost }) : t("Generate {name} · Free", { name: t(heroTitle) })}</>}
          </button>
          <div className="fs-eta" aria-live="polite" title={t("A rough estimate — longer films and lip-sync take more time.")}>
            <span aria-hidden="true">⏱</span> {t("Est. render time")} <b>{filmEta({ lipSyncSinger: tmpl?.lipSyncSinger, dialogue: isStoryboard, narrated, moves: d.storyMotion && pictures !== "still", scenes, engine: dialogueEngine })}</b>
          </div>
        </Form>
        <p className="fs-cost">
          {cost > 0
            ? <>{t("{base} + {per}/scene × {n} = {cost} Tokens", { base: d.base, per: d.perScene, n: scenes, cost })}{" · "}<span className={affordable ? "fs-bal" : "fs-bal low"}>{t("you have {n}", { n: d.tokens })}</span></>
            : t("Free while we get this section dialed in — pricing comes later")}
        </p>
        {!treatment && <p className="fs-hint">{narrated ? t("Tip: write and draw it above first so you see exactly what renders — or Generate straight away and we'll write it, draw it and tell it for you.") : t("Tip: write the treatment above first so you see exactly what renders — but you can Generate straight away and we'll script it for you.")}</p>}
        {!d.hasPlan && <p className="fs-err">{t("Pick a plan on the Dashboard first — film runs on tokens.")}</p>}
        {d.hasPlan && !affordable && <p className="fs-err">{t("Not enough tokens for this length — shorten it, or top up on the Plans page.")}</p>}
        {d.hasPlan && tmpl?.needsProduct && !productReady && <p className="fs-err">{t("Add your product above to generate a skit.")}</p>}
        {actionData?.error && <p className="fs-err">{actionData.error}</p>}
        {actionData?.ok && (<>
          <Slate title={slateTitle(seeds?.treatment?.title || treatment?.title || (series ? `${series.title} — ${t("Episode {n}", { n: series.episode })}` : ""), topic, t(hero?.name || "Film"))} format={t(hero?.name || "Film")} scenes={scenes} />
          <p className="fs-ok"><Ico n="check" size={14} /> {t("Rolling! Your film is rendering — it'll land in your Archive when it's done. You can keep working.")}</p>
        </>)}
      </div>
      </>)}
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
function filmEta(opts: { lipSyncSinger?: boolean; dialogue?: boolean; narrated?: boolean; moves?: boolean; scenes: number; sceneSec?: number; engine: "veo" | "kling3" }): string {
  const n = Math.max(1, opts.scenes || 1);
  let lo: number, hi: number;
  if (opts.narrated) {
    lo = 2; hi = n > 8 ? 5 : 4; // a narration, an alignment pass, a picture a scene, one cut
    // …and, when its pictures move, a clip a scene — the same sum the Archive's card counts down from
    if (opts.moves) { const s = storyTypicalSeconds(n, true); lo = Math.max(3, Math.round((s * 0.8) / 60)); hi = Math.round((s * 1.35) / 60); }
  } else if (opts.lipSyncSinger) {
    // The scenes are filmed three at a time. MEASURED 2026-11-21: a 30-second video of six five-second
    // scenes took 11 min 46 s start to finish (about four minutes a wave of three, plus the song, the
    // segments and the cut); ten-second scenes have run about nine minutes a wave (a 2:00 video ≈ 40 min).
    const waves = Math.ceil(n / 3);
    const half = opts.sceneSec === 5;
    lo = Math.round((half ? 4 : 5) + waves * (half ? 3 : 7)); hi = Math.round((half ? 6 : 8) + waves * (half ? 4.5 : 10));
  } else if (opts.dialogue) {
    const per = opts.engine === "veo" ? 4 : 3.5;
    lo = Math.round(3 + n * per * 0.8); hi = Math.round(5 + n * per * 1.3);
  } else {
    lo = Math.round(4 + n * 1.2); hi = Math.round(7 + n * 2); // sung / other (parallel scenes)
  }
  return lo === hi ? `~${lo} min` : `~${lo}–${hi} min`;
}

const FS_STYLE = `
${VOICE_UI_CSS}
${FORGE_CSS}
${SPIN_STAGE_CSS}
${CAST_ID_CSS}
/* ---- the cast ID card in the pickers (CastPeek): a face a finger can hold, and the sheet it opens ---- */
/* holding a face selects no text and raises no callout (iOS) — the card opens instead */
[data-cast-hold],[data-cast-hold] *{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;}
.fs-peek-hint{display:none;margin:4px 2px 0;font-size:11.5px;font-weight:600;line-height:1.35;color:var(--ink3,#7C877F);}
@media(hover:none) and (pointer:coarse){.fs-peek-hint{display:block;}}
/* (10650: over the Helpurr mascot, which floats at 10600 — on a phone it sat on the corner of this sheet's card) */
.fs-peek{position:fixed;inset:0;z-index:10650;display:flex;align-items:flex-end;justify-content:center;padding:16px 16px max(16px,env(safe-area-inset-bottom));background:rgba(20,32,26,.46);font-family:Inter,-apple-system,sans-serif;color:var(--ink,#14201A);-webkit-user-select:none;user-select:none;}
.fs-peek-sheet{box-sizing:border-box;width:100%;max-width:400px;max-height:calc(100dvh - 32px);overflow-y:auto;overscroll-behavior:contain;border:1.5px solid var(--green,#0C7A46);border-radius:20px;background:#FFFDF7;padding:2px 12px 12px;box-shadow:0 24px 60px -18px rgba(20,32,26,.55);animation:fspeekin .2s cubic-bezier(.2,.8,.2,1) both;}
@keyframes fspeekin{from{opacity:0;transform:translateY(18px);}}
@media(min-width:640px){.fs-peek{align-items:center;}}
@media(prefers-reduced-motion:reduce){.fs-peek-sheet{animation:none;}}
.fs-peek-head{display:flex;justify-content:flex-end;margin:0 -8px -2px 0;}
.fs-peek-x{display:grid;place-items:center;width:44px;height:44px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--ink2,#4A554E);font-size:14px;cursor:pointer;}
.fs-peek-x span{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;border:1.5px solid var(--line,#E4DFCF);background:#fff;}
/* the card fills the sheet, and says all it has to say: here is where it is inspected */
.fs-peek-sheet .pc-id.mini{width:auto;box-shadow:none;}
.fs-peek-sheet .pc-id.mini .pc-id-about{display:block;-webkit-line-clamp:unset;overflow:visible;}
.fs-peek-pick{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;min-height:48px;margin-top:12px;padding:10px 16px;border:0;border-radius:14px;background:var(--green,#0C7A46);color:#fff;font-family:Poppins,sans-serif;font-size:15px;font-weight:800;line-height:1.2;cursor:pointer;}
.fs-peek-pick:disabled{background:#E7EAE3;color:var(--ink2,#4A554E);cursor:default;}
.fs-peek-pick.on:disabled{background:#E3F3EA;color:var(--green,#0C7A46);}
.fs-wrap{max-width:none;margin:0 auto;--fs-gold:#C79A3A;--fs-gold-lt:#E7C879;}
.fs-eta{display:flex;align-items:center;justify-content:center;gap:6px;margin:8px 0 0;font-size:12.5px;font-weight:700;color:var(--ink2,#4A554E);}
.fs-eta b{font-weight:800;color:var(--ink,#14201A);}
/* Cinematic hero — a dark "movie theatre" band with a gold spotlight + underline. */
/* Green hero band — SOFTENED so it sits in the page (light shadow + a crisp inner
   edge + slimmer) instead of a floating slab. Gold rosette, the still bleeds in. */
.fs-head{position:relative;overflow:hidden;border-radius:20px;margin-bottom:16px;min-height:200px;display:flex;align-items:center;box-shadow:0 20px 48px -24px rgba(8,62,39,.55);background:radial-gradient(135% 130% at 8% -25%,#38815C 0%,#265F45 46%,#1C4E33 100%);}
/* A blurred, zoomed copy of the hero still FILLS the band behind everything — the ground the reel's own
   blurred posters lie over once they have loaded (ambient-mode look). */
.fs-head::before{content:"";position:absolute;inset:0;z-index:0;background:url(/landing/film-hero.jpg?v=5) center/cover;filter:blur(30px) brightness(.5) saturate(1.15);transform:scale(1.18);}
/* Desktop: a proper tall hero (a thin 200px strip looked tiny against the full-bleed width). */
@media(min-width:960px){.fs-head{min-height:320px;}.fs-head-copy{padding:44px 54px;max-width:680px;}.fs-head-copy b{font-size:50px;}.fs-head-copy>span{font-size:16.5px;max-width:540px;margin-top:14px;}}
/* THE CLIP IS FLUSH. On a wide screen it stood in this band as a screen of its own — a margin round it, its
   own corners, a ring and a shadow — and the owner, 2026-11-24, with the other sections' headers beside it:
   "the video hero's here are not flush like the others they appear boxed". So it is as the Auto-post's and
   the Archive's headers have their picture: the clip fills the band's far side from the top to the foot and
   out to the edge (the band's own rounded corners are what cut it), and its near edge dissolves into the
   band. Nothing stands round it: no margin, no corners, no ring, no shadow of its own. At every width — on a
   phone too, where it lay under the words from edge to edge. (Read right to left, the words start from
   the right, so the clip keeps the left.) */
.fs-head-vid{position:absolute;top:0;right:0;bottom:0;left:auto;width:56%;height:100%;object-fit:cover;object-position:center;z-index:1;-webkit-mask-image:linear-gradient(90deg,transparent,#000 46%);mask-image:linear-gradient(90deg,transparent,#000 46%);}
[dir=rtl] .fs-head-vid{right:auto;left:0;-webkit-mask-image:linear-gradient(270deg,transparent,#000 46%);mask-image:linear-gradient(270deg,transparent,#000 46%);}
/* The reel: two stacked players that cross-fade. Each carries a blurred copy of its own poster across the
   whole band, behind the clip — so what the clip dissolves into is its own colours, under the band's shade. */
.fs-reel{position:absolute;inset:0;z-index:1;opacity:0;transition:opacity .9s ease;}
.fs-reel.on{opacity:1;}
.fs-reel-amb{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(30px) brightness(.5) saturate(1.15);transform:scale(1.18);}
/* what the reel is showing — tap it to make one */
.fs-head-tag{position:absolute;z-index:4;right:16px;bottom:14px;display:inline-flex;align-items:center;gap:7px;min-height:34px;box-sizing:border-box;padding:6px 13px 6px 11px;border:1px solid rgba(255,255,255,.3);border-radius:999px;background:rgba(7,42,27,.58);color:#fff;font:inherit;font-size:12px;font-weight:800;cursor:pointer;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);animation:fstag .5s ease both;transition:background .14s,border-color .14s,transform .14s;}
.fs-head-tag:hover{background:rgba(7,42,27,.82);border-color:rgba(255,255,255,.65);transform:translateY(-1px);}
.fs-head-tag i{flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:#FF6B5E;box-shadow:0 0 0 3px rgba(255,107,94,.28);}
.fs-head-tag em{font-style:normal;font-weight:700;opacity:.78;}
@keyframes fstag{from{opacity:0;transform:translateY(5px);}}
/* Desktop: a tall band. (The clip's side of it is then close to the clip's own shape, so little of a clip is
   cut: the hero as a whole is 4–5 : 1, and a clip stretched across all of it showed the tops of two heads.) */
@media(min-width:960px){
  .fs-head{min-height:clamp(320px,24vw,420px);}
  .fs-head-tag{right:22px;bottom:20px;}
}
@media(max-width:640px){.fs-head-tag{top:12px;bottom:auto;right:12px;min-height:28px;padding:4px 10px 4px 9px;font-size:11px;}.fs-head-tag em{display:none;}}
[dir=rtl] .fs-head-tag{right:auto;left:16px;}
@media(min-width:960px){[dir=rtl] .fs-head-tag{left:22px;}}
@media(max-width:640px){[dir=rtl] .fs-head-tag{left:12px;}}
@media(prefers-reduced-motion:reduce){.fs-reel{transition:none;}.fs-head-tag{animation:none;}}
/* THE SHADE THE WORDS STAND ON IS THE AD MAKER'S GREEN — the very gradient its hero is painted with
   (web.studio.tsx → .ws-cinehead-bg; a test holds the two together). The owner, 2026-11-24, with the two
   heroes side by side: "Lighten movie maker hero to ad maker green so it matches". It was a near-black green
   laid over the picture at 92%; it is now that lighter green itself, whole where the words are (they keep to
   the band's first 58%, 60% on a phone) and masked away before the clip is whole — so no word stands on a
   busy picture, and nothing dulls the clip itself. */
.fs-head-scrim{position:absolute;inset:0;z-index:2;background:radial-gradient(135% 130% at 8% -25%,#38815C 0%,#265F45 46%,#1C4E33 100%);-webkit-mask-image:linear-gradient(90deg,#000 54%,transparent 74%);mask-image:linear-gradient(90deg,#000 54%,transparent 74%);}
[dir=rtl] .fs-head-scrim{background:radial-gradient(135% 130% at 92% -25%,#38815C 0%,#265F45 46%,#1C4E33 100%);-webkit-mask-image:linear-gradient(270deg,#000 54%,transparent 74%);mask-image:linear-gradient(270deg,#000 54%,transparent 74%);}
/* (a phone: the words run to 60% of the band and the hero's rosette lies under all of them, so the shade is
   whole a little further — no letter stands on a line of the rosette AND on the clip's near edge at once) */
@media(max-width:640px){
  .fs-head-scrim{-webkit-mask-image:linear-gradient(90deg,#000 60%,transparent 78%);mask-image:linear-gradient(90deg,#000 60%,transparent 78%);}
  [dir=rtl] .fs-head-scrim{-webkit-mask-image:linear-gradient(270deg,#000 60%,transparent 78%);mask-image:linear-gradient(270deg,#000 60%,transparent 78%);}
}

.fs-head-bg{position:absolute;inset:0;z-index:0;border-radius:18px;overflow:hidden;background:radial-gradient(135% 130% at 8% -25%,#38815C 0%,#265F45 46%,#1C4E33 100%);box-shadow:0 8px 22px rgba(11,20,15,.16),inset 0 0 0 1px rgba(255,255,255,.1);}
.fs-head-rose{position:absolute;background:center/contain no-repeat;mix-blend-mode:screen;pointer-events:none;will-change:transform;}
.fs-head-rose.b{left:-130px;bottom:-170px;width:350px;height:350px;background-image:url(/gstyle-rosette.svg);opacity:.3;animation:fsspinB 115s linear infinite;}
@keyframes fsspinB{to{transform:rotate(-360deg);}}
.fs-head-media{position:absolute;right:0;top:0;bottom:0;width:54%;-webkit-mask-image:linear-gradient(90deg,transparent,#000 44%);mask-image:linear-gradient(90deg,transparent,#000 44%);}
.fs-head-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;animation:fsstill .55s cubic-bezier(.2,.7,.2,1);}
@keyframes fsstill{from{opacity:0;transform:scale(1.06);}to{opacity:1;transform:scale(1);}}
.fs-head-copy{position:relative;z-index:3;flex:1 1 auto;min-width:0;padding:26px 30px;max-width:min(560px,58%);}
/* THE EYEBROW IS THE AD MAKER'S (.ws-cinehead-eyebrow): an icon and the words, small, in its gold. Written as
   .fs-head-copy>.fs-head-eyebrow because the sub-line's rule below (.fs-head-copy>span) also catches this
   span and, being more specific than a bare class, used to win — the eyebrow came out white, 13.5px and a
   block, where the Ad Maker's is gold and 11px. */
.fs-head-copy>.fs-head-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:800;color:#E7C879;text-transform:uppercase;letter-spacing:.08em;margin:0;max-width:none;line-height:1.3;text-shadow:none;}
@media(min-width:960px){.fs-head-copy>.fs-head-eyebrow{font-size:12.5px;}}
.fs-head-copy b{display:block;font-family:Poppins,sans-serif;font-weight:800;font-size:33px;letter-spacing:-.02em;color:#fff;margin-top:11px;line-height:1.04;text-shadow:0 2px 18px rgba(0,0,0,.4);text-wrap:balance;}
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
/* THE SHELVES — told · acted · sung. Each shelf is a soft tray with its own accent (storybook gold, the
   stage's green, the music video's violet): an icon, a name, one line that says what its posters share,
   and a one-word tag. Entering a format lets the trays fall away so the chosen poster can fly. */
.fs-shelves{display:grid;gap:18px;margin:18px 0 6px;}
.fs-shelf{position:relative;border-radius:22px;padding:14px 14px 14px;border:1px solid var(--line,#E4DFCF);background:linear-gradient(180deg,#FFFEFA,#FBF8F0);transition:background .3s ease,border-color .3s ease;}
.fs-shelf.is-told{--shelf:#A8741B;--shelf-soft:rgba(168,116,27,.1);}
.fs-shelf.is-acted{--shelf:#0C7A46;--shelf-soft:rgba(12,122,70,.09);}
.fs-shelf.is-sung{--shelf:#6B4BC8;--shelf-soft:rgba(107,75,200,.09);}
.fs-shelf::before{content:"";position:absolute;left:0;top:18px;bottom:18px;width:4px;border-radius:0 4px 4px 0;background:var(--shelf);opacity:.85;}
.fs-shelf-h{display:flex;align-items:center;gap:11px;margin:0 2px 12px 6px;transition:opacity .25s ease;}
.fs-shelf-ico{flex:none;width:38px;height:38px;border-radius:12px;display:grid;place-items:center;color:#fff;background:var(--shelf);box-shadow:0 10px 18px -10px var(--shelf);}
.fs-shelf-txt{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px;}
.fs-shelf-name{margin:0;font-family:Poppins,sans-serif;font-size:19px;font-weight:800;letter-spacing:-.015em;line-height:1.15;color:var(--ink,#14201A);}
.fs-shelf-txt span{font-size:12.5px;font-weight:600;line-height:1.35;color:var(--ink2,#55605A);}
.fs-shelf-tag{flex:none;font-style:normal;font-family:Poppins,sans-serif;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;color:var(--shelf);background:var(--shelf-soft);border-radius:999px;padding:5px 10px;}
.fs-shelf .fs-fmtgrid{margin:0;}
/* (a wide screen: four to a row, so the four Films stand in one line — three left one alone on a second) */
@media(min-width:980px){.fs-shelf .fs-fmtgrid{grid-template-columns:repeat(4,minmax(0,1fr));}}
.fs-shelves.throw .fs-shelf{background:transparent;border-color:transparent;}
.fs-shelves.throw .fs-shelf::before,.fs-shelves.throw .fs-shelf-h{opacity:0;}
@media(max-width:420px){.fs-shelf{padding:12px 10px 12px;border-radius:18px;}.fs-shelf-name{font-size:17px;}}
@media(prefers-reduced-motion:reduce){.fs-shelf,.fs-shelf-h{transition:none;}}
/* Tablet / desktop: cap the stage width and show 3 columns so posters stay poster-sized
   instead of ballooning to half the screen on a wide monitor. Phones keep the 2-up grid. */
@media (min-width:640px){
  .fs-switch{max-width:none;margin-left:auto;margin-right:auto;}
  .fs-fmtgrid{grid-template-columns:repeat(3,minmax(0,1fr));}
}
@keyframes fsgridin{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
.fs-fmtgrid .fs-fmt{flex:none;width:auto;transform-origin:center;}
.fs-fmtgrid.throw .fs-fmt{opacity:0;transform:scale(.72) translateY(26px);transition:opacity .32s ease,transform .36s ease;pointer-events:none;}
.fs-fmtgrid.throw .fs-fmt.zoom{opacity:1;z-index:6;will-change:transform;transform:scale(1.16);transition:transform .4s cubic-bezier(.34,.62,.2,1),box-shadow .4s ease;box-shadow:0 36px 72px -22px rgba(10,20,15,.6);}
.fs-head.throw{opacity:0;transform:scale(.97);transition:opacity .32s ease,transform .36s ease;pointer-events:none;}
.fs-fmt-sub{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;padding:9px 11px 12px;font-size:12px;font-weight:700;color:var(--ink,#14201A);line-height:1.34;}
@media(min-width:640px){.fs-fmt-sub{padding:11px 16px 14px;font-size:13.5px;}}
.fs-fmt-sub em{font-style:normal;font-weight:600;color:var(--ink2,#55605A);}
.fs-hero{position:relative;height:150px;border-radius:16px;overflow:hidden;margin:2px 0 10px;background:#20302A;}
@media(min-width:960px){.fs-hero{height:260px;}.fs-hero-art{object-fit:contain;object-position:center;}.fs-hero-ttl{font-size:34px;left:26px;}.fs-hero-sub{left:26px;font-size:14px;}.fs-hero-back{left:26px;}}
.fs-hero-art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;}
@keyframes fsken{from{transform:scale(1.06)}to{transform:scale(1.2)}}
/* Ambient fill: a blurred, zoomed copy of the same still fills the banner behind the (contain) art, so
   the WHOLE scene shows on desktop with no empty bars — matches the main hero. */
.fs-hero-blur{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(28px) brightness(.5) saturate(1.12);transform:scale(1.2);z-index:0;animation:fsken 18s ease-in-out infinite alternate;}
.fs-hero-scrim{position:absolute;inset:0;z-index:2;background:linear-gradient(to top,rgba(8,16,12,.6) 0%,rgba(8,16,12,.06) 54%,rgba(8,16,12,.22) 100%);}
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
/* Desktop: the format posters go LANDSCAPE (wide, not a tall 4:5 that dominated the screen). */
@media(min-width:640px){.fs-fmt-cover{aspect-ratio:16/9;}}
.fs-fmt-cover img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .4s cubic-bezier(.2,.7,.2,1);}
.fs-fmt-cover picture{display:contents;}
/* the format's loop, faded in over its still while the card is pointed at (see LoopCover) */
.fs-fmt-vid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .35s ease;pointer-events:none;}
.fs-fmt-vid.on{opacity:1;}
/* the covers MOVE now, so the title has to win: a deeper, taller shade under it and a bigger, heavier name */
.fs-fmt-cover::after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(6,14,10,.94) 0%,rgba(6,14,10,.62) 24%,rgba(6,14,10,.14) 50%,transparent 68%);}
.fs-fmt-ico{position:absolute;z-index:2;top:8px;left:8px;width:28px;height:28px;border-radius:9px;display:grid;place-items:center;box-shadow:0 5px 14px -5px rgba(0,0,0,.6);}
.fs-fmt-ico svg{width:15px;height:15px;stroke:#fff;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;}
.fs-fmt-check{position:absolute;z-index:2;top:10px;right:10px;width:23px;height:23px;border-radius:50%;background:var(--green,#0C7A46);display:grid;place-items:center;box-shadow:0 4px 10px -3px rgba(0,0,0,.5);}
.fs-fmt-check svg{width:12px;height:12px;stroke:#fff;stroke-width:3;fill:none;}
.fs-fmt-label{position:absolute;z-index:2;left:9px;right:9px;bottom:9px;}
.fs-fmt-kick{display:block;font-size:10px;font-weight:800;color:#A7F0C8;text-transform:uppercase;letter-spacing:.07em;}
.fs-fmt-label b{display:block;font-family:Poppins,sans-serif;font-size:17px;font-weight:800;letter-spacing:-.02em;color:#fff;line-height:1.08;text-shadow:0 2px 14px rgba(0,0,0,.75),0 1px 2px rgba(0,0,0,.65);}
@media(min-width:640px){.fs-fmt-label{left:16px;right:16px;bottom:14px;}.fs-fmt-label b{font-size:24px;}}
@media(min-width:1100px){.fs-fmt-label b{font-size:28px;}}
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
/* THE SLATE — it claps once when a film is sent off (Slate). The stick is hinged at its left end. */
.fs-slate{position:relative;z-index:2;width:min(100%,290px);margin:22px 0 4px;padding-top:21px;font-family:Poppins,sans-serif;}
.fs-slate-stick,.fs-slate-bar{display:block;height:19px;background:repeating-linear-gradient(-55deg,#FAF7EE 0 17px,#14201A 17px 34px);}
.fs-slate-stick{position:absolute;top:0;left:0;right:0;border-radius:5px;box-shadow:0 2px 5px -2px rgba(20,32,26,.55);transform-origin:9px 60%;animation:fsClap .66s cubic-bezier(.45,0,.9,.45) .18s both;}
.fs-slate-board{overflow:hidden;border-radius:5px 5px 12px 12px;background:#14201A;color:#FAF7EE;box-shadow:0 16px 28px -18px rgba(20,32,26,.7);}
.fs-slate-bar{background:repeating-linear-gradient(55deg,#FAF7EE 0 17px,#14201A 17px 34px);}
.fs-slate-prod{padding:10px 14px 8px;border-bottom:1px solid rgba(250,247,238,.22);}
.fs-slate i{display:block;font-style:normal;font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#9FB0A6;line-height:1.5;}
.fs-slate-prod b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;font-size:15.5px;font-weight:800;line-height:1.22;}
.fs-slate-cells{display:grid;grid-template-columns:1fr auto 1fr;}
.fs-slate-cells span{min-width:0;padding:8px 14px 9px;}
.fs-slate-cells span+span{border-left:1px solid rgba(250,247,238,.22);}
.fs-slate-cells b{display:block;font-size:14px;font-weight:800;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.fs-slate-fmt{padding:5px 14px 7px;border-top:1px solid rgba(250,247,238,.22);font-size:9.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#E7C879;}
@keyframes fsClap{0%{transform:rotate(-15deg)}58%{transform:rotate(0deg)}72%{transform:rotate(-2.6deg)}100%{transform:rotate(0deg)}}
@media(prefers-reduced-motion:reduce){.fs-slate-stick{animation:none;}}
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
/* The script's cast: one locked actor (face + voice) per character. These rows were a section of their own
   under the script ("Cast your movie") until 2026-11-25; they now live in the Cast STEP's panel
   (.mm-castpanel, further down) — the one place a film is cast. */
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
.fs-lockvoice{display:flex;align-items:flex-start;gap:10px;margin:12px 0 2px;border:1.5px solid var(--line,#E4DFCF);background:#FBFAF5;border-radius:13px;padding:11px 13px;cursor:pointer;}
.fs-lockvoice:has(input:checked){border-color:var(--green,#0C7A46);background:#F0F8F3;}
.fs-lockvoice input{flex:none;width:17px;height:17px;margin-top:2px;accent-color:var(--green,#0C7A46);cursor:pointer;}
.fs-lockvoice-txt{display:flex;flex-direction:column;gap:2px;min-width:0;}
.fs-lockvoice-txt b{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:800;color:var(--ink,#14201A);}
.fs-lockvoice-txt small{font-size:11.5px;color:var(--ink2,#55605A);line-height:1.4;}
.fs-lockvoice-beta{font-size:9px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;color:var(--green,#0C7A46);background:#DEF0E6;border-radius:5px;padding:1px 5px;}
.fs-cast-add span{font-size:17px;line-height:1;font-weight:700;}
.fs-actor-voice{display:flex;gap:7px;align-items:stretch;}
.fs-actor-voice select{flex:1 1 auto;min-width:0;box-sizing:border-box;border:1.5px solid var(--line,#E4DFCF);border-radius:10px;padding:8px 11px;font-size:12.5px;font-family:inherit;color:var(--ink,#14201A);background:#fff;cursor:pointer;}
.fs-actor-voice select:focus{outline:none;border-color:var(--green,#0C7A46);}
.fs-actor-voice select:disabled{opacity:.6;}
.fs-voice-play{flex:0 0 auto;width:38px;display:grid;place-items:center;border:1.5px solid var(--line,#E4DFCF);border-radius:10px;background:#fff;color:var(--green,#0C7A46);cursor:pointer;transition:background .12s,border-color .12s;}
.fs-voice-play:hover:not(:disabled){background:rgba(12,122,70,.08);border-color:var(--green,#0C7A46);}
.fs-voice-play:disabled{opacity:.4;cursor:default;}
.fs-actor-opts{display:flex;gap:14px;align-items:center;flex-wrap:wrap;}
/* An opened picker takes the whole row. As one more item in this row it was only as wide as its own label
   — "Pick a presenter" opened 32 faces in a single 98px column, one and a half showing at a time. */
.fs-actor-opts > details[open]{flex:1 1 100%;min-width:0;}
/* On a phone that row goes UNDER the face, the full width of the card: beside the face there was room for
   two faces across. (The face keeps its place beside the name, the description and the voice.) */
@media(max-width:560px){
  .fs-actor{display:grid;grid-template-columns:98px minmax(0,1fr);gap:8px 14px;align-items:start;}
  .fs-actor-face{grid-row:1 / span 3;}
  .fs-actor-main{display:contents;}
  .fs-actor-opts{grid-column:1 / -1;}
}
.fs-actor-recast{display:inline-flex;align-items:center;gap:4px;background:none;border:0;color:var(--ink2,#4A554E);font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;padding:0;}
.fs-actor-recast:hover:not(:disabled){color:var(--green,#0C7A46);}
.fs-actor-recast:disabled{opacity:.5;cursor:default;}
.fs-actor-own{margin:0;}
/* ONE PLACE TO CAST (2026-11-25): those rows INSIDE the Cast step's panel. The panel is already a card with
   its own heading, so the rows sit a little closer in; "Start over with different stars" is one quiet line
   under them (the picker it opens writes a different story — it is not laid out beside the characters). */
.mm-castpanel .fs-cast-head{margin-bottom:5px;}
.mm-castpanel .fs-cast-head .mm-opts-h{margin-bottom:0;}
.mm-castpanel .fs-cast{margin-top:0;}
.mm-castover{position:relative;display:flex;align-items:center;gap:7px;width:100%;min-height:44px;margin:14px 0 0;padding:10px 2px 0;border:0;border-top:1px dashed var(--line,#E4DFCF);background:transparent;color:var(--ink2,#4A554E);font-family:Poppins,sans-serif;font-size:12.5px;font-weight:700;text-align:start;cursor:pointer;transition:color .14s;}
.mm-castover svg{flex:none;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;}
.mm-castover::after{content:"+";margin-inline-start:auto;font-weight:800;font-size:15px;line-height:1;}
.mm-castover.on::after{content:"–";}
.mm-castover:hover:not(:disabled),.mm-castover.on{color:var(--green,#0C7A46);}
.mm-castover:disabled{opacity:.5;cursor:default;}
.mm-castover + .mm-opts-sub{margin-top:8px;}
/* (Where there is room the rows stay one under another, the full width of the panel — two side by side were
   tried in the mock, and "Pick a presenter" then opened five faces across instead of thirteen.) */
/* On a phone, inside the panel: the face stands beside the name and the look (a caption beside its picture,
   as it was), and the VOICE takes the full width under them — beside a 98px face the picked voice's name
   was cut off after a dozen letters. Everything typed in is 16px: a smaller field makes an iPhone zoom the
   whole page on the first tap; the look is set in the page's reading face so 16px of it stays quiet, and
   it grows with what is written where the browser can (field-sizing). Every control is 44px to the thumb. */
@media(max-width:560px){
  .mm-castpanel{padding:14px 12px;}
  .mm-castpanel .fs-actor{padding:10px;gap:8px 12px;}
  .mm-castpanel .fs-actor-face{grid-row:1 / span 2;grid-column:1;}
  .mm-castpanel .fs-actor-name-in{grid-row:1;grid-column:2;min-height:44px;font-size:16px;}
  .mm-castpanel .fs-actor-desc-in{grid-row:2;grid-column:2;display:block;min-height:79px;max-height:230px;field-sizing:content;font-family:Inter,system-ui,sans-serif;font-weight:400;font-size:16px;line-height:1.36;}
  .mm-castpanel .fs-actor-voice{grid-row:3;grid-column:1 / -1;}
  .mm-castpanel .fs-actor-voice select{min-height:44px;font-size:16px;}
  .mm-castpanel .fs-voice-play{width:46px;}
  /* (the two ways to bring a face share the first line; "Re-cast" and, at the far end, "Remove" the next —
     four small things in a row broke wherever the row ran out, and left "Use my own photo" alone on a line) */
  .mm-castpanel .fs-actor-opts{grid-row:4;gap:12px 16px;}
  .mm-castpanel .fs-actor-opts > details{order:1;}
  .mm-castpanel .fs-actor-opts > .fs-actor-recast{order:2;}
  .mm-castpanel .fs-actor-opts > .fs-actor-del{order:3;margin-inline-start:auto;}
  .mm-castpanel .fs-shot-url{font-size:16px;}
  .mm-castpanel .fs-cast-add{width:100%;justify-content:center;min-height:46px;box-sizing:border-box;}
  /* (…and the step's one link, "Create a new character", was 31px tall under the faces) */
  .mm-story a.mm-pace-auto{min-height:44px;}
}
@media(prefers-reduced-motion:reduce){.fs-go::after{display:none;}.fs-tmpl,.fs-shot-make,.fs-write,.fs-go,.fs-actor-cast{transition:none;}.fs-head-img,.fs-head-copy b,.fs-head-rose{animation:none;}}
@media(max-width:640px){.fs-head{padding:18px;min-height:114px;}.fs-head-copy{max-width:60%;padding:0;}.fs-head-vid{width:52%;}.fs-head-copy b{font-size:21px;}.fs-head-media{width:52%;}.fs-tmpl{flex:1 1 100%;}.fs-shot{flex-direction:column;}.fs-shot-frame{width:100%;max-width:160px;align-self:center;}}
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
/* the music video's idea: one line that grows to show all of what was typed */
.mm-topic textarea.mm-topic-grow{resize:none;overflow:hidden;field-sizing:content;min-height:0;display:block;}
.mm-topic input:focus,.mm-topic textarea:focus{outline:0;border-color:var(--green,#0C7A46);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.mm-topic input::placeholder,.mm-topic textarea::placeholder{color:var(--ink3,#9AA39B);}
/* a music video kept from last time: one card, one tap to pick it up */
.mm-kept{display:flex;align-items:center;gap:12px;margin:14px 0 2px;padding:10px 12px;border:1.5px solid #B9E0C8;background:#F0F8F3;border-radius:16px;}
.mm-kept-pic{flex:none;width:42px;height:56px;border-radius:9px;object-fit:cover;background:#20302A;}
.mm-kept-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
.mm-kept-txt b{font-family:Poppins,sans-serif;font-size:13.5px;font-weight:800;color:#0A5E37;line-height:1.2;}
.mm-kept-txt span{font-size:11.5px;font-weight:600;color:var(--ink2,#4B5A51);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.mm-kept-go{flex:none;min-height:44px;padding:0 16px;border-radius:12px;border:0;background:var(--green,#0C7A46);color:#fff;font-family:Poppins,sans-serif;font-size:13px;font-weight:800;cursor:pointer;}
.mm-kept-go:hover{filter:brightness(1.07);}
.mm-kept-x{flex:none;position:relative;width:30px;height:30px;border-radius:50%;border:1px solid var(--line,#E4DFCF);background:#fff;color:var(--ink2,#55605A);font-size:11px;cursor:pointer;}
.mm-kept-x::after{content:"";position:absolute;inset:-7px;}
/* NEXT EPISODE (film-series.ts): a small row above the posters — up to three of the member's own story
   films, one tap from their next episode. One line of compact cards, swiped sideways on a phone. */
.fs-eps{margin:16px 0 0;transition:opacity .32s ease;}
.fs-eps.throw{opacity:0;pointer-events:none;}
.fs-eps-h{margin:0 0 8px;font-family:Poppins,sans-serif;font-size:14px;font-weight:800;color:var(--ink,#14201A);}
.fs-eps-row{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 2px 6px;scrollbar-width:none;}
.fs-eps-row::-webkit-scrollbar{display:none;}
.fs-ep-card{flex:0 0 auto;width:min(240px,74vw);min-height:64px;display:flex;align-items:center;gap:10px;padding:8px 12px 8px 8px;border:1.5px solid #B9E0C8;background:#F0F8F3;border-radius:14px;cursor:pointer;text-align:left;font:inherit;color:inherit;scroll-snap-align:start;}
.fs-ep-card:hover{border-color:var(--green,#0C7A46);}
.fs-ep-card:focus-visible{outline:3px solid rgba(12,122,70,.35);outline-offset:2px;}
.fs-ep-pic{flex:none;width:56px;height:70px;border-radius:9px;object-fit:cover;background:#20302A;box-shadow:0 2px 6px rgba(20,32,26,.22);}
.fs-ep-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;}
.fs-ep-txt b{font-family:Poppins,sans-serif;font-size:13px;font-weight:800;color:var(--ink,#14201A);line-height:1.25;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;}
.fs-ep-txt span{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:800;color:#0A5E37;}
/* …and on the setup screen, the one line that says what this is, with an ✕ to make it an ordinary film */
.fs-epline{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.fs-editline{display:flex;align-items:flex-start;gap:8px;margin:0 0 10px;padding:9px 12px;border-radius:12px;background:#EEF7F1;border:1px solid #CFE6D8;color:#0A5E37;font-size:13px;line-height:1.45;}
.fs-editline svg{flex:none;margin-top:2px;}
.mm-topic .fs-epline label{flex:1;min-width:0;margin:0;display:flex;align-items:center;gap:6px;font-family:Poppins,sans-serif;font-size:13.5px;color:#0A5E37;}
.fs-epline-x{flex:none;position:relative;width:32px;height:32px;display:grid;place-items:center;border-radius:50%;border:1px solid var(--line,#E4DFCF);background:#fff;color:var(--ink2,#55605A);cursor:pointer;}
.fs-epline-x::after{content:"";position:absolute;inset:-6px;}
.fs-epline-x.is-arm{border-color:#D9A53A;box-shadow:0 0 0 2px #EBD9A8;background:#FFF7E3;color:#7A5A12;}
/* scene-count row that lives under the describe-first box in the classic (non-MV) builder */
.fs-len-topic{display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line,#E4DFCF);font-size:13px;font-weight:700;color:var(--ink2,#55605A);flex-wrap:wrap;}
/* THE LANGUAGE A STORY IS TOLD IN — under the idea box: the same pill as the Studio's "Writing in" (one setting) */
.fs-toldin{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12.5px;font-weight:700;color:var(--ink2,#55605A);flex-wrap:wrap;}
.mm-hint{font-size:12.5px;color:var(--ink2,#4A554E);margin:18px 4px 10px;display:flex;align-items:center;gap:7px;}
/* The cards are a horizontal SLIDER (swipe through them like a wheel) — one row, so tapping a card
   opens its options directly beneath the row (adjacent), never buried under the other cards. */
/* A numbered 1-5 step flow, two across — each step turns green once set. An open step's options
   panel is a full-width grid item placed right after its card (via the order property); dense flow
   backfills so the 2-up cards never leave an empty gap next to the open step. */
.mm-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;grid-auto-flow:row dense;}
.mm-card{position:relative;text-align:left;cursor:pointer;background:#fff;border:1.5px solid var(--line,#E4DFCF);border-radius:18px;padding:15px 16px;box-shadow:0 1px 2px rgba(20,32,26,.04);transition:transform .16s cubic-bezier(.2,.7,.2,1),box-shadow .16s,border-color .16s,background .2s;font-family:Poppins,sans-serif;}
.mm-card-wide{grid-column:1 / -1;}
.mm-pacepick .mm-lenopt{flex:1 1 150px;align-items:flex-start;text-align:left;gap:3px;padding:12px 14px;}
.mm-pacepick .mm-lenopt small{font-size:11.5px;line-height:1.35;}
.mm-pace-n{font-weight:800;color:var(--green,#0C7A46);}
.mm-pace-auto{display:inline-flex;align-items:center;gap:6px;margin-top:10px;border:0;background:transparent;color:var(--green,#0C7A46);font:inherit;font-size:12.5px;font-weight:800;cursor:pointer;padding:6px 2px;}
.mm-pace-auto:hover{text-decoration:underline;}
a.mm-pace-auto{text-decoration:none;}
/* The STORY builder's own pickers (it shares the cards, panels and length tiles with the Music Video). */
.mm-story{margin-top:0;}
.mm-toldpick{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:4px;}
.mm-told{display:flex;flex-direction:column;align-items:flex-start;gap:6px;text-align:left;border:1.5px solid var(--line,#E4DFCF);background:#fff;border-radius:14px;padding:14px 15px;cursor:pointer;font-family:Poppins,sans-serif;transition:border-color .14s,background .14s,box-shadow .14s;}
.mm-told b{display:flex;align-items:center;gap:7px;font-size:15px;font-weight:800;color:var(--ink,#14201A);}
.mm-told b svg{stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;}
.mm-told small{font-size:12px;line-height:1.45;color:var(--ink2,#4A554E);}
.mm-told em{font-style:normal;font-size:11px;font-weight:800;color:var(--green,#0C7A46);background:var(--mint,#EAF6EF);border-radius:999px;padding:3px 9px;}
.mm-told.on{border-color:var(--green,#0C7A46);background:#F0F8F3;box-shadow:0 0 0 1px var(--green,#0C7A46);}
.mm-told.on b{color:var(--green,#0C7A46);}
.mm-told:disabled{opacity:.5;cursor:default;}
@media(max-width:520px){.mm-toldpick{grid-template-columns:1fr;}}
.mm-shapepick .mm-lenopt{gap:5px;}
/* (the Motion card has two choices: they share the row — three columns left a third of it empty) */
.mm-lenpick.mm-motionpick{grid-template-columns:1fr 1fr;}
.mm-motionpick .mm-lenopt{gap:4px;padding:13px 10px;}
.mm-motionpick .mm-lenopt b{font-size:15.5px;}
.mm-motionpick .mm-lenopt small{font-size:11.5px;line-height:1.35;text-align:center;}
.mm-shapepick .mm-lenopt b{font-size:14.5px;}
.mm-shape{display:block;border:2px solid currentColor;border-radius:4px;color:var(--ink3,#9AA39B);background:rgba(20,32,26,.04);}
.mm-shape.s16x9{width:44px;height:25px;margin:9px 0;}
.mm-shape.s9x16{width:25px;height:43px;}
.mm-shape.s1x1{width:34px;height:34px;margin:4.5px 0;}
.mm-lenopt.on .mm-shape{color:var(--green,#0C7A46);background:rgba(12,122,70,.1);}
.mm-cappick{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:4px;}
/* four styles: one row where there is room, two rows of two on a phone (three across left "Off" by itself) */
@media(max-width:640px){.mm-cappick{grid-template-columns:repeat(2,minmax(0,1fr));}}
.mm-cap{display:flex;flex-direction:column;align-items:center;gap:6px;border:1.5px solid var(--line,#E4DFCF);background:#fff;border-radius:14px;padding:10px 8px 12px;cursor:pointer;font-family:Poppins,sans-serif;transition:border-color .14s,background .14s,box-shadow .14s;}
.mm-cap b{font-size:13.5px;font-weight:800;color:var(--ink,#14201A);}
.mm-cap small{font-size:11px;line-height:1.35;color:var(--ink2,#4A554E);text-align:center;}
.mm-cap.on{border-color:var(--green,#0C7A46);background:#F0F8F3;box-shadow:0 0 0 1px var(--green,#0C7A46);}
.mm-cap.on b{color:var(--green,#0C7A46);}
.mm-cap-demo{position:relative;display:block;width:100%;max-width:132px;aspect-ratio:4 / 5;border-radius:10px;overflow:hidden;background:#12241D center/cover no-repeat;}
.mm-cap-demo i{position:absolute;left:7%;right:7%;text-align:center;font-style:normal;color:#fff;}
.mm-cap-demo .bold{top:54%;font-size:15px;font-weight:900;line-height:1.08;letter-spacing:.01em;text-transform:uppercase;text-shadow:-1.5px -1.5px 0 #000,1.5px -1.5px 0 #000,-1.5px 1.5px 0 #000,1.5px 1.5px 0 #000,0 2.5px 0 #000;}
.mm-cap-demo .bold .lit{color:#FFD84A;font-weight:inherit;}
.mm-cap-demo .sub{bottom:8%;font-size:8.5px;font-weight:600;line-height:1.3;text-shadow:0 1px 2px #000,0 0 3px #000;}
.mm-vo-h{font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--ink3,#9AA39B);margin:14px 0 7px;}
.mm-vopick{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;}
.mm-vo{display:flex;align-items:stretch;border:1.5px solid var(--line,#E4DFCF);background:#fff;border-radius:12px;overflow:hidden;transition:border-color .14s,background .14s,box-shadow .14s;}
.mm-vo.on{border-color:var(--green,#0C7A46);background:#F0F8F3;box-shadow:0 0 0 1px var(--green,#0C7A46);}
.mm-vo-pick{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left;border:0;background:transparent;padding:10px 12px;min-height:48px;font-family:Poppins,sans-serif;cursor:pointer;}
.mm-vo-pick b{font-size:13.5px;font-weight:800;color:var(--ink,#14201A);}
.mm-vo.on .mm-vo-pick b{color:var(--green,#0C7A46);}
.mm-vo-pick small{font-size:11px;line-height:1.3;color:var(--ink2,#4A554E);}
.mm-vo-play{flex:none;width:46px;border:0;border-left:1.5px solid var(--line,#E4DFCF);background:transparent;color:var(--green,#0C7A46);cursor:pointer;display:grid;place-items:center;}
.mm-vo-play:hover{background:var(--mint,#EAF6EF);}
.mm-vo-play svg{stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
.fs-narr .mm-preview-btn{width:100%;justify-content:center;padding:13px 16px;font-size:14px;}
.fs-narr .mm-storyboard{margin-top:12px;}
.mm-sc-told .mm-sc-lyr-ico{display:grid;place-items:center;}
.mm-sc-told .mm-sc-lyr-ico svg{stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;}
.mm-sc-told .mm-sc-words{min-height:74px;line-height:1.45;}
@media(max-width:560px){
  .mm-sb-list.is-told{grid-template-columns:1fr;}
  .mm-sb-list.is-told .mm-sc{flex-direction:row;}
  .mm-sb-list.is-told .mm-sc-frame{flex:0 0 36%;width:36%;aspect-ratio:auto !important;min-height:176px;}
  .mm-sb-list.is-told .mm-sc-bd{flex:1;min-width:0;}
  /* (the picture is a third of the card here: a flag that names someone — "Marta is missing" — wraps inside
     it, and stops short of the re-roll button in the same corner row; seen in a mock: it ran under the button) */
  .mm-sb-list.is-told .mm-sb-flag{max-width:calc(100% - 48px);white-space:normal;overflow-wrap:anywhere;text-align:left;line-height:1.15;padding:5px 9px;border-radius:12px;}
}
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
/* Wide desktop: fan the step cards into 3 columns so they don't balloon in the wider studio. */
@media (min-width:960px){.mm-grid{grid-template-columns:repeat(3,minmax(0,1fr));}}
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
/* Desktop: the step cards get real presence (they looked thin + sparse stretched across the wide view). */
@media(min-width:960px){
  .mm-card{padding:22px 26px;border-radius:20px;}
  .mm-card-top{gap:14px;}
  .mm-card-ico,.mm-card-face{width:50px;height:50px;border-radius:14px;}
  .mm-card-ico svg{width:24px;height:24px;}
  .mm-card-kick{font-size:11.5px;}
  .mm-card-ttl b{font-size:19px;}
  .mm-val{font-size:14.5px;margin-top:15px;}
  .mm-step{width:28px;height:28px;font-size:13.5px;top:16px;right:16px;}
}
.mm-val .mm-free{color:var(--green,#0C7A46);font-weight:800;}
.mm-card-cast{display:flex;margin-top:10px;padding-left:5px;}
.mm-card-castface{width:26px;height:26px;border-radius:50%;background:#20302A;background-size:cover;background-position:center;border:2px solid #fff;margin-left:-7px;box-shadow:0 1px 3px rgba(0,0,0,.14);}
.mm-card-castface.lead{margin-left:0;border-color:var(--green,#0C7A46);}
/* THE CAST CARD ONCE A SCRIPT EXISTS (2026-11-25, one place to cast): the script's characters — a face each,
   or a lettered disc with a dashed edge for one not cast yet (an empty frame waiting for a picture, in the
   Cast step's own violet) — their names, and how many of them have a face. */
.mm-cast-names{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;font-weight:700;color:var(--ink,#14201A);}
.mm-cast-line{display:flex;align-items:center;justify-content:space-between;gap:6px 8px;flex-wrap:wrap;margin-top:9px;}
.mm-cast-line .mm-card-cast{margin-top:0;padding-left:0;}
.mm-card-castface.is-open,.mm-card-castface.is-more{display:grid;place-items:center;box-sizing:border-box;font-family:Poppins,sans-serif;font-size:11px;font-weight:800;line-height:1;}
.mm-card-castface.is-open{background:#F3EFFB;border:1.5px dashed #A792D6;color:#6C4FB0;box-shadow:none;}
.mm-card-castface.is-open:first-child{margin-left:0;}
.mm-card-castface.is-more{background:#EFF1EE;color:var(--ink2,#4A554E);font-size:10px;}
.mm-cast-count{flex:none;display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800;line-height:1;color:var(--ink2,#4A554E);background:var(--cream,#FBF6E6);border:1px solid var(--line,#E4DFCF);border-radius:999px;padding:5px 9px;white-space:nowrap;transition:background .2s,color .2s,border-color .2s;}
.mm-cast-count.done{color:#fff;background:var(--green,#0C7A46);border-color:var(--green,#0C7A46);}
.mm-cast-count svg{stroke:currentColor;stroke-width:2.4;fill:none;stroke-linecap:round;stroke-linejoin:round;}
@media(min-width:960px){.mm-cast-line{margin-top:11px;}.mm-cast-line .mm-card-castface{width:32px;height:32px;font-size:12.5px;}.mm-cast-count{font-size:12px;padding:6px 11px;}}
/* THE CARD ASKS ONCE: a script that has just arrived gives the card a green edge and ONE soft pulse, its discs
   walk on one after another, and a line under them asks to be opened — all of it gone the first time the
   step is. (The pulse waits until the card is on screen — the page adds .is-new only then.) */
.mm-cast-nudge{display:block;margin-top:8px;font-size:11.5px;font-weight:700;line-height:1.3;color:var(--green,#0C7A46);}
.mm-card.is-new{border-color:var(--green2,#1EA85C);animation:mmCastNew 1.7s ease-out .15s 1;}
.mm-card.is-new .mm-card-castface{animation:mmCastOn .46s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,0) * 110ms + .2s);}
@keyframes mmCastNew{0%{box-shadow:0 0 0 0 rgba(31,164,99,.5);}65%{box-shadow:0 0 0 13px rgba(31,164,99,0);}100%{box-shadow:0 0 0 0 rgba(31,164,99,0);}}
@keyframes mmCastOn{from{opacity:0;transform:translateY(7px) scale(.7);}to{opacity:1;transform:none;}}
@media(prefers-reduced-motion:reduce){.mm-card.is-new,.mm-card.is-new .mm-card-castface{animation:none;}}
@media(min-width:960px){.mm-cast-nudge{font-size:12.5px;}}
/* (A button centres what it holds: beside a Cast card made taller by a script's characters, the next card's
   title floated in the middle of its height. The story builder's cards start from the top, so the titles
   of a row stand on one line.) */
.mm-story .mm-grid > .mm-card{display:flex;flex-direction:column;justify-content:flex-start;}
/* (…and the picked face of its Cast panel keeps a whole glow: the strip scrolls sideways, so it clips, and
   the wide green halo was cut off square at the strip's edge. A little room inside the strip, taken back
   outside it, and a halo that fits in that room.) */
.mm-story .mm-artistpick{padding:8px 8px 14px;margin:-6px -6px -4px;}
.mm-story .mm-artistpick .fs-rface.on:not(.is-arm){box-shadow:0 0 0 2.5px var(--green,#0C7A46),0 0 9px -1px rgba(18,168,94,.55),0 5px 9px -5px rgba(12,122,70,.5);}
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
/* Desktop: the avatar + cast portrait cards get MUCH bigger so the row reads premium, not a
   cramped strip of tiny faces (owner: "the little stuff makes it look rough"). */
@media(min-width:960px){
  .mm-artistpick{gap:14px;padding-bottom:12px;}
  .mm-artistpick .fs-rface{flex-basis:128px;border-radius:16px;padding:7px 7px 9px;}
  .mm-artistpick .fs-rface-img{border-radius:12px;}
  .mm-artistpick .fs-rface-name{font-size:13px;}
  .mm-wd2-saved{gap:14px;}
  .mm-wd2-look,.mm-wd2-lookname{width:110px;max-width:110px;}
  .mm-wd2-lookimg{width:110px;height:110px;border-radius:18px;}
}
/* The cast LIBRARY — extra named members beyond the lead artist (Stage 2). */
.mm-castlib{margin-top:14px;padding-top:13px;border-top:1px solid var(--line,#E4DFCF);}
.mm-castlib-h{font-size:13px;font-weight:800;color:var(--ink,#14201A);display:flex;align-items:center;gap:7px;margin-bottom:3px;}
.mm-castlib-badge{font-size:10px;font-weight:700;color:var(--ink3,#9AA39B);background:var(--panel,#F3F1EA);border:1px solid var(--line,#E4DFCF);border-radius:999px;padding:1px 8px;}
.mm-castlib-list{display:flex;flex-direction:column;gap:7px;margin:9px 0 4px;}
.mm-castmem{display:flex;align-items:center;gap:9px;background:#fff;border:1px solid var(--line,#E4DFCF);border-radius:11px;padding:6px 8px;}
.mm-castmem-face{width:34px;height:34px;border-radius:50%;background-size:cover;background-position:center;flex:none;}
.mm-castmem-name{flex:1;min-width:0;border:1px solid transparent;border-radius:8px;background:transparent;font-family:Poppins,sans-serif;font-size:13px;font-weight:600;color:var(--ink,#14201A);padding:5px 8px;}
.mm-castmem-name:focus{outline:0;background:#FCFBF7;border-color:var(--green2,#1EA85C);box-shadow:0 0 0 2px rgba(12,122,70,.1);}
.mm-castmem-del{flex:none;width:28px;height:28px;border-radius:8px;border:1px solid var(--line,#E4DFCF);background:#fff;color:var(--ink3,#9AA39B);font-size:12px;cursor:pointer;display:grid;place-items:center;transition:background .14s,color .14s;}
.mm-castmem-del:hover{background:#FBEEEC;color:#B4463A;border-color:#F2D6D1;}
/* A FEATURED VERSE — the co-star sings part of the song in their own voice. */
.mm-twovoice{display:flex;align-items:center;gap:12px;width:100%;margin:10px 0 2px;padding:11px 14px;min-height:56px;border:1px solid var(--line,#E4DFCF);border-radius:14px;background:#fff;color:var(--ink,#14201A);text-align:left;cursor:pointer;font:inherit;transition:border-color .14s,background .14s;}
.mm-twovoice:hover:not(:disabled){border-color:var(--green2,#1EA85C);}
.mm-twovoice.on{border-color:var(--green,#0C7A46);background:#F2FAF5;}
.mm-twovoice:disabled{opacity:.6;cursor:default;}
.mm-twovoice:focus-visible{outline:2px solid var(--green2,#1EA85C);outline-offset:2px;}
.mm-switch{flex:none;position:relative;width:44px;height:26px;border-radius:999px;background:#C8CEC9;transition:background .16s;}
.mm-switch::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(20,32,26,.3);transition:transform .16s;}
.mm-twovoice.on .mm-switch{background:var(--green,#0C7A46);}
.mm-twovoice.on .mm-switch::after{transform:translateX(18px);}
.mm-twovoice-txt{display:grid;gap:2px;min-width:0;}
.mm-twovoice-txt b{font-family:Poppins,sans-serif;font-size:13.5px;font-weight:700;}
.mm-twovoice-txt span{font-size:12.5px;line-height:1.35;color:var(--ink2,#55605A);}
@media (prefers-reduced-motion:reduce){.mm-switch,.mm-switch::after,.mm-twovoice{transition:none;}}
.mm-castmem-feat{flex:none;display:inline-flex;align-items:center;gap:5px;min-height:28px;padding:0 10px;border-radius:999px;border:1px solid var(--line,#E4DFCF);background:#fff;color:var(--ink2,#55605A);font-family:Poppins,sans-serif;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .14s,color .14s,border-color .14s,box-shadow .14s;}
.mm-castmem-feat svg{stroke:currentColor;stroke-width:2;fill:none;}
.mm-castmem-feat:hover:not(:disabled){border-color:var(--green2,#1EA85C);color:var(--green-d,#0A5E37);background:#F2FAF5;}
.mm-castmem-feat.on{background:var(--green,#0C7A46);border-color:var(--green,#0C7A46);color:#fff;box-shadow:0 4px 12px -6px rgba(12,122,70,.7);}
.mm-castmem-feat:disabled{opacity:.5;cursor:default;}
.mm-castmem-feat:focus-visible{outline:2px solid var(--green2,#1EA85C);outline-offset:2px;}
.mm-castpick{margin-top:4px;}
/* Wardrobe — folded INTO the avatar picker (no doomscroll): an outfit slider opens under the selected
   avatar; presets + your SAVED generated outfits (each a thumbnail); picking GENERATES + saves it. */
.mm-castmem-wrap{display:flex;flex-direction:column;gap:0;}
.mm-gender{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:11px;}
.mm-gender-lbl{font-size:12px;font-weight:800;color:var(--ink,#14201A);}
.mm-gender-seg{display:inline-flex;gap:5px;background:#F3EFE2;border:1px solid var(--line,#E4DFCF);border-radius:11px;padding:4px;}
.mm-gender-opt{border:0;background:transparent;border-radius:8px;padding:6px 16px;font-size:12.5px;font-weight:700;color:var(--ink2,#55605A);cursor:pointer;font-family:Poppins,sans-serif;transition:background .14s,color .14s;}
.mm-gender-opt.on{background:var(--green,#0C7A46);color:#fff;}
.mm-gender-hint{font-size:11px;font-weight:600;color:var(--ink3,#9AA39B);}
.mm-artist-wd{margin-top:11px;padding-top:11px;border-top:1px dashed var(--line,#E4DFCF);}
.mm-castmem-faceb{position:relative;border:0;cursor:pointer;padding:0;transition:box-shadow .14s;}
.mm-castmem-faceb.on{box-shadow:0 0 0 2px #7A4FC2;}
.mm-castmem-wd{position:absolute;right:-2px;bottom:-2px;width:15px;height:15px;border-radius:50%;background:#7A4FC2;color:#fff;display:grid;place-items:center;border:1.5px solid #fff;}
.mm-castmem-wd svg{stroke:#fff;stroke-width:2.2;fill:none;}
.mm-wd2{display:flex;flex-direction:column;gap:7px;}
.mm-castmem-wrap .mm-wd2{margin:7px 0 3px 4px;}
.mm-wd2-h{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:800;color:var(--ink,#14201A);}
.mm-wd2-h svg{stroke:currentColor;stroke-width:2;fill:none;}
.mm-wd2-hint{font-size:11px;font-weight:600;color:var(--ink3,#9AA39B);line-height:1.4;margin:-3px 0 1px;}
/* the wardrobe is locked: said where the look is picked */
.mm-wd2-lock{display:inline-flex;align-items:center;gap:5px;align-self:flex-start;font-size:11px;font-weight:700;color:var(--green,#0C7A46);background:rgba(12,122,70,.08);border-radius:999px;padding:3px 9px;line-height:1.3;}
.mm-wd2-spin{width:24px;height:24px;border:2.5px solid #E0D4F3;border-top-color:#7A4FC2;border-radius:50%;animation:mm-wd2-rot .7s linear infinite;}
@keyframes mm-wd2-rot{to{transform:rotate(360deg);}}
/* Generating tile uses the Archive's rosette-green cook spinner (sized to the 78px look tile). */
.mm-wd2-cook{background:linear-gradient(160deg,#0E8A4F,#0A5F38 55%,#084A2C)!important;border-color:#0C7A46!important;display:grid!important;place-items:center;overflow:hidden;}
.mm-wd2-cook .wb-spin{width:30px;height:30px;}
.mm-wd2-cook .wb-bufwrap::before{width:70px;height:70px;}
.mm-wd2-saved{display:flex;gap:10px;overflow-x:auto;padding:3px 1px 5px;scrollbar-width:thin;}
.mm-wd2-look{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:5px;width:78px;border:0;background:transparent;cursor:pointer;padding:0;}
.mm-wd2-look[disabled]{cursor:default;}
.mm-wd2-lookimg{position:relative;width:78px;height:78px;border-radius:14px;overflow:hidden;background:#F3EEFB;display:grid;place-items:center;border:2px solid var(--line,#E4DFCF);transition:border-color .14s,box-shadow .14s;}
.mm-wd2-look.on .mm-wd2-lookimg{border-color:#7A4FC2;box-shadow:0 0 0 2px #7A4FC2;}
.mm-wd2-lookimg img{width:100%;height:100%;object-fit:cover;}
.mm-wd2-lookchk{position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:#7A4FC2;color:#fff;display:grid;place-items:center;box-shadow:0 1px 3px rgba(0,0,0,.22);}
.mm-wd2-lookchk svg{stroke:#fff;stroke-width:2.6;fill:none;}
.mm-wd2-lookname{font-size:11px;font-weight:700;color:var(--ink2,#55605A);text-align:center;line-height:1.2;max-width:78px;}
.mm-wd2-look.on .mm-wd2-lookname{color:#5B3A99;}
.mm-wd2-look.is-making .mm-wd2-lookname{color:#7A4FC2;}
.mm-wd2-sugs{display:flex;flex-wrap:wrap;align-items:center;gap:6px;}
.mm-wd2-sugl{font-size:10px;font-weight:800;color:var(--ink3,#9AA39B);text-transform:uppercase;letter-spacing:.05em;margin-right:2px;}
.mm-wd2-sug{border:1.5px dashed #D9C9F0;background:#FBF8FF;color:#5B3A99;border-radius:999px;padding:6px 12px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:Poppins,sans-serif;transition:background .14s,border-color .14s;}
.mm-wd2-sug:hover:not(:disabled){background:#F3EEFB;border-color:#7A4FC2;}
.mm-wd2-sug:disabled{opacity:.5;cursor:default;}
.mm-wd2-make{display:flex;gap:7px;align-items:center;}
.mm-wardrobe-input{flex:1;border:1.5px solid var(--line,#E4DFCF);border-radius:10px;padding:10px 12px;font-size:12.5px;font-family:Poppins,sans-serif;color:var(--ink,#14201A);background:#fff;}
.mm-wardrobe-input:focus{outline:0;border-color:#7A4FC2;box-shadow:0 0 0 3px rgba(122,79,194,.12);}
.mm-wd2-gen{flex:none;display:inline-flex;align-items:center;gap:6px;border:0;border-radius:10px;background:#7A4FC2;color:#fff;font-weight:800;font-size:12px;padding:10px 14px;cursor:pointer;font-family:Poppins,sans-serif;}
.mm-wd2-gen:disabled{opacity:.5;cursor:default;}
.mm-wd2-gen svg{stroke:#fff;stroke-width:2;fill:none;}
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
/* THE STORY'S CAST — a row of portraits over the scenes (a told story's storyboard) */
.mm-stars{margin:2px 0 14px;}
.mm-stars-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;margin:0 2px 9px;}
.mm-stars-h b{font-family:Poppins,sans-serif;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--ink,#14201A);}
.mm-stars-h span{font-size:12px;font-weight:600;color:var(--ink2,#4A554E);line-height:1.35;}
.mm-stars-row{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 8px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;scrollbar-width:thin;}
.mm-star{position:relative;flex:0 0 108px;width:108px;min-width:0;display:flex;flex-direction:column;gap:5px;scroll-snap-align:start;}
.mm-star-pic{position:relative;display:block;width:108px;height:144px;padding:0;border:0;border-radius:14px;overflow:hidden;background:#EDE9DF;cursor:zoom-in;font:inherit;color:inherit;box-shadow:0 0 0 1px var(--line,#E4DFCF),0 8px 18px -10px rgba(20,32,26,.35);transition:transform .16s cubic-bezier(.2,.7,.2,1),box-shadow .16s;}
.mm-star-pic img{display:block;width:100%;height:100%;object-fit:cover;object-position:center top;}
.mm-star-nm{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;font-family:Poppins,sans-serif;font-size:12.5px;font-weight:800;line-height:1.2;color:var(--ink,#14201A);}
.mm-star-lk{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:11px;font-weight:600;line-height:1.3;color:var(--ink2,#4A554E);}
.mm-star-pic:focus-visible{outline:3px solid var(--green,#0C7A46);outline-offset:2px;}
.mm-star .mm-sb-reroll{top:5px;right:5px;}
/* THE WALK-ON: the cast come on one by one, then the places — the way a film's titles bring on its stars.
   (A character drawn again is a new card, so they walk on again.) */
.mm-stars-row .mm-star{animation:mmStarOn .52s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,0) * 120ms);}
@keyframes mmStarOn{from{opacity:0;transform:translateY(16px) scale(.94) rotate(-1.6deg)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.mm-stars-row .mm-star{animation:none;}}
.mm-star.is-place{flex-basis:144px;width:144px;}
.mm-star.is-place .mm-star-pic{width:144px;}
.mm-star.is-place .mm-star-pic img{object-position:center;}
.mm-star-tag{position:absolute;left:6px;bottom:6px;display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border-radius:999px;background:rgba(20,32,26,.78);color:#fff;font-family:Poppins,sans-serif;font-size:10px;font-weight:800;letter-spacing:.04em;line-height:1;}
@media(hover:hover){.mm-star-pic:hover{transform:translateY(-3px);box-shadow:0 0 0 1px var(--line,#E4DFCF),0 14px 24px -12px rgba(20,32,26,.45);}}
@media(prefers-reduced-motion:reduce){.mm-star-pic{transition:none;}.mm-star-pic:hover{transform:none;}}
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
.mm-sb-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:2px 0 4px;grid-auto-flow:row dense;}
@media(min-width:640px){.mm-sb-list{grid-template-columns:repeat(3,minmax(0,1fr));}}
@media(min-width:1120px){.mm-sb-list{grid-template-columns:repeat(4,minmax(0,1fr));}}
@media(min-width:1680px){.mm-sb-list{grid-template-columns:repeat(5,minmax(0,1fr));}}
.mm-sc{display:flex;flex-direction:column;border:1.5px solid var(--line,#E4DFCF);border-radius:14px;background:#fff;overflow:hidden;box-shadow:0 1px 3px rgba(20,32,26,.06);}
.mm-sc.is-perform{border-color:#A6DCC0;}
.mm-sc.is-broll{border-color:#CBC6F2;}
.mm-sc-frame{position:relative;width:100%;aspect-ratio:4/5;background:#20302A;}
.mm-sc-frame img{width:100%;height:100%;object-fit:cover;display:block;}
.mm-sc-load{position:absolute;inset:0;}
.mm-sc .wb-cookimg{position:absolute;inset:0;width:100%;height:100%;aspect-ratio:auto;}
.mm-sc .wb-spin{width:52px;height:52px;}
.mm-sb-busy-rose{background:linear-gradient(160deg,#0E8A4F,#0A5F38 55%,#084A2C)!important;display:grid;place-items:center;}
.mm-sc-zoomable{cursor:zoom-in;}
.mm-lightbox{position:fixed;inset:0;z-index:9999;background:rgba(8,16,12,.9);display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out;animation:mmlbin .18s ease;}
@keyframes mmlbin{from{opacity:0}to{opacity:1}}
.mm-lightbox img{max-width:100%;max-height:100%;border-radius:12px;box-shadow:0 20px 60px -10px rgba(0,0,0,.7);}
.mm-lightbox-x{position:fixed;top:18px;right:18px;width:40px;height:40px;border-radius:50%;border:none;background:rgba(255,255,255,.16);color:#fff;font-size:17px;cursor:pointer;display:grid;place-items:center;}
.mm-lightbox-x:hover{background:rgba(255,255,255,.3);}
/* (the big view of a story character's portrait: keep them in your cast) */
.mm-lightbox-keep{position:fixed;left:50%;bottom:max(22px,env(safe-area-inset-bottom,0px));transform:translateX(-50%);display:inline-flex;align-items:center;gap:8px;min-height:48px;max-width:calc(100vw - 32px);padding:0 22px;border-radius:999px;border:0;background:var(--green,#0C7A46);color:#fff;font-family:Poppins,sans-serif;font-size:14px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;box-shadow:0 12px 30px rgba(0,0,0,.5);}
.mm-lightbox-keep:hover{background:var(--green2,#12A85E);}
.mm-lightbox-keep svg{stroke:currentColor;fill:none;flex:none;}
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
.mm-sc-what,.mm-sc-words{width:100%;display:block;box-sizing:border-box;border:1px solid transparent;border-radius:7px;background:transparent;resize:none;overflow:hidden;field-sizing:content;min-height:1.5em;font-family:Poppins,sans-serif;padding:3px 5px;margin:0;cursor:text;transition:background .12s,border-color .12s,box-shadow .12s;}
.mm-sc-what:hover,.mm-sc-words:hover{background:rgba(12,122,70,.05);}
.mm-sc-what:focus,.mm-sc-words:focus{outline:0;background:#fff;border-color:var(--green2,#1EA85C);box-shadow:0 0 0 2px rgba(12,122,70,.1);}
.mm-sc-what::placeholder,.mm-sc-words::placeholder{color:var(--ink3,#9AA39B);}
.mm-sc-what{font-size:12.5px;line-height:1.4;color:var(--ink,#14201A);font-weight:500;}
.mm-sc-lyr{display:flex;align-items:flex-start;gap:2px;}
.mm-sc-lyr-ico{flex:none;font-size:12px;line-height:1;color:#1EA85C;padding:5px 0 0;}
.mm-sc-words{font-size:12.5px;line-height:1.38;color:var(--green-d,#0A5E37);font-style:italic;font-weight:600;}
.mm-sc-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px;}
/* a row of cards is as tall as its tallest: the people and the two edit buttons sit at the BOTTOM of each,
   in line across the row (they floated at different heights, with a blank under the shorter card) */
.mm-sb-list.is-mv .mm-sc-bd{flex:1 1 auto;}
.mm-sb-list.is-mv .mm-sc-chips{margin-top:auto;padding-top:2px;}
/* a phone's card is 170px wide — three name chips stacked three deep. Whoever leads keeps their name; the
   people beside them are their faces (the name is still there for a screen reader, and in the Cast editor) */
@media(max-width:639px){
  .mm-sb-list.is-mv .mm-chip-av:not(.mm-chip-lead){padding:2px;}
  .mm-sb-list.is-mv .mm-chip-av:not(.mm-chip-lead) img{width:20px;height:20px;}
  .mm-sb-list.is-mv .mm-chip-av:not(.mm-chip-lead) .mm-chip-nm{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
}
.mm-sc-chip{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;border-radius:999px;padding:2px 8px 2px 3px;border:1px solid;}
.mm-sc-chip img{width:17px;height:17px;border-radius:50%;object-fit:cover;flex:none;}
.mm-chip-av{background:#EAF2FB;border-color:#D4E4F5;color:#1A4E85;}
.mm-chip-lead{background:#E7EEFA;border-color:#C7D9F0;font-weight:800;box-shadow:inset 0 0 0 1px #C7D9F0;}
/* a featured verse: the co-star who sings this shot, and a cut scene their voice is heard over */
.mm-chip-sings{background:#E4F4EA;border-color:#B9E0C8;color:#0A5E37;box-shadow:inset 0 0 0 1px #B9E0C8;}
.mm-chip-sings svg{stroke:currentColor;stroke-width:2;fill:none;flex:none;}
/* the picture check found something off: a nudge to draw it again, on the still itself */
.mm-sb-flag{position:absolute;left:7px;bottom:7px;display:inline-flex;align-items:center;gap:5px;min-height:24px;padding:0 9px;border-radius:999px;border:0;background:rgba(199,154,58,.95);color:#1A1407;font-family:Poppins,sans-serif;font-size:10.5px;font-weight:800;cursor:pointer;box-shadow:0 4px 12px -5px rgba(0,0,0,.6);}
.mm-sb-flag svg{stroke:currentColor;stroke-width:2.2;fill:none;}
.mm-sb-flag:hover:not(:disabled){background:#E7C879;}
.mm-sb-flag:disabled{opacity:.6;cursor:default;}
.mm-chip-cast{background:#F3EEFB;border-color:#E0D4F3;color:#5B3A99;padding:2px 9px;cursor:pointer;transition:background .14s;}
.mm-chip-cast:hover:not(:disabled){background:#EBE2F7;}
.mm-chip-cast:disabled{opacity:.5;cursor:default;}
.mm-chip-cast svg{stroke:currentColor;stroke-width:2;fill:none;}
.mm-sc-castedit{display:flex;flex-direction:column;gap:7px;}
.mm-sc-castpick{display:flex;gap:6px;overflow-x:auto;padding:7px 1px 2px;scrollbar-width:thin;}
.mm-cp-opt{flex:0 0 auto;position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;width:58px;border:1.5px solid var(--line,#E4DFCF);background:#fff;border-radius:10px;padding:5px 3px;font-size:9.5px;font-weight:700;color:var(--ink2,#55605A);cursor:pointer;line-height:1.1;text-align:center;}
.mm-cp-opt.on{border-color:#7A4FC2;box-shadow:0 0 0 1.5px #7A4FC2;color:#5B3A99;}
.mm-cp-img{width:46px;height:46px;border-radius:50%;background:#20302A;background-size:cover;background-position:center;}
.mm-cp-plus{position:absolute;top:3px;right:5px;width:16px;height:16px;line-height:15px;text-align:center;border-radius:50%;background:var(--green,#0C7A46);color:#fff;font-size:11px;font-weight:800;}
.mm-cp-hint{font-size:10.5px;font-weight:600;color:var(--ink3,#9AA39B);line-height:1.35;}
.mm-chip-pr{background:#F0F8F3;border-color:#CFE8DB;color:#0A5E37;padding-left:8px;}
.mm-chip-prop{background:#F0F8F3;border-color:#CFE8DB;color:#0A5E37;padding:2px 9px;cursor:pointer;transition:background .14s;}
.mm-chip-prop:hover:not(:disabled){background:#E4F2EA;}
.mm-chip-prop.empty{background:#F3F1EA;border-color:#E4DFCF;color:#8A8577;}
.mm-chip-prop svg{stroke:currentColor;stroke-width:2;fill:none;}
.mm-chip-prop:disabled{opacity:.5;cursor:default;}
/* EDIT A SCENE: three buttons in a row of their own under the people; each opens a DRAWER that spans the
   whole row under the card (a card is 174px wide on a phone — far too narrow to edit inside). */
.mm-sc-acts{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px;}
.mm-sc-act{flex:1 1 auto;display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:32px;padding:5px 9px;border-radius:9px;border:1px solid;font-family:Poppins,sans-serif;font-size:10.5px;font-weight:700;line-height:1.1;white-space:nowrap;cursor:pointer;transition:background .14s,box-shadow .14s,transform .08s;}
.mm-sc-act svg{stroke:currentColor;stroke-width:2;fill:none;flex:none;}
.mm-sc-act:active:not(:disabled){transform:scale(.97);}
.mm-sc-act:disabled{opacity:.5;cursor:default;}
.mm-sc-act:focus-visible{outline:2px solid #0C7A46;outline-offset:2px;}
.mm-sc-act.is-cast{background:#F3EEFB;border-color:#E0D4F3;color:#5B3A99;}
.mm-sc-act.is-cast:hover:not(:disabled){background:#EBE2F7;}
.mm-sc-act.is-prop{background:#F0F8F3;border-color:#CFE8DB;color:#0A5E37;}
.mm-sc-act.is-prop:hover:not(:disabled){background:#E4F2EA;}
.mm-sc-act.is-prop.empty{background:#F3F1EA;border-color:#E4DFCF;color:#6F6A5C;}
/* the scene has an outfit of its own: a small mark on the Cast button (the outfits live in that editor) */
.mm-sc-act-tag{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;background:var(--green,#0C7A46);color:#fff;margin-left:1px;}
.mm-sc-act-tag svg{stroke:#fff;}
.mm-sc-act.open{box-shadow:0 0 0 2px rgba(12,122,70,.35);}
.mm-sc.is-editing{border-color:var(--green,#0C7A46);box-shadow:0 0 0 3px rgba(12,122,70,.14);}
.mm-sc-drawer{grid-column:1/-1;display:flex;flex-direction:column;gap:10px;border:1.5px solid var(--green,#0C7A46);border-radius:14px;background:#FFFDF7;padding:11px 13px 13px;box-shadow:0 8px 22px rgba(20,32,26,.09);animation:mmDrawerIn .18s ease-out;}
@keyframes mmDrawerIn{from{opacity:0;transform:translateY(-6px);}to{opacity:1;transform:none;}}
@media(prefers-reduced-motion:reduce){.mm-sc-drawer{animation:none;}}
.mm-sd-head{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.mm-sd-title{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:800;color:var(--ink,#14201A);}
.mm-sd-num{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:var(--green,#0C7A46);color:#fff;font-size:11.5px;font-weight:800;}
.mm-sd-x{flex:none;width:32px;height:32px;border-radius:50%;border:1.5px solid var(--line,#E4DFCF);background:#fff;color:var(--ink2,#55605A);font-size:13px;cursor:pointer;line-height:1;}
.mm-sd-x:hover{background:#F3F1EA;}
.mm-sc-drawer .mm-sc-propcta{flex-wrap:wrap;}
.mm-sc-drawer .mm-sp-confirm{flex:1 1 190px;max-width:320px;min-height:40px;}
.mm-sc-drawer .mm-sp-cancel{min-height:40px;}
/* PER-SCENE WARDROBE: what each person wears in THIS scene (their look for the video unless changed) */
/* …bundled into the scene's Cast editor, under who is in it */
.mm-sw-label{display:flex;align-items:center;gap:6px;margin-top:4px;padding-top:10px;border-top:1px dashed var(--line,#E4DFCF);font-size:12px;font-weight:800;color:var(--ink,#14201A);}
.mm-sw-label svg{stroke:currentColor;stroke-width:2;fill:none;}
.mm-sw-people{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px 18px;}
.mm-sw-new{color:#5B3A99;}
.mm-sw-plus{width:58px;height:58px;border-radius:12px;border:2px dashed #C9B6EA;background:#FAF7FE;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:600;color:#7A4FC2;box-sizing:border-box;}
.mm-sw-new.on .mm-sw-plus{border-style:solid;border-color:#7A4FC2;background:#F3EEFB;}
.mm-sw-new:disabled{opacity:.5;cursor:default;}
.mm-chip-wear{background:#FBF4E6;border-color:#EBD9B4;color:#7A5A12;padding:2px 9px;cursor:pointer;transition:background .14s;}
.mm-chip-wear:hover:not(:disabled){background:#F6EAD0;}
.mm-chip-wear.on{background:#0C7A46;border-color:#0C7A46;color:#fff;}
.mm-chip-wear:disabled{opacity:.5;cursor:default;}
.mm-chip-wear svg{stroke:currentColor;stroke-width:2;fill:none;}
.mm-sc-wear{display:flex;flex-direction:column;gap:10px;}
.mm-sw-row{display:flex;flex-direction:column;gap:6px;}
.mm-sw-name{display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--ink2,#4B5A51);min-height:22px;}
/* who they are in the scene: whoever leads it is tagged; anyone else can be taken out of it */
.mm-sw-tag{display:inline-flex;align-items:center;gap:4px;font-size:9.5px;font-weight:800;letter-spacing:.03em;text-transform:none;border-radius:999px;padding:2px 7px;background:#E4F4EA;color:#0A5E37;}
.mm-sw-tag svg,.mm-sw-mic svg{stroke:currentColor;stroke-width:2;fill:none;flex:none;}
/* who SINGS the scene: the mic on their own row. Outlined = tap to hand it to them; filled = it is theirs */
.mm-sw-mic{position:relative;display:inline-flex;align-items:center;gap:4px;min-height:22px;padding:0 8px;border-radius:999px;border:1.5px solid var(--line,#E4DFCF);background:#fff;font-family:Poppins,sans-serif;font-size:9.5px;font-weight:800;letter-spacing:.03em;text-transform:none;color:var(--ink2,#55605A);cursor:pointer;transition:border-color .14s,background .14s,color .14s;}
.mm-sw-mic::after{content:"";position:absolute;inset:-11px -2px;}
.mm-sw-mic:hover{border-color:var(--green2,#1EA85C);color:#0A5E37;}
.mm-sw-mic.on{border-color:var(--green,#0C7A46);background:#E4F4EA;color:#0A5E37;}
.mm-sw-rm{flex:none;margin-left:5px;width:22px;height:22px;border-radius:50%;border:1px solid var(--line,#E4DFCF);background:#fff;color:var(--ink2,#55605A);font-size:10px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;position:relative;}
.mm-sw-rm::after{content:"";position:absolute;inset:-11px -9px;}
.mm-sw-rm:hover{background:#FBEDEA;border-color:#E9B8AE;color:#A2321C;}
.mm-sw-add{display:flex;flex-direction:column;gap:5px;padding-top:10px;border-top:1px dashed var(--line,#E4DFCF);}
.mm-sw-looks{display:flex;gap:8px;overflow-x:auto;padding:3px 2px 4px;scrollbar-width:thin;}
.mm-sw-look{flex:0 0 auto;width:64px;min-height:44px;display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:0;padding:0;cursor:pointer;font-family:Poppins,sans-serif;color:var(--ink2,#4B5A51);}
.mm-sw-look img,.mm-sw-cook{width:58px;height:58px;border-radius:12px;object-fit:cover;object-position:top;border:2px solid transparent;background:#EEF1EC;display:block;box-sizing:border-box;}
.mm-sw-cook{display:flex;align-items:center;justify-content:center;}
.mm-sw-look.on img{border-color:#7A4FC2;box-shadow:0 0 0 2px rgba(122,79,194,.2);}
.mm-sw-look span:last-child{font-size:10px;font-weight:700;line-height:1.2;max-width:66px;text-align:center;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.mm-sw-look.on span:last-child{color:#5B3A99;}
.mm-sw-look:focus-visible{outline:2px solid #7A4FC2;outline-offset:2px;border-radius:12px;}
.mm-sw-make{display:flex;gap:6px;align-items:center;}
.mm-sw-make .mm-wardrobe-input{min-width:0;padding:8px 10px;font-size:12px;}
.mm-sw-make .mm-wd2-gen{padding:8px 11px;}
.mm-sc-proppick{display:flex;gap:6px;overflow-x:auto;padding:7px 1px 2px;scrollbar-width:thin;}
.mm-sp-opt{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:3px;width:58px;border:1.5px solid var(--line,#E4DFCF);background:#fff;border-radius:10px;padding:5px 3px;font-size:9.5px;font-weight:700;color:var(--ink2,#55605A);cursor:pointer;line-height:1.1;text-align:center;}
.mm-sp-opt.on{border-color:var(--green,#0C7A46);box-shadow:0 0 0 1.5px var(--green,#0C7A46);}
.mm-sp-img{width:46px;height:40px;border-radius:7px;background:#20302A;background-size:cover;background-position:center;}
.mm-sp-new{color:var(--green,#0C7A46);border-style:dashed;}
.mm-sp-newimg{display:grid;place-items:center;background:#F0F8F3!important;color:var(--green,#0C7A46);font-size:22px;font-weight:800;line-height:1;}
.mm-sc-propedit{display:flex;flex-direction:column;gap:7px;}
.mm-sc-propcta{display:flex;gap:7px;align-items:center;}
.mm-sp-confirm{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:none;background:var(--green,#0C7A46);color:#fff;border-radius:9px;padding:9px 12px;font-size:12px;font-weight:800;cursor:pointer;transition:background .14s,opacity .14s;}
.mm-sp-confirm:hover:not(:disabled){background:#0A6B3D;}
.mm-sp-confirm:disabled{opacity:.5;cursor:default;}
.mm-sp-confirm svg{stroke:currentColor;stroke-width:2.5;fill:none;}
.mm-sp-cancel{flex:0 0 auto;border:1.5px solid var(--line,#E4DFCF);background:#fff;color:var(--ink2,#55605A);border-radius:9px;padding:9px 13px;font-size:12px;font-weight:700;cursor:pointer;}
.mm-sp-cancel:hover{background:#F3F1EA;}
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
.mm-aspect{display:flex;align-items:center;gap:10px;}
.mm-aspect-lbl{font-size:12px;font-weight:800;color:var(--ink2,#55605A);flex:none;}
.mm-aspect-seg{display:flex;gap:6px;flex:1;}
.mm-aspect-opt{flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;border:1.5px solid var(--line,#E4DFCF);background:#fff;border-radius:10px;padding:6px 4px;font-size:12px;font-weight:700;color:var(--ink2,#4A554E);cursor:pointer;transition:border-color .14s,background .14s;}
.mm-aspect-opt small{font-size:9.5px;font-weight:700;color:var(--ink3,#9AA39B);}
.mm-aspect-opt.on{border-color:var(--green,#0C7A46);background:#F0F8F3;color:var(--green,#0C7A46);box-shadow:0 0 0 1px var(--green,#0C7A46);}
.mm-aspect-opt.on small{color:var(--green,#0C7A46);}
/* a shape that would draw the scenes again: asked for once, done on the second tap */
.mm-aspect-opt.arm{border-color:#C79A3A;background:#FFF7E3;color:#7A5A12;box-shadow:0 0 0 1px #C79A3A;text-align:center;line-height:1.2;}
.mm-aspect-opt.arm small{color:#7A5A12;}
.mm-shape-warn{font-size:11.5px;font-weight:600;color:#7A5A12;background:#FFF7E3;border:1px solid #EBD9A8;border-radius:10px;padding:8px 11px;}
/* a tap that would start the story over is ARMED first (amber) and done on the second tap */
.fs-rface.is-arm,.mm-told.is-arm,.mm-lenopt.is-arm,.fs-rewrite.is-arm{border-color:#D9A53A;box-shadow:0 0 0 2px #EBD9A8;background:#FFF7E3;color:#7A5A12;}
.fs-stepper button.is-arm{background:#FFF1CF;color:#7A5A12;}
.mm-opts .mm-shape-warn,.mm-topic .mm-shape-warn{text-align:left;margin-top:10px;}
.fs-scenetop + .mm-shape-warn{text-align:left;margin:-4px 0 12px;}
.mm-idea-kept{text-align:left;margin-top:7px;font-size:11.5px;font-weight:600;}
.fs-go.is-sent:disabled{opacity:1;background:#E4F4EA;color:#0A5E37;box-shadow:inset 0 0 0 1.5px #B9E0C8;}
.fs-go.is-sent svg{stroke:#0A5E37;}
/* phone: the story editor's small controls get a full-size place to tap — the look stays as it is */
@media(max-width:640px){
.fs-stepper button{width:44px;height:44px;}
.fs-rewrite,.fs-beat-add,.fs-loc-addangle,.fs-bchip,.fs-actor-del,.fs-msg-x,.fs-anglecut-x,.fs-msg-spk,.fs-actor-recast,.fs-shot-own summary{position:relative;}
.fs-rewrite::after,.fs-beat-add::after,.fs-loc-addangle::after,.fs-bchip::after,.fs-actor-del::after,.fs-msg-spk::after,.fs-actor-recast::after,.fs-shot-own summary::after{content:"";position:absolute;left:0;right:0;top:50%;height:44px;transform:translateY(-50%);}
.fs-msg-x::after,.fs-anglecut-x::after{content:"";position:absolute;left:50%;top:50%;width:44px;height:44px;transform:translate(-50%,-50%);}
.fs-hero-back{min-height:40px;}
.fs-hero-back::after{content:"";position:absolute;inset:-4px -6px;}
}
.mm-lenpick{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:4px;}
.mm-lenopt{display:flex;flex-direction:column;align-items:center;gap:2px;border:1.5px solid var(--line,#E4DFCF);background:#fff;border-radius:12px;padding:12px 6px;cursor:pointer;transition:border-color .14s,background .14s,box-shadow .14s;}
.mm-lenopt b{font-size:18px;font-weight:900;color:var(--ink,#14201A);font-variant-numeric:tabular-nums;}
.mm-lenopt small{font-size:10.5px;font-weight:700;color:var(--ink3,#9AA39B);}
.mm-lenopt.on{border-color:var(--green,#0C7A46);background:#F0F8F3;box-shadow:0 0 0 1px var(--green,#0C7A46);}
.mm-lenopt.on b{color:var(--green,#0C7A46);}
.mm-lenopt.on small{color:var(--green,#0C7A46);}
.mm-lentip{font-size:11px;color:var(--ink3,#9AA39B);margin-top:2px;}
@media(max-width:520px){.mm-lenpick{grid-template-columns:repeat(3,1fr);}}
.mm-voicetog{display:flex;align-items:flex-start;gap:10px;border:1.5px solid var(--line,#E4DFCF);background:#FBFAF5;border-radius:12px;padding:11px 13px;cursor:pointer;margin-top:2px;}
.mm-voicetog:has(input:checked){border-color:var(--green,#0C7A46);background:#F0F8F3;}
.mm-voicetog input{margin-top:2px;width:17px;height:17px;accent-color:var(--green,#0C7A46);flex:none;cursor:pointer;}
.mm-voicetog-txt{display:flex;flex-direction:column;gap:2px;}
.mm-voicetog-txt b{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:800;color:var(--ink,#14201A);}
.mm-voicetog-txt small{font-size:11px;color:var(--ink3,#9AA39B);line-height:1.35;}
.mm-beta{font-size:9px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;color:var(--green,#0C7A46);background:#DEF0E6;border-radius:5px;padding:1px 5px;}
.mm-makegen .mm-preview-btn{width:100%;justify-content:center;padding:13px 16px;font-size:14px;}
.mm-makegen .mm-eta,.mm-makegen .mm-note{margin-top:0;}
.mm-go{position:relative;overflow:hidden;width:100%;display:inline-flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,#0C7A46,#15B165 55%,#1EA85C);color:#fff;border:0;border-radius:15px;padding:16px;font-family:Poppins,sans-serif;font-weight:800;font-size:16.5px;letter-spacing:-.01em;cursor:pointer;box-shadow:0 14px 30px -14px rgba(12,122,70,.7),inset 0 1px 0 rgba(255,255,255,.25);}
.mm-go:disabled{filter:grayscale(.55) brightness(.9);opacity:.75;cursor:default;box-shadow:none;}
.mm-go svg{stroke:#fff;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;}
.mm-go::after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.45),transparent);transform:skewX(-18deg);animation:mm-sheen 4.5s ease-in-out infinite;}
.mm-go:disabled::after{display:none;}
/* sent: the button itself says so — calm, not greyed out like something that cannot be done */
.mm-go.is-sent:disabled{filter:none;opacity:1;background:#E4F4EA;color:#0A5E37;box-shadow:inset 0 0 0 1.5px #B9E0C8;}
.mm-go.is-sent svg{stroke:#0A5E37;}
@keyframes mm-sheen{0%,58%{left:-60%}80%,100%{left:130%}}
.mm-eta{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:12px;font-size:13px;font-weight:700;color:var(--ink2,#4A554E);}
.mm-eta b{color:var(--ink,#14201A);}
.mm-note{text-align:center;font-size:12.5px;color:var(--ink2,#4A554E);margin-top:8px;}
.mm-note-req{display:flex;align-items:center;justify-content:center;gap:7px;text-align:center;font-size:12.5px;font-weight:700;color:var(--green-d,#0A5E37);background:rgba(12,122,70,.07);border:1px solid #CDE8D9;border-radius:11px;padding:10px 13px;margin-top:0;}
.mm-note-req svg{stroke:var(--green,#0C7A46);stroke-width:2;fill:none;flex:none;}
@media (prefers-reduced-motion:reduce){.mm-go::after{animation:none;}.mm-card{transition:none;}}

/* ───────── THE ROWS — each shelf is ONE row of its posters, swiped sideways ─────────
   The owner, 2026-11-24, looking at the posters on his phone: "the film section needs sideways scroll for
   options instead of that layout". A shelf was a two-column grid of tall cards — the Films shelf alone was
   two screens of scrolling down. Now a shelf is one row, and the rules above it are left as they were (the
   grid element itself becomes the scroller here; nothing in the markup changed):
     · a phone shows 2.3 posters, a tablet 3.3 — the next one PEEKS past the right edge of the screen, which
       is what says there are more. The shelf's tray runs off that edge with its row; the page itself never
       scrolls sideways, because the tray ends exactly where the page's own gutter does (--fs-gut is the
       shell's .wb-main padding, width for width — a test holds the two together);
     · from 980px four stand across, as before; a fifth would scroll (the row is only un-clipped while it fits);
       (2026-11-25: …and a fifth is there now on two shelves — nine Stories, eleven Films, the genres made movie
       categories — and four whole posters with nothing after them said the row ENDED: five of the Stories and
       seven of the Films were invisible on a laptop. So from 980px a shelf shows four and THREE TENTHS, the
       fifth peeking in at the card's edge as the third does on a phone, and a mouse gets two arrows of its
       own — FS_SHELF_GO, below the page's sheet;)
     · it is the same list of buttons in the same order: Tab reaches every poster and brings it into view;
     · a tapped poster still pops where it stands and the others fall away (enterFormat) — the row keeps
       28px of its own air above and 24 below so the pop is not cut, and a poster that was only PEEKING is
       brought inside the row first (sticky: it cannot fly while it is half off the screen);
     · the line under a name gets a third line on a phone (the card is 15px narrower than it was, and that
       line must never lose its end), and every card keeps the same height. */
.fs-wrap{--fs-gut:0px;}
@media(max-width:979px){.fs-wrap{--fs-gut:clamp(18px,3vw,56px);}}
@media(max-width:760px){.fs-wrap{--fs-gut:16px;}}
.fs-shelves{grid-template-columns:minmax(0,1fr);}
.fs-shelf{--tp:14px;--ps:14px;--pe:14px;--gap:12px;--pw:calc((100% + var(--pe) - 4 * var(--gap)) / 4.3);min-width:0;padding-bottom:0;}
@media(max-width:979px){
  .fs-shelf{--pe:16px;--pw:calc((100% + var(--pe) - 3 * var(--gap)) / 3.3);margin-inline-end:calc(var(--fs-gut) * -1);border-inline-end-width:0;border-start-end-radius:0;border-end-end-radius:0;}
}
/* (the heading keeps its place — its tag stands where the page's gutter is, not against the glass: its box is
   said once, in THE TICKET below, where it becomes the ticket's stub) */
/* (never wider than 190px: on a wide phone a taller card's pop would not fit the air the row keeps for it) */
@media(max-width:639px){.fs-shelf{--pw:min(calc((100% + var(--pe) - 2 * var(--gap)) / 2.3),190px);}}
@media(max-width:420px){.fs-shelf{--tp:10px;}}
.fs-shelf .fs-fmtgrid{display:flex;align-items:flex-start;gap:var(--gap);margin-block:-28px 0;margin-inline:calc(var(--tp) * -1);padding-block:28px 24px;padding-inline:var(--ps) var(--pe);overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-padding-inline:var(--ps) var(--pe);overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
.fs-shelf .fs-fmtgrid::-webkit-scrollbar{display:none;}
/* (a mouse cannot swipe: where there is one, the row shows a thin bar of its own when it has more to show.
   The bar has NO TRACK: a track is a square, the row runs to the card's round corner, and left as a browser
   draws it a white corner stands out past the card's — PHOTOGRAPHED, on the dark page and on the cream. Its
   thumb is the shell's deep gold, the gold of the hairline printed inside the card: 3:1 on the cream.) */
@media(hover:hover) and (pointer:fine){.fs-shelf .fs-fmtgrid{scrollbar-width:thin;scrollbar-color:#B08526 transparent;}}
.fs-shelf .fs-fmtgrid .fs-fmt{flex:0 0 var(--pw);min-width:0;}
.fs-shelf .fs-fmt-label b{overflow-wrap:anywhere;}
.fs-shelf .fs-fmt-sub{min-height:calc(1.34em * 2 + 21px);}
@media(min-width:640px){.fs-shelf .fs-fmt-sub{min-height:calc(1.34em * 2 + 25px);}}
@media(max-width:639px){.fs-shelf .fs-fmt-sub{-webkit-line-clamp:3;min-height:calc(1.34em * 3 + 21px);}}
.fs-shelf .fs-fmtgrid.throw .fs-fmt.zoom{position:sticky;left:var(--ps);right:var(--ps);}
@media(min-width:980px){.fs-shelf .fs-fmtgrid:not(:has(> .fs-fmt:nth-child(5))){overflow:visible;}}
/* THE ROW'S END. A small gold rosette stood here, turning — a finial — and it is gone (the owner, 2026-11-24:
   "Those little rosettes on the cards appear slightly out of place"). The room it took is kept, and nothing
   is drawn in it: below 980px it is still an item of the row after its last poster — the row's end margin (a
   browser may drop a scroller's own end padding) — and, scrolled to its end, a row now opens onto the
   card's own engraving (THE TICKET, below). From 980px a row runs on too (2026-11-25), inside a card framed on
   all four sides: its end is one gap and the row's own end padding — a pixel-wide item, so that a browser that
   drops a scroller's end padding still leaves the last poster off the card's edge. */
.fs-shelf .fs-fmtgrid::after{flex:0 0 auto;align-self:center;width:calc(var(--pw) * .86);height:1px;margin-inline:6px 14px;pointer-events:none;}
@media(max-width:979px){.fs-shelf .fs-fmtgrid::after{content:"";}}
@media(min-width:640px){.fs-shelf .fs-fmtgrid::after{width:calc(var(--pw) * .62);}}
@media(min-width:980px){.fs-shelf .fs-fmtgrid::after{content:"";width:1px;margin-inline:0;}}
/* (the Next-episode row is the same kind of row: it runs to the same edge) */
.fs-eps-row{margin-inline-end:calc(var(--fs-gut) * -1);padding-inline-end:16px;scroll-padding-inline-end:16px;}

/* ───────── THE GOLD — the app's rosette, slow and faint, in BOTH themes ─────────
   The owner, 2026-11-24: "I think we still need some gold spinners in there for asthetic". The rosette is
   the app's own spinner (the shell turns two great ones behind every page; the Presenters' hero has one in
   its corner; the Ad Maker's, the Auto-post's and the Archive's have one under their words).
   THIS PAGE HAS ONE IN GOLD: THE HERO'S — AND IT IS THE AD MAKER'S (the owner, 2026-11-24, with the two
   heroes side by side on his phone: "Movie maker hero rosette needs to match the ad hero rosette"). The same
   one, to the number: off the hero's bottom near corner (130px out, 170px down), 350px, at 30%, blended
   as light ("screen"), turning the other way round once in 115 seconds — routes/web.studio.tsx,
   .ws-cinehead-rose.b; a test holds the two together. It is INSIDE the hero: the hero is its own layer and
   cuts it at its own rounded edge, so nothing of a rosette crosses that edge. And it is SEEN: it lies over
   the shade the words stand on and under the words — fine light lines across the words' side of the band,
   as on the Ad Maker's (the words still read where a line passes under them: the hero's test has the sum).
   Read right to left the words' side is the right one, and the rosette goes with them.
   (What it replaces: on a phone only, a gold rosette in the hero's FAR bottom corner, over the clip — the
   corner the shell's own great rosette turns behind, so the two read as one rosette hanging out of the
   card. A format's banner had one in its top far corner that read the same way; a banner is all picture,
   with no panel for one to be engraved on, so it has none now. And there was a small one where every row
   of posters ends, a finial: "Those little rosettes on the cards appear slightly out of place". A shelf
   has the rosette ENGRAVED in its paper instead, in its own colour — THE TICKET, below — and the row's
   end is empty: THE ROWS.)
   It is a picture only (no tap, no name), and stands still for anyone who asks for less motion. */
.fs-head{isolation:isolate;}
.fs-head::after{content:"";position:absolute;z-index:2;left:-130px;bottom:-170px;width:350px;height:350px;background:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.3;mix-blend-mode:screen;pointer-events:none;will-change:transform;animation:fsspinB 115s linear infinite;}
[dir=rtl] .fs-head::after{left:auto;right:-130px;}
@media(prefers-reduced-motion:reduce){
  .fs-head::after{animation:none;}
  .fs-hero-blur{animation:none;}
}

/* ───────── THE TICKET — a shelf is a ticket: engraved, perforated, edged (BOTH themes) ─────────
   The owner, 2026-11-24, of the small rosette that stood at the end of each row: "Those little rosettes on
   the cards appear slightly out of place, can we do some texture on the cards similar to the login one to
   make it FUCKING POP". The login one is the "Admit one" ticket (components/AuthLobby.tsx): cream paper with
   the rosette engraved in it as a watermark, a dashed perforation between two half-round notches, a gold
   edge. A shelf is a cream card in both themes, so in both it is that kind of ticket:
     1 · THE ENGRAVING. The rosette is IN the paper: one, larger than the card is tall (140% of its height;
         160% on a wide screen, where a card is four posters long), its hub AT the card's top far corner
         and the rest bleeding off that corner — a fan of its long loops across the heading and down behind
         the posters, in the shelf's own colour (storybook gold-brown · the stage's green · the music
         video's violet) at the strength of an engraving, 18% (the ticket's is 16%, and smaller). It is seen
         across the heading, between the posters, in a place a shelf has to spare, and where a row ends (the
         finial's old room is a window onto it). Where there is a mouse it turns, once in four minutes (and
         stands still for anyone who asks for less motion); on a phone it stands still — the reason is with
         its rule. It is drawn in a layer of its own (.fs-shelf-wm) that covers the card
         and cuts ITSELF to the card's shape: the card clips nothing, so its row still runs off the screen
         and a tapped poster still pops across its edge. That layer also carries the STUB's wash — the
         shelf's own tint, whole at the card's top and gone by 60px, as the ticket's stub is tinted.
         (TRIED AND NOT KEPT: a second, smaller rosette off the opposite corner. It lies under the first
         poster — an arc in the card's foot is all of it that shows — and the hub behind the shelf's tag
         instead of at the corner, which made a white disc of the rosette's eye: an object again.)
     2 · THE PERFORATION. The heading is the ticket's stub: a dashed line under it from edge to edge, and a
         half-round notch at each end of that line where the card has an end (below 980px it runs off the
         screen: one notch). A notch is filled with the page's own colour and carries the card's edge round.
     3 · THE HAIRLINE. A fine gold line just inside the card's edge, the way a ticket is printed.
     4 · THE STOCK. The card has a THICKNESS and stands off the page, and what is on it is pressed into it or
         lies on it: see "3D" and THE PRINTS below.
   Nothing here is a control or says a word. The heading's words stand on the cream as they did: where a
   line of the engraving passes under a letter, the ground there is at most a quarter the shelf's colour
   (the wash and the line together) — which leaves a shelf's name 11.5:1 or better (it was 16.5) and the
   line under it 4.7:1 or better (it was 6.4); a test holds the sums. And the tag's plate is solid cream
   under its tint, so no line of the engraving runs behind its letters at all. */
/* 3D ("Hero cards still need textured. 3d style" — the owner, the same evening; and LIGHT is the default, so
   it is judged on cream first, where a cream card has no colour to stand off with: its depth is all edge and
   shadow). A card is a piece of STOCK with a thickness, as the sign-in ticket is: a lit top edge and a
   shaded foot inside it, three steps of darker cream under it (its side, seen from a little above), a tight
   contact shadow and a long soft one. --tk-side is the card's own; --tk-drop is the shadow it casts, which
   the dark page says again in black. All of it is cast only while the shelves stand. */
.fs-shelf{isolation:isolate;--rr:17px;--tk-side:inset 0 1px 0 #fff,inset 0 -1px 0 rgba(126,94,19,.16),0 1px 0 #EDE6D2,0 2px 0 #E1D9C1,0 3px 0 #D3CAB0;--tk-drop:0 4px 5px rgba(20,32,26,.2),0 16px 26px -16px rgba(20,32,26,.3),0 38px 56px -38px rgba(20,32,26,.42);}
@media(max-width:420px){.fs-shelf{--rr:13px;}}
.fs-shelves:not(.throw) .fs-shelf{box-shadow:var(--tk-side),var(--tk-drop);}
[dir=rtl] .fs-shelf::before{left:auto;right:0;border-radius:4px 0 0 4px;}
.fs-shelf-wm{position:absolute;inset:0;z-index:-1;border-radius:inherit;overflow:hidden;pointer-events:none;background:linear-gradient(180deg,var(--shelf-soft),rgba(255,255,255,0) 60px);transition:opacity .3s ease;}
@keyframes fsWmTurn{from{transform:translate(var(--wx),-50%) rotate(0deg)}to{transform:translate(var(--wx),-50%) rotate(360deg)}}
/* (drawn THROUGH the rosette — a mask — so it takes the shelf's colour; where a browser cannot mask, nothing is
   drawn. PRESSED INTO the stock, not printed on it: the line in the shelf's colour, and the same line again in
   white a pixel down and along — the far lip of a groove, catching the light. It turns only where there is a
   mouse: on a phone two such layers a card, each larger than the card, would be composited on every frame of
   a scroll; standing still they are painted once, with the paper.) */
@supports ((-webkit-mask-image:none) or (mask-image:none)){
  .fs-shelf-wm::before,.fs-shelf-wm::after{content:"";position:absolute;--wx:50%;top:0;right:0;height:140%;aspect-ratio:1;transform:translate(var(--wx),-50%);-webkit-mask:url(/gstyle-rosette.svg) center/contain no-repeat;mask:url(/gstyle-rosette.svg) center/contain no-repeat;}
  .fs-shelf-wm::before{background:var(--shelf);opacity:.18;}
  .fs-shelf-wm::after{z-index:-1;margin:1px -1px 0 0;background:#fff;opacity:.9;}
  [dir=rtl] .fs-shelf-wm::before,[dir=rtl] .fs-shelf-wm::after{--wx:-50%;right:auto;left:0;}
  [dir=rtl] .fs-shelf-wm::after{margin:1px 0 0 1px;}
  @media(min-width:980px){.fs-shelf-wm::before,.fs-shelf-wm::after{height:160%;}}
  @media(hover:hover) and (pointer:fine){.fs-shelf-wm::before,.fs-shelf-wm::after{animation:fsWmTurn 240s linear infinite;}}
}
/* (the stub: the heading's own box runs from the card's one edge to the other — its words keep their place,
   the tag where the page's gutter is — and the perforation is its foot: cut INTO the stock, a line of light
   under the row of holes; and a notch is a bite out of the card, shaded inside its upper lip) */
.fs-shelf-h{position:relative;margin-block:0 12px;margin-inline:calc(var(--tp) * -1);padding-block:0 11px;padding-inline:calc(var(--tp) + 6px) calc(var(--tp) + 2px + var(--fs-gut));border-bottom:2px dashed rgba(107,79,14,.42);box-shadow:0 1px 0 rgba(255,255,255,.95);}
.fs-shelf-h::before,.fs-shelf-h::after{content:"";position:absolute;bottom:-8px;width:10px;height:18px;box-sizing:border-box;background:var(--paper,#F4F1E6);border:1px solid var(--line,#E4DFCF);box-shadow:inset 0 2px 2px -1px rgba(20,32,26,.3);pointer-events:none;}
.fs-shelf-h::before{inset-inline-start:-1px;border-inline-start:0;border-start-end-radius:9px;border-end-end-radius:9px;}
.fs-shelf-h::after{inset-inline-end:-1px;border-inline-end:0;border-start-start-radius:9px;border-end-start-radius:9px;}
@media(max-width:979px){.fs-shelf-h::after{content:none;}}
.fs-shelf-tag{background:linear-gradient(var(--shelf-soft),var(--shelf-soft)),#FFFEFA;}
.fs-shelf::after{content:"";position:absolute;z-index:-1;inset:5px;border:1px solid rgba(176,133,38,.38);border-radius:var(--rr);pointer-events:none;transition:opacity .3s ease;}
@media(max-width:979px){.fs-shelf::after{inset-inline-end:0;border-inline-end:0;border-start-end-radius:0;border-end-end-radius:0;}}
/* (a ticket falls away with its shelf — the page's own rule takes the card, its bar and its stub) */
.fs-shelves.throw .fs-shelf::after,.fs-shelves.throw .fs-shelf-wm{opacity:0;}
/* THE PRINTS. A poster in a shelf is a physical print lying on the card: the same two steps of stock under it
   and a deeper shadow; over its picture a thin lit bevel (light along its top and near side, shade along its
   foot) and a sheen falling across its upper corner; and it LIFTS a little under a pointer or a finger —
   moved and re-shadowed only, so nothing beside it shifts. No blur, no filter: a row of them still scrolls as
   one painted strip. (The poster that flies when a format is entered keeps its own, stronger rules.) */
.fs-shelf .fs-fmt{box-shadow:0 1px 0 #EDE7D6,0 2px 0 #DDD6C0,0 3px 4px rgba(20,32,26,.2),0 12px 18px -12px rgba(20,32,26,.36);}
.fs-shelf .fs-fmt::after{content:"";position:absolute;inset:0;z-index:3;border-radius:inherit;pointer-events:none;background:linear-gradient(118deg,rgba(255,255,255,.2),rgba(255,255,255,.05) 24%,rgba(255,255,255,0) 42%);box-shadow:inset 0 1px 0 rgba(255,255,255,.6),inset 1px 0 0 rgba(255,255,255,.22),inset 0 -1px 0 rgba(20,32,26,.16);}
@media(hover:hover){.fs-shelf .fs-fmt:hover{transform:translateY(-4px);box-shadow:0 1px 0 #EDE7D6,0 2px 0 #DDD6C0,0 7px 9px -2px rgba(20,32,26,.22),0 18px 22px -14px rgba(20,32,26,.44);}}
.fs-shelf .fs-fmt:active{transform:translateY(-2px);box-shadow:0 1px 0 #EDE7D6,0 2px 0 #DDD6C0,0 5px 7px -2px rgba(20,32,26,.22),0 15px 20px -13px rgba(20,32,26,.4);}
@media(prefers-reduced-motion:reduce){
  .fs-shelf-wm::before,.fs-shelf-wm::after{animation:none;}
  .fs-shelf-wm,.fs-shelf::after{transition:none;}
  .fs-shelf .fs-fmt,.fs-shelf .fs-fmt:hover,.fs-shelf .fs-fmt:active{transition:none;transform:none;}
}
`;

/* A WIDE SCREEN'S ARROWS — a shelf that runs on past its fourth poster, said to a mouse (2026-11-25).
 *
 * The genres became movie categories (the owner: "Our genres need to be movie categories (drama, horror,
 * comedy, etch)") and two shelves now hold nine and eleven posters. A phone swipes and a trackpad slides, but a
 * mouse wheel scrolls the PAGE: a laptop with a mouse had the thin gold bar alone to reach the Fantasy Film.
 * So where there is a mouse and room for four, a shelf that runs on has a round arrow at each end, over its
 * pictures' middle: one click moves it four posters. An arrow is there only while the row can go that way.
 *
 * They are for the mouse only, and add nothing anyone else must step through: hidden from a screen reader and
 * out of the Tab order (Tab already walks every poster, and the browser brings each into view), absent on a
 * touch screen and below 980px. The page tells them where the pictures' middle is (--go-y) and which way a
 * row can still go (data-moved, data-end) — FilmStudio's "A WIDE SCREEN'S ARROWS" effect. They sit on the
 * cream card in both themes, so they are cream in both. A click is the only thing that moves a row: never by
 * itself, and with no glide for anyone who asks for less motion. */
const FS_SHELF_GO = `
.fs-shelf-arrow{display:none;}
@media(min-width:980px) and (hover:hover) and (pointer:fine){
  .fs-shelf-arrow{display:grid;place-items:center;position:absolute;z-index:5;top:var(--go-y,50%);width:46px;height:46px;margin-top:-23px;border-radius:50%;cursor:pointer;color:#14201A;background:#FFFEFA;border:1px solid rgba(176,133,38,.55);box-shadow:0 1px 0 #fff inset,0 6px 16px -6px rgba(20,32,26,.45),0 2px 4px rgba(20,32,26,.18);transition:opacity .2s ease,transform .2s ease,background .2s ease;}
  .fs-shelf-arrow svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;}
  .fs-shelf-arrow.is-back{inset-inline-start:2px;}
  .fs-shelf-arrow.is-on{inset-inline-end:2px;}
  [dir=rtl] .fs-shelf-arrow svg{transform:scaleX(-1);}
  .fs-shelf-arrow:hover{background:#fff;transform:scale(1.07);}
  .fs-shelf-arrow:active{transform:scale(.96);}
  .fs-shelf:not([data-moved]) .fs-shelf-arrow.is-back,.fs-shelf[data-end] .fs-shelf-arrow.is-on,.fs-shelves.throw .fs-shelf-arrow{opacity:0;pointer-events:none;}
}
@media(prefers-reduced-motion:reduce){.fs-shelf-arrow,.fs-shelf-arrow:hover,.fs-shelf-arrow:active{transition:none;transform:none;}}
`;

/* THE THEATER — the Movie Maker as a dark movie theater.
 *
 * The sign-in screens became a cinema's lobby (components/AuthLobby.tsx), and the owner, 2026-11-24:
 *   "I'm really fond of that dark style screen"
 *   "the Admit one light cream card over the dark is extremely attractive bro"
 *   "i typed money theater but really meant to say movie theater - but we can extend it to the film section
 *    and if we like it we move futher. I think we still need some gold spinners in there for asthetic"
 * So the lobby's dark comes inside — to THIS section and no other (not the cast page, not the Archive).
 * Then, the same day: "dark mode toggle in setting but keeep it light" — then, once he had seen the two
 * lights side by side: "Make dark default" — and then, that evening: "Light mode as the default - dark mode
 * as option". So LIGHT IS THE DEFAULT and the dark is a member's choice (lib/theme.ts), and this is the
 * Movie Maker's DARK theme, the option: FilmStudio mounts this stylesheet
 * — and puts .fs-theater on its root — only when useTheme() says "dark". In the light theme the page is the
 * cream page it was; what both themes share (the posters in rows, the page's own gold rosettes) is in the
 * page's stylesheet, FS_STYLE.
 *
 * What he loves is LIGHT CREAM CARDS OVER THE DARK, so nothing a member works in is repainted: the idea box,
 * the step cards and their pickers, the storyboard's scene cards and drawers, the cast stage, Generate, every
 * dialog — each is the cream card it was, with its own ink. This stylesheet paints what is BETWEEN and AROUND
 * them:
 *
 *   THE ROOM     the shell's page and header go dark — a DEEP GREEN, not the first lobby's brown ("maybe we
 *                do a dark green background instead of the brown"): near-black green, a lighter green
 *                where the light falls, the lobby's gold #E7C879 — and a phone's tab bar with them.
 *                (These rules are the SHELL's, so they live where a second dark page can share them:
 *                lib/theater-shell.ts, THEATER_SHELL_CSS — mounted with this sheet, ahead of it.)
 *   THE SCREEN   the hero and a format's banner get a thin gold edge
 *   THE SHELVES  each shelf is the LIGHT theme's own cream card — a ticket: engraved, perforated, see THE
 *                TICKET in the page's stylesheet — laid on the dark the way the sign-in ticket is: a gold
 *                hairline edge, a deep doubled shadow, its notches showing the dark page, and nothing in it
 *                repainted. They were deep green "poster cases" first; he looked and said: "these cards
 *                even in dark should take on the lighter theme overlay like login right? To make it flow".
 *   THE TICKETS  "Next episode" cards are cream tickets with a perforation, under a sign-painted heading
 *   THE GOLD     the shell's own two great rosettes, behind the page, in the gold cut (as in the lobby);
 *                the page's own rosettes and engravings are in both themes, and are not touched here
 *
 * SCOPE. Every rule in THIS sheet starts with .fs-theater (the class this route's root carries in the dark
 * theme only), so it can style nothing else even if it were left on the page. The shell's rules (html,
 * body, .wb …) have no such anchor — they work the way the lobby's do: lib/theater-shell.ts is mounted by
 * this route's component, with this sheet, only in the dark theme, and unmounted with it; web.tsx knows
 * nothing of either. tests/film-theater.test.ts holds all of that.
 *
 * Nothing here changes what a control does, adds a word, or asks for a file other than the rosette. */
const FS_THEATER = `
/* (THE ROOM — the shell's page, its header and a phone's tab bar gone dark — is lib/theater-shell.ts, mounted
   ahead of this sheet in the same <style>. Every rule below is the PAGE's, and starts with .fs-theater.) */

/* ---- THE SCREEN: the hero, and a format's own banner — a thin gold edge. (The hero is the page's own deep
   green band, and the shade its words stand on is the page's own: neither is repainted.) ---- */
.fs-theater .fs-head{box-shadow:0 0 0 1px rgba(231,200,121,.45),0 0 0 6px rgba(231,200,121,.07),0 34px 64px -34px #000,0 0 110px -34px rgba(231,200,121,.3);}
.fs-theater .fs-head-copy b em{color:#E7C879;}
.fs-theater .fs-head-tag{border-color:rgba(231,200,121,.5);}
.fs-theater .fs-head-tag:hover{border-color:#E7C879;}
/* (on a phone that tag is 28 tall: 44 to the finger) */
@media(max-width:640px){.fs-theater .fs-head-tag::after{content:"";position:absolute;inset:-8px -4px;}}
.fs-theater .fs-hero{box-shadow:0 0 0 1px rgba(231,200,121,.45),0 24px 44px -28px #000;}
.fs-theater .fs-hero-back{border-color:rgba(231,200,121,.45);}

/* (the page's own rosettes — the one inside the hero, and the one ENGRAVED in every shelf — are in BOTH
   themes: see THE GOLD and THE TICKET in the page's stylesheet. Nothing of them is changed here.) */

/* ---- THE TICKETS: a kept music video, and Next episode ---- */
.fs-theater .mm-kept{box-shadow:0 0 0 1px rgba(231,200,121,.5);}
.fs-theater .fs-eps-h{color:#E7C879;font-size:12px;letter-spacing:.24em;text-transform:uppercase;text-shadow:0 0 14px rgba(231,200,121,.5);}
[dir=rtl] .fs-theater .fs-eps-h{letter-spacing:0;font-size:13.5px;}
.fs-theater .fs-ep-card{border-color:rgba(231,200,121,.7);background:linear-gradient(176deg,#FFFDF7,#F7F0DE);}
.fs-theater .fs-ep-card:hover{border-color:#E7C879;}
/* (the perforation between a ticket's picture and its words) */
.fs-theater .fs-ep-txt{align-self:stretch;justify-content:center;padding-inline-start:10px;border-inline-start:2px dashed rgba(107,79,14,.42);}

/* ---- THE SHELVES: light cards on the dark page, as the sign-in ticket is ----
   They were deep green "poster cases" at first, and the owner, 2026-11-24, with the Films shelf beside the
   sign-in ticket: "Now buddy, these cards even in dark should take on the lighter theme overlay like login
   right? To make it flow". So a shelf here IS the light theme's shelf card, and nothing of it is repainted:
   its cream ground, its ink title and grey line, its coloured bar and tag, its poster cards — and what makes
   it a ticket (THE TICKET, in the page's stylesheet): its engraving, its perforation, its printed hairline.
   It only gets what a cream card needs to sit on a dark page, the way the sign-in ticket has it — a gold
   hairline for an edge (the card's own 1px border in the lobby's gold, the dark showing under it rather than
   the cream) and a deep, doubled shadow.
   The edge is said by a rule of TWO classes, so the page's own rule for a shelf falling away (three) still
   takes it. The shadow is only NAMED here (--tk-drop: a contact shadow, a near one and the ticket's long one,
   in black): the page's own rule casts it, with the card's own thickness, and only while the shelves stand —
   so nothing of a card is left as a poster flies. */
.fs-theater .fs-shelf{border-color:rgba(231,200,121,.6);background-clip:padding-box;--tk-drop:0 4px 6px rgba(0,0,0,.5),0 14px 26px -16px rgba(0,0,0,.55),0 34px 60px -30px #000;}
/* (a notch is a bite out of the card: THIS page's dark fills it, and the card's gold edge goes round it) */
.fs-theater .fs-shelf-h::before,.fs-theater .fs-shelf-h::after{background:#0A1C13;border-color:rgba(231,200,121,.6);}
/* (the poster that flies when a format is entered crosses the dark page: a ring of gold — its own shadow is dark on dark) */
.fs-theater .fs-fmtgrid.throw .fs-fmt.zoom{box-shadow:0 0 0 2px #E7C879,0 24px 40px -20px #000;}

/* ---- THE WORKBENCH: the cream cards are kept; what stands between them reads on the dark ---- */
.fs-theater .mm-hint{color:#D8CFBA;}
/* (the two big sheets get the ticket's gold edge; nothing inside them is touched) */
.fs-theater .mm-topic,.fs-theater .fs-card:not(.fs-go-card){box-shadow:0 0 0 1px rgba(231,200,121,.5),0 22px 40px -28px #000;}
/* the Music Video lays three things straight on the page: the song's title, an error, the storyboard's note */
.fs-theater .mm > .mm-preview .fs-treat{border-top-color:rgba(231,200,121,.3);}
.fs-theater .mm > .mm-preview .fs-treat-ttl{color:#FFFDF7;}
.fs-theater .mm > .mm-preview .fs-treat-mood{color:#D8CFBA;}
.fs-theater .mm > .fs-err{color:#FFB4A6;}
.fs-theater .mm > .mm-storyboard > .mm-sb-head{color:#D8CFBA;}

/* ---- a ring that is seen on the dark (a poster stands on its shelf's cream card: it keeps the shell's green ring) ---- */
.fs-theater .fs-ep-card:focus-visible,.fs-theater .fs-head-tag:focus-visible,.fs-theater .fs-hero-back:focus-visible{outline:2px solid #E7C879;outline-offset:2px;}
/* (less motion: this sheet moves nothing. The room's two rosettes are stopped by the shell and again by
   lib/theater-shell.ts; the page's own rosettes and engravings by the page's stylesheet.) */
`;
