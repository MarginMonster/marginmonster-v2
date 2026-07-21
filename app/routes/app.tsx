import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useLocation, useRouteError } from "@remix-run/react";
import { useState, useEffect, useRef } from "react";
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
import { getCompanion } from "../lib/companion.server";
import { totalXpForLevel } from "../lib/achievements";
import { paidAdsEnabled } from "../lib/feature-flags.server";
import { socialProviderEnabled } from "../lib/social-provider.server";

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
    srcs?: { a: string; b?: string; c?: string };
    accent: string;
    tokens: number;
    tokensPct: number; // health = % of wallet remaining
    tokensMax: number; // wallet ceiling (allowance + top-ups) for the HP label
    level: number;
    xpPct: number; // progress through the current level
    xpInto: number; // XP earned inside the current level
    xpNeed: number; // XP the current level spans — "132 / 280"
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
    tokensMax: 0,
    level: 1,
    xpPct: 0,
    xpInto: 0,
    xpNeed: 40,
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
      hud.xpInto = Math.max(0, shop.xp - cur);
      hud.xpNeed = Math.max(1, next - cur);
      hud.xpPct = Math.max(0, Math.min(100, Math.round((hud.xpInto / hud.xpNeed) * 100)));
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
        tokensMax,
        tokensPct: Math.max(0, Math.min(100, Math.round((remaining / tokensMax) * 100))),
        videos: Math.max(0, plan.videoQuota - plan.videoUsed),
        ads: Math.floor(remaining / TOKEN_COST.image),
      };
    }
    // The companion outranks the plan mascot everywhere it's been chosen.
    if (shop) {
      const comp = getCompanion({
        id: shop.id, companionId: shop.companionId, companionName: shop.companionName,
        companionArt: shop.companionArt, planType: plan?.type,
      });
      hud.img = comp.img;
      hud.accent = comp.accent;
      hud.srcs = comp.srcs;
    }
  } catch (e) {
    console.error("[app hud] failed to load player stats:", e);
  }

  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    hud,
    levelUp,
    // launch-time visibility gates (plumbing stays; UI hides until approval lands)
    features: { paidAds: paidAdsEnabled(), socialOn: socialProviderEnabled() },
  });
};

