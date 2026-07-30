/* Web front-door layout — the non-Shopify shell around dashboard, studio and
 * archive. Same engine, no Polaris/App Bridge; styled to match the landing. */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { getWebIdentity } from "../lib/web-auth.server";
import { tokensRemainingLive, planTrialing } from "../lib/tokens.server";
import { resolveTierKey, PLAN_BY_KEY } from "../lib/plan-config";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const id = await getWebIdentity(request);
  if (!id) return json({ authed: false, tokens: 0, planLabel: null as string | null });
  const tier = id.shop.activePlan?.active ? resolveTierKey(id.shop.activePlan.type) : null;
  const planLabel = tier
    ? `${PLAN_BY_KEY[tier].name}${planTrialing(id.shop.activePlan) ? " · Trial" : ""}`
    : null;
  return json({ authed: true, tokens: tokensRemainingLive(id.shop.activePlan), planLabel });
};

export default function WebLayout() {
  const { authed, tokens, planLabel } = useLoaderData<typeof loader>();
  const loc = useLocation();
  const tab = (p: string) => (loc.pathname === p ? "wb-tab on" : "wb-tab");
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wb">
        <header className="wb-nav">
          <Link to="/" className="wb-brand">
            <img src="/easymode-head.png" width="30" height="24" alt="" style={{ imageRendering: "pixelated", objectFit: "contain" }} />
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
          {authed ? (
            <div className="wb-me">
              {planLabel && <span className="wb-plan">{planLabel}</span>}
              <span className="wb-tok">🪙 {tokens.toLocaleString()}</span>
              <Link to="/web/logout" className="wb-out">Log out</Link>
            </div>
          ) : (
            <div className="wb-me">
              <Link to="/web/login" className="wb-out">Log in</Link>
            </div>
          )}
        </header>
        <main className="wb-main">
          <Outlet />
        </main>
      </div>
    </>
  );
}

const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600&display=swap");
*{box-sizing:border-box} html,body{margin:0;padding:0}
.wb{--paper:#F4F1E6;--card:#FDFCF7;--ink:#14201A;--ink2:#4A554E;--line:#E4DFCF;--green:#0C7A46;--green2:#12A85E;--gold:#B08526;--gold-deep:#7E5E13;
  min-height:100vh;color:var(--ink);font-family:Inter,-apple-system,sans-serif;background:radial-gradient(60% 45% at 50% -5%,rgba(15,145,82,.08),transparent 60%),var(--paper);}
.wb-nav{display:flex;align-items:center;justify-content:space-between;gap:18px;max-width:1080px;margin:0 auto;padding:18px 24px;flex-wrap:wrap;}
.wb-brand{display:flex;align-items:center;gap:8px;font-family:Poppins,sans-serif;font-weight:800;font-size:18px;color:var(--ink);text-decoration:none;}
.wb-brand b{color:var(--gold)}
.wb-tabs{display:flex;gap:6px;}
.wb-tab{padding:8px 16px;border-radius:11px;text-decoration:none;font-weight:700;font-size:13.5px;color:var(--ink2);}
.wb-tab.on{background:var(--card);border:1px solid var(--line);color:var(--ink);box-shadow:0 2px 6px rgba(20,32,26,.06);}
.wb-me{display:flex;align-items:center;gap:12px;}
.wb-plan{font-weight:800;font-size:12px;padding:5px 12px;border-radius:999px;color:#fff;background:linear-gradient(165deg,#12A85E,#0B6B3E);}
.wb-tok{font-weight:700;font-size:13px;color:var(--gold-deep);}
.wb-out{font-size:13px;color:var(--ink2);text-decoration:none;font-weight:600;}
.wb-main{max-width:1080px;margin:0 auto;padding:10px 24px 70px;}
.wb-h1{font-family:Poppins,sans-serif;font-weight:800;font-size:clamp(24px,4vw,34px);letter-spacing:-.02em;margin:14px 0 6px;}
.wb-sub{color:var(--ink2);font-size:14.5px;line-height:1.55;margin:0 0 24px;max-width:60ch;}
.wb-card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 2px 8px rgba(20,32,26,.05);}
.wb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;}
.wb-lbl{display:block;font-weight:700;font-size:12.5px;margin:14px 0 5px;color:var(--ink);}
.wb-in,.wb-sel,.wb-ta{width:100%;padding:11px 13px;border-radius:11px;border:1px solid var(--line);background:#fff;font:inherit;font-size:14px;color:var(--ink);}
.wb-ta{min-height:76px;resize:vertical}
.wb-btn{display:inline-block;border:0;cursor:pointer;text-decoration:none;text-align:center;font-family:Poppins,sans-serif;font-weight:800;font-size:14px;color:#fff;padding:12px 24px;border-radius:12px;background:linear-gradient(165deg,#12A85E,#0B6B3E);box-shadow:0 4px 12px rgba(12,122,70,.28);}
.wb-btn:hover{filter:brightness(1.06)}
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
.wb-asset video,.wb-asset img{width:100%;height:220px;object-fit:cover;display:block;background:#0b0f0d;}
.wb-asset .m{padding:10px 12px;font-size:13px;font-weight:600;}
.wb-asset .s{font-size:11.5px;color:var(--ink2);font-weight:500;}
.wb-auth{max-width:420px;margin:40px auto;}

/* ---- Web Studio: the embedded-app experience, GStyle ---- */
.ws-tabs{display:flex;gap:8px;margin:4px 0 16px;}
.ws-tab{padding:10px 20px;border-radius:12px;border:1px solid var(--line);background:var(--card);
  font-family:Poppins,sans-serif;font-weight:700;font-size:13.5px;color:var(--ink2);cursor:pointer;}
.ws-tab.on{background:linear-gradient(165deg,#12A85E,#0B6B3E);border-color:transparent;color:#fff;box-shadow:0 4px 12px rgba(12,122,70,.25);}
.ws-card{overflow:hidden;}
.ws-lbl{display:flex;align-items:baseline;gap:8px;font-family:Poppins,sans-serif;font-weight:700;font-size:13px;color:var(--ink);margin:16px 0 8px;}
.ws-lbl:first-child{margin-top:0}
.ws-opt{font-family:Inter,sans-serif;font-weight:500;font-size:11px;color:var(--ink2);}
.ws-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;}
.ws-tiles.two{grid-template-columns:repeat(2,minmax(220px,300px));justify-content:center;}
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
.ws-tile.lockd .ws-tile-img{filter:saturate(.35) brightness(.72);}
.ws-tile.lockd:hover .ws-tile-img{filter:saturate(.6) brightness(.85);}
.ws-lock{position:absolute;top:8px;right:8px;padding:3px 9px;border-radius:999px;font-size:10.5px;font-weight:800;
  color:#fff;background:rgba(10,14,12,.78);border:1px solid rgba(255,255,255,.35);}
.ws-chk{position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;
  background:#12A85E;color:#fff;font-size:12px;font-weight:900;box-shadow:0 2px 6px rgba(0,0,0,.3);}
.ws-back{border:0;background:none;color:var(--green);font-weight:700;font-size:13px;cursor:pointer;padding:0;margin-bottom:6px;}
.ws-note{font-size:13px;color:var(--ink2);background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:11px 14px;margin:8px 0;}
.ws-cast{display:flex;gap:10px;overflow-x:auto;padding:4px 2px 8px;}
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
.ws-upsell b{font-family:Poppins,sans-serif;font-size:14px;color:var(--ink);}
.ws-upsell p{font-size:12.5px;color:var(--ink2);margin:6px 0 12px;}
`;
