import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { trimToWord } from "../lib/text-trim";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit, useSearchParams, Link } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Page, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { enqueueJob } from "../lib/job-queue.server";
import { spendTokens } from "../lib/tokens.server";
import { tokensRemaining, tokensRemainingLive } from "../lib/tokens.server";
import { TOKEN_COST } from "../lib/plan-config";
import { AVATARS, avatarImg, DESIGNED_VOICES, privateCastFor } from "../lib/avatars";
import { AD_TEMPLATES, AD_TEMPLATE_BY_KEY } from "../lib/ad-templates";
import { AD_FORMATS } from "../lib/ad-formats";
import { VIDEO_ENGINES, engineSurcharge } from "../lib/video-engines";

type Tab = "video" | "image" | "blog";
const TABS: { key: Tab; label: string; icon: string; cost: number; verb: string; noun: string }[] = [
  { key: "video", label: "Video", icon: "🎬", cost: TOKEN_COST.video, verb: "Generate", noun: "video" },
  { key: "image", label: "Image", icon: "🖼", cost: TOKEN_COST.image, verb: "Generate", noun: "image" },
  { key: "blog", label: "Blog", icon: "✍️", cost: TOKEN_COST.blog, verb: "Write", noun: "article" },
];

// Content-type step — the merchant picks a GENERATION STYLE before anything
// else, then the screen shifts in place to that style's picker. All four are
// live pipelines: avatar (UGC), highlight (cinematic), cartoon (illustrated
// keyframe + kling), jingle (sung ad).
type CType = "avatar" | "highlight" | "cartoon" | "jingle" | "commercial" | "review" | "unboxing" | "asmr";

// The three PRESET types ride the avatar/highlight pipelines with a baked-in
// creative direction — translated at submit so the queue, the capability
// gate and the pipelines never learn new keys. (web.studio.tsx mirrors this.)
const CT_PRESETS: Record<string, { base: "avatar" | "highlight"; direction: string }> = {
  review: { base: "avatar", direction: "Film it like a real customer review shot on a phone for social: casual selfie framing, natural light, honest conversational tone — a viral organic review, not a polished ad." },
  unboxing: { base: "avatar", direction: "An excited first-impressions unboxing: they open the package on camera, lift the product out, react genuinely, and show it close to the lens." },
  asmr: { base: "highlight", direction: "An oddly-satisfying ASMR-style macro edit: extreme close-ups, slow luxurious motion, rich textures, droplets and light play — a mesmerizing loop that stops the scroll." },
};
// What a preset key renders AS — everything downstream keys off the base.
const baseOf = (ct: string | null | undefined) => (ct && CT_PRESETS[ct] ? CT_PRESETS[ct].base : ct);
// Covers carry ?v= so replacing the art actually reaches browsers that
// cached the old file under the same name.
const CONTENT_TYPES: { key: CType; name: string; icon: string; cover: string; sub: string; live: boolean }[] = [
  { key: "avatar", name: "Avatar AI", icon: "🧑‍💼", cover: "/style-tiles/avatarcover.jpg?v=4", sub: "A real-looking presenter talks it up", live: true },
  { key: "highlight", name: "Product Highlight", icon: "🎬", cover: "/ad-templates/phcover.jpg?v=1", sub: "Cinematic motion, no presenter", live: true },
  { key: "cartoon", name: "Cartoon Avatar", icon: "🎨", cover: "/style-tiles/cover.jpg?v=4", sub: "Your presenter & product, redrawn viral-style", live: true },
  { key: "jingle", name: "Anthem", icon: "🎵", cover: "/style-tiles/anthemcover.jpg?v=4", sub: "A stuck-in-your-head theme song — iconic 2000s commercial energy", live: true },
  { key: "commercial", name: "Commercial", icon: "🎥", cover: "/showcase/commercial-cover.jpg?v=2", sub: "A cinematic multi-scene story ad with a big-budget commercial feel", live: true },
  { key: "review", name: "UGC Review", icon: "🤳", cover: "/ad-templates/ctcover-review.jpg?v=1", sub: "A creator's honest phone-shot review — social-feed real", live: true },
  { key: "unboxing", name: "Unboxing", icon: "📦", cover: "/ad-templates/ctcover-unboxing.jpg?v=1", sub: "The box opens on camera — first impressions, real reactions", live: true },
  { key: "asmr", name: "Satisfying Close-Up", icon: "🌊", cover: "/ad-templates/ctcover-asmr.jpg?v=1", sub: "Macro textures in slow motion — the loop nobody scrolls past", live: true },
];

// Cartoon sub-styles — the VIRAL formats people already share, named
// descriptively (no IP names). Keys must match CARTOON_RECIPES in
// cartoon-ad-pipeline.server.ts. Covers come from /style-tiles/* — REAL
// flux generations of one cast member redrawn per style (the server builds
// them on first visit; illustrated fallbacks serve until then).
const CARTOON_STYLES: { key: string; name: string; emoji: string; tint: string; cover: string; blurb: string }[] = [
  { key: "dreamanime", name: "Dream Anime", emoji: "🌿", tint: "#6FAF7C", cover: "/style-tiles/dreamanime.jpg?v=5", blurb: "Your presenter as a soft painterly anime character — the style the whole internet shares" },
  { key: "toyfigure", name: "Boxed Figure", emoji: "🧍", tint: "#F4B400", cover: "/style-tiles/toyfigure.jpg?v=5", blurb: "Presenter & product as a collectible figure in the pack — the viral format" },
  { key: "papercut", name: "Paper Craft", emoji: "✂️", tint: "#E58A4E", cover: "/style-tiles/papercut.jpg?v=5", blurb: "A handmade layered-paper diorama — the craft style feeds fall in love with" },
  { key: "pixar", name: "3D Toon", emoji: "🧸", tint: "#34C3E7", cover: "/style-tiles/pixar.jpg?v=5", blurb: "Big-studio 3D character film — glossy and cinematic" },
  { key: "retroanime", name: "Retro Anime", emoji: "📼", tint: "#E5397D", cover: "/style-tiles/retroanime.jpg?v=5", blurb: "90s VHS anime — sunset palettes and speed lines" },
  { key: "vintagetoon", name: "Vintage Toon", emoji: "🎪", tint: "#E7A33C", cover: "/style-tiles/vintagetoon.jpg?v=5", blurb: "Playful vintage 2D — hand-inked, storybook warmth" },
  { key: "puppet", name: "Felt Puppet", emoji: "🧦", tint: "#8E5BD9", cover: "/style-tiles/puppet.jpg?v=5", blurb: "Fuzzy felt and googly eyes — puppet-show charm" },
  { key: "clay", name: "Claymation", emoji: "🎭", tint: "#B08526", cover: "/style-tiles/clay.jpg?v=5", blurb: "Hand-molded stop-motion, cozy and tactile" },
];

// Wearable products should be modeled (worn) by the presenter, not held.
const APPAREL_RE = /\b(shirt|tee|t-shirt|top|blouse|hoodie|sweat(er|shirt)?|jacket|coat|dress|skirt|pant|trouser|jean|short|legging|activewear|apparel|clothing|clothes|hat|cap|beanie|scarf|sock|jersey|uniform|robe|gown|cardigan|blazer|vest|romper|jumpsuit|swimsuit|bikini|lingerie|underwear|bra|glove|wear|outfit|garment|tank|polo)\b/i;

