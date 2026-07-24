import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit, Link } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Page, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { enqueueJob } from "../lib/job-queue.server";
import { spendTokens } from "../lib/tokens.server";
import { tokensRemaining } from "../lib/tokens.server";
import { TOKEN_COST } from "../lib/plan-config";
import { AVATARS, avatarImg, DESIGNED_VOICES } from "../lib/avatars";

type Tab = "video" | "image" | "blog";
const TABS: { key: Tab; label: string; icon: string; cost: number; verb: string; noun: string }[] = [
  { key: "video", label: "Video", icon: "🎬", cost: TOKEN_COST.video, verb: "Generate", noun: "video" },
  { key: "image", label: "Image", icon: "🖼", cost: TOKEN_COST.image, verb: "Generate", noun: "image" },
  { key: "blog", label: "Blog", icon: "✍️", cost: TOKEN_COST.blog, verb: "Write", noun: "article" },
];

// Wearable products should be modeled (worn) by the presenter, not held.
const APPAREL_RE = /\b(shirt|tee|t-shirt|top|blouse|hoodie|sweat(er|shirt)?|jacket|coat|dress|skirt|pant|trouser|jean|short|legging|activewear|apparel|clothing|clothes|hat|cap|beanie|scarf|sock|jersey|uniform|robe|gown|cardigan|blazer|vest|romper|jumpsuit|swimsuit|bikini|lingerie|underwear|bra|glove|wear|outfit|garment|tank|polo)\b/i;
function isApparel(text: string): boolean { return APPAREL_RE.test(text); }

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

  const cast = AVATARS.map((a) => ({ id: a.id, name: a.name, img: avatarImg(a.id, 0), designed: DESIGNED_VOICES.has(a.id) }));
  const videoQuotaLeft = plan ? Math.max(0, plan.videoQuota - plan.videoUsed + plan.videoCredits) : 0;
  const brandFaceId = shop?.brandAvatarId && cast.some((c) => c.id === shop.brandAvatarId) ? shop.brandAvatarId : null;

  return json({
    hasPlan: !!plan?.active,
    hasBrand: !!shop?.brandProfile,
    tokens: tokensRemaining(plan ?? { tokensIncluded: 0, tokensUsed: 0, tokensExtra: 0 }),
    products,
    cast,
    brandFaceId,
    defaultAvatar: brandFaceId ?? cast[0]?.id ?? null,
    videoQuotaLeft,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop }, include: { activePlan: true, brandProfile: true } });
  if (!shop) return json({ error: "Shop not found." });
  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (!shop.brandProfile) return json({ error: "Analyze your store first (on the dashboard) so content matches your brand." });
  if (!shop.activePlan?.active) return json({ error: "Pick a package first — content runs on tokens." });

  const productTitle = ((form.get("productTitle") as string) || "").trim();
  const productImageUrl = ((form.get("productImageUrl") as string) || "").trim() || undefined;
  const direction = ((form.get("direction") as string) || "").trim() || undefined;
  const wear = form.get("wear") === "1";
  const scene = ((form.get("scene") as string) || "").trim() || undefined;
  const clipMode = form.get("clipMode") === "action" ? "action" : undefined;
  if (!productTitle) return json({ error: "Pick a product to feature." });

  if (intent === "genVideo") {
    const avatarId = ((form.get("avatarId") as string) || "").trim() || undefined;
    const avatarVariant = Math.max(0, Math.min(3, parseInt((form.get("avatarVariant") as string) || "0", 10) || 0));
    const style = avatarId ? "AI_AVATAR" : "PRODUCT_HIGHLIGHT";
    let prePaid = false;
    const left = shop.activePlan.videoQuota - shop.activePlan.videoUsed + shop.activePlan.videoCredits;
    if (left <= 0) {
      try { await spendTokens(shop.id, TOKEN_COST.video); prePaid = true; }
      catch (e) { return json({ error: e instanceof Error ? e.message : "Not enough tokens for this video." }); }
    }
    await enqueueJob(shop.id, "GENERATE_VIDEO_AD", { productTitle, style, customPrompt: direction, avatarId, avatarVariant, productImageUrl, productDescription: direction, holdProduct: !!avatarId, wearProduct: !!avatarId && wear, scene, clipMode, prePaid });
    return json({ ok: true, queued: "video" });
  }
  if (intent === "genImage") {
    const avatarId = ((form.get("avatarId") as string) || "").trim() || undefined;
    const avatarVariant = Math.max(0, Math.min(3, parseInt((form.get("avatarVariant") as string) || "0", 10) || 0));
    if (avatarId && !productImageUrl) return json({ error: "Pick a product with a photo — the presenter needs something to hold." });
    try { await spendTokens(shop.id, TOKEN_COST.image); }
    catch (e) { return json({ error: e instanceof Error ? e.message : "Not enough tokens for a still." }); }
    await enqueueJob(shop.id, "GENERATE_IMAGE_AD", { productTitle, productImageUrl, stylePrompt: direction, avatarId, avatarVariant, wear: !!avatarId && wear, scene, prePaid: true });
    return json({ ok: true, queued: "image" });
  }
  if (intent === "genBlog") {
    try { await spendTokens(shop.id, TOKEN_COST.blog); }
    catch (e) { return json({ error: e instanceof Error ? e.message : "Not enough tokens for an article." }); }
    await enqueueJob(shop.id, "GENERATE_BLOG_POST", { productTitle, productDescription: direction, prePaid: true });
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
  const PREVIEW = 8;
  const selIdx = value ? ordered.findIndex((c) => c.id === value) : -1;
  const preview = ordered.slice(0, PREVIEW);
  if (selIdx >= PREVIEW) preview.push(ordered[selIdx]);

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
        <button type="button" className="cs-viewall" onClick={() => setOpen((o) => !o)}>{open ? "Show less" : `View all ${cast.length}`}</button>
      </div>
      {open ? (
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
  const { hasPlan, hasBrand, tokens, products, cast, brandFaceId, defaultAvatar, videoQuotaLeft } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const error = actionData && "error" in actionData ? actionData.error : null;
  const queued = actionData && "queued" in actionData ? actionData.queued : null;

  const [tab, setTab] = useState<Tab>("video");
  const [picked, setPicked] = useState(0);
  const [avatarId, setAvatarId] = useState<string | null>(defaultAvatar);
  const [direction, setDirection] = useState(""); // image style / blog topic
  // video prompting — default: EasyMode decides. Advanced reveals the 3 W's.
  const [advanced, setAdvanced] = useState(false);
  const [saySomething, setSaySomething] = useState("");
  const [doWhat, setDoWhat] = useState("");
  const [where, setWhere] = useState("");
  const [actionMode, setActionMode] = useState(false); // video: talking vs action clip

  const meta = TABS.find((t) => t.key === tab)!;
  const product = products[picked];
  const videoFree = videoQuotaLeft > 0;
  // Presenter × product → hold vs wear. Auto-detect apparel; reset the override
  // when the product changes so detection leads.
  const [wearOverride, setWearOverride] = useState<boolean | null>(null);
  useEffect(() => { setWearOverride(null); }, [picked]);
  // Post-generate popup → Archive Storage
  const [showDone, setShowDone] = useState(false);
  useEffect(() => { if (actionData && "queued" in actionData) setShowDone(true); }, [actionData]);
  const showWear = (tab === "video" || tab === "image") && !!avatarId && !!product;
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
      // Visual scene = the action + setting (shapes the opening frame / motion)
      const sceneParts = [doWhat.trim(), where.trim()].filter(Boolean);
      if (sceneParts.length) fields.scene = sceneParts.join(". ");
      fields.direction = dir;
      if (actionMode && avatarId) fields.clipMode = "action";
      if (avatarId) { fields.avatarId = avatarId; fields.avatarVariant = nextVariant(); if (wear) fields.wear = "1"; }
    } else {
      fields.direction = direction.trim();
      if (tab === "image") { if (direction.trim()) fields.scene = direction.trim(); if (avatarId) { fields.avatarId = avatarId; fields.avatarVariant = nextVariant(); if (wear) fields.wear = "1"; } }
    }
    submit(fields, { method: "post" });
  };

  const costLabel = tab === "video" ? (videoFree ? "uses 1 plan video" : `${meta.cost} tokens`) : `${meta.cost} tokens`;

  return (
    <Page>
      <div className="smp">
        <h1 className="smp-h1">Content Studio</h1>
        <p className="smp-sub">Make one piece by hand, in your voice — created now and dropped into your Content Queue.</p>

        <div className="cs-tabs">
          {TABS.map((t) => (
            <button type="button" key={t.key} className={`cs-tab${t.key === tab ? " sel" : ""}`} onClick={() => setTab(t.key)}>
              <span className="cs-ti">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {(!hasBrand || !hasPlan) && (
          <div style={{ marginBottom: 14 }}>
            <Banner tone="warning" title={!hasBrand ? "Analyze your store first" : "Choose a package first"}>
              <p>{!hasBrand ? "Run the brand analyzer on the dashboard so content matches your voice." : "Content runs on tokens — pick a plan to start generating."}</p>
            </Banner>
          </div>
        )}
        {error && <div style={{ marginBottom: 14 }}><Banner tone="warning" title="Couldn't generate"><p>{error}</p></Banner></div>}

        <div className="smp-cfg">
          {(tab === "video" || tab === "image") && (
            <PresenterPicker cast={cast} value={avatarId} onChange={setAvatarId} allowNone={true} brandFaceId={brandFaceId} />
          )}
          {tab === "image" && avatarId && <p className="cfg-note">The presenter will hold your product in the shot — pick a product with a photo below.</p>}
          {(tab === "video" || tab === "image") && avatarId && <p className="cfg-note">Their outfit rotates each time, so your content never looks stale.</p>}

          {tab === "video" && avatarId && (
            <>
              <div className="cfg-lbl">Video type</div>
              <div className="dc-seg cs-wear">
                <button type="button" className={!actionMode ? "sel" : ""} onClick={() => setActionMode(false)}>🗣 Talking</button>
                <button type="button" className={actionMode ? "sel" : ""} onClick={() => setActionMode(true)}>🎬 Action clip</button>
              </div>
              {actionMode && <p className="cfg-note">A short motion clip from your <b>scene &amp; action</b> — no talking or captions. Fill in <b>What do they do / Where</b> under Advanced below.</p>}
            </>
          )}

          <div className="cfg-lbl">{tab === "blog" ? "Product to write about" : "Product to feature"}</div>
          {products.length > 0 ? (
            <div className="cfg-prods">
              {products.map((p, i) => (
                <button type="button" key={i} className={`prod${picked === i ? " sel" : ""}`} onClick={() => setPicked(i)} title={p.title}>
                  <span className="pr-img" style={p.image ? { backgroundImage: `url(${p.image})` } : undefined}>{picked === i && <span className="pr-chk">✓</span>}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="cfg-note">Add a product to your store to generate content.</p>
          )}
          {product && <p className="cfg-note">Featuring <b>{product.title}</b></p>}

          {showWear && (
            <>
              <div className="cfg-lbl cs-lblrow"><span>How they show it</span>{product?.apparel && <span className="cs-opt">apparel detected</span>}</div>
              <div className="dc-seg cs-wear">
                <button type="button" className={!wear ? "sel" : ""} onClick={() => setWearOverride(false)}>✋ Holding it</button>
                <button type="button" className={wear ? "sel" : ""} onClick={() => setWearOverride(true)}>👕 Wearing it</button>
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
                    <span className="cs-w">What do they say?</span>
                    <textarea className="cs-input cs-ta" value={saySomething} maxLength={400} placeholder="The hook + a couple talking points, in your voice…" onChange={(e) => setSaySomething(e.target.value)} />
                  </div>
                  <div className="cs-wfield">
                    <span className="cs-w">What do they do?</span>
                    <input className="cs-input" type="text" value={doWhat} maxLength={160} placeholder="unbox it, hold it up, demo a feature…" onChange={(e) => setDoWhat(e.target.value)} />
                  </div>
                  <div className="cs-wfield">
                    <span className="cs-w">Where are they?</span>
                    <input className="cs-input" type="text" value={where} maxLength={140} placeholder="a cozy cabin, a city rooftop, a snowy slope…" onChange={(e) => setWhere(e.target.value)} />
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="cfg-lbl">{tab === "blog" ? "What should it cover?" : "Direction"} <span className="cs-opt">optional</span></div>
              <input className="cs-input" type="text" value={direction} maxLength={200} placeholder={tab === "image" ? "e.g. Clean studio, lifestyle scene…" : "e.g. Best uses, buyer's guide, how-to…"} onChange={(e) => setDirection(e.target.value)} />
            </>
          )}

          <div className="smp-tok"><div className="tt">This {meta.noun}</div><div className="tb"><b>{tab === "video" && videoFree ? "Free" : meta.cost}</b><span>{tab === "video" && videoFree ? "1 of your plan videos" : "tokens"}</span></div></div>

          <button type="button" className="smp-cta go" disabled={busy || !product} onClick={generate}>
            {busy ? "Sending to the studio…" : `${meta.verb} ${meta.noun} — ${costLabel}`}
          </button>
          <p className="smp-wallet">{hasPlan ? `Wallet: ${tokens.toLocaleString()} tokens` : "Choose a subscription plan to generate."}</p>
        </div>

        {showDone && queued && (
          <div className="cs-scrim" onClick={() => setShowDone(false)}>
            <div className="cs-modal" onClick={(e) => e.stopPropagation()}>
              <div className="cs-mi">✨</div>
              <b className="cs-mh">Your {queued} is being made</b>
              <p className="cs-mp">Find it — and everything else EasyMode makes — in your <b>Archive Storage</b>.</p>
              <Link className="cs-mcta" to="/app/archive">Go to Archive Storage ›</Link>
              <button type="button" className="cs-mclose" onClick={() => setShowDone(false)}>Make another</button>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
