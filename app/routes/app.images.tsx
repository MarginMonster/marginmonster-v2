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
  const stylePrompt = ((form.get("stylePrompt") as string) || "").trim() || undefined;
  if (!productTitle) return json({ error: "Pick a product for your still." });
  try {
    await spendTokens(shop.id, TOKEN_COST.image);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Not enough tokens for a still." });
  }
  await enqueueJob(shop.id, "GENERATE_IMAGE_AD", { productTitle, productImageUrl, stylePrompt, prePaid: true });
  return json({ ok: true, stillQueued: true });
};

/* art-direction chips — for merchants who like getting hands-on */
const STYLES: { key: string; label: string; prompt: string }[] = [
  { key: "studio", label: "🎬 Clean Studio", prompt: "clean studio product photography, seamless backdrop, soft key light" },
  { key: "lifestyle", label: "🏠 Lifestyle", prompt: "warm lifestyle scene, product in real everyday use, natural light, candid" },
  { key: "luxury", label: "💎 Luxury Minimal", prompt: "luxury minimal aesthetic, marble and soft shadows, editorial elegance" },
  { key: "neon", label: "🌈 Neon Pop", prompt: "bold neon pop art style, electric gradient background, high energy" },
  { key: "island", label: "🏝️ Island Vibes", prompt: "tropical island scene, golden beach light, palm shadows, vacation energy" },
  { key: "ugc", label: "🤳 UGC Candid", prompt: "authentic UGC phone photo look, slightly imperfect, real-person energy" },
  { key: "bold", label: "📣 Meme Bold", prompt: "bold attention-grabbing thumbnail style, dramatic zoom, high contrast punch" },
  { key: "noir", label: "🖤 Noir Drama", prompt: "dramatic noir lighting, deep shadows, single spotlight, cinematic mood" },
];

export default function ImageStudio() {
  const { products, stills, tokens, stillTokenCost } = useLoaderData<typeof loader>();
  const fx = useFetcher<typeof action>();
  const [productId, setProductId] = useState("");
  const [styleKey, setStyleKey] = useState("");
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const picked = products.find((p) => p.id === productId);
  const pickedStyle = STYLES.find((s) => s.key === styleKey);
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
              The focused studio for image ads — pick a product, tap once, and a
              branded still lands in your library, ready for the feed. Hands-on
              when you want control; for true easy mode,{" "}
              <Link to="/app/campaigns">a Marketing Campaign</Link> creates and
              posts stills like these all month while you do anything else.
            </p>
            <div className="pp-stats">
              <div className="pp-stat">
                <b>{stillTokenCost} 🪙 &nbsp;·&nbsp; Balance {tokens.toLocaleString()} 🪙</b>
                <span>per still &nbsp;·&nbsp; your token wallet</span>
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
                <Banner tone="success" title="🖼 On it!">
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
              <input type="hidden" name="stylePrompt" value={pickedStyle?.prompt || ""} />
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
                  {`Create still · ${stillTokenCost} 🪙`}
                </Button>
                <Badge tone="attention">{`${stillTokenCost} 🪙 per still`}</Badge>
              </div>
              <div style={{ marginTop: 12 }}>
                <span className="mm-section-label" style={{ fontSize: 11 }}>🎨 ART DIRECTION — optional, for the hands-on</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                  {STYLES.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setStyleKey(styleKey === s.key ? "" : s.key)}
                      style={{
                        border: styleKey === s.key ? "2px solid #C98F12" : "1px solid rgba(20,18,31,.2)",
                        background: styleKey === s.key ? "#FFE9A8" : "#fff",
                        borderRadius: 999, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </fx.Form>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <span className="mm-section-label">▶ THE GALLERY<span className="mm-dots">· · · · ·</span></span>
          {stills.length === 0 ? (
            <Card>
              <p style={{ padding: 8 }}>No stills yet — create your first above, or let a campaign fill this gallery on autopilot.</p>
            </Card>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              {stills.map((s) => (
                <div key={s.id} style={{ background: "#fff", border: "1px solid rgba(20,18,31,.12)", borderRadius: 12, overflow: "hidden" }}>
                  {broken[s.id] ? (
                    <div style={{ width: "100%", aspectRatio: "1/1", display: "grid", placeItems: "center", background: "#F4F0E4", color: "#8A8598", fontSize: 12, textAlign: "center", padding: 10 }}>
                      🌫 media expired on the server<br />remake to restore
                    </div>
                  ) : (
                    <img
                      src={s.imageUrl || ""}
                      alt={s.title}
                      loading="lazy"
                      style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block" }}
                      onError={() => setBroken((b) => ({ ...b, [s.id]: true }))}
                    />
                  )}
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
