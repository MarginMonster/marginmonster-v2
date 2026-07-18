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
import { PLAN_TIERS, PLAN_BY_KEY, TOKEN_PACKS, type PlanKey } from "../lib/plan-config";
import { Partner } from "../components/Partner";
import { unlockAchievement } from "../lib/xp.server";
import { COMPANIONS, COMPANION_BY_ID, CATEGORY_LABEL, companionSrcs, type CompanionCategory } from "../lib/companions";
import { enqueueJob } from "../lib/job-queue.server";
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
  const activate = url.searchParams.get("activate") as PlanKey | null;
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
        const { hasActivePayment } = await billing.check({ plans: [activate] as never, isTest: billingIsTest() });
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
  // is a forge currently running?
  let forging = false;
  try {
    if (shop) {
      const j = await db.job.findFirst({ where: { shopId: shop.id, type: "FORGE_COMPANION", status: { in: ["PENDING", "IN_PROGRESS"] } } });
      forging = !!j;
    }
  } catch { /* non-fatal */ }
  return json({
    currentPlan: shop?.activePlan?.type || null,
    currentReview: shop?.activePlan?.reviewMode || "REVIEW_FIRST",
    companionId: shop?.companionId || null,
    companionName: shop?.companionName || null,
    hasCustom: !!shop?.companionArt,
    shopId: shop?.id || "",
    installed,
    forging,
    billingTest: billingIsTest(),
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
    if (id === "custom" && !shop.companionArt) return json({ error: "Forge a custom companion first" });
    const nick = ((form.get("companionName") as string) || "").trim().slice(0, 24);
    await db.shop.update({
      where: { id: shop.id },
      data: { companionId: id, companionName: nick || (id === "custom" ? shop.companionName : COMPANION_BY_ID[id]?.name) },
    });
    return json({ companionSet: true });
  }
  if (intent === "forgeCompanion") {
    const shop = await db.shop.findUnique({ where: { domain: session.shop } });
    if (!shop) return json({ error: "Shop not found" });
    const prompt = ((form.get("prompt") as string) || "").trim();
    const name = ((form.get("name") as string) || "").trim();
    if (prompt.length < 8) return json({ error: "Describe your companion in a few words first." });
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

  // ---- token top-up: one-time charge, credited on confirmed return ----
  if (intent === "buyTokens") {
    const packKey = form.get("packKey") as keyof typeof TOKEN_PACK_PLANS;
    if (!TOKEN_PACK_PLANS[packKey]) return json({ error: "Unknown token pack." });
    const shop = await db.shop.findUnique({ where: { domain: session.shop }, include: { activePlan: true } });
    if (!shop?.activePlan) return json({ error: "Pick a package first — tokens live in your plan's wallet." });
    return requestCharge(packKey, `${adminBase}/app/plans?pack=${packKey}`);
  }

  // ---- plan subscription: PAYMENT FIRST — activation happens on the return
  // leg (loader) only after Shopify confirms the subscription is active ----
  const planKey = form.get("planKey") as PlanKey;
  const reviewMode = (form.get("reviewMode") as "SET_AND_FORGET" | "REVIEW_FIRST") || "REVIEW_FIRST";
  if (!PLAN_BY_KEY[planKey]) throw new Error("Invalid plan");
  return requestCharge(planKey, `${adminBase}/app/plans?activate=${planKey}&review=${reviewMode}`);
};




/* Package identities — expedition scale, not characters. Companions are the
 * merchant's own pick now; these emblems carry the tier flex instead. */
type Pkg = { title: string; ref: string; rank: string; power: 1 | 2 | 3 | 4; accent: string; img: string; stats: { label: string; v: number }[] };
const PACKAGES: Record<string, Pkg> = {
  STARTER: { title: 'STARTER SHOP', ref: 'Starter', rank: 'EXPEDITION I', power: 1, accent: '#34E7E4', img: '/plans/pkg-camp.png',
    stats: [{ label: 'CONTENT', v: 2 }, { label: 'ADS', v: 0 }, { label: 'VIDEO', v: 0 }, { label: 'AUTOPILOT', v: 5 }] },
  GROWTH: { title: 'RISING BRAND', ref: 'Growth', rank: 'EXPEDITION II', power: 2, accent: '#FF3D8B', img: '/plans/pkg-caravan.png',
    stats: [{ label: 'CONTENT', v: 4 }, { label: 'ADS', v: 3 }, { label: 'VIDEO', v: 0 }, { label: 'AUTOPILOT', v: 5 }] },
  PRO: { title: 'FLAGSHIP BRAND', ref: 'Rapid Growth', rank: 'EXPEDITION III', power: 3, accent: '#FFB020', img: '/plans/pkg-galleon.png',
    stats: [{ label: 'CONTENT', v: 4 }, { label: 'ADS', v: 4 }, { label: 'VIDEO', v: 3 }, { label: 'AUTOPILOT', v: 5 }] },
  SCALE: { title: 'HOUSEHOLD NAME', ref: 'Commercial Growth', rank: 'EXPEDITION IV', power: 4, accent: '#B77BFF', img: '/plans/pkg-citadel.png',
    stats: [{ label: 'CONTENT', v: 5 }, { label: 'ADS', v: 5 }, { label: 'VIDEO', v: 5 }, { label: 'AUTOPILOT', v: 5 }] },
};

export default function Plans() {
  const { currentPlan, companionId, companionName, hasCustom, shopId, installed, forging, billingTest, welcome, topped, packs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const billingError = actionData && "error" in actionData ? actionData.error : null;
  const confirmationUrl = actionData && "confirmationUrl" in actionData ? actionData.confirmationUrl : null;
  const companionSet = !!(actionData && "companionSet" in actionData);
  const forgeQueued = !!(actionData && "forgeQueued" in actionData);
  const submit = useSubmit();
  const nav = useNavigation();

  // companion gallery state
  const installedSet = new Set(installed);
  const gallery = COMPANIONS.filter((c) => installedSet.has(c.id));
  const [cat, setCat] = useState<CompanionCategory | "all">("all");
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

  const buy = (planKey: PlanKey) => {
    setPending(planKey);
    submit({ planKey }, { method: "post" });
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
    <Page
      fullWidth
      backAction={{ content: "Home", url: "/app" }}
      title="Expedition Packages"
      subtitle="Pick the scale of your expedition, then choose (or forge) the companion who runs it for you."
    >
      <Layout>
        <Layout.Section>
          <div className="mm-hero">
            <span className="mm-eyebrow">▶ EXPEDITION PACKAGES</span>
            <h1><span className="mm-marquee">Pick your package. Choose your companion.</span></h1>
            <p>
              You didn't start a business to grind through blog posts and video
              edits. Choose how big your expedition runs — then pick any
              companion you like to run it. Your buddy is yours forever, no
              matter how your package changes.
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
                    <p className="mm-lvlup-msg">The coins just hit your wallet.</p>
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
          <div className="mm-fighter-grid">
            {PLAN_TIERS.map((tier) => {
              const isCurrent = currentPlan === tier.key;
              const f = PACKAGES[tier.key];
              return (
                <div
                  key={tier.key}
                  className={`mm-fighter-card${tier.highlight ? " is-featured" : ""}`}
                  style={{ ["--fx" as string]: f.accent }}
                >
                  {tier.highlight && <div className="mm-plan-ribbon">★ Player favorite</div>}

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
                    ${tier.price}<small> /mo</small>
                  </p>
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
                  <button
                    className={`mm-fighter-select${nav.state !== "idle" && pending === tier.key ? " loading" : ""}`}
                    onClick={() => buy(tier.key)}
                    disabled={isCurrent}
                  >
                    {isCurrent ? "★ YOUR PACKAGE" : nav.state !== "idle" && pending === tier.key ? "LOADING…" : "▶ SET OUT"}
                  </button>
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
              <Banner tone="info" title="⚒️ The forge is lit">
                <p>Your custom companion is being forged — three animation frames, hand-cut. It installs itself automatically in a couple of minutes; check back or refresh.</p>
              </Banner>
            </div>
          )}

          <div className="cmp-wrap">
            <div className="cmp-left">
              <div className="cmp-filters">
                <button type="button" className={`cmp-chip${cat === "all" ? " on" : ""}`} onClick={() => setCat("all")}>ALL ({gallery.length})</button>
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
                    👁 View your forged companion
                  </button>
                )}
              </div>

              {/* the forge — free, always */}
              <div className="cmp-forge">
                <div className="cmp-forge-title">⚒️ FORGE YOUR OWN — FREE</div>
                <p className="cmp-forge-sub">Describe any companion you can imagine. We forge it in the house style with full animation frames.</p>
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
                  {forging || forgeQueued ? "⚒️ FORGING…" : "⚒️ FORGE COMPANION"}
                </button>
              </div>
            </div>
          </div>
        </Layout.Section>

        <Layout.Section>
          <Text variant="bodySm" as="p" tone="subdued" alignment="center">
            Need more than your package includes? Drop in tokens anytime — no
            upgrade required. Cancel or switch packages whenever you like. Your
            companion stays with you either way.
          </Text>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
