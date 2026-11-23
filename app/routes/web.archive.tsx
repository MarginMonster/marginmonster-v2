/* Web Archive — finished pieces for web accounts. Media serves from the same
 * /renders route the embedded app uses. Full parity with the embedded Archive:
 * fullscreen viewer, Keep + 30-day expiry countdown, delete, remix, blog
 * read/export, caption preview before posting, downloads, wallet readout. */

import { HeroVideo } from "../components/HeroVideo";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useFetcher, useLoaderData, useNavigate, useNavigation, useRevalidator, useSearchParams, useSubmit } from "@remix-run/react";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import { AD_SIZES, AD_SIZE_KEYS, isAdSize, type AdSize } from "../lib/ad-sizes";
import { isPostable, takes } from "../lib/social-networks";

// The ad pack (a size, the captions file, the ad copy) changes nothing in the library, so it must not
// reload the whole shelf (hundreds of pieces) every time a part of it lands.
const AD_PACK_INTENTS = new Set(["adsize", "adsrt", "adcopy", "share", "unshare"]);
export const shouldRevalidate: ShouldRevalidateFunction = ({ formData, defaultShouldRevalidate }) =>
  AD_PACK_INTENTS.has(String(formData?.get("intent") || "")) ? false : defaultShouldRevalidate;
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ico } from "../lib/icons";
// (2026-11-22) a photo edit the model did not make: said in the viewer, as on the Studio's Stage
import { editNote } from "../lib/edit-check";
import { useT } from "../lib/ui-lang";
import { readUiLang, tr } from "../lib/ui-i18n";
import { requireWebIdentity } from "../lib/web-auth.server";
import { isExpiringUrl } from "../lib/image-generation.server";
import { db } from "../db.server";
import { ensureProfile, linkedFromCache, publishPost, refreshLinkedPlatforms, socialProviderEnabled } from "../lib/social-provider.server";
import { spendTokens, tokensRemainingLive } from "../lib/tokens.server";
import { TOKEN_COST, CREATOR_SURCHARGE_MULT, creatorVideoTokens } from "../lib/plan-config";
import { facelessQualitySurcharge } from "../lib/create-models";
import { engineSurcharge, normalizeEngineKey } from "../lib/video-engines";
import { xpForSpend } from "../lib/achievements";
import { AVATAR_BY_ID } from "../lib/avatars";

/** The CURRENT price to retry a failed job, derived from its payload — not the
 *  amount originally charged. A job that failed before a reprice (e.g. faceless
 *  at the old 80 tokens, now 30) must retry at today's price, never the stale
 *  one. Callers clamp with Math.min(stored, current) so a retry is never more
 *  than either the original charge or the current price. */
function currentRetryCost(type: string, pl: Record<string, unknown>): number {
  if (type === "GENERATE_VIDEO_AD") {
    if (pl.contentType === "faceless") return TOKEN_COST.faceless + facelessQualitySurcharge(pl.facelessQuality as string);
    const eng = engineSurcharge(normalizeEngineKey(pl.videoEngine as string));
    // A Creator video is priced by its length on the default engine, and a premium engine's surcharge
    // is scaled on the Creator floor — the same sum the Studio charges (plan-config.ts). Retrying a
    // 15-second clip at the 5-second price would be a loss on every retry.
    if (pl.section === "creator") return creatorVideoTokens(eng ? 5 : pl.videoDurationSec) + eng * CREATOR_SURCHARGE_MULT;
    return TOKEN_COST.video + eng;
  }
  // A COMBINE frame is a GENERATE_IMAGE_AD but runs the pricey nano-banana-pro
  // compose (presenterOnly), so it reprices at the combine rate, not the cheap
  // shared image rate — a retry must not undercharge for it.
  if (type === "GENERATE_IMAGE_AD") return pl.presenterOnly === true ? TOKEN_COST.combine : TOKEN_COST.image;
  if (type === "GENERATE_SONG") return TOKEN_COST.music;
  if (type === "GENERATE_BLOG_POST") return TOKEN_COST.blog;
  return TOKEN_COST.image;
}
import { assertCapability, videoCapabilityFor, videoCapabilityForSection } from "../lib/capabilities.server";
import { enqueueJob } from "../lib/job-queue.server";
import { AI_DISCLOSURE_TAG, buildPostTitle, fallbackCaption, getOrMakeCaptions, trialCredit } from "../lib/social-caption.server";
import { catalogImageFor, productLinkFor } from "../lib/catalog-import.server";
import { externalOrigin } from "../lib/origin.server";
// (2026-11-22) the "Today" of the When filter starts at midnight where the shop is
import { isValidTimeZone, zonedDateString, zonedInstant } from "../lib/timezone";
import { storyHeroOf } from "../lib/film-series";
// (2026-11-22) Collections — named shelves a piece can sit on; every query is in collections.server.ts
import { addToCollection, collectionIdsByAsset, createCollection, deleteCollection, listCollections, removeFromCollection, renameCollection, type ColProblem } from "../lib/collections.server";

// Merchants keep several of these open at once; an untitled tab is just a URL.
export const meta = ({ matches }: { matches: Array<{ id: string; data: unknown }> }) => {
  const uiLang = (matches.find((m) => m.id === "root")?.data as { uiLang?: string } | null)?.uiLang;
  return [{ title: tr((uiLang || "en") as Parameters<typeof tr>[0], "Archive") + " · EasyMode" }];
};

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Human name for the recipe behind an asset — the ad format, backdrop
 *  template, cartoon style or video style it was built with. metaJson carries
 *  the picked keys; bodyJson's `method` records what the pipeline ACTUALLY
 *  used after any fallback, which is the honest answer. */
/** The format the merchant picked, when the render didn't manage to deliver it.
 *
 *  A silent fallback is worse than a visible one: the merchant spent tokens on
 *  a Versus ad, got a scene ad, and had no way to tell whether the pick was
 *  ignored or the layout just didn't land. Surfacing it also makes Remix the
 *  obvious next move. */
