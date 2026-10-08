/* Creator home — the CREATOR section's own front door (Marketing keeps
 * web._index as its dashboard). A premium, DeepAI-style prompt-first hub in
 * EASYMODE's green-on-cream theme: a confident hero, one "Ask anything" bar with
 * mode tabs (Image · Edit · Video · Music · Chat) that deep-link into the
 * Studio's casual flows (?do=…&prompt=…), Chat opens Helpurr, and a strip of
 * your most recent Gallery pieces. All features intact — just world-class
 * execution. Casual mode is the section switch; the nav routes "Home" here. */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useNavigate } from "@remix-run/react";
import { useState, type ReactNode } from "react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";
import { tokensRemainingLive } from "../lib/tokens.server";

export const meta = () => [{ title: "Create · EasyMode" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { account, shop } = await requireWebIdentity(request);
  // Your most recent CREATOR pieces only — tagged section:"creator" at
  // generation (see the Archive split). Marketing content never shows here.
  const recent = await db.asset.findMany({
    where: { shopId: shop.id, type: { in: ["IMAGE_AD", "VIDEO_AD", "AUDIO"] }, metaJson: { contains: '"section":"creator"' } },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, type: true, bodyJson: true, title: true },
  });
  const pieces = recent
    .map((a) => {
      let b: { videoUrl?: string; imageUrl?: string; audioUrl?: string } = {};
      try { b = JSON.parse(a.bodyJson || "{}"); } catch { /* ignore */ }
      return { id: a.id, isVideo: a.type === "VIDEO_AD", isAudio: a.type === "AUDIO", media: b.videoUrl || b.imageUrl || b.audioUrl || null, title: a.title || "Untitled" };
    })
    .filter((p) => !!p.media)
    .slice(0, 6);

  return json({
    name: (account.name?.trim()?.split(" ")[0]) || account.email.split("@")[0],
    tokens: tokensRemainingLive(shop.activePlan),
    hasPlan: !!shop.activePlan?.active,
    pieces,
  });
};

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const ICON: Record<string, ReactNode> = {
  create: <svg viewBox="0 0 24 24" {...S}><rect x="3" y="4.5" width="18" height="15" rx="2.6" /><circle cx="8.4" cy="9.6" r="1.5" /><path d="m4 16.5 4.6-4.2 3.3 3 3-2.4 5.1 4.2" /></svg>,
  faceless: <svg viewBox="0 0 24 24" {...S}><rect x="3" y="4.5" width="14" height="11" rx="2" /><path d="M17 8.4 20.5 6v8l-3.5-2.4" /><path d="M6.5 8.5h5M6.5 11.5h3" /></svg>,
  edit: <svg viewBox="0 0 24 24" {...S}><path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.8-2.8L5 17v3z" /><path d="M13.5 6.5l4 4" /></svg>,
  video: <svg viewBox="0 0 24 24" {...S}><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="m10 9.5 5 2.5-5 2.5z" /></svg>,
  music: <svg viewBox="0 0 24 24" {...S}><path d="M9 17.4V6.2l9-1.8v11.2" /><circle cx="6.8" cy="17.6" r="2.4" /><circle cx="15.8" cy="15.6" r="2.4" /></svg>,
  chat: <svg viewBox="0 0 24 24" {...S}><path d="M4 5h16v11H8l-4 3.5z" /></svg>,
};

// DeepAI-style mode tabs over one "Ask anything" bar. Image/Edit/Video/Music
// deep-link into the Studio's casual flows with the prompt prefilled; Chat opens
// Helpurr. Edit uploads its photo in the Studio.
type Mode = { key: string; label: string; ph: string };
const MODES: Mode[] = [
  { key: "faceless", label: "Faceless video", ph: "5 mind-blowing facts about the deep ocean…" },
  { key: "create", label: "Image", ph: "a red panda astronaut floating over neon Tokyo at night…" },
  { key: "edit", label: "Edit", ph: "make the shirt a purple hoodie and add a camera… (you'll add your photo next)" },
  { key: "video", label: "Video", ph: "a cozy 5-second clip of my product on a sunlit desk…" },
  { key: "music", label: "Music", ph: "upbeat lo-fi hip-hop with mellow piano and a soft beat…" },
  { key: "chat", label: "Chat", ph: "ask Helpurr anything — ideas, captions, what to make…" },
];

