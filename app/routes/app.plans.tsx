import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useState, useEffect } from "react";
import {
  Page,
  Layout,
  Text,
  Banner,
} from "@shopify/polaris";
import { authenticate, billingIsTest, TOKEN_PACK_PLANS, TOKENS_BY_PACK } from "../shopify.server";
import { recordBillingFailure } from "../lib/billing-debug.server";
import { db } from "../db.server";
import { PLAN_TIERS, PLAN_BY_KEY, TOKEN_PACKS, ANNUAL_TO_TIER, annualKey, annualPrice, type PlanKey } from "../lib/plan-config";
import { Partner } from "../components/Partner";
import { unlockAchievement } from "../lib/xp.server";
import { REFERRAL_REWARD_TOKENS } from "../lib/referral.server";
import { COMPANIONS, COMPANION_BY_ID, CATEGORY_LABEL, companionSrcs, type CompanionCategory } from "../lib/companions";
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
type Pkg = {
  title: string; ref: string; rank: string; power: 1 | 2 | 3 | 4; accent: string; img: string;
  stats: { label: string; v: number }[];
  whoFor: string; why: string;
};
const PACKAGES: Record<string, Pkg> = {
  STARTER: { title: 'DECKHAND', ref: 'Get found', rank: 'CREW RANK I', power: 1, accent: '#34E7E4', img: '/plans/rank-deckhand.png',
    stats: [{ label: 'CONTENT', v: 2 }, { label: 'ADS', v: 0 }, { label: 'VIDEO', v: 0 }, { label: 'AUTOPILOT', v: 5 }],
    whoFor: 'Brand-new stores that just need to get found on Google.',
    why: 'Every blog post is a line in the water. Cast enough and free traffic starts washing in — day and night, on autopilot.' },
  GROWTH: { title: 'NAVIGATOR', ref: 'Get seen', rank: 'CREW RANK II', power: 2, accent: '#FF3D8B', img: '/plans/rank-navigator.png',
    stats: [{ label: 'CONTENT', v: 4 }, { label: 'ADS', v: 3 }, { label: 'VIDEO', v: 0 }, { label: 'AUTOPILOT', v: 5 }],
    whoFor: 'Stores ready to show up in the feed, not just in search.',
    why: 'Blogs pull them in from Google; scroll-stopping image ads catch them mid-scroll. Two nets in the water, twice the catch.' },
  PRO: { title: 'CAPTAIN', ref: 'Get selling', rank: 'CREW RANK III', power: 3, accent: '#FFB020', img: '/plans/rank-captain.png',
    stats: [{ label: 'CONTENT', v: 4 }, { label: 'ADS', v: 4 }, { label: 'VIDEO', v: 3 }, { label: 'AUTOPILOT', v: 5 }],
    whoFor: 'Growing brands that want video doing the heavy selling.',
    why: 'Video is the crew that never sleeps — selling on TikTok while you’re on the beach. And Autopilot runs the whole month, hands off.' },
  SCALE: { title: 'ADMIRAL', ref: 'Go all-in', rank: 'CREW RANK IV', power: 4, accent: '#B77BFF', img: '/plans/rank-admiral.png',
    stats: [{ label: 'CONTENT', v: 5 }, { label: 'ADS', v: 5 }, { label: 'VIDEO', v: 5 }, { label: 'AUTOPILOT', v: 5 }],
    whoFor: 'Stores going all-in — everywhere, every day, at once.',
    why: 'Maximum firepower: the most videos, the most ads, the best token rate. When you’re ready to own every feed, this is the flagship.' },
};

