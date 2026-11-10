/* The SECTION EDITOR (OpenArt-style "Director" timeline) — Phase 1.
 *
 * Open a finished dialogue film and see it as a strip of SHOTS: the engine now records
 * every shot (its /renders clip + the line it speaks) on the asset, so here we lay them
 * out as a clickable timeline with a big preview on top. Click a shot → it previews just
 * that clip; "Full film" plays the assembled cut. Per-shot editing (trim · speed · volume ·
 * regenerate · add-shot) hangs off this same rail in the next phases. Styled to our
 * market-green-on-cream theme, OpenArt's layout: preview up top, shot rail along the bottom. */

import { json, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { useState } from "react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";

export const meta: MetaFunction = () => [{ title: "Shot Editor · EASYMODE" }];

type Shot = { n: number; url: string; speaker: string; line: string };

/** Split "NAME: the line" into speaker + line for the shot label. */
function parseCaption(c: string): { speaker: string; line: string } {
  const m = (c || "").match(/^\s*([\p{Lu}][\p{L}'’-]{1,20})\s*:\s*(.*)$/u);
  return m ? { speaker: m[1], line: m[2].trim() } : { speaker: "", line: (c || "").trim() };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { shop } = await requireWebIdentity(request);
  const id = params.id || "";
  const a = await db.asset.findFirst({
    where: { id, shopId: shop.id },
    select: { id: true, title: true, bodyJson: true, metaJson: true },
  });
  if (!a) throw new Response("Film not found", { status: 404 });
  let body: { videoUrl?: string } = {};
  let meta: { shots?: Array<{ url?: string; caption?: string }>; engine?: string; aspect?: string } = {};
  try { body = JSON.parse(a.bodyJson || "{}"); } catch { /* ignore */ }
  try { meta = JSON.parse(a.metaJson || "{}"); } catch { /* ignore */ }
  const shots: Shot[] = (meta.shots || [])
    .filter((s): s is { url: string; caption?: string } => !!s && typeof s.url === "string")
    .map((s, i) => { const { speaker, line } = parseCaption(s.caption || ""); return { n: i + 1, url: s.url, speaker, line }; });
  return json({
    id: a.id,
    title: a.title || "Film",
    filmUrl: body.videoUrl || "",
    aspect: meta.aspect === "16:9" || meta.aspect === "1:1" ? meta.aspect : "9:16",
    engine: meta.engine === "kling3" ? "Kling" : "Veo",
    shots,
  });
}

export default function FilmEditor() {
  const d = useLoaderData<typeof loader>();
  // -1 = the full assembled film; 0..n-1 = a single shot.
  const [sel, setSel] = useState(-1);
  const src = sel >= 0 ? d.shots[sel]?.url : d.filmUrl;
  const wide = d.aspect === "16:9";
  const cur = sel >= 0 ? d.shots[sel] : null;

  return (
    <div className="se-wrap">
      <style>{CSS}</style>
      <div className="se-top">
        <Link to="/web/archive" className="se-back">← {`Archive`}</Link>
        <div className="se-ttl">{d.title}</div>
        <div className="se-badges">
          <span className="se-badge">{d.engine}</span>
          <span className="se-badge">{d.aspect}</span>
          <span className="se-badge se-badge-soft">{d.shots.length || "?"} shots</span>
        </div>
      </div>

      <div className={`se-stage${wide ? " wide" : ""}`}>
        {src
          ? <video key={src} className="se-video" src={src} controls autoPlay playsInline />
          : <div className="se-empty">This film’s media has expired.</div>}
      </div>

      <div className="se-shotpanel">
        {cur
          ? <>
              <div className="se-shot-h"><span className="se-shot-n">Shot {cur.n}</span>{cur.speaker && <span className="se-shot-spk">{cur.speaker}</span>}</div>
              <p className="se-shot-line">{cur.line || <em>no line</em>}</p>
              <div className="se-soon">Trim · speed · volume · regenerate — coming to each shot next.</div>
            </>
          : <div className="se-shot-hint">Playing the full film. Tap a shot below to preview just that one.</div>}
      </div>

      <div className="se-railwrap">
        <div className="se-rail">
          <button type="button" className={`se-shot${sel < 0 ? " on" : ""}`} onClick={() => setSel(-1)}>
            <span className="se-shot-thumb se-shot-full">▶</span>
            <span className="se-shot-cap">Full film</span>
          </button>
          {d.shots.map((s, i) => (
            <button type="button" key={s.n} className={`se-shot${sel === i ? " on" : ""}`} onClick={() => setSel(i)}>
              <span className="se-shot-thumb"><video src={`${s.url}#t=0.4`} muted preload="metadata" playsInline /><span className="se-shot-idx">{s.n}</span></span>
              <span className="se-shot-cap">{s.speaker ? `${s.speaker}: ` : ""}{s.line || "—"}</span>
            </button>
          ))}
        </div>
        {d.shots.length === 0 && (
          <p className="se-norail">No per-shot data on this film yet — it was made before the shot editor. Re-render it to unlock per-shot editing.</p>
        )}
      </div>
    </div>
  );
}

const CSS = `
.se-wrap{max-width:1080px;margin:0 auto;padding:16px max(16px,env(safe-area-inset-left,0px)) 40px;font-family:Poppins,system-ui,sans-serif;color:var(--ink,#14201A);}
.se-top{display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap;}
.se-back{color:var(--green,#0C7A46);font-weight:700;text-decoration:none;font-size:14px;}
.se-ttl{font-weight:800;font-size:18px;flex:1;min-width:140px;}
.se-badges{display:flex;gap:6px;}
.se-badge{font-size:11px;font-weight:800;color:#fff;background:var(--green,#0C7A46);border-radius:999px;padding:2px 10px;}
.se-badge-soft{color:var(--green,#0C7A46);background:var(--mint,#EAF6EF);}
.se-stage{background:#0b0f0d;border-radius:16px;overflow:hidden;display:grid;place-items:center;margin-bottom:12px;max-height:60vh;}
.se-stage .se-video{width:auto;max-width:100%;max-height:60vh;display:block;}
.se-stage:not(.wide) .se-video{max-height:66vh;}
.se-empty{color:#cdd6d0;padding:60px;font-size:14px;}
.se-shotpanel{background:var(--card,#FDFCF7);border:1.5px solid var(--line,#E4DFCF);border-radius:14px;padding:12px 15px;margin-bottom:14px;min-height:62px;}
.se-shot-h{display:flex;align-items:center;gap:10px;margin-bottom:4px;}
.se-shot-n{font-weight:800;color:var(--green,#0C7A46);font-size:13px;}
.se-shot-spk{font-weight:700;font-size:12px;color:#5E7A6D;background:var(--mint,#EAF6EF);border-radius:999px;padding:1px 9px;}
.se-shot-line{margin:0;font-size:14px;line-height:1.45;}
.se-shot-hint,.se-norail{color:#6A8577;font-size:13px;margin:0;}
.se-soon{margin-top:8px;font-size:11.5px;font-weight:700;color:#B07D16;background:#FCF3DC;border-radius:8px;padding:5px 9px;display:inline-block;}
.se-railwrap{margin-top:4px;}
.se-rail{display:flex;gap:10px;overflow-x:auto;padding:6px 2px 10px;scroll-snap-type:x proximity;}
.se-shot{flex:0 0 auto;width:132px;scroll-snap-align:start;background:transparent;border:0;padding:0;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:5px;}
.se-shot-thumb{position:relative;display:block;width:132px;height:80px;border-radius:10px;overflow:hidden;background:#11201a;box-shadow:0 0 0 2px transparent;transition:box-shadow .12s;display:grid;place-items:center;}
.se-shot.on .se-shot-thumb{box-shadow:0 0 0 2.5px var(--green,#0C7A46);}
.se-shot-thumb video{width:100%;height:100%;object-fit:cover;}
.se-shot-full{color:#9CCBB1;font-size:22px;background:#13251d;}
.se-shot-idx{position:absolute;left:5px;top:5px;background:rgba(0,0,0,.6);color:#fff;font-size:10px;font-weight:800;border-radius:6px;padding:0 5px;}
.se-shot-cap{font-size:11px;line-height:1.3;color:#3A4A41;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.se-shot.on .se-shot-cap{color:var(--ink,#14201A);font-weight:600;}
`;
