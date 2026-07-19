import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
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

  return json({ apiKey: process.env.SHOPIFY_API_KEY || "", hud, levelUp });
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
  const { apiKey, hud, levelUp } = useLoaderData<typeof loader>();
  const [showLevelUp, setShowLevelUp] = useState(!!levelUp);
  // re-arm when a new level-up flash arrives on a later revalidation
  useEffect(() => { setShowLevelUp(!!levelUp); }, [levelUp]);
  // HUD collapse — remembered per browser (read after mount: SSR-safe)
  const [hudMin, setHudMin] = useState(false);
  useEffect(() => { setHudMin(localStorage.getItem("mmHudMin") === "1"); }, []);
  const toggleHud = () => {
    setHudMin((m) => { localStorage.setItem("mmHudMin", m ? "0" : "1"); return !m; });
  };

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
              <span className="mm-hud-lvl" title={`Level ${hud.level} · ${hud.xpNeed - hud.xpInto} XP to level ${hud.level + 1}`}>LVL {hud.level}</span>
              <span className="mm-hud-stat" title="Token balance">🪙 {hud.tokens.toLocaleString()}</span>
              <button type="button" className="mm-hud-toggle" onClick={toggleHud} title="Expand HUD" aria-label="Expand HUD">▾</button>
            </div>
          </div>
        ) : (
          <div className="mm-hud-body">
            <div className="mm-hud-top">
              <span className="mm-hud-name">{hud.name}</span>
              <span className="mm-hud-lvl" title={`Level ${hud.level} — earn XP by forging, applying & spending tokens`}>LVL {hud.level}</span>
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
        <Link to="/app/seo">SEO Hub</Link>
        <Link to="/app/assets">Content Queue</Link>
        <Link to="/app/calendar">Content Calendar</Link>
        <Link to="/app/strategy">Strategy</Link>
        <Link to="/app/connect">Ad Accounts</Link>
        <Link to="/app/performance">Performance & ROI</Link>
        <Link to="/app/plans">Packages & Companions</Link>
      </NavMenu>
      <ParadoxField />
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


/** 🌘 MARBLE VOID v3 — premium pass. Retina-crisp, anchored to the PAGE
 *  (scrolls with content via a seamless vertical tile — no dirt-on-glass),
 *  four-point star sparkles instead of dust, structured diagonal marble
 *  veining that actually reads, edge anomalies, elegant rare comets. */
function ParadoxField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const x = c.getContext("2d");
    if (!x) return;
    const INK = "#101018", GOLD = "#C98F12";
    let W = 0, H = 0, TILE = 0, dpr = 1, raf = 0;
    const tile = document.createElement("canvas");
    let tx: CanvasRenderingContext2D | null = null;

    // one four-point sparkle (the ✦ form) at crisp scale
    const sparklePath = (g: CanvasRenderingContext2D, px: number, py: number, r: number) => {
      const k = r * 0.22;
      g.beginPath();
      g.moveTo(px, py - r);
      g.quadraticCurveTo(px + k, py - k, px + r, py);
      g.quadraticCurveTo(px + k, py + k, px, py + r);
      g.quadraticCurveTo(px - k, py + k, px - r, py);
      g.quadraticCurveTo(px - k, py - k, px, py - r);
      g.closePath();
    };

    // stars live in TILE space and repeat forever down the page
    type Star = { x: number; y: number; r: number; p: number; s: number; gold: boolean };
    let stars: Star[] = [];

    const paintTile = () => {
      tx = tile.getContext("2d");
      if (!tx) return;
      tx.setTransform(dpr, 0, 0, dpr, 0, 0);
      tx.clearRect(0, 0, W, TILE);
      // v4: the void stays PURE — no bands, no clouds, no veins (they read
      // as dirty two-tone patches at page scale). Stars + anomalies carry it.
    };

    const seedStars = () => {
      stars = [];
      const n = Math.round((W * TILE) / 15000); // density by area
      for (let i = 0; i < n; i++) {
        stars.push({
          x: Math.random() * W, y: Math.random() * TILE,
          r: 3.0 + Math.random() * 6.0,
          p: Math.random() * 6.28, s: 0.006 + Math.random() * 0.012,
          gold: Math.random() < 0.14,
        });
      }
    };

    const size = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth; H = window.innerHeight;
      TILE = Math.round(H * 2);
      c.width = W * dpr; c.height = H * dpr;
      c.style.width = W + "px"; c.style.height = H + "px";
      tile.width = W * dpr; tile.height = TILE * dpr;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintTile();
      seedStars();
    };
    size();
    window.addEventListener("resize", size);

    // anomalies at fixed DOCUMENT positions (first stretch of the page)
    const drawAnomalies = (scroll: number) => {
      const items: Array<{ y: number; draw: (yy: number) => void }> = [
        { y: H * 0.14, draw: (yy) => { // ringed planet — upper right
          const pX = W * 0.915, pR = 27;
          x.globalAlpha = 0.96; x.fillStyle = INK;
          x.beginPath(); x.arc(pX, yy, pR, 0, 7); x.fill();
          x.globalAlpha = 0.9; x.strokeStyle = GOLD; x.lineWidth = 2.6;
          x.beginPath(); x.ellipse(pX, yy, pR * 1.85, pR * 0.5, -0.42, 0, 7); x.stroke();
        } },
        { y: H * 0.10, draw: (yy) => { // crescent — upper left
          const cX = W * 0.045;
          x.save();
          x.globalAlpha = 0.85; x.fillStyle = INK;
          x.beginPath(); x.arc(cX, yy, 17, 0, 7); x.fill();
          x.globalCompositeOperation = "destination-out";
          x.beginPath(); x.arc(cX + 8, yy - 4.5, 16, 0, 7); x.fill();
          x.restore();
        } },
        { y: H * 1.28, draw: (yy) => { // constellation — left, second screen
          const pts: Array<[number, number]> = [[0.05, 0], [0.09, 0.06], [0.075, 0.14], [0.13, 0.18], [0.16, 0.10]];
          x.globalAlpha = 0.5; x.strokeStyle = INK; x.lineWidth = 1;
          x.beginPath();
          pts.forEach((uv, i) => { const px = uv[0] * W, py = yy + uv[1] * H; if (i === 0) x.moveTo(px, py); else x.lineTo(px, py); });
          x.stroke();
          x.globalAlpha = 0.95; x.fillStyle = INK;
          for (const uv of pts) { sparklePath(x, uv[0] * W, yy + uv[1] * H, 6); x.fill(); }
        } },
        { y: H * 1.7, draw: (yy) => { // gold-dust eddy — right, deeper down
          x.globalAlpha = 0.8;
          for (let i = 0; i < 7; i++) {
            const t = i / 7 * 5.2, r = 4 + t * 5.5;
            x.fillStyle = i % 2 ? GOLD : INK;
            x.beginPath(); x.arc(W * 0.93 + Math.cos(t) * r, yy + Math.sin(t) * r, 1.4 + (i % 3) * 0.5, 0, 7); x.fill();
          }
        } },
      ];
      for (const it of items) {
        const yy = it.y - scroll;
        if (yy > -80 && yy < H + 80) it.draw(yy);
      }
      x.globalAlpha = 1;
    };

    type Comet = { x: number; y: number; vx: number; vy: number; life: number };
    const comets: Comet[] = [];

    const tick = () => {
      const scroll = window.scrollY || 0;
      x.clearRect(0, 0, W, H);
      // marble tile, page-anchored (repeats seamlessly down the document)
      const off = ((scroll % TILE) + TILE) % TILE;
      x.drawImage(tile, 0, -off * 0 - off, W, TILE);
      x.drawImage(tile, 0, TILE - off, W, TILE);
      // sparkles, page-anchored via the same tiling
      for (const st of stars) {
        st.p += st.s;
        const pulse = 0.72 + Math.sin(st.p) * 0.28;
        let sy = st.y - off; if (sy < -12) sy += TILE; if (sy > H + 12 && sy - TILE > -12) sy -= TILE;
        if (sy < -12 || sy > H + 12) continue;
        x.globalAlpha = 0.4 + pulse * 0.55;
        x.fillStyle = st.gold ? GOLD : INK;
        if (st.r < 4.2) { x.beginPath(); x.arc(st.x, sy, st.r * 0.45 * pulse + 0.8, 0, 7); x.fill(); }
        else { sparklePath(x, st.x, sy, st.r * pulse); x.fill(); }
      }
      drawAnomalies(scroll);
      // elegant rare comet
      if (Math.random() < 0.0045 && comets.length < 1) {
        const fromLeft = Math.random() < 0.5;
        comets.push({ x: fromLeft ? -60 : W + 60, y: H * (0.1 + Math.random() * 0.35),
          vx: (fromLeft ? 1 : -1) * (5.5 + Math.random() * 3), vy: 1.4 + Math.random() * 1.4, life: 0 });
      }
      for (let i = comets.length - 1; i >= 0; i--) {
        const m = comets[i]; m.x += m.vx; m.y += m.vy; m.life++;
        const fade = Math.max(0, 1 - m.life / 260);
        for (let t = 0; t < 9; t++) {
          x.globalAlpha = fade * 0.4 * (1 - t / 9);
          x.strokeStyle = INK; x.lineWidth = 1.5 - t * 0.12; x.lineCap = "round";
          x.beginPath();
          x.moveTo(m.x - m.vx * t * 1.6, m.y - m.vy * t * 1.6);
          x.lineTo(m.x - m.vx * (t + 1) * 1.6, m.y - m.vy * (t + 1) * 1.6);
          x.stroke();
        }
        x.globalAlpha = fade * 0.95; x.fillStyle = INK;
        sparklePath(x, m.x, m.y, 3.4); x.fill();
        if (m.life > 280 || m.x < -140 || m.x > W + 140 || m.y > H + 140) comets.splice(i, 1);
      }
      x.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", size); };
  }, []);
  return <canvas ref={ref} className="px-field" aria-hidden="true" />;
}
