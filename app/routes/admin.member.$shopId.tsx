/* Owner-only view of ONE member's generations — every image, video, song, blog
 * and ad they've made, newest first. This shows a specific user's private
 * content, so it is gated exactly like /admin/members: owner session
 * (ADMIN_EMAILS) or ?key=<PURGE_KEY>, and 404s for everyone else so the route's
 * existence stays hidden. Read-only; the member is not notified (standard
 * operator access to content stored on your own platform).
 *
 * Reached from the "view" link on each row of /admin/members. */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { db } from "../db.server";
import { isOwner } from "../lib/admin.server";

export const meta = () => [{ title: "Member generations · EasyMode" }];

function fmtWhen(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

// A friendly label for each AssetType the archive stores.
function kindLabel(t: string): string {
  switch (t) {
    case "IMAGE_AD": return "Image";
    case "VIDEO_AD": return "Video";
    case "AUDIO": return "Song";
    case "BLOG_POST": return "Blog";
    case "AD_COPY": return "Ad copy";
    case "EMAIL": return "Email";
    case "LANDING_PAGE": return "Landing page";
    default: return t.replace(/_/g, " ").toLowerCase();
  }
}

type Tile = {
  id: string;
  kind: string;
  label: string;
  status: string;
  title: string;
  when: string;
  media: string | null; // image/video/audio URL when present
  isVideo: boolean;
  isAudio: boolean;
  text: string | null; // a short snippet for text types (blog/copy/email)
  section: string | null; // "creator" | "marketing" (from metaJson)
  prompt: string | null; // the generation prompt / instruction that drove it
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  // Private content — reveal nothing (not even existence) to non-owners.
  if (!(await isOwner(request))) throw new Response("Not Found", { status: 404 });
  const shopId = params.shopId || "";

  const [conn, shop, assets, threads, messages] = await Promise.all([
    db.connection.findFirst({ where: { externalId: shopId, kind: "web" }, include: { account: { select: { email: true, name: true } } } }),
    db.shop.findUnique({ where: { id: shopId }, select: { storeUrl: true, domain: true, level: true } }),
    db.asset.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 240, select: { id: true, type: true, status: true, title: true, bodyJson: true, metaJson: true, createdAt: true } }),
    db.buddyThread.findMany({ where: { shopId }, orderBy: { updatedAt: "desc" } }),
    db.buddyMessage.findMany({ where: { shopId }, orderBy: { createdAt: "asc" }, take: 500, select: { id: true, role: true, content: true, mode: true, threadId: true, createdAt: true } }),
  ]);
  if (!shop) throw new Response("Not Found", { status: 404 });

  const tiles: Tile[] = assets.map((a) => {
    let media: string | null = null;
    let text: string | null = null;
    let prompt: string | null = null;
    try {
      const b = JSON.parse(a.bodyJson) as Record<string, unknown>;
      media = (b.videoUrl as string) || (b.imageUrl as string) || (b.audioUrl as string) || (b.url as string) || null;
      // The prompt / instruction that drove the generation (for accuracy review).
      const p = (b.prompt as string) || (b.script as string) || (b.editPrompt as string) || (b.direction as string) || (b.customPrompt as string) || "";
      if (p) prompt = p.replace(/\s+/g, " ").trim().slice(0, 400);
      // For text creations, show a short readable snippet instead of a thumbnail.
      const raw = (b.blogHtml as string) || (b.html as string) || (b.body as string) || (b.adCopy as string) || (b.copy as string) || (b.caption as string) || "";
      if (!media && raw) text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
    } catch { /* unreadable body → no media */ }
    let section: string | null = null;
    try { section = (JSON.parse(a.metaJson) as { section?: string }).section || null; } catch { /* */ }
    return {
      id: a.id,
      kind: a.type,
      label: kindLabel(a.type),
      status: a.status,
      title: a.title || kindLabel(a.type),
      when: fmtWhen(a.createdAt),
      media,
      isVideo: a.type === "VIDEO_AD" || /\.(mp4|webm|mov)(\?|$)/i.test(media || ""),
      isAudio: a.type === "AUDIO" || /\.(mp3|wav|m4a|aac)(\?|$)/i.test(media || ""),
      text,
      section,
      prompt,
    };
  });

  // Breakdown by kind so it's obvious at a glance whether they make videos, etc.
  const counts: Record<string, number> = {};
  for (const tInfo of tiles) counts[tInfo.label] = (counts[tInfo.label] || 0) + 1;
  const breakdown = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, n]) => `${n} ${label.toLowerCase()}${n === 1 ? "" : "s"}`);

  // Helpurr chat transcripts (read-only, for QA) — grouped by thread. Messages
  // whose threadId is null belong to the default "Main" thread. Each group keeps
  // its own last-message time so we can surface the most-recently-active first.
  type ChatGroup = { id: string; title: string; mode: string; count: number; messages: { role: string; content: string; when: string }[]; lastAt: number };
  const groups = new Map<string, ChatGroup>();
  const threadTitle = new Map<string, string>();
  const threadMode = new Map<string, string>();
  for (const t of threads) { threadTitle.set(t.id, t.title || "New chat"); threadMode.set(t.id, t.mode); }
  for (const m of messages) {
    const key = m.threadId || "__main__";
    let g = groups.get(key);
    if (!g) {
      g = {
        id: key,
        title: m.threadId ? (threadTitle.get(m.threadId) || "New chat") : "Main",
        mode: m.threadId ? (threadMode.get(m.threadId) || m.mode) : m.mode,
        count: 0,
        messages: [],
        lastAt: 0,
      };
      groups.set(key, g);
    }
    g.messages.push({ role: m.role, content: m.content, when: fmtWhen(m.createdAt) });
    g.count += 1;
    g.lastAt = Math.max(g.lastAt, m.createdAt.getTime());
  }
  // Newest-active group first; drop the per-group sort key from the payload.
  const chats = [...groups.values()]
    .sort((a, b) => b.lastAt - a.lastAt)
    .map(({ lastAt: _lastAt, ...g }) => g);

  return json({
    member: { email: conn?.account.email || "(unknown)", name: conn?.account.name || "—", store: shop.storeUrl || null, domain: shop.domain || null, level: shop.level },
    tiles,
    total: tiles.length,
    breakdown,
    chats,
    generatedAt: fmtWhen(new Date()),
  });
};