export default function Plans() {
  const { currentPlan, companionId, companionName, hasCustom, shopId, installed, forging, forgeFailed, billingTest, welcome, topped, packs, referralCode, referredBy, referralReward, appListingUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const billingError = actionData && "error" in actionData ? actionData.error : null;
  const confirmationUrl = actionData && "confirmationUrl" in actionData ? actionData.confirmationUrl : null;
  const companionSet = !!(actionData && "companionSet" in actionData);
  const forgeQueued = !!(actionData && "forgeQueued" in actionData);
  const submit = useSubmit();
  const nav = useNavigation();

  // plan cards flip to a plain-English detail back
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const toggleFlip = (k: string) => setFlipped((prev) => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n;
  });

  // companion gallery state
  const installedSet = new Set(installed);
  const gallery = COMPANIONS.filter((c) => installedSet.has(c.id));
  const [cat, setCat] = useState<CompanionCategory | "all">("troop"); // monkeys lead; no ALL tab
  const [selId, setSelId] = useState<string | null>(companionId);
  const [nick, setNick] = useState<string>(companionName || "");
  const [forgeName, setForgeName] = useState("");
  const [forgePrompt, setForgePrompt] = useState("");
  const selDef = selId && selId !== "custom" ? COMPANION_BY_ID[selId] : null;
  const selSrcs =
    selId === "custom" && hasCustom
      ? { a: `/companion-art/${shopId}/a`, b: `/companion-art/${shopId}/b`, c: `/companion-art/${shopId}/c` }
      : selDef ? companionSrcs(selDef.id) : null;

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

  // 💰 the money moment gets the level-up treatment — coins, companion, the works
  const [celebration, setCelebration] = useState<null | { kind: "plan"; key: PlanKey } | { kind: "tokens"; n: number }>(() =>
    welcome && PLAN_BY_KEY[welcome as PlanKey]
      ? { kind: "plan", key: welcome as PlanKey }
      : topped
        ? { kind: "tokens", n: Number(topped) || 0 }
        : null
  );
  const closeCelebration = () => {
    setCelebration(null);
    // strip only OUR params — the embedded host/id_token must survive
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("welcome");
      u.searchParams.delete("topped");
      window.history.replaceState({}, "", u.toString());
    } catch { /* cosmetic */ }
  };

  return (
    <Page fullWidth backAction={{ content: "Home", url: "/app" }}>
      <Layout>
        <Layout.Section>
          <div className="mm-hero">
            <span className="mm-eyebrow">▶ CHOOSE YOUR RANK</span>
            <h1><span className="mm-marquee">Pick your rank. Choose your companion.</span></h1>
            <p>
              You didn't start a business to grind through blog posts and video
              edits. Pick how big your voyage runs — then choose any companion
              you like to captain it. Your buddy is yours forever, no matter how
              your rank changes.
            </p>
          </div>
        </Layout.Section>

        {billingTest && (
          <Layout.Section>
            <Banner tone="warning" title="🧪 Billing is in TEST mode">
              <p>Approvals run the real Shopify checkout but no money moves. Set BILLING_TEST=0 on the server to charge for real.</p>
            </Banner>
          </Layout.Section>
        )}
        {celebration && (() => {
          const pkg = celebration.kind === "plan" ? PACKAGES[celebration.key] : null;
          const tier = celebration.kind === "plan" ? PLAN_BY_KEY[celebration.key] : null;
          return (
            <div className="mm-lvlup-overlay" role="dialog" aria-label="Purchase confirmed">
              <div className="mm-lvlup-card">
                <div className="mm-lvlup-coins" aria-hidden="true">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <span key={i} className={`c c${i + 1}`}>🪙</span>
                  ))}
                </div>
                {selSrcs ? (
                  <div className="mm-lvlup-partner">
                    <Partner img={selId || "custom"} accent={pkg?.accent || "#F0B429"} srcs={selSrcs} />
                  </div>
                ) : pkg ? (
                  <div className="mm-lvlup-partner"><img src={pkg.img} alt="" style={{ width: 120 }} /></div>
                ) : null}
                {celebration.kind === "plan" ? (
                  <>
                    <div className="mm-lvlup-eyebrow">✦ SUBSCRIPTION CONFIRMED ✦</div>
                    <div className="mm-lvlup-title big">{pkg?.title || celebration.key}</div>
                    <div className="mm-lvlup-live">IS LIVE</div>
                    <p className="mm-lvlup-msg">Your expedition is funded and your crew is on the clock.</p>
                    <div className="mm-lvlup-gift">
                      💰 LOADED: {tier ? `${tier.monthlyTokens.toLocaleString()} 🪙 tokens` : "fresh tokens"}
                      {tier && tier.videoQuota > 0 ? ` · 🎬 ${tier.videoQuota} video takes` : ""}
                      {tier ? ` · 📝 ${tier.blogQuota} blogs` : ""} — every month
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mm-lvlup-eyebrow">✦ PAYMENT CONFIRMED ✦</div>
                    <div className="mm-lvlup-title big">+{celebration.n.toLocaleString()} TOKENS</div>
                    <p className="mm-lvlup-msg">The coins just hit your balance.</p>
                    <div className="mm-lvlup-gift">💰 Spend them on anything: videos, campaigns, the works.</div>
                  </>
                )}
                <button type="button" className="pp-cta-hero" style={{ marginTop: 14 }} onClick={closeCelebration}>
                  ▶ LET'S GO
                </button>
              </div>
            </div>
          );
        })()}
        {billingError && (
          <Layout.Section>
            <Banner tone="critical" title="Couldn't start checkout">
              <p>{billingError}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Package select — each tier is a bigger expedition */}
        <Layout.Section>
          <span className="mm-section-label">▶ CHOOSE YOUR PACKAGE<span className="mm-dots">· · · · ·</span></span>
          <div className="mm-billtoggle" role="group" aria-label="Billing period">
            <button type="button" className={annual ? "" : "on"} onClick={() => setAnnual(false)}>Monthly</button>
            <button type="button" className={annual ? "on" : ""} onClick={() => setAnnual(true)}>Annual <span>2 months free</span></button>
          </div>
          <div className="mm-fighter-grid">
            {PLAN_TIERS.map((tier) => {
              const isCurrent = currentPlan === tier.key;
              const f = PACKAGES[tier.key];
              const isFlipped = flipped.has(tier.key);
              const buyBtn = (
                <>
                  <button
                    className={`mm-fighter-select${nav.state !== "idle" && pending === tier.key ? " loading" : ""}`}
                    onClick={() => buy(tier.key)}
                    disabled={isCurrent}
                  >
                    {isCurrent ? "★ YOUR RANK" : nav.state !== "idle" && pending === tier.key ? "LOADING…" : "▶ START FREE"}
                  </button>
                  {!isCurrent && <div className="mm-fighter-trial">7-day free trial · cancel anytime</div>}
                </>
              );
              return (
                <div
                  key={tier.key}
                  className={`mm-flip${isFlipped ? " flipped" : ""}${tier.highlight ? " is-featured" : ""}`}
                  style={{ ["--fx" as string]: f.accent }}
                >
                  {tier.highlight && <div className="mm-plan-ribbon">★ Player favorite</div>}
                  <div className="mm-flip-inner">
                    {/* FRONT — the flex */}
                    <div className="mm-fighter-card mm-flip-face">
                      <div className="mm-fighter-portrait">
                        <div className="mm-fighter-rank">{f.rank}</div>
                        <div className="pkg-emblem" style={{ ["--acc" as string]: f.accent }}>
                          <img src={f.img} alt={f.title} loading="lazy" />
                        </div>
                        <div className="mm-fighter-power">
                          {[1, 2, 3, 4].map((n) => (
                            <span key={n} className={`pw${n <= f.power ? " on" : ""}`} />
                          ))}
                        </div>
                      </div>

                      <div className="mm-fighter-name">{f.title}</div>
                      <div className="mm-fighter-plan">
                        <span className="mm-fighter-ref">"{f.ref}"</span>
                        {isCurrent && <span className="mm-fighter-current">YOURS</span>}
                      </div>
                      <p className="mm-plan-price" style={{ margin: "6px 0 4px" }}>
                        {annual ? <>${annualPrice(tier)}<small> /yr</small></> : <>${tier.price}<small> /mo</small></>}
                      </p>
                      {annual && <div className="mm-fighter-save">${tier.price * 2} saved · 2 months free</div>}
                      <div className="mm-fighter-tokens">⚡ {tier.monthlyTokens.toLocaleString()} tokens / mo</div>

                      <div className="mm-fighter-stats">
                        {f.stats.map((s) => (
                          <div className="mm-stat" key={s.label}>
                            <span className="sl">{s.label}</span>
                            <span className="sb">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <i key={n} className={n <= s.v ? "on" : ""} />
                              ))}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="mm-fighter-features">
                        {tier.features.slice(0, 4).map((ft) => (
                          <div className="ff" key={ft}><span>▸</span>{ft}</div>
                        ))}
                      </div>

                      <div style={{ flexGrow: 1 }} />
                      <button type="button" className="mm-flip-btn" onClick={() => toggleFlip(tier.key)}>
                        ⟲ View more
                      </button>
                      {buyBtn}
                    </div>

                    {/* BACK — plain-English detail + motivation */}
                    <div className="mm-fighter-card mm-flip-face mm-flip-back">
                      <div className="mm-flip-rank">{f.rank} · {f.title}</div>
                      <div className="mm-flip-block">
                        <b>🧭 WHO IT'S FOR</b>
                        <p>{f.whoFor}</p>
                      </div>
                      <div className="mm-flip-block">
                        <b>📦 EVERY MONTH, HANDS-OFF</b>
                        <ul>
                          {tier.blogQuota > 0 && <li><span>📝 {tier.blogQuota} SEO blog posts</span><em>ranks you on Google</em></li>}
                          {tier.imageQuota > 0 && <li><span>🖼 {tier.imageQuota} image ads</span><em>+ TikTok/Meta copy</em></li>}
                          {tier.videoQuota > 0 && <li><span>🎬 {tier.videoQuota} product videos</span><em>the crew that sells</em></li>}
                          <li><span>🪙 {tier.monthlyTokens.toLocaleString()} tokens</span><em>spend on anything extra</em></li>
                        </ul>
                      </div>
                      <div className="mm-flip-block why">
                        <b>💡 WHY IT WORKS</b>
                        <p>{f.why}</p>
                      </div>
                      <div style={{ flexGrow: 1 }} />
                      <button type="button" className="mm-flip-btn" onClick={() => toggleFlip(tier.key)}>
                        ⟲ Back
                      </button>
                      {buyBtn}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Layout.Section>

        {/* Token top-ups — one-time purchases, credited on confirmed payment */}
        {currentPlan && (
          <Layout.Section>
            <span className="mm-section-label">▶ INSERT TOKENS<span className="mm-dots">· · · · ·</span></span>
            <div className="pp-tools">
              {packs.map((p) => (
                <div key={p.key} className="pp-tool" style={{ cursor: "default" }}>
                  <span className="ico">🪙</span>
                  <h3>+{p.tokens.toLocaleString()} tokens</h3>
                  <p>
                    {p.key === "TOKENS_250" && "Enough for a bronze campaign or four extra video takes."}
                    {p.key === "TOKENS_750" && "Runs a silver campaign with room to spare — the workhorse pack."}
                    {p.key === "TOKENS_2000" && "Diamond-tier fuel — the best rate per token in the shop."}
                  </p>
                  <div className="pp-meta">
                    <span className="pp-count">${p.price}</span>
                    {p.best && <span className="pp-chip">Best value</span>}
                  </div>
                  <button
                    type="button"
                    className="pp-cta gold"
                    disabled={nav.state !== "idle"}
                    onClick={() => submit({ intent: "buyTokens", packKey: p.key }, { method: "post" })}
                  >
                    Buy for ${p.price}
                  </button>
                </div>
              ))}
            </div>
          </Layout.Section>
        )}

        {/* Referral — both stores earn tokens when a referred store converts */}
        {referralCode && (
          <Layout.Section>
            <span className="mm-section-label">▶ REFER &amp; EARN<span className="mm-dots">· · · · ·</span></span>
            <div className="pp-refer">
              <div className="pp-refer-main">
                <h3>Refer a store — you <em>both</em> get {referralReward} 🪙</h3>
                <p>Share your code. When a store you refer starts a paid plan, {referralReward} tokens land in both wallets.</p>
                <div className="pp-refer-code">
                  <span className="pp-code">{referralCode}</span>
                  <button type="button" className="pp-cta gold" onClick={copyRef}>{copied ? "Copied ✓" : "Copy invite"}</button>
                </div>
              </div>
              {!referredBy ? (
                <div className="pp-refer-enter">
                  <label>Got a code from another store?</label>
                  {referralApplied ? (
                    <div className="pp-refer-ok">Code applied ✓ — your {referralReward} tokens land when you start a paid plan.</div>
                  ) : (
                    <div className="pp-refer-row">
                      <input value={refInput} maxLength={12} placeholder="ENTER CODE" onChange={(e) => setRefInput(e.target.value.toUpperCase())} />
                      <button type="button" className="pp-cta" disabled={nav.state !== "idle" || refInput.trim().length < 5} onClick={() => submit({ intent: "applyReferral", code: refInput.trim() }, { method: "post" })}>Apply</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="pp-refer-enter"><div className="pp-refer-ok">You joined with a referral — enjoy your bonus tokens 🪙</div></div>
              )}
            </div>
          </Layout.Section>
        )}

        {/* Companion select — 48 chibi partners + the free forge */}
        <Layout.Section>
          <span className="mm-section-label">▶ CHOOSE YOUR COMPANION<span className="mm-dots">· · · · ·</span></span>
          {companionSet && (
            <div style={{ marginBottom: 12 }}>
              <Banner tone="success" title="Companion recruited!"><p>Your new buddy is live in the HUD and out on the quest map already.</p></Banner>
            </div>
          )}
          {(forgeQueued || forging) && (
            <div style={{ marginBottom: 12 }}>
              <Banner tone="info" title="🥥 On it!">
                <p>Your custom companion is being created — three animation frames, hand-cut. It installs itself automatically in a couple of minutes; check back or refresh.</p>
              </Banner>
            </div>
          )}
          {forgeFailed && !forging && !forgeQueued && (
            <div style={{ marginBottom: 12 }}>
              <Banner tone="warning" title="🌊 Server was busy — token refunded, try again!">
                <p>That one didn't come through, so we gave your token back. Give it another go — it usually works the second time.</p>
              </Banner>
            </div>
          )}

          <div className="cmp-wrap">
            <div className="cmp-left">
              <div className="cmp-filters">
                {(Object.keys(CATEGORY_LABEL) as CompanionCategory[]).map((k) => (
                  <button key={k} type="button" className={`cmp-chip${cat === k ? " on" : ""}`} onClick={() => setCat(k)}>{CATEGORY_LABEL[k]}</button>
                ))}
              </div>
              <div className="cmp-grid">
                {gallery.filter((c) => cat === "all" || c.cat === cat).map((c, ci) => (
                  <button
                    key={c.id} type="button"
                    className={`cmp-card${selId === c.id ? " on" : ""}${companionId === c.id ? " mine" : ""}`}
                    onClick={() => { setSelId(c.id); setNick(""); }}
                    title={`${c.name} — ${c.vibe}`}
                    style={{ ["--acc" as string]: c.accent, ["--fd" as string]: `${(ci % 8) * 0.4}s` }}
                  >
                    <span className="cmp-flip">
                      <img src={companionSrcs(c.id).a} alt={c.name} loading="lazy" className="fa" />
                      <img src={companionSrcs(c.id).c} alt="" loading="lazy" className="fb" aria-hidden="true" />
                    </span>
                    <span className="nm">{c.name}</span>
                  </button>
                ))}
                {gallery.length === 0 && (
                  <p style={{ fontFamily: "ui-monospace, monospace", color: "#7d7da8", fontSize: 13 }}>
                    The companion roster is still marching in — check back shortly.
                  </p>
                )}
              </div>
            </div>

            <div className="cmp-right">
              {/* live preview with the full flipbook animation */}
              <div className="cmp-preview">
                {selSrcs ? (
                  <>
                    <div className="cmp-stage" style={{ ["--acc" as string]: selDef?.accent || "#34E7E4" }}>
                      <Partner img={selId || "custom"} accent={selDef?.accent || "#34E7E4"} srcs={selSrcs} />
                    </div>
                    <div className="cmp-prevname">{selId === "custom" ? (companionName || "YOUR FORGED COMPANION") : selDef?.name}</div>
                    <div className="cmp-prevvibe">{selId === "custom" ? "One of one" : selDef?.vibe}</div>
                    <input
                      className="qh-input" style={{ width: "100%", marginTop: 8 }}
                      placeholder="Nickname (optional)" maxLength={24}
                      value={nick} onChange={(e) => setNick(e.target.value)}
                    />
                    <button
                      type="button" className="qh-start" style={{ marginTop: 10 }}
                      disabled={nav.state !== "idle" || companionId === selId && !nick}
                      onClick={() => submit({ intent: "setCompanion", companionId: selId!, companionName: nick }, { method: "post" })}
                    >
                      {companionId === selId ? "★ YOUR COMPANION" : "▶ MAKE IT MINE"}
                    </button>
                  </>
                ) : (
                  <p style={{ fontFamily: "ui-monospace, monospace", color: "#7d7da8", fontSize: 13, textAlign: "center" }}>
                    Pick a companion from the roster to preview it — blink, cheer, aura and all.
                  </p>
                )}
                {hasCustom && selId !== "custom" && (
                  <button type="button" className="qh-mini-btn" style={{ marginTop: 10, width: "100%" }} onClick={() => setSelId("custom")}>
                    👁 View your custom companion
                  </button>
                )}
              </div>

              {/* create your own — 1 token, saved to your profile */}
              <div className="cmp-forge">
                <div className="cmp-forge-title">🎨 CREATE YOUR OWN — 1 🪙</div>
                <p className="cmp-forge-sub">Describe any companion you can imagine. We create it in the house style with full animation frames and save it to your profile — yours forever.</p>
                <input
                  className="qh-input" style={{ width: "100%", marginBottom: 8 }}
                  placeholder="Name it (e.g. SPROCKET)" maxLength={24}
                  value={forgeName} onChange={(e) => setForgeName(e.target.value)}
                />
                <textarea
                  className="qh-input" style={{ width: "100%", minHeight: 64, resize: "vertical" }}
                  placeholder="a grumpy purple axolotl wearing a tiny wizard hat…"
                  maxLength={220}
                  value={forgePrompt} onChange={(e) => setForgePrompt(e.target.value)}
                />
                <button
                  type="button" className="qh-start" style={{ marginTop: 10 }}
                  disabled={nav.state !== "idle" || forging || forgeQueued || forgePrompt.trim().length < 8}
                  onClick={() => submit({ intent: "forgeCompanion", name: forgeName, prompt: forgePrompt }, { method: "post" })}
                >
                  {forging || forgeQueued ? "🎨 CREATING…" : "🎨 CREATE COMPANION · 1 🪙"}
                </button>
              </div>
            </div>
          </div>
        </Layout.Section>

        <Layout.Section>
          <p className="mm-floor-note">
            Need more than your package includes? Drop in tokens anytime — no
            upgrade required. Cancel or switch packages whenever you like. Your
            companion stays with you either way.
          </p>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
