/* Creator home — the CREATOR section's own front door (the Marketing section
 * keeps web._index as its dashboard). A DeepAI-style "what do you want to make?"
 * hub, in EASYMODE's green-on-cream theme: a warm hero with Helpurr, big tool
 * cards that deep-link into the Studio's casual flows (?do=…), and a strip of
 * your most recent Gallery pieces. No merchant/dashboard machinery — this is the
 * fun, personal side. Casual mode is the section switch; the nav routes "Home"
 * here when it's on. */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useNavigate } from "@remix-run/react";
import { useState } from "react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";
import { tokensRemainingLive } from "../lib/tokens.server";
import { Ico } from "../lib/icons";

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

// DeepAI-style mode tabs over one "Ask anything" box. Image/Edit/Video/Music
// deep-link into the Studio's casual flows with the prompt prefilled (?do=…
// &prompt=…); Chat opens Helpurr. Edit uploads its photo in the Studio.
type Mode = { key: string; emoji: string; label: string; ph: string };
const MODES: Mode[] = [
  { key: "create", emoji: "✨", label: "Image", ph: "a red panda astronaut floating over neon Tokyo at night…" },
  { key: "edit", emoji: "🎨", label: "Edit", ph: "make the shirt a purple hoodie and add a camera… (you'll add your photo next)" },
  { key: "video", emoji: "🎬", label: "Video", ph: "a cozy 5-second clip of my product on a sunlit desk…" },
  { key: "music", emoji: "🎵", label: "Music", ph: "upbeat lo-fi hip-hop with mellow piano and a soft beat…" },
  { key: "chat", emoji: "🐾", label: "Chat", ph: "ask Helpurr anything — ideas, captions, what to make…" },
];

// Secondary entry points not covered by a prompt tab.
const QUICK = [
  { key: "presenter", emoji: "🧑", title: "With a presenter", to: "/web/studio?do=presenter" },
  { key: "gallery", emoji: "🖼", title: "My Gallery", to: "/web/archive?section=creator" },
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
        <span className="cr-hero-cat" aria-hidden="true"><img src="/familiar-px.png?v=2" alt="" /></span>
        <div className="cr-hero-txt">
          <h1 className="cr-h1">Hey {name} — what are we making? 🐾</h1>
          <p className="cr-sub">
            Type what you want, pick a mode, go.
            {hasPlan ? <> You&apos;ve got <b>{tokens.toLocaleString("en-US")}</b> tokens to play with.</> : <> <Link to="/web#plans">Pick a plan</Link> to start.</>}
          </p>
        </div>
      </div>

      {/* Prompt-first surface: mode tabs + one "Ask anything" box. */}
      <div className="cr-make">
        <div className="cr-modes" role="tablist" aria-label="What to make">
          {MODES.map((m) => (
            <button type="button" key={m.key} role="tab" aria-selected={mode === m.key}
              className={`cr-mode${mode === m.key ? " on" : ""}`} onClick={() => setMode(m.key)}>
              <span aria-hidden="true">{m.emoji}</span> {m.label}
            </button>
          ))}
        </div>
        <div className="cr-ask">
          <textarea
            className="cr-askin"
            rows={2}
            value={prompt}
            placeholder={active.ph}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }}
          />
          <button type="button" className="cr-go" onClick={go} disabled={!isChat && !prompt.trim()}>
            {isChat ? "Ask Helpurr 🐾" : "Make it →"}
          </button>
        </div>
        <div className="cr-quick">
          {QUICK.map((q) => (
            <Link key={q.key} to={q.to} className="cr-quicklink"><span aria-hidden="true">{q.emoji}</span> {q.title}</Link>
          ))}
        </div>
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
                  ? <span className="cr-piece-media cr-piece-audio"><Ico n="music" size={26} /></span>
                  : p.isVideo
                    ? <video src={p.media!} className="cr-piece-media" muted playsInline preload="metadata" />
                    : <span className="cr-piece-media" style={{ backgroundImage: `url(${p.media})` }} />}
                {(p.isVideo || p.isAudio) && <span className="cr-piece-play" aria-hidden="true"><Ico n="play" size={16} /></span>}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <p className="cr-empty">Nothing in your gallery yet — type something above and make your first one. ✨</p>
      )}

      <p className="cr-foot">
        <Ico n="coin" /> {hasPlan ? `${tokens.toLocaleString("en-US")} tokens` : "No plan yet"} · <Link to="/web#plans">Get more</Link>
      </p>
    </div>
  );
}

