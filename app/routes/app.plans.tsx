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

/* ---- Pixel-art fighter sprites ----
 * Each fighter is a 14x18 bitmap. Two frames (idle guard + punch) are drawn
 * and cross-faded with stepped CSS animation so it reads like a real arcade
 * sprite that changes pose. Colour keys resolve per-tier via the accent.
 */
const GRID_W = 14;

// shared body; only the front arm differs between guard and punch
const F_IDLE = [
  ".....ooo......",
  "....oaaao.....",
  "....okkko.....",
  "....okeko.....",
  "....okkko.....",
  ".....ooo......",
  "....aaaaa.....",
  "...oaaaaao....",
  "...oaaaaao.ff.",
  "...oaaaaao.ff.",
  "...odaaado....",
  "...oaaaaao....",
  "....ok.ko.....",
  "....ok.ko.....",
  "...okk.kko....",
  "...od...do....",
  "...od...do....",
  "..ooo...ooo...",
];
const F_PUNCH = F_IDLE.map((row, y) =>
  y === 8 ? "...oaaaaaaaaff" : y === 9 ? "...oaaaaao...." : row
);

function pixelRects(map: string[], colorFor: (c: string) => string | null, keyPrefix: string) {
  const out: JSX.Element[] = [];
  map.forEach((row, y) => {
    for (let x = 0; x < GRID_W; x++) {
      const c = row[x];
      if (!c || c === "." || c === " ") continue;
      const fill = colorFor(c);
      if (!fill) continue;
      out.push(<rect key={`${keyPrefix}${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={fill} />);
    }
  });
  return out;
}

function PixelFighter({ power, accent, context }: { power: number; accent: string; context?: "fight" }) {
  const colorFor = (c: string): string | null => {
    switch (c) {
      case "o": return "#0B0A17";        // outline
      case "k": return "#ECC39A";        // skin
      case "e": return "#0B0A17";        // eye
      case "d": return "#1C1930";        // belt / boots
      case "a": return accent;           // suit / armour
      case "f": return accent;           // glove
      default: return null;
    }
  };
  // escalating gear overlay drawn on both frames
  const gear: JSX.Element[] = [];
  if (power >= 2) gear.push(<rect key="emblem" x={6.2} y={8.2} width={1.6} height={1.6} fill="#FFFFFF" opacity={0.85} />);
  if (power >= 3) { // shoulder pads
    gear.push(<rect key="padL" x={2} y={6} width={2} height={2} fill={accent} />);
    gear.push(<rect key="padR" x={8} y={6} width={2} height={2} fill={accent} />);
  }
  if (power === 4) { // crown crest
    gear.push(<rect key="cr1" x={5} y={-1} width={1} height={1} fill={accent} />);
    gear.push(<rect key="cr2" x={7} y={-1} width={1} height={1} fill={accent} />);
    gear.push(<rect key="cr3" x={6} y={0} width={2} height={1} fill={accent} />);
  }
  return (
    <svg
      viewBox="-1 -2 16 21"
      className={`mm-pixel${context === "fight" ? " in-fight" : ""}`}
      shapeRendering="crispEdges"
      style={{ ["--fx" as string]: accent }}
      aria-hidden="true"
    >
      {/* soft aura scales with power */}
      <ellipse cx="7" cy="10" rx={5 + power * 0.9} ry="10" fill={accent} opacity={0.05 + power * 0.03} />
      <g className="pf-idle">{pixelRects(F_IDLE, colorFor, "i")}{gear}</g>
      <g className="pf-punch">{pixelRects(F_PUNCH, colorFor, "p")}{gear}</g>
    </svg>
  );
}

/** The weaker "solo" opponent — same body, greyed out, no gear. */
function PixelFoe() {
  const colorFor = (c: string): string | null => {
    switch (c) {
      case "o": return "#0B0A17";
      case "k": return "#B9B4CE";
      case "e": return "#0B0A17";
      case "d": return "#3A3654";
      case "a": return "#6E6A88";
      case "f": return "#6E6A88";
      default: return null;
    }
  };
  return (
    <svg viewBox="-1 -2 16 21" className="mm-pixel foe" shapeRendering="crispEdges" aria-hidden="true">
      {pixelRects(F_IDLE, colorFor, "f")}
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
              <div className="mm-fighter-you"><PixelFighter key={previewKey} power={champ.power} accent={champ.accent} context="fight" /></div>
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
