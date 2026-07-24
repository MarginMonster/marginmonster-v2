import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useState, useEffect } from "react";
import { Page } from "@shopify/polaris";
import { authenticate, billingIsTest, TOKEN_PACK_PLANS, TOKENS_BY_PACK } from "../shopify.server";
import { recordBillingFailure } from "../lib/billing-debug.server";
import { db } from "../db.server";
import { PLAN_TIERS, PLAN_BY_KEY, TOKEN_PACKS, ANNUAL_TO_TIER, annualKey, annualPrice, type PlanKey } from "../lib/plan-config";
import { unlockAchievement } from "../lib/xp.server";
import { REFERRAL_REWARD_TOKENS } from "../lib/referral.server";
import { COMPANIONS, COMPANION_BY_ID } from "../lib/companions";
import { enqueueJob } from "../lib/job-queue.server";
import { spendTokens } from "../lib/tokens.server";

const COMPANION_TOKEN_COST = 1; // creating a custom companion costs 1 token (anti-spam)
import fsMod from "node:fs";
import pathMod from "node:path";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  // Embedded iframes lose their session if a redirect drops the host/id_token
  // query params ("accounts.shopify.com refused to connect") — so return-leg
  // redirects carry the ORIGINAL embedded params and only swap ours.
  const embeddedRedirect = (set: Record<string, string>): never => {
    const u = new URL(request.url);
    for (const k of ["activate", "review", "pack", "charge_id", "welcome", "topped"]) u.searchParams.delete(k);
    for (const [k, v] of Object.entries(set)) u.searchParams.set(k, v);
    throw redirect(`${u.pathname}?${u.searchParams.toString()}`);
  };

  // ---- BILLING RETURN LEG 1: subscription approved → activate the plan ----
  // Payment comes FIRST now; the plan row only exists once Shopify confirms
  // an active subscription. No confirmation, no plan — no free rides.
  // activate may be a tier key (STARTER) or an annual key (STARTER_ANNUAL);
  // normalize to the tier for the plan row — quotas/features are identical.
  const rawActivate = url.searchParams.get("activate");
  const activate = (rawActivate ? (ANNUAL_TO_TIER[rawActivate] || rawActivate) : null) as PlanKey | null;
  if (activate && PLAN_BY_KEY[activate]) {
    // Verify the EXACT approved charge from the return URL — billing.check
    // can throw the SDK's 401 bounce here, which hijacks the iframe into
    // accounts.shopify.com ("refused to connect"). A direct node query on the
    // charge id never throws that way (same pattern as token packs).
    let confirmed = false;
    const subChargeId = (url.searchParams.get("charge_id") || "").replace(/[^0-9]/g, "");
    try {
      if (subChargeId) {
        const res = await admin.graphql(
          `{ node(id: "gid://shopify/AppSubscription/${subChargeId}") { ... on AppSubscription { status } } }`
        );
        const j = (await res.json()) as { data?: { node?: { status?: string } } };
        confirmed = j.data?.node?.status === "ACTIVE";
      } else {
        const { hasActivePayment } = await billing.check({ plans: [rawActivate || activate] as never, isTest: billingIsTest() });
        confirmed = hasActivePayment;
      }
    } catch (e) {
      if (!(e instanceof Response)) console.error("[billing] activate verify failed:", e);
      // Response bounce or query hiccup: fall through unconfirmed — merchant
      // lands on a clean page instead of a hijacked frame; retrying the URL
      // (or the plan button) completes activation.
    }
    if (confirmed) {
      const shopRow = await db.shop.findUnique({ where: { domain: session.shop } });
      if (shopRow) {
        const tier = PLAN_BY_KEY[activate];
        const reviewMode = url.searchParams.get("review") === "SET_AND_FORGET" ? "SET_AND_FORGET" as const : "REVIEW_FIRST" as const;
        await db.plan.upsert({
          where: { shopId: shopRow.id },
          create: {
            shopId: shopRow.id, type: activate, reviewMode,
            blogQuota: tier.blogQuota, videoQuota: tier.videoQuota, imageQuota: tier.imageQuota,
            adCreativePack: tier.imageQuota > 0, campaignAutopilot: tier.campaignAutopilot,
            periodStart: new Date(), tokensIncluded: tier.monthlyTokens, tokensUsed: 0,
          },
          update: {
            type: activate, reviewMode, active: true,
            blogQuota: tier.blogQuota, videoQuota: tier.videoQuota, imageQuota: tier.imageQuota,
            adCreativePack: tier.imageQuota > 0, campaignAutopilot: tier.campaignAutopilot,
            tokensIncluded: tier.monthlyTokens, tokensUsed: 0, periodStart: new Date(),
          },
        });
        await unlockAchievement(shopRow.id, "INSERT_COIN");
        // Plan just went live — if the brand's already analyzed, forge their
        // first blog + image now so the Archive isn't empty (TTFV).
        try {
          const { kickstartFirstContent } = await import("../lib/onboarding.server");
          const gql = async (q: string) => { const r = await admin.graphql(q); const j = (await r.json()) as { data?: unknown }; return j.data; };
          await kickstartFirstContent(shopRow.id, gql);
        } catch (e) { console.error("[plans] first-content kick failed (non-fatal):", e); }
        // Referral payout — if this store was referred, both sides earn tokens.
        try {
          const { creditReferralOnConversion } = await import("../lib/referral.server");
          await creditReferralOnConversion(shopRow.id);
        } catch (e) { console.error("[plans] referral credit failed (non-fatal):", e); }
      }
      embeddedRedirect({ welcome: activate });
    }
    embeddedRedirect({}); // declined/abandoned — nothing activates
  }

  // ---- BILLING RETURN LEG 2: token pack paid → credit ONCE (chargeId unique) ----
  const packKey = url.searchParams.get("pack") as keyof typeof TOKEN_PACK_PLANS | null;
  const chargeId = url.searchParams.get("charge_id");
  if (packKey && TOKENS_BY_PACK[packKey] && chargeId) {
    const shopRow = await db.shop.findUnique({ where: { domain: session.shop }, include: { activePlan: true } });
    if (shopRow?.activePlan) {
      const already = await db.tokenPurchase.findUnique({ where: { chargeId } });
      if (!already) {
        // verify with Shopify that this exact charge is real and paid
        let status = "";
        try {
          const res = await admin.graphql(
            `{ node(id: "gid://shopify/AppPurchaseOneTime/${chargeId.replace(/[^0-9]/g, "")}") { ... on AppPurchaseOneTime { status } } }`
          );
          const j = (await res.json()) as { data?: { node?: { status?: string } } };
          status = j.data?.node?.status || "";
        } catch (e) { console.error("[billing] charge verify failed:", e); }
        if (status === "ACTIVE") {
          await db.tokenPurchase.create({
            data: { shopId: shopRow.id, chargeId, tokens: TOKENS_BY_PACK[packKey], amountUsd: TOKEN_PACK_PLANS[packKey].amount },
          });
          await db.plan.update({
            where: { shopId: shopRow.id },
            data: { tokensExtra: { increment: TOKENS_BY_PACK[packKey] } },
          });
          embeddedRedirect({ topped: String(TOKENS_BY_PACK[packKey]) });
        }
      }
    }
    embeddedRedirect({});
  }

  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true },
  });
  // gallery availability: only show companions whose art actually shipped
  let installed: string[] = [];
  try {
    const files = new Set(fsMod.readdirSync(pathMod.join(process.cwd(), "public", "companions")));
    installed = COMPANIONS.filter((c) => files.has(`${c.id}.png`)).map((c) => c.id);
  } catch { /* gallery not installed yet */ }
  // companion job status — the LATEST job drives both flags so a later success
  // suppresses an earlier failure. forgeFailed → show the refund message.
  let forging = false;
  let forgeFailed = false;
  try {
    if (shop) {
      const last = await db.job.findFirst({
        where: { shopId: shop.id, type: "FORGE_COMPANION" },
        orderBy: { createdAt: "desc" },
      });
      forging = last?.status === "PENDING" || last?.status === "IN_PROGRESS";
      forgeFailed = last?.status === "FAILED" && (Date.now() - new Date(last.updatedAt).getTime() < 10 * 60_000);
    }
  } catch { /* non-fatal */ }
  // Referral: mint this store's code (once) + whether it already used one.
  let referralCode = "";
  let referredBy = false;
  if (shop) {
    try {
      const { ensureReferralCode } = await import("../lib/referral.server");
      referralCode = await ensureReferralCode(shop.id);
      referredBy = !!shop.referredBy;
    } catch { /* non-fatal */ }
  }

  return json({
    currentPlan: shop?.activePlan?.type || null,
    currentReview: shop?.activePlan?.reviewMode || "REVIEW_FIRST",
    companionId: shop?.companionId || null,
    companionName: shop?.companionName || null,
    hasCustom: !!shop?.companionArt,
    shopId: shop?.id || "",
    installed,
    forging,
    forgeFailed,
    billingTest: billingIsTest(),
    referralCode,
    referredBy,
    referralReward: REFERRAL_REWARD_TOKENS,
    appListingUrl: process.env.SHOPIFY_APP_LISTING_URL || "https://apps.shopify.com",
    welcome: url.searchParams.get("welcome"),
    topped: url.searchParams.get("topped"),
    packs: TOKEN_PACKS.map((p, i) => ({
      tokens: p.tokens,
      price: p.price,
      label: p.label,
      best: !!(p as { best?: boolean }).best,
      key: (["TOKENS_250", "TOKENS_750", "TOKENS_2000"] as const)[i],
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent") as string | null;

  // ---- companion intents (no billing involved) ----
  if (intent === "setCompanion") {
    const shop = await db.shop.findUnique({ where: { domain: session.shop } });
    if (!shop) return json({ error: "Shop not found" });
    const id = (form.get("companionId") as string) || "";
    if (id !== "custom" && !COMPANION_BY_ID[id]) return json({ error: "Unknown companion" });
    if (id === "custom" && !shop.companionArt) return json({ error: "Create a custom companion first" });
    const nick = ((form.get("companionName") as string) || "").trim().slice(0, 24);
    await db.shop.update({
      where: { id: shop.id },
      data: { companionId: id, companionName: nick || (id === "custom" ? shop.companionName : COMPANION_BY_ID[id]?.name) },
    });
    return json({ companionSet: true });
  }
  if (intent === "forgeCompanion") {
    const shop = await db.shop.findUnique({ where: { domain: session.shop }, include: { activePlan: true } });
    if (!shop) return json({ error: "Shop not found" });
    if (!shop.activePlan || !shop.activePlan.active) return json({ error: "Pick a package first — creating a companion costs 1 token." });
    const prompt = ((form.get("prompt") as string) || "").trim();
    const name = ((form.get("name") as string) || "").trim();
    if (prompt.length < 8) return json({ error: "Describe your companion in a few words first." });
    // anti-spam: only one in flight at a time (blocks spam-clicking the button)
    const already = await db.job.findFirst({
      where: { shopId: shop.id, type: "FORGE_COMPANION", status: { in: ["PENDING", "IN_PROGRESS"] } },
    });
    if (already) return json({ error: "You've already got a companion being created — let it finish first." });
    // costs 1 token; spendTokens throws if the wallet can't cover it
    try {
      await spendTokens(shop.id, COMPANION_TOKEN_COST);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Not enough tokens — a companion costs 1 token." });
    }
    await enqueueJob(shop.id, "FORGE_COMPANION", { prompt, name: name || "PARTNER" });
    return json({ forgeQueued: true });
  }

  // Embedded apps can't follow a server redirect to Shopify's approval page
  // inside the iframe — hand the confirmation URL to the client for a
  // TOP-LEVEL redirect instead. returnUrl must re-enter the embedded admin.
  const storeHandle = session.shop.replace(/\.myshopify\.com$/, "");
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "marginmonster-1";
  const adminBase = `https://admin.shopify.com/store/${storeHandle}/apps/${appHandle}`;

  const requestCharge = async (plan: string, returnUrl: string) => {
    try {
      await billing.request({ plan: plan as never, isTest: billingIsTest(), returnUrl });
    } catch (e) {
      if (e instanceof Response && e.status >= 300 && e.status < 400) {
        const confirmationUrl = e.headers.get("location");
        if (confirmationUrl) return json({ confirmationUrl });
      }
      if (e instanceof Response) {
        // The new embedded-auth SDK delivers the charge CONFIRMATION URL in a
        // 401's reauthorize header (not a 3xx like the docs of old) — the
        // charge is already created; we just have to walk through the door.
        const reauth = e.headers.get("x-shopify-api-request-failure-reauthorize-url");
        if (reauth && /charges|confirm/i.test(reauth)) {
          return json({ confirmationUrl: reauth });
        }
        // Anything else: capture forensics, then rethrow so App Bridge can
        // recover genuine session bounces.
        await recordBillingFailure(e, session);
        throw e;
      }
      const anyErr = e as { message?: string; errorData?: unknown };
      const detail = anyErr?.errorData ? JSON.stringify(anyErr.errorData) : anyErr?.message || String(e);
      console.error("[billing] request failed:", detail);
      // test mode = the merchant is US — show the real reason so we can fix it
      return json({ error: billingIsTest() ? `Billing couldn't start: ${detail.slice(0, 300)}` : "Billing couldn't start — give it another try in a moment." });
    }
    return json({ error: "Billing didn't respond — try again." });
  };

  // ---- referral: a new store enters someone's code (paid out on conversion) ----
  if (intent === "applyReferral") {
    const shop = await db.shop.findUnique({ where: { domain: session.shop } });
    if (!shop) return json({ error: "Shop not found." });
    const { applyReferralCode } = await import("../lib/referral.server");
    const r = await applyReferralCode(shop.id, (form.get("code") as string) || "");
    return json(r.ok ? { referralApplied: true } : { error: r.error });
  }

  // ---- token top-up: one-time charge, credited on confirmed return ----
  if (intent === "buyTokens") {
    const packKey = form.get("packKey") as keyof typeof TOKEN_PACK_PLANS;
    if (!TOKEN_PACK_PLANS[packKey]) return json({ error: "Unknown token pack." });
    const shop = await db.shop.findUnique({ where: { domain: session.shop }, include: { activePlan: true } });
    if (!shop?.activePlan) return json({ error: "Pick a package first — tokens top up your plan's balance." });
    return requestCharge(packKey, `${adminBase}/app/plans?pack=${packKey}`);
  }

  // ---- plan subscription: PAYMENT FIRST — activation happens on the return
  // leg (loader) only after Shopify confirms the subscription is active ----
  // planKey may be a tier key or an annual key; validate against the tier.
  const planKey = form.get("planKey") as string;
  const tierKey = (ANNUAL_TO_TIER[planKey] || planKey) as PlanKey;
  const reviewMode = (form.get("reviewMode") as "SET_AND_FORGET" | "REVIEW_FIRST") || "REVIEW_FIRST";
  if (!PLAN_BY_KEY[tierKey]) throw new Error("Invalid plan");
  return requestCharge(planKey, `${adminBase}/app/plans?activate=${planKey}&review=${reviewMode}`);
};




/* Package identities — a crew-rank ladder: the bigger your voyage, the higher
 * your rank. Companions are the merchant's own pick now; these crests carry the
 * tier flex. whoFor + why power the "flip for details" back of each card. */

export default function Plans() {
  const { currentPlan, billingTest, welcome, topped, packs, referralCode, referredBy, referralReward, appListingUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const billingError = actionData && "error" in actionData ? actionData.error : null;
  const confirmationUrl = actionData && "confirmationUrl" in actionData ? actionData.confirmationUrl : null;
  const submit = useSubmit();
  const nav = useNavigation();

  // Billing approval must be a TOP-LEVEL redirect (the confirmation page lives
  // on admin.shopify.com and can't load inside the embedded iframe → 401).
  useEffect(() => {
    if (!confirmationUrl) return;
    try {
      if (window.top) {
        window.top.location.href = confirmationUrl;
        return;
      }
    } catch {
      /* cross-origin — fall through */
    }
    window.open(confirmationUrl, "_top");
  }, [confirmationUrl]);
  const [pending, setPending] = useState<PlanKey | null>(null);
  const [annual, setAnnual] = useState(false);
  const [refInput, setRefInput] = useState("");
  const [copied, setCopied] = useState(false);
  const referralApplied = !!(actionData && "referralApplied" in actionData);
  const shareMsg = `Try EasyMode on Shopify — AI blogs, videos & auto-posting built from your real products. Use my code ${referralCode} and we both get ${referralReward} free tokens. ${appListingUrl}`;
  const copyRef = () => {
    navigator.clipboard?.writeText(shareMsg).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => { /* clipboard blocked */ });
  };

  const buy = (tierKey: PlanKey) => {
    setPending(tierKey);
    submit({ planKey: annual ? annualKey(tierKey) : tierKey }, { method: "post" });
  };

  // Post-purchase success banner (plan activated or tokens topped up).
  const [success, setSuccess] = useState<null | { kind: "plan"; key: PlanKey } | { kind: "tokens"; n: number }>(() =>
    welcome && PLAN_BY_KEY[welcome as PlanKey]
      ? { kind: "plan", key: welcome as PlanKey }
      : topped
        ? { kind: "tokens", n: Number(topped) || 0 }
        : null
  );
  const closeSuccess = () => {
    setSuccess(null);
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("welcome");
      u.searchParams.delete("topped");
      window.history.replaceState({}, "", u.toString());
    } catch { /* cosmetic */ }
  };

  return (
    <Page fullWidth backAction={{ content: "Home", url: "/app" }}>
      <div className="pl">
        <header className="pl-hero">
          <span className="pl-eyebrow">Plans &amp; pricing</span>
          <h1>Pick the plan that fits your store.</h1>
          <p>Start free for 7 days — cancel anytime. Every plan builds real content from your products and posts it for you, automatically.</p>
          <div className="pl-toggle" role="group" aria-label="Billing period">
            <button type="button" className={annual ? "" : "on"} onClick={() => setAnnual(false)}>Monthly</button>
            <button type="button" className={annual ? "on" : ""} onClick={() => setAnnual(true)}>Annual <span>2 months free</span></button>
          </div>
        </header>

        {billingTest && (
          <div className="pl-banner test">🧪 <b>Billing is in test mode.</b> Approvals run the real Shopify checkout but no money moves — set BILLING_TEST=0 to charge for real.</div>
        )}
        {success && (
          <div className="lvc-scrim" role="dialog" aria-label="Purchase confirmed">
            <div className="lvc-card">
              <div className="lvc-coins" aria-hidden="true">
                {Array.from({ length: 12 }).map((_, i) => <span key={i} className={`lvc-coin c${i + 1}`}>🪙</span>)}
              </div>
              <div className="lvc-medal"><b className="star">✦</b></div>
              {success.kind === "plan" ? (
                <>
                  <div className="lvc-eyebrow">Marketing level up</div>
                  <div className="lvc-title">{PLAN_BY_KEY[success.key]?.name ?? "Your plan"} is live</div>
                  <p className="lvc-msg">Your store&apos;s marketing just leveled up — content starts now.</p>
                  <div className="lvc-gift">🎁 {PLAN_BY_KEY[success.key]?.monthlyTokens.toLocaleString()} 🪙 tokens loaded — every month</div>
                </>
              ) : (
                <>
                  <div className="lvc-eyebrow">Tokens added</div>
                  <div className="lvc-title">+{success.n.toLocaleString()} tokens</div>
                  <p className="lvc-msg">They just hit your balance — spend them on anything.</p>
                </>
              )}
              <button type="button" className="lvc-btn" onClick={closeSuccess}>Let&apos;s go →</button>
            </div>
          </div>
        )}
        {billingError && <div className="pl-banner err"><b>Couldn&apos;t start checkout.</b> {billingError}</div>}
        <div className="pl-grid">
          {PLAN_TIERS.map((tier) => {
            const isCurrent = currentPlan === tier.key;
            const loading = nav.state !== "idle" && pending === tier.key;
            return (
              <div className={`pl-card${tier.highlight ? " feat" : ""}${isCurrent ? " current" : ""}`} key={tier.key}>
                {tier.highlight && <div className="pl-ribbon">Most popular</div>}
                <div className="pl-name">{tier.name}</div>
                <div className="pl-tag">{tier.tagline}</div>
                <div className="pl-price">
                  {annual ? <>${annualPrice(tier).toLocaleString()}<small>/yr</small></> : <>${tier.price}<small>/mo</small></>}
                </div>
                <div className="pl-sub">{annual ? `Just $${Math.round((tier.price * 10) / 12)}/mo, billed yearly · 2 months free` : "billed monthly"}</div>
                <div className="pl-tokens">🪙 {tier.monthlyTokens.toLocaleString()} tokens / mo</div>
                <ul className="pl-feats">
                  {tier.features.map((ft) => <li key={ft}>{ft}</li>)}
                </ul>
                <div className="pl-spacer" />
                <button
                  type="button"
                  className={`pl-cta${tier.highlight ? " go" : ""}`}
                  onClick={() => buy(tier.key)}
                  disabled={isCurrent || loading}
                >
                  {isCurrent ? "✓ Your plan" : loading ? "Starting…" : "Start free"}
                </button>
                {!isCurrent && <div className="pl-trial">7-day free trial · then ${annual ? `${annualPrice(tier).toLocaleString()}/yr` : `${tier.price}/mo`}</div>}
              </div>
            );
          })}
        </div>

        {/* Token top-ups — one-time purchases, credited on confirmed payment */}
        {currentPlan && (
          <section className="pl-sec">
            <div className="pl-sec-h">Need more? Top up tokens</div>
            <p className="pl-sec-sub">One-time packs that never expire — spend them on anything: videos, images, blogs, campaigns.</p>
            <div className="pl-packs">
              {packs.map((p) => (
                <div key={p.key} className={`pl-pack${p.best ? " best" : ""}`}>
                  {p.best && <span className="pl-pack-tag">Best value</span>}
                  <div className="pl-pack-n">+{p.tokens.toLocaleString()}</div>
                  <div className="pl-pack-u">tokens</div>
                  <p>
                    {p.key === "TOKENS_250" && "A quick refill — a handful of extra videos or a full image campaign."}
                    {p.key === "TOKENS_750" && "The workhorse pack — a whole campaign with room to spare."}
                    {p.key === "TOKENS_2000" && "The best rate per token in the shop — go all-in."}
                  </p>
                  <div className="pl-spacer" />
                  <button
                    type="button"
                    className="pl-cta"
                    disabled={nav.state !== "idle"}
                    onClick={() => submit({ intent: "buyTokens", packKey: p.key }, { method: "post" })}
                  >
                    Buy for ${p.price}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Referral — both stores earn tokens when a referred store converts */}
        {referralCode && (
          <section className="pl-sec">
            <div className="pl-sec-h">Refer a store, you both earn</div>
            <div className="pl-refer">
              <div className="pl-refer-main">
                <h3>Share EasyMode — you <em>both</em> get {referralReward} 🪙</h3>
                <p>When a store you refer starts a paid plan, {referralReward} tokens land in both wallets.</p>
                <div className="pl-refer-code">
                  <span className="pl-code">{referralCode}</span>
                  <button type="button" className="pl-cta go sm" onClick={copyRef}>{copied ? "Copied ✓" : "Copy invite"}</button>
                </div>
              </div>
              {!referredBy ? (
                <div className="pl-refer-enter">
                  <label>Got a code from another store?</label>
                  {referralApplied ? (
                    <div className="pl-refer-ok">Code applied ✓ — your {referralReward} tokens land when you start a paid plan.</div>
                  ) : (
                    <div className="pl-refer-row">
                      <input value={refInput} maxLength={12} placeholder="ENTER CODE" onChange={(e) => setRefInput(e.target.value.toUpperCase())} />
                      <button type="button" className="pl-cta sm" disabled={nav.state !== "idle" || refInput.trim().length < 5} onClick={() => submit({ intent: "applyReferral", code: refInput.trim() }, { method: "post" })}>Apply</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="pl-refer-enter"><div className="pl-refer-ok">You joined with a referral — enjoy your bonus tokens 🪙</div></div>
              )}
            </div>
          </section>
        )}

        <p className="pl-foot">Cancel or switch plans anytime. Top up tokens whenever you need more — no upgrade required.</p>
      </div>
    </Page>
  );
}
