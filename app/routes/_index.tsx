import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Embedded / install traffic always carries a shop param → send to the
  // embedded app area (/app), which performs the App Bridge token exchange.
  // (Redirecting to /auth here breaks fresh installs — it returns null.)
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // No shop param → the public marketing page (also serves as the health check).
  return json({ listingUrl: process.env.SHOPIFY_APP_LISTING_URL || "https://apps.shopify.com" });
};

const FEATURES = [
  { icon: "🎬", title: "UGC videos that sell", body: "AI presenters hold your product and talk it up — vertical-formatted for TikTok, Reels & Shorts." },
  { icon: "✍️", title: "SEO blogs on autopilot", body: "Buyer-intent articles written and published to your store, pulling in free Google traffic month after month." },
  { icon: "📣", title: "Auto-posted for you", body: "Every drop goes out to TikTok, Instagram & Facebook on a schedule — captions and hashtags written to travel." },
  { icon: "🪄", title: "One-tap autopilot", body: "Pick a goal. EasyMode builds a full month of content, launches it, and scales what works." },
];

export default function Index() {
  const { listingUrl } = useLoaderData<typeof loader>();
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="lz">
        <header className="lz-nav">
          <div className="lz-brand">
            <img src="/easymode-head.png" width="34" height="27" alt="" style={{ imageRendering: "pixelated", objectFit: "contain" }} />
            <span>Easy<b>Mode</b></span>
          </div>
          <a className="lz-navcta" href={listingUrl}>Install</a>
        </header>

        <main className="lz-hero">
          <span className="lz-eyebrow">Marketing on easy mode</span>
          <h1>Your whole store&apos;s marketing, <span className="lz-grad">running itself.</span></h1>
          <p className="lz-sub">
            EasyMode turns your products into videos, image ads and SEO blogs — then posts
            them to your socials on a schedule. You approve, it ships. All from inside Shopify.
          </p>
          <div className="lz-ctas">
            <a className="lz-cta" href={listingUrl}><span className="lz-arr-w">Start free — 7-day trial<span className="lz-arr">→</span></span></a>
            <span className="lz-note">No card for the trial · cancel anytime</span>
          </div>

          <div className="lz-stats">
            <div><b>4</b><span>content types</span></div>
            <div className="lz-div" />
            <div><b>3</b><span>social channels</span></div>
            <div className="lz-div" />
            <div><b>$19</b><span>to start</span></div>
          </div>
        </main>

        <section className="lz-feats">
          {FEATURES.map((f) => (
            <div className="lz-card" key={f.title}>
              <div className="lz-ic">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </section>

        <section className="lz-band">
          <div className="lz-band-in">
            <h2>Made for founders who don&apos;t have a marketing team.</h2>
            <p>Set it up in a couple of minutes. Wake up to finished content, posted and working.</p>
            <a className="lz-cta gold" href={listingUrl}><span className="lz-arr-w">Get EasyMode<span className="lz-arr">→</span></span></a>
          </div>
        </section>

        <footer className="lz-foot">
          <div className="lz-brand small">
            <img src="/easymode-head.png" width="26" height="20" alt="" style={{ imageRendering: "pixelated", objectFit: "contain" }} />
            <span>Easy<b>Mode</b><i>.io</i></span>
          </div>
          <span className="lz-copy">AI marketing autopilot for Shopify.</span>
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
.lz-feats{max-width:1000px;margin:56px auto 0;padding:0 26px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px;}
.lz-card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px 20px;box-shadow:0 2px 8px rgba(20,32,26,.05);
  transition:transform .12s,border-color .12s,box-shadow .12s;}
.lz-card:hover{transform:translateY(-4px);border-color:var(--green2);box-shadow:0 16px 40px rgba(12,122,70,.14)}
.lz-ic{width:46px;height:46px;display:grid;place-items:center;font-size:23px;border-radius:13px;margin-bottom:14px;
  background:rgba(12,122,70,.09);box-shadow:inset 0 0 0 1px rgba(12,122,70,.2);}
.lz-card h3{font-family:Poppins,sans-serif;font-weight:700;font-size:16px;margin:0 0 7px;letter-spacing:-.01em;color:var(--ink);}
.lz-card p{font-size:13.5px;line-height:1.55;color:var(--ink2);margin:0;}
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
