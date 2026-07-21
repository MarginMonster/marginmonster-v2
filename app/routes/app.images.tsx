/* 🖼 IMAGE STUDIO — the dedicated still-image forge (user: "Image Gen Center
 * for focus solely on image generation"). Same engine as campaign image drops
 * (GENERATE_IMAGE_AD, pure token economy) — this page is the hands-on,
 * high-focus counterpart; campaigns are the true easy mode. */

import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
import { Page, Layout, Card, Banner, Button, Badge } from "@shopify/polaris";
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
      jobs: [] as { id: string; status: string; title: string; productImage: string | null; scheduledFor: string | null; createdAt: Date }[],
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

  // in-flight image jobs — on-demand renders (rendering now / in line) AND
  // campaign image drops still scheduled for the future. Mirrors the Video
  // Studio's Scheduled & rendering tab.
  const nowMs = Date.now();
  const jobRows = await db.job.findMany({
    where: { shopId: shop.id, type: "GENERATE_IMAGE_AD", status: { in: ["PENDING", "IN_PROGRESS"] } },
    orderBy: { createdAt: "desc" },
    take: 24,
  });
  const jobs = jobRows.map((j) => {
    let p: { productTitle?: string; productImageUrl?: string } = {};
    try { p = JSON.parse(j.payload); } catch { /* keep defaults */ }
    return {
      id: j.id,
      status: j.status,
      title: p.productTitle ? `Ad image for ${p.productTitle}` : "Image ad",
      productImage: p.productImageUrl || null,
      scheduledFor: j.runAt && j.runAt.getTime() > nowMs ? j.runAt.toISOString() : null,
      createdAt: j.createdAt,
    };
  });

  return json({
    products,
    stills,
    jobs,
    tokens: shop.activePlan ? tokensRemaining(shop.activePlan) : 0,
    stillTokenCost: TOKEN_COST.image,
  });
};

/* Friendly "Thu, Jul 24 · 6PM" for a scheduled drop — UTC-deterministic so
 * server and client agree (no hydration mismatch). */
