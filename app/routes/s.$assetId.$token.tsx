/* A SHARED PIECE — the public page a merchant's "Share link" opens: one video, image or track, its title,
 * and a quiet "Made with EasyMode" under it. Nothing else of the account is on it (the loader reads one
 * asset's media and title, never the shop row), it is only there while the piece carries the share token
 * the link was made with (Stop sharing removes it), and it is kept out of search engines.
 *
 * Every shared piece is also an ad for us: the people a merchant sends their ad or film to are other
 * makers and other shop owners — the badge is tracked (utm_source=share). */

import { json, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import crypto from "node:crypto";
import path from "node:path";
import { db } from "../db.server";
import { externalOrigin } from "../lib/origin.server";

const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const id = params.assetId || "";
  const token = params.token || "";
  const gone = () => new Response("This link isn't shared any more.", { status: 404, headers: { "X-Robots-Tag": "noindex" } });
  if (!/^[a-z0-9]{10,40}$/i.test(id) || !/^[A-Za-z0-9_-]{10,40}$/.test(token)) throw gone();
  const a = await db.asset.findUnique({ where: { id }, select: { title: true, type: true, bodyJson: true, metaJson: true } });
  if (!a || !["VIDEO_AD", "IMAGE_AD", "AUDIO"].includes(a.type)) throw gone();
  let meta: { share?: { token?: string }; aspect?: string } = {};
  let body: { videoUrl?: string; imageUrl?: string; audioUrl?: string } = {};
  try { meta = JSON.parse(a.metaJson || "{}"); } catch { /* none */ }
  try { body = JSON.parse(a.bodyJson || "{}"); } catch { /* none */ }
  if (!meta.share?.token || !sameToken(meta.share.token, token)) throw gone();
  const raw = body.videoUrl || body.imageUrl || body.audioUrl || "";
  if (!raw) throw gone();
  const origin = externalOrigin(request);
  const abs = (u: string) => (/^https?:\/\//.test(u) ? u : `${origin}${u.startsWith("/") ? "" : "/"}${u}`);
  const kind = a.type === "VIDEO_AD" ? "video" : a.type === "AUDIO" ? "audio" : "image";
  const local = raw.startsWith("/renders/") ? path.basename(raw.split("?")[0]) : "";
  const poster = kind === "video" && /\.mp4$/i.test(local) ? `${origin}/vthumb/${local}` : kind === "image" ? abs(raw) : `${origin}/helpurr-icon.png?v=3`;
  return json(
    {
      title: (a.title || "A piece made with EasyMode").slice(0, 120),
      kind, media: abs(raw), poster,
      wide: meta.aspect === "16:9", square: meta.aspect === "1:1",
      home: `${origin}/?utm_source=share&utm_medium=link&utm_campaign=made_with`,
      url: `${origin}/s/${id}/${token}`,
    },
    { headers: { "Cache-Control": "public, max-age=120", "X-Robots-Tag": "noindex" } },
  );
};

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Not shared · EasyMode" }, { name: "robots", content: "noindex" }];
  return [
    { title: `${data.title} · made with EasyMode` },
    { name: "robots", content: "noindex" },
    { name: "description", content: "Made with EasyMode — ads, films and posts, on easy mode." },
    { property: "og:title", content: data.title },
    { property: "og:description", content: "Made with EasyMode" },
    { property: "og:url", content: data.url },
    { property: "og:image", content: data.poster },
    ...(data.kind === "video"
      ? [{ property: "og:type", content: "video.other" }, { property: "og:video", content: data.media }, { property: "og:video:secure_url", content: data.media }, { property: "og:video:type", content: "video/mp4" }]
      : [{ property: "og:type", content: "website" }]),
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: data.title },
    { name: "twitter:image", content: data.poster },
  ];
};

export default function SharedPiece() {
  const d = useLoaderData<typeof loader>();
  return (
    <main className="sh-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className={`sh-stage${d.wide ? " wide" : d.square ? " square" : ""}${d.kind === "audio" ? " audio" : ""}`}>
        {d.kind === "video" ? (
          <video src={d.media} poster={d.poster} controls playsInline preload="metadata" />
        ) : d.kind === "image" ? (
          <img src={d.media} alt={d.title} />
        ) : (
          <audio src={d.media} controls preload="metadata" />
        )}
      </div>
      <h1 className="sh-title">{d.title}</h1>
      <a className="sh-made" href={d.home}>
        <img className="sh-made-mark" src="/helpurr-icon.png?v=3" alt="" width={28} height={28} />
        <span>Made with <b>EasyMode</b> — make yours</span>
        <span aria-hidden="true">→</span>
      </a>
    </main>
  );
}

const CSS = `
:root{--sh-bg:#0E1712;--sh-ink:#F4F1E8;--sh-dim:rgba(244,241,232,.66);--sh-green:#12A85E;--sh-gold:#E7C879;}
html,body{background:var(--sh-bg);}
.sh-wrap{min-height:100vh;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:28px max(16px,env(safe-area-inset-right,0px)) 36px max(16px,env(safe-area-inset-left,0px));background:radial-gradient(1200px 600px at 50% -10%,rgba(18,168,94,.16),transparent 60%),var(--sh-bg);color:var(--sh-ink);font-family:Inter,-apple-system,sans-serif;}
.sh-stage{width:min(420px,100%);border-radius:20px;overflow:hidden;background:#000;box-shadow:0 30px 80px -30px rgba(0,0,0,.8),0 0 0 1px rgba(255,255,255,.06);}
.sh-stage.wide{width:min(960px,100%);}
.sh-stage.square{width:min(640px,100%);}
.sh-stage.audio{width:min(520px,100%);background:#16221B;padding:22px;}
.sh-stage video,.sh-stage img{display:block;width:100%;height:auto;max-height:78vh;object-fit:contain;background:#000;}
.sh-stage audio{width:100%;}
.sh-title{margin:0;max-width:720px;text-align:center;text-wrap:balance;font-family:Poppins,sans-serif;font-weight:700;font-size:clamp(18px,3.4vw,26px);line-height:1.25;letter-spacing:-.01em;}
.sh-made{display:inline-flex;align-items:center;gap:9px;min-height:44px;padding:0 16px 0 8px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:var(--sh-dim);font-size:13.5px;text-decoration:none;transition:background .15s,color .15s;}
.sh-made b{color:var(--sh-ink);font-family:Poppins,sans-serif;font-weight:700;}
.sh-made:hover{background:rgba(18,168,94,.18);color:var(--sh-ink);}
.sh-made:focus-visible{outline:2px solid var(--sh-gold);outline-offset:3px;}
.sh-made-mark{width:28px;height:28px;border-radius:50%;display:block;background:#fff;object-fit:cover;}
`;
