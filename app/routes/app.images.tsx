/* 🖼 IMAGE STUDIO — the dedicated still-image forge (user: "Image Gen Center
 * for focus solely on image generation"). Same engine as campaign image drops
 * (GENERATE_IMAGE_AD, pure token economy) — this page is the hands-on,
 * high-focus counterpart; campaigns are the true easy mode. */

import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Layout, Card, Banner, Select, TextField, Button, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { enqueueJob } from "../lib/job-queue.server";
import { spendTokens, tokensRemaining } from "../lib/tokens.server";
import { TOKEN_COST } from "../lib/plan-config";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true },
  });
  if (!shop) {
    return json({
      products: [] as { id: string; title: string; image: string | null }[],
      stills: [] as { id: string; title: string; imageUrl: string | null; createdAt: Date }[],
      tokens: 0,
      stillTokenCost: TOKEN_COST.image,
    });
  }

  let products: { id: string; title: string; image: string | null }[] = [];
  try {
    const res = await admin.graphql(
      `{ products(first: 24, sortKey: UPDATED_AT, reverse: true) {
        edges { node { id title featuredImage { url } } }
      } }`
    );
    const j = (await res.json()) as {
      data?: { products?: { edges?: { node: { id: string; title: string; featuredImage?: { url?: string } } }[] } };
    };
    products = (j.data?.products?.edges || []).map((e) => ({
      id: e.node.id,
      title: e.node.title,
      image: e.node.featuredImage?.url || null,
    }));
  } catch {
    /* non-fatal */
  }

  const stillRows = await db.asset.findMany({
    where: { shopId: shop.id, type: "IMAGE_AD" },
    orderBy: { createdAt: "desc" },
    take: 36,
  });
  const stills = stillRows
    .map((a) => {
      let imageUrl: string | null = null;
      try { imageUrl = (JSON.parse(a.bodyJson) as { imageUrl?: string }).imageUrl || null; } catch { /* ignore */ }
      return { id: a.id, title: a.title || "Still", imageUrl, createdAt: a.createdAt };
    })
    .filter((a) => !!a.imageUrl);

  return json({
    products,
    stills,
    tokens: shop.activePlan ? tokensRemaining(shop.activePlan) : 0,
    stillTokenCost: TOKEN_COST.image,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true, brandProfile: true },
  });
  if (!shop) return json({ error: "Shop not found." });
  const form = await request.formData();

  if (!shop.brandProfile) {
    return json({ error: "Analyze your store first (on the dashboard) so stills match your brand." });
  }
  if (!shop.activePlan || !shop.activePlan.active) {
    return json({ error: "Pick a package first — stills roll on tokens." });
  }
  const productTitle = (form.get("productTitle") as string)?.trim();
  const productImageUrl = ((form.get("productImageUrl") as string) || "").trim() || undefined;
  if (!productTitle) return json({ error: "Pick a product for your still." });
  try {
    await spendTokens(shop.id, TOKEN_COST.image);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Not enough tokens for a still." });
  }
  await enqueueJob(shop.id, "GENERATE_IMAGE_AD", { productTitle, productImageUrl, prePaid: true });
  return json({ ok: true, stillQueued: true });
};

export default function ImageStudio() {
  const { products, stills, tokens, stillTokenCost } = useLoaderData<typeof loader>();
  const fx = useFetcher<typeof action>();
  const [productId, setProductId] = useState("");
  const picked = products.find((p) => p.id === productId);
  const busy = fx.state !== "idle";
  const queued = !!(fx.data && "stillQueued" in fx.data && fx.data.stillQueued);
  const err = fx.data && "error" in fx.data ? (fx.data.error as string) : null;

  return (
    <Page>
      <Layout>
        <Layout.Section>
          <div className="pp-hero">
            <span className="pp-eyebrow">Image Studio</span>
            <h1>Scroll-stoppers, <em>on demand.</em></h1>
            <p className="pp-sub">
              The focused forge for image ads — pick a product, tap once, and a
              branded still lands in your library, ready for the feed. Hands-on
              when you want control; for true easy mode,{" "}
              <Link to="/app/campaigns">a Marketing Campaign</Link> forges and
              posts stills like these all month while you do anything else.
            </p>
            <div className="pp-stats">
              <div className="pp-stat">
                <b>{stillTokenCost} 🪙</b>
                <span>per still · rolling on tokens</span>
              </div>
              <div className="pp-stat">
                <b>{tokens.toLocaleString()}</b>
                <span>tokens in the wallet</span>
              </div>
              <div className="pp-stat">
                <b>{stills.length}</b>
                <span>stills in the library</span>
              </div>
            </div>
          </div>
        </Layout.Section>

        <Layout.Section>
          <Card>
            {queued && (
              <div style={{ marginBottom: 12 }}>
                <Banner tone="success" title="🖼 The forge is lit">
                  <p>Your still is rendering — it lands in the gallery below in about a minute. Refresh to see it shine.</p>
                </Banner>
              </div>
            )}
            {err && (
              <div style={{ marginBottom: 12 }}>
                <Banner tone="critical" title="Couldn't start the still">
                  <p>{err}</p>
                </Banner>
              </div>
            )}
            <fx.Form method="post">
              <input type="hidden" name="productTitle" value={picked?.title || ""} />
              <input type="hidden" name="productImageUrl" value={picked?.image || ""} />
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ minWidth: 260, flex: 1 }}>
                  <Select
                    label="Star product"
                    options={[{ label: products.length ? "Pick a product…" : "No products found", value: "" }, ...products.map((p) => ({ label: p.title, value: p.id }))]}
                    value={productId}
                    onChange={setProductId}
                  />
                </div>
                <Button submit variant="primary" disabled={!picked || busy} loading={busy}>
                  {`Forge still · ${stillTokenCost} 🪙`}
                </Button>
                <Badge tone="attention">{`${stillTokenCost} 🪙 per still`}</Badge>
              </div>
            </fx.Form>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <span className="mm-section-label">▶ THE GALLERY<span className="mm-dots">· · · · ·</span></span>
          {stills.length === 0 ? (
            <Card>
              <p style={{ padding: 8 }}>No stills yet — forge your first above, or let a campaign fill this gallery on autopilot.</p>
            </Card>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              {stills.map((s) => (
                <div key={s.id} style={{ background: "#fff", border: "1px solid rgba(20,18,31,.12)", borderRadius: 12, overflow: "hidden" }}>
                  <img src={s.imageUrl || ""} alt={s.title} loading="lazy" style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", display: "block" }} />
                  <div style={{ padding: "6px 9px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</div>
                </div>
              ))}
            </div>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
