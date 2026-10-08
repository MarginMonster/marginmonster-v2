/* Web front-door layout — the non-Shopify shell around dashboard, studio and
 * archive. Same engine, no Polaris/App Bridge; styled to match the landing. */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { getWebIdentity } from "../lib/web-auth.server";
import { tokensRemainingLive, planTrialing } from "../lib/tokens.server";
import { resolveTierKey, PLAN_BY_KEY, TOKEN_COST } from "../lib/plan-config";
import { totalXpForLevel } from "../lib/achievements";
import { Ico } from "../lib/icons";

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

  // Creation mode — "marketing" (sell your products) vs "casual" (just make cool
  // stuff + edit photos). A pure front-end reframe: it swaps copy and hides the
  // merchant-only surfaces, never touching billing or capability gates. Read
  // after mount (same discipline as the HUD) so SSR + first paint stay on the
  // default 'marketing' and the live paid experience never flips under a
  // merchant mid-hydration. Persisted per browser; see [emMode].
  const [mode, setMode] = useState<"marketing" | "casual">("marketing");
  useEffect(() => { try { const m = localStorage.getItem("emMode"); if (m === "casual" || m === "marketing") setMode(m); } catch { /* storage is a nicety */ } }, []);
  const chooseMode = (m: "marketing" | "casual") => { setMode(m); try { localStorage.setItem("emMode", m); } catch { /* ignore */ } };

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
              <Link className={tab(mode === "casual" ? "/web/create" : "/web")} to={mode === "casual" ? "/web/create" : "/web"}>{mode === "casual" ? "Home" : "Dashboard"}</Link>
              <Link className={tab("/web/studio")} to="/web/studio">Studio</Link>
              {/* Campaigns is a pure selling surface (scheduled ad runs) — hidden
                  in casual, where there's nothing being marketed. */}
              {mode === "marketing" && <Link className={tab("/web/campaigns")} to="/web/campaigns">Campaigns</Link>}
              <Link className={tab("/web/archive")} to={mode === "casual" ? "/web/archive?section=creator" : "/web/archive"}>{mode === "casual" ? "Gallery" : "Archive"}</Link>
              <Link className={tab("/web/connect")} to="/web/connect">{mode === "casual" ? "Share" : "Auto-posting"}</Link>
            </nav>
          )}
          <div className="wb-me">
            {authed && (
              <div className="wb-mode" role="group" aria-label="Creation mode">
                <button type="button" className={`wb-mode-opt${mode === "marketing" ? " on" : ""}`} aria-pressed={mode === "marketing"} onClick={() => chooseMode("marketing")} title="Sell your products — ads, campaigns, the works">Marketing</button>
                <button type="button" className={`wb-mode-opt${mode === "casual" ? " on" : ""}`} aria-pressed={mode === "casual"} onClick={() => chooseMode("casual")} title="Just make cool stuff & edit photos — no selling">Casual</button>
              </div>
            )}
            {authed
              ? <Link to="/web/logout" className="wb-out">Log out</Link>
              : <Link to="/web/login" className="wb-login">Log in</Link>}
          </div>
        </header>

        {/* Player HUD — the app's arcade status bar, ported to the web shell.
            Level, token reserve, XP to the next level and what the wallet
            currently affords, all in one glance. */}
        {authed && (
          <div className={`wb-hud${hudMin ? " min" : ""}${mode === "casual" ? " wb-hud-lite" : ""}`} aria-label="Player status">
            {hudMin ? (
              <button
                type="button" className="wb-hud-mini" onClick={toggleHud}
                title={`LVL ${hud.level} · ${hud.tokens.toLocaleString()} tokens — tap to expand`}
                aria-label="Expand player status"
              >
                <Crest size={22} />
                <span className="wb-hud-lvl">LVL {hud.level}</span>
                <span className="wb-hud-mini-tok"><Ico n="coin" /> {hud.tokens.toLocaleString()}</span>
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
                    <span><Ico n="coin" /> {hud.tokens.toLocaleString()}</span><b>Add tokens</b>
                  </Link>
                  {/* These are what the BALANCE AFFORDS, not what the merchant
                      owns — but the label said "3 Videos", which on the Archive
                      page sits inches from that page’s own "Videos · 9" tab and
                      reads as a count of their library. The only thing
                      distinguishing them was a title attribute, which does not
                      exist on touch. Say what the number means. */}
                  {/* "1 videos' worth" was live in the HUD the moment a trialist
                      made one 225-token video. Pluralise on the count. */}
                  <span className="wb-hud-stat" title="How many product videos your balance covers"><Ico n="video" /> {hud.videos} {hud.videos === 1 ? "video’s" : "videos’"} worth</span>
                  <span className="wb-hud-stat" title="How many image ads your balance covers"><Ico n="image" /> {hud.ads} {hud.ads === 1 ? "image’s" : "images’"} worth</span>
                </div>
              </>
            )}
          </div>
        )}

        <main className="wb-main">
          <Outlet context={{ mode, setMode: chooseMode }} />
        </main>
        <Buddy hud={hud} authed={authed} mode={mode} />
      </div>
    </>
  );
}

