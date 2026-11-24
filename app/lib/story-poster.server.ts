/* THE CAST POSTER — an acted film's cover on the shelf (the layout and the words live in story-poster.ts).
 *
 * A told story has a picture for every scene, and its poster is drawn from one of them
 * (narrated-story.server.ts → makeStoryPoster). An acted film's pictures are wide two-shots: cropped to the
 * shelf's shape, both faces would be cut in half. What it does have is who the maker CAST — their own
 * portraits. So an acted film is billed with them: one fills the poster, two stand side by side, three
 * share it, under the same foot, rule, names and title.
 *
 * One ffmpeg frame from pictures that are already on this disk; no model is asked. It never fails a film:
 * the caller ships the film without a poster, and the shelf shows the first frame as it always did. */
import fs from "node:fs";
import path from "node:path";
import { resolveTextFont, runFfmpeg } from "./ugc-ad-pipeline.server";
import { mirrorRender } from "./object-storage.server";
import { POSTER_CAST_MAX, castPosterGraph, posterLayout, posterName } from "./story-poster";

const RENDERS = () => path.join(process.cwd(), "data", "renders");

/** A cast picture as something ffmpeg can open: the file itself when it is one of ours on this disk (a
 *  stock portrait, a render, an upload) — else its https address — else nothing. */
export function pictureInput(u: string | null | undefined, base = ""): string | null {
  const raw = String(u || "").trim();
  if (!raw) return null;
  const p = raw.replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0];
  const name = path.basename(p);
  const safe = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.(?:jpe?g|png|webp)$/i.test(name) && !name.includes("..");
  if (safe) {
    const candidates = p.startsWith("/avatars/") ? [path.join(process.cwd(), "public", "avatars", name), path.join(process.cwd(), "build", "client", "avatars", name)]
      : p.startsWith("/renders/") ? [path.join(RENDERS(), name)]
      : p.startsWith("/uploads/") ? [path.join(RENDERS(), "uploads", name)]
      : [];
    const hit = candidates.find((f) => fs.existsSync(f));
    if (hit) return hit;
  }
  if (/^https:\/\/[^\s"']+$/.test(raw)) return raw;
  return p.startsWith("/") && /^https:\/\//.test(base) ? `${base.replace(/\/$/, "")}${p}` : null;
}

/** Draw an acted film's poster from its cast's portraits. Returns its /renders address; null when the maker
 *  cast nobody with a picture (an invented cast has no portraits). Throws when it cannot be drawn (no font
 *  for these words, ffmpeg) — the caller ships the film without one. */
export async function makeCastPoster(o: {
  cast: ReadonlyArray<{ name?: string | null; faceUrl?: string | null }> | null | undefined; title: string; videoName: string;
}): Promise<string | null> {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const pictured = (o.cast || [])
    .map((c) => ({ name: String(c?.name || "").trim(), input: pictureInput(c?.faceUrl, base) }))
    .filter((c): c is { name: string; input: string } => !!c.name && !!c.input)
    .filter((c, k, a) => a.findIndex((x) => x.input === c.input) === k)
    .slice(0, POSTER_CAST_MAX);
  if (!pictured.length) return null;
  const layout = posterLayout({ title: o.title, cast: pictured.map((c) => c.name) });
  if (!layout) return null;
  // (the captions' own rule: no font for these words → no words drawn, so no poster — never boxes)
  const font = await resolveTextFont([...layout.lines, layout.cast, layout.episode, layout.episode2 || ""].join(" "));
  const name = posterName(o.videoName);
  const outPath = path.join(RENDERS(), name);
  const r = await runFfmpeg(["-y", ...pictured.flatMap((c) => ["-i", c.input]), "-filter_complex", castPosterGraph(pictured.length, layout, font), "-frames:v", "1", "-q:v", "3", outPath]);
  if (r.status !== 0 || !fs.existsSync(outPath) || fs.statSync(outPath).size < 5000) throw new Error(`cast poster ffmpeg ${r.status}: ${r.stderr.slice(-200)}`);
  try { await mirrorRender(name, fs.readFileSync(outPath)); } catch { /* non-fatal, as everywhere else */ }
  return `/renders/${name}`;
}
