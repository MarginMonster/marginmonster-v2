import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { useState, useEffect } from "react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import brandStyles from "../brand.css?raw";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { refreshPeriod, tokensRemaining } from "../lib/tokens.server";
import { PLAN_BY_KEY, TOKEN_COST, type PlanKey } from "../lib/plan-config";
import { Partner, PARTNER_BY_PLAN } from "../components/Partner";
import { totalXpForLevel } from "../lib/achievements";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

// Display name per plan tier. The avatar itself is the matching partner monster
// (see PARTNER_BY_PLAN), so the HUD stays in sync with the Plans select screen.
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

  // Player stats — token wallet, XP/level progression, generation balances.
  let hud: {
    name: string;
    planKey: PlanKey | null;
    planLabel: string;
    img: string | null;
    accent: string;
    tokens: number;
    tokensPct: number; // health = % of wallet remaining
    level: number;
    xpPct: number; // progress through the current level
    videos: number;
    ads: number;
  } = {
    name: playerName,
    planKey: null,
    planLabel: "No Plan",
    img: null,
    accent: "#34E7E4",
    tokens: 0,
    tokensPct: 0,
    level: 1,
    xpPct: 0,
    videos: 0,
    ads: 0,
  };
  // one-shot level-up celebration (set by awardXp, cleared here after read)
  let levelUp: { level: number; gift: number } | null = null;

  try {
    const shop = await db.shop.findUnique({
      where: { domain: session.shop },
      include: { activePlan: true },
    });
    if (shop) {
      const cur = totalXpForLevel(shop.level);
      const next = totalXpForLevel(shop.level + 1);
      hud.level = shop.level;
      hud.xpPct = Math.max(0, Math.min(100, Math.round(((shop.xp - cur) / Math.max(1, next - cur)) * 100)));
      if (shop.pendingLevelUp) {
        try { levelUp = JSON.parse(shop.pendingLevelUp); } catch { levelUp = null; }
        await db.shop.update({ where: { id: shop.id }, data: { pendingLevelUp: null } });
      }
    }
    let plan = shop?.activePlan ?? null;
    if (plan) {
      plan = await refreshPeriod(plan);
      const remaining = tokensRemaining(plan);
      const partner = PARTNER_BY_PLAN[plan.type as PlanKey];
      const tokensMax = Math.max(1, (PLAN_BY_KEY[plan.type as PlanKey]?.monthlyTokens ?? plan.tokensIncluded) + plan.tokensExtra);
      hud = {
        ...hud,
        planKey: plan.type as PlanKey,
        planLabel: PLAN_AVATAR[plan.type as PlanKey]?.label ?? plan.type,
        img: partner?.img ?? null,
        accent: partner?.accent ?? "#34E7E4",
        tokens: remaining,
        tokensPct: Math.max(0, Math.min(100, Math.round((remaining / tokensMax) * 100))),
        videos: Math.max(0, plan.videoQuota - plan.videoUsed),
        ads: Math.floor(remaining / TOKEN_COST.image),
      };
    }
  } catch (e) {
    console.error("[app hud] failed to load player stats:", e);
  }

  return json({ apiKey: process.env.SHOPIFY_API_KEY || "", hud, levelUp });
};

function LevelUpPopup({ level, gift, img, accent, onClose }: { level: number; gift: number; img: string | null; accent: string; onClose: () => void }) {
  const isVideoGift = gift >= 60;
  return (
    <div className="mm-lvlup-overlay" role="dialog" aria-label={`Level ${level} reached`}>
      <div className="mm-lvlup-card">
        <div className="mm-lvlup-coins" aria-hidden="true">
          {Array.from({ length: 10 }).map((_, i) => (
            <span key={i} className={`c c${i + 1}`}>🪙</span>
          ))}
        </div>
        {img && (
          <div className="mm-lvlup-partner">
            <Partner img={img} accent={accent} />
          </div>
        )}
        <div className="mm-lvlup-title">⭐ LEVEL {level}! ⭐</div>
        <p className="mm-lvlup-msg">Congratulations, Player One — your store just leveled up.</p>
        {gift > 0 ? (
          <div className="mm-lvlup-gift">
            🎁 REWARD: +{gift} 🪙 tokens{isVideoGift ? " — a FREE VIDEO generation, on us!" : " — a free ad generation, on us!"}
          </div>
        ) : (
          <div className="mm-lvlup-gift">🎁 Pick a plan to start collecting level-up token gifts!</div>
        )}
        <button type="button" className="mm-arcade-btn mm-lvlup-btn" onClick={onClose}>
          ▶ CONTINUE
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { apiKey, hud, levelUp } = useLoaderData<typeof loader>();
  const [showLevelUp, setShowLevelUp] = useState(!!levelUp);
  // re-arm when a new level-up flash arrives on a later revalidation
  useEffect(() => { setShowLevelUp(!!levelUp); }, [levelUp]);

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <style dangerouslySetInnerHTML={{ __html: brandStyles }} />
      {showLevelUp && levelUp && (
        <LevelUpPopup
          level={levelUp.level}
          gift={levelUp.gift}
          img={hud.img}
          accent={hud.accent}
          onClose={() => setShowLevelUp(false)}
        />
      )}
      {/* Player HUD — sticky top-right, like an arcade name/health bar */}
      <div className="mm-hud" aria-label="Player status">
        <Link to="/app/plans" className="mm-hud-avatar" title={`${hud.planLabel} — change plan`} style={{ ["--acc" as string]: hud.accent }}>
          {hud.img ? (
            <span className="mm-hud-sprite" aria-hidden="true">
              <Partner img={hud.img} accent={hud.accent} />
            </span>
          ) : (
            <span className="mm-hud-face">🎮</span>
          )}
        </Link>
        <div className="mm-hud-body">
          <div className="mm-hud-top">
            <span className="mm-hud-name">{hud.name}</span>
            <span className="mm-hud-lvl" title={`Level ${hud.level} — earn XP by forging, applying & spending tokens`}>LVL {hud.level}</span>
            <Link to="/app/plans" className="mm-hud-plan" title="Change plan">{hud.planLabel}</Link>
          </div>
          {/* Health = token wallet remaining (%) */}
          <div className="mm-hud-hp" title={`Health ${hud.tokensPct}% — token wallet remaining`}>
            <i style={{ width: `${hud.tokensPct}%` }} />
          </div>
          {/* XP progress through the current level */}
          <div className="mm-hud-xp" title={`XP ${hud.xpPct}% to level ${hud.level + 1}`}>
            <i style={{ width: `${hud.xpPct}%` }} />
          </div>
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
