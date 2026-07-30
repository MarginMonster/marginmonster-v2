/* Web Studio — the SAME experience as the embedded Content Studio, minus
 * Shopify: big content-type tiles with live renders, per-presenter cartoon
 * style grids, presenter cards, tier lock badges, the engine picker and the
 * Commercial look. Same token costs, same server-side capability gates, same
 * worker pipelines. Product input = name + photo URL (any store). */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { spendTokens, tokensRemainingLive } from "../lib/tokens.server";
import { enqueueJob } from "../lib/job-queue.server";
import { TOKEN_COST } from "../lib/plan-config";
import { assertCapability, capabilitiesFor, videoCapabilityFor } from "../lib/capabilities.server";
import { AVATARS, avatarImg } from "../lib/avatars";
import { AD_TEMPLATES, AD_TEMPLATE_BY_KEY } from "../lib/ad-templates";
import { VIDEO_ENGINES, engineSurcharge, normalizeEngineKey } from "../lib/video-engines";

// Mirrors the embedded Studio's pickers (same keys, names, live art routes).
const CONTENT_TYPES = [
  { key: "avatar", name: "Avatar AI", cover: "/style-tiles/avatarcover.jpg?v=2", sub: "A real-looking presenter talks it up", cap: "video", tier: "Studio", price: 59 },
  { key: "highlight", name: "Product Highlight", cover: "/ad-templates/phcover.jpg?v=1", sub: "Cinematic motion, no presenter", cap: "video", tier: "Studio", price: 59 },
  { key: "cartoon", name: "Cartoon Avatar", cover: "/style-tiles/cover.jpg?v=2", sub: "Your presenter & product, redrawn viral-style", cap: "cartoon", tier: "Anthem", price: 99 },
  { key: "jingle", name: "Anthem", cover: "/style-tiles/anthemcover.jpg?v=2", sub: "Your avatar SINGS your product's theme song", cap: "anthem", tier: "Anthem", price: 99 },
] as const;

