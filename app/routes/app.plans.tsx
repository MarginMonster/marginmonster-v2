import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Layout,
  Text,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { PLAN_TIERS, PLAN_BY_KEY, type PlanKey } from "../lib/plan-config";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true },
  });
  return json({
    currentPlan: shop?.activePlan?.type || null,
    currentReview: shop?.activePlan?.reviewMode || "REVIEW_FIRST",
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const form = await request.formData();
  const planKey = form.get("planKey") as PlanKey;
  const reviewMode = (form.get("reviewMode") as "SET_AND_FORGET" | "REVIEW_FIRST") || "REVIEW_FIRST";

  const tier = PLAN_BY_KEY[planKey];
  if (!tier) throw new Error("Invalid plan");

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) throw new Error("Shop not found");

  // Seed the plan row (so quotas are ready the moment payment clears).
  await db.plan.upsert({
    where: { shopId: shop.id },
    create: {
      shopId: shop.id,
      type: planKey,
      reviewMode,
      blogQuota: tier.blogQuota,
      videoQuota: tier.videoQuota,
      imageQuota: tier.imageQuota,
      adCreativePack: tier.imageQuota > 0,
      campaignAutopilot: tier.campaignAutopilot,
      periodStart: new Date(),
    },
    update: {
      type: planKey,
      reviewMode,
      blogQuota: tier.blogQuota,
      videoQuota: tier.videoQuota,
      imageQuota: tier.imageQuota,
      adCreativePack: tier.imageQuota > 0,
      campaignAutopilot: tier.campaignAutopilot,
      active: true,
    },
  });

  // Attempt the real Shopify charge. On success this THROWS a redirect to
  // Shopify's approval screen. If billing isn't fully set up yet, we don't
  // block the merchant — the plan is already active, so we just send them
  // back to the dashboard. Real charging turns on once billing is verified.
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  try {
    await billing.request({
      plan: planKey,
      isTest: true,
      returnUrl: `${appUrl}/app`,
    });
  } catch (e) {
    if (e instanceof Response) throw e; // the approval redirect — let it flow
    // Surface the real billing error so we can see what Shopify says.
    const anyErr = e as { message?: string; errorData?: unknown };
    const detail = anyErr?.errorData
      ? JSON.stringify(anyErr.errorData)
      : anyErr?.message || String(e);
    console.error("[billing] request failed:", detail);
    return json({ error: detail });
  }

  throw redirect("/app");
};

type Fighter = { title: string; rank: string; power: number; accent: string; stats: { label: string; v: number }[] };
const FIGHTERS: Record<string, Fighter> = {
  STARTER: { title: "Striker", rank: "TIER I", power: 1, accent: "#34E7E4",
    stats: [{ label: "CONTENT", v: 2 }, { label: "ADS", v: 0 }, { label: "VIDEO", v: 0 }, { label: "AUTOPILOT", v: 0 }] },
  GROWTH: { title: "Bruiser", rank: "TIER II", power: 2, accent: "#E5397D",
    stats: [{ label: "CONTENT", v: 4 }, { label: "ADS", v: 3 }, { label: "VIDEO", v: 0 }, { label: "AUTOPILOT", v: 1 }] },
  PRO: { title: "Warlord", rank: "TIER III", power: 3, accent: "#F5C451",
    stats: [{ label: "CONTENT", v: 4 }, { label: "ADS", v: 4 }, { label: "VIDEO", v: 3 }, { label: "AUTOPILOT", v: 4 }] },
  SCALE: { title: "Titan", rank: "TIER IV", power: 4, accent: "#B77BFF",
    stats: [{ label: "CONTENT", v: 5 }, { label: "ADS", v: 5 }, { label: "VIDEO", v: 5 }, { label: "AUTOPILOT", v: 5 }] },
};

/**
 * Parametric neon fighter — a full-body martial silhouette that bulks up
 * and gains gear/aura as `power` (tier) climbs. Drawn in the tier accent.
 */