export default function CreatorHome() {
  const { name, tokens, hasPlan, pieces } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [mode, setMode] = useState("create");
  const [prompt, setPrompt] = useState("");
  const active = MODES.find((m) => m.key === mode) || MODES[0];
  const isChat = mode === "chat";

  function go() {
    const text = prompt.trim();
    if (isChat) {
      try { window.dispatchEvent(new CustomEvent("helpurr:open", { detail: { text } })); } catch { /* ignore */ }
      return;
    }
    const q = text ? `&prompt=${encodeURIComponent(text)}` : "";
    navigate(`/web/studio?do=${mode}${q}`);
  }

  return (
    <div className="cr">
      <style dangerouslySetInnerHTML={{ __html: CR_CSS }} />

      <div className="cr-hero">
        <span className="cr-greet">
          <span className="cr-greet-av" aria-hidden="true"><img src="/familiar-px.png?v=2" alt="" /></span>
          Helpurr&apos;s ready <span className="cr-greet-dot" aria-hidden="true" />
        </span>
        <h1 className="cr-h1">What will you <span className="cr-accent">create</span>, {name}?</h1>
        <p className="cr-sub">
          {hasPlan
            ? <>Describe it, pick a mode, and we&apos;ll make it — images, edits, video, music, or a quick chat.</>
            : <>Describe it, pick a mode, and we&apos;ll make it. <Link to="/web#plans">Pick a plan</Link> to start.</>}
        </p>
      </div>

      <div className="cr-modes" role="tablist" aria-label="What to make">
        {MODES.map((m) => (
          <button type="button" key={m.key} role="tab" aria-selected={mode === m.key}
            className={`cr-mode${mode === m.key ? " on" : ""}`} onClick={() => setMode(m.key)}>
            {ICON[m.key]} {m.label}
          </button>
        ))}
      </div>

      <div className="cr-ask">
        <textarea
          className="cr-askin"
          rows={1}
          value={prompt}
          placeholder={active.ph}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }}
        />
        <button type="button" className="cr-go" onClick={go} disabled={!isChat && !prompt.trim()}>
          {isChat ? "Ask Helpurr" : "Make it"}
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13" /><path d="m12 5 7 7-7 7" /></svg>
        </button>
      </div>
      <p className="cr-hint">Press Enter to generate · Shift+Enter for a new line</p>

      <div className="cr-quick">
        <Link to="/web/archive?section=creator" className="cr-ql">
          <svg viewBox="0 0 24 24" {...S}><rect x="3" y="4.5" width="18" height="15" rx="2.6" /><circle cx="8.4" cy="9.6" r="1.5" /><path d="m4 16.5 4.6-4.2 3.3 3 3-2.4 5.1 4.2" /></svg>
          My Gallery
        </Link>
      </div>

      {pieces.length > 0 ? (
        <div className="cr-recent">
          <div className="cr-recent-hd">
            <b>Recently made</b>
            <Link to="/web/archive?section=creator" className="cr-recent-all">See all →</Link>
          </div>
          <div className="cr-recent-row">
            {pieces.map((p) => (
              <Link key={p.id} to={`/web/archive?section=creator${p.isAudio ? "&tab=music" : p.isVideo ? "&tab=video" : "&tab=image"}`} className="cr-piece" title={p.title}>
                {p.isAudio
                  ? <span className="cr-piece-media cr-piece-audio">{ICON.music}</span>
                  : p.isVideo
                    ? <video src={p.media!} className="cr-piece-media" muted playsInline preload="metadata" />
                    : <span className="cr-piece-media cr-piece-img" style={{ backgroundImage: `url(${p.media})` }} />}
                {(p.isVideo || p.isAudio) && <span className="cr-piece-play" aria-hidden="true">▶</span>}
                <span className="cr-piece-tag">{p.isAudio ? "Music" : p.isVideo ? "Video" : "Image"}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <p className="cr-empty">Nothing in your gallery yet — type something above and make your first one.</p>
      )}

      <p className="cr-foot">
        <span className="cr-coin" aria-hidden="true">◎</span> {hasPlan ? `${tokens.toLocaleString("en-US")} tokens` : "No plan yet"} · <Link to="/web#plans">Get more</Link>
      </p>
    </div>
  );
}

const CR_CSS = `
.cr{--cr-card:#fff;--cr-line:#E7E2D2;--cr-ink:#14201A;--cr-ink2:#5B6B61;--cr-ink3:#8A968E;--cr-green:#0C7A46;--cr-green2:#12A85E;--cr-gold:#B08526;
  --cr-sh-sm:0 1px 2px rgba(20,32,26,.05);--cr-sh-md:0 2px 6px rgba(20,32,26,.05),0 14px 34px -14px rgba(20,32,26,.16);--cr-sh-lg:0 2px 8px rgba(20,32,26,.06),0 26px 60px -22px rgba(20,32,26,.2);
  max-width:860px;margin:0 auto;padding:14px 0 56px;}
.cr-hero{text-align:center;padding:14px 0 6px;}
.cr-greet{display:inline-flex;align-items:center;gap:9px;background:var(--cr-card);border:1px solid var(--cr-line);border-radius:999px;padding:5px 14px 5px 6px;box-shadow:var(--cr-sh-sm);font-size:12.5px;font-weight:600;color:var(--cr-ink2);margin-bottom:18px;}
.cr-greet-av{width:24px;height:24px;border-radius:50%;overflow:hidden;background:linear-gradient(135deg,#1B6D46,#0C7A46);display:grid;place-items:center;flex:0 0 auto;}
.cr-greet-av img{width:118%;height:118%;object-fit:contain;image-rendering:pixelated;}
.cr-greet-dot{width:7px;height:7px;border-radius:50%;background:var(--cr-green2);box-shadow:0 0 0 3px rgba(18,168,94,.18);}
.cr-h1{font-family:Poppins,sans-serif;font-weight:800;font-size:38px;line-height:1.06;letter-spacing:-.025em;margin:0 0 12px;color:var(--cr-ink);}
.cr-accent{background:linear-gradient(120deg,var(--cr-green2),var(--cr-green));-webkit-background-clip:text;background-clip:text;color:transparent;}
.cr-sub{margin:0 auto;max-width:470px;font-size:15px;line-height:1.5;color:var(--cr-ink2);}
.cr-sub a{color:var(--cr-green);font-weight:700;}
.cr-modes{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:26px 0 14px;}
.cr-mode{display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:999px;cursor:pointer;font:inherit;font-family:Poppins,sans-serif;font-weight:700;font-size:13.5px;color:var(--cr-ink2);background:var(--cr-card);border:1px solid var(--cr-line);box-shadow:var(--cr-sh-sm);transition:transform .12s,box-shadow .12s,border-color .12s,color .12s;}
.cr-mode svg{width:16px;height:16px;}
.cr-mode:hover{color:var(--cr-ink);transform:translateY(-1px);box-shadow:var(--cr-sh-md);}
.cr-mode.on{position:relative;isolation:isolate;overflow:hidden;color:#fff;border-color:transparent;box-shadow:0 4px 14px rgba(12,122,70,.3);
  background:linear-gradient(100deg,#12A85E 42%,#0A6A3D 82%,#075530);}
/* Gold flower — the engine-turned rosette masked gold, bleeding off the right
   like the app's green buttons; held far out so it stays a corner flourish. */
.cr-mode.on::after{content:"";position:absolute;z-index:-1;top:50%;right:-66px;width:104px;height:104px;margin-top:-52px;pointer-events:none;
  background:#FFD24A;-webkit-mask:url(/gstyle-rosette.svg) center/contain no-repeat;mask:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.5;animation:wbDrift 60s linear infinite;}
.cr-ask{position:relative;isolation:isolate;overflow:hidden;display:flex;align-items:flex-end;gap:12px;background:var(--cr-card);border:1px solid var(--cr-line);border-radius:22px;padding:14px;box-shadow:var(--cr-sh-lg),inset 0 0 0 1px rgba(231,200,121,.26);}
/* The gold cut of the rosette bleeding off the prompt bar's right edge — the
   app's Autopilot/HUD card treatment, the "spinning gold" signature. */
.cr-ask::after{content:"";position:absolute;z-index:-1;top:50%;right:-78px;width:234px;height:234px;margin-top:-117px;
  background:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.13;pointer-events:none;animation:wbDrift 160s linear infinite;}
/* The actual type-here field — a recessed cream well so the text sits IN a box,
   not floating on the white card. */
.cr-askin{flex:1;outline:0;resize:none;font:inherit;font-size:16px;line-height:1.5;color:var(--cr-ink);
  background:#F4F1E6;border:1px solid #E2DCC8;border-radius:14px;padding:12px 15px;min-height:58px;max-height:170px;
  box-shadow:inset 0 1px 3px rgba(20,32,26,.055);transition:border-color .15s,box-shadow .15s;
  overflow-y:auto;scrollbar-width:none;}
.cr-askin::-webkit-scrollbar{width:0;height:0;}
.cr-askin:focus{border-color:#9CCBB1;box-shadow:inset 0 1px 3px rgba(20,32,26,.045),0 0 0 3px rgba(12,122,70,.14);}
.cr-askin::placeholder{color:var(--cr-ink3);}
.cr-go{position:relative;isolation:isolate;overflow:hidden;flex:0 0 auto;display:inline-flex;align-items:center;gap:8px;border:0;cursor:pointer;font:inherit;font-family:Poppins,sans-serif;font-weight:800;font-size:14.5px;color:#fff;padding:13px 22px;border-radius:15px;transition:transform .1s,box-shadow .1s,filter .1s;
  /* Dark-right gradient so the gold rosette reads (gold on flat bright green vanishes). */
  background:linear-gradient(100deg,#12A85E 38%,#0A6A3D 78%,#075530),linear-gradient(165deg,#12A85E,#0B6B3E);
  box-shadow:0 4px 14px rgba(12,122,70,.32),inset 0 0 0 1px rgba(231,200,121,.34);}
/* Gold hairline ruled inside the edge + the masked-gold rosette turning behind
   the label where it bleeds off the right — the app's full CTA treatment. */
.cr-go::before{content:"";position:absolute;inset:4px;border:1px solid rgba(255,210,74,.42);border-radius:11px;pointer-events:none;}
.cr-go::after{content:"";position:absolute;z-index:-1;top:50%;right:-82px;width:150px;height:150px;margin-top:-75px;pointer-events:none;
  background:#FFD24A;-webkit-mask:url(/gstyle-rosette.svg) center/contain no-repeat;mask:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.55;animation:wbDrift 60s linear infinite;}
.cr-go:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 20px rgba(12,122,70,.36),inset 0 0 0 1px rgba(231,200,121,.34);filter:brightness(1.04);}
.cr-go:disabled{opacity:.4;cursor:not-allowed;box-shadow:none;}
.cr-go svg{width:17px;height:17px;}
.cr-hint{text-align:center;font-size:12.5px;color:var(--cr-ink3);margin:12px 0 0;}
.cr-quick{display:flex;flex-wrap:wrap;justify-content:center;gap:9px;margin:20px 0 0;}
.cr-ql{display:inline-flex;align-items:center;gap:7px;text-decoration:none;font-family:Poppins,sans-serif;font-weight:600;font-size:12.5px;color:var(--cr-ink2);background:rgba(255,255,255,.6);border:1px solid var(--cr-line);padding:8px 14px;border-radius:999px;transition:all .12s;}
.cr-ql svg{width:15px;height:15px;}
.cr-ql:hover{color:var(--cr-green);border-color:#9CCBB1;background:#fff;}
.cr-recent{margin-top:46px;}
.cr-recent-hd{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;}
.cr-recent-hd b{font-family:Poppins,sans-serif;font-weight:700;font-size:15px;letter-spacing:-.01em;color:var(--cr-ink);}
.cr-recent-all{font-family:Poppins,sans-serif;font-weight:600;font-size:12.5px;color:var(--cr-green);text-decoration:none;}
.cr-recent-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:12px;}
.cr-piece{position:relative;display:block;aspect-ratio:1;border-radius:16px;overflow:hidden;border:1px solid var(--cr-line);box-shadow:var(--cr-sh-sm);transition:transform .14s,box-shadow .14s;}
.cr-piece:hover{transform:translateY(-3px);box-shadow:var(--cr-sh-md);}
.cr-piece-media{display:block;width:100%;height:100%;object-fit:cover;}
.cr-piece-img{background-size:cover;background-position:center;}
.cr-piece-audio{display:grid;place-items:center;background:linear-gradient(150deg,#1B6D46,#14201A);color:#EAF6EF;}
.cr-piece-audio svg{width:26px;height:26px;}
.cr-piece-tag{position:absolute;left:8px;bottom:8px;font-family:Poppins,sans-serif;font-weight:700;font-size:10.5px;color:#fff;background:rgba(12,18,14,.55);padding:3px 8px;border-radius:999px;}
.cr-piece-play{position:absolute;inset:0;margin:auto;width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:rgba(255,255,255,.22);color:#fff;font-size:13px;}
.cr-empty{margin-top:30px;padding:20px;border-radius:16px;background:rgba(255,255,255,.55);border:1px dashed var(--cr-line);font-size:13.5px;color:var(--cr-ink2);text-align:center;}
.cr-foot{margin-top:30px;text-align:center;font-size:12.5px;font-weight:600;color:var(--cr-gold);}
.cr-coin{color:var(--cr-gold);}
.cr-foot a{color:var(--cr-green);font-weight:700;text-decoration:none;}
@media(prefers-reduced-motion:reduce){.cr-ask::after,.cr-go::after,.cr-mode.on::after{animation:none;}}
@media(max-width:620px){
  .cr-h1{font-size:29px;}
  .cr-ask{flex-direction:column;align-items:stretch;border-radius:18px;padding:14px;}
  .cr-go{justify-content:center;}
  .cr-recent-row{grid-template-columns:repeat(3,1fr);}
}
`;
