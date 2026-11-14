/* The LAUNCHER — the new console-style home (dark), the post-login landing. Lives
 * at /web/home, full-bleed with the shell nav hidden (web.tsx hides it on this
 * path). The dashboard stays at /web untouched (Stripe returns, deep links) and is
 * just one of the studio tiles here. Helpurr is the shell's Buddy orb + the "Ask
 * Helpurr" prompt below, which fires the same helpurr:open event the nav used.
 *
 * ISOLATED + revertable: this is a new file + a nav condition + the login landing
 * default. Delete this file, undo those two, and the app is exactly as it was. */
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";
import { tokensRemainingLive } from "../lib/tokens.server";

export const meta = () => [{ title: "Home · EasyMode" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const [videos, images] = await Promise.all([
    db.asset.count({ where: { shopId: shop.id, type: "VIDEO_AD" } }),
    db.asset.count({ where: { shopId: shop.id, type: "IMAGE_AD" } }),
  ]);
  return json({ tokens: tokensRemainingLive(shop.activePlan), videos, images });
};

type Studio = {
  id: string; name: string; kicker: string; sub: string; title: string; blurb: string;
  cta: string; to: string; accent: string; wash: string; line: string; grad: string;
};

export default function WebHome() {
  const { tokens, videos, images } = useLoaderData<typeof loader>();

  const STUDIOS: Studio[] = useMemo(() => [
    { id: "create", name: "Create", kicker: "Make anything", sub: "Images & video", title: "Create Studio",
      blurb: "Describe it and it’s made — product shots, scenes, short videos — right in the chat.",
      cta: "Open Create", to: "/web/studio", accent: "#2cc67f", wash: "rgba(44,198,127,.14)", line: "rgba(44,198,127,.3)", grad: "linear-gradient(120deg,#123524,#0e2a1d)" },
    { id: "film", name: "Film", kicker: "Entertainment engine", sub: "Episodes · dialogue", title: "Film Studio",
      blurb: "Movies, kids episodes, music videos and real character dialogue — built to post, not just ads.",
      cta: "Open Film", to: "/web/film", accent: "#f2dca0", wash: "rgba(242,220,160,.12)", line: "rgba(242,220,160,.3)", grad: "linear-gradient(120deg,#352c15,#241d0e)" },
    { id: "social", name: "Social", kicker: "Marketing on autopilot", sub: "Campaigns · posting", title: "Social",
      blurb: "Your marketing runs itself — campaigns, trending topics, and auto-posting to every account.",
      cta: "Open Social", to: "/web/product-channels", accent: "#34c9c0", wash: "rgba(52,201,192,.13)", line: "rgba(52,201,192,.3)", grad: "linear-gradient(120deg,#0e3734,#0c2724)" },
    { id: "presenters", name: "Presenters", kicker: "Your AI cast", sub: "Avatars that sell", title: "Presenters",
      blurb: "A cast of AI presenters — pick one to front your videos, or forge a custom face with its own voice.",
      cta: "Open Presenters", to: "/web/presenters", accent: "#c48cf0", wash: "rgba(196,140,240,.12)", line: "rgba(196,140,240,.28)", grad: "linear-gradient(120deg,#2d1d3a,#1d1427)" },
    { id: "dashboard", name: "Dashboard", kicker: "Your numbers", sub: "Reach & clicks", title: "Dashboard",
      blurb: "What’s working — reach, clicks and the piece pulling the most store visits, with a next move suggested.",
      cta: "Open Dashboard", to: "/web", accent: "#2cc67f", wash: "rgba(44,198,127,.13)", line: "rgba(44,198,127,.28)", grad: "linear-gradient(120deg,#113525,#0e271c)" },
    { id: "archive", name: "Archive", kicker: "Everything you’ve made", sub: "Watch · keep · post", title: "Archive",
      blurb: "Every image and video you’ve made, in one place — watch it big, keep the good ones, or push them live.",
      cta: "Open Archive", to: "/web/archive", accent: "#b7c0a0", wash: "rgba(183,192,160,.13)", line: "rgba(183,192,160,.28)", grad: "linear-gradient(120deg,#232e21,#161e17)" },
  ], []);

  const ICONS: Record<string, string> = {
    create: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l1.7 4.1L18 8l-3.4 2 1 4.2L12 11.9 8.4 14.2l1-4.2L6 8l4.3-.9L12 3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M19 15v4M17 17h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    film: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2.4" stroke="currentColor" stroke-width="1.7"/><path d="M3 9h18M8 5v14M16 5v14" stroke="currentColor" stroke-width="1.5"/><path d="M11 12.1v2.8l2.4-1.4-2.4-1.4z" fill="currentColor"/></svg>',
    social: '<svg viewBox="0 0 24 24" fill="none"><circle cx="6.5" cy="12" r="2.4" stroke="currentColor" stroke-width="1.7"/><circle cx="17" cy="6.5" r="2.4" stroke="currentColor" stroke-width="1.7"/><circle cx="17" cy="17.5" r="2.4" stroke="currentColor" stroke-width="1.7"/><path d="M8.7 10.9l6.1-3.1M8.7 13.1l6.1 3.1" stroke="currentColor" stroke-width="1.6"/></svg>',
    presenters: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8.5" r="3.4" stroke="currentColor" stroke-width="1.7"/><path d="M5.5 19.5c0-3.3 2.9-5.6 6.5-5.6s6.5 2.3 6.5 5.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    dashboard: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 19V11M9 19V5M14 19v-6M19 19V8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    archive: '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="4" rx="1.3" stroke="currentColor" stroke-width="1.7"/><path d="M5 8.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V8.5M10 12h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  };
  const PORTAL: Record<string, [string, string, string, string]> = {
    create: ["make", '<div class="lx-chatline"></div><div class="lx-chatline two"></div><div class="lx-imgres"></div>', "result", '<div class="lx-frame916" style="inset:9px"></div>'],
    film: ["scene 1", '<div class="lx-frame916"><span class="lx-play"></span></div><div class="lx-capbar"></div>', "clip", '<div class="lx-frame916" style="inset:9px"><span class="lx-play" style="border-left-width:10px"></span></div>'],
    social: ["post", '<div class="lx-postcard"></div><span class="lx-heart">●</span><div class="lx-bars"><i style="height:40%"></i><i style="height:70%"></i><i style="height:55%"></i><i style="height:90%"></i><i style="height:65%"></i></div>', "reach", '<div class="lx-bars" style="inset:12px;bottom:12px"><i style="height:50%"></i><i style="height:80%"></i><i style="height:95%"></i></div>'],
    presenters: ["cast", '<div class="lx-faces"><span class="lx-f"></span><span class="lx-f"></span></div>', "forge", '<div class="lx-faces"><span class="lx-f" style="width:40px;height:40px"></span></div>'],
    dashboard: ["this week", '<div class="lx-bignum">1,284</div><div class="lx-numsub">store clicks</div><div class="lx-bars"><i style="height:45%"></i><i style="height:60%"></i><i style="height:52%"></i><i style="height:85%"></i><i style="height:72%"></i><i style="height:95%"></i></div>', "top piece", '<div class="lx-frame916" style="inset:9px"></div>'],
    archive: ["everything", '<div class="lx-grid4"><b></b><b></b><b></b><b></b><b></b><b></b></div>', "keep", '<div class="lx-grid4" style="grid-template-columns:1fr 1fr"><b></b><b></b></div>'],
  };
  const MINI: Record<string, [string, string]> = {
    create: [String(images + videos), "made"], film: ["7", "formats"], social: ["auto", "posting"],
    presenters: ["21", "cast"], dashboard: ["1,284", "clicks 7d"], archive: [String(videos + images), "pieces"],
  };

  const [sel, setSel] = useState(1);
  const s = STUDIOS[sel];
  const askHelpurr = () => { try { window.dispatchEvent(new CustomEvent("helpurr:open", { detail: { max: true } })); } catch { /* ignore */ } };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { setSel((i) => Math.min(STUDIOS.length - 1, i + 1)); e.preventDefault(); }
      if (e.key === "ArrowLeft") { setSel((i) => Math.max(0, i - 1)); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [STUDIOS.length]);

  const portal = PORTAL[s.id];
  const mini = MINI[s.id];

  return (
    <div className="lx" style={{ ["--hero-accent" as string]: s.accent }}>
      <style dangerouslySetInnerHTML={{ __html: LX_CSS }} />
      <div className="lx-wrap">
        <header className="lx-top">
          <div className="lx-brand">
            <span className="lx-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 9c0-1 .8-2 2-2 .6-2 2.2-3 4-3 2 0 3.6 1.3 4 3.2 1.4.2 2.4 1.3 2.4 2.8 0 1.4-1 2.6-2.6 2.6" stroke="#06130c" strokeWidth="1.6" strokeLinecap="round"/><circle cx="9.3" cy="11.5" r="1.1" fill="#06130c"/><circle cx="14.7" cy="11.5" r="1.1" fill="#06130c"/><path d="M9.5 14.5c.8.8 3.2.8 4 0" stroke="#06130c" strokeWidth="1.6" strokeLinecap="round"/></svg></span>
            <b>EASY<span>MODE</span></b>
          </div>
          <div className="lx-tr">
            <span className="lx-chip"><span className="lx-dot" /><b>{tokens.toLocaleString("en-US")}</b>&nbsp;tokens</span>
          </div>
        </header>

        <section className="lx-hero">
          <div className="lx-herobg" style={{ background: s.grad }} key={s.id} />
          <div className="lx-pglow" />
          <div className="lx-portal" aria-hidden="true" key={"p" + s.id}>
            <div className="lx-pwin main"><div className="lx-barttl">{portal[0]}</div><div className="lx-pscreen" dangerouslySetInnerHTML={{ __html: portal[1] }} /></div>
            <div className="lx-pwin sub"><div className="lx-barttl">{portal[2]}</div><div className="lx-pscreen" dangerouslySetInnerHTML={{ __html: portal[3] }} /></div>
          </div>
          <div className="lx-heroinner">
            <span className="lx-eyebrow"><span className="lx-ic" dangerouslySetInnerHTML={{ __html: ICONS[s.id] }} />{s.kicker}</span>
            <h1>{s.title}</h1>
            <p>{s.blurb}</p>
            <div className="lx-actions">
              <Link className="lx-btn lx-primary" to={s.to}>{s.cta} <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg></Link>
              <button className="lx-btn lx-ghost" type="button" onClick={askHelpurr}>Ask Helpurr</button>
            </div>
            <div className="lx-heromini"><b>{mini[0]}</b> {mini[1]}</div>
          </div>
        </section>

        <div className="lx-railhead"><h2>Your studios</h2><span className="lx-hint">Pick a studio — or ← → to browse</span></div>
        <div className="lx-rail" role="listbox" aria-label="Studios">
          {STUDIOS.map((st, i) => (
            <button key={st.id} type="button" className="lx-tile" role="option" aria-selected={i === sel}
              style={{ ["--t-accent" as string]: st.accent, ["--t-wash" as string]: st.wash, ["--t-line" as string]: st.line }}
              onMouseEnter={() => setSel(i)} onClick={() => { setSel(i); }} onDoubleClick={() => { window.location.href = st.to; }}>
              <span className="lx-ticon" dangerouslySetInnerHTML={{ __html: ICONS[st.id] }} />
              <span className="lx-tx"><span className="lx-th">{st.name}</span><span className="lx-tsub">{st.sub}</span></span>
            </button>
          ))}
        </div>
        <p className="lx-foot">Tip: single-click previews a studio up top; the button opens it. Helpurr’s bottom-right, always ready.</p>
      </div>
    </div>
  );
}

const LX_CSS = `
.lx{--bg:#0a120e;--surface:#111e17;--surface-hi:#16271e;--glass:rgba(22,39,30,.72);--line:#223429;--line-hi:#2e4638;--cream:#f1eee2;--muted:#8ba093;--green:#2cc67f;--green-soft:#189059;--gold:#f2dca0;--rad:22px;--rad-sm:15px;
  --fdisp:"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif;--fbody:"Poppins",ui-sans-serif,system-ui,sans-serif;
  position:relative;width:100%;min-height:100vh;color:var(--cream);font-family:var(--fbody);
  background:radial-gradient(120% 80% at 84% -12%, rgba(44,198,127,.15), transparent 58%),radial-gradient(90% 70% at 4% 2%, rgba(242,220,160,.06), transparent 52%),var(--bg);}
.lx *{box-sizing:border-box;}
.lx-wrap{max-width:none;margin:0 auto;padding:0 max(22px,env(safe-area-inset-left,0px)) 48px;}
.lx-top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 0 8px;}
.lx-brand{display:flex;align-items:center;gap:11px;}
.lx-mark{width:38px;height:38px;border-radius:11px;background:linear-gradient(155deg,var(--green),var(--green-soft));display:grid;place-items:center;box-shadow:0 6px 18px rgba(44,198,127,.3);}
.lx-mark svg{width:23px;height:23px;}
.lx-brand b{font-family:var(--fdisp);font-weight:800;font-size:20px;letter-spacing:.4px;}
.lx-brand b span{color:var(--green);}
.lx-chip{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:999px;background:var(--surface);border:1px solid var(--line);font-size:13px;font-weight:500;}
.lx-chip .lx-dot{width:6px;height:6px;border-radius:50%;background:var(--green);}
.lx-chip b{font-variant-numeric:tabular-nums;font-weight:600;}
.lx-hero{position:relative;margin-top:14px;border-radius:var(--rad);overflow:hidden;border:1px solid var(--line);background:var(--surface);min-height:372px;display:flex;isolation:isolate;}
.lx-herobg{position:absolute;inset:0;z-index:0;animation:lxfade .5s ease;}
.lx-herobg::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,15,12,.95) 0%,rgba(8,15,12,.62) 44%,rgba(8,15,12,.08) 86%);}
@keyframes lxfade{from{opacity:0;}to{opacity:1;}}
.lx-pglow{position:absolute;width:260px;height:260px;right:40px;top:30px;border-radius:50%;background:radial-gradient(circle,var(--hero-accent,var(--green)),transparent 66%);opacity:.14;filter:blur(10px);z-index:1;}
.lx-portal{position:absolute;inset:0;z-index:1;pointer-events:none;}
.lx-pwin{position:absolute;border-radius:14px;overflow:hidden;border:1px solid var(--line-hi);background:var(--glass);backdrop-filter:blur(6px);box-shadow:0 20px 44px rgba(0,0,0,.5);animation:lxbob 6s ease-in-out infinite;}
.lx-pwin .lx-barttl{font-size:9px;letter-spacing:.4px;text-transform:uppercase;color:var(--muted);padding:7px 9px 0;}
.lx-pwin.main{width:188px;right:58px;top:52px;}
.lx-pwin.sub{width:132px;right:150px;bottom:46px;animation-delay:-3s;opacity:.92;}
.lx-pwin .lx-pscreen{position:relative;height:112px;}
.lx-pwin.sub .lx-pscreen{height:84px;}
@keyframes lxbob{0%,100%{transform:translateY(0);}50%{transform:translateY(-9px);}}
.lx-frame916{position:absolute;inset:10px;border-radius:9px;background:linear-gradient(160deg,#0c1711,#1a2c21);display:grid;place-items:center;}
.lx-play{width:0;height:0;border-left:14px solid var(--cream);border-top:9px solid transparent;border-bottom:9px solid transparent;margin-left:4px;opacity:.92;}
.lx-capbar{position:absolute;left:14px;right:14px;bottom:14px;height:7px;border-radius:4px;background:rgba(241,238,226,.5);}
.lx-chatline{position:absolute;left:11px;top:12px;height:11px;width:72%;border-radius:6px;background:rgba(241,238,226,.18);}
.lx-chatline.two{top:28px;width:52%;}
.lx-imgres{position:absolute;left:11px;right:11px;bottom:11px;height:52px;border-radius:8px;background:linear-gradient(135deg,var(--hero-accent,var(--green)),#1a2c21);}
.lx-postcard{position:absolute;left:11px;right:11px;top:11px;height:46px;border-radius:8px;background:rgba(241,238,226,.08);border:1px solid var(--line-hi);}
.lx-heart{position:absolute;left:16px;top:22px;color:var(--hero-accent,var(--green));font-size:12px;}
.lx-bars{position:absolute;left:12px;right:12px;bottom:12px;height:40px;display:flex;align-items:flex-end;gap:5px;}
.lx-bars i{flex:1;border-radius:3px 3px 0 0;background:var(--hero-accent,var(--green));opacity:.85;}
.lx-bignum{position:absolute;left:13px;top:12px;font-family:var(--fdisp);font-weight:700;font-size:22px;color:var(--cream);}
.lx-numsub{position:absolute;left:13px;top:40px;font-size:9px;letter-spacing:.4px;text-transform:uppercase;color:var(--muted);}
.lx-faces{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}
.lx-faces .lx-f{width:46px;height:46px;border-radius:50%;border:2px solid var(--surface-hi);background:linear-gradient(150deg,var(--hero-accent,var(--green)),#1a2c21);}
.lx-faces .lx-f:nth-child(2){margin-left:-14px;filter:brightness(.8);}
.lx-grid4{position:absolute;inset:11px;display:grid;grid-template-columns:1fr 1fr 1fr;grid-auto-rows:1fr;gap:5px;}
.lx-grid4 b{border-radius:5px;background:linear-gradient(140deg,color-mix(in srgb,var(--hero-accent,var(--green)) 55%,#16271e),#16271e);}
.lx-heroinner{position:relative;z-index:2;padding:38px 40px;display:flex;flex-direction:column;justify-content:center;gap:15px;max-width:500px;}
.lx-eyebrow{display:inline-flex;align-items:center;gap:9px;font-size:11.5px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase;color:var(--hero-accent,var(--green));}
.lx-ic{width:17px;height:17px;display:inline-grid;}
.lx-ic svg{width:17px;height:17px;}
.lx-heroinner h1{font-family:var(--fdisp);font-weight:800;font-size:clamp(30px,4.4vw,50px);line-height:1.0;margin:0;letter-spacing:-.8px;text-wrap:balance;}
.lx-heroinner p{margin:0;color:var(--cream);opacity:.8;font-size:15.5px;line-height:1.55;max-width:42ch;}
.lx-actions{display:flex;flex-wrap:wrap;gap:11px;margin-top:4px;}
.lx-btn{font-family:var(--fbody);font-weight:600;font-size:14px;padding:12px 20px;border-radius:12px;border:1px solid transparent;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:8px;transition:transform .12s ease,filter .15s ease;}
.lx-btn:active{transform:translateY(1px);}
.lx-primary{background:linear-gradient(150deg,var(--hero-accent,var(--green)),color-mix(in srgb,var(--hero-accent,var(--green)) 62%,#000));color:#06130c;}
.lx-primary svg{width:15px;height:15px;}
.lx-primary:hover{filter:brightness(1.07);}
.lx-ghost{background:rgba(241,238,226,.06);border-color:var(--line-hi);color:var(--cream);}
.lx-ghost:hover{background:rgba(241,238,226,.11);}
.lx-heromini{font-size:12px;color:var(--muted);}
.lx-heromini b{font-family:var(--fdisp);color:var(--cream);font-size:14px;font-variant-numeric:tabular-nums;}
.lx-railhead{display:flex;align-items:baseline;justify-content:space-between;margin:24px 2px 12px;}
.lx-railhead h2{font-family:var(--fdisp);font-weight:700;font-size:14px;letter-spacing:.3px;margin:0;}
.lx-hint{font-size:12px;color:var(--muted);}
.lx-rail{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;}
.lx-tile{position:relative;text-align:left;cursor:pointer;color:var(--cream);background:var(--surface);border:1px solid var(--line);border-radius:var(--rad-sm);padding:14px;display:flex;align-items:center;gap:12px;transition:transform .15s ease,border-color .15s ease,background .15s ease;font-family:var(--fbody);}
.lx-tile:hover{transform:translateY(-3px);border-color:var(--line-hi);}
.lx-ticon{width:38px;height:38px;flex:none;border-radius:11px;display:grid;place-items:center;background:var(--t-wash,rgba(44,198,127,.13));border:1px solid var(--t-line,rgba(44,198,127,.28));}
.lx-ticon svg{width:21px;height:21px;color:var(--t-accent,var(--green));}
.lx-tx{min-width:0;display:flex;flex-direction:column;}
.lx-th{font-family:var(--fdisp);font-weight:700;font-size:14.5px;letter-spacing:-.2px;}
.lx-tsub{font-size:11px;color:var(--muted);line-height:1.3;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.lx-tile[aria-selected="true"]{background:var(--surface-hi);border-color:var(--t-accent,var(--green));box-shadow:0 10px 26px rgba(0,0,0,.4);}
.lx-tile[aria-selected="true"] .lx-ticon{background:var(--t-accent,var(--green));border-color:var(--t-accent,var(--green));}
.lx-tile[aria-selected="true"] .lx-ticon svg{color:#06130c;}
.lx-tile:focus-visible{outline:2px solid var(--green);outline-offset:3px;}
.lx-foot{margin:18px 2px 0;font-size:12px;color:var(--muted);}
@media (max-width:860px){.lx-rail{grid-template-columns:repeat(3,1fr);}.lx-portal .lx-pwin.sub{display:none;}.lx-pwin.main{right:26px;}}
@media (max-width:620px){.lx-rail{grid-template-columns:repeat(2,1fr);}.lx-portal{display:none;}.lx-hero{min-height:300px;}.lx-heroinner{padding:28px 22px;max-width:none;}}
@media (prefers-reduced-motion:reduce){.lx *{animation:none !important;transition:none !important;}}
`;
