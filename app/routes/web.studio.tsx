/* Web Studio — the SAME experience as the embedded Content Studio, minus
 * Shopify: big content-type tiles with live renders, per-presenter cartoon
 * style grids, presenter cards with voice previews, tier lock badges, the
 * engine picker, Commercial look, service mode, hold/wear, Advanced
 * prompting, Brand Face and import-by-URL. Same token costs, same
 * server-side capability gates, same worker pipelines. Product input =
 * name + photo (upload, URL, or scraped from any store's product page). */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams, useSubmit } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";
import { spendTokens, tokensRemainingLive } from "../lib/tokens.server";
import { enqueueJob } from "../lib/job-queue.server";
import { TOKEN_COST } from "../lib/plan-config";
import { assertCapability, capabilitiesFor, videoCapabilityFor } from "../lib/capabilities.server";
import { AVATARS, avatarImg, DESIGNED_VOICES } from "../lib/avatars";
import { AD_TEMPLATES, AD_TEMPLATE_BY_KEY } from "../lib/ad-templates";
import { AD_FORMATS, AD_FORMAT_BY_KEY } from "../lib/ad-formats";
import { VIDEO_ENGINES, engineSurcharge, normalizeEngineKey } from "../lib/video-engines";

// Mirrors the embedded Studio's pickers (same keys, names, live art routes).
const CONTENT_TYPES = [
  { key: "avatar", name: "Avatar AI", cover: "/style-tiles/avatarcover.jpg?v=4", sub: "A real-looking presenter talks it up", cap: "video", tier: "Studio", price: 59 },
  { key: "highlight", name: "Product Highlight", cover: "/ad-templates/phcover.jpg?v=1", sub: "Cinematic motion, no presenter", cap: "video", tier: "Studio", price: 59 },
  { key: "cartoon", name: "Cartoon Avatar", cover: "/style-tiles/cover.jpg?v=4", sub: "Your presenter & product, redrawn viral-style", cap: "cartoon", tier: "Studio", price: 59 },
  { key: "jingle", name: "Anthem", cover: "/style-tiles/anthemcover.jpg?v=4", sub: "A stuck-in-your-head theme song — iconic 2000s commercial energy", cap: "anthem", tier: "Studio", price: 59 },
] as const;

const CARTOON_STYLES = [
  { key: "dreamanime", name: "Dream Anime", emoji: "🌿", tint: "#6FAF7C", blurb: "Your presenter as a soft painterly anime character — the style the whole internet shares" },
  { key: "toyfigure", name: "Boxed Figure", emoji: "🧍", tint: "#F4B400", blurb: "Presenter & product as a collectible figure in the pack — the viral format" },
  { key: "papercut", name: "Paper Craft", emoji: "✂️", tint: "#E58A4E", blurb: "A handmade layered-paper diorama — the craft style feeds fall in love with" },
  { key: "pixar", name: "3D Toon", emoji: "🧸", tint: "#34C3E7", blurb: "Big-studio 3D character film — glossy and cinematic" },
  { key: "retroanime", name: "Retro Anime", emoji: "📼", tint: "#E5397D", blurb: "90s VHS anime — sunset palettes and speed lines" },
  { key: "vintagetoon", name: "Vintage Toon", emoji: "🎪", tint: "#E7A33C", blurb: "Playful vintage 2D — hand-inked, storybook warmth" },
  { key: "puppet", name: "Felt Puppet", emoji: "🧦", tint: "#8E5BD9", blurb: "Fuzzy felt and googly eyes — puppet-show charm" },
  { key: "clay", name: "Claymation", emoji: "🎭", tint: "#B08526", blurb: "Hand-molded stop-motion, cozy and tactile" },
];

// Wearable products should be modeled (worn) by the presenter, not held.
const APPAREL_RE = /\b(shirt|tee|t-shirt|top|blouse|hoodie|sweat(er|shirt)?|jacket|coat|dress|skirt|pant|trouser|jean|short|legging|activewear|apparel|clothing|clothes|hat|cap|beanie|scarf|sock|jersey|uniform|robe|gown|cardigan|blazer|vest|romper|jumpsuit|swimsuit|bikini|lingerie|underwear|bra|glove|wear|outfit|garment|tank|polo)\b/i;
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

const decodeEntities = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const cast = AVATARS.map((a) => ({ id: a.id, name: a.name, img: avatarImg(a.id, 0), designed: DESIGNED_VOICES.has(a.id) }));
  const brandFaceId = shop.brandAvatarId && cast.some((c) => c.id === shop.brandAvatarId) ? shop.brandAvatarId : null;
  return json({
    hasBrand: !!shop.brandProfile,
    hasPlan: !!shop.activePlan?.active,
    tokens: tokensRemainingLive(shop.activePlan),
    caps: [...capabilitiesFor(shop.activePlan)] as string[],
    cast,
    brandFaceId,
    templates: AD_TEMPLATES.map((t) => ({ key: t.key, name: t.name, emoji: t.emoji, blurb: t.blurb, kind: t.kind })),
    costs: { video: TOKEN_COST.video, image: TOKEN_COST.image, blog: TOKEN_COST.blog },
  });
};

/** Can our render engines actually FETCH this product photo? Replicate and
 *  fal download the URL server-side; a 403/404, a login wall or an HTML error
 *  page comes back as "input was invalid" minutes later, after the merchant
 *  has already been charged. Cheap pre-flight: must answer 2xx with an image
 *  content-type (or at least real image bytes). Never blocks on our own
 *  slowness — a timeout is treated as reachable rather than failing a
 *  legitimate photo. */
