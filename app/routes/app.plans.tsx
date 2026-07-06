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
    stats: [{ label: "CONTENT", v: 2 }, { label: "ADS", v: 0 }, { label: "VIDEO", v: 0 }, { label: "AUTOPILOT", v: 5 }] },
  GROWTH: { title: "Bruiser", rank: "TIER II", power: 2, accent: "#E5397D",
    stats: [{ label: "CONTENT", v: 4 }, { label: "ADS", v: 3 }, { label: "VIDEO", v: 0 }, { label: "AUTOPILOT", v: 5 }] },
  PRO: { title: "Warlord", rank: "TIER III", power: 3, accent: "#F5C451",
    stats: [{ label: "CONTENT", v: 4 }, { label: "ADS", v: 4 }, { label: "VIDEO", v: 3 }, { label: "AUTOPILOT", v: 5 }] },
  SCALE: { title: "Titan", rank: "TIER IV", power: 4, accent: "#B77BFF",
    stats: [{ label: "CONTENT", v: 5 }, { label: "ADS", v: 5 }, { label: "VIDEO", v: 5 }, { label: "AUTOPILOT", v: 5 }] },
};

/* ---- Street-Fighter-style martial artists ----
 * A dynamic side-on lunging stance drawn with rounded, muscular vector limbs
 * (thick strokes = volume, not LEGO blocks). Skin head w/ headband, extended
 * front jab. The front arm lives in `.pf-arm` and thrusts on the punch.
 */
const OUT = "#0B0A17";
const SKIN = "#E9BA8B";

