import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import brandStyles from "../brand.css?raw";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { refreshPeriod, tokensRemaining } from "../lib/tokens.server";
import { PLAN_BY_KEY, TOKEN_COST, type PlanKey } from "../lib/plan-config";
import { Mech, MECH_BY_PLAN } from "../components/Mech";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

// Display name per plan tier. The avatar itself is the matching combat mech
// (see MECH_BY_PLAN), so the HUD stays in sync with the Plans select screen.
const PLAN_AVATAR: Record<PlanKey, { label: string }> = {
  STARTER: { label: "Starter" },
  GROWTH: { label: "Growth" },
  PRO: { label: "Pro" },
  SCALE: { label: "Scale" },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Player name = the Shopify staff member who signed in (online token),
  // falling back to the store handle.
  const user = (session as any).onlineAccessInfo?.associated_user;
  const playerName =
    [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() ||
    session.shop.replace(/\.myshopify\.com$/, "");

  // Player stats — token wallet + video/ad generation balance.
  let hud: {
    name: string;
    planKey: PlanKey | null;
    planLabel: string;
    img: string | null;
    accent: string;
    tokens: number;
    tokensMax: number;
    videos: number;
    ads: number;
  } = {
    name: playerName,
    planKey: null,
    planLabel: "No Plan",
    img: null,
    accent: "#34E7E4",
    tokens: 0,
    tokensMax: 0,
    videos: 0,
    ads: 0,
  };

  try {
    const shop = await db.shop.findUnique({
      where: { domain: session.shop },
      include: { activePlan: true },
    });
    let plan = shop?.activePlan ?? null;
    if (plan) {
      plan = await refreshPeriod(plan);
      const remaining = tokensRemaining(plan);
      const mech = MECH_BY_PLAN[plan.type as PlanKey];
      hud = {
        name: playerName,
        planKey: plan.type as PlanKey,
        planLabel: PLAN_AVATAR[plan.type as PlanKey]?.label ?? plan.type,
        img: mech?.img ?? null,
        accent: mech?.accent ?? "#34E7E4",
        tokens: remaining,
        tokensMax: Math.max(1, (PLAN_BY_KEY[plan.type as PlanKey]?.monthlyTokens ?? plan.tokensIncluded) + plan.tokensExtra),
        videos: Math.max(0, plan.videoQuota - plan.videoUsed),
        ads: Math.floor(remaining / TOKEN_COST.image),
      };
    }
  } catch (e) {
    console.error("[app hud] failed to load player stats:", e);
  }

  return json({ apiKey: process.env.SHOPIFY_API_KEY || "", hud });
};

export default function App() {
  const { apiKey, hud } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <style dangerouslySetInnerHTML={{ __html: brandStyles }} />
      {/* Player HUD — sticky top-right, like an arcade name/health bar */}
      <div className="mm-hud" aria-label="Player status">
        <Link to="/app/plans" className="mm-hud-avatar" title={`${hud.planLabel} — change plan`} style={{ ["--acc" as string]: hud.accent }}>
          {hud.img ? (
            <span className="mm-hud-sprite" aria-hidden="true">
              <Mech img={hud.img} accent={hud.accent} />
            </span>
          ) : (
            <span className="mm-hud-face">🎮</span>
          )}
        </Link>
        <div className="mm-hud-body">
          <div className="mm-hud-top">
            <span className="mm-hud-name">{hud.name}</span>
            <Link to="/app/plans" className="mm-hud-plan" title="Change plan">{hud.planLabel}</Link>
          </div>
          {/* Always-full lime health bar (decorative) */}
          <div className="mm-hud-hp" aria-hidden="true"><i /></div>
          <div className="mm-hud-stats">
            <Link to="/app/plans" className="mm-hud-top-up" title="Get more tokens">
              <span title="Tokens remaining">🪙 {hud.tokens.toLocaleString()}</span>
              <span className="mm-hud-plus">+ INSERT COINS</span>
            </Link>
            <span className="mm-hud-stat" title="Video generations left">🎬 {hud.videos}</span>
            <span className="mm-hud-stat" title="Ad generations you can afford">🖼 {hud.ads}</span>
          </div>
        </div>
      </div>
      <NavMenu>
        <Link to="/app" rel="home">Dashboard</Link>
        <Link to="/app/strategy">Marketing Plan</Link>
        <Link to="/app/plans">Choose Plan</Link>
        <Link to="/app/assets">Content Queue</Link>
        <Link to="/app/calendar">Content Calendar</Link>
        <Link to="/app/videos">Video Studio</Link>
        <Link to="/app/products">SEO Forge</Link>
        <Link to="/app/funnels">Landing Pages</Link>
        <Link to="/app/connect">Ad Accounts</Link>
        <Link to="/app/campaigns">Campaigns</Link>
        <Link to="/app/performance">Performance & ROI</Link>
      </NavMenu>
      <div className="mm-asteroids" aria-hidden="true">
        <svg className="ast a1" viewBox="0 0 100 100"><polygon points="50,4 74,14 92,40 86,68 66,92 38,90 12,70 6,40 22,16" /></svg>
        <svg className="ast a2" viewBox="0 0 100 100"><polygon points="48,6 70,10 90,34 94,58 78,82 52,94 26,86 8,62 10,32 28,14" /></svg>
        <svg className="ast a3" viewBox="0 0 100 100"><polygon points="50,8 78,22 90,50 76,82 44,92 16,72 10,42 26,18" /></svg>
        <svg className="ast a4" viewBox="0 0 100 100"><polygon points="50,6 80,26 88,56 68,86 36,88 12,62 14,30 32,12" /></svg>
      </div>
      {/* spacer so the fixed HUD never covers page header actions */}
      <div className="mm-hud-spacer" aria-hidden="true" />
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = boundary.headers;
