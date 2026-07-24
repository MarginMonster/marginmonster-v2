import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit, Link } from "@remix-run/react";
import { useState } from "react";
import { Page, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { enqueueJob } from "../lib/job-queue.server";
import { spendTokens } from "../lib/tokens.server";
import { tokensRemaining } from "../lib/tokens.server";
import { TOKEN_COST } from "../lib/plan-config";
import { AVATARS, avatarImg } from "../lib/avatars";

type Tab = "video" | "image" | "blog";
const TABS: { key: Tab; label: string; icon: string; cost: number; verb: string; noun: string }[] = [
  { key: "video", label: "Video", icon: "🎬", cost: TOKEN_COST.video, verb: "Generate", noun: "video" },
  { key: "image", label: "Image", icon: "🖼", cost: TOKEN_COST.image, verb: "Generate", noun: "image" },
  { key: "blog", label: "Blog", icon: "✍️", cost: TOKEN_COST.blog, verb: "Write", noun: "article" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop }, include: { activePlan: true, brandProfile: true } });
  const plan = shop?.activePlan ?? null;

  let products: { title: string; image: string | null; url: string | null }[] = [];
  try {
    const res = await admin.graphql(`{ products(first: 12, sortKey: UPDATED_AT, reverse: true) { edges { node { title handle onlineStoreUrl featuredImage { url } } } } }`);
    const j = (await res.json()) as { data?: { products?: { edges?: { node: { title: string; handle?: string; onlineStoreUrl?: string; featuredImage?: { url?: string } } }[] } } };
    products = (j.data?.products?.edges || []).map((e) => ({ title: e.node.title, image: e.node.featuredImage?.url || null, url: e.node.onlineStoreUrl || (e.node.handle ? `https://${session.shop}/products/${e.node.handle}` : null) }));
  } catch { /* fall through */ }

  const cast = AVATARS.slice(0, 10).map((a) => ({ id: a.id, name: a.name, img: avatarImg(a.id, 0) }));
  const videoQuotaLeft = plan ? Math.max(0, plan.videoQuota - plan.videoUsed + plan.videoCredits) : 0;

  return json({
    hasPlan: !!plan?.active,
    hasBrand: !!shop?.brandProfile,
    tokens: tokensRemaining(plan ?? { tokensIncluded: 0, tokensUsed: 0, tokensExtra: 0 }),
    products,
    cast,
    defaultAvatar: shop?.brandAvatarId && cast.some((c) => c.id === shop.brandAvatarId) ? shop.brandAvatarId : cast[0]?.id ?? null,
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
    await enqueueJob(shop.id, "GENERATE_VIDEO_AD", { productTitle, style, customPrompt: direction, avatarId, avatarVariant, productImageUrl, productDescription: direction, holdProduct: !!avatarId, prePaid });
    return json({ ok: true, queued: "video" });
  }
  if (intent === "genImage") {
    try { await spendTokens(shop.id, TOKEN_COST.image); }
    catch (e) { return json({ error: e instanceof Error ? e.message : "Not enough tokens for a still." }); }
    await enqueueJob(shop.id, "GENERATE_IMAGE_AD", { productTitle, productImageUrl, stylePrompt: direction, prePaid: true });
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

export default function Studio() {
  const { hasPlan, hasBrand, tokens, products, cast, defaultAvatar, videoQuotaLeft } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const error = actionData && "error" in actionData ? actionData.error : null;
  const queued = actionData && "queued" in actionData ? actionData.queued : null;

  const [tab, setTab] = useState<Tab>("video");
  const [picked, setPicked] = useState(0);
  const [avatarId, setAvatarId] = useState<string | null>(defaultAvatar);
  const [direction, setDirection] = useState("");
  const meta = TABS.find((t) => t.key === tab)!;
  const product = products[picked];
  const videoFree = videoQuotaLeft > 0;

  const generate = () => {
    if (!product) return;
    const intent = tab === "video" ? "genVideo" : tab === "image" ? "genImage" : "genBlog";
    const fields: Record<string, string> = { intent, productTitle: product.title, productImageUrl: product.image || "", direction: direction.trim() };
    if (tab === "video" && avatarId) { fields.avatarId = avatarId; fields.avatarVariant = "0"; }
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
        {queued && (
          <div className="cs-ok">
            <b>Queued — your {queued} is being made.</b>
            <Link to="/app/assets">Track it in the Content Queue ›</Link>
          </div>
        )}

        <div className="smp-cfg">
          {tab === "video" && (
            <>
              <div className="cfg-lbl">Presenter <span className="cs-opt">— or none for a product-only clip</span></div>
              <div className="cfg-cast">
                <button type="button" className={`cast${avatarId === null ? " sel" : ""}`} onClick={() => setAvatarId(null)}>
                  <span className="ca-img cs-none">🚫</span><span className="ca-nm">None</span>
                </button>
                {cast.map((c) => (
                  <button type="button" key={c.id} className={`cast${c.id === avatarId ? " sel" : ""}`} onClick={() => setAvatarId(c.id)}>
                    <span className="ca-img" style={{ backgroundImage: `url(${c.img})` }}>{c.id === avatarId && <span className="ca-chk">✓</span>}</span>
                    <span className="ca-nm">{c.name}</span>
                  </button>
                ))}
              </div>
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

          <div className="cfg-lbl">{tab === "blog" ? "What should it cover?" : "Direction"} <span className="cs-opt">optional</span></div>
          <input className="cs-input" type="text" value={direction} maxLength={200} placeholder={tab === "video" ? "e.g. Unboxing reveal, big excited reaction…" : tab === "image" ? "e.g. Clean studio, lifestyle scene…" : "e.g. Best uses, buyer's guide, how-to…"} onChange={(e) => setDirection(e.target.value)} />

          <div className="smp-tok"><div className="tt">This {meta.noun}</div><div className="tb"><b>{tab === "video" && videoFree ? "Free" : meta.cost}</b><span>{tab === "video" && videoFree ? "1 of your plan videos" : "tokens"}</span></div></div>

          <button type="button" className="smp-cta go" disabled={busy || !product} onClick={generate}>
            {busy ? "Sending to the studio…" : `${meta.verb} ${meta.noun} — ${costLabel}`}
          </button>
          <p className="smp-wallet">{hasPlan ? `Wallet: ${tokens.toLocaleString()} tokens` : "Choose a subscription plan to generate."}</p>
        </div>
      </div>
    </Page>
  );
}
