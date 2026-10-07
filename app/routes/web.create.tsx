/* Creator home — the CREATOR section's own front door (the Marketing section
 * keeps web._index as its dashboard). A DeepAI-style "what do you want to make?"
 * hub, in EASYMODE's green-on-cream theme: a warm hero with Helpurr, big tool
 * cards that deep-link into the Studio's casual flows (?do=…), and a strip of
 * your most recent Gallery pieces. No merchant/dashboard machinery — this is the
 * fun, personal side. Casual mode is the section switch; the nav routes "Home"
 * here when it's on. */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
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

type Tool = { key: string; emoji: string; title: string; sub: string; to?: string; event?: string };
const TOOLS: Tool[] = [
  { key: "create", emoji: "✨", title: "Make an image", sub: "Type anything, pick an art style, generate", to: "/web/studio?do=create" },
  { key: "edit", emoji: "🎨", title: "Edit a photo", sub: "Restyle, cartoonize, swap or remove the background", to: "/web/studio?do=edit" },
  { key: "video", emoji: "🎬", title: "Make a video", sub: "A short, shareable clip from your photo", to: "/web/studio?do=video" },
  { key: "presenter", emoji: "🧑", title: "With a presenter", sub: "A character holds or shows off your thing", to: "/web/studio?do=presenter" },
  { key: "music", emoji: "🎵", title: "Make music", sub: "Describe a track, get an original song", to: "/web/studio?do=music" },
  { key: "helpurr", emoji: "🐾", title: "Ask Helpurr", sub: "Your AI helper — ideas, edits, anything", event: "helpurr:open" },
  { key: "gallery", emoji: "🖼", title: "My Gallery", sub: "Everything you've made, ready to share", to: "/web/archive?section=creator" },
];

export default function CreatorHome() {
  const { name, tokens, hasPlan, pieces } = useLoaderData<typeof loader>();

  return (
    <div className="cr">
      <style dangerouslySetInnerHTML={{ __html: CR_CSS }} />

      <div className="cr-hero">
        <span className="cr-hero-cat" aria-hidden="true"><img src="/familiar-px.png?v=2" alt="" /></span>
        <div className="cr-hero-txt">
          <h1 className="cr-h1">Hey {name} — what are we making? 🐾</h1>
          <p className="cr-sub">
            Upload a photo and turn it into something cool, or make a short video to share.
            {hasPlan ? <> You&apos;ve got <b>{tokens.toLocaleString("en-US")}</b> tokens to play with.</> : <> <Link to="/web#plans">Pick a plan</Link> to start.</>}
          </p>
        </div>
      </div>

      <div className="cr-tools">
        {TOOLS.map((t) => {
          const inner = (
            <>
              <span className="cr-tool-emoji" aria-hidden="true">{t.emoji}</span>
              <b>{t.title}</b>
              <span className="cr-tool-sub">{t.sub}</span>
            </>
          );
          return t.event ? (
            <button type="button" key={t.key} className="cr-tool" onClick={() => { try { window.dispatchEvent(new Event(t.event!)); } catch { /* ignore */ } }}>
              {inner}
            </button>
          ) : (
            <Link key={t.key} className="cr-tool" to={t.to!}>{inner}</Link>
          );
        })}
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
        <p className="cr-empty">Nothing in your gallery yet — tap <b>Edit a photo</b> above and make your first one. ✨</p>
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
.cr-tools{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.cr-tool{display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;text-decoration:none;cursor:pointer;
  padding:18px 18px 16px;border-radius:18px;background:var(--card,#FDFCF7);border:1px solid var(--line,#E4DFCF);
  box-shadow:0 2px 8px rgba(20,32,26,.05);transition:transform .12s,box-shadow .12s,border-color .12s;font:inherit}
.cr-tool:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(20,32,26,.1);border-color:#9CCBB1}
.cr-tool-emoji{font-size:26px;line-height:1;margin-bottom:6px;filter:drop-shadow(0 1px 1px rgba(20,32,26,.15))}
.cr-tool b{font-family:Poppins,sans-serif;font-weight:800;font-size:15.5px;color:var(--ink,#14201A)}
.cr-tool-sub{font-size:12.5px;color:var(--ink2,#4A554E);line-height:1.35}
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
  .cr-tools{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .cr-tool{padding:14px 13px}
  .cr-recent-row{grid-template-columns:repeat(3,minmax(0,1fr))}
}
`;