export default function AdminMemberGenerations() {
  const { member, tiles, total, breakdown, chats } = useLoaderData<typeof loader>();
  // Lightbox — the clicked creation, shown full-size in an overlay.
  const [active, setActive] = useState<null | (typeof tiles)[number]>(null);
  return (
    <div className="mg-wrap">
      <style>{CSS}</style>
      <header className="mg-head">
        <Link to="/admin/members" className="mg-back">← Members</Link>
        <h1 className="mg-title">{member.name === "—" ? member.email : member.name}</h1>
        <p className="mg-sub">
          {member.email} · level {member.level} · {total} {total === 1 ? "creation" : "creations"}
          {member.store ? <> · <a href={member.store} target="_blank" rel="noreferrer">{hostOf(member.store)}</a></> : null}
        </p>
        {breakdown.length > 0 && <p className="mg-breakdown">{breakdown.join(" · ")}</p>}
      </header>

      <section className="mc-chat-sec">
        <h2 className="mc-chat-h">Helpurr chats</h2>
        {chats.length === 0 ? (
          <p className="mc-chat-empty">No Helpurr chats yet.</p>
        ) : (
          chats.map((c) => (
            <div key={c.id} className="mc-chat-thread">
              <div className="mc-chat-head">
                <span className="mc-chat-title" title={c.title}>{c.title}</span>
                <span className={"mc-chat-mode mc-chat-mode-" + c.mode}>{c.mode}</span>
                <span className="mc-chat-count">{c.count} {c.count === 1 ? "message" : "messages"}</span>
              </div>
              <div className="mc-chat-log">
                {c.messages.map((m, i) => (
                  <div key={i} className={"mc-chat-row mc-chat-" + (m.role === "assistant" ? "assistant" : "user")}>
                    <div className="mc-chat-meta">
                      <span className="mc-chat-role">{m.role === "assistant" ? "Helpurr" : "user"}</span>
                      <span className="mc-chat-when">{m.when}</span>
                    </div>
                    <div className="mc-chat-body">{m.content}</div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {tiles.length === 0 ? (
        <p className="mg-empty">This member hasn't generated anything yet.</p>
      ) : (
        <div className="mg-grid">
          {tiles.map((tInfo) => (
            <div key={tInfo.id} className="mg-tile">
              <div className="mg-media">
                {tInfo.isVideo && tInfo.media ? (
                  <button type="button" className="mg-open" onClick={() => setActive(tInfo)} aria-label={`View ${tInfo.title}`}>
                    <video src={tInfo.media} muted preload="metadata" playsInline />
                    <span className="mg-play" aria-hidden="true">▶</span>
                  </button>
                ) : tInfo.isAudio && tInfo.media ? (
                  <div className="mg-aud"><span>♪</span><audio src={tInfo.media} controls /></div>
                ) : tInfo.media ? (
                  <button type="button" className="mg-open" onClick={() => setActive(tInfo)} aria-label={`View ${tInfo.title}`}>
                    <img src={tInfo.media} alt={tInfo.title} loading="lazy" />
                  </button>
                ) : tInfo.text ? (
                  <div className="mg-text">{tInfo.text}{tInfo.text.length >= 240 ? "…" : ""}</div>
                ) : (
                  <div className="mg-none">{tInfo.status === "PENDING" ? "still rendering…" : tInfo.status === "FAILED" ? "failed" : "no preview"}</div>
                )}
              </div>
              <div className="mg-meta">
                <span className={"mg-kind mg-kind-" + tInfo.kind.toLowerCase()}>{tInfo.label}</span>
                {tInfo.section === "creator" && <span className="mg-tag">Creator</span>}
                {tInfo.status !== "COMPLETED" && <span className="mg-st">{tInfo.status.toLowerCase()}</span>}
                <span className="mg-when">{tInfo.when}</span>
              </div>
              <div className="mg-ttl" title={tInfo.title}>{tInfo.title}</div>
              {tInfo.prompt && <div className="mg-prompt" title={tInfo.prompt}>“{tInfo.prompt}”</div>}
            </div>
          ))}
        </div>
      )}

      {active && (
        <div className="mg-lb" role="dialog" aria-modal="true" onClick={() => setActive(null)}>
          <button type="button" className="mg-lb-x" onClick={() => setActive(null)} aria-label="Close">×</button>
          <div className="mg-lb-inner" onClick={(e) => e.stopPropagation()}>
            {active.isVideo && active.media ? (
              <video src={active.media} controls autoPlay playsInline className="mg-lb-media" />
            ) : active.media ? (
              <img src={active.media} alt={active.title} className="mg-lb-media" />
            ) : null}
            <div className="mg-lb-meta">
              <b>{active.title}</b>
              <span className="mg-lb-line">{active.label}{active.section === "creator" ? " · Creator" : ""} · {active.when} · {active.status.toLowerCase()}</span>
              {active.prompt && <p className="mg-lb-prompt">“{active.prompt}”</p>}
              {active.media && <a href={active.media} target="_blank" rel="noreferrer" className="mg-lb-raw">open original ↗</a>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; }
}

const CSS = `
.mg-wrap{max-width:1160px;margin:0 auto;padding:28px 18px 64px;color:#14201A;font-family:Poppins,system-ui,sans-serif}
.mg-head{margin-bottom:20px}
.mg-back{color:#0C7A46;text-decoration:none;font-size:13px;font-weight:600}
.mg-back:hover{text-decoration:underline}
.mg-title{font-size:28px;font-weight:700;margin:8px 0 0;letter-spacing:-.01em}
.mg-sub{margin:4px 0 0;color:#5a6b61;font-size:14px}
.mg-sub a{color:#0C7A46;text-decoration:none}
.mg-sub a:hover{text-decoration:underline}
.mg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.mg-tile{background:#fff;border:1px solid #e3e9e4;border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.mg-media{aspect-ratio:1/1;background:#0f1713;display:flex;align-items:center;justify-content:center;overflow:hidden}
.mg-media img,.mg-media video{width:100%;height:100%;object-fit:cover;display:block}
.mg-aud{display:flex;flex-direction:column;align-items:center;gap:10px;color:#9fdcbf;padding:14px}
.mg-aud span{font-size:34px}
.mg-aud audio{width:90%}
.mg-text{padding:14px;font-size:12px;line-height:1.5;color:#dfeee6;overflow:hidden}
.mg-none{color:#7f9488;font-size:12px}
.mg-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:9px 11px 0}
.mg-kind{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:2px 7px;border-radius:999px;background:#eef4ef;color:#0C7A46}
.mg-kind-video_ad{background:#e7effd;color:#2558b8}
.mg-kind-audio{background:#f3e9fd;color:#7a3fb8}
.mg-kind-blog_post{background:#fdf3e3;color:#9a6a12}
.mg-tag{font-size:10px;font-weight:700;color:#7a3fb8;background:#f3e9fd;padding:2px 7px;border-radius:999px}
.mg-st{font-size:10px;font-weight:700;color:#8a5a00;background:#fdecc8;padding:2px 7px;border-radius:999px;text-transform:uppercase}
.mg-when{margin-left:auto;font-size:11px;color:#8a9a90;white-space:nowrap}
.mg-ttl{padding:4px 11px 2px;font-size:12.5px;font-weight:600;color:#2a3b33;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg-breakdown{margin:8px 0 0;color:#2a3b33;font-size:13px;font-weight:600}
.mg-prompt{padding:0 11px 11px;font-size:11.5px;line-height:1.4;color:#6a7c72;font-style:italic;cursor:help;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.mg-empty{color:#5a6b61;font-size:15px;padding:50px 0;text-align:center}
.mg-open{display:block;width:100%;height:100%;border:0;padding:0;margin:0;background:none;cursor:zoom-in;position:relative}
.mg-open img,.mg-open video{width:100%;height:100%;object-fit:cover;display:block}
.mg-play{position:absolute;inset:0;margin:auto;width:46px;height:46px;display:grid;place-items:center;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:17px;pointer-events:none}
.mg-lb{position:fixed;inset:0;z-index:9999;background:rgba(8,12,10,.88);display:flex;align-items:center;justify-content:center;padding:28px}
.mg-lb-x{position:absolute;top:14px;right:20px;background:none;border:0;color:#fff;font-size:34px;line-height:1;cursor:pointer}
.mg-lb-inner{max-width:min(1000px,92vw);max-height:90vh;display:flex;flex-direction:column;gap:12px;align-items:center}
.mg-lb-media{max-width:100%;max-height:74vh;width:auto;height:auto;object-fit:contain;border-radius:10px;background:#000;box-shadow:0 10px 40px rgba(0,0,0,.5)}
.mg-lb-meta{max-width:720px;text-align:center;color:#eaf3ee}
.mg-lb-meta b{display:block;font-size:15px}
.mg-lb-line{display:block;font-size:12px;color:#9fb3a8;margin-top:3px}
.mg-lb-prompt{margin:8px 0 0;font-size:13px;font-style:italic;color:#cfe0d6;line-height:1.5}
.mg-lb-raw{display:inline-block;margin-top:8px;color:#5fd39a;font-size:12px;font-weight:600;text-decoration:none}
.mg-lb-raw:hover{text-decoration:underline}
.mc-chat-sec{margin:0 0 30px}
.mc-chat-h{font-size:19px;font-weight:700;margin:0 0 12px;letter-spacing:-.01em}
.mc-chat-empty{color:#5a6b61;font-size:14px;margin:0}
.mc-chat-thread{background:#fff;border:1px solid #e3e9e4;border-radius:14px;overflow:hidden;margin-bottom:14px}
.mc-chat-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:11px 14px;border-bottom:1px solid #eef2ee;background:#f7faf8}
.mc-chat-title{font-size:13.5px;font-weight:700;color:#14201A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%}
.mc-chat-mode{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:2px 7px;border-radius:999px;background:#eef4ef;color:#0C7A46}
.mc-chat-mode-casual{background:#f3e9fd;color:#7a3fb8}
.mc-chat-count{margin-left:auto;font-size:11px;color:#8a9a90;white-space:nowrap}
.mc-chat-log{max-height:420px;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.mc-chat-row{max-width:85%;border-radius:12px;padding:8px 11px}
.mc-chat-user{align-self:flex-end;background:#eef4ef;border:1px solid #dfeae2}
.mc-chat-assistant{align-self:flex-start;background:#f3e9fd;border:1px solid #ecdcfb}
.mc-chat-meta{display:flex;align-items:baseline;gap:8px;margin-bottom:3px}
.mc-chat-role{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:#5a6b61}
.mc-chat-assistant .mc-chat-role{color:#7a3fb8}
.mc-chat-when{font-size:10px;color:#9fb0a6;white-space:nowrap}
.mc-chat-body{font-size:13px;line-height:1.5;color:#2a3b33;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto}
`;