/* Helpurr — the AI helper. A floating sidekick with real character that
 * greets you by name, suggests what to make, and drops tappable buttons under
 * its replies that take you straight there. Talks to /api/buddy (Haiku behind a
 * hype persona). It can't click for you yet — the buttons are its hands. */
type MMAction = { label: string; to: string };
type MMMsg = { role: "user" | "assistant"; content: string; actions?: MMAction[] };
function Buddy({ hud, authed, mode }: { hud: { name: string; ads: number; level: number }; authed: boolean; mode: "marketing" | "casual" }) {
  const loc = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<MMMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Refresh a lone, not-yet-replied greeting when the mode flips, but never
    // wipe a started conversation — length stays 1, so this doesn't re-fire.
    if (open && (msgs.length === 0 || (msgs.length === 1 && msgs[0].role === "assistant"))) {
      const name = authed && hud.name ? hud.name.split(" ")[0] : null;
      const greet = mode === "casual"
        ? (name
            ? `Hey ${name}! 🐾 I'm Helpurr, your AI helper — got ${hud.ads} images' worth of tokens to play with. Want to edit a photo or make something fun to post?`
            : "Hey — I'm Helpurr 🐾 your AI helper. Upload a photo and we'll restyle it, swap the background, or make something fun to share.")
        : (name
            ? `Hey ${name}! 🐾 I'm Helpurr, your AI helper — you've got ${hud.ads} ads' worth of tokens in the tank. What are we making?`
            : "Hey — I'm Helpurr 🐾 your AI helper for ads & videos. Tell me what you're selling and let's make something scroll-stopping.");
      setMsgs([{ role: "assistant", content: greet }]);
    }
  }, [open, msgs.length, authed, hud.name, hud.ads, mode]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, busy]);
  // Let any page open the chat — the Creator home's "Ask Helpurr" card fires this.
  useEffect(() => {
    const h = (e: Event) => {
      setOpen(true);
      // The Creator home's Chat mode passes the typed prompt — prefill the box
      // so the user just hits send (we don't auto-send; let them confirm).
      const t = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (typeof t === "string" && t.trim()) setInput(t);
    };
    window.addEventListener("helpurr:open", h);
    return () => window.removeEventListener("helpurr:open", h);
  }, []);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    const next: MMMsg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const res = await fetch("/api/buddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), path: loc.pathname, mode }) });
      const data = await res.json().catch(() => ({ reply: "", actions: [] })) as { reply?: string; actions?: MMAction[] };
      setMsgs((m) => [...m, { role: "assistant", content: data.reply || "…", actions: Array.isArray(data.actions) ? data.actions : [] }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Connection blipped — mind trying again?" }]);
    } finally { setBusy(false); }
  };

  const go = (to: string) => { setOpen(false); if (to.startsWith("/web#")) { window.location.href = to; } else { nav(to); } };
  const chips = mode === "casual"
    ? ["Edit one of my photos", "Make a fun post", "Turn this into a sticker"]
    : ["Make me an ad", "Which format converts best?", "Give me an idea for a video"];

  return (
    <>
      <button type="button" className={`mm-fab${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)} aria-label="Chat with Helpurr, your AI helper">
        <Familiar />
        {!open && <span className="mm-fab-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="mm-panel" role="dialog" aria-label="Helpurr chat">
          <div className="mm-head">
            <span className="mm-head-crest"><Familiar think={busy} /></span>
            <div className="mm-head-txt"><b>Helpurr</b><span>{busy ? "thinking…" : "your AI helper 🐾"}</span></div>
            <button type="button" className="mm-x" onClick={() => setOpen(false)} aria-label="Close chat">×</button>
          </div>
          <div className="mm-list" ref={listRef}>
            {msgs.map((m, i) => (
              <div key={i} className={`mm-row ${m.role}`}>
                <div className={`mm-msg ${m.role}`}>{m.content}</div>
                {m.actions && m.actions.length > 0 && (
                  <div className="mm-acts">{m.actions.map((a) => <button key={a.to + a.label} type="button" className="mm-act" onClick={() => go(a.to)}>{a.label}</button>)}</div>
                )}
              </div>
            ))}
            {busy && <div className="mm-msg assistant mm-typing"><i /><i /><i /></div>}
            {msgs.length <= 1 && !busy && (
              <div className="mm-chips">{chips.map((c) => <button key={c} type="button" onClick={() => send(c)}>{c}</button>)}</div>
            )}
          </div>
          <form className="mm-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Helpurr…" aria-label="Message Helpurr" />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send">➤</button>
          </form>
        </div>
      )}
    </>
  );
}

/* Helpurr the familiar — a smart emerald PIXEL-ART cat (open-eyes sprite at
 * /familiar-px.png, eyes-closed frame at /familiar-px-blink.png) brought to life
 * with CSS: it idly bobs and breathes, blinks on its own by swapping frames, and
 * bursts gold pixel-sparks when tapped. Each instance self-animates on its own
 * rAF; honours prefers-reduced-motion (stays still). */
const FAM = { open: "/familiar-px.png", blink: "/familiar-px-blink.png?v=2", pawup: "/familiar-px-pawup.png", lick: "/familiar-px-lick.png" };
function famBurst(el: HTMLElement) {
  const img = el.querySelector("img.mm-fam-img") as HTMLImageElement | null;
  if (img) img.animate([{ filter: "brightness(1)" }, { filter: "brightness(1.4)" }, { filter: "brightness(1)" }], { duration: 400, easing: "ease-out" });
  const R = el.getBoundingClientRect();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, sp = document.createElement("span");
    sp.className = "mm-fam-spark";
    sp.style.left = R.width / 2 + "px"; sp.style.top = R.height * 0.45 + "px";
    el.appendChild(sp);
    const d = R.width * 0.52;
    sp.animate([{ transform: "translate(-50%,-50%) scale(1)", opacity: 1 }, { transform: `translate(${Math.cos(a) * d - 2}px, ${Math.sin(a) * d - 2}px) scale(.3)`, opacity: 0 }], { duration: 520 + Math.random() * 200, easing: "cubic-bezier(.2,.7,.3,1)" }).onfinish = () => sp.remove();
  }
}
function Familiar({ think }: { think?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const img = el.querySelector("img.mm-fam-img") as HTMLImageElement | null;
    if (!img) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    [FAM.blink, FAM.pawup, FAM.lick].forEach((s) => { const im = new Image(); im.src = s; }); // preload frames
    const ph = Math.random() * 6.28;
    let raf = 0;
    const t0 = performance.now();
    let nextAction = 2000 + Math.random() * 3000;
    let steps: { src: string; dur: number }[] | null = null, idx = 0, stepStart = 0;
    const frame = (now: number) => {
      const t = now - t0;
      const bob = Math.sin(t / 640 + ph) * 2.3, br = 1 + Math.sin(t / 1250 + ph) * 0.02;
      img.style.transform = `translateY(${bob.toFixed(2)}px) scale(${br.toFixed(3)})`;
      if (steps) {
        if (now - stepStart >= steps[idx].dur) {
          idx++;
          if (idx >= steps.length) { steps = null; img.src = FAM.open; nextAction = t + 2600 + Math.random() * 4000; }
          else { stepStart = now; img.src = steps[idx].src; }
        }
      } else if (t >= nextAction) {
        steps = Math.random() < 0.65
          ? [{ src: FAM.blink, dur: 150 }]
          : [{ src: FAM.pawup, dur: 200 }, { src: FAM.lick, dur: 260 }, { src: FAM.pawup, dur: 150 }, { src: FAM.lick, dur: 260 }, { src: FAM.pawup, dur: 170 }];
        idx = 0; stepStart = now; img.src = steps[0].src;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span className={`mm-fam${think ? " think" : ""}`} ref={ref} onClick={() => { if (ref.current) famBurst(ref.current); }}>
      <img className="mm-fam-img" src={FAM.open} alt="" draggable={false} />
    </span>
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
/* Font is linked from the document head (app/root.tsx). An @import here
   cost three sequential round trips before any text rendered in Poppins. */
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
/* Creation-mode pill — flips the whole app between selling (Marketing) and
   just-for-fun (Casual). Lives in the bar on every page so it reads as a true,
   readily-available switch rather than a buried setting. */
.wb-mode{display:inline-flex;padding:3px;border-radius:999px;background:var(--paper,#F4F1E6);border:1px solid var(--line);flex:0 0 auto;}
.wb-mode-opt{border:0;background:none;padding:6px 13px;border-radius:999px;font:inherit;font-size:12px;font-weight:800;letter-spacing:.02em;color:var(--ink2);cursor:pointer;line-height:1;white-space:nowrap;}
.wb-mode-opt.on{background:linear-gradient(135deg,var(--green,#12A85E),var(--green2,#0C7A46));color:#fff;box-shadow:0 1px 4px rgba(12,122,70,.3);}
.wb-mode-opt:not(.on):hover{color:var(--ink);}
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

/* ---- Creator-mode HUD: a cleaner, calmer take (Marketing keeps the full
   arcade HUD unchanged). Every element stays — this only slims the look:
   flat-white card, no gold-rosette glow, thinner bars, muted LVL badge,
   tighter spacing. LOGGED FOR REVERT: to restore the original, remove the
   wb-hud-lite class from the HUD div in WebLayout and delete this block;
   the pre-change version is git commit bfa35e9. ---- */
.wb-hud-lite{background:#fff;padding:11px 15px;
  box-shadow:0 1px 2px rgba(20,32,26,.05),0 12px 30px -18px rgba(20,32,26,.16);}
.wb-hud-lite::after{display:none;}
.wb-hud-lite .wb-hud-top{margin-bottom:8px;}
.wb-hud-lite .wb-hud-lvl{background:#F3F0E4;color:#7E5E13;border-color:rgba(176,133,38,.26);box-shadow:none;}
.wb-hud-lite .wb-hud-barlabel{margin:7px 0 3px;}
.wb-hud-lite .wb-hud-hp,.wb-hud-lite .wb-hud-xp{height:6px;}
.wb-hud-lite .wb-hud-stats{margin-top:9px;font-size:11.5px;}
.wb-hud-lite .wb-hud-toggle{border-color:var(--line);}

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
.wb-h1{font-family:Poppins,sans-serif;font-weight:800;font-size:clamp(24px,4vw,34px);letter-spacing:-.02em;margin:14px 0 6px;overflow-wrap:anywhere;}
.wb-sub{color:var(--ink2);font-size:14.5px;line-height:1.55;margin:0 0 24px;max-width:60ch;}
/* Cards were flat white inside a flat cream border. Now they carry a faint
   top-to-bottom warmth, a greener border line, and a hairline of white along
   the top edge — the thing that makes a panel read as a raised surface rather
   than a rectangle drawn on the page. */
.wb-card{background:linear-gradient(178deg,#FEFDF9,#F7F6EB);border:1px solid var(--line2);border-radius:18px;padding:22px;
  box-shadow:0 3px 12px rgba(20,32,26,.06),inset 0 1px 0 rgba(255,255,255,.8);}
.wb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;}
.wb-lbl{display:block;font-weight:700;font-size:12.5px;margin:14px 0 5px;color:var(--ink);}
/* 16px, not 14: iOS Safari auto-zooms the page on focus below 16px and
   never zooms back out, which broke signup and login on iPhone. */
.wb-in,.wb-sel,.wb-ta{width:100%;padding:12px 13px;border-radius:11px;border:1px solid var(--line);background:#fff;font:inherit;font-size:16px;color:var(--ink);}
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
/* Dimmed, not hidden: the merchant should still see the engines exist and
   why they aren't in play, rather than the row silently vanishing. */
.ws-engines.off{opacity:.45;}
.ws-enginenote{margin:0 0 8px;font-size:11.5px;line-height:1.45;color:var(--ink2);
  background:#FDF4E3;border:1px solid #E8D3A6;border-radius:9px;padding:8px 11px;}
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

/* ---- Helpurr — the AI helper (floating sidekick) ---- */
.mm-fab{position:fixed;z-index:10600;bottom:30px;right:20px;width:66px;height:66px;border:0;cursor:pointer;padding:0;background:transparent;transition:transform .15s;}
.mm-fab:hover{transform:translateY(-2px) scale(1.06);}
.mm-fab.open{transform:scale(.92);opacity:.95;}
/* Nudged up and out to the top-right corner — at top:4px/right:6px it sat on the
   cat's ear and read as an earring. Now it floats clear above the head as a badge. */
.mm-fab-dot{position:absolute;top:-2px;right:-3px;width:12px;height:12px;border-radius:50%;background:#F3D98C;border:2px solid #0B6B3E;pointer-events:none;z-index:4;box-shadow:0 1px 3px rgba(0,0,0,.25);}
/* ---- the familiar: a smart emerald pixel-art cat, floating + animated ---- */
.mm-fam{position:relative;display:grid;place-items:center;width:100%;height:100%;cursor:pointer;overflow:visible;}
.mm-fam-img{width:124%;height:124%;object-fit:contain;image-rendering:pixelated;will-change:transform;
  filter:drop-shadow(0 3px 4px rgba(10,40,26,.3));user-select:none;-webkit-user-drag:none;pointer-events:none;}
.mm-fam.think .mm-fam-img{filter:drop-shadow(0 3px 6px rgba(201,158,63,.55));}
.mm-fam-spark{position:absolute;width:5px;height:5px;border-radius:1px;background:#F3D98C;box-shadow:0 0 4px rgba(243,200,110,.9);pointer-events:none;z-index:3;}
@media (prefers-reduced-motion:reduce){.mm-fam-img{transform:none!important}}
.mm-panel{position:fixed;z-index:10600;bottom:94px;right:22px;width:min(360px,calc(100vw - 32px));height:min(520px,70vh);
  display:flex;flex-direction:column;border-radius:20px;overflow:hidden;background:linear-gradient(178deg,#FEFDF9,#F5F2E8);
  border:1px solid #D7DCCB;box-shadow:0 24px 60px rgba(10,20,14,.32),inset 0 1px 0 rgba(255,255,255,.8);
  animation:mmUp .28s cubic-bezier(.2,1.3,.4,1) both;}
@keyframes mmUp{from{opacity:0;transform:translateY(16px) scale(.96)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.mm-panel{animation:none}}
.mm-head{display:flex;align-items:center;gap:10px;padding:13px 14px;background:linear-gradient(168deg,#0E5233,#0A3421);color:#F4EAC8;}
.mm-head-crest{width:42px;height:42px;flex:0 0 auto;overflow:visible;}
.mm-head-txt{display:flex;flex-direction:column;line-height:1.2;min-width:0;}
.mm-head-txt b{font-family:Poppins,sans-serif;font-size:14.5px;}
.mm-head-txt span{font-size:11px;color:rgba(244,234,200,.72);}
.mm-x{margin-left:auto;background:none;border:0;color:rgba(244,234,200,.85);font-size:23px;line-height:1;cursor:pointer;padding:2px 5px;}
.mm-x:hover{color:#fff;}
.mm-list{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:9px;scrollbar-width:thin;}
.mm-msg{max-width:84%;padding:9px 13px;border-radius:15px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;}
.mm-msg.assistant{align-self:flex-start;background:#fff;border:1px solid #E1DECD;color:#14201A;border-bottom-left-radius:5px;}
.mm-msg.user{align-self:flex-end;background:linear-gradient(168deg,#12A85E,#0B6B3E);color:#fff;border-bottom-right-radius:5px;}
.mm-row{display:flex;flex-direction:column;gap:7px;}
.mm-row.user{align-items:flex-end;}
.mm-row.assistant{align-items:flex-start;}
.mm-acts{display:flex;flex-wrap:wrap;gap:6px;max-width:92%;}
.mm-act{font:inherit;font-size:12.5px;font-weight:700;color:#fff;cursor:pointer;border:0;border-radius:999px;padding:8px 15px;
  background:linear-gradient(168deg,#12A85E,#0B6B3E);box-shadow:0 2px 8px rgba(12,122,70,.26),inset 0 0 0 1px rgba(231,200,121,.3);}
.mm-act:hover{filter:brightness(1.07);transform:translateY(-1px);}
.mm-typing{display:flex;gap:4px;align-items:center;}
.mm-typing i{width:7px;height:7px;border-radius:50%;background:#9CCBB1;animation:mmBlink 1.2s infinite both;}
.mm-typing i:nth-child(2){animation-delay:.2s}.mm-typing i:nth-child(3){animation-delay:.4s}
@keyframes mmBlink{0%,60%,100%{opacity:.3}30%{opacity:1}}
@media (prefers-reduced-motion:reduce){.mm-typing i{animation:none;opacity:.6}}
.mm-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;}
.mm-chips button{font:inherit;font-size:12px;font-weight:600;color:#0C7A46;background:#EAF6EF;border:1px solid #BFE2CD;border-radius:999px;padding:6px 11px;cursor:pointer;}
.mm-chips button:hover{background:#DCF0E5;}
.mm-input{display:flex;gap:8px;padding:11px;border-top:1px solid #E1DECD;background:#FDFCF7;}
.mm-input input{flex:1;border:1px solid #D7DCCB;border-radius:999px;padding:10px 15px;font:inherit;font-size:16px;background:#fff;color:#14201A;outline:none;}
.mm-input input:focus{border-color:#12A85E;}
.mm-input button{flex:0 0 auto;width:42px;border:0;border-radius:50%;background:linear-gradient(168deg,#12A85E,#0B6B3E);color:#fff;font-size:14px;cursor:pointer;}
.mm-input button:disabled{opacity:.4;cursor:not-allowed;}
@media(max-width:620px){.mm-fab{bottom:30px;right:16px;width:56px;height:56px}.mm-panel{bottom:92px;right:16px;height:72vh}}
`;