async function checkImageUrl(url: string): Promise<{ ok: boolean; why: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    let res = await fetch(url, { method: "HEAD", signal: ctl.signal, redirect: "follow" });
    // Plenty of CDNs refuse HEAD — fall back to a tiny ranged GET.
    if (res.status === 405 || res.status === 501 || res.status === 403) {
      res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-1023" }, signal: ctl.signal, redirect: "follow" });
    }
    if (!res.ok) return { ok: false, why: `the link returned ${res.status}` };
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (type && !type.startsWith("image/")) return { ok: false, why: "the link isn't an image" };
    return { ok: true, why: "" };
  } catch (e) {
    // Abort = our probe was slow, not proof the URL is bad. Let it through;
    // the pipeline degrades on its own if the fetch really fails.
    if (e instanceof Error && e.name === "AbortError") return { ok: true, why: "" };
    return { ok: false, why: "we couldn't reach it" };
  } finally {
    clearTimeout(timer);
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  // Crown a presenter as the Brand Face (no plan/brand gate needed).
  if (intent === "setBrandFace") {
    const id = ((form.get("avatarId") as string) || "").trim() || null;
    await db.shop.update({ where: { id: shop.id }, data: { brandAvatarId: id, brandAvatarVariant: 0 } });
    return json({ brandFaceSet: true });
  }

  // Import a product by URL — scrapes any storefront's page for a title +
  // image (JSON-LD → og: → <title>), with a Shopify /products/*.js shortcut.
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

  if (!shop.brandProfile) return json({ error: "Set your brand voice on the Dashboard first." });
  if (!shop.activePlan?.active) return json({ error: "Pick a plan on the Dashboard first — content runs on tokens." });

  const productTitle = ((form.get("productTitle") as string) || "").trim();
  const urlField = ((form.get("productImageUrl") as string) || "").trim() || undefined;
  const direction = ((form.get("direction") as string) || "").trim() || undefined;
  const service = form.get("service") === "1"; // intangible offering — sell the outcome
  const wear = form.get("wear") === "1";
  const scene = ((form.get("scene") as string) || "").trim() || undefined;
  if (!productTitle) return json({ error: "Give the product a name." });
  if (urlField && !/^https?:\/\//.test(urlField)) return json({ error: "The product image must be a full https:// URL." });

  // Uploaded photo beats the URL field — not everyone has a hosted image.
  // Stored on the persistent disk and served publicly at /uploads/* so the
  // render engines can fetch it like any other product URL.
  let productImageUrl = urlField;
  const photo = form.get("productPhoto");
  if (photo && typeof photo !== "string" && photo.size > 0) {
    if (!/^image\//.test(photo.type)) return json({ error: "That file isn't an image — use a JPG, PNG or WebP." });
    if (photo.size > 8 * 1024 * 1024) return json({ error: "Image too large — keep it under 8 MB." });
    const [fsMod, pathMod, crypto] = await Promise.all([import("node:fs"), import("node:path"), import("node:crypto")]);
    const ext = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
    const dir = pathMod.join(process.cwd(), "data", "renders", "uploads");
    fsMod.mkdirSync(dir, { recursive: true });
    const name = `${shop.id.toLowerCase().replace(/[^a-z0-9]/g, "")}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
    fsMod.writeFileSync(pathMod.join(dir, name), Buffer.from(await photo.arrayBuffer()));
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    if (!base) return json({ error: "Photo uploads aren't configured on this server yet — paste an image URL instead." });
    productImageUrl = `${base}/uploads/${name}`;
  }

  // REACHABILITY GATE — the render engines fetch this URL themselves, and an
  // unfetchable one made them reject the job three minutes later ("input was
  // invalid"), after the tokens were already spent. Verify it BEFORE charging
  // so the merchant gets an instant, fixable message instead of a refund loop.
  if (productImageUrl) {
    const reach = await checkImageUrl(productImageUrl);
    if (!reach.ok) return json({ error: `That product photo can't be opened by our renderers (${reach.why}). Try uploading the file directly, or use a public image link.` });
  }

  // HARD REQUIREMENT: no product photo = the engines invent a product from
  // the title and the merchant pays for generic AI art. Services are the one
  // legitimate exception (there is nothing to photograph).
  if ((intent === "video" || intent === "image") && !service && !productImageUrl) {
    return json({ error: "Add a product photo — upload one or paste an image URL. Without it we'd be inventing a product from the name. Promoting a service? Switch to “Service / offer”." });
  }

  try {
    if (intent === "video") {
      const contentType = ((form.get("contentType") as string) || "").trim() || undefined;
      const avatarId = ((form.get("avatarId") as string) || "").trim() || undefined;
      const cartoonStyle = ((form.get("cartoonStyle") as string) || "").trim() || undefined;
      const avatarVariant = Math.max(0, Math.min(3, parseInt((form.get("avatarVariant") as string) || "0", 10) || 0));
      const videoEngine = normalizeEngineKey((form.get("videoEngine") as string) || "");
      const commercial = form.get("commercial") === "1";
      assertCapability(shop.activePlan, videoCapabilityFor(contentType));
      // Pre-charge validation: a presenter has to have something to hold —
      // fail BEFORE tokens are spent, not in the pipeline.
      const presenterVideo = !!avatarId && contentType !== "cartoon" && contentType !== "jingle";
      if (presenterVideo && !productImageUrl && !service) {
        return json({ error: "Add a product photo — the presenter needs something to hold. (Promoting a service? Flip to ✨ Service / offer.)" });
      }
      const charged = TOKEN_COST.video + engineSurcharge(videoEngine);
      await spendTokens(shop.id, charged);
      // Services: the presenter explains the offer to camera — nothing to hold.
      await enqueueJob(shop.id, "GENERATE_VIDEO_AD", {
        productTitle, productImageUrl, customPrompt: direction, productDescription: direction,
        style: presenterVideo ? "AI_AVATAR" : "PRODUCT_HIGHLIGHT",
        contentType, cartoonStyle,
        avatarId, avatarVariant,
        holdProduct: !!avatarId && !service,
        wearProduct: !!avatarId && wear && !service,
        serviceMode: service, scene,
        videoEngine, commercial, chargedTokens: charged, prePaid: true, initiator: "web",
      });
      return json({ ok: true, queued: "video" });
    }
    if (intent === "image") {
      assertCapability(shop.activePlan, "image");
      const avatarId = ((form.get("avatarId") as string) || "").trim() || undefined;
      const avatarVariant = Math.max(0, Math.min(3, parseInt((form.get("avatarVariant") as string) || "0", 10) || 0));
      if (avatarId && !productImageUrl && !service) {
        return json({ error: "Add a product photo — the presenter needs something to hold." });
      }
      const rawTemplate = ((form.get("templateKey") as string) || "").trim();
      const templateKey = AD_TEMPLATE_BY_KEY[rawTemplate] ? rawTemplate : undefined;
      const rawFormat = ((form.get("formatKey") as string) || "").trim();
      const formatKey = AD_FORMAT_BY_KEY[rawFormat] ? rawFormat : undefined;
      await spendTokens(shop.id, TOKEN_COST.image);
      // Services skip the presenter-hold and product photo → outcome scene.
      await enqueueJob(shop.id, "GENERATE_IMAGE_AD", {
        productTitle, productImageUrl, stylePrompt: direction,
        styleMode: direction ? "scene" : "backdrop",
        templateKey: avatarId || service ? undefined : templateKey,
        formatKey: avatarId || service ? undefined : formatKey,
        avatarId: service ? undefined : avatarId, avatarVariant,
        wear: !!avatarId && wear && !service,
        serviceMode: service, scene, prePaid: true,
      });
      return json({ ok: true, queued: "image" });
    }
    if (intent === "blog") {
      assertCapability(shop.activePlan, "blog");
      await spendTokens(shop.id, TOKEN_COST.blog);
      await enqueueJob(shop.id, "GENERATE_BLOG_POST", { productTitle, productDescription: direction, serviceMode: service, prePaid: true });
      return json({ ok: true, queued: "article" });
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Couldn't queue that." });
  }
  return json({});
};

type Tab = "video" | "image" | "blog";
type CType = (typeof CONTENT_TYPES)[number]["key"];
type CastItem = { id: string; name: string; img: string; designed: boolean };

/* Module-level on purpose: defined inside the page component, React would
 * see a NEW component type on every render and remount the strip — which
 * reset the horizontal scroll to the first presenter on every click. Any
 * new inputs come in as explicit props. */
function Presenters({ cast, avatarId, setAvatarId, optional, brandFaceId }: {
  cast: CastItem[];
  avatarId: string | null;
  setAvatarId: (id: string | null) => void;
  optional?: boolean;
  brandFaceId: string | null;
}) {
  // Voice preview: one sample at a time. Designed ("true voice") faces get a
  // lip-sync video instead of the mp3 snippet.
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

  return (
    <>
      <div className="ws-lbl">Presenter{optional ? <span className="ws-opt">optional</span> : null}</div>
      <div className="ws-cast">
        {optional && (
          <button type="button" className={`ws-face${avatarId === null ? " sel" : ""}`} onClick={() => setAvatarId(null)}>
            <span className="ws-face-img none">✕</span><span>None</span>
          </button>
        )}
        {ordered.map((c) => {
          const bf = c.id === brandFaceId;
          return (
            <div key={c.id} className={`ws-face${avatarId === c.id ? " sel" : ""}${bf ? " bf" : ""}`}>
              <button type="button" className="ws-face-pick" onClick={() => setAvatarId(c.id)} aria-label={`Cast ${c.name}`}>
                <span className="ws-face-img" style={{ backgroundImage: `url(${c.img})` }}>{avatarId === c.id && <b>✓</b>}</span>
              </button>
              <button type="button" className={`ws-samp${playing === c.id ? " on" : ""}${c.designed ? " prem" : ""}`} onClick={() => sample(c)}
                title={c.designed ? `Watch ${c.name} speak` : `Hear ${c.name}`} aria-label={c.designed ? `Watch ${c.name} speak` : `Hear ${c.name}'s voice`}>
                {playing === c.id ? "♪" : c.designed ? "▶" : "🔊"}
              </button>
              <span>{bf ? "★ Brand face" : c.name}</span>
            </div>
          );
        })}
      </div>
      {videoId && (
        <div className="ws-vscrim" onClick={() => setVideoId(null)}>
          <div className="ws-vbox" onClick={(e) => e.stopPropagation()}>
            <video src={`/voice-videos/${videoId}.mp4?v=1`} autoPlay controls playsInline className="ws-video" />
            <button type="button" className="ws-vx" onClick={() => setVideoId(null)}>✕</button>
          </div>
        </div>
      )}
    </>
  );
}

export default function WebStudio() {
  const d = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const busy = nav.state !== "idle";
  const can = (c: string) => d.caps.includes(c);

  // Deep-link support: arrive with ?tab= and ?product= pre-filled.
  const [searchParams] = useSearchParams();
  const initTab = (["video", "image", "blog"] as const).find((t) => t === searchParams.get("tab"));
  const [tab, setTab] = useState<Tab>(initTab || "video");
  const [productTitle, setProductTitle] = useState(searchParams.get("product") || "");
  const [imageUrl, setImageUrl] = useState("");
  const [hasFile, setHasFile] = useState(false);
  const [contentType, setContentType] = useState<CType | null>(null);
  const [cartoonStyle, setCartoonStyle] = useState<string | null>(null);
  const [avatarId, setAvatarId] = useState<string | null>(d.brandFaceId ?? d.cast[0]?.id ?? null);
  const [imageMode, setImageMode] = useState<"product" | "presenter" | null>(null);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [formatKey, setFormatKey] = useState<string | null>(null);
  const [allFormats, setAllFormats] = useState(false);
  const [videoEngine, setVideoEngine] = useState("auto");
  const [commercial, setCommercial] = useState(false);
  const [upsell, setUpsell] = useState<{ name: string; tier: string; price: number } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [direction, setDirection] = useState("");
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
  // Import-by-URL (works for any storefront).
  const [showImport, setShowImport] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  // Last-used product memory — offer a one-tap refill next visit.
  const [lastProd, setLastProd] = useState<{ title: string; image: string } | null>(null);
  useEffect(() => {
    try { const raw = localStorage.getItem("wsLastProduct"); if (raw) setLastProd(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);

  const queued = actionData && "queued" in actionData ? (actionData as { queued: string }).queued : null;
  useEffect(() => {
    if (actionData && "queued" in actionData) {
      setShowDone(true);
      try {
        const entry = { title: productTitle.trim(), image: imageUrl.trim() };
        if (entry.title) { localStorage.setItem("wsLastProduct", JSON.stringify(entry)); setLastProd(entry); }
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionData]);
  useEffect(() => {
    const imp = actionData && "imported" in actionData ? (actionData as { imported: { title: string; image: string | null; url: string | null } }).imported : null;
    if (imp) { setProductTitle(imp.title); setImageUrl(imp.image || ""); setUrlInput(""); setShowImport(false); }
  }, [actionData]);
  const importErr = actionData && "importError" in actionData ? (actionData as { importError: string }).importError : null;

  const styleChar = avatarId ?? d.cast[0]?.id ?? "ingrid";
  const styleCover = (key: string) => `/style-tiles/${styleChar}-${key}.jpg?v=5`;

  const engineFee = tab === "video" ? engineSurcharge(videoEngine) : 0;
  const verb = tab === "blog" ? "Write" : "Generate";
  const noun = tab === "video" ? "video" : tab === "image" ? "image" : "article";
  const baseCost = tab === "video" ? d.costs.video : tab === "image" ? d.costs.image : d.costs.blog;
  const cost = baseCost + engineFee;
  const needsPresenter = tab === "video" ? contentType === "avatar" : tab === "image" && imageMode === "presenter";
  const showCartoonGrid = tab === "video" && (contentType === "cartoon" || contentType === "jingle");
  const cfgReady = tab === "blog" || (tab === "video" && !!contentType && (contentType !== "cartoon" || !!cartoonStyle)) || (tab === "image" && imageMode !== null);
  const showService = tab === "video" || (tab === "image" && imageMode === "product");
  const showWear = ((tab === "video" && contentType === "avatar") || (tab === "image" && imageMode === "presenter")) && !!avatarId && !service;
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
    if (commercial && (contentType === "avatar" || contentType === "highlight")) {
      const commercialScene = "a seamless bold single-color studio backdrop that complements the product's colors, big-budget commercial styling, crisp professional studio lighting";
      finalScene = finalScene ? `${finalScene}. ${commercialScene}` : commercialScene;
      finalDirection = finalDirection ? `${finalDirection}. Big-budget studio commercial energy.` : "Big-budget studio commercial energy: polished, confident, premium.";
    }
  } else if (tab === "image") {
    finalScene = direction.trim();
  }

  // Rotate the presenter's 4 wardrobe variants across generations so repeated
  // content of the same face never looks stale (0→1→2→3→…, remembered locally).
  const variantRef = useRef<HTMLInputElement | null>(null);
  const nextVariant = () => {
    let n = 0;
    try { n = ((parseInt(localStorage.getItem("csOutfit") || "0", 10) || 0) + 1); localStorage.setItem("csOutfit", String(n)); } catch { /* ignore */ }
    return String(n % 4);
  };
  const onFormSubmit = () => { if (variantRef.current) variantRef.current.value = nextVariant(); };

  const doImport = () => { if (urlInput.trim()) submit({ intent: "importUrl", url: urlInput.trim() }, { method: "post" }); };

  const err = actionData && "error" in actionData ? (actionData.error as string) : null;
  // A product ad with no product photo is just AI art from the title — the
  // pipeline happily renders it and the merchant pays for slop. Require a
  // photo (upload OR url) for anything that should SHOW the product; services
  // legitimately have nothing to photograph.
  const needsPhoto = tab !== "blog" && !service && !hasFile && !imageUrl.trim();
  const ctaDisabled = busy || !productTitle.trim() || needsPhoto || (needsPresenter && !avatarId) || (tab === "video" && contentType === "cartoon" && !cartoonStyle);

  return (
    <div>
      <style>{WS_STYLE}</style>
      <h1 className="wb-h1">Content Studio</h1>
      <p className="wb-sub">Make one piece by hand, in your voice — it lands in your <Link to="/web/archive">Archive</Link>. Balance: 🪙 {d.tokens.toLocaleString()}</p>
      {!d.hasBrand && <div className="wb-err">Set your <Link to="/web">brand voice</Link> first so content sounds like you.</div>}
      {!d.hasPlan && <div className="wb-err">Pick a <Link to="/web">plan</Link> first — content runs on tokens.</div>}
      {/* Top banner too — a failure must be visible even when the config
          section that holds the inline error is collapsed or scrolled away. */}
      {err && <div className="wb-err">Couldn&apos;t generate: {err}</div>}

      <div className="ws-tabs">
        {([["video", "🎬 Video"], ["image", "🖼 Image"], ["blog", "✍️ Article"]] as [Tab, string][]).map(([k, label]) => (
          <button type="button" key={k} className={`ws-tab${tab === k ? " on" : ""}`} onClick={() => { setTab(k); setUpsell(null); }}>{label}</button>
        ))}
      </div>

      <Form method="post" encType="multipart/form-data" className="wb-card ws-card" onSubmit={onFormSubmit}>
        {/* ---- VIDEO: pick your content type (big live-render tiles) ---- */}
        {tab === "video" && !contentType && (
          <>
            <div className="ws-lbl">Pick your content type</div>
            <div className="ws-tiles">
              {CONTENT_TYPES.map((ct) => {
                const locked = !can(ct.cap);
                return (
                  <button type="button" key={ct.key} className={`ws-tile${locked ? " lockd" : ""}`}
                    onClick={() => (locked ? setUpsell({ name: ct.name, tier: ct.tier, price: ct.price }) : (setContentType(ct.key), setUpsell(null)))}>
                    <span className="ws-tile-img" style={{ backgroundImage: `url(${ct.cover})` }}>
                      {locked && <span className="ws-lock">🔒 {ct.tier}</span>}
                    </span>
                    <b>{ct.name}</b>
                    <span className="ws-tile-sub">{locked ? `Unlock with ${ct.tier}` : ct.sub}</span>
                  </button>
                );
              })}
            </div>
            {upsell && (
              <div className="ws-upsell">
                <b>🔒 {upsell.name} is a {upsell.tier} feature</b>
                <p>Upgrade to {upsell.tier} (${upsell.price}/mo) to unlock it — everything you already have comes along.</p>
                <div><Link to="/web" className="wb-btn" style={{ padding: "9px 20px", fontSize: 13 }}>See plans</Link>
                  <button type="button" className="wb-btn ghost" style={{ padding: "9px 16px", fontSize: 13, marginLeft: 8 }} onClick={() => setUpsell(null)}>Not now</button></div>
              </div>
            )}
          </>
        )}
        {tab === "video" && contentType && (
          <>
            <button type="button" className="ws-back" onClick={() => setContentType(null)}>‹ Content type</button>
            {/* Real content type always rides along — the pipelines route on it
                and videoCapabilityFor() gates avatar/highlight as plain "video". */}
            <input type="hidden" name="contentType" value={contentType} />
            {contentType === "jingle" && (
              <p className="ws-note">🎵 <b>Anthem</b> — we write your product an earworm: the iconic, stuck-in-your-head jingle of a 2000s commercial, and your presenter <i>sings it on camera</i>, lipsynced. Pick your singer first — photoreal, or redrawn in a cartoon style below. No singer = the song plays over a cinematic product shot.</p>
            )}
            {/* Presenter FIRST — the style tiles below render as the chosen
              * presenter, so picking them in this order explains the art. */}
            {(contentType === "avatar" || showCartoonGrid) && <Presenters cast={d.cast} avatarId={avatarId} setAvatarId={setAvatarId} optional={contentType !== "avatar"} brandFaceId={d.brandFaceId} />}
            {contentType === "cartoon" && !avatarId && <p className="ws-note">No presenter — the ad goes product-hero in the picked style instead.</p>}
            {contentType === "jingle" && !avatarId && <p className="ws-note">No singer picked — the anthem plays over a hero shot of your product instead.</p>}
            {showCartoonGrid && (
              <>
                <div className="ws-lbl">{contentType === "jingle" ? "Singer style" : "Pick a cartoon avatar style"} <span className="ws-opt">previews show your chosen {contentType === "jingle" ? "singer" : "presenter"}</span></div>
                <div className="ws-tiles styles">
                  {contentType === "jingle" && (
                    <button type="button" className={`ws-tile small${cartoonStyle === null ? " sel" : ""}`}
                      onClick={() => setCartoonStyle(null)}>
                      <span className="ws-tile-img" style={{ backgroundImage: `url(${d.cast.find((c) => c.id === styleChar)?.img || ""})` }}>{cartoonStyle === null && <span className="ws-chk">✓</span>}</span>
                      <b>📷 Photoreal</b>
                    </button>
                  )}
                  {CARTOON_STYLES.map((cs) => (
                    <button type="button" key={cs.key} className={`ws-tile small${cartoonStyle === cs.key ? " sel" : ""}`}
                      onClick={() => setCartoonStyle(cs.key)}>
                      <span className="ws-tile-img" style={{ backgroundImage: `url(${styleCover(cs.key)})`, backgroundColor: cs.tint }}>{cartoonStyle === cs.key && <span className="ws-chk">✓</span>}</span>
                      <b>{cs.emoji} {cs.name}</b>
                    </button>
                  ))}
                </div>
                {contentType === "cartoon" && (cartoonStyle ? (
                  <p className="ws-note">🎨 <b>{CARTOON_STYLES.find((c) => c.key === cartoonStyle)?.name}</b> — {CARTOON_STYLES.find((c) => c.key === cartoonStyle)?.blurb}. Your presenter and product get redrawn in this style, then animated with a narrator.</p>
                ) : (
                  <p className="ws-note">Pick the style — your presenter becomes the character, your product stays recognizable.</p>
                ))}
                {cartoonStyle && <input type="hidden" name="cartoonStyle" value={cartoonStyle} />}
              </>
            )}
            {contentType === "highlight" && <p className="ws-note">🎬 <b>Product Highlight</b> — cinematic motion built around your product. No presenter needed.</p>}
            {avatarId && needsPresenterField(contentType) && <input type="hidden" name="avatarId" value={avatarId} />}
            {(contentType === "avatar" || contentType === "highlight") && (
              <label className="ws-commercial">
                <input type="checkbox" name="commercial" value="1" checked={commercial} onChange={(e) => setCommercial(e.target.checked)} />
                <span><b>🎬 Commercial look</b> — big-budget studio spot: color-block set matched to your product, hero-lit</span>
              </label>
            )}
            <div className="ws-lbl">Video engine <span className="ws-opt">premium engines add tokens</span></div>
            <div className="ws-engines">
              {VIDEO_ENGINES.map((e) => (
                <button type="button" key={e.key} className={`ws-engine${videoEngine === e.key ? " sel" : ""}`} title={e.blurb} onClick={() => setVideoEngine(e.key)}>
                  <b>{e.name}</b><span>{e.surcharge > 0 ? `+${e.surcharge}` : "included"}</span>
                </button>
              ))}
            </div>
            <input type="hidden" name="videoEngine" value={videoEngine} />
          </>
        )}

        {/* ---- IMAGE: product-ad templates or presenter-holding ---- */}
        {tab === "image" && !imageMode && (
          <>
            <div className="ws-lbl">What kind of image ad?</div>
            <div className="ws-tiles two">
              <button type="button" className="ws-tile" onClick={() => setImageMode("product")}>
                <span className="ws-tile-img" style={{ backgroundImage: "url(/ad-templates/format-offer.jpg?v=2)" }} />
                <b>Product ad</b><span className="ws-tile-sub">Your product in a famous ad format</span>
              </button>
              <button type="button" className="ws-tile" onClick={() => setImageMode("presenter")}>
                <span className="ws-tile-img" style={{ backgroundImage: "url(/style-tiles/avatarcover.jpg?v=4)" }} />
                <b>With presenter</b><span className="ws-tile-sub">A presenter holds it, poster copy on top</span>
              </button>
            </div>
          </>
        )}
        {tab === "image" && imageMode && (
          <>
            <button type="button" className="ws-back" onClick={() => { setImageMode(null); setTemplateKey(null); }}>‹ Image type</button>
            {imageMode === "product" && !service && (
              <>
                <div className="ws-lbl">Ad format <span className="ws-opt">proven structures, not filters</span></div>
                <div className={`ws-tiles fmt${allFormats ? " ws-fmtbox" : ""}`}>
                  {(allFormats ? AD_FORMATS : AD_FORMATS.slice(0, 8)).map((f, i) => (
                    <button type="button" key={f.key} className={`ws-tile fmt${formatKey === f.key ? " sel" : ""}`} title={f.blurb}
                      style={allFormats ? { animationDelay: `${Math.min(i * 22, 550)}ms` } : undefined}
                      onClick={() => { setFormatKey(formatKey === f.key ? null : f.key); setTemplateKey(null); }}>
                      <span className="ws-tile-img" style={{ backgroundImage: `url(/ad-templates/format-${f.key}.jpg?v=2)` }}>{formatKey === f.key && <span className="ws-chk">✓</span>}</span>
                      <b>{f.emoji} {f.name}</b>
                    </button>
                  ))}
                </div>
                <div style={{ textAlign: "center", margin: "8px 0 2px" }}>
                  <button type="button" className="wb-btn ghost" style={{ padding: "8px 18px", fontSize: 12.5 }} onClick={() => setAllFormats((v) => !v)}>
                    {allFormats ? "Show fewer ▴" : `See all ${AD_FORMATS.length} formats ▾`}
                  </button>
                </div>
                <p className="ws-note">Each format is a different creative <b>structure</b> — copy is written fresh for your product, the layout is built around your real photo, and a vision check rejects garbled text before you ever see it.</p>
                {formatKey && <input type="hidden" name="formatKey" value={formatKey} />}
                <details>
                  <summary className="ws-lbl" style={{ cursor: "pointer" }}>Backdrop scenes (classic){templateKey ? " · 1 selected" : ""}</summary>
                  <div className="ws-tiles styles">
                    {d.templates.map((t) => (
                      <button type="button" key={t.key} className={`ws-tile small${templateKey === t.key ? " sel" : ""}`} title={t.blurb}
                        onClick={() => { setTemplateKey(templateKey === t.key ? null : t.key); setFormatKey(null); }}>
                        <span className="ws-tile-img" style={{ backgroundImage: `url(/ad-templates/preview-${t.key}.jpg?v=10)` }}>{templateKey === t.key && <span className="ws-chk">✓</span>}</span>
                        <b>{t.emoji} {t.name}</b>
                        <span className="ws-tile-sub">{t.kind === "exact" ? "Exact match — your product, this scene" : "AI-staged to match"}</span>
                      </button>
                    ))}
                  </div>
                </details>
                {templateKey && <input type="hidden" name="templateKey" value={templateKey} />}
              </>
            )}
            {imageMode === "presenter" && (
              <>
                <Presenters cast={d.cast} avatarId={avatarId} setAvatarId={setAvatarId} brandFaceId={d.brandFaceId} />
                {avatarId && <p className="ws-note">The presenter will hold your product in the shot — add a product photo below.</p>}
                {avatarId && <input type="hidden" name="avatarId" value={avatarId} />}
              </>
            )}
          </>
        )}

        {/* Outfit rotation + Brand Face crowning, wherever a presenter stars. */}
        {((tab === "video" && contentType === "avatar") || (tab === "image" && imageMode === "presenter")) && avatarId && (
          <>
            <p className="ws-note">Their outfit rotates each time, so your content never looks stale.</p>
            {avatarId !== d.brandFaceId && (
              <button type="button" className="ws-setbf" onClick={() => submit({ intent: "setBrandFace", avatarId }, { method: "post" })}>
                ★ Make {d.cast.find((c) => c.id === avatarId)?.name || "this presenter"} your Brand Face
              </button>
            )}
          </>
        )}

        {/* ---- Shared product fields + CTA ---- */}
        {cfgReady && (
          <>
            <div className="ws-lbl"><span>Product name</span>
              <button type="button" className="ws-addurl" onClick={() => setShowImport((s) => !s)}>{showImport ? "Cancel" : "＋ Add by URL"}</button>
            </div>
            {showImport && (
              <div className="ws-import">
                <input className="wb-in" type="url" value={urlInput} placeholder="Paste a product link…" onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && urlInput.trim()) { e.preventDefault(); doImport(); } }} />
                <button type="button" className="wb-btn ws-impbtn" disabled={busy || !urlInput.trim()} onClick={doImport}>{busy ? "…" : "Import"}</button>
              </div>
            )}
            {importErr && <p className="ws-note" style={{ color: "#9A3120" }}>{importErr}</p>}
            {lastProd && lastProd.title && lastProd.title !== productTitle.trim() && (
              <button type="button" className="ws-chip ws-lastchip" onClick={() => { setProductTitle(lastProd.title); setImageUrl(lastProd.image || ""); }}>
                ↺ Use last: {lastProd.title}
              </button>
            )}
            <input className="wb-in" name="productTitle" required value={productTitle} onChange={(e) => setProductTitle(e.target.value)} placeholder="Midnight Roast — whole bean coffee" />
            {tab !== "blog" && (
              <>
                <div className="ws-lbl">Product photo <span className="ws-opt">powers videos & image ads — upload or paste a URL</span></div>
                <input className="wb-in" type="file" name="productPhoto" accept="image/jpeg,image/png,image/webp" style={{ padding: 9 }}
                  onChange={(e) => setHasFile(!!e.currentTarget.files?.length)} />
                <input className="wb-in" name="productImageUrl" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="…or https://yourstore.com/cdn/product.jpg" style={{ marginTop: 8 }} />
                {needsPhoto && (
                  <p className="ws-note" style={{ color: "#8A5A12" }}>
                    Add a photo so the ad features <b>your</b> product — without one we&apos;d be inventing a product from the name. Promoting a service? Switch to <b>Service / offer</b> below.
                  </p>
                )}
              </>
            )}

            {showService && (
              <>
                <div className="ws-lbl">What are you promoting?</div>
                <div className="ws-seg">
                  <button type="button" className={!service ? "sel" : ""} onClick={() => setService(false)}>📦 Physical product</button>
                  <button type="button" className={service ? "sel" : ""} onClick={() => setService(true)}>✨ Service / offer</button>
                </div>
                {service && <p className="ws-svchint">{tab === "video" && (contentType === "cartoon" || contentType === "jingle" || contentType === "highlight") ? <>The ad sells the <b>outcome</b> of your offer — no product shot needed. Great for coaching, subscriptions, digital &amp; local services.</> : <>The presenter explains your offer and sells the <b>outcome</b> — no product shot needed. Great for coaching, subscriptions, digital &amp; local services.</>}</p>}
              </>
            )}

            {showWear && (
              <>
                <div className="ws-lbl"><span>How they show it</span>{apparel && <span className="ws-opt">apparel detected</span>}</div>
                <div className="ws-seg">
                  <button type="button" className={!wear ? "sel" : ""} onClick={() => setWearOverride(false)}>✋ Holding it</button>
                  <button type="button" className={wear ? "sel" : ""} onClick={() => setWearOverride(true)}>👕 Wearing it <span className="ws-wq">(generally for apparel)</span></button>
                </div>
              </>
            )}

            {tab === "video" ? (
              <>
                <div className="ws-lbl"><span>Prompting</span>
                  <button type="button" className="ws-addurl" onClick={() => setAdvanced((a) => !a)}>{advanced ? "Use auto" : "Advanced ▾"}</button>
                </div>
                {!advanced ? (
                  <>
                    <div className="ws-autobox">✨ <b>EasyMode decides</b> the scene &amp; script from your brand voice. Tap <b>Advanced</b> to direct it yourself — or drop a quick direction below.</div>
                    <input className="wb-in" value={direction} maxLength={300} placeholder="cozy autumn morning energy, focus on the aroma" onChange={(e) => setDirection(e.target.value)} />
                  </>
                ) : (
                  <div className="ws-3w">
                    <div>
                      <span className="ws-w">{contentType === "jingle" ? "What should the anthem sing about?" : contentType === "cartoon" ? "What should the narrator say?" : "What do they say?"}</span>
                      <textarea className="wb-in ws-ta" value={saySomething} maxLength={400} placeholder={contentType === "jingle" ? "Lines or claims to work into the lyrics…" : "The hook + a couple talking points, in your voice…"} onChange={(e) => setSaySomething(e.target.value)} />
                    </div>
                    <div>
                      <span className="ws-w">{contentType === "cartoon" || contentType === "jingle" ? "What happens in the scene?" : "What do they do?"}</span>
                      <input className="wb-in" type="text" value={doWhat} maxLength={160} placeholder={contentType === "cartoon" || contentType === "jingle" ? "the product saves the day, sparkles, celebration…" : "unbox it, hold it up, demo a feature…"} onChange={(e) => setDoWhat(e.target.value)} />
                    </div>
                    <div>
                      <span className="ws-w">{contentType === "cartoon" || contentType === "jingle" ? "Where does it happen?" : "Where are they?"}</span>
                      <input className="wb-in" type="text" value={where} maxLength={140} placeholder="a cozy cabin, a city rooftop, a snowy slope…" onChange={(e) => setWhere(e.target.value)} />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {tab === "blog" && (
                  <>
                    <div className="ws-lbl">Pick an angle <span className="ws-opt">optional</span></div>
                    <div className="ws-chips">
                      {BLOG_ANGLES.map((s, i) => (
                        <button type="button" key={i} className={`ws-chip${direction === s.prompt ? " sel" : ""}`} onClick={() => setDirection(direction === s.prompt ? "" : s.prompt)}>{s.label}</button>
                      ))}
                    </div>
                  </>
                )}
                <div className="ws-lbl">{tab === "image" ? (templateKey ? "Tweaks" : "Describe it") : "Topic"} <span className="ws-opt">optional</span></div>
                <input className="wb-in" value={direction} maxLength={300}
                  placeholder={tab === "image" ? (templateKey ? "Any edits — e.g. make the wall sage green, add pine branches…" : "Describe the scene you want — or leave blank for bright & clean…") : "Tap an angle above, or describe your own topic…"}
                  onChange={(e) => setDirection(e.target.value)} />
              </>
            )}

            {/* Composed fields ride hidden inputs so the native multipart
                submit (needed for the photo upload) carries them. */}
            <input type="hidden" name="direction" value={finalDirection} />
            {finalScene ? <input type="hidden" name="scene" value={finalScene} /> : null}
            {service ? <input type="hidden" name="service" value="1" /> : null}
            {showWear && wear ? <input type="hidden" name="wear" value="1" /> : null}
            {avatarRides && <input ref={variantRef} type="hidden" name="avatarVariant" defaultValue="0" />}

            <div className="ws-tok"><span className="tt">This {noun}</span><span className="tb"><b>{baseCost}</b><i>tokens</i></span></div>

            {err && <div className="wb-err" style={{ marginTop: 4 }}>{err}</div>}
            <div style={{ marginTop: 10 }}>
              <button className="wb-btn" name="intent" value={tab} disabled={ctaDisabled}>
                {busy ? "Sending to the studio…" : `${verb} ${noun} — ${cost} tokens${engineFee ? ` (incl. +${engineFee} engine)` : ""}`}
              </button>
              <p className="ws-wallet">{d.hasPlan ? `Wallet: ${d.tokens.toLocaleString()} tokens` : "Choose a plan to generate."}</p>
            </div>
          </>
        )}
      </Form>

      {showDone && queued && (
        <div className="ws-scrim" onClick={() => setShowDone(false)}>
          <div className="ws-modal" onClick={(e) => e.stopPropagation()}>
            <span className="ws-mrose" aria-hidden />
            <div className="ws-mi">✨</div>
            <b className="ws-mh">Your {queued} is being made</b>
            <p className="ws-mp">It lands in your <b>Archive</b> in a few minutes — along with everything else EasyMode builds for you.</p>
            <Link className="wb-btn ws-mcta" to={`/web/archive?tab=${queued === "article" ? "blog" : queued}`}>View Archive ›</Link>
            <button type="button" className="ws-mclose" onClick={() => setShowDone(false)}>Make another</button>
          </div>
        </div>
      )}
    </div>
  );
}

function needsPresenterField(ct: CType | null): boolean {
  return ct === "avatar" || ct === "cartoon" || ct === "jingle";
}

/* Route-local styles — GStyle palette (paper #F4F1E6, card #FDFCF7, ink
 * #14201A, green #12A85E, gold #B08526/#E7C879), extending the ws-* look
 * that lives in the /web layout. */
const WS_STYLE = `
.ws-face{position:relative}
.ws-face-pick{display:block;width:100%;border:0;background:none;padding:0;cursor:pointer;font:inherit;color:inherit;text-align:center}
.ws-samp{position:absolute;top:46px;right:0;width:24px;height:24px;border-radius:50%;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);cursor:pointer;font-size:11px;line-height:1;display:grid;place-items:center;box-shadow:0 1px 4px rgba(20,32,26,.14);z-index:2;padding:0}
.ws-samp.on{border-color:#12A85E;color:#12A85E}
.ws-samp.prem{border-color:#E7C879;background:#FFFBEF}
.ws-face.bf .ws-face-img{border-color:#B08526;box-shadow:0 0 0 2px rgba(176,133,38,.35)}
.ws-face.bf>span:last-child{color:#7E5E13;font-weight:700}
.ws-vscrim{position:fixed;inset:0;z-index:10600;background:rgba(12,18,14,.6);backdrop-filter:blur(3px);display:grid;place-items:center;padding:20px}
.ws-vbox{position:relative;width:min(420px,92vw)}
.ws-video{width:100%;border-radius:16px;display:block;background:#000;box-shadow:0 18px 60px rgba(0,0,0,.4)}
.ws-vx{position:absolute;top:-10px;right:-10px;width:30px;height:30px;border-radius:50%;border:0;background:#FDFCF7;color:#14201A;font-size:14px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.ws-setbf{display:inline-block;margin:2px 0 6px;padding:8px 14px;border-radius:999px;border:1px solid #E7C879;background:#FFFBEF;color:#7E5E13;font-weight:700;font-size:12.5px;cursor:pointer}
.ws-seg{display:flex;gap:8px;flex-wrap:wrap}
.ws-seg button{padding:9px 14px;border-radius:11px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink2,#4A554E);font-weight:700;font-size:12.5px;cursor:pointer}
.ws-seg button.sel{border-color:#12A85E;box-shadow:0 0 0 1px #12A85E;color:var(--ink,#14201A);background:#F0FAF4}
.ws-wq{font-weight:500;font-size:11px;color:var(--ink2,#4A554E)}
.ws-svchint{font-size:12.5px;color:var(--ink2,#4A554E);background:var(--paper,#F4F1E6);border:1px solid var(--line,#E4DFCF);border-radius:12px;padding:10px 13px;margin:8px 0 0}
.ws-autobox{font-size:13px;color:var(--ink,#14201A);background:var(--paper,#F4F1E6);border:1px dashed #B08526;border-radius:12px;padding:11px 14px;margin:2px 0 8px}
.ws-3w{display:flex;flex-direction:column;gap:10px;margin-top:2px}
.ws-w{display:block;font-size:12px;font-weight:700;color:var(--ink,#14201A);margin-bottom:5px}
.ws-ta{min-height:74px;resize:vertical;font:inherit;width:100%}
.ws-chips{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 4px}
.ws-chip{padding:8px 13px;border-radius:999px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink,#14201A);font-weight:600;font-size:12.5px;cursor:pointer}
.ws-chip.sel{border-color:#12A85E;box-shadow:0 0 0 1px #12A85E;background:#F0FAF4}
.ws-lastchip{display:block;margin:0 0 8px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.ws-import{display:flex;gap:8px;margin-bottom:8px}
.ws-import input{flex:1;min-width:0}
.ws-impbtn{padding:9px 18px;font-size:13px;flex:0 0 auto}
.ws-addurl{border:0;background:none;color:#0C7A46;font-weight:700;font-size:12px;cursor:pointer;padding:0;margin-left:auto}
.ws-tok{display:flex;align-items:center;justify-content:space-between;margin:18px 0 10px;padding:12px 16px;border-radius:14px;background:var(--paper,#F4F1E6);border:1px solid var(--line,#E4DFCF)}
.ws-tok .tt{font-size:12.5px;font-weight:700;color:var(--ink2,#4A554E)}
.ws-tok .tb{font-family:Poppins,sans-serif;font-weight:800;font-size:16px;color:var(--ink,#14201A)}
.ws-tok .tb i{font-style:normal;font-size:11.5px;font-weight:600;color:var(--ink2,#4A554E);margin-left:5px}
.ws-wallet{margin-top:8px;font-size:12.5px;font-weight:600;color:#7E5E13}
`;
