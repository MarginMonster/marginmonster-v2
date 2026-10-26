/* Web Studio — the SAME experience as the embedded Content Studio, minus
 * Shopify: big content-type tiles with live renders, per-presenter cartoon
 * style grids, presenter cards with voice previews, tier lock badges, the
 * engine picker, Commercial look, service mode, hold/wear, Advanced
 * prompting, Brand Face and import-by-URL. Same token costs, same
 * server-side capability gates, same worker pipelines. Product input =
 * name + photo (upload, URL, or scraped from any store's product page). */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { trimToWord } from "../lib/text-trim";
import { Form, Link, useActionData, useFetcher, useLoaderData, useNavigation, useOutletContext, useRevalidator, useSearchParams, useSubmit } from "@remix-run/react";
import { LangToggle } from "../components/LangToggle";
import { normalizeContentLang, CONTENT_LANG_NATIVE } from "../lib/content-lang";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ico } from "../lib/icons";
import { useT } from "../lib/ui-lang";
import { requireWebIdentity } from "../lib/web-auth.server";
import { readUiLang, tr } from "../lib/ui-i18n";
import { db } from "../db.server";
import { planTrialing, refundTokens, spendTokens, tokensRemainingLive } from "../lib/tokens.server";
import { enqueueJob } from "../lib/job-queue.server";
import { screenCreatePrompt } from "../lib/prompt-safety.server";
import { TOKEN_COST, CREATOR_PRICE, CREATOR_SURCHARGE_MULT } from "../lib/plan-config";
import { uploadFileName, type UploadExt } from "../lib/upload-names";
import { assertCapability, capabilitiesFor, videoCapabilityFor } from "../lib/capabilities.server";
import { LIVE_AVATARS, avatarImg, DESIGNED_VOICES, privateCastFor } from "../lib/avatars";
import { AVATAR_VOICES, DEFAULT_AVATAR_VOICE, safeVoiceId } from "../lib/avatar-voice-catalog";
import { AD_TEMPLATES, AD_TEMPLATE_BY_KEY } from "../lib/ad-templates";
import { AD_FORMATS, AD_FORMAT_BY_KEY, FORMAT_GROUPS, type AdFormat } from "../lib/ad-formats";
import { CREATE_STYLES } from "../lib/create-styles";
import { CREATE_MODELS, CREATE_ASPECTS, aspectCss, createModelSurcharge, normalizeCreateModelKey, DEFAULT_CREATE_MODEL, DEFAULT_CREATE_ASPECT, FACELESS_QUALITIES, facelessQualitySurcharge, normalizeFacelessQuality } from "../lib/create-models";
import { MUSIC_STYLES, MUSIC_STYLE_BY_KEY } from "../lib/music-styles";
import { VIDEO_ENGINES, engineSurcharge, normalizeEngineKey } from "../lib/video-engines";
import { resolveImageOrPage, scrapeProductPage } from "../lib/product-scrape.server";
import { CATALOG_CAP, storeOrigin } from "../lib/catalog-import.server";
import { SIZE_CHOICES } from "../lib/product-scale";

// Merchants keep several of these open at once; an untitled tab is just a URL.
export const meta = () => [{ title: "Studio · EasyMode" }];

// Mirrors the embedded Studio's pickers (same keys, names, live art routes).
const CONTENT_TYPES = [
  { key: "avatar", name: "Avatar AI", cover: "/style-tiles/avatarcover.jpg?v=4", sub: "A real-looking presenter talks it up", cap: "video", tier: "Studio", price: 39 },
  { key: "talkinghead", name: "Talking Head", cover: "/ad-templates/ctcover-talkinghead.jpg?v=4", sub: "Straight to camera, selfie-style — no product", cap: "video", tier: "Studio", price: 39 },
  { key: "highlight", name: "Product Highlight", cover: "/ad-templates/phcover.jpg?v=1", sub: "Cinematic motion, no presenter", cap: "video", tier: "Studio", price: 39 },
  { key: "cartoon", name: "Cartoon Avatar", cover: "/ad-templates/ctcover-cartoon.jpg?v=2", sub: "Cartoon hook, then your real product", cap: "cartoon", tier: "Studio", price: 39 },
  { key: "jingle", name: "Anthem", cover: "/style-tiles/anthemcover.jpg?v=4", sub: "A stuck-in-your-head 2000s theme song", cap: "anthem", tier: "Studio", price: 39 },
  { key: "commercial", name: "Commercial", cover: "/ad-templates/ctcover-commercial.jpg?v=1", sub: "A cinematic, big-budget story ad", cap: "video", tier: "Studio", price: 39 },
  // Creator Demo (review) retired from the picker 2026-10-21 — it was the SAME
  // presenter+product UGC pipeline as Avatar AI (base:"avatar"), just with a
  // casual phone-shot direction, so it read as a duplicate card. CT_PRESETS.review
  // stays below so any already-made Creator Demo asset still remixes.
  // Unboxing retired from the picker 2026-10-15 — the "box opens, product lifted
  // out" beat is hard to render accurately (the real product rarely survives the
  // reveal). CT_PRESETS.unboxing + its note stay so an already-made one remixes.
  // Satisfying Close-Up (asmr) retired from the picker 2026-10-21 (owner call) —
  // leaves 6 clean video formats. "asmr" stays a valid CType (below) so an
  // already-made Close-Up still remixes.
] as const;

// The two flagship formats lead the marketing picker and render LARGER (span 2
// columns), so the 6 cards read as 2 big on top + 4 under — no empty "void"
// from an odd fill. Owner's call; easy to swap the keys.
const FLAGSHIP_KEYS = new Set<string>(["avatar", "highlight"]);

// Casual (Creator) reframes the kept video types in its own, non-sell language —
// same pipelines, creator-native names. Only the three casual keeps it shows.
const CASUAL_VIDEO_COPY: Record<string, { name: string; sub: string; icon: string }> = {
  cartoon: { name: "Cartoon", sub: "Your idea, redrawn & animated viral-style", icon: "palette" },
  highlight: { name: "Showcase", sub: "Cinematic motion from your photo or idea", icon: "film" },
  asmr: { name: "Satisfying", sub: "Macro textures in slow-mo — the loop nobody scrolls past", icon: "sparkle" },
};

// Pick-by-look art-style swatches — each background is CRAFTED to evoke the
// style itself (watercolor washes, neon cyberpunk, pixel bands…), so you choose
// a look by its look, not by reading a chip. Keyed to CREATE_STYLES.
const STYLE_SWATCH: Record<string, string> = {
  photo: "linear-gradient(135deg,#dcc9a8,#9b8a6e)",
  digital: "linear-gradient(135deg,#7b5cff,#ff5ca8 55%,#ffb15c)",
  anime: "linear-gradient(135deg,#ff9ec4,#9ad0ff 55%,#fff3a0)",
  "3d": "radial-gradient(circle at 35% 30%,#eef4ff,#9fb3d9 60%,#56688f)",
  oil: "linear-gradient(135deg,#8a3b1e,#c98a3b 55%,#4a5a2e)",
  watercolor: "radial-gradient(circle at 30% 30%,#ffd1dc,transparent 55%),radial-gradient(circle at 72% 62%,#bfe3ff,transparent 52%),#fdfbf5",
  neon: "radial-gradient(circle at 72% 28%,#ff2e97,transparent 48%),linear-gradient(135deg,#0b0f2a,#5a1e8f)",
  pixel: "linear-gradient(135deg,#5ec8ff 25%,#ff5ca8 25% 50%,#ffe24a 50% 75%,#5efc82 75%)",
  fantasy: "radial-gradient(circle at 50% 18%,#ffe8a3,transparent 52%),linear-gradient(160deg,#3a2a6b,#7b3f9e 60%,#c76b3f)",
  minimal: "linear-gradient(135deg,#fdfbf5,#ece4d4)",
  comic: "radial-gradient(circle at 72% 30%,#ffe24a,transparent 46%),linear-gradient(135deg,#ff4d4d,#ff8a3d 52%,#2b8cff)",
  sketch: "linear-gradient(135deg,#f6f3ec,#cfccc5 52%,#6f6c66)",
};

// One-tap photo-edit ops (casual "Edit a photo"). Shown as a collapsed
// disclosure below the describe box so they don't crowd it.
const EDIT_QUICK_ACTIONS: [string, string][] = [
  ["restyle", "Restyle"], ["cartoonize", "Cartoonize"], ["replace", "Replace"],
  ["colorize", "Colorize"], ["upscale", "Upscale"], ["bgswap", "Swap background"],
  ["bgremove", "Remove background"],
];

// The three PRESET types ride the avatar/highlight pipelines with a baked-in
// creative direction — translated at submit so the queue, the capability
// gate and the pipelines never learn new keys.
/* BURST — make several at once instead of tapping generate over and over.
 * It gives the merchant a set of usable variations to post or test in one go,
 * not "pick one, bin the rest" — every take should be good. Caps differ because
 * the money does — an image is 5 tokens, a video is 60+, so a ten-video burst
 * would empty most wallets on a single tap. Shared by the picker UI and the
 * action that charges. */
const MAX_BURST = { image: 10, video: 3 } as const;
const BURST_STEPS = { image: [1, 3, 5, 10], video: [1, 2, 3] } as const;
/** Stagger a burst across the queue instead of dropping ten jobs in at once.
 *  Every item is a full pipeline making several provider calls, and ten of
 *  them starting together is how a compose gets rate-limited into falling
 *  back to a plain product still — which is what a merchant reported. 25s
 *  apart costs the merchant nothing they'd notice and keeps each render on
 *  the good path. The first one runs immediately. */
function burstRunAt(i: number): Date | undefined {
  return i === 0 ? undefined : new Date(Date.now() + i * 25_000);
}

function burstCount(form: FormData, max: number): number {
  const n = parseInt((form.get("burst") as string) || "1", 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(max, n)) : 1;
}

const CT_PRESETS: Record<string, { base: "avatar" | "highlight"; direction: string }> = {
  talkinghead: { base: "avatar", direction: "Shot like an authentic selfie-style TikTok: the creator films themselves at arm's length (or with the phone propped up), at home in natural daylight, talking directly to camera — casual, warm and real, like organic UGC, not a polished studio ad. Natural handheld energy, an everyday room in the background, genuine to-camera delivery. NO product is shown, held, or worn — this is a pure talking-head about the topic." },
  review: { base: "avatar", direction: "Film it like a creator's phone-shot product demo for social: casual selfie framing, natural light, upbeat first-person walkthrough of what the product does and why it's cool — organic UGC energy, not a polished ad. Do NOT claim to be a customer or to have bought or owned it." },
  unboxing: { base: "avatar", direction: "An excited first-impressions unboxing: they open the package on camera, lift the product out, react genuinely, and show it close to the lens." },
  asmr: { base: "highlight", direction: "An oddly-satisfying ASMR-style macro edit: extreme close-ups, slow luxurious motion, rich textures, droplets and light play — a mesmerizing loop that stops the scroll." },
};
// What a preset key renders AS — everything downstream keys off the base.
const baseOf = (ct: string | null | undefined) => (ct && CT_PRESETS[ct] ? CT_PRESETS[ct].base : ct);

// Talking Head is all about the WHERE — a selfie-to-camera clip lives or dies on
// its setting + whether they're seated or standing. These feed the talkinghead
// direction (built in the action) instead of the old fixed "at home" preset.
const TALKINGHEAD_SETTINGS = [
  { key: "home", label: "At home", prompt: "at home in a cozy, lived-in room with soft natural daylight from a window" },
  { key: "office", label: "Office / desk", prompt: "at a clean, modern desk or home-office with a tidy background and soft indoor light" },
  { key: "outdoors", label: "Outdoors", prompt: "outdoors in natural daylight — a street, park or balcony with gentle background bokeh" },
  { key: "cafe", label: "Cafe", prompt: "in a warm, inviting cafe with soft blurred background activity" },
  { key: "car", label: "In the car", prompt: "in the front seat of a parked car — the classic car-vlog selfie look" },
  { key: "studio", label: "Clean backdrop", prompt: "against a clean, softly-lit solid-color backdrop" },
] as const;

const CARTOON_STYLES = [
  { key: "dreamanime", name: "Dream Anime", tint: "#6FAF7C", blurb: "Your presenter as a soft painterly anime character — the style the whole internet shares" },
  { key: "pixar", name: "3D Toon", tint: "#34C3E7", blurb: "Big-studio 3D character film — glossy and cinematic" },
  { key: "retroanime", name: "Retro Anime", tint: "#E5397D", blurb: "90s VHS anime — sunset palettes and speed lines" },
  { key: "vintagetoon", name: "Vintage Toon", tint: "#E7A33C", blurb: "Playful vintage 2D — hand-inked, storybook warmth" },
  { key: "clay", name: "Claymation", tint: "#B08526", blurb: "Hand-molded stop-motion, cozy and tactile" },
  { key: "plushie", name: "Plushie", tint: "#E59AB8", blurb: "You as a huggable plush toy holding your product — the trend feeds can't stop sharing" },
  // Hidden from the picker 2026-10-22 (owner call) — the product-in-hand change
  // keeps the real product photo-exact, which pulls the whole frame photoreal:
  //   toyfigure  → character stays un-stylized + the card header garbles
  //   papercut   → loses its layered-paper texture (reads photoreal)
  //   puppet     → loses its felt texture (reads photoreal)
  // Their CARTOON_RECIPES entries stay (pipeline-side) so an already-made asset
  // in one of those styles still remixes. Re-enable here if we harden them.
];

// Scene SETTING presets for the Combine step — each maps to a `scene` string the
// composer already understands (the SAME field the Edit box's "put them in an
// office" writes). Works for Realistic + cartoon. "Auto" = presenter's own backdrop.
const COMBINE_SETTINGS: { key: string; name: string; scene: string; emoji: string; tint: string }[] = [
  { key: "auto", name: "Auto", scene: "", emoji: "✨", tint: "#EAF2EC" },
  { key: "studio", name: "Studio", scene: "in a clean photo studio with soft, even lighting", emoji: "🎬", tint: "#E9EEF6" },
  { key: "kitchen", name: "Kitchen", scene: "in a bright, modern kitchen", emoji: "🍳", tint: "#FBEEDF" },
  { key: "outdoors", name: "Outdoors", scene: "outdoors in natural daylight, softly blurred greenery behind", emoji: "🌳", tint: "#E6F2E3" },
  { key: "living", name: "Cozy room", scene: "in a cozy living room with warm lighting", emoji: "🛋️", tint: "#F3EBE2" },
  { key: "gym", name: "Gym", scene: "in a modern fitness gym", emoji: "🏋️", tint: "#E8EDF2" },
  { key: "cafe", name: "Café", scene: "in a stylish coffee shop, softly blurred background", emoji: "☕", tint: "#F0E7DE" },
  { key: "office", name: "Office", scene: "in a bright, modern office", emoji: "🏢", tint: "#E9EDF1" },
];

// Wearable products should be modeled (worn) by the presenter, not held.
const APPAREL_RE = /\b(shirt|tee|t-shirt|top|blouse|hoodie|sweat(er|shirt)?|jacket|coat|dress|skirt|pant|trouser|jean|short|legging|activewear|apparel|clothing|clothes|hat|cap|beanie|scarf|sock|jersey|uniform|robe|gown|cardigan|blazer|vest|romper|jumpsuit|swimsuit|bikini|lingerie|underwear|bra|glove|wear|outfit|garment|tank|polo)\b/i;
function isApparel(text: string): boolean { return APPAREL_RE.test(text); }

// One-tap blog angles — the picker that standardizes what kind of article you get.
const BLOG_ANGLES: { icon: string; label: string; prompt: string }[] = [
  { icon: "clipboard", label: "Buyer's Guide", prompt: "a practical buyer's guide that helps a shopper choose the right option — what to look for, common mistakes to avoid, and why this product fits" },
  { icon: "wrench", label: "How-To", prompt: "a step-by-step how-to that helps the reader get the most out of the product, with clear numbered steps and pro tips" },
  { icon: "star", label: "Best-Of List", prompt: "a curated best-of listicle ranking top picks or use-cases, positioning this product as the standout choice" },
  { icon: "question", label: "FAQ", prompt: "an FAQ-style post answering the real questions shoppers ask before buying, each answer building confidence to purchase" },
  { icon: "book", label: "Brand Story", prompt: "a short brand-story feature connecting the product to a relatable customer moment and the values behind it" },
  { icon: "gift", label: "Gift Guide", prompt: "a gift-guide angle framing the product as the perfect gift for specific people and occasions" },
];

const decodeEntities = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const lang = readUiLang(request);
  const { account, shop } = await requireWebIdentity(request);
  const { customCastFor } = await import("../lib/custom-avatars.server");
  const custom = await customCastFor(shop.id);
  const cast = [
    ...custom.filter((c) => c.status === "ready").map((c) => ({ id: c.id, name: c.name, img: c.img, designed: false })),
    ...[...privateCastFor(account.email, shop.id, shop.domain), ...LIVE_AVATARS].map((a) => ({ id: a.id, name: a.name, img: avatarImg(a.id, 0), designed: DESIGNED_VOICES.has(a.id) })),
  ];
  const forgingAvatars = custom
    .filter((c) => c.status !== "ready")
    .map((c) => ({ name: c.name, status: c.status, startedAt: c.createdAt.toISOString() }));
  // The merchant's ready custom presenters, for the Manage panel: change the
  // voice (fixes a presenter forged before voice-pick existed) or delete one to
  // free a slot. voiceId drives which chip shows selected; gender picks defaults.
  const myPresenters = custom
    .filter((c) => c.status === "ready")
    .map((c) => ({ id: c.id, name: c.name, img: c.img, voiceId: c.voiceId || "", gender: c.gender }));
  const brandFaceId = shop.brandAvatarId && cast.some((c) => c.id === shop.brandAvatarId) ? shop.brandAvatarId : null;
  // The merchant's own catalogue, mirrored by the importer. Present = the
  // Studio can offer a picker instead of asking for a link every single time.
  const [catalog, catalogCount, syncing, recentRows] = await Promise.all([
    db.catalogProduct.findMany({
      where: { shopId: shop.id },
      orderBy: { position: "asc" },
      take: 400,
      select: { id: true, title: true, url: true, imageUrl: true, priceText: true },
    }),
    db.catalogProduct.count({ where: { shopId: shop.id } }),
    // THE LAST IMPORT, WHATEVER HAPPENED TO IT.
    //
    // This asked only for a LIVE import, so a failed one was invisible: the
    // merchant saw "Import queued — your products will appear here shortly",
    // then a spinner that says it updates itself, then nothing — an empty
    // catalogue and no explanation anywhere in the product. Meanwhile
    // catalog-import throws messages written FOR them ("Double-check the
    // address — or keep pasting individual product links, which always
    // works"), which reached a server log and stopped there.
    //
    // Taking the most recent job of any status makes this self-clearing: a
    // later successful import is a newer row, so the error goes away on its
    // own rather than nagging forever.
    db.job.findFirst({
      where: { shopId: shop.id, type: "IMPORT_CATALOG" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, status: true, lastError: true },
    }),
    // Recent CREATOR pieces — surfaced inside the Studio as the "creations
    // shelf" (the Easel layout) so work accumulates in view, not only in the gallery.
    db.asset.findMany({
      where: { shopId: shop.id, type: { in: ["IMAGE_AD", "VIDEO_AD", "AUDIO"] }, metaJson: { contains: '"section":"creator"' } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, type: true, bodyJson: true, title: true },
    }),
  ]);
  const recent = recentRows
    .map((a) => {
      let b: { videoUrl?: string; imageUrl?: string; audioUrl?: string; url?: string } = {};
      try { b = JSON.parse(a.bodyJson || "{}"); } catch { /* ignore */ }
      return { id: a.id, isVideo: a.type === "VIDEO_AD", isAudio: a.type === "AUDIO", media: b.videoUrl || b.imageUrl || b.audioUrl || b.url || null, title: a.title || "Untitled" };
    })
    .filter((p) => !!p.media)
    .slice(0, 6);
  // REUSABLE FRAMES. Past presenter/product IMAGE renders the merchant can seed
  // a NEW video from WITHOUT re-combining (free) — "I already combined this, give
  // me another video from the same shot". Only durable /renders or /uploads paths
  // (the video fetches the seed server-side, so it must be a real hosted file, not
  // an expired provider URL), absolutized, newest first. avatarId/productTitle
  // ride along so picking one re-matches the presenter + product to the frame.
  const frameBase = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const frameRows = await db.asset.findMany({
    where: { shopId: shop.id, type: "IMAGE_AD" },
    orderBy: { createdAt: "desc" },
    take: 160,
    select: { id: true, bodyJson: true, metaJson: true, title: true, createdAt: true },
  });
  const frameChoices = frameRows.flatMap((a) => {
    let b: { imageUrl?: string; url?: string } = {};
    let m: { avatarId?: string; productTitle?: string } = {};
    try { b = JSON.parse(a.bodyJson || "{}"); } catch { /* ignore */ }
    try { m = JSON.parse(a.metaJson || "{}"); } catch { /* ignore */ }
    const raw = b.imageUrl || b.url || "";
    if (!raw.startsWith("/renders") && !raw.startsWith("/uploads")) return [];
    return [{
      id: a.id,
      media: frameBase ? frameBase + raw : raw,
      avatarId: m.avatarId || null,
      productTitle: m.productTitle || a.title || null,
      presenter: !!m.avatarId,
      when: a.createdAt.toISOString(),
    }];
  }).slice(0, 120);
  // The newest CREATOR generation job (any status) — so the Studio Stage can
  // surface a FAILED generation (e.g. a blocked/risky prompt) instead of
  // spinning forever. Self-clearing: a later success is a newer row.
  const lastGenRow = await db.job.findFirst({
    where: { shopId: shop.id, type: { in: ["GENERATE_IMAGE_AD", "GENERATE_VIDEO_AD", "GENERATE_SONG"] }, payload: { contains: '"section":"creator"' } },
    orderBy: { createdAt: "desc" },
    select: { status: true, createdAt: true, lastError: true },
  });
  const lastGen = lastGenRow ? { status: lastGenRow.status as string, at: lastGenRow.createdAt.toISOString(), error: lastGenRow.lastError || null } : null;
  // ---- Combine-step status (polled by ?combineJob=<id>) ----
  // The Combine step runs in MARKETING mode, so its presenter image is tagged
  // section:"marketing" and never appears in the creator-only `recent`/`lastGen`
  // above. Correlate on the JOB ID instead: look it up, then find the presenter
  // IMAGE_AD it produced (metaJson records avatarId; the Combine button is
  // disabled while combining, so only one runs at a time). Section-agnostic.
  const combineJobId = new URL(request.url).searchParams.get("combineJob");
  let combineResult: { jobId: string; done: boolean; failed: boolean; media: string | null } | null = null;
  if (combineJobId) {
    const cjob = await db.job.findFirst({
      where: { id: combineJobId, shopId: shop.id, type: "GENERATE_IMAGE_AD" },
      select: { status: true, createdAt: true, payload: true },
    });
    if (cjob) {
      let avId = "", pImg = "";
      try { const pl = JSON.parse(cjob.payload || "{}") as { avatarId?: string; productImageUrl?: string }; avId = pl.avatarId || ""; pImg = pl.productImageUrl || ""; } catch { /* */ }
      let media: string | null = null;
      if (avId) {
        // Match avatarId AND this combine's exact product image (both recorded
        // in the presenter asset's metaJson) so a concurrent presenter-image
        // burst of the same avatar can't win the newest-first race.
        const and: Array<Record<string, unknown>> = [{ metaJson: { contains: `"avatarId":"${avId}"` } }];
        if (pImg) and.push({ metaJson: { contains: `"productImageUrl":"${pImg}"` } });
        const casset = await db.asset.findFirst({
          where: { shopId: shop.id, type: "IMAGE_AD", createdAt: { gte: cjob.createdAt }, AND: and },
          orderBy: { createdAt: "desc" },
          select: { bodyJson: true },
        });
        if (casset) {
          try { const b = JSON.parse(casset.bodyJson || "{}") as { imageUrl?: string; url?: string }; media = b.imageUrl || b.url || null; } catch { /* */ }
          // The asset stores a RELATIVE "/renders/..." path. The video pipeline
          // fetches composedFrameUrl SERVER-SIDE (Node fetch needs an absolute
          // URL or it throws), so absolutize here — the same value also feeds the
          // in-flow <img> preview, where an absolute same-origin URL is fine too.
          if (media && media.startsWith("/")) { const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, ""); if (base) media = base + media; }
        }
      } else {
        // A FRAME-EDIT job (editing a reused/uploaded shot) carries editOp, not an
        // avatarId. Only one combine/edit runs at a time (the buttons disable while
        // combining), so the newest edit-method IMAGE_AD since this job started is
        // this edit's result. Keyed on method:"edit" so a concurrent plain gen
        // can't be mistaken for it.
        const easset = await db.asset.findFirst({
          where: { shopId: shop.id, type: "IMAGE_AD", createdAt: { gte: cjob.createdAt }, bodyJson: { contains: '"method":"edit"' } },
          orderBy: { createdAt: "desc" },
          select: { bodyJson: true },
        });
        if (easset) {
          try { const b = JSON.parse(easset.bodyJson || "{}") as { imageUrl?: string; url?: string }; media = b.imageUrl || b.url || null; } catch { /* */ }
          if (media && media.startsWith("/")) { const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, ""); if (base) media = base + media; }
        }
      }
      combineResult = { jobId: combineJobId, done: cjob.status === "COMPLETED" || cjob.status === "FAILED", failed: cjob.status === "FAILED", media };
    }
  }
  return json({
    combineResult,
    lastGen,
    recent,
    frameChoices,
    catalog,
    catalogCount,
    // Said next to the count, because the count on its own reads as "your
    // catalogue is here" when the import stopped at the ceiling.
    catalogTruncated: !!shop.catalogTruncatedAt,
    catalogSyncing: syncing?.status === "PENDING" || syncing?.status === "IN_PROGRESS",
    // Only when the MOST RECENT attempt is the failed one.
    catalogFailed: syncing?.status === "FAILED" ? syncing.lastError || tr(lang, "That import didn't complete.") : null,
    // Real start time, so the elapsed counter survives a reload instead of
    // restarting at zero and making a long import look stuck.
    catalogSyncStartedAt:
      syncing?.status === "PENDING" || syncing?.status === "IN_PROGRESS"
        ? syncing.createdAt.toISOString()
        : null,
    // A trial that's out of tokens shouldn't strand the merchant until day 7.
    trialing: planTrialing(shop.activePlan),
    hasBrand: !!shop.brandProfile,
    hasPlan: !!shop.activePlan?.active,
    tokens: tokensRemainingLive(shop.activePlan),
    caps: [...capabilitiesFor(shop.activePlan)] as string[],
    cast,
    brandFaceId,
    forgingAvatars,
    myPresenters,
    templates: AD_TEMPLATES.map((t) => ({ key: t.key, name: t.name, emoji: t.emoji, blurb: t.blurb, kind: t.kind })),
    costs: { video: TOKEN_COST.video, casualVideo: TOKEN_COST.casualVideo, image: TOKEN_COST.image, combine: TOKEN_COST.combine, createImage: TOKEN_COST.createImage, quickEdit: TOKEN_COST.quickEdit, videoEdit: TOKEN_COST.videoEdit, blog: TOKEN_COST.blog, music: TOKEN_COST.music, faceless: TOKEN_COST.faceless, avatarForge: TOKEN_COST.avatarForge },
    // OUTPUT language — the language the generated copy/script/captions are
    // written in (shop.contentLang). Surfaced as a subtle chip by the Make
    // button so a merchant can, e.g., run an English store but make Spanish ads.
    outputLang: normalizeContentLang(shop.contentLang),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const lang = readUiLang(request);
  const { shop } = await requireWebIdentity(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  // Crown a presenter as the Brand Face (no plan/brand gate needed).
  if (intent === "setBrandFace") {
    const id = ((form.get("avatarId") as string) || "").trim() || null;
    await db.shop.update({ where: { id: shop.id }, data: { brandAvatarId: id, brandAvatarVariant: 0 } });
    return json({ brandFaceSet: true });
  }

  // Out of trial tokens and ready to go? Bill now rather than making them wait
  // out the clock. Stripe closes the trial and raises the first invoice.
  if (intent === "endTrial") {
    const { endTrialNow } = await import("../lib/stripe.server");
    const { account } = await requireWebIdentity(request);
    const r = await endTrialNow(account.id);
    return r.ok
      ? json({ trialEnded: tr(lang, "You're on the full plan — your whole allowance just unlocked.") })
      : json({ error: r.error });
  }

  // Mirror the merchant's whole storefront so they can pick from a grid instead
  // of pasting a link every time. Queued, never inline: a sitemap-crawled store
  // is hundreds of fetches against their own server.
  if (intent === "importCatalog") {
    const storeUrl = ((form.get("storeUrl") as string) || "").trim();
    try {
      storeOrigin(storeUrl); // validates + blocks private hosts before queueing
    } catch (e) {
      return json({ catalogError: e instanceof Error ? e.message : tr(lang, "That doesn't look like a web address.") });
    }
    // A second submission usually means the merchant spotted a typo in the
    // first one. This used to answer "queued!" and silently drop the new URL,
    // so the wrong address kept importing, the corrected one never ran, and
    // re-submitting did nothing until the bad crawl finished — with no hint
    // anywhere that the address they were looking at was being ignored.
    const running = await db.job.findMany({
      where: { shopId: shop.id, type: "IMPORT_CATALOG", status: { in: ["PENDING", "IN_PROGRESS"] } },
      select: { id: true, status: true, payload: true },
      orderBy: { createdAt: "desc" },
    });
    const sameUrl = (p: string) => {
      try { return ((JSON.parse(p) as { storeUrl?: string }).storeUrl || "") === storeUrl; } catch { return false; }
    };
    // Already importing this exact address — nothing to do.
    if (running.some((j) => sameUrl(j.payload))) return json({ catalogQueued: true });

    // A CRAWL IS EXPENSIVE AND THIS PAGE IS REACHABLE WITHOUT A PLAN.
    //
    // Importing a catalogue is hundreds of fetches against someone else's
    // server, queued on a worker that runs one job at a time for every tenant.
    // It sits above the "pick a plan first" gate on purpose — a new merchant
    // has to be able to connect their store before they subscribe — so the
    // bound has to come from somewhere else. The dedupe below only catches the
    // same address twice; varying the URL walked straight past it.
    //
    // Correcting a typo takes a couple of goes. Six an hour is generous for
    // that and useless as an amplifier.
    const crawls = await db.job.count({
      where: {
        shopId: shop.id,
        type: "IMPORT_CATALOG",
        createdAt: { gte: new Date(Date.now() - 60 * 60_000) },
      },
    });
    if (crawls >= 6) {
      return json({ catalogError: tr(lang, "That's a lot of imports in one hour — give the last one time to finish and try again shortly.") });
    }

    // Re-point anything still waiting: it has not started, so it can simply
    // carry the corrected address instead.
    const pending = running.filter((j) => j.status === "PENDING");
    if (pending.length > 0) {
      await db.job.updateMany({
        where: { id: { in: pending.map((j) => j.id) }, status: "PENDING" },
        data: { payload: JSON.stringify({ storeUrl, cap: CATALOG_CAP }) },
      });
    } else {
      // Only an in-flight crawl of the old address exists. It cannot be
      // redirected mid-run, so queue the correction behind it — the worker is
      // serial, and the good import lands second and wins.
      await enqueueJob(shop.id, "IMPORT_CATALOG", { storeUrl, cap: CATALOG_CAP });
    }
    // Store the NORMALIZED origin, never the raw field. The placeholder reads
    // "yourstore.com" and the button is type="button", so type="url" never
    // validates — a merchant typing exactly what is shown saved a schemeless
    // value. catalog-import rewrites it the same way, but only AFTER a
    // successful discoverCatalog(), so every merchant whose import failed kept
    // it forever: lp.$slug blanked the buy button (a paid landing page with
    // nothing to click) and both /go turnstiles threw on new URL() and sent
    // their shoppers to easymodeapp.com instead of the merchant's store.
    await db.shop.update({ where: { id: shop.id }, data: { storeUrl: storeOrigin(storeUrl).origin } }).catch(() => { /* column is optional */ });
    return json({ catalogQueued: true });
  }

  // Import a product by URL — scrapes any storefront's page for a title +
  // image (JSON-LD → og: → <title>), with a Shopify /products/*.js shortcut.
  if (intent === "importUrl") {
    try {
      const p = await scrapeProductPage((form.get("url") as string) || "");
      // GROUND THE ONE-OFF PRODUCT, TOO. A pasted single URL never reached the
      // catalogue, so generateImageAd's by-title lookup (description, price,
      // buy-link) all missed and the copywriter fell back to invented specs.
      // Mirror this one product exactly as importCatalog mirrors each (keyed by
      // shopId_url) so the existing by-title grounding just works — no new field
      // threaded through the generate payload. Best-effort: a failed mirror must
      // never break the import the merchant actually asked for.
      if (p.title) {
        try {
          const data = {
            title: p.title.slice(0, 200),
            imageUrl: p.image || null,
            priceText: p.price || null,
            description: p.description || null,
            lastSeenAt: new Date(),
          };
          await db.catalogProduct.upsert({
            where: { shopId_url: { shopId: shop.id, url: p.url } },
            create: { shopId: shop.id, url: p.url, ...data },
            update: data,
          });
        } catch (e) {
          console.warn("[studio] single-URL catalogue mirror failed (non-fatal):", e instanceof Error ? e.message.slice(0, 120) : e);
        }
      }
      return json({ imported: { title: p.title || "", image: p.image || null, url: p.url } });
    } catch (e) {
      return json({ importError: e instanceof Error ? e.message : tr(lang, "Couldn't import from that URL.") });
    }
  }

  // "Turn your brand mascot into a marketing tool" — forge a private
  // presenter from an uploaded reference. Queued: four renders take ~90s.
  if (intent === "forgeAvatar") {
    if (!shop.activePlan?.active) return json({ avatarError: tr(lang, "Pick a plan first — the forge runs on tokens.") });
    // Custom presenters exist to STAR in avatar videos — a "video" capability
    // (Studio+). The forge was gated only on an active plan, so a standalone
    // Creator plan ($6.99, no video) could forge presenters it can never use in
    // a video AND at a loss: 4 nano-banana-pro renders (~$0.60 COGS) for 20
    // tokens = ~$0.28 on the Creator token floor. Gate it to the tier that can
    // actually use the output, where 20 tokens (~$0.87 on Studio) clears margin.
    if (!capabilitiesFor(shop.activePlan).has("video")) {
      return json({ avatarError: tr(lang, "Custom presenters star in your avatar videos — upgrade to a plan with video to forge one.") });
    }
    const name = ((form.get("avatarName") as string) || "").trim().slice(0, 40);
    if (!name) return json({ avatarError: tr(lang, "Give your presenter a name.") });
    const gender = form.get("avatarGender") === "f" ? "f" : "m";
    const ref = form.get("avatarPhoto");
    if (!ref || typeof ref === "string" || ref.size === 0) return json({ avatarError: tr(lang, "Upload a photo of your mascot or spokesperson.") });
    if (!/^image\//.test(ref.type)) return json({ avatarError: tr(lang, "That file isn't an image — use a JPG, PNG or WebP.") });
    if (ref.size > 8 * 1024 * 1024) return json({ avatarError: tr(lang, "Image too large — keep it under 8 MB.") });
    const [fsMod, pathMod, crypto] = await Promise.all([import("node:fs"), import("node:path"), import("node:crypto")]);
    const ext = ref.type === "image/png" ? "png" : ref.type === "image/webp" ? "webp" : "jpg";
    const dir = pathMod.join(process.cwd(), "data", "renders", "uploads");
    fsMod.mkdirSync(dir, { recursive: true });
    // Built by the same module that allowlists it — see app/lib/upload-names.ts.
    const fileName = uploadFileName(shop.id, crypto.randomBytes(8).toString("hex"), ext as UploadExt, "mascot");
    fsMod.writeFileSync(pathMod.join(dir, fileName), Buffer.from(await ref.arrayBuffer()));
    // THE FORGE COSTS US FOUR RENDERS AND CHARGED FOR NONE.
    //
    // The guard above already tells the merchant "the forge runs on tokens",
    // and then nothing took any: no spendTokens, no in-flight guard, no cap on
    // how many presenters a shop could forge. Every submit queued a job that
    // renders one portrait per outfit — four paid generations, in parallel —
    // so pressing the button repeatedly was free to the merchant and billed to
    // us, without limit.
    const running = await db.job.count({
      where: { shopId: shop.id, type: "FORGE_CUSTOM_AVATAR", status: { in: ["PENDING", "IN_PROGRESS"] } },
    });
    if (running > 0) {
      return json({ avatarError: tr(lang, "Your last presenter is still being forged — give it a minute.") });
    }
    const MAX_CUSTOM_PRESENTERS = 12;
    const owned = await db.customAvatar.count({ where: { shopId: shop.id } });
    if (owned >= MAX_CUSTOM_PRESENTERS) {
      return json({ avatarError: tr(lang, "You already have {n} presenters — delete one to forge another.", { n: MAX_CUSTOM_PRESENTERS }) });
    }

    let forgeFromExtra = 0;
    try {
      forgeFromExtra = (await spendTokens(shop.id, TOKEN_COST.avatarForge)).fromExtra;
    } catch (e) {
      return json({ avatarError: e instanceof Error ? e.message : tr(lang, "Not enough tokens to forge a presenter.") });
    }

    // The spend above is committed, so everything after it has to either queue
    // the work or give the tokens back. Unguarded, a failure here escaped the
    // action as a 500 error page with the forge fee gone and no job to refund
    // it — refundPrepaidOnce needs a job row, and there is none until the
    // enqueue below succeeds.
    try {
      const row = await db.customAvatar.create({
        data: {
          shopId: shop.id, name, gender,
          // Vibe sets the speaking PACE (castFor maps energy → speed); voice is
          // the owner's explicit pick, coerced to a known clean voice so a bad id
          // can never reach the TTS model.
          energy: ["hype", "warm", "calm"].includes(String(form.get("avatarEnergy"))) ? String(form.get("avatarEnergy")) : "warm",
          voiceId: safeVoiceId((form.get("avatarVoice") as string) || "", gender),
          desc: ((form.get("avatarDesc") as string) || "").trim().slice(0, 200) || `${name}, the brand's own presenter character`,
          refFile: fileName,
        },
      });
      await enqueueJob(shop.id, "FORGE_CUSTOM_AVATAR", {
        customAvatarId: row.id,
        prePaid: true,
        chargedTokens: TOKEN_COST.avatarForge,
        chargedFromExtra: forgeFromExtra,
      });
      return json({ avatarQueued: name });
    } catch (e) {
      try {
        await refundTokens(shop.id, TOKEN_COST.avatarForge, forgeFromExtra);
        console.warn(`[studio] forge failed before queueing — refunded ${TOKEN_COST.avatarForge} tokens to shop ${shop.id}`);
      } catch (re) {
        console.error(
          `[studio] FORGE REFUND FAILED — shop ${shop.id} is owed ${TOKEN_COST.avatarForge} tokens: `,
          re instanceof Error ? re.message.slice(0, 200) : re,
        );
      }
      return json({ avatarError: e instanceof Error ? e.message : tr(lang, "Couldn't start the forge — your tokens were returned.") });
    }
  }

  // Managing your OWN presenters (delete / change voice) is deliberately NOT
  // gated on an active plan or brand voice — a lapsed merchant must still be able
  // to free a slot or fix a voice. These sit before the generic gates below.
  if (intent === "deleteAvatar") {
    const pub = ((form.get("avatarId") as string) || "").trim();
    const id = pub.startsWith("cav") ? pub.slice(3) : pub;
    const row = await db.customAvatar.findFirst({ where: { id, shopId: shop.id } });
    if (!row) return json({ avatarError: tr(lang, "That presenter is already gone.") });
    const [fsMod, pathMod] = await Promise.all([import("node:fs"), import("node:path")]);
    const rdir = pathMod.join(process.cwd(), "data", "renders");
    try {
      const files: string[] = JSON.parse(row.files || "[]");
      for (const f of files) { try { fsMod.unlinkSync(pathMod.join(rdir, f)); } catch { /* cache file — non-fatal */ } }
    } catch { /* files column unparseable — nothing to unlink */ }
    if (row.refFile) { try { fsMod.unlinkSync(pathMod.join(rdir, "uploads", row.refFile)); } catch { /* non-fatal */ } }
    await db.customAvatar.delete({ where: { id: row.id } });
    return json({ avatarDeleted: row.name });
  }

  // Change a custom presenter's voice — including FIXING one forged before the
  // voice picker shipped (the "my character got an accent" case). Coerced to a
  // known clean voice; shop-scoped so it can only touch this shop's presenters.
  if (intent === "setAvatarVoice") {
    const pub = ((form.get("avatarId") as string) || "").trim();
    const id = pub.startsWith("cav") ? pub.slice(3) : pub;
    const row = await db.customAvatar.findFirst({ where: { id, shopId: shop.id } });
    if (!row) return json({ avatarError: tr(lang, "That presenter is already gone.") });
    const voiceId = safeVoiceId((form.get("avatarVoice") as string) || "", row.gender === "f" ? "f" : "m");
    await db.customAvatar.update({ where: { id: row.id }, data: { voiceId } });
    return json({ avatarVoiceSet: row.name });
  }

  // The Creator section (casual mode) is its own entitlement — gate it here.
  const casualMode = form.get("mode") === "casual";
  // Creators don't need a brand voice (that's a marketing concept); only
  // marketing generation requires it. Editing never did.
  if (!shop.brandProfile && intent !== "edit" && !casualMode) return json({ error: tr(lang, "Set your brand voice on the Dashboard first.") });
  if (!shop.activePlan?.active) return json({ error: tr(lang, "Pick a plan on the Dashboard first — content runs on tokens.") });
  // Creator section = the $6.99 Creator entitlement (standalone plan, the +add-on,
  // Legend, or a trial). Without it, send them to unlock it rather than generate.
  // Photo EDITS are a Creator feature too — gate them on the entitlement itself,
  // not just the client-supplied mode flag (a marketing-mode POST can't bypass it).
  if ((casualMode || intent === "edit" || intent === "create" || intent === "music" || intent === "quickedit") && !capabilitiesFor(shop.activePlan).has("creator")) {
    return json({ error: tr(lang, "Creator is included on every plan — pick one on the Plans page to make images, edit photos and generate music (or get the standalone Creator plan for $6.99/mo).") });
  }

  // FRAME UPLOAD — the merchant brings their OWN presenter-holding-product shot to
  // seed a video without paying for a compose. Handled HERE, before the product-
  // name requirement and the product-photo resolution below (an uploaded frame
  // needs neither). Store it on the durable disk and hand back the public /uploads
  // URL to use as the seed (same storage as a product-photo upload). FREE.
  if (intent === "frameUpload") {
    const frame = form.get("productPhoto");
    if (!frame || typeof frame === "string" || frame.size === 0) return json({ error: tr(lang, "Pick an image to use as your frame.") });
    if (!/^image\//.test(frame.type)) return json({ error: tr(lang, "That file isn't an image — use a JPG, PNG or WebP.") });
    if (frame.size > 8 * 1024 * 1024) return json({ error: tr(lang, "Image too large — keep it under 8 MB.") });
    const [fsMod, pathMod, crypto] = await Promise.all([import("node:fs"), import("node:path"), import("node:crypto")]);
    const ext = frame.type === "image/png" ? "png" : frame.type === "image/webp" ? "webp" : "jpg";
    const dir = pathMod.join(process.cwd(), "data", "renders", "uploads");
    fsMod.mkdirSync(dir, { recursive: true });
    const name = uploadFileName(shop.id, crypto.randomBytes(8).toString("hex"), ext as UploadExt);
    fsMod.writeFileSync(pathMod.join(dir, name), Buffer.from(await frame.arrayBuffer()));
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    if (!base) return json({ error: tr(lang, "Photo uploads aren't configured on this server yet.") });
    return json({ frameUrl: `${base}/uploads/${name}` });
  }

  // Same reasoning as `direction` below: productTitle is interpolated into the
  // prompt (and in casual video mode it IS the scene description), so a pasted
  // brief here buries the fidelity clauses just the same. Word-safe clamp — 300
  // fits a full creative sentence and stops a novel; a short title passes
  // through untouched. Mirrors the client maxLength on both inputs.
  const productTitle = trimToWord((form.get("productTitle") as string) || "", 300);
  const urlField = ((form.get("productImageUrl") as string) || "").trim() || undefined;
  // THE LINK THE STUDIO PROMISES TWICE.
  //
  // The catalogue picker submits productUrl and the page says, in two places,
  // that "the product page rides along to the post, so shoppers land straight
  // on the buy page". The action never read it. The go turnstile then fell
  // back to matching the title against the mirrored catalogue, and when that
  // missed — a hand-typed title, anything added by URL, any service — it
  // reached for the shop's domain, which for a web account is synthetic and
  // dead. Carried on the payload now so the asset can keep it.
  const productUrlRaw = ((form.get("productUrl") as string) || "").trim();
  const productUrl =
    productUrlRaw && /^https?:\/\//i.test(productUrlRaw) && productUrlRaw.length <= 600
      ? productUrlRaw
      : undefined;
  // The input carries maxLength={300}, which is a courtesy to the merchant and
  // nothing to the server: this string is interpolated straight into the image
  // and video prompts, ahead of the fidelity clauses that keep the product
  // looking like the product. A pasted brief pushes those to the tail of a very
  // long prompt, where models weight them least. 500 leaves room for the
  // composed presets on top of a full-length direction and stops a novel.
  // trimToWord, not slice: this text is read by a model, so it must not end
  // mid-word.
  const direction = trimToWord((form.get("direction") as string) || "", 500) || undefined;
  // PROMPT SAFETY SCREEN — classify the creative prompt BEFORE spending a token
  // or touching the pipeline. An unsafe prompt never travels the pipeline; it
  // gets a distinct "against our guidelines" message (unsafe:true) so the client
  // can tell it apart from a general generation failure. Fails open. Scoped to
  // the free-text Creator generators (quickedit uses our own baked prompts).
  let genPermissive = false;
  if (["create", "edit", "music", "faceless"].includes(intent) || (intent === "video" && casualMode)) {
    const screenText = [form.get("createPrompt"), direction, form.get("productTitle")]
      .map((v) => (typeof v === "string" ? v : "")).join("\n").trim();
    if (screenText) {
      const verdict = await screenCreatePrompt(screenText);
      if (!verdict.ok) return json({ error: verdict.message, unsafe: true });
      genPermissive = verdict.permissive;
    }
  }
  // casualMode (above) is authoritative on the SERVER: even if a merchant-only
  // hidden field leaks from a stale client, casual never honors service/offer/
  // ad-format selections. This is the real guard; client-side hiding is only UX.
  // Which SECTION this piece belongs to — casual = the Creator gallery, marketing
  // = the Marketing archive. Carried on every job so the Archive can split them.
  const genSection = casualMode ? "creator" : "marketing";
  const service = !casualMode && form.get("service") === "1"; // intangible offering — sell the outcome
  const wear = form.get("wear") === "1";
  // Composed client-side from doWhat+where (or the direction), both already
  // capped — but clamp here too so a crafted POST can't smuggle a novel into
  // the prompt. Word-safe: the scene line is read by the model.
  const scene = trimToWord((form.get("scene") as string) || "", 300) || undefined;
  // Creator flows carry their own title (the prompt): photo edits, text-to-image
  // "create", and music never ask for a product name — only the product-based ad
  // flows do. (Masked until Creator became free on every plan — now reachable.)
  // Casual video is now describe-first too (no separate "name" field) — derive
  // its title from the description, same as create/music/faceless.
  // "combine" is excluded: the combine identifies the product from its PHOTO, so
  // a name isn't needed to combine — it's collected at the video step. (The old
  // per-branch check at the combine handler was removed; THIS global one also had
  // to let combine through, which was the real "name required before combine" bug.)
  // frameEdit (editing an uploaded/reused Combine shot) and videoedit (an ffmpeg
  // edit of an uploaded clip) are EDITS of a file the user supplied — like
  // combine, they identify the subject from the photo/clip, NOT a typed name
  // (that's collected later, for the video script). Excluding them fixes the
  // "give the product a name" wall the OG avatar flow hit on upload-then-edit.
  if (!productTitle && intent !== "edit" && intent !== "create" && intent !== "music" && intent !== "faceless" && intent !== "combine" && intent !== "frameEdit" && intent !== "videoedit" && !(casualMode && intent === "video")) return json({ error: tr(lang, "Give the product a name.") });
  if (urlField && !/^https?:\/\//.test(urlField)) return json({ error: tr(lang, "The product image must be a full https:// URL.") });

  // Uploaded photo beats the URL field — not everyone has a hosted image.
  // Stored on the persistent disk and served publicly at /uploads/* so the
  // render engines can fetch it like any other product URL.
  let productImageUrl = urlField;
  let uploadedPhoto = false;
  const photo = form.get("productPhoto");
  if (photo && typeof photo !== "string" && photo.size > 0) {
    if (!/^image\//.test(photo.type)) return json({ error: tr(lang, "That file isn't an image — use a JPG, PNG or WebP.") });
    if (photo.size > 8 * 1024 * 1024) return json({ error: tr(lang, "Image too large — keep it under 8 MB.") });
    const [fsMod, pathMod, crypto] = await Promise.all([import("node:fs"), import("node:path"), import("node:crypto")]);
    const ext = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
    const dir = pathMod.join(process.cwd(), "data", "renders", "uploads");
    fsMod.mkdirSync(dir, { recursive: true });
    const name = uploadFileName(shop.id, crypto.randomBytes(8).toString("hex"), ext as UploadExt);
    fsMod.writeFileSync(pathMod.join(dir, name), Buffer.from(await photo.arrayBuffer()));
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    if (!base) return json({ error: tr(lang, "Photo uploads aren't configured on this server yet — paste an image URL instead.") });
    productImageUrl = `${base}/uploads/${name}`;
    uploadedPhoto = true;
  }

  // RESOLVE WHAT THEY PASTED — merchants paste product PAGE links, not .jpg
  // files, because that's the natural thing to do. A page URL used to fail the
  // render three minutes later ("input was invalid") with the tokens already
  // spent. Now: direct images pass through, product pages get scraped for
  // their hero image, and only a genuinely unusable link is refused — before
  // any charge, with a message that says what to do.
  if (productImageUrl && !uploadedPhoto) {
    const resolved = await resolveImageOrPage(productImageUrl);
    if (!resolved.image) {
      return json({ error: tr(lang, "We couldn't get a product image from that link — {why}. Paste a direct image link, or upload the photo.", { why: resolved.why || tr(lang, "it isn't an image and has no product photo on the page") }) });
    }
    productImageUrl = resolved.image;
  }

  // HARD REQUIREMENT: no product photo = the engines invent a product from
  // the title and the merchant pays for generic AI art. Services are one
  // legitimate exception (there is nothing to photograph); the other is CASUAL
  // (Creator) video, which is a text-to-video CREATIVE generator by design —
  // "describe anything, no photo" — not a factual product ad, so a photoless
  // render is the intended path (minimax text-to-video / cartoon text keyframe),
  // and the claims guardrail already governs any spoken/on-screen copy.
  if ((intent === "video" || intent === "image") && !service && !productImageUrl && !(casualMode && intent === "video")) {
    return json({ error: tr(lang, "Add a product photo — upload one or paste an image URL. Without it we'd be inventing a product from the name. Promoting a service? Switch to “Service / offer”.") });
  }

  // TOKENS CHARGED BUT NOT YET BACKED BY A QUEUED JOB.
  //
  // Every branch below spends FIRST and enqueues after, which is the right
  // order — it is what makes the spend atomic and the burst share recordable
  // per piece. But if a db.job.create threw between the two (a pool timeout,
  // the connection drop that follows a deploy), the catch returned an error and
  // the debit stayed: there is no job row for refundPrepaidOnce to find, so
  // nothing anywhere gives those tokens back. A Veo x3 burst is 675 tokens.
  //
  // Tracked here rather than in each branch so a new branch cannot forget it:
  // charge sets the debt, each successful enqueue retires its share, and the
  // catch refunds whatever is left.
  let unbackedTokens = 0;
  let unbackedFromExtra = 0;
  const charged = (total: number, fromExtra: number) => { unbackedTokens = total; unbackedFromExtra = fromExtra; };
  const backed = (tokens: number, fromExtra: number) => {
    unbackedTokens = Math.max(0, unbackedTokens - tokens);
    unbackedFromExtra = Math.max(0, unbackedFromExtra - fromExtra);
  };

  try {
    if (intent === "video") {
      let contentType = ((form.get("contentType") as string) || "").trim() || undefined;
      // Casual never renders the ad-coded content types — coerce the two most
      // ad-shaped (a story Commercial, a Creator Demo) to a neutral Product
      // Highlight even if a stale client submits them. The picker already hides
      // them in casual; this is the server guard.
      if (casualMode && (contentType === "commercial" || contentType === "review")) contentType = "highlight";
      // Preset translation: the picker key becomes its base pipeline type and
      // its baked-in direction rides ahead of whatever the merchant typed.
      const preset = contentType ? CT_PRESETS[contentType] : undefined;
      // Talking Head builds its direction from the merchant's WHERE + pose picks
      // instead of the fixed "at home" preset, so the setting actually steers it.
      let presetDir = preset?.direction || "";
      if (contentType === "talkinghead") {
        const setKey = ((form.get("thSetting") as string) || "home").trim();
        const pose = (form.get("thPose") as string) === "seated" ? "seated" : "standing";
        const thSet = TALKINGHEAD_SETTINGS.find((s) => s.key === setKey) || TALKINGHEAD_SETTINGS[0];
        presetDir = `Shot like an authentic selfie-style TikTok: the creator films themselves at arm's length (or with the phone propped up), ${thSet.prompt}, ${pose === "seated" ? "SEATED" : "STANDING"}, talking directly to camera — casual, warm and real, like organic UGC, not a polished studio ad. Natural handheld energy, genuine to-camera delivery. NO product is shown, held, or worn — this is a pure talking-head about the topic.`;
      }
      const videoDirection = [presetDir, direction].filter(Boolean).join(" ") || direction;
      if (preset) contentType = preset.base;
      // Creator has NO presenter picker — casual video is always the cheap
      // no-presenter path. Forcing avatarId off in casual also CLOSES an exploit:
      // a crafted casual request carrying avatarId would otherwise run the
      // expensive AI_AVATAR lipsync pipeline at the cheap creatorvideo gate/price.
      const avatarId = casualMode ? undefined : (((form.get("avatarId") as string) || "").trim() || undefined);
      const cartoonStyle = ((form.get("cartoonStyle") as string) || "").trim() || undefined;
      const avatarVariant = Math.max(0, Math.min(3, parseInt((form.get("avatarVariant") as string) || "0", 10) || 0));
      const videoEngine = normalizeEngineKey((form.get("videoEngine") as string) || "");
      const commercial = !casualMode && form.get("commercial") === "1"; // the packshot endcard reads "ad" — never in casual
      const breakout = form.get("breakout") === "1";
      // Creator-section (casual) video uses the cheap "creatorvideo" cap — the
      // $6.99 Creator plan can make these, metered by tokens. A marketing video
      // keeps its full video/cartoon/anthem requirement (Studio+).
      assertCapability(shop.activePlan, casualMode ? "creatorvideo" : videoCapabilityFor(contentType));
      // Pre-charge validation: a presenter has to have something to hold —
      // fail BEFORE tokens are spent, not in the pipeline.
      const presenterVideo = !!avatarId && contentType !== "cartoon" && contentType !== "jingle";
      if (presenterVideo && !productImageUrl && !service) {
        return json({ error: tr(lang, "Add a product photo — the presenter needs something to hold. (Promoting a service? Flip to Service / offer.)") });
      }
      // A Studio-approved "presenter holding the product" frame (the Combine
      // step) seeds the video directly — the pipeline uses exactly what the
      // merchant approved and skips its own internal compose. Forwarded for any
      // presenter+product video so avatar/review/CARTOON animate from it (cartoon
      // rejoined the hub 2026-10-26: its Combine renders the STYLED keyframe and
      // the video seeds from it via resume.keyframeUrl). Gated to a real presenter
      // + not-service so a stray value can never ride a service clip; no product → none.
      const composedFrameUrl = !!avatarId && !service
        ? (((form.get("composedFrameUrl") as string) || "").trim() || undefined)
        : undefined;
      // The engine picker drives an IMAGE-TO-VIDEO render. A presenter ad does
      // not use one: it goes through the lipsync chain (HeyGen/omni-human), so
      // generateUgcAd never even receives videoEngine — and a cartoon with a
      // presenter now lipsyncs too. Charging the Seedance or Veo surcharge on
      // those was billing for an engine that never ran.
      // Commercial renders one clip PER BEAT (up to 5) for a SINGLE engine
      // surcharge, so a premium engine there loses money on every spot (and
      // every burst multiplies it). Pin Commercial to the default animator:
      // no surcharge billed, default-engine COGS stays inside the flat price.
      const engineDrivesRender = !avatarId && contentType !== "commercial";
      const effectiveEngine = engineDrivesRender ? videoEngine : "auto";
      // Casual (Creator) video is a single clip — priced well below a full
      // marketing video ad (presenter/multi-scene). Engine surcharge still rides.
      const videoBase = casualMode ? TOKEN_COST.casualVideo : TOKEN_COST.video;
      // Creator floor: a premium engine's surcharge was sized for Studio tokens,
      // so scale it up on casual video (creatorvideo cap) — see CREATOR_SURCHARGE_MULT.
      const each = videoBase + engineSurcharge(effectiveEngine) * (casualMode ? CREATOR_SURCHARGE_MULT : 1);
      // Video bursts cap lower than image bursts — one video is 60+ tokens, so
      // a ten-pack would empty most wallets on a single tap. Three is enough
      // to pick from without being a decision the merchant regrets.
      const n = burstCount(form, MAX_BURST.video);
      // Split the burst spend across its pieces so each job records the
      // bucket ITS share came from — a burst can straddle allowance and
      // top-up, and a single failed piece must refund only its own share.
      const burstFromExtra = (await spendTokens(shop.id, each * n)).fromExtra;
      const perPieceFromExtra = Math.floor(burstFromExtra / n);
      // floor() drops up to n-1 tokens of the top-up share; hand that remainder
      // to the first `rem` pieces so the per-piece extra sums back to the full
      // burstFromExtra. Otherwise a fully-failed burst refunds the remainder to
      // the expiring allowance instead of the purchased top-up it came from.
      const rem = burstFromExtra - perPieceFromExtra * n;
      charged(each * n, burstFromExtra);
      for (let i = 0; i < n; i++) {
        // Services: the presenter explains the offer to camera — nothing to hold.
        await enqueueJob(shop.id, "GENERATE_VIDEO_AD", {
          section: genSection,
          // Casual video has no name field — title it from the description.
          productTitle: productTitle || (casualMode ? (direction || "").slice(0, 60) || "My video" : productTitle),
          productImageUrl, productUrl, customPrompt: videoDirection, productDescription: direction,
          style: presenterVideo ? "AI_AVATAR" : "PRODUCT_HIGHLIGHT",
          contentType, cartoonStyle,
          avatarId, avatarVariant,
          holdProduct: !!avatarId && !service,
          composedFrameUrl,
          productSize: ((form.get("productSize") as string) || "").trim() || undefined,
          wearProduct: !!avatarId && wear && !service,
          serviceMode: service, scene,
          videoEngine: effectiveEngine, commercial, breakout, chargedTokens: each, chargedFromExtra: perPieceFromExtra + (i < rem ? 1 : 0), prePaid: true, initiator: "web",
        }, burstRunAt(i));
        backed(each, perPieceFromExtra + (i < rem ? 1 : 0));
      }
      return json({ ok: true, queued: "video", count: n });
    }
    if (intent === "videoedit") {
      // Creator "edit a video" — upload a clip + ONE ffmpeg op (trim / caption /
      // speed). The cheap, token-metered path, so it's gated at "creatorvideo"
      // (the $6.99 Creator plan carries it), exactly like casual video + faceless.
      assertCapability(shop.activePlan, "creatorvideo");
      // The source is its OWN upload field (productVideo), not productPhoto, so
      // the image-only productPhoto block above never touches it. Stored on the
      // persistent disk at /uploads/* and served publicly so the ffmpeg half can
      // read it like any uploaded asset — same shape as the productPhoto path.
      const vid = form.get("productVideo");
      if (!vid || typeof vid === "string" || vid.size === 0) {
        return json({ error: tr(lang, "Add a video to edit — upload an MP4, MOV or WebM.") });
      }
      if (!/^video\//.test(vid.type)) {
        return json({ error: tr(lang, "That file isn't a video — use an MP4, MOV or WebM.") });
      }
      if (vid.size > 150 * 1024 * 1024) {
        return json({ error: tr(lang, "Video too large — keep it under 150 MB.") });
      }
      const [fsMod, pathMod, crypto] = await Promise.all([import("node:fs"), import("node:path"), import("node:crypto")]);
      // ext from mime first, then the filename, defaulting to mp4 — kept inside
      // the uploadFileName allowlist (mp4/mov/webm).
      const nm = typeof vid.name === "string" ? vid.name.toLowerCase() : "";
      const vext: UploadExt =
        vid.type === "video/webm" || nm.endsWith(".webm") ? "webm"
        : vid.type === "video/quicktime" || nm.endsWith(".mov") ? "mov"
        : "mp4";
      const vdir = pathMod.join(process.cwd(), "data", "renders", "uploads");
      fsMod.mkdirSync(vdir, { recursive: true });
      const vname = uploadFileName(shop.id, crypto.randomBytes(8).toString("hex"), vext, "video");
      fsMod.writeFileSync(pathMod.join(vdir, vname), Buffer.from(await vid.arrayBuffer()));
      const vbase = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
      if (!vbase) return json({ error: tr(lang, "Video uploads aren't configured on this server yet.") });
      const sourceVideoUrl = `${vbase}/uploads/${vname}`;
      // The op + its params. Validation of ranges/values lives in the ffmpeg half
      // (editVideo throws a clear Error on bad params); here we just parse.
      const editOp = ((form.get("editOp") as string) || "").trim();
      if (editOp !== "trim" && editOp !== "caption" && editOp !== "speed") {
        return json({ error: tr(lang, "Pick what to do with the video — trim, caption or speed.") });
      }
      const startSecRaw = Number(form.get("startSec"));
      const endSecRaw = Number(form.get("endSec"));
      const speedRaw = Number(form.get("speed"));
      const startSec = Number.isFinite(startSecRaw) ? startSecRaw : undefined;
      const endSec = Number.isFinite(endSecRaw) ? endSecRaw : undefined;
      const speed = Number.isFinite(speedRaw) ? speedRaw : undefined;
      const captionText = trimToWord((form.get("captionText") as string) || "", 200) || undefined;
      const editTitle = trimToWord((form.get("title") as string) || "", 80) || undefined;
      // Spend FIRST, enqueue after — the same order (and the same unbacked-token
      // guard) every branch uses, so a db.job.create that throws refunds.
      const veFromExtra = (await spendTokens(shop.id, TOKEN_COST.videoEdit)).fromExtra;
      charged(TOKEN_COST.videoEdit, veFromExtra);
      await enqueueJob(shop.id, "EDIT_VIDEO", {
        section: "creator", sourceVideoUrl, editOp, startSec, endSec, captionText, speed, title: editTitle,
        prePaid: true, chargedTokens: TOKEN_COST.videoEdit, chargedFromExtra: veFromExtra,
      });
      backed(TOKEN_COST.videoEdit, veFromExtra);
      return json({ ok: true, queued: "videoedit", count: 1 });
    }
    if (intent === "image") {
      assertCapability(shop.activePlan, "image");
      const avatarId = ((form.get("avatarId") as string) || "").trim() || undefined;
      const avatarVariant = Math.max(0, Math.min(3, parseInt((form.get("avatarVariant") as string) || "0", 10) || 0));
      if (avatarId && !productImageUrl && !service) {
        return json({ error: tr(lang, "Add a product photo — the presenter needs something to hold.") });
      }
      // Ad templates & formats are marketing constructs — never applied in
      // casual, so a casual image is a clean styled still, not an ad layout.
      const rawTemplate = ((form.get("templateKey") as string) || "").trim();
      const templateKey = !casualMode && AD_TEMPLATE_BY_KEY[rawTemplate] ? rawTemplate : undefined;
      const rawFormat = ((form.get("formatKey") as string) || "").trim();
      const formatKey = !casualMode && AD_FORMAT_BY_KEY[rawFormat] ? rawFormat : undefined;
      const n = burstCount(form, MAX_BURST.image);
      // Charge the WHOLE burst in one call. spendTokens throws a plain
      // "needs X, you have Y" before anything is queued, so a burst the
      // merchant can't afford costs them nothing and says so — far better
      // than queueing four and failing the fifth mid-run.
      // Capture the split, like the video path above. spendTokens draws from
      // the expiring allowance first and the purchased top-up only after it
      // runs out, and the job carries that split so a terminal failure refunds
      // to the same place. Discarding it meant an image paid for with bought,
      // never-expiring tokens came back as allowance and expired at the next
      // period roll — the merchant paid cash for those.
      const imgFromExtra = (await spendTokens(shop.id, TOKEN_COST.image * n)).fromExtra;
      const imgPerPieceFromExtra = Math.floor(imgFromExtra / n);
      // Same floor() remainder as the video burst above — give the leftover
      // top-up tokens to the first `imgRem` pieces so a fully-failed burst
      // refunds to the purchased bucket, not the expiring allowance.
      const imgRem = imgFromExtra - imgPerPieceFromExtra * n;
      charged(TOKEN_COST.image * n, imgFromExtra);
      // A burst exists to give the merchant a SPREAD to choose from, so when
      // they haven't pinned a template or format, walk the format list instead
      // of rendering the same composition n times. Pin one and every shot in
      // the burst honours it — the variation then comes from the render.
      // Casual never walks the ad-format list — its spread stays empty so every
      // shot is a clean scene still, not a rotation of ad layouts.
      const spread = !casualMode && !templateKey && !formatKey && !avatarId && !service
        ? AD_FORMATS.slice(0, n).map((f) => f.key)
        : [];
      for (let i = 0; i < n; i++) {
        // Services skip the presenter-hold and product photo → outcome scene.
        await enqueueJob(shop.id, "GENERATE_IMAGE_AD", {
          section: genSection,
          // ALWAYS FRESH FROM THE STUDIO.
          //
          // This was `n > 1`: a burst composed fresh, a single press reused the
          // Shot Library’s frozen composite for the pair. That was sound while
          // presenter stills carried a copy overlay — same composite, different
          // headline, different ad. Then presenter stills started shipping
          // CLEAN (see the “NO POSTER TEXT ON A PRESENTER SHOT” note in
          // image-generation.server.ts) and nobody reconnected the two, so the
          // reuse has nothing left to vary: the frozen shot IS the deliverable.
          //
          // The wardrobe variant is part of the shot key and the client rotates
          // it 0→1→2→3, so ads 1-4 differ and ad 5 comes back byte-identical to
          // ad 1, at full price, forever. This Archive has a pair with eight
          // assets pointing at one render.
          //
          // A merchant pressing Generate is asking for another one, so they get
          // another one. The library still serves every other caller.
          freshShot: true,
          productTitle, productImageUrl, productUrl, stylePrompt: direction,
          styleMode: direction ? "scene" : "backdrop",
          templateKey: avatarId || service ? undefined : templateKey,
          formatKey: avatarId || service ? undefined : (spread[i] || formatKey),
          // Only a merchant-declared promotion ever puts an offer on an ad — and
          // never in casual, where there's nothing being sold.
          merchantOffer: casualMode ? undefined : (((form.get("merchantOffer") as string) || "").trim().slice(0, 40) || undefined),
          productSize: ((form.get("productSize") as string) || "").trim() || undefined,
          avatarId: service ? undefined : avatarId, avatarVariant,
          wear: !!avatarId && wear && !service,
          serviceMode: service, scene, prePaid: true,
          chargedTokens: TOKEN_COST.image, chargedFromExtra: imgPerPieceFromExtra + (i < imgRem ? 1 : 0),
        }, burstRunAt(i));
        backed(TOKEN_COST.image, imgPerPieceFromExtra + (i < imgRem ? 1 : 0));
      }
      return json({ ok: true, queued: "image", count: n });
    }
    if (intent === "combine") {
      // Compose-first "Combine" step: render the presenter-holding-product frame
      // as ONE normal image gen (1 image charge, lands in the gallery), and hand
      // back the JOB ID so the client can correlate the exact result (the
      // section-filtered recent list can't see a marketing image). The video
      // then reuses this approved frame as its animation seed.
      assertCapability(shop.activePlan, "image");
      const avatarId = ((form.get("avatarId") as string) || "").trim() || undefined;
      const avatarVariant = Math.max(0, Math.min(3, parseInt((form.get("avatarVariant") as string) || "0", 10) || 0));
      // Post-combine tweaks ("New setting" / the free-text Edit box) ride in as a
      // scene/direction: runPresenterHold feeds it to the compose as `scene`, so
      // "put them in an office" relights into that setting and "green shirt" is a
      // best-effort style note. Empty = the presenter's own backdrop (the default).
      const combineScene = ((form.get("combineScene") as string) || "").trim().slice(0, 200) || undefined;
      if (!avatarId) return json({ error: tr(lang, "Pick a presenter first.") });
      if (!productImageUrl) return json({ error: tr(lang, "Add a product photo — the presenter needs something to hold.") });
      // The product NAME is for the video script, not the combine — the combine
      // identifies the product from its PHOTO (and reads scale from the photo),
      // so a name is NOT required here. Default it only so the compose prompt
      // isn't an empty string; the real name is collected at the video step.
      // Combine is priced on its OWN cost (nano-banana-pro compose ~$0.15), not
      // the shared cheap-model image price — see TOKEN_COST.combine.
      const cFromExtra = (await spendTokens(shop.id, TOKEN_COST.combine)).fromExtra;
      charged(TOKEN_COST.combine, cFromExtra);
      const combineJobId = await enqueueJob(shop.id, "GENERATE_IMAGE_AD", {
        section: genSection,
        freshShot: true,
        productTitle: productTitle || "product", productImageUrl, productUrl,
        styleMode: "backdrop",
        scene: combineScene,
        avatarId, avatarVariant,
        wear: !!avatarId && wear && !service,
        // Size + hold/wear are COMBINE inputs — they decide how the presenter
        // holds/shows the product and at what scale (a card "fits in palm", a
        // case needs both hands). Was missing, so the compose only inferred size
        // from the title; the video later just animates this approved frame.
        productSize: ((form.get("productSize") as string) || "").trim() || undefined,
        // Presenter-holding frame or nothing — a product-only still is not what
        // Combine asked for, so a miss FAILS (and refunds) instead of charging.
        presenterOnly: true,
        // CARTOON combine → the frame the merchant approves must BE the cartoon
        // look, so run the cartoon keyframe (compose → cartoonize in the chosen
        // style → product-in-hand gate) instead of the photoreal compose; the
        // approved frame then seeds the video. Non-cartoon stays photoreal.
        ...(((form.get("contentType") as string) || "").trim() === "cartoon"
          ? { cartoonKeyframe: true, cartoonStyle: ((form.get("cartoonStyle") as string) || "").trim() || "dreamanime", contentType: "cartoon" }
          : {}),
        prePaid: true, chargedTokens: TOKEN_COST.combine, chargedFromExtra: cFromExtra,
      });
      backed(TOKEN_COST.combine, cFromExtra);
      return json({ ok: true, combineJobId });
    }
    if (intent === "frameEdit") {
      // Edit the CURRENT combine frame ITSELF — a true image edit of a reused
      // gallery shot or an upload (which have no presenter/product to re-compose,
      // so the normal Edit/Retry can't apply). Routes to the tested editImage
      // "describe" path and returns a combineJobId so the combine step's own
      // polling picks up the edited result. Priced the same as a combine edit.
      assertCapability(shop.activePlan, "image");
      const srcFrame = ((form.get("sourceFrameUrl") as string) || "").trim();
      if (!srcFrame || !/^https?:\/\//i.test(srcFrame)) return json({ error: tr(lang, "No shot to edit — pick or upload one first.") });
      const change = (direction || "").trim().slice(0, 200);
      if (!change) return json({ error: tr(lang, "Describe the change you want to this photo.") });
      const feModel = normalizeCreateModelKey("");
      const feFromExtra = (await spendTokens(shop.id, TOKEN_COST.combine)).fromExtra;
      charged(TOKEN_COST.combine, feFromExtra);
      const frameEditJobId = await enqueueJob(shop.id, "GENERATE_IMAGE_AD", {
        section: genSection,
        editOp: "describe", sourceImageUrl: srcFrame, editPrompt: change, editModel: feModel,
        // carried only for the Archive "cooking" tile thumbnail/label while it runs
        productImageUrl: srcFrame, productTitle: "Shot edit",
        prePaid: true, chargedTokens: TOKEN_COST.combine, chargedFromExtra: feFromExtra,
      });
      backed(TOKEN_COST.combine, feFromExtra);
      return json({ ok: true, combineJobId: frameEditJobId });
    }
    if (intent === "edit") {
      // Casual "edit a photo" — transform the user's own uploaded/linked photo.
      // Same 5-token image cost + spend/refund discipline; the worker routes it
      // to editImage() (no brand profile or ad ladder). A source photo is
      // REQUIRED — img2img can't invent one from a title.
      assertCapability(shop.activePlan, "image");
      // Primary flow is DeepAI-style: upload a photo + "describe your changes".
      // When no quick-action chip is picked we default to the free-text
      // "describe" edit, so the description alone is enough.
      const pickedOp = ((form.get("editOp") as string) || "").trim();
      const editOp = pickedOp || ((direction || "").trim() ? "describe" : "");
      if (!["restyle", "cartoonize", "bgremove", "bgswap", "colorize", "upscale", "replace", "describe"].includes(editOp)) {
        return json({ error: tr(lang, "Upload a photo and describe the changes you want — or tap a quick action.") });
      }
      if ((editOp === "describe" || editOp === "replace") && !(direction || "").trim()) {
        return json({ error: tr(lang, "Describe the changes you want — e.g. 'make the shirt a purple hoodie'.") });
      }
      if (!productImageUrl) {
        return json({ error: tr(lang, "Add a photo to edit — upload one or paste an image URL.") });
      }
      // Optional SECOND photo → a two-photo combine / cross-edit. Same upload
      // discipline as the primary (8 MB cap, public /uploads URL).
      let sourceImageUrl2: string | undefined;
      const photo2 = form.get("productPhoto2");
      if (photo2 && typeof photo2 !== "string" && photo2.size > 0) {
        if (!/^image\//.test(photo2.type)) return json({ error: tr(lang, "That second file isn't an image — use a JPG, PNG or WebP.") });
        if (photo2.size > 8 * 1024 * 1024) return json({ error: tr(lang, "Second image too large — keep it under 8 MB.") });
        const [fsMod, pathMod, crypto] = await Promise.all([import("node:fs"), import("node:path"), import("node:crypto")]);
        const ext2 = photo2.type === "image/png" ? "png" : photo2.type === "image/webp" ? "webp" : "jpg";
        const dir2 = pathMod.join(process.cwd(), "data", "renders", "uploads");
        fsMod.mkdirSync(dir2, { recursive: true });
        const name2 = uploadFileName(shop.id, crypto.randomBytes(8).toString("hex"), ext2 as UploadExt);
        fsMod.writeFileSync(pathMod.join(dir2, name2), Buffer.from(await photo2.arrayBuffer()));
        const base2 = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
        if (!base2) return json({ error: tr(lang, "Photo uploads aren't configured on this server yet.") });
        sourceImageUrl2 = `${base2}/uploads/${name2}`;
      }
      if (sourceImageUrl2 && !(direction || "").trim()) {
        return json({ error: tr(lang, "Describe how to combine the two photos — e.g. 'put the person from the second photo into the first'.") });
      }
      // A combine is always a described op, even if a quick-action chip was set.
      const effectiveEditOp = sourceImageUrl2 && editOp !== "replace" ? "describe" : editOp;
      // The user picks the edit engine (Pro = nano-banana, Ultra = nano-banana-
      // pro). A two-photo combine FORCES Ultra (the multi-image engine) — which
      // also lands the charge at the 16-token price that clears the Creator
      // margin floor. Charge base image + the model surcharge, validated here.
      const editModel = sourceImageUrl2 ? normalizeCreateModelKey("ultra") : normalizeCreateModelKey((form.get("createModel") as string) || "");
      const editEach = TOKEN_COST.image + createModelSurcharge(editModel);
      const editFromExtra = (await spendTokens(shop.id, editEach)).fromExtra;
      charged(editEach, editFromExtra);
      await enqueueJob(shop.id, "GENERATE_IMAGE_AD", {
        section: "creator",
        editOp: effectiveEditOp, sourceImageUrl: productImageUrl, sourceImageUrl2, editPrompt: direction, editModel,
        // Carried only so the Archive "cooking" tile has a thumbnail + label
        // while the edit runs (the worker's edit path ignores them).
        productImageUrl, productTitle: productTitle || (sourceImageUrl2 ? "Photo combine" : "Photo edit"),
        prePaid: true, chargedTokens: editEach, chargedFromExtra: editFromExtra,
      });
      backed(editEach, editFromExtra);
      return json({ ok: true, queued: "image", count: 1 });
    }
    if (intent === "quickedit") {
      // One-tap post-generation edit of a finished Creator image (Enhance /
      // Zoom out / Zoom in / Remove bg). Reuses the edit pipeline on the
      // result's own URL, but a small "slight" charge — another value moment on
      // an image already made (DeepAI's post-gen upsell).
      assertCapability(shop.activePlan, "image");
      const quickOp = ((form.get("editOp") as string) || "").trim();
      if (!["bgremove", "upscale", "replace"].includes(quickOp)) {
        return json({ error: tr(lang, "That quick action isn't available.") });
      }
      if (quickOp === "replace" && !(direction || "").trim()) {
        return json({ error: tr(lang, "Couldn't apply that edit.") });
      }
      if (!productImageUrl) {
        return json({ error: tr(lang, "Make an image first, then tap a quick edit.") });
      }
      const quickFromExtra = (await spendTokens(shop.id, TOKEN_COST.quickEdit)).fromExtra;
      charged(TOKEN_COST.quickEdit, quickFromExtra);
      await enqueueJob(shop.id, "GENERATE_IMAGE_AD", {
        section: "creator",
        editOp: quickOp, sourceImageUrl: productImageUrl, editPrompt: direction,
        productImageUrl, productTitle: productTitle || "Quick edit",
        prePaid: true, chargedTokens: TOKEN_COST.quickEdit, chargedFromExtra: quickFromExtra,
      });
      backed(TOKEN_COST.quickEdit, quickFromExtra);
      return json({ ok: true, queued: "image", count: 1 });
    }
    if (intent === "create") {
      // Creator "Make an image" — text-to-image in an art style. No product.
      assertCapability(shop.activePlan, "image");
      const createPrompt = trimToWord((form.get("createPrompt") as string) || (direction || ""), 500);
      if (!createPrompt) return json({ error: tr(lang, "Describe what you want to make.") });
      const createStyle = ((form.get("createStyle") as string) || "").trim() || undefined;
      // Model + output frame are re-validated here (and again in createImage)
      // against the create-models allow-list — a crafted value can't reach
      // Replicate OR dodge the surcharge. The premium "Genius" model carries a
      // token surcharge (margin protector, like the video engines); re-derive it
      // server-side from the normalized key, and charge base + surcharge.
      const createModel = normalizeCreateModelKey((form.get("createModel") as string) || "");
      const createAspect = ((form.get("createAspect") as string) || "").trim() || undefined;
      // Charge the price the user picked (base + any premium surcharge),
      // regardless of which engine actually runs it. A "mature" prompt routes to
      // flux-dev under the hood, but the quote and the charge stay consistent —
      // and the permissive engine is cheap, so the margin only improves.
      const createEach = TOKEN_COST.createImage + createModelSurcharge(createModel);
      const createFromExtra = (await spendTokens(shop.id, createEach)).fromExtra;
      charged(createEach, createFromExtra);
      await enqueueJob(shop.id, "GENERATE_IMAGE_AD", {
        createImage: true, createPrompt, createStyle, createModel, createAspect, createPermissive: genPermissive, section: "creator",
        productTitle: createPrompt.slice(0, 60),
        prePaid: true, chargedTokens: createEach, chargedFromExtra: createFromExtra,
      });
      backed(createEach, createFromExtra);
      return json({ ok: true, queued: "image", count: 1 });
    }
    if (intent === "music") {
      // Creator "Make music" — text-to-song. No product, no photo.
      assertCapability(shop.activePlan, "music");
      const musicBase = trimToWord((form.get("musicPrompt") as string) || (direction || ""), 500);
      if (!musicBase) return json({ error: tr(lang, "Describe the music you want.") });
      // Fold the picked genre/mood preset into the prompt (DeepAI-style style
      // selection on top of the free-text prompt). Unknown keys are ignored.
      const musicStyleKey = ((form.get("musicStyle") as string) || "").trim();
      const musicStyle = MUSIC_STYLE_BY_KEY[musicStyleKey];
      const musicPrompt = musicStyle ? `${musicBase}. Style: ${musicStyle.prompt}` : musicBase;
      const musicFromExtra = (await spendTokens(shop.id, TOKEN_COST.music)).fromExtra;
      charged(TOKEN_COST.music, musicFromExtra);
      await enqueueJob(shop.id, "GENERATE_SONG", {
        section: "creator", musicPrompt,
        productTitle: musicBase.slice(0, 60),
        prePaid: true, chargedTokens: TOKEN_COST.music, chargedFromExtra: musicFromExtra,
      });
      backed(TOKEN_COST.music, musicFromExtra);
      return json({ ok: true, queued: "music", count: 1 });
    }
    if (intent === "faceless") {
      // Creator "Faceless video" — topic → scripted 9:16 social video. No product,
      // no photo. The cheap, token-metered path, so it's gated at "creatorvideo"
      // (the $6.99 Creator plan carries it; the expensive marketing pipeline does
      // not). COGS ~$0.08 vs 30 tokens = margin-safe even on the Creator floor.
      assertCapability(shop.activePlan, "creatorvideo");
      const topic = trimToWord((form.get("facelessTopic") as string) || (direction || ""), 300);
      if (!topic) return json({ error: tr(lang, "Give your video a topic.") });
      const facelessFormat = ((form.get("facelessFormat") as string) || "facts").trim();
      const voiceKey = ((form.get("voiceKey") as string) || "f-warm").trim();
      // Ultra = nano-banana-pro b-roll (vs nano-banana for Pro) — a per-video
      // surcharge on top of the base faceless cost.
      const facelessQuality = normalizeFacelessQuality((form.get("facelessQuality") as string) || "");
      // Faceless always rides the Creator floor (creatorvideo cap), so the Ultra
      // b-roll surcharge is scaled to it — otherwise nano-banana-pro runs underwater.
      const facelessCost = TOKEN_COST.faceless + facelessQualitySurcharge(facelessQuality) * CREATOR_SURCHARGE_MULT;
      const flFromExtra = (await spendTokens(shop.id, facelessCost)).fromExtra;
      charged(facelessCost, flFromExtra);
      await enqueueJob(shop.id, "GENERATE_VIDEO_AD", {
        section: "creator", contentType: "faceless", topic, facelessFormat, voiceKey, facelessQuality,
        productTitle: topic.slice(0, 60),
        prePaid: true, chargedTokens: facelessCost, chargedFromExtra: flFromExtra,
      });
      backed(facelessCost, flFromExtra);
      return json({ ok: true, queued: "faceless", count: 1 });
    }
    if (intent === "blog") {
      assertCapability(shop.activePlan, "blog");
      const blogFromExtra = (await spendTokens(shop.id, TOKEN_COST.blog)).fromExtra;
      charged(TOKEN_COST.blog, blogFromExtra);
      await enqueueJob(shop.id, "GENERATE_BLOG_POST", {
        section: genSection,
        productTitle, productUrl, productDescription: direction, serviceMode: service,
        prePaid: true, chargedTokens: TOKEN_COST.blog, chargedFromExtra: blogFromExtra,
      });
      backed(TOKEN_COST.blog, blogFromExtra);
      return json({ ok: true, queued: "article" });
    }
  } catch (e) {
    // Give back anything charged that no job will ever run. spendTokens itself
    // throwing (insufficient balance) leaves the debt at 0, so this cannot
    // refund a spend that never happened, and a partially-queued burst refunds
    // only the pieces that did not make it.
    if (unbackedTokens > 0) {
      try {
        await refundTokens(shop.id, unbackedTokens, unbackedFromExtra);
        console.warn(`[studio] refunded ${unbackedTokens} token(s) for ${intent} pieces that were charged but never queued`);
      } catch (re) {
        console.error(
          `[studio] REFUND FAILED — shop ${shop.id} is owed ${unbackedTokens} token(s) for an unqueued ${intent}: `,
          re instanceof Error ? re.message.slice(0, 200) : re,
        );
      }
    }
    return json({ error: e instanceof Error ? e.message : tr(lang, "Couldn't queue that.") });
  }
  return json({});
};

type Tab = "video" | "image" | "music" | "faceless" | "blog" | "import";
// "review" (Creator Demo) is retired from the picker but stays a valid content
// type: its CT_PRESETS entry + the note/presenter-field handling keep any
// already-made Creator Demo asset remixing correctly.
type CType = (typeof CONTENT_TYPES)[number]["key"] | "review" | "asmr";
type CastItem = { id: string; name: string; img: string; designed: boolean };

/* Module-level on purpose: defined inside the page component, React would
 * see a NEW component type on every render and remount the strip — which
 * reset the horizontal scroll to the first presenter on every click. Any
 * new inputs come in as explicit props. */
/** Modal/lightbox accessibility, shared by every overlay in this route (forge,
 *  Manage, the done/queued state, the two tap-to-enlarge lightboxes). Returns a
 *  ref for the dialog container and wires up: Escape-to-close, initial focus
 *  moved INTO the dialog on open, focus RETURNED to the opener on close, and a
 *  Tab focus-trap that keeps keyboard focus inside while it's open. `active`
 *  gates it so a closed overlay costs nothing. */
function useModalA11y<T extends HTMLElement>(active: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    const focusable = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null || el === document.activeElement)
        : [];
    // Initial focus lands inside — the first control, else the container itself.
    const first = focusable()[0];
    if (first) first.focus();
    else if (node) { node.setAttribute("tabindex", "-1"); node.focus(); }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== "Tab" || !node) return;
      const items = focusable();
      if (items.length === 0) { e.preventDefault(); return; }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === firstEl || !node.contains(activeEl))) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && activeEl === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Return focus to whatever opened the overlay (if it's still around).
      if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus();
    };
    // Only re-run on open/close — onClose is read through a ref so a new
    // identity never re-triggers focus handling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return ref;
}

/** Live character counter for the big describe/direction textareas. maxLength
 *  silently truncates — this makes the limit VISIBLE so a merchant knows their
 *  prompt is being cut, and warns as they near it. */
function CharCount({ value, max }: { value: string; max: number }) {
  const used = value.length;
  const near = used >= max * 0.9;
  return (
    <span className={`ws-charcount${near ? " near" : ""}`} aria-live="polite">{used}/{max}</span>
  );
}

/** The forge takes a minute or two of silence, and a line of text reading
 *  "forging…" makes that look like nothing is happening. So show the shape of
 *  what's coming: four placeholder character cards — one per outfit — shimmering
 *  in the same tile geometry the presenter row uses, with a real elapsed clock.
 *  When the job lands, these swap for the actual faces. */
function ForgingPresenter({ name, status, startedAt }: { name: string; status: string; startedAt: string }) {
  const t = useT();
  const revalidator = useRevalidator();
  const [elapsed, setElapsed] = useState(0);
  const failed = status === "failed";

  // Count from the job's REAL start, so a reload mid-forge shows "1m 40s".
  useEffect(() => {
    if (failed) return;
    const base = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - base) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, failed]);

  // Poll until the forge lands. 6s matches the catalogue importer.
  useEffect(() => {
    if (failed) return;
    const id = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 6000);
    return () => clearInterval(id);
  }, [revalidator, failed]);

  if (failed) {
    return (
      <div className="ws-forge ws-forge-bad" role="status">
        <b>{t("{name} couldn’t be forged.", { name })}</b>
        <span>{t("The reference photo didn’t give us enough to work with — try a clearer, front-facing image.")}</span>
      </div>
    );
  }
  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;
  return (
    <div className="ws-forge" role="status" aria-live="polite">
      <div className="ws-forge-hd">
        <span className="ws-forge-spin" aria-hidden="true" />
        <div>
          <b>{t("Forging {name}…", { name })}</b>
          <span>{t("Four outfits, {elapsed} elapsed — usually a minute or two. You can keep working.", { elapsed: mm > 0 ? `${mm}m ${ss}s` : `${ss}s` })}</span>
        </div>
      </div>
      <div className="ws-forge-row">
        {["Casual", "Smart", "Active", "Street"].map((o, i) => (
          <div className="ws-forge-card" key={o} style={{ animationDelay: `${i * 0.18}s` }}>
            <span className="ws-forge-img" aria-hidden="true" />
            <span className="ws-forge-nm">{t(o)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Pick a voice for a custom presenter — chips under the gender toggle, each with
 * a ▶ that plays the real pre-rendered sample (free, instant) so a merchant
 * HEARS the voice before spending. One <audio>, one playing at a time. Shared by
 * the forge modal and the Manage panel. The catalog is deliberately small and
 * all-neutral-English, so nothing here surprises them with an accent. */
function VoicePicker({ gender, value, onChange }: { gender: "f" | "m"; value: string; onChange: (id: string) => void }) {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const voices = AVATAR_VOICES.filter((v) => v.gender === gender);
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const done = () => setPlaying(null);
    a.addEventListener("ended", done);
    return () => a.removeEventListener("ended", done);
  }, []);
  const play = (id: string) => {
    const a = audioRef.current;
    if (!a) return;
    if (playing === id) { a.pause(); setPlaying(null); return; }
    a.src = `/voice-samples/${id}.mp3`;
    a.currentTime = 0;
    a.play().then(() => setPlaying(id)).catch(() => setPlaying(null));
  };
  return (
    <div className="ws-vp">
      {voices.map((v) => {
        const sel = value === v.id;
        const on = playing === v.id;
        return (
          <div key={v.id} className={`ws-vp-chip${sel ? " sel" : ""}`}>
            <button type="button" className="ws-vp-pick" onClick={() => onChange(v.id)} aria-pressed={sel}>
              <b>{t(v.label)}</b>
              <em className="ws-vp-blurb">{t(v.blurb)}</em>
              {sel ? <i className="ws-vp-tick" aria-hidden="true">✓</i> : null}
            </button>
            <button type="button" className={`ws-vp-play${on ? " on" : ""}`} onClick={() => play(v.id)}
              aria-label={on ? t("Stop preview") : t("Preview the {label} voice", { label: t(v.label) })}>
              {on ? "⏸" : "▶"}
            </button>
          </div>
        );
      })}
      <audio ref={audioRef} preload="none" />
    </div>
  );
}

type MyPresenter = { id: string; name: string; img: string; voiceId: string; gender: string };

/* Manage YOUR custom presenters — the home the quota error always promised
 * ("delete one to forge another") but never had, plus the fix for a presenter
 * forged before voices were pickable: change its voice here, no re-forge. Each
 * row can expand a VoicePicker (save on confirm) or arm-to-confirm a delete. */
function ManagePresenters({ presenters, onClose }: { presenters: MyPresenter[]; onClose: () => void }) {
  const t = useT();
  const fetcher = useFetcher<{ avatarDeleted?: string; avatarVoiceSet?: string; avatarError?: string }>();
  const [editing, setEditing] = useState<string | null>(null);
  const [pendingVoice, setPendingVoice] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";
  const dialogRef = useModalA11y<HTMLDivElement>(true, onClose);
  // A successful save/delete revalidates the loader (presenters updates); fold
  // the open editor and disarm so the panel settles to the new truth.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && (fetcher.data.avatarVoiceSet || fetcher.data.avatarDeleted)) {
      setEditing(null); setArmed(null);
    }
  }, [fetcher.state, fetcher.data]);
  return (
    <div className="ws-scrim" onClick={onClose}>
      <div ref={dialogRef} className="ws-managem" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button type="button" className="ws-forgem-x" onClick={onClose} aria-label={t("Close")}><Ico n="x" size={16} /></button>
        <div className="ws-forgem-h">
          <span className="ws-forgem-crest"><Ico n="sliders" size={20} /></span>
          <div>
            <b>{t("Your presenters")}</b>
            <span>{t("Change a voice, or delete one to free a slot. You have {n} of 12.", { n: presenters.length })}</span>
          </div>
        </div>
        {fetcher.data?.avatarError ? <p className="ws-forgem-err">{String(fetcher.data.avatarError)}</p> : null}
        <div className="ws-mp-list">
          {presenters.length === 0 && <p className="ws-offernote">{t("No custom presenters yet — create one from the presenter picker.")}</p>}
          {presenters.map((p) => {
            const open = editing === p.id;
            const gender = p.gender === "f" ? "f" : "m";
            return (
              <div key={p.id} className="ws-mp-row">
                <div className="ws-mp-head">
                  <span className="ws-mp-img" style={{ backgroundImage: p.img ? `url(${p.img})` : undefined }} aria-hidden="true" />
                  <b className="ws-mp-nm">{p.name}</b>
                  <button type="button" className={`ws-mp-act${open ? " on" : ""}`} disabled={busy}
                    onClick={() => { if (open) { setEditing(null); } else { setEditing(p.id); setPendingVoice(p.voiceId || DEFAULT_AVATAR_VOICE[gender]); setArmed(null); } }}>
                    <Ico n="mic" size={14} /> {t("Voice")}
                  </button>
                  {armed === p.id ? (
                    <button type="button" className="ws-mp-act danger" disabled={busy}
                      onClick={() => { const fd = new FormData(); fd.set("intent", "deleteAvatar"); fd.set("avatarId", p.id); fetcher.submit(fd, { method: "post" }); }}>
                      {t("Delete")}
                    </button>
                  ) : (
                    <button type="button" className="ws-mp-act danger" disabled={busy}
                      onClick={() => { setArmed(p.id); setEditing(null); }} aria-label={t("Delete {name}", { name: p.name })}>
                      <Ico n="trash" size={14} />
                    </button>
                  )}
                </div>
                {armed === p.id && (
                  <p className="ws-mp-warn">
                    {t("Delete {name}? This can't be undone.", { name: p.name })}
                    <button type="button" className="ws-mp-undo" onClick={() => setArmed(null)}>{t("Keep")}</button>
                  </p>
                )}
                {open && (
                  <div className="ws-mp-voice">
                    <VoicePicker gender={gender} value={pendingVoice} onChange={setPendingVoice} />
                    <button type="button" className="wb-btn ws-mp-save" disabled={busy || pendingVoice === (p.voiceId || "")}
                      onClick={() => { const fd = new FormData(); fd.set("intent", "setAvatarVoice"); fd.set("avatarId", p.id); fd.set("avatarVoice", pendingVoice); fetcher.submit(fd, { method: "post" }); }}>
                      {busy ? t("Saving…") : t("Save voice")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Presenters({ cast, avatarId, setAvatarId, optional, brandFaceId, onCreateOwn, onManage }: {
  cast: CastItem[];
  avatarId: string | null;
  setAvatarId: (id: string | null) => void;
  optional?: boolean;
  brandFaceId: string | null;
  onCreateOwn?: () => void;
  onManage?: () => void;
}) {
  const t = useT();
  const hasCustom = cast.some((c) => c.id.startsWith("cav"));
  // Just the selection row now — small circle heads. Picking one plays that
  // presenter's intro (with sound) in the hero tile above; the preview no
  // longer lives on each chip, which keeps this compact.

  // Brand Face leads the cast.
  const ordered = brandFaceId ? [...cast.filter((c) => c.id === brandFaceId), ...cast.filter((c) => c.id !== brandFaceId)] : cast;
  // Type a name instead of scrubbing a hundred faces sideways. Filtering never
  // drops the CAST presenter — losing sight of your own selection mid-search is
  // worse than one extra tile.
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? ordered.filter((c) => c.name.toLowerCase().includes(needle) || c.id === avatarId)
    : ordered;

  return (
    <>
      <div className="ws-lbl">{t("Presenter")}{optional ? <span className="ws-opt">{t("optional")}</span> : null}</div>
      <div className="ws-castsearch">
        <input className="wb-in" type="search" value={q} placeholder={t("Search {n} presenters by name…", { n: cast.length })}
          onChange={(e) => setQ(e.target.value)} aria-label={t("Search presenters by name")} />
        {needle && <button type="button" className="ws-cs-clr" onClick={() => setQ("")} aria-label={t("Clear search")}>✕</button>}
      </div>
      {needle && shown.length === 0 && <p className="ws-offernote">{t("No presenter called “{q}”.", { q: q.trim() })}</p>}
      <div className="ws-cast">
        {onCreateOwn && !needle && (
          <button type="button" className="ws-face ws-face-create" onClick={onCreateOwn} aria-label={t("Create your own presenter")}>
            <span className="ws-face-img create"><Ico n="upload" size={23} /></span>
            <span>{t("Create your own")}</span>
          </button>
        )}
        {onManage && hasCustom && !needle && (
          <button type="button" className="ws-face ws-face-manage" onClick={onManage} aria-label={t("Manage your presenters")}>
            <span className="ws-face-img manage"><Ico n="sliders" size={21} /></span>
            <span>{t("Manage")}</span>
          </button>
        )}
        {optional && !needle && (
          <button type="button" className={`ws-face${avatarId === null ? " sel" : ""}`} onClick={() => setAvatarId(null)}>
            <span className="ws-face-img none">✕</span><span>{t("None")}</span>
          </button>
        )}
        {shown.map((c) => {
          const bf = c.id === brandFaceId;
          const sel = avatarId === c.id;
          return (
            <div key={c.id} className={`ws-face${sel ? " sel" : ""}${bf ? " bf" : ""}`}>
              <button type="button" className="ws-face-pick" onClick={() => setAvatarId(c.id)} aria-label={t("Cast {name}", { name: c.name })}>
                <span className="ws-face-img" style={{ backgroundImage: `url(${c.img})` }}>{sel && <b>✓</b>}</span>
              </button>
              <span>{bf ? <><Ico n="star" size={12} /> {t("Brand face")}</> : c.name}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* "Pulling your products in now" as flat text reads as a page that died. This
 * is the same beat the Archive's cooking tiles hit: the gold rosette turning on
 * a dark panel, a live elapsed clock, and the page quietly revalidating so the
 * grid appears the moment the import lands — nobody has to guess or refresh. */
function CatalogSync({ startedAt }: { startedAt: string | null }) {
  const t = useT();
  const revalidator = useRevalidator();
  const [elapsed, setElapsed] = useState(0);

  // Tick the clock from the job's REAL start time, so a reload mid-import
  // shows "2m 10s", not a counter that just began.
  useEffect(() => {
    const base = startedAt ? new Date(startedAt).getTime() : Date.now();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - base) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // Poll for completion. 6s is frequent enough to feel instant and cheap
  // enough that a long sitemap crawl doesn't hammer our own server.
  useEffect(() => {
    const id = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 6000);
    return () => clearInterval(id);
  }, [revalidator]);

  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;
  return (
    <div className="ws-catload" role="status" aria-live="polite">
      <span className="ws-catload-spin" aria-hidden="true" />
      <div className="ws-catload-txt">
        <b>{t("Pulling your products in…")}</b>
        <span>
          {t("{elapsed} — reading your storefront.", { elapsed: mm > 0 ? `${mm}m ${ss}s` : `${ss}s` })}
          {elapsed > 90 ? " " + t("Big catalogues take a few minutes.") : ""}
        </span>
        <i>{t("This page updates itself the moment it lands.")}</i>
      </div>
    </div>
  );
}

/* One long card reads as one long chore. Numbered heads cut the same fields
 * into three obvious moves — look, product, direction — so the form is scanned
 * rather than waded through. Purely presentational: no state, no wrapping, so
 * every field stays exactly where the multipart submit expects it. */
function StepHead({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="ws-stephead">
      <span className="ws-stepn" aria-hidden="true">{n}</span>
      <b>{title}</b>
      {hint ? <span className="ws-stephint">{hint}</span> : null}
    </div>
  );
}

/* Tab glyphs, drawn rather than typed.
 *
 * Emoji were doing two things wrong here: they render as a different typeface
 * on every platform (Apple's clapperboard is nothing like Android's), and they
 * carry their own colour — so on the selected green tab the picture stayed a
 * beige-and-blue sticker while the label went white. These inherit
 * currentColor, so they turn white with the label and green-grey without. */
function TabIcon({ kind }: { kind: Tab }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg className="ws-tabi" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
      {kind === "video" && (
        <>
          <rect x="2.2" y="4.4" width="15.6" height="11.2" rx="2.4" {...p} />
          <path d="M8.4 8.2 12.6 10l-4.2 1.8Z" {...p} fill="currentColor" />
          <path d="M2.2 7.6h15.6" {...p} />
        </>
      )}
      {kind === "import" && (
        <>
          <path d="M3 7.4 4.6 3.6h10.8L17 7.4Z" {...p} />
          <path d="M4.2 7.4v8.2a1.2 1.2 0 0 0 1.2 1.2h9.2a1.2 1.2 0 0 0 1.2-1.2V7.4" {...p} />
          <path d="M10 9.4v4.2m0 0 1.7-1.7M10 13.6l-1.7-1.7" {...p} />
        </>
      )}
      {kind === "image" && (
        <>
          <rect x="2.4" y="3.8" width="15.2" height="12.4" rx="2.4" {...p} />
          <circle cx="7.3" cy="8.1" r="1.35" {...p} />
          <path d="m3.6 14.4 3.9-3.6a1.5 1.5 0 0 1 2 0l2.1 1.9 1.5-1.3a1.5 1.5 0 0 1 2 0l3.3 3" {...p} />
        </>
      )}
      {kind === "music" && (
        <>
          <path d="M7.2 14.2V5.2l8-1.6v8.4" {...p} />
          <circle cx="5.3" cy="14.3" r="1.9" {...p} />
          <circle cx="13.3" cy="12.3" r="1.9" {...p} />
        </>
      )}
      {kind === "faceless" && (
        <>
          <rect x="3" y="4.5" width="14" height="11" rx="2" {...p} />
          <path d="M17 8.4 20.5 6v8l-3.5-2.4" {...p} />
          <path d="M6.5 8.5h5M6.5 11.5h3" {...p} />
        </>
      )}
      {kind === "blog" && (
        <>
          <path d="M4 3.4h8.4L16.4 7v9.6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1Z" {...p} />
          <path d="M12.2 3.6V7h3.9" {...p} />
          <path d="M6.1 10.3h6.4M6.1 13.2h4.3" {...p} />
        </>
      )}
    </svg>
  );
}

export default function WebStudio() {
  const t = useT();
  const d = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  // Creation mode from the shell (web.tsx). "casual" reframes the Studio for
  // just-for-fun making + photo edits and hides the merchant-only surfaces; it
  // never changes what the backend charges. Default marketing if, somehow,
  // there's no provider (keeps the live merchant flow safe).
  const { mode, setMode } = useOutletContext<{ mode: "marketing" | "casual"; setMode: (m: "marketing" | "casual") => void }>() || { mode: "marketing" as const, setMode: () => {} };
  const can = (c: string) => d.caps.includes(c);
  // "Social media" Studio mode is a marketing-plan feature. autopost is the
  // capability that starts at Starter ($19) and is exactly what Creator ($6.99)
  // and free/trial-without-plan users lack — so it's the clean gate.
  const socialUnlocked = can("autopost");
  // A plan that can't do social is ALWAYS in Create — derive casual from the gate
  // (not just the mode) so there's never even a pre-hydration flash of the locked
  // marketing Studio. caps come from the loader, so this is correct at SSR too.
  // Unlocked users switch freely via the toggle.
  const casual = !socialUnlocked || mode === "casual";
  const nav = useNavigation();
  const submit = useSubmit();
  const busy = nav.state !== "idle";

  // Deep-link support: arrive with ?tab= and ?product= pre-filled.
  const [searchParams] = useSearchParams();
  // ?do= lets the Creator home deep-link straight into a flow: edit/image →
  // Image tab, presenter → Image+presenter, video → Video tab. ?tab= still works.
  const doParam = searchParams.get("do");
  const initTab = doParam === "video" ? "video"
    : doParam === "music" ? "music"
    : doParam === "faceless" ? "faceless"
    : (doParam === "edit" || doParam === "image" || doParam === "presenter" || doParam === "create") ? "image"
    : (["video", "image", "music", "faceless", "blog", "import"] as const).find((t) => t === searchParams.get("tab"));
  // Creator is now the single create surface (Home merged in): it opens
  // prompt-first on "Make an image" (describe box) instead of the video tiles.
  const [tab, setTab] = useState<Tab>(initTab || (casual ? "image" : "video"));
  const [productTitle, setProductTitle] = useState(searchParams.get("product") || "");
  // ?src=<renders url> imports an existing creation (from the Gallery) straight
  // into the edit flow — the cross-section "edit my own content" bridge. It
  // seeds the edit source URL; paired with ?do=edit it lands in the edit flow
  // with the image already on the Stage (see editPreview below + onFormSubmit).
  const [imageUrl, setImageUrl] = useState(searchParams.get("src") || "");
  const [hasFile, setHasFile] = useState(false);
  const [contentType, setContentType] = useState<CType | null>(null);
  const [cartoonStyle, setCartoonStyle] = useState<string | null>(null);
  // Talking Head: the WHERE (setting) + seated/standing, which build its direction.
  const [thSetting, setThSetting] = useState<string>("home");
  const [thPose, setThPose] = useState<"standing" | "seated">("standing");
  const [avatarId, setAvatarId] = useState<string | null>(d.brandFaceId ?? d.cast[0]?.id ?? null);
  const [imageMode, setImageMode] = useState<"product" | "presenter" | "create" | null>(
    doParam === "edit" || doParam === "image" ? "product" : doParam === "presenter" ? "presenter" : doParam === "create" ? "create" : (casual ? "create" : null),
  );
  // A photo dropped/uploaded onto the Stage waits here until the edit flow has
  // mounted its file input, then loads in (see the effect below). DeepAI-style:
  // the canvas is a drop target, not just an output.
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const stageUploadRef = useRef<HTMLInputElement>(null);
  // `mode` loads from localStorage after mount, so `casual` is false during the
  // tab initializer. Once casual is confirmed on a fresh landing (no deep-link),
  // open prompt-first on "Make an image" — the Studio is the Creator home now.
  const didInitCasualRef = useRef(false);
  useEffect(() => {
    if (casual && !initTab && !didInitCasualRef.current) {
      didInitCasualRef.current = true;
      setTab("image");
      setImageMode("create");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casual]);
  // Casual image never shows the Make/Edit picker — it leads with the describe
  // box (create); dropping a photo on the Stage switches to edit. So whenever
  // casual lands on the image tab with no mode (tab click, back button, pre-
  // hydration), default to create.
  useEffect(() => { if (casual && tab === "image" && imageMode === null) setImageMode("create"); }, [casual, tab, imageMode]);
  // Casual video likewise skips the Showcase/Cartoon picker — it leads with the
  // describe box; default to the cinematic "highlight" path (describe -> make, or
  // upload a video to edit it). Uploading a video switches to the edit flow.
  useEffect(() => { if (casual && tab === "video" && contentType === null) setContentType("highlight"); }, [casual, tab, contentType]);
  // Cartoon defaults to a PRESENTER (Brand Face) so it runs the "presenter holds
  // your product" path, not the product-free scene + bolted-on endcard. A tester
  // left it on None and got a generic clip with the product only at the very end.
  // You can still pick None after (this won't re-fire and override it) — entering
  // cartoon just STARTS with a presenter so the product lands in-hand by default.
  useEffect(() => { if (tab === "video" && contentType === "cartoon" && avatarId === null) { const def = d.brandFaceId ?? d.cast[0]?.id ?? null; if (def) setAvatarId(def); } }, [tab, contentType]); // eslint-disable-line react-hooks/exhaustive-deps
  // Cartoon no longer auto-picks a style — the style card starts UNSELECTED (a
  // required field with a needs-selection glow), chosen explicitly in the hub.
  // (cfgReady no longer gates the hub on cartoonStyle, so the scene still opens.)
  // Photo-editor drag-and-drop: a preview of the dropped/chosen photo + the file
  // input it drives. Cleared when the preview changes so blob URLs don't leak.
  // Seeded from ?src= so an imported Gallery creation shows on the Stage the
  // moment the edit flow opens (a remote URL here; revokeObjectURL no-ops it).
  const [editPreview, setEditPreview] = useState<string | null>(doParam === "edit" ? (searchParams.get("src") || null) : null);
  // The actual picked File, held in state. iOS Safari blocks setting
  // input.files programmatically, so a photo chosen via the Stage "+" never
  // reaches the native productPhoto input — we inject THIS into the submit
  // FormData instead (see onFormSubmit), and show it on the Stage.
  const [editFile, setEditFile] = useState<File | null>(null);
  // A SECOND photo for a two-photo combine / cross-edit ("add the person from
  // photo 2 into photo 1"). Optional — when unset, edits behave exactly as
  // before. A combine forces the Ultra engine + a 16-token charge server-side.
  const [editFile2, setEditFile2] = useState<File | null>(null);
  const [editPreview2, setEditPreview2] = useState<string | null>(null);
  const stageUpload2Ref = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  // CREATOR "upload a video to edit it" — the alternative to describe->make on
  // the casual Video tab. A real <input type=file name="productVideo"> inside
  // the Form posts the File directly (no DataTransfer needed, unlike photos);
  // we mirror the selection into state for the <video> preview + to know we're
  // in edit mode. editVideoUrl is a blob preview, revoked on change so it can't
  // leak (mirrors the avatarFile effect below). Ops: trim | caption | speed.
  const [editVideoFile, setEditVideoFile] = useState<File | null>(null);
  const [editVideoUrl, setEditVideoUrl] = useState<string | null>(null);
  const [videoEditOp, setVideoEditOp] = useState<"trim" | "caption" | "speed">("trim");
  const [trimStart, setTrimStart] = useState("");
  const [trimEnd, setTrimEnd] = useState("");
  const [videoCaption, setVideoCaption] = useState("");
  const [videoSpeed, setVideoSpeed] = useState(1);
  const editVideoUploadRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editVideoFile) { setEditVideoUrl(null); return; }
    const url = URL.createObjectURL(editVideoFile);
    setEditVideoUrl(url);
    return () => { try { URL.revokeObjectURL(url); } catch { /* */ } };
  }, [editVideoFile]);
  // The plain (non-edit) product-photo file input, so the catalogue picker can
  // offer a visible "upload your own instead" shortcut — with a big store the
  // picker dominates and the upload field below it is easy to miss.
  const uploadRef = useRef<HTMLInputElement>(null);
  // Marketing product-source chooser: "From your store" (catalogue grid) vs
  // "Upload a photo" (own image). Default null so the merchant meets a clean
  // two-card choice instead of a 200-row grid dumped on them every time.
  const [prodSource, setProdSource] = useState<"store" | "upload" | null>(null);
  // A preview thumbnail of the uploaded product photo — they SEE it before
  // confirming (object URL; revoked on change so blob URLs don't leak).
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  // The picked File held in STATE. The <input type=file> is UNCONTROLLED and
  // loses its file when a remount kills it (Talking Head round-trip, source
  // switch) while hasFile/uploadPreview survive — a phantom photo. We inject
  // THIS into the submit so a photo the UI shows is always actually sent
  // (mirrors editFile for the casual editor).
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  // Tap-to-enlarge lightbox for the combine thumbnails + result.
  const [expandImg, setExpandImg] = useState<string | null>(null);
  // Compose-first "Combine" step (avatar+product video): make the presenter-
  // holding-product frame FIRST, approve it in-flow, then animate the video
  // from exactly that frame (Zeely-style). A copy lands in the gallery.
  const [combineUrl, setCombineUrl] = useState<string | null>(null);
  const [combining, setCombining] = useState(false);
  const [combineErr, setCombineErr] = useState<string | null>(null);
  const [combineJobId, setCombineJobId] = useState<string | null>(null);
  // Post-combine edit context: the change ("green shirt", "in an office")
  // currently applied, plus the in-progress Edit-box text. Each Edit/Retry
  // re-runs the compose (a fresh image charge), which is why it's affordable —
  // the merchant chose the spend.
  const [combineScene, setCombineScene] = useState("");
  // Which SETTING preset is active (drives combineScene + the chip selection).
  // The Edit box can still override the scene with free text.
  const [settingKey, setSettingKey] = useState("auto");
  // Has the user EXPLICITLY picked a style yet (Realistic or a cartoon style)?
  // Starts false so the style card reads "Pick a style" with a needs-selection
  // glow — a required field, enforced at combine + generate.
  const [styleSet, setStyleSet] = useState(false);
  const [combineEdit, setCombineEdit] = useState("");
  // Did THIS frame come from a generate (Combine/Edit/Retry) or from an upload /
  // reused archive shot? Edit/Retry re-compose, so they only make sense for a
  // generated frame — an uploaded/reused one the merchant chose on purpose stays
  // put (they just generate the video from it).
  const [combineGenerated, setCombineGenerated] = useState(false);
  // One place to wipe the combine AND its edit context (new presenter/product/tab).
  const resetCombine = () => {
    setCombineUrl(null); setCombineErr(null); setCombining(false); setCombineJobId(null);
    setCombineScene(""); setCombineEdit(""); setCombineGenerated(false);
  };
  const combineFetcher = useFetcher<{ error?: string; combineJobId?: string }>();
  const statusFetcher = useFetcher<{ combineResult?: { jobId: string; done: boolean; failed: boolean; media: string | null } | null }>();
  // Seed the combine frame from an UPLOAD instead of generating it (free).
  const frameUploadRef = useRef<HTMLInputElement>(null);
  const frameFetcher = useFetcher<{ frameUrl?: string; error?: string }>();
  // Reuse strip pages left/right with arrows (like the presenter picker) so the
  // whole archive is reachable without the strip ever growing taller.
  const reuseStripRef = useRef<HTMLDivElement>(null);
  const scrollReuse = (dir: number) => { const el = reuseStripRef.current; if (el) el.scrollBy({ left: dir * Math.max(170, el.clientWidth * 0.82), behavior: "smooth" }); };
  const frameUploading = frameFetcher.state !== "idle";
  const combineStartRef = useRef(0);
  // True while the in-flight combine job is actually a FRAME EDIT (a true image
  // edit of a reused/uploaded shot) rather than a presenter re-compose — so the
  // result stays a "your own shot" frame (combineGenerated false) and can be
  // edited again, instead of flipping to the re-compose path.
  const frameEditModeRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const takePhoto = (f: File | null | undefined) => {
    if (!f || !/^image\//.test(f.type)) return;
    try {
      const dt = new DataTransfer();
      dt.items.add(f);
      if (photoInputRef.current) photoInputRef.current.files = dt.files;
    } catch { /* some browsers block programmatic file set — the click path still works */ }
    setEditPreview((prev) => { if (prev) { try { URL.revokeObjectURL(prev); } catch { /* */ } } return URL.createObjectURL(f); });
    setEditFile(f);
    setHasFile(true);
  };
  // The SECOND photo for a combine. Held in state (iOS blocks programmatic file
  // set) and injected at submit; shown as a small slot beside the primary.
  const takePhoto2 = (f: File | null | undefined) => {
    if (!f || !/^image\//.test(f.type)) return;
    setEditPreview2((prev) => { if (prev) { try { URL.revokeObjectURL(prev); } catch { /* */ } } return URL.createObjectURL(f); });
    setEditFile2(f);
  };
  const clearPhoto2 = () => {
    setEditPreview2((p) => { if (p) { try { URL.revokeObjectURL(p); } catch { /* */ } } return null; });
    setEditFile2(null);
  };
  // Creator "Make an image" art style. The picker is collapsed by default
  // (reveal on click) so the describe box stays the whole act of creation.
  const [createStyle, setCreateStyle] = useState<string | null>(null);
  const [showStyle, setShowStyle] = useState(false);
  // Casual "Edit a photo" — collapsed quick-actions disclosure.
  const [showEditOps, setShowEditOps] = useState(false);
  // Creator "Make an image" — AI model + output frame (aspect ratio).
  const [createModel, setCreateModel] = useState<string>(DEFAULT_CREATE_MODEL);
  const [createAspect, setCreateAspect] = useState<string>(DEFAULT_CREATE_ASPECT);
  // Creator "Make music" genre/mood preset (optional, folded into the prompt).
  const [musicStyle, setMusicStyle] = useState<string | null>(null);
  // Creator "Faceless video" — format + voice.
  const [facelessFormat, setFacelessFormat] = useState("facts");
  const [voiceKey, setVoiceKey] = useState("f-warm");
  const [facelessQuality, setFacelessQuality] = useState<"pro" | "ultra">("pro");
  // How many to make in one go. Kept in one place across tabs so the choice
  // survives switching, but re-clamped below — video caps lower than image.
  const [burst, setBurst] = useState(1);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [formatKey, setFormatKey] = useState<string | null>(null);
  // Casual "edit a photo" operation (restyle | cartoonize | bgswap | bgremove).
  const [editOp, setEditOp] = useState<string | null>(null);
  // Which format category the picker is showing. Leads with "popular" so the
  // first thing a merchant sees is eight strong choices, not forty.
  const [fmtGroup, setFmtGroup] = useState<string>("popular");
  const [videoEngine, setVideoEngine] = useState("auto");
  const [commercial, setCommercial] = useState(false);
  const [breakout, setBreakout] = useState(false);
  const [upsell, setUpsell] = useState<{ name: string; tier: string; price: number } | null>(null);
  const [socialLockOpen, setSocialLockOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  // ?prompt= lets the Creator home's prompt-first box prefill the describe/
  // topic field when it deep-links into a mode (image/edit/video/music).
  const [direction, setDirection] = useState(searchParams.get("prompt") || "");
  // Advanced prompting — default: EasyMode decides. Advanced reveals the 3 W's.
  const [advanced, setAdvanced] = useState(false);
  const [saySomething, setSaySomething] = useState("");
  const [doWhat, setDoWhat] = useState("");
  const [where, setWhere] = useState("");
  // Service mode — an intangible offer (coaching, SaaS, a subscription…). No
  // product to hold, so the presenter explains and sells the outcome.
  const [service, setService] = useState(false);
  // Presenter × product → hold vs wear. Auto-detect apparel from the typed
  // name; reset the override when detection flips so detection leads.
  const apparel = isApparel(productTitle);
  const [wearOverride, setWearOverride] = useState<boolean | null>(null);
  useEffect(() => { setWearOverride(null); }, [apparel]);
  const wear = wearOverride === null ? apparel : wearOverride;
  // Casual hides Article + Import — if the mode flips (or a deep-link lands)
  // while one of those is active, fall back to a visible tab so the user never
  // stares at a tab with no button. Runs after mount, when `casual` resolves.
  useEffect(() => { if (casual && (tab === "blog" || tab === "import")) { setTab("image"); setUpsell(null); } }, [casual, tab]);
  // Marketing has no Music/Faceless tab — if you toggle to Social from one of
  // those Creator-only tabs, land on Image rather than an orphaned tab.
  useEffect(() => { if (!casual && (tab === "music" || tab === "faceless")) { setTab("image"); setUpsell(null); } }, [casual, tab]);
  // A plan that can't do social must never sit in the (fully locked) marketing
  // Studio — keep locked users in Create; the Social toggle then upsells them.
  useEffect(() => { if (!socialUnlocked && mode !== "casual") { setMode("casual"); setSocialLockOpen(false); } }, [socialUnlocked, mode]);
  // "Commercial look" is an ad treatment — clear it on entering casual so a value
  // ticked in marketing can't ride a casual submit (the control is hidden in
  // casual, but a control nobody can see must not change the order).
  useEffect(() => { if (casual) setCommercial(false); }, [casual]);
  // The photo-edit op only applies to the casual Image→product surface; clear it
  // whenever we leave so a stale op can't flag a later submit as an edit.
  useEffect(() => { if (!(casual && tab === "image" && imageMode === "product")) setEditOp(null); }, [casual, tab, imageMode]);
  useEffect(() => { if (!(casual && tab === "image" && imageMode === "create")) setCreateStyle(null); }, [casual, tab, imageMode]);
  useEffect(() => { if (!(casual && tab === "music")) setMusicStyle(null); }, [casual, tab]);
  // Import-by-URL (works for any storefront).
  const [showImport, setShowImport] = useState(false);
  // Catalogue picker: the chosen product's URL rides along so the social
  // post can deep-link shoppers straight to the buy page.
  const [pickedUrl, setPickedUrl] = useState("");
  const [catQuery, setCatQuery] = useState("");
  // Deep-link product pre-select — Helpurr's "set up an image ad" lands here with
  // ?product=<title>. A bare title isn't enough: a product ad needs the product's
  // IMAGE too, and the kind-picker hasn't opened the product step yet. So match
  // the title against the real catalogue and SELECT the whole product (title +
  // image + url), then open the Product-ad step — the ad is ready to make, not
  // just half-addressed. Runs once; no match → leaves the normal flow untouched.
  const didPreselectRef = useRef(false);
  useEffect(() => {
    if (didPreselectRef.current) return;
    const want = (searchParams.get("product") || "").trim();
    if (!want) return;
    const norm = (s: string) => s.trim().toLowerCase();
    const hit = d.catalog.find((c) => norm(c.title) === norm(want))
      || d.catalog.find((c) => norm(c.title).includes(norm(want)) || norm(want).includes(norm(c.title)));
    if (!hit) return;
    didPreselectRef.current = true;
    setProductTitle(hit.title);
    setImageUrl(hit.imageUrl || "");
    setPickedUrl(hit.url);
    setProdSource("store");
    setTab("image");
    setImageMode("product");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // WHAT IS ON SCREEN, NOT WHAT IS IN THE DATABASE.
  //
  // The label quoted catalogCount — every row the shop has — over a grid that
  // renders at most 60 tiles. A merchant with 300 products read "300 products"
  // above 60 of them and had no way to know the other 240 existed, let alone
  // that the search box was how to reach them. The count was true about the
  // database and false about the page.
  const CAT_TILES = 60;
  // Token-AND search, not one contiguous substring. A contiguous match drops a
  // real product the moment any token sits between the words you typed: searching
  // "Grumpipi Whispers to Dreamland" returned 0 rows for the title
  // "Grumpipi V2 Whispers to Dreamland" because the run is broken by "V2".
  // Match every whitespace-separated token somewhere in the title instead, so
  // word order and interspersed tokens (versions, sizes, pack counts) still hit.
  const catNeedles = catQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const catFiltered = d.catalog.filter((c) => {
    if (!catNeedles.length) return true;
    const hay = c.title.toLowerCase();
    return catNeedles.every((n) => hay.includes(n));
  });
  const catShown = catFiltered.slice(0, CAT_TILES);
  const [productSize, setProductSize] = useState("");
  const [showConnect, setShowConnect] = useState(false);
  const [storeInput, setStoreInput] = useState("");
  const [avatarName, setAvatarName] = useState("");
  const [avatarGender, setAvatarGender] = useState("m");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  // Voice is now an explicit PICK (was a scorer guess that sometimes handed a
  // merchant an accent). desc + energy let them shape the character/pace; the
  // preview is a local object-URL of the uploaded photo so they see what they're
  // forging before they spend.
  const [avatarVoice, setAvatarVoice] = useState(DEFAULT_AVATAR_VOICE.m);
  const [avatarDesc, setAvatarDesc] = useState("");
  const [avatarEnergy, setAvatarEnergy] = useState("warm");
  const [avatarPreview, setAvatarPreview] = useState("");
  useEffect(() => {
    if (!avatarFile) { setAvatarPreview(""); return; }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);
  // Manage YOUR presenters: change a voice (incl. fixing a pre-picker one) or
  // delete one to free a slot. The panel owns its own fetcher.
  const [manageOpen, setManageOpen] = useState(false);
  // "Create your own presenter" — the forge, promoted from a buried Import card
  // to a first-class modal opened straight from the presenter picker. A
  // dedicated fetcher (not the global submit) keeps the forge's own
  // submitting/queued/error state scoped, so the modal can show a spinner then
  // a confirmation instead of silently closing (the merchant hit Forge and saw
  // nothing). `forging` flips the modal from the form to the progress view;
  // reset on close so reopening is a fresh form.
  const [forgeOpen, setForgeOpen] = useState(false);
  const [forging, setForging] = useState(false);
  const forgeFetcher = useFetcher<{ avatarQueued?: string; avatarError?: string }>();
  // Escape-to-close + focus-trap + focus-return for the overlays. Each dialog
  // gets a ref; the hook no-ops while its overlay is closed. (Manage runs the
  // same hook inside its own component.)
  const closeForge = useCallback(() => { setForgeOpen(false); setForging(false); }, []);
  const forgeDialogRef = useModalA11y<HTMLDivElement>(forgeOpen, closeForge);
  const doneDialogRef = useModalA11y<HTMLDivElement>(showDone, () => setShowDone(false));
  const lightboxRef = useModalA11y<HTMLDivElement>(!!expandImg, () => setExpandImg(null));
  const [urlInput, setUrlInput] = useState("");
  // Last-used product memory — offer a one-tap refill next visit.
  const [lastProd, setLastProd] = useState<{ title: string; image: string } | null>(null);
  useEffect(() => {
    try { const raw = localStorage.getItem("wsLastProduct"); if (raw) setLastProd(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);

  const queued = actionData && "queued" in actionData ? (actionData as { queued: string }).queued : null;
  const queuedCount = (actionData as { count?: number } | null)?.count ?? 1;
  useEffect(() => {
    if (actionData && "queued" in actionData) {
      if (!casual) setShowDone(true); // casual: the Stage shows the making → result state instead of a modal
      try {
        const entry = { title: productTitle.trim(), image: imageUrl.trim() };
        if (entry.title) { localStorage.setItem("wsLastProduct", JSON.stringify(entry)); setLastProd(entry); }
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionData]);
  useEffect(() => {
    const imp = actionData && "imported" in actionData ? (actionData as { imported: { title: string; image: string | null; url: string | null } }).imported : null;
    // THE BUY LINK MOVES WITH THE PRODUCT, ON EVERY PATH.
    //
    // pickedUrl is set by the catalogue tile and cleared only by the product
    // NAME input's onChange. Two paths replace the product without firing
    // that handler — this import, and the “Use last” chip — so the previous
    // pick's URL rode along: the ad went out with a caption linking to a
    // different product than the one in the picture. Here the scraped page IS
    // the right destination, so carry it.
    // Jump to the "store" source so the imported image actually renders + rides
    // the submit (productImageUrl only exists on the store/upload branches).
    if (imp) { setProductTitle(imp.title); setImageUrl(imp.image || ""); setPickedUrl(imp.url || ""); setUrlInput(""); setShowImport(false); setProdSource("store"); }
  }, [actionData]);
  const importErr = actionData && "importError" in actionData ? (actionData as { importError: string }).importError : null;

  const styleChar = avatarId ?? d.cast[0]?.id ?? "ingrid";
  // Generic style samples (a fixed default presenter per style) instead of the
  // selected avatar re-rendered per tile — the per-avatar tiles changed as you
  // switched presenters, which read as confusing (owner). These are the SAME
  // generic tiles the Shopify app uses. (styleChar still backs the jingle
  // "Photoreal" tile below, which shows the actual chosen singer.)
  const styleCover = (key: string) => `/style-tiles/${key}.jpg?v=5`;

  // Mirror the server: no presenter → the engine renders the video and its
  // surcharge is real. With a presenter the lipsync engine does the work, so
  // quoting a surcharge here would quote a fee we don't take.
  // QUOTE WHAT THE SERVER WILL CHARGE.
  //
  // This asked "is a presenter selected?", but the server asks "did a presenter
  // ARRIVE?" — and avatarId is only submitted for the content types that use
  // one (needsPresenterField). The picker state defaults to the brand face on
  // arrival and is never cleared, so for Highlight, Commercial and Satisfying
  // Close-Up the button saw a presenter, quoted no surcharge, and the server
  // saw no presenter and took one: 225 tokens for a Veo video the button priced
  // at 150, or 675 against a quoted 450 on a x3 burst. The note underneath also
  // told the merchant the surcharge did not apply, while it did.
  //
  // Same condition as the hidden field, so the quote and the charge cannot
  // disagree again.
  const presenterWillBeSent = !!avatarId && needsPresenterField(contentType);
  const engineForcedDefault = contentType === "commercial";
  const engineApplies = tab === "video" && !presenterWillBeSent && !engineForcedDefault;
  const engineFee = engineApplies ? engineSurcharge(videoEngine) * (casual ? CREATOR_SURCHARGE_MULT : 1) : 0;
  // Re-clamp on every render rather than in an effect: switching from a ×10
  // image burst to the video tab must not quote — or charge — ten videos.
  const burstMax = tab === "video" ? MAX_BURST.video : tab === "image" ? MAX_BURST.image : 1;
  if (burst > burstMax) setBurst(burstMax);
  // Casual "edit a photo": the image→product surface becomes the photo editor,
  // which submits intent="edit" (once an op is picked) and reads as "Edit photo".
  const isEdit = casual && tab === "image" && imageMode === "product";
  // Creator "Make an image" — a text-to-image generation (its own intent).
  const isCreate = casual && tab === "image" && imageMode === "create";
  // Creator "Make music" — a text-to-song generation on its own casual tab.
  const isMusic = casual && tab === "music";
  // Creator "Faceless video" — topic → scripted 9:16 social video, own casual tab.
  const isFaceless = casual && tab === "faceless";
  // Creator "upload a video to edit it" — the casual Video tab with a clip
  // loaded. One ffmpeg op (trim/caption/speed), its own intent + flat 5-tok
  // cost; it REPLACES the describe->make flow while a video is loaded (removing
  // the video returns to make). Gated to casual video so the make path is intact.
  const isVideoEdit = casual && tab === "video" && !!editVideoFile;
  const submitIntent = isVideoEdit ? "videoedit" : isEdit && (editOp || direction.trim()) ? "edit" : isCreate ? "create" : tab;
  const verb = isVideoEdit ? "Edit" : isCreate || isMusic || isFaceless || (casual && tab === "video") ? "Make" : isEdit ? "Edit" : tab === "blog" ? "Write" : "Generate";
  const noun = isCreate ? "image" : isMusic ? "song" : isFaceless ? "video" : isEdit ? "photo" : tab === "video" ? "video" : tab === "image" ? "image" : "article";
  const baseCost = isVideoEdit ? d.costs.videoEdit : isCreate ? d.costs.createImage : tab === "video" ? (casual ? d.costs.casualVideo : d.costs.video) : tab === "image" ? d.costs.image : tab === "music" ? d.costs.music : tab === "faceless" ? d.costs.faceless : d.costs.blog;
  // Premium "Make an image" model (Genius) adds a token surcharge, like the
  // video engines. Re-derived from the SAME table the server charges from, so
  // the quote, the pill, XP and the Make button can't disagree with the charge.
  const createFee = (isCreate || isEdit) ? createModelSurcharge(createModel) : 0;
  const facelessFee = isFaceless ? facelessQualitySurcharge(facelessQuality) * CREATOR_SURCHARGE_MULT : 0;
  // A video edit is a flat per-op charge — no engine/model/burst surcharges ride it.
  const cost = isVideoEdit ? d.costs.videoEdit : baseCost + engineFee + createFee + facelessFee;

  // ── THE EASEL, PHASE 2: live result on the Stage (casual only) ──────────────
  // The Studio is fire-and-confirm: a submit queues an async job and the piece
  // lands in the gallery minutes later. Here we keep watching, and the moment the
  // new piece appears we render it ON the Stage with verb chips — no leaving the
  // room. Marketing is untouched (it keeps the confirmation modal).
  type StagePiece = { id: string; isVideo: boolean; isAudio: boolean; media: string; title: string };
  const [stageResult, setStageResult] = useState<StagePiece | null>(null);
  // The result's real aspect ratio (w/h), captured on load, so the Stage frame
  // HUGS the image instead of letterboxing it in a wide black box. Reset to
  // null whenever the shown media changes (falls back to a square frame).
  const [stageAspect, setStageAspect] = useState<number | null>(null);
  useEffect(() => { setStageAspect(null); }, [stageResult?.media, editPreview]);
  const [making, setMaking] = useState(false);
  // A generation that FAILED or was BLOCKED — shown on the Stage instead of
  // spinning forever. `kind` splits an unsafe/guideline block from a general
  // technical failure so the message (and tone) can differ.
  const [genError, setGenError] = useState<{ kind: "failed" | "unsafe"; message: string } | null>(null);
  const makingStartedRef = useRef<number>(0);
  const preIdsRef = useRef<string[]>([]);
  const makingNounRef = useRef<string>("");
  const makeBtnRef = useRef<HTMLButtonElement>(null);
  // Output-language chip (by the Make button): sets the language the generated
  // copy/script is written in. Optimistic pendingLang so the chip never lags.
  const outLangFetcher = useFetcher();
  const outputLang = outLangFetcher.formData?.get("contentLang")?.toString() || d.outputLang;
  const stageRev = useRevalidator();
  // Enter "making" on the Stage when a casual generation is queued; remember
  // what's already there so we can spot the fresh piece when it lands.
  useEffect(() => {
    if (casual && actionData && "queued" in actionData) {
      preIdsRef.current = d.recent.map((p) => p.id);
      makingNounRef.current = noun;
      makingStartedRef.current = Date.now();
      setGenError(null);
      setStageResult(null);
      setMaking(true);
    } else if (casual && actionData && "unsafe" in actionData && (actionData as { unsafe?: boolean }).unsafe) {
      // The prompt was blocked BEFORE the pipeline — show it on the Stage as a
      // guidelines block (distinct from a technical failure), no spinner.
      setMaking(false);
      setGenError({ kind: "unsafe", message: (actionData as { error?: string }).error || t("That prompt is against our content guidelines.") });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionData]);
  // While making, quietly revalidate so d.recent refreshes; stop after a cap so a
  // stuck render never polls forever.
  useEffect(() => {
    if (!making) return;
    const started = Date.now();
    // Video can legitimately take minutes; images/songs are quick. Cap the poll
    // so a stuck render never spins forever — and SAY something on timeout
    // instead of silently going idle.
    const capMs = (makingNounRef.current === "video") ? 6 * 60_000 : 3 * 60_000;
    const iv = setInterval(() => {
      if (Date.now() - started > capMs) {
        setMaking(false);
        setGenError({ kind: "failed", message: t("This is taking longer than usual. It may still land in your gallery shortly — or try again.") });
        return;
      }
      if (stageRev.state === "idle") stageRev.revalidate();
    }, 5000);
    return () => clearInterval(iv);
  }, [making, stageRev]);
  // The new piece has landed → show it on the Stage.
  useEffect(() => {
    if (!making) return;
    const fresh = d.recent.find((p) => p.media && !preIdsRef.current.includes(p.id));
    if (fresh && fresh.media) {
      setStageResult({ id: fresh.id, isVideo: fresh.isVideo, isAudio: fresh.isAudio, media: fresh.media, title: fresh.title });
      setMaking(false);
      // The edit is done — drop the loaded source photo so it doesn't linger on
      // the Stage behind the result or get re-submitted on the next Make.
      setEditPreview((p) => { if (p) { try { URL.revokeObjectURL(p); } catch { /* */ } } return null; });
      setEditFile(null);
      setHasFile(false);
      // Same for a video-edit: drop the loaded clip so the panel resets to the
      // describe->make flow once the edited video lands.
      if (editVideoUploadRef.current) editVideoUploadRef.current.value = "";
      setEditVideoFile(null);
      return;
    }
    // No new piece yet — did THIS generation fail? The newest creator job is
    // FAILED and was created around when we started → stop spinning and say so.
    const lg = d.lastGen;
    if (lg && lg.status === "FAILED" && new Date(lg.at).getTime() >= makingStartedRef.current - 15000) {
      // Even a prompt that passed our pre-screen can be refused by the model's
      // own provider-side safety — read the failure reason and split the message.
      const errStr = (lg.error || "").toLowerCase();
      const isSafety = /safet|flag|content polic|sensitive|nsfw|not allowed|blocked|moderat|csam|prohibit|violat|e005/.test(errStr);
      setGenError(isSafety
        ? { kind: "unsafe", message: t("Sorry — this one looks like it touches on something we can’t create, so the model held back. You’ve been refunded, no worries. Try rewording it or a different idea and we’ll get right on it.") }
        : { kind: "failed", message: t("That one didn’t come through — it may have hit a snag. Your tokens were refunded; try again.") });
      setMaking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.recent, d.lastGen, making]);
  // POST-GENERATION QUICK EDITS — turn a finished image into the next one
  // (Enhance / Zoom out / Zoom in / Remove bg). Reuses the edit pipeline on the
  // result's OWN url (a small "quickedit" charge). Submitted programmatically
  // because the Stage lives outside the <Form>.
  //
  // Flow is SELECT-then-CONFIRM: tapping a chip only selects the edit type; the
  // green "Apply" button is what spends the tokens. (Was charge-on-tap, which
  // debited the wallet the instant a chip was touched — too easy to misfire.)
  const QUICK_OPS: { key: string; op: string; icon: string; label: string; dir?: string }[] = [
    { key: "enhance", op: "upscale", icon: "sparkle", label: t("Enhance") },
    { key: "zoomout", op: "replace", icon: "search", label: t("Zoom out"), dir: "Zoom out and reveal more of the scene around the subject — a wider framing of this same image, keep the style and subject consistent." },
    { key: "zoomin", op: "replace", icon: "search", label: t("Zoom in"), dir: "Zoom in closer on the main subject — a tighter crop that fills the frame, keep the style and subject consistent." },
    { key: "bgremove", op: "bgremove", icon: "scissors", label: t("Remove bg") },
  ];
  const [quickSel, setQuickSel] = useState<string | null>(null);
  const quickEdit = (op: string, dir?: string) => {
    if (!stageResult || stageResult.isVideo || stageResult.isAudio || making || busy) return;
    const abs = stageResult.media.startsWith("http") ? stageResult.media : `${window.location.origin}${stageResult.media}`;
    const fd = new FormData();
    fd.set("intent", "quickedit");
    fd.set("mode", "casual");
    fd.set("editOp", op);
    if (dir) fd.set("direction", dir);
    fd.set("productImageUrl", abs);
    fd.set("productTitle", "Quick edit");
    submit(fd, { method: "post", encType: "multipart/form-data" });
  };
  // Save the staged result. A plain <a download> only works same-origin — our
  // renders live at /renders but fal/replicate/CDN results are cross-origin
  // expiring URLs, where the browser silently IGNORES `download` and just opens
  // the file. So for those we pull the bytes and save a blob, falling back to a
  // new-tab open if the host blocks the fetch (never worse than before).
  const downloadMedia = async (url: string) => {
    const base = url.split("?")[0];
    const ext = (base.match(/\.(mp4|webm|mov|png|jpe?g|webp|gif|mp3|wav|m4a)$/i)?.[1] || (stageResult?.isVideo ? "mp4" : stageResult?.isAudio ? "mp3" : "png")).toLowerCase();
    const name = `easymode-${Date.now()}.${ext}`;
    const save = (href: string, revoke?: string) => {
      const a = document.createElement("a");
      a.href = href; a.download = name; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 4000);
    };
    const sameOrigin = url.startsWith("data:") || url.startsWith("/") || (typeof window !== "undefined" && url.startsWith(window.location.origin));
    if (sameOrigin) { save(url); return; }
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(String(res.status));
      const obj = URL.createObjectURL(await res.blob());
      save(obj, obj);
    } catch {
      window.open(url, "_blank", "noopener"); // CORS-blocked: at least show it
    }
  };
  // Clear the pending selection whenever the staged image changes — after an
  // edit lands (new media), when a different creation is loaded, or on clear.
  useEffect(() => { setQuickSel(null); }, [stageResult?.media]);
  // Click a creation in the shelf → bring it back UP onto the Stage (for viewing
  // + quick edits), instead of leaving to the gallery.
  const loadToStage = (p: StagePiece) => {
    setGenError(null);
    setMaking(false);
    setEditPreview((prev) => { if (prev) { try { URL.revokeObjectURL(prev); } catch { /* */ } } return null; });
    setEditFile(null);
    setStageResult(p);
    try { document.querySelector(".ws-stage")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* */ }
  };
  // DROP (or upload) A PHOTO ONTO THE STAGE → edit it. The idle Stage is a
  // drag/drop + click-to-upload target (DeepAI-style). A dropped image flips
  // into the photo-edit flow, then loads once that flow's file input mounts.
  const onStagePhoto = (f?: File | null) => {
    if (!f || !/^image\//.test(f.type)) return;
    setStageResult(null);
    // On the VIDEO tab a dropped/uploaded photo SEEDS the video (image-to-video)
    // — it must NOT yank the user over to the image editor. (Beta feedback: a
    // photo uploaded while making a video wrongly jumped to the Image section.)
    // The casual video submit injects uploadFile as productPhoto when
    // prodSource==="upload" (see onFormSubmit), and the server animates a
    // PRODUCT_HIGHLIGHT clip from it; with no photo it stays text-to-video.
    if (casual && tab === "video") {
      takeUpload(f);
      setProdSource("upload");
      return;
    }
    setTab("image");
    setImageMode("product");
    setPendingPhoto(f);
  };
  useEffect(() => {
    // Don't gate on photoInputRef being mounted — takePhoto holds the File in
    // state (editFile) and shows the preview regardless; the input.files copy
    // is only a best-effort bonus for browsers that allow it.
    if (isEdit && pendingPhoto) {
      takePhoto(pendingPhoto);
      setPendingPhoto(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, pendingPhoto]);
  const needsPresenter = tab === "video" ? baseOf(contentType) === "avatar" : tab === "image" && imageMode === "presenter";
  const showCartoonGrid = tab === "video" && (contentType === "cartoon" || contentType === "jingle");
  const cfgReady = tab === "blog" || tab === "music" || tab === "faceless" || (tab === "video" && !!contentType) || (tab === "image" && imageMode !== null);
  // The Service/offer toggle only EXISTS on two of the four surfaces, but its
  // state survived a tab or mode change and the hidden field was submitted
  // regardless. So a merchant who tried Service on the product screen, backed
  // out and picked "With presenter" was charged for a presenter-less
  // service-outcome image — after a screen that told them the presenter would
  // be in it. A control nobody can see must not be able to change the order.
  // No "what are you promoting?" in casual — there's nothing being sold. (The
  // server also forces service=false in casual, so this is UX, not the guard.)
  const showService = !casual && (tab === "video" || (tab === "image" && imageMode === "product"));
  // ONE FLAG, AND IT IS THE ONE THAT GETS SUBMITTED.
  //
  // `service` survives a tab or mode change but the toggle only EXISTS while
  // showService is true, and the hidden field is only submitted under the
  // same condition. The client-side checks still read the raw state, so:
  // turn Service on in Video, switch to Image + With presenter, and
  // needsPhoto reads false while the field is not submitted. The button
  // enables, the form posts with no photo and no service flag, and the
  // server generates a presenter ad from the product NAME — the AI-slop path
  // the “add a product photo” warning exists to prevent, at full price.
  //
  // Everything the client reasons about now uses the effective value, so a
  // control nobody can see cannot change the order.
  // Talking Head is a product-free presenter format: it rides the same no-product
  // "service" path (no photo, no hold, serviceMode) without exposing the toggle,
  // so serviceOn is forced on for it. Scoped to the video tab so a leftover
  // contentType can't flip the image flow's photo requirement.
  const serviceForced = tab === "video" && contentType === "talkinghead";
  const serviceOn = showService && (service || serviceForced);
  // baseOf, not the literal. Review and Unboxing are avatar-based presets
  // (CT_PRESETS above maps both to base "avatar"), and every other test in this
  // file goes through baseOf — needsPresenter, the presenter picker, the
  // product-in-hand hint. This one did not, so on exactly the two formats that
  // are ABOUT holding the product, the merchant lost both the hold/wear choice
  // and the "how big is it?" control, and no wear flag was submitted. Size then
  // falls to inference, which is how a twelve-box case once came out palm-sized.
  const showWear = ((tab === "video" && baseOf(contentType) === "avatar") || (tab === "image" && imageMode === "presenter")) && !!avatarId && !serviceOn;
  const avatarRides = (tab === "video" && !!contentType && needsPresenterField(contentType) && !!avatarId) || (tab === "image" && imageMode === "presenter" && !!avatarId);

  // Compose direction + scene exactly like the embedded Studio: Advanced's
  // 3 W's fold into one direction string, the do/where pair also feeds the
  // composed opening frame as `scene`; Commercial look rides the same plumbing.
  let finalDirection = direction.trim();
  let finalScene = "";
  if (tab === "video") {
    if (advanced) {
      const parts: string[] = [];
      if (saySomething.trim()) parts.push(`They say: ${saySomething.trim()}`);
      if (doWhat.trim()) parts.push(`They do: ${doWhat.trim()}`);
      if (where.trim()) parts.push(`Setting: ${where.trim()}`);
      finalDirection = parts.join(". ");
      finalScene = [doWhat.trim(), where.trim()].filter(Boolean).join(". ");
    }
    if (!casual && commercial && (contentType === "avatar" || contentType === "highlight")) {
      const commercialScene = "a seamless bold single-color studio backdrop that complements the product's colors, big-budget commercial styling, crisp professional studio lighting";
      finalScene = finalScene ? `${finalScene}. ${commercialScene}` : commercialScene;
      finalDirection = finalDirection ? `${finalDirection}. Big-budget studio commercial energy.` : "Big-budget studio commercial energy: polished, confident, premium.";
    }
  } else if (tab === "image") {
    finalScene = direction.trim();
  }

  // Rotate the presenter’s 4 wardrobe variants across generations so repeated
  // content of the same face never looks stale (0→1→2→3→…).
  //
  // The counter is PER PRESENTER AND PRODUCT. One global “csOutfit” key meant
  // the rotation was shared by every pair the merchant had ever made: two ads
  // of different products could land on the same outfit while two ads of the
  // SAME product skipped straight past one, so “their outfit rotates each
  // time” — which this page says out loud — was true only by accident.
  //
  // localStorage still, because it is a nicety, not an invariant: a fresh
  // browser starts the pair at outfit 1 again, which is a different outfit
  // from a merchant’s first-ever ad only by luck. What guarantees the ads
  // differ is freshShot in the action, not this.
  const variantRef = useRef<HTMLInputElement | null>(null);
  const nextVariant = () => {
    const pair = `csOutfit:${avatarId || "none"}:${(productTitle || "").slice(0, 60)}`;
    let n = 0;
    try { n = ((parseInt(localStorage.getItem(pair) || "0", 10) || 0) + 1); localStorage.setItem(pair, String(n)); } catch { /* private mode */ }
    return String(n % 4);
  };
  // Product-source chooser handlers. Upload stashes a preview + marks hasFile so
  // the Generate gate clears; switching source clears the OTHER path so a stale
  // store link or an orphaned file can't ride the submit.
  const takeUpload = (f: File | null | undefined) => {
    // MIME guard (mirrors takePhoto): the accept list filters the dialog, but an
    // OS "All files" override can still hand us a non-image — don't preview or
    // arm the submit with one. clearUpload resets the stray selection.
    if (f && !/^image\//.test(f.type)) { clearUpload(); return; }
    setHasFile(!!f);
    setUploadFile(f || null);
    setUploadPreview((prev) => { if (prev) { try { URL.revokeObjectURL(prev); } catch { /* */ } } return f ? URL.createObjectURL(f) : null; });
    // A new product photo (incl. swapping file A->B, where hasFile stays true so
    // the stale-frame effect's deps don't fire) invalidates any approved combine.
    resetCombine();
    // Snap the hub drawer shut on a successful pick so the photo shows in the
    // product HERO tile (mirrors a store-catalogue pick). No-op outside the hub.
    if (f) setHubPick(null);
  };
  const clearUpload = () => {
    setUploadPreview((prev) => { if (prev) { try { URL.revokeObjectURL(prev); } catch { /* */ } } return null; });
    setHasFile(false);
    setUploadFile(null);
    if (uploadRef.current) uploadRef.current.value = "";
    resetCombine();
  };
  // Switching source clears the OTHER path so a stale store link / buy-URL or an
  // orphaned uploaded file can't ride the submit — but only when actually
  // CHANGING source, so re-tapping the already-active card never wipes a pick.
  // No explicit clearUpload here — the [prodSource] effect clears the upload
  // state only on an ACTUAL switch, so re-tapping the active store card never
  // wipes an approved combine frame.
  const chooseStore = () => { if (prodSource !== "store") { setImageUrl(""); setPickedUrl(""); } setProdSource("store"); if (d.catalog.length === 0) setShowConnect(true); };
  // Clear any store pick so "upload my own" starts clean, then REVEAL the upload
  // branch. chooseUpload itself does NOT open the OS picker — the "Upload a photo"
  // CARD opens it (it calls uploadRef.current?.click() right after this, which
  // works because the file input is always-mounted), per owner request that
  // tapping the card BE the Choose-File action. The in-branch "Choose a photo"
  // button and the "Not in your store" link reuse chooseUpload without the auto-open.
  const chooseUpload = () => { if (prodSource !== "upload") { setImageUrl(""); setPickedUrl(""); } setProdSource("upload"); setShowConnect(false); };
  // Combine: submit the presenter-holding-product frame as a normal image gen
  // (1 image charge, lands in the gallery — the user chose this cost model),
  // then poll for the fresh asset and hold its URL to seed the video. We reuse
  // the tested presenter-image path rather than duplicate the compose/money
  // path in a new job handler.
  // `over` lets the post-combine tweaks re-run the SAME compose with one thing
  // changed: a different outfit variant, and/or a scene/direction. Omitted =
  // the first Combine (form defaults: variant 0, no scene).
  const doCombine = (over?: { variant?: number; scene?: string }) => {
    const formEl = formRef.current;
    if (!formEl) return;
    const fd = new FormData(formEl);
    fd.set("intent", "combine");
    fd.set("burst", "1");        // exactly one frame, never a burst
    fd.delete("merchantOffer");  // a seed frame carries no promo text
    fd.delete("templateKey");
    fd.delete("formatKey");
    fd.delete("composedFrameUrl");
    if (avatarId) fd.set("avatarId", avatarId);
    if (over?.variant != null) fd.set("avatarVariant", String(over.variant));
    if (over?.scene != null) fd.set("combineScene", over.scene);
    // Inject the state-held file in case the input was remounted empty.
    if (prodSource === "upload" && uploadFile) fd.set("productPhoto", uploadFile);
    combineStartRef.current = Date.now();
    setCombineErr(null);
    setCombineUrl(null);
    setCombineJobId(null);
    setCombining(true);
    combineFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  };
  // ONE action, the green hero. Typed a change ("green shirt", "put them in an
  // office") → apply it as an Edit and remember it. Box empty → Retry: re-run the
  // SAME shot (keeping any change already applied) for another take of a bad one.
  // Either way it re-composes for one 16-tok charge — the only button that spends.
  const applyCombineEdit = () => {
    const s = combineEdit.trim();
    if (s) {
      // ACCUMULATE the change onto the look so far — don't replace it. The combine
      // re-composes from presenter+product each time using `scene` as the directive,
      // so replacing it dropped every earlier edit and the next edit effectively
      // started from the original frame again. Stacking directives ("green shirt" +
      // "add a hat") makes each edit build on the last. Keep the most-recent ones
      // within the compose's ~200-char scene budget (oldest fall off first).
      const parts = (combineScene ? combineScene.split(", ") : []).concat(s);
      while (parts.length > 1 && parts.join(", ").length > 190) parts.shift();
      const next = parts.join(", ");
      setCombineScene(next); setCombineEdit(""); doCombine({ scene: next });
    } else {
      // Retry: re-run the SAME accumulated look (or the base shot) for another take.
      doCombine({ scene: combineScene || undefined });
    }
  };
  // Edit the CURRENT frame itself — a true image edit of this exact shot (used
  // for a reused gallery shot or an upload, which have no presenter/product to
  // re-compose). The edited result replaces the frame and can be edited again.
  // Reuses the combine job polling (returns a combineJobId); frameEditModeRef
  // keeps it a "your own shot" frame so it doesn't flip to the re-compose path.
  const applyFrameEdit = () => {
    const s = combineEdit.trim();
    if (!s || !combineUrl || combining || busy) return;
    const fd = new FormData();
    fd.set("intent", "frameEdit");
    fd.set("sourceFrameUrl", combineUrl);
    fd.set("direction", s);
    frameEditModeRef.current = true;
    combineStartRef.current = Date.now();
    setCombineEdit(""); setCombineErr(null); setCombineUrl(null); setCombineJobId(null); setCombining(true);
    combineFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  };
  // Upload your OWN frame → it becomes the combine result (the video seed), free.
  const doFrameUpload = (file: File | null | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("intent", "frameUpload");
    fd.set("productPhoto", file);
    setCombineErr(null);
    frameFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
    if (frameUploadRef.current) frameUploadRef.current.value = "";
  };
  // Reuse a PAST creation as the frame — re-match the presenter + product to it
  // (so the video's voice/script fit the shot) and drop straight into Locked-in.
  const useFrame = (f: { media: string; avatarId: string | null; productTitle: string | null }) => {
    if (f.avatarId && d.cast.some((c) => c.id === f.avatarId)) setAvatarId(f.avatarId);
    if (f.productTitle) setProductTitle(f.productTitle);
    setCombineScene(""); setCombineEdit(""); setCombineErr(null); setCombineJobId(null); setCombining(false);
    setCombineGenerated(false); setCombineUrl(f.media);
  };
  // Clear the current frame (the ✕ on the photo) — back to the empty state to
  // combine, upload or reuse a different one. The edit context goes with it.
  const clearCombineFrame = () => {
    setCombineUrl(null); setCombineGenerated(false); setCombineScene(""); setCombineEdit(""); setCombineErr(null); setSettingKey("auto");
  };
  // The uploaded frame came back — use it as the seed, or surface an error.
  useEffect(() => {
    const data = frameFetcher.data;
    if (!data) return;
    if (data.error) { setCombineErr(data.error); return; }
    if (data.frameUrl) { setCombineScene(""); setCombineEdit(""); setCombineJobId(null); setCombining(false); setCombineGenerated(false); setCombineUrl(data.frameUrl); }
  }, [frameFetcher.data]);
  // The combine submit came back — grab the job id to poll, or surface an error
  // (tokens are charged BEFORE enqueue, so an error here means no charge).
  useEffect(() => {
    const data = combineFetcher.data;
    if (!data) return;
    if (data.error) { setCombining(false); setCombineErr(data.error); return; }
    if (data.combineJobId) setCombineJobId(data.combineJobId);
  }, [combineFetcher.data]);
  // Poll the combine job BY ID (section-agnostic) until its presenter frame
  // lands; a cap stops a stuck render from spinning forever.
  useEffect(() => {
    if (!combining || !combineJobId) return;
    const tick = () => {
      if (Date.now() - combineStartRef.current > 4 * 60_000) {
        setCombining(false);
        setCombineErr(t("That took too long — try Combine again."));
        return;
      }
      // No state guard: the effect closure would capture a STALE statusFetcher,
      // so reading .state here is unreliable. A fetcher serializes its own loads
      // (a new load supersedes an in-flight one), so polling every tick is safe.
      statusFetcher.load(`/web/studio?combineJob=${encodeURIComponent(combineJobId)}`);
    };
    tick();
    const iv = setInterval(tick, 4000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combining, combineJobId]);
  // Read the polled status: the frame URL wins the moment it exists; a terminal
  // job with no presenter frame (compose failed) or an outright FAILED is an error.
  useEffect(() => {
    if (!combining) return;
    const r = statusFetcher.data?.combineResult;
    // Ignore a stale result from a PREVIOUS combine (fetcher data persists across
    // submits) — only act on the result for the job we're currently polling.
    if (!r || r.jobId !== combineJobId) return;
    if (r.media) {
      setCombineUrl(r.media);
      // A frame edit stays a "your own shot" (so it keeps the true-edit path);
      // a real combine/retry becomes a generated frame (the re-compose path).
      if (frameEditModeRef.current) frameEditModeRef.current = false;
      else setCombineGenerated(true);
      setCombining(false); return;
    }
    if (r.failed) {
      // Only a genuine technical miss (no frame produced) fails now — the job
      // refunds the charge (presenterOnly), so keep it plain and reassuring.
      setCombining(false);
      setCombineErr(t("That didn’t come through — you weren’t charged. Tap Combine to try again."));
    } else if (r.done) {
      setCombining(false);
      setCombineErr(t("That take didn’t come through — tap Combine to run it again."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFetcher.data, combining, combineJobId]);
  const avatarThumb = d.cast.find((c) => c.id === avatarId)?.img || "";
  const productThumb = uploadPreview || imageUrl || "";
  // A marketing product is really present only when the source whose input is
  // mounted matches: store needs imageUrl, upload needs a file. Trusting a bare
  // hasFile/imageUrl let the panel/Generate show a product whose input wasn't
  // rendered (prodSource desync) → "add a photo" on submit.
  const hasMarketingProduct = (prodSource === "store" && !!imageUrl.trim()) || (prodSource === "upload" && (hasFile || !!imageUrl.trim()));
  // Content types that use the compact Combine Hub: avatar/review (base avatar)
  // Only AVATAR video and JINGLE use the combine hub (presenter holds the real
  // product → combine → stylize/animate). Commercial has no presenter;
  // talkinghead is product-free (serviceForced). CARTOON rejoined the hub
  // (2026-10-26, owner): it now ANIMATES from the approved Combine frame — the
  // Combine renders the presenter holding the product REDRAWN in the chosen
  // cartoon style (the styled keyframe, cartoon-ad-pipeline keyframeOnly), the
  // merchant approves that exact look, and the video is seeded from it. The
  // style grid stays above the hub (cfgReady gates the hub on a picked style),
  // so the flow is: pick style → Your scene (presenter + product) → Combine →
  // generate — matching Avatar AI, which the owner wanted for its viral appeal.
  const hubType = baseOf(contentType) === "avatar" || contentType === "jingle" || contentType === "cartoon";
  const showCombine = tab === "video" && hubType && !!avatarId && !serviceOn && hasMarketingProduct;
  const combineCost = d.costs.combine;
  // The avatar-VIDEO "Combine hub": presenter + product + size/wear + combine
  // merged into ONE panel — the START of the flow. Only this flow restructures;
  // serviceOn (incl. Talking Head's serviceForced) and every image/cartoon/
  // jingle/casual flow keep their current layout untouched. Does NOT require a
  // presenter/product yet (empty tiles); showCombine still gates the Combine
  // button + result inside it.
  const avatarVideoHub = tab === "video" && hubType && !serviceOn;
  // Which hub ingredient tile has its inline picker open. Collapsing happens in
  // the pick handlers (store-catalogue tap, presenter tap) — NOT an effect keyed
  // on hasMarketingProduct/avatarId, which would slam the drawer shut the instant
  // you reopened it to CHANGE an already-set pick.
  const [hubPick, setHubPick] = useState<"presenter" | "product" | "style" | "setting" | null>(null);
  // Leaving the hub entirely (tab→Image, contentType→cartoon/commercial, Service
  // on) must reset hubPick, or a drawer left open would re-open EXPANDED on
  // return — defeating collapse-by-default. Keyed on avatarVideoHub so it only
  // fires on the true→false leave, never mid-pick (the old slam-shut bug).
  useEffect(() => {
    if (!avatarVideoHub) setHubPick(null);
  }, [avatarVideoHub]);
  // ── Hero presenter video ────────────────────────────────────────────────
  // The selected presenter's intro plays in the big hub tile. It autoplays
  // MUTED on first load (no gesture yet), and plays WITH SOUND the moment you
  // pick a presenter (the tap is the gesture, so iOS — even in Low Power Mode —
  // allows it). Controlled imperatively so the with-sound play() fires inside
  // the selecting tap, not in an effect a tick later (which iOS would block).
  const heroVid = useRef<HTMLVideoElement | null>(null);
  const [heroMuted, setHeroMuted] = useState(true);
  const avatarIdRef = useRef(avatarId); avatarIdRef.current = avatarId;
  const wantHeroSound = useRef(false);
  const heroShown = useRef<string | null>(null);
  const heroDesigned = !!d.cast.find((c) => c.id === avatarId)?.designed;
  const applyHero = (id: string, withSound: boolean) => {
    const v = heroVid.current; if (!v || !id) return;
    if (heroShown.current !== id) { v.src = `/voice-videos/${id}.mp4?v=2`; heroShown.current = id; try { v.load(); } catch { /* noop */ } }
    v.loop = true; v.muted = !withSound; setHeroMuted(!withSound);
    const p = v.play(); if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {});
  };
  // Stable ref callback: fires on mount/unmount of the hero <video>. On mount,
  // start it (muted, or with sound if a selection is pending from a remount).
  const heroVidRef = useCallback((el: HTMLVideoElement | null) => {
    heroVid.current = el;
    if (el) { heroShown.current = null; const snd = wantHeroSound.current; wantHeroSound.current = false; applyHero(avatarIdRef.current || "", snd); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleHeroSound = () => {
    const v = heroVid.current; if (!v) return;
    if (v.muted) { v.muted = false; setHeroMuted(false); const p = v.play(); if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {}); }
    else { v.muted = true; setHeroMuted(true); }
  };
  // Picking a presenter: select it + play its intro with sound in the SAME tap.
  const selectPresenter = (id: string | null) => {
    setAvatarId(id); setHubPick(null);
    const designed = !!d.cast.find((c) => c.id === id)?.designed;
    if (id && designed && avatarVideoHub) {
      if (heroVid.current) applyHero(id, true); // element persists → play now, in the gesture
      else wantHeroSound.current = true;        // hero will mount → play with sound then
    }
  };
  // The product source chooser (cards + store grid/connect/import + upload box +
  // the hidden productImageUrl). Defined once and rendered in EITHER the classic
  // step-2 layout OR inside the avatar-video Combine panel — exactly one mounts
  // per render (avatarVideoHub is exclusive), so form input names never collide.
  const productChooserUI = (
    <>
      {/* Always-mounted hidden file input: the "Upload a photo" card calls its
          .click() SYNCHRONOUSLY, which only opens the OS picker if the input is
          already in the DOM at tap time (matters on iOS). So it lives here, not
          inside the prodSource==="upload" branch that mounts a render too late. */}
      <input ref={uploadRef} type="file" name="productPhoto" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => takeUpload(e.currentTarget.files?.[0])} />
      {!serviceForced && (
        <div className="ws-srcpick" role="group" aria-label={t("Where's your product?")}>
          <button type="button" className={`ws-srccard${prodSource === "store" ? " sel" : ""}`} aria-pressed={prodSource === "store"} onClick={chooseStore}>
            <Ico n="box" size={19} />
            <b>{t("From your store")}</b>
            <span>{d.catalog.length > 0 ? t("Pick a product you already sell") : t("Link your store to pick products")}</span>
          </button>
          {/* Tapping this IS "Choose File" — it selects the upload source AND opens
              the picker in one tap (owner-requested). */}
          <button type="button" className={`ws-srccard${prodSource === "upload" ? " sel" : ""}`} aria-pressed={prodSource === "upload"} onClick={() => { chooseUpload(); uploadRef.current?.click(); }}>
            <Ico n="camera" size={19} />
            <b>{t("Upload a photo")}</b>
            <span>{t("Use your own product image")}</span>
          </button>
        </div>
      )}
      {prodSource === "store" && !serviceForced && d.catalog.length > 0 ? (
        <>
          <div className="ws-lbl">
            <span>{t("Pick from your store")}</span>
            <span className="ws-opt">
              {catShown.length < d.catalogCount
                ? t("showing {shown} of {total} — search for the rest", { shown: catShown.length, total: d.catalogCount })
                : (d.catalogCount === 1 ? t("{n} product", { n: d.catalogCount }) : t("{n} products", { n: d.catalogCount }))}
            </span>
          </div>
          <button type="button" className="ws-addurl ws-uploadown" onClick={chooseUpload}>
            <Ico n="camera" size={13} /> {t("Not in your store? Upload your own photo instead")}
          </button>
          {d.catalog.length > 8 && (
            <input className="wb-in ws-catsearch" value={catQuery} placeholder={t("Search your catalogue…")}
              onChange={(e) => setCatQuery(e.target.value)} />
          )}
          <div className="ws-catgrid">
            {catShown
              .map((c) => (
                <button type="button" key={c.id}
                  className={`ws-cat${productTitle === c.title ? " sel" : ""}`}
                  title={c.title}
                  onClick={() => {
                    setProductTitle(c.title);
                    setImageUrl(c.imageUrl || "");
                    setPickedUrl(c.url);
                    setHubPick(null); // snap the hub drawer shut on a store pick
                  }}>
                  <span className="ws-cat-img" style={c.imageUrl ? { backgroundImage: `url(${c.imageUrl})` } : undefined}>
                    {!c.imageUrl && <Ico n="image" size={22} />}
                    {productTitle === c.title && <span className="ws-chk">✓</span>}
                  </span>
                  <b>{c.title}</b>
                  {c.priceText && <span className="ws-cat-p">{c.priceText}</span>}
                </button>
              ))}
          </div>
          <div className="ws-catfoot">
            {!d.catalogSyncing && (
              <button type="button" className="ws-addurl" onClick={() => setShowConnect((v) => !v)}>
                {showConnect ? t("Cancel") : <>↻ {t("Refresh catalogue")}</>}
              </button>
            )}
          </div>
          {d.catalogSyncing && <CatalogSync startedAt={d.catalogSyncStartedAt} />}
        </>
      ) : prodSource === "store" && !serviceForced ? (
        <div className="ws-connect">
          <b><Ico n="box" /> {t("Bring your whole store in")}</b>
          <p>{t("Paste your store address once and we’ll pull your products in — then you pick one from a grid instead of hunting down a link every time. Your product page link rides along to the post, so shoppers land straight on the buy page.")}</p>
          {!d.catalogSyncing && d.catalogFailed && (
            <div className="wb-err" style={{ marginBottom: 8 }}><b>{t("That import didn’t work.")}</b> {d.catalogFailed} {t("You can paste a single product link below instead.")}</div>
          )}
          {!d.catalogSyncing && (
            <button type="button" className="wb-btn ghost" onClick={() => setShowConnect(true)}>{t("Connect my store")}</button>
          )}
        </div>
      ) : null}
      {prodSource === "store" && !serviceForced && d.catalogSyncing && d.catalog.length === 0 && <CatalogSync startedAt={d.catalogSyncStartedAt} />}
      {prodSource === "store" && !serviceForced && showConnect && !d.catalogSyncing && (
        <div className="ws-import">
          <input className="wb-in" type="url" value={storeInput} placeholder="yourstore.com"
            onChange={(e) => setStoreInput(e.target.value)} />
          <button type="button" className="wb-btn" disabled={busy || !storeInput.trim()}
            onClick={() => { submit({ intent: "importCatalog", storeUrl: storeInput.trim() }, { method: "post" }); setShowConnect(false); }}>
            {t("Pull my products in")}
          </button>
        </div>
      )}
      {/* The chosen store image rides to the server as productImageUrl. */}
      {prodSource === "store" && !serviceForced && <input type="hidden" name="productImageUrl" value={imageUrl} />}
      {/* No upload box / "Choose a photo" button / big preview: tapping the
          "Upload a photo" card IS the upload (it opens the picker), and the
          chosen photo shows in the larger product HERO tile above. */}
    </>
  );
  // (The product source chooser stays inline in step 2 — for the avatar-video
  // hub it is simply wrapped in a collapsible .ws-hub-reveal there, so there is
  // one mount and one set of form inputs, never a duplicate.)
  // A new presenter, product, outfit or hold/wear flip makes the combined frame
  // stale AND must cancel any in-flight combine, so a late landing can't set the
  // wrong frame — drop it all. (Swapping an uploaded FILE keeps hasFile=true, so
  // that case is cleared directly in takeUpload/clearUpload, not here.)
  useEffect(() => {
    resetCombine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarId, imageUrl, wear, contentType, productSize]);
  // Avatar AI is the PRODUCT path; SERVICE lives on its own type (Talking Head).
  // A stale service=true (set on another type) must not flip the product hub into
  // the classic service layout — force it off whenever Avatar AI is selected.
  useEffect(() => { if (contentType === "avatar") setService(false); }, [contentType]);
  // Leaving the UPLOAD source unmounts the file input and loses the native file,
  // but hasFile/uploadPreview are React state that survive — leaving a PHANTOM
  // photo (the panel shows a product; the submit carries none → "add a photo",
  // even though one looks selected). The "Use last" chip / Add-by-URL import /
  // ?product= preselect all flip prodSource to "store" WITHOUT going through
  // chooseStore, so clear the upload state here whenever we are not on upload.
  useEffect(() => {
    if (prodSource !== "upload") clearUpload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prodSource]);
  // Marketing upload and casual edit SHARE hasFile, and switching modes toggles
  // in place (no remount), so a file left over from one flow would mis-gate the
  // other. Reset the upload/combine state on any mode change.
  useEffect(() => {
    clearUpload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  // Casual tabs (Make / Edit / Music / Faceless) toggle in place too, and the
  // Edit tab shares hasFile with the Marketing upload — a photo left on one tab
  // would mis-gate another, enabling Create/Edit with no real photo. Clear the
  // upload AND the source so the submit gate starts honest on every tab switch.
  useEffect(() => {
    clearUpload();
    setProdSource(null);
    // Drop any loaded video-to-edit too, so leaving the Video tab returns the
    // describe->make flow and the native productVideo input starts empty.
    if (editVideoUploadRef.current) editVideoUploadRef.current.value = "";
    setEditVideoFile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const onFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (variantRef.current) variantRef.current.value = nextVariant();
    // A photo picked via the Stage "+" lives in state (editFile) but may not be
    // in the native productPhoto input (iOS blocks the programmatic transfer).
    // For a casual photo edit, submit a FormData with the File injected so the
    // edit always has the photo — regardless of what the input holds.
    if (isEdit && (editFile || imageUrl.trim())) {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      // An uploaded photo rides as a File; an imported Gallery creation (?src=)
      // rides as its URL — casual edit hides the native productImageUrl input,
      // so inject it here or the edit would arrive with no source image. The
      // server requires a FULL https:// URL, and a ?src= from the gallery is a
      // relative /renders/… path, so absolutize it (same as quickEdit does).
      if (editFile) fd.set("productPhoto", editFile);
      else { const u = imageUrl.trim(); fd.set("productImageUrl", u.startsWith("http") ? u : `${window.location.origin}${u}`); }
      // A second photo turns this into a combine: inject it + force Ultra (the
      // multi-image engine); the server reprices it to 16 tokens.
      if (editFile2) { fd.set("productPhoto2", editFile2); fd.set("createModel", "ultra"); }
      fd.set("intent", submitIntent);
      submit(fd, { method: "post", encType: "multipart/form-data" });
      return;
    }
    // Marketing upload: the native file input can be dropped by a remount (the
    // Talking Head round-trip) while uploadFile state survives, so a Generate
    // would submit no photo even though one is shown. Inject the state file.
    if (!isEdit && prodSource === "upload" && uploadFile) {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      fd.set("productPhoto", uploadFile);
      fd.set("intent", submitIntent);
      submit(fd, { method: "post", encType: "multipart/form-data" });
    }
  };

  const doImport = () => { if (urlInput.trim()) submit({ intent: "importUrl", url: urlInput.trim() }, { method: "post" }); };

  // A casual unsafe-prompt block is shown on the Stage card, so don't ALSO
  // repeat it in the form error line.
  const isUnsafeBlock = !!(actionData && "unsafe" in actionData && (actionData as { unsafe?: boolean }).unsafe);
  const err = actionData && "error" in actionData && !(casual && isUnsafeBlock) ? (actionData.error as string) : null;
  // A product ad with no product photo is just AI art from the title — the
  // pipeline happily renders it and the merchant pays for slop. Require a
  // photo (upload OR url) for anything that should SHOW the product; services
  // legitimately have nothing to photograph.
  // "Make an image" generates from text — no photo required. Casual (Creator)
  // VIDEO is the same deal: a "describe anything, no photo" text-to-video
  // generator, so a photo is optional there too (add one to feature a real
  // product; without one we create the whole thing from the words).
  const needsPhoto = tab !== "blog" && tab !== "music" && tab !== "faceless" && !serviceOn && !isCreate && !(casual && tab === "video")
    // Casual uses its own photo flow (no source chooser); marketing must have a
    // product that actually matches its mounted source input.
    && (casual ? (!hasFile && !imageUrl.trim()) : !hasMarketingProduct);
  // THE WALLET IS PART OF WHETHER THE BUTTON WORKS. Every other precondition
  // (title, photo, presenter, cartoon style) disabled the button; the one that
  // bites a brand-new trialist first did not. A Studio trial spends from a
  // 400-token ceiling, and "×3" on a Veo pick is 675 — the button read
  // "Generate 3 videos — 675 tokens" directly above "Wallet: 400 tokens" and
  // was live. The server refused it, correctly, so no money moved — but the
  // very first thing many merchants would try answered with an error instead
  // of the number they were short by and where to get it.
  // A video edit is always a single flat-cost op — never multiplied by the
  // image/video burst that may be left over from a prior session.
  const effBurst = isVideoEdit || (casual && tab === "video") ? 1 : burst;
  const shortBy = d.hasPlan ? Math.max(0, cost * effBurst - d.tokens) : 0;
  // Casual video is describe-first (no name field): it needs a description, not
  // a productTitle — same as create/music/faceless. (A loaded video to EDIT is
  // its own flow — no description required; see casualVideoMake below.)
  const casualVideo = casual && tab === "video";
  // The describe->make video path specifically (a video loaded to edit is NOT it).
  const casualVideoMake = casualVideo && !isVideoEdit;
  // A Captions edit needs text to burn in; trim/speed validate ranges server-side.
  const videoEditReady = isVideoEdit && (videoEditOp !== "caption" || !!videoCaption.trim());
  const ctaDisabled = busy || !d.hasPlan || combining || (!isEdit && !isCreate && !isMusic && !isFaceless && !casualVideo && !productTitle.trim()) || needsPhoto || (needsPresenter && !avatarId) || (tab === "video" && (contentType === "cartoon" || contentType === "avatar") && !styleSet) || (isEdit && !editOp && !direction.trim()) || (isEdit && editOp === "replace" && !direction.trim()) || (isCreate && !direction.trim()) || (isMusic && !direction.trim()) || (isFaceless && !direction.trim()) || (casualVideoMake && !direction.trim()) || (isVideoEdit && !videoEditReady) || shortBy > 0;

  return (
    <div className={casual ? "ws-casual" : "ws-mkt"}>
      <style dangerouslySetInnerHTML={{ __html: WS_STYLE }} />
      <h1 className="wb-h1">{casual ? t("Create") : t("Social Marketing")}</h1>
      <p className="wb-sub">
        {casual
          ? <>{t("Upload a photo to edit, or make an image or video to share — it lands in your ")}<Link to="/web/archive?section=creator">{t("gallery")}</Link>.</>
          : <>{t("Make one piece by hand, in your voice — it lands in your ")}<Link to="/web/archive">{t("Archive")}</Link>.</>}
      </p>
      {/* Create ↔ Social switch — the in-Studio mode toggle (replaces the retired
          global header toggle). "Social media" flips the Studio to the marketing
          creation tools; it's gated on a marketing plan (autopost = Starter+), so
          Creator ($6.99) / free users see it locked with an upgrade prompt. */}
      <div className="ws-modeswitch" role="group" aria-label={t("What are you making?")}>
        <button type="button" className={`ws-ms-opt${casual ? " on" : ""}`} aria-pressed={casual}
          onClick={() => { setMode("casual"); setContentType(null); setImageMode(null); setUpsell(null); setSocialLockOpen(false); }}>
          <Ico n="palette" size={15} />{t("Create")}
        </button>
        <button type="button" className={`ws-ms-opt${!casual ? " on" : ""}${socialUnlocked ? "" : " locked"}`} aria-pressed={!casual}
          onClick={() => (socialUnlocked ? (setMode("marketing"), setContentType(null), setImageMode(null), setUpsell(null), setSocialLockOpen(false)) : setSocialLockOpen(true))}
          title={socialUnlocked ? t("Make for social — product ads, spokesperson videos & auto-posting") : t("A Starter feature — upgrade to switch into Social Marketing mode")}>
          <Ico n={socialUnlocked ? "trend" : "lock"} size={15} />{t("Social Marketing")}
          {!socialUnlocked && <span className="ws-ms-badge">{t("Starter")}</span>}
        </button>
      </div>
      {/* Plain-English guidance for the Create vs Social choice — always visible
          (the only explanation used to be a hover-only title tooltip) and it names
          the cost gap, which was invisible until the make step. */}
      <p className="ws-ms-hint">
        <b>{t("Create")}</b>{t(" — images, video & music just for you. ")}<b>{t("Social Marketing")}</b>{t(" — product ads that auto-post to TikTok, IG & FB.")}
      </p>
      {socialLockOpen && !socialUnlocked && (
        <div className="ws-upsell ws-ms-upsell">
          <b><Ico n="lock" size={15} /> {t("Social Marketing is a Starter feature")}</b>
          <p>{t("Upgrade to Starter ($19/mo) to switch into Social Marketing mode — product ads, spokesperson videos & auto-posting. Everything you already make comes along.")}</p>
          <div><Link to="/web#plans" className="wb-btn" style={{ padding: "9px 20px", fontSize: 13 }}>{t("See plans")}</Link>
            <button type="button" className="wb-btn ghost" style={{ padding: "9px 16px", fontSize: 13, marginLeft: 8 }} onClick={() => setSocialLockOpen(false)}>{t("Not now")}</button></div>
        </div>
      )}
      {!d.hasBrand && !casual && <div className="wb-err">{t("Set your ")}<Link to="/web">{t("brand voice")}</Link>{t(" first so content sounds like you.")}</div>}
      {!d.hasPlan && <div className="wb-err">{t("Pick a ")}<Link to="/web">{t("plan")}</Link>{t(" first — content runs on tokens.")}</div>}
      {/* Top banner too — a failure must be visible even when the config
          section that holds the inline error is collapsed or scrolled away. */}
      {err && <div className="wb-err">{t("Couldn’t generate: {err}", { err })}</div>}

      {/* THE EASEL (casual) — a left instrument rail + controls beside a Stage,
          with a creations shelf below. Marketing is untouched: its wrappers are
          display:contents (.ws-flow), so tabs + Form render in the old flow. */}
      {/* Persistent "you are here" — mode + what you're making. Sticky so it
          never scrolls away mid-config (the title + mode toggle do), which is
          exactly how a tester ended up deep in Social Marketing not knowing it. */}
      <div className="ws-crumb" aria-label={t("Where you are")}>
        <span className={`ws-crumb-mode${casual ? "" : " mk"}`}><Ico n={casual ? "palette" : "trend"} size={13} /> {casual ? t("Create") : t("Social Marketing")}</span>
        {(() => {
          const what = tab === "music" ? t("Music") : tab === "faceless" ? t("Faceless video") : tab === "import" ? t("Your store")
            : tab === "image" ? (casual ? (imageMode === "product" ? t("Edit a photo") : t("Make an image")) : (imageMode === "presenter" ? t("With a presenter") : imageMode === "product" ? t("Product ad") : imageMode === "create" ? t("Make an image") : null))
            : (casual ? t("Video") : (contentType ? t(CONTENT_TYPES.find((c) => c.key === baseOf(contentType))?.name || "Video") : null));
          return what ? <><span className="ws-crumb-sep" aria-hidden="true">›</span><span className="ws-crumb-what">{what}</span></> : null;
        })()}
      </div>
      <div className={casual ? "ws-easel" : "ws-flow"}>
       <div className={casual ? "ws-easel-left" : "ws-flow"}>
      <div className="ws-tabs">
        {/* Casual drops Article (every blog angle is sell-coded) and Import (a
            store-catalogue concept) — it's about making & editing, not merchandising. */}
        {((casual ? [["video", "Video"], ["image", "Image"], ["music", "Music"], ["faceless", "Faceless video"]] : [["video", "Video"], ["image", "Image"], ["import", "Import your store"]]) as [Tab, string][]).map(([k, label]) => (
          <button type="button" key={k} className={`ws-tab${tab === k ? " on" : ""}`} onClick={() => { setTab(k); setUpsell(null); }}>
            <TabIcon kind={k} />{t(label)}
          </button>
        ))}
      </div>

      <Form ref={formRef} method="post" encType="multipart/form-data" className="wb-card ws-card" onSubmit={onFormSubmit}
        onKeyDown={(e) => {
          // Enter in a single-line field must NOT submit the form — that fired a
          // paid generation from the product-name box on mobile. Only the
          // Generate button generates. Textareas (direction/describe) keep Enter
          // for newlines; this guard only catches <input> elements.
          if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
        }}>
        {/* ---- IMPORT: the setup tab. Bring the whole store in, and forge
             a presenter from your own logo or mascot. Both are queued jobs,
             so this tab is about kicking them off and watching them land. ---- */}
        {tab === "import" && (
          <div className="ws-import-tab">
            <div className="ws-lbl">{t("Bring your store in")}</div>
            {d.catalog.length > 0 ? (
              <p className="ws-offernote">
                <b>{d.catalogCount === 1 ? t("{n} product", { n: d.catalogCount }) : t("{n} products", { n: d.catalogCount })}</b>{" "}{t("imported.")}
                {d.catalogTruncated ? " " + t("That’s our maximum for a single import, so if your store has more they aren’t here yet.") : ""}{" "}
                {t("Pick one from the grid whenever you make something — no more hunting down links. Re-run this any time your catalogue changes.")}
              </p>
            ) : (
              <p className="ws-offernote">
                {t("Paste your store address once and we pull your products in — photos, titles and links. After that you choose from a grid instead of pasting a link every time, and the product page rides along to the post so shoppers land on the buy page.")}
              </p>
            )}
            <div className="ws-import">
              <input className="wb-in" type="url" value={storeInput} placeholder="yourstore.com"
                onChange={(e) => setStoreInput(e.target.value)} />
              <button type="button" className="wb-btn" disabled={busy || d.catalogSyncing || !storeInput.trim()}
                onClick={() => submit({ intent: "importCatalog", storeUrl: storeInput.trim() }, { method: "post" })}>
                {d.catalog.length > 0 ? t("Re-import") : t("Pull my products in")}
              </button>
            </div>
            {actionData && "catalogError" in actionData && actionData.catalogError
              ? <div className="wb-err">{String(actionData.catalogError)}</div> : null}
            {actionData && "catalogQueued" in actionData && actionData.catalogQueued
              ? <p className="ws-offernote">{t("Import queued — your products will appear here shortly.")}</p> : null}
            {d.catalogSyncing && <CatalogSync startedAt={d.catalogSyncStartedAt} />}
            {!d.catalogSyncing && d.catalogFailed && (
              <div className="wb-err" style={{ marginTop: 10 }}>
                <b>{t("That import didn’t work.")}</b> {d.catalogFailed}
              </div>
            )}

            <div className="ws-lbl" style={{ marginTop: 26 }}>
              <span>{t("Turn your brand mascot into a marketing tool")}</span>
            </div>
            <p className="ws-offernote">
              {t("Upload your logo, mascot or spokesperson and we forge them into a presenter — four outfits, ready to star in your videos. Yours alone: nobody else’s Studio can cast them.")}
            </p>
            <div className="ws-import ws-avatarforge">
              <input className="wb-in" name="avatarName" placeholder={t("Presenter name (e.g. your mascot)")}
                value={avatarName} onChange={(e) => setAvatarName(e.target.value)} />
              <input className="wb-in" type="file" accept="image/*"
                onChange={(e) => setAvatarFile(e.target.files?.[0] || null)} />
              <button type="button" className="wb-btn" disabled={busy || !avatarName.trim() || !avatarFile}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("intent", "forgeAvatar");
                  fd.set("avatarName", avatarName.trim());
                  fd.set("avatarGender", avatarGender);
                  if (avatarFile) fd.set("avatarPhoto", avatarFile);
                  submit(fd, { method: "post", encType: "multipart/form-data" });
                }}>
                {t("Forge my presenter")}
              </button>
            </div>
            <div className="ws-seg" style={{ marginTop: 10 }}>
              {([["m", "He"], ["f", "She"]] as [string, string][]).map(([g, label]) => (
                <button type="button" key={g} className={avatarGender === g ? "sel" : ""}
                  onClick={() => setAvatarGender(g)}>{t(label)}</button>
              ))}
            </div>
            {actionData && "avatarError" in actionData && actionData.avatarError
              ? <div className="wb-err">{String(actionData.avatarError)}</div> : null}
            {/* The buffer sits at the BOTTOM, under the form, so the moment you
                hit Forge there is something visibly working. */}
            {d.forgingAvatars.map((f) => (
              <ForgingPresenter key={f.name + f.startedAt} name={f.name} status={f.status} startedAt={f.startedAt} />
            ))}
          </div>
        )}

        {/* ---- VIDEO: pick your content type (big live-render tiles) ---- */}
        {tab === "video" && !contentType && !casual && (
          <>
            <div className="ws-lbl">{t("Pick your content type")}</div>
            <div className="ws-tiles ws-ctgrid ws-scrollbox">
              {CONTENT_TYPES.filter((ct) => !casual
                // Casual = Creator: drop the presenter/ad formats (avatar,
                // Creator Demo, unboxing = a person on camera; jingle = a song,
                // which lives in the Music tab; commercial = an ad). Keep the
                // ones a creator makes from an idea or a photo: a cartoon, a
                // cinematic showcase, and satisfying macro loops.
                // Cartoon removed from the Social Marketing picker — it now lives
                // inside the Avatar AI hub's style card (Realistic ↔ cartoon), so a
                // separate card is redundant. (Creator keeps its cartoon tile.)
                ? ct.key !== "cartoon"
                : (ct.key === "cartoon" || ct.key === "highlight"))
                // Flagships lead so they fill the top row (they span 2 columns).
                .sort((a, b) => (casual ? 0 : (FLAGSHIP_KEYS.has(b.key) ? 1 : 0) - (FLAGSHIP_KEYS.has(a.key) ? 1 : 0)))
                .map((ct) => {
                // Casual (Creator) video is the cheap token-metered path — gate it
                // on "creatorvideo" (included wherever the Creator section is) and
                // upsell to Creator, not the marketing video/cartoon caps + Studio.
                const tileCap = casual ? "creatorvideo" : ct.cap;
                const tileTier = casual ? "Creator" : ct.tier;
                const tilePrice = casual ? CREATOR_PRICE : ct.price;
                const tileName = casual && CASUAL_VIDEO_COPY[ct.key] ? CASUAL_VIDEO_COPY[ct.key].name : ct.name;
                const locked = !can(tileCap);
                return (
                  <button type="button" key={ct.key} className={`ws-tile${locked ? " lockd" : ""}${!casual && FLAGSHIP_KEYS.has(ct.key) ? " ws-tile-flag" : ""}`}
                    onClick={() => (locked ? setUpsell({ name: tileName, tier: tileTier, price: tilePrice }) : (setContentType(ct.key), setUpsell(null)))}>
                    <span className={`ws-tile-img${casual && CASUAL_VIDEO_COPY[ct.key] ? " ws-tile-casual" : ""}`}
                      style={casual && CASUAL_VIDEO_COPY[ct.key] ? undefined : { backgroundImage: `url(${ct.cover})` }}>
                      {casual && CASUAL_VIDEO_COPY[ct.key] ? <span className="ws-tile-emoji" aria-hidden="true"><Ico n={CASUAL_VIDEO_COPY[ct.key].icon} size={32} /></span> : null}
                      {locked && <span className="ws-lock"><Ico n="lock" size={13} /> {tileTier}</span>}
                    </span>
                    <b>{casual && CASUAL_VIDEO_COPY[ct.key] ? t(CASUAL_VIDEO_COPY[ct.key].name) : t(ct.name)}</b>
                    {/* The description, always. With no plan every tile is
                        locked, so this line used to replace all eight
                        explanations with “Unlock with Studio” — a merchant
                        deciding whether to pay could not find out what Anthem,
                        Unboxing or Satisfying Close-Up even were. The lock is
                        already said twice over by the badge and the tile
                        styling, and tapping one opens the panel that names the
                        tier and the price. */}
                    <span className="ws-tile-sub">{casual && CASUAL_VIDEO_COPY[ct.key] ? t(CASUAL_VIDEO_COPY[ct.key].sub) : t(ct.sub)}</span>
                  </button>
                );
              })}
            </div>
            {upsell && (
              <div className="ws-upsell">
                <b><Ico n="lock" size={15} /> {t("{name} is a {tier} feature", { name: upsell.name, tier: upsell.tier })}</b>
                <p>{t("Upgrade to {tier} (${price}/mo) to unlock it — everything you already have comes along.", { tier: upsell.tier, price: upsell.price })}</p>
                <div><Link to="/web" className="wb-btn" style={{ padding: "9px 20px", fontSize: 13 }}>{t("See plans")}</Link>
                  <button type="button" className="wb-btn ghost" style={{ padding: "9px 16px", fontSize: 13, marginLeft: 8 }} onClick={() => setUpsell(null)}>{t("Not now")}</button></div>
              </div>
            )}
          </>
        )}
        {tab === "video" && contentType && (
          <>
            {!casual && <button type="button" className="ws-back" onClick={() => setContentType(null)}>‹ {t("Content type")}</button>}
            {/* Avatar video folds step 1 away — its only control (Commercial look)
                moves into the scene hub, which then becomes step 1. */}
            {!avatarVideoHub && !isVideoEdit && <StepHead n={1} title={casual ? t("Set the look") : t("Pick the look")} hint={casual ? t("the style, and what it's about") : t("who stars in it, and how it's shot")} />}
            {/* Real content type always rides along — the pipelines route on it
                and videoCapabilityFor() gates avatar/highlight as plain "video". */}
            <input type="hidden" name="contentType" value={contentType} />
            {contentType === "jingle" && (
              <p className="ws-note"><Ico n="music" /> <b>Anthem</b>{t(" — we write your product an earworm: the iconic, stuck-in-your-head jingle of a 2000s commercial, and your presenter ")}<i>{t("sings it on camera")}</i>{t(", lipsynced. Pick your singer first — photoreal, or redrawn in a cartoon style below. No singer = the song plays over a cinematic product shot.")}</p>
            )}
            {/* Presenter FIRST — the style tiles below render as the chosen
              * presenter, so picking them in this order explains the art.
              * CREATOR (casual) has NO presenter: a spokesperson/avatar is a
              * marketing concept (a person selling your product). A casual
              * "Cartoon" still shows the style grid below, but it animates the
              * described idea, not a presenter. */}
            {/* Avatar-video folds the presenter picker into the hub (step 2); it
                stays here for cartoon/jingle style grids. */}
            {/* Cartoon/jingle show the character picker in BOTH Marketing AND
                Creator (casual): the style tiles literally show a character and
                the copy promises "your chosen presenter", so there MUST be a way
                to pick/change them — otherwise it "prompts an avatar with no
                picker" (owner bug). Creator stays presenter-less for the OTHER
                formats (avatar-video is marketing-only, gated by !casual). */}
            {!avatarVideoHub && (showCartoonGrid || (!casual && baseOf(contentType) === "avatar")) && <Presenters cast={d.cast} avatarId={avatarId} setAvatarId={setAvatarId} optional={baseOf(contentType) !== "avatar"} brandFaceId={d.brandFaceId} onCreateOwn={() => setForgeOpen(true)} onManage={() => setManageOpen(true)} />}
            {contentType === "cartoon" && !avatarId && <p className="ws-note">{casual ? t("No presenter? We'll animate a fun scene in the picked style from your idea.") : t("No presenter? We'll animate a fun scene in the picked style, then close on your real product.")}</p>}
            {contentType === "jingle" && !avatarId && <p className="ws-note">{t("No singer picked — the anthem plays over a hero shot of your product instead.")}</p>}
            {/* Cartoon's style picker moved INTO the scene hub (the center card);
                only jingle (and the rare non-hub cartoon/service) keeps it up top. */}
            {showCartoonGrid && !(avatarVideoHub && contentType === "cartoon") && (
              <>
                <div className="ws-lbl">{contentType === "jingle" ? t("Singer style") : t("Pick a cartoon avatar style")} <span className="ws-opt">{contentType === "jingle" ? t("previews show your chosen singer") : t("sample looks — your presenter stars in yours")}</span></div>
                <div className="ws-tiles styles ws-stylestrip">
                  {contentType === "jingle" && (
                    <button type="button" className={`ws-tile small${cartoonStyle === null ? " sel" : ""}`}
                      onClick={() => setCartoonStyle(null)}>
                      <span className="ws-tile-img" style={{ backgroundImage: `url(${d.cast.find((c) => c.id === styleChar)?.img || ""})` }}>{cartoonStyle === null && <span className="ws-chk">✓</span>}</span>
                      <b><Ico n="camera" /> {t("Photoreal")}</b>
                    </button>
                  )}
                  {CARTOON_STYLES.map((cs) => (
                    <button type="button" key={cs.key} className={`ws-tile small${cartoonStyle === cs.key ? " sel" : ""}`}
                      onClick={() => setCartoonStyle(cs.key)}>
                      <span className="ws-tile-img" style={{ backgroundImage: `url(${styleCover(cs.key)})`, backgroundColor: cs.tint }}>{cartoonStyle === cs.key && <span className="ws-chk">✓</span>}</span>
                      <b>{t(cs.name)}</b>
                    </button>
                  ))}
                </div>
                {contentType === "cartoon" && (cartoonStyle ? (
                  <p className="ws-note"><Ico n="palette" /> <b>{t(CARTOON_STYLES.find((c) => c.key === cartoonStyle)?.name || "")}</b>{t(" — ")}{t(CARTOON_STYLES.find((c) => c.key === cartoonStyle)?.blurb || "")}{casual ? (avatarId ? t(". Your character gets redrawn in this style and animated with a narrator.") : t(". We animate a scene in this style with a narrator.")) : (avatarId ? t(". Your presenter gets redrawn in this style holding your product, with a narrator — then your real product closes it, sharp.") : t(". We animate a scene in this style with a narrator — then your real product closes it, sharp (never cartoonized)."))}</p>
                ) : (
                  <p className="ws-note">{casual ? (avatarId ? t("Pick the style — your character stars in it.") : t("Pick the style — we animate a scene in it.")) : (avatarId ? t("Pick the style — your presenter becomes the character and shows off your product in it, then your real product closes it, sharp.") : t("Pick the style — we animate a scene in it. Your real product appears at the end, sharp (never cartoonized)."))}</p>
                ))}
                {cartoonStyle && <input type="hidden" name="cartoonStyle" value={cartoonStyle} />}
              </>
            )}
            {contentType === "highlight" && !isVideoEdit && <p className="ws-note"><Ico n="video" /> <b>{casual ? t("Showcase") : t("Product Highlight")}</b>{" — "}{casual ? t("cinematic motion from your idea or a photo.") : t("cinematic motion built around your product. No presenter needed.")}</p>}
            {contentType === "commercial" && <p className="ws-note"><Ico n="film" /> <b>{t("Commercial")}</b>{t(" — a multi-scene cinematic story ad that ends on your product, like a big-budget TV spot. No presenter needed; give direction below to steer the story.")}</p>}
            {contentType === "review" && <p className="ws-note"><Ico n="camera" /> <b>{t("Creator Demo")}</b>{t(" — your presenter demos the product like a creator would: phone-shot, casual, straight to camera. Organic UGC energy without faking a customer review.")}</p>}
            {contentType === "asmr" && <p className="ws-note"><Ico n="wave" /> <b>{t("Satisfying Close-Up")}</b>{t(" — extreme macro, slow luxurious motion, textures and light. No presenter — just the loop nobody scrolls past.")}</p>}
            {avatarId && needsPresenterField(contentType) && <input type="hidden" name="avatarId" value={avatarId} />}
            {!casual && !avatarVideoHub && (contentType === "avatar" || contentType === "highlight") && (
              <label className="ws-commercial">
                <input type="checkbox" name="commercial" value="1" checked={commercial}
                  onChange={(e) => { setCommercial(e.target.checked); if (e.target.checked) setBreakout(false); }} />
                <span><b><Ico n="video" /> {t("Commercial look")}</b>{t(" — big-budget studio spot: color-block set matched to your product, hero-lit")}</span>
              </label>
            )}
            {contentType === "highlight" && !isVideoEdit && (
              <label className="ws-commercial">
                <input type="checkbox" name="breakout" value="1" checked={breakout}
                  onChange={(e) => { setBreakout(e.target.checked); if (e.target.checked) setCommercial(false); }} />
                <span><b><Ico n="burst" /> {t("Breakout")}</b>{" — "}{casual ? t("your subject bursts out of the frame in 3D — the scroll-stopper") : t("your product bursts out of a social post frame in 3D, the scroll-stopper")}</span>
              </label>
            )}
            {/* The engine picker only MATTERS when it applies — presenter/lip-sync
                ads and commercials ignore it, so showing 8 greyed-out engines + a
                "doesn't apply" note was pure chore. Hidden there; the videoEngine
                value still rides along for the pipeline. */}
            {engineApplies && !isVideoEdit && (casual ? (
              /* Creator video: just Pro vs Ultra (owner call) — the 8-engine menu
                 is for Social Marketing. Pro = Auto (Kling 3 Pro, included); Ultra
                 = Veo 3.1 Fast (the margin-safe premium per video-engines.ts). The
                 videoEngine value still rides the hidden input + server fallback. */
              <>
                <div className="ws-lbl">{t("Quality")} <span className="ws-opt">{t("Ultra adds tokens")}</span></div>
                <div className="ws-models" role="radiogroup" aria-label={t("Video quality")}>
                  <button type="button" role="radio" aria-checked={videoEngine !== "veo31"}
                    className={`ws-model${videoEngine !== "veo31" ? " sel" : ""}`} onClick={() => setVideoEngine("auto")}>
                    {t("Pro")}
                  </button>
                  <button type="button" role="radio" aria-checked={videoEngine === "veo31"}
                    className={`ws-model${videoEngine === "veo31" ? " sel" : ""}`} onClick={() => setVideoEngine("veo31")}>
                    {t("Ultra")}<span className="ws-model-up">+{engineSurcharge("veo31") * CREATOR_SURCHARGE_MULT}</span>
                  </button>
                </div>
                <p className="ws-note" style={{ marginTop: 6 }}>{videoEngine === "veo31" ? t("Ultra — Google Veo, premium cinematic realism. Adds tokens.") : t("Pro — Kling 3 Pro: top motion & product fidelity. Included.")}</p>
              </>
            ) : (
              <>
                <div className="ws-lbl">{t("Video engine")} <span className="ws-opt">{t("premium engines add tokens")}</span></div>
                <div className="ws-engines">
                  {VIDEO_ENGINES.map((e) => (
                    <button type="button" key={e.key} className={`ws-engine${videoEngine === e.key ? " sel" : ""}`} title={t(e.blurb)} onClick={() => setVideoEngine(e.key)}>
                      <b>{t(e.name)}</b><span>{e.surcharge > 0 ? `+${e.surcharge * (casual ? CREATOR_SURCHARGE_MULT : 1)}` : t("included")}</span>
                    </button>
                  ))}
                </div>
              </>
            ))}
            <input type="hidden" name="videoEngine" value={videoEngine} />
          </>
        )}

        {/* ---- IMAGE: product-ad templates or presenter-holding ---- */}
        {tab === "image" && !imageMode && !casual && (
          <>
            <div className="ws-lbl">{t("What kind of image ad?")}</div>
            <div className={`ws-tiles${casual ? "" : " two"}`}>
              {casual && (
                <button type="button" className="ws-tile" onClick={() => setImageMode("create")}>
                  <span className="ws-tile-img" style={{ backgroundImage: "url(/create/make-image.svg?v=1)", backgroundPosition: "center" }} />
                  <b>{t("Make an image")}</b><span className="ws-tile-sub">{t("Type anything — pick an art style, generate")}</span>
                </button>
              )}
              <button type="button" className="ws-tile" onClick={() => setImageMode("product")}>
                <span className="ws-tile-img" style={{ backgroundImage: casual ? "url(/create/edit-photo.svg?v=1)" : "url(/ad-templates/format-offer.jpg?v=2)", ...(casual ? { backgroundPosition: "center" } : null) }} />
                <b>{casual ? t("Edit a photo") : t("Product ad")}</b><span className="ws-tile-sub">{casual ? t("Restyle, cartoonize, change the background") : t("Your product in a famous ad format")}</span>
              </button>
              {/* "With presenter" is a marketing concept (brand mascot/spokesperson
                  selling a product) — never in casual, where there's no product to hold. */}
              {!casual && (
                <button type="button" className="ws-tile" onClick={() => setImageMode("presenter")}>
                  <span className="ws-tile-img" style={{ backgroundImage: "url(/style-tiles/avatarcover.jpg?v=4)" }} />
                  <b>{t("With presenter")}</b><span className="ws-tile-sub">{t("A presenter holds it, poster copy on top")}</span>
                </button>
              )}
            </div>
          </>
        )}
        {tab === "image" && imageMode && (
          <>
            {/* Casual "create" is the default landing and leads straight with
                the describe box sitting right under the Stage: no "Image type"
                back link (the Stage itself is the upload/edit entry) and no
                separate style header up here — the optional style picker is a
                collapsed disclosure BELOW the box. Every other image mode keeps
                the back link + header. */}
            {!(isCreate && casual) && (
              <button type="button" className="ws-back" onClick={() => { if (casual) { setImageMode("create"); setTemplateKey(null); } else { setImageMode(null); setTemplateKey(null); } }}>‹ {casual ? t("Make an image") : t("Image type")}</button>
            )}
            {!((isCreate || isEdit) && casual) && (
              <StepHead n={1} title={isCreate ? t("Pick a style") : t("Pick the look")} hint={isCreate ? t("optional — pick a look, or skip for a natural photo") : casual ? t("how your image is styled") : t("the structure your ad is built on")} />
            )}
            {/* Casual photo-edit quick actions moved BELOW the describe box as a
                collapsed disclosure (see the {isEdit && casual} block), so the
                edit flow leads with the box — same clean shape as "Make an image". */}
            {imageMode === "product" && !service && !casual && (
              <>
                <div className="ws-lbl">{t("Ad format")} <span className="ws-opt">{t("proven structures, not filters")}</span></div>
                <div className="ws-fmtcats" role="radiogroup" aria-label={t("Ad format categories")}>
                  {FORMAT_GROUPS.map((g) => (
                    <button type="button" key={g.key} role="radio" aria-checked={fmtGroup === g.key}
                      className={`ws-fmtcat${fmtGroup === g.key ? " sel" : ""}`} title={t(g.blurb)}
                      onClick={() => setFmtGroup(g.key)}>
                      <span aria-hidden="true">{g.emoji}</span> {t(g.name)}
                    </button>
                  ))}
                  <button type="button" role="radio" aria-checked={fmtGroup === "all"}
                    className={`ws-fmtcat${fmtGroup === "all" ? " sel" : ""}`} title={t("Every format")}
                    onClick={() => setFmtGroup("all")}>{t("All {n}", { n: AD_FORMATS.length })}</button>
                </div>
                {/* What's armed, shown above the tiles so a selection made in one
                    category isn't invisible while browsing another — otherwise a
                    merchant could generate "Callouts" while looking at an empty-
                    looking Offers tab. */}
                {formatKey && AD_FORMAT_BY_KEY[formatKey] && (
                  <p className="ws-fmtsel">
                    {t("Selected:")} <b>{t(AD_FORMAT_BY_KEY[formatKey].name)}</b>
                    <button type="button" onClick={() => setFormatKey(null)} aria-label={t("Clear {name}", { name: AD_FORMAT_BY_KEY[formatKey].name })}>✕</button>
                  </p>
                )}
                {(() => {
                  const grp = FORMAT_GROUPS.find((g) => g.key === fmtGroup);
                  const scroll = fmtGroup === "all";
                  const shown: AdFormat[] = scroll || !grp
                    ? AD_FORMATS
                    : grp.formats.map((k) => AD_FORMAT_BY_KEY[k]).filter((f): f is AdFormat => !!f && !f.retired);
                  return (
                    <>
                      {grp && grp.key !== "popular" && <p className="ws-fmthint">{t(grp.blurb)}</p>}
                      <div className={`ws-tiles fmt${scroll ? " ws-fmtbox" : ""}`}>
                        {shown.map((f, i) => (
                          <button type="button" key={f.key} className={`ws-tile fmt${formatKey === f.key ? " sel" : ""}`} title={t(f.blurb)}
                            style={scroll ? { animationDelay: `${Math.min(i * 22, 550)}ms` } : undefined}
                            onClick={() => { setFormatKey(formatKey === f.key ? null : f.key); setTemplateKey(null); }}>
                            <span className="ws-tile-img" style={{ backgroundImage: `url(/ad-templates/format-${f.key}.jpg?v=2)` }}>{formatKey === f.key && <span className="ws-chk">✓</span>}</span>
                            <b>{t(f.name)}</b>
                          </button>
                        ))}
                      </div>
                    </>
                  );
                })()}
                <p className="ws-note">{t("Each format is a different creative ")}<b>{t("structure")}</b>{t(" — copy is written fresh for your product, the layout is built around your real photo, and a vision check rejects garbled text before you ever see it.")}</p>
                {formatKey && <input type="hidden" name="formatKey" value={formatKey} />}
                <details>
                  <summary className="ws-lbl" style={{ cursor: "pointer" }}>{t("Backdrop scenes (classic)")}{templateKey ? t(" · 1 selected") : ""}</summary>
                  <div className="ws-tiles styles ws-scrollbox">
                    {d.templates.map((tpl) => (
                      <button type="button" key={tpl.key} className={`ws-tile small${templateKey === tpl.key ? " sel" : ""}`} title={t(tpl.blurb)}
                        onClick={() => { setTemplateKey(templateKey === tpl.key ? null : tpl.key); setFormatKey(null); }}>
                        <span className="ws-tile-img" style={{ backgroundImage: `url(/ad-templates/preview-${tpl.key}.jpg?v=10)` }}>{templateKey === tpl.key && <span className="ws-chk">✓</span>}</span>
                        <b>{t(tpl.name)}</b>
                        <span className="ws-tile-sub">{tpl.kind === "exact" ? t("Exact match — your product, this scene") : t("AI-staged to match")}</span>
                      </button>
                    ))}
                  </div>
                </details>
                {templateKey && <input type="hidden" name="templateKey" value={templateKey} />}
              </>
            )}
            {imageMode === "presenter" && (
              <>
                <Presenters cast={d.cast} avatarId={avatarId} setAvatarId={setAvatarId} brandFaceId={d.brandFaceId} onCreateOwn={() => setForgeOpen(true)} onManage={() => setManageOpen(true)} />
                {avatarId && <p className="ws-note">{casual ? t("The character will hold your subject in the shot — add a photo below.") : t("The presenter will hold your product in the shot — add a product photo below.")}</p>}
                {avatarId && <input type="hidden" name="avatarId" value={avatarId} />}
              </>
            )}
          </>
        )}

        {/* Outfit rotation + Brand Face crowning, wherever a presenter stars.
            For the avatar-video hub this moves UNDER the presenter tile (it
            referenced a presenter chosen elsewhere on the page), so it's gated
            out here and re-rendered inside the hub. */}
        {!avatarVideoHub && ((tab === "video" && baseOf(contentType) === "avatar") || (tab === "image" && imageMode === "presenter")) && avatarId && (
          <>
            <p className="ws-note">{casual ? t("Their outfit changes each time, so every shot looks a little different.") : t("Their outfit rotates each time, so your content never looks stale.")}</p>
            {!casual && avatarId !== d.brandFaceId && (
              <button type="button" className="ws-setbf" onClick={() => submit({ intent: "setBrandFace", avatarId }, { method: "post" })}>
                <Ico n="star" size={13} /> {t("Make {name} your Brand Face", { name: d.cast.find((c) => c.id === avatarId)?.name || t("this presenter") })}
              </button>
            )}
          </>
        )}

        {/* ---- Shared product fields + CTA ---- */}
        {cfgReady && (
          <>
            {/* "Make an image" and "Make music" generate from text — they need
                no subject/photo, so the whole step-2 block is skipped for them. */}
            {!isCreate && !isMusic && !isFaceless && !(isEdit && casual) && !(casual && tab === "video") && (<>
            <StepHead n={avatarVideoHub ? 1 : 2} title={avatarVideoHub ? t("Your scene") : casual ? (tab === "video" ? t("Describe your video") : t("Your subject")) : t("Your product")} hint={avatarVideoHub ? t("your presenter, holding your product") : casual ? (tab === "video" ? t("anything you like — no photo needed") : t("what this is about")) : t("what we're actually selling")} />

            {/* ======================================================================
                AVATAR-VIDEO COMBINE PANEL — ONE immersive flow (owner-requested).
                The presenter + product tiles ARE the combine's slots; you upload
                or pick the product RIGHT HERE (in the panel), size it, and the
                combined output + Combine button sit directly below — no separate
                chooser you then scroll past to reach the combine. Only the
                avatar-VIDEO flow uses this; every other mode keeps the classic
                layout (gated !avatarVideoHub) below, byte-for-byte unchanged.
                ====================================================================== */}
            {avatarVideoHub && (
              <div className={`ws-combine ws-scene${combining ? " combining" : ""}${combineUrl ? " done" : ""}`}>
                {/* Ingredients = two tap-tiles; tap to pick/upload inline. */}
                <div className="ws-hubtiles" role="group" aria-label={t("Your presenter and product")}>
                  {/* The hero is a DIV (its image holds the intro video + sound
                      toggle, which can't nest in a button), so the whole tile gets
                      an onClick — otherwise tapping the NAME/"Tap to change" label
                      below the image did nothing (owner). The inner face/sound
                      buttons stopPropagation so they don't double-toggle. */}
                  <div className={`ws-hubtile ws-hubhero${hubPick === "presenter" ? " open" : ""}${avatarThumb ? " set ws-isgood" : ""}`}
                    onClick={() => setHubPick((p) => (p === "presenter" ? null : "presenter"))}>
                    <span className="ws-hubtile-img" style={!heroDesigned && avatarThumb ? { backgroundImage: `url(${avatarThumb})` } : undefined}>
                      {heroDesigned && (
                        <video ref={heroVidRef} className="ws-hubtile-vid" playsInline loop preload="metadata" poster={`/voice-videos/${avatarId}.jpg?v=2`}
                          onError={(e) => {
                            // A missing intro/poster would otherwise leave a black
                            // tile — hide the dead video and paint the avatar still.
                            const v = e.currentTarget; v.style.display = "none";
                            const img = v.parentElement as HTMLElement | null;
                            if (img && avatarThumb) img.style.backgroundImage = `url(${avatarThumb})`;
                          }} />
                      )}
                      <button type="button" className="ws-hubtile-face" aria-expanded={hubPick === "presenter"}
                        onClick={(e) => { e.stopPropagation(); setHubPick((p) => (p === "presenter" ? null : "presenter")); }}
                        aria-label={avatarId ? t("Change presenter") : t("Pick a presenter")} />
                      {heroDesigned && (
                        <button type="button" className={`ws-hubtile-sound${heroMuted ? "" : " on"}`} onClick={(e) => { e.stopPropagation(); toggleHeroSound(); }}
                          aria-label={heroMuted ? t("Play with sound") : t("Mute")} title={heroMuted ? t("Play with sound") : t("Mute")}>
                          <Ico n="sound" size={15} />
                        </button>
                      )}
                      <span className="ws-hubtile-badge" aria-hidden="true">{avatarThumb ? "✎" : "＋"}</span>
                    </span>
                    <b>{avatarId ? (d.cast.find((c) => c.id === avatarId)?.name || t("Presenter")) : t("Pick a presenter")}</b>
                    <span>{avatarId ? t("Tap to change") : t("Who stars in your video")}</span>
                  </div>
                  <button type="button" className={`ws-hubtile${hubPick === "product" ? " open" : ""}${hasMarketingProduct ? " set ws-isgood" : " ws-needsel"}`}
                    aria-expanded={hubPick === "product"} onClick={() => setHubPick((p) => (p === "product" ? null : "product"))}>
                    <span className="ws-hubtile-img prod" style={hasMarketingProduct && productThumb ? { backgroundImage: `url(${productThumb})` } : undefined}>
                      <span className="ws-hubtile-badge" aria-hidden="true">{hasMarketingProduct && productThumb ? "✎" : "＋"}</span>
                    </span>
                    <b>{hasMarketingProduct ? (productTitle.trim() || t("Your product")) : t("Add your product")}</b>
                    <span>{hasMarketingProduct ? t("Tap to change") : t("What they'll hold")}</span>
                  </button>
                  {/* CENTER STYLE CARD — the picked STYLE, sitting over the gap
                      between presenter + product so it stays visible and attached to
                      the scene. It's the Realistic↔Cartoon switch: "Realistic AI" runs
                      the Avatar-AI pipeline, a cartoon style runs the cartoon pipeline.
                      (Shown for both avatar + cartoon — they're one combine flow now.) */}
                  {(contentType === "avatar" || contentType === "cartoon") && (
                    <div className="ws-stylecombo">
                      <button type="button" className={`ws-stylecard${hubPick === "style" ? " open" : ""}${styleSet ? " ws-isgood" : " ws-needsel"}`}
                        aria-expanded={hubPick === "style"} aria-label={styleSet ? t("Change the style") : t("Pick a style")}
                        onClick={() => setHubPick((p) => (p === "style" ? null : "style"))}>
                        <span className="ws-stylecard-img" style={styleSet ? { backgroundImage: `url(${contentType === "avatar" ? "/style-tiles/avatarcover.jpg?v=4" : styleCover(cartoonStyle || "dreamanime")})` } : undefined}>
                          {!styleSet && <span className="ws-stylecard-ph" aria-hidden="true"><Ico n="palette" size={22} /></span>}
                          <span className="ws-stylecard-badge" aria-hidden="true">{styleSet ? "✎" : "＋"}</span>
                        </span>
                        <b>{!styleSet ? t("Pick a style") : (contentType === "avatar" ? t("Realistic AI") : t(CARTOON_STYLES.find((c) => c.key === cartoonStyle)?.name || "Dream Anime"))}</b>
                        <span>{styleSet ? t("Tap to change") : t("Realistic or cartoon")}</span>
                      </button>
                      {/* "+" connects the look (above) to WHERE it happens (below). */}
                      <span className="ws-stylecombo-plus" aria-hidden="true">+</span>
                      {/* SETTING hero — the picked scene, directly under the style. */}
                      {(() => {
                        const cur = COMBINE_SETTINGS.find((s) => s.key === settingKey) || COMBINE_SETTINGS[0];
                        return (
                          <button type="button" className={`ws-stylecard ws-isgood${hubPick === "setting" ? " open" : ""}`}
                            aria-expanded={hubPick === "setting"} aria-label={t("Change the setting")}
                            onClick={() => setHubPick((p) => (p === "setting" ? null : "setting"))}>
                            <span className="ws-stylecard-img" style={{ backgroundColor: cur.tint, backgroundImage: cur.key !== "auto" ? `url(/style-tiles/${cur.key}.jpg?v=1)` : undefined }}>
                              {cur.key === "auto" && <span className="ws-setemoji" aria-hidden="true">{cur.emoji}</span>}
                              <span className="ws-stylecard-badge" aria-hidden="true">✎</span>
                            </span>
                            <b>{t(cur.name)}</b>
                            <span>{t("The setting")}</span>
                          </button>
                        );
                      })()}
                    </div>
                  )}
                </div>
                {/* Center-card style picker reveal (cartoon) — the 6 styles slide
                    open right under the scene; picking one restyles + collapses. */}
                {(contentType === "avatar" || contentType === "cartoon") && hubPick === "style" && (
                  <div className="ws-hub-reveal open">
                    <div className="ws-tiles styles ws-stylestrip">
                      {/* Realistic AI = the Avatar-AI pipeline (photoreal + lipsync); a
                          cartoon style = the cartoon pipeline. Switching clears any
                          combined frame so a cartoon frame never seeds a realistic video. */}
                      <button type="button" className={`ws-tile small${contentType === "avatar" ? " sel" : ""}`}
                        onClick={() => { if (contentType !== "avatar") clearCombineFrame(); setContentType("avatar"); setCartoonStyle(null); setStyleSet(true); setHubPick(null); }}>
                        <span className="ws-tile-img" style={{ backgroundImage: `url(/style-tiles/avatarcover.jpg?v=4)`, backgroundPosition: "center 22%" }}>{contentType === "avatar" && <span className="ws-chk">✓</span>}</span>
                        <b><Ico n="camera" /> {t("Realistic AI")}</b>
                      </button>
                      {CARTOON_STYLES.map((cs) => (
                        <button type="button" key={cs.key} className={`ws-tile small${contentType === "cartoon" && cartoonStyle === cs.key ? " sel" : ""}`}
                          onClick={() => { if (contentType !== "cartoon" || cartoonStyle !== cs.key) clearCombineFrame(); setContentType("cartoon"); setCartoonStyle(cs.key); setStyleSet(true); setHubPick(null); }}>
                          <span className="ws-tile-img" style={{ backgroundImage: `url(${styleCover(cs.key)})`, backgroundColor: cs.tint }}>{contentType === "cartoon" && cartoonStyle === cs.key && <span className="ws-chk">✓</span>}</span>
                          <b>{t(cs.name)}</b>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {contentType === "cartoon" && cartoonStyle && <input type="hidden" name="cartoonStyle" value={cartoonStyle} />}
                {/* Setting picker reveal — opens from the center setting hero;
                    "Where this takes place" scene cards. */}
                {(contentType === "avatar" || contentType === "cartoon") && hubPick === "setting" && (
                  <div className="ws-hub-reveal open">
                    <div className="ws-lbl"><span>{t("Where this takes place")}</span></div>
                    <div className="ws-setcards">
                      {COMBINE_SETTINGS.map((s) => (
                        <button type="button" key={s.key} className={`ws-setcard${settingKey === s.key ? " sel" : ""}`}
                          onClick={() => { if (settingKey !== s.key) clearCombineFrame(); setSettingKey(s.key); setCombineScene(s.scene); setHubPick(null); }}>
                          <span className="ws-setcard-img" style={{ backgroundColor: s.tint, backgroundImage: s.key !== "auto" ? `url(/style-tiles/${s.key}.jpg?v=1)` : undefined }}>
                            {s.key === "auto" && <span className="ws-setcard-emoji">{s.emoji}</span>}
                            {settingKey === s.key && <span className="ws-chk">✓</span>}
                          </span>
                          <b>{t(s.name)}</b>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Presenter picker reveal — picking selects + plays the intro in
                    the hero above (with sound), and collapses this. */}
                {hubPick === "presenter" && (
                  <div className="ws-hub-reveal open">
                    <Presenters cast={d.cast} avatarId={avatarId} setAvatarId={selectPresenter} brandFaceId={d.brandFaceId} onCreateOwn={() => setForgeOpen(true)} onManage={() => setManageOpen(true)} />
                  </div>
                )}
                {avatarId && avatarId !== d.brandFaceId && (
                  <button type="button" className="ws-setbf" onClick={() => submit({ intent: "setBrandFace", avatarId }, { method: "post" })}>
                    <Ico n="star" size={13} /> {t("Make {name} your Brand Face", { name: d.cast.find((c) => c.id === avatarId)?.name || t("this presenter") })}
                  </button>
                )}
                {/* Product chooser + UPLOAD — lives INSIDE the combine. Always
                    mounted (just hidden) so a store pick keeps submitting. */}
                <div className="ws-hub-reveal" hidden={hubPick !== "product"}>{productChooserUI}</div>
                {/* Product NAME moved to step 3 — it's for the VIDEO script, not
                    the combine (the combine identifies the product from the PHOTO).
                    Only the buy-link hidden input rides along here. */}
                {pickedUrl ? <input type="hidden" name="productUrl" value={pickedUrl} /> : null}
                {/* Combine inputs — size + how they show it, once a product's set. */}
                {hasMarketingProduct && showWear && (
                  <>
                    <div className="ws-lbl"><span>{t("How big is it?")}</span> <span className="ws-opt">{t("so the presenter holds it at the right size")}</span></div>
                    <div className="ws-seg ws-sizeseg">
                      <button type="button" className={!productSize ? "sel" : ""} onClick={() => setProductSize("")}>{t("Auto")}</button>
                      {SIZE_CHOICES.map((sz) => (
                        <button type="button" key={sz.key} className={productSize === sz.key ? "sel" : ""} onClick={() => setProductSize(sz.key)}>{t(sz.label)}</button>
                      ))}
                    </div>
                    {productSize ? <input type="hidden" name="productSize" value={productSize} /> : null}
                    <div className="ws-lbl"><span>{t("How they show it")}</span>{apparel && <span className="ws-opt">{t("apparel detected")}</span>}</div>
                    <div className="ws-seg">
                      <button type="button" className={!wear ? "sel" : ""} onClick={() => setWearOverride(false)}><Ico n="figure" /> {t("Holding it")}</button>
                      <button type="button" className={wear ? "sel" : ""} onClick={() => setWearOverride(true)}><Ico n="shirt" /> {t("Wearing it")} <span className="ws-wq">{t("(generally for apparel)")}</span></button>
                    </div>
                  </>
                )}
                {/* (The "Where this takes place" setting grid moved into the center
                    setting-hero's reveal above.) */}
                {/* The combine's SETTING rides the form as `scene`; doCombine uses it
                    unless an Edit overrides. Empty (Auto) = the presenter's own backdrop. */}
                <input type="hidden" name="combineScene" value={combineScene} />
                {/* The big output — the payoff, right under the inputs. Tap to enlarge. */}
                <div className={`ws-combine-stage${combineUrl ? " has" : ""}`}>
                  {combineUrl ? (
                    <div className="ws-combine-frame">
                      <button type="button" className="ws-combine-big" onClick={() => setExpandImg(combineUrl)} aria-label={t("Tap to enlarge")}>
                        <img src={combineUrl} alt={t("Your presenter holding your product")} />
                        <span className="ws-combine-zoom" aria-hidden="true"><Ico n="expand" size={15} /></span>
                      </button>
                      <button type="button" className="ws-combine-clear" onClick={clearCombineFrame} aria-label={t("Clear this frame")} title={t("Clear this frame")}><Ico n="x" size={16} /></button>
                    </div>
                  ) : combining ? (
                    <div className="ws-combine-loading">
                      <span className="ws-combine-loadtxt">{t("Placing your product in their hands…")}</span>
                      <span className="ws-combine-loadsub">{t("This usually takes up to a minute — hang tight.")}</span>
                    </div>
                  ) : (
                    <div className="ws-combine-empty">
                      <Ico n="sparkle" size={30} />
                      <span>{hasMarketingProduct ? t("Tap Combine — your presenter holding your product shows up here") : t("Add your presenter and product above")}</span>
                    </div>
                  )}
                </div>
                {combineErr && <p className="ws-note ws-err" style={{ marginTop: 8 }}>{combineErr}</p>}
                {combineUrl ? (
                  <>
                    <div className="ws-combine-foot">
                      <span className="ws-combine-ok">✓ {combineGenerated ? t("Locked in — generate your video below. Or edit this shot first: describe a change, or hit Retry for another take.") : t("Using your own shot — generate your video below, or describe a change to edit it. (✕ the photo to pick a different one.)")}</span>
                    </div>
                    {/* "Describe a change" edits THIS shot. A GENERATED frame re-composes
                        presenter+product (typed change = Edit, empty box = Retry for
                        another take). A reused/uploaded shot has no compose context, so
                        its change is a TRUE image edit of the photo itself (text
                        required — no Retry). Either way, 16 tok. */}
                    {combineGenerated ? (
                      <div className="ws-combine-editrow">
                        <input
                          type="text"
                          className="ws-combine-editbox"
                          value={combineEdit}
                          onChange={(e) => setCombineEdit(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !combining && !busy) { e.preventDefault(); applyCombineEdit(); } }}
                          placeholder={t("Describe a change — e.g. “green shirt”, “put them in an office”")}
                          maxLength={160}
                          disabled={combining || busy}
                        />
                        <button type="button" className="ws-tweak primary" onClick={applyCombineEdit} disabled={combining || busy} title={combineEdit.trim() ? t("Apply your change") : t("Another take of this shot")}>
                          {combineEdit.trim()
                            ? <><span className="ws-tweak-ico" aria-hidden="true">✎</span> {t("Edit")} <span className="ws-tweak-c">{combineCost}</span></>
                            : <><span className="ws-tweak-ico" aria-hidden="true">↻</span> {t("Retry")} <span className="ws-tweak-c">{combineCost}</span></>}
                        </button>
                      </div>
                    ) : (
                      <div className="ws-combine-editrow">
                        <input
                          type="text"
                          className="ws-combine-editbox"
                          value={combineEdit}
                          onChange={(e) => setCombineEdit(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !combining && !busy && combineEdit.trim()) { e.preventDefault(); applyFrameEdit(); } }}
                          placeholder={t("Describe a change to this photo — e.g. “add a hat”, “blue background”")}
                          maxLength={160}
                          disabled={combining || busy}
                        />
                        <button type="button" className="ws-tweak primary" onClick={applyFrameEdit} disabled={combining || busy || !combineEdit.trim()} title={t("Edit this photo")}>
                          <span className="ws-tweak-ico" aria-hidden="true">✎</span> {t("Edit")} <span className="ws-tweak-c">{combineCost}</span>
                        </button>
                      </div>
                    )}
                    <input type="hidden" name="composedFrameUrl" value={combineUrl} />
                  </>
                ) : (
                  <>
                    <button type="button" className="wb-btn ws-combine-btn" disabled={combining || busy}
                      onClick={() => {
                        const miss: string[] = [];
                        if (!styleSet) miss.push(t("pick a style"));
                        if (!hasMarketingProduct) miss.push(t("add a product"));
                        if (!avatarId) miss.push(t("pick a presenter"));
                        if (miss.length) { setCombineErr(t("Before combining: ") + miss.join(t(", ")) + "."); return; }
                        doCombine();
                      }}>
                      {combining ? <span className="ws-combine-btntxt">{t("Combining…")}</span> : t("Combine — {n} tokens", { n: combineCost })}
                    </button>
                    {/* ALREADY HAVE A FRAME? Skip the generate. Upload your own
                        presenter-holding-product shot, or reuse a past creation —
                        both become the video seed, FREE (great for "another video
                        from the same shot"). */}
                    {!combining && (
                      <div className="ws-combine-reuse">
                        <span className="ws-combine-reuse-lbl">{t("Already have a shot? Use it free — no combine:")}</span>
                        {/* Upload is the HERO alternative — a big, obvious upload
                            button, not a pill. Reused past shots scroll sideways
                            below so they never add height. */}
                        <button type="button" className="ws-reuse-upload" onClick={() => frameUploadRef.current?.click()} disabled={busy || frameUploading}>
                          <Ico n="upload" size={19} /> {frameUploading ? t("Uploading…") : t("Upload a photo")}
                        </button>
                        {d.frameChoices.length > 0 && (
                          <div className="ws-reuse-nav">
                            {d.frameChoices.length > 6 && <button type="button" className="ws-reuse-arrow" onClick={() => scrollReuse(-1)} aria-label={t("Scroll left")}>‹</button>}
                            <div className="ws-reuse-strip" ref={reuseStripRef} aria-label={t("Reuse a past shot")}>
                              {d.frameChoices.map((f) => (
                                <button type="button" key={f.id} className="ws-reuse-thumb" title={f.presenter ? t("Reuse this shot") : t("Use this image")} onClick={() => useFrame(f)} disabled={busy || frameUploading}>
                                  {/* A 404'd past shot would show a broken tile — hide the whole thumb instead. */}
                                  <img src={f.media} alt="" loading="lazy" onError={(e) => { const b = e.currentTarget.closest(".ws-reuse-thumb") as HTMLElement | null; if (b) b.style.display = "none"; }} />
                                </button>
                              ))}
                            </div>
                            {d.frameChoices.length > 6 && <button type="button" className="ws-reuse-arrow" onClick={() => scrollReuse(1)} aria-label={t("Scroll right")}>›</button>}
                          </div>
                        )}
                      </div>
                    )}
                    <input ref={frameUploadRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => doFrameUpload(e.currentTarget.files?.[0])} />
                  </>
                )}
                {needsPhoto && (
                  <p className="ws-note ws-warn" style={{ marginTop: 8 }}>
                    {prodSource === null
                      ? t("Tap “Add your product” above — from your store, or upload a photo.")
                      : prodSource === "store"
                        ? t("Pick a product from your store so the ad features it.")
                        : <>{t("Add a photo so the ad features ")}<b>{t("your")}</b>{t(" product.")}</>}
                  </p>
                )}
                {/* Commercial-look removed here (owner): the flag was leaking into
                    the spoken SCRIPT ("Studio Commercial"), which it must never do —
                    it's a visual treatment only. Pulled from the avatar-video hub. */}
                {/* No "physical vs service" toggle here anymore: Avatar AI IS the
                    product path (presenter holds the product), and SERVICE has its
                    own dedicated content type — Talking Head (a presenter, no
                    product). So services pick Talking Head at the content-type
                    step instead of flipping a switch inside the product hub. */}
              </div>
            )}
            {/* Tap-to-enlarge overlay for the combine ingredients/result. */}
            {avatarVideoHub && expandImg && (
              <div ref={lightboxRef} className="ws-lightbox" onClick={() => setExpandImg(null)} role="dialog" aria-modal="true">
                <img src={expandImg} alt={t("Enlarged")} onClick={(e) => e.stopPropagation()} />
                <button type="button" className="ws-lightbox-x" onClick={() => setExpandImg(null)} aria-label={t("Close")}>✕</button>
              </div>
            )}

            {/* ======= CLASSIC layout — every non-avatar-video mode, unchanged ======= */}
            {!avatarVideoHub && (<>
            {/* ---- Avatar-video hub: presenter + product as two Creator-style
                tap-tiles that expand their picker inline, so the big presenter
                grid and the product chooser collapse until tapped (~4in of
                scroll saved). Only the avatar-VIDEO combine flow uses this; the
                classic chooser below still serves every other mode. */}
            {avatarVideoHub && (
              <div className="ws-hubtiles" role="group" aria-label={t("Your presenter and product")}>
                <button type="button" className={`ws-hubtile${hubPick === "presenter" ? " open" : ""}${avatarThumb ? " set" : ""}`}
                  aria-expanded={hubPick === "presenter"} onClick={() => setHubPick((p) => (p === "presenter" ? null : "presenter"))}>
                  <span className="ws-hubtile-img" style={avatarThumb ? { backgroundImage: `url(${avatarThumb})` } : undefined}>
                    <span className="ws-hubtile-badge" aria-hidden="true">{avatarThumb ? "✎" : "＋"}</span>
                  </span>
                  <b>{avatarId ? (d.cast.find((c) => c.id === avatarId)?.name || t("Presenter")) : t("Pick a presenter")}</b>
                  <span>{avatarId ? t("Tap to change") : t("Who stars in your video")}</span>
                </button>
                <button type="button" className={`ws-hubtile${hubPick === "product" ? " open" : ""}${hasMarketingProduct ? " set" : ""}`}
                  aria-expanded={hubPick === "product"} onClick={() => setHubPick((p) => (p === "product" ? null : "product"))}>
                  <span className="ws-hubtile-img prod" style={hasMarketingProduct && productThumb ? { backgroundImage: `url(${productThumb})` } : undefined}>
                    <span className="ws-hubtile-badge" aria-hidden="true">{hasMarketingProduct && productThumb ? "✎" : "＋"}</span>
                  </span>
                  <b>{hasMarketingProduct ? (productTitle.trim() || t("Your product")) : t("Add your product")}</b>
                  <span>{hasMarketingProduct ? t("Tap to change") : t("What they'll hold")}</span>
                </button>
              </div>
            )}
            {/* Presenter picker — revealed under the hub tiles for avatar video
                (its classic step-1 spot is suppressed then); picking collapses
                the drawer so the hub snaps back to the tiles. */}
            {avatarVideoHub && hubPick === "presenter" && (
              <div className="ws-hub-reveal open">
                <Presenters cast={d.cast} avatarId={avatarId} setAvatarId={(id) => { setAvatarId(id); setHubPick(null); }} brandFaceId={d.brandFaceId} onCreateOwn={() => setForgeOpen(true)} onManage={() => setManageOpen(true)} />
              </div>
            )}
            {/* Outfit note + Brand-Face CTA — reads WITH the presenter tile here
                (its step-1 copy is gated out for the hub). */}
            {avatarVideoHub && avatarId && (
              <>
                <p className="ws-note">{t("Their outfit rotates each time, so your content never looks stale.")}</p>
                {avatarId !== d.brandFaceId && (
                  <button type="button" className="ws-setbf" onClick={() => submit({ intent: "setBrandFace", avatarId }, { method: "post" })}>
                    <Ico n="star" size={13} /> {t("Make {name} your Brand Face", { name: d.cast.find((c) => c.id === avatarId)?.name || t("this presenter") })}
                  </button>
                )}
              </>
            )}

            {/* ---- Where's the product? Two side-by-side cards. Dumping a grid
                of 200 products on every visit was a doom-scroll AND buried the
                "upload my own" path; now it's one clean choice and only the
                chosen path expands. Service / Talking-Head sell an outcome with
                no product photo, so the chooser is skipped there. For the avatar-
                video hub the whole chooser is wrapped in a .ws-hub-reveal that
                collapses behind the product tile — always mounted, so a chosen
                store product keeps submitting its hidden productImageUrl. */}
            <div className="ws-hub-reveal" hidden={avatarVideoHub && hubPick !== "product"}>
            {!serviceForced && (
              <div className="ws-srcpick" role="group" aria-label={t("Where's your product?")}>
                <button type="button" className={`ws-srccard${prodSource === "store" ? " sel" : ""}`} aria-pressed={prodSource === "store"} onClick={chooseStore}>
                  <Ico n="box" size={19} />
                  <b>{t("From your store")}</b>
                  <span>{d.catalog.length > 0 ? t("Pick a product you already sell") : t("Link your store to pick products")}</span>
                </button>
                <button type="button" className={`ws-srccard${prodSource === "upload" ? " sel" : ""}`} aria-pressed={prodSource === "upload"} onClick={chooseUpload}>
                  <Ico n="camera" size={19} />
                  <b>{t("Upload a photo")}</b>
                  <span>{t("Use your own product image")}</span>
                </button>
              </div>
            )}

            {/* ---- Catalogue picker ----
                Pasting a link and retyping the title on every generation is a
                tax the merchant pays forever. Their storefront gets mirrored
                once, and from then on this is two taps. Hidden in casual — a
                store catalogue is a selling concept; casual uploads its own photo. */}
            {prodSource === "store" && !serviceForced && d.catalog.length > 0 ? (
              <>
                <div className="ws-lbl">
                  <span>{t("Pick from your store")}</span>
                  <span className="ws-opt">
                    {catShown.length < d.catalogCount
                      ? t("showing {shown} of {total} — search for the rest", { shown: catShown.length, total: d.catalogCount })
                      : (d.catalogCount === 1 ? t("{n} product", { n: d.catalogCount }) : t("{n} products", { n: d.catalogCount }))}
                  </span>
                </div>
                <button type="button" className="ws-addurl ws-uploadown" onClick={chooseUpload}>
                  <Ico n="camera" size={13} /> {t("Not in your store? Upload your own photo instead")}
                </button>
                {d.catalog.length > 8 && (
                  <input className="wb-in ws-catsearch" value={catQuery} placeholder={t("Search your catalogue…")}
                    onChange={(e) => setCatQuery(e.target.value)} />
                )}
                <div className="ws-catgrid">
                  {catShown
                    .map((c) => (
                      <button type="button" key={c.id}
                        className={`ws-cat${productTitle === c.title ? " sel" : ""}`}
                        title={c.title}
                        onClick={() => {
                          setProductTitle(c.title);
                          setImageUrl(c.imageUrl || "");
                          setPickedUrl(c.url);
                          setHubPick(null); // snap the hub drawer shut on a store pick
                        }}>
                        <span className="ws-cat-img" style={c.imageUrl ? { backgroundImage: `url(${c.imageUrl})` } : undefined}>
                          {!c.imageUrl && <Ico n="image" size={22} />}
                          {productTitle === c.title && <span className="ws-chk">✓</span>}
                        </span>
                        <b>{c.title}</b>
                        {c.priceText && <span className="ws-cat-p">{c.priceText}</span>}
                      </button>
                    ))}
                </div>
                <div className="ws-catfoot">
                  {!d.catalogSyncing && (
                    <button type="button" className="ws-addurl" onClick={() => setShowConnect((v) => !v)}>
                      {showConnect ? t("Cancel") : <>↻ {t("Refresh catalogue")}</>}
                    </button>
                  )}
                </div>
                {d.catalogSyncing && <CatalogSync startedAt={d.catalogSyncStartedAt} />}
              </>
            ) : prodSource === "store" && !serviceForced ? (
              <div className="ws-connect">
                <b><Ico n="box" /> {t("Bring your whole store in")}</b>
                <p>{t("Paste your store address once and we’ll pull your products in — then you pick one from a grid instead of hunting down a link every time. Your product page link rides along to the post, so shoppers land straight on the buy page.")}</p>
                {/* A failed import otherwise showed only on the Import tab, so a
                    merchant who came straight here to generate had no idea why
                    their store never appeared. */}
                {!d.catalogSyncing && d.catalogFailed && (
                  <div className="wb-err" style={{ marginBottom: 8 }}><b>{t("That import didn’t work.")}</b> {d.catalogFailed} {t("You can paste a single product link below instead.")}</div>
                )}
                {!d.catalogSyncing && (
                  <button type="button" className="wb-btn ghost" onClick={() => setShowConnect(true)}>{t("Connect my store")}</button>
                )}
              </div>
            ) : null}
            {prodSource === "store" && !serviceForced && d.catalogSyncing && d.catalog.length === 0 && <CatalogSync startedAt={d.catalogSyncStartedAt} />}
            {prodSource === "store" && !serviceForced && showConnect && !d.catalogSyncing && (
              <div className="ws-import">
                <input className="wb-in" type="url" value={storeInput} placeholder="yourstore.com"
                  onChange={(e) => setStoreInput(e.target.value)} />
                <button type="button" className="wb-btn" disabled={busy || !storeInput.trim()}
                  onClick={() => { submit({ intent: "importCatalog", storeUrl: storeInput.trim() }, { method: "post" }); setShowConnect(false); }}>
                  {t("Pull my products in")}
                </button>
              </div>
            )}
            {/* The chosen store image rides to the server as productImageUrl. */}
            {prodSource === "store" && !serviceForced && <input type="hidden" name="productImageUrl" value={imageUrl} />}

            {/* ---- Upload branch ---- own photo, with a live preview so they SEE
                it before confirming, plus the "or paste a URL" fallback. The file
                input is name="productPhoto" (server prefers it over the URL). */}
            {prodSource === "upload" && !serviceForced && (
              <div className="ws-uploadbox">
                <div className="ws-lbl"><span>{t("Product photo")}</span> <span className="ws-opt">{t("powers videos & image ads")}</span></div>
                <input ref={uploadRef} className="wb-in" type="file" name="productPhoto" accept="image/jpeg,image/png,image/webp" style={{ padding: 9 }}
                  onChange={(e) => takeUpload(e.currentTarget.files?.[0])} />
                {uploadPreview && (
                  <div className="ws-uppreview">
                    <img src={uploadPreview} alt={t("Your product photo")} />
                    <button type="button" className="ws-upclear" onClick={clearUpload}>✕ {t("Remove")}</button>
                  </div>
                )}
                <input className="wb-in" name="productImageUrl" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder={t("…or https://yourstore.com/cdn/product.jpg")} style={{ marginTop: 8 }} />
              </div>
            )}
            </div>{/* /.ws-hub-reveal — product chooser */}
            {/* Size + Holding/Wearing are the COMBINE inputs — in the hub they
                stay hidden until a product is set (they only shape the compose);
                every other flow shows them whenever a presenter is chosen. */}
            {showWear && (!avatarVideoHub || hasMarketingProduct) && (
              <>
                <div className="ws-lbl"><span>{t("How big is it?")}</span> <span className="ws-opt">{t("so the presenter holds it at the right size")}</span></div>
                <div className="ws-seg ws-sizeseg">
                  <button type="button" className={!productSize ? "sel" : ""} onClick={() => setProductSize("")}>{t("Auto")}</button>
                  {SIZE_CHOICES.map((sz) => (
                    <button type="button" key={sz.key} className={productSize === sz.key ? "sel" : ""} onClick={() => setProductSize(sz.key)}>
                      {t(sz.label)}
                    </button>
                  ))}
                </div>
                {productSize ? <input type="hidden" name="productSize" value={productSize} /> : null}
                <p className="ws-offernote">
                  {t("A product photo on a white background carries no scale, so we read the size from your title. Set it yourself if a render comes out too big or too small.")}
                </p>
              </>
            )}
            {(actionData as { catalogError?: string } | null)?.catalogError && (
              <div className="wb-err" style={{ marginTop: 8 }}>{(actionData as { catalogError?: string }).catalogError}</div>
            )}
            {pickedUrl ? <input type="hidden" name="productUrl" value={pickedUrl} /> : null}

            {/* Product name + "Add by URL" (import a product by link) is a
                selling/catalogue concept — marketing only. In casual the field
                above IS the "describe anything" subject box, labelled by its
                StepHead, so this row would only confuse a creator. */}
            {!casual && (
              <>
                <div className="ws-lbl"><span>{t("Product name")}</span>
                  <button type="button" className="ws-addurl" onClick={() => setShowImport((s) => !s)}>{showImport ? t("Cancel") : <>＋ {t("Add by URL")}</>}</button>
                </div>
                {showImport && (
                  <div className="ws-import">
                    <input className="wb-in" type="url" value={urlInput} placeholder={t("Paste a product link…")} onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && urlInput.trim()) { e.preventDefault(); doImport(); } }} />
                    <button type="button" className="wb-btn ws-impbtn" disabled={busy || !urlInput.trim()} onClick={doImport}>{busy ? "…" : t("Import")}</button>
                  </div>
                )}
                {importErr && <p className="ws-note ws-err">{importErr}</p>}
              </>
            )}
            {/* setPickedUrl("") because no URL is remembered with the last
                product — the previous pick's link must not survive the swap. */}
            {!casual && prodSource === "store" && lastProd && lastProd.title && lastProd.title !== productTitle.trim() && (
              <button type="button" className="ws-chip ws-lastchip" onClick={() => { setProductTitle(lastProd.title); setImageUrl(lastProd.image || ""); setPickedUrl(""); setProdSource("store"); }}>
                ↺ {t("Use last: {title}", { title: lastProd.title })}
              </button>
            )}
            {/* This whole block is already gated !(casual && tab==="video") above,
                so casual video never renders here — its describe box lives in the
                direction section below. Just the product-name input remains. */}
            <input className="wb-in" name="productTitle" required={!isEdit} maxLength={120} value={productTitle} onChange={(e) => { setProductTitle(e.target.value); setPickedUrl(""); }} placeholder={isEdit ? t("Optional name for your edit") : casual ? t("My dog Biscuit · Sunset at the lake") : t("Midnight Roast — whole bean coffee")} />
            {/* The product photo now lives in the source branches above — the
                store pick carries its image, the upload card shows a file input
                + live preview. All that's left here is the nudge for when
                neither path has produced a photo yet. */}
            {needsPhoto && (
              <p className="ws-note ws-warn">
                {prodSource === null
                  ? t("Pick where your product comes from above — choose from your store, or upload a photo.")
                  : prodSource === "store"
                    ? t("Pick a product from your store above so the ad features it.")
                    : <>{t("Add a photo so the ad features ")}<b>{t("your")}</b>{t(" product — without one we’d be inventing a product from the name. Promoting a service? Switch to ")}<b>{t("Service / offer")}</b>{t(" below.")}</>}
              </p>
            )}

            {serviceForced && (
              <>
                <p className="ws-svchint">{t("Talking Head is ")}<b>{t("product-free")}</b>{t(" — your presenter talks straight to camera like an authentic TikTok. Set the scene below, then give them a topic.")}</p>
                <div className="ws-lbl"><span>{t("Where are they?")}</span> <span className="ws-opt">{t("sets the scene")}</span></div>
                <div className="ws-seg ws-thwrap">
                  {TALKINGHEAD_SETTINGS.map((s) => (
                    <button type="button" key={s.key} className={thSetting === s.key ? "sel" : ""} onClick={() => setThSetting(s.key)}>{t(s.label)}</button>
                  ))}
                </div>
                <div className="ws-lbl"><span>{t("Seated or standing?")}</span></div>
                <div className="ws-seg">
                  <button type="button" className={thPose === "standing" ? "sel" : ""} onClick={() => setThPose("standing")}><Ico n="figure" /> {t("Standing")}</button>
                  <button type="button" className={thPose === "seated" ? "sel" : ""} onClick={() => setThPose("seated")}>{t("Seated")}</button>
                </div>
                <input type="hidden" name="thSetting" value={thSetting} />
                <input type="hidden" name="thPose" value={thPose} />
              </>
            )}
            {showService && !serviceForced && (
              <>
                <div className="ws-lbl">{t("What are you promoting?")}</div>
                <div className="ws-seg">
                  <button type="button" className={!service ? "sel" : ""} onClick={() => setService(false)}><Ico n="box" /> {t("Physical product")}</button>
                  <button type="button" className={service ? "sel" : ""} onClick={() => setService(true)}><Ico n="burst" /> {t("Service / offer")}</button>
                </div>
                {service && <p className="ws-svchint">{tab === "video" && contentType === "commercial" ? <>{t("The commercial tells your offer’s ")}<b>{t("transformation story")}</b>{t(" — before, discovery, after — and closes on a branded end-card. No product shot needed.")}</> : tab === "video" && (contentType === "cartoon" || contentType === "jingle" || baseOf(contentType) === "highlight") ? <>{t("The ad sells the ")}<b>{t("outcome")}</b>{t(" of your offer — no product shot needed. Great for coaching, subscriptions, digital & local services.")}</> : tab === "image" ? <>{t("We build a lifestyle scene that sells the ")}<b>{t("outcome")}</b>{t(" of your offer — no product shot needed. Great for coaching, subscriptions, digital & local services.")}</> : <>{t("The presenter explains your offer and sells the ")}<b>{t("outcome")}</b>{t(" — no product shot needed. Great for coaching, subscriptions, digital & local services.")}</>}</p>}
              </>
            )}

            {showWear && (!avatarVideoHub || hasMarketingProduct) && (
              <>
                <div className="ws-lbl"><span>{t("How they show it")}</span>{apparel && <span className="ws-opt">{t("apparel detected")}</span>}</div>
                <div className="ws-seg">
                  <button type="button" className={!wear ? "sel" : ""} onClick={() => setWearOverride(false)}><Ico n="figure" /> {t("Holding it")}</button>
                  <button type="button" className={wear ? "sel" : ""} onClick={() => setWearOverride(true)}><Ico n="shirt" /> {t("Wearing it")} <span className="ws-wq">{t("(generally for apparel)")}</span></button>
                </div>
              </>
            )}

            {/* ---- Combine step — lives HERE in the product step, with the chosen
                product and the waiting presenter, so it reads as one smooth act
                (not a separate block farther down). Composes the presenter-
                holding-product frame, approved in-flow; the video then animates
                from exactly that frame. */}
            {showCombine && (
              <div className={`ws-combine${combining ? " combining" : ""}${combineUrl ? " done" : ""}`}>
                <div className="ws-combine-h">
                  <b>{combineUrl ? t("Your presenter has your product") : t("Combine presenter + product")}</b>
                  <span>{t("For the most accurate video, we put your presenter holding your real product first — then animate from it.")}</span>
                </div>
                {/* Ingredients — tap either to enlarge. */}
                <div className="ws-combine-ing">
                  <button type="button" className="ws-combine-src" style={avatarThumb ? { backgroundImage: `url(${avatarThumb})` } : undefined} onClick={() => avatarThumb && setExpandImg(avatarThumb)} aria-label={t("Presenter — tap to enlarge")} />
                  <em aria-hidden="true">+</em>
                  <button type="button" className="ws-combine-src prod" style={productThumb ? { backgroundImage: `url(${productThumb})` } : undefined} onClick={() => productThumb && setExpandImg(productThumb)} aria-label={t("Product — tap to enlarge")} />
                  <em className="ws-combine-to" aria-hidden="true">→</em>
                </div>
                {/* The big result — the hero of the step. Tap to enlarge. */}
                <div className={`ws-combine-stage${combineUrl ? " has" : ""}`}>
                  {combineUrl ? (
                    <div className="ws-combine-frame">
                      <button type="button" className="ws-combine-big" onClick={() => setExpandImg(combineUrl)} aria-label={t("Tap to enlarge")}>
                        <img src={combineUrl} alt={t("Your presenter holding your product")} />
                        <span className="ws-combine-zoom" aria-hidden="true"><Ico n="expand" size={15} /></span>
                      </button>
                      <button type="button" className="ws-combine-clear" onClick={clearCombineFrame} aria-label={t("Clear this frame")} title={t("Clear this frame")}><Ico n="x" size={16} /></button>
                    </div>
                  ) : combining ? (
                    <div className="ws-combine-loading">
                      <span className="ws-combine-loadtxt">{t("Placing your product in their hands…")}</span>
                      <span className="ws-combine-loadsub">{t("This usually takes up to a minute — hang tight.")}</span>
                    </div>
                  ) : (
                    <div className="ws-combine-empty">
                      <Ico n="sparkle" size={30} />
                      <span>{t("Your presenter holding your product shows up here")}</span>
                    </div>
                  )}
                </div>
                {combineErr && <p className="ws-note ws-err" style={{ marginTop: 8 }}>{combineErr}</p>}
                {combineUrl ? (
                  <div className="ws-combine-foot">
                    <span className="ws-combine-ok">✓ {t("Locked in — a copy’s in your gallery. Your video animates from this.")}</span>
                    <button type="button" className="ws-verb" onClick={() => doCombine()} disabled={combining}>↻ {t("Re-combine")}</button>
                  </div>
                ) : (
                  <button type="button" className="wb-btn ws-combine-btn" onClick={() => doCombine()} disabled={combining || busy || !productTitle.trim()}>
                    {combining ? <span className="ws-combine-btntxt">{t("Combining…")}</span> : t("Combine — {n} tokens", { n: combineCost })}
                  </button>
                )}
                {combineUrl && <input type="hidden" name="composedFrameUrl" value={combineUrl} />}
              </div>
            )}
            {/* Tap-to-enlarge overlay (ingredients + combined result). */}
            {expandImg && (
              <div ref={lightboxRef} className="ws-lightbox" onClick={() => setExpandImg(null)} role="dialog" aria-modal="true">
                <img src={expandImg} alt={t("Enlarged")} onClick={(e) => e.stopPropagation()} />
                <button type="button" className="ws-lightbox-x" onClick={() => setExpandImg(null)} aria-label={t("Close")}>✕</button>
              </div>
            )}
            </>)}{/* /!avatarVideoHub classic layout */}
            </>)}

            {/* Casual create skips this header — the "Describe your image"
                label below already names the box, and dropping it lifts the
                box to sit right under the Stage. */}
            {!(((isCreate || isEdit) && casual) || isMusic || isFaceless || (casual && tab === "video")) && (
              <StepHead n={avatarVideoHub ? 2 : 3} title={isFaceless ? t("Your video") : isCreate || isMusic ? t("Describe it") : t("Direction & {verb}", { verb: t(verb).toLowerCase() })} hint={isFaceless ? t("what's it about?") : isCreate || isMusic ? t("the more detail, the better") : t("leave it to EasyMode, or steer it")} />
            )}
            {/* Product NAME — for an avatar video it lives HERE (with the video),
                because it drives the SCRIPT, not the combine (owner-noted). The
                combine already identifies the product from its photo, so a name
                isn't needed to combine — only to generate the video. */}
            {avatarVideoHub && (
              <>
                <div className="ws-lbl"><span>{t("Product name")}</span>
                  <button type="button" className="ws-addurl" onClick={() => setShowImport((s) => !s)}>{showImport ? t("Cancel") : <>＋ {t("Add by URL")}</>}</button>
                </div>
                {showImport && (
                  <div className="ws-import">
                    <input className="wb-in" type="url" value={urlInput} placeholder={t("Paste a product link…")} onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && urlInput.trim()) { e.preventDefault(); doImport(); } }} />
                    <button type="button" className="wb-btn ws-impbtn" disabled={busy || !urlInput.trim()} onClick={doImport}>{busy ? "…" : t("Import")}</button>
                  </div>
                )}
                {importErr && <p className="ws-note ws-err">{importErr}</p>}
                {prodSource === "store" && lastProd && lastProd.title && lastProd.title !== productTitle.trim() && (
                  <button type="button" className="ws-chip ws-lastchip" onClick={() => { setProductTitle(lastProd.title); setImageUrl(lastProd.image || ""); setPickedUrl(""); setProdSource("store"); }}>
                    ↺ {t("Use last: {title}", { title: lastProd.title })}
                  </button>
                )}
                <input className="wb-in" name="productTitle" required maxLength={120} value={productTitle} onChange={(e) => { setProductTitle(e.target.value); setPickedUrl(""); }} placeholder={t("Midnight Roast — whole bean coffee")} />
              </>
            )}
            {tab === "image" && !casual && (
              <>
                <div className="ws-lbl"><span>{t("Running a promo?")}</span> <span className="ws-opt">{t("optional")}</span></div>
                <input className="wb-in" name="merchantOffer" maxLength={40} placeholder={t("e.g. 20% off first order")} />
                <p className="ws-offernote">
                  {t("Only fill this in if you’re ")}<b>{t("actually")}</b>{t(" running it — we never invent discounts, so offer-style ads sell on the product instead when this is blank.")}
                </p>
              </>
            )}
            {tab === "video" ? (
              casual ? (
                /* CREATOR video = describe-your-video OR upload-a-video-to-edit.
                   No brand voice, no presenter "what do they say/do/where"
                   (that's a marketing spokesperson ad). The file input below is
                   ALWAYS mounted (just hidden) so a chosen clip's File rides the
                   native multipart submit directly — picking a video flips to the
                   edit panel, which replaces the describe box until it's removed. */
                <>
                  {/* Always-mounted real file input — its own selection POSTs the
                      File on submit (no DataTransfer needed, unlike the iOS photo
                      path). We also mirror the File into state for the preview. */}
                  <input ref={editVideoUploadRef} type="file" name="productVideo"
                    accept="video/mp4,video/quicktime,video/webm" style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.currentTarget.files?.[0];
                      if (f && !/^video\//.test(f.type)) { setEditVideoFile(null); e.currentTarget.value = ""; return; }
                      setEditVideoFile(f || null);
                    }} />
                  {isVideoEdit ? (
                    /* ── EDIT PANEL — a loaded clip + one ffmpeg op. Replaces the
                       describe box; ✕ Remove returns to describe->make. ── */
                    <div className="ws-vedit">
                      <div className="ws-lbl"><span>{t("Edit your video")}</span> <span className="ws-opt">{t("one quick change")}</span></div>
                      {editVideoUrl && <video className="ws-vedit-prev" src={editVideoUrl} controls playsInline />}
                      <div className="ws-vedit-op ws-seg" role="group" aria-label={t("What to do with the video")}>
                        {([["trim", "Trim"], ["caption", "Captions"], ["speed", "Speed"]] as ["trim" | "caption" | "speed", string][]).map(([k, label]) => (
                          <button type="button" key={k} className={videoEditOp === k ? "sel" : ""} aria-pressed={videoEditOp === k}
                            onClick={() => setVideoEditOp(k)}>{t(label)}</button>
                        ))}
                      </div>
                      {videoEditOp === "trim" && (
                        <div className="ws-vedit-trim">
                          <label className="ws-vedit-num"><span>{t("Start (sec)")}</span>
                            <input className="wb-in" type="number" min={0} step={0.1} value={trimStart}
                              placeholder="0" onChange={(e) => setTrimStart(e.target.value)} /></label>
                          <label className="ws-vedit-num"><span>{t("End (sec)")}</span>
                            <input className="wb-in" type="number" min={0} step={0.1} value={trimEnd}
                              placeholder={t("e.g. 10")} onChange={(e) => setTrimEnd(e.target.value)} /></label>
                        </div>
                      )}
                      {videoEditOp === "caption" && (
                        <input className="wb-in" type="text" maxLength={200} value={videoCaption}
                          placeholder={t("Caption to burn in")} onChange={(e) => setVideoCaption(e.target.value)} />
                      )}
                      {videoEditOp === "speed" && (
                        <div className="ws-vedit-speed ws-seg" role="group" aria-label={t("Playback speed")}>
                          {[0.5, 1, 1.5, 2].map((s) => (
                            <button type="button" key={s} className={videoSpeed === s ? "sel" : ""} aria-pressed={videoSpeed === s}
                              onClick={() => setVideoSpeed(s)}>{s}×</button>
                          ))}
                        </div>
                      )}
                      <button type="button" className="ws-vedit-remove ws-back" style={{ marginTop: 10 }}
                        onClick={() => { if (editVideoUploadRef.current) editVideoUploadRef.current.value = ""; setEditVideoFile(null); }}>
                        ✕ {t("Remove video")}
                      </button>
                      {/* Op + params ride hidden inputs so the native multipart
                          submit (carrying productVideo) sends them. Only meaningful
                          values go — the server parses/validates ranges. */}
                      <input type="hidden" name="editOp" value={videoEditOp} />
                      {videoEditOp === "trim" && trimStart.trim() !== "" ? <input type="hidden" name="startSec" value={trimStart} /> : null}
                      {videoEditOp === "trim" && trimEnd.trim() !== "" ? <input type="hidden" name="endSec" value={trimEnd} /> : null}
                      {videoEditOp === "caption" && videoCaption.trim() ? <input type="hidden" name="captionText" value={videoCaption} /> : null}
                      {videoEditOp === "speed" ? <input type="hidden" name="speed" value={videoSpeed} /> : null}
                      {editVideoFile ? <input type="hidden" name="title" value={editVideoFile.name.replace(/\.[^.]+$/, "").slice(0, 80)} /> : null}
                    </div>
                  ) : (
                    <>
                      <div className="ws-lbl">{t("Describe your video")} <span className="ws-opt">{t("required")}</span></div>
                      <textarea className="wb-in ws-ta ws-hero" value={direction} maxLength={400} rows={3}
                        placeholder={t("e.g. a red fox running through a snowy forest at dawn, cinematic slow motion")}
                        onChange={(e) => setDirection(e.target.value)} />
                      <CharCount value={direction} max={400} />
                      <div className="ws-chips" style={{ marginTop: 8 }}>
                        {["a red panda surfing a giant wave at sunset, cinematic", "neon jellyfish drifting through deep space", "coffee pouring in slow-mo, macro close-up"].map((ex) => (
                          <button type="button" key={ex} className={`ws-chip${direction === ex ? " sel" : ""}`} onClick={() => setDirection(direction === ex ? "" : ex)}><Ico n="sparkle" /> {t(ex)}</button>
                        ))}
                      </div>
                      {/* The alternative path — subtle but discoverable, right under
                          the describe box: upload a clip to trim / caption / speed it. */}
                      <button type="button" className="ws-vedit-entry" onClick={() => editVideoUploadRef.current?.click()}>
                        <Ico n="video" size={14} /> {t("Or upload a video to edit it")} →
                      </button>
                    </>
                  )}
                </>
              ) : (
              <>
                <div className="ws-lbl"><span>{t("Prompting")}</span>
                  <button type="button" className="ws-addurl" onClick={() => setAdvanced((a) => !a)}>{advanced ? t("Use auto") : <>{t("Advanced")} ▾</>}</button>
                </div>
                {!advanced ? (
                  <>
                    <div className="ws-autobox"><Ico n="sparkle" /> <b>{t("EasyMode decides")}</b>{t(" the scene & script from your brand voice. Tap ")}<b>{t("Advanced")}</b>{t(" to direct it yourself — or drop a quick direction below.")}</div>
                    <input className="wb-in" value={direction} maxLength={300} placeholder={t("cozy autumn morning energy, focus on the aroma")} onChange={(e) => setDirection(e.target.value)} />
                    {/* Blank boxes freeze people. Three tappable directions
                        show the register and prove a single sentence is
                        enough — tap to fill, tap again to clear. */}
                    <div className="ws-chips" style={{ marginTop: 8 }}>
                      {["golden-hour rooftop, confident and premium", "fast + funny, lead with the price", "cozy at home, make it feel like a gift"].map((ex) => (
                        <button type="button" key={ex} className={`ws-chip${direction === ex ? " sel" : ""}`} onClick={() => setDirection(direction === ex ? "" : ex)}><Ico n="sparkle" /> {t(ex)}</button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="ws-3w">
                    <div>
                      <span className="ws-w">{contentType === "jingle" ? t("What should the anthem sing about?") : contentType === "cartoon" ? t("What should the narrator say?") : t("What do they say?")}</span>
                      <textarea className="wb-in ws-ta" value={saySomething} maxLength={400} placeholder={contentType === "jingle" ? t("Lines or claims to work into the lyrics…") : t("The hook + a couple talking points, in your voice…")} onChange={(e) => setSaySomething(e.target.value)} />
                      <CharCount value={saySomething} max={400} />
                    </div>
                    <div>
                      <span className="ws-w">{contentType === "cartoon" || contentType === "jingle" ? t("What happens in the scene?") : t("What do they do?")}</span>
                      <input className="wb-in" type="text" value={doWhat} maxLength={160} placeholder={contentType === "cartoon" || contentType === "jingle" ? t("the product saves the day, sparkles, celebration…") : t("unbox it, hold it up, demo a feature…")} onChange={(e) => setDoWhat(e.target.value)} />
                    </div>
                    <div>
                      <span className="ws-w">{contentType === "cartoon" || contentType === "jingle" ? t("Where does it happen?") : t("Where are they?")}</span>
                      <input className="wb-in" type="text" value={where} maxLength={140} placeholder={t("a cozy cabin, a city rooftop, a snowy slope…")} onChange={(e) => setWhere(e.target.value)} />
                    </div>
                  </div>
                )}
              </>
              )
            ) : (
              <>
                {tab === "blog" && (
                  <>
                    <div className="ws-lbl">{t("Pick an angle")} <span className="ws-opt">{t("optional")}</span></div>
                    <div className="ws-chips">
                      {BLOG_ANGLES.map((s, i) => (
                        <button type="button" key={i} className={`ws-chip${direction === s.prompt ? " sel" : ""}`} onClick={() => setDirection(direction === s.prompt ? "" : s.prompt)}><Ico n={s.icon} /> {t(s.label)}</button>
                      ))}
                    </div>
                  </>
                )}
                {/* Marketing mode keeps these pickers above the compact input
                    (its StepHead layout). Casual gets the describe-first hero
                    with the same pickers moved BELOW, in a .ws-genopts block —
                    see the isMusic / isFaceless genopts further down. */}
                {tab === "music" && !casual && (
                  <>
                    <div className="ws-lbl">{t("Genre / mood")} <span className="ws-opt">{t("optional")}</span></div>
                    <div className="ws-fmtcats" role="radiogroup" aria-label={t("Music style")}>
                      {MUSIC_STYLES.map((s) => (
                        <button type="button" key={s.key} role="radio" aria-checked={musicStyle === s.key}
                          className={`ws-fmtcat${musicStyle === s.key ? " sel" : ""}`} onClick={() => setMusicStyle(musicStyle === s.key ? null : s.key)}>
                          <Ico n={s.icon} /> {t(s.name)}
                        </button>
                      ))}
                    </div>
                    {musicStyle && <input type="hidden" name="musicStyle" value={musicStyle} />}
                  </>
                )}
                {tab === "faceless" && !casual && (
                  <>
                    <div className="ws-lbl">{t("Format")}</div>
                    <div className="ws-fmtcats ws-pills2" role="radiogroup" aria-label={t("Video format")}>
                      {([["motivational", "Motivational"], ["facts", "Facts"], ["storytime", "Storytime"], ["listicle", "Listicle"]] as [string, string][]).map(([k, label]) => (
                        <button type="button" key={k} role="radio" aria-checked={facelessFormat === k}
                          className={`ws-fmtcat${facelessFormat === k ? " sel" : ""}`} onClick={() => setFacelessFormat(k)}>{t(label)}</button>
                      ))}
                    </div>
                    <div className="ws-lbl" style={{ marginTop: 12 }}>{t("Voice")}</div>
                    <div className="ws-fmtcats ws-pills2" role="radiogroup" aria-label={t("Voice")}>
                      {([["f-warm", "Female · calm"], ["f-hype", "Female · hype"], ["m-warm", "Male · calm"], ["m-hype", "Male · hype"]] as [string, string][]).map(([k, label]) => (
                        <button type="button" key={k} role="radio" aria-checked={voiceKey === k}
                          className={`ws-fmtcat${voiceKey === k ? " sel" : ""}`} onClick={() => setVoiceKey(k)}>{t(label)}</button>
                      ))}
                    </div>
                    <input type="hidden" name="facelessFormat" value={facelessFormat} />
                    <input type="hidden" name="voiceKey" value={voiceKey} />
                    <p className="ws-note" style={{ marginTop: 12 }}>{t("We write the script, voice it, generate the b-roll + word-synced captions and set it to music — a ready-to-post 9:16 video. Takes a few minutes.")}</p>
                  </>
                )}
                {/* WHAT THIS BOX DOES DEPENDS ON WHAT IS ABOVE IT.
                    With an ad FORMAT picked the composition is already fixed
                    and this text only ever reaches the copywriter as “Angle:”,
                    so asking the merchant to “describe the scene you want”
                    invited an instruction the renderer will not follow — and
                    they then blame the app for ignoring them. Ask for the
                    thing it can actually deliver. */}
                <div className="ws-lbl">
                  {tab === "image"
                    ? isCreate
                      ? t("Describe your image")
                      : isEdit
                        ? editOp === "bgswap" ? t("Describe the new background") : editOp === "replace" ? t("What to change") : editOp === "cartoonize" ? t("Cartoon style") : (editOp === "bgremove" || editOp === "colorize" || editOp === "upscale") ? t("No input needed") : editOp === "restyle" ? t("Describe the look") : t("Describe your edits")
                        : templateKey ? t("Tweaks") : formatKey ? t("Anything to emphasise?") : t("Describe it")
                    : tab === "music" ? t("Describe your music")
                    : tab === "faceless" ? t("What's your video about?")
                    : t("Topic")}{" "}
                  <span className="ws-opt">{isCreate || isMusic || isFaceless ? t("required") : isEdit && (editOp === "replace" || !editOp) ? t("required") : isEdit && (editOp === "bgremove" || editOp === "colorize" || editOp === "upscale") ? t("nothing to add") : t("optional")}</span>
                </div>
                {/* The text-to-create instruments (Make an image / Make music /
                    Faceless) lead with a BIG "describe anything" box — the
                    DeepAI-style hero input. No reference photo is involved, so
                    the box is the whole act of creation and deserves the room.
                    Edit / blog / marketing keep the compact single-line input. */}
                {(isCreate || isMusic || isFaceless || (isEdit && casual)) ? (
                  <>
                  <textarea className="wb-in ws-ta ws-hero" value={direction} maxLength={isCreate ? 500 : 300} rows={3}
                    placeholder={
                      isMusic ? t("e.g. upbeat lo-fi hip-hop with mellow piano and a soft beat")
                      : isFaceless ? t("e.g. 5 mind-blowing facts about the deep ocean")
                      : isEdit ? t("e.g. make it terrifying · turn it into a watercolor painting · add a stormy sunset sky")
                      : t("e.g. a red panda astronaut floating over neon Tokyo at night")
                    }
                    onChange={(e) => setDirection(e.target.value)} />
                  <CharCount value={direction} max={isCreate ? 500 : 300} />
                  </>
                ) : (
                <input className="wb-in" value={direction} maxLength={300}
                  disabled={isEdit && (editOp === "bgremove" || editOp === "colorize" || editOp === "upscale")}
                  placeholder={
                    tab === "faceless"
                      ? t("e.g. 5 mind-blowing facts about the deep ocean")
                    : tab === "music"
                      ? t("e.g. upbeat lo-fi hip-hop with mellow piano and a soft beat")
                    : tab === "image"
                      ? isCreate
                        ? t("e.g. a red panda astronaut floating over neon Tokyo at night")
                        : isEdit
                        ? editOp === "bgswap" ? t("e.g. a sunny marble kitchen counter") : editOp === "replace" ? t("e.g. replace the sky with a sunset") : editOp === "cartoonize" ? t("e.g. bold outlines, flat colors — or leave blank") : (editOp === "bgremove" || editOp === "colorize" || editOp === "upscale") ? t("Nothing to add — just hit Edit") : editOp === "restyle" ? t("e.g. warm film look, soft golden light") : t("e.g. make the shirt a purple hoodie, add a camera")
                        : templateKey
                          ? t("Any edits — e.g. make the wall sage green, add pine branches…")
                          : formatKey
                            ? t("e.g. lead with how fast it ships — or leave blank and we'll pick the angle")
                            : t("Describe the scene you want — or leave blank for bright & clean…")
                      : t("Tap an angle above, or describe your own topic…")
                  }
                  onChange={(e) => setDirection(e.target.value)} />
                )}
                {isFaceless && (
                  <div className="ws-chips" style={{ marginTop: 8 }}>
                    {["5 mind-blowing facts about the deep ocean", "a 30-second motivational pep talk", "storytime: the day everything changed"].map((ex) => (
                      <button type="button" key={ex} className={`ws-chip${direction === ex ? " sel" : ""}`} onClick={() => setDirection(direction === ex ? "" : ex)}><Ico n="sparkle" /> {t(ex)}</button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Output FRAME + AI MODEL — the two the merchant asked for. Frame
                sets aspect_ratio (so no more square-in-a-black-box); Model picks
                the Replicate model (default "Best" = premium, legible text).
                Both ride hidden inputs and are re-validated server-side. */}
            {/* Everything the describe box doesn't need lives behind ONE collapsed
                "Options" disclosure — Frame, Model, and Art style — so casual Create
                reads as a clean canvas (describe → Make). The summary shows the
                current choices; hidden inputs sit OUTSIDE the open/closed gate so a
                choice still submits when collapsed. */}
            {isCreate && casual && (
              <div className="ws-styledisc">
                <button type="button" className={`ws-styletoggle${showStyle ? " open" : ""}`}
                  aria-expanded={showStyle} onClick={() => setShowStyle((v) => !v)}>
                  <span className="ws-styletoggle-l">
                    <span aria-hidden="true"><Ico n="sliders" /></span>
                    {t("Options")}
                    <span style={{ marginLeft: 7, fontSize: "11.5px", fontWeight: 600, color: "#8A968E" }}>
                      {t(CREATE_ASPECTS.find((a) => a.value === createAspect)?.name || "")} · {t(CREATE_MODELS.find((m) => m.key === createModel)?.name || "")}{createStyle ? ` · ${t(CREATE_STYLES.find((s) => s.key === createStyle)?.name || "")}` : ""}
                    </span>
                  </span>
                  <span className="ws-styletoggle-r">
                    <span className="ws-chev" aria-hidden="true">⌄</span>
                  </span>
                </button>
                {showStyle && (
                  <div style={{ marginTop: 10 }}>
                    <div className="ws-lbl">{t("Frame")}</div>
                    <div className="ws-frames" role="radiogroup" aria-label={t("Output frame")}>
                      {CREATE_ASPECTS.map((a) => (
                        <button type="button" key={a.value} role="radio" aria-checked={createAspect === a.value} title={t("{name} ({value})", { name: a.name, value: a.value })}
                          className={`ws-frame${createAspect === a.value ? " sel" : ""}`} onClick={() => setCreateAspect(a.value)}>
                          <span className="ws-frame-shape" style={{ aspectRatio: a.css }} aria-hidden="true" />
                          <span className="ws-frame-nm">{t(a.name)}</span>
                        </button>
                      ))}
                    </div>
                    <div className="ws-lbl" style={{ marginTop: 12 }}>{t("Model")}</div>
                    <div className="ws-models" role="radiogroup" aria-label={t("AI model")}>
                      {CREATE_MODELS.map((m) => (
                        <button type="button" key={m.key} role="radio" aria-checked={createModel === m.key}
                          className={`ws-model${createModel === m.key ? " sel" : ""}`} onClick={() => setCreateModel(m.key)}>
                          {t(m.name)}{m.surcharge > 0 && <span className="ws-model-up">+{m.surcharge}</span>}
                        </button>
                      ))}
                    </div>
                    <p className="ws-note" style={{ marginTop: 6 }}>{t(CREATE_MODELS.find((m) => m.key === createModel)?.blurb || "")}</p>
                    <div className="ws-lbl" style={{ marginTop: 12 }}>{t("Art style")} <span className="ws-opt">{t("optional")}</span></div>
                    <div className="ws-stylegrid" role="radiogroup" aria-label={t("Art style")}>
                      {CREATE_STYLES.map((s) => (
                        <button type="button" key={s.key} role="radio" aria-checked={createStyle === s.key} title={t(s.name)}
                          className={`ws-styletile${createStyle === s.key ? " sel" : ""}`} onClick={() => setCreateStyle(createStyle === s.key ? null : s.key)}>
                          <span className="ws-styletile-face" style={{ background: STYLE_SWATCH[s.key] || "linear-gradient(135deg,#EAF6EF,#F4F1E6)" }}>
                            <span className="ws-styletile-emoji" aria-hidden="true"><Ico n={s.icon} size={24} /></span>
                          </span>
                          <span className="ws-styletile-nm">{t(s.name)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <input type="hidden" name="createModel" value={createModel} />
                <input type="hidden" name="createAspect" value={createAspect} />
                {createStyle && <input type="hidden" name="createStyle" value={createStyle} />}
              </div>
            )}

            {/* CASUAL "EDIT A PHOTO" — same clean shape as "Make an image":
                the describe box leads (above), then a compact Model picker
                (Pro/Ultra; no Frame — an edit keeps the photo's own shape) and
                the quick actions as a collapsed disclosure. */}
            {isEdit && casual && (
              <div className="ws-genopts">
                <div className="ws-lbl">{t("Model")}</div>
                <div className="ws-models" role="radiogroup" aria-label={t("AI model")}>
                  {CREATE_MODELS.map((m) => (
                    <button type="button" key={m.key} role="radio" aria-checked={createModel === m.key}
                      className={`ws-model${createModel === m.key ? " sel" : ""}`} onClick={() => setCreateModel(m.key)}>
                      {t(m.name)}{m.surcharge > 0 && <span className="ws-model-up">+{m.surcharge}</span>}
                    </button>
                  ))}
                </div>
                <p className="ws-note" style={{ marginTop: 6 }}>{t(CREATE_MODELS.find((m) => m.key === createModel)?.blurb || "")}</p>
                <input type="hidden" name="createModel" value={createModel} />
                <div className="ws-styledisc" style={{ marginTop: 12 }}>
                  <button type="button" className={`ws-styletoggle${showEditOps ? " open" : ""}`}
                    aria-expanded={showEditOps} onClick={() => setShowEditOps((v) => !v)}>
                    <span className="ws-styletoggle-l">
                      <span aria-hidden="true"><Ico n="bolt" /></span>
                      {editOp
                        ? <>{t("Quick action:")} <b>{t(EDIT_QUICK_ACTIONS.find(([k]) => k === editOp)?.[1] || "")}</b></>
                        : t("Quick actions")}
                    </span>
                    <span className="ws-styletoggle-r">
                      {!editOp && <span className="ws-opt">{t("optional")}</span>}
                      <span className="ws-chev" aria-hidden="true">⌄</span>
                    </span>
                  </button>
                  {showEditOps && (
                    <>
                      <p className="ws-note" style={{ marginTop: 8 }}>{t("One-tap transforms — or just describe your edit above.")}</p>
                      <div className="ws-fmtcats" role="radiogroup" aria-label={t("Photo edit")}>
                        {EDIT_QUICK_ACTIONS.map(([k, label]) => (
                          <button type="button" key={k} role="radio" aria-checked={editOp === k}
                            className={`ws-fmtcat${editOp === k ? " sel" : ""}`} onClick={() => setEditOp(editOp === k ? null : k)}>{t(label)}</button>
                        ))}
                      </div>
                    </>
                  )}
                  {editOp && <input type="hidden" name="editOp" value={editOp} />}
                </div>
              </div>
            )}

            {/* CASUAL "MAKE MUSIC" — describe-first like image: the hero box
                leads (above), and the Genre / mood picker sits below as a tidy
                options row instead of crowding in over the box. */}
            {isMusic && (
              <div className="ws-genopts">
                <div className="ws-lbl">{t("Genre / mood")} <span className="ws-opt">{t("optional")}</span></div>
                <div className="ws-fmtcats" role="radiogroup" aria-label={t("Music style")}>
                  {MUSIC_STYLES.map((s) => (
                    <button type="button" key={s.key} role="radio" aria-checked={musicStyle === s.key}
                      className={`ws-fmtcat${musicStyle === s.key ? " sel" : ""}`} onClick={() => setMusicStyle(musicStyle === s.key ? null : s.key)}>
                      <Ico n={s.icon} /> {t(s.name)}
                    </button>
                  ))}
                </div>
                {musicStyle && <input type="hidden" name="musicStyle" value={musicStyle} />}
              </div>
            )}

            {/* CASUAL "FACELESS VIDEO" — describe-first like image: the topic
                box + example chips lead (above), then Format + Voice below in a
                .ws-genopts block. Flagship action, so both choices stay visible. */}
            {isFaceless && (
              <div className="ws-genopts">
                <div className="ws-lbl">{t("Format")}</div>
                <div className="ws-fmtcats ws-pills2" role="radiogroup" aria-label={t("Video format")}>
                  {([["motivational", "Motivational"], ["facts", "Facts"], ["storytime", "Storytime"], ["listicle", "Listicle"]] as [string, string][]).map(([k, label]) => (
                    <button type="button" key={k} role="radio" aria-checked={facelessFormat === k}
                      className={`ws-fmtcat${facelessFormat === k ? " sel" : ""}`} onClick={() => setFacelessFormat(k)}>{t(label)}</button>
                  ))}
                </div>
                <div className="ws-lbl" style={{ marginTop: 12 }}>{t("Voice")}</div>
                <div className="ws-fmtcats ws-pills2" role="radiogroup" aria-label={t("Voice")}>
                  {([["f-warm", "Female · calm"], ["f-hype", "Female · hype"], ["m-warm", "Male · calm"], ["m-hype", "Male · hype"]] as [string, string][]).map(([k, label]) => (
                    <button type="button" key={k} role="radio" aria-checked={voiceKey === k}
                      className={`ws-fmtcat${voiceKey === k ? " sel" : ""}`} onClick={() => setVoiceKey(k)}>{t(label)}</button>
                  ))}
                </div>
                <div className="ws-lbl" style={{ marginTop: 12 }}>{t("Quality")}</div>
                <div className="ws-models" role="radiogroup" aria-label={t("B-roll quality")}>
                  {FACELESS_QUALITIES.map((q) => (
                    <button type="button" key={q.key} role="radio" aria-checked={facelessQuality === q.key}
                      className={`ws-model${facelessQuality === q.key ? " sel" : ""}`} onClick={() => setFacelessQuality(q.key)}>
                      {t(q.name)}{q.surcharge > 0 && <span className="ws-model-up">+{q.surcharge * CREATOR_SURCHARGE_MULT}</span>}
                    </button>
                  ))}
                </div>
                <p className="ws-note" style={{ marginTop: 6 }}>{t(FACELESS_QUALITIES.find((q) => q.key === facelessQuality)?.blurb || "")}</p>
                <input type="hidden" name="facelessFormat" value={facelessFormat} />
                <input type="hidden" name="voiceKey" value={voiceKey} />
                <input type="hidden" name="facelessQuality" value={facelessQuality} />
                <p className="ws-note" style={{ marginTop: 12 }}>{t("We write the script, voice it, generate the b-roll + word-synced captions and set it to music — a ready-to-post 9:16 video. Takes a few minutes.")}</p>
              </div>
            )}

            {/* Composed fields ride hidden inputs so the native multipart
                submit (needed for the photo upload) carries them. */}
            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="direction" value={finalDirection} />
            {finalScene ? <input type="hidden" name="scene" value={finalScene} /> : null}
            {serviceOn ? <input type="hidden" name="service" value="1" /> : null}
            {showWear && wear ? <input type="hidden" name="wear" value="1" /> : null}
            {avatarRides && <input ref={variantRef} type="hidden" name="avatarVariant" defaultValue="0" />}

            {err && <div className="wb-err" style={{ marginTop: 4 }}>{err}</div>}
            {/* The trial cap is the ONE spend failure the merchant can clear
                themselves, so the way out sits on the message that blocked
                them rather than three taps away on the plans page. */}
            {err && d.trialing && /free trial/i.test(err) && (
              <div className="ws-trialout">
                <b>{t("Don’t want to wait?")}</b>
                <p>{t("Start your plan now and your full monthly allowance unlocks immediately — your card is charged today instead of on day 7.")}</p>
                <button type="button" className="wb-btn" disabled={busy}
                  onClick={() => submit({ intent: "endTrial" }, { method: "post" })}>
                  {t("Start my plan now")}
                </button>
              </div>
            )}
            {(actionData as { trialEnded?: string } | null)?.trialEnded && (
              <div className="wb-ok" style={{ marginTop: 8 }}>{(actionData as { trialEnded?: string }).trialEnded}</div>
            )}
            {/* BURST — a handful of usable variations in one go, so the merchant
                has options to post or test, not "pick one, bin the rest" (every
                take should be good). Blog has no burst: nobody wants five near
                identical articles, and each one is a page not a thumbnail. */}
            {tab !== "blog" && !isEdit && !isCreate && !isMusic && !isFaceless && !isVideoEdit && !(casual && tab === "video") && (
              <div className="ws-burst">
                <span className="ws-burst-lbl">{t("How many")}</span>
                <div className="ws-burst-steps">
                  {(tab === "video" ? BURST_STEPS.video : BURST_STEPS.image).map((n) => (
                    <button type="button" key={n} className={burst === n ? "sel" : ""}
                      onClick={() => setBurst(n)} aria-pressed={burst === n}>
                      {n === 1 ? t("Just one") : `×${n}`}
                    </button>
                  ))}
                </div>
                {burst > 1 && (
                  <p className="ws-burst-note">
                    {tab === "image" && !templateKey && !formatKey && imageMode !== "presenter" && !service && !casual
                      ? t("{n} different ad layouts at once — a full set, all ready to post.", { n: burst })
                      : casual
                        ? t("{n} different looks at once — all yours to share.", { n: burst })
                        : t("{n} takes at once — same setup, different angles, all yours to use.", { n: burst })}
                  </p>
                )}
              </div>
            )}
            <input type="hidden" name="burst" value={effBurst} />
            {!isMusic && (
              <div className="ws-outlang">
                <span className="ws-outlang-lbl">{t("Writing in")}</span>
                <LangToggle
                  value={outputLang} labels={CONTENT_LANG_NATIVE} align="left"
                  onPick={(c) => outLangFetcher.submit({ intent: "setLang", contentLang: c }, { method: "post", action: "/web" })}
                  title={t("Output language — the language the generated copy, script & captions are written in. Keep the app in English and still make, say, Spanish ads.")}
                />
              </div>
            )}
            <div className="ws-makebar" style={{ marginTop: 10 }}>
              <button ref={makeBtnRef} className="wb-btn" name="intent" value={submitIntent} disabled={ctaDisabled}>
                {busy
                  ? t("Sending to the studio…")
                  : !d.hasPlan
                    ? t("Pick a plan to start")
                  : shortBy > 0
                    ? (shortBy === 1 ? t("Need 1 more token") : t("Need {short} more tokens", { short: shortBy.toLocaleString("en-US") }))
                  : effBurst > 1
                    ? t("{verb} {n} {noun}s", { verb: t(verb), n: effBurst, noun: t(noun) })
                    : t("{verb} {noun}", { verb: t(verb), noun: t(noun) })}
              </button>
              <p className="ws-wallet">
                {!d.hasPlan
                  ? <>{t("Your 7-day free trial unlocks every generator — ")}<Link to="/web#plans">{t("pick a plan")}</Link>{t(" to begin.")}</>
                  : shortBy > 0
                    ? <>{t("{total} tokens · ", { total: (cost * effBurst).toLocaleString("en-US") })}<Link to="/web#plans">{t("Add tokens")}</Link>{effBurst > 1 ? t(" or make fewer") : ""}</>
                    : <>{t("{total} tokens", { total: cost * effBurst })}{effBurst > 1 ? t(" · {cost} each", { cost }) : ""}{engineFee ? t(" · incl. {n} engine", { n: engineFee }) : createFee ? t(" · incl. {n} {model}", { n: createFee, model: CREATE_MODELS.find((m) => m.key === createModel)?.name || t("premium") }) : facelessFee ? t(" · incl. {n} Ultra", { n: facelessFee }) : ""}</>}
              </p>
            </div>
          </>
        )}
      </Form>
       </div>
       {casual && (
         <aside className="ws-stage">
           <div className={`ws-stage-frame${stageResult || (isEdit && editPreview) ? " has-result" : ""}`}
             style={(stageResult || (isEdit && editPreview)) && stageAspect ? ({ ["--stage-ar" as string]: String(stageAspect) } as React.CSSProperties) : undefined}>
             {stageResult ? (
               <div className="ws-stageresult">
                 <div className="ws-stagemedia">
                   {stageResult.isVideo
                     ? <video src={stageResult.media} controls autoPlay muted loop playsInline
                         onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setStageAspect(v.videoWidth / v.videoHeight); }} />
                     : stageResult.isAudio
                       ? <div className="ws-stageaud"><span className="ws-rose" aria-hidden="true" /><audio src={stageResult.media} controls /></div>
                       : <img src={stageResult.media} alt={stageResult.title}
                           onLoad={(e) => { const t = e.currentTarget; if (t.naturalWidth && t.naturalHeight) setStageAspect(t.naturalWidth / t.naturalHeight); }} />}
                 </div>
               </div>
             ) : genError ? (
               <div className={`ws-easelph ws-generr${genError.kind === "unsafe" ? " unsafe" : ""}`} role="alert">
                 <span className="ws-generr-ico" aria-hidden="true">{genError.kind === "unsafe" ? <Ico n="warning" size={24} /> : "!"}</span>
                 <div className="ws-easel-cap">{genError.kind === "unsafe" ? t("Sorry, we can’t make that one") : t("That didn’t finish")}</div>
                 <div className="ws-easel-sub">{genError.message}</div>
                 <button type="button" className="ws-verb ws-generr-btn" onClick={() => setGenError(null)}>{genError.kind === "unsafe" ? t("Try another") : t("Got it")}</button>
               </div>
             ) : (isEdit && editPreview) ? (
               /* A photo loaded for editing shows ON the Stage (the canvas) — so
                  the "+" placeholder is clearly replaced — then the edited
                  result lands over it. Tapping it re-opens the picker. */
               <div className="ws-stageresult">
                 <div className="ws-stagemedia ws-stagemedia-edit" role="button" tabIndex={0}
                   onClick={() => { if (!(making || busy)) stageUploadRef.current?.click(); }}
                   onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !(making || busy)) { e.preventDefault(); stageUploadRef.current?.click(); } }}>
                   <img src={editPreview} alt={t("Your photo")}
                     onLoad={(e) => { const el = e.currentTarget; if (el.naturalWidth && el.naturalHeight) setStageAspect(el.naturalWidth / el.naturalHeight); }} />
                 </div>
                 <div className="ws-verbs">
                   <span className="ws-editcap">{making || busy ? t("Editing your photo…") : editPreview2 ? t("Describe how to combine them, then Make") : t("Describe your edits, then Make")}</span>
                   {!(making || busy) && (
                     <button type="button" className="ws-verb" onClick={() => { setEditPreview((p) => { if (p) { try { URL.revokeObjectURL(p); } catch { /* */ } } return null; }); setEditFile(null); setHasFile(false); clearPhoto2(); }}>✕ {t("Remove")}</button>
                   )}
                 </div>
                 {/* Two-photo combine: add a second photo and describe how to merge
                     them (e.g. "add the person from photo 2 into photo 1"). A
                     combine runs on the Ultra engine (16 tokens). */}
                 {!(making || busy) && (
                   <div className="ws-combine2">
                     {editPreview2 ? (
                       <div className="ws-combine2-has">
                         <img src={editPreview2} alt={t("Second photo")} />
                         <button type="button" className="ws-combine2-x" onClick={clearPhoto2} aria-label={t("Remove second photo")}><Ico n="x" size={12} /></button>
                         <span className="ws-combine2-lbl">{t("Photo 2 — say how to combine them below")}</span>
                       </div>
                     ) : (
                       <button type="button" className="ws-combine2-add" onClick={() => stageUpload2Ref.current?.click()}>
                         <Ico n="upload" size={15} /> {t("Add a 2nd photo to combine or cross-edit")}
                       </button>
                     )}
                   </div>
                 )}
               </div>
             ) : (casual && tab === "video" && uploadPreview) ? (
               /* A photo attached in the VIDEO flow SEEDS the video (image-to-
                  video). Show it ON the Stage so it's clearly part of the video —
                  not shunted off to the image editor (beta feedback). */
               <div className="ws-stageresult">
                 <div className="ws-stagemedia ws-stagemedia-edit" role="button" tabIndex={0}
                   onClick={() => { if (!(making || busy)) stageUploadRef.current?.click(); }}
                   onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !(making || busy)) { e.preventDefault(); stageUploadRef.current?.click(); } }}>
                   <img src={uploadPreview} alt={t("Your photo")}
                     onLoad={(e) => { const el = e.currentTarget; if (el.naturalWidth && el.naturalHeight) setStageAspect(el.naturalWidth / el.naturalHeight); }} />
                 </div>
                 <div className="ws-verbs">
                   <span className="ws-editcap">{making || busy ? t("Making your video…") : t("This photo becomes your video — describe the motion, then Make")}</span>
                   {!(making || busy) && (
                     <button type="button" className="ws-verb" onClick={() => { clearUpload(); setProdSource(null); }}>✕ {t("Remove")}</button>
                   )}
                 </div>
               </div>
             ) : (
               <div className={`ws-easelph ws-easelph-drop${(making || busy) ? " making" : ""}`}
                 role="button" tabIndex={0} aria-label={(casual && tab === "video") ? t("Drop or upload a photo to animate") : t("Drop or upload a photo to edit")}
                 onClick={() => { if (!(making || busy)) stageUploadRef.current?.click(); }}
                 onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !(making || busy)) { e.preventDefault(); stageUploadRef.current?.click(); } }}
                 onDragOver={(e) => { if (making || busy) return; e.preventDefault(); e.currentTarget.classList.add("drag"); }}
                 onDragLeave={(e) => e.currentTarget.classList.remove("drag")}
                 onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("drag"); if (!(making || busy)) onStagePhoto(e.dataTransfer.files?.[0]); }}>
                 <span className="ws-easel-mark" aria-hidden="true">
                   <span className="ws-rose" />
                   {!(making || busy) && (
                     <span className="ws-dropplus">
                       <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5.4v13.2M5.4 12h13.2" /></svg>
                     </span>
                   )}
                 </span>
                 <div className="ws-easel-cap">{(making || busy) ? t("Making your {noun}…", { noun: t(makingNounRef.current || noun) }) : (casual && tab === "video") ? t("Add a photo to animate, or just describe your video") : t("Add a photo, or make one")}</div>
                 <div className="ws-easel-sub">{(making || busy) ? t("This takes a few minutes — it'll land right here.") : (casual && tab === "video") ? t("Tap to upload or drop a photo to turn into a video — or just describe it below.") : t("Tap to upload or drop a photo to edit — or just describe what you want below.")}</div>
                 {/* Without a plan the Stage still invites a photo, but nothing can
                     be made — say so here (not only at the button), so the lock
                     is visible on the canvas the merchant is looking at. */}
                 {!d.hasPlan && !(making || busy) && (
                   <div className="ws-easel-lock"><Ico n="lock" size={13} /> {t("Your free trial unlocks every maker — ")}<Link to="/web#plans">{t("pick a plan")}</Link>{t(" to make this.")}</div>
                 )}
               </div>
             )}
           </div>
           {/* RESULT CONTROLS — everything lives in its OWN area UNDER the photo
               (nothing is painted on top of the image any more): the quick-edit
               picker first, then the download/make-another/clear actions. */}
           {stageResult && (
             <div className="ws-resultctl">
               {!stageResult.isVideo && !stageResult.isAudio && (
                 <div className="ws-qedit">
                   <div className="ws-qedit-h">
                     <span className="ws-qedit-t">{t("Quick edit")}</span>
                     <span className="ws-qedit-sub">{t("{n} tokens each", { n: d.costs.quickEdit })}</span>
                   </div>
                   <div className="ws-qedit-chips" role="radiogroup" aria-label={t("Quick edit type")}>
                     {QUICK_OPS.map((o) => (
                       <button key={o.key} type="button" role="radio" aria-checked={quickSel === o.key}
                         className={`ws-qchip${quickSel === o.key ? " on" : ""}`} disabled={making || busy}
                         onClick={() => setQuickSel((s) => (s === o.key ? null : o.key))}>
                         <Ico n={o.icon} size={15} /> {o.label}
                       </button>
                     ))}
                   </div>
                   <button type="button" className="wb-btn ws-qedit-go" disabled={!quickSel || making || busy}
                     onClick={() => { const o = QUICK_OPS.find((x) => x.key === quickSel); if (o) quickEdit(o.op, o.dir); }}>
                     {(making || busy)
                       ? t("Applying your edit…")
                       : quickSel
                         ? t("Apply {label}", { label: QUICK_OPS.find((o) => o.key === quickSel)?.label || "" })
                         : t("Pick an edit above to apply")}
                   </button>
                 </div>
               )}
               <div className="ws-verbs">
                 <button type="button" className="ws-verb gold" onClick={() => downloadMedia(stageResult.media)}>⤓ {t("Download")}</button>
                 <button type="button" className="ws-verb" onClick={() => makeBtnRef.current?.click()}>↻ {t("Make another")}</button>
                 <Link className="ws-verb" to="/web/archive?section=creator">{t("Open gallery")}</Link>
                 <button type="button" className="ws-verb" onClick={() => setStageResult(null)}>✕ {t("Clear")}</button>
               </div>
             </div>
           )}
           <input ref={stageUploadRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={(e) => onStagePhoto(e.currentTarget.files?.[0])} />
           <input ref={stageUpload2Ref} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={(e) => takePhoto2(e.currentTarget.files?.[0])} />
         </aside>
       )}
      </div>

      {casual && d.recent.length > 0 && (
        <section className="ws-shelf">
          <div className="ws-shelf-h"><b>{t("Your creations")}</b><Link to="/web/archive?section=creator" className="ws-shelf-all">{t("Open gallery")} ›</Link></div>
          <div className="ws-shelf-strip">
            {d.recent.map((p) => (
              <button type="button" onClick={() => p.media && loadToStage({ id: p.id, isVideo: p.isVideo, isAudio: p.isAudio, media: p.media, title: p.title })} key={p.id} className="ws-shelf-piece" title={t("{title} — open on the Stage", { title: p.title })}>
                <span className="ws-shelf-thumb" style={!p.isVideo && !p.isAudio && p.media ? { backgroundImage: `url(${p.media})` } : undefined}>
                  {p.isVideo && p.media ? <video src={`${p.media}#t=0.1`} muted playsInline preload="metadata" /> : null}
                  {p.isAudio ? <span className="ws-shelf-aud" aria-hidden="true"><Ico n="music" size={26} /></span> : null}
                  <span className="ws-shelf-tag">{p.isVideo ? <>▶ {t("Video")}</> : p.isAudio ? t("Music") : t("Image")}</span>
                </span>
                <span className="ws-shelf-pt">{p.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {forgeOpen && (
        <div className="ws-scrim" onClick={closeForge}>
          <div ref={forgeDialogRef} className="ws-forgem" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <button type="button" className="ws-forgem-x" onClick={closeForge} aria-label={t("Close")}><Ico n="x" size={16} /></button>
            {forging ? (
              forgeFetcher.data?.avatarError ? (
                <div className="ws-forgem-done">
                  <span className="ws-forgem-bad"><Ico n="warning" size={26} /></span>
                  <b>{t("Couldn't start the forge")}</b>
                  <p>{String(forgeFetcher.data.avatarError)}</p>
                  <button type="button" className="wb-btn ws-forgem-go" onClick={() => setForging(false)}>{t("Try again")}</button>
                </div>
              ) : forgeFetcher.data?.avatarQueued && forgeFetcher.state === "idle" ? (
                <div className="ws-forgem-done">
                  <span className="ws-forgem-check"><Ico n="check" size={30} /></span>
                  <b>{t("{name} is on the way!", { name: String(forgeFetcher.data.avatarQueued) })}</b>
                  <p>{t("We're forging four outfits — about a minute. Your new presenter appears in your presenter list when it's ready; keep creating in the meantime.")}</p>
                  <button type="button" className="wb-btn ws-forgem-go" onClick={() => { setForgeOpen(false); setForging(false); setAvatarName(""); setAvatarFile(null); setAvatarDesc(""); setAvatarEnergy("warm"); }}>{t("Got it")}</button>
                </div>
              ) : (
                <div className="ws-forgem-done">
                  <span className="ws-forge-spin ws-forgem-spin" aria-hidden="true" />
                  <b>{t("Forging {name}…", { name: avatarName.trim() || t("your presenter") })}</b>
                  <p>{t("Hang tight — setting up your presenter.")}</p>
                </div>
              )
            ) : (
              <>
                <div className="ws-forgem-h">
                  <span className="ws-forgem-crest"><Ico n="wand" size={20} /></span>
                  <div>
                    <b>{t("Create your own presenter")}</b>
                    <span>{t("Upload your logo, mascot or spokesperson — we forge them into a presenter with four outfits, ready to star in your videos. Yours alone.")}</span>
                  </div>
                </div>
                <input className="wb-in ws-forgem-nm" placeholder={t("Presenter name (e.g. your mascot)")}
                  value={avatarName} onChange={(e) => setAvatarName(e.target.value)} maxLength={40} />
                <label className={`ws-forgem-up${avatarPreview ? " has" : ""}`}>
                  <input type="file" accept="image/*" onChange={(e) => setAvatarFile(e.target.files?.[0] || null)} hidden />
                  {avatarPreview
                    ? <><span className="ws-forgem-thumb" style={{ backgroundImage: `url(${avatarPreview})` }} aria-hidden="true" /><span>{t("Photo added — tap to change")}</span></>
                    : <><Ico n="upload" size={18} /><span>{t("Upload a photo")}</span></>}
                </label>
                <div className="ws-seg ws-forgem-seg">
                  {([["m", "He"], ["f", "She"]] as [string, string][]).map(([g, label]) => (
                    <button type="button" key={g} className={avatarGender === g ? "sel" : ""}
                      onClick={() => { setAvatarGender(g); setAvatarVoice(DEFAULT_AVATAR_VOICE[g as "f" | "m"]); }}>{t(label)}</button>
                  ))}
                </div>
                <div className="ws-forgem-lbl">{t("Voice")}<span>{t("tap ▶ to hear it")}</span></div>
                <VoicePicker gender={avatarGender === "f" ? "f" : "m"} value={avatarVoice} onChange={setAvatarVoice} />
                <div className="ws-forgem-lbl">{t("Vibe")}</div>
                <div className="ws-seg ws-forgem-seg">
                  {([["warm", "Warm"], ["hype", "Energetic"], ["calm", "Chill"]] as [string, string][]).map(([e, label]) => (
                    <button type="button" key={e} className={avatarEnergy === e ? "sel" : ""} onClick={() => setAvatarEnergy(e)}>{t(label)}</button>
                  ))}
                </div>
                <textarea className="wb-in ws-forgem-desc" rows={2} maxLength={200}
                  placeholder={t("Describe your character (optional) — e.g. a friendly green monster mascot")}
                  value={avatarDesc} onChange={(e) => setAvatarDesc(e.target.value)} />
                <CharCount value={avatarDesc} max={200} />
                {!d.caps.includes("video") && (
                  <p className="ws-forgem-gate">{t("Custom presenters need a plan with video — Studio and up.")}</p>
                )}
                <button type="button" className="wb-btn ws-forgem-go" disabled={forgeFetcher.state !== "idle" || !avatarName.trim() || !avatarFile}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("intent", "forgeAvatar");
                    fd.set("avatarName", avatarName.trim());
                    fd.set("avatarGender", avatarGender);
                    fd.set("avatarVoice", avatarVoice);
                    fd.set("avatarEnergy", avatarEnergy);
                    fd.set("avatarDesc", avatarDesc.trim());
                    if (avatarFile) fd.set("avatarPhoto", avatarFile);
                    forgeFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
                    setForging(true);
                  }}>
                  <Ico n="wand" size={16} /> {t("Forge my presenter")} · {d.costs.avatarForge} {t("tokens")}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {manageOpen && <ManagePresenters presenters={d.myPresenters} onClose={() => setManageOpen(false)} />}

      {showDone && queued && (
        <div className="ws-scrim" onClick={() => setShowDone(false)}>
          <div ref={doneDialogRef} className="ws-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <span className="ws-mrose" aria-hidden />
            {/* The flex: crest, wordmark, gold rule. A stock sparkle emoji is
                the one thing on screen that isn't ours — this is the moment
                the merchant just paid for, so put our name on it. */}
            <div className="ws-flex" aria-hidden="true">
              <span className="ws-flex-crest"><img src="/easymode-head.png?v=2" alt="" /></span>
              <span className="ws-flex-word">Easy<b>Mode</b></span>
              <span className="ws-flex-rule" />
            </div>
            <b className="ws-mh">{queuedCount > 1 ? t("Your {n} {queued}s are being made", { n: queuedCount, queued }) : t("Your {queued} is being made", { queued: queued === "faceless" ? t("faceless video") : queued })}</b>
            <p className="ws-mp">{queuedCount > 1 ? <>{t("They land in your ")}<b>{casual ? t("gallery") : t("Archive")}</b>{t(" over the next few minutes — a set of different takes, all ready to ")}{casual ? t("share") : t("post")}.</> : <>{t("It lands in your ")}<b>{casual ? t("gallery") : t("Archive")}</b>{t(" in a few minutes — along with everything else EasyMode builds for you.")}</>}</p>
            <Link className="wb-btn ws-mcta" to={`/web/archive?tab=${queued === "article" ? "blog" : queued === "faceless" ? "video" : queued}${casual ? "&section=creator" : ""}`}>{casual ? <>{t("View gallery")} ›</> : <>{t("View Archive")} ›</>}</Link>
            <button type="button" className="ws-mclose" onClick={() => setShowDone(false)}>{t("Make another")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function needsPresenterField(ct: CType | null): boolean {
  // talkinghead is a presenter-to-camera format (base avatar, serviceForced, no
  // product) — it was MISSING here, so the chosen presenter's avatarId was never
  // submitted and the job fell through to the presenter-less product pipeline
  // instead of generateUgcAd. Including it makes the talking head actually use
  // the merchant's presenter.
  return ct === "avatar" || ct === "talkinghead" || ct === "cartoon" || ct === "jingle" || ct === "review";
}

/* Route-local styles — GStyle palette (paper #F4F1E6, card #FDFCF7, ink
 * #14201A, green #12A85E, gold #B08526/#E7C879), extending the ws-* look
 * that lives in the /web layout. */
const WS_STYLE = `
/* Search above the presenter row — typing a name beats scrubbing 100 faces. */
.ws-castsearch{position:relative;margin:0 0 8px}
.ws-castsearch .wb-in{width:100%;padding-right:34px}
.ws-cs-clr{position:absolute;top:50%;right:8px;transform:translateY(-50%);width:22px;height:22px;border-radius:50%;border:0;background:var(--paper,#F4F1E6);color:var(--ink2,#4A554E);font-size:11px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0}
/* Forging buffer — the shape of what's coming, so the wait looks like work. */
.ws-forge{margin:14px 0 4px;padding:13px 14px;border-radius:14px;background:var(--paper,#F4F1E6);border:1px solid var(--line,#E4DFCF)}
.ws-forge-hd{display:flex;gap:11px;align-items:flex-start;margin-bottom:12px}
.ws-forge-hd b{display:block;font-size:13.5px;color:var(--ink,#14201A)}
.ws-forge-hd span{display:block;font-size:12px;color:var(--ink2,#4A554E);margin-top:2px}
.ws-forge-spin{flex:0 0 auto;width:16px;height:16px;margin-top:2px;border-radius:50%;border:2px solid rgba(18,168,94,.25);border-top-color:var(--green2);animation:wsforgespin .8s linear infinite}
@keyframes wsforgespin{to{transform:rotate(360deg)}}
.ws-forge-row{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}
.ws-forge-card{animation:wsforgepulse 1.5s ease-in-out infinite;text-align:center}
@keyframes wsforgepulse{0%,100%{opacity:.45}50%{opacity:1}}
.ws-forge-img{display:block;width:100%;aspect-ratio:3/4;border-radius:11px;border:1px dashed var(--line,#E4DFCF);
  background:linear-gradient(100deg,rgba(18,168,94,.05) 30%,rgba(18,168,94,.16) 50%,rgba(18,168,94,.05) 70%) 0 0/280% 100%;
  animation:wsforgeshim 1.5s linear infinite}
@keyframes wsforgeshim{to{background-position:-280% 0}}
.ws-forge-nm{display:block;margin-top:5px;font-size:10.5px;font-weight:700;color:var(--ink2,#4A554E)}
.ws-forge-bad{border-color:#D9A2A2;background:#FDF4F4}
.ws-forge-bad b{display:block;font-size:13.5px;color:#8C2F2F}
.ws-forge-bad span{display:block;font-size:12px;color:var(--ink2,#4A554E);margin-top:3px}
@media (prefers-reduced-motion:reduce){
  .ws-forge-spin,.ws-forge-card,.ws-forge-img{animation:none}
  .ws-forge-card{opacity:.7}
  /* Catalog-sync spinner — stop the spin, keep the dot. */
  .ws-catload-spin{animation:none}
  /* Format/create tile entrance stagger — the inline animationDelay only
     matters because the shared class animates; kill both so nothing drifts in.
     !important is needed to beat the inline animation-delay. */
  .ws-tiles .ws-tile,.ws-ctgrid .ws-tile,.ws-tiles.fmt .ws-tile{animation:none!important;animation-delay:0s!important}
  /* Hub-slide drawer + modal/lightbox entrances — show them instantly. */
  .ws-hub-reveal.open{animation:none}
  .ws-scrim,.ws-forgem,.ws-managem,.ws-modal,.ws-lightbox{animation:none}
  .ws-modal .ws-mrose,.ws-forgem-spin{animation:none}
}
.ws-face{position:relative}
.ws-face-pick{display:block;width:100%;border:0;background:none;padding:0;cursor:pointer;font:inherit;color:inherit;text-align:center}
/* HERO presenter tile — the selected presenter's intro plays here (bigger
   preview, no extra vertical space): autoplays with sound right after you pick
   one, muted on first load, with a sound toggle. The circle picker below just
   selects. */
.ws-hubhero .ws-hubtile-img{overflow:hidden}
.ws-hubtile-vid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 58%;border-radius:inherit;display:block;background:#EAF6EF;z-index:0}
.ws-hubtile-face{position:absolute;inset:0;z-index:1;border:0;background:transparent;cursor:pointer;border-radius:inherit}
.ws-hubhero .ws-hubtile-badge{z-index:2;pointer-events:none}
.ws-hubtile-sound{position:absolute;left:8px;top:8px;z-index:3;width:34px;height:34px;border-radius:50%;border:0;background:rgba(12,18,14,.5);color:#fff;cursor:pointer;display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,.3);transition:background .14s}
.ws-hubtile-sound:hover{background:rgba(12,18,14,.72)}
.ws-hubtile-sound.on,.ws-hubtile-sound.on:hover{background:var(--green,#0C7A46)}
.ws-face.bf .ws-face-img{border-color:var(--gold);box-shadow:0 0 0 2px rgba(176,133,38,.35)}
.ws-face.bf>span:last-child{color:var(--gold-deep);font-weight:700}
/* "Create your own" — the forge promoted to a hero tile at the head of the
   presenter strip (dashed-green, reads as "add"), opening the forge modal. */
.ws-face-create{color:var(--green,#0C7A46)}
.ws-face-create .ws-face-img.create{display:grid;place-items:center;border:2px dashed var(--green,#0C7A46);background:#F3F9F4;color:var(--green,#0C7A46);transition:background .14s}
.ws-face-create:hover .ws-face-img.create{background:#E6F3EC}
.ws-face-create>span:last-child{color:var(--green,#0C7A46);font-weight:700}
/* The forge modal (opened from the picker). Sits in the shared .ws-scrim. */
.ws-forgem{position:relative;width:min(400px,92vw);background:var(--card,#FDFCF7);border-radius:18px;padding:22px 20px 20px;box-shadow:0 24px 70px rgba(8,12,10,.4);animation:ws-lb-in .16s ease}
.ws-forgem-x{position:absolute;top:12px;inset-inline-end:12px;width:32px;height:32px;border-radius:50%;border:0;background:var(--paper,#F4F1E6);color:var(--ink2,#4A554E);cursor:pointer;display:grid;place-items:center;padding:0}
.ws-forgem-h{display:flex;gap:12px;align-items:flex-start;margin:2px 26px 16px 0}
.ws-forgem-crest{flex:0 0 auto;width:38px;height:38px;border-radius:11px;display:grid;place-items:center;background:#F3F9F4;color:var(--green,#0C7A46)}
.ws-forgem-h b{display:block;font-size:15px;color:var(--ink,#14201A)}
.ws-forgem-h span{display:block;font-size:12.5px;line-height:1.45;color:var(--ink2,#4A554E);margin-top:3px}
.ws-forgem-nm{width:100%;margin-bottom:10px}
.ws-forgem-up{display:flex;align-items:center;gap:9px;width:100%;padding:12px 14px;border-radius:12px;border:1.5px dashed var(--green,#0C7A46);background:#F3F9F4;color:var(--green,#0C7A46);font-weight:700;font-size:13px;cursor:pointer;margin-bottom:10px}
.ws-forgem-up span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-forgem-seg{margin-bottom:12px}
.ws-forgem-gate{font-size:12px;color:#8a5a12;background:#FDF4E3;border:1px solid #E8D3A6;border-radius:9px;padding:8px 11px;margin:0 0 10px}
.ws-forgem-err{font-size:12.5px;color:#8C2F2F;background:#FDF4F4;border:1px solid #D9A2A2;border-radius:9px;padding:8px 11px;margin:0 0 10px}
.ws-forgem-go{display:flex;align-items:center;justify-content:center;gap:8px;width:100%}
/* Forge progress view: spinner → confirmation (or error), so Forge never
   silently closes with no feedback. */
.ws-forgem-done{display:flex;flex-direction:column;align-items:center;text-align:center;gap:11px;padding:16px 6px 6px}
.ws-forgem-done b{font-size:16px;color:var(--ink,#14201A)}
.ws-forgem-done p{font-size:12.5px;line-height:1.5;color:var(--ink2,#4A554E);margin:0 2px}
.ws-forgem-done .ws-forgem-go{margin-top:5px}
.ws-forgem-spin{width:30px;height:30px;border-width:3px;margin:6px auto 2px}
.ws-forgem-check{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:#E9F5EE;color:var(--green,#0C7A46)}
.ws-forgem-bad{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:#FDF4F4;color:#8C2F2F}
/* "Manage" tile in the presenter strip — neutral ink vs the green "create". */
.ws-face-manage{color:var(--ink2,#4A554E)}
.ws-face-manage .ws-face-img.manage{display:grid;place-items:center;border:2px solid var(--line,#E4DFCF);background:var(--paper,#F4F1E6);color:var(--ink2,#4A554E);transition:background .14s}
.ws-face-manage:hover .ws-face-img.manage{background:#EFEADB}
.ws-face-manage>span:last-child{color:var(--ink2,#4A554E);font-weight:700}
/* Forge modal is taller now (voice + vibe + describe) and the Manage modal is a
   list — both scroll inside the viewport on small screens. */
.ws-forgem,.ws-managem{max-height:90vh;overflow:auto}
.ws-forgem-thumb{flex:0 0 auto;width:30px;height:30px;border-radius:8px;background:#fff center/cover no-repeat;box-shadow:inset 0 0 0 1px rgba(12,18,14,.12)}
.ws-forgem-up.has{border-style:solid;border-color:var(--green2,#1FA463);background:#EFF8F1}
.ws-forgem-lbl{display:flex;align-items:baseline;gap:8px;font-weight:700;font-size:12px;color:var(--ink,#14201A);margin:4px 0 7px}
.ws-forgem-lbl span{font-weight:500;font-size:11px;color:var(--ink2,#4A554E)}
.ws-forgem-desc{width:100%;margin:10px 0 2px;resize:vertical;min-height:40px;font-family:inherit}
/* Voice picker — a scroll-capped column of (pick label + ▶ preview) rows. */
.ws-vp{display:flex;flex-direction:column;gap:7px;max-height:188px;overflow-y:auto;margin-bottom:12px;padding-right:2px}
.ws-vp-chip{display:flex;align-items:stretch;gap:0;border:1px solid var(--line,#E4DFCF);border-radius:12px;background:var(--card,#FDFCF7);overflow:hidden;transition:border-color .12s,box-shadow .12s,background .12s}
.ws-vp-chip.sel{border-color:var(--green2,#1FA463);box-shadow:0 0 0 1px var(--green2,#1FA463);background:#F0FAF4}
.ws-vp-pick{flex:1 1 auto;display:flex;align-items:center;gap:8px;min-width:0;text-align:left;border:0;background:transparent;padding:10px 11px;cursor:pointer}
.ws-vp-pick b{flex:0 0 auto;font-size:13px;color:var(--ink,#14201A)}
.ws-vp-blurb{flex:1 1 auto;min-width:0;font-style:normal;font-size:11.5px;color:var(--ink2,#4A554E);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-vp-tick{flex:0 0 auto;font-style:normal;color:var(--green,#0C7A46);font-size:12px}
.ws-vp-play{flex:0 0 auto;width:42px;border:0;border-left:1px solid var(--line,#E4DFCF);background:#F3F9F4;color:var(--green,#0C7A46);font-size:12px;cursor:pointer;display:grid;place-items:center;transition:background .12s}
.ws-vp-play:hover{background:#E6F3EC}
.ws-vp-play.on{background:var(--green,#0C7A46);color:#fff}
/* Manage modal rows: head (thumb · name · Voice · delete), then optional voice
   editor / delete-confirm. */
.ws-managem{position:relative;width:min(440px,94vw);background:var(--card,#FDFCF7);border-radius:18px;padding:22px 20px 20px;box-shadow:0 24px 70px rgba(8,12,10,.4);animation:ws-lb-in .16s ease}
.ws-mp-list{display:flex;flex-direction:column;gap:9px}
.ws-mp-row{border:1px solid var(--line,#E4DFCF);border-radius:13px;background:var(--paper,#F4F1E6);padding:9px 10px}
.ws-mp-head{display:flex;align-items:center;gap:10px}
.ws-mp-img{flex:0 0 auto;width:38px;height:38px;border-radius:9px;background:#fff center/cover no-repeat;box-shadow:inset 0 0 0 1px rgba(12,18,14,.12)}
.ws-mp-nm{flex:1 1 auto;font-size:13.5px;font-weight:700;color:var(--ink,#14201A);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-mp-act{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;padding:7px 11px;border-radius:10px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink2,#4A554E);font-weight:700;font-size:12px;cursor:pointer}
.ws-mp-act.on{border-color:var(--green2,#1FA463);color:var(--green,#0C7A46);background:#F0FAF4}
.ws-mp-act.danger{color:#8C2F2F}
.ws-mp-act.danger:hover{background:#FDF4F4;border-color:#D9A2A2}
.ws-mp-act:disabled{opacity:.5;cursor:default}
.ws-mp-warn{display:flex;align-items:center;gap:9px;font-size:12px;color:#8C2F2F;margin:8px 2px 2px}
.ws-mp-undo{margin-left:auto;padding:5px 11px;border-radius:9px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink,#14201A);font-weight:700;font-size:12px;cursor:pointer}
.ws-mp-voice{margin-top:9px}
.ws-mp-voice .ws-vp{max-height:168px;margin-bottom:9px}
.ws-mp-save{width:100%}
.ws-vscrim{position:fixed;inset:0;z-index:10600;background:rgba(12,18,14,.6);backdrop-filter:blur(3px);display:grid;place-items:center;padding:20px}
.ws-vbox{position:relative;width:min(420px,92vw)}
.ws-video{width:100%;border-radius:16px;display:block;background:#000;box-shadow:0 18px 60px rgba(0,0,0,.4)}
.ws-vx{position:absolute;top:-10px;inset-inline-end:-10px;width:30px;height:30px;border-radius:50%;border:0;background:var(--card);color:var(--ink);font-size:14px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.ws-setbf{display:inline-block;margin:2px 0 6px;padding:8px 14px;border-radius:999px;border:1px solid #E7C879;background:#FFFBEF;color:var(--gold-deep);font-weight:700;font-size:12.5px;cursor:pointer}
.ws-seg{display:flex;gap:8px;flex-wrap:wrap}
.ws-seg button{padding:9px 14px;border-radius:11px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink2,#4A554E);font-weight:700;font-size:12.5px;cursor:pointer}
.ws-seg button.sel{border-color:var(--green2);box-shadow:0 0 0 1px var(--green2);color:var(--ink,#14201A);background:#F0FAF4}
/* CREATOR "upload a video to edit it" — the edit panel + its entry affordance. */
.ws-vedit{display:flex;flex-direction:column;gap:10px}
.ws-vedit-prev{width:100%;max-height:300px;border-radius:13px;background:#000;display:block}
.ws-vedit-op,.ws-vedit-speed{margin-top:2px}
.ws-vedit-trim{display:flex;gap:10px;flex-wrap:wrap}
.ws-vedit-num{display:flex;flex-direction:column;gap:4px;flex:1 1 120px;min-width:0;font-size:11.5px;font-weight:700;color:var(--ink2,#4A554E)}
.ws-vedit-num .wb-in{width:100%}
.ws-vedit-remove{align-self:flex-start}
.ws-vedit-entry{margin-top:10px;background:none;border:0;padding:4px 0;color:var(--green,#0C7A46);font-weight:700;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.ws-vedit-entry:hover{text-decoration:underline}
.ws-wq{font-weight:500;font-size:11px;color:var(--ink2,#4A554E)}
.ws-svchint{font-size:12.5px;color:var(--ink2,#4A554E);background:var(--paper,#F4F1E6);border:1px solid var(--line,#E4DFCF);border-radius:12px;padding:10px 13px;margin:8px 0 0}
/* Shared semantic inline-message colors — one red, one amber — so combine /
   import / photo-nudge notes stop hard-coding their own hex. Paired with
   .ws-note for sizing/spacing. */
.ws-err{color:#9A3120}
.ws-warn{color:#8A5A12}
/* Live char counter under the big describe/direction textareas — subtle, right
   aligned; amber as you approach the limit so silent truncation is visible. */
.ws-charcount{display:block;text-align:right;margin:4px 2px 0;font-size:11px;font-weight:600;color:var(--ink2,#8A968E);font-variant-numeric:tabular-nums}
.ws-charcount.near{color:#8A5A12}
.ws-autobox{font-size:13px;color:var(--ink,#14201A);background:var(--paper,#F4F1E6);border:1px dashed var(--gold);border-radius:12px;padding:11px 14px;margin:2px 0 8px}
.ws-3w{display:flex;flex-direction:column;gap:10px;margin-top:2px}
.ws-w{display:block;font-size:12px;font-weight:700;color:var(--ink,#14201A);margin-bottom:5px}
.ws-ta{min-height:74px;resize:vertical;font:inherit;width:100%}
/* The "describe anything" hero box — the DeepAI-style text-to-create input for
   Make an image / Make music / Faceless. Bigger, softer, with a green focus ring. */
.ws-hero{min-height:112px;font-size:16px;line-height:1.45;padding:14px 15px;border-radius:14px;border:1.5px solid var(--line,#E1DECD);background:#fff;box-shadow:0 1px 2px rgba(20,32,26,.05);transition:border-color .12s,box-shadow .12s}
.ws-hero:focus{outline:none;border-color:var(--green2);box-shadow:0 0 0 3px rgba(18,168,94,.16)}
.ws-hero::placeholder{color:#9AA69E}
/* Format category chips — turn a 40-tile wall into a short, browsable menu.
   Wrap on desktop (all chips fit); scroll sideways on a phone so they never
   stack three rows deep above the tiles. */
.ws-fmtcats{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}
.ws-fmtcat{padding:8px 14px;border-radius:999px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink2,#4A554E);font-weight:700;font-size:12.5px;line-height:1;white-space:nowrap;cursor:pointer}
.ws-fmtcat:hover{border-color:#9CCBB1}
.ws-fmtcat.sel{border-color:var(--green2);box-shadow:0 0 0 1px var(--green2);background:#F0FAF4;color:var(--ink,#14201A)}
.ws-fmtcats.ws-pills2{display:grid;grid-template-columns:1fr 1fr;gap:8px;overflow:visible}
.ws-pills2 .ws-fmtcat{width:100%;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:9px 12px}
.ws-fmthint{margin:-4px 0 10px;font-size:12.5px;color:var(--ink2,#4A554E)}
.ws-fmtsel{display:flex;align-items:center;gap:8px;margin:0 0 11px;font-size:12.5px;color:var(--ink2,#4A554E)}
.ws-fmtsel b{color:var(--green);font-size:12.5px}
.ws-fmtsel button{width:20px;height:20px;border-radius:50%;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink2,#4A554E);font-size:10px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0}
.ws-fmtsel button:hover{border-color:var(--green2);color:var(--green2)}
@media (max-width:620px){
  .ws-fmtcats{flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;padding-bottom:4px;scrollbar-width:none}
  .ws-fmtcats::-webkit-scrollbar{display:none}
}
.ws-chips{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 4px}
.ws-chip{padding:8px 13px;border-radius:999px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink,#14201A);font-weight:600;font-size:12.5px;cursor:pointer}
.ws-chip.sel{border-color:var(--green2);box-shadow:0 0 0 1px var(--green2);background:#F0FAF4}
.ws-lastchip{display:block;margin:0 0 8px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.ws-import{display:flex;gap:8px;margin-bottom:8px}
/* Burst — make several at once rather than tapping generate over and over. */
.ws-burst{margin-top:14px;padding:11px 13px;border-radius:13px;background:var(--paper,#F4F1E6);border:1px solid var(--line,#E4DFCF)}
.ws-burst-lbl{display:block;font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink2,#4A554E);margin-bottom:7px}
.ws-burst-steps{display:flex;gap:10px;flex-wrap:wrap}
/* 44px min target — these pick how many PAID renders fire, so a mis-tap on a
   phone costs real tokens; they were 31px tall and 7px apart. */
.ws-burst-steps button{min-height:44px;min-width:56px;padding:11px 18px;border-radius:999px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink2,#4A554E);font:inherit;font-size:13px;font-weight:700;cursor:pointer}
.ws-burst-steps button.sel{border-color:var(--green2);box-shadow:0 0 0 1px var(--green2);background:#F0FAF4;color:var(--ink,#14201A)}
.ws-burst-note{margin:8px 0 0;font-size:12px;color:var(--ink2,#4A554E)}
/* Import tab: the setup surface — pull the catalogue in, forge a presenter. */
.ws-import-tab{padding:2px 0 6px}
.ws-import-tab .ws-import{flex-wrap:wrap}
.ws-import-tab .ws-import .wb-in{flex:1 1 220px;min-width:0}
.ws-avatarforge input[type=file]{padding:9px 10px;font-size:13px}
.ws-import input{flex:1;min-width:0}
.ws-impbtn{padding:9px 18px;font-size:13px;flex:0 0 auto}
.ws-addurl{border:0;background:none;color:var(--green);font-weight:700;font-size:12px;cursor:pointer;padding:0;margin-left:auto}
.ws-uploadown{margin:7px 0 2px;display:inline-flex;align-items:center;gap:6px;font-size:12.5px;padding:6px 11px;border:1px dashed #BFE2CD;border-radius:9px;background:#F0FAF4;}
.ws-uploadown svg{flex:0 0 auto}
/* Product-source chooser — two side-by-side cards (store vs upload). */
.ws-srcpick{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:4px 0 12px}
.ws-srccard{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;padding:13px 14px;border-radius:14px;border:1.5px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);cursor:pointer;transition:border-color .14s,background .14s,box-shadow .14s;min-height:44px}
.ws-srccard svg{color:var(--green);margin-bottom:3px}
.ws-srccard b{font-size:14px;color:var(--ink,#14201A);font-weight:700}
.ws-srccard span{font-size:11.5px;color:var(--ink2,#4A554E);line-height:1.3}
.ws-srccard:hover{border-color:#9CCBB1;background:#F3F9F4}
.ws-srccard.sel{border-color:var(--green);background:#EAF6EF;box-shadow:0 0 0 2px rgba(12,122,70,.14)}
.ws-uploadbox{margin:4px 0 2px}
/* Clean picker button replaces the raw <input type=file> chrome — tapping the
   "Upload a photo" card opens the OS picker, this is the in-branch fallback. */
.ws-uploadpick{display:inline-flex;align-items:center;gap:7px;width:100%;justify-content:center;padding:12px 16px}
.ws-uploadpick svg{color:#fff}
/* Hug the image (width:fit-content) so a portrait photo gets NO black pillar
   bars — the box is the photo's size, centered, on a light card ground. */
.ws-uppreview{position:relative;margin:9px auto 0;width:fit-content;max-width:100%;border-radius:12px;overflow:hidden;background:var(--card,#FDFCF7);border:1px solid var(--line,#E4DFCF)}
.ws-uppreview img{display:block;width:auto;max-width:100%;max-height:260px;object-fit:contain}
.ws-upclear{position:absolute;top:8px;inset-inline-end:8px;border:0;border-radius:999px;background:rgba(11,18,14,.72);color:#eafff4;font-size:11.5px;font-weight:700;padding:5px 11px;cursor:pointer}
.ws-upclear:hover{background:rgba(11,18,14,.9)}
@media (max-width:420px){.ws-srccard span{font-size:11px}}
/* Avatar-video hub — presenter + product as two tap-tiles; each picker reveals
   inline. .ws-hub-reveal is display:contents so wrapping the chooser changes no
   layout; the [hidden] rule MUST re-assert display:none, because author
   display:contents otherwise beats the UA [hidden]{display:none}. */
.ws-hub-reveal{display:contents}
.ws-hub-reveal[hidden]{display:none}
.ws-hub-reveal.open{display:block;animation:ws-hub-slide .22s ease}
@keyframes ws-hub-slide{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
.ws-hubtiles{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:6px 0 14px;position:relative}
/* Center style card (cartoon) — the picked animation style, overlapping the gap
   between the presenter + product tiles so it's always in view (replaces the
   top style grid). Tap it to slide the 6 styles open under the scene. */
.ws-stylecombo{position:absolute;left:50%;top:43%;transform:translate(-50%,-50%);z-index:6;display:flex;flex-direction:column;align-items:center;gap:7px}
/* Matches the presenter/product hub tiles (same border, green-bordered image +
   ✎ badge, "Tap to change" subtitle) — just smaller, and floating over the gap. */
.ws-stylecard{width:112px;display:flex;flex-direction:column;align-items:stretch;gap:7px;text-align:center;padding:8px 8px 10px;border-radius:16px;border:1.5px solid #9CCBB1;background:var(--card,#FDFCF7);box-shadow:0 9px 24px rgba(20,32,26,.22);cursor:pointer;transition:border-color .14s,background .14s,box-shadow .14s,transform .14s}
.ws-stylecard:hover{border-color:#9CCBB1;background:#F3F9F4;transform:scale(1.04);box-shadow:0 13px 30px rgba(20,32,26,.26)}
.ws-stylecard.open{border-color:var(--green,#0C7A46);background:#EAF6EF}
.ws-stylecard-ph{position:absolute;inset:0;display:grid;place-items:center;color:#C98A6E;background:linear-gradient(145deg,#FBEDE8,#F6E3DA);border-radius:inherit}
/* "needs selection" — a slight red glow on the style card + product tile until
   each is picked, so it's obvious one still needs choosing. */
.ws-needsel{border-color:#E08A72!important;box-shadow:0 0 0 2px rgba(214,98,70,.26),0 0 14px rgba(214,98,70,.22)!important;animation:ws-needpulse 1.9s ease-in-out infinite}
/* "all good" — a faint green glow once a slot IS filled (presenter/product/style). */
.ws-isgood{box-shadow:0 0 0 1.5px rgba(18,168,94,.3),0 0 12px rgba(18,168,94,.2)!important}
@keyframes ws-needpulse{0%,100%{box-shadow:0 0 0 2px rgba(214,98,70,.22),0 0 11px rgba(214,98,70,.17)}50%{box-shadow:0 0 0 2px rgba(214,98,70,.4),0 0 18px rgba(214,98,70,.3)}}
@media(prefers-reduced-motion:reduce){.ws-needsel{animation:none}}
.ws-stylecard-img{position:relative;width:100%;aspect-ratio:1/1;border-radius:12px;background:#EAF6EF center/cover no-repeat;border:1.5px solid var(--green,#0C7A46);display:grid;place-items:center}
.ws-setemoji{font-size:30px;line-height:1}
/* MOBILE: the center combo stops OVERLAPPING the tiles (busy on small screens) —
   it flows below them as a compact style + "+" + setting row spanning both cols. */
@media(max-width:620px){
  .ws-stylecombo{position:static;transform:none;grid-column:1/-1;display:flex;flex-direction:row;justify-content:center;align-items:center;margin:9px 0 0;gap:8px}
  .ws-stylecombo .ws-stylecard{width:auto;flex:1 1 0;min-width:0;max-width:150px}
  .ws-stylecombo-plus{flex:0 0 auto;width:24px;height:24px;font-size:17px}
}
.ws-stylecard-badge{position:absolute;right:5px;bottom:5px;width:24px;height:24px;border-radius:50%;background:var(--green,#0C7A46);color:#fff;font-size:13px;font-weight:800;line-height:1;display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,.3)}
.ws-stylecard b{font-size:13px;font-weight:800;color:var(--ink,#14201A);line-height:1.15}
.ws-stylecard>span:last-child{font-size:11px;color:var(--ink2,#4A554E);line-height:1.2}
/* the equation "+" under the card: presenter + product -> combined output */
.ws-stylecombo-plus{width:30px;height:30px;border-radius:50%;background:var(--gold-deep,#B08526);color:#fff;font-size:21px;font-weight:800;line-height:1;display:grid;place-items:center;box-shadow:0 4px 12px rgba(20,32,26,.3)}
@media(max-width:420px){.ws-stylecard{width:84px}}
/* min-width:0 is load-bearing: a grid item defaults to min-width:auto, so the
   nowrap <b> product name sets a large min-content width and 1fr can't shrink →
   horizontal overflow + the ellipsis never engages. min-width:0 lets it clip. */
.ws-hubtile{min-width:0;display:flex;flex-direction:column;align-items:stretch;gap:9px;text-align:center;padding:9px 9px 12px;border-radius:18px;border:1.5px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);cursor:pointer;transition:border-color .14s,background .14s,box-shadow .14s}
.ws-hubtile:hover{border-color:#9CCBB1;background:#F3F9F4}
.ws-hubtile.set{border-color:#9CCBB1}
.ws-hubtile.open{border-color:var(--green);background:#EAF6EF;box-shadow:0 0 0 2px rgba(12,122,70,.14)}
/* Image-forward hero tiles — the photo fills the card (the "create square" look)
   so the presenter + product carry themselves, no separate preview needed. */
.ws-hubtile-img{position:relative;width:100%;aspect-ratio:1/1;border-radius:14px;background:#EAF6EF center/cover no-repeat;border:1.5px dashed #9CCBB1;display:grid;place-items:center}
.ws-hubtile.set .ws-hubtile-img{border-style:solid;border-color:var(--green)}
.ws-hubtile-badge{position:absolute;right:7px;bottom:7px;width:30px;height:30px;border-radius:50%;background:var(--green);color:#fff;font-size:16px;font-weight:800;line-height:1;display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,.3)}
.ws-hubtile b{width:100%;font-size:14.5px;color:var(--ink,#14201A);font-weight:800;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ws-hubtile>span:last-child{font-size:11.5px;color:var(--ink2,#4A554E);line-height:1.25}
@media (max-width:420px){.ws-hubtile b{font-size:13.5px}.ws-hubtiles{gap:10px}}
/* The Combine panel IS the avatar-video scene step: tiles up top, pickers reveal
   inside, output + button below. .ws-scene scopes the in-panel spacing. */
.ws-combine.ws-scene{position:relative;overflow:hidden;margin-top:8px;padding:16px 15px}
.ws-combine.ws-scene>*{position:relative;z-index:1}
.ws-combine.ws-scene>.ws-hubtiles{margin:0 0 12px}
.ws-combine.ws-scene>.ws-lbl{margin-top:12px}
.ws-combine.ws-scene .ws-combine-stage{margin-top:12px}
/* Contain the combine OUTPUT — the loading/result stage, the Combine button and
   the Edit/Retry controls — to a tidy centered column (~photo width) instead of
   letting it span the full studio width. The presenter/product tiles above stay
   wide; this only reins in the "combination screen" below them. */
.ws-combine.ws-scene .ws-combine-stage,
.ws-combine.ws-scene .ws-combine-btn,
.ws-combine.ws-scene .ws-combine-foot,
.ws-combine.ws-scene .ws-combine-reuse,
.ws-combine.ws-scene .ws-combine-editrow{max-width:440px;margin-left:auto;margin-right:auto}
/* The Combine button is inline-block, so margin:auto can't center it — make it a
   block so it centers in the contained column (the flex foot/editrow already do). */
.ws-combine.ws-scene .ws-combine-btn{display:block;width:100%}
/* "Already have a shot?" — upload your own frame (the HERO) or reuse a past one. */
.ws-combine-reuse{margin-top:10px;text-align:center}
.ws-combine-reuse-lbl{display:block;font-size:11.5px;color:var(--ink2,#5b6b61);margin-bottom:7px}
/* HERO upload button — big, dashed, unmistakably an upload drop. */
.ws-reuse-upload{display:flex;width:100%;align-items:center;justify-content:center;gap:8px;border:1.5px dashed var(--green,#0C7A46);background:#F3F9F4;color:var(--green-deep,#0A3D26);font-family:Poppins,sans-serif;font-weight:800;font-size:13.5px;padding:13px 16px;border-radius:13px;cursor:pointer;box-sizing:border-box;transition:background .14s,border-color .14s}
.ws-reuse-upload:hover:not([disabled]){background:#E9F5EE;border-color:var(--green2,#12A85E)}
.ws-reuse-upload[disabled]{opacity:.55;cursor:not-allowed}
/* Past shots page SIDEWAYS with ‹ › arrows — a one-row strip that never grows
   the panel, with the whole archive reachable by paging. */
.ws-reuse-nav{display:flex;align-items:stretch;gap:5px;margin-top:8px}
.ws-reuse-arrow{flex:0 0 auto;width:26px;border:1px solid var(--line,#E1DECD);background:#fff;color:var(--ink,#14201A);border-radius:9px;cursor:pointer;font-size:18px;font-weight:700;line-height:1;display:grid;place-items:center;padding:0}
.ws-reuse-arrow:hover{background:#F3F9F4;border-color:var(--green,#12A85E)}
.ws-reuse-strip{flex:1 1 auto;min-width:0;display:flex;gap:7px;overflow-x:auto;overflow-y:hidden;flex-wrap:nowrap;padding:2px 2px 6px;scrollbar-width:thin;-webkit-overflow-scrolling:touch;scroll-behavior:smooth}
.ws-reuse-strip::-webkit-scrollbar{height:6px}
.ws-reuse-strip::-webkit-scrollbar-thumb{background:rgba(20,32,26,.2);border-radius:999px}
.ws-reuse-thumb{width:64px;height:64px;border-radius:11px;overflow:hidden;border:1px solid var(--line,#E1DECD);padding:0;cursor:pointer;background:#f3f1e4;flex:0 0 auto}
.ws-reuse-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.ws-reuse-thumb:hover:not([disabled]){border-color:var(--green,#12A85E);box-shadow:0 0 0 2px rgba(18,168,94,.2)}
.ws-reuse-thumb[disabled]{opacity:.5;cursor:not-allowed}
.ws-reuse-change{border:0;background:none;color:var(--green,#0C7A46);font-weight:700;font-size:11.5px;text-decoration:underline;cursor:pointer;padding:0;margin-left:6px}
.ws-reuse-change:hover{color:var(--green2,#12A85E)}
.ws-scene-svc{margin-top:14px;padding-top:12px;border-top:1px dashed var(--line,#E4DFCF)}
.ws-scene-look{margin-top:12px}
/* Spinning rosettes — the brand watermark, strategically placed: one drifting in
   the panel's top-right corner, one spinning behind the empty output stage so the
   "your presenter holding your product" placeholder has life. Reuses wsrosespin. */
.ws-combine.ws-scene::after{content:"";position:absolute;top:-58px;right:-66px;width:196px;height:196px;z-index:0;pointer-events:none;background:var(--green,#0C7A46);-webkit-mask:url(/gstyle-rosette.svg) center/contain no-repeat;mask:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.05;animation:wsrosespin 150s linear infinite}
.ws-combine.ws-scene .ws-combine-stage>*{position:relative;z-index:1}
.ws-combine.ws-scene .ws-combine-stage::before{content:"";position:absolute;top:50%;left:50%;width:168px;height:168px;margin:-84px 0 0 -84px;z-index:0;pointer-events:none;background:var(--green2,#12A85E);-webkit-mask:url(/gstyle-rosette.svg) center/contain no-repeat;mask:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.10;animation:wsrosespin 70s linear infinite}
.ws-combine.ws-scene .ws-combine-stage.has::before{display:none}
/* While combining, the rosette IS the buffer — it grows, brightens and pulses
   (and keeps spinning) so it reads as a loader, instead of a separate ring sitting
   on top of it. */
.ws-combine.ws-scene.combining .ws-combine-stage::before{width:210px;height:210px;margin:-105px 0 0 -105px;animation:wsrosespin 5s linear infinite,ws-rose-glow 1.5s ease-in-out infinite}
@keyframes ws-rose-glow{0%,100%{opacity:.16}50%{opacity:.46}}
@media (prefers-reduced-motion:reduce){.ws-combine.ws-scene::after,.ws-combine.ws-scene .ws-combine-stage::before,.ws-combine.ws-scene.combining .ws-combine-stage::before{animation:none;opacity:.3}}
/* The whole combining family — breathing border, the bouncing arrow, the src
   pulse, the pop-in, the working dots and the button shimmer — stilled too. */
@media (prefers-reduced-motion:reduce){.ws-combine.combining,.ws-combine.combining .ws-combine-to,.ws-combine.combining .ws-combine-src,.ws-combine-stage.has,.ws-combine-work i,.ws-combine.combining .ws-combine-btn::after{animation:none}}
/* Combine step — presenter + product -> holding frame, in-flow, with theatrics. */
.ws-combine{margin:14px 0 4px;padding:15px;border-radius:16px;border:1.5px solid var(--line,#E4DFCF);background:linear-gradient(180deg,#F3F9F4,var(--card,#FDFCF7));transition:box-shadow .3s,border-color .3s}
.ws-combine.combining{border-color:var(--green2,#12A85E);animation:ws-comb-breathe 1.8s ease-in-out infinite}
@keyframes ws-comb-breathe{0%,100%{box-shadow:0 0 0 2px rgba(18,168,94,.14),0 8px 24px rgba(12,122,70,.12)}50%{box-shadow:0 0 0 3px rgba(18,168,94,.28),0 10px 30px rgba(12,122,70,.22)}}
.ws-combine-h b{display:block;font-size:14.5px;color:var(--ink,#14201A);font-weight:700}
.ws-combine-h span{display:block;font-size:12px;color:var(--ink2,#4A554E);margin-top:2px;line-height:1.35}
/* Ingredients row — tap either to enlarge. */
.ws-combine-ing{display:flex;align-items:center;justify-content:center;gap:11px;margin:14px 0 11px}
.ws-combine-ing em{font-style:normal;font-weight:800;color:var(--green);font-size:20px}
.ws-combine-to{opacity:.5}
.ws-combine.combining .ws-combine-to{animation:ws-comb-arrow 1.2s ease-in-out infinite}
@keyframes ws-comb-arrow{0%,100%{transform:translateY(0);opacity:.45}50%{transform:translateY(3px);opacity:1}}
.ws-combine-src{width:84px;height:84px;flex:0 0 auto;border-radius:14px;background:#EDEAD9 center/cover no-repeat;border:1.5px solid var(--line,#E4DFCF);box-shadow:0 2px 6px rgba(20,32,26,.08);cursor:zoom-in;padding:0}
.ws-combine-src.prod{background-color:#fff}
.ws-combine.combining .ws-combine-src{animation:ws-comb-pulse 1.6s ease-in-out infinite}
.ws-combine.combining .ws-combine-src.prod{animation-delay:.3s}
@keyframes ws-comb-pulse{0%,100%{box-shadow:0 2px 6px rgba(20,32,26,.08)}50%{box-shadow:0 0 0 3px rgba(18,168,94,.3),0 2px 12px rgba(12,122,70,.28)}}
/* The big result stage — the hero of the step. */
.ws-combine-stage{position:relative;width:100%;min-height:210px;border-radius:16px;overflow:hidden;background:#EAF6EF;border:1.5px dashed #9CCBB1;display:grid;place-items:center}
.ws-combine.combining .ws-combine-stage{border-style:solid;border-color:var(--green2,#12A85E);background:linear-gradient(135deg,#EAF6EF,#D7F0E2)}
/* With a result, HUG the frame (usually a 9:16/portrait) so there are no black
   pillar bars — width shrinks to the image, centered, instead of a fixed-width box. */
.ws-combine-stage.has{position:relative;width:fit-content;max-width:100%;min-height:0;margin:0 auto;border-style:solid;border-color:var(--green);background:#0b0f0d;box-shadow:0 0 0 3px rgba(18,168,94,.18);animation:ws-comb-pop .3s ease}
@keyframes ws-comb-pop{from{transform:scale(.97);opacity:.4}to{transform:scale(1);opacity:1}}
/* A position:relative wrapper the size of the photo, so the overlay controls
   pin to the image's own corners (not a grid row under it). */
.ws-combine-frame{position:relative;display:block;width:fit-content;max-width:100%;margin:0 auto;line-height:0}
.ws-combine-big{display:block;width:fit-content;max-width:100%;padding:0;border:0;background:none;cursor:zoom-in;position:relative}
.ws-combine-big img{display:block;width:auto;max-width:100%;max-height:440px;margin:0 auto;object-fit:contain}
/* Enlarge affordance — a glassy chip with the maximize glyph, bottom-right.
   pointer-events:none so a tap falls through to the image (which enlarges). */
.ws-combine-zoom{position:absolute;bottom:10px;right:10px;z-index:2;display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:rgba(11,15,13,.56);-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px);color:#fff;box-shadow:0 2px 9px rgba(0,0,0,.32);pointer-events:none}
/* Clear the frame — a glassy close button in the top-right of the photo;
   turns danger-red on hover so it reads as "remove". */
.ws-combine-clear{position:absolute;top:10px;right:10px;z-index:4;width:32px;height:32px;border-radius:50%;border:1.5px solid rgba(255,255,255,.9);background:rgba(11,15,13,.56);-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px);color:#fff;padding:0;cursor:pointer;display:grid;place-items:center;box-shadow:0 2px 9px rgba(0,0,0,.32);transition:background .14s,border-color .14s,transform .14s}
.ws-combine-clear:hover{background:rgba(176,42,26,.94);border-color:#fff;transform:scale(1.08)}
.ws-combine-loading{display:flex;flex-direction:column;align-items:center;gap:13px;padding:34px 16px;text-align:center}
.ws-combine-loadtxt{font-size:12.5px;font-weight:700;color:var(--green-deep,#0A3D26)}
.ws-combine-loadsub{font-size:11px;font-weight:600;color:var(--ink2,#4A554E);margin-top:3px}
.ws-combine-empty{display:flex;flex-direction:column;align-items:center;gap:9px;padding:34px 20px;text-align:center;color:var(--ink2,#4A554E)}
.ws-combine-empty span{font-size:12px;max-width:26ch}
.ws-combine-empty svg{color:var(--green);opacity:.85}
.ws-combine-work{display:inline-flex;gap:8px}
.ws-combine-work i{width:13px;height:13px;border-radius:999px;background:var(--green);display:block;animation:ws-comb-bounce 1s ease-in-out infinite}
.ws-combine-work i:nth-child(2){animation-delay:.15s}
.ws-combine-work i:nth-child(3){animation-delay:.3s}
@keyframes ws-comb-bounce{0%,100%{transform:translateY(0);opacity:.45}50%{transform:translateY(-8px);opacity:1}}
.ws-combine-btn{width:100%;margin-top:10px;position:relative;overflow:hidden}
.ws-combine-btntxt{position:relative;z-index:1}
.ws-combine.combining .ws-combine-btn::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 25%,rgba(255,255,255,.4) 50%,transparent 75%);transform:translateX(-100%);animation:ws-comb-shim 1.3s linear infinite}
@keyframes ws-comb-shim{100%{transform:translateX(100%)}}
.ws-combine-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:space-between;margin-top:10px}
.ws-combine-ok{font-size:12px;font-weight:700;color:var(--green-deep,#0A3D26);flex:1;min-width:140px}
/* ── Post-combine tweak controls (Re-roll / New outfit / Edit box). Each re-runs
   the compose for another image charge, so each carries its token cost as a pill. */
.ws-combine-tweaks{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.ws-tweak{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line,#E1DECD);background:#fff;color:var(--ink,#14201A);font-family:Poppins,sans-serif;font-weight:700;font-size:12.5px;padding:8px 12px;border-radius:999px;cursor:pointer;min-height:40px;box-sizing:border-box;transition:transform .12s,box-shadow .12s}
.ws-tweak:hover:not([disabled]){transform:translateY(-1px);box-shadow:0 8px 18px -12px rgba(20,32,26,.35)}
.ws-tweak[disabled]{opacity:.5;cursor:not-allowed}
.ws-tweak.primary{background:linear-gradient(135deg,#12A85E,#0C7A46);color:#fff;border-color:transparent}
.ws-tweak-ico{font-size:14px;line-height:1}
.ws-tweak-sub{font-weight:600;color:var(--ink2,#5b6b61);font-size:11px}
.ws-tweak.primary .ws-tweak-sub{color:rgba(255,255,255,.85)}
.ws-tweak-c{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:rgba(20,32,26,.08);color:var(--ink2,#5b6b61);font-size:10.5px;font-weight:800}
.ws-tweak.primary .ws-tweak-c{background:rgba(255,255,255,.22);color:#fff}
.ws-combine-editrow{display:flex;gap:8px;margin-top:8px;align-items:stretch}
.ws-combine-editbox{flex:1;min-width:0;border:1px solid var(--line,#E1DECD);border-radius:12px;padding:9px 12px;font:inherit;font-size:13px;background:#fff;color:var(--ink,#14201A)}
.ws-combine-editbox:focus{outline:none;border-color:var(--green,#12A85E);box-shadow:0 0 0 3px rgba(18,168,94,.14)}
.ws-combine-editrow .ws-tweak{white-space:nowrap}
.ws-combine-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
.ws-combine-chip{border:1px dashed var(--line,#CFC9B6);background:transparent;color:var(--ink2,#5b6b61);font-size:11.5px;font-weight:600;padding:5px 10px;border-radius:999px;cursor:pointer}
.ws-combine-chip:hover:not([disabled]){background:#fff;color:var(--ink,#14201A);border-style:solid}
.ws-combine-chip[disabled]{opacity:.5;cursor:not-allowed}
.ws-combine-hint{margin:7px 0 0;font-size:11.5px;color:var(--ink2,#5b6b61);line-height:1.45}
/* Tap-to-enlarge lightbox. */
.ws-lightbox{position:fixed;inset:0;z-index:9999;background:rgba(8,12,10,.86);display:grid;place-items:center;padding:24px;cursor:zoom-out;animation:ws-lb-in .15s ease}
@keyframes ws-lb-in{from{opacity:0}to{opacity:1}}
.ws-lightbox img{max-width:min(96vw,760px);max-height:88vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.5);cursor:default}
.ws-lightbox-x{position:fixed;top:16px;inset-inline-end:16px;width:44px;height:44px;border-radius:999px;border:0;background:rgba(255,255,255,.16);color:#fff;font-size:20px;cursor:pointer}
.ws-lightbox-x:hover{background:rgba(255,255,255,.28)}
@media (max-width:420px){.ws-combine-src{width:74px;height:74px}.ws-combine-stage{min-height:180px}}
.ws-tok{display:flex;align-items:center;justify-content:space-between;margin:18px 0 10px;padding:12px 16px;border-radius:14px;background:var(--paper,#F4F1E6);border:1px solid var(--line,#E4DFCF)}
.ws-tok .tt{font-size:12.5px;font-weight:700;color:var(--ink2,#4A554E)}
.ws-tok .tb{font-family:Poppins,sans-serif;font-weight:800;font-size:16px;color:var(--ink,#14201A)}
.ws-tok .tb i{font-style:normal;font-size:11.5px;font-weight:600;color:var(--ink2,#4A554E);margin-left:5px}
.ws-tok .tb em.xp{font-style:normal;font-size:11px;font-weight:800;color:var(--brand,#0C7A46);background:rgba(12,122,70,.1);border-radius:999px;padding:2px 7px;margin-left:8px;vertical-align:middle}
.ws-wallet{margin-top:8px;font-size:12.5px;font-weight:600;color:var(--gold-deep)}
/* Output-language chip — subtle, right above Make; not part of the main option
   stack so it never clutters a flow that rarely changes it. */
.ws-outlang{display:flex;align-items:center;gap:7px;margin:2px 0;font-size:12px;color:var(--ink2,#8A968E)}
.ws-outlang-lbl{font-weight:600}
.ws-casual .ws-outlang{justify-content:center}

/* ===================================================================
   CASUAL (Creator) — premium, DeepAI-clean treatment. Scoped to
   .ws-casual so the Marketing Studio is untouched. All features stay;
   this only restyles. =================================================== */
.ws-casual .wb-h1{font-family:Poppins,sans-serif;font-weight:800;font-size:34px;line-height:1.08;letter-spacing:-.025em;text-align:center;margin:8px 0 10px}
.ws-casual .wb-sub{text-align:center;max-width:520px;margin:0 auto 20px;font-size:14.5px;color:var(--ink2,#4A554E)}
/* Create ↔ Social switch at the top of the Studio (plan-gated). */
.ws-modeswitch{display:inline-flex;gap:4px;padding:4px;border-radius:13px;background:var(--wash,#F1EEE3);border:1px solid var(--line,#E4DFCF);margin:0 0 18px}
.ws-casual .ws-modeswitch{display:flex;width:max-content;margin:0 auto 20px}
.ws-ms-opt{display:inline-flex;align-items:center;gap:7px;border:0;background:none;cursor:pointer;font:inherit;font-weight:700;font-size:13.5px;color:var(--ink2,#6A756E);padding:8px 15px;border-radius:10px;transition:background .14s,color .14s}
.ws-ms-opt:hover{color:var(--ink,#14201A)}
.ws-ms-opt.on{background:#fff;color:var(--ink,#14201A);box-shadow:0 2px 6px rgba(20,32,26,.08)}
.ws-ms-opt.locked{color:var(--ink2,#9AA39C)}
.ws-ms-badge{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#8a5a12;background:#FDF4E3;border:1px solid #E8D3A6;border-radius:6px;padding:2px 6px}
.ws-ms-hint{max-width:600px;margin:-8px 0 18px;font-size:12px;line-height:1.5;color:var(--ink2,#6A756E)}
.ws-ms-hint b{color:var(--ink,#14201A)}
.ws-casual .ws-ms-hint{margin:-12px auto 20px;text-align:center}
/* Social Marketing header centered to match Create (owner ask, IMG_3389 was
   left-heavy vs IMG_3390). Mirrors the .ws-casual header centering; the
   marketing tools + flow below the header are untouched. */
.ws-mkt .wb-h1{text-align:center}
.ws-mkt .wb-sub{text-align:center;max-width:520px;margin:0 auto 20px}
.ws-mkt .ws-modeswitch{display:flex;width:max-content;margin:0 auto 18px}
.ws-mkt .ws-ms-hint{margin:-12px auto 18px;text-align:center}
/* Per-tab token-cost badge — shows the price gap (image 5 · video 50/150 · etc.)
   before you enter a flow, not just on the make button. */
.ws-tab-cost{display:inline-flex;align-items:center;gap:2px;margin-left:1px;font-size:10.5px;font-weight:800;color:var(--ink2,#8A968E);opacity:.85}
.ws-tab.on .ws-tab-cost{color:#eafff4;opacity:1}
/* "You are here" — a sticky mode+step breadcrumb so nobody gets lost mid-config
   (the title + mode toggle scroll away; this doesn't). */
.ws-crumb{position:sticky;top:6px;z-index:6;display:inline-flex;align-items:center;gap:8px;margin:0 0 14px;padding:7px 14px;border-radius:999px;background:#fff;border:1px solid var(--line,#E4DFCF);box-shadow:0 3px 14px rgba(20,32,26,.1);font-family:Poppins,sans-serif;font-size:12.5px;font-weight:700;width:max-content;max-width:100%}
.ws-casual .ws-crumb{margin-left:auto;margin-right:auto}
.ws-crumb-mode{display:inline-flex;align-items:center;gap:5px;color:var(--green,#0C7A46);white-space:nowrap}
.ws-crumb-mode.mk{color:var(--gold-deep,#7E5E13)}
.ws-crumb-sep{color:var(--ink2,#8A968E);font-weight:400}
.ws-crumb-what{color:var(--ink,#14201A);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.ws-ms-upsell{margin:0 0 18px}
.ws-casual .ws-ms-upsell{max-width:520px;margin-left:auto;margin-right:auto;margin-bottom:20px}
.ws-casual .ws-tabs{justify-content:center;gap:8px;margin-bottom:18px}
.ws-casual .ws-tab{border-radius:999px;border:1px solid var(--line,#E1DECD);background:#fff;box-shadow:0 1px 2px rgba(20,32,26,.05);font-family:Poppins,sans-serif;font-weight:700;font-size:13.5px;color:var(--ink2,#4A554E);padding:9px 17px;transition:transform .12s,box-shadow .12s,color .12s}
.ws-casual .ws-tab:hover{transform:translateY(-1px);box-shadow:0 10px 22px -12px rgba(20,32,26,.3);color:var(--ink,#14201A)}
.ws-casual .ws-tab.on{background:linear-gradient(135deg,#12A85E,#0C7A46);color:#fff;border-color:transparent;box-shadow:0 4px 14px rgba(12,122,70,.3)}
.ws-casual .ws-card{border-radius:22px;padding:26px 26px 24px;box-shadow:0 2px 8px rgba(20,32,26,.06),0 26px 60px -24px rgba(20,32,26,.2),inset 0 0 0 1px rgba(231,200,121,.26)}
/* De-wizard: drop the numbered badges, let the titles lead (DeepAI-clean). The
   steps and everything they do stay; only the number chip is hidden. */
.ws-casual .ws-stepn{display:none}
.ws-casual .ws-stephead{align-items:baseline;gap:8px;margin-top:6px}
.ws-casual .ws-stephead b{font-family:Poppins,sans-serif;font-weight:700;font-size:16px;letter-spacing:-.01em;color:var(--ink,#14201A)}
.ws-casual .ws-lbl{font-family:Poppins,sans-serif}
/* Selection pills get depth + lift; active in the brand green. */
.ws-casual .ws-fmtcat,.ws-casual .ws-chip{box-shadow:0 1px 2px rgba(20,32,26,.05);font-family:Poppins,sans-serif;transition:transform .12s,box-shadow .12s,border-color .12s,background .12s}
.ws-casual .ws-fmtcat:hover,.ws-casual .ws-chip:hover{transform:translateY(-1px);box-shadow:0 9px 18px -11px rgba(20,32,26,.3)}
.ws-casual .ws-fmtcat.sel,.ws-casual .ws-chip.sel{border-color:var(--green);background:#EAF6EF;box-shadow:0 0 0 3px rgba(12,122,70,.14);color:var(--ink,#14201A)}
/* The describe/prompt field → a premium ask-field. */
/* 16px (not 15) is deliberate: iOS Safari auto-zooms any focused field below
   16px, and this selector outranks the base .wb-in / .ws-hero — that 1px was
   the whole "screen zooms & I have to realign after Generate" bug on phones. */
.ws-casual .wb-in{border-radius:14px;border:1px solid var(--line,#E1DECD);padding:13px 16px;font-size:16px;box-shadow:inset 0 1px 2px rgba(20,32,26,.03);transition:border-color .15s,box-shadow .15s}
.ws-casual .wb-in:focus{border-color:#9CCBB1;box-shadow:0 0 0 4px rgba(12,122,70,.14);outline:none}
.ws-casual .ws-tok{border-radius:14px}
/* Primary CTA → the home's "Make it" gradient pill (ghosts stay ghosts). */
.ws-casual .wb-btn:not(.ghost){border-radius:15px;font-family:Poppins,sans-serif;font-weight:800;font-size:15px;padding:14px 22px;background:linear-gradient(135deg,#12A85E,#0C7A46);box-shadow:0 4px 14px rgba(12,122,70,.3);transition:transform .1s,box-shadow .1s,filter .1s}
.ws-casual .wb-btn:not(.ghost):hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(12,122,70,.36);filter:brightness(1.03)}
@media(max-width:620px){.ws-casual .wb-h1{font-size:27px}.ws-casual .ws-card{padding:20px 17px}}

/* ===== THE EASEL — casual Creator Studio workspace (left rail · Stage · shelf) =====
   Marketing is untouched: its wrappers are display:contents, so tabs + Form
   render in the old flow. All rules below are scoped to .ws-casual. */
.ws-flow{display:contents}
.ws-casual .ws-easel{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;align-items:start;margin-top:6px}
.ws-casual .ws-easel-left{display:flex;flex-direction:column;gap:14px;min-width:0}
.ws-casual .ws-easel-left .ws-card{margin:0}
/* tab bar → vertical instrument rail */
.ws-casual .ws-tabs{display:flex;flex-direction:column;gap:5px;background:#fff;border:1px solid var(--line,#E4DFCF);border-radius:18px;padding:11px;box-shadow:0 1px 2px rgba(20,32,26,.05);margin:0}
.ws-casual .ws-tab{justify-content:flex-start;width:100%;border-radius:12px;padding:11px 13px;font-size:14px;gap:11px;border:1px solid transparent}
.ws-casual .ws-tab.on{color:#fff;background:linear-gradient(100deg,#12A85E 40%,#0A6A3D 84%);box-shadow:0 4px 12px rgba(12,122,70,.26);border-color:transparent}
/* the Stage */
.ws-stage{position:sticky;top:14px;min-width:0;display:flex;flex-direction:column;align-items:center}
.ws-stage-frame{position:relative;width:100%;min-height:470px;height:100%;display:grid;place-items:center;border-radius:20px;overflow:hidden;border:1px dashed #DED7C2;background:repeating-linear-gradient(135deg,rgba(12,122,70,.018) 0 2px,transparent 2px 22px),radial-gradient(90% 80% at 50% 35%,#FFFEF9,#F6F1E4)}
.ws-stage-frame::after{content:"";position:absolute;inset:10px;border-radius:14px;border:1px solid rgba(199,154,46,.18);pointer-events:none}
.ws-easelph{display:flex;flex-direction:column;align-items:center;gap:13px;text-align:center;padding:24px}
/* The idle Stage is a drop/upload target (DeepAI-style). */
.ws-easelph-drop{cursor:pointer;width:100%;height:100%;justify-content:center;border-radius:20px;transition:background .14s}
.ws-easelph-drop:hover{background:rgba(12,122,70,.04)}
.ws-easelph-drop:focus-visible{outline:2px solid var(--green2);outline-offset:-8px}
.ws-easelph-drop.drag{background:rgba(12,122,70,.08);outline:2px dashed var(--green2);outline-offset:-12px}
.ws-easelph-drop.making{cursor:default}
/* Add-photo affordance: a solid + badge nested in the rosette's hollow centre. */
.ws-easel-mark{position:relative;display:grid;place-items:center}
.ws-dropplus{position:absolute;inset:0;margin:auto;width:46px;height:46px;display:grid;place-items:center;border-radius:999px;background:var(--green);color:#fff;border:2.5px solid #fff;box-shadow:0 6px 16px rgba(12,122,70,.32);transition:transform .14s}
.ws-easelph-drop:hover .ws-dropplus{transform:scale(1.07)}
.ws-rose{width:160px;height:160px;background:#FFD24A;-webkit-mask:url(/gstyle-rosette.svg) center/contain no-repeat;mask:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.92;animation:wsrose 3.8s ease-in-out infinite}
@keyframes wsrose{0%,100%{transform:scale(1) rotate(0);opacity:.92}50%{transform:scale(1.06) rotate(4deg);opacity:1}}
.ws-easelph.making .ws-rose{background:conic-gradient(from 0deg,#0A6A3D,#12A85E 30%,#FFD24A 52%,#12A85E 74%,#0A6A3D);opacity:1;animation:wsrosespin 2.4s linear infinite}
@keyframes wsrosespin{to{transform:rotate(360deg)}}
.ws-easel-cap{font-size:14px;font-weight:700;color:var(--ink,#14201A)}
.ws-easel-sub{font-size:12px;color:var(--ink2,#8A968E);max-width:30ch;line-height:1.45}
/* No-plan lock on the Stage — gentle gold, not an error; the link routes to plans. */
.ws-easel-lock{display:inline-flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;color:#8a5a12;background:#FDF4E3;border:1px solid #E8D3A6;border-radius:9px;padding:6px 11px;line-height:1.4}
.ws-easel-lock a{color:var(--green,#0C7A46);font-weight:700;text-decoration:underline}
/* Phase 2 — the finished piece renders ON the Stage, with verb chips. */
/* The finished piece renders at its OWN aspect ratio. The frame grows to the
   image + the button rows (height:auto, NOT a fixed tall box) and the image
   fills the available width undistorted, so a landscape or square result is
   never stranded letterboxed with big dark bands above and below — the old
   height:min(66vh,560px)+max-width:100% silently overrode aspect-ratio and
   forced every result into a fixed ~portrait box. The dark matte now only shows
   behind a portrait's side margins (a normal, intentional look). */
.ws-stage-frame.has-result{border-style:solid;border-color:var(--line,#E4DFCF);background:var(--ink);min-height:0;height:auto;width:100%;max-width:min(100%,560px);display:block;margin-inline:auto}
.ws-stage-frame.has-result::after{display:none}
.ws-stageresult{position:relative;display:flex;flex-direction:column}
.ws-stagemedia{display:grid;place-items:center;overflow:hidden;background:transparent}
.ws-stagemedia img,.ws-stagemedia video{max-width:100%;max-height:62vh;width:auto;height:auto;object-fit:contain;display:block}
.ws-stageaud{display:flex;flex-direction:column;align-items:center;gap:18px;padding:26px}
.ws-stageaud audio{width:min(320px,86%)}
.ws-verbs{display:flex;flex-wrap:wrap;gap:7px;padding:10px;background:#0b120e;border-top:1px solid rgba(255,255,255,.08)}
.ws-verb{font:inherit;font-weight:700;font-size:12px;color:#d9f3e5;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);border-radius:999px;padding:7px 13px;cursor:pointer;text-decoration:none;transition:.12s}
.ws-verb:hover{background:rgba(18,168,94,.22);border-color:rgba(18,168,94,.5);color:#fff}
.ws-verb.gold{color:#2a2008;background:linear-gradient(180deg,#FFD873,#F3B63E);border-color:#E7A92f}
.ws-stagemedia-edit{cursor:pointer}
.ws-editcap{margin-right:auto;align-self:center;padding-left:4px;font-size:12px;font-weight:700;color:#d9f3e5}
/* Two-photo combine slot — sits under the primary edit photo on the Stage. */
.ws-combine2{margin-top:9px;padding-left:4px}
.ws-combine2-add{display:inline-flex;align-items:center;gap:7px;padding:9px 13px;border-radius:11px;border:1.5px dashed rgba(217,243,229,.6);background:rgba(18,168,94,.14);color:#eafff4;font-weight:700;font-size:12.5px;cursor:pointer}
.ws-combine2-add:hover{background:rgba(18,168,94,.24)}
.ws-combine2-has{display:inline-flex;align-items:center;gap:11px;position:relative}
.ws-combine2-has img{width:46px;height:46px;object-fit:cover;border-radius:9px;border:2px solid var(--green2,#12A85E)}
.ws-combine2-x{position:absolute;top:-6px;left:34px;width:20px;height:20px;border-radius:50%;border:0;background:rgba(11,15,13,.85);color:#fff;cursor:pointer;display:grid;place-items:center;padding:0}
.ws-combine2-lbl{font-size:12px;font-weight:700;color:#d9f3e5}
/* Post-generation quick edits (Enhance / Zoom out / Zoom in / Remove bg). */
/* QUICK EDIT — a clean light panel UNDER the photo card (not a dark overlay on
   the image). Select a chip, then the green button confirms + spends. */
.ws-qedit{padding:13px 14px 14px;border-radius:16px;
  background:var(--card,#FDFCF7);border:1px solid var(--line,#E4DFCF);box-shadow:0 2px 10px rgba(20,32,26,.06)}
.ws-qedit-h{display:flex;align-items:baseline;gap:8px;margin-bottom:10px}
.ws-qedit-t{font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:var(--ink,#14201A)}
.ws-qedit-sub{font-size:11px;font-weight:700;color:var(--ink2,#4A554E);letter-spacing:.02em}
.ws-qedit-chips{display:flex;flex-wrap:wrap;gap:8px}
.ws-qchip{display:inline-flex;align-items:center;gap:6px;font:inherit;font-weight:700;font-size:12.5px;color:var(--ink,#14201A);
  background:#F3F0E4;border:1.5px solid transparent;border-radius:999px;padding:7px 13px;cursor:pointer;transition:background .12s,border-color .12s,color .12s}
.ws-qchip svg{color:var(--ink2,#4A554E)}
.ws-qchip:hover:not(:disabled){background:#EAE6D6}
.ws-qchip.on{background:#E7F5EC;border-color:var(--green2,#12A85E);color:var(--green,#0C7A46)}
.ws-qchip.on svg{color:var(--green2,#12A85E)}
.ws-qchip:disabled{opacity:.5;cursor:default}
/* The Apply button reuses .wb-btn — green gradient + gold rule + the drifting
   gold rosette medallion, same as the main "Make" CTA. This only makes it a
   full-width block sitting under the chips. */
.ws-qedit-go{margin-top:12px;width:100%;display:block}
/* RESULT CONTROLS wrapper — holds the quick-edit panel + the action verbs in
   their own area UNDER the photo. The verbs are relit for this light area
   (the base .ws-verbs stays dark for the on-frame edit-preview state). */
.ws-resultctl{max-width:min(100%,560px);margin:14px auto 0;display:flex;flex-direction:column;gap:10px}
.ws-resultctl .ws-verbs{justify-content:center;background:none;border-top:0;padding:0}
.ws-resultctl .ws-verb{color:var(--ink2,#4A554E);background:var(--card,#FDFCF7);border-color:var(--line,#E4DFCF)}
.ws-resultctl .ws-verb:hover{color:var(--green,#0C7A46);background:#EAF6EE;border-color:var(--green2,#12A85E)}
.ws-resultctl .ws-verb.gold{color:#2a2008;background:linear-gradient(180deg,#FFD873,#F3B63E);border-color:#E7A92f}
/* Failed-generation card (shown on the Stage instead of spinning forever). */
.ws-generr{gap:10px}
.ws-generr-ico{display:grid;place-items:center;width:44px;height:44px;border-radius:999px;background:#F5E6C8;color:#9A5B12;font-weight:900;font-size:24px;border:2px solid #E7C98F}
/* The unsafe card stays warm/amber (not alarm-red) so the tone matches the
   gentle, apologetic copy. */
.ws-generr-btn{margin-top:6px;color:var(--green);background:#fff;border:1.5px solid var(--line,#E4DFCF)}
.ws-generr-btn:hover{background:rgba(12,122,70,.06);border-color:var(--green2);color:var(--green)}
/* Creator-native Video cards: brand tile + emoji instead of product/presenter cover art. */
.ws-casual .ws-tile-casual{background:linear-gradient(145deg,#EAF6EF 0%,#F4F1E6 70%);display:grid;place-items:center;position:relative}
.ws-casual .ws-tile-casual::after{content:"";position:absolute;inset:0;background:url(/gstyle-rosette.svg) center/120% no-repeat;opacity:.06}
.ws-tile-emoji{font-size:34px;line-height:1;filter:saturate(1.05)}
/* Cartoon/jingle style picker: ONE sideways-scroll strip you flick through
   (owner: "like the avatar picker"). Was a 3-wide grid that stacked the 7 styles
   (Realistic/Photoreal + 6) into 3 rows; the horizontal strip matches the .ws-cast
   presenter row's feel — flex, overflow-x, fixed-width cards. */
.ws-tiles.ws-stylestrip{display:flex;gap:11px;overflow-x:auto;overflow-y:hidden;padding:4px 2px 12px;scrollbar-gutter:stable;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;justify-content:flex-start}
.ws-tiles.ws-stylestrip .ws-tile{flex:0 0 auto;width:146px;scroll-snap-align:start}
@media(max-width:620px){.ws-tiles.ws-stylestrip .ws-tile{width:128px}}
/* Setting = visual cards (emoji in a tinted square + name), "Where this takes place". */
.ws-setcards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:0 0 6px}
.ws-setcard{border:1.5px solid var(--line,#E4DFCF);background:#fff;border-radius:14px;padding:6px 6px 8px;cursor:pointer;display:flex;flex-direction:column;align-items:stretch;gap:6px;transition:border-color .14s,background .14s,transform .14s,box-shadow .14s}
.ws-setcard:hover{border-color:#9CCBB1;transform:translateY(-2px);box-shadow:0 8px 18px -10px rgba(20,32,26,.3)}
.ws-setcard.sel{border-color:var(--green,#0C7A46);background:#EAF6EF}
.ws-setcard-img{position:relative;width:100%;aspect-ratio:1/1;border-radius:10px;background-size:cover;background-position:center;display:grid;place-items:center}
.ws-setcard-emoji{font-size:26px;line-height:1}
.ws-setcard b{font-size:12px;font-weight:700;color:var(--ink,#14201A);line-height:1.1;text-align:center}
@media(max-width:620px){.ws-setcards{grid-template-columns:repeat(3,minmax(0,1fr))}}
/* In the Creator Easel the content-type grid lives in a ~300px rail, so the
   default 4-column .ws-ctgrid squeezed the 2 casual video tiles to ~65px and
   clipped their labels to "Show…" / "Carto…". Two columns fills the rail
   cleanly; the brand icon tile doesn't need a full square, so cap its height. */
.ws-casual .ws-ctgrid{grid-template-columns:1fr 1fr;gap:10px;}
.ws-casual .ws-ctgrid .ws-tile-casual{aspect-ratio:auto;height:92px;}
/* Pick-by-look art-style swatches (casual "Make an image"). */
/* 4-up so the 12 styles fill clean 3×4 rows on both the narrow desktop
   controls column and mobile (no half-empty last row). */
.ws-stylegrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:4px}
/* Output FRAME picker — four shape chips (each shows its real aspect). */
.ws-genopts{margin-top:4px}
.ws-frames{display:flex;gap:8px;margin-top:4px}
.ws-frame{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;padding:9px 4px;border:1.5px solid var(--line,#E4E7E1);border-radius:12px;background:var(--card,#fff);font:inherit;cursor:pointer;transition:border-color .14s,background .14s}
.ws-frame:hover{border-color:var(--green2)}
.ws-frame.sel{border-color:var(--green);background:rgba(12,122,70,.06)}
.ws-frame-shape{height:22px;width:auto;border:2px solid #B9C2BB;border-radius:3px;background:rgba(12,122,70,.05)}
.ws-frame.sel .ws-frame-shape{border-color:var(--green);background:rgba(12,122,70,.12)}
.ws-frame-nm{font-size:11px;font-weight:700;color:var(--ink,#14201A)}
/* AI MODEL picker — compact pills; the selected one's blurb shows below. */
.ws-models{display:flex;gap:8px;margin-top:4px}
.ws-model{flex:1;padding:10px 8px;border:1.5px solid var(--line,#E4E7E1);border-radius:12px;background:var(--card,#fff);font:inherit;font-weight:800;font-size:13px;color:var(--ink,#14201A);cursor:pointer;transition:border-color .14s,background .14s}
.ws-model:hover{border-color:var(--green2)}
.ws-model.sel{border-color:var(--green);background:rgba(12,122,70,.06);box-shadow:inset 0 0 0 1px rgba(12,122,70,.25)}
.ws-model-up{display:inline-block;margin-left:5px;font-size:10px;font-weight:800;color:#8A6A12;background:rgba(255,210,74,.32);border-radius:999px;padding:1px 6px;vertical-align:middle}
/* Collapsed art-style disclosure — a single row that reveals the grid on click. */
.ws-styledisc{margin-top:4px}
.ws-styletoggle{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;background:var(--card,#fff);border:1.5px solid var(--line,#E4E7E1);border-radius:12px;padding:11px 14px;font:inherit;cursor:pointer;color:var(--ink,#14201A);transition:border-color .14s,background .14s}
.ws-styletoggle:hover{border-color:var(--green2)}
.ws-styletoggle.open{border-color:var(--green2);background:rgba(12,122,70,.03)}
.ws-styletoggle-l{display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-styletoggle-l b{font-weight:800}
.ws-styletoggle-r{display:inline-flex;align-items:center;gap:8px;flex-shrink:0}
.ws-chev{font-size:13px;line-height:1;color:var(--ink2,#5C6B61);transition:transform .18s}
.ws-styletoggle.open .ws-chev{transform:rotate(180deg)}
.ws-styletile{position:relative;border:0;padding:0;margin:0;background:none;font:inherit;cursor:pointer;border-radius:12px}
.ws-styletile-face{display:block;position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(20,32,26,.08),inset 0 0 0 1px rgba(255,255,255,.14);transition:transform .13s,box-shadow .13s}
.ws-styletile-emoji{position:absolute;left:6px;top:5px;font-size:16px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}
.ws-styletile-nm{position:absolute;left:0;right:0;bottom:0;font-size:9.5px;font-weight:700;color:#fff;letter-spacing:.01em;padding:11px 3px 4px;background:linear-gradient(transparent,rgba(12,18,14,.6));text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-styletile:hover .ws-styletile-face{transform:translateY(-2px);box-shadow:0 8px 16px -8px rgba(20,32,26,.4),inset 0 0 0 1px rgba(255,255,255,.18)}
.ws-styletile.sel .ws-styletile-face{box-shadow:0 0 0 2px var(--green),0 0 0 5px rgba(12,122,70,.18),inset 0 0 0 1px rgba(255,255,255,.2)}
@media(max-width:560px){.ws-stylegrid{grid-template-columns:repeat(4,1fr)}}
/* Photo-editor drag & drop zone (casual Edit) + a DeepAI-style before→after hint. */
.ws-drop{position:relative;border:2px dashed #CFC8B2;border-radius:16px;background:#F7F4EC;min-height:150px;display:grid;place-items:center;text-align:center;cursor:pointer;overflow:hidden;transition:border-color .15s,background .15s}
.ws-drop:hover{border-color:#9CCBB1;background:#F3F9F4}
.ws-drop.drag{border-color:var(--green);background:#EAF6EF}
.ws-drop.has{border-style:solid;border-color:var(--line,#E4DFCF);background:#0f1713;padding:0;min-height:0}
.ws-drop-input{display:none}
.ws-drop-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:22px 18px;pointer-events:none}
.ws-drop-empty b{font-size:14.5px;color:var(--ink,#14201A)}
.ws-drop-sub{font-size:12px;color:var(--ink2,#8A968E);max-width:34ch}
.ws-drop-img{display:block;max-width:100%;max-height:260px;object-fit:contain}
.ws-drop-change{position:absolute;left:0;right:0;bottom:0;font-size:11px;font-weight:700;color:#eafff4;background:rgba(11,18,14,.6);padding:7px}
.ws-drop-ba{display:inline-flex;align-items:center;gap:9px;margin-bottom:4px}
.ws-drop-ba i{width:46px;height:46px;border-radius:10px;box-shadow:0 1px 3px rgba(20,32,26,.14);display:block}
.ws-drop-ba i.before{background:linear-gradient(135deg,#cfc7b6,#9a917c);filter:grayscale(.3) brightness(.95)}
.ws-drop-ba i.after{background:radial-gradient(circle at 35% 30%,#ffe8a3,transparent 55%),linear-gradient(135deg,#12A85E,#7b3f9e)}
.ws-drop-ba em{font-style:normal;font-weight:800;color:var(--green);font-size:15px}
/* creations shelf */
.ws-shelf{margin-top:20px}
.ws-shelf-h{display:flex;align-items:baseline;gap:12px;margin:0 2px 11px}
.ws-shelf-h b{font-size:14px;font-weight:800;color:var(--ink,#14201A)}
.ws-shelf-all{margin-left:auto;font-size:12.5px;font-weight:700;color:var(--green);text-decoration:none}
.ws-shelf-strip{position:relative;display:flex;gap:12px;overflow-x:auto;padding:4px 2px 12px;scrollbar-width:thin}
.ws-shelf-strip::after{content:"";position:absolute;left:4px;right:4px;bottom:2px;height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,rgba(12,122,70,.3),transparent)}
.ws-shelf-piece{flex:0 0 auto;width:112px;text-decoration:none;border:0;background:none;padding:0;margin:0;font:inherit;cursor:pointer;text-align:left;display:block}
.ws-shelf-thumb{position:relative;display:block;width:112px;height:150px;border-radius:13px;overflow:hidden;border:1px solid var(--line,#E4DFCF);background:#F0ECDE center/cover no-repeat;box-shadow:0 1px 2px rgba(20,32,26,.05);transition:transform .14s,box-shadow .14s}
.ws-shelf-thumb video{width:100%;height:100%;object-fit:cover;display:block}
.ws-shelf-piece:hover .ws-shelf-thumb{transform:translateY(-4px);box-shadow:0 14px 28px -14px rgba(20,32,26,.3)}
.ws-shelf-aud{position:absolute;inset:0;display:grid;place-items:center;font-size:26px;color:#EAF6EF;background:linear-gradient(150deg,#1B6D46,#14201A)}
.ws-shelf-tag{position:absolute;left:7px;bottom:7px;font-size:9.5px;font-weight:700;color:#fff;background:rgba(12,18,14,.55);border-radius:999px;padding:2px 8px}
.ws-shelf-pt{display:block;font-size:11px;font-weight:600;color:var(--ink2,#5B6B61);margin-top:7px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:820px){
  .ws-casual .ws-easel{grid-template-columns:1fr}
  .ws-casual .ws-tabs{flex-direction:row;overflow-x:auto}
  .ws-casual .ws-tab{flex:0 0 auto}
  .ws-stage{position:static}
  .ws-stage-frame{min-height:300px}
}
/* ── THE EASEL on phones — "Pinned Cockpit" ───────────────────────────────
   On a single column the old layout buried the Stage under the whole form and
   left the Make button mid-scroll. Here the three zones get PINNED instead of
   stacked (the Ideogram/Krea model): the Rosette Stage leads as a hero canvas,
   the instrument rail becomes a sticky 4-up segmented control, and the Make CTA
   sits full-width in flow right under the cost pill. All scoped to .ws-casual, so
   desktop (>620px) and marketing are untouched. 620px is the file's phone
   breakpoint; being later in source, these rules win at ≤620px. */
@media (max-width:620px){
  /* 1 — hoist the Rosette Stage to the top as the hero canvas */
  .ws-casual .ws-easel{gap:12px}
  .ws-casual .ws-stage{order:-1;position:static;top:auto}
  .ws-casual .ws-easel-left{order:0}
  .ws-casual .ws-stage-frame{min-height:0;height:40vh;max-height:340px}
  /* a result hugs its own shape (portrait stays tall, capped); idle stays 40vh */
  .ws-casual .ws-stage-frame.has-result{height:auto;width:100%;aspect-ratio:var(--stage-ar,1/1);max-height:min(62vh,460px)}

  /* 2 — vertical rail → one sticky 4-up segmented control (icon over label) */
  .ws-casual .ws-tabs{position:sticky;top:0;z-index:6;display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:5px;border-radius:14px;overflow:visible}
  .ws-casual .ws-tab{width:auto;flex-direction:column;justify-content:center;gap:4px;padding:8px 4px;font-size:11px;line-height:1.1;border-radius:10px}
  .ws-casual .ws-tab svg{width:18px;height:18px}

  /* 3 — Make CTA + wallet sit IN FLOW right under the cost pill (owner: keep
     Make adjacent to the cost, not pinned at the page bottom under the shelf).
     Full-width so it still reads as the primary action. */
  .ws-casual .ws-makebar{margin-top:14px}
  .ws-casual .ws-makebar .wb-btn{width:100%;margin:0}
  .ws-casual .ws-makebar .ws-wallet{margin:7px 0 0;text-align:center;font-size:11px;line-height:1.3}

  /* 4 — shelf stays a horizontal filmstrip, slightly smaller */
  .ws-casual .ws-shelf{margin-top:16px}
  .ws-casual .ws-shelf-strip{gap:9px}
  .ws-casual .ws-shelf-piece,.ws-casual .ws-shelf-thumb{width:96px}
  .ws-casual .ws-shelf-thumb{height:128px}
}
/* The Stage rose — idle AND the making spinner (the .making selector is more
   specific than .ws-rose, so it needs naming to actually stop). */
@media (prefers-reduced-motion:reduce){.ws-rose,.ws-easelph.making .ws-rose{animation:none}}
/* ── 44px tap-target floor (mobile touch). Appended so source order wins; only
   hit boxes grow, glyph sizes unchanged. ── */
.ws-vx{width:44px;height:44px}
.ws-setbf{min-height:44px;display:inline-flex;align-items:center}
.ws-impbtn{min-height:44px;display:inline-flex;align-items:center;justify-content:center}
.ws-styletoggle{min-height:44px}
@media(max-width:620px){
  .ws-addurl{min-height:44px;display:inline-flex;align-items:center}
  .ws-fmtsel button{width:44px;height:44px}
  .ws-cs-clr{width:44px;height:44px;background:transparent}
  .ws-samp{width:44px;height:44px}
  .ws-fmtcat{min-height:44px;display:inline-flex;align-items:center;justify-content:center}
  .ws-verb{min-height:44px;display:inline-flex;align-items:center}
  .ws-qchip{min-height:44px}
  .ws-chip{min-height:44px;padding-top:12px;padding-bottom:12px}
  .ws-seg button{min-height:44px;display:inline-flex;align-items:center}
  .ws-model{min-height:44px;display:inline-flex;align-items:center;justify-content:center}
  .ws-upclear{min-height:44px;padding-top:11px;padding-bottom:11px}
  .ws-srccard{min-height:76px}
}
`;
