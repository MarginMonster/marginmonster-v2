/* Web dashboard — brand setup + plan/billing (Stripe). The wallet, tiers and
 * trial rules are IDENTICAL to the Shopify app; only the payer differs. */

import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams, Link } from "@remix-run/react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";
import { PLAN_TIERS, PLAN_BY_KEY, TOKEN_PACKS, annualPrice, planCapacityLine, resolveTierKey, type PlanKey } from "../lib/plan-config";
import { tokensRemainingLive, planTrialing } from "../lib/tokens.server";
import { createPackCheckout, createPlanCheckout, stripeEnabled } from "../lib/stripe.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { account, shop } = await requireWebIdentity(request);
  const tierKey = shop.activePlan?.active ? resolveTierKey(shop.activePlan.type) : null;
  const { CONTENT_LANGS, normalizeContentLang } = await import("../lib/content-lang");
  return json({
    name: account.name || account.email,
    hasBrand: !!shop.brandProfile,
    brand: shop.brandProfile ? (JSON.parse(shop.brandProfile.voiceJson || "{}") as { tone?: string; tagline?: string }) : null,
    contentLang: normalizeContentLang(shop.contentLang),
    langs: CONTENT_LANGS,
    tier: tierKey,
    tierName: tierKey ? PLAN_BY_KEY[tierKey].name : null,
    trialing: planTrialing(shop.activePlan),
    tokens: tokensRemainingLive(shop.activePlan),
    billingOn: stripeEnabled(),
    tiers: PLAN_TIERS.map((t) => ({
      key: t.key, name: t.name, price: t.price, yearly: annualPrice(t),
      tokens: t.monthlyTokens, capacity: planCapacityLine(t), features: t.features, highlight: !!t.highlight,
    })),
    packs: TOKEN_PACKS,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { account, shop } = await requireWebIdentity(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;
  const baseUrl = new URL(request.url).origin;

  if (intent === "brand") {
    const tone = ((form.get("tone") as string) || "").trim();
    const tagline = ((form.get("tagline") as string) || "").trim();
    const about = ((form.get("about") as string) || "").trim();
    if (!tone && !about) return json({ error: "Tell us a little about the brand so content sounds like you." });
    const voiceJson = JSON.stringify({ tone: tone || "friendly, confident, modern", tagline, about, vocabulary: [], values: [] });
    await db.brandProfile.upsert({
      where: { shopId: shop.id },
      create: { shopId: shop.id, voiceJson, visualJson: "{}", productJson: "{}" },
      update: { voiceJson },
    });
    // Content language rides the brand form — it's part of the brand's voice.
    const { normalizeContentLang } = await import("../lib/content-lang");
    const lang = (form.get("contentLang") as string) || "";
    if (lang) await db.shop.update({ where: { id: shop.id }, data: { contentLang: normalizeContentLang(lang) } });
    return json({ ok: "Brand voice saved — the studio is open." });
  }

  if (intent === "subscribe") {
    if (!stripeEnabled()) return json({ error: "Billing is coming online — check back shortly." });
    const tierKey = form.get("tier") as PlanKey;
    if (!PLAN_BY_KEY[tierKey]) return json({ error: "Unknown plan." });
    const annual = form.get("annual") === "1";
    try {
      const url = await createPlanCheckout({ accountId: account.id, email: account.email, tierKey, annual, baseUrl });
      return redirect(url);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Checkout couldn't start." });
    }
  }

  if (intent === "pack") {
    if (!stripeEnabled()) return json({ error: "Billing is coming online — check back shortly." });
    if (!shop.activePlan?.active) return json({ error: "Pick a plan first — packs top up a plan's balance." });
    const tokens = parseInt((form.get("tokens") as string) || "0", 10);
    try {
      const url = await createPackCheckout({ accountId: account.id, email: account.email, tokens, baseUrl });
      return redirect(url);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Checkout couldn't start." });
    }
  }

  return json({});
};

export default function WebDashboard() {
  const d = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const [params] = useSearchParams();
  const welcome = params.get("welcome");
  const topped = params.get("topped");
  const busy = nav.state !== "idle";
  return (
    <div>
      <h1 className="wb-h1">Welcome, {d.name}.</h1>
      <p className="wb-sub">
        {d.tierName
          ? <>You&apos;re on <b>{d.tierName}</b>{d.trialing ? " (free trial)" : ""} with <b>{d.tokens.toLocaleString()}</b> tokens ready.</>
          : "Two steps to your first AI content drop: set your brand voice, pick a plan."}
      </p>

      {welcome && <div className="wb-ok">🎉 {PLAN_BY_KEY[welcome as PlanKey]?.name || "Your plan"} is active — your trial starts now. Head to the Studio and make something.</div>}
      {topped && <div className="wb-ok">🪙 +{Number(topped).toLocaleString()} tokens are landing on your balance now.</div>}
      {(() => {
        const err = actionData && "error" in actionData ? (actionData.error as string) : null;
        const ok = actionData && "ok" in actionData ? (actionData.ok as string) : null;
        return (<>{err && <div className="wb-err">{err}</div>}{ok && <div className="wb-ok">{ok}</div>}</>);
      })()}

      {/* Brand voice */}
      <div className="wb-card" style={{ marginBottom: 22 }}>
        <div className="wb-price-name">1 · Brand voice {d.hasBrand && "✓"}</div>
        <p className="wb-note" style={{ margin: "6px 0 0" }}>Every script, caption and article is written in your voice.</p>
        <Form method="post">
          <input type="hidden" name="intent" value="brand" />
          <label className="wb-lbl">What do you sell, and to whom?</label>
          <textarea className="wb-ta" name="about" placeholder="Handmade ceramic mugs for coffee people who like slow mornings…" defaultValue={d.brand?.tagline ? "" : undefined} />
          <label className="wb-lbl">Tone (optional)</label>
          <input className="wb-in" name="tone" placeholder="warm, playful, a little cheeky" defaultValue={d.brand?.tone || ""} />
          <label className="wb-lbl">Tagline (optional)</label>
          <input className="wb-in" name="tagline" placeholder="Slow mornings, served hot." defaultValue={d.brand?.tagline || ""} />
          <label className="wb-lbl">Content language — everything generates in this language</label>
          <select className="wb-sel" name="contentLang" defaultValue={d.contentLang}>
            {Object.entries(d.langs).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
          <div style={{ marginTop: 14 }}>
            <button className="wb-btn ghost" disabled={busy}>{d.hasBrand ? "Update brand voice" : "Save brand voice"}</button>
          </div>
        </Form>
      </div>

      {/* Plans */}
      <div className="wb-price-name" style={{ marginBottom: 10 }}>2 · Your plan</div>
      {!d.billingOn && <div className="wb-err">Billing is coming online — plans can&apos;t be purchased on the web quite yet.</div>}
      <div className="wb-grid" style={{ marginBottom: 22 }}>
        {d.tiers.map((t) => (
          <div className="wb-card" key={t.key} style={t.highlight ? { borderColor: "rgba(18,168,94,.5)" } : undefined}>
            <div className="wb-price-name">{t.name} {d.tier === t.key && "· your plan ✓"}</div>
            <div className="wb-price-amt">${t.price}<small>/mo</small></div>
            <div className="wb-note">or ${t.yearly.toLocaleString()}/yr (2 months free) · 🪙 {t.tokens.toLocaleString()} tokens/mo</div>
            <div className="wb-note">{t.capacity}</div>
            <ul className="wb-feats">{t.features.map((f) => <li key={f}>{f}</li>)}</ul>
            {d.tier !== t.key && (
              <Form method="post" style={{ display: "flex", gap: 8 }}>
                <input type="hidden" name="intent" value="subscribe" />
                <input type="hidden" name="tier" value={t.key} />
                <button className="wb-btn" disabled={busy || !d.billingOn}>Start free trial</button>
                <button className="wb-btn ghost" name="annual" value="1" disabled={busy || !d.billingOn}>Annual</button>
              </Form>
            )}
          </div>
        ))}
      </div>

      {/* Top-ups */}
      {d.tier && (
        <>
          <div className="wb-price-name" style={{ marginBottom: 10 }}>Top up tokens</div>
          <div className="wb-grid">
            {d.packs.map((p) => (
              <div className="wb-card" key={p.tokens}>
                <div className="wb-price-name">+{p.tokens.toLocaleString()} tokens</div>
                <div className="wb-note" style={{ margin: "6px 0 12px" }}>One-time · never expires</div>
                <Form method="post">
                  <input type="hidden" name="intent" value="pack" />
                  <input type="hidden" name="tokens" value={p.tokens} />
                  <button className="wb-btn gold" disabled={busy || !d.billingOn}>Buy for ${p.price}</button>
                </Form>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="wb-note" style={{ marginTop: 26 }}>
        Ready to create? <Link to="/web/studio">Open the Studio →</Link>
      </p>
    </div>
  );
}