function pickedButMissed(metaJson: string | null, bodyJson: string | null): string | null {
  let meta: Record<string, unknown> = {};
  let body: Record<string, unknown> = {};
  try { meta = JSON.parse(metaJson || "{}"); } catch { /* ignore */ }
  try { body = JSON.parse(bodyJson || "{}"); } catch { /* ignore */ }
  if (typeof body.formatFallback !== "string" || !body.formatFallback) return null;
  const key = typeof meta.formatKey === "string" ? meta.formatKey : "";
  if (!key) return null;
  return key.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The kinds every Movie Maker pipeline writes on its finished film. */
const FILM_KINDS = new Set(["testmovie", "narrated", "musicvideo", "film", "avatardialogue", "enginetest"]);

/** A Creator video: a scene the member described, animated — not a product ad. The pipeline stamps
 *  `creative` on it; one made before 2026-11-23 is known by the brief every such video was built from. */
function creativeVideo(meta: Record<string, unknown>, body: Record<string, unknown>): boolean {
  return meta.creative === true || (meta.style === "PRODUCT_HIGHLIGHT" && typeof body.prompt === "string" && body.prompt.startsWith("Cinematic short video."));
}

function recipeLabel(metaJson: string | null, bodyJson: string | null): string | null {
  let meta: Record<string, unknown> = {};
  let body: Record<string, unknown> = {};
  try { meta = JSON.parse(metaJson || "{}"); } catch { /* ignore */ }
  try { body = JSON.parse(bodyJson || "{}"); } catch { /* ignore */ }
  const pretty = (k: string) => k.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  // A described Creator video is not a "Product Highlight" (the pipeline's name for its style): say what it
  // is, how long, and whether it carries sound — asked of the finished file, so a silent fallback says so.
  if (creativeVideo(meta, body)) {
    const sec = typeof meta.seconds === "number" && meta.seconds > 0 ? ` · ${meta.seconds}s` : "";
    // …and the engine that really rendered it (the film labels name theirs too), so a fallback is visible
    const e = typeof meta.engine === "string" ? meta.engine : "";
    const eng = /kling-video\/o3\//.test(e) ? " · Kling 3 Omni" : /kling-video\/v3\//.test(e) ? " · Kling 3 Pro" : /veo/.test(e) ? " · Veo" : /seedance/.test(e) ? " · Seedance" : /kling/.test(e) ? " · Kling 2.5" : "";
    return `Creator video${eng}${sec}${meta.sound === true ? " · sound" : meta.sound === false ? " · silent" : ""}`;
  }
  // An engine test (a film shot, or a whole film, rendered again on another Kling host): say which host made it.
  if (meta.kind === "enginetest") {
    const h = meta.host === "fal" ? "fal · ½ price" : meta.host === "fal-std" ? "fal standard · ⅖ price" : "Replicate";
    return `Engine test${meta.whole ? " · whole film" : ""} · ${h}`;
  }
  // Test Movie A/B: label each film with the ENGINE that rendered it, so the merchant
  // can tell Veo from Kling at a glance when judging the same scene across models.
  if (meta.kind === "testmovie" || body.style === "TESTMOVIE") {
    const eng = typeof meta.engine === "string" ? meta.engine : "veo";
    const tk = typeof meta.template === "string" ? meta.template : "testmovie";
    const names: Record<string, string> = { testmovie: "Short Film", moral: "Moral Story", horror: "Horror Story", kidstv: "Kids Cartoon", musicvideo: "Music Video", kidsmusic: "Kids Music Video" };
    const ar = typeof meta.aspect === "string" && meta.aspect !== "9:16" && meta.aspect !== "vertical" ? ` · ${meta.aspect}` : "";
    return `${names[tk] || "Short Film"} · ${eng === "kling3" ? "Kling" : "Veo"}${ar}`;
  }
  const method = typeof body.method === "string" ? body.method : "";
  const m = method.match(/^(format|template|template-staged|template-fallback):(.+)$/);
  if (m) return `${pretty(m[2])}${m[1].startsWith("template") ? " backdrop" : ""}`;
  // metaJson always records the format the merchant PICKED, but the render
  // falls back to a plain scene ad when the layout fails QA. Claiming the
  // format anyway told merchants they got a Versus ad when they plainly
  // hadn't — the label has to describe what was BUILT, not what was asked for.
  if (typeof body.formatFallback === "string" && body.formatFallback) return method ? pretty(method) : null;
  if (typeof meta.formatKey === "string" && meta.formatKey) return pretty(meta.formatKey);
  if (typeof meta.templateKey === "string" && meta.templateKey) return `${pretty(meta.templateKey)} backdrop`;
  if (typeof meta.cartoonStyle === "string" && meta.cartoonStyle) return pretty(meta.cartoonStyle);
  if (typeof meta.style === "string" && meta.style) return pretty(meta.style);
  if (method === "presenter") return "With presenter";
  if (method) return pretty(method);
  return null;
}

/** THE RECEIPT. What the merchant picked and what the AI wrote, pulled out of
 *  the two JSON blobs every asset carries, so the viewer's right rail can show
 *  "here's exactly how this was made" instead of a bare title. Every field is
 *  optional — older assets stored less, and the UI renders only what exists.
 *  `kind` / `scriptLabel` are English source strings the client runs through
 *  t(); every value field is user content and is shown verbatim. */
export type PieceDetails = {
  kind: string | null;         // "Avatar video", "Commercial", …
  product: string | null;      // the product it's about
  presenter: string | null;    // "Mara · hype energy" for avatar pieces
  held: boolean;               // the presenter is holding the product
  service: boolean;            // service / no-physical-product mode
  topic: string | null;        // faceless topic
  tagline: string | null;      // commercial tagline
  direction: string | null;    // the merchant's OWN words / brief
  script: string | null;       // what the AI actually wrote (spoken/narration)
  scriptLabel: string | null;  // how to title the script block
};
function buildDetails(type: string, metaJson: string | null, bodyJson: string | null): PieceDetails {
  let meta: Record<string, unknown> = {};
  let body: Record<string, unknown> = {};
  try { meta = JSON.parse(metaJson || "{}"); } catch { /* ignore */ }
  try { body = JSON.parse(bodyJson || "{}"); } catch { /* ignore */ }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const style = str(meta.style) || str(body.style);
  const isFaceless = meta.kind === "faceless" || style === "FACELESS";
  const hasPresenter = style === "AI_AVATAR" || style === "COMMERCIAL" || style === "CARTOON" || style === "JINGLE";
  const kind =
    type === "AUDIO" ? "Music track"
    : type === "BLOG_POST" ? "Article"
    : type === "IMAGE_AD" ? "Image ad"
    : isFaceless ? "Faceless video"
    : style === "AI_AVATAR" ? "Avatar video"
    : style === "COMMERCIAL" ? "Commercial"
    : style === "CARTOON" ? "Cartoon ad"
    : style === "JINGLE" ? "Jingle video"
    : type === "VIDEO_AD" ? "Video"
    : null;
  const av = str(meta.avatarId) ? AVATAR_BY_ID[str(meta.avatarId)!] : undefined;
  const presenter = av ? (av.vibe ? `${av.name} · ${av.vibe}` : av.name) : null;
  const topic = str(meta.topic);
  // body.script is the spoken/narrated line; body.prompt doubles as the script
  // on older cartoon/avatar rows and as the topic on faceless — don't echo the
  // topic back as if it were the script.
  let script = str(body.script) || str(body.prompt);
  if (script && script === topic) script = null;
  // A described Creator video has no product and no script: what the member wrote is its "direction", and
  // body.prompt is OUR brief to the engine (camera, no-text rules, the sound line) — not theirs to read.
  const creative = type === "VIDEO_AD" && creativeVideo(meta, body);
  if (creative) script = null;
  return {
    kind,
    product: creative ? null : str(meta.productTitle),
    presenter,
    held: body.heldProduct === true,
    service: meta.serviceMode === true,
    topic,
    tagline: str(body.tagline),
    direction: str(meta.direction) || (creative ? str(meta.productTitle) : null),
    script,
    scriptLabel: script ? (isFaceless ? "Narration" : hasPresenter ? "What they say" : "Prompt") : null,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const lang = readUiLang(request);

  // ONE unified archive (owner 11-01): the Creator/Marketing toggle was far too
  // confusing — it hid a still-rendering film in the "other" section. Everything
  // the shop has made now shows in a single list. The section TAG stays on each
  // asset + job (it still drives pricing, remix routing and capability gates);
  // only the archive VIEW split is gone. `section` is kept for link back-compat.
  const section = new URL(request.url).searchParams.get("section") === "creator" ? "creator" : "marketing";

  // How many to render. This USED to be a hard `take: 60` with no pagination
  // and no total — which quietly hid everything older than the newest 60. That
  // was not merely cosmetic: un-kept media is permanently deleted at 30 days
  // (storage-cleanup.server.ts), and the only ways to save a piece — Keep and
  // Post — require opening it HERE. The hidden assets are by definition the
  // oldest, i.e. exactly the ones about to be destroyed, so a merchant past 60
  // pieces could not rescue the work they had paid for.
  const SHOW_STEP = 60;
  const SHOW_MAX = 600;
  const showParam = parseInt(new URL(request.url).searchParams.get("show") || "", 10);
  const show = Math.min(SHOW_MAX, Math.max(SHOW_STEP, Number.isFinite(showParam) ? showParam : SHOW_STEP));

  // Scene stills + avatar/wardrobe portraits (from the Movie Maker) get their OWN archive section,
  // so they don't crowd the ad Images tab or dominate pagination. They're marked by metaJson.kind.
  // SEARCH. A library of hundreds had no way to find one piece but scrolling (and "show older").
  // Matched on the title across the whole library, not the loaded page, so an old piece is findable;
  // every count below is narrowed the same way so "Showing X of Y" stays true.
  const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 80);
  // COLLECTIONS (2026-11-22): ?col= names one of THIS shop's collections — anything else (a deleted one,
  // another shop's, a hand-edited link) is no filter at all. It narrows the shelves and every count exactly
  // the way the search does, so it rides in the same where: `titleWhere` is every narrowing the counts
  // share — the search word and the collection.
  const collections = await listCollections(shop.id);
  const colParam = new URL(request.url).searchParams.get("col") || "";
  const col = collections.some((c) => c.id === colParam) ? colParam : "";
  const colWhere = col ? { collectionItems: { some: { collectionId: col } } } : {};
  const titleWhere = { ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}), ...colWhere };
  // WHEN (2026-11-22) — "All time · Today · This week · This month". Like the search it lives in the URL
  // (?when=) and is applied HERE, because here is where the paging is: the page holds only the newest
  // `show` pieces, so a filter over what was loaded would quietly leave out this month's 61st. Today
  // starts at midnight where the shop is (the zone its posts are scheduled by); a shop with no zone on
  // file gets the last 24 hours (whenSince, below).
  const when = parseWhen(new URL(request.url).searchParams.get("when"));
  const whenNowMs = Date.now();
  const dayStartMs = isValidTimeZone(shop.timezone)
    ? zonedInstant(zonedDateString(new Date(whenNowMs), shop.timezone), "00:00", shop.timezone).getTime()
    : null;
  const since = whenSince(when, whenNowMs, dayStartMs);
  const whenWhere = since ? { createdAt: { gte: since } } : {};
  const GALLERY_KINDS = ['"kind":"musicvideo-scene"', '"kind":"wardrobe"'];
  const galleryWhere = { OR: GALLERY_KINDS.map((k) => ({ metaJson: { contains: k } })) };

  // True per-type totals, independent of what we render — the tab labels were
  // counting the truncated page and therefore under-reported the library.
  const totalsRaw = await db.asset.groupBy({
    by: ["type"],
    where: { shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD", "AUDIO", "BLOG_POST"] }, NOT: galleryWhere, ...titleWhere },
    _count: { _all: true },
  });
  const totals = { video: 0, image: 0, music: 0, blog: 0, stills: 0 };
  for (const t of totalsRaw) {
    if (t.type === "VIDEO_AD") totals.video = t._count._all;
    else if (t.type === "IMAGE_AD") totals.image = t._count._all;
    else if (t.type === "AUDIO") totals.music = t._count._all;
    else if (t.type === "BLOG_POST") totals.blog = t._count._all;
  }
  totals.stills = await db.asset.count({ where: { shopId: shop.id, type: "IMAGE_AD", ...galleryWhere, ...titleWhere } });
  // WHEN (2026-11-22): what each window holds, tab by tab — the number on each of its chips. The three
  // windows nest (today is inside this week is inside this month), so ONE lean read of the last 30 days
  // — two small columns, the search still applied — counts all three. `totals` above is "All time".
  const monthSince = whenSince("month", whenNowMs)!;
  const [recentPieces, recentStills] = await Promise.all([
    db.asset.findMany({ where: { shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD", "AUDIO", "BLOG_POST"] }, NOT: galleryWhere, ...titleWhere, createdAt: { gte: monthSince } }, select: { type: true, createdAt: true } }),
    db.asset.findMany({ where: { shopId: shop.id, type: "IMAGE_AD", ...galleryWhere, ...titleWhere, createdAt: { gte: monthSince } }, select: { createdAt: true } }),
  ]);
  const whenCounts = {
    all: totals,
    ...tallyWhen([
      ...recentPieces.map((p) => ({ tab: A_KIND[p.type], at: p.createdAt.getTime() })),
      ...recentStills.map((p) => ({ tab: "stills" as const, at: p.createdAt.getTime() })),
    ], whenNowMs, dayStartMs),
  };
  // Every count the page shows is the OPEN window's — narrowed exactly as the search narrows them — so
  // the numbers on the tabs and "Showing X of Y" stay true, and "Show older pieces" pages inside the window.
  const inWhen = whenCounts[when];
  const totalAll = inWhen.video + inWhen.image + inWhen.music + inWhen.blog;

  // EACH TAB HOLDS ITS OWN NEWEST PIECES (2026-11-22). The page used to load the newest `show` pieces of
  // every kind TOGETHER, and the tabs sifted that one page — so an account that had just made sixty
  // videos opened Images to "Showing 3 of 76 images" and had to tap "Show older pieces" through its videos
  // to reach them (seen live, on the owner's own library). Now it is the newest `show` OF EACH KIND, put
  // back in one newest-first list: same order, same numbering of repeats, and every tab opens full.
  const assets = (await Promise.all((["VIDEO_AD", "IMAGE_AD", "AUDIO", "BLOG_POST"] as const).map((type) => db.asset.findMany({
    where: { shopId: shop.id, type, NOT: galleryWhere, ...titleWhere, ...whenWhere },
    orderBy: { createdAt: "desc" },
    take: show,
  })))).flat().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  // Separate fetch for the Scenes & Portraits section (its own pagination so neither crowds the other).
  const stills = await db.asset.findMany({
    where: { shopId: shop.id, type: "IMAGE_AD", ...galleryWhere, ...titleWhere, ...whenWhere },
    orderBy: { createdAt: "desc" },
    take: 180,
  });
  const jobs = await db.job.findMany({
    where: { shopId: shop.id, status: { in: ["PENDING", "IN_PROGRESS", "FAILED"] }, type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_SONG", "GENERATE_BLOG_POST"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  // Cooking tiles, same logic as the embedded Archive: live ETA per job type,
  // product image as the tile art, failed jobs surfaced instead of vanishing.
  const nowMs = Date.now();
  const TYPICAL: Record<string, number> = { GENERATE_VIDEO_AD: 180, GENERATE_IMAGE_AD: 45, GENERATE_SONG: 60, GENERATE_BLOG_POST: 40 };
  const COMMERCIAL_TYPICAL_SEC = 660;
  const KIND: Record<string, "video" | "image" | "music" | "blog"> = { GENERATE_VIDEO_AD: "video", GENERATE_IMAGE_AD: "image", GENERATE_SONG: "music", GENERATE_BLOG_POST: "blog" };
  const cookingCards: { jobId: string; kind: "video" | "image" | "music" | "blog"; status: "generating" | "failed"; productImage: string | null; productTitle: string; etaSec: number; elapsedSec: number; refunded: boolean; retryCost: number }[] = [];
  for (const j of jobs) {
    let p: { productImageUrl?: string; productTitle?: string; refunded?: boolean; __startedAt?: string; section?: string; contentType?: string; filmScenes?: number } = {};
    try { p = JSON.parse(j.payload); } catch { /* ignore */ }
    // Unified archive: every cooking tile shows, whichever section started it.
    const due = !j.runAt || j.runAt.getTime() <= nowMs;
    const failed = j.status === "FAILED";
    const generating = j.status === "IN_PROGRESS" || (j.status === "PENDING" && due);
    if (!failed && !generating) continue; // future-scheduled drip isn't "cooking"
    // __startedAt is written once, when the job is claimed. Falling back to
    // updatedAt keeps jobs claimed before this existed reporting sensibly.
    const stamped = Date.parse(String((p as { __startedAt?: string }).__startedAt || ""));
    const startMs =
      j.status === "IN_PROGRESS"
        ? (Number.isFinite(stamped) ? stamped : j.updatedAt.getTime())
        : j.createdAt.getTime();
    // Math.max(5, …) pinned the countdown at "5s left" forever once the
    // estimate ran out — a merchant watched it say that for two minutes. An
    // estimate that has expired is not a five-second estimate; it is an
    // expired estimate, and the honest thing is to stop counting and say the
    // render is taking longer than usual.
    const elapsedSec = Math.round((nowMs - startMs) / 1000);
    // A film runs FAR longer than a normal 180s video (one AI clip per scene),
    // so estimate from its scene count — otherwise the card falsely reads
    // "taking longer than usual" within a few minutes of a perfectly healthy run.
    // A COMMERCIAL is five scenes drawn, animated and voiced one after another, then cut over music:
    // 9 min 26 s on the live site (2026-11-23). At the 180 s of a single clip its card read "taking
    // longer than usual" from the third minute of a perfectly healthy render.
    const typical = (j.type === "GENERATE_VIDEO_AD" && p.contentType === "film")
      ? Math.max(600, (typeof p.filmScenes === "number" ? p.filmScenes : 8) * 60)
      : (j.type === "GENERATE_VIDEO_AD" && p.contentType === "commercial") ? COMMERCIAL_TYPICAL_SEC
      : TYPICAL[j.type];
    const etaSec = generating ? Math.round(typical - elapsedSec) : 0;
    const pl = p as { chargedTokens?: number };
    const curCost = currentRetryCost(j.type, p as Record<string, unknown>);
    const storedCost = typeof pl.chargedTokens === "number" && pl.chargedTokens > 0 ? pl.chargedTokens : curCost;
    const retryCost = failed && p.refunded ? Math.min(storedCost, curCost) : 0;
    cookingCards.push({ jobId: j.id, kind: KIND[j.type] || "image", status: failed ? "failed" : "generating", productImage: p.productImageUrl || null, productTitle: p.productTitle || "", etaSec, elapsedSec, refunded: !!p.refunded, retryCost });
  }
  const linked = linkedFromCache(shop.socialsJson).filter(isPostable);
  // WHICH PIECES CAN BE REMIXED.
  //
  // The viewer offered a gold "Remix · N tokens" on every video and image, but the remix action refuses
  // a piece with no product photo — it would have to invent the product — and every Creator image, photo
  // edit, Movie Maker film, faceless video and scene still is one. On those the button could only ever
  // answer "made before we started saving its product photo… Remake it from the Studio". So the action's
  // own test is run here, and the button is offered only where it passes: a product title, and (videos
  // and images) service mode, the photo kept on the piece, or the catalogue's photo under that title —
  // asked of the catalogue ONCE for the whole page, not once per piece. What depends on the account (a
  // plan, the tier, tokens) is left out on purpose: those refusals say what to do next.
  const remixBasis = (a: (typeof assets)[number]) => {
    let m: { productTitle?: unknown; productImageUrl?: unknown; serviceMode?: unknown } = {};
    try { m = JSON.parse(a.metaJson || "{}") || {}; } catch { /* no meta: the title is all there is */ }
    const title = ((typeof m.productTitle === "string" && m.productTitle) || a.title || "").trim();
    // settled = needs nothing from the catalogue: an article takes no photo, a service piece has none
    return { title, settled: a.type === "BLOG_POST" || !!m.serviceMode || !!m.productImageUrl };
  };
  const askCatalogue = [...new Set([...assets, ...stills].filter((a) => a.type !== "AUDIO").map(remixBasis).filter((b) => b.title && !b.settled).map((b) => b.title))];
  let catalogueHas = new Set<string>();
  if (askCatalogue.length) {
    try {
      const rows = await db.catalogProduct.findMany({ where: { shopId: shop.id, title: { in: askCatalogue }, imageUrl: { not: null } }, select: { title: true, imageUrl: true } });
      catalogueHas = new Set(rows.filter((r) => r.imageUrl).map((r) => r.title));
    } catch { /* the action's own lookup fails the same way: no photo, no remix */ }
  }
  const remixable = (a: (typeof assets)[number]) => {
    if (a.type === "AUDIO") return false; // the action takes videos, images and articles only
    const b = remixBasis(a);
    return !!b.title && (b.settled || catalogueHas.has(b.title));
  };
  // Un-kept media (PENDING video/photo) auto-clears at 30 days — surface a
  // per-item countdown so nothing vanishes as a surprise. Blogs never expire.
  const CACHE_DAYS = 30;
  // Which collections each loaded piece is on (its chips in the viewer) — one read for the page, and none
  // at all for a shop that has no collections.
  const colsOf = collections.length ? await collectionIdsByAsset(shop.id, [...assets, ...stills].map((a) => a.id)) : {};
  const mapAsset = (a: (typeof assets)[number]) => {
      let body: { videoUrl?: string; imageUrl?: string; audioUrl?: string; title?: string; html?: string; needsRegen?: boolean } = {};
      try { body = JSON.parse(a.bodyJson || "{}"); } catch { /* ignore */ }
      // MEDIA WE KNOW IS GONE.
      //
      // Provider render URLs die after about an hour. backfillDeadImages
      // re-forges what it can and stamps needsRegen:true on the rest — but
      // the only thing that ever read that flag was the query that skips
      // those rows, so the merchant was left with a permanently broken tile,
      // a download link to nothing, and a Post button that could only fail.
      // Say it plainly instead. The age check matters: a just-generated asset
      // can legitimately still be serving from the provider.
      const rawMedia = body.videoUrl || body.imageUrl || body.audioUrl || null;
      const pastProviderTtl = nowMs - a.createdAt.getTime() > 2 * 60 * 60 * 1000;
      // Audio lives on our own durable /renders disk (no provider TTL to expire).
      const expired = a.type !== "AUDIO" && (body.needsRegen === true || (pastProviderTtl && isExpiringUrl(rawMedia || undefined)));
      const text = typeof body.html === "string" ? stripHtml(body.html) : undefined;
      const unkeptMedia = a.status === "PENDING" && (a.type === "VIDEO_AD" || a.type === "IMAGE_AD");
      const daysLeft = unkeptMedia ? Math.max(0, CACHE_DAYS - Math.floor((nowMs - a.createdAt.getTime()) / 86_400_000)) : undefined;
      return {
        id: a.id,
        type: a.type,
        title: a.title || body.title || tr(lang, "Untitled"),
        media: expired ? null : rawMedia,
        expired,
        isVideo: a.type === "VIDEO_AD",
        isAudio: a.type === "AUDIO",
        // Output shape so the viewer can frame landscape (16:9) / square videos properly, not squeeze
        // them into the portrait stage. Refined from the real video dimensions once it loads.
        aspect: (() => { try { const m = JSON.parse(a.metaJson || "{}"); return typeof m.aspect === "string" ? m.aspect : null; } catch { return null; } })(),
        snippet: text ? text.slice(0, 140) : undefined,
        html: a.type === "BLOG_POST" && typeof body.html === "string" ? body.html : undefined,
        // Which recipe built this? Merchants remix and compare, and "the one
        // that worked" is unfindable if the ad won't say what it was.
        recipe: recipeLabel(a.metaJson, a.bodyJson),
        // Does this film carry a per-shot timeline (dialogue pipeline)? Gates the "Edit
        // shots" link into the section editor.
        hasShots: (() => { try { const m = JSON.parse(a.metaJson || "{}"); return Array.isArray(m.shots) && m.shots.length > 0; } catch { return false; } })(),
        // Is it a STORY film (acted or narrated)? Those can be continued: the viewer's "Next episode" opens
        // the Movie Maker on the next episode of its series (film-series.ts → storyHeroOf / episodeCardFor).
        canContinue: a.type === "VIDEO_AD" && !!storyHeroOf(a.metaJson),
        // Which kind of video it is, for the Films / Faceless chips: every Movie Maker pipeline records its
        // own kind (acted, narrated, music video, the older stills-and-clips engine, engine tests).
        group: (() => {
          if (a.type !== "VIDEO_AD") return null;
          try {
            const k = String(JSON.parse(a.metaJson || "{}").kind || "");
            return FILM_KINDS.has(k) ? "film" : k === "faceless" ? "faceless" : null;
          } catch { return null; }
        })(),
        missed: pickedButMissed(a.metaJson, a.bodyJson),
        // The share link's token while the piece is shared (the owner's own page — never on the public one).
        shareToken: (() => { try { const s = JSON.parse(a.metaJson || "{}").share; return s && typeof s.token === "string" ? (s.token as string) : null; } catch { return null; } })(),
        // The ad pack's copy, once written for this piece (kept on it), so it shows the moment the pack opens.
        adCopy: (() => {
          try {
            const c = JSON.parse(a.metaJson || "{}").adCopy;
            return c && typeof c.headline === "string" && typeof c.primary === "string" && c.headline && c.primary ? { headline: c.headline as string, primary: c.primary as string } : null;
          } catch { return null; }
        })(),
        // The "receipt" for the viewer's right rail — selections + the script.
        details: buildDetails(a.type, a.metaJson, a.bodyJson),
        when: a.createdAt.toISOString(),
        status: a.status,
        daysLeft,
        // Post tracking: clicks counted by the /go/a turnstile + where the
        // piece went live, for the Boost panel.
        clicks: (() => { try { return Number(JSON.parse(a.metaJson || "{}").clicks) || 0; } catch { return 0; } })(),
        postedUrls: (() => { try { const u = JSON.parse(a.metaJson || "{}").postedUrls; return u && typeof u === "object" ? (u as Record<string, string>) : undefined; } catch { return undefined; } })(),
        // WE LOST IT, SO WE REPLACE IT.
        //
        // When a render goes missing the only thing the merchant can do is
        // remix — and remix charges full price for a video (150 tokens) they
        // already paid for once. Charging a second time for our own storage
        // failure is not a thing this app should do. One free replacement per
        // dead piece; the stamp lives on the asset so it cannot be farmed.
        freeRemake: expired && !(() => { try { return JSON.parse(a.metaJson || "{}").freeReplacedAt; } catch { return false; } })(),
        // an edit the model did not make, and the tokens that came back for it (edit-check.ts editNote)
        ...editNote(a.metaJson),
        // Whether the remix action would take this piece at all (remixBasis, above). The viewer shows
        // Remix — and the free "Make it again" — only then: a button that can only refuse is a dead end.
        canRemix: remixable(a),
        // the ids of the collections it is on (the shop's own only)
        cols: colsOf[a.id] || [],
      };
  };
  return json({
    section,
    q,
    canPost: socialProviderEnabled() && linked.length > 0,
    linkedCount: linked.length,
    linked,
    tokens: tokensRemainingLive(shop.activePlan),
    hasPlan: !!shop.activePlan,
    cost: TOKEN_COST,
    cooking: cookingCards.filter((c) => c.status === "generating").length,
    cookingCards,
    totals: inWhen,
    // WHEN (2026-11-22): the open window, and what every window holds (the numbers on its chips)
    when,
    whenCounts,
    // COLLECTIONS (2026-11-22): the shop's shelves (A to Z, each with its count) and the open one ("" = none)
    collections,
    col,
    // Whether anything is still hidden, and how to ask for more of it.
    shown: Math.min(show, totalAll),
    totalAll,
    // (more to show while ANY tab holds more than is loaded of its kind — each kind is paged on its own)
    nextShow: Math.max(inWhen.video, inWhen.image, inWhen.music, inWhen.blog) > show ? Math.min(SHOW_MAX, show + SHOW_STEP) : null,
    assets: numberRepeats(assets.map(mapAsset)),
    stills: numberRepeats(stills.map(mapAsset)),
  });
};

/** RE-RENDERS SHARE A TITLE. Making a film again gives the new one the same name, so the shelf showed
 *  "Short Film — The Last Slice" three times with nothing to tell them apart. Number repeats oldest
 *  first — the first keeps its name, later ones read "(2)", "(3)" — within what the page shows. */
function numberRepeats<T extends { title: string; when: string }>(list: T[]): T[] {
  const seen = new Map<string, number>();
  const oldestFirst = [...list].sort((a, b) => a.when.localeCompare(b.when));
  const label = new Map<T, string>();
  for (const x of oldestFirst) {
    const n = (seen.get(x.title) || 0) + 1;
    seen.set(x.title, n);
    if (n > 1) label.set(x, `${x.title} (${n})`);
  }
  return list.map((x) => (label.has(x) ? { ...x, title: label.get(x)! } : x));
}

/** What a collection request that could not be done says, as one sentence in the member's language. */
function colProblemSentence(lang: ReturnType<typeof readUiLang>, problem: ColProblem, name?: string): string {
  if (problem === "empty") return tr(lang, "Give the collection a name.");
  if (problem === "long") return tr(lang, "Keep the name to 40 characters or fewer.");
  if (problem === "taken") return tr(lang, "You already have a collection called “{name}” — pick another name.", { name: name || "" });
  if (problem === "full") return tr(lang, "You have 50 collections, the most there can be — delete one to make another.");
  if (problem === "gone") return tr(lang, "That collection is gone — refresh and try again.");
  return tr(lang, "Those pieces are gone — refresh and try again.");
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const lang = readUiLang(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  // EVERY SIZE: the open video in another ad shape (no crop, blur fill), made on this server with ffmpeg
  // once and kept beside the original. No tokens — it is the merchant's own video, reshaped.
  if (intent === "adsize") {
    const size = String(form.get("size") || "");
    if (!isAdSize(size)) return json({ adsize: { ok: false as const, size, error: tr(lang, "That size didn't render — try again.") } });
    const a = await db.asset.findFirst({ where: { id: String(form.get("assetId") || ""), shopId: shop.id, type: "VIDEO_AD" }, select: { bodyJson: true } });
    let videoUrl = "";
    try { videoUrl = String(JSON.parse(a?.bodyJson || "{}").videoUrl || ""); } catch { /* none */ }
    const { sizedVideo } = await import("../lib/ad-sizes.server");
    const { mirrorRender } = await import("../lib/object-storage.server");
    const r = a ? await sizedVideo(videoUrl, size, { mirror: mirrorRender }) : { ok: false as const, error: "missing" };
    if (r.ok) return json({ adsize: { ok: true as const, size, url: r.url } });
    const why = r.error === "not-local" || r.error === "missing" ? tr(lang, "This video is no longer on our storage — make it again first.")
      : r.error === "too-long" ? tr(lang, "Videos longer than five minutes can't be resized here.")
      : tr(lang, "That size didn't render — try again.");
    return json({ adsize: { ok: false as const, size, error: why } });
  }

  // AD PACK · CAPTIONS FILE: what the video says, timed to the word, as the .srt every ad manager and
  // YouTube take. Free; made once and kept beside the video.
  if (intent === "adsrt") {
    const a = await db.asset.findFirst({ where: { id: String(form.get("assetId") || ""), shopId: shop.id, type: "VIDEO_AD" }, select: { bodyJson: true } });
    let videoUrl = "";
    try { videoUrl = String(JSON.parse(a?.bodyJson || "{}").videoUrl || ""); } catch { /* none */ }
    const { srtForVideo } = await import("../lib/ad-pack.server");
    const { mirrorRender } = await import("../lib/object-storage.server");
    const r = a ? await srtForVideo(videoUrl, { mirror: mirrorRender }) : { ok: false as const, error: "missing" as const };
    if (r.ok) return json({ adsrt: { ok: true as const, url: r.url } });
    const why = r.error === "not-local" || r.error === "missing" ? tr(lang, "This video is no longer on our storage — make it again first.")
      : r.error === "no-speech" ? tr(lang, "No one speaks in this video, so there are no captions to make.")
      : tr(lang, "The captions didn't come out — try again.");
    return json({ adsrt: { ok: false as const, error: why } });
  }

  // SHARE LINK: a public page for this one piece — its media and title, nothing else of the account —
  // made when asked for. The token lives on the piece, so "Stop sharing" kills every copy of the link.
  if (intent === "share" || intent === "unshare") {
    const a = await db.asset.findFirst({ where: { id: String(form.get("assetId") || ""), shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD", "AUDIO"] } }, select: { id: true, metaJson: true } });
    if (!a) return json({ share: { ok: false as const, error: tr(lang, "That piece is gone.") } });
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(a.metaJson || "{}"); } catch { /* none */ }
    const cur = (meta.share as { token?: string } | undefined)?.token || "";
    const linkFor = (tok: string) => `${externalOrigin(request)}/s/${a.id}/${tok}`;
    if (intent === "share") {
      if (cur) return json({ share: { ok: true as const, url: linkFor(cur) } });
      const { randomBytes } = await import("node:crypto");
      const token = randomBytes(12).toString("base64url");
      const saved = await db.asset.updateMany({ where: { id: a.id, shopId: shop.id, metaJson: a.metaJson }, data: { metaJson: JSON.stringify({ ...meta, share: { token, at: new Date().toISOString() } }) } });
      if (saved.count !== 1) return json({ share: { ok: false as const, error: tr(lang, "That didn't save — try again.") } });
      return json({ share: { ok: true as const, url: linkFor(token) } });
    }
    if (cur) {
      const rest = Object.fromEntries(Object.entries(meta).filter(([k]) => k !== "share"));
      const saved = await db.asset.updateMany({ where: { id: a.id, shopId: shop.id, metaJson: a.metaJson }, data: { metaJson: JSON.stringify(rest) } });
      if (saved.count !== 1) return json({ share: { ok: false as const, error: tr(lang, "That didn't save — try again.") } });
    }
    return json({ share: { ok: true as const, url: null } });
  }

  // AD PACK · AD COPY: a headline and primary text to run the piece with, grounded only in what the piece
  // and the store say. Free; kept on the piece (fresh=1 writes another).
  if (intent === "adcopy") {
    const { writeAdCopy } = await import("../lib/ad-pack.server");
    const r = await writeAdCopy({ shopId: shop.id, assetId: String(form.get("assetId") || ""), fresh: form.get("fresh") === "1" });
    if (r.ok) return json({ adcopy: { ok: true as const, ...r.copy } });
    return json({ adcopy: { ok: false as const, error: r.error === "missing" ? tr(lang, "That piece is gone.") : tr(lang, "The copy didn't come out — try again.") } });
  }

  // COLLECTIONS (2026-11-22): make, fill, empty, rename and delete the shop's named shelves. The database
  // work — and the shop scoping of every query — is collections.server.ts; this reads the form and says
  // what happened, in a sentence when something is wrong.
  if (intent === "colCreate" || intent === "colAdd" || intent === "colRemove" || intent === "colRename" || intent === "colDelete") {
    const collectionId = String(form.get("collectionId") || "");
    const r = intent === "colCreate" ? await createCollection(shop.id, form.get("name"))
      : intent === "colAdd" ? await addToCollection(shop.id, collectionId ? { collectionId } : { newName: form.get("newName") }, form.get("assetIds"))
      : intent === "colRemove" ? await removeFromCollection(shop.id, collectionId, form.get("assetIds"))
      : intent === "colRename" ? await renameCollection(shop.id, collectionId, form.get("name"))
      : await deleteCollection(shop.id, collectionId);
    if (!r.ok) return json({ col: { ok: false as const, op: intent, error: colProblemSentence(lang, r.problem, r.name) } });
    return json({ col: { ok: true as const, op: intent, id: r.collection.id, name: r.collection.name, n: r.n } });
  }

  if (intent === "retryJob") {
    // Same economics as the embedded app: interrupted failure = free retry;
    // refunded terminal failure = a fresh purchase (re-charge, restore prePaid).
    // FAILED or wedged IN_PROGRESS only — never a COMPLETED job (see below).
    const jobId = (form.get("jobId") as string) || "";
    // A retry is only ever legitimate for a job that FAILED terminally or is
    // WEDGED in progress. With no status filter this also matched a COMPLETED
    // job: payload.refunded is falsy on a successful run, so nothing was
    // re-charged, the job went back to PENDING with attempts cleared, and the
    // worker rendered the merchant another 150-token video for free — as many
    // times as they pressed it.
    const job = await db.job.findFirst({ where: { id: jobId, shopId: shop.id, status: { in: ["FAILED", "IN_PROGRESS"] }, type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_SONG", "GENERATE_BLOG_POST"] } } });
    if (!job) return json({ error: tr(lang, "That job's gone — try generating again from the Studio.") });
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(job.payload); } catch { /* ignore */ }
    // Re-assert entitlement for EVERY generator type before re-charging — a
    // retry is a fresh paid generation, and a plan that has since lost the
    // capability (e.g. dropped the Creator add-on) must not re-run a song/edit
    // the tier no longer includes. (Two-currency rule: tokens never unlock a
    // generator the tier lacks.) The worker's own cases re-assert too.
    {
      const retryCap = job.type === "GENERATE_VIDEO_AD" ? videoCapabilityForSection((payload.section as string) || undefined, (payload.contentType as string) || undefined)
        : job.type === "GENERATE_IMAGE_AD" ? "image" as const
        : job.type === "GENERATE_SONG" ? "music" as const
        : "blog" as const;
      try { assertCapability(shop.activePlan, retryCap); }
      catch (e) { return json({ error: (e as Error).message }); }
    }
    let newPayload: string | undefined;
    // Hoisted so the losing side of the claim below can give back exactly
    // what this request charged.
    let spent = 0;
    let retryFromExtra = 0;
    if (payload.refunded) {
      // Retry at TODAY's price, clamped so it is never more than the original
      // charge (a pre-reprice faceless job stored 80; the current price is 30).
      const curCost = currentRetryCost(job.type, payload as Record<string, unknown>);
      const storedCost = typeof payload.chargedTokens === "number" && payload.chargedTokens > 0 ? (payload.chargedTokens as number) : curCost;
      const cost = Math.min(storedCost, curCost);
      spent = cost;
      // The RE-SPEND has its own split. The refund that preceded this put
      // tokens back into whichever bucket paid the first time, but the wallet
      // has moved on since — a period roll, a top-up, other spends — so the
      // second charge can easily come out of the other bucket. Carrying the
      // old chargedFromExtra forward would refund a purchased token as an
      // expiring one on the next failure, which is the bug this field exists
      // to prevent.
      try { retryFromExtra = (await spendTokens(shop.id, cost)).fromExtra; }
      catch (e) { return json({ error: e instanceof Error ? e.message : tr(lang, "Not enough tokens to retry.") }); }
      // START CLEAN. A re-run is a fresh render the merchant is paying for
      // again, so it must not inherit the previous run's stage checkpoints:
      // ckFalRequestId, ckTalkingUrl and friends would re-attach to — or
      // re-deliver — work from the earlier attempt, handing over an old video
      // for a new charge. Everything the pipelines checkpoint is prefixed ck.
      const fresh = Object.fromEntries(
        Object.entries(payload as Record<string, unknown>).filter(([k]) => !k.startsWith("ck"))
      );
      newPayload = JSON.stringify({ ...fresh, prePaid: true, refunded: false, chargedTokens: cost, chargedFromExtra: retryFromExtra });
    }
    // CLAIM THE RETRY, AND REFUND THE LOSER.
    //
    // This was a bare update. Two overlapping clicks — a double-tap, a
    // resubmitted form — both read payload.refunded as true, both charged, and
    // both wrote the row back to PENDING: one render, two charges, and the
    // second write also reset attempts on a job the first had already made
    // runnable. The status the row was READ with is the guard, exactly as in
    // the worker.
    const claimed = await db.job.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: "PENDING", attempts: 0, lastError: null, runAt: new Date(), ...(newPayload ? { payload: newPayload } : {}) },
    });
    if (claimed.count !== 1) {
      // Someone else got there first. Give back what this request charged —
      // to the bucket it actually came out of — or the merchant pays twice
      // for the one retry that is now running.
      if (spent > 0) {
        const { refundTokens } = await import("../lib/tokens.server");
        await refundTokens(shop.id, spent, retryFromExtra).catch((e) => console.error("[retry] losing click refund failed:", e));
      }
      return json({ ok: tr(lang, "Already retrying — hang tight.") });
    }
    return json({ ok: tr(lang, "Retrying — back in the oven.") });
  }
  if (intent === "dismissJob") {
    const jobId = (form.get("jobId") as string) || "";
    await db.job.deleteMany({ where: { id: jobId, shopId: shop.id, status: "FAILED", type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_SONG", "GENERATE_BLOG_POST"] } } });
    return json({});
  }
  if (intent === "keep") {
    // ONLY AN UN-KEPT PIECE BECOMES KEPT — the guard keepMany has just below. This had no status in
    // its where, and after "Post now" the open viewer still showed the piece as it was before the post,
    // heart live: one tap turned a PUBLISHED piece back into APPROVED. It then read "Kept" instead of
    // "Posted" and lost what protects a posted piece from a bulk delete.
    await db.asset.updateMany({ where: { id: (form.get("assetId") as string) || "", shopId: shop.id, status: "PENDING" }, data: { status: "APPROVED" } });
    return json({ kept: true });
  }
  if (intent === "keepMany") {
    // "Keep all" on the Clearing-soon shelf: every piece on the 30-day clock, saved in one tap. Only
    // un-kept ones change (a posted piece stays posted), only this shop's, and never more than a page.
    const ids = String(form.get("assetIds") || "").split(",").map((x) => x.trim()).filter((x) => /^[a-z0-9]{10,40}$/i.test(x)).slice(0, 300);
    if (!ids.length) return json({ keptMany: 0 });
    const r = await db.asset.updateMany({ where: { id: { in: ids }, shopId: shop.id, status: "PENDING" }, data: { status: "APPROVED" } });
    return json({ keptMany: r.count });
  }
  if (intent === "deleteMany") {
    // Select mode's Delete: the picked pieces, this shop's only, never more than a page — and never a
    // POSTED piece (its click tracking and boost links live on it; those are deleted one at a time).
    const ids = String(form.get("assetIds") || "").split(",").map((x) => x.trim()).filter((x) => /^[a-z0-9]{10,40}$/i.test(x)).slice(0, 300);
    if (!ids.length) return json({ deletedMany: 0, skippedPosted: 0 });
    const skippedPosted = await db.asset.count({ where: { id: { in: ids }, shopId: shop.id, status: "PUBLISHED" } });
    const r = await db.asset.deleteMany({ where: { id: { in: ids }, shopId: shop.id, status: { not: "PUBLISHED" } } });
    return json({ deletedMany: r.count, skippedPosted });
  }
  if (intent === "unkeep") {
    // Toggle Keep back off — the heart is a switch, so a second tap un-saves the
    // piece (it rejoins the 30-day auto-clear). Scoped to APPROVED so a tap can
    // never un-publish a piece that was actually posted to socials.
    await db.asset.updateMany({ where: { id: (form.get("assetId") as string) || "", shopId: shop.id, status: "APPROVED" }, data: { status: "PENDING" } });
    return json({ unkept: true });
  }
  if (intent === "delete") {
    await db.asset.deleteMany({ where: { id: (form.get("assetId") as string) || "", shopId: shop.id } });
    return json({ deleted: true });
  }
  if (intent === "remix") {
    // "Remix" = make a fresh variation of a piece they already liked. We reuse
    // the original's product + direction and enqueue the same kind of job; the
    // avatar variant is nudged so the new take genuinely looks different.
    // Costs the same as making one new. (Web accounts have no Shopify catalog
    // to re-fetch a photo from — the metaJson-stored productImageUrl rides along.)
    if (!shop.brandProfile) return json({ error: tr(lang, "Analyze your store first so remixes match your brand.") });
    if (!shop.activePlan?.active) return json({ error: tr(lang, "Pick a plan first — remixes run on tokens.") });
    const id = (form.get("assetId") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD", "BLOG_POST"] } } });
    if (!asset) return json({ error: tr(lang, "That piece is gone — refresh and try again.") });
    let meta: { productTitle?: string; avatarId?: string; avatarVariant?: number; direction?: string; style?: string; cartoonStyle?: string; productImageUrl?: string; formatKey?: string; templateKey?: string; serviceMode?: boolean; styleMode?: string; wear?: boolean } = {};
    try { meta = JSON.parse(asset.metaJson || "{}"); } catch { /* ignore */ }
    const productTitle = (meta.productTitle || asset.title || "").trim();
    if (!productTitle) return json({ error: tr(lang, "Couldn't tell which product this was — remake it from the Studio.") });
    const avatarId = meta.avatarId || undefined;
    const direction = meta.direction || undefined;
    const nextVariant = avatarId ? (((meta.avatarVariant ?? 0) + 1) % 4) : 0; // rotate the take
    // Ads made before metaJson carried the photo would be un-remixable forever.
    // The catalogue has the same product under the same title, so recover from
    // there rather than stranding the whole back catalogue.
    const productImageUrl = asset.type !== "BLOG_POST"
      ? meta.productImageUrl || (await catalogImageFor(shop.id, productTitle)) || undefined
      : undefined;
    // Same story for the recipe: older assets never stored formatKey, but
    // bodyJson.method recorded what actually ran ("format:callout"). Recover it
    // so a remix of a Callout is another Callout, not a plain scene.
    if (!meta.formatKey && !meta.templateKey) {
      try {
        const body = JSON.parse(asset.bodyJson || "{}") as { method?: string };
        const m = (body.method || "").match(/^(format|template|template-staged|template-fallback):(.+)$/);
        if (m) {
          if (m[1] === "format") meta.formatKey = m[2];
          else meta.templateKey = m[2];
        }
      } catch { /* no recipe to recover */ }
    }
    const type = asset.type === "VIDEO_AD" ? "video" : asset.type === "IMAGE_AD" ? "image" : "blog";
    // No photo means the pipeline invents a product from its name. That's the
    // AI-slop path, and it costs the SAME as a real render — 150 tokens on a
    // video. Refuse BEFORE the spend. Anything made before we started saving
    // the photo lands here, which is a one-time cliff, not an ongoing one.
    if (asset.type !== "BLOG_POST" && !meta.serviceMode && !productImageUrl) {
      return json({
        error: tr(lang, "This {kind} was made before we started saving its product photo, so a remix would invent a product instead of using yours. Remake it from the Studio — pick the product and we'll keep the rest.", { kind: type === "video" ? "video" : "ad" }),
      });
    }
    // Creator-section pieces (faceless / casual clips) remix on the cheap path:
    // the casual-video price + the "creatorvideo" cap, not the marketing video
    // price + "video" cap — otherwise a Creator remixing their own clip would be
    // over-charged and blocked behind Studio.
    const assetSection = (meta as { section?: string }).section === "creator" ? "creator" : "marketing";
    const cost = type === "video" ? (assetSection === "creator" ? TOKEN_COST.casualVideo : TOKEN_COST.video) : type === "image" ? TOKEN_COST.image : TOKEN_COST.blog;
    // Tier gate BEFORE the spend: old assets stay viewable/postable forever,
    // but remixing (new generation) needs the capability on the current tier.
    {
      const cap = type === "video"
        ? videoCapabilityForSection(assetSection, meta.style === "CARTOON" ? "cartoon" : meta.style === "JINGLE" ? "jingle" : undefined)
        : type === "image" ? ("image" as const) : ("blog" as const);
      try { assertCapability(shop.activePlan, cap); }
      catch (e) { return json({ error: (e as Error).message }); }
    }
    // Capture WHICH bucket paid. spendTokens draws from the expiring monthly
    // allowance first and the purchased top-up only after it runs out, and
    // the job carries that split so a terminal failure refunds to the same
    // place. Discarding it meant a failed remix paid for with bought,
    // never-expiring tokens came back as allowance — and expired at the next
    // period roll. The merchant paid cash for those.
    // IS THIS A REPLACEMENT FOR SOMETHING WE LOST?
    //
    // Same test the loader uses: needsRegen stamped by the healer, or a
    // provider URL that is past its ~1h life. If so the remake is free, once.
    // The stamp is claimed with a compare-and-swap BEFORE anything is spent
    // or enqueued, so two clicks in the same second cannot both take it — the
    // loser pays like any other remix.
    let free = false;
    if (asset.type !== "BLOG_POST") {
      let deadBody: { videoUrl?: string; imageUrl?: string; needsRegen?: boolean } = {};
      try { deadBody = JSON.parse(asset.bodyJson || "{}"); } catch { /* treat as alive */ }
      const rawMedia = deadBody.videoUrl || deadBody.imageUrl || null;
      const pastProviderTtl = Date.now() - asset.createdAt.getTime() > 2 * 60 * 60 * 1000;
      const mediaLost = deadBody.needsRegen === true || (pastProviderTtl && isExpiringUrl(rawMedia || undefined));
      if (mediaLost && !(meta as { freeReplacedAt?: string }).freeReplacedAt) {
        const claimed = await db.asset.updateMany({
          where: { id: asset.id, metaJson: asset.metaJson },
          data: { metaJson: JSON.stringify({ ...meta, freeReplacedAt: new Date().toISOString() }) },
        });
        free = claimed.count === 1;
      }
    }
    let remixFromExtra = 0;
    if (!free) {
      try { remixFromExtra = (await spendTokens(shop.id, cost)).fromExtra; }
      catch (e) { return json({ error: e instanceof Error ? e.message : tr(lang, "Not enough tokens for a remix.") }); }
    }
    // prePaid:false on a free job, NOT chargedTokens:0 — the refund path
    // falls back to REFUND_BY_TYPE when chargedTokens is not a positive
    // number, so a failed free remake would have minted 150 tokens out of a
    // spend that never happened.
    const paid = !free;
    if (type === "video") {
      const style = avatarId ? "AI_AVATAR" : "PRODUCT_HIGHLIGHT";
      // Cartoon/jingle remixes stay cartoon/jingle — the content type (and the
      // picked animation style) rides along from the original's metaJson.
      // COMMERCIAL was missing from this map, so remixing a cinematic
      // commercial fell through to contentType undefined and produced a plain
      // product highlight — a different format entirely, for the same 150
      // tokens, with nothing on screen saying so. Every branch job-queue
      // dispatches on (cartoon / commercial / jingle) is now represented.
      const contentType = meta.style === "CARTOON" ? "cartoon"
        : meta.style === "COMMERCIAL" ? "commercial"
        : meta.style === "JINGLE" ? "jingle"
        : undefined;
      // SERVICE MODE HAS TO RIDE ALONG.
      //
      // The guard above lets a piece through with no product photo precisely
      // BECAUSE meta.serviceMode is true — and then this payload dropped the
      // flag, so the pipelines took the physical-product path: a script
      // written about an object, a presenter told to hold one, and a prompt
      // demanding the product "stay exactly as it appears in the source
      // photograph" when there is no photograph and no product. A coach or a
      // local service paid 150 tokens for the AI-slop path the guard above
      // exists to refuse. The image branch below already passes it.
      const serviceMode = !!meta.serviceMode;
      await enqueueJob(shop.id, "GENERATE_VIDEO_AD", { section: assetSection, productTitle, style, contentType, cartoonStyle: meta.cartoonStyle, customPrompt: direction, avatarId, avatarVariant: nextVariant, productImageUrl, productDescription: direction, serviceMode, holdProduct: !!avatarId && !contentType && !serviceMode, wearProduct: false, prePaid: paid, chargedTokens: paid ? cost : undefined, chargedFromExtra: remixFromExtra, initiator: "remix" });
    } else if (type === "image") {
      // A remix is a VARIATION of this ad, so the recipe rides along — without
      // the format/template the "remix" quietly became a different ad entirely.
      await enqueueJob(shop.id, "GENERATE_IMAGE_AD", {
        productTitle, productImageUrl, stylePrompt: direction,
        avatarId, avatarVariant: nextVariant, wear: !!meta.wear,
        formatKey: meta.formatKey || undefined,
        templateKey: meta.templateKey || undefined,
        serviceMode: !!meta.serviceMode,
        styleMode: meta.styleMode === "scene" || meta.styleMode === "backdrop" ? meta.styleMode : undefined,
        prePaid: paid, chargedTokens: paid ? cost : undefined, chargedFromExtra: remixFromExtra,
      });
    } else {
      await enqueueJob(shop.id, "GENERATE_BLOG_POST", { productTitle, productDescription: direction, prePaid: paid, chargedTokens: paid ? cost : undefined, chargedFromExtra: remixFromExtra });
    }
    return json({ remixed: type, free });
  }
  if (intent === "draft") {
    // Suggest one editable caption for the manual post box. A single caption
    // the merchant can tweak, not three per-platform boxes. Tuned to Instagram
    // when linked (richest tag style), else the first linked network.
    const id = (form.get("assetId") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD"] } } });
    if (!asset) return json({ error: tr(lang, "That piece is gone — refresh and try again.") });
    let title = asset.title || "New from our shop";
    try { const m = JSON.parse(asset.metaJson || "{}"); title = m.productTitle || title; } catch { /* ignore */ }
    const isVideo = asset.type === "VIDEO_AD";
    let platforms: string[] = [];
    try {
      if (socialProviderEnabled()) platforms = (await refreshLinkedPlatforms(shop.id)).filter((p) => takes(p, isVideo));
    } catch { /* ignore */ }
    if (platforms.length === 0) platforms = ["instagram"];
    const tune = platforms.includes("instagram") ? "instagram" : platforms[0];
    const captions = await getOrMakeCaptions(id, shop.id, { productTitle: title, isVideo, platforms });
    const fbText = fallbackCaption({ productTitle: title, isVideo, platforms }).text;
    // Deep-link the post at the actual product page when we mirrored their
    // catalogue — an ad nobody can act on is half an ad.
    const buyUrl = await productLinkFor(shop.id, title);
    return json({ draft: buildPostTitle(captions[tune], buyUrl, fbText, undefined, tune) });
  }
  if (intent === "post") {
    if (!socialProviderEnabled()) return json({ error: tr(lang, "Social posting is coming online — check back shortly.") });
    const id = (form.get("assetId") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD"] } } });
    if (!asset) return json({ error: tr(lang, "That piece is gone — refresh and try again.") });
    let media: string | undefined;
    let title = asset.title || "New from our shop";
    try { const b = JSON.parse(asset.bodyJson || "{}"); media = b.videoUrl || b.imageUrl; } catch { /* ignore */ }
    try { const m = JSON.parse(asset.metaJson || "{}"); title = m.productTitle || title; } catch { /* ignore */ }
    if (!media) return json({ error: tr(lang, "This piece has no media to post.") });
    // Provision-on-demand instead of hard-failing on a missing profile key, and
    // a live platform refresh instead of trusting the stale socials cache.
    const profileKey = await ensureProfile(shop.id);
    if (!profileKey) return json({ error: tr(lang, "Couldn't reach the posting service — try again in a minute.") });
    const platforms = (await refreshLinkedPlatforms(shop.id)).filter((p) => takes(p, asset.type === "VIDEO_AD"));
    if (platforms.length === 0) return json({ error: tr(lang, "Link your socials first on the Auto-posting page.") });
    const isVideo = asset.type === "VIDEO_AD";
    // DO NOT ABSOLUTIZE HERE.
    //
    // Render terminates TLS at its edge and forwards over plain HTTP, and
    // remix-serve never sets Express’s "trust proxy", so req.protocol is
    // "http" and `new URL(request.url).origin` is http://easymodeapp.com on a
    // page the merchant loaded over HTTPS. The provider was handed an http://
    // video URL to fetch — and because it already began with "http",
    // publishPost’s own correct absolutization (SHOPIFY_APP_URL) was skipped.
    // So this button and the scheduled poster disagreed about the address of
    // the very same file, and only the scheduler had it right.
    //
    // Every pipeline stores videoUrl/imageUrl as "/renders/<file>", so pass
    // the stored value through and let publishPost resolve it exactly the way
    // it does for a campaign drop.
    const mediaUrl = media;
    // The go-link goes out IN THE CAPTION, publicly, so it must be https for
    // the same reason: request.url reads http:// behind the edge. Resolved the
    // way the scheduled poster resolves it, from the env, with the forwarded
    // origin as a fallback.
    const base =
      (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "") || externalOrigin(request);

    // If the merchant edited a caption in the draft box, post THAT verbatim to
    // every platform (their words win, no tokens spent). Otherwise fall back to
    // the AI writer: a per-platform tuned caption, cached on the asset.
    const custom = ((form.get("caption") as string) || "").trim();
    const credit = trialCredit(shop.activePlan);
    let titleFor: (p: string) => string;
    if (custom) {
      // Merchant words win, but the AI-disclosure tag is mandatory on every
      // post — append it unless their caption already carries it.
      const capBase = custom.slice(0, 860);
      const withTag = new RegExp(`#${AI_DISCLOSURE_TAG}\\b`, "i").test(capBase) ? capBase : `${capBase}\n\n#${AI_DISCLOSURE_TAG}`;
      titleFor = () => (credit ? `${withTag}\n\n${credit}` : withTag);
    } else {
      const captions = await getOrMakeCaptions(id, shop.id, { productTitle: title, isVideo, platforms });
      const fbText = fallbackCaption({ productTitle: title, isVideo, platforms }).text;
      // The caption links through OUR turnstile, not the raw product page —
      // every click gets counted on this exact piece before forwarding with
      // UTM tags. This is where "which post made money" starts.
      const goUrl = `${base}/go/a/${id}`;
      titleFor = (p) => buildPostTitle(captions[p], goUrl, fbText, credit, p);
    }
    // NAME THE PLATFORMS THAT ACTUALLY TOOK IT.
    //
    // This used to track a single anyOk flag and then report success against
    // `platforms` — the list the merchant ASKED for, not the list that
    // worked. One live account out of two, and the toast still read "Posted
    // to tiktok · facebook". The merchant believes it went to Facebook, it
    // did not, and nothing ever corrects them. Same defect the questline
    // poster was already fixed for; the manual path kept it.
    let lastErr: string | undefined;
    const postedUrls: Record<string, string> = {};
    const landed: string[] = [];
    const missed: string[] = [];
    for (const p of platforms) {
      const r = await publishPost(profileKey, { title: titleFor(p), mediaUrl, isVideo, platforms: [p] });
      if (r.ok) {
        landed.push(p);
        if (r.urls) Object.assign(postedUrls, r.urls);
      } else {
        missed.push(p);
        lastErr = r.error;
      }
    }
    if (!landed.length) return json({ error: tr(lang, "Posting failed ({err}) — check your linked accounts.", { err: lastErr || "unknown" }) });
    // Remember WHERE it landed: the live post links power the Boost panel
    // and stay on the card long after this response is gone.
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(asset.metaJson || "{}"); } catch { /* fresh */ }
    // postedTo is the load-bearing one: it is what stops a second attempt from
    // posting again where it already landed. Re-read and merge rather than
    // writing back a blob captured before the network round-trip — the public
    // click counter writes this same field, so the stale copy loses real state.
    // Union, never replace: two attempts that each reached different accounts
    // must both be remembered.
    for (let attempt = 0; attempt < 3; attempt++) {
      const fresh = await db.asset.findUnique({ where: { id }, select: { metaJson: true } });
      if (!fresh) break; // the piece was deleted while we were posting
      let m: Record<string, unknown> = {};
      try { m = JSON.parse(fresh.metaJson || "{}"); } catch { /* fresh */ }
      m.postedUrls = { ...(m.postedUrls as Record<string, string> | undefined), ...postedUrls };
      m.postedAt = new Date().toISOString();
      m.postedTo = [...new Set([...((m.postedTo as string[] | undefined) || []), ...landed])];
      const done = await db.asset.updateMany({
        where: { id, metaJson: fresh.metaJson },
        data: { status: "PUBLISHED", metaJson: JSON.stringify(m) },
      });
      if (done.count === 1) break;
    }
    // If this piece is a drop in a running campaign, close its slot too.
    // REVIEW_FIRST is the default and the poster never touches those, so this
    // is the ONLY thing that can advance such a campaign.
    try {
      const { recordManualPost } = await import("../lib/questlines.server");
      await recordManualPost(shop.id, id, landed, postedUrls);
    } catch (e) {
      console.error("[archive] manual post slot update failed (non-fatal):", e);
    }
    // Shipped It — first piece that actually reached a social account.
    if (landed.length) { try { const { unlockAchievement } = await import("../lib/xp.server"); await unlockAchievement(shop.id, "SHIPPED_IT"); } catch { /* non-fatal */ } }
    return json({
      // WHICH piece this is about. Without it the badge below is a claim
      // about whatever the merchant happens to be looking at.
      postedAssetId: id,
      posted: landed.join(" · "),
      ok: missed.length
        ? tr(lang, "Posted to {landed}. {missed} didn't go through ({err}) — check that account and try again.", { landed: landed.join(" · "), missed: missed.join(" · "), err: lastErr || "unknown" })
        : tr(lang, "Posted to {landed}", { landed: landed.join(" · ") }),
      postedUrls,
    });
  }
  return json({});
};

/** Countdown text, or the truth when the estimate has run out.
 *
 *  These are queued renders behind a third-party API — they routinely run
 *  past a typical time, and a stuck "5s left" makes a working render look
 *  frozen. Below ~10s we stop giving a number at all, because a number that
 *  keeps not arriving is worse than no number. */
function fmtEta(etaSec: number, elapsedSec: number | undefined, t: (s: string, p?: Record<string, string | number>) => string): string {
  if (etaSec > 60) return t("{n} min left", { n: Math.ceil(etaSec / 60) });
  if (etaSec > 10) return t("{n}s left", { n: etaSec });
  if (etaSec > 0) return t("almost there");
  const mins = Math.floor((elapsedSec ?? 0) / 60);
  // "still rendering", not "taking longer than usual" — a lip-sync video legitimately runs 15-35 min,
  // so the alarming phrasing fired on a perfectly healthy render the moment the (too-low) estimate ran out.
  return mins >= 1 ? t("still rendering · {mins} min in", { mins }) : t("still rendering");
}

/** COMPACT status for the spinner OVERLAY — just the time, never the full sentence
 *  (that lives in the detail line below the card, where there's room). A narrow card
 *  wrapped the long overlay into a broken-looking mess; this keeps it one clean line. */
function fmtEtaShort(etaSec: number, elapsedSec: number | undefined, t: (s: string, p?: Record<string, string | number>) => string): string {
  if (etaSec > 60) return t("{n} min", { n: Math.ceil(etaSec / 60) });
  if (etaSec > 10) return t("{n}s", { n: etaSec });
  if (etaSec > 0) return t("almost there");
  const mins = Math.floor((elapsedSec ?? 0) / 60);
  return mins >= 1 ? t("{mins} min in", { mins }) : t("one moment");
}
// Sanitized download filename from the piece's title.
function dlName(title: string, isVideo: boolean, isAudio = false): string {
  const base = (title || "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "easymode";
  return `${base}.${isAudio ? "mp3" : isVideo ? "mp4" : "jpg"}`;
}

type ATab = "video" | "image" | "music" | "blog" | "stills";
/** What a tab's pieces are called in a sentence ("Showing 60 of 82 videos"). */
const TAB_PLURAL: Record<ATab, string> = { video: "videos", image: "images", music: "tracks", blog: "articles", stills: "pictures" };
const A_KIND: Record<string, ATab> = { VIDEO_AD: "video", IMAGE_AD: "image", AUDIO: "music", BLOG_POST: "blog" };

/* ── ARCHIVE FEATURES · THE PURE PART (2026-11-22) ────────────────────────────────────────────────────
 * Two things customers of rival tools ask for, and this Archive had neither: a WHEN filter (to find last
 * week's piece) and DOWNLOAD for a whole selection (to take several pieces out at once). What decides
 * them is kept in this one block — no React, no database, nothing imported — so that
 * tests/archive-features.test.ts can lift the block out of this file and run it exactly as written.
 * Keep it that way: plain values in, plain values out, between here and the closing rule. */

/** WHEN — the date filter's windows. "all" is no filter, and is the default. */
const WHEN_KEYS = ["all", "today", "week", "month"] as const;
type AWhen = (typeof WHEN_KEYS)[number];
type AWindow = Exclude<AWhen, "all">;
/** What each chip reads (English source strings; the page runs them through t()). */
const WHEN_LABEL: Record<AWhen, string> = { all: "All time", today: "Today", week: "This week", month: "This month" };
/** …and what the shelf says when a window holds nothing (whole sentences, so they translate whole). */
const WHEN_EMPTY: Record<AWindow, string> = {
  today: "Nothing from today yet.",
  week: "Nothing from this week yet.",
  month: "Nothing from this month yet.",
};
const DAY_MS = 86_400_000;

/** ?when= → a window this page knows. Anything else (a hand-edited link) is all time — never an error. */
function parseWhen(v: unknown): AWhen {
  return typeof v === "string" && (WHEN_KEYS as readonly string[]).includes(v) ? (v as AWhen) : "all";
}

/** The oldest moment a window reaches back to; null = no limit. This week is the last 7 days and this
 *  month the last 30. Today starts at `dayStartMs` — midnight where the shop is, which the loader works
 *  out from the shop's time zone. With no zone on file (or a midnight that cannot be right: ahead of
 *  now, or more than a 25-hour day behind it) it is the last 24 hours instead, which is wider than any
 *  calendar day — so nothing made today can be left out. */
function whenSince(when: AWhen, nowMs: number, dayStartMs?: number | null): Date | null {
  if (when === "week") return new Date(nowMs - 7 * DAY_MS);
  if (when === "month") return new Date(nowMs - 30 * DAY_MS);
  if (when !== "today") return null;
  const sane = typeof dayStartMs === "number" && Number.isFinite(dayStartMs) && dayStartMs <= nowMs && nowMs - dayStartMs <= 25 * 3_600_000;
  return new Date(sane ? (dayStartMs as number) : nowMs - DAY_MS);
}

/** How many pieces each window holds, tab by tab — the number on each chip. One pass over the pieces of
 *  the widest window is enough, because the windows nest. */
function tallyWhen(pieces: Array<{ tab: ATab; at: number }>, nowMs: number, dayStartMs?: number | null): Record<AWindow, Record<ATab, number>> {
  const zero = (): Record<ATab, number> => ({ video: 0, image: 0, music: 0, blog: 0, stills: 0 });
  const out: Record<AWindow, Record<ATab, number>> = { today: zero(), week: zero(), month: zero() };
  const windows = (["today", "week", "month"] as const).map((k) => [k, whenSince(k, nowMs, dayStartMs)!.getTime()] as const);
  for (const p of pieces) {
    if (!(p.tab in out.month)) continue; // a kind this page has no tab for
    for (const [k, from] of windows) if (p.at >= from) out[k][p.tab]++;
  }
  return out;
}

/** DOWNLOAD SEVERAL — one tap of the select bar saves this many files at most, this far apart (browsers
 *  swallow downloads fired in the same instant). */
const DL_CAP = 20;
const DL_GAP_MS = 400;
type DlPiece = { id: string; type: string; title: string; media: string | null; isVideo: boolean; isAudio: boolean };
type DlFile = { id: string; url: string; name: string };

/** A clean file name from the piece's title — letters and digits of any alphabet, spaces to dashes — with
 *  the file's OWN extension when its address shows one (a .png is saved as .png), else its kind's usual one.
 *  (The single Download's dlName, above, keeps unaccented Latin letters only — a title in any other script
 *  comes out "easymode" — and calls every image .jpg, a PNG included. It is left as it was.) */
function dlFileName(title: string, url: string, isVideo: boolean, isAudio: boolean): string {
  const clean = (title || "").replace(/[^\p{L}\p{M}\p{N} _-]+/gu, "").trim().replace(/[\s-]+/g, "-").replace(/^[-_]+/, "");
  const chars = Array.from(clean);
  let cut = chars.slice(0, 60).join("");
  // a name that had to be cut ends at a whole word (seen live: "…find-a-bri.mp4") when that keeps most of it
  if (chars.length > 60 && chars[60] !== "-") { const at = cut.lastIndexOf("-"); if (at >= 30) cut = cut.slice(0, at); }
  const base = cut.replace(/[-_]+$/, "") || "easymode";
  const real = /^(data|blob):/i.test(url) ? null : url.split(/[?#]/)[0].match(/\.(mp4|webm|mov|png|jpe?g|webp|gif|mp3|wav|m4a)$/i);
  return `${base}.${real ? real[1].toLowerCase() : isAudio ? "mp3" : isVideo ? "mp4" : "jpg"}`;
}

/** Is this address the page's own? The browser obeys <a download> for the page's own files only: another
 *  site's file it would OPEN instead — in this tab, taking the page and the rest of the downloads with it. */
function dlSameOrigin(url: string, pageOrigin: string): boolean {
  if (/^(data|blob):/i.test(url)) return true;
  try { return new URL(url, pageOrigin).origin === pageOrigin; } catch { return false; }
}

/** What one go will save: every picked piece that HAS a media file, in the order given (the order the
 *  page shows them), `cap` at most — the rest are `over`. A piece with no file is `skipped`: its render
 *  is gone, or it is an article. (Select mode does not reach the Articles tab today; if it ever does,
 *  give an article its own words — the page says "its render is gone" for everything skipped.) Two
 *  pieces that would be saved under one name are numbered, so neither overwrites the other. */
function downloadPlan(pieces: DlPiece[], cap: number = DL_CAP): { files: DlFile[]; skipped: number; over: number } {
  const files: DlFile[] = [];
  const taken = new Set<string>();
  let skipped = 0;
  let over = 0;
  for (const p of pieces) {
    if (p.type === "BLOG_POST" || !p.media) { skipped++; continue; }
    if (files.length >= cap) { over++; continue; }
    const first = dlFileName(p.title, p.media, p.isVideo, p.isAudio);
    let name = first;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = first.replace(/(\.[^.]+)$/, `-${n}$1`);
    taken.add(name.toLowerCase());
    files.push({ id: p.id, url: p.media, name });
  }
  return { files, skipped, over };
}

/** What a go says when it is over: how many were handed to the browser, how many were skipped and why,
 *  how many did not come. English source strings and their {n}; the page runs each through t().
 *  ("Started", not "saved": the page hands the files over — the browser is still writing a long video
 *  when this is said, and may ask before it takes several.) */
function dlSummary(started: number, skipped: number, failed: number): Array<{ s: string; n: number }> {
  const out: Array<{ s: string; n: number }> = [];
  if (started > 0) out.push({ s: started === 1 ? "1 download started." : "{n} downloads started.", n: started });
  if (skipped > 0) out.push({ s: skipped === 1 ? "1 skipped — its render is gone." : "{n} skipped — their renders are gone.", n: skipped });
  if (failed > 0) out.push({ s: failed === 1 ? "1 didn't download — open it and use its own Download." : "{n} didn't download — open each one and use its own Download.", n: failed });
  return out;
}
/* ── end of the pure part ─────────────────────────────────────────────────────────────────────────── */

/* ── COLLECTIONS & THE QUEUE · THE PURE PART (2026-11-22) ─────────────────────────────────────────────
 * What the Collections controls and the two "Add to queue" buttons decide and say. Like the block above:
 * no React, no database, nothing imported — tests/archive-collections.test.ts lifts it out and runs it. */

/** What the posting queue answers (POST /web/autopost, intent=queueAdd — the Auto-post page's endpoint). */
type QueueAnswer = { ok: true; queued: number; skipped: number; firstDueAt: string | null; lastDueAt: string | null } | { error: string };

/** Only videos and image ads go in the posting queue — and only ones whose render is still there. */
function queueableIds(pieces: Array<{ id: string; type: string; media: string | null }>): string[] {
  return pieces.filter((p) => (p.type === "VIDEO_AD" || p.type === "IMAGE_AD") && !!p.media).map((p) => p.id);
}

/** When the first queued piece posts, in the member's own locale: weekday and time within the week ahead
 *  ("Tue 6:00 PM"), the date and time further out ("Dec 2, 6:00 PM"). A time nothing can be made of is "". */
function queueWhen(iso: string, nowMs: number, locale?: string): string {
  const d = new Date(iso);
  const at = d.getTime();
  if (!Number.isFinite(at)) return "";
  const soon = at - nowMs < 6 * 86_400_000;
  return d.toLocaleString(locale, soon ? { weekday: "short", hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** What the page says once the queue has answered: English source sentences and their values (the page
 *  runs each through t()). The endpoint's own error sentence is shown as it is. */
function queueSay(a: QueueAnswer, when: string): { error: string } | { parts: Array<{ s: string; p: Record<string, string | number> }> } {
  if ("error" in a) return { error: a.error };
  const parts: Array<{ s: string; p: Record<string, string | number> }> = [];
  if (a.queued > 0) {
    if (when) parts.push({ s: a.queued === 1 ? "1 added to your queue — it posts {when}." : "{n} added to your queue — the first posts {when}.", p: { n: a.queued, when } });
    else parts.push({ s: a.queued === 1 ? "1 added to your queue." : "{n} added to your queue.", p: { n: a.queued } });
    if (a.skipped > 0) parts.push({ s: a.skipped === 1 ? "1 was already in it or can't be posted." : "{n} were already in it or can't be posted.", p: { n: a.skipped } });
  } else {
    parts.push({ s: "Nothing new to queue — those are already in it or can't be posted.", p: {} });
  }
  return { parts };
}

/** What a collection change says, once it is done (English source; {n} and {name} are filled by t()). */
function colSay(op: string, n: number): string {
  if (op === "colAdd") return n === 0 ? "Already in “{name}”." : n === 1 ? "1 added to “{name}”." : "{n} added to “{name}”.";
  if (op === "colRemove") return n === 1 ? "1 removed from “{name}”." : "{n} removed from “{name}”.";
  if (op === "colRename") return "Renamed to “{name}”.";
  if (op === "colDelete") return "“{name}” deleted — its pieces are still in your Archive.";
  return "“{name}” is ready.";
}
/* ── end of the collections & queue part ──────────────────────────────────────────────────────────── */

/** The browser's own download for one file: an <a download> made for it and clicked (2026-11-22). */
function clickDownload(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Route-local styles for everything the parity pass added (viewer, badges,
// chips, caption box, failed section). Matches the web front-door look:
// paper #F4F1E6 / card #FDFCF7 / ink #14201A / green #0C7A46 / gold #B08526.
// ONE accent green: the wallet + Kept chips resolve to the canonical brand
// green (#0C7A46 = --green). The section pills keep a #12A85E→#0C7A46 gradient
// on purpose — a lit pill reads as a toggle, not a status chip, so the two are
// deliberately different weights of the same green.
const WA_CSS = `
.wa-wallet{font-size:13px;font-weight:800;color:var(--green,#0C7A46);margin:0 0 12px;}
.wa-shelfnote{display:flex;align-items:flex-start;gap:6px;font-size:12px;line-height:1.45;color:var(--ink2,#5b6b61);margin:0 0 14px;}
.wa-shelfnote svg{flex:0 0 auto;margin-top:2px;}
.wa-poster{position:relative;display:block;width:100%;padding:0;border:0;background:#0b0f0d;cursor:pointer;font:inherit;color:inherit;}
.wa-poster video,.wa-poster img{width:100%;aspect-ratio:4/5;height:auto;object-fit:cover;display:block;pointer-events:none;}
.wa-play{position:absolute;inset:0;display:grid;place-items:center;font-size:32px;color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.65);pointer-events:none;}
/* Audio has no still — a soft green-on-cream panel with a music glyph stands
   in on the tile; the real <audio> player lives in the viewer. */
.wa-audiotile{position:relative;width:100%;aspect-ratio:4/5;display:grid;place-items:center;background:linear-gradient(150deg,#0C7A46,#14201A);}
.wa-audiotile .wa-audio-ico{color:var(--paper);opacity:.9;}
.wa-audiotile .wa-play{font-size:26px;opacity:.85;}
.wa-audiofull{width:100%;background:linear-gradient(150deg,#0C7A46,#14201A);display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px 20px;}
.wa-audiofull .wa-audio-ico{color:var(--paper);opacity:.92;}
.wa-audiofull audio{width:min(420px,88%);}
.wa-cd{position:absolute;top:8px;left:8px;background:rgba(20,32,26,.8);color:#E7C879;font-size:11.5px;font-weight:800;padding:4px 9px;border-radius:999px;letter-spacing:.02em;}
.wa-cd.urgent{background:#8C2E1B;color:#fff;}
.wa-track{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px;padding:10px 12px;border:1px solid var(--line,#e4e1d5);border-radius:10px;background:rgba(255,255,255,.55);}
.wa-clicks{font-size:12px;font-weight:800;color:#0A3D26;background:#EAF6EF;border:1px solid #BFE2CD;border-radius:999px;padding:5px 11px;}
.wa-boost{font-size:12px;font-weight:800;text-decoration:none;color:#5b3c00;background:#FFF3D6;border:1px solid #EAD79E;border-radius:999px;padding:5px 11px;}
.wa-boost:hover{background:#FFE9B3;}
.wa-boosthint{flex-basis:100%;font-size:11.5px;color:var(--ink2,#4a4f4b);opacity:.85;line-height:1.5;}
.wa-recipe{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;letter-spacing:.02em;
  background:#F3F1E4;color:#6B5312;border:1px solid rgba(176,133,38,.32);}
.wa-chip{display:inline-block;font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:999px;letter-spacing:.03em;text-transform:uppercase;}
.wa-chip.new{background:#FBF4E2;color:#8a6207;border:1px solid #E7C879;}
.wa-chip.kept{background:#EAF6EF;color:var(--green,#0C7A46);border:1px solid #BFE2CD;}
.wa-chip.posted{background:linear-gradient(165deg,#12A85E,#0B6B3E);color:#fff;border:1px solid transparent;}
.wa-tileacts{display:flex;gap:8px;align-items:center;margin-top:8px;}
.wa-jacts{display:flex;gap:8px;margin-top:8px;}
.wa-icon{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:10px;border:1px solid var(--line,#E5E0CF);background:#fff;color:var(--ink,#14201A);cursor:pointer;font-size:14px;text-decoration:none;padding:0;}
/* armed delete — first tap turns the trash red; a second tap within 4s deletes. */
.wa-icon.armed{border-color:#C0392B;background:#FBEAE7;color:#8C2E1B;box-shadow:0 0 0 2px rgba(192,57,43,.28);animation:waArm .18s ease}
@keyframes waArm{from{transform:scale(.88)}to{transform:scale(1)}}
.wa-icon:hover{filter:brightness(.97)}
.wa-icon[disabled]{opacity:.5;cursor:not-allowed}
.wa-blogrows{display:grid;gap:12px;}
.wa-blogrow{display:flex;gap:10px;align-items:flex-start;background:var(--card,#FDFCF7);border:1px solid var(--line,#E5E0CF);border-radius:16px;padding:16px 18px;}
.wa-blogopen{flex:1;text-align:left;border:0;background:none;padding:0;cursor:pointer;font:inherit;color:inherit;}
.wa-blogopen b{font-family:Poppins,sans-serif;font-size:15px;}
.wa-blogopen p{margin:6px 0 8px;font-size:12.5px;color:var(--ink2,#5b6b61);line-height:1.5;}
/* "Read" — a visible affordance so an Articles row looks like the rest of the
   app (the other tabs have a play/▶ and a thumbnail; a blog row is just text).
   It opens the same viewer the row click does. */
.wa-read-btn{align-self:center;flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;font-family:Poppins,sans-serif;font-weight:800;font-size:12.5px;color:var(--green,#0C7A46);background:#EAF6EF;border:1px solid #BFE2CD;border-radius:999px;padding:7px 14px;cursor:pointer;text-decoration:none;}
.wa-read-btn:hover{background:#DCF0E5;}
.wa-failsec{margin-top:26px;}
.wa-faildiv{display:flex;align-items:center;gap:12px;margin:0 0 12px;font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:#8C2E1B;white-space:nowrap;}
.wa-faildiv::before,.wa-faildiv::after{content:"";height:1px;background:var(--line,#E5E0CF);flex:1;}
.wa-scrim{position:fixed;inset:0;z-index:10500;background:rgba(10,14,12,.68);display:grid;place-items:center;padding:16px;}
/* 100% (of the scrim's padded box), never a vw unit: a vw width ignores the
 * scrim's own padding, so the panel overhung the right edge and took the close
 * button and the next arrow off-screen with it. */
.wa-viewer{position:relative;background:var(--card,#FDFCF7);border-radius:18px;width:min(920px,100%);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 70px rgba(10,14,12,.45);}
/* The clip sits in a dark STAGE that hugs it — a portrait video gets no cream
   letterbox bands — and the cycle arrows + count + Keep heart all live inside
   the stage, so they flank the actual clip, never the screen edges. The stage
   is only the dark cinematic frame for real media (video/image); blog + audio
   render in a plain transparent stage so their own layout is untouched. */
.wa-vstage{position:relative;min-width:0;min-height:0;}
.wa-vstage.media{display:flex;align-items:center;justify-content:center;background:#0b0f0d;}
/* MOBILE / default: stacked. The clip fills a phone-width card, info below. */
.wa-viewer.vmedia{width:min(440px,94vw);}
.wa-viewer.vmedia .wa-vfull{width:auto;height:auto;max-width:100%;max-height:74vh;object-fit:contain;}
/* LANDSCAPE / square clip → a WIDE viewer so a 16:9 video fills a landscape frame instead of being
   squeezed into the portrait stage. */
.wa-viewer.vmedia.wa-wide{width:min(820px,96vw);}
.wa-viewer.vmedia.wa-wide .wa-vfull{max-height:58vh;}
@media (min-width:760px){
  /* DESKTOP: clip LEFT, info RIGHT — a landscape card. The clip (max 80vh)
     drives the card height; the rail stretches to match and its text is
     clamped to fit, so nothing scrolls and the clip has no bands. */
  .wa-viewer.vmedia{flex-direction:row;width:auto;max-width:min(900px,95vw);max-height:84vh;align-items:stretch;}
  .wa-viewer.vmedia .wa-vstage{flex:0 0 auto;align-self:stretch;max-width:58vh;}
  .wa-viewer.vmedia .wa-vfull{width:auto;height:auto;max-width:58vh;max-height:80vh;}
  .wa-viewer.vmedia .wa-vmeta{flex:1 1 340px;min-width:306px;max-width:360px;border-top:none;border-left:1px solid var(--line,#E5E0CF);align-self:stretch;}
  /* Landscape clip on desktop: let the stage grow wide and the video fill it (no portrait cap). */
  .wa-viewer.vmedia.wa-wide{max-width:min(1280px,96vw);}
  .wa-viewer.vmedia.wa-wide .wa-vstage{flex:1 1 auto;max-width:none;}
  .wa-viewer.vmedia.wa-wide .wa-vfull{max-width:100%;max-height:80vh;}
  .wa-viewer.vmedia .wa-vheart{right:12px;}
}
.wa-vx{position:absolute;top:10px;right:10px;z-index:6;width:34px;height:34px;border-radius:50%;border:0;background:rgba(20,32,26,.78);color:#fff;font-size:15px;cursor:pointer;display:grid;place-items:center;}
.wa-vx:hover{background:rgba(20,32,26,.94)}
/* Keep = a heart over the clip's top-right. Fills gold once the piece is kept. */
.wa-vheart{position:absolute;top:10px;right:52px;z-index:6;width:38px;height:38px;border-radius:50%;border:0;background:rgba(20,32,26,.6);color:#fff;cursor:pointer;display:grid;place-items:center;transition:transform .14s ease,background .14s ease,color .14s ease;}
.wa-vheart:hover{background:rgba(20,32,26,.9);transform:scale(1.08)}
.wa-vheart.on{color:#FFC24A;background:rgba(20,32,26,.72);}
.wa-vheart[disabled]{cursor:default}
.wa-vheart[disabled]:not(.on){opacity:.55;cursor:not-allowed}
.wa-vnav{position:absolute;top:50%;transform:translateY(-50%);z-index:5;width:40px;height:40px;border-radius:50%;border:0;background:rgba(20,32,26,.6);color:#fff;font-size:24px;line-height:1;cursor:pointer;display:grid;place-items:center;padding-bottom:3px;}
.wa-vnav:hover{background:rgba(20,32,26,.9)}
.wa-vnav.prev{left:10px}
.wa-vnav.next{right:10px}
.wa-vcount{position:absolute;top:12px;left:12px;z-index:5;background:rgba(20,32,26,.72);color:#fff;font-size:11.5px;font-weight:800;padding:4px 10px;border-radius:999px;}
.wa-vfull{display:block;margin:0 auto;width:auto;height:auto;max-width:100%;max-height:74vh;object-fit:contain;background:#0b0f0d;}
/* One-tap "sound on" nudge — only shows if a strict browser refused to open the
   clip unmuted (iOS mostly). Sits above the native controls bar, centered. */
.wa-vsound{position:absolute;left:50%;bottom:54px;transform:translateX(-50%);z-index:6;display:inline-flex;align-items:center;gap:7px;padding:10px 18px;border:0;border-radius:999px;background:var(--green,#0C7A46);color:#fff;font:inherit;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.45);}
.wa-vsound:hover{filter:brightness(1.07)}
.wa-read{padding:24px 28px;overflow:auto;max-height:52vh;font-size:14.5px;line-height:1.65;color:var(--ink,#14201A);}
.wa-read h1,.wa-read h2,.wa-read h3{font-family:Poppins,sans-serif;line-height:1.25;margin:1em 0 .4em;}
.wa-read h1:first-child,.wa-read h2:first-child{margin-top:0}
.wa-read img{max-width:100%;border-radius:12px;}
/* Rail content is clamped to fit the clip's height, so it shouldn't need to
   scroll — but keep it scrollable as a safety (never clip the action buttons)
   while HIDING the scrollbar, so the panel always reads as a clean, scroll-free
   card the way the merchant expects. */
.wa-vmeta{padding:14px 16px 16px;border-top:1px solid var(--line,#E5E0CF);overflow:auto;scrollbar-width:none;-ms-overflow-style:none;}
.wa-vmeta::-webkit-scrollbar{display:none;}
.wa-vtitle{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.wa-vtitle b{font-family:Poppins,sans-serif;font-size:14.5px;}
.wa-vok{font-size:12.5px;font-weight:800;color:var(--green,#0C7A46);}
.wa-verr{font-size:12.5px;font-weight:700;color:#8C2E1B;}
.wa-vcdnote{display:block;margin-top:6px;font-size:12px;color:#8a6207;font-weight:600;}
.wa-vmissed{display:block;margin-top:8px;padding:9px 12px;border-radius:10px;font-size:12px;line-height:1.45;
  background:#FDF4E3;border:1px solid #E8D3A6;color:#7A5A12;font-weight:600;}
.wa-vcdnote.urgent{color:#8C2E1B;}
.wa-aitag{display:inline-block;margin-top:6px;font-size:11.5px;color:var(--ink2,#5b6b61);}
/* "The receipt" — what was picked + what the AI wrote, filling the viewer's
   right rail. Key/value grid uses display:contents rows so dt/dd align in one
   two-column grid; the prompt/script blocks read like a transcript (green
   accent, scrollable when long). */
.wa-spec{margin-top:10px;background:#FBF9F0;border:1px solid var(--line,#E5E0CF);border-radius:14px;padding:11px 13px;}
.wa-spec-kind{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#0A3D26;background:#EAF6EF;border:1px solid #BFE2CD;border-radius:999px;padding:3px 10px;margin-bottom:10px;}
.wa-spec-list{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:0;}
.wa-spec-row{display:contents;}
.wa-spec-list dt{font-size:11.5px;font-weight:700;color:var(--ink2,#5b6b61);white-space:nowrap;}
.wa-spec-list dd{margin:0;font-size:12.5px;font-weight:600;color:var(--ink,#14201A);word-break:break-word;}
.wa-spec-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;}
.wa-spec-tag{font-size:11px;font-weight:700;color:#5b3c00;background:#FFF3D6;border:1px solid #EAD79E;border-radius:999px;padding:3px 9px;}
.wa-prompt{margin-top:10px;}
.wa-prompt-h{display:block;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--ink2,#5b6b61);margin-bottom:5px;}
.wa-prompt p{margin:0;font-size:13px;line-height:1.5;color:var(--ink,#14201A);padding:9px 11px;background:#fff;border:1px solid var(--line,#E5E0CF);border-left:3px solid var(--green,#12A85E);border-radius:0 10px 10px 0;white-space:pre-wrap;}
/* Clamp so the rail fits the clip height with no scroll; fade the last line so
   a cut script reads as intentional, not broken. The full text is still in the
   piece — this is a preview panel, not the editor. */
.wa-prompt p.wa-prompt-dir,.wa-prompt p.wa-prompt-script{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;}
.wa-prompt-dir{-webkit-line-clamp:3;}
.wa-prompt-script{-webkit-line-clamp:6;}
/* The action row: two-up, every button the SAME height. The primary (Post) and
   the destructive Delete span the full width; the rest share equal half-width
   cells, and the last button in an odd row grows to fill — so there's never a
   lone half-button or a stray floating icon. */
.wa-vacts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}
.wa-vacts > .wa-vbtn{flex:1 1 calc(50% - 4px);min-width:0;}
.wa-vacts > .wa-vbtn.full{flex-basis:100%;}
.wa-vbtn.ghost.on{background:#EAF6EF;border-color:#BFE2CD;color:var(--green,#0C7A46);}
.wa-sizes{flex-basis:100%;border:1px solid var(--line,#E1DECD);border-radius:14px;padding:12px;background:#FBFAF4;}
.wa-sizes-h{margin:0 0 10px;font-size:12.5px;line-height:1.45;color:var(--ink2,#4A554E);}
.wa-sizes-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;} /* one per row: the viewer rail is narrow, and two across cut the labels */
.wa-size{display:flex;align-items:center;gap:10px;min-height:52px;padding:8px 10px;border-radius:12px;border:1px solid var(--line,#E1DECD);background:#fff;color:var(--ink,#14201A);font:inherit;text-align:left;text-decoration:none;cursor:pointer;box-sizing:border-box;transition:border-color .12s,background .12s;}
.wa-size:hover{border-color:#BFE2CD;}
.wa-size:disabled{cursor:progress;}
.wa-size.ready{background:#EAF6EF;border-color:#BFE2CD;}
.wa-size.ready b{color:var(--green,#0C7A46);}
.wa-size.err small{color:#B4532A;}
.wa-size-shape{flex:0 0 auto;height:30px;max-width:44px;border:2px solid currentColor;border-radius:4px;opacity:.55;box-sizing:border-box;}
.wa-size.making .wa-size-shape{animation:waSizePulse 1s ease-in-out infinite;}
@keyframes waSizePulse{0%,100%{opacity:.25}50%{opacity:.8}}
@media (prefers-reduced-motion:reduce){.wa-size.making .wa-size-shape{animation:none;}}
.wa-size-txt{display:flex;flex-direction:column;min-width:0;gap:2px;}
.wa-size-txt b{font-family:Poppins,sans-serif;font-size:13px;font-weight:700;display:inline-flex;align-items:center;gap:4px;}
.wa-size-txt small{font-size:11.5px;color:var(--ink2,#4A554E);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wa-pack-h{margin:12px 0 6px;font-family:Poppins,sans-serif;font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--green,#0C7A46);}
.wa-pack-h:first-child{margin-top:0;}
.wa-size-shape.wa-badge{width:34px;max-width:none;display:inline-flex;align-items:center;justify-content:center;font:800 10.5px/1 Poppins,sans-serif;letter-spacing:.02em;}
.wa-copy{display:flex;flex-direction:column;gap:8px;transition:opacity .15s;}
.wa-copy.making{opacity:.55;}
.wa-copy-row{position:relative;border:1px solid var(--line,#E1DECD);border-radius:12px;background:#fff;padding:9px 11px 10px;}
.wa-copy-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding-right:64px;}
.wa-copy-lbl{font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--ink2,#4A554E);}
.wa-copy-n{font-size:11px;color:#8A938D;font-variant-numeric:tabular-nums;}
.wa-copy-v{margin:5px 0 0;font-size:14px;line-height:1.45;color:var(--ink,#14201A);user-select:text;-webkit-user-select:text;overflow-wrap:anywhere;}
.wa-copy-btn{position:absolute;top:6px;right:6px;min-height:32px;padding:0 12px;border-radius:999px;border:1px solid #BFE2CD;background:#EAF6EF;color:var(--green,#0C7A46);font:700 12px/1 Poppins,sans-serif;cursor:pointer;}
.wa-copy-btn:hover{background:#DDF0E5;}
.wa-copy-again{align-self:flex-start;min-height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--line,#E1DECD);background:#fff;color:var(--ink,#14201A);font:700 12.5px/1 Poppins,sans-serif;cursor:pointer;}
.wa-copy-again:disabled{cursor:progress;opacity:.7;}
.wa-copy-err{margin:0;font-size:12px;color:#B4532A;}
.wa-share{display:flex;flex-direction:column;gap:8px;}
.wa-share-url{width:100%;box-sizing:border-box;min-height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--line,#E1DECD);background:#fff;font:500 12.5px/1.2 Inter,sans-serif;color:var(--ink,#14201A);}
.wa-share-url:focus{outline:2px solid var(--green,#0C7A46);outline-offset:1px;}
.wa-share-acts{display:flex;flex-wrap:wrap;align-items:center;gap:6px;}
.wa-share-acts .wa-share-btn{position:static;min-height:36px;}
.wa-share-acts a.wa-copy-again{display:inline-flex;align-items:center;text-decoration:none;}
.wa-share-stop{min-height:36px;padding:0 10px;border:0;background:transparent;color:#B4532A;font:700 12.5px/1 Poppins,sans-serif;text-decoration:underline;text-underline-offset:2px;cursor:pointer;margin-left:auto;}
.wa-share-stop:disabled{opacity:.6;cursor:progress;}

/* Two-layer premium gradient baked into the base rule: the viewer is portaled to
   document.body (outside .wb-main), so the .wb-main-scoped two-layer in web.tsx no
   longer reaches these CTAs. This block renders after web.tsx, so at equal 0,1,0
   it wins for the portaled buttons; in-shell .wa-vbtn still gets the identical
   two-layer via .wb-main (0,2,0) — no divergence either way. */
.wa-vbtn{border:0;cursor:pointer;font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:#fff;padding:8px 14px;min-height:46px;border-radius:12px;background:linear-gradient(100deg,#12A85E 58%,#0B7443 86%,#095F36),linear-gradient(165deg,#12A85E,#0B6B3E);box-shadow:0 4px 12px rgba(12,122,70,.25);text-decoration:none;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:2px 6px;box-sizing:border-box;text-align:center;line-height:1.2;}
.wa-vbtn:hover{filter:brightness(1.06)}
.wa-vbtn.gold{background:linear-gradient(165deg,#C98F12,#8a6207);box-shadow:0 4px 12px rgba(176,133,38,.3);}
.wa-vbtn.ghost{background:#fff;color:var(--ink,#14201A);border:1px solid var(--line,#E5E0CF);box-shadow:none;}
.wa-vbtn.danger{background:#fff;color:#8C2E1B;border:1px solid #E8C4BC;box-shadow:none;}
.wa-vbtn.danger.armed{background:#8C2E1B;color:#fff;border-color:#8C2E1B;}
.wa-vbtn[disabled]{opacity:.5;cursor:not-allowed}
/* The token/XP sub-line drops onto its own centered line under the label
   (flex-basis:100% forces the wrap), so Remix stays the same height as the rest. */
.wa-vbtn .c{flex-basis:100%;display:block;font-size:10px;font-weight:700;opacity:.85;}
.wa-cap{margin-top:12px;background:#FBF9F0;border:1px solid var(--line,#E5E0CF);border-radius:14px;padding:12px;}
.wa-capbox{width:100%;box-sizing:border-box;border:1px solid var(--line,#E5E0CF);border-radius:12px;padding:10px 12px;font:inherit;font-size:13.5px;line-height:1.5;background:#fff;color:var(--ink,#14201A);resize:vertical;}
.wa-capbox:disabled{opacity:.6}
.wa-caprow{display:flex;gap:8px;margin-top:8px;}
.wa-caphint{display:block;font-size:11.5px;color:var(--ink2,#5b6b61);margin-top:6px;}
/* ---- Phone shelf: the same doom-scroll relief the Studio pickers got. ----
 * One full-width column of 4/5 tiles is a ~500px card apiece, so a dozen
 * finished pieces became a mile of scrolling. Two-up halves it and the crop
 * is unchanged (aspect is what decides that, not size). Everything inside the
 * card tightens to survive a ~170px column — the retry row wraps rather than
 * running off the edge. */
@media (max-width:640px){
  .wb-assets{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
  .wb-asset{border-radius:14px;}
  .wb-asset .m{padding:9px 10px;font-size:12px;line-height:1.35;}
  .wb-asset .s{font-size:10.5px;}
  .wa-tileacts{gap:6px;margin-top:7px;}
  .wa-icon{width:28px;height:28px;border-radius:9px;font-size:13px;}
  .wa-chip{font-size:9.5px;padding:3px 7px;}
  .wa-play{font-size:26px;}
  .wa-cd{top:6px;left:6px;font-size:10.5px;padding:3px 7px;}
  /* Inline styles on these buttons, so !important is the only lever. */
  .wa-jacts{flex-wrap:wrap;gap:6px;}
  .wa-jacts .wb-btn{padding:8px 12px !important;font-size:11.5px !important;}
  /* The buffer scales with the tile it now lives in. */
  .wb-bufwrap{gap:7px;}
  .wb-bufwrap::before{width:150px;height:150px;}
  .wb-spin{width:74px;height:74px;}
  .wb-eta{font-size:11.5px;}
  .wb-failbadge{font-size:24px;}
}
/* Phone viewer: the frame keeps its margin, the chrome pulls in with it, and
   the ad gets more of the height back now that the buttons stack tighter. */
@media (max-width:640px){
  .wa-scrim{padding:10px;}
  .wa-viewer{max-height:95vh;border-radius:14px;}
  .wa-read{padding:18px;max-height:56vh;}
  /* The clip is HEIGHT-capped so a tall portrait video can never spill past the
     viewport top (it was: the base ".vmedia .wa-vfull{74vh}" out-specifies a
     bare ".wa-vfull", so the phone never got the shorter cap and the 74vh clip
     overflowed its flex-shrunk stage). Match that specificity so this wins, and
     let the details scroll BELOW the clip instead of squeezing it. */
  .wa-viewer.vmedia .wa-vstage{flex:0 0 auto;min-height:0;max-height:62vh;}
  .wa-viewer.vmedia .wa-vfull{max-height:62vh;}
  .wa-viewer.vmedia .wa-vmeta{flex:1 1 auto;min-height:0;}
  .wa-vx{top:8px;right:8px;width:32px;height:32px;font-size:14px;}
  .wa-vcount{top:10px;left:10px;font-size:11px;padding:3px 9px;}
  .wa-vnav{width:36px;height:36px;font-size:21px;}
  .wa-vnav.prev{left:6px}
  .wa-vnav.next{right:6px}
  .wa-vmeta{padding:12px 14px 16px;}
  .wa-vtitle b{font-size:13.5px;}
  .wa-vacts{gap:7px;margin-top:10px;}
  .wa-vbtn{padding:10px 14px;font-size:12.5px;border-radius:11px;}
}

/* ===================================================================
   CASUAL (Creator) Gallery — premium treatment, scoped to .wa-creator
   so the Marketing Archive is untouched. Styling only. =============== */
.wa-creator .wb-h1{font-family:Poppins,sans-serif;font-weight:800;font-size:34px;line-height:1.08;letter-spacing:-.025em;text-align:center;margin:8px 0 10px;}
.wa-creator .wb-sub{text-align:center;max-width:560px;margin:0 auto 8px;font-size:14.5px;color:var(--ink2,#4A554E);}
.wa-creator .wa-wallet{text-align:center;}
.wa-creator .ws-tabs{justify-content:center;gap:8px;}
.wa-creator .ws-tab{border-radius:999px;border:1px solid var(--line,#E1DECD);background:#fff;box-shadow:0 1px 2px rgba(20,32,26,.05);font-family:Poppins,sans-serif;font-weight:700;font-size:13.5px;color:var(--ink2,#4A554E);padding:9px 17px;transition:transform .12s,box-shadow .12s,color .12s;}
.wa-creator .ws-tab:hover{transform:translateY(-1px);box-shadow:0 10px 22px -12px rgba(20,32,26,.3);color:var(--ink,#14201A);}
.wa-creator .ws-tab.on{background:linear-gradient(135deg,#12A85E,#0C7A46);color:#fff;border-color:transparent;box-shadow:0 4px 14px rgba(12,122,70,.3);}
/* Tiles — rounder, softer, premium hover lift. */
.wa-creator .wa-poster{border-radius:16px;overflow:hidden;}
.wa-creator .wa-audiotile{border-radius:16px;}
.wa-creator .wb-asset{transition:transform .14s ease,box-shadow .14s ease;}
.wa-creator .wb-asset:hover{transform:translateY(-3px);}
@media(max-width:620px){.wa-creator .wb-h1{font-size:27px;}}
/* Section toggle (Creator | Social) — a small segmented pill under the heading. */
.wa-sections{display:inline-flex;gap:3px;padding:3px;margin:0 0 14px;background:#EAF6EF;border:1px solid #BFE2CD;border-radius:999px;}
.wa-creator .wa-sections{display:flex;width:max-content;margin-left:auto;margin-right:auto;}
.wa-sectab{font-family:Poppins,sans-serif;font-size:12.5px;font-weight:700;color:var(--green,#0C7A46);text-decoration:none;padding:6px 15px;border-radius:999px;line-height:1;display:inline-flex;align-items:center;min-height:30px;transition:background .12s,color .12s;}
.wa-sectab:hover{background:#DCF0E5;}
.wa-sectab.on{background:linear-gradient(135deg,#12A85E,#0C7A46);color:#fff;box-shadow:0 2px 8px rgba(12,122,70,.28);}
@media(max-width:640px){.wa-sectab{min-height:40px;padding:8px 16px;}}
/* Quick-filter chips — a light outlined pill row that sifts the current tab
   ("All / Clearing soon / Kept"). Lit chip reuses the same green as the tabs so
   the whole header reads as one control surface. */
/* ---- the top of the shelf: tabs · filters + count · one quiet note ---- */
.ws-tabs.wa-typebar{justify-content:flex-start;flex-wrap:nowrap;overflow-x:auto;gap:8px;margin:0 0 12px;padding:2px 0 4px;scrollbar-width:none;-webkit-overflow-scrolling:touch;}
.ws-tabs.wa-typebar::-webkit-scrollbar{display:none;}
.wa-typebar .ws-tab{flex:0 0 auto;white-space:nowrap;}
.wa-bar{display:flex;align-items:center;justify-content:space-between;gap:8px 16px;flex-wrap:wrap;margin:0 0 10px;min-height:0;}
.wa-search{display:flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--line,#E1DECD);border-radius:999px;padding:0 12px;min-height:36px;color:var(--ink2,#5b6b61);}
.wa-search:focus-within{border-color:var(--green,#0C7A46);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.wa-search input{border:0;outline:0;background:transparent;font:inherit;font-size:13px;color:var(--ink,#14201A);width:190px;min-width:0;}
.wa-qchip{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--green,#0C7A46);background:#EAF6EF;border:1px solid #BFE2CD;border-radius:999px;padding:5px 8px 5px 12px;}
.wa-qchip a{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:999px;color:inherit;}
.wa-qchip a:hover{background:#D5EEDF;}
.wa-noq{font-size:14px;color:var(--ink2,#5b6b61);margin:6px 0 18px;}
@media(max-width:640px){.wa-search{flex:1 1 100%;min-height:44px;}.wa-search input{width:100%;}}
.wa-bar:empty{display:none;}
.wa-autonote{display:flex;align-items:flex-start;gap:7px;margin:-4px 2px 14px;font-size:12.5px;line-height:1.45;color:var(--ink2,#5b6b61);}
.wa-autonote svg{flex:0 0 auto;margin-top:3px;color:var(--green,#0C7A46);}
.wa-autonote a{font-weight:800;color:var(--green,#0C7A46);text-decoration:none;}
.wa-autonote a:hover{text-decoration:underline;}
.wa-count{margin:0;font-size:12.5px;color:var(--ink2,#5b6b61);}
.wa-count a{font-weight:700;color:var(--green,#0C7A46);text-decoration:none;white-space:nowrap;}
.wa-count a:hover{text-decoration:underline;}
.wa-filters{display:flex;flex-wrap:wrap;gap:8px;margin:0;}
@media(max-width:640px){
  /* edge to edge, so the last tab peeks in and says "there is more this way" */
  .ws-tabs.wa-typebar{margin-inline:-16px;padding-inline:16px;}
  .wa-typebar .ws-tab{padding:9px 14px;}
}
.wa-filterchip{display:inline-flex;align-items:center;gap:5px;font-family:Poppins,sans-serif;font-weight:700;font-size:12.5px;color:var(--ink2,#4A554E);background:#fff;border:1px solid var(--line,#E1DECD);border-radius:999px;padding:6px 13px;cursor:pointer;line-height:1;transition:background .12s,color .12s,border-color .12s;}
.wa-filterchip:hover{color:var(--ink,#14201A);border-color:#CFD6C5;}
.wa-filterchip.on{background:#EAF6EF;color:var(--green,#0C7A46);border-color:#BFE2CD;}
/* WHEN chips (2026-11-22) — the date filter. They are links (the window lives in the URL), dressed as the
   chips beside them. The row never wraps: where it is too wide — a phone — it scrolls by ITSELF, edge to
   edge like the tabs above, so the page never scrolls sideways. */
.wa-when{flex-wrap:nowrap;min-width:0;max-width:100%;overflow-x:auto;padding:2px 0;scrollbar-width:none;-webkit-overflow-scrolling:touch;}
.wa-when::-webkit-scrollbar{display:none;}
.wa-when .wa-filterchip{flex:0 0 auto;white-space:nowrap;text-decoration:none;font-variant-numeric:tabular-nums;min-height:30px;box-sizing:border-box;} /* 30px: as tall as the chips beside them, which an icon makes 30 */
@media(max-width:640px){.wa-when{flex:1 1 100%;max-width:none;margin-inline:-16px;padding-inline:16px;}.wa-when .wa-filterchip{min-height:44px;}}
.wa-pick{margin-top:-2px;}
.wa-selbtn{align-self:flex-start;}
.wb-asset.wa-picked{box-shadow:0 0 0 3px var(--green,#0C7A46),0 10px 24px -14px rgba(12,122,70,.55);}
.wa-sel{position:absolute;top:8px;right:8px;z-index:3;width:28px;height:28px;border-radius:50%;border:2px solid #fff;background:rgba(20,32,26,.38);display:grid;place-items:center;color:transparent;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:background .12s,color .12s;}
.wa-sel.on{background:var(--green,#0C7A46);color:#fff;}
.wa-bulk{position:fixed;left:50%;transform:translateX(-50%);bottom:max(16px,env(safe-area-inset-bottom,0px));z-index:10650;display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:min(720px,calc(100vw - 32px));box-sizing:border-box;padding:10px 12px;border-radius:18px;background:#14201A;color:#fff;box-shadow:0 18px 40px -16px rgba(0,0,0,.55);}
.wa-bulk-n{font:800 13.5px/1 Poppins,sans-serif;padding-left:4px;font-variant-numeric:tabular-nums;}
.wa-bulk-link{border:0;background:none;color:#8FE3B4;font:700 12.5px/1 Inter,sans-serif;text-decoration:underline;text-underline-offset:2px;cursor:pointer;min-height:36px;padding:0 4px;}
.wa-bulk-sp{flex:1 1 auto;}
.wa-bulk-btn{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 14px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;font:700 13px/1 Poppins,sans-serif;cursor:pointer;}
.wa-bulk-btn:disabled{opacity:.45;cursor:default;}
.wa-bulk-btn.keep:not(:disabled):hover{background:rgba(143,227,180,.18);}
.wa-bulk-btn.del.armed{background:#B4532A;border-color:#B4532A;}
.wa-bulk-done{min-height:40px;padding:0 14px;border-radius:999px;border:0;background:#fff;color:#14201A;font:800 13px/1 Poppins,sans-serif;cursor:pointer;}
@media(max-width:640px){.wa-bulk{left:16px;right:16px;transform:none;width:auto;}.wa-bulk-sp{display:none;}.wa-bulk-btn,.wa-bulk-done{flex:1 1 auto;justify-content:center;min-height:44px;}}
/* DOWNLOAD in the select bar (2026-11-22). While a go runs the button cannot be tapped, but it is showing
   the progress, so it must stay readable: it takes a lit look, not the dimmed :disabled one. */
.wa-bulk-btn.dl:not(:disabled):hover{background:rgba(143,227,180,.18);}
.wa-bulk-btn.dl.busy:disabled{opacity:1;cursor:progress;color:#8FE3B4;border-color:rgba(143,227,180,.45);background:rgba(143,227,180,.14);}
.wa-bulk-lbl{font-variant-numeric:tabular-nums;}
.wa-bulk-lbl.busy .wa-bulk-idle,.wa-bulk-short{display:none;}
/* On a phone the bar wraps, and a label that changed width when a go started re-wrapped it: the short
   count made Download narrow, Keep slid up beside it — under the thumb that had just tapped Download
   (measured at 390: a second tap on the same spot kept the selection instead). So here the word and the
   count ("3 / 8") share ONE cell, sized by the wider of the two whichever is showing: the button is the
   same width idle and running, and nothing in the bar moves. */
@media(max-width:640px){
  .wa-bulk-lbl{display:inline-grid;justify-items:center;}
  .wa-bulk-lbl > span{grid-area:1/1;}
  .wa-bulk-lbl .wa-bulk-long{display:none;}
  .wa-bulk-lbl .wa-bulk-idle,.wa-bulk-lbl.busy .wa-bulk-idle,.wa-bulk-lbl .wa-bulk-short{display:block;}
  .wa-bulk-lbl.busy .wa-bulk-idle,.wa-bulk-lbl:not(.busy) .wa-bulk-short{visibility:hidden;}
}
.wa-select{position:relative;padding-right:30px;}
.wa-select select{appearance:none;-webkit-appearance:none;border:0;background:transparent;font:inherit;color:inherit;padding:0;margin:0;max-width:220px;cursor:pointer;outline:none;}
.wa-select::after{content:"";position:absolute;right:12px;top:50%;width:6px;height:6px;margin-top:-5px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);opacity:.6;pointer-events:none;}
.wa-select:focus-within{border-color:var(--green,#0C7A46);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.wa-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
@media(max-width:640px){.wa-select select{max-width:150px;}}
.wa-keepall{display:inline-flex;align-items:center;gap:4px;font-weight:700;color:var(--green,#0C7A46);}
.wa-keepall:disabled{opacity:.55;cursor:default;}
.wa-keptmany{color:var(--green,#0C7A46);}
/* An inline text button that reads as a link — for the "Show all" reset on an
   empty filtered view, so it matches the Link styling the notes use. */
.wa-linkbtn{border:0;background:none;padding:0;font:inherit;color:var(--green,#0C7A46);text-decoration:underline;cursor:pointer;}
@media(max-width:640px){.wa-filterchip{min-height:44px;box-sizing:border-box;}}
/* ── 44px tap-target floor (mobile touch). Appended so source order wins over
   the shrunk mobile icon rules above; glyph sizes unchanged, only hit boxes. ── */
@media(max-width:640px){
  .wa-boost{min-height:44px;box-sizing:border-box;display:inline-flex;align-items:center}
  .wa-icon{width:44px;height:44px;border-radius:9px;font-size:13px}
  .wa-jacts .wb-btn{min-height:44px !important;box-sizing:border-box !important}
  .wa-vx{width:44px;height:44px;font-size:14px}
  .wa-vbtn{min-height:44px;box-sizing:border-box}
  .wa-vnav{width:44px;height:44px;font-size:21px}
  /* The floor missed these. The Keep heart was 38px and flush against the 44px close
     button (one ended where the other began) — full size, 6px clear of it, and level
     with it (the close sits at top:8px on a phone; the heart was left at 10). */
  .wa-vheart{width:44px;height:44px;right:58px;top:8px}
  /* The search chip's clear (20px) and the ad pack's Copy (32px) keep their looks and
     get an unseen hit box out to 44px. (Copy is -7, not -6: inset counts from inside
     its 1px border, and -6 measured 42px.) */
  .wa-qchip a{position:relative}
  .wa-qchip a::before{content:"";position:absolute;inset:-12px}
  .wa-copy-row .wa-copy-btn::before{content:"";position:absolute;inset:-7px}
  /* …and the 36px text buttons. (The share Copy is written with its parent: its 36px
     comes from ".wa-share-acts .wa-share-btn", which a bare class would lose to.) */
  .wa-copy-again,.wa-share-acts .wa-share-btn,.wa-share-stop,.wa-read-btn,.wa-bulk-link{min-height:44px;box-sizing:border-box}
}
@media(max-width:620px){
  .wa-creator .ws-tab{min-height:44px;box-sizing:border-box}
}
/* Empty tab — a real empty state, not a bare sentence with an inline link.
   An icon, one line of encouragement, and a prominent deep-linked button into
   the Studio, so a fresh account has an obvious first move. */
.wa-empty{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;background:linear-gradient(178deg,#FEFDF9,#F7F6EB);border:1px solid var(--line2,#D7DCCB);border-radius:18px;padding:40px 24px;}
.wa-empty-ic{display:grid;place-items:center;width:58px;height:58px;border-radius:50%;background:#EAF6EF;border:1px solid #BFE2CD;color:var(--green,#0C7A46);}
.wa-empty-ln{margin:0;font-size:14.5px;color:var(--ink2,#4A554E);max-width:360px;line-height:1.5;}
.wa-empty .wa-empty-cta{margin-top:4px;}
/* Delete / retry toast — a small confirmation that drops in at the bottom,
   fades, and (for delete) offers an Undo while the piece is still recoverable.
   Mirrors the wb-ok palette so it reads as the same system. */
.wa-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:10700;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 32px);background:#14201A;color:#fff;font-size:13.5px;font-weight:600;padding:12px 16px;border-radius:14px;box-shadow:0 14px 40px rgba(10,14,12,.4);animation:waToastIn .18s ease;}
@keyframes waToastIn{from{opacity:0;transform:translate(-50%,10px)}to{opacity:1;transform:translate(-50%,0)}}
.wa-toast .wa-toast-ic{color:#8FE3B4;display:inline-grid;place-items:center;}
.wa-toast-undo{border:0;background:none;color:#FFC24A;font:inherit;font-weight:800;cursor:pointer;padding:4px 6px;text-decoration:underline;flex:0 0 auto;}
@media(max-width:640px){.wa-toast{left:16px;right:16px;transform:none;bottom:16px;}.wa-toast-undo{min-height:44px}@keyframes waToastIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}}
/* ABOVE THE PHONE'S TAB BAR. Up to 760px the app's own navigation is a floating bar across the bottom of
   the screen (web.tsx .wb-bottom — the page keeps 98px clear for it). The Select bar and the toast sat at
   16px from the bottom, UNDER it: with two rows of buttons the bar's lower edge was merely clipped, and
   the third row added on 2026-11-23 ("Add to collection", "Done") could not be tapped at all — measured
   on a 390px screen, the tab bar was the element under both. They now stand on top of that clearance. */
@media(max-width:760px){.wa-bulk,.wa-toast{bottom:calc(98px + env(safe-area-inset-bottom,0px));}}
/* Section hero — softened green band to match Film Studio / Studio / Presenters. */
.ar-cinehead{position:relative;z-index:1;border-radius:18px;padding:20px 24px;margin-bottom:16px;min-height:130px;display:flex;align-items:center;}
.ar-cinehead-bg{position:absolute;inset:0;z-index:0;border-radius:18px;overflow:hidden;background:radial-gradient(135% 130% at 8% -25%,#38815C 0%,#265F45 46%,#1C4E33 100%);box-shadow:0 8px 22px rgba(11,20,15,.16),inset 0 0 0 1px rgba(255,255,255,.1);}
.ar-cinehead-rose{position:absolute;left:-130px;bottom:-170px;width:350px;height:350px;background:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.3;mix-blend-mode:screen;pointer-events:none;will-change:transform;animation:arspin 115s linear infinite;}
@keyframes arspin{to{transform:rotate(-360deg);}}
.ar-cinehead-media{position:absolute;right:0;top:0;bottom:0;width:54%;-webkit-mask-image:linear-gradient(90deg,transparent,#000 44%);mask-image:linear-gradient(90deg,transparent,#000 44%);}
.ar-cinehead-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}
.ar-cinehead-copy{position:relative;z-index:1;flex:1 1 auto;min-width:0;max-width:54%;}
.ar-cinehead-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:800;color:#E7C879;text-transform:uppercase;letter-spacing:.08em;}
.ar-cinehead .wb-h1{color:#fff;text-align:left;margin:7px 0 0;font-size:26px;}
.ar-cinehead .wb-sub{color:rgba(255,255,255,.74);text-align:left;margin:7px 0 0;max-width:360px;}
.ar-cinehead .wb-sub b{color:#fff;}
.ar-cinehead .wb-sub a{color:#E7C879;text-decoration:underline;}
@media(max-width:640px){.ar-cinehead{padding:18px;min-height:118px;}.ar-cinehead .wb-h1{font-size:21px;}.ar-cinehead-copy{max-width:60%;}.ar-cinehead-media{width:52%;}}
@media(prefers-reduced-motion:reduce){.ar-cinehead-rose{animation:none;}}
/* COLLECTIONS + QUEUE (2026-11-22). A native <select> laid invisibly over a chip or a bar button, so a tap
   opens the phone's own picker while the control keeps the look of what sits beside it. */
.wa-pickover{position:relative;overflow:hidden;}
.wa-pickover select{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:16px;border:0;margin:0;padding:0;}
.wa-pickover select:disabled{cursor:default;}
.wa-bulk-btn.wa-pickover.off{opacity:.45;}
.wa-pickover:focus-within{box-shadow:0 0 0 3px rgba(143,227,180,.45);}
.wa-colmanage{align-items:center;flex-wrap:wrap;gap:4px 12px;}
.wa-colmanage .wa-linkbtn{font-weight:700;min-height:30px;}
.wa-coldel{color:#8C2E1B !important;}
.wa-coldel.armed{background:#8C2E1B;color:#fff !important;text-decoration:none;border-radius:999px;padding:0 12px;}
.wa-colrow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0;}
.wa-colchip{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--green,#0C7A46);background:#EAF6EF;border:1px solid #BFE2CD;border-radius:999px;padding:0 4px 0 10px;min-height:30px;box-sizing:border-box;}
.wa-colchip button{position:relative;display:inline-grid;place-items:center;width:22px;height:22px;border:0;border-radius:999px;background:none;color:inherit;cursor:pointer;padding:0;}
.wa-colchip button:hover{background:#D5EEDF;}
.wa-colchip.wa-coladd{color:var(--ink,#14201A);background:#fff;border-style:dashed;border-color:#CFD6C5;padding:0 12px;cursor:pointer;font-family:Poppins,sans-serif;}
button.wa-colchip.wa-coladd{font-size:12px;}
.wa-colform{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 12px;}
.wa-colform input{flex:1 1 160px;min-width:0;min-height:36px;box-sizing:border-box;border:1px solid var(--line,#E1DECD);border-radius:999px;padding:0 14px;font:inherit;font-size:14px;color:var(--ink,#14201A);background:#fff;outline:none;}
.wa-colform input:focus{border-color:var(--green,#0C7A46);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.wa-colform-go{min-height:36px;padding:0 16px;border-radius:999px;border:0;background:var(--green,#0C7A46);color:#fff;font:800 13px/1 Poppins,sans-serif;cursor:pointer;}
.wa-colform-go:disabled{opacity:.5;cursor:default;}
.wa-colform-x{min-height:36px;padding:0 10px;border:0;background:none;color:var(--ink2,#4A554E);font:700 13px/1 Poppins,sans-serif;cursor:pointer;text-decoration:underline;}
.wa-colform-err{flex-basis:100%;margin:0;font-size:12.5px;font-weight:600;color:#8C2E1B;}
.wa-colform.dark{flex-basis:100%;margin:0;}
.wa-colform.dark input{border-color:rgba(255,255,255,.25);}
.wa-colform.dark .wa-colform-x{color:#fff;}
.wa-colform.dark .wa-colform-err{color:#FFC24A;}
.wa-toast-link{color:#8FE3B4;font-weight:800;text-decoration:underline;white-space:nowrap;flex:0 0 auto;padding:4px 6px;}
@media(max-width:640px){
  .wa-colchip,.wa-colmanage .wa-linkbtn,.wa-colform input,.wa-colform-go,.wa-colform-x,.wa-toast-link{min-height:44px;}
  .wa-colchip button::before{content:"";position:absolute;inset:-11px;}
  .wa-toast-link{display:inline-flex;align-items:center;box-sizing:border-box;}
}
`;

/** One shape in the viewer's "Every size" panel: tap → made on the server → a Save link. */
function SizeTile({ assetId, size, title }: { assetId: string; size: AdSize; title: string }) {
  const t = useT();
  const f = useFetcher<{ adsize?: { ok: boolean; size: string; url?: string; error?: string } }>();
  const spec = AD_SIZES[size];
  const res = f.data?.adsize && f.data.adsize.size === size ? f.data.adsize : null;
  const making = f.state !== "idle";
  const fileName = `${(title || "video").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "video"}-${size}.mp4`;
  const shape = <span className="wa-size-shape" style={{ aspectRatio: `${spec.w} / ${spec.h}` }} aria-hidden />;
  if (res?.ok && res.url && !making) {
    return (
      <a className="wa-size ready" href={res.url} download={fileName}>
        {shape}
        <span className="wa-size-txt"><b><Ico n="download" size={13} /> {t("Save {ratio}", { ratio: spec.ratio })}</b><small>{t(spec.where)}</small></span>
      </a>
    );
  }
  return (
    <button type="button" className={`wa-size${making ? " making" : ""}${res && !res.ok ? " err" : ""}`} disabled={making}
      onClick={() => f.submit({ intent: "adsize", assetId, size }, { method: "post" })}>
      {shape}
      <span className="wa-size-txt">
        <b>{making ? t("Making…") : res && !res.ok ? t("Try again") : `${t(spec.label)} ${spec.ratio}`}</b>
        <small>{res && !res.ok && !making ? res.error : t(spec.where)}</small>
      </span>
    </button>
  );
}

/** A file name from a piece's title (letters, digits, spaces → dashes). */
const safeFileBase = (title: string) => (title || "video").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "video";

/** The ad pack's captions file: tap → heard and timed on the server → a Save link. */
function CaptionsTile({ assetId, title }: { assetId: string; title: string }) {
  const t = useT();
  const f = useFetcher<{ adsrt?: { ok: boolean; url?: string; error?: string } }>();
  const res = f.data?.adsrt || null;
  const making = f.state !== "idle";
  const badge = <span className="wa-size-shape wa-badge" aria-hidden>CC</span>;
  if (res?.ok && res.url && !making) {
    return (
      <a className="wa-size ready" href={res.url} download={`${safeFileBase(title)}.srt`}>
        {badge}
        <span className="wa-size-txt"><b><Ico n="download" size={13} /> {t("Save captions (.srt)")}</b><small>{t("Upload it with the video on YouTube, Meta or TikTok")}</small></span>
      </a>
    );
  }
  return (
    <button type="button" className={`wa-size${making ? " making" : ""}${res && !res.ok ? " err" : ""}`} disabled={making}
      onClick={() => f.submit({ intent: "adsrt", assetId }, { method: "post" })}>
      {badge}
      <span className="wa-size-txt">
        <b>{making ? t("Listening…") : res && !res.ok ? t("Try again") : t("Captions file (.srt)")}</b>
        <small>{res && !res.ok && !making ? res.error : t("Every word, timed to the voice")}</small>
      </span>
    </button>
  );
}

/** The ad pack's words: a headline and the primary text written for this piece (free, kept on it), each
 *  with its own Copy, and "Write another" for a different take. */
function AdCopyBlock({ assetId, initial }: { assetId: string; initial: { headline: string; primary: string } | null }) {
  const t = useT();
  const f = useFetcher<{ adcopy?: { ok: boolean; headline?: string; primary?: string; error?: string } }>();
  const writing = f.state !== "idle";
  const got = f.data?.adcopy;
  const copy = got?.ok && got.headline && got.primary ? { headline: got.headline, primary: got.primary } : initial;
  const failed = got && !got.ok ? got.error : null;
  const [copied, setCopied] = useState<string | null>(null);
  const copyText = async (k: string, v: string) => {
    try { await navigator.clipboard.writeText(v); setCopied(k); setTimeout(() => setCopied((c) => (c === k ? null : c)), 1600); } catch { /* clipboard blocked — the text is selectable */ }
  };
  const write = (fresh: boolean) => f.submit({ intent: "adcopy", assetId, ...(fresh ? { fresh: "1" } : {}) }, { method: "post" });
  if (!copy) {
    return (
      <button type="button" className={`wa-size${writing ? " making" : ""}${failed ? " err" : ""}`} disabled={writing} onClick={() => write(false)}>
        <span className="wa-size-shape wa-badge" aria-hidden>Aa</span>
        <span className="wa-size-txt">
          <b>{writing ? t("Writing…") : failed ? t("Try again") : t("Write the ad copy")}</b>
          <small>{failed && !writing ? failed : t("A headline and the main text — free")}</small>
        </span>
      </button>
    );
  }
  const rows = [
    { k: "h", label: t("Headline"), v: copy.headline, max: 40 },
    { k: "p", label: t("Primary text"), v: copy.primary, max: 125 },
  ];
  return (
    <div className={`wa-copy${writing ? " making" : ""}`} aria-busy={writing}>
      {rows.map((r) => (
        <div key={r.k} className="wa-copy-row">
          <div className="wa-copy-top"><span className="wa-copy-lbl">{r.label}</span><span className="wa-copy-n">{r.v.length}/{r.max}</span></div>
          <p className="wa-copy-v">{r.v}</p>
          <button type="button" className="wa-copy-btn" onClick={() => copyText(r.k, r.v)}>{copied === r.k ? t("Copied ✓") : t("Copy")}</button>
        </div>
      ))}
      {failed && !writing && <p className="wa-copy-err">{failed}</p>}
      <button type="button" className="wa-copy-again" disabled={writing} onClick={() => write(true)}>↻ {writing ? t("Writing…") : t("Write another")}</button>
    </div>
  );
}

/** Share link: a public page for this one piece. Made on request; Copy, the phone's own share sheet,
 *  Open, and Stop sharing (which kills every copy of the link). */
function ShareLink({ assetId, title, token }: { assetId: string; title: string; token: string | null }) {
  const t = useT();
  const f = useFetcher<{ share?: { ok: boolean; url?: string | null; error?: string } }>();
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { setOrigin(window.location.origin); setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"); }, []);
  const got = f.data?.share;
  const busy = f.state !== "idle";
  const url = got?.ok ? (got.url ?? null) : token && origin ? `${origin}/s/${assetId}/${token}` : null;
  const err = got && !got.ok ? got.error : null;
  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* the field is selectable */ }
  };
  if (!url) {
    return (
      <button type="button" className={`wa-size${busy ? " making" : ""}${err ? " err" : ""}`} disabled={busy}
        onClick={() => f.submit({ intent: "share", assetId }, { method: "post" })}>
        <span className="wa-size-shape wa-badge" aria-hidden="true"><Ico n="link" size={14} /></span>
        <span className="wa-size-txt">
          <b>{busy ? t("Making the link…") : err ? t("Try again") : t("Make a share link")}</b>
          <small>{err && !busy ? err : t("Anyone with the link can watch it — nothing else of yours")}</small>
        </span>
      </button>
    );
  }
  return (
    <div className="wa-share">
      <input className="wa-share-url" readOnly value={url} aria-label={t("Share link")} onFocus={(e) => e.currentTarget.select()} />
      <div className="wa-share-acts">
        <button type="button" className="wa-copy-btn wa-share-btn" onClick={copy}>{copied ? t("Copied ✓") : t("Copy link")}</button>
        {canShare && <button type="button" className="wa-copy-again" onClick={() => { navigator.share({ title, url }).catch(() => { /* closed */ }); }}>{t("Share…")}</button>}
        <a className="wa-copy-again" href={url} target="_blank" rel="noreferrer">{t("Open")} ↗</a>
        <button type="button" className="wa-share-stop" disabled={busy} onClick={() => f.submit({ intent: "unshare", assetId }, { method: "post" })}>{busy ? t("Stopping…") : t("Stop sharing")}</button>
      </div>
      {err && !busy && <p className="wa-copy-err">{err}</p>}
    </div>
  );
}

/** COLLECTIONS (2026-11-22): the one inline box that asks for a collection's name — a new one (from the
 *  Collections menu, the select bar or an opened piece) or a new name for the open one. Enter saves. */
function ColNameForm({ initial = "", label, busy, error, dark, onSave, onCancel }: { initial?: string; label: string; busy: boolean; error: string | null; dark?: boolean; onSave: (name: string) => void; onCancel: () => void }) {
  const t = useT();
  const [v, setV] = useState(initial);
  return (
    <form className={`wa-colform${dark ? " dark" : ""}`} onSubmit={(e) => { e.preventDefault(); const name = v.trim(); if (name && !busy) onSave(name); }}>
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <input autoFocus value={v} maxLength={40} onChange={(e) => setV(e.target.value)} placeholder={t("Collection name")} aria-label={t("Collection name")} />
      <button type="submit" className="wa-colform-go" disabled={busy || !v.trim()}>{label}</button>
      <button type="button" className="wa-colform-x" onClick={onCancel}>{t("Cancel")}</button>
      {error && <p className="wa-colform-err" role="alert">{error}</p>}
    </form>
  );
}

export default function WebArchive() {
  const t = useT();
  const { section, q, when, whenCounts, assets, stills, cooking, cookingCards, canPost, linkedCount, linked, tokens, hasPlan, cost, totals, nextShow, collections, col } = useLoaderData<typeof loader>();
  const isCreator = section === "creator";
  // Preserve the section across tab links, "show more", and revalidation so the
  // Gallery stays the Gallery.
  const sectionQ = isCreator ? "section=creator" : "";
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  // ?tab= deep link → initial tab.
  const [searchParams, setSearchParams] = useSearchParams();
  const startTab = (["video", "image", "music", "blog", "stills"] as const).find((t) => t === searchParams.get("tab"));
  const [tab, setTab] = useState<ATab>(startTab || "video");
  // Quick-filter within a tab. Up to 600 pieces land here, and the two things a
  // merchant actually hunts for are "what's about to be deleted" (un-kept media
  // on the 30-day clock — oldest = nearest purge) and "what I already saved".
  // "all" is the default; the chips only render when there's something to sift.
  type AFilter = "all" | "clearing" | "kept" | "films" | "faceless";
  const [filter, setFilter] = useState<AFilter>("all");
  // …and by who is in it / what it's for (the menus beside the chips); "" = any
  const [who, setWho] = useState("");
  const [prod, setProd] = useState("");
  // WHEN (2026-11-22): the date filter. The window is the LOADER's — it is applied where the paging is —
  // so its chips are links, and it survives a reload the way the search does. `whenLit` is the chip to
  // light: the one just tapped, at once, not a beat later when the loader has answered.
  const whenOpen = parseWhen(when);
  const whenGoing = nav.state === "loading" && nav.location && typeof window !== "undefined" && nav.location.pathname === window.location.pathname
    ? parseWhen(new URLSearchParams(nav.location.search).get("when"))
    : null;
  const whenLit = whenGoing ?? whenOpen;
  // …and every link that reloads the shelf (search, clear, show older) carries it, so none of them drops it
  const whenQ = whenOpen !== "all" ? `&when=${whenOpen}` : "";
  // COLLECTIONS (2026-11-22): the open collection lives in the URL too (?col=), and every link that reloads
  // the shelf carries it — the When chips, clearing the search, Show older — so the filters work together.
  const colOpen = collections.find((c) => c.id === col) || null;
  const colQ = colOpen ? `&col=${encodeURIComponent(colOpen.id)}` : "";
  const colHref = (id: string) => `?tab=${tab}${whenQ}${q ? `&q=${encodeURIComponent(q)}` : ""}${id ? `&col=${encodeURIComponent(id)}` : ""}${isCreator ? "&section=creator" : ""}`;
  const whenHref = (k: AWhen) => `?tab=${tab}${k !== "all" ? `&when=${k}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}${colQ}${isCreator ? "&section=creator" : ""}`;
  const [viewer, setViewer] = useState<(typeof assets)[number] | null>(null);
  // A PIECE CAN BE OPENED BY ITS ADDRESS: /web/archive?open=<id>. The shell's "… is ready · Watch it" notice
  // (web.tsx → ReadyNotice) links here, so the film that just finished opens in the viewer instead of the
  // member hunting for its card. Once only, for a piece in the list this page loaded (this shop's own); the
  // address is then tidied through the router, keeping every other filter, so a refresh does not re-open it.
  const openId = searchParams.get("open");
  const openedById = useRef(false);
  useEffect(() => {
    if (!openId || openedById.current) return;
    const it = assets.find((a) => a.id === openId);
    if (!it) return; // not among the loaded pieces (yet): the page's own refresh while cooking tries again
    openedById.current = true;
    setViewer(it);
    setSearchParams((p) => { const n = new URLSearchParams(p); n.delete("open"); return n; }, { replace: true, preventScrollReset: true });
  }, [openId, assets]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Every size" panel — closed again whenever a different piece opens
  const [sizesFor, setSizesFor] = useState<string | null>(null);
  // the Share link panel, the same way
  const [shareFor, setShareFor] = useState<string | null>(null);
  const vfullRef = useRef<HTMLVideoElement | null>(null);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  // Landscape (16:9) / square videos need a WIDE viewer, not the portrait stage. Seed from the stored
  // aspect (no flash) then confirm from the real video dimensions on load.
  const [vidWide, setVidWide] = useState(false);
  const [copied, setCopied] = useState(false);
  // The fullscreen viewer portals to document.body (to escape the .wb-main
  // stacking context that otherwise traps its z-index below the shell nav).
  // Portal only after mount so SSR never touches `document`; the viewer only
  // opens on a client click, so `mounted` is always true by the time it shows.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Live tiles: while anything is cooking, refresh the data every 8s so the
  // ETAs count down and finished pieces swap in without a manual reload.
  const revalidator = useRevalidator();
  useEffect(() => {
    if (cooking === 0) return;
    const t = setInterval(() => { if (revalidator.state === "idle") revalidator.revalidate(); }, 8000);
    return () => clearInterval(t);
  }, [cooking, revalidator]);

  const err = actionData && "error" in actionData ? (actionData as { error: string }).error : null;
  const ok = actionData && "ok" in actionData ? (actionData as { ok: string }).ok : null;
  const posted = actionData && "posted" in actionData ? (actionData as { posted: string }).posted : null;
  // actionData survives for the whole page, and the viewer is not closed on a
  // successful post — only on delete/keep/remix. So after posting one piece,
  // opening ANY other piece showed "Posted to … ✓" on it and suppressed its
  // real status chip: the Archive told the merchant something had gone out
  // when it had not, and hid what actually had. Tie the badge to the id the
  // action reported.
  const postedAssetId = actionData && "postedAssetId" in actionData ? (actionData as { postedAssetId: string }).postedAssetId : null;
  const remixed = actionData && "remixed" in actionData ? (actionData as { remixed: string }).remixed : null;
  const remixFree = !!(actionData && "free" in actionData && (actionData as { free?: boolean }).free);
  const draftText = actionData && "draft" in actionData ? (actionData as { draft: string }).draft : null;

  // WHICH piece a viewer action was fired against. actionData.error is global
  // and sticks around for the whole page, so without this an error from acting
  // on piece A kept showing — and suppressed the real status chip — on piece B
  // when the merchant cycled to it. Scope the inline error to this id, exactly
  // the way postedAssetId scopes the "Posted ✓" badge. Reset on viewer change.
  const [actedId, setActedId] = useState<string | null>(null);

  const retryJob = (jobId: string) => submit({ intent: "retryJob", jobId }, { method: "post" });
  const dismissJob = (jobId: string) => submit({ intent: "dismissJob", jobId }, { method: "post" });
  const keepAsset = (assetId: string) => { setActedId(assetId); submit({ intent: "keep", assetId }, { method: "post" }); };
  const unkeepAsset = (assetId: string) => { setActedId(assetId); submit({ intent: "unkeep", assetId }, { method: "post" }); };
  const deleteAsset = (assetId: string) => submit({ intent: "delete", assetId }, { method: "post" });
  const remix = (assetId: string) => { setActedId(assetId); submit({ intent: "remix", assetId }, { method: "post" }); };
  // Delete is permanent and the trash icons are small and easy to mis-tap, so
  // guard it behind a confirm: the first tap arms the button, a second tap
  // within 4s actually deletes. Arming auto-clears so a stray tap is harmless.
  const [armedDel, setArmedDel] = useState<string | null>(null);
  useEffect(() => {
    if (!armedDel) return;
    const timer = setTimeout(() => setArmedDel(null), 4000);
    return () => clearTimeout(timer);
  }, [armedDel]);
  // A small confirmation that fades, with an Undo for delete while the piece is
  // still recoverable. `undo` runs on the Undo tap; `pending` is the timer that
  // fires the real server delete once the window closes un-undone.
  // (`ms`, 2026-11-22: a toast with more to read — the select bar's Download — says how long it stays;
  //  every toast that does not, stays exactly as long as it did.)
  // (`link`, 2026-11-22: the queue's confirmation carries "See the queue".)
  const [toast, setToast] = useState<{ msg: string; undo?: () => void; pending?: ReturnType<typeof setTimeout>; ms?: number; link?: { to: string; label: string } } | null>(null);
  useEffect(() => {
    if (!toast) return;
    // Undo-able toasts linger until their delete actually commits (6s); plain
    // confirmations clear on their own after 3s.
    const timer = setTimeout(() => setToast(null), toast.ms ?? (toast.undo ? 6200 : 3000));
    return () => clearTimeout(timer);
  }, [toast]);
  // DELETE WITH UNDO. The grid/viewer trash is permanent, so the second ("armed")
  // tap does NOT hit the server right away — it closes the piece, shows an Undo
  // toast, and only submits the delete after a short window. Undo cancels the
  // pending submit, so nothing is ever lost to a mis-tap. All client-side: the
  // action still hard-deletes, we just hold the trigger for a beat.
  // (Which is why the armed tooltip on the four trash / Delete buttons that call this no longer
  //  reads "can't be undone": it was said right above a 5-second Undo.)
  const askDelete = (assetId: string) => {
    if (armedDel !== assetId) { setArmedDel(assetId); return; }
    setArmedDel(null);
    setViewer(null); // close the piece being deleted (old flow closed it too)
    const pending = setTimeout(() => { setToast(null); deleteAsset(assetId); }, 5000);
    setToast({
      msg: t("Deleted."),
      pending,
      undo: () => { clearTimeout(pending); setToast({ msg: t("Restored.") }); },
    });
  };
  // Retry a failed job and confirm it with the same toast system (no undo —
  // nothing destructive to reverse, just a "back in the oven" acknowledgement).
  const retryWithToast = (jobId: string) => { retryJob(jobId); setToast({ msg: t("Retrying — back in the oven.") }); };

  // SELECT MODE — review many pieces at once (the Dashboard's "256 to review" had no fast way through):
  // tap pieces to pick them, then Keep or Delete them together. Delete is armed (a second tap) and held
  // behind the same Undo window as a single delete; posted pieces are never bulk-deleted (the server
  // skips them — their click tracking and boost links live on them).
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [armBulk, setArmBulk] = useState(false);
  useEffect(() => { if (!armBulk) return; const tm = setTimeout(() => setArmBulk(false), 4000); return () => clearTimeout(tm); }, [armBulk]);
  const togglePick = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const endSelect = () => { setSelecting(false); setPicked(new Set()); setArmBulk(false); };
  // THE TOAST CLEARS THE SELECT BAR, HOWEVER TALL THE BAR IS (2026-11-22). It sat a fixed 96px up, which
  // clears a bar of one row — a wide screen. On a phone the bar wraps to two rows, and the toast landed ON
  // its first row (measured at 390: "Kept 1 piece." over "N selected · Select all · Keep") — which is now
  // where Download shows its progress. So the bar's top edge is measured, and the toast sits 16px above
  // it; where 96px already cleared the bar, it is 96px still.
  const bulkRef = useRef<HTMLDivElement | null>(null);
  const [bulkTop, setBulkTop] = useState(0); // px from the bottom of the screen to the top of the bar
  useEffect(() => {
    const el = bulkRef.current;
    if (!selecting || !el) { setBulkTop(0); return; }
    const measure = () => setBulkTop(Math.round(window.innerHeight - el.getBoundingClientRect().top));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [selecting]);
  const keepPicked = () => { const ids = [...picked]; if (!ids.length) return; submit({ intent: "keepMany", assetIds: ids.join(",") }, { method: "post" }); setToast({ msg: ids.length === 1 ? t("Kept 1 piece.") : t("Kept {n} pieces.", { n: ids.length }) }); setPicked(new Set()); };
  const deletePicked = () => {
    const ids = [...picked];
    if (!ids.length) return;
    if (!armBulk) { setArmBulk(true); return; }
    setArmBulk(false);
    setPicked(new Set());
    const pending = setTimeout(() => { setToast(null); submit({ intent: "deleteMany", assetIds: ids.join(",") }, { method: "post" }); }, 5000);
    setToast({ msg: ids.length === 1 ? t("Deleted 1 piece.") : t("Deleted {n} pieces.", { n: ids.length }), pending, undo: () => { clearTimeout(pending); setPicked(new Set(ids)); setToast({ msg: t("Restored.") }); } });
  };

  // COLLECTIONS (2026-11-22) — named shelves. Every change goes through ONE fetcher to this route's action
  // (colCreate / colAdd / colRemove / colRename / colDelete), so the shelf and the counts reload after it
  // and the page's own actionData — the viewer's post and remix messages — is left alone. `colForm` is the
  // one inline name box that may be open (a new collection from the menu, the bar or a piece; or a rename).
  const navigate = useNavigate();
  const colById = new Map(collections.map((c) => [c.id, c] as const));
  const colFetcher = useFetcher<{ col?: { ok: true; op: string; id: string; name: string; n: number } | { ok: false; op: string; error: string } }>();
  const colBusy = colFetcher.state !== "idle";
  const [colForm, setColForm] = useState<null | "filter" | "bulk" | "viewer" | "rename">(null);
  const [colErr, setColErr] = useState<string | null>(null);
  const [armColDel, setArmColDel] = useState(false);
  useEffect(() => { if (!armColDel) return; const tm = setTimeout(() => setArmColDel(false), 4000); return () => clearTimeout(tm); }, [armColDel]);
  const colSubmit = (data: Record<string, string>) => { setColErr(null); colFetcher.submit(data, { method: "post" }); };
  const askColForm = (which: "filter" | "bulk" | "viewer" | "rename") => { setColErr(null); setArmColDel(false); setColForm(which); };
  // an opened piece's name box closes when another piece opens (or the viewer closes); the bar's, when selecting ends
  useEffect(() => { setColForm((f) => (f === "viewer" ? null : f)); }, [viewer?.id]);
  useEffect(() => { if (!selecting) setColForm((f) => (f === "bulk" ? null : f)); }, [selecting]);
  // choosing a collection (or none) is a new shelf from the server, like a When chip: it ends a selection
  const openCol = (id: string) => { endSelect(); setColForm(null); setArmColDel(false); navigate(colHref(id), { preventScrollReset: true }); };
  const deleteCol = () => {
    if (!colOpen) return;
    if (!armColDel) { setArmColDel(true); return; }
    setArmColDel(false);
    colSubmit({ intent: "colDelete", collectionId: colOpen.id });
  };
  // An answer is acted on ONCE, when its fetcher has gone idle. (A fetcher's `data` arrives while it is
  // still "loading" the page again, and going idle does not change `data` — so an effect on the data alone
  // ran once, too early, and the name box stayed open over a collection that had been made.)
  const colAnswered = useRef<unknown>(null);
  useEffect(() => {
    const r = colFetcher.data?.col;
    if (!r || colFetcher.state !== "idle" || colAnswered.current === colFetcher.data) return;
    colAnswered.current = colFetcher.data;
    if (!r.ok) { if (colForm) setColErr(r.error); else setToast({ msg: r.error }); return; }
    setColForm(null);
    setColErr(null);
    if ((r.op === "colAdd" || r.op === "colRemove") && selecting) setPicked(new Set());
    if (r.op === "colCreate") { openCol(r.id); return; } // made from the menu: open it (its empty state says how to fill it)
    if (r.op === "colDelete") { setSelecting(false); setPicked(new Set()); navigate(colHref(""), { preventScrollReset: true }); }
    setToast({ msg: t(colSay(r.op, r.n), { n: r.n, name: r.name }) });
  }, [colFetcher.data, colFetcher.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const addPickedTo = (target: { collectionId: string } | { newName: string }) => {
    const ids = [...picked];
    if (!ids.length) return;
    colSubmit({ intent: "colAdd", ...target, assetIds: ids.join(",") });
  };
  const removePicked = () => {
    const ids = [...picked];
    if (!ids.length || !colOpen) return;
    colSubmit({ intent: "colRemove", collectionId: colOpen.id, assetIds: ids.join(",") });
  };

  // ADD TO QUEUE (2026-11-22) — the posting queue is the Auto-post page's (POST /web/autopost, intent
  // queueAdd); this page only hands it pieces and says what came back. Videos and image ads only.
  const queueFetcher = useFetcher<QueueAnswer>();
  const queueBusy = queueFetcher.state !== "idle";
  const queueIds = (ids: string[]) => queueFetcher.submit({ intent: "queueAdd", assetIds: ids.join(",") }, { method: "post", action: "/web/autopost" });
  const queueAnswered = useRef<unknown>(null);
  useEffect(() => {
    const a = queueFetcher.data;
    if (!a || queueFetcher.state !== "idle" || queueAnswered.current === a) return; // once, when idle — see colAnswered
    queueAnswered.current = a;
    const said = queueSay(a, !("error" in a) && a.firstDueAt ? queueWhen(a.firstDueAt, Date.now()) : "");
    if ("error" in said) { setToast({ msg: said.error, ms: 6000 }); return; }
    if (selecting) setPicked(new Set());
    setToast({ msg: said.parts.map((x) => t(x.s, x.p)).join(" "), link: { to: "/web/autopost", label: t("See the queue") }, ms: 8000 });
  }, [queueFetcher.data, queueFetcher.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Editable caption preview: "Post to socials" opens one caption box pre-filled
  // with an AI suggestion (intent "draft") the merchant can tweak or post as-is.
  const [capOpen, setCapOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [draftPending, setDraftPending] = useState(false);
  const startPost = (assetId: string) => { setActedId(assetId); setCaption(""); setCapOpen(true); setDraftPending(true); submit({ intent: "draft", assetId }, { method: "post" }); };
  const doPost = (assetId: string) => { setActedId(assetId); submit({ intent: "post", assetId, caption }, { method: "post" }); };
  // KEYED ON THE ANSWER, NOT ON ITS TEXT. Captions are cached per piece, so a second "Post to socials"
  // on the same piece brings back the identical string: an effect keyed on the string did not run again,
  // and the box sat disabled on "Writing a caption for you…" with Post now dead. Every answer is a new
  // object, so the same words still land. A draft that came back as an error stuck the same way — it
  // ends the wait too: the box opens empty to type in, with the reason shown beside the title.
  useEffect(() => {
    if (draftText != null) { setCaption(draftText); setDraftPending(false); }
    else if (err != null) setDraftPending(false);
  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps
  // Reset per-piece UI when the viewer opens or cycles to another piece. armedDel
  // MUST reset here too: without it, arming a grid tile's trash and then opening
  // that piece left the viewer's full-width Delete already armed — a single tap
  // destroyed it with no confirm. Clearing it means the viewer's Delete always
  // starts disarmed (tap once to arm, again to delete), like a fresh open.
  useEffect(() => { setCapOpen(false); setCaption(""); setDraftPending(false); setCopied(false); setArmedDel(null); setActedId(null); }, [viewer?.id]);
  // Open video pieces PLAYING WITH SOUND. Browsers override the HTML `autoplay`
  // attribute for *unmuted* media (anti-annoyance policy), so the viewer would
  // otherwise sit paused + silent on the first frame. We call play() imperatively
  // on open — still inside the tile-tap's activation window, where sound IS
  // allowed. If a strict browser (e.g. iOS) still refuses, fall back to muted
  // playback + a one-tap "Tap for sound" nudge instead of a dead, silent frame.
  useEffect(() => {
    setNeedsUnmute(false);
    setVidWide(viewer?.aspect === "16:9" || viewer?.aspect === "1:1"); // seed from stored shape; refined on load
    if (!viewer?.isVideo || !viewer.media) return;
    const v = vfullRef.current;
    if (!v) return;
    try { v.muted = false; } catch { /* */ }
    const p = v.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        try { v.muted = true; v.play().catch(() => { /* controls remain */ }); setNeedsUnmute(true); } catch { /* */ }
      });
    }
  }, [viewer?.id, viewer?.isVideo, viewer?.media]);
  useEffect(() => { if (posted) setCapOpen(false); }, [posted]);
  // Close the viewer once a piece is deleted, or when a remix starts (so the
  // fresh "cooking…" tile is visible under the auto-revalidator). KEEP does NOT
  // close it — the merchant tapped the heart to save the piece they're looking
  // at, so backing them out is jarring. Instead flip the open viewer to kept in
  // place (heart fills gold, chip reads Kept, the clears-in countdown drops);
  // the grid tile behind updates on the revalidation the submit already fires.
  useEffect(() => {
    if (actionData && ("deleted" in actionData || "remixed" in actionData)) setViewer(null);
    else if (actionData && "kept" in actionData) setViewer((v) => (v ? { ...v, status: "APPROVED" } : v));
    else if (actionData && "unkept" in actionData) setViewer((v) => (v ? { ...v, status: "PENDING" } : v));
    // A POST does not close the viewer either, and the open piece kept the status it was opened with —
    // so its heart stayed live on a piece that had just gone out (see the "keep" action). Flip it to
    // posted in place: the heart locks gold and the chip reads Posted. Only the piece the action names.
    else if (postedAssetId) setViewer((v) => (v && v.id === postedAssetId ? { ...v, status: "PUBLISHED" } : v));
  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps

  const shelf = tab === "stills" ? stills : assets.filter((a) => A_KIND[a.type] === tab);
  // The true library count for the open tab, so the note under the shelf
  // matches the number on the tab itself.
  const tabTotal = totals?.[tab] ?? shelf.length;
  // Quick-filter counts come off the full tab shelf (not the filtered view), so
  // a chip can say how many it holds. "Clearing soon" = un-kept media on the
  // 30-day clock (daysLeft is only set for video/image); "Kept" = saved or
  // already posted. The chip row only shows on video/image, where clearing is a
  // real concept and the volume lives.
  const isKept = (a: { status: string }) => a.status === "APPROVED" || a.status === "PUBLISHED";
  const clearingCount = shelf.filter((a) => a.daysLeft != null).length;
  const keptCount = shelf.filter((a) => isKept(a)).length;
  // Films / Faceless only when the Videos tab holds a MIX (a chip that matches everything is noise).
  const filmCount = tab === "video" ? shelf.filter((a) => a.group === "film").length : 0;
  const facelessCount = tab === "video" ? shelf.filter((a) => a.group === "faceless").length : 0;
  const showFilms = filmCount > 0 && filmCount < shelf.length;
  const showFaceless = facelessCount > 0 && facelessCount < shelf.length;
  const canFilter = (tab === "video" || tab === "image" || tab === "stills") && (clearingCount > 0 || keptCount > 0 || showFilms || showFaceless);
  // What actually renders + what the viewer arrows cycle through. Pagination and
  // the empty state stay on the unfiltered `shelf` — they describe the library,
  // not the chip. Oldest-first would bury the nearest-purge pieces, so the
  // default desc order already puts "clearing soon" where the merchant expects.
  // Who's in it / what it's for: the presenters and products this tab holds, most-used first.
  const optsOf = (key: "presenter" | "product"): Array<[string, number]> => {
    const m = new Map<string, number>();
    for (const a of shelf) { const v = a.details?.[key]; if (v) m.set(v, (m.get(v) || 0) + 1); }
    return [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  };
  const whoOpts = optsOf("presenter");
  const prodOpts = optsOf("product");
  const visibleShelf = (!canFilter || filter === "all"
    ? shelf
    : filter === "clearing"
      ? shelf.filter((a) => a.daysLeft != null)
      : filter === "films"
        ? shelf.filter((a) => a.group === "film")
        : filter === "faceless"
          ? shelf.filter((a) => a.group === "faceless")
          : shelf.filter((a) => isKept(a)))
    .filter((a) => (!who || a.details?.presenter === who) && (!prod || a.details?.product === prod));
  // "Keep all": what is on the clock in the open tab, saved in one tap.
  const clearingIds = shelf.filter((a) => a.daysLeft != null).map((a) => a.id);
  const keepAll = () => submit({ intent: "keepMany", assetIds: clearingIds.join(",") }, { method: "post" });
  const keptManyN = actionData && "keptMany" in actionData ? Number((actionData as { keptMany?: unknown }).keptMany) || 0 : 0;
  // a bulk delete never takes a posted piece — say so when some were left
  const skippedPosted = actionData && "skippedPosted" in actionData ? Number((actionData as { skippedPosted?: unknown }).skippedPosted) || 0 : 0;
  useEffect(() => {
    if (skippedPosted > 0) setToast({ msg: skippedPosted === 1 ? t("1 posted piece was kept — delete posted pieces one at a time.") : t("{n} posted pieces were kept — delete posted pieces one at a time.", { n: skippedPosted }) });
  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps

  // DOWNLOAD THE SELECTION (2026-11-22) — the select bar's third thing to do with what is picked. No zip
  // and no server route: the browser's own download, one file after another (an <a download> clicked for
  // each, DL_GAP_MS apart so none is swallowed), named from the piece's title. What is saved, what is
  // skipped and where one go stops is downloadPlan's call (the pure part, above). The selection is NOT
  // cleared: people download, then keep or delete the same pieces.
  const [dl, setDl] = useState<{ i: number; n: number } | null>(null);
  const dlRunning = useRef(false);
  const dlSay = (parts: Array<{ s: string; n: number }>) => parts.map((p) => t(p.s, { n: p.n })).join(" ");
  const downloadPicked = async () => {
    if (dlRunning.current || !picked.size) return;
    // in the order the page shows them, so "the first 20" are the 20 nearest the top
    const plan = downloadPlan(shelf.filter((a) => picked.has(a.id)));
    if (!plan.files.length) {
      if (plan.skipped) setToast({ msg: dlSay(dlSummary(0, plan.skipped, 0)), ms: 6000 });
      return;
    }
    dlRunning.current = true;
    // more picked than one go takes: say so now, and leave it up for as long as the go runs
    if (plan.over > 0) setToast({ msg: t("Downloading the first {n} — select fewer to get the rest.", { n: plan.files.length }), ms: 600_000 });
    let started = 0;
    let failed = 0;
    try {
      for (let i = 0; i < plan.files.length; i++) {
        const f = plan.files[i];
        setDl({ i: i + 1, n: plan.files.length });
        try {
          if (dlSameOrigin(f.url, window.location.origin)) clickDownload(f.url, f.name);
          else {
            // ANOTHER SITE'S FILE (a fresh render still at its provider's address). An <a download> to it
            // is not obeyed: the browser OPENS the file — in this tab, which ends the go and the page. So
            // its bytes are pulled first and saved from memory, the way the Studio saves a staged result.
            // A host that will not hand them over is counted and said; it is never opened in a tab.
            const res = await fetch(f.url, { mode: "cors", signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(300_000) : undefined });
            if (!res.ok) throw new Error(String(res.status));
            const blobUrl = URL.createObjectURL(await res.blob());
            clickDownload(blobUrl, f.name);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
          }
          started++;
        } catch { failed++; }
        await new Promise((r) => setTimeout(r, DL_GAP_MS));
      }
    } finally {
      dlRunning.current = false;
      setDl(null);
    }
    setToast({ msg: dlSay(dlSummary(started, plan.skipped, failed)), ms: 6000 });
  };
  const vIdx = viewer ? visibleShelf.findIndex((c) => c.id === viewer.id) : -1;
  const openAt = (idx: number) => { const n = visibleShelf[(idx % visibleShelf.length + visibleShelf.length) % visibleShelf.length]; if (n) setViewer(n); };
  // Keyboard: Escape closes, arrows cycle the current tab's pieces.
  // The handler reads the shelf + index off a ref so the listener can bind ONCE
  // per open piece instead of re-binding every render — visibleShelf is a fresh
  // array each render (shelf itself is assets.filter(...)), so depending on it
  // defeated the point. The ref is refreshed each render (free) and the effect
  // only re-runs when the open piece changes identity.
  const navRef = useRef({ shelf: visibleShelf, vIdx });
  navRef.current = { shelf: visibleShelf, vIdx };
  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setViewer(null); return; }
      const { shelf: s, vIdx: i } = navRef.current;
      if (s.length < 2 || i < 0) return;
      const goTo = (idx: number) => { const n = s[(idx % s.length + s.length) % s.length]; if (n) setViewer(n); };
      if (e.key === "ArrowLeft") goTo(i - 1);
      else if (e.key === "ArrowRight") goTo(i + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer?.id]);

  const chipFor = (a: { type: string; status: string }): [string, string] =>
    a.type === "BLOG_POST"
      ? a.status === "PUBLISHED" ? ["posted", t("Published")] : a.status === "APPROVED" ? ["kept", t("Kept")] : ["new", t("Ready")]
      : a.status === "PUBLISHED" ? ["posted", t("Posted")] : a.status === "APPROVED" ? ["kept", t("Kept")] : ["new", t("New")];
  const costOf = (t: string) => (t === "VIDEO_AD" ? cost.video : t === "IMAGE_AD" ? cost.image : t === "AUDIO" ? cost.music : cost.blog);
  const copyHtml = (html: string) => { navigator.clipboard.writeText(html).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => { /* ignore */ }); };
  const downloadHtml = (title: string, html: string) => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "article").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "article"}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // a search narrows the cooking and failed cards too, by the same title the finished piece will carry
  const qMatch = (title: string) => !q || title.toLowerCase().includes(q.toLowerCase());
  // (2026-11-22) …and a piece still being made is on no collection yet, so none show while one is open
  const genCards = colOpen ? [] : cookingCards.filter((j) => j.kind === tab && j.status === "generating" && qMatch(j.productTitle));
  const failCards = colOpen ? [] : cookingCards.filter((j) => j.kind === tab && j.status === "failed" && qMatch(j.productTitle));

  // WHEN, and a window with nothing in it (2026-11-22). An empty WINDOW is not an empty library: where
  // the open tab has pieces from other days, the shelf says which window is empty and offers the way back
  // — not "No videos yet", and not "Nothing here matches" when it is the day, not the search word, that
  // leaves it bare. `tabEver` is this tab's count whatever the window (the search still applied). A piece
  // being made right now is about to land in every window, so nothing is said over a cooking tile.
  const tabEver = whenCounts?.all?.[tab] ?? tabTotal;
  const whenEmpty = whenOpen !== "all" && shelf.length === 0 && tabTotal === 0 && tabEver > 0 && genCards.length === 0;
  // The chips show wherever the open tab has something to sift by date — and while a window is on (the way back).
  const showWhen = whenOpen !== "all" || tabEver > 0;
  // COLLECTIONS: an open collection with nothing of this tab's kind on it, at any time — its own empty state
  // (how to fill it, and the way back), never "No videos yet — open the Studio".
  const colEmpty = !!colOpen && !q && !whenEmpty && shelf.length === 0 && tabTotal === 0 && tabEver === 0;
  // the open piece's collections, from the freshest data (the viewer holds the piece as it was when opened)
  const viewerCols = viewer ? (([...assets, ...stills].find((a) => a.id === viewer.id) ?? viewer).cols || []).map((id) => colById.get(id)).filter((c): c is (typeof collections)[number] => !!c) : [];
  const queuePicked = () => {
    const ids = queueableIds(shelf.filter((a) => picked.has(a.id)));
    if (!ids.length) { setToast({ msg: t("Only videos and image ads can be queued.") }); return; }
    queueIds(ids);
  };

  return (
    <div className={isCreator ? "wa-creator" : undefined}>
      <style dangerouslySetInnerHTML={{ __html: WA_CSS }} />
      <div className="ar-cinehead">
        <span className="ar-cinehead-bg" aria-hidden="true">
          <span className="ar-cinehead-rose" />
          <span className="ar-cinehead-media"><HeroVideo name="archive" still={4} clip={5} className="ar-cinehead-img" /></span>
        </span>
        <div className="ar-cinehead-copy">
          <span className="ar-cinehead-eyebrow"><Ico n="box" size={13} /> {t("Your library")}</span>
          <h1 className="wb-h1">{t("Your Archive")}</h1>
          {/* ONE unified archive (owner 11-01) — the Creator/Marketing toggle was
              removed; everything the shop has made lives in a single list. */}
          <p className="wb-sub">
            {t("Everything you've made")} — {t("tap a piece to watch it big, keep it, download it")}{canPost ? (linkedCount > 1 ? t(", or post it to your {n} linked accounts", { n: linkedCount }) : t(", or post it to your {n} linked account", { n: linkedCount })) : ""}.
            {cooking > 0 && <> · <b>{cooking > 1 ? t("{n} pieces cooking below", { n: cooking }) : t("{n} piece cooking below", { n: cooking })}</b> — {t("this page updates itself.")}</>}
          </p>
        </div>
      </div>
      {!canPost
        ? <p className="wa-autonote"><Ico n="rocket" size={13} /> <span>{t("Want one-tap posting?")} <Link to="/web/connect">{t("Link your socials")}</Link> · <Link to="/web/autopost">{t("See everything that can post itself")}</Link></span></p>
        : <p className="wa-autonote"><Ico n="rocket" size={13} /> <span><Link to="/web/autopost">{t("Auto-post")}</Link> — {t("channels and campaigns that post themselves.")}</span></p>}
      {!hasPlan && <p className="wa-wallet">{t("Pick a plan to generate.")}</p>}
      {err && !viewer && <div className="wb-err">{err}</div>}
      {ok && <div className="wb-ok">{ok}</div>}
      {remixed && (
        <div className="wb-ok">
          <Ico n="sparkle" /> {remixFree ? t("Making it again, on us") : t("Remixing")} — {t("a fresh {kind} is on the way. It'll land on this shelf in a minute.", { kind: remixed === "blog" ? t("article") : remixed })}{remixFree ? t(" No tokens spent.") : ""}
        </div>
      )}
      <div className="ws-tabs wa-typebar">
        {/* (2026-11-22: the Scenes & Portraits tab is there whenever the library has any — counted for ALL
            time, so an empty window reads "· 0" on it instead of taking the tab away from under the reader) */}
        {([["video", "video", t("Videos")], ["image", "image", t("Images")], ["music", "music", t("Music")], ["blog", "article", t("Articles")], ...((whenCounts?.all?.stills ?? totals?.stills ?? 0) > 0 ? [["stills", "film", t("Scenes & Portraits")]] : [])] as [ATab, string, string][]).map(([k, icon, label]) => {
          // Count the whole library, not the slice we happened to render —
          // this used to read off `assets`, so a truncated page under-reported
          // how much the merchant actually owned.
          // …plus what is being made right now (it is about to be a piece). A job that FAILED is not one:
          // counting its card made the tab say "Videos · 115" over a shelf that said "57 of 111".
          const n = (totals?.[k] ?? assets.filter((a) => A_KIND[a.type] === k).length)
            + (colOpen ? 0 : cookingCards.filter((j) => j.kind === k && j.status === "generating").length);
          return (
            <button type="button" key={k} className={`ws-tab${tab === k ? " on" : ""}`} onClick={() => { setTab(k); setFilter("all"); setWho(""); setProd(""); endSelect(); }}>
              <Ico n={icon} /> {label} · {n}
            </button>
          );
        })}
      </div>
      {/* Quick-filters within a tab, so a library of hundreds isn't a single
          doom-scroll. "Clearing soon" surfaces exactly the un-kept media on the
          30-day clock (what a merchant comes here to rescue); "Kept" is the
          saved shelf. Only shows when there's actually something to sift. */}
      {/* One line under the tabs: the quick filters on the left, how much is showing (and the way to
          older pieces) on the right — they used to be four separate rows stacked down the page. */}
      <div className="wa-bar">
        <Form method="get" className="wa-search" role="search" preventScrollReset>
          {isCreator && <input type="hidden" name="section" value="creator" />}
          <input type="hidden" name="tab" value={tab} />
          {/* (2026-11-22) a search keeps the open When window — and clearing the search keeps it too */}
          {whenOpen !== "all" && <input type="hidden" name="when" value={whenOpen} />}
          {/* …and the open collection */}
          {colOpen && <input type="hidden" name="col" value={colOpen.id} />}
          <Ico n="search" />
          <input type="search" name="q" defaultValue={q} key={q} maxLength={80} placeholder={t("Search your pieces")} aria-label={t("Search your pieces")} />
        </Form>
        {q && (
          <span className="wa-qchip">
            {t("Results for “{q}”", { q })}
            <Link to={`?tab=${tab}${whenQ}${colQ}${isCreator ? "&section=creator" : ""}`} preventScrollReset aria-label={t("Clear")}><Ico n="x" size={12} /></Link>
          </span>
        )}
        {/* COLLECTIONS: the open collection is NOT repeated here as a chip. It was, on the first day
            (2026-11-23) — and the page then named it three times: this chip, the Collections menu showing it
            selected, and the line under the filters that counts it. The menu chooses and the line below
            manages (with "Show all" to leave); one fewer row on a phone. */}
        {/* WHEN (2026-11-22) — All time · Today · This week · This month, each with how many of the open
            tab's pieces it holds. Links, not buttons: the window lives in the URL and the loader applies
            it (where the paging is), so it combines with the search and the chips beside it and survives
            a reload. A new window is a new shelf from the server, so — like changing tab — it ends a
            selection rather than leave pieces picked that are no longer on the page. */}
        {showWhen && (
          <div className="wa-filters wa-when" role="group" aria-label={t("Filter by date")}>
            {WHEN_KEYS.map((k) => {
              const n = whenCounts?.[k]?.[tab];
              return (
                <Link key={k} to={whenHref(k)} preventScrollReset className={`wa-filterchip${whenLit === k ? " on" : ""}`} aria-current={whenLit === k ? "true" : undefined} onClick={endSelect}>
                  {t(WHEN_LABEL[k])}{n != null ? ` · ${n}` : ""}
                </Link>
              );
            })}
          </div>
        )}
        {canFilter && (
          <div className="wa-filters" role="group" aria-label={t("Filter pieces")}>
            <button type="button" className={`wa-filterchip${filter === "all" ? " on" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("All")} · {shelf.length}</button>
            {showFilms && (
              <button type="button" className={`wa-filterchip${filter === "films" ? " on" : ""}`} aria-pressed={filter === "films"} onClick={() => setFilter("films")}><Ico n="film" /> {t("Films")} · {filmCount}</button>
            )}
            {showFaceless && (
              <button type="button" className={`wa-filterchip${filter === "faceless" ? " on" : ""}`} aria-pressed={filter === "faceless"} onClick={() => setFilter("faceless")}><Ico n="mic" /> {t("Faceless")} · {facelessCount}</button>
            )}
            {clearingCount > 0 && (
              <button type="button" className={`wa-filterchip${filter === "clearing" ? " on" : ""}`} aria-pressed={filter === "clearing"} onClick={() => setFilter("clearing")}><Ico n="hourglass" /> {t("Clearing soon")} · {clearingCount}</button>
            )}
            {keptCount > 0 && (
              <button type="button" className={`wa-filterchip${filter === "kept" ? " on" : ""}`} aria-pressed={filter === "kept"} onClick={() => setFilter("kept")}><Ico n="heart" /> {t("Kept")} · {keptCount}</button>
            )}
          </div>
        )}
        {/* Who's in it and what it's for — a menu each, when the open tab has more than one of them. */}
        {/* (2026-11-22) …and which collection — a third menu, there once the shop has a collection. */}
        {(whoOpts.length > 1 || prodOpts.length > 1 || who || prod || collections.length > 0) && (
          <div className="wa-filters wa-pick" role="group" aria-label={t("Filter by presenter, product or collection")}>
            {(whoOpts.length > 1 || who) && (
              <label className={`wa-filterchip wa-select${who ? " on" : ""}`}>
                <Ico n="presenter" /> <span className="wa-sr">{t("Presenter")}</span>
                <select value={who} onChange={(e) => setWho(e.target.value)} aria-label={t("Presenter")}>
                  <option value="">{t("Any presenter")}</option>
                  {whoOpts.map(([v, n]) => <option key={v} value={v}>{v} · {n}</option>)}
                </select>
              </label>
            )}
            {(prodOpts.length > 1 || prod) && (
              <label className={`wa-filterchip wa-select${prod ? " on" : ""}`}>
                <Ico n="box" /> <span className="wa-sr">{t("Product")}</span>
                <select value={prod} onChange={(e) => setProd(e.target.value)} aria-label={t("Product")}>
                  <option value="">{t("Any product")}</option>
                  {prodOpts.map(([v, n]) => <option key={v} value={v}>{v.length > 42 ? `${v.slice(0, 40)}…` : v} · {n}</option>)}
                </select>
              </label>
            )}
            {/* COLLECTIONS (2026-11-22): each collection with how many pieces it holds, then "New collection…".
                Choosing one opens it (?col= — the loader filters, so it pages and counts like the search). */}
            {collections.length > 0 && (
              <label className={`wa-filterchip wa-select${colOpen ? " on" : ""}`}>
                <Ico n="bookcase" /> <span className="wa-sr">{t("Collections")}</span>
                <select value={colOpen?.id || ""} aria-label={t("Collections")}
                  onChange={(e) => { const v = e.target.value; if (v === "__new") askColForm("filter"); else openCol(v); }}>
                  <option value="">{colOpen ? t("Show all") : t("Collections")}</option>
                  {collections.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.count}</option>)}
                  <option value="__new">{t("New collection…")}</option>
                </select>
              </label>
            )}
          </div>
        )}
        {/* Select mode: tap pieces, then Keep or Delete them together */}
        {tab !== "blog" && visibleShelf.length >= 2 && (
          <button type="button" className={`wa-filterchip wa-selbtn${selecting ? " on" : ""}`} aria-pressed={selecting} onClick={() => (selecting ? endSelect() : setSelecting(true))}>
            <Ico n="check" /> {selecting ? t("Done selecting") : t("Select")}
          </button>
        )}
        {/* Only when there is genuinely more of THIS type to load. The library
            can be past the page size while the open tab is already complete —
            the Videos tab read “Showing 9 of 9 videos. Show older pieces→”. */}
        {nextShow != null && shelf.length < tabTotal && (
          // The oldest pieces are the ones nearest the 30-day clear, so "older"
          // must stay reachable — Keep is only available from the viewer here.
          //
          // Counted for THIS tab, not the whole library. The page loads the
          // newest N across every type and the tabs then filter that slice in
          // the browser, so the tab label ("Images · 77") and the shelf under it
          // disagreed with no explanation, and the note said "60 of 87" on a tab
          // showing neither number.
          <p className="wa-count">
            {shelf.length === 0
              // None of THIS type are in the recent window (older ones got crowded
              // out by newer pieces of other types) — don't pretend there are none.
              // (the word was built as tab + "s", which on the Scenes & Portraits tab read "stillss")
              ? <>{t("Your")} <b>{tabTotal}</b> {t(TAB_PLURAL[tab])} {t("are further back.")}{" "}</>
              : <>{t("Showing")} <b>{shelf.length}</b> {t("of")} <b>{tabTotal}</b>{" "}{t(TAB_PLURAL[tab])}.{" "}</>}
            <Link to={`?show=${nextShow}&tab=${tab}${whenQ}${q ? `&q=${encodeURIComponent(q)}` : ""}${colQ}${isCreator ? "&section=creator" : ""}`} preventScrollReset>{t("Show older pieces")} →</Link>
          </p>
        )}
      </div>
      {/* COLLECTIONS (2026-11-22): a new one from the Collections menu — named here, then opened */}
      {colForm === "filter" && (
        <ColNameForm label={t("Create")} busy={colBusy} error={colErr} onSave={(name) => colSubmit({ intent: "colCreate", name })} onCancel={() => setColForm(null)} />
      )}
      {/* …and, while one is open, its two ways to manage it: Rename, and Delete (armed — a second tap deletes
          it; the pieces stay in the Archive, and the line says so before that tap) */}
      {colOpen && (colForm === "rename" ? (
        <ColNameForm key={colOpen.id} initial={colOpen.name} label={t("Save")} busy={colBusy} error={colErr} onSave={(name) => colSubmit({ intent: "colRename", collectionId: colOpen.id, name })} onCancel={() => setColForm(null)} />
      ) : (
        <p className="wa-shelfnote wa-colmanage">
          <Ico n="bookcase" />
          <span>{colOpen.count === 1 ? t("1 piece in “{name}”.", { name: colOpen.name }) : t("{n} pieces in “{name}”.", { n: colOpen.count, name: colOpen.name })}</span>
          <Link to={colHref("")} preventScrollReset className="wa-linkbtn" onClick={() => { endSelect(); setColForm(null); setArmColDel(false); }}>{t("Show all")}</Link>
          <button type="button" className="wa-linkbtn" disabled={colBusy} onClick={() => askColForm("rename")}>{t("Rename")}</button>
          <button type="button" className={`wa-linkbtn wa-coldel${armColDel ? " armed" : ""}`} disabled={colBusy} onClick={deleteCol}>
            {armColDel ? t("Tap again to delete it — the pieces stay") : t("Delete collection")}
          </button>
        </p>
      ))}
      {(tab === "video" || tab === "image") && shelf.some((a) => a.daysLeft != null) && (
        // It said to open a piece and hit "Keep" — an opened piece has no button that reads Keep:
        // keeping is the heart over the clip, and the viewer's own note says "tap the heart".
        <p className="wa-shelfnote"><Ico n="hourglass" /> {t("Un-kept videos & photos clear after 30 days — open a piece and tap the heart to save it for good.")}
          {filter === "clearing" && clearingIds.length > 1 && (
            <>{" "}<button type="button" className="wa-linkbtn wa-keepall" onClick={keepAll} disabled={nav.state !== "idle"}><Ico n="heart" /> {t("Keep all {n}", { n: clearingIds.length })}</button></>
          )}
        </p>
      )}
      {keptManyN > 0 && (
        <p className="wa-shelfnote wa-keptmany" role="status"><Ico n="check" /> {t("Kept {n} pieces — they won't clear.", { n: keptManyN })}</p>
      )}
      {/* "Yet — make one" only when there are GENUINELY none of this type —
          tabTotal === 0 — not merely none in the current page (which is the
          "are further back" note above). */}
      {/* (2026-11-22: neither of the next two speaks for an empty When WINDOW — `whenEmpty`, which has its
          own words just below them. With no window on, both are exactly what they were.) */}
      {!whenEmpty && q && shelf.length === 0 && tabTotal === 0 && (
        <p className="wa-noq">{t("Nothing here matches “{q}”.", { q })} <Link to={`?tab=${tab}${whenQ}${colQ}${isCreator ? "&section=creator" : ""}`} preventScrollReset>{t("Clear")}</Link></p>
      )}
      {/* WHEN, and nothing in the window: the page's own empty state — an icon, one line, one button —
          saying which window is empty, with the way back to everything. */}
      {whenEmpty && (
        <div className="wa-empty">
          <span className="wa-empty-ic"><Ico n={tab === "blog" ? "article" : tab === "music" ? "music" : tab === "image" ? "image" : tab === "stills" ? "film" : "video"} size={26} /></span>
          <p className="wa-empty-ln">{t(WHEN_EMPTY[whenOpen])}</p>
          <Link to={whenHref("all")} preventScrollReset className="wb-btn wa-empty-cta" onClick={endSelect}>{t("Show all")}</Link>
        </div>
      )}
      {/* COLLECTIONS: an open collection with none of this kind on it — how to fill it, and the way back */}
      {colEmpty && colOpen && (
        <div className="wa-empty">
          <span className="wa-empty-ic"><Ico n="bookcase" size={26} /></span>
          <p className="wa-empty-ln">{t("Nothing of this kind in “{name}” yet. Show all your pieces, tap Select, pick some, then Add to collection.", { name: colOpen.name })}</p>
          <Link to={colHref("")} preventScrollReset className="wb-btn wa-empty-cta" onClick={endSelect}>{t("Show all")}</Link>
        </div>
      )}
      {!whenEmpty && !colEmpty && !q && shelf.length === 0 && tabTotal === 0 && genCards.length === 0 && failCards.length === 0 && (
        // A real empty state: an icon, one line of encouragement, and a bold
        // deep-link into the Studio — not a bare inline text link.
        <div className="wa-empty">
          <span className="wa-empty-ic"><Ico n={tab === "blog" ? "article" : tab === "music" ? "music" : tab === "image" ? "image" : "video"} size={26} /></span>
          <p className="wa-empty-ln">
            {tab === "video" ? t("No videos yet — your first one lands right here.")
              : tab === "image" ? t("No image ads yet — your first one lands right here.")
              : tab === "music" ? t("No music yet — your first track lands right here.")
              : t("No articles yet — your first one lands right here.")}
          </p>
          {/* Marketing is the default mode, so a plain Link lands right. For
              Creator, set emMode the way the cross-section bridge above does (a
              full load so the shell re-reads it) and the Studio opens in casual. */}
          {isCreator ? (
            <button type="button" className="wb-btn wa-empty-cta"
              onClick={() => { try { localStorage.setItem("emMode", "casual"); } catch { /* */ } window.location.href = "/web/studio"; }}>
              <Ico n="sparkle" /> {t("Open the Studio")} →
            </button>
          ) : (
            <Link to="/web/studio" className="wb-btn wa-empty-cta"><Ico n="sparkle" /> {t("Open the Studio")} →</Link>
          )}
        </div>
      )}
      {/* A filter that hid everything on the page — say so plainly with a one-tap
          way back, rather than leaving an empty grid that reads as broken. */}
      {canFilter && filter !== "all" && visibleShelf.length === 0 && shelf.length > 0 && (
        <p className="wa-shelfnote">
          {filter === "clearing" ? t("Nothing's clearing soon — everything here is kept or still fresh.") : filter === "kept" ? t("Nothing kept in this tab yet.") : t("Nothing of that kind on this page.")}{" "}
          <button type="button" className="wa-linkbtn" onClick={() => setFilter("all")}>{t("Show all")}</button>
        </p>
      )}

      {/* Cooking tiles stay pinned at the top of the shelf. */}
      {genCards.length > 0 && (
        <div className="wb-assets" style={{ marginBottom: 16 }}>
          {genCards.map((j) => (
            <div className="wb-asset" key={j.jobId}>
              <div
                className="wb-cookimg"
                style={j.productImage ? { backgroundImage: `linear-gradient(rgba(10,14,12,.5),rgba(10,14,12,.55)), url(${j.productImage})` } : undefined}
              >
                <span className="wb-bufwrap"><span className="wb-spin" /><span className="wb-eta">{j.etaSec > 10 ? "~" : ""}{fmtEtaShort(j.etaSec, j.elapsedSec, t)}</span></span>
              </div>
              <div className="m">
                {j.kind === "blog"
                  ? (j.productTitle ? t("Writing about {title}…", { title: j.productTitle }) : t("Writing your article…"))
                  : (j.productTitle ? t("Creating your {kind} — {title}…", { kind: j.kind, title: j.productTitle }) : t("Creating your {kind}…", { kind: j.kind }))}
                <div className="s">{t("Rendering")} · {j.etaSec > 10 ? "~" : ""}{fmtEta(j.etaSec, j.elapsedSec, t)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Finished pieces: poster-frame tiles (media) or read rows (blogs). */}
      {tab === "blog" ? (
        <div className="wa-blogrows">
          {visibleShelf.map((a) => {
            const [cc, cl] = chipFor(a);
            return (
              <div className="wa-blogrow" key={a.id}>
                <button type="button" className="wa-blogopen" onClick={() => setViewer(a)}>
                  <b>{a.title}</b>
                  {a.snippet && <p>{a.snippet}…</p>}
                  <span className={`wa-chip ${cc}`}>{cl}</span>
                </button>
                {/* A visible Read affordance, so an Articles row reads like the
                    rest of the app instead of a wall of text. Opens the same
                    viewer the row does. */}
                <button type="button" className="wa-read-btn" onClick={() => setViewer(a)}><Ico n="book" /> {t("Read")}</button>
                {/* (armed tooltip: it said "can't be undone" — askDelete gives 5 seconds to Undo) */}
                <button type="button" className={`wa-icon${armedDel === a.id ? " armed" : ""}`} title={armedDel === a.id ? t("Tap again to delete") : t("Delete this article")} disabled={busy} onClick={() => askDelete(a.id)}><Ico n="trash" /></button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="wb-assets">
          {visibleShelf.map((a) => {
            const [cc, cl] = chipFor(a);
            return (
              <div className={`wb-asset${selecting && picked.has(a.id) ? " wa-picked" : ""}`} key={a.id}>
                <button type="button" className="wa-poster" onClick={() => (selecting ? togglePick(a.id) : setViewer(a))}
                  title={selecting ? (picked.has(a.id) ? t("Unselect") : t("Select")) : a.isAudio ? t("Open & play") : t("Open it big")}
                  aria-pressed={selecting ? picked.has(a.id) : undefined}>
                  {selecting && <span className={`wa-sel${picked.has(a.id) ? " on" : ""}`} aria-hidden="true"><Ico n="check" size={14} /></span>}
                  {/* A cached first-frame JPG, NOT the video — iOS won't paint a <video>
                      frame unprompted, so loading videos just to show a poster made the
                      grid sit black and feel broken. The real <video> loads in the viewer. */}
                  {a.isVideo && a.media && <img src={`/vthumb/${a.media.split("?")[0].split("/").pop()}`} alt={a.title} loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />}
                  {!a.isVideo && !a.isAudio && a.media && <img src={a.media} alt={a.title} loading="lazy" />}
                  {/* Audio has no still — the tile is a play affordance; the real
                      <audio> player lives in the viewer. (An <img src=mp3> would
                      just render broken, so audio never hits the <img> above.) */}
                  {a.isAudio && a.media && (
                    <div className="wa-audiotile">
                      <span className="wa-audio-ico"><Ico n="music" size={34} /></span>
                      <span className="wa-play" aria-hidden>▶</span>
                    </div>
                  )}
                  {!a.media && (
                    <div style={{ height: 220, display: "grid", placeItems: "center", gap: 6, textAlign: "center", color: "#E7C879" }}>
                      <span style={{ display: "grid", placeItems: "center", opacity: .5 }}><Ico n={a.isVideo ? "video" : a.isAudio ? "music" : "image"} size={32} /></span>
                      {a.expired && <span style={{ fontSize: 11, opacity: 0.75, padding: "0 14px" }}>{t("The render for this one is gone — make it again.")}</span>}
                    </div>
                  )}
                  {a.isVideo && a.media && <span className="wa-play" aria-hidden>▶</span>}
                  {/* Not on a dead tile. A video whose render is gone was
                      showing “The render for this one is gone” and “⏳ 29d” at
                      the same time — one says it is lost, the other says it is
                      safe for a month. The countdown is about un-kept media
                      clearing; there is nothing here left to clear. */}
                  {/* (the tooltip said "hit Keep" — there is no such button in the
                      opened piece: keeping is the heart) */}
                  {a.daysLeft != null && !a.expired && <span className={`wa-cd${a.daysLeft <= 5 ? " urgent" : ""}`} title={a.daysLeft === 1 ? t("Auto-clears in {n} day — open it and tap the heart to keep it", { n: a.daysLeft }) : t("Auto-clears in {n} days — open it and tap the heart to keep it", { n: a.daysLeft })}><Ico n="hourglass" /> {a.daysLeft}d</span>}
                </button>
                <div className="m">
                  {a.title}
                  {/* Rendered on the server in UTC and on the client in the
                      viewer's zone, so these two disagree for anything made
                      after early evening local time. That mismatch aborted
                      hydration for the ENTIRE route (React #418, then #423 —
                      "switch to client rendering"), which is why the Archive
                      re-rendered itself from scratch on every visit. Keep the
                      local date; let React reconcile this one node. */}
                  <div className="s">{a.isVideo ? t("Video") : a.isAudio ? t("Music") : t("Image ad")} · <span suppressHydrationWarning>{new Date(a.when).toLocaleDateString()}</span></div>
                  <div className="wa-tileacts">
                    <span className={`wa-chip ${cc}`}>{cl}</span>
                    {a.media && <a className="wa-icon" href={a.media} download={dlName(a.title, a.isVideo, a.isAudio)} title={t("Download")}><Ico n="download" /></a>}
                    {/* (armed tooltip: it said "can't be undone" — askDelete gives 5 seconds to Undo) */}
                    <button type="button" className={`wa-icon${armedDel === a.id ? " armed" : ""}`} title={armedDel === a.id ? t("Tap again to delete") : t("Delete")} disabled={busy} onClick={() => askDelete(a.id)}><Ico n="trash" /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Wipeouts live below the finished work, not mixed into it. */}
      {failCards.length > 0 && (
        <div className="wa-failsec">
          <div className="wa-faildiv"><span>{t("Didn't come through — retry or clear it")}</span></div>
          <div className="wb-assets">
            {failCards.map((j) => (
              <div className="wb-asset" key={j.jobId}>
                <div
                  className="wb-cookimg"
                  style={j.productImage ? { backgroundImage: `linear-gradient(rgba(10,14,12,.5),rgba(10,14,12,.55)), url(${j.productImage})` } : undefined}
                >
                  <span className="wb-failbadge">✕</span>
                </div>
                <div className="m">
                  {t("This {kind} didn't make it", { kind: j.kind })}{j.refunded ? t(" — tokens refunded") : ""}.
                  <div className="s">{t("Failed — retry it right here")}</div>
                  <div className="wa-jacts">
                    <button type="button" className="wb-btn" style={{ padding: "8px 16px", fontSize: 12.5 }} disabled={busy} onClick={() => retryWithToast(j.jobId)}>
                      {j.retryCost > 0 ? t("Retry · {n} tokens · +{xp} XP", { n: j.retryCost, xp: xpForSpend(j.retryCost) }) : t("Retry free")}
                    </button>
                    <button type="button" className="wb-btn ghost" style={{ padding: "8px 14px", fontSize: 12.5 }} disabled={busy} onClick={() => dismissJob(j.jobId)}>{t("Dismiss")}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fullscreen viewer: media plays big / blogs read in a scroll pane.
          Portaled to document.body so it escapes .wb-main's stacking context
          and its z-index:10500 scrim paints above the shell nav (z-index:30);
          the Helpurr FAB (z-index:10600) still sits above the scrim. */}
      {viewer && mounted ? createPortal(
        <div className="wa-scrim" onClick={() => setViewer(null)}>
          <div className={`wa-viewer${viewer.media && viewer.type !== "BLOG_POST" && !viewer.isAudio ? " vmedia" : ""}${vidWide && viewer.isVideo ? " wa-wide" : ""}`} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="wa-vx" aria-label={t("Close")} onClick={() => setViewer(null)}>✕</button>
            <div className={`wa-vstage${viewer.media && viewer.type !== "BLOG_POST" && !viewer.isAudio ? " media" : ""}`}>
              {visibleShelf.length > 1 && vIdx >= 0 && (
                <>
                  <button type="button" className="wa-vnav prev" aria-label={t("Previous")} onClick={() => openAt(vIdx - 1)}>‹</button>
                  <button type="button" className="wa-vnav next" aria-label={t("Next")} onClick={() => openAt(vIdx + 1)}>›</button>
                  <span className="wa-vcount">{vIdx + 1} / {visibleShelf.length}</span>
                </>
              )}
              {/* Keep = a heart TOGGLE over the clip's top-right. Outline → tap to
                  keep (fills gold); gold → tap to un-keep (back to an ordinary
                  piece on the 30-day clock). A PUBLISHED piece stays gold and
                  locked — a tap must never un-publish something already posted. */}
              {viewer.type !== "BLOG_POST" && viewer.media && (() => {
                const published = viewer.status === "PUBLISHED";
                const kept = viewer.status === "APPROVED" || published;
                return (
                  <button type="button" className={`wa-vheart${kept ? " on" : ""}`} disabled={busy || published}
                    aria-pressed={kept}
                    title={published ? t("Posted — saved for good") : kept ? t("Kept — tap to un-keep") : t("Keep — save it for good")}
                    aria-label={kept ? t("Kept") : t("Keep")}
                    onClick={() => { if (published) return; if (viewer.status === "APPROVED") unkeepAsset(viewer.id); else keepAsset(viewer.id); }}>
                    <Ico n="heart" size={20} style={kept ? { fill: "currentColor" } : undefined} />
                  </button>
                );
              })()}
              {viewer.type === "BLOG_POST" ? (
                viewer.html
                  ? <div className="wa-read" dangerouslySetInnerHTML={{ __html: viewer.html }} />
                  : <div className="wa-read"><h2>{viewer.title}</h2><p>{viewer.snippet || t("Still being written…")}</p></div>
              ) : viewer.isVideo && viewer.media ? (
                <>
                  <video ref={vfullRef} className="wa-vfull" src={viewer.media} controls autoPlay playsInline onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth > 0) setVidWide(v.videoWidth >= v.videoHeight); }} />
                  {needsUnmute && (
                    <button type="button" className="wa-vsound"
                      onClick={() => { const v = vfullRef.current; if (v) { v.muted = false; v.play().catch(() => { /* */ }); } setNeedsUnmute(false); }}>
                      🔊 {t("Tap for sound")}
                    </button>
                  )}
                </>
              ) : viewer.isAudio && viewer.media ? (
                <div className="wa-audiofull">
                  <span className="wa-audio-ico"><Ico n="music" size={46} /></span>
                  <audio src={viewer.media} controls autoPlay />
                </div>
              ) : viewer.media ? (
                <img className="wa-vfull" src={viewer.media} alt={viewer.title} />
              ) : (
                <div className="wa-read"><p>{t("Still being made…")}</p></div>
              )}
            </div>
            <div className="wa-vmeta">
              <div className="wa-vtitle">
                <b>{viewer.title}</b>
                {viewer.recipe && <span className="wa-recipe" title={t("The recipe this ad was built with")}><Ico n="sliders" /> {viewer.recipe}</span>}
                {posted && postedAssetId === viewer.id ? <span className="wa-vok">{t("Posted to {where}", { where: posted })} ✓</span>
                  : err && actedId === viewer.id ? <span className="wa-verr">{err}</span>
                  : <span className={`wa-chip ${chipFor(viewer)[0]}`}>{chipFor(viewer)[1]}</span>}
              </div>
              {viewer.notMade && (
                <span className="wa-vmissed">
                  <Ico n={viewer.returned ? "coin" : "bulb"} /> {viewer.returned ? t("The model didn’t make that change, so this one is on us — your {n} tokens are back. Try saying it another way.", { n: viewer.returned }) : t("The model didn’t make that change. Try saying it another way.")}
                </span>
              )}
              {viewer.missed && (
                <span className="wa-vmissed">
                  {/* (Remix is named only where the button is there — canRemix) */}
                  <Ico n="warning" /> {t("The")} <b>{viewer.missed}</b> {t("layout didn't render cleanly, so this went out as a plain product ad instead.")}{viewer.canRemix && <> <b>{t("Remix")}</b> {t("re-rolls it.")}</>}
                </span>
              )}
              {/* COLLECTIONS (2026-11-22): the collections this piece is on, each a chip whose ✕ takes it off that
                  one (the piece stays), and "+ Collection" — the shop's other collections and "New collection…"
                  in the phone's own picker, or straight to the name box while the shop has none. */}
              {colForm === "viewer" ? (
                <ColNameForm label={t("Add")} busy={colBusy} error={colErr} onSave={(name) => colSubmit({ intent: "colAdd", newName: name, assetIds: viewer.id })} onCancel={() => setColForm(null)} />
              ) : (
                <div className="wa-colrow" role="group" aria-label={t("Collections")}>
                  {viewerCols.map((c) => (
                    <span key={c.id} className="wa-colchip">
                      <Ico n="bookcase" size={12} /> {c.name}
                      <button type="button" aria-label={t("Take it off “{name}”", { name: c.name })} title={t("Take it off “{name}”", { name: c.name })} disabled={colBusy}
                        onClick={() => colSubmit({ intent: "colRemove", collectionId: c.id, assetIds: viewer.id })}><Ico n="x" size={12} /></button>
                    </span>
                  ))}
                  {collections.length === 0 ? (
                    <button type="button" className="wa-colchip wa-coladd" disabled={colBusy} onClick={() => askColForm("viewer")}>+ {t("Collection")}</button>
                  ) : (
                    <label className="wa-colchip wa-coladd wa-pickover">
                      + {t("Collection")}
                      <select value="" disabled={colBusy} aria-label={t("Add to collection")}
                        onChange={(e) => { const v = e.target.value; if (v === "__new") askColForm("viewer"); else if (v) colSubmit({ intent: "colAdd", collectionId: v, assetIds: viewer.id }); }}>
                        <option value="" disabled>{t("Add to collection")}</option>
                        {collections.filter((c) => !viewerCols.some((v) => v.id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        <option value="__new">{t("New collection…")}</option>
                      </select>
                    </label>
                  )}
                </div>
              )}
              {/* THE RECEIPT — what the merchant picked and what the AI wrote.
                  Only renders the fields a given piece actually stored. */}
              {(() => {
                const d = viewer.details;
                if (!d) return null;
                const showProduct = d.product && d.product !== viewer.title;
                const hasRow = showProduct || d.presenter || d.topic || d.tagline;
                if (!d.kind && !hasRow && !d.held && !d.service && !d.direction && !d.script) return null;
                return (
                  <div className="wa-spec">
                    {d.kind && <span className="wa-spec-kind">{t(d.kind)}</span>}
                    {hasRow && (
                      <dl className="wa-spec-list">
                        {showProduct && <div className="wa-spec-row"><dt>{t("Product")}</dt><dd>{d.product}</dd></div>}
                        {d.presenter && <div className="wa-spec-row"><dt>{t("Presenter")}</dt><dd>{d.presenter}</dd></div>}
                        {d.topic && <div className="wa-spec-row"><dt>{t("Topic")}</dt><dd>{d.topic}</dd></div>}
                        {d.tagline && <div className="wa-spec-row"><dt>{t("Tagline")}</dt><dd>{d.tagline}</dd></div>}
                      </dl>
                    )}
                    {(d.held || d.service) && (
                      <div className="wa-spec-tags">
                        {d.held && <span className="wa-spec-tag">✋ {t("Holding the product")}</span>}
                        {d.service && <span className="wa-spec-tag">{t("Service — no physical product")}</span>}
                      </div>
                    )}
                    {d.direction && (
                      <div className="wa-prompt">
                        <span className="wa-prompt-h">{t("Your direction")}</span>
                        <p>{d.direction}</p>
                      </div>
                    )}
                    {d.script && d.scriptLabel && (
                      <div className="wa-prompt">
                        <span className="wa-prompt-h">{t(d.scriptLabel)}</span>
                        <p className="wa-prompt-script">{d.script}</p>
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Post tracking + the Boost Bridge. Clicks come from the /go/a
                  turnstile in every posted caption; the live post links open
                  the exact post so boosting is two taps in Meta's own UI —
                  the SMB way to put spend behind a winner, no ads API needed. */}
              {(viewer.clicks > 0 || viewer.postedUrls) && (
                <div className="wa-track">
                  <span className="wa-clicks" title={t("Shoppers who tapped the link in this post's caption")}><Ico n="link" /> {viewer.clicks === 1 ? t("{n} click", { n: viewer.clicks }) : t("{n} clicks", { n: viewer.clicks })}</span>
                  {viewer.postedUrls && Object.entries(viewer.postedUrls).map(([p, u]) => (
                    <a key={p} className="wa-boost" href={u} target="_blank" rel="noreferrer"><Ico n="bolt" /> {t("Boost on {platform}", { platform: p.charAt(0).toUpperCase() + p.slice(1) })} ↗</a>
                  ))}
                  {viewer.postedUrls && (
                    <span className="wa-boosthint">{t("Open the post")} → {t("tap")} <b>⋯ / Boost</b>. {t("Suggested start: $10/day × 3 days, Advantage+ audience. Clicks above tell you which piece earned the spend.")}</span>
                  )}
                </div>
              )}
              {/* (only while it can still clear: a piece just kept or posted was still told it "clears in 12 days") */}
              {viewer.status === "PENDING" && viewer.daysLeft != null && !posted && !viewer.expired && (
                <span className={`wa-vcdnote${viewer.daysLeft <= 5 ? " urgent" : ""}`}><Ico n="hourglass" /> {viewer.daysLeft === 1 ? t("Clears in {n} day", { n: viewer.daysLeft }) : t("Clears in {n} days", { n: viewer.daysLeft })} — {t("tap the heart to save it for good.")}</span>
              )}
              {viewer.type !== "BLOG_POST" && <span className="wa-aitag"><Ico n="sparkle" /> {t("AI-generated · review before posting")}</span>}
              {viewer.type === "BLOG_POST" ? (
                <div className="wa-vacts">
                  {viewer.html && <button type="button" className="wa-vbtn ghost" onClick={() => copyHtml(viewer.html!)}>{copied ? t("Copied ✓") : t("Copy HTML")}</button>}
                  {viewer.html && <button type="button" className="wa-vbtn ghost" onClick={() => downloadHtml(viewer.title, viewer.html!)}><Ico n="download" /> {t("Download")}</button>}
                  {/* the same rule as the media Remix below: only where the action will take it (an article needs its product's name) */}
                  {viewer.canRemix && <button type="button" className="wa-vbtn gold" disabled={busy} title={t("Write a fresh article on the same product")} onClick={() => remix(viewer.id)}><Ico n="sparkle" /> {t("Remix")}<span className="c">{t("{n} tokens · +{xp} XP", { n: costOf(viewer.type), xp: xpForSpend(costOf(viewer.type)) })}</span></button>}
                  {/* (armed tooltip: it said "can't be undone" — askDelete gives 5 seconds to Undo) */}
                  <button type="button" className={`wa-vbtn danger full${armedDel === viewer.id ? " armed" : ""}`} disabled={busy} title={armedDel === viewer.id ? t("Tap again to delete") : t("Delete")} onClick={() => askDelete(viewer.id)}>{armedDel === viewer.id ? t("Tap again to delete") : t("Delete")}</button>
                </div>
              ) : (
                <>
                  <div className="wa-vacts">
                    {canPost && linked.length > 0 && !capOpen && viewer.media && !viewer.isAudio && (
                      <button type="button" className="wa-vbtn full" disabled={busy} onClick={() => startPost(viewer.id)}>{isCreator ? t("Share to socials") : t("Post to socials")}</button>
                    )}
                    {/* ADD TO QUEUE (2026-11-22): post it later instead of now — into the Auto-post queue */}
                    {(viewer.isVideo || viewer.type === "IMAGE_AD") && viewer.media && !viewer.expired && (
                      <button type="button" className="wa-vbtn ghost" disabled={queueBusy} onClick={() => queueIds([viewer.id])}><Ico n="rocket" /> {queueBusy ? t("Adding…") : t("Add to queue")}</button>
                    )}
                    {viewer.media && <a className="wa-vbtn ghost" href={viewer.media} download={dlName(viewer.title, viewer.isVideo, viewer.isAudio)}><Ico n="download" /> {t("Download")}</a>}
                    {viewer.media && !viewer.expired && (
                      <button type="button" className={`wa-vbtn ghost${shareFor === viewer.id ? " on" : ""}`} aria-expanded={shareFor === viewer.id}
                        onClick={() => setShareFor((cur) => (cur === viewer.id ? null : viewer.id))}>
                        <Ico n="link" /> {t("Share link")}
                      </button>
                    )}
                    {viewer.media && !viewer.expired && shareFor === viewer.id && (
                      <div className="wa-sizes" role="group" aria-label={t("Share link")}>
                        <p className="wa-sizes-h">{t("A page with just this piece on it, to send to anyone — a client, a friend, a group chat.")}</p>
                        <ShareLink key={`${viewer.id}-share`} assetId={viewer.id} title={viewer.title} token={viewer.shareToken} />
                      </div>
                    )}
                    {viewer.hasShots && viewer.media && <a className="wa-vbtn ghost" href={`/web/filmedit/${viewer.id}`} title={t("Open the shot timeline — preview and edit each shot")}><Ico n="video" /> {t("Edit shots")}</a>}
                    {/* A story film is continued from where it is watched: the Movie Maker opens on the next
                        episode of its series — same cast, same voices — whichever episode this one is. */}
                    {viewer.canContinue && viewer.media && !viewer.expired && <a className="wa-vbtn ghost" href={`/web/film?episode=${viewer.id}`} title={t("Continue this story — the next episode, with the same cast")}><Ico n="video" /> {t("Next episode")}</a>}
                    {(viewer.isVideo || viewer.type === "IMAGE_AD") && viewer.media && (
                      <button type="button" className={`wa-vbtn ghost${sizesFor === viewer.id ? " on" : ""}`} aria-expanded={sizesFor === viewer.id}
                        onClick={() => setSizesFor((cur) => (cur === viewer.id ? null : viewer.id))}>
                        <Ico n="grid" /> {t("Ad pack")}
                      </button>
                    )}
                    {(viewer.isVideo || viewer.type === "IMAGE_AD") && viewer.media && sizesFor === viewer.id && (
                      <div className="wa-sizes" role="group" aria-label={t("Ad pack")}>
                        {viewer.isVideo && (
                          <>
                            <p className="wa-pack-h">{t("Every size")}</p>
                            <p className="wa-sizes-h">{t("One video in every shape ads use. Nothing is cut off — the space around it is filled with a soft blur of the video.")}</p>
                            <div className="wa-sizes-grid">
                              {AD_SIZE_KEYS.map((k) => <SizeTile key={`${viewer.id}-${k}`} assetId={viewer.id} size={k} title={viewer.title} />)}
                            </div>
                            <p className="wa-pack-h">{t("Captions")}</p>
                            <div className="wa-sizes-grid"><CaptionsTile key={`${viewer.id}-srt`} assetId={viewer.id} title={viewer.title} /></div>
                          </>
                        )}
                        <p className="wa-pack-h">{t("Ad copy")}</p>
                        <AdCopyBlock key={`${viewer.id}-copy`} assetId={viewer.id} initial={viewer.adCopy} />
                      </div>
                    )}
                    {/* CROSS-SECTION BRIDGE — "edit my own content": open this
                        image in the Creator editor (seeds ?src=; the full
                        describe-first edit flow runs on it). Image-only — the
                        edit pipeline can't edit video. Flips to casual so the
                        edit lands back in the Creator Gallery. */}
                    {!viewer.isVideo && !viewer.isAudio && viewer.media && (
                      <button type="button" className="wa-vbtn ghost" disabled={busy}
                        title={t("Open this image in the Creator editor")}
                        onClick={() => { try { localStorage.setItem("emMode", "casual"); } catch { /* */ } window.location.href = `/web/studio?do=edit&src=${encodeURIComponent(viewer.media!)}`; }}>
                        <Ico n="article" /> {t("Edit")}{isCreator ? "" : t(" in Creator")}
                      </button>
                    )}
                    {/* CROSS-SECTION BRIDGE — "use creator content on Marketing":
                        schedule this creation into a marketing campaign (repost,
                        0 tokens, posts the media as-is — no ad-format claims are
                        layered on, so no fabrication risk). Flips to marketing. */}
                    {isCreator && !viewer.isAudio && viewer.media && (
                      <button type="button" className="wa-vbtn ghost" disabled={busy}
                        title={t("Schedule this into a social campaign")}
                        onClick={() => { try { localStorage.setItem("emMode", "marketing"); } catch { /* */ } window.location.href = `/web/campaigns?pick=${encodeURIComponent(viewer.id)}`; }}>
                        ➜ {t("Use in a campaign")}
                      </button>
                    )}
                    {/* A piece whose render we lost is replaced on us, so the
                        button must not quote a price the merchant will not pay. */}
                    {/* …and only on a piece the remix action will take (canRemix, from
                        the loader). It showed on everything but audio, so on a Creator
                        image, a film, a faceless video or a scene still it could only
                        answer "made before we started saving its product photo". */}
                    {!viewer.isAudio && viewer.canRemix && (
                      <button type="button" className="wa-vbtn gold" disabled={busy} title={viewer.freeRemake ? t("We lost this render — make it again, on us") : t("Make a fresh variation of this piece")} onClick={() => remix(viewer.id)}>{viewer.freeRemake ? t("Make it again") : t("Remix")}<span className="c">{viewer.freeRemake ? t("free — on us") : t("{n} tokens · +{xp} XP", { n: costOf(viewer.type), xp: xpForSpend(costOf(viewer.type)) })}</span></button>
                    )}
                    {/* (armed tooltip: it said "can't be undone" — askDelete gives 5 seconds to Undo) */}
                    <button type="button" className={`wa-vbtn danger full${armedDel === viewer.id ? " armed" : ""}`} disabled={busy} title={armedDel === viewer.id ? t("Tap again to delete") : t("Delete")} onClick={() => askDelete(viewer.id)}>{armedDel === viewer.id ? t("Tap again to delete") : t("Delete")}</button>
                  </div>
                  {capOpen && (
                    <div className="wa-cap">
                      <textarea
                        className="wa-capbox"
                        rows={5}
                        value={caption}
                        disabled={draftPending}
                        placeholder={draftPending ? t("Writing a caption for you…") : t("Write your caption…")}
                        onChange={(e) => setCaption(e.target.value)}
                      />
                      <div className="wa-caprow">
                        <button type="button" className="wa-vbtn" disabled={busy || draftPending || !caption.trim()} onClick={() => doPost(viewer.id)}>{busy && !draftPending ? t("Posting…") : t("Post now")}</button>
                        <button type="button" className="wa-vbtn ghost" disabled={busy} onClick={() => setCapOpen(false)}>{t("Cancel")}</button>
                      </div>
                      <span className="wa-caphint">{t("Posts to {where}.", { where: linked.join(" · ") })} {t("Tweak it or post as-is — the #EasyModeAi disclosure rides along either way.")}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      , document.body) : null}

      {/* Delete / retry confirmation toast. Portaled to document.body so its
          fixed position + z-index clear any stacking context and it shows
          whether or not the viewer is open. */}
      {toast && mounted ? createPortal(
        <div className="wa-toast" role="status" aria-live="polite" style={selecting ? { bottom: Math.max(96, bulkTop + 16) } : undefined}>
          <span className="wa-toast-ic"><Ico n={toast.undo ? "trash" : "check"} /></span>
          <span>{toast.msg}</span>
          {toast.undo && <button type="button" className="wa-toast-undo" onClick={toast.undo}>{t("Undo")}</button>}
          {toast.link && <Link to={toast.link.to} className="wa-toast-link" onClick={() => setToast(null)}>{toast.link.label} →</Link>}
        </div>
      , document.body) : null}

      {/* Select mode's action bar, pinned to the bottom of the screen while picking */}
      {selecting && (
        <div className="wa-bulk" ref={bulkRef} role="toolbar" aria-label={t("Selected pieces")}>
          <span className="wa-bulk-n">{picked.size === 1 ? t("1 selected") : t("{n} selected", { n: picked.size })}</span>
          <button type="button" className="wa-bulk-link" onClick={() => setPicked(picked.size >= visibleShelf.length ? new Set() : new Set(visibleShelf.map((a) => a.id)))}>
            {picked.size >= visibleShelf.length ? t("Clear") : t("Select all {n}", { n: visibleShelf.length })}
          </button>
          <span className="wa-bulk-sp" />
          {/* DOWNLOAD (2026-11-22): the media file of every picked piece that has one, one after another.
              While a go runs the button shows how far it is and cannot be tapped again; what happened is
              said in the toast when it ends. (First of the three, so on a wide screen its growing label
              pushes into the spacer and Keep / Delete / Done stay where they are.) */}
          <button type="button" className={`wa-bulk-btn dl${dl ? " busy" : ""}`} disabled={!picked.size || !!dl} aria-busy={dl ? true : undefined}
            aria-label={dl ? t("Downloading {i} of {n}…", { i: dl.i, n: dl.n }) : undefined} onClick={downloadPicked}>
            <Ico n="download" />{" "}
            {/* Three faces of one label: the word, the sentence (wide screens) and the short count (phones).
                On a phone the word and the count are stacked in one cell — see .wa-bulk-lbl — so the button
                is the same width idle and running, and nothing in the bar moves when a go starts. */}
            <span className={`wa-bulk-lbl${dl ? " busy" : ""}`}>
              <span className="wa-bulk-idle">{t("Download")}</span>
              {dl && <span className="wa-bulk-long">{t("Downloading {i} of {n}…", { i: dl.i, n: dl.n })}</span>}
              <span className="wa-bulk-short" aria-hidden="true">{dl ? `${dl.i} / ${dl.n}` : `${DL_CAP} / ${DL_CAP}`}</span>
            </span>
          </button>
          <button type="button" className="wa-bulk-btn keep" disabled={!picked.size || busy} onClick={keepPicked}><Ico n="heart" /> {t("Keep")}</button>
          <button type="button" className={`wa-bulk-btn del${armBulk ? " armed" : ""}`} disabled={!picked.size || busy} onClick={deletePicked}>
            <Ico n="trash" /> {armBulk ? t("Tap again to delete {n}", { n: picked.size }) : t("Delete")}
          </button>
          {/* QUEUE (2026-11-22): the picked videos and image ads, into the Auto-post queue — not on the tabs
              that hold neither */}
          {tab !== "music" && tab !== "blog" && (
            <button type="button" className="wa-bulk-btn queue" disabled={!picked.size || queueBusy} onClick={queuePicked}><Ico n="rocket" /> {t("Queue")}</button>
          )}
          {/* COLLECTIONS (2026-11-22): put the picked pieces on a collection — or, while one is open, take them
              off it. One control for the one decision each place offers. */}
          {colOpen ? (
            <button type="button" className="wa-bulk-btn" disabled={!picked.size || colBusy} onClick={removePicked}><Ico n="x" /> {t("Remove from collection")}</button>
          ) : collections.length === 0 ? (
            <button type="button" className="wa-bulk-btn" disabled={!picked.size || colBusy} onClick={() => askColForm("bulk")}><Ico n="bookcase" /> {t("Add to collection")}</button>
          ) : (
            <label className={`wa-bulk-btn wa-pickover${!picked.size || colBusy ? " off" : ""}`}>
              <Ico n="bookcase" /> {t("Add to collection")}
              <select value="" disabled={!picked.size || colBusy} aria-label={t("Add to collection")}
                onChange={(e) => { const v = e.target.value; if (v === "__new") askColForm("bulk"); else if (v) addPickedTo({ collectionId: v }); }}>
                <option value="" disabled>{t("Add to collection")}</option>
                {collections.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.count}</option>)}
                <option value="__new">{t("New collection…")}</option>
              </select>
            </label>
          )}
          <button type="button" className="wa-bulk-done" onClick={endSelect}>{t("Done")}</button>
          {colForm === "bulk" && !colOpen && (
            <ColNameForm dark label={t("Add")} busy={colBusy || !picked.size} error={colErr} onSave={(name) => addPickedTo({ newName: name })} onCancel={() => setColForm(null)} />
          )}
        </div>
      )}
    </div>
  );
}
