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

/* ---- Chunky block fighters ----
 * Built from explicitly-sized muscle blocks (not a thin bitmap) so limbs are
 * thick and aligned. Every block gets a 1px dark outline via Blk. The front
 * arm lives in a `.pf-arm` group that thrusts on a transform keyframe = a
 * crisp, controllable punch (no ghosty frame cross-fade).
 */
const OUT = "#0B0A17";
function Blk({ x, y, w, h, fill }: { x: number; y: number; w: number; h: number; fill: string }) {
  return (
    <>
      <rect x={x - 1} y={y - 1} width={w + 2} height={h + 2} fill={OUT} />
      <rect x={x} y={y} width={w} height={h} fill={fill} />
    </>
  );
}

function PixelFighter({ power, accent, context }: { power: number; accent: string; context?: "fight" }) {
  const dark = "#141225";
  return (
    <svg
      viewBox="0 0 80 96"
      className={`mm-pixel${context === "fight" ? " in-fight" : ""}`}
      shapeRendering="crispEdges"
      style={{ ["--fx" as string]: accent }}
      aria-hidden="true"
    >
      {/* aura + cape behind the body */}
      <ellipse cx="34" cy="52" rx={22 + power * 3} ry="46" fill={accent} opacity={0.05 + power * 0.03} />
      {power >= 3 && <Blk x={16} y={30} w={36} h={54} fill={accent} />}
      {power >= 3 && <rect x={17} y={31} width={34} height={52} fill={accent} opacity={0.35} />}

      {/* rear (cocked) arm + fist */}
      <Blk x={8} y={32} w={12} h={20} fill={accent} />
      <Blk x={5} y={50} w={16} h={13} fill={accent} />

      {/* thick legs, wide stance */}
      <Blk x={20} y={60} w={12} h={26} fill={accent} />
      <Blk x={36} y={60} w={12} h={26} fill={accent} />
      <Blk x={18} y={83} w={16} h={9} fill={dark} />
      <Blk x={34} y={83} w={16} h={9} fill={dark} />

      {/* torso + belt + emblem */}
      <Blk x={20} y={34} w={28} h={24} fill={accent} />
      <Blk x={20} y={56} w={28} h={7} fill={dark} />
      {power >= 2 && <rect x={29} y={40} width={10} height={10} fill="#FFFFFF" opacity={0.9} />}

      {/* huge shoulders + pauldrons */}
      <Blk x={12} y={26} w={44} h={11} fill={accent} />
      {power >= 3 && <><Blk x={8} y={24} w={13} h={11} fill={accent} /><Blk x={47} y={24} w={13} h={11} fill={accent} /></>}

      {/* helmet + visor + glowing eyes + horns */}
      <Blk x={24} y={8} w={20} h={17} fill={accent} />
      <rect x={26} y={15} width={16} height={6} fill={OUT} />
      <rect x={28} y={16} width={5} height={4} fill="#FFFFFF" />
      <rect x={36} y={16} width={5} height={4} fill="#FFFFFF" />
      {power === 4 && <><rect x={19} y={2} width={5} height={9} fill={accent} /><rect x={44} y={2} width={5} height={9} fill={accent} /></>}

      {/* FRONT ARM — thrusts on the punch */}
      <g className="pf-arm">
        <Blk x={42} y={34} w={16} h={11} fill={accent} />
        <Blk x={54} y={33} w={14} h={14} fill={power >= 4 ? "#FFFFFF" : accent} />
      </g>
    </svg>
  );
}

/** The weaker "solo" opponent — a plain office guy, greyed out. */
function PixelFoe() {
  const shirt = "#6E6A88";
  const dark = "#2C2942";
  const skin = "#C9B79E";
  return (
    <svg viewBox="0 0 64 96" className="mm-pixel foe" shapeRendering="crispEdges" aria-hidden="true">
      {/* arms at sides */}
      <Blk x={14} y={30} w={8} h={22} fill={shirt} />
      <Blk x={42} y={30} w={8} h={22} fill={shirt} />
      <Blk x={14} y={50} w={8} h={6} fill={skin} />
      <Blk x={42} y={50} w={8} h={6} fill={skin} />
      {/* legs */}
      <Blk x={24} y={54} w={7} h={32} fill={dark} />
      <Blk x={33} y={54} w={7} h={32} fill={dark} />
      <Blk x={22} y={84} w={11} h={7} fill="#111018" />
      <Blk x={32} y={84} w={11} h={7} fill="#111018" />
      {/* torso + tie */}
      <Blk x={22} y={28} w={20} h={26} fill={shirt} />
      <rect x={30} y={30} width={4} height={16} fill={dark} />
      {/* head */}
      <Blk x={24} y={10} w={16} h={15} fill={skin} />
      <rect x={24} y={10} width={16} height={4} fill={dark} />
      <rect x={28} y={17} width={3} height={3} fill={OUT} />
      <rect x={34} y={17} width={3} height={3} fill={OUT} />
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
