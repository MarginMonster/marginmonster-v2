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


/** 🌘 MARBLE VOID — the Paradox ground, v2. White void with smoky marble
 *  veining, a confident ink-star field, and edge ANOMALIES (ringed planet,
 *  hairline constellation, crescent, ink swirl) plus the rare ink comet.
 *  Anomalies live at the viewport edges — never behind content. */
function ParadoxField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const x = c.getContext("2d");
    if (!x) return;
    let W = 0, H = 0, raf = 0;
    const stat = document.createElement("canvas");
    const sx = stat.getContext("2d");
    if (!sx) return;

    // ------- static layer: marble veins + anomalies (repainted on resize)
    const paintStatic = () => {
      sx.clearRect(0, 0, W, H);
      const vein = (x0: number, y0: number, steps: number, alpha: number, color: string, width: number) => {
        sx.strokeStyle = color; sx.globalAlpha = alpha; sx.lineWidth = width; sx.lineCap = "round";
        sx.beginPath(); sx.moveTo(x0, y0);
        let px = x0, py = y0, ang = Math.random() * 6.28;
        for (let i = 0; i < steps; i++) {
          ang += (Math.random() - 0.5) * 1.1;
          const len = 60 + Math.random() * 120;
          const nx = px + Math.cos(ang) * len, ny = py + Math.sin(ang) * len;
          sx.quadraticCurveTo(px + Math.cos(ang + 0.5) * len * 0.5, py + Math.sin(ang + 0.5) * len * 0.5, nx, ny);
          px = nx; py = ny;
        }
        sx.stroke();
        sx.globalAlpha = 1;
      };
      for (let i = 0; i < 7; i++) vein(Math.random() * W, Math.random() * H, 6 + Math.floor(Math.random() * 5), 0.045, "#14121F", 1 + Math.random() * 1.6);
      for (let i = 0; i < 2; i++) vein(Math.random() * W, Math.random() * H, 5, 0.05, "#C98F12", 0.8);
      for (let i = 0; i < 5; i++) {
        const gx = Math.random() * W, gy = Math.random() * H, gr = 180 + Math.random() * 260;
        const g = sx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        g.addColorStop(0, "rgba(20,18,31,0.028)"); g.addColorStop(1, "rgba(20,18,31,0)");
        sx.fillStyle = g; sx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
      }
      const ink = "#14121F";
      // ringed dark planet — upper right, gold ring
      const pX = W * 0.90, pY = H * 0.16, pR = 26;
      sx.globalAlpha = 0.85; sx.fillStyle = ink;
      sx.beginPath(); sx.arc(pX, pY, pR, 0, 7); sx.fill();
      sx.globalAlpha = 0.7; sx.strokeStyle = "#C98F12"; sx.lineWidth = 2;
      sx.beginPath(); sx.ellipse(pX, pY, pR * 1.9, pR * 0.55, -0.42, 0, 7); sx.stroke();
      // crescent — upper left
      const cX = W * 0.07, cY = H * 0.12;
      sx.globalAlpha = 0.8; sx.fillStyle = ink;
      sx.beginPath(); sx.arc(cX, cY, 15, 0, 7); sx.fill();
      sx.globalCompositeOperation = "destination-out";
      sx.beginPath(); sx.arc(cX + 7, cY - 4, 14, 0, 7); sx.fill();
      sx.globalCompositeOperation = "source-over";
      // hairline constellation — lower left
      const pts: Array<[number, number]> = [[0.06, 0.62], [0.10, 0.68], [0.085, 0.76], [0.14, 0.80], [0.17, 0.72]];
      const stars = pts.map(function (uv): [number, number] { return [uv[0] * W, uv[1] * H]; });
      sx.globalAlpha = 0.35; sx.strokeStyle = ink; sx.lineWidth = 0.8;
      sx.beginPath(); sx.moveTo(stars[0][0], stars[0][1]);
      for (let i = 1; i < stars.length; i++) sx.lineTo(stars[i][0], stars[i][1]);
      sx.stroke();
      sx.globalAlpha = 0.9; sx.fillStyle = ink;
      for (const sp of stars) { sx.beginPath(); sx.arc(sp[0], sp[1], 2.4, 0, 7); sx.fill(); }
      // ink swirl — lower right
      const wX = W * 0.93, wY = H * 0.82;
      sx.globalAlpha = 0.4; sx.strokeStyle = ink; sx.lineWidth = 1.4;
      sx.beginPath();
      for (let t = 0; t < 5.4; t += 0.12) {
        const r = 3 + t * 4.4;
        const px2 = wX + Math.cos(t * 1.9) * r, py2 = wY + Math.sin(t * 1.9) * r;
        if (t === 0) sx.moveTo(px2, py2); else sx.lineTo(px2, py2);
      }
      sx.stroke();
      sx.globalAlpha = 1;
    };

    const size = () => {
      W = c.width = stat.width = window.innerWidth;
      H = c.height = stat.height = window.innerHeight;
      paintStatic();
    };
    size();
    window.addEventListener("resize", size);

    // ------- dynamic layer: bold star spatter + rare ink comets
    type Dot = { x: number; y: number; r: number; p: number; s: number; dx: number; dy: number; gold: boolean };
    const dots: Dot[] = [];
    const spawn = (n: number, rMin: number, rMax: number, sat: boolean) => {
      for (let i = 0; i < n; i++) {
        const d: Dot = { x: Math.random(), y: Math.random(), r: rMin + Math.random() * (rMax - rMin),
          p: Math.random() * 6.28, s: 0.008 + Math.random() * 0.024,
          dx: (Math.random() - 0.5) * 0.000025, dy: (Math.random() - 0.5) * 0.00002,
          gold: Math.random() < 0.09 };
        dots.push(d);
        if (sat) for (let k = 0, m = 1 + Math.floor(Math.random() * 3); k < m; k++) {
          dots.push({ x: d.x + (Math.random() - 0.5) * 0.022, y: d.y + (Math.random() - 0.5) * 0.04,
            r: 0.5 + Math.random() * 1.1, p: Math.random() * 6.28, s: 0.01 + Math.random() * 0.02,
            dx: d.dx, dy: d.dy, gold: false });
        }
      }
    };
    spawn(150, 0.5, 1.3, false);
    spawn(48, 1.4, 2.6, false);
    spawn(15, 2.8, 4.6, true);
    const comets: Array<{ x: number; y: number; vx: number; vy: number; life: number }> = [];

    const tick = () => {
      x.clearRect(0, 0, W, H);
      x.drawImage(stat, 0, 0);
      for (const d of dots) {
        d.p += d.s;
        d.x = (d.x + d.dx + 1) % 1; d.y = (d.y + d.dy + 1) % 1;
        x.globalAlpha = Math.max(0.12, 0.5 + Math.sin(d.p) * 0.3);
        x.fillStyle = d.gold ? "#C98F12" : "#14121F";
        x.beginPath(); x.arc(d.x * W, d.y * H, d.r, 0, 7); x.fill();
      }
      if (Math.random() < 0.0035 && comets.length < 1) {
        const fromLeft = Math.random() < 0.5;
        comets.push({ x: fromLeft ? -40 : W + 40, y: Math.random() * H * 0.5,
          vx: (fromLeft ? 1 : -1) * (7 + Math.random() * 5), vy: 2 + Math.random() * 2, life: 0 });
      }
      for (let i = comets.length - 1; i >= 0; i--) {
        const m = comets[i]; m.x += m.vx; m.y += m.vy; m.life++;
        x.globalAlpha = Math.max(0, 0.5 - m.life / 220);
        x.strokeStyle = "#14121F"; x.lineWidth = 1.6; x.lineCap = "round";
        x.beginPath(); x.moveTo(m.x, m.y); x.lineTo(m.x - m.vx * 6, m.y - m.vy * 6); x.stroke();
        x.globalAlpha = Math.min(0.85, 0.5 - m.life / 220 + 0.35);
        x.fillStyle = "#14121F"; x.beginPath(); x.arc(m.x, m.y, 2.2, 0, 7); x.fill();
        if (m.life > 240 || m.x < -80 || m.x > W + 80 || m.y > H + 80) comets.splice(i, 1);
      }
      x.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", size); };
  }, []);
  return <canvas ref={ref} className="px-field" aria-hidden="true" />;
}