function FighterArt({ power, accent, className }: { power: number; accent: string; className?: string }) {
  const Sh = 20 + power * 3;       // shoulder half-width
  const torsoW = 13 + power * 3;   // torso bulk
  const limbW = 8 + power * 2;     // arm/leg thickness
  const body = "#F1EFFC";
  const lf = { x: 70 - 18, y: 62 };
  const rf = { x: 70 + 16, y: 56 };
  return (
    <svg viewBox="0 0 140 190" className={`mm-fighter-svg${className ? " " + className : ""}`} aria-hidden="true">
      {/* aura */}
      <ellipse cx="70" cy="98" rx={30 + power * 8} ry="82" fill={accent} opacity={0.06 + power * 0.035} />
      {/* cape (higher tiers) */}
      {power >= 3 && <path d="M50 52 Q28 122 44 178 L70 150 L96 178 Q112 122 90 52 Z" fill={accent} opacity="0.22" />}
      {/* limbs */}
      <g fill="none" stroke={body} strokeWidth={limbW} strokeLinecap="round" strokeLinejoin="round">
        <polyline points={`70,100 ${70 - 24},140 ${70 - 34},178`} />
        <polyline points={`70,100 ${70 + 22},138 ${70 + 34},176`} />
        <polyline points={`${70 - Sh},52 ${70 - Sh - 6},74 ${lf.x},${lf.y}`} />
        <polyline points={`${70 + Sh},52 ${70 + Sh + 4},76 ${rf.x},${rf.y}`} />
      </g>
      {/* torso + shoulders */}
      <line x1="70" y1="44" x2="70" y2="102" stroke={body} strokeWidth={torsoW} strokeLinecap="round" />
      <line x1={70 - Sh} y1="52" x2={70 + Sh} y2="52" stroke={body} strokeWidth={limbW} strokeLinecap="round" />
      {/* shoulder pads */}
      {power >= 3 && (
        <>
          <path d={`M${70 - Sh - 10} 52 a10 10 0 0 1 20 0 z`} fill={accent} opacity="0.9" />
          <path d={`M${70 + Sh - 10} 52 a10 10 0 0 1 20 0 z`} fill={accent} opacity="0.9" />
        </>
      )}
      {/* head + headband */}
      <circle cx="70" cy="30" r="13" fill={body} />
      <path d="M56 27 H84" stroke={accent} strokeWidth="4" strokeLinecap="round" />
      <path d="M84 26 l11 -3 M84 30 l11 3" stroke={accent} strokeWidth="2.5" strokeLinecap="round" />
      {/* crown (top tier) */}
      {power === 4 && <path d="M56 18 l4 -13 5 9 5 -13 5 13 5 -9 4 13 z" fill={accent} />}
      {/* chest emblem */}
      {power >= 2 && <circle cx="70" cy="68" r={4 + power} fill={accent} />}
      {/* fists (glowing on high tiers) */}
      {power >= 3 && (
        <>
          <circle cx={lf.x} cy={lf.y} r={limbW} fill={accent} opacity="0.55" />
          <circle cx={rf.x} cy={rf.y} r={limbW} fill={accent} opacity="0.55" />
        </>
      )}
      <circle cx={lf.x} cy={lf.y} r={limbW / 1.5} fill={body} />
      <circle cx={rf.x} cy={rf.y} r={limbW / 1.5} fill={body} />
    </svg>
  );
}

/** The weaker "solo" opponent for the fight scene — thin, grey, no gear. */
function FoeArt() {
  const body = "#7C7796";
  return (
    <svg viewBox="0 0 140 190" className="mm-fighter-svg foe" aria-hidden="true">
      <g fill="none" stroke={body} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="70,100 58,142 52,178" />
        <polyline points="70,100 84,142 90,178" />
        <polyline points="56,54 48,78 62,72" />
        <polyline points="84,54 92,80 80,74" />
      </g>
      <line x1="70" y1="46" x2="70" y2="102" stroke={body} strokeWidth="11" strokeLinecap="round" />
      <line x1="56" y1="54" x2="84" y2="54" stroke={body} strokeWidth="7" strokeLinecap="round" />
      <circle cx="70" cy="32" r="12" fill={body} />
    </svg>
  );
}