function PixelFighter({ power, accent, context }: { power: number; accent: string; context?: "fight" }) {
  const hair = "#231B33";
  const band = power >= 4 ? "#FFFFFF" : "#EDEAF6";
  return (
    <svg
      viewBox="0 0 140 140"
      className={`mm-pixel${context === "fight" ? " in-fight" : ""}`}
      style={{ ["--fx" as string]: accent }}
      aria-hidden="true"
    >
      {/* aura */}
      <ellipse cx="72" cy="86" rx={34 + power * 4} ry="54" fill={accent} opacity={0.05 + power * 0.03} />
      {/* cape (higher tiers) */}
      {power >= 3 && <path d="M60 50 Q38 98 52 130 L72 112 L92 130 Q104 98 82 50 Z" fill={accent} opacity="0.26" />}

      {/* body — thick rounded limbs, dark outline underlay for definition */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" stroke={OUT}>
        <path d="M64 84 L44 106" strokeWidth="25" />
        <path d="M44 106 L30 126" strokeWidth="19" />
        <path d="M72 84 L92 103" strokeWidth="25" />
        <path d="M92 103 L110 123" strokeWidth="19" />
        <path d="M60 84 L74 84" strokeWidth="27" />
        <path d="M67 83 L68 47" strokeWidth="29" />
        <path d="M59 48 L77 47" strokeWidth="24" />
        <path d="M62 50 L46 58 L40 68" strokeWidth="17" />
      </g>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" stroke={accent}>
        <path d="M64 84 L44 106" strokeWidth="21" />
        <path d="M44 106 L30 126" strokeWidth="15" />
        <path d="M72 84 L92 103" strokeWidth="21" />
        <path d="M92 103 L110 123" strokeWidth="15" />
        <path d="M60 84 L74 84" strokeWidth="23" />
        <path d="M67 83 L68 47" strokeWidth="25" />
        <path d="M59 48 L77 47" strokeWidth="20" />
        <path d="M62 50 L46 58 L40 68" strokeWidth="13" />
      </g>

      {/* belt */}
      <path d="M55 80 L79 80" stroke={power >= 4 ? "#F5C451" : "#12101E"} strokeWidth="6" strokeLinecap="round" />
      {/* chest emblem */}
      {power >= 2 && <circle cx="68" cy="62" r={3 + power} fill="#FFFFFF" opacity="0.9" />}

      {/* feet + rear fist */}
      <ellipse cx="27" cy="127" rx="12" ry="5.5" fill={SKIN} stroke={OUT} strokeWidth="1.5" />
      <ellipse cx="112" cy="124" rx="12" ry="5.5" fill={SKIN} stroke={OUT} strokeWidth="1.5" />
      <circle cx="40" cy="68" r="8.5" fill={SKIN} stroke={OUT} strokeWidth="2" />

      {/* shoulder pads (higher tiers) */}
      {power >= 3 && (
        <>
          <circle cx="59" cy="48" r="10" fill={accent} stroke={OUT} strokeWidth="2" />
          <circle cx="77" cy="47" r="10" fill={accent} stroke={OUT} strokeWidth="2" />
        </>
      )}

      {/* head, hair, headband, eye */}
      <circle cx="73" cy="30" r="14.5" fill={SKIN} stroke={OUT} strokeWidth="2" />
      <path d="M59 27 Q71 12 88 25 Q80 20 73 21 Q65 22 59 27 Z" fill={hair} />
      <path d="M59 29 Q73 22 88 29" fill="none" stroke={band} strokeWidth="5" strokeLinecap="round" />
      <path d="M60 30 L48 27 M60 33 L47 35" stroke={band} strokeWidth="3" strokeLinecap="round" />
      <circle cx="82" cy="30" r="2.3" fill={OUT} />
      {/* horns (top tier) */}
      {power === 4 && (
        <>
          <path d="M60 19 l-4 -11 9 6 z" fill={accent} stroke={OUT} strokeWidth="1.5" />
          <path d="M86 19 l4 -11 -9 6 z" fill={accent} stroke={OUT} strokeWidth="1.5" />
        </>
      )}

      {/* FRONT ARM + fist — thrusts on the punch */}
      <g className="pf-arm">
        <path d="M72 50 L95 51 L114 48" fill="none" stroke={OUT} strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M72 50 L95 51 L114 48" fill="none" stroke={accent} strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="116" cy="48" r="9.5" fill={power >= 4 ? "#FFFFFF" : SKIN} stroke={OUT} strokeWidth="2" />
      </g>
    </svg>
  );
}

/** The weaker "solo" opponent — a plain office guy throwing his hands up. */
function PixelFoe() {
  const suit = "#6E6A88";
  const dark = "#2C2942";
  const skin = "#C9B79E";
  return (
    <svg viewBox="0 0 120 140" className="mm-pixel foe" aria-hidden="true">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" stroke={suit}>
        <path d="M52 84 L46 118" strokeWidth="16" />
        <path d="M66 84 L72 118" strokeWidth="16" />
        <path d="M59 84 L59 46" strokeWidth="22" />
        <path d="M50 48 L68 48" strokeWidth="16" />
        <path d="M50 50 L39 39" strokeWidth="11" />
        <path d="M68 50 L79 39" strokeWidth="11" />
      </g>
      <path d="M59 50 L59 74" stroke={dark} strokeWidth="5" strokeLinecap="round" />
      <ellipse cx="44" cy="120" rx="10" ry="4.5" fill={dark} />
      <ellipse cx="74" cy="120" rx="10" ry="4.5" fill={dark} />
      <circle cx="38" cy="38" r="6.5" fill={skin} />
      <circle cx="80" cy="38" r="6.5" fill={skin} />
      <circle cx="59" cy="32" r="12.5" fill={skin} stroke={OUT} strokeWidth="1.5" />
      <path d="M47 30 Q59 19 71 30 Q65 25 59 26 Q53 25 47 30 Z" fill={dark} />
      <circle cx="54" cy="33" r="1.9" fill={OUT} />
      <circle cx="64" cy="33" r="1.9" fill={OUT} />
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

  // which plan the fight scene is previewing — hover a card to change it
  const defaultPreview = (PLAN_TIERS.find((t) => t.highlight)?.key || PLAN_TIERS[0].key) as PlanKey;
  const [previewKey, setPreviewKey] = useState<PlanKey>(defaultPreview);
  const champ = FIGHTERS[previewKey];
  const DMG: Record<number, string> = { 1: "70%", 2: "50%", 3: "28%", 4: "8%" };

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
                <div className="mm-hp-name" style={{ color: champ.accent }}>{champ.title.toUpperCase()} · ARCADE</div>
                <div className="mm-hp"><span className="mm-hp-fill you" /></div>
              </div>
              <div className="mm-fight-vs">VS</div>
              <div className="mm-hp-block right">
                <div className="mm-hp-name">GOING IT ALONE</div>
                <div className="mm-hp"><span className="mm-hp-fill foe" style={{ ["--dmg" as string]: DMG[champ.power] }} /></div>
              </div>
            </div>

            <div className="mm-fight-stage" data-p={champ.power}>
              <div className="mm-fighter-you"><PixelFighter power={champ.power} accent={champ.accent} context="fight" /></div>
              <div className="mm-fight-hit" style={{ color: champ.accent, fontSize: 15 + champ.power * 4 }}>
                {champ.power >= 4 ? "K.O.!" : champ.power >= 3 ? "BOOM!" : "POW!"}
              </div>
              <div className="mm-fighter-foe"><PixelFoe /></div>
            </div>

            <p className="mm-fight-caption">
              Hover a plan below to send that fighter in — <strong>stronger plans
              hit harder.</strong> Then choose how hands-on you want to be:
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
                  className={`mm-fighter-card${tier.highlight ? " is-featured" : ""}${previewKey === tier.key ? " is-previewing" : ""}`}
                  style={{ ["--fx" as string]: f.accent }}
                  onMouseEnter={() => setPreviewKey(tier.key as PlanKey)}
                >
                  {tier.highlight && <div className="mm-plan-ribbon">Most popular</div>}

                  <div className="mm-fighter-portrait">
                    <div className="mm-fighter-rank">{f.rank}</div>
                    <PixelFighter power={f.power} accent={f.accent} />
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
                    onFocus={() => setPreviewKey(tier.key as PlanKey)}
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
