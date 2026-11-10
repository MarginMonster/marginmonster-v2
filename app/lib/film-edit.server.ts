/* Section editor — Phase 2 (ffmpeg, no AI) + Phase 3 hook.
 *
 * Edit a finished dialogue film shot-by-shot: trim / speed / volume / delete a single shot,
 * then RE-ASSEMBLE the film from the (edited) shots and update the asset in place. The shots
 * are the per-clip files the engine already recorded on the asset (metaJson.shots), and the
 * re-assembly reuses the same crossfade assembler the render uses, so an edit looks like a
 * native render. Runs synchronously in the editor action — the ops are light (one clip) and
 * the assemble is a handful of short clips. Phase 3 (regenerate a shot with AI) lands here
 * too, alongside these. */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.server";
import { runFfmpeg, ffprobeDuration } from "./ugc-ad-pipeline.server";
import { assembleTestMovie, renderDialogueClipTo } from "./film-dialogue.server";
import { mirrorRender } from "./object-storage.server";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
const toLocal = (u: string) => path.join(RENDERS(), path.basename((u || "").split("?")[0]));
const newName = (suffix: string) => `tm-edit-${Date.now()}-${crypto.randomBytes(5).toString("hex")}${suffix}.mp4`;

export type Shot = { url: string; caption?: string; seed?: string; prompt?: string; dur?: number };
export type ShotOp = "trim" | "speed" | "volume" | "delete";

async function ffOp(inLocal: string, args: string[], suffix: string): Promise<string | null> {
  const outName = newName(suffix);
  const outPath = path.join(RENDERS(), outName);
  try {
    const r = await runFfmpeg(["-y", "-i", inLocal, ...args, "-movflags", "+faststart", outPath]);
    if (r.status === 0 && fs.existsSync(outPath) && ffprobeDuration(outPath) > 0.3) return outName;
  } catch { /* fall through */ }
  return null;
}

