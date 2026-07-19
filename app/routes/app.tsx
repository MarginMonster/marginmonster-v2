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


/** 🌩️ PARADOX VOID — the crowned backdrop (demo v10: lightning marble ·
 *  Storm liquid · black stars). Layer 1 is WebGL liquid stone: domain-warp
 *  fbm over the marble photo with a cursor lens stir, abyss-white grade,
 *  and three BLACK STARS that emit darkness instead of light — bending the
 *  veins around themselves, breathing, ringed by a thin gold event horizon.
 *  Layer 2 is a 2d entity pass: ink wisps, THE ALGORITHM (the gold-eyed
 *  watcher), a slow golden breath, free-drifting black motes, click ripples. */
function ParadoxField() {
  const stoneRef = useRef<HTMLCanvasElement>(null);
  const entRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sc = stoneRef.current, c = entRef.current;
    if (!sc || !c) return;
    let raf1 = 0, raf2 = 0;
    const disposers: Array<() => void> = [];
    let mx = window.innerWidth / 2, my = window.innerHeight * 0.4, tx = mx, ty = my;
    const onMove = (e: PointerEvent) => { tx = e.clientX; ty = e.clientY; };
    window.addEventListener("pointermove", onMove);
    disposers.push(() => window.removeEventListener("pointermove", onMove));

    // ── layer 1: liquid stone ──
    const gl = sc.getContext("webgl", { antialias: false, depth: false });
    if (gl) {
      const vsrc = "attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }";
      const fsrc = [
        "precision mediump float;",
        "uniform sampler2D uTex; uniform vec2 uRes; uniform vec2 uTexRes;",
        "uniform vec2 uMouse; uniform float uTime; uniform float uWarp; uniform float uReduced; uniform float uBlack;",
        "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }",
        "float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.-2.*f);",
        "  return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x), mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), f.x), f.y); }",
        "float fbm(vec2 p){ float v = 0.; float a = .5; for(int i=0;i<4;i++){ v += a*noise(p); p *= 2.03; a *= .5; } return v; }",
        "void main(){",
        "  vec2 frag = gl_FragCoord.xy; vec2 uv = frag / uRes; uv.y = 1. - uv.y;",
        "  float screenAspect = uRes.x / uRes.y; float texAspect = uTexRes.x / uTexRes.y;",
        "  vec2 cuv = uv - .5;",
        "  if (screenAspect > texAspect) { cuv.y *= texAspect / screenAspect; } else { cuv.x *= screenAspect / texAspect; }",
        "  cuv += .5;",
        "  vec2 mpx = vec2(uMouse.x, uMouse.y); float md = distance(frag * vec2(1.,-1.) + vec2(0., uRes.y), mpx);",
        "  float lens = smoothstep(300., 60., md);",
        "  float amp = uWarp * (1. + lens * 1.6);",
        "  float t = uTime * .05;",
        "  vec2 w = vec2(fbm(cuv * 3.4 + vec2(t * .21, t * .17)), fbm(cuv * 3.4 + vec2(5.2 - t * .19, 8.7 + t * .23)));",
        "  vec2 w2 = vec2(fbm(cuv * 7.1 + w * 1.4 + vec2(t * .11, -t * .13)), fbm(cuv * 7.1 + w * 1.4 + vec2(3.1 + t * .12, 1.7 + t * .1)));",
        "  vec2 wuv = cuv + (w2 - .5) * amp * (uReduced > .5 ? 0. : 1.);",
        "  // BLACK STARS — they emit darkness instead of light, and bend the stone",
        "  float dark = 0.; float rim = 0.;",
        "  for (int i = 0; i < 3; i++) {",
        "    float fi = float(i);",
        "    vec2 sp = vec2(.5) + vec2(sin(uTime*.041+fi*2.4)*.33 + sin(uTime*.013+fi*5.1)*.08, cos(uTime*.033+fi*1.7)*.27 + cos(uTime*.017+fi*3.3)*.07);",
        "    vec2 sd = uv - sp; sd.x *= screenAspect; float dd = max(length(sd), .0001);",
        "    float rr = .05 + .015*sin(uTime*(.5+fi*.13)+fi*2.1);",
        "    wuv += (sd/dd) * -(rr*rr*.5 / max(dd, rr*.7)) * uBlack;",
        "    float core = 1. - smoothstep(rr*.35, rr, dd);",
        "    float halo = 1. - smoothstep(rr, rr*3.4, dd);",
        "    dark += core + halo*halo*.34;",
        "    rim += smoothstep(rr*1.3, rr*1.02, dd) * smoothstep(rr*.75, rr*.98, dd);",
        "  }",
        "  vec3 col = texture2D(uTex, wuv).rgb;",
        "  float lum = dot(col, vec3(.299,.587,.114));",
        "  float lift = smoothstep(.26, .76, lum);",
        "  col = mix(col, vec3(1.0,.999,.995), lift * .985);",
        "  col = mix(vec3(.06,.06,.09), col, smoothstep(.0, .38, lum) * .25 + .75);",
        "  float veil = mix(.80, .42, lens);",
        "  col = mix(col, vec3(1.0,.999,.996), veil);",
        "  float dk = clamp(dark, 0., 1.) * uBlack;",
        "  col = mix(col, vec3(.06,.055,.09), dk*.93);",
        "  col = mix(col, vec3(.80,.62,.18), clamp(rim,0.,1.) * .14 * uBlack);",
        "  gl_FragColor = vec4(col, 1.);",
        "}"
      ].join("\n");
      const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, vsrc));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fsrc));
      gl.linkProgram(prog); gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const aloc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(aloc); gl.vertexAttribPointer(aloc, 2, gl.FLOAT, false, 0, 0);
      const uRes = gl.getUniformLocation(prog, "uRes"), uTime = gl.getUniformLocation(prog, "uTime"),
        uMouse = gl.getUniformLocation(prog, "uMouse"), uWarp = gl.getUniformLocation(prog, "uWarp"),
        uTexRes = gl.getUniformLocation(prog, "uTexRes"), uReduced = gl.getUniformLocation(prog, "uReduced"),
        uBlack = gl.getUniformLocation(prog, "uBlack");
      const tex = gl.createTexture();
      let texW = 768, texH = 1344, texReady = false;
      const img = new Image();
      img.onload = () => {
        texW = img.width; texH = img.height;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        texReady = true;
      };
      img.src = "/paradox-marble.jpg";
      const t0 = performance.now();
      const draw = () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const bw = Math.round(window.innerWidth * dpr), bh = Math.round(window.innerHeight * dpr);
        if (sc.width !== bw || sc.height !== bh) { sc.width = bw; sc.height = bh; gl.viewport(0, 0, bw, bh); }
        if (texReady) {
          mx += (tx - mx) * 0.06; my += (ty - my) * 0.06;
          gl.uniform2f(uRes, bw, bh);
          gl.uniform2f(uTexRes, texW, texH);
          gl.uniform2f(uMouse, mx * dpr, my * dpr);
          gl.uniform1f(uTime, reduced ? 0 : (performance.now() - t0) / 1000);
          gl.uniform1f(uWarp, 0.026);
          gl.uniform1f(uReduced, reduced ? 1 : 0);
          gl.uniform1f(uBlack, 1);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        raf1 = requestAnimationFrame(draw);
      };
      draw();
    }

    // ── layer 2: entities ──
    const x = c.getContext("2d");
    if (!reduced && x) {
      const INK = "#101018", GOLD = "#C98F12", GOLD_HI = "#F0B429";
      const level = 1.7;
      let W = 0, H = 0, t = 0;
      const size = () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        W = window.innerWidth; H = window.innerHeight;
        c.width = W * dpr; c.height = H * dpr;
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      size();
      window.addEventListener("resize", size);
      disposers.push(() => window.removeEventListener("resize", size));

      const wisps = [
        { bx: 0.10, by: 0.22, r: 300, s1: 0.00030, s2: 0.00046, ph: 0 },
        { bx: 0.90, by: 0.58, r: 380, s1: 0.00024, s2: 0.00037, ph: 2.1 },
        { bx: 0.28, by: 0.88, r: 280, s1: 0.00034, s2: 0.00027, ph: 4.4 },
        { bx: 0.62, by: 0.08, r: 240, s1: 0.00028, s2: 0.00040, ph: 1.2 },
      ];
      const watcher = { bx: 0.84, by: 0.15, r: 130, nextBlink: 300 + Math.random() * 500, blink: 0 };
      type Mote = { x: number; y: number; vx: number; vy: number; ph: number };
      const dust: Mote[] = [];
      for (let i = 0; i < 46; i++) dust.push({ x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight, vx: 0, vy: 0, ph: Math.random() * 6.28 });
      type Ripple = { x: number; y: number; r: number; a: number; v: number; life: number };
      const ripples: Ripple[] = [];
      const onDown = (e: PointerEvent) => {
        ripples.push({ x: e.clientX, y: e.clientY, r: 0, a: 0, v: 0, life: 0 });
        for (let k = 0; k < 8; k++) ripples.push({ x: e.clientX, y: e.clientY, r: -1, a: Math.random() * 6.28, v: 2 + Math.random() * 3, life: 0 });
      };
      window.addEventListener("pointerdown", onDown);
      disposers.push(() => window.removeEventListener("pointerdown", onDown));
      const breath = { t: 0, dur: 2400 };

      const tick = () => {
        t++;
        x.clearRect(0, 0, W, H);

        // the golden breath — a warm bloom traversing the void
        breath.t = (breath.t + 1) % breath.dur;
        const bp = breath.t / breath.dur;
        const bx2 = W * (-0.2 + bp * 1.4), by2 = H * (0.3 + Math.sin(bp * 6.28) * 0.2);
        const bg = x.createRadialGradient(bx2, by2, 0, bx2, by2, 420);
        bg.addColorStop(0, "rgba(240,180,41,0.05)");
        bg.addColorStop(1, "rgba(240,180,41,0)");
        x.fillStyle = bg; x.fillRect(bx2 - 420, by2 - 420, 840, 840);

        for (const w of wisps) {
          const wx = (w.bx + Math.sin(t * w.s1 * 60 + w.ph) * 0.06 + Math.sin(t * w.s2 * 60 + w.ph * 2) * 0.04) * W;
          const wy = (w.by + Math.cos(t * w.s2 * 60 + w.ph) * 0.06 + Math.sin(t * w.s1 * 60 + w.ph * 3) * 0.05) * H;
          const wr = w.r * (1 + Math.sin(t * 0.005 + w.ph) * 0.15);
          const g = x.createRadialGradient(wx, wy, 0, wx, wy, wr);
          g.addColorStop(0, "rgba(16,16,24," + 0.015 * level + ")");
          g.addColorStop(0.6, "rgba(16,16,24," + 0.007 * level + ")");
          g.addColorStop(1, "rgba(16,16,24,0)");
          x.fillStyle = g;
          x.fillRect(wx - wr, wy - wr, wr * 2, wr * 2);
        }

        // THE ALGORITHM — it watches, it blinks gold, it noticed
        const pxr = (tx / W - 0.5) * -34, pyr = (ty / H - 0.5) * -24;
        const vx2 = watcher.bx * W + pxr, vy2 = watcher.by * H + pyr;
        const vg = x.createRadialGradient(vx2, vy2, 0, vx2, vy2, watcher.r);
        vg.addColorStop(0, "rgba(16,16,24," + 0.12 * level + ")");
        vg.addColorStop(0.7, "rgba(16,16,24," + 0.05 * level + ")");
        vg.addColorStop(1, "rgba(16,16,24,0)");
        x.fillStyle = vg;
        x.fillRect(vx2 - watcher.r, vy2 - watcher.r, watcher.r * 2, watcher.r * 2);
        watcher.nextBlink--;
        if (watcher.nextBlink <= 0) { watcher.blink = 90; watcher.nextBlink = 500 + Math.random() * 800; }
        if (watcher.blink > 0) {
          watcher.blink--;
          const ba = Math.sin(((90 - watcher.blink) / 90) * Math.PI);
          x.globalAlpha = ba * 0.9;
          x.strokeStyle = GOLD_HI; x.lineWidth = 2.4; x.lineCap = "round";
          x.beginPath(); x.arc(vx2, vy2, 28, Math.PI * 0.15, Math.PI * 0.85); x.stroke();
          x.globalAlpha = ba * 0.7;
          x.fillStyle = GOLD;
          x.font = "600 10px ui-monospace, monospace";
          x.textAlign = "center";
          x.fillText("t h e   a l g o r i t h m   n o t i c e d", vx2, vy2 + 54);
          x.globalAlpha = 1;
        }

        // black drift — free, never fully still
        for (const m of dust) {
          m.ph += 0.012;
          m.vx += Math.sin(m.ph) * 0.005; m.vy += Math.cos(m.ph * 1.3) * 0.005;
          m.vx += (Math.random() - 0.5) * 0.05; m.vy += (Math.random() - 0.5) * 0.05;
          m.vx *= 0.96; m.vy *= 0.96;
          m.x = (m.x + m.vx + W) % W; m.y = (m.y + m.vy + H) % H;
          x.globalAlpha = 0.42 + Math.sin(m.ph * 2) * 0.3;
          x.fillStyle = INK;
          x.beginPath(); x.arc(m.x, m.y, 1.3, 0, 7); x.fill();
        }

        for (let r2 = ripples.length - 1; r2 >= 0; r2--) {
          const rp = ripples[r2];
          if (rp.r >= 0) {
            rp.r += 3.4;
            x.globalAlpha = Math.max(0, 0.42 - rp.r / 320);
            x.strokeStyle = INK; x.lineWidth = 1.7;
            x.beginPath(); x.arc(rp.x, rp.y, rp.r, 0, 7); x.stroke();
            if (rp.r > 310) ripples.splice(r2, 1);
          } else {
            rp.life++;
            const sx2 = rp.x + Math.cos(rp.a) * rp.v * rp.life;
            const sy2 = rp.y + Math.sin(rp.a) * rp.v * rp.life - rp.life * rp.life * 0.02;
            x.globalAlpha = Math.max(0, 1 - rp.life / 48);
            x.fillStyle = INK;
            x.beginPath(); x.arc(sx2, sy2, 1.6, 0, 7); x.fill();
            if (rp.life > 52) ripples.splice(r2, 1);
          }
        }
        x.globalAlpha = 1;
        raf2 = requestAnimationFrame(tick);
      };
      tick();
    }

    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); disposers.forEach((f) => f()); };
  }, []);
  return (
    <>
      <canvas ref={stoneRef} className="px-stone" aria-hidden="true" />
      <canvas ref={entRef} className="px-ent" aria-hidden="true" />
    </>
  );
}
