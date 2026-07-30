import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import { PLAN_TIERS, annualPrice, planCapacityLine } from "../lib/plan-config";
import { LANDING_I18N, LANG_LABELS, detectLang, type LangKey } from "../lib/landing-i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Embedded / install traffic always carries a shop param → send to the
  // embedded app area (/app), which performs the App Bridge token exchange.
  // (Redirecting to /auth here breaks fresh installs — it returns null.)
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // No shop param → the public marketing page (also serves as the health check).
  return json({ ok: true });
};

export default function Index() {
  useLoaderData<typeof loader>();
  // Language toggle — persisted per browser, auto-detected on first visit.
  const [lang, setLang] = useState<LangKey>("en");
  useEffect(() => { setLang(detectLang()); }, []);
  useEffect(() => { try { document.documentElement.lang = lang; } catch { /* SSR */ } }, [lang]);
  const pick = (l: LangKey) => { setLang(l); try { localStorage.setItem("emLang", l); } catch { /* private mode */ } };
  const t = LANDING_I18N[lang] || LANDING_I18N.en;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="lz">
        <header className="lz-nav">
          <div className="lz-brand">
            <img src="/easymode-head.png" width="34" height="27" alt="" style={{ imageRendering: "pixelated", objectFit: "contain" }} />
            <span>Easy<b>Mode</b></span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label className="lz-lang">
              🌐
              <select value={lang} onChange={(e) => pick(e.target.value as LangKey)} aria-label="Language">
                {(Object.keys(LANG_LABELS) as LangKey[]).map((l) => (
                  <option key={l} value={l}>{LANG_LABELS[l]}</option>
                ))}
              </select>
            </label>
            <a className="lz-navlink" href="/web/login">{t.nav.login}</a>
            <a className="lz-navcta" href="/web/signup">{t.nav.start}</a>
          </div>
        </header>

        <main className="lz-hero">
          <span className="lz-rose lz-rose-hero" aria-hidden="true" />
          <span className="lz-eyebrow">{t.hero.eyebrow}</span>
          <h1>{t.hero.h1a}<span className="lz-grad">{t.hero.h1b}</span></h1>
          <p className="lz-sub">{t.hero.sub}</p>
          <div className="lz-ctas">
            <a className="lz-cta" href="/web/signup"><span className="lz-arr-w">{t.hero.cta}<span className="lz-arr">→</span></span></a>
            <span className="lz-note">{t.hero.note}</span>
          </div>

          <div className="lz-stats">
            <div><b>4</b><span>{t.stats.types}</span></div>
            <div className="lz-div" />
            <div><b>3</b><span>{t.stats.channels}</span></div>
            <div className="lz-div" />
            <div><b>$19</b><span>{t.stats.start}</span></div>
          </div>
        </main>

        <section className="lz-feats">
          {t.features.map((f) => (
            <div className="lz-card" key={f.title}>
              <div className="lz-ic">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </section>

        {/* Real output — these are the SAME live renders the app serves its
            pickers from (they self-forge on this server; no mock art). */}
        <section className="lz-show">
          <span className="lz-eyebrow">{t.show.eyebrow}</span>
          <h2>{t.show.h2}</h2>
          <p className="lz-show-sub">{t.show.sub}</p>
          <div className="lz-show-grid">
            {[
              "/style-tiles/avatarcover.jpg?v=2",
              "/style-tiles/cover.jpg?v=2",
              "/style-tiles/anthemcover.jpg?v=2",
              "/ad-templates/preview-colorblock.jpg?v=9",
            ].map((src, i) => (
              <figure className="lz-show-card" key={src}>
                <span className="lz-show-img" style={{ backgroundImage: `url(${src})` }} />
                <figcaption><b>{t.show.cards[i]?.label}</b><span>{t.show.cards[i]?.sub}</span></figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* Pricing — rendered from the SAME plan-config the app bills from,
            so the public page can never drift from the real ladder. */}
        <section className="lz-price" id="pricing">
          <span className="lz-eyebrow">{t.price.eyebrow}</span>
          <h2>{t.price.h2}</h2>
          <p className="lz-show-sub">{t.price.sub}</p>
          <div className="lz-price-grid">
            {PLAN_TIERS.map((tier) => (
              <div className={`lz-price-card${tier.highlight ? " feat" : ""}`} key={tier.key}>
                {tier.highlight && <span className="lz-price-ribbon">{t.price.ribbon}</span>}
                <div className="lz-price-name">{tier.name}</div>
                <div className="lz-price-amt">${tier.price}<small>{t.price.perMo}</small></div>
                <div className="lz-price-alt">{t.price.yearAlt.replace("{Y}", annualPrice(tier).toLocaleString())}</div>
                <div className="lz-price-tok">{t.price.tokensMo.replace("{N}", tier.monthlyTokens.toLocaleString())}</div>
                {lang === "en" && <div className="lz-price-cap">{planCapacityLine(tier)}</div>}
                <ul>{(t.price.tiers[tier.key] || tier.features).map((f) => <li key={f}>{f}</li>)}</ul>
                <a className="lz-price-cta" href="/web/signup">{t.price.cta}</a>
              </div>
            ))}
          </div>
          <div className="lz-price-note">{t.price.note}</div>
        </section>

        <section className="lz-faq">
          <span className="lz-eyebrow">{t.faq.eyebrow}</span>
          <h2>{t.faq.h2}</h2>
          <div className="lz-faq-list">
            {t.faq.items.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lz-compare">
          <span className="lz-eyebrow">{t.compare.eyebrow}</span>
          <h2>{t.compare.h2a}<span className="lz-vsname">{t.compare.h2b}</span></h2>
          <p className="lz-compare-sub">{t.compare.sub}</p>
          <div className="lz-vs">
            <div className="lz-vs-col them">
              <div className="lz-vs-h">{t.compare.themH}</div>
              <ul>{t.compare.them.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
            <div className="lz-vs-col us">
              <span className="lz-rose lz-rose-vs" aria-hidden="true" />
              <div className="lz-vs-h">{t.compare.usH}</div>
              <ul>{t.compare.us.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          </div>
        </section>

        <section className="lz-band">
          <div className="lz-band-in">
            <span className="lz-rose lz-rose-band" aria-hidden="true" />
            <h2>{t.band.h2}</h2>
            <p>{t.band.p}</p>
            <a className="lz-cta gold" href="/web/signup"><span className="lz-arr-w">{t.band.cta}<span className="lz-arr">→</span></span></a>
          </div>
        </section>

        <footer className="lz-foot">
          <div className="lz-brand small">
            <img src="/easymode-head.png" width="26" height="20" alt="" style={{ imageRendering: "pixelated", objectFit: "contain" }} />
            <span>Easy<b>Mode</b><i>.io</i></span>
          </div>
          <span className="lz-copy">{t.footer.copy}</span>
        </footer>
      </div>
    </>
  );
}

const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600&display=swap");
*{box-sizing:border-box}
html,body{margin:0;padding:0}
.lz{--paper:#F4F1E6;--card:#FDFCF7;--ink:#14201A;--ink2:#4A554E;--line:#E4DFCF;
  --green:#0C7A46;--green2:#0F9152;--green-deep:#0A3D26;--gold:#B08526;--gold-hi:#E7C879;--gold-deep:#7E5E13;--mint:#7FE0AC;
  position:relative;min-height:100vh;color:var(--ink);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-x:hidden;
  background:
    radial-gradient(60% 45% at 50% -5%,rgba(15,145,82,.10),transparent 60%),
    radial-gradient(50% 40% at 92% 4%,rgba(176,133,38,.10),transparent 60%),
    var(--paper);}
.lz-nav{display:flex;align-items:center;justify-content:space-between;max-width:1080px;margin:0 auto;padding:22px 26px;}
.lz-brand{display:flex;align-items:center;gap:9px;font-family:Poppins,sans-serif;font-weight:800;font-size:19px;letter-spacing:-.01em;color:var(--ink);}
.lz-brand b{color:var(--gold);font-weight:800}
.lz-brand i{color:var(--gold);font-style:normal;font-size:.7em;opacity:.8}
.lz-brand.small{font-size:15px;opacity:.9}
.lz-navcta{font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:#fff;text-decoration:none;padding:10px 18px;border-radius:11px;
  background:linear-gradient(165deg,#12A85E,#0B6B3E);box-shadow:0 5px 14px rgba(12,122,70,.28);transition:filter .12s;}
.lz-navlink{font-weight:700;font-size:13px;color:var(--ink2);text-decoration:none;}
.lz-navlink:hover{color:var(--ink)}
.lz-lang{display:inline-flex;align-items:center;gap:5px;font-size:14px;}
.lz-lang select{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:9px;
  padding:6px 8px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;}
.lz-alt{color:var(--green);font-weight:600;}
.lz-navcta:hover{filter:brightness(1.05)}
.lz-hero{max-width:820px;margin:0 auto;padding:52px 26px 30px;text-align:center;}
.lz-eyebrow{font-size:12px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:var(--green);display:block;margin-bottom:22px;}
.lz-hero h1{font-family:Poppins,sans-serif;font-weight:800;font-size:clamp(34px,6.4vw,58px);line-height:1.05;letter-spacing:-.03em;margin:0 0 20px;text-wrap:balance;color:var(--ink);}
.lz-grad{background:linear-gradient(100deg,var(--green2),#12A85E 45%,var(--gold));-webkit-background-clip:text;background-clip:text;color:transparent;}
.lz-sub{font-size:clamp(15px,2.2vw,18px);line-height:1.62;color:var(--ink2);max-width:600px;margin:0 auto 30px;}
.lz-ctas{display:flex;flex-direction:column;align-items:center;gap:11px;}
.lz-cta{position:relative;overflow:hidden;display:inline-flex;isolation:isolate;text-decoration:none;border-radius:15px;padding:2px;
  background:
    repeating-linear-gradient(57deg,rgba(255,220,120,.12) 0 1px,transparent 1px 8px),
    repeating-linear-gradient(123deg,rgba(255,220,120,.09) 0 1px,transparent 1px 8px),
    linear-gradient(165deg,#12A85E,#0B6B3E);
  box-shadow:0 6px 0 #064e2e,0 16px 36px rgba(12,122,70,.34);transition:transform .09s,filter .12s;}
/* Spinning guilloché medallion — engine-turned money etching, CSS-only so the
   public page stays light (no big SVG). Fine conic rays + radial waves spin. */
.lz-cta::after{content:"";position:absolute;z-index:-1;top:50%;right:-18px;width:104px;height:104px;margin-top:-52px;border-radius:50%;
  background:
    repeating-conic-gradient(from 0deg,rgba(255,228,158,.15) 0deg 1.4deg,transparent 1.4deg 4deg),
    repeating-conic-gradient(from 0deg,rgba(255,228,158,.10) 0deg .7deg,transparent .7deg 7deg),
    repeating-radial-gradient(circle,rgba(255,228,158,.12) 0 1px,transparent 1px 6px);
  -webkit-mask:radial-gradient(circle,#000 60%,transparent 63%);mask:radial-gradient(circle,#000 60%,transparent 63%);
  opacity:.8;animation:lz-medallion 26s linear infinite;pointer-events:none;}
@keyframes lz-medallion{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.lz-cta::after{animation:none}}
.lz-cta::before{content:"";position:absolute;inset:6px;border:1px solid rgba(255,210,74,.45);border-radius:11px;pointer-events:none;z-index:1;}
.lz-cta:hover{filter:brightness(1.05)}
.lz-cta:active{transform:translateY(3px);box-shadow:0 3px 0 #064e2e,0 8px 18px rgba(12,122,70,.3)}
.lz-arr-w{display:inline-flex;align-items:center;gap:10px;font-family:Poppins,sans-serif;font-weight:800;font-size:16px;color:#fff;padding:15px 30px;}
.lz-arr{transition:transform .15s}
.lz-cta:hover .lz-arr{transform:translateX(3px)}
.lz-note{font-size:12.5px;color:var(--ink2);opacity:.85}
.lz-stats{display:inline-flex;align-items:center;gap:24px;margin-top:42px;padding:16px 28px;border-radius:16px;background:var(--card);
  border:1px solid var(--line);box-shadow:0 10px 30px rgba(20,32,26,.06);}
.lz-stats>div{text-align:center}
.lz-stats b{display:block;font-family:Poppins,sans-serif;font-weight:800;font-size:26px;color:var(--green);line-height:1;}
.lz-stats span{font-size:11px;color:var(--ink2)}
.lz-div{width:1px;height:30px;background:var(--line)}
.lz-feats{max-width:1000px;margin:56px auto 0;padding:0 26px;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;}
.lz-card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px 20px;box-shadow:0 2px 8px rgba(20,32,26,.05);
  transition:transform .12s,border-color .12s,box-shadow .12s;}
.lz-card:hover{transform:translateY(-4px);border-color:var(--green2);box-shadow:0 16px 40px rgba(12,122,70,.14)}
.lz-ic{width:46px;height:46px;display:grid;place-items:center;font-size:23px;border-radius:13px;margin-bottom:14px;
  background:rgba(12,122,70,.09);box-shadow:inset 0 0 0 1px rgba(12,122,70,.2);}
.lz-card h3{font-family:Poppins,sans-serif;font-weight:700;font-size:16px;margin:0 0 7px;letter-spacing:-.01em;color:var(--ink);}
.lz-card p{font-size:13.5px;line-height:1.55;color:var(--ink2);margin:0;}
.lz-show,.lz-price,.lz-faq{max-width:1000px;margin:72px auto 0;padding:0 26px;text-align:center;}
.lz-show h2,.lz-price h2,.lz-faq h2{font-family:Poppins,sans-serif;font-weight:800;font-size:clamp(24px,4vw,34px);letter-spacing:-.02em;margin:10px 0 8px;color:var(--ink);text-wrap:balance;}
.lz-show-sub{font-size:15.5px;color:var(--ink2);margin:0 auto 28px;max-width:56ch;line-height:1.55;}
.lz-show-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px;}
.lz-show-card{margin:0;background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 2px 8px rgba(20,32,26,.05);transition:transform .12s,box-shadow .12s;}
.lz-show-card:hover{transform:translateY(-4px);box-shadow:0 16px 40px rgba(12,122,70,.14);}
.lz-show-img{display:block;height:150px;background-size:cover;background-position:center 22%;}
.lz-show-card figcaption{padding:12px 14px;text-align:left;}
.lz-show-card b{display:block;font-family:Poppins,sans-serif;font-size:14px;color:var(--ink);}
.lz-show-card span:not(.lz-show-img){font-size:12px;color:var(--ink2);}
.lz-price-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px;text-align:left;margin-top:26px;}
.lz-price-card{position:relative;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:26px 24px;box-shadow:0 2px 8px rgba(20,32,26,.05);display:flex;flex-direction:column;}
.lz-price-card.feat{border-color:rgba(18,168,94,.55);box-shadow:0 18px 44px rgba(12,122,70,.16);}
.lz-price-ribbon{position:absolute;top:-11px;left:50%;transform:translateX(-50%);padding:4px 14px;border-radius:999px;font-family:Poppins,sans-serif;font-weight:800;font-size:11px;color:#fff;background:linear-gradient(165deg,#12A85E,#0B6B3E);box-shadow:0 4px 10px rgba(12,122,70,.3);}
.lz-price-name{font-family:Poppins,sans-serif;font-weight:800;font-size:18px;color:var(--ink);}
.lz-price-amt{font-family:Poppins,sans-serif;font-weight:800;font-size:38px;color:var(--green);margin-top:6px;}
.lz-price-amt small{font-size:15px;color:var(--ink2);font-weight:600;}
.lz-price-alt{font-size:12px;color:var(--ink2);margin-top:2px;}
.lz-price-tok{margin-top:14px;font-weight:700;font-size:13.5px;color:var(--gold-deep);}
.lz-price-cap{font-size:12.5px;color:var(--ink2);margin-top:3px;}
.lz-price-card ul{list-style:none;margin:16px 0 18px;padding:0;display:flex;flex-direction:column;gap:9px;flex:1;}
.lz-price-card li{position:relative;padding-left:24px;font-size:13.5px;line-height:1.45;color:var(--ink2);}
.lz-price-card li::before{content:"✓";position:absolute;left:2px;color:var(--green2);font-weight:900;}
.lz-price-cta{display:block;text-align:center;text-decoration:none;font-family:Poppins,sans-serif;font-weight:800;font-size:14px;color:#fff;padding:13px 18px;border-radius:13px;background:linear-gradient(165deg,#12A85E,#0B6B3E);box-shadow:0 5px 14px rgba(12,122,70,.28);transition:filter .12s;}
.lz-price-cta:hover{filter:brightness(1.06);}
.lz-price-note{margin-top:20px;font-size:13px;color:var(--ink2);}
.lz-faq-list{max-width:660px;margin:26px auto 0;display:flex;flex-direction:column;gap:10px;text-align:left;}
.lz-faq details{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:15px 18px;}
.lz-faq summary{cursor:pointer;font-family:Poppins,sans-serif;font-weight:700;font-size:14.5px;color:var(--ink);}
.lz-faq p{font-size:13.5px;line-height:1.6;color:var(--ink2);margin:10px 0 2px;}
.lz-compare{max-width:920px;margin:72px auto 0;padding:0 26px;text-align:center;}
.lz-vsname{color:var(--green2,#12A85E);}
.lz-compare h2{font-family:Poppins,sans-serif;font-weight:800;font-size:clamp(24px,4vw,34px);letter-spacing:-.02em;margin:10px 0 8px;color:var(--ink);text-wrap:balance;}
.lz-compare-sub{font-size:15.5px;color:var(--ink2);margin:0 auto 30px;max-width:52ch;line-height:1.55;}
.lz-vs{display:grid;grid-template-columns:1fr 1fr;gap:16px;text-align:left;}
.lz-vs-col{border-radius:18px;padding:24px 22px;}
.lz-vs-col.them{background:var(--card);border:1px solid var(--line);box-shadow:0 2px 8px rgba(20,32,26,.05);}
.lz-vs-col.us{position:relative;overflow:hidden;isolation:isolate;color:#EAF4EE;
  background:repeating-linear-gradient(57deg,rgba(255,214,102,.06) 0 1px,transparent 1px 7px),repeating-linear-gradient(123deg,rgba(255,214,102,.05) 0 1px,transparent 1px 7px),linear-gradient(160deg,#0E5233,#0A3421 58%,#062417);
  border:1px solid rgba(231,200,121,.34);box-shadow:0 18px 44px rgba(8,42,26,.32);}
.lz-vs-h{font-family:Poppins,sans-serif;font-weight:800;font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:14px;}
.lz-vs-col.them .lz-vs-h{color:var(--ink2);}
.lz-vs-col.us .lz-vs-h{color:var(--gold-hi,#E7C879);}
.lz-vs-col ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:11px;}
.lz-vs-col li{position:relative;padding-left:26px;font-size:14px;line-height:1.45;}
.lz-vs-col.them li{color:var(--ink2);}
.lz-vs-col.them li::before{content:"–";position:absolute;left:6px;color:#B0A98E;font-weight:800;}
.lz-vs-col.us li{color:#EAF4EE;}
.lz-vs-col.us li::before{content:"✓";position:absolute;left:2px;color:#7FE0AC;font-weight:900;}
@media(max-width:600px){.lz-vs{grid-template-columns:1fr}}
/* GStyle rosettes — the app's spinning engine-turned gold spirographs,
   CSS-only so the public page stays light. Same family as the CTA medallion. */
.lz-rose{position:absolute;border-radius:50%;pointer-events:none;z-index:0;
  background:
    repeating-conic-gradient(from 0deg,rgba(231,200,121,.5) 0 1deg,transparent 1deg 5.6deg),
    repeating-conic-gradient(from 2deg,rgba(231,200,121,.3) 0 .6deg,transparent .6deg 9deg),
    repeating-radial-gradient(circle,rgba(231,200,121,.42) 0 1px,transparent 1px 9px);
  -webkit-mask:radial-gradient(circle,transparent 24%,#000 25% 60%,transparent 62%);
  mask:radial-gradient(circle,transparent 24%,#000 25% 60%,transparent 62%);
  animation:lz-medallion 44s linear infinite;}
.lz-hero{position:relative;}
.lz-rose-hero{right:-150px;top:-70px;width:430px;height:430px;opacity:.32;z-index:-1;
  background:
    repeating-conic-gradient(from 0deg,rgba(176,133,38,.4) 0 1deg,transparent 1deg 5.6deg),
    repeating-conic-gradient(from 2deg,rgba(12,122,70,.25) 0 .6deg,transparent .6deg 9deg),
    repeating-radial-gradient(circle,rgba(176,133,38,.32) 0 1px,transparent 1px 9px);}
.lz-rose-band{right:-100px;top:50%;width:400px;height:400px;margin-top:-200px;opacity:.5;}
.lz-rose-vs{right:-80px;bottom:-90px;width:280px;height:280px;opacity:.42;}
.lz-band-in>*{position:relative;z-index:1;}
.lz-band-in .lz-rose{z-index:0;}
.lz-vs-col.us>*{position:relative;z-index:1;}
.lz-vs-col.us .lz-rose{z-index:0;}
@media (prefers-reduced-motion:reduce){.lz-rose{animation:none}}
.lz-band{max-width:1000px;margin:64px auto 0;padding:0 26px;}
.lz-band-in{position:relative;isolation:isolate;overflow:hidden;text-align:center;border-radius:24px;padding:52px 32px;color:#EAF4EE;
  background:
    repeating-linear-gradient(57deg,rgba(255,214,102,.06) 0 1px,transparent 1px 7px),
    repeating-linear-gradient(123deg,rgba(255,214,102,.05) 0 1px,transparent 1px 7px),
    linear-gradient(160deg,#0E5233,#0A3421 55%,#072617);
  border:1px solid rgba(231,200,121,.34);box-shadow:0 24px 60px rgba(8,42,26,.4);}
.lz-band-in::before{content:"";position:absolute;inset:12px;border:1px solid rgba(255,210,74,.28);border-radius:16px;pointer-events:none;}
.lz-band-in h2{font-family:Poppins,sans-serif;font-weight:800;font-size:clamp(24px,4vw,34px);letter-spacing:-.02em;margin:0 0 12px;color:#F4EAC8;text-wrap:balance;}
.lz-band-in p{font-size:15.5px;color:rgba(220,240,225,.82);margin:0 auto 26px;max-width:480px;line-height:1.55;}
.lz-foot{max-width:1000px;margin:56px auto 0;padding:24px 26px 40px;display:flex;align-items:center;justify-content:space-between;
  border-top:1px solid var(--line);flex-wrap:wrap;gap:12px;}
.lz-copy{font-size:12.5px;color:var(--ink2);opacity:.8}
@media(max-width:820px){.lz-feats{grid-template-columns:1fr 1fr}}
@media(max-width:520px){.lz-feats{grid-template-columns:1fr}.lz-stats{gap:16px;padding:14px 18px}.lz-stats b{font-size:22px}}
`;