/** Apply one shot edit, re-assemble, and persist. Returns the new film URL + shot list. */
export async function editFilmShot(opts: {
  assetId: string;
  shopId: string;
  op: ShotOp;
  shotIndex: number;
  startSec?: number;
  endSec?: number;
  factor?: number;
  deltaDb?: number;
}): Promise<{ ok: boolean; videoUrl?: string; shots?: Shot[]; error?: string }> {
  const a = await db.asset.findFirst({ where: { id: opts.assetId, shopId: opts.shopId }, select: { id: true, bodyJson: true, metaJson: true } });
  if (!a) return { ok: false, error: "Film not found." };
  let body: Record<string, unknown> = {};
  let meta: Record<string, unknown> = {};
  try { body = JSON.parse(a.bodyJson || "{}"); } catch { /* ignore */ }
  try { meta = JSON.parse(a.metaJson || "{}"); } catch { /* ignore */ }
  const shots: Shot[] = Array.isArray(meta.shots) ? (meta.shots as Shot[]).filter((s) => s && typeof s.url === "string") : [];
  if (!shots.length) return { ok: false, error: "This film has no per-shot data to edit." };
  const i = opts.shotIndex;
  if (i < 0 || i >= shots.length) return { ok: false, error: "That shot no longer exists." };
  const aspect: "9:16" | "16:9" | "1:1" = meta.aspect === "16:9" || meta.aspect === "1:1" ? meta.aspect : "9:16";

  const next = shots.slice();
  if (opts.op === "delete") {
    if (shots.length <= 1) return { ok: false, error: "Can't delete the only shot." };
    next.splice(i, 1);
  } else {
    const inLocal = toLocal(shots[i].url);
    if (!fs.existsSync(inLocal)) return { ok: false, error: "That shot's media is no longer on disk." };
    let outName: string | null = null;
    if (opts.op === "trim") {
      const dur = ffprobeDuration(inLocal);
      const s = Math.max(0, Math.min(opts.startSec ?? 0, dur - 0.5));
      const e = Math.max(s + 0.5, Math.min(opts.endSec ?? dur, dur));
      outName = await ffOp(inLocal, ["-ss", s.toFixed(2), "-t", (e - s).toFixed(2), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k"], "-trim");
    } else if (opts.op === "speed") {
      const f = Math.max(0.5, Math.min(2, opts.factor ?? 1));
      outName = await ffOp(inLocal, ["-filter_complex", `[0:v]setpts=${(1 / f).toFixed(4)}*PTS[v];[0:a]atempo=${f.toFixed(3)}[a]`, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k"], "-spd");
    } else if (opts.op === "volume") {
      const d = Math.max(-30, Math.min(12, opts.deltaDb ?? 0));
      outName = await ffOp(inLocal, ["-af", `volume=${d}dB`, "-c:v", "copy", "-c:a", "aac", "-b:a", "160k"], "-vol");
    }
    if (!outName) return { ok: false, error: "That edit didn't render — nothing changed." };
    try { await mirrorRender(outName, fs.readFileSync(path.join(RENDERS(), outName))); } catch { /* non-fatal */ }
    next[i] = { ...shots[i], url: `/renders/${outName}` };
  }

  // Re-assemble the film from the updated shots (same crossfade assembler as the render).
  const clipPaths = next.map((s) => toLocal(s.url)).filter((p) => fs.existsSync(p));
  if (!clipPaths.length) return { ok: false, error: "No shot media left to assemble." };
  const outName = newName("");
  const outPath = path.join(RENDERS(), outName);
  try {
    await assembleTestMovie(clipPaths, outPath, undefined, undefined, aspect);
  } catch (e) {
    return { ok: false, error: `Re-assembly failed: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"}` };
  }
  if (!(fs.existsSync(outPath) && ffprobeDuration(outPath) > 1)) return { ok: false, error: "Re-assembly produced no film." };
  try { await mirrorRender(outName, fs.readFileSync(outPath)); } catch { /* non-fatal */ }
  const videoUrl = `/renders/${outName}`;

  await db.asset.update({
    where: { id: a.id },
    data: { bodyJson: JSON.stringify({ ...body, videoUrl }), metaJson: JSON.stringify({ ...meta, shots: next }) },
  });
  return { ok: true, videoUrl, shots: next };
}

/** Phase 3: RE-ROLL one shot via the dialogue engine (its stored seed + prompt), then
 *  re-stitch. Slow (an AI clip render), so this runs on the worker via a REGEN_SHOT job. */
export async function regenerateFilmShot(opts: { assetId: string; shopId: string; shotIndex: number }): Promise<{ ok: boolean; videoUrl?: string; error?: string }> {
  const a = await db.asset.findFirst({ where: { id: opts.assetId, shopId: opts.shopId }, select: { id: true, bodyJson: true, metaJson: true } });
  if (!a) return { ok: false, error: "Film not found." };
  let body: Record<string, unknown> = {};
  let meta: Record<string, unknown> = {};
  try { body = JSON.parse(a.bodyJson || "{}"); } catch { /* ignore */ }
  try { meta = JSON.parse(a.metaJson || "{}"); } catch { /* ignore */ }
  const shots: Shot[] = Array.isArray(meta.shots) ? (meta.shots as Shot[]).filter((s) => s && typeof s.url === "string") : [];
  const i = opts.shotIndex;
  if (i < 0 || i >= shots.length) return { ok: false, error: "That shot no longer exists." };
  const shot = shots[i];
  if (!shot.seed || !shot.prompt) return { ok: false, error: "This shot predates regenerate — re-render the film once to enable it." };
  const engine: "veo" | "kling3" = meta.engine === "veo" ? "veo" : "kling3";
  const aspect: "9:16" | "16:9" | "1:1" = meta.aspect === "16:9" || meta.aspect === "1:1" ? meta.aspect : "9:16";
  const dur = typeof shot.dur === "number" && shot.dur > 0 ? shot.dur : 8;

  let newClip: string;
  try {
    newClip = await renderDialogueClipTo(engine, shot.seed, shot.prompt, dur, aspect, `regen-${i}`);
  } catch (e) {
    return { ok: false, error: `Shot re-render failed: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"}` };
  }
  const clipName = path.basename(newClip);
  try { await mirrorRender(clipName, fs.readFileSync(newClip)); } catch { /* non-fatal */ }

  const next = shots.slice();
  next[i] = { ...shot, url: `/renders/${clipName}` };

  const clipPaths = next.map((s) => toLocal(s.url)).filter((p) => fs.existsSync(p));
  if (!clipPaths.length) return { ok: false, error: "No shot media to assemble." };
  const outName = newName("");
  const outPath = path.join(RENDERS(), outName);
  try { await assembleTestMovie(clipPaths, outPath, undefined, undefined, aspect); }
  catch (e) { return { ok: false, error: `Re-assembly failed: ${e instanceof Error ? e.message.slice(0, 60) : "unknown"}` }; }
  if (!(fs.existsSync(outPath) && ffprobeDuration(outPath) > 1)) return { ok: false, error: "Re-assembly produced no film." };
  try { await mirrorRender(outName, fs.readFileSync(outPath)); } catch { /* non-fatal */ }
  const videoUrl = `/renders/${outName}`;

  await db.asset.update({
    where: { id: a.id },
    data: { bodyJson: JSON.stringify({ ...body, videoUrl }), metaJson: JSON.stringify({ ...meta, shots: next }) },
  });
  return { ok: true, videoUrl };
}
