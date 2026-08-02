/* Web front-door layout — the non-Shopify shell around dashboard, studio and
 * archive. Same engine, no Polaris/App Bridge; styled to match the landing. */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { getWebIdentity } from "../lib/web-auth.server";
import { tokensRemainingLive, planTrialing } from "../lib/tokens.server";
import { resolveTierKey, PLAN_BY_KEY, TOKEN_COST } from "../lib/plan-config";
import { totalXpForLevel } from "../lib/achievements";

const EMPTY_HUD = {
  name: "", level: 1, xpInto: 0, xpNeed: 40, xpPct: 0,
  tokens: 0, tokensMax: 0, tokensPct: 0, videos: 0, ads: 0,
  planLabel: null as string | null,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const id = await getWebIdentity(request);
  if (!id) return json({ authed: false, hud: EMPTY_HUD });
  const { account, shop } = id;
  const plan = shop.activePlan;
  const tier = plan?.active ? resolveTierKey(plan.type) : null;
  // Wallet ceiling = the plan's monthly allowance + purchased top-ups (mirrors
  // the embedded app's HUD math in app.tsx).
  const tokensMax = plan?.active
    ? Math.max(1, (tier ? PLAN_BY_KEY[tier].monthlyTokens : plan.tokensIncluded) + plan.tokensExtra)
    : 0;
  const tokens = tokensRemainingLive(plan);
  // XP inside the current level, same curve the embedded app plots.
  const cur = totalXpForLevel(shop.level);
  const next = totalXpForLevel(shop.level + 1);
  const xpInto = Math.max(0, shop.xp - cur);
  const xpNeed = Math.max(1, next - cur);
  return json({
    authed: true,
    hud: {
      name: account.name?.trim() || account.email.split("@")[0],
      level: shop.level,
      xpInto,
      xpNeed,
      xpPct: Math.max(0, Math.min(100, Math.round((xpInto / xpNeed) * 100))),
      tokens,
      tokensMax,
      tokensPct: tokensMax > 0 ? Math.max(0, Math.min(100, Math.round((tokens / tokensMax) * 100))) : 0,
      videos: Math.floor(tokens / TOKEN_COST.video),
      ads: Math.floor(tokens / TOKEN_COST.image),
      planLabel: tier ? `${PLAN_BY_KEY[tier].name}${planTrialing(plan) ? " · Trial" : ""}` : null,
    },
  });
};

export default function WebLayout() {
  const { authed, hud } = useLoaderData<typeof loader>();
  const loc = useLocation();
  const tab = (p: string) => (loc.pathname === p ? "wb-tab on" : "wb-tab");

  // HUD collapse — remembered per browser, read after mount so SSR matches.
  const [hudMin, setHudMin] = useState(false);
  useEffect(() => { setHudMin(localStorage.getItem("wbHudMin") === "1"); }, []);
  const toggleHud = () => setHudMin((m) => { localStorage.setItem("wbHudMin", m ? "0" : "1"); return !m; });

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wb">
        <header className="wb-nav">
          <Link to="/" className="wb-brand">
            <Crest size={30} />
            <span>Easy<b>Mode</b></span>
          </Link>
          {authed && (
            <nav className="wb-tabs">
              <Link className={tab("/web")} to="/web">Dashboard</Link>
              <Link className={tab("/web/studio")} to="/web/studio">Studio</Link>
              <Link className={tab("/web/archive")} to="/web/archive">Archive</Link>
              <Link className={tab("/web/connect")} to="/web/connect">Auto-posting</Link>
            </nav>
          )}
          <div className="wb-me">
            {authed
              ? <Link to="/web/logout" className="wb-out">Log out</Link>
              : <Link to="/web/login" className="wb-login">Log in</Link>}
          </div>
        </header>

        {/* Player HUD — the app's arcade status bar, ported to the web shell.
            Level, token reserve, XP to the next level and what the wallet
            currently affords, all in one glance. */}
        {authed && (
          <div className={`wb-hud${hudMin ? " min" : ""}`} aria-label="Player status">
            {hudMin ? (
              <button
                type="button" className="wb-hud-mini" onClick={toggleHud}
                title={`LVL ${hud.level} · ${hud.tokens.toLocaleString()} tokens — tap to expand`}
                aria-label="Expand player status"
              >
                <Crest size={22} />
                <span className="wb-hud-lvl">LVL {hud.level}</span>
                <span className="wb-hud-mini-tok">🪙 {hud.tokens.toLocaleString()}</span>
                <span className="wb-hud-caret">▾</span>
              </button>
            ) : (
              <>
                <div className="wb-hud-top">
                  <Crest size={26} />
                  <span className="wb-hud-name">{hud.name}</span>
                  <span className="wb-hud-lvl" title="Your store's level — every level pays out free tokens">LVL {hud.level}</span>
                  {hud.planLabel
                    ? <Link to="/web#plans" className="wb-hud-plan" title="Manage your plan">{hud.planLabel}</Link>
                    : <Link to="/web#plans" className="wb-hud-plan off">No plan</Link>}
                  <button type="button" className="wb-hud-toggle" onClick={toggleHud} title="Collapse" aria-label="Collapse player status">▴</button>
                </div>

                <div className="wb-hud-barlabel"><span>Token reserve</span><span>{hud.tokens.toLocaleString()} / {hud.tokensMax.toLocaleString()}</span></div>
                <div className="wb-hud-hp" title={`${hud.tokensPct}% of your wallet remaining`}><i style={{ width: `${hud.tokensPct}%` }} /></div>

                <div className="wb-hud-barlabel">
                  <span>XP · Level {hud.level}</span>
                  <span>{hud.xpInto.toLocaleString()} / {hud.xpNeed.toLocaleString()} · {(hud.xpNeed - hud.xpInto).toLocaleString()} to LVL {hud.level + 1}</span>
                </div>
                <div className="wb-hud-xp" title={`${hud.xpPct}% of the way to level ${hud.level + 1}`}><i style={{ width: `${hud.xpPct}%` }} /></div>

                <div className="wb-hud-stats">
                  <Link to="/web#plans" className="wb-hud-topup" title="Get more tokens">
                    <span>🪙 {hud.tokens.toLocaleString()}</span><b>Add tokens</b>
                  </Link>
                  <span className="wb-hud-stat" title="Videos your balance affords">🎬 {hud.videos} Videos</span>
                  <span className="wb-hud-stat" title="Image ads your balance affords">🖼 {hud.ads} Images</span>
                </div>
              </>
            )}
          </div>
        )}

        <main className="wb-main">
          <Outlet />
        </main>
      </div>
    </>
  );
}