function LevelUpPopup({ level, gift, img, accent, srcs, onClose }: { level: number; gift: number; img: string | null; accent: string; srcs?: { a: string; b?: string; c?: string }; onClose: () => void }) {
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
            <Partner img={img} accent={accent} srcs={srcs} />
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
  const { apiKey, hud, levelUp, features } = useLoaderData<typeof loader>();
  const location = useLocation();
  // each page gets its own island scene (brand.css body[data-page] rules)
  const [pageKey, setPageKey] = useState("dashboard");
  useEffect(() => {
    const seg = location.pathname.split("/")[2] || "dashboard";
    const alias: Record<string, string> = { assets: "queue", products: "seo", strategy: "campaigns", connect: "queue", funnels: "plans", images: "videos" };
    const KNOWN = ["dashboard", "campaigns", "videos", "seo", "queue", "calendar", "performance", "plans"];
    const key = alias[seg] ?? seg;
    const resolved = KNOWN.includes(key) ? key : "dashboard";
    document.body.dataset.page = resolved;
    setPageKey(resolved);
  }, [location.pathname]);
  const [showLevelUp, setShowLevelUp] = useState(!!levelUp);
  // re-arm when a new level-up flash arrives on a later revalidation
  useEffect(() => { setShowLevelUp(!!levelUp); }, [levelUp]);
  // HUD collapse — remembered per browser (read after mount: SSR-safe)
  const [hudMin, setHudMin] = useState(false);
  useEffect(() => { setHudMin(localStorage.getItem("mmHudMin") === "1"); }, []);
  const toggleHud = () => {
    setHudMin((m) => { localStorage.setItem("mmHudMin", m ? "0" : "1"); return !m; });
  };
  // level-help popover: what leveling YOUR STORE earns you
  const [lvlInfo, setLvlInfo] = useState(false);

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <style dangerouslySetInnerHTML={{ __html: brandStyles }} />
      {showLevelUp && levelUp && (
        <LevelUpPopup
          level={levelUp.level}
          gift={levelUp.gift}
          img={hud.img}
          accent={hud.accent}
          srcs={hud.srcs}
          onClose={() => setShowLevelUp(false)}
        />
      )}
      {/* Player HUD — sticky top-right, like an arcade name/health bar */}
      <div className={`mm-hud${hudMin ? " min" : ""}`} aria-label="Player status">
        <Link to="/app/plans" className="mm-hud-avatar" title={`${hud.planLabel} — change plan`} style={{ ["--acc" as string]: hud.accent }}>
          {hud.img ? (
            <span className="mm-hud-sprite" aria-hidden="true">
              <Partner img={hud.img} accent={hud.accent} srcs={hud.srcs} />
            </span>
          ) : (
            <span className="mm-hud-face">🎮</span>
          )}
        </Link>
        {hudMin ? (
          <div className="mm-hud-body">
            <div className="mm-hud-top">
              <img src="/easymode-head.png" className="mm-hud-head" alt="" />
              <span className="mm-hud-lvl" title={`Level ${hud.level} · ${hud.xpNeed - hud.xpInto} XP to level ${hud.level + 1}`}>LVL {hud.level}</span>
              <span className="mm-hud-stat" title="Token balance">🪙 {hud.tokens.toLocaleString()}</span>
              <button type="button" className="mm-hud-toggle" onClick={toggleHud} title="Expand HUD" aria-label="Expand HUD">▾</button>
            </div>
          </div>
        ) : (
          <div className="mm-hud-body">
            <div className="mm-hud-top">
              <img src="/easymode-head.png" className="mm-hud-head" alt="" />
              <span className="mm-hud-name">{hud.name}</span>
              <span className="mm-hud-lvl" title={`Level ${hud.level} — your store's level`}>LVL {hud.level}</span>
              <button
                type="button"
                className="mm-hud-help"
                aria-label="What does leveling up do?"
                title="What does leveling up do?"
                onClick={() => setLvlInfo((v) => !v)}
              >?</button>
              {lvlInfo && (
                <div className="mm-lvlinfo" role="dialog" aria-label="Store level rewards">
                  <b>🏪 YOUR STORE IS LEVELING UP</b>
                  <p>Everything EasyMode does for your shop — takes, stills, campaigns, even tokens spent — earns XP. Levels pay you back in free tokens, automatically:</p>
                  <ul>
                    <li><i>Every level</i><em>+5 🪙</em></li>
                    <li><i>Every 5th level</i><em>+15 🪙</em></li>
                    <li><i>Levels 10 · 20 · 25 · 30</i><em>+60 🪙 — a free video</em></li>
                    <li><i>Level 40</i><em>+100 🪙 · 🌋 Island Legend</em></li>
                    <li><i>Level 50</i><em>+150 🪙 · 👑 Crowned</em></li>
                    <li><i>Levels 75 · 99</i><em>+250 · +500 🪙</em></li>
                  </ul>
                  <p className="foot">Achievements drop bonus tokens on top. Keep the island working — the wallet grows itself.</p>
                </div>
              )}
              <Link to="/app/plans" className="mm-hud-plan" title="Change plan">{hud.planLabel}</Link>
              <button type="button" className="mm-hud-toggle" onClick={toggleHud} title="Collapse HUD" aria-label="Collapse HUD">▴</button>
            </div>
            {/* Health = token wallet remaining */}
            <div className="mm-hud-barlabel">
              <span>❤ HP · tokens</span>
              <span>{hud.tokens.toLocaleString()} / {hud.tokensMax.toLocaleString()}</span>
            </div>
            <div className="mm-hud-hp" title={`${hud.tokensPct}% of your token wallet remaining`}>
              <i style={{ width: `${hud.tokensPct}%` }} />
            </div>
            {/* XP progress through the current level */}
            <div className="mm-hud-barlabel">
              <span>⚡ XP</span>
              <span>{hud.xpInto.toLocaleString()} / {hud.xpNeed.toLocaleString()} · {(hud.xpNeed - hud.xpInto).toLocaleString()} to LVL {hud.level + 1}</span>
            </div>
            <div className="mm-hud-xp" title={`${hud.xpPct}% of the way to level ${hud.level + 1}`}>
              <i style={{ width: `${hud.xpPct}%` }} />
            </div>
            <div className="mm-hud-stats">
              <Link to="/app/plans" className="mm-hud-top-up" title="Get more tokens">
                <span title="Token balance">🪙 {hud.tokens.toLocaleString()}</span>
                <span className="mm-hud-plus">+ INSERT TOKENS</span>
              </Link>
              <span className="mm-hud-stat" title="Video generations left">🎬 {hud.videos}</span>
              <span className="mm-hud-stat" title="Ad generations you can afford">🖼 {hud.ads}</span>
            </div>
          </div>
        )}
      </div>
      <NavMenu>
        <Link to="/app" rel="home">Dashboard</Link>
        <Link to="/app/campaigns">Marketing Campaigns</Link>
        <Link to="/app/videos">Video Studio</Link>
        <Link to="/app/images">Image Studio</Link>
        <Link to="/app/email">Email Studio</Link>
        <Link to="/app/seo">SEO Hub</Link>
        <Link to="/app/assets">Content Queue</Link>
        <Link to="/app/calendar">Content Calendar</Link>
        <Link to="/app/strategy">Strategy</Link>
        {(features.socialOn || features.paidAds) && (
          <Link to="/app/connect">{features.paidAds ? "Ad Accounts" : "Auto-Posting"}</Link>
        )}
        {features.paidAds && <Link to="/app/performance">Performance & ROI</Link>}
        <Link to="/app/plans">Packages & Companions</Link>
      </NavMenu>
      {/* spacer so the fixed HUD never covers page header actions */}
      <div className={`mm-hud-spacer${hudMin ? " slim" : ""}`} aria-hidden="true" />
      {/* the living island — per-page ambient loop; poster/body bg carry when the clip is absent */}
      <video
        key={pageKey}
        className="em-bgvid"
        src={`/bg/${pageKey}.mp4?v=2`}
        poster={`/bg/${pageKey}.jpg`}
        muted
        autoPlay
        loop
        playsInline
        aria-hidden="true"
      />
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = boundary.headers;