// Image art direction lives in the Ad Templates (statue previews) + one free
// tweak/describe box — the old parallel style-chip system was redundant and
// confusing next to them, so it's gone.
function isApparel(text: string): boolean { return APPAREL_RE.test(text); }

// One-tap blog angles — the picker that standardizes what kind of article you get.
const BLOG_ANGLES: { label: string; prompt: string }[] = [
  { label: "📋 Buyer's Guide", prompt: "a practical buyer's guide that helps a shopper choose the right option — what to look for, common mistakes to avoid, and why this product fits" },
  { label: "🔧 How-To", prompt: "a step-by-step how-to that helps the reader get the most out of the product, with clear numbered steps and pro tips" },
  { label: "⭐ Best-Of List", prompt: "a curated best-of listicle ranking top picks or use-cases, positioning this product as the standout choice" },
  { label: "❓ FAQ", prompt: "an FAQ-style post answering the real questions shoppers ask before buying, each answer building confidence to purchase" },
  { label: "📖 Brand Story", prompt: "a short brand-story feature connecting the product to a relatable customer moment and the values behind it" },
  { label: "🎁 Gift Guide", prompt: "a gift-guide angle framing the product as the perfect gift for specific people and occasions" },
];

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const decodeEntities = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop }, include: { activePlan: true, brandProfile: true } });
  const plan = shop?.activePlan ?? null;

  let products: { title: string; image: string | null; url: string | null; apparel: boolean }[] = [];
  try {
    const res = await admin.graphql(`{ products(first: 12, sortKey: UPDATED_AT, reverse: true) { edges { node { title handle onlineStoreUrl productType tags featuredImage { url } } } } }`);
    const j = (await res.json()) as { data?: { products?: { edges?: { node: { title: string; handle?: string; onlineStoreUrl?: string; productType?: string; tags?: string[]; featuredImage?: { url?: string } } }[] } } };
    products = (j.data?.products?.edges || []).map((e) => ({
      title: e.node.title,
      image: e.node.featuredImage?.url || null,
      url: e.node.onlineStoreUrl || (e.node.handle ? `https://${session.shop}/products/${e.node.handle}` : null),
      apparel: isApparel(`${e.node.title} ${e.node.productType || ""} ${(e.node.tags || []).join(" ")}`),
    }));
  } catch { /* fall through */ }

  // Forged presenters lead the cast. They're created from the web Studio's
  // Import tab, but they belong to the SHOP — so they have to show up here too,
  // or a merchant forges their mascot and then can't find them on this side.
  const { customCastFor } = await import("../lib/custom-avatars.server");
  const forged = shop ? await customCastFor(shop.id) : [];
  const cast = [
    ...forged.filter((c) => c.status === "ready").map((c) => ({ id: c.id, name: c.name, img: c.img, designed: false })),
    ...[...privateCastFor(session.shop, shop?.id), ...AVATARS].map((a) => ({ id: a.id, name: a.name, img: avatarImg(a.id, 0), designed: DESIGNED_VOICES.has(a.id) })),
  ];
  const brandFaceId = shop?.brandAvatarId && cast.some((c) => c.id === shop.brandAvatarId) ? shop.brandAvatarId : null;

  // Capabilities drive the locked-card UI. The action re-checks server-side —
  // these are for painting locks, not for security.
  const { capabilitiesFor } = await import("../lib/capabilities.server");
  const caps = [...capabilitiesFor(plan)];

  return json({
    hasPlan: !!plan?.active,
    hasBrand: !!shop?.brandProfile,
    tokens: tokensRemainingLive(plan),
    caps,
    products,
    cast,
    brandFaceId,
    defaultAvatar: brandFaceId ?? cast[0]?.id ?? null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop }, include: { activePlan: true, brandProfile: true } });
  if (!shop) return json({ error: "Shop not found." });
  const form = await request.formData();
  const intent = form.get("intent") as string;

  // Crown a presenter as the Brand Face (no plan/brand gate needed).
  if (intent === "setBrandFace") {
    const id = ((form.get("avatarId") as string) || "").trim() || null;
    await db.shop.update({ where: { id: shop.id }, data: { brandAvatarId: id, brandAvatarVariant: 0 } });
    return json({ brandFaceSet: true });
  }

  // Import a product by URL — the standalone (non-Shopify) path. Scrapes the
  // page for a title + image so any storefront's product can be featured.
  if (intent === "importUrl") {
    const raw = ((form.get("url") as string) || "").trim();
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (!/^https?:$/.test(u.protocol)) throw new Error("bad protocol");
      const host = u.hostname.toLowerCase();
      if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
        return json({ importError: "That URL isn't allowed." });
      }
      const ua = { "user-agent": "Mozilla/5.0 (compatible; EasyMode product import)", accept: "text/html,application/json" };
      // Shopify storefront shortcut
      if (/\/products\/[^/?#]+\/?$/.test(u.pathname)) {
        try {
          const jres = await fetch(`${u.origin}${u.pathname.replace(/\/$/, "")}.js`, { signal: AbortSignal.timeout(8000), headers: ua });
          if (jres.ok) {
            const pj = (await jres.json()) as { title?: string; featured_image?: string };
            if (pj?.title) {
              const img = pj.featured_image ? (pj.featured_image.startsWith("//") ? `https:${pj.featured_image}` : pj.featured_image) : null;
              return json({ imported: { title: pj.title.slice(0, 120), image: img, url: u.href } });
            }
          }
        } catch { /* fall through */ }
      }
      const res = await fetch(u.href, { signal: AbortSignal.timeout(9000), headers: ua, redirect: "follow" });
      if (!res.ok) return json({ importError: `Couldn't reach that page (${res.status}).` });
      const html = (await res.text()).slice(0, 600_000);
      let title: string | undefined;
      let image: string | undefined;
      const ldBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
      for (const block of ldBlocks) {
        try {
          const data = JSON.parse(block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, ""));
          const nodes: { "@type"?: unknown; name?: string; image?: unknown }[] = Array.isArray(data) ? data : (data as { "@graph"?: [] })?.["@graph"] ? (data as { "@graph": [] })["@graph"] : [data];
          const prod = nodes.find((n) => { const t = n?.["@type"]; return t === "Product" || (Array.isArray(t) && t.includes("Product")); });
          if (prod) { title = prod.name; const im = Array.isArray(prod.image) ? prod.image[0] : prod.image; image = typeof im === "object" ? (im as { url?: string })?.url : (im as string); break; }
        } catch { /* next */ }
      }
      const og = (p: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']og:${p}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:${p}["']`, "i"))?.[1];
      title = title || og("title") || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
      image = image || og("image");
      if (!title) return json({ importError: "Couldn't find product info on that page." });
      return json({ imported: { title: decodeEntities(title.trim()).slice(0, 120), image: image || null, url: u.href } });
    } catch {
      return json({ importError: "Couldn't import from that URL — check the link and try again." });
    }
  }

  if (!shop.brandProfile) return json({ error: "Analyze your store first (on the dashboard) so content matches your brand." });
  if (!shop.activePlan?.active) return json({ error: "Pick a plan first — content runs on tokens." });

  const productTitle = ((form.get("productTitle") as string) || "").trim();
  const productImageUrl = ((form.get("productImageUrl") as string) || "").trim() || undefined;
  // The input carries maxLength={300}, which is a courtesy to the merchant and
  // nothing to the server: this string is interpolated straight into the image
  // and video prompts, ahead of the fidelity clauses that keep the product
  // looking like the product. A pasted brief pushes those to the tail of a very
  // long prompt, where models weight them least. 500 leaves room for the
  // composed presets on top of a full-length direction and stops a novel.
  // trimToWord, not slice: this text is read by a model, so it must not end
  // mid-word.
  const direction = trimToWord((form.get("direction") as string) || "", 500) || undefined;
  const wear = form.get("wear") === "1";
  const service = form.get("service") === "1"; // intangible offering — sell the outcome
  const scene = ((form.get("scene") as string) || "").trim() || undefined;
  if (!productTitle) return json({ error: "Pick a product to feature." });

  // TWO-CURRENCY RULE: the tier decides WHICH generators are unlocked, tokens
  // only meter volume. This is the server-side gate — UI locks are cosmetics.
  const { assertCapability, videoCapabilityFor } = await import("../lib/capabilities.server");

  if (intent === "genVideo") {
    // Content type routes the pipeline: avatar → UGC, highlight → showcase,
    // cartoon → presenter+product redrawn in style, jingle → sung ad (no
    // presenter).
    let contentType = ((form.get("contentType") as string) || "").trim();
    // Preset translation: the picker key becomes its base pipeline type and
    // its baked-in direction rides ahead of whatever the merchant typed.
    const ctPreset = CT_PRESETS[contentType];
    const videoDirection = ctPreset ? [ctPreset.direction, direction].filter(Boolean).join(" ") : direction;
    if (ctPreset) contentType = ctPreset.base;
    try { assertCapability(shop.activePlan, videoCapabilityFor(contentType)); }
    catch (e) { return json({ error: (e as Error).message }); }
    const cartoonStyle = ((form.get("cartoonStyle") as string) || "").trim() || undefined;
    const avatarId = ((form.get("avatarId") as string) || "").trim() || undefined;
    const avatarVariant = Math.max(0, Math.min(3, parseInt((form.get("avatarVariant") as string) || "0", 10) || 0));
    const style = avatarId && contentType !== "cartoon" && contentType !== "jingle" ? "AI_AVATAR" : "PRODUCT_HIGHLIGHT";
    // Engine picker: premium engines carry a token surcharge (margin cover).
    const { normalizeEngineKey, engineSurcharge } = await import("../lib/video-engines");
    const videoEngine = normalizeEngineKey((form.get("videoEngine") as string) || "");
    const commercial = form.get("commercial") === "1";
    const breakout = form.get("breakout") === "1";
    // The engine picker drives an IMAGE-TO-VIDEO render. A presenter ad does
    // not use one: it goes through the lipsync chain (HeyGen/omni-human), so
    // generateUgcAd never even receives videoEngine. Charging the Seedance or
    // Veo surcharge on those was billing for an engine that never ran. The web
    // Studio already guarded this; the embedded one did not.
    const engineDrivesRender = !avatarId;
    const effectiveEngine = engineDrivesRender ? videoEngine : "auto";
    const charged = TOKEN_COST.video + engineSurcharge(effectiveEngine);
    // Without a photo the engines invent a product from the title — generic AI
    // art the merchant paid for. Services legitimately have nothing to shoot.
    if (!productImageUrl && !service) return json({ error: "Pick a product that has a photo — without one we'd be inventing a product from the name. Promoting a service? Switch to “Service / offer”." });
    // One currency: video spends tokens like every other action (no separate
    // free-video quota). Campaigns and the Studio now bill identically.
    let chargedFromExtra = 0;
    try { chargedFromExtra = (await spendTokens(shop.id, charged)).fromExtra; }
    catch (e) { return json({ error: e instanceof Error ? e.message : "Not enough tokens for this video." }); }
    // Services: the presenter explains the offer to camera — nothing to hold.
    await enqueueJob(shop.id, "GENERATE_VIDEO_AD", { productTitle, style, contentType: contentType || undefined, cartoonStyle, customPrompt: videoDirection, avatarId, avatarVariant, productImageUrl, productDescription: direction, holdProduct: !!avatarId && !service, wearProduct: !!avatarId && wear && !service, serviceMode: service, scene, videoEngine: effectiveEngine, commercial, breakout, chargedTokens: charged, prePaid: true, chargedFromExtra });
    return json({ ok: true, queued: "video" });
  }
  if (intent === "genImage") {
    try { assertCapability(shop.activePlan, "image"); }
    catch (e) { return json({ error: (e as Error).message }); }
    const avatarId = ((form.get("avatarId") as string) || "").trim() || undefined;
    const avatarVariant = Math.max(0, Math.min(3, parseInt((form.get("avatarVariant") as string) || "0", 10) || 0));
    if (avatarId && !productImageUrl && !service) return json({ error: "Pick a product with a photo — the presenter needs something to hold." });
    // Without a photo the engines invent a product from the title, so the
    // merchant pays for generic AI art. Services are the one real exception.
    if (!productImageUrl && !service) return json({ error: "Pick a product that has a photo — without one we'd be inventing a product from the name. Promoting a service? Switch to “Service / offer”." });
    const rawMode = (form.get("styleMode") as string) || "";
    const styleMode = rawMode === "scene" || rawMode === "backdrop" ? rawMode : undefined;
    const rawTemplate = ((form.get("templateKey") as string) || "").trim();
    const templateKey = AD_TEMPLATE_BY_KEY[rawTemplate] ? rawTemplate : undefined;
    const { AD_FORMAT_BY_KEY } = await import("../lib/ad-formats");
    const rawFormat = ((form.get("formatKey") as string) || "").trim();
    const formatKey = AD_FORMAT_BY_KEY[rawFormat] ? rawFormat : undefined;
    try { await spendTokens(shop.id, TOKEN_COST.image); }
    catch (e) { return json({ error: e instanceof Error ? e.message : "Not enough tokens for a still." }); }
    // Services skip the presenter-hold and product photo → outcome scene.
    await enqueueJob(shop.id, "GENERATE_IMAGE_AD", { productTitle, productImageUrl, stylePrompt: direction, styleMode, templateKey, formatKey, avatarId: service ? undefined : avatarId, avatarVariant, wear: !!avatarId && wear && !service, serviceMode: service, scene, prePaid: true });
    return json({ ok: true, queued: "image" });
  }
  if (intent === "genBlog") {
    try { assertCapability(shop.activePlan, "blog"); }
    catch (e) { return json({ error: (e as Error).message }); }
    try { await spendTokens(shop.id, TOKEN_COST.blog); }
    catch (e) { return json({ error: e instanceof Error ? e.message : "Not enough tokens for an article." }); }
    await enqueueJob(shop.id, "GENERATE_BLOG_POST", { productTitle, productDescription: direction, serviceMode: service, prePaid: true });
    return json({ ok: true, queued: "blog" });
  }
  return json({ ok: true });
};

type CastItem = { id: string; name: string; img: string; designed: boolean };

function PresenterPicker({ cast, value, onChange, allowNone, brandFaceId }: { cast: CastItem[]; value: string | null; onChange: (id: string | null) => void; allowNone: boolean; brandFaceId: string | null }) {
  const [open, setOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);

  const stopAudio = () => { audioRef.current?.pause(); audioRef.current = null; setPlaying(null); };
  const sample = (c: CastItem) => {
    if (c.designed) { stopAudio(); setVideoId(c.id); return; } // premium "true voice" → lip-sync video
    if (playing === c.id) { stopAudio(); return; }
    stopAudio();
    const a = new Audio(`/voices/${c.id}.mp3?v=3`);
    audioRef.current = a; setPlaying(c.id);
    a.onended = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
  };

  // Brand Face leads the cast.
  const ordered = brandFaceId ? [...cast.filter((c) => c.id === brandFaceId), ...cast.filter((c) => c.id !== brandFaceId)] : cast;
  // Type a name instead of scrubbing a hundred faces sideways. The CAST
  // presenter always survives the filter — losing sight of your own selection
  // mid-search is worse than one extra tile.
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const matches = needle
    ? ordered.filter((c) => c.name.toLowerCase().includes(needle) || c.id === value)
    : ordered;
  const PREVIEW = 8;
  const selIdx = value ? ordered.findIndex((c) => c.id === value) : -1;
  const preview = ordered.slice(0, PREVIEW);
  if (selIdx >= PREVIEW) preview.push(ordered[selIdx]);
  // A search is a request to see the matches — not the 8-tile teaser.
  const searching = needle.length > 0;

  const None = allowNone ? (
    <button type="button" className={`cast${value === null ? " sel" : ""}`} onClick={() => onChange(null)}>
      <span className="ca-img cs-none">🚫</span><span className="ca-nm">None</span>
    </button>
  ) : null;
  const Tile = (c: CastItem) => {
    const bf = c.id === brandFaceId;
    return (
      <div className={`cast${c.id === value ? " sel" : ""}${bf ? " bf" : ""}`} key={c.id}>
        <button type="button" className="ca-pick" onClick={() => onChange(c.id)} aria-label={`Cast ${c.name}`}>
          <span className="ca-img" style={{ backgroundImage: `url(${c.img})` }}>{c.id === value && <span className="ca-chk">✓</span>}</span>
        </button>
        <button type="button" className={`cs-samp${playing === c.id ? " on" : ""}${c.designed ? " prem" : ""}`} onClick={() => sample(c)} title={c.designed ? `Watch ${c.name} speak` : `Hear ${c.name}`} aria-label={c.designed ? `Watch ${c.name} speak` : `Hear ${c.name}'s voice`}>
          {playing === c.id ? "♪" : c.designed ? "▶" : "🔊"}
        </button>
        <span className="ca-nm">{bf ? "★ Brand face" : c.name}</span>
      </div>
    );
  };

  return (
    <>
      <div className="cfg-lbl cs-lblrow">
        <span>Presenter {allowNone && <span className="cs-opt">— or none</span>}</span>
        {!searching && <button type="button" className="cs-viewall" onClick={() => setOpen((o) => !o)}>{open ? "Show less" : `View all ${cast.length}`}</button>}
      </div>
      <div className="cs-search">
        <input className="cs-search-in" type="search" value={q} placeholder={`Search ${cast.length} presenters by name…`}
          onChange={(e) => setQ(e.target.value)} aria-label="Search presenters by name" />
        {searching && <button type="button" className="cs-search-x" onClick={() => setQ("")} aria-label="Clear search">✕</button>}
      </div>
      {searching && matches.length === 0 && <p className="cs-nohit">No presenter called “{q.trim()}”.</p>}
      {searching ? (
        <div className="cs-castgrid">{matches.map(Tile)}</div>
      ) : open ? (
        <div className="cs-castgrid">{None}{ordered.map(Tile)}</div>
      ) : (
        <div className="cfg-cast">{None}{preview.map(Tile)}<button type="button" className="cast cs-moretile" onClick={() => setOpen(true)}><span className="ca-img cs-none">＋</span><span className="ca-nm">All</span></button></div>
      )}
      {videoId && (
        <div className="cs-vscrim" onClick={() => setVideoId(null)}>
          <div className="cs-vbox" onClick={(e) => e.stopPropagation()}>
            <video src={`/voice-videos/${videoId}.mp4?v=1`} autoPlay controls playsInline className="cs-video" />
            <button type="button" className="cs-vx" onClick={() => setVideoId(null)}>✕</button>
          </div>
        </div>
      )}
    </>
  );
}