/* The EasyMode mark. The raw tile is deep green and reads as a dark blob on
 * cream, so it's set in a gold-rimmed crest and lifted — an emblem, not a
 * smudge. Same mark as the embedded app, legible on a light page. */
function Crest({ size }: { size: number }) {
  return (
    <span className="wb-crest" style={{ width: size, height: size }} aria-hidden="true">
      <img src="/easymode-head.png?v=2" alt="" />
    </span>
  );
}

const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600&display=swap");
*{box-sizing:border-box} html,body{margin:0;padding:0}
.wb{--paper:#F4F1E6;--card:#FDFCF7;--ink:#14201A;--ink2:#4A554E;--line:#E1DECD;--line2:#D7DCCB;--green:#0C7A46;--green2:#12A85E;--gold:#B08526;--gold-deep:#7E5E13;
  position:relative;min-height:100vh;color:var(--ink);font-family:Inter,-apple-system,sans-serif;
  /* A green field instead of flat cream: three soft washes give the page a
     direction to read down. There WAS a diagonal hairline hatch here too, but
     two crossing diagonals make diamonds, and diamonds at this scale read as
     reptile scales. The rosettes below carry the texture instead. */
  background:
    radial-gradient(72% 52% at 50% -8%,rgba(15,145,82,.14),transparent 62%),
    radial-gradient(46% 34% at 4% 24%,rgba(12,122,70,.09),transparent 66%),
    radial-gradient(54% 40% at 98% 64%,rgba(176,133,38,.075),transparent 68%),
    var(--paper);}
/* Two ambient rosettes drifting behind everything — the same figure the buffer
   spins, in the green cut so it reads as a watermark on cream rather than
   disappearing. Fixed, so they sit still while the page scrolls past. */
.wb::before,.wb::after{content:"";position:fixed;z-index:0;pointer-events:none;
  background-repeat:no-repeat;background-position:center;background-size:contain;}
.wb::before{top:-190px;right:-240px;width:660px;height:660px;opacity:.075;
  background-image:url(/gstyle-rosette-green.svg);animation:wbDrift 210s linear infinite;}
.wb::after{bottom:-290px;left:-270px;width:620px;height:620px;opacity:.05;
  background-image:url(/gstyle-rosette-green.svg);animation:wbDriftBack 260s linear infinite;}
@keyframes wbDrift{to{transform:rotate(360deg)}}
@keyframes wbDriftBack{to{transform:rotate(-360deg)}}
@media (prefers-reduced-motion:reduce){.wb::before,.wb::after{animation:none}}
/* Everything real sits above the ambient layer. */
.wb-nav,.wb-hud,.wb-main{position:relative;z-index:1;}
.wb-nav{display:flex;align-items:center;justify-content:space-between;gap:18px;max-width:1080px;margin:0 auto;padding:18px 24px;flex-wrap:wrap;}
.wb-brand{display:flex;align-items:center;gap:8px;font-family:Poppins,sans-serif;font-weight:800;font-size:18px;color:var(--ink);text-decoration:none;}
.wb-brand b{color:var(--gold)}
.wb-tabs{display:flex;gap:6px;}
.wb-tab{padding:8px 16px;border-radius:11px;text-decoration:none;font-weight:700;font-size:13.5px;color:var(--ink2);}
.wb-tab.on{background:var(--card);border:1px solid var(--line);color:var(--ink);box-shadow:0 2px 6px rgba(20,32,26,.06);}
.wb-me{display:flex;align-items:center;gap:12px;}
.wb-out{font-size:13px;color:var(--ink2);text-decoration:none;font-weight:600;padding:8px 12px;border-radius:10px;}
.wb-out:hover{color:var(--ink);background:rgba(20,32,26,.05);}
/* Logged-out "Log in" is a real target, not stray text floating in the bar. */
.wb-login{font-family:Poppins,sans-serif;font-weight:800;font-size:13px;text-decoration:none;color:var(--ink);
  padding:9px 18px;border-radius:11px;background:var(--card);border:1px solid var(--line);box-shadow:0 2px 6px rgba(20,32,26,.06);}
.wb-login:hover{border-color:var(--green2);color:var(--green);}
/* The mark: gold-rimmed crest so the deep-green tile reads as an emblem
   against cream instead of a dark smudge. */
.wb-crest{position:relative;flex:0 0 auto;display:inline-grid;place-items:center;border-radius:8px;overflow:hidden;
  border:1.5px solid rgba(199,158,63,.75);box-shadow:0 1px 3px rgba(20,32,26,.18),0 0 0 2px rgba(231,200,121,.16);}
.wb-crest img{width:100%;height:100%;object-fit:cover;display:block;image-rendering:pixelated;filter:brightness(1.16) saturate(1.06);}
.wb-crest::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:linear-gradient(150deg,rgba(255,255,255,.24),transparent 52%);}
.wb-main{max-width:1080px;margin:0 auto;padding:10px 24px 70px;}