const CARTOON_STYLES = [
  { key: "dreamanime", name: "Dream Anime", tint: "#6FAF7C" },
  { key: "toyfigure", name: "Boxed Figure", tint: "#F4B400" },
  { key: "brick", name: "Block Build", tint: "#D93A2B" },
  { key: "pixar", name: "3D Toon", tint: "#34C3E7" },
  { key: "retroanime", name: "Retro Anime", tint: "#E5397D" },
  { key: "vintagetoon", name: "Vintage Toon", tint: "#E7A33C" },
  { key: "puppet", name: "Felt Puppet", tint: "#8E5BD9" },
  { key: "clay", name: "Claymation", tint: "#B08526" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  return json({
    hasBrand: !!shop.brandProfile,
    hasPlan: !!shop.activePlan?.active,
    tokens: tokensRemainingLive(shop.activePlan),
    caps: [...capabilitiesFor(shop.activePlan)] as string[],
    cast: AVATARS.map((a) => ({ id: a.id, name: a.name, img: avatarImg(a.id, 0) })),
    templates: AD_TEMPLATES.map((t) => ({ key: t.key, name: t.name, emoji: t.emoji, blurb: t.blurb })),
    costs: { video: TOKEN_COST.video, image: TOKEN_COST.image, blog: TOKEN_COST.blog },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  if (!shop.brandProfile) return json({ error: "Set your brand voice on the Dashboard first." });
  if (!shop.activePlan?.active) return json({ error: "Pick a plan on the Dashboard first — content runs on tokens." });

  const form = await request.formData();
  const intent = form.get("intent") as string;
  const productTitle = ((form.get("productTitle") as string) || "").trim();
  const productImageUrl = ((form.get("productImageUrl") as string) || "").trim() || undefined;
  const direction = ((form.get("direction") as string) || "").trim() || undefined;
  if (!productTitle) return json({ error: "Give the product a name." });
  if (productImageUrl && !/^https?:\/\//.test(productImageUrl)) return json({ error: "The product image must be a full https:// URL." });

  try {
    if (intent === "video") {
      const contentType = ((form.get("contentType") as string) || "").trim() || undefined;
      const avatarId = ((form.get("avatarId") as string) || "").trim() || undefined;
      const cartoonStyle = ((form.get("cartoonStyle") as string) || "").trim() || undefined;
      const videoEngine = normalizeEngineKey((form.get("videoEngine") as string) || "");
      const commercial = form.get("commercial") === "1";
      assertCapability(shop.activePlan, videoCapabilityFor(contentType));
      const charged = TOKEN_COST.video + engineSurcharge(videoEngine);
      await spendTokens(shop.id, charged);
      await enqueueJob(shop.id, "GENERATE_VIDEO_AD", {
        productTitle, productImageUrl, customPrompt: direction, productDescription: direction,
        style: avatarId && contentType !== "cartoon" && contentType !== "jingle" ? "AI_AVATAR" : "PRODUCT_HIGHLIGHT",
        contentType, cartoonStyle: contentType === "cartoon" ? (cartoonStyle || "pixar") : (contentType === "jingle" ? cartoonStyle : undefined),
        avatarId, avatarVariant: 0, holdProduct: !!avatarId && !contentType,
        videoEngine, commercial, chargedTokens: charged, prePaid: true, initiator: "web",
      });
      return json({ ok: "Video queued — it lands in your Archive in a few minutes. 🎬" });
    }
    if (intent === "image") {
      assertCapability(shop.activePlan, "image");
      const avatarId = ((form.get("avatarId") as string) || "").trim() || undefined;
      const rawTemplate = ((form.get("templateKey") as string) || "").trim();
      const templateKey = AD_TEMPLATE_BY_KEY[rawTemplate] ? rawTemplate : undefined;
      await spendTokens(shop.id, TOKEN_COST.image);
      await enqueueJob(shop.id, "GENERATE_IMAGE_AD", {
        productTitle, productImageUrl, stylePrompt: direction,
        styleMode: direction ? "scene" : "backdrop",
        templateKey: avatarId ? undefined : templateKey,
        avatarId, avatarVariant: 0, prePaid: true,
      });
      return json({ ok: "Image ad queued — check the Archive shortly. 🖼" });
    }
    if (intent === "blog") {
      assertCapability(shop.activePlan, "blog");
      await spendTokens(shop.id, TOKEN_COST.blog);
      await enqueueJob(shop.id, "GENERATE_BLOG_POST", { productTitle, productDescription: direction, prePaid: true });
      return json({ ok: "Article queued — check the Archive shortly. ✍️" });
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Couldn't queue that." });
  }
  return json({});
};

type Tab = "video" | "image" | "blog";
type CType = (typeof CONTENT_TYPES)[number]["key"];

export default function WebStudio() {
  const d = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const can = (c: string) => d.caps.includes(c);

  const [tab, setTab] = useState<Tab>("video");
  const [contentType, setContentType] = useState<CType | null>(null);
  const [cartoonStyle, setCartoonStyle] = useState<string | null>(null);
  const [avatarId, setAvatarId] = useState<string | null>(d.cast[0]?.id ?? null);
  const [imageMode, setImageMode] = useState<"product" | "presenter" | null>(null);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [videoEngine, setVideoEngine] = useState("auto");
  const [commercial, setCommercial] = useState(false);
  const [upsell, setUpsell] = useState<{ name: string; tier: string; price: number } | null>(null);

  const styleChar = avatarId ?? d.cast[0]?.id ?? "ingrid";
  const styleCover = (key: string) => `/style-tiles/${styleChar}-${key}.jpg?v=${key === "brick" ? 4 : 2}`;

  const engineFee = tab === "video" ? engineSurcharge(videoEngine) : 0;
  const cost = tab === "video" ? d.costs.video + engineFee : tab === "image" ? d.costs.image : d.costs.blog;
  const needsPresenter = tab === "video" ? contentType === "avatar" : tab === "image" && imageMode === "presenter";
  const showCartoonGrid = tab === "video" && (contentType === "cartoon" || contentType === "jingle");
  const cfgReady = tab === "blog" || (tab === "video" && !!contentType && (contentType !== "cartoon" || !!cartoonStyle)) || (tab === "image" && imageMode !== null);

  const err = actionData && "error" in actionData ? (actionData.error as string) : null;
  const ok = actionData && "ok" in actionData ? (actionData.ok as string) : null;

  const Presenters = ({ optional }: { optional?: boolean }) => (
    <>
      <div className="ws-lbl">Presenter{optional ? <span className="ws-opt">optional</span> : null}</div>
      <div className="ws-cast">
        {optional && (
          <button type="button" className={`ws-face${avatarId === null ? " sel" : ""}`} onClick={() => setAvatarId(null)}>
            <span className="ws-face-img none">✕</span><span>None</span>
          </button>
        )}
        {d.cast.map((c) => (
          <button type="button" key={c.id} className={`ws-face${avatarId === c.id ? " sel" : ""}`} onClick={() => setAvatarId(c.id)}>
            <span className="ws-face-img" style={{ backgroundImage: `url(${c.img})` }}>{avatarId === c.id && <b>✓</b>}</span>
            <span>{c.name}</span>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div>
      <h1 className="wb-h1">Content Studio</h1>
      <p className="wb-sub">Make one piece by hand, in your voice — it lands in your <Link to="/web/archive">Archive</Link>. Balance: 🪙 {d.tokens.toLocaleString()}</p>
      {!d.hasBrand && <div className="wb-err">Set your <Link to="/web">brand voice</Link> first so content sounds like you.</div>}
      {!d.hasPlan && <div className="wb-err">Pick a <Link to="/web">plan</Link> first — content runs on tokens.</div>}
      {err && <div className="wb-err">{err}</div>}
      {ok && <div className="wb-ok">{ok}</div>}

      <div className="ws-tabs">
        {([["video", "🎬 Video"], ["image", "🖼 Image"], ["blog", "✍️ Article"]] as [Tab, string][]).map(([k, label]) => (
          <button type="button" key={k} className={`ws-tab${tab === k ? " on" : ""}`} onClick={() => { setTab(k); setUpsell(null); }}>{label}</button>
        ))}
      </div>

      <Form method="post" className="wb-card ws-card">
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
            <input type="hidden" name="contentType" value={contentType === "cartoon" || contentType === "jingle" ? contentType : ""} />
            {showCartoonGrid && (
              <>
                <div className="ws-lbl">{contentType === "jingle" ? "Singer style" : "Pick a cartoon avatar style"}{contentType === "jingle" && <span className="ws-opt">optional — none = photoreal</span>}</div>
                <div className="ws-tiles styles">
                  {CARTOON_STYLES.map((cs) => (
                    <button type="button" key={cs.key} className={`ws-tile small${cartoonStyle === cs.key ? " sel" : ""}`}
                      onClick={() => setCartoonStyle(contentType === "jingle" && cartoonStyle === cs.key ? null : cs.key)}>
                      <span className="ws-tile-img" style={{ backgroundImage: `url(${styleCover(cs.key)})`, backgroundColor: cs.tint }}>{cartoonStyle === cs.key && <span className="ws-chk">✓</span>}</span>
                      <b>{cs.name}</b>
                    </button>
                  ))}
                </div>
                {cartoonStyle && <input type="hidden" name="cartoonStyle" value={cartoonStyle} />}
              </>
            )}
            {(contentType === "avatar" || showCartoonGrid) && <Presenters optional={contentType !== "avatar"} />}
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
                <span className="ws-tile-img" style={{ backgroundImage: "url(/ad-templates/preview-colorblock.jpg?v=8)" }} />
                <b>Product ad</b><span className="ws-tile-sub">Your product in a famous ad format</span>
              </button>
              <button type="button" className="ws-tile" onClick={() => setImageMode("presenter")}>
                <span className="ws-tile-img" style={{ backgroundImage: "url(/style-tiles/avatarcover.jpg?v=2)" }} />
                <b>With presenter</b><span className="ws-tile-sub">A presenter holds it, poster copy on top</span>
              </button>
            </div>
          </>
        )}
        {tab === "image" && imageMode && (
          <>
            <button type="button" className="ws-back" onClick={() => { setImageMode(null); setTemplateKey(null); }}>‹ Image type</button>
            {imageMode === "product" && (
              <>
                <div className="ws-lbl">Ad template <span className="ws-opt">optional — the preview is exactly what you get</span></div>
                <div className="ws-tiles styles">
                  {d.templates.map((t) => (
                    <button type="button" key={t.key} className={`ws-tile small${templateKey === t.key ? " sel" : ""}`} title={t.blurb}
                      onClick={() => setTemplateKey(templateKey === t.key ? null : t.key)}>
                      <span className="ws-tile-img" style={{ backgroundImage: `url(/ad-templates/preview-${t.key}.jpg?v=8)` }}>{templateKey === t.key && <span className="ws-chk">✓</span>}</span>
                      <b>{t.emoji} {t.name}</b>
                    </button>
                  ))}
                </div>
                {templateKey && <input type="hidden" name="templateKey" value={templateKey} />}
              </>
            )}
            {imageMode === "presenter" && (
              <>
                <Presenters />
                {avatarId && <input type="hidden" name="avatarId" value={avatarId} />}
              </>
            )}
          </>
        )}

        {/* ---- Shared product fields + CTA ---- */}
        {(tab === "blog" || cfgReady) && (
          <>
            <div className="ws-lbl">Product name</div>
            <input className="wb-in" name="productTitle" required placeholder="Midnight Roast — whole bean coffee" />
            {tab !== "blog" && (
              <>
                <div className="ws-lbl">Product photo URL <span className="ws-opt">powers videos & image ads</span></div>
                <input className="wb-in" name="productImageUrl" placeholder="https://yourstore.com/cdn/product.jpg" />
              </>
            )}
            <div className="ws-lbl">Direction <span className="ws-opt">optional</span></div>
            <input className="wb-in" name="direction" placeholder="cozy autumn morning energy, focus on the aroma" />
            <div style={{ marginTop: 18 }}>
              <button className="wb-btn" name="intent" value={tab} disabled={busy}>
                {busy ? "Queuing…" : `Create · ${cost} tokens`}
              </button>
            </div>
          </>
        )}
      </Form>
    </div>
  );
}

function needsPresenterField(ct: CType | null): boolean {
  return ct === "avatar" || ct === "cartoon" || ct === "jingle";
}
