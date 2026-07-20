/* 📧 EMAIL STUDIO — the Klaviyo-overtake wedge. Klaviyo makes you BUILD emails
 * and flows (often with a paid consultant); EasyMode's AI writes them in your
 * brand voice. This page: generate + preview branded emails now; the four
 * killer flows arm the moment email + customer-data approval are connected. */

import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Layout, Card, Banner, Button } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { emailEnabled } from "../lib/email-provider.server";
import { writeMarketingEmail } from "../lib/email-writer.server";
import { EMAIL_KINDS, type EmailKind } from "../lib/email-kinds";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true, brandProfile: true },
  });

  let products: { title: string }[] = [];
  try {
    const res = await admin.graphql(
      `{ products(first: 24, sortKey: UPDATED_AT, reverse: true) { edges { node { title } } } }`
    );
    const j = (await res.json()) as { data?: { products?: { edges?: { node: { title: string } }[] } } };
    products = (j.data?.products?.edges || []).map((e) => ({ title: e.node.title }));
  } catch {
    /* non-fatal */
  }

  return json({
    products,
    hasPlan: !!shop?.activePlan?.active,
    hasBrand: !!shop?.brandProfile,
    emailReady: emailEnabled(),
    storeName: session.shop.replace(/\.myshopify\.com$/, ""),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true, brandProfile: true },
  });
  if (!shop?.brandProfile) return json({ error: "Analyze your store first (on the dashboard) so emails match your brand voice." });
  if (!shop.activePlan?.active) return json({ error: "Pick a package first — email drafting rolls with your plan." });

  const form = await request.formData();
  const kind = (form.get("kind") as EmailKind) || "broadcast";
  const productTitle = ((form.get("productTitle") as string) || "").trim() || undefined;
  const topic = ((form.get("topic") as string) || "").trim() || undefined;
  try {
    const email = await writeMarketingEmail(shop.brandProfile, {
      kind,
      productTitle,
      topic,
      storeName: session.shop.replace(/\.myshopify\.com$/, ""),
    });
    return json({ ok: true, email });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Couldn't write the email." });
  }
};

const FLOWS: { key: EmailKind; title: string; icon: string; when: string; why: string }[] = [
  { key: "abandoned_cart", title: "Abandoned Cart", icon: "🛒", when: "Fires ~1h after a cart is left behind", why: "The single highest-ROI email in ecommerce — recovers sales that were already almost yours." },
  { key: "welcome", title: "Welcome Series", icon: "👋", when: "Fires the moment someone subscribes", why: "First impressions convert — a warm hello turns a browser into a first-time buyer." },
  { key: "post_purchase", title: "Post-Purchase", icon: "🎁", when: "Fires right after an order", why: "Turns one purchase into two — thank them, then tease what's next." },
  { key: "winback", title: "Win-Back", icon: "💌", when: "Fires after a customer goes quiet", why: "Cheaper to win back a lapsed customer than to find a new one." },
];