export default function Plans() {
  const { currentPlan, currentReview } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const billingError = actionData && "error" in actionData ? actionData.error : null;
  const submit = useSubmit();
  const nav = useNavigation();
  const [reviewMode, setReviewMode] = useState<string>(currentReview);
  const [pending, setPending] = useState<PlanKey | null>(null);

  const buy = (planKey: PlanKey) => {
    setPending(planKey);
    submit({ planKey, reviewMode }, { method: "post" });
  };

  return (
    <Page
      fullWidth
      backAction={{ content: "Home", url: "/app" }}
      title="Choose your plan"
      subtitle="Pick a plan, choose how hands-on you want to be, and start growing today."
    >
      <Layout>
        <Layout.Section>
          <div className="mm-hero">
            <span className="mm-eyebrow">▶ SELECT YOUR LEVEL</span>
            <h1>Pick your level. Let your store sell for you.</h1>
            <p>
              You didn't start a business to spend nights writing blog posts and
              editing videos. Pick a plan and hand the content grind to us — grow
              faster, and take your time back.
            </p>
          </div>
        </Layout.Section>

        {billingError && (
          <Layout.Section>
            <Banner tone="critical" title="Couldn't start checkout">
              <p>{billingError}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Animated fight — an Arcade-powered owner vs. going it alone */}
        <Layout.Section>
          <div className="mm-fight">
            <div className="mm-fight-hud">
              <div className="mm-hp-block">
                <div className="mm-hp-name">MARKET ARCADE OWNER</div>
                <div className="mm-hp"><span className="mm-hp-fill you" /></div>
              </div>
              <div className="mm-fight-vs">VS</div>
              <div className="mm-hp-block right">
                <div className="mm-hp-name">GOING IT ALONE</div>
                <div className="mm-hp"><span className="mm-hp-fill foe" /></div>
              </div>
            </div>

            <div className="mm-fight-stage">
              <div className="mm-fighter-you"><FighterArt power={4} accent="#34E7E4" /></div>
              <div className="mm-fight-hit">POW!</div>
              <div className="mm-fighter-foe"><FoeArt /></div>
            </div>

            <p className="mm-fight-caption">
              With the arcade running your marketing, you fight in a different
              weight class. <strong>Choose how hands-on you want to be:</strong>
            </p>

            <div className="mm-seg" role="group" aria-label="Publishing mode">
              <button
                type="button"
                className={`mm-seg-btn${reviewMode === "SET_AND_FORGET" ? " on" : ""}`}
                onClick={() => setReviewMode("SET_AND_FORGET")}
              >
                ⚡ Set &amp; forget
                <small>Publishes automatically</small>
              </button>
              <button
                type="button"
                className={`mm-seg-btn${reviewMode === "REVIEW_FIRST" ? " on" : ""}`}
                onClick={() => setReviewMode("REVIEW_FIRST")}
              >
                ✓ Review first
                <small>You approve before it goes live</small>
              </button>
            </div>
          </div>
        </Layout.Section>

        {/* Character-select — each tier is a stronger fighter */}
        <Layout.Section>
          <span className="mm-section-label">▶ SELECT YOUR FIGHTER</span>
          <div className="mm-fighter-grid">
            {PLAN_TIERS.map((tier) => {
              const isCurrent = currentPlan === tier.key;
              const f = FIGHTERS[tier.key];
              return (
                <div
                  key={tier.key}
                  className={`mm-fighter-card${tier.highlight ? " is-featured" : ""}`}
                  style={{ ["--fx" as string]: f.accent }}
                >
                  {tier.highlight && <div className="mm-plan-ribbon">Most popular</div>}

                  <div className="mm-fighter-portrait">
                    <div className="mm-fighter-rank">{f.rank}</div>
                    <FighterArt power={f.power} accent={f.accent} />
                    <div className="mm-fighter-power">
                      {[1, 2, 3, 4].map((n) => (
                        <span key={n} className={`pw${n <= f.power ? " on" : ""}`} />
                      ))}
                    </div>
                  </div>

                  <div className="mm-fighter-name">{f.title}</div>
                  <div className="mm-fighter-plan">
                    {tier.name}{isCurrent && <span className="mm-fighter-current">SELECTED</span>}
                  </div>
                  <p className="mm-plan-price" style={{ margin: "6px 0 12px" }}>
                    ${tier.price}<small> /mo</small>
                  </p>

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
                    {isCurrent ? "SELECTED" : nav.state !== "idle" && pending === tier.key ? "LOADING…" : "▶ SELECT"}
                  </button>
                </div>
              );
            })}
          </div>
        </Layout.Section>

        <Layout.Section>
          <Text variant="bodySm" as="p" tone="subdued" alignment="center">
            Need more than your plan includes? Drop in tokens anytime — no
            upgrade required. Cancel or switch plans whenever you like.
          </Text>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