/* ---- Player HUD — the app's arcade status bar, GStyle for the web shell ---- */
.wb-hud{width:min(1080px,100% - 48px);margin:0 auto 6px;padding:13px 16px;border-radius:16px;position:relative;overflow:hidden;isolation:isolate;
  background:linear-gradient(168deg,#FDFCF7,#F2EEE0);border:1px solid var(--line);
  /* Gold hairline inside the border, the way the app rules its status card. */
  box-shadow:0 3px 12px rgba(20,32,26,.07),inset 0 0 0 1px rgba(231,200,121,.3),inset 0 1px 0 rgba(255,255,255,.7);}
/* The HUD gets the gold cut of the rosette bleeding off its right edge —
   this is the app's Autopilot card treatment, brought over. */
.wb-hud:not(.min)::after{content:"";position:absolute;z-index:-1;top:50%;right:-72px;width:238px;height:238px;margin-top:-119px;
  background:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.16;pointer-events:none;
  animation:wbDrift 150s linear infinite;}
.wb-hud.min{padding:0;background:none;border:0;box-shadow:none;overflow:visible;}
.wb-hud-mini{display:inline-flex;align-items:center;gap:9px;cursor:pointer;padding:7px 14px;border-radius:999px;
  background:linear-gradient(168deg,#FDFCF7,#F2EEE0);border:1px solid var(--line);box-shadow:0 3px 12px rgba(20,32,26,.07);font:inherit;}
.wb-hud-mini-tok{font-weight:800;font-size:12.5px;color:var(--gold-deep);}
.wb-hud-caret{font-size:10px;color:var(--ink2);}
.wb-hud-top{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:9px;}
.wb-hud-name{font-family:Poppins,sans-serif;font-weight:800;font-size:14px;color:var(--ink);
  max-width:44vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.wb-hud-lvl{font-family:Poppins,sans-serif;font-weight:800;font-size:11.5px;letter-spacing:.05em;color:#3A2A05;
  padding:4px 11px;border-radius:999px;background:linear-gradient(168deg,#F3D98C,#D8AE41);border:1px solid rgba(140,105,25,.35);}
.wb-hud-plan{font-family:Poppins,sans-serif;font-weight:800;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;
  color:#fff;text-decoration:none;padding:5px 13px;border-radius:999px;background:linear-gradient(168deg,#12A85E,#0B6B3E);
  box-shadow:0 2px 8px rgba(12,122,70,.26);}
.wb-hud-plan.off{background:#DED9C7;color:#5A5347;box-shadow:none;}
.wb-hud-plan:hover{filter:brightness(1.07)}
.wb-hud-toggle{margin-left:auto;border:1px solid var(--line);background:var(--card);color:var(--ink2);
  width:26px;height:26px;border-radius:8px;cursor:pointer;font-size:11px;line-height:1;}
.wb-hud-toggle:hover{color:var(--ink);border-color:var(--green2);}
.wb-hud-barlabel{display:flex;justify-content:space-between;gap:10px;font-size:10.5px;font-weight:700;letter-spacing:.06em;
  text-transform:uppercase;color:var(--ink2);margin:8px 0 4px;}
.wb-hud-barlabel span:last-child{color:var(--ink);letter-spacing:.02em;text-transform:none;font-variant-numeric:tabular-nums;}
.wb-hud-hp,.wb-hud-xp{height:9px;border-radius:99px;background:#E6E1D0;overflow:hidden;border:1px solid rgba(20,32,26,.07);}
.wb-hud-hp>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#0C7A46,#3FD186);transition:width .5s ease;}
.wb-hud-xp>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#B08526,#F3D98C);transition:width .5s ease;}
.wb-hud-stats{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:11px;font-size:12px;font-weight:700;color:var(--ink2);}
.wb-hud-topup{display:inline-flex;align-items:center;gap:8px;text-decoration:none;padding:5px 6px 5px 11px;border-radius:999px;
  background:var(--card);border:1px solid var(--line);color:var(--gold-deep);font-weight:800;}
.wb-hud-topup b{font-size:11.5px;color:#fff;background:linear-gradient(168deg,#12A85E,#0B6B3E);padding:5px 11px;border-radius:999px;}
.wb-hud-topup:hover b{filter:brightness(1.07)}
.wb-hud-stat{white-space:nowrap;}

/* ---- Mobile header: nothing wraps into a second line of tabs, nothing
        overflows the viewport. The tab strip scrolls sideways instead. ---- */
@media(max-width:760px){
  .wb-nav{padding:12px 16px;gap:10px;}
  .wb-brand{font-size:16px;gap:7px;}
  .wb-tabs{order:3;flex:1 0 100%;gap:5px;overflow-x:auto;scrollbar-width:none;
    -webkit-overflow-scrolling:touch;padding-bottom:2px;margin-top:2px;}
  .wb-tabs::-webkit-scrollbar{display:none}
  .wb-tab{flex:0 0 auto;white-space:nowrap;padding:7px 13px;font-size:12.5px;}
  .wb-me{margin-left:auto;gap:8px;}
  .wb-out{padding:7px 10px;font-size:12.5px;}
  .wb-login{padding:8px 15px;font-size:12.5px;}
  .wb-main{padding:10px 16px 70px;}
  .wb-hud{width:calc(100% - 32px);padding:11px 13px;}
  .wb-hud-name{max-width:38vw;font-size:13px;}
  .wb-hud-barlabel{font-size:9.5px;}
  .wb-hud-barlabel span:last-child{font-size:10.5px;}
  .wb-hud-stats{font-size:11.5px;gap:8px;}
}
.wb-h1{font-family:Poppins,sans-serif;font-weight:800;font-size:clamp(24px,4vw,34px);letter-spacing:-.02em;margin:14px 0 6px;}
.wb-sub{color:var(--ink2);font-size:14.5px;line-height:1.55;margin:0 0 24px;max-width:60ch;}
/* Cards were flat white inside a flat cream border. Now they carry a faint
   top-to-bottom warmth, a greener border line, and a hairline of white along
   the top edge — the thing that makes a panel read as a raised surface rather
   than a rectangle drawn on the page. */
.wb-card{background:linear-gradient(178deg,#FEFDF9,#F7F6EB);border:1px solid var(--line2);border-radius:18px;padding:22px;
  box-shadow:0 3px 12px rgba(20,32,26,.06),inset 0 1px 0 rgba(255,255,255,.8);}
.wb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;}
.wb-lbl{display:block;font-weight:700;font-size:12.5px;margin:14px 0 5px;color:var(--ink);}
.wb-in,.wb-sel,.wb-ta{width:100%;padding:11px 13px;border-radius:11px;border:1px solid var(--line);background:#fff;font:inherit;font-size:14px;color:var(--ink);}
.wb-ta{min-height:76px;resize:vertical}
/* Green buttons get the app's treatment: a gold hairline ruled inside the
   edge, and the engine-turned rosette turning slowly behind the label where it
   bleeds off the right. isolation + z-index:-1 keeps the rosette above the
   button's own gradient but under the text. */
.wb-btn{position:relative;isolation:isolate;overflow:hidden;display:inline-block;border:0;cursor:pointer;text-decoration:none;text-align:center;
  font-family:Poppins,sans-serif;font-weight:800;font-size:14px;color:#fff;padding:12px 24px;border-radius:12px;
  /* The right side darkens toward the rosette. In the app the rosette sits on
     a DARK green card, which is the only reason thin gold lines read as gold —
     on flat bright #12A85E the same gold has no contrast and turns into pale
     green scribble. This recreates the dark field locally. */
  background:
    linear-gradient(100deg,#12A85E 38%,#0A6A3D 78%,#075530),
    linear-gradient(165deg,#12A85E,#0B6B3E);
  box-shadow:0 4px 12px rgba(12,122,70,.28),inset 0 0 0 1px rgba(231,200,121,.34);}
/* ---- The gold rule, applied to EVERY green surface in one place ----
   This started as a .wb-btn-only treatment, which meant every other green
   button on the site (Studio tabs, Archive actions, the plans toggle) shipped
   bare and had to be chased down one at a time. Anything with the green
   gradient goes in these selector lists — that's the rule now. */
.ws-tab.on,.wa-vbtn,.wd-toggle button.on{position:relative;isolation:isolate;overflow:hidden;}
.wb-btn::before,.ws-tab.on::before,.wa-vbtn::before,.wd-toggle button.on::before{
  content:"";position:absolute;inset:4px;border:1px solid rgba(255,210,74,.42);border-radius:8px;pointer-events:none;}
/* The rosette is MASKED rather than drawn: the SVG's own stroke colour is
   fixed, and masking lets the gold be picked per surface. Pushed far enough
   right that its hollow centre clears the edge — parked closer in, the centre
   reads as a dark smudge on the button instead of etching. */
.wb-btn::after,.ws-tab.on::after,.wa-vbtn::after,.wd-toggle button.on::after{
  content:"";position:absolute;z-index:-1;top:50%;pointer-events:none;background:#FFD24A;
  -webkit-mask-image:url(/gstyle-rosette.svg);-webkit-mask-size:contain;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;
  mask-image:url(/gstyle-rosette.svg);mask-size:contain;mask-position:center;mask-repeat:no-repeat;
  animation:wbDrift 60s linear infinite;}
/* Wide CTAs carry the full medallion. */
.wb-btn::after{right:-96px;width:158px;height:158px;margin-top:-79px;opacity:.6;}
/* Compact buttons get a smaller one held further out, so it stays a corner
   flourish and never crosses a short label like "Video". */
.ws-tab.on::after,.wa-vbtn::after,.wd-toggle button.on::after{
  right:-74px;width:112px;height:112px;margin-top:-56px;opacity:.5;}
/* Scoped through .wb-main so this beats the child routes' own background
   declarations on specificity — child route <style> blocks render AFTER this
   one, so an equal-specificity rule here would silently lose. */
.wb-main .ws-tab.on,.wb-main .wa-vbtn,.wb-main .wd-toggle button.on{
  background:
    linear-gradient(100deg,#12A85E 58%,#0B7443 86%,#095F36),
    linear-gradient(165deg,#12A85E,#0B6B3E);}
/* Pill-shaped buttons need the inner rule to follow the pill, not a rounded
   rectangle sitting inside it. */
.wd-toggle button.on::before{inset:3px;border-radius:999px;}
.ws-tab.on::before{border-radius:9px;}
@media (prefers-reduced-motion:reduce){.ws-tab.on::after,.wa-vbtn::after,.wd-toggle button.on::after{animation:none}}
.wb-btn:hover{filter:brightness(1.06)}
/* Ghost + disabled buttons aren't gold-rule surfaces — strip the treatment. */
.wb-btn.ghost::before,.wb-btn.ghost::after{display:none}
.wb-btn[disabled]::after{opacity:.14}
@media (prefers-reduced-motion:reduce){.wb-btn::after{animation:none}}
.wb-btn.gold{background:linear-gradient(165deg,#C98F12,#8a6207);box-shadow:0 4px 12px rgba(176,133,38,.3);}
.wb-btn.ghost{background:#fff;color:var(--ink);border:1px solid var(--line);box-shadow:none;}
.wb-btn[disabled]{opacity:.5;cursor:not-allowed}
.wb-err{margin:14px 0;padding:12px 16px;border-radius:12px;background:#FBEDEA;border:1px solid #E8C4BC;color:#7A2E1D;font-size:13.5px;}
.wb-ok{margin:14px 0;padding:12px 16px;border-radius:12px;background:#EAF6EF;border:1px solid #BFE2CD;color:#0A3D26;font-size:13.5px;}
.wb-note{font-size:12.5px;color:var(--ink2);}
.wb-price-name{font-family:Poppins,sans-serif;font-weight:800;font-size:16px;}
.wb-price-amt{font-family:Poppins,sans-serif;font-weight:800;font-size:30px;color:var(--green);margin:4px 0;}
.wb-price-amt small{font-size:13px;color:var(--ink2);font-weight:600;}
.wb-feats{list-style:none;margin:12px 0 16px;padding:0;display:flex;flex-direction:column;gap:7px;}
.wb-feats li{position:relative;padding-left:22px;font-size:13px;color:var(--ink2);line-height:1.4;}
.wb-feats li::before{content:"✓";position:absolute;left:0;color:var(--green2);font-weight:900;}
.wb-assets{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;}
.wb-asset{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;}
/* Tiles are PORTRAIT, because the content is. A fixed 220px-tall box is
 * landscape once a card goes full-width on a phone, and cover-cropping a 9:16
 * video into it threw away two thirds of the frame — you got a mouth and a
 * beard. At 4/5 the same video keeps ~70% of its height, and square ad images
 * keep 80% of their width, while every tile stays the same shape so the grid
 * doesn't go ragged. Cooking tiles and posters below match it exactly. */
.wb-asset video,.wb-asset img{width:100%;aspect-ratio:4/5;height:auto;object-fit:cover;display:block;background:#0b0f0d;}
/* Cooking tiles — live render placeholders with shimmer + ETA. */
.wb-cookimg{position:relative;aspect-ratio:4/5;height:auto;background-color:#101612;background-size:cover;background-position:center;display:grid;place-items:center;overflow:hidden;}
.wb-cookimg::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 32%,rgba(255,255,255,.13) 50%,transparent 68%);animation:wbShimmer 1.7s linear infinite;}
@keyframes wbShimmer{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
.wb-bufwrap{position:relative;z-index:1;display:grid;place-items:center;gap:9px;}
/* GStyle buffer: the actual engine-turned rosette the embedded app spins in its
 * Autopilot card — the same hypotrochoid geometry, served from
 * /gstyle-rosette.svg. Conic gradients can only fake radial spokes; this figure
 * is built from overlapping petal loops, and that's what gives it the guilloche
 * shimmer. Nothing approximates it, so we reuse the real curve. */
.wb-bufwrap::before{content:"";position:absolute;width:210px;height:210px;border-radius:50%;pointer-events:none;
  background:radial-gradient(circle,rgba(6,10,8,.88),rgba(6,10,8,.66) 34%,rgba(6,10,8,.3) 54%,transparent 72%);}
.wb-spin{position:relative;z-index:1;width:104px;height:104px;display:block;
  background:url(/gstyle-rosette.svg) center / contain no-repeat;
  animation:wbRot 13s linear infinite;
  filter:drop-shadow(0 0 10px rgba(255,210,74,.3));}
/* A gold bead orbits the rim: the rosette turns too gracefully to signal
   activity on its own, and merchants need to see that it's still working. */
.wb-spin::after{content:"";position:absolute;inset:2px;border-radius:50%;animation:wbRot 1.7s linear infinite;
  background:radial-gradient(circle 3.5px at 50% 2%,#FFF6DA,rgba(255,210,74,.95) 45%,transparent 68%);}
@keyframes wbRot{to{transform:rotate(360deg)}}
.wb-eta{color:#fff;font-weight:800;font-size:12.5px;letter-spacing:.02em;text-shadow:0 1px 8px rgba(0,0,0,.6);}
.wb-failbadge{position:relative;z-index:1;font-size:30px;color:#E9897B;font-weight:800;}
@media (prefers-reduced-motion: reduce){.wb-cookimg::after{animation:none}.wb-spin,.wb-spin::before,.wb-spin::after{animation:none}}
.wb-asset .m{padding:10px 12px;font-size:13px;font-weight:600;}
.wb-asset .s{font-size:11.5px;color:var(--ink2);font-weight:500;}
.wb-auth{max-width:420px;margin:40px auto;}

/* ---- Web Studio: the embedded-app experience, GStyle ---- */
/* Centred: three equal choices read as a set, and left-hanging them under a
   centred page title left a lopsided gap on every width. */
.ws-tabs{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;margin:4px 0 16px;}
.ws-tab{display:inline-flex;align-items:center;gap:7px;padding:10px 20px;border-radius:12px;border:1px solid var(--line);background:var(--card);
  font-family:Poppins,sans-serif;font-weight:700;font-size:13.5px;color:var(--ink2);cursor:pointer;}
.ws-tab.on{background:linear-gradient(165deg,#12A85E,#0B6B3E);border-color:transparent;color:#fff;box-shadow:0 4px 12px rgba(12,122,70,.25);}
/* Line art, not emoji — inherits the tab's colour so it flips white on select. */
.ws-tabi{flex:none;opacity:.62;}
.ws-tab.on .ws-tabi{opacity:1;}
/* The Studio form is the longest card on the site, so it gets its own drifting
   rosette in the bottom corner to break up the field behind the controls. */
.ws-card{overflow:hidden;position:relative;isolation:isolate;}
.ws-card::after{content:"";position:absolute;z-index:-1;bottom:-290px;right:-250px;width:520px;height:520px;
  background:url(/gstyle-rosette-green.svg) center/contain no-repeat;opacity:.085;pointer-events:none;
  animation:wbDrift 240s linear infinite;}
@media (prefers-reduced-motion:reduce){.wb-hud::after,.ws-card::after{animation:none}}
.ws-lbl{display:flex;align-items:baseline;gap:8px;font-family:Poppins,sans-serif;font-weight:700;font-size:13px;color:var(--ink);margin:16px 0 8px;}
.ws-lbl:first-child{margin-top:0}
.ws-opt{font-family:Inter,sans-serif;font-weight:500;font-size:11px;color:var(--ink2);}
.ws-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;}
/* minmax(0,…) not minmax(220px,…): a hard 220px floor on two columns needs
 * 454px of room, which a phone doesn't have — the first card got clipped. */
.ws-tiles.two{grid-template-columns:repeat(2,minmax(0,300px));justify-content:center;}
.ws-tiles.styles{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));}
.ws-tile{position:relative;text-align:left;border:1px solid var(--line);border-radius:16px;background:#fff;padding:0 0 12px;
  cursor:pointer;transition:transform .12s,border-color .12s,box-shadow .12s;overflow:hidden;}
.ws-tile:hover{transform:translateY(-3px);border-color:var(--green2);box-shadow:0 12px 30px rgba(12,122,70,.14);}
.ws-tile.sel{border-color:#12A85E;box-shadow:0 0 0 1px #12A85E,0 8px 22px rgba(12,122,70,.16);}
.ws-tile b{display:block;padding:10px 12px 0;font-family:Poppins,sans-serif;font-size:13.5px;color:var(--ink);}
.ws-tile-sub{display:block;padding:3px 12px 0;font-size:11.5px;color:var(--ink2);line-height:1.4;}
/* Every picker card shares the tall square art treatment — the art IS the
 * pitch, so no card gets a cropped little strip. */
.ws-tile-img{position:relative;display:block;height:auto;aspect-ratio:1/1;background-size:cover;background-position:center 25%;}
.ws-tiles.fmt{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;}
.ws-tile.fmt .ws-tile-img{background-position:center;}
.ws-tile.fmt b,.ws-tile b{font-size:14px;}
/* Expanded format library: contained, smooth-scrolling, staggered reveal —
 * the page never becomes a mile-long scroll. */
.ws-fmtbox{max-height:64vh;overflow-y:auto;overscroll-behavior:contain;scroll-behavior:smooth;padding:4px 16px 46px 4px;scrollbar-gutter:stable;
  -webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 44px),transparent);mask-image:linear-gradient(180deg,#000 calc(100% - 44px),transparent);}
.ws-fmtbox::-webkit-scrollbar{width:9px}
.ws-fmtbox::-webkit-scrollbar-thumb{background:#BFDCCB;border-radius:99px}
.ws-fmtbox::-webkit-scrollbar-thumb:hover{background:#9CCBB1}
.ws-fmtbox::-webkit-scrollbar-track{background:transparent}
@keyframes wsFadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.ws-fmtbox .ws-tile{animation:wsFadeUp .45s ease both}
@media (prefers-reduced-motion: reduce){.ws-fmtbox .ws-tile{animation:none}}
.ws-tile.lockd .ws-tile-img{filter:saturate(.35) brightness(.72);}
/* Post-generate celebration — same energy as the embedded app's modal. */
.ws-scrim{position:fixed;inset:0;z-index:10500;background:rgba(12,18,14,.55);backdrop-filter:blur(3px);
  display:grid;place-items:center;padding:24px;}
.ws-modal{position:relative;overflow:hidden;background:var(--card);border:1px solid var(--line);border-radius:22px;
  padding:34px 30px 26px;max-width:400px;width:100%;text-align:center;box-shadow:0 24px 70px rgba(10,20,14,.45);
  animation:wsPop .35s cubic-bezier(.2,1.4,.4,1) both;}
@keyframes wsPop{from{opacity:0;transform:scale(.86) translateY(14px)}to{opacity:1;transform:none}}
/* Sits high, so it fans out behind the crest rather than under the copy. */
.ws-mrose{position:absolute;top:-172px;left:50%;width:340px;height:340px;margin-left:-170px;pointer-events:none;
  background:url(/gstyle-rosette-green.svg) center/contain no-repeat;opacity:.15;
  animation:wsSpin 40s linear infinite;}
@keyframes wsSpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.ws-mrose{animation:none}.ws-modal{animation:none}}
.ws-mi{position:relative;font-size:44px;margin-bottom:6px;}
/* ---- EasyMode flex: the brand lockup that fronts the celebration ---- */
.ws-flex{position:relative;display:flex;flex-direction:column;align-items:center;gap:9px;margin-bottom:14px;}
.ws-flex-crest{position:relative;width:56px;height:56px;border-radius:15px;overflow:hidden;display:grid;place-items:center;
  border:1.5px solid rgba(199,158,63,.85);
  box-shadow:0 4px 14px rgba(20,32,26,.22),0 0 0 4px rgba(231,200,121,.16),0 0 22px rgba(255,210,74,.3);
  animation:wsFlexIn .5s cubic-bezier(.2,1.5,.4,1) both;}
.ws-flex-crest img{width:100%;height:100%;object-fit:cover;display:block;image-rendering:pixelated;filter:brightness(1.16) saturate(1.06);}
.ws-flex-crest::after{content:"";position:absolute;inset:0;border-radius:inherit;
  background:linear-gradient(150deg,rgba(255,255,255,.28),transparent 52%);}
.ws-flex-word{font-family:Poppins,sans-serif;font-weight:800;font-size:25px;letter-spacing:-.02em;line-height:1;color:var(--ink);
  animation:wsFlexIn .5s .07s cubic-bezier(.2,1.5,.4,1) both;}
/* Gold on "Mode" — the same split the wordmark uses everywhere else, just
   turned up to a proper metallic gradient for the celebration. */
.ws-flex-word b{background:linear-gradient(100deg,#B08526,#F3D98C 45%,#B08526);-webkit-background-clip:text;background-clip:text;color:transparent;}
.ws-flex-rule{display:block;width:74px;height:2px;border-radius:2px;
  background:linear-gradient(90deg,transparent,rgba(199,158,63,.95),transparent);
  animation:wsFlexIn .5s .14s cubic-bezier(.2,1.5,.4,1) both;}
@keyframes wsFlexIn{from{opacity:0;transform:translateY(10px) scale(.9)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.ws-flex-crest,.ws-flex-word,.ws-flex-rule{animation:none}}
.ws-mh{position:relative;display:block;font-family:Poppins,sans-serif;font-weight:800;font-size:20px;color:var(--ink);}
.ws-mp{position:relative;color:var(--ink2);font-size:13.5px;line-height:1.55;margin:8px 0 18px;}
.ws-mcta{position:relative;display:block;width:100%;}
.ws-mclose{position:relative;margin-top:10px;background:none;border:0;cursor:pointer;font-weight:700;font-size:13px;color:var(--ink2);}
.ws-mclose:hover{color:var(--ink)}
.ws-tile.lockd:hover .ws-tile-img{filter:saturate(.6) brightness(.85);}
.ws-lock{position:absolute;top:8px;right:8px;padding:3px 9px;border-radius:999px;font-size:10.5px;font-weight:800;
  color:#fff;background:rgba(10,14,12,.78);border:1px solid rgba(255,255,255,.35);}
.ws-chk{position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;
  background:#12A85E;color:#fff;font-size:12px;font-weight:900;box-shadow:0 2px 6px rgba(0,0,0,.3);}
.ws-back{border:0;background:none;color:var(--green);font-weight:700;font-size:13px;cursor:pointer;padding:0;margin-bottom:6px;}
.ws-note{font-size:13px;color:var(--ink2);background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:11px 14px;margin:8px 0;}
.ws-cast{display:flex;gap:10px;overflow-x:auto;padding:4px 2px 12px;scrollbar-gutter:stable;}
.ws-face{flex:0 0 auto;width:76px;border:0;background:none;cursor:pointer;text-align:center;font-size:11px;color:var(--ink2);font-weight:600;}
.ws-face-img{position:relative;display:block;width:68px;height:68px;margin:0 auto 5px;border-radius:50%;background-size:cover;background-position:center 20%;
  border:2px solid var(--line);}
.ws-face-img.none{display:grid;place-items:center;font-size:18px;color:var(--ink2);background:var(--paper);}
.ws-face.sel .ws-face-img{border-color:#12A85E;box-shadow:0 0 0 2px rgba(18,168,94,.25);}
.ws-face-img b{position:absolute;bottom:-2px;right:-2px;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;
  background:#12A85E;color:#fff;font-size:11px;}
.ws-engines{display:flex;gap:8px;flex-wrap:wrap;}
.ws-engine{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:8px 13px;border-radius:11px;cursor:pointer;
  border:1px solid var(--line);background:#fff;}
.ws-engine b{font-size:12px;color:var(--ink);}
.ws-engine span{font-size:10px;color:var(--ink2);}
.ws-engine.sel{border-color:#12A85E;box-shadow:0 0 0 1px #12A85E;}
.ws-commercial{display:flex;align-items:center;gap:10px;margin:14px 0 2px;padding:11px 14px;border-radius:12px;
  border:1px solid var(--line);background:#fff;font-size:12.5px;color:var(--ink2);cursor:pointer;line-height:1.45;}
.ws-commercial input{accent-color:#12A85E;width:16px;height:16px;flex:0 0 auto;}
.ws-commercial b{color:var(--ink);}
.ws-upsell{margin-top:14px;padding:16px;border-radius:14px;background:var(--paper);border:1px solid var(--line);text-align:center;}
/* Trial cap escape hatch. Sits under the red spend error, so it reads as the
   answer to it rather than another upsell. */
.ws-trialout{margin-top:10px;padding:14px 16px;border-radius:14px;
  background:linear-gradient(168deg,#FBF4E2,#F5ECD4);border:1px solid rgba(176,133,38,.42);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.7);}
.ws-trialout b{display:block;font-family:Poppins,sans-serif;font-size:14px;color:#3A2A05;margin-bottom:4px;}
.ws-trialout p{margin:0 0 11px;font-size:12.5px;line-height:1.5;color:#6B5312;}

/* Catalogue import, in progress. Dark green panel on purpose: the gold cut of
   the rosette is invisible on cream, and this is the one place we badly need
   "it's alive" to read at a glance. */
.ws-catload{display:flex;align-items:center;gap:15px;margin-top:12px;padding:15px 17px;border-radius:16px;color:#EAF4EE;
  background:linear-gradient(160deg,#0E5233,#0A3421 58%,#072617);
  border:1px solid rgba(231,200,121,.34);box-shadow:0 12px 30px rgba(8,42,26,.28),inset 0 0 0 1px rgba(231,200,121,.16);}
.ws-catload-spin{flex:0 0 auto;width:52px;height:52px;display:block;
  background:url(/gstyle-rosette.svg) center/contain no-repeat;
  animation:wbRot 13s linear infinite;filter:drop-shadow(0 0 8px rgba(255,210,74,.32));}
.ws-catload-txt{min-width:0;display:flex;flex-direction:column;gap:3px;}
.ws-catload-txt b{font-family:Poppins,sans-serif;font-size:14px;color:#F4EAC8;}
.ws-catload-txt span{font-size:12.5px;color:rgba(220,240,225,.85);font-variant-numeric:tabular-nums;}
.ws-catload-txt i{font-style:normal;font-size:11.5px;color:rgba(220,240,225,.6);}
@media (prefers-reduced-motion:reduce){.ws-catload-spin{animation:none}}
@media(max-width:620px){
  .ws-catload{gap:12px;padding:13px 14px;}
  .ws-catload-spin{width:44px;height:44px;}
  .ws-catload-txt b{font-size:13.5px;}
  .ws-catload-txt span{font-size:12px;}
}

/* ---- Catalogue picker: the merchant's own storefront, mirrored ---- */
.ws-catsearch{margin-bottom:10px;}
.ws-catgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px;max-height:340px;overflow-y:auto;
  overscroll-behavior:contain;padding:2px 15px 26px 2px;scrollbar-gutter:stable;
  -webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 26px),transparent);mask-image:linear-gradient(180deg,#000 calc(100% - 26px),transparent);}
.ws-catgrid::-webkit-scrollbar{width:8px}
.ws-catgrid::-webkit-scrollbar-thumb{background:#BFDCCB;border-radius:99px}
.ws-cat{position:relative;text-align:left;border:1px solid var(--line2);border-radius:13px;background:#fff;padding:0 0 8px;
  cursor:pointer;overflow:hidden;transition:transform .12s,border-color .12s,box-shadow .12s;font:inherit;color:inherit;}
.ws-cat:hover{transform:translateY(-2px);border-color:var(--green2);box-shadow:0 8px 20px rgba(12,122,70,.12);}
.ws-cat.sel{border-color:#12A85E;box-shadow:0 0 0 1px #12A85E,0 6px 16px rgba(12,122,70,.16);}
.ws-cat-img{position:relative;display:grid;place-items:center;aspect-ratio:1/1;background:#F2F0E6 center/cover no-repeat;font-size:22px;color:#B6B0A0;}
.ws-cat b{display:block;padding:7px 9px 0;font-family:Inter,sans-serif;font-weight:600;font-size:11.5px;line-height:1.3;color:var(--ink);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.ws-cat-p{display:block;padding:2px 9px 0;font-size:11px;font-weight:700;color:var(--gold-deep);}
.ws-catfoot{display:flex;justify-content:flex-end;margin:-14px 0 4px;}
/* First run: no catalogue yet, so sell the idea before asking for the URL. */
.ws-connect{border:1px dashed rgba(176,133,38,.55);border-radius:14px;padding:15px 16px;background:rgba(231,200,121,.08);}
.ws-connect b{display:block;font-family:Poppins,sans-serif;font-size:14px;color:var(--ink);margin-bottom:5px;}
.ws-connect p{margin:0 0 11px;font-size:12.5px;line-height:1.5;color:var(--ink2);}
@media(max-width:620px){
  .ws-catgrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;max-height:300px;}
  .ws-cat b{font-size:10.5px;padding:6px 7px 0;}
  .ws-cat-p{font-size:10px;padding:1px 7px 0;}
}
/* Numbered step heads — the rule above each one is what actually segregates
   the form; the badge tells you how far in you are. */
.ws-stephead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:26px 0 14px;padding-top:20px;border-top:1px solid var(--line2);}
.ws-stephead:first-child{margin-top:4px;padding-top:0;border-top:0;}
.ws-stepn{flex:0 0 auto;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;
  font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:#3A2A05;line-height:1;
  background:linear-gradient(168deg,#F3D98C,#D8AE41);border:1px solid rgba(140,105,25,.38);box-shadow:0 2px 6px rgba(140,105,25,.22);}
.ws-stephead b{font-family:Poppins,sans-serif;font-size:15.5px;color:var(--ink);letter-spacing:-.01em;}
.ws-stephint{font-size:11.5px;color:var(--ink2);font-weight:500;margin-left:auto;text-align:right;}
@media(max-width:620px){
  .ws-stephead{gap:8px;margin:20px 0 11px;padding-top:16px;}
  .ws-stephead b{font-size:14.5px;}
  .ws-stephint{flex:1 0 100%;margin-left:36px;text-align:left;}
}
.ws-offernote{font-size:11.5px;line-height:1.5;color:var(--ink2);margin:6px 0 2px;}
/* Size picker wraps — five options never fit one phone row. */
.ws-sizeseg{flex-wrap:wrap;}
.ws-sizeseg button{flex:0 1 auto;}
.ws-upsell b{font-family:Poppins,sans-serif;font-size:14px;color:var(--ink);}
.ws-upsell p{font-size:12.5px;color:var(--ink2);margin:6px 0 12px;}

/* ---- Mobile Studio: kill the doom scroll ----
 * One 200px-wide column per row meant every picker was a mile of thumbnails.
 * Two columns halves the height, and every picker gets the same contained,
 * inner-scrolling treatment the format library already had — so the page
 * stays a page and the choosing happens inside it. */
@media(max-width:620px){
  .ws-tiles,.ws-tiles.styles,.ws-tiles.fmt,.ws-tiles.two{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
  .ws-tile b{font-size:12.5px;padding:8px 9px 0;}
  .ws-tile.fmt b{font-size:12.5px;}
  .ws-tile-sub{font-size:10.5px;padding:2px 9px 0;line-height:1.35;}
  .ws-tile{padding-bottom:9px;border-radius:13px;}
  .ws-scrollbox{max-height:58vh;overflow-y:auto;overscroll-behavior:contain;scroll-behavior:smooth;
    /* Right gutter: the scroll thumb was riding on the tile art. */
    padding:3px 15px 34px 3px;scrollbar-gutter:stable;
    -webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 34px),transparent);
    mask-image:linear-gradient(180deg,#000 calc(100% - 34px),transparent);}
  .ws-fmtbox{max-height:58vh;}
  .ws-tabs{gap:6px}
  .ws-tab{padding:9px 13px;font-size:12.5px;gap:6px;}
  .ws-lbl{margin:13px 0 7px}
  .ws-card{padding:16px}
  .ws-engines{gap:6px}
  .ws-engine{padding:7px 11px}
}
/* Two columns is already tight at 200px art — below that, don't shrink the
   text any further, just let the art carry it. */
@media(max-width:380px){
  .ws-tiles,.ws-tiles.styles,.ws-tiles.fmt,.ws-tiles.two{gap:8px;}
  .ws-tile-sub{display:none;}
}
`;