export default function Studio() {
  const { hasPlan, hasBrand, tokens, caps, products, cast, brandFaceId, defaultAvatar } = useLoaderData<typeof loader>();
  // Which capability each content type needs + where its lock upsells to.
  const CT_CAP: Record<string, { cap: string; tier: string; price: number }> = {
    avatar: { cap: "video", tier: "Studio", price: 59 },
    highlight: { cap: "video", tier: "Studio", price: 59 },
    cartoon: { cap: "cartoon", tier: "Studio", price: 59 },
    jingle: { cap: "anthem", tier: "Studio", price: 59 },
  };
  const lockFor = (key: string) => {
    const need = CT_CAP[key];
    return need && !(caps as string[]).includes(need.cap) ? need : null;
  };
  const [upsell, setUpsell] = useState<{ name: string; tier: string; price: number } | null>(null);
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const error = actionData && "error" in actionData ? actionData.error : null;
  const queued = actionData && "queued" in actionData ? (actionData as { queued: string }).queued : null;

  // Deep-link support: the dashboard "Next move" card links here with ?tab= and
  // ?product=, so the right format and product are pre-selected on arrival.
  const [searchParams] = useSearchParams();
  const initTab = (["video", "image", "blog"] as const).find((t) => t === searchParams.get("tab")) as Tab | undefined;
  const wantProduct = (searchParams.get("product") || "").toLowerCase();
  const [tab, setTab] = useState<Tab>(initTab || "video");
  const [picked, setPicked] = useState(() => {
    if (!wantProduct) return 0;
    const i = products.findIndex((p) => p.title.toLowerCase() === wantProduct);
    return i >= 0 ? i : 0;
  });
  const [avatarId, setAvatarId] = useState<string | null>(defaultAvatar);
  // Content-type step (video only). null = show the type carousel; picking a
  // type shifts the same screen to that type's picker.
  const [contentType, setContentType] = useState<CType | null>(null);
  const [cartoonStyle, setCartoonStyle] = useState<string | null>(null);
  // Engine picker (Arcads-style) + big-budget Commercial look toggle.
  const [videoEngine, setVideoEngine] = useState("auto");
  const [commercial, setCommercial] = useState(false);
  const [breakout, setBreakout] = useState(false);
  // Entering Avatar AI or Cartoon Avatar defaults a presenter (cartoon ads
  // star the presenter redrawn in the picked style). Other types DON'T null
  // the shared selection — the Image tab and a later return keep the
  // merchant's explicit pick; generate() omits the presenter where unused.
  // Image tab has its own first step: product-only ad, or presenter holding
  // it. The presenter picker only appears after choosing "presenter" — no
  // avatar clutter on arrival.
  const [imageMode, setImageMode] = useState<null | "product" | "presenter">(null);
  useEffect(() => {
    if (baseOf(contentType) === "avatar" || contentType === "cartoon" || contentType === "jingle" || (tab === "image" && imageMode === "presenter")) setAvatarId((a) => a ?? defaultAvatar);
  }, [contentType, defaultAvatar, tab, imageMode]);
  // The config below the type step appears once a type (and, for cartoon, a
  // style — and for images, a mode) is chosen.
  const cfgReady =
    tab === "blog" ||
    (tab === "image" && imageMode !== null) ||
    (tab === "video" && (
      baseOf(contentType) === "avatar" ||
      baseOf(contentType) === "highlight" ||
      contentType === "commercial" ||
      contentType === "jingle" ||
      (contentType === "cartoon" && !!cartoonStyle)));
  const [direction, setDirection] = useState(""); // image style / blog topic
  const [templateKey, setTemplateKey] = useState<string | null>(null); // image ad template (statue previews)
  const [formatKey, setFormatKey] = useState<string | null>(null); // image ad FORMAT (the proven compositions)
  const [allFormats, setAllFormats] = useState(false); // "See all" expander on the format grid
  // video prompting — default: EasyMode decides. Advanced reveals the 3 W's.
  const [advanced, setAdvanced] = useState(false);
  const [saySomething, setSaySomething] = useState("");
  const [doWhat, setDoWhat] = useState("");
  const [where, setWhere] = useState("");
  // Import-by-URL (works with or without a Shopify catalog).
  const [extraProducts, setExtraProducts] = useState<{ title: string; image: string | null; url: string | null; apparel?: boolean }[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [showImport, setShowImport] = useState(false);
  const allProducts = [...extraProducts, ...products];
  useEffect(() => {
    const imp = actionData && "imported" in actionData ? (actionData as { imported: { title: string; image: string | null; url: string | null } }).imported : null;
    if (imp) { setExtraProducts((prev) => (prev.some((p) => p.url === imp.url) ? prev : [imp, ...prev])); setPicked(0); setUrlInput(""); setShowImport(false); }
  }, [actionData]);
  const importErr = actionData && "importError" in actionData ? (actionData as { importError: string }).importError : null;

  const meta = TABS.find((t) => t.key === tab)!;
  const product = allProducts[picked];
  // Presenter × product → hold vs wear. Auto-detect apparel; reset the override
  // when the product changes so detection leads.
  const [wearOverride, setWearOverride] = useState<boolean | null>(null);
  useEffect(() => { setWearOverride(null); }, [picked]);
  // Post-generate popup → Archive Storage
  const [showDone, setShowDone] = useState(false);
  useEffect(() => { if (actionData && "queued" in actionData) setShowDone(true); }, [actionData]);
  // Service mode — an intangible offer (coaching, SaaS, a subscription…). No
  // product to hold, so the presenter explains and sells the outcome. Defaults
  // on when the picked product has no photo (a strong service signal).
  const [serviceOverride, setServiceOverride] = useState<boolean | null>(null);
  useEffect(() => { setServiceOverride(null); }, [picked]);
  const service = serviceOverride === null ? (!!product && !product.image) : serviceOverride;
  const showService = (tab === "video" || (tab === "image" && imageMode === "product")) && !!product;
  const showWear = ((tab === "video" && contentType === "avatar") || (tab === "image" && imageMode === "presenter")) && !!avatarId && !!product && !service;
  const wear = wearOverride === null ? !!product?.apparel : wearOverride;

  // Rotate the presenter's 4 wardrobe variants across generations so repeated
  // content of the same face never looks stale (0→1→2→3→…, remembered locally).
  const nextVariant = () => {
    let n = 0;
    try { n = ((parseInt(localStorage.getItem("csOutfit") || "0", 10) || 0) + 1); localStorage.setItem("csOutfit", String(n)); } catch { /* ignore */ }
    return String(n % 4);
  };

  const generate = () => {
    if (!product) return;
    const intent = tab === "video" ? "genVideo" : tab === "image" ? "genImage" : "genBlog";
    const fields: Record<string, string> = { intent, productTitle: product.title, productImageUrl: product.image || "" };
    if (tab === "video") {
      let dir = "";
      if (advanced) {
        const parts: string[] = [];
        if (saySomething.trim()) parts.push(`They say: ${saySomething.trim()}`);
        if (doWhat.trim()) parts.push(`They do: ${doWhat.trim()}`);
        if (where.trim()) parts.push(`Setting: ${where.trim()}`);
        dir = parts.join(". ");
      }
      // Visual scene = the setting/action → shapes the composed opening frame
      const sceneParts = [doWhat.trim(), where.trim()].filter(Boolean);
      if (sceneParts.length) fields.scene = sceneParts.join(". ");
      fields.direction = dir;
      // Presenter rides along for Avatar AI, Cartoon Avatar and Anthem (the
      // character presents or SINGS) — highlight never carries one, even if a
      // pick lingers in shared state.
      if ((baseOf(contentType) === "avatar" || contentType === "cartoon" || contentType === "jingle") && avatarId) { fields.avatarId = avatarId; fields.avatarVariant = nextVariant(); if (wear && contentType === "avatar") fields.wear = "1"; }
    } else {
      fields.direction = direction.trim();
      if (tab === "image") {
        if (direction.trim()) fields.scene = direction.trim();
        // Presenter rides along ONLY in presenter mode; templates only in
        // product mode. Template picked → preview-matched delivery (tweak
        // text re-stages the same scene). Otherwise: text = generative scene,
        // blank = photo-true bright composite.
        if (imageMode === "presenter" && avatarId) { fields.avatarId = avatarId; fields.avatarVariant = nextVariant(); if (wear) fields.wear = "1"; }
        if (imageMode === "product" && templateKey && !service) fields.templateKey = templateKey;
        if (imageMode === "product" && formatKey && !service) fields.formatKey = formatKey;
        fields.styleMode = direction.trim() ? "scene" : "backdrop";
      }
    }
    if (service) fields.service = "1";
    if (tab === "video" && contentType) {
      fields.contentType = contentType;
      if ((contentType === "cartoon" || contentType === "jingle") && cartoonStyle) fields.cartoonStyle = cartoonStyle;
      if (videoEngine !== "auto") fields.videoEngine = videoEngine;
      if (commercial && (contentType === "avatar" || contentType === "highlight")) {
        fields.commercial = "1";
        // Commercial look rides the existing scene/direction plumbing for the
        // presenter path (composed frame + motion prompt both honor it).
        const commercialScene = "a seamless bold single-color studio backdrop that complements the product's colors, big-budget commercial styling, crisp professional studio lighting";
        fields.scene = fields.scene ? `${fields.scene}. ${commercialScene}` : commercialScene;
        fields.direction = fields.direction ? `${fields.direction}. Big-budget studio commercial energy.` : "Big-budget studio commercial energy: polished, confident, premium.";
      }
    }
    submit(fields, { method: "post" });
  };

  // Style tiles follow the SELECTED presenter — pick Omar, see Omar in every
  // style. Server renders each character's set on demand (portrait fallback
  // while it cooks).
  const styleChar = avatarId ?? defaultAvatar ?? "ingrid";
  // ?v must move when a style's tile version bumps, or browsers pin the old art
  const styleCover = (key: string) => `/style-tiles/${styleChar}-${key}.jpg?v=5`;

  // Mirror the server rule exactly, or the quote and the charge diverge:
  // a presenter video ignores the engine picker, so it carries no surcharge.
  const engineApplies = tab === "video" && !avatarId;
  const engineFee = engineApplies ? engineSurcharge(videoEngine) : 0;
  const costLabel = `${meta.cost + engineFee} tokens${engineFee ? ` (incl. +${engineFee} engine)` : ""}`;

  return (
    <Page>
      <div className="smp">
        <h1 className="smp-h1">Content Studio</h1>
        <p className="smp-sub">Make one piece by hand, in your voice — created now and dropped into your Archive Storage.</p>

        <div className="cs-tabs">
          {TABS.map((t) => (
            <button type="button" key={t.key} className={`cs-tab${t.key === tab ? " sel" : ""}`} onClick={() => setTab(t.key)}>
              <span className="cs-ti">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {(!hasBrand || !hasPlan) && (
          <div style={{ marginBottom: 14 }}>
            <Banner tone="warning" title={!hasBrand ? "Analyze your store first" : "Choose a plan first"}>
              <p>{!hasBrand ? "Run the brand analyzer on the dashboard so content matches your voice." : "Content runs on tokens — pick a plan to start generating."}</p>
            </Banner>
          </div>
        )}
        {error && <div style={{ marginBottom: 14 }}><Banner tone="warning" title="Couldn't generate"><p>{error}</p></Banner></div>}

        <div className="smp-cfg">
          {/* STEP 1 — pick your content type (video). Shifts in place to the
              type's picker; a back button returns here. */}
          {tab === "video" && !contentType && (
            <>
              <div className="cfg-lbl cs-lblrow"><span>Pick your content type</span></div>
              <div className="cfg-cast cs-ctypes bigtiles">
                {CONTENT_TYPES.map((ct) => {
                  const lock = lockFor(ct.key);
                  return (
                    <button
                      type="button"
                      key={ct.key}
                      className={`cast cs-ctype${ct.live ? "" : " soon"}${lock ? " cs-lockd" : ""}`}
                      onClick={() => (lock ? setUpsell({ name: ct.name, tier: lock.tier, price: lock.price }) : setContentType(ct.key))}
                    >
                      <span className="ca-img cs-ctimg" style={{ backgroundImage: `url(${ct.cover})` }}>
                        {!ct.live && <span className="ca-soon">SOON</span>}
                        {lock && <span className="cs-lockbadge">🔒 {lock.tier}</span>}
                      </span>
                      <span className="ca-nm">{ct.name}</span>
                      <span className="ca-sub">{lock ? `Unlock with ${lock.tier}` : ct.sub}</span>
                    </button>
                  );
                })}
              </div>
              {upsell && (
                <div className="cs-upsell">
                  <div className="cs-upsell-card">
                    <div className="cs-upsell-ttl">🔒 {upsell.name} is a {upsell.tier} feature</div>
                    <div className="cs-upsell-sub">Upgrade to {upsell.tier} (${upsell.price}/mo) to unlock it — everything you already have comes along.</div>
                    <div className="cs-upsell-row">
                      <Link to="/app/plans" className="cs-upsell-go">See plans</Link>
                      <button type="button" className="cs-upsell-x" onClick={() => setUpsell(null)}>Not now</button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          {tab === "video" && contentType && (
            <>
              <button type="button" className="cs-back" onClick={() => setContentType(null)}>‹ Content type</button>
              {baseOf(contentType) === "avatar" && <PresenterPicker cast={cast} value={avatarId} onChange={setAvatarId} allowNone={false} brandFaceId={brandFaceId} />}
              {contentType === "highlight" && <p className="cfg-note cs-ctnote">🎬 <b>Product Highlight</b> — cinematic motion built around your product. No presenter needed.</p>}
              {contentType === "review" && <p className="cfg-note cs-ctnote">🤳 <b>UGC Review</b> — your presenter films it like a real customer review: phone-shot, casual, straight to camera. The kind of post people actually trust.</p>}
              {contentType === "unboxing" && <p className="cfg-note cs-ctnote">📦 <b>Unboxing</b> — the box opens on camera: your presenter lifts the product out, reacts, and shows it off up close.</p>}
              {contentType === "asmr" && <p className="cfg-note cs-ctnote">🌊 <b>Satisfying Close-Up</b> — extreme macro, slow luxurious motion, textures and light. No presenter — just the loop nobody scrolls past.</p>}
              {contentType === "cartoon" && (
                <>
                  {/* Presenter FIRST — the style tiles render AS the chosen
                    * presenter, so this order explains whose face is in them. */}
                  <PresenterPicker cast={cast} value={avatarId} onChange={setAvatarId} allowNone={true} brandFaceId={brandFaceId} />
                  {!avatarId && <p className="cfg-note">No presenter — the ad goes product-hero in the picked style instead.</p>}
                  <div className="cfg-lbl cs-lblrow"><span>Pick a cartoon avatar style</span><span className="cs-opt">previews show your chosen presenter</span></div>
                  <div className="cfg-cast cs-ctypes bigtiles">
                    {CARTOON_STYLES.map((cs) => (
                      <button type="button" key={cs.key} className={`cast cs-ctype${cartoonStyle === cs.key ? " sel" : ""}`} onClick={() => setCartoonStyle(cs.key)}>
                        <span className="ca-img cs-ctimg cs-cartimg" style={{ backgroundImage: `url(${styleCover(cs.key)})`, backgroundColor: cs.tint }}>{cartoonStyle === cs.key && <span className="ca-chk">✓</span>}</span>
                        <span className="ca-nm">{cs.name}</span>
                      </button>
                    ))}
                  </div>
                  {cartoonStyle ? (
                    <p className="cfg-note cs-ctnote">🎨 <b>{CARTOON_STYLES.find((c) => c.key === cartoonStyle)?.name}</b> — {CARTOON_STYLES.find((c) => c.key === cartoonStyle)?.blurb}. Your presenter and product get redrawn in this style, then animated with a narrator.</p>
                  ) : (
                    <p className="cfg-note cs-ctnote">Pick the style — your presenter becomes the character, your product stays recognizable.</p>
                  )}
                </>
              )}
              {(contentType === "avatar" || contentType === "highlight") && (
                <label className="cs-commercial">
                  <input type="checkbox" checked={commercial} onChange={(e) => { setCommercial(e.target.checked); if (e.target.checked) setBreakout(false); }} />
                  <span><b>🎬 Commercial look</b> — big-budget studio spot: seamless color-block set matched to your product, styled &amp; hero-lit</span>
                </label>
              )}
              {contentType === "highlight" && (
                <label className="cs-commercial">
                  <input type="checkbox" checked={breakout} onChange={(e) => { setBreakout(e.target.checked); if (e.target.checked) setCommercial(false); }} />
                  <span><b>💥 Breakout</b> — your product bursts out of a social post frame in 3D, the scroll-stopper</span>
                </label>
              )}
              <div className="cfg-lbl cs-lblrow"><span>Video engine</span><span className="cs-opt">premium engines add tokens</span></div>
              <div className="cs-engines">
                {VIDEO_ENGINES.map((e) => (
                  <button type="button" key={e.key} className={`cs-engine${videoEngine === e.key ? " sel" : ""}`} onClick={() => setVideoEngine(e.key)} title={e.blurb}>
                    <b>{e.name}</b>
                    <span>{e.surcharge > 0 ? `+${e.surcharge} tokens` : "included"}</span>
                  </button>
                ))}
              </div>
              {contentType === "jingle" && (
                <>
                  <p className="cfg-note cs-ctnote">🎵 <b>Anthem</b> — we write your product an earworm: the iconic, stuck-in-your-head jingle of a 2000s commercial, and your presenter <i>sings it on camera</i>, lipsynced. Pick your singer first — photoreal, or redrawn in a cartoon style below. No singer = the song plays over a cinematic product shot.</p>
                  <PresenterPicker cast={cast} value={avatarId} onChange={setAvatarId} allowNone={true} brandFaceId={brandFaceId} />
                  {!avatarId && <p className="cfg-note">No singer picked — the anthem plays over a hero shot of your product instead.</p>}
                  <div className="cfg-lbl cs-lblrow"><span>Singer style</span><span className="cs-opt">previews show your chosen singer</span></div>
                  <div className="cfg-cast cs-ctypes bigtiles">
                    <button type="button" className={`cast cs-ctype${cartoonStyle === null ? " sel" : ""}`} onClick={() => setCartoonStyle(null)}>
                      <span className="ca-img cs-ctimg cs-cartimg" style={{ backgroundImage: `url(/avatars/${styleChar}_0.jpg)` }}>{cartoonStyle === null && <span className="ca-chk">✓</span>}</span>
                      <span className="ca-nm">📷 Photoreal</span>
                    </button>
                    {CARTOON_STYLES.map((cs) => (
                      <button type="button" key={cs.key} className={`cast cs-ctype${cartoonStyle === cs.key ? " sel" : ""}`} onClick={() => setCartoonStyle(cs.key)}>
                        <span className="ca-img cs-ctimg cs-cartimg" style={{ backgroundImage: `url(${styleCover(cs.key)})`, backgroundColor: cs.tint }}>{cartoonStyle === cs.key && <span className="ca-chk">✓</span>}</span>
                        <span className="ca-nm">{cs.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {/* IMAGE STEP 1 — what kind of image ad? Presenter picker stays
              hidden until the presenter path is explicitly chosen. */}
          {tab === "image" && !imageMode && (
            <>
              <div className="cfg-lbl cs-lblrow"><span>What kind of image ad?</span></div>
              <div className="cfg-cast cs-ctypes bigtiles">
                <button type="button" className="cast cs-ctype" onClick={() => setImageMode("product")}>
                  <span className="ca-img cs-ctimg" style={{ backgroundImage: "url(/ad-templates/format-offer.jpg?v=2)" }} />
                  <span className="ca-nm">🖼 Product ad</span>
                  <span className="ca-sub">Your product as the hero — pick a template scene</span>
                </button>
                <button type="button" className="cast cs-ctype" onClick={() => setImageMode("presenter")}>
                  <span className="ca-img cs-ctimg" style={{ backgroundImage: "url(/style-tiles/avatarcover.jpg?v=4)" }} />
                  <span className="ca-nm">🤳 Presenter holding it</span>
                  <span className="ca-sub">A real-looking presenter holds your product</span>
                </button>
              </div>
            </>
          )}
          {tab === "image" && imageMode && (
            <>
              <button type="button" className="cs-back" onClick={() => setImageMode(null)}>‹ Image type</button>
              {imageMode === "presenter" && (
                <>
                  <PresenterPicker cast={cast} value={avatarId} onChange={setAvatarId} allowNone={false} brandFaceId={brandFaceId} />
                  {avatarId && <p className="cfg-note">The presenter will hold your product in the shot — pick a product with a photo below.</p>}
                </>
              )}
            </>
          )}
          {(((tab === "video" && baseOf(contentType) === "avatar") || (tab === "image" && imageMode === "presenter"))) && avatarId && <p className="cfg-note">Their outfit rotates each time, so your content never looks stale.</p>}
          {(((tab === "video" && baseOf(contentType) === "avatar") || (tab === "image" && imageMode === "presenter"))) && avatarId && avatarId !== brandFaceId && (
            <button type="button" className="cs-setbf" onClick={() => submit({ intent: "setBrandFace", avatarId }, { method: "post" })}>★ Make {cast.find((c) => c.id === avatarId)?.name || "this presenter"} your Brand Face</button>
          )}

          {cfgReady && (<>
          <div className="cfg-lbl cs-lblrow"><span>{tab === "blog" ? "Product to write about" : "Product to feature"}</span><button type="button" className="cs-viewall" onClick={() => setShowImport((s) => !s)}>{showImport ? "Cancel" : "＋ Add by URL"}</button></div>
          {showImport && (
            <div className="cs-import">
              <input className="cs-input" type="url" value={urlInput} placeholder="Paste a product link…" onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && urlInput.trim()) { e.preventDefault(); submit({ intent: "importUrl", url: urlInput.trim() }, { method: "post" }); } }} />
              <button type="button" className="cs-impbtn" disabled={busy || !urlInput.trim()} onClick={() => submit({ intent: "importUrl", url: urlInput.trim() }, { method: "post" })}>{busy ? "…" : "Import"}</button>
            </div>
          )}
          {importErr && <p className="cfg-note" style={{ color: "#9A3120" }}>{importErr}</p>}
          {allProducts.length > 0 ? (
            <div className="cfg-prods">
              {allProducts.map((p, i) => (
                <button type="button" key={i} className={`prod${picked === i ? " sel" : ""}`} onClick={() => setPicked(i)} title={p.title}>
                  <span className="pr-img" style={p.image ? { backgroundImage: `url(${p.image})` } : undefined}>{picked === i && <span className="pr-chk">✓</span>}{i < extraProducts.length && <span className="pr-url">↗</span>}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="cfg-note">Pick a product from your store, or <b>Add by URL</b> above.</p>
          )}
          {product && <p className="cfg-note">Featuring <b>{product.title}</b></p>}

          {showService && (
            <>
              <div className="cfg-lbl cs-lblrow"><span>What are you promoting?</span>{!product?.image && <span className="cs-opt">no photo → service</span>}</div>
              <div className="dc-seg cs-svc">
                <button type="button" className={!service ? "sel" : ""} onClick={() => setServiceOverride(false)}>📦 Physical product</button>
                <button type="button" className={service ? "sel" : ""} onClick={() => setServiceOverride(true)}>✨ Service / offer</button>
              </div>
              {service && <p className="cs-svchint">{tab === "video" && contentType === "commercial" ? <>The commercial tells your offer&apos;s <b>transformation story</b> — before, discovery, after — and closes on a branded end-card. No product shot needed.</> : tab === "video" && (contentType === "cartoon" || contentType === "jingle" || baseOf(contentType) === "highlight") ? <>The ad sells the <b>outcome</b> of your offer — no product shot needed. Great for coaching, subscriptions, digital &amp; local services.</> : <>The presenter explains your offer and sells the <b>outcome</b> — no product shot needed. Great for coaching, subscriptions, digital &amp; local services.</>}</p>}
            </>
          )}

          {showWear && (
            <>
              <div className="cfg-lbl cs-lblrow"><span>How they show it</span>{product?.apparel && <span className="cs-opt">apparel detected</span>}</div>
              <div className="dc-seg cs-wear">
                <button type="button" className={!wear ? "sel" : ""} onClick={() => setWearOverride(false)}>✋ Holding it</button>
                <button type="button" className={wear ? "sel" : ""} onClick={() => setWearOverride(true)}>👕 Wearing it <span className="cs-wq">(generally for apparel)</span></button>
              </div>
            </>
          )}

          {tab === "video" ? (
            <>
              <div className="cfg-lbl cs-lblrow">
                <span>Prompting</span>
                <button type="button" className="cs-viewall" onClick={() => setAdvanced((a) => !a)}>{advanced ? "Use auto" : "Advanced ▾"}</button>
              </div>
              {!advanced ? (
                <div className="cs-autobox">✨ <b>EasyMode decides</b> the scene &amp; script from your brand voice. Tap <b>Advanced</b> to direct it yourself.</div>
              ) : (
                <div className="cs-3w">
                  <div className="cs-wfield">
                    <span className="cs-w">{contentType === "jingle" ? "What should the anthem sing about?" : contentType === "cartoon" ? "What should the narrator say?" : "What do they say?"}</span>
                    <textarea className="cs-input cs-ta" value={saySomething} maxLength={400} placeholder={contentType === "jingle" ? "Lines or claims to work into the lyrics…" : "The hook + a couple talking points, in your voice…"} onChange={(e) => setSaySomething(e.target.value)} />
                  </div>
                  <div className="cs-wfield">
                    <span className="cs-w">{contentType === "cartoon" || contentType === "jingle" ? "What happens in the scene?" : "What do they do?"}</span>
                    <input className="cs-input" type="text" value={doWhat} maxLength={160} placeholder={contentType === "cartoon" || contentType === "jingle" ? "the product saves the day, sparkles, celebration…" : "unbox it, hold it up, demo a feature…"} onChange={(e) => setDoWhat(e.target.value)} />
                  </div>
                  <div className="cs-wfield">
                    <span className="cs-w">{contentType === "cartoon" || contentType === "jingle" ? "Where does it happen?" : "Where are they?"}</span>
                    <input className="cs-input" type="text" value={where} maxLength={140} placeholder="a cozy cabin, a city rooftop, a snowy slope…" onChange={(e) => setWhere(e.target.value)} />
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {tab === "image" && imageMode === "product" && !service && (
                <>
                  <div className="cfg-lbl cs-lblrow"><span>Ad format — proven structures, not filters</span>{formatKey && <button type="button" className="cs-viewall" onClick={() => setFormatKey(null)}>Clear</button>}</div>
                  <div className={`cfg-cast cs-ctypes bigtiles fmtgrid${allFormats ? " cs-fmtbox" : ""}`}>
                    {(allFormats ? AD_FORMATS : AD_FORMATS.slice(0, 8)).map((f, i) => (
                      <button type="button" key={f.key} className={`cast cs-ctype${formatKey === f.key ? " sel" : ""}`}
                        style={allFormats ? { animationDelay: `${Math.min(i * 22, 550)}ms` } : undefined}
                        onClick={() => { setFormatKey(formatKey === f.key ? null : f.key); setTemplateKey(null); }}>
                        <span className="ca-img cs-ctimg" style={{ backgroundImage: `url(/ad-templates/format-${f.key}.jpg?v=2)` }}>{formatKey === f.key && <span className="ca-chk">✓</span>}</span>
                        <span className="ca-nm">{f.emoji} {f.name}</span>
                        <span className="ca-sub">{f.blurb}</span>
                      </button>
                    ))}
                  </div>
                  <div style={{ textAlign: "center", marginTop: 6 }}>
                    <button type="button" className="cs-seeall" onClick={() => setAllFormats((v) => !v)}>
                      {allFormats ? "Show fewer ▴" : `See all ${AD_FORMATS.length} formats ▾`}
                    </button>
                  </div>
                  <p className="cfg-note cs-ctnote">Each format is a different creative <b>structure</b> — copy is written fresh for your product, the layout is built around your real photo, and a vision check rejects garbled text before you ever see it.</p>
                  <details className="cs-scenes">
                    <summary className="cfg-lbl cs-lblrow"><span>Backdrop scenes (classic){templateKey ? " · 1 selected" : ""}</span></summary>
                    <div className="cfg-cast cs-ctypes bigtiles">
                      {AD_TEMPLATES.map((t) => (
                        <button type="button" key={t.key} className={`cast cs-ctype${templateKey === t.key ? " sel" : ""}`} onClick={() => { setTemplateKey(templateKey === t.key ? null : t.key); setFormatKey(null); }}>
                          <span className="ca-img cs-ctimg" style={{ backgroundImage: `url(/ad-templates/preview-${t.key}.jpg?v=10)` }}>{templateKey === t.key && <span className="ca-chk">✓</span>}</span>
                          <span className="ca-nm">{t.emoji} {t.name}</span>
                          <span className="ca-sub">{t.kind === "exact" ? "Exact match — your product, this scene" : "AI-staged to match"}</span>
                        </button>
                      ))}
                    </div>
                  </details>
                </>
              )}
              {tab === "blog" && (
                <>
                  <div className="cfg-lbl">Pick an angle <span className="cs-opt">optional</span></div>
                  <div className="cs-styles">
                    {BLOG_ANGLES.map((s, i) => <button type="button" key={i} className={`cs-chip${direction === s.prompt ? " sel" : ""}`} onClick={() => setDirection(direction === s.prompt ? "" : s.prompt)}>{s.label}</button>)}
                  </div>
                </>
              )}
              {tab === "image" && <div className="cfg-lbl">{templateKey ? "Tweaks" : "Describe it"} <span className="cs-opt">optional</span></div>}
              <input className="cs-input" type="text" value={direction} maxLength={300} placeholder={tab === "image" ? (templateKey ? "Any edits — e.g. make the wall sage green, add pine branches…" : "Describe the scene you want — or leave blank for bright & clean…") : "Tap an angle above, or describe your own topic…"} onChange={(e) => setDirection(e.target.value)} />
            </>
          )}

          <div className="smp-tok"><div className="tt">This {meta.noun}</div><div className="tb"><b>{meta.cost}</b><span>tokens</span></div></div>

          <button type="button" className="smp-cta go" disabled={busy || !product || (tab === "video" && baseOf(contentType) === "avatar" && !avatarId) || (tab === "video" && contentType === "cartoon" && !cartoonStyle) || (tab === "image" && imageMode === "presenter" && !avatarId)} onClick={generate}>
            {busy ? "Sending to the studio…" : `${meta.verb} ${meta.noun} — ${costLabel}`}
          </button>
          <p className="smp-wallet">{hasPlan ? `Wallet: ${tokens.toLocaleString()} tokens` : "Choose a subscription plan to generate."}</p>
          </>)}
        </div>

        {showDone && queued && (
          <div className="cs-scrim" onClick={() => setShowDone(false)}>
            <div className="cs-modal" onClick={(e) => e.stopPropagation()}>
              <div className="cs-mi">✨</div>
              <b className="cs-mh">Your {queued} is being made</b>
              <p className="cs-mp">Find it — and everything else EasyMode makes — in your <b>Archive Storage</b>.</p>
              <Link className="cs-mcta" to={`/app/archive?tab=${queued}`}>Go to Archive Storage ›</Link>
              <button type="button" className="cs-mclose" onClick={() => setShowDone(false)}>Make another</button>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
