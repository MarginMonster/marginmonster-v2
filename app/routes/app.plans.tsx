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
  // returnUrl MUST re-enter the EMBEDDED admin context, otherwise Shopify
  // redirects to the bare app URL outside admin → no session → 401.
  const storeHandle = session.shop.replace(/\.myshopify\.com$/, "");
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "marginmonster-1";
  const returnUrl = `https://admin.shopify.com/store/${storeHandle}/apps/${appHandle}/app`;
  try {
    await billing.request({
      plan: planKey,
      isTest: true,
      returnUrl,
    });
  } catch (e) {
    if (e instanceof Response) {
      // A 3xx is the real approval redirect. Embedded apps CANNOT follow a
      // server redirect to admin.shopify.com inside the iframe (that 401s), so
      // hand the confirmation URL back to the client for a TOP-LEVEL redirect.
      if (e.status >= 300 && e.status < 400) {
        const confirmationUrl = e.headers.get("location");
        if (confirmationUrl) return json({ confirmationUrl });
        throw e;
      }
      // Any other Response (401/403/etc): the plan row is already active above,
      // so don't dead-end the merchant. Charging via the Billing API needs
      // expiring offline tokens (SDK migration) for apps created after
      // 2026-04-01; until then, activate the plan and return to the dashboard.
      const body = await e.text().catch(() => "");
      console.error("[billing] non-redirect response (plan still activated)", e.status, body.slice(0, 300));
      throw redirect("/app");
    }
    const anyErr = e as { message?: string; errorData?: unknown };
    const detail = anyErr?.errorData ? JSON.stringify(anyErr.errorData) : anyErr?.message || String(e);
    console.error("[billing] request failed:", detail);
    return json({ error: detail });
  }

  throw redirect("/app");
};

type Fighter = { title: string; ref: string; rank: string; power: number; accent: string; img: string; stats: { label: string; v: number }[] };
const FIGHTERS: Record<string, Fighter> = {
  STARTER: { title: "Striker", ref: "Starter", rank: "TIER I", power: 1, accent: "#34E7E4", img: "striker",
    stats: [{ label: "CONTENT", v: 2 }, { label: "ADS", v: 0 }, { label: "VIDEO", v: 0 }, { label: "AUTOPILOT", v: 5 }] },
  GROWTH: { title: "Bruiser", ref: "Pro", rank: "TIER II", power: 2, accent: "#E5397D", img: "bruiser",
    stats: [{ label: "CONTENT", v: 4 }, { label: "ADS", v: 3 }, { label: "VIDEO", v: 0 }, { label: "AUTOPILOT", v: 5 }] },
  PRO: { title: "Warlord", ref: "Master", rank: "TIER III", power: 3, accent: "#F5C451", img: "warlord",
    stats: [{ label: "CONTENT", v: 4 }, { label: "ADS", v: 4 }, { label: "VIDEO", v: 3 }, { label: "AUTOPILOT", v: 5 }] },
  SCALE: { title: "Titan", ref: "Grandmaster", rank: "TIER IV", power: 4, accent: "#B77BFF", img: "titan",
    stats: [{ label: "CONTENT", v: 5 }, { label: "ADS", v: 5 }, { label: "VIDEO", v: 5 }, { label: "AUTOPILOT", v: 5 }] },
};

/* Real generated pixel-art sprites (public/fighters/*.png), each on a pure
 * black background. Two frames per fighter ({img}.png + {img}_b.png) hard-cut
 * on a step animation = an arcade idle flipbook. `mix-blend-mode: lighten`
 * (in CSS) drops the black so the fighter floats on the dark stage. */
const SPRITE_V = "4"; // bump to bust browser cache when sprites change
function Sprite({ img, className }: { img: string; className: string }) {
  return (
    <div className={className}>
      <img className="frame f1" src={`/fighters/${img}.png?v=${SPRITE_V}`} alt="" aria-hidden="true" draggable={false} />
      <img className="frame f2" src={`/fighters/${img}_b.png?v=${SPRITE_V}`} alt="" aria-hidden="true" draggable={false} />
    </div>
  );
}

function PixelFighter({ img, accent, context }: { img: string; accent: string; context?: "fight" }) {
  return (
    <div className={`mm-pixel${context === "fight" ? " in-fight" : ""}`} style={{ ["--fx" as string]: accent }}>
      <Sprite img={img} className="mm-sprite" />
    </div>
  );
}

function PixelFoe() {
  return (
    <div className="mm-pixel foe">
      <Sprite img="foe" className="mm-sprite" />
    </div>
  );
}

export default function Plans() {
  const { currentPlan, currentReview } = useLoaderData<typeof loader>();
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
            <span className="mm-eyebrow">▶ CHOOSE YOUR PLAN</span>
            <h1>Choose your plan. Let your store sell for you.</h1>
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
              <div className="mm-fighter-you"><PixelFighter img={champ.img} accent={champ.accent} context="fight" /></div>
              <div className="mm-fireball" style={{ ["--fireclr" as string]: champ.accent }} />
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
                    <PixelFighter img={f.img} accent={f.accent} />
                    <div className="mm-fighter-power">
                      {[1, 2, 3, 4].map((n) => (
                        <span key={n} className={`pw${n <= f.power ? " on" : ""}`} />
                      ))}
                    </div>
                  </div>

                  <div className="mm-fighter-name">{f.title}</div>
                  <div className="mm-fighter-plan">
                    <span className="mm-fighter-ref">"{f.ref}"</span>
                    {isCurrent && <span className="mm-fighter-current">SELECTED</span>}
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