function fmtDayTime(iso: string): string {
  const d = new Date(iso);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const mons = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let h = d.getUTCHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${days[d.getUTCDay()]}, ${mons[d.getUTCMonth()]} ${d.getUTCDate()} · ${h}${ap}`;
}

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
  { key: "studio", label: "🎬 Clean Studio", prompt: "clean high-end studio product photography on a seamless gradient backdrop, soft diffused key light with a gentle rim light, crisp subtle reflections, minimalist premium composition" },
  { key: "lifestyle", label: "🏠 Lifestyle", prompt: "warm lifestyle scene with the product in real everyday use, cozy lived-in home setting, soft natural window light, candid unposed moment, shallow depth of field" },
  { key: "luxury", label: "💎 Luxury Minimal", prompt: "ultra-luxury minimal editorial aesthetic, polished marble and brushed-metal surfaces, dramatic soft shadows, generous negative space, magazine-cover elegance with subtle gold accents" },
  { key: "neon", label: "🌈 Neon Pop", prompt: "bold neon pop-art style, electric magenta-and-cyan gradient background, glowing neon rim light, high-saturation vibrant color, playful eye-catching energy" },
  { key: "island", label: "🏝️ Island Vibes", prompt: "sun-drenched tropical island scene, warm golden-hour beach light, soft palm-frond shadows, turquoise water bokeh, breezy aspirational vacation energy" },
  { key: "ugc", label: "🤳 UGC Candid", prompt: "authentic user-generated phone-photo look, slightly imperfect framing, natural on-camera flash or window light, hand-held real-person candid energy, relatable and unpolished" },
  { key: "bold", label: "📣 Meme Bold", prompt: "bold scroll-stopping thumbnail style, dramatic close-up zoom, punchy high-contrast lighting, saturated colors, exaggerated energy that demands a tap" },
  { key: "noir", label: "🖤 Noir Drama", prompt: "cinematic film-noir lighting, deep inky shadows, a single hard spotlight, moody high-contrast chiaroscuro, dramatic and premium" },
];

export default function ImageStudio() {
  const { products, stills, jobs, tokens, stillTokenCost } = useLoaderData<typeof loader>();
  const fx = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [productId, setProductId] = useState("");
  const [styleKey, setStyleKey] = useState("");
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [libTab, setLibTab] = useState<"GALLERY" | "OVEN">("GALLERY");
  const picked = products.find((p) => p.id === productId);
  const pickedStyle = STYLES.find((s) => s.key === styleKey);
  const busy = fx.state !== "idle";
  const queued = !!(fx.data && "stillQueued" in fx.data && fx.data.stillQueued);
  const err = fx.data && "error" in fx.data ? (fx.data.error as string) : null;

  // any job still cooking → poll the loader so finished stills pop in on their
  // own, and a fresh submit shows up in the oven without a manual refresh
  const cooking = jobs.length > 0;
  useEffect(() => {
    if (!cooking) return;
    const t = setInterval(() => revalidator.revalidate(), 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooking]);
  // the moment a still is queued, jump to the oven + pull the new job in
  useEffect(() => {
    if (queued) { setLibTab("OVEN"); revalidator.revalidate(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued]);
  // client-only clock for "N min in" (SSR-safe)
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

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

              {/* 1 · visual product picker — tap a product's image, no dropdown */}
              <span className="mm-section-label" style={{ fontSize: 11 }}>▶ 1 · PICK A PRODUCT<span className="mm-dots">· · · · ·</span></span>
              {products.length === 0 ? (
                <p style={{ fontSize: 13, color: "#8A8598", margin: "6px 2px" }}>No products found in your catalog.</p>
              ) : (
                <div className="mm-prodgrid" style={{ marginTop: 6 }}>
                  {products.map((p) => {
                    const on = productId === p.id;
                    return (
                      <button key={p.id} type="button" className={`mm-prodcard${on ? " on" : ""}`} onClick={() => setProductId(on ? "" : p.id)}>
                        {on && <span className="mm-prodcheck">✓</span>}
                        {p.image ? <img src={p.image} alt="" loading="lazy" /> : <div className="mm-prodph">🛍️</div>}
                        <span className="mm-prodtitle">{p.title}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 2 · art direction chips */}
              <div style={{ marginTop: 16 }}>
                <span className="mm-section-label" style={{ fontSize: 11 }}>▶ 2 · ART DIRECTION <span style={{ fontWeight: 400, color: "#8A8598" }}>— optional</span></span>
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

              {/* 3 · create */}
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 18 }}>
                <Button submit variant="primary" disabled={!picked || busy} loading={busy}>
                  {`Create still · ${stillTokenCost} 🪙`}
                </Button>
                {picked && <Badge tone="success">{`★ ${picked.title.length > 28 ? picked.title.slice(0, 28) + "…" : picked.title}`}</Badge>}
                <Badge tone="attention">{`${stillTokenCost} 🪙 per still · Balance ${tokens.toLocaleString()} 🪙`}</Badge>
              </div>
            </fx.Form>
          </Card>
        </Layout.Section>

        <Layout.Section>
          {/* tabs — finished gallery vs the oven (rendering + scheduled), like
              the Video Studio's Ready / Scheduled & rendering split */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              className={`mm-chip mm-filter-chip${libTab === "GALLERY" ? " on" : ""}`}
              onClick={() => setLibTab("GALLERY")}
            >
              🖼 The Gallery ({stills.length})
            </button>
            <button
              type="button"
              className={`mm-chip mm-filter-chip${libTab === "OVEN" ? " on" : ""}`}
              onClick={() => setLibTab("OVEN")}
            >
              🔥 In the Oven ({jobs.length})
            </button>
          </div>

          {libTab === "GALLERY" && (stills.length === 0 ? (
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
          ))}

          {libTab === "OVEN" && (jobs.length === 0 ? (
            <Card>
              <p style={{ padding: 8 }}>Nothing cooking right now — hit <b>Create still</b> above, or a campaign will schedule image drops here automatically.</p>
            </Card>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              {jobs.map((j) => {
                const mins = now ? Math.max(1, Math.round((now - new Date(j.createdAt).getTime()) / 60_000)) : null;
                const scheduled = j.status === "PENDING" && !!j.scheduledFor;
                return (
                  <div key={j.id} style={{ background: "#fff", border: "1px solid rgba(20,18,31,.12)", borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ position: "relative", width: "100%", aspectRatio: "1/1", background: "#0b0a17" }}>
                      {j.productImage
                        ? <img src={j.productImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.35 }} />
                        : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 30 }}>🖼</div>}
                      {scheduled ? (
                        <div className="mm-sched-overlay" aria-hidden="true">
                          <span className="ico">🗓️</span>
                          <span className="lb">SCHEDULED</span>
                          <span className="dt">{fmtDayTime(j.scheduledFor as string)}</span>
                        </div>
                      ) : (
                        <div className="mm-buffer" aria-hidden="true"><span className="ring" /></div>
                      )}
                    </div>
                    <div style={{ padding: "8px 9px" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.title}</div>
                      <div style={{ fontSize: 10.5, color: "#8A8598", marginTop: 2 }}>
                        {scheduled
                          ? `Auto-creates ${fmtDayTime(j.scheduledFor as string)} — a campaign makes this a day before it posts.`
                          : j.status === "IN_PROGRESS"
                          ? `Rendering now${mins ? ` · ${mins} min in` : ""} · usually under a minute. Updates automatically.`
                          : "In line — starts the moment the one ahead finishes."}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
