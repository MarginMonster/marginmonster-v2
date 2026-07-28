/* Web Studio — the lean, Shopify-free generator. Same engine as the embedded
 * Studio (same token costs, same tier capabilities, same worker pipelines);
 * the product comes from a pasted URL or manual title + image instead of the
 * Shopify catalog. */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { spendTokens, tokensRemainingLive } from "../lib/tokens.server";
import { enqueueJob } from "../lib/job-queue.server";
import { TOKEN_COST, CAPABILITY_TIER, PLAN_BY_KEY } from "../lib/plan-config";
import { VIDEO_ENGINES, engineSurcharge, normalizeEngineKey } from "../lib/video-engines";
import { assertCapability, capabilitiesFor, videoCapabilityFor } from "../lib/capabilities.server";
import { AVATARS } from "../lib/avatars";
import { CARTOON_RECIPES } from "../lib/cartoon-ad-pipeline.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  return json({
    hasBrand: !!shop.brandProfile,
    hasPlan: !!shop.activePlan?.active,
    tokens: tokensRemainingLive(shop.activePlan),
    caps: [...capabilitiesFor(shop.activePlan)],
    cast: AVATARS.map((a) => ({ id: a.id, name: a.name })),
    cartoonStyles: Object.entries(CARTOON_RECIPES).map(([key, r]) => ({ key, name: r.name })),
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
      assertCapability(shop.activePlan, videoCapabilityFor(contentType));
      const charged = TOKEN_COST.video + engineSurcharge(videoEngine);
      await spendTokens(shop.id, charged);
      await enqueueJob(shop.id, "GENERATE_VIDEO_AD", {
        productTitle, productImageUrl, customPrompt: direction, productDescription: direction,
        style: avatarId && contentType !== "cartoon" && contentType !== "jingle" ? "AI_AVATAR" : "PRODUCT_HIGHLIGHT",
        contentType, cartoonStyle: contentType === "cartoon" ? (cartoonStyle || "pixar") : undefined,
        avatarId, avatarVariant: 0, holdProduct: !!avatarId && !contentType,
        videoEngine, chargedTokens: charged, prePaid: true, initiator: "web",
      });
      return json({ ok: "Video queued — it lands in your Archive in a few minutes." });
    }
    if (intent === "image") {
      assertCapability(shop.activePlan, "image");
      await spendTokens(shop.id, TOKEN_COST.image);
      await enqueueJob(shop.id, "GENERATE_IMAGE_AD", { productTitle, productImageUrl, stylePrompt: direction, prePaid: true });
      return json({ ok: "Image ad queued — check the Archive shortly." });
    }
    if (intent === "blog") {
      assertCapability(shop.activePlan, "blog");
      await spendTokens(shop.id, TOKEN_COST.blog);
      await enqueueJob(shop.id, "GENERATE_BLOG_POST", { productTitle, productDescription: direction, prePaid: true });
      return json({ ok: "Article queued — check the Archive shortly." });
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Couldn't queue that." });
  }
  return json({});
};

export default function WebStudio() {
  const d = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const can = (c: string) => (d.caps as string[]).includes(c);
  const lockNote = (c: "video" | "cartoon" | "anthem") =>
    `Unlocks on the ${PLAN_BY_KEY[CAPABILITY_TIER[c]].name} plan`;
  return (
    <div>
      <h1 className="wb-h1">Studio</h1>
      <p className="wb-sub">Name a product, paste a photo URL, pick a format. Balance: 🪙 {d.tokens.toLocaleString()}</p>
      {!d.hasBrand && <div className="wb-err">Set your <Link to="/web">brand voice</Link> first so content sounds like you.</div>}
      {!d.hasPlan && <div className="wb-err">Pick a <Link to="/web">plan</Link> first — content runs on tokens.</div>}
      {(() => {
        const err = actionData && "error" in actionData ? (actionData.error as string) : null;
        const ok = actionData && "ok" in actionData ? (actionData.ok as string) : null;
        return (<>{err && <div className="wb-err">{err}</div>}{ok && <div className="wb-ok">{ok}</div>}</>);
      })()}

      <Form method="post" className="wb-card">
        <label className="wb-lbl">Product name</label>
        <input className="wb-in" name="productTitle" required placeholder="Midnight Roast — whole bean coffee" />
        <label className="wb-lbl">Product photo URL (optional, powers videos & image ads)</label>
        <input className="wb-in" name="productImageUrl" placeholder="https://yourstore.com/cdn/product.jpg" />
        <label className="wb-lbl">Direction (optional)</label>
        <input className="wb-in" name="direction" placeholder="cozy autumn morning energy, focus on the aroma" />

        <label className="wb-lbl">Video type</label>
        <select className="wb-sel" name="contentType" defaultValue="">
          <option value="">Avatar presenter {can("video") ? "" : `— ${lockNote("video")}`}</option>
          <option value="highlight">Product Highlight {can("video") ? "" : `— ${lockNote("video")}`}</option>
          <option value="cartoon" disabled={!can("cartoon")}>Cartoon Avatar {can("cartoon") ? "" : `— ${lockNote("cartoon")}`}</option>
          <option value="jingle" disabled={!can("anthem")}>Anthem (sung) {can("anthem") ? "" : `— ${lockNote("anthem")}`}</option>
        </select>
        <label className="wb-lbl">Presenter</label>
        <select className="wb-sel" name="avatarId" defaultValue={d.cast[0]?.id || ""}>
          {d.cast.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="wb-lbl">Cartoon style (cartoon videos only)</label>
        <select className="wb-sel" name="cartoonStyle" defaultValue="pixar">
          {d.cartoonStyles.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
        </select>
        <label className="wb-lbl">Video engine</label>
        <select className="wb-sel" name="videoEngine" defaultValue="auto">
          {VIDEO_ENGINES.map((e) => (
            <option key={e.key} value={e.key}>{e.name}{e.surcharge ? ` (+${e.surcharge} tokens)` : ""} — {e.blurb}</option>
          ))}
        </select>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
          <button className="wb-btn" name="intent" value="video" disabled={busy || !can("video")}>
            🎬 Video · {d.costs.video} tokens{can("video") ? "" : " 🔒"}
          </button>
          <button className="wb-btn" name="intent" value="image" disabled={busy}>🖼 Image ad · {d.costs.image} tokens</button>
          <button className="wb-btn" name="intent" value="blog" disabled={busy}>✍️ Article · {d.costs.blog} tokens</button>
        </div>
        {!can("video") && <p className="wb-note" style={{ marginTop: 10 }}>🔒 Video generators unlock on the Studio plan — <Link to="/web">upgrade</Link>.</p>}
      </Form>

      <p className="wb-note" style={{ marginTop: 18 }}>
        Finished pieces land in your <Link to="/web/archive">Archive</Link> — refresh it after a few minutes.
      </p>
    </div>
  );
}