export default function EmailStudio() {
  const { products, hasPlan, hasBrand, emailReady, storeName } = useLoaderData<typeof loader>();
  const fx = useFetcher<typeof action>();
  const [kind, setKind] = useState<EmailKind>("broadcast");
  const [productTitle, setProductTitle] = useState("");
  const [topic, setTopic] = useState("");
  const busy = fx.state !== "idle";
  const result = fx.data && "email" in fx.data ? fx.data.email : null;
  const err = fx.data && "error" in fx.data ? (fx.data.error as string) : null;

  return (
    <Page backAction={{ content: "Home", url: "/app" }}>
      <Layout>
        <Layout.Section>
          <div className="pp-hero">
            <span className="pp-eyebrow">Email Studio</span>
            <h1>Email that <em>writes itself.</em></h1>
            <p className="pp-sub">
              Every other tool hands you a blank email builder. EasyMode's AI writes
              the whole thing in your brand voice — subject, copy, and call to
              action — then runs your automated flows for you. The power of a
              full email platform, on easy mode.
            </p>
            <div className="pp-stats">
              <div className="pp-stat">
                <b>{emailReady ? "Connected" : "Not connected"}</b>
                <span>{emailReady ? "ready to send" : "connect to go live"}</span>
              </div>
              <div className="pp-stat">
                <b>4</b>
                <span>automated flows, written for you</span>
              </div>
            </div>
          </div>
        </Layout.Section>

        {!emailReady && (
          <Layout.Section>
            <Banner tone="info" title="🏝️ Draft now, send once you connect">
              <p>
                You can write and preview branded emails right now. To actually send
                them, EasyMode needs an email sender connected and Shopify's customer-data
                approval — both one-time setups. Until then, everything you draft is saved
                and ready to fire the day you go live.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {/* GENERATOR */}
        <Layout.Section>
          <Card>
            {err && (
              <div style={{ marginBottom: 12 }}>
                <Banner tone="critical" title="Couldn't write it"><p>{err}</p></Banner>
              </div>
            )}
            {(!hasPlan || !hasBrand) && (
              <div style={{ marginBottom: 12 }}>
                <Banner tone="warning" title="Two quick prerequisites">
                  <p>{!hasBrand ? "Analyze your store on the dashboard (so emails sound like you). " : ""}{!hasPlan ? "Pick a package to start drafting." : ""}</p>
                </Banner>
              </div>
            )}
            <fx.Form method="post">
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="productTitle" value={productTitle} />
              <input type="hidden" name="topic" value={topic} />

              <span className="mm-section-label" style={{ fontSize: 11 }}>▶ 1 · WHAT KIND OF EMAIL<span className="mm-dots">· · · · ·</span></span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "6px 0 14px" }}>
                {EMAIL_KINDS.map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    onClick={() => setKind(k.key)}
                    title={k.blurb}
                    style={{
                      border: kind === k.key ? "2px solid #C98F12" : "1px solid rgba(20,18,31,.2)",
                      background: kind === k.key ? "#FFE9A8" : "#fff",
                      borderRadius: 999, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    {k.icon} {k.label}
                  </button>
                ))}
              </div>

              <span className="mm-section-label" style={{ fontSize: 11 }}>▶ 2 · ABOUT (optional)<span className="mm-dots">· · · · ·</span></span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "6px 0 14px" }}>
                <label style={{ fontSize: 12, fontWeight: 600 }}>
                  Feature a product
                  <select value={productTitle} onChange={(e) => setProductTitle(e.target.value)} style={{ width: "100%", marginTop: 4, padding: "8px", borderRadius: 8, border: "1px solid rgba(20,18,31,.25)" }}>
                    <option value="">— none / whole store —</option>
                    {products.map((p) => <option key={p.title} value={p.title}>{p.title}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 12, fontWeight: 600 }}>
                  Angle / topic
                  <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. summer restock, first-order thank you" style={{ width: "100%", marginTop: 4, padding: "8px", borderRadius: 8, border: "1px solid rgba(20,18,31,.25)" }} />
                </label>
              </div>

              <Button submit variant="primary" disabled={busy || !hasPlan || !hasBrand} loading={busy}>
                {busy ? "Writing…" : "✍️ Write the email"}
              </Button>
            </fx.Form>

            {result && (
              <div style={{ marginTop: 18, borderTop: "1px solid #EEE9DC", paddingTop: 16 }}>
                <div style={{ fontSize: 12, color: "#8A8598", fontWeight: 700, letterSpacing: ".08em" }}>SUBJECT</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#14121F", margin: "2px 0 6px" }}>{result.subject}</div>
                <div style={{ fontSize: 12.5, color: "#6B6690" }}>{result.preheader}</div>
                <div style={{ marginTop: 12, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(20,18,31,.12)" }}>
                  <iframe title="Email preview" srcDoc={result.html} style={{ width: "100%", height: 520, border: "none", display: "block" }} />
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: "#8A8598" }}>
                  {emailReady ? "Ready to send to your list." : "Preview only — connect email to send. Regenerate for a different take."}
                </div>
              </div>
            )}
          </Card>
        </Layout.Section>

        {/* FLOWS — the automations that arm on connect */}
        <Layout.Section>
          <span className="mm-section-label">▶ AUTOMATED FLOWS<span className="mm-dots">· · · · ·</span></span>
          <p style={{ fontSize: 13.5, color: "#FFFFFF", textShadow: "1px 1px 0 #000,-1px 1px 0 #000,1px -1px 0 #000,-1px -1px 0 #000", margin: "0 0 12px", maxWidth: "60ch" }}>
            What Klaviyo charges a consultant to set up, EasyMode writes and runs for you — automatically, in your voice. These arm the moment email is connected.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {FLOWS.map((f) => (
              <div key={f.key} style={{ background: "#fff", border: "1px solid rgba(20,18,31,.12)", borderRadius: 14, padding: 16, boxShadow: "0 7px 18px rgba(20,18,31,.05)" }}>
                <div style={{ fontSize: 22 }}>{f.icon}</div>
                <div style={{ fontSize: 15, fontWeight: 900, marginTop: 4 }}>{f.title}</div>
                <div style={{ fontSize: 11, color: "#C98F12", fontWeight: 700, margin: "2px 0 8px" }}>{f.when}</div>
                <div style={{ fontSize: 12.5, color: "#5C5872", lineHeight: 1.5 }}>{f.why}</div>
                <div style={{ marginTop: 10, display: "inline-block", fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em", color: emailReady ? "#1F6B2E" : "#8A8598", background: emailReady ? "#DFF3E2" : "#F1EFF7", borderRadius: 999, padding: "3px 10px" }}>
                  {emailReady ? "● ARMED" : "○ ARMS ON CONNECT"}
                </div>
              </div>
            ))}
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
