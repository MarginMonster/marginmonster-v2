import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useLocation, useRouteError } from "@remix-run/react";
import { useState, useEffect } from "react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import brandStyles from "../brand.css?raw";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { refreshPeriod, tokensRemaining, tokensRemainingLive } from "../lib/tokens.server";
import { PLAN_BY_KEY, TOKEN_COST, resolveTierKey, type PlanKey } from "../lib/plan-config";
import { planTrialing } from "../lib/tokens.server";
import { PARTNER_BY_PLAN, type PlanKey as PartnerKey } from "../components/Partner";
import { getCompanion } from "../lib/companion.server";
import { totalXpForLevel } from "../lib/achievements";
import { paidAdsEnabled } from "../lib/feature-flags.server";
import { socialProviderEnabled } from "../lib/social-provider.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

// Display name per plan tier (current + legacy). The avatar itself is the
// matching partner monster (see PARTNER_BY_PLAN).
const PLAN_AVATAR: Record<string, { label: string }> = {
  STARTER: { label: "Starter" },
  STUDIO: { label: "Studio" },
  ANTHEM: { label: "Anthem" },
  GROWTH: { label: "Growth" },
  PRO: { label: "Pro" },
  SCALE: { label: "Scale" },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

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
      const remaining = tokensRemainingLive(plan);
      const partner = PARTNER_BY_PLAN[plan.type as PartnerKey];
      const tierKey = resolveTierKey(plan.type);
      const tokensMax = Math.max(1, (tierKey ? PLAN_BY_KEY[tierKey].monthlyTokens : plan.tokensIncluded) + plan.tokensExtra);
      const trialing = planTrialing(plan);
      hud = {
        ...hud,
        planKey: tierKey,
        // badge reflects the ACTUAL active plan — an inactive/cancelled plan reads "No Plan"
        planLabel: plan.active ? `${PLAN_AVATAR[plan.type]?.label ?? plan.type}${trialing ? " · Trial" : ""}` : "No Plan",
        img: partner?.img ?? null,
        accent: partner?.accent ?? "#34E7E4",
        tokens: remaining,
        tokensMax,
        tokensPct: Math.max(0, Math.min(100, Math.round((remaining / tokensMax) * 100))),
        // One wallet: show what the balance affords, not a separate quota.
        videos: Math.floor(remaining / TOKEN_COST.video),
        ads: Math.floor(remaining / TOKEN_COST.image),
      };
    }
    // Content language: auto-detect ONCE from the store's primary locale so a
    // Chinese store generates Chinese ads by default (web accounts set theirs
    // at signup). Never overwrites a value that's already set.
    if (shop && !shop.contentLang) {
      try {
        const r = await admin.graphql(`{ shopLocales { locale primary } }`);
        const j = (await r.json()) as { data?: { shopLocales?: { locale?: string; primary?: boolean }[] } };
        const primary = (j.data?.shopLocales || []).find((l) => l.primary)?.locale;
        const { normalizeContentLang } = await import("../lib/content-lang");
        await db.shop.update({ where: { id: shop.id }, data: { contentLang: normalizeContentLang(primary) } });
      } catch {
        await db.shop.update({ where: { id: shop.id }, data: { contentLang: "en" } }).catch(() => { /* non-fatal */ });
      }
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

function LevelUpPopup({ level, gift, onClose }: { level: number; gift: number; onClose: () => void }) {
  const isVideoGift = gift >= 60;
  return (
    <div className="lvc-scrim" role="dialog" aria-label={`Level ${level} reached`}>
      <div className="lvc-card">
        <div className="lvc-coins" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, i) => (
            <span key={i} className={`lvc-coin c${i + 1}`}>🪙</span>
          ))}
        </div>
        <div className="lvc-medal"><span className="lvc-ml">LVL</span><b>{level}</b></div>
        <div className="lvc-eyebrow">Store level up</div>
        <div className="lvc-title">Level {level}!</div>
        <p className="lvc-msg">Your store just leveled up — nice work.</p>
        {gift > 0 ? (
          <div className="lvc-gift">🎁 +{gift} 🪙 tokens{isVideoGift ? " — a free video, on us!" : " — a free ad, on us!"}</div>
        ) : (
          <div className="lvc-gift">🎁 Pick a plan to start earning level-up token rewards!</div>
        )}
        <button type="button" className="lvc-btn" onClick={onClose}>Continue →</button>
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
    const alias: Record<string, string> = { products: "seo", strategy: "campaigns", connect: "queue", funnels: "plans", studio: "campaigns", archive: "campaigns" };
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
          onClose={() => setShowLevelUp(false)}
        />
      )}
      {/* Player HUD — sticky top-right, like an arcade name/health bar */}
      <div className={`mm-hud${hudMin ? " min" : ""}`} aria-label="Player status">
        {hudMin ? (
          /* Collapsed = a single menu icon — the whole pill shrinks to it */
          <button
            type="button"
            className="mm-hud-menubtn"
            onClick={toggleHud}
            title={`LVL ${hud.level} · ${hud.tokens.toLocaleString()} tokens — tap to expand`}
            aria-label="Expand player HUD"
          >
            <img src="/easymode-head.png?v=2" className="mm-hud-head" alt="" />
          </button>
        ) : (
          <div className="mm-hud-body">
            <div className="mm-hud-top">
              <img src="/easymode-head.png?v=2" className="mm-hud-head" alt="" />
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
                  <button type="button" className="mm-lvlinfo-x" aria-label="Close" onClick={() => setLvlInfo(false)}>✕</button>
                  <b>🏪 YOUR STORE IS LEVELING UP</b>
                  <p>Everything EasyMode does for your shop — takes, stills, campaigns, even tokens spent — earns XP. Levels pay you back in free tokens, automatically:</p>
                  <ul>
                    <li><i>Every level</i><em>+5 🪙</em></li>
                    <li><i>Every 5th level</i><em>+15 🪙</em></li>
                    <li><i>Levels 10 · 20 · 25 · 30</i><em>+60 🪙 — a free video</em></li>
                    <li><i>Level 40</i><em>+100 🪙 · 🏅 Marketer</em></li>
                    <li><i>Level 50</i><em>+150 🪙 · 👑 Crowned</em></li>
                    <li><i>Levels 75 · 99</i><em>+250 · +500 🪙</em></li>
                  </ul>
                  <p className="foot">Achievements drop bonus tokens on top. Keep creating — your wallet grows itself.</p>
                </div>
              )}
              <Link to="/app/plans" className="mm-hud-plan" title="Change plan">{hud.planLabel}</Link>
              <button type="button" className="mm-hud-toggle" onClick={toggleHud} title="Collapse HUD" aria-label="Collapse HUD">▴</button>
            </div>
            {/* Health = token wallet remaining */}
            <div className="mm-hud-barlabel">
              <span>Token reserve</span>
              <span>{hud.tokens.toLocaleString()} / {hud.tokensMax.toLocaleString()}</span>
            </div>
            <div className="mm-hud-hp" title={`${hud.tokensPct}% of your token wallet remaining`}>
              <i style={{ width: `${hud.tokensPct}%` }} />
            </div>
            {/* XP progress through the current level */}
            <div className="mm-hud-barlabel">
              <span>XP · Level {hud.level}</span>
              <span>{hud.xpInto.toLocaleString()} / {hud.xpNeed.toLocaleString()} · {(hud.xpNeed - hud.xpInto).toLocaleString()} to LVL {hud.level + 1}</span>
            </div>
            <div className="mm-hud-xp" title={`${hud.xpPct}% of the way to level ${hud.level + 1}`}>
              <i style={{ width: `${hud.xpPct}%` }} />
            </div>
            <div className="mm-hud-stats">
              <Link to="/app/plans" className="mm-hud-top-up" title="Get more tokens">
                <span title="Token balance">{hud.tokens.toLocaleString()}</span>
                <span className="mm-hud-plus">Add tokens</span>
              </Link>
              <span className="mm-hud-stat" title="Product videos your token balance affords">🎬 {hud.videos} Videos</span>
              <span className="mm-hud-stat" title="Image ads your token balance affords">🖼 {hud.ads} Images</span>
            </div>
          </div>
        )}
      </div>
      <NavMenu>
        <Link to="/app" rel="home">Dashboard</Link>
        <Link to="/app/campaigns">Marketing Campaigns</Link>
        <Link to="/app/studio">Content Studio</Link>
        <Link to="/app/archive">Archive Storage</Link>
        <Link to="/app/email">Email Studio</Link>
        <Link to="/app/seo">SEO Hub</Link>
        <Link to="/app/calendar">Content Calendar</Link>
        <Link to="/app/strategy">Strategy</Link>
        {(features.socialOn || features.paidAds) && (
          <Link to="/app/connect">{features.paidAds ? "Ad Accounts" : "Auto-Posting"}</Link>
        )}
        <Link to="/app/performance">{features.paidAds ? "Performance & ROI" : "Results"}</Link>
        <Link to="/app/plans">Plans</Link>
      </NavMenu>
      {/* spacer so the fixed HUD never covers page header actions */}
      <div className={`mm-hud-spacer${hudMin ? " slim" : ""}`} aria-hidden="true" />
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = boundary.headers;