const CR_CSS = `
.cr{max-width:1080px;margin:0 auto;padding:4px 0 40px}
.cr-hero{display:flex;align-items:center;gap:16px;margin:2px 0 22px;padding:18px 20px;border-radius:20px;
  background:linear-gradient(135deg,#F0FAF4,#FBFAF2);border:1px solid var(--line,#E4DFCF);
  box-shadow:0 3px 14px rgba(20,32,26,.06),inset 0 0 0 1px rgba(231,200,121,.22)}
.cr-hero-cat{flex:0 0 auto;width:64px;height:64px;display:grid;place-items:center}
.cr-hero-cat img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated;filter:drop-shadow(0 2px 4px rgba(20,32,26,.25))}
.cr-h1{margin:0;font-family:Poppins,sans-serif;font-weight:800;font-size:22px;line-height:1.15;color:var(--ink,#14201A)}
.cr-sub{margin:6px 0 0;font-size:14px;color:var(--ink2,#4A554E)}
.cr-sub a{color:var(--green,#0C7A46);font-weight:700}
.cr-make{padding:16px 16px 14px;border-radius:20px;background:var(--card,#FDFCF7);border:1px solid var(--line,#E4DFCF);box-shadow:0 3px 14px rgba(20,32,26,.06)}
.cr-modes{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.cr-mode{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;cursor:pointer;font:inherit;
  font-family:Poppins,sans-serif;font-weight:700;font-size:13.5px;color:var(--ink2,#4A554E);
  background:var(--paper,#F4F1E6);border:1px solid var(--line,#E4DFCF);transition:all .12s}
.cr-mode:hover{border-color:#9CCBB1}
.cr-mode.on{background:var(--green,#0C7A46);color:#fff;border-color:var(--green,#0C7A46);box-shadow:0 2px 8px rgba(12,122,70,.28)}
.cr-ask{display:flex;gap:10px;align-items:stretch}
.cr-askin{flex:1;resize:none;padding:14px 16px;border-radius:14px;border:1px solid var(--line,#E4DFCF);background:#fff;
  font:inherit;font-size:15px;line-height:1.4;color:var(--ink,#14201A);outline:none;transition:border-color .12s,box-shadow .12s}
.cr-askin:focus{border-color:#9CCBB1;box-shadow:0 0 0 3px rgba(12,122,70,.12)}
.cr-askin::placeholder{color:#9AA69E}
.cr-go{flex:0 0 auto;align-self:stretch;padding:0 22px;border:0;border-radius:14px;cursor:pointer;
  font-family:Poppins,sans-serif;font-weight:800;font-size:14.5px;color:#fff;background:var(--green,#0C7A46);
  box-shadow:0 2px 10px rgba(12,122,70,.3);transition:transform .1s,box-shadow .1s,opacity .1s}
.cr-go:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 16px rgba(12,122,70,.34)}
.cr-go:disabled{opacity:.45;cursor:not-allowed}
.cr-quick{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.cr-quicklink{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--ink2,#4A554E);
  text-decoration:none;padding:6px 12px;border-radius:999px;background:var(--paper,#F4F1E6);border:1px solid var(--line,#E4DFCF);transition:border-color .12s,color .12s}
.cr-quicklink:hover{border-color:#9CCBB1;color:var(--green,#0C7A46)}
.cr-recent{margin-top:26px}
.cr-recent-hd{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px}
.cr-recent-hd b{font-family:Poppins,sans-serif;font-weight:800;font-size:15px;color:var(--ink,#14201A)}
.cr-recent-all{font-size:12.5px;font-weight:700;color:var(--green,#0C7A46);text-decoration:none}
.cr-recent-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}
.cr-piece{position:relative;display:block;border-radius:14px;overflow:hidden;aspect-ratio:1/1;border:1px solid var(--line,#E4DFCF);background:#EFEADB}
.cr-piece-media{display:block;width:100%;height:100%;object-fit:cover;background-size:cover;background-position:center}
.cr-piece-audio{display:grid;place-items:center;background:linear-gradient(150deg,#0C7A46,#14201A);color:#F4F1E6}
.cr-piece-play{position:absolute;inset:0;margin:auto;width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:rgba(12,18,14,.5);color:#fff}
.cr-empty{margin-top:24px;padding:18px;border-radius:16px;background:var(--paper,#F4F1E6);border:1px dashed var(--line,#E4DFCF);font-size:13.5px;color:var(--ink2,#4A554E);text-align:center}
.cr-empty b{color:var(--ink,#14201A)}
.cr-foot{margin-top:22px;font-size:12.5px;font-weight:600;color:#7E5E13;display:flex;align-items:center;gap:6px}
.cr-foot a{color:var(--green,#0C7A46);font-weight:700}
@media (max-width:620px){
  .cr-hero{flex-direction:row;padding:14px 15px;gap:12px}
  .cr-hero-cat{width:52px;height:52px}
  .cr-h1{font-size:18px}
  .cr-ask{flex-direction:column}
  .cr-go{align-self:flex-end;padding:12px 20px}
  .cr-recent-row{grid-template-columns:repeat(3,minmax(0,1fr))}
}
`;
