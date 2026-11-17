/* Section editor — Phase 2 (ffmpeg, no AI) + Phase 3 (re-roll one shot with AI).
 *
 * Edit a finished dialogue film shot-by-shot: trim / speed / volume / delete a single shot,
 * then RE-ASSEMBLE the film from the (edited) shots and update the asset in place. The shots
 * are the per-clip files the engine already recorded on the asset (metaJson.shots), and the
 * re-assembly reuses the same crossfade assembler the render uses, so an edit looks like a
 * native render. The quick edits run synchronously in the editor action — the ops are light
 * (one clip) and the assemble is a handful of short clips; a re-roll is an AI clip render and
 * runs on the worker.
 *
 * SAVING. A re-roll takes minutes, and the merchant can keep editing other shots while it runs.
 * Both used to read the film's shot list, work, and then write the whole list back — so whichever
 * finished last silently erased the other's change. Every save here now goes through saveCut():
 * the new cut is computed from the film AS IT IS NOW, and the write is pinned to the exact rows it
 * was computed from (updateMany), so a change that landed meanwhile makes the write MISS and the
 * cut is simply recomputed on top of it. (tests/no-blind-writes.test.ts is the standing rule.) */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.server";
import { runFfmpeg, ffprobeDuration } from "./ugc-ad-pipeline.server";
import { assembleTestMovie, renderDialogueClipTo } from "./film-dialogue.server";
import { ensureVoiceModel, revoiceClip } from "./singing-voice.server";
import { mirrorRender } from "./object-storage.server";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
const toLocal = (u: string) => path.join(RENDERS(), path.basename((u || "").split("?")[0]));
const newName = (suffix: string) => `tm-edit-${Date.now()}-${crypto.randomBytes(5).toString("hex")}${suffix}.mp4`;

/** One shot of a finished film. `seed` + `prompt` + `dur` are what it was rendered from (a re-roll
 *  renders from them again); `chained` = it continues the previous shot (seeded from its last frame);
 *  `voice` = the cast voice that was put on it ("Lock these voices"), so a re-roll gets it too. */
export type Shot = { url: string; caption?: string; seed?: string; prompt?: string; dur?: number; chained?: boolean; voice?: string };
export type ShotOp = "trim" | "speed" | "volume" | "delete";
type Aspect = "9:16" | "16:9" | "1:1";
type CutResult = { ok: boolean; videoUrl?: string; shots?: Shot[]; error?: string };

async function ffOp(inLocal: string, args: string[], suffix: string): Promise<string | null> {
  const outName = newName(suffix);
  const outPath = path.join(RENDERS(), outName);
  try {
    const r = await runFfmpeg(["-y", "-i", inLocal, ...args, "-movflags", "+faststart", outPath]);
    if (r.status === 0 && fs.existsSync(outPath) && ffprobeDuration(outPath) > 0.3) return outName;
  } catch { /* fall through */ }
  return null;
}

type Film = { id: string; bodyJson: string; metaJson: string; body: Record<string, unknown>; meta: Record<string, unknown>; shots: Shot[]; aspect: Aspect };

/** The film as it is right now: its two JSON columns exactly as stored (the save pins them) and parsed. */
async function loadFilm(assetId: string, shopId: string): Promise<Film | null> {
  const a = await db.asset.findFirst({ where: { id: assetId, shopId }, select: { id: true, bodyJson: true, metaJson: true } });
  if (!a) return null;
  const parse = (s: string | null): Record<string, unknown> => { try { const v = JSON.parse(s || "{}"); return v && typeof v === "object" ? v as Record<string, unknown> : {}; } catch { return {}; } };
  const body = parse(a.bodyJson);
  const meta = parse(a.metaJson);
  const shots: Shot[] = Array.isArray(meta.shots) ? (meta.shots as Shot[]).filter((s) => s && typeof s.url === "string") : [];
  const aspect: Aspect = meta.aspect === "16:9" || meta.aspect === "1:1" ? meta.aspect : "9:16";
  return { id: a.id, bodyJson: a.bodyJson, metaJson: a.metaJson, body, meta, shots, aspect };
}

/** Re-cut the film with `change` applied to its CURRENT shot list and save it — without overwriting
 *  an edit that landed while this one was working. `change` returns the new list, or an error to stop. */
async function saveCut(assetId: string, shopId: string, change: (shots: Shot[]) => Shot[] | { error: string }): Promise<CutResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const film = await loadFilm(assetId, shopId);
    if (!film) return { ok: false, error: "Film not found." };
    const next = change(film.shots);
    if (!Array.isArray(next)) return { ok: false, error: next.error };

    // Re-assemble the film from the updated shots (same crossfade assembler as the render).
    const clipPaths = next.map((s) => toLocal(s.url)).filter((p) => fs.existsSync(p));
    if (!clipPaths.length) return { ok: false, error: "No shot media left to assemble." };
    const outName = newName("");
    const outPath = path.join(RENDERS(), outName);
    try {
      await assembleTestMovie(clipPaths, outPath, undefined, undefined, film.aspect);
    } catch (e) {
      return { ok: false, error: `Re-assembly failed: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"}` };
    }
    if (!(fs.existsSync(outPath) && ffprobeDuration(outPath) > 1)) return { ok: false, error: "Re-assembly produced no film." };
    try { await mirrorRender(outName, fs.readFileSync(outPath)); } catch { /* non-fatal */ }
    const videoUrl = `/renders/${outName}`;

    // Pinned to the rows this cut was built from: if another edit saved first, this misses and we go again.
    const saved = await db.asset.updateMany({
      where: { id: film.id, bodyJson: film.bodyJson, metaJson: film.metaJson },
      data: { bodyJson: JSON.stringify({ ...film.body, videoUrl }), metaJson: JSON.stringify({ ...film.meta, shots: next }) },
    });
    if (saved.count === 1) return { ok: true, videoUrl, shots: next };
    try { fs.rmSync(outPath, { force: true }); } catch { /* an unused cut — best-effort */ }
  }
  return { ok: false, error: "The film was changed by another edit while this one was saving — try again." };
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
}): Promise<CutResult> {
  const film = await loadFilm(opts.assetId, opts.shopId);
  if (!film) return { ok: false, error: "Film not found." };
  if (!film.shots.length) return { ok: false, error: "This film has no per-shot data to edit." };
  const i = opts.shotIndex;
  if (i < 0 || i >= film.shots.length) return { ok: false, error: "That shot no longer exists." };
  const target = film.shots[i];
  // the shot the merchant was looking at, wherever it sits by the time we save
  const find = (cur: Shot[]) => (cur[i]?.url === target.url ? i : cur.findIndex((s) => s.url === target.url));

  if (opts.op === "delete") {
    return saveCut(opts.assetId, opts.shopId, (cur) => {
      const k = find(cur);
      if (k < 0) return { error: "That shot no longer exists." };
      if (cur.length <= 1) return { error: "Can't delete the only shot." };
      return cur.filter((_, j) => j !== k);
    });
  }

  const inLocal = toLocal(target.url);
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
  const edited = `/renders/${outName}`;
  return saveCut(opts.assetId, opts.shopId, (cur) => {
    // this edit was made FROM that exact clip; if the shot has changed since (re-rolled, edited again),
    // dropping our version on top would throw that change away
    const k = find(cur);
    if (k < 0) return { error: "That shot was changed by another edit — try again." };
    const next = cur.slice();
    next[k] = { ...cur[k], url: edited };
    return next;
  });
}

/** Phase 3: RE-ROLL one shot via the dialogue engine (its stored seed + prompt), then
 *  re-stitch. Slow (an AI clip render), so this runs on the worker via a REGEN_SHOT job. */
export async function regenerateFilmShot(opts: { assetId: string; shopId: string; shotIndex: number }): Promise<{ ok: boolean; videoUrl?: string; error?: string }> {
  const film = await loadFilm(opts.assetId, opts.shopId);
  if (!film) return { ok: false, error: "Film not found." };
  const i = opts.shotIndex;
  if (i < 0 || i >= film.shots.length) return { ok: false, error: "That shot no longer exists." };
  const shot = film.shots[i];
  if (!shot.seed || !shot.prompt) return { ok: false, error: "This shot predates regenerate — re-render the film once to enable it." };
  const engine: "veo" | "kling3" = film.meta.engine === "veo" ? "veo" : "kling3";
  const dur = typeof shot.dur === "number" && shot.dur > 0 ? shot.dur : 8;

  let newClip: string;
  try {
    // a shot that continues the previous one keeps its opening frames, exactly as in the first render
    newClip = await renderDialogueClipTo(engine, shot.seed, shot.prompt, dur, film.aspect, `regen-${i}`, !!shot.chained);
  } catch (e) {
    return { ok: false, error: `Shot re-render failed: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"}` };
  }
  // The video model acts every take in a voice of its own. If this shot carried a cast voice, the new
  // take gets the same one — otherwise the re-rolled shot would be the only line in the film spoken by
  // a stranger. Fails open, like the render: a voice that can't be applied keeps the take as it is.
  if (shot.voice) {
    try {
      const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
      const model = await ensureVoiceModel(shot.voice, base);
      newClip = await revoiceClip(newClip, model.url, base, { voiceId: shot.voice });
    } catch (e) {
      console.error(`[regen] cast voice not applied to the new take: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    }
  }
  const clipName = path.basename(newClip);
  try { await mirrorRender(clipName, fs.readFileSync(newClip)); } catch { /* non-fatal */ }

  const r = await saveCut(opts.assetId, opts.shopId, (cur) => {
    // it may have been trimmed or sped up while its re-roll rendered — it is still the same shot
    const same = (s: Shot) => s.seed === shot.seed && s.prompt === shot.prompt;
    const k = cur[i] && same(cur[i]) ? i : cur.findIndex(same);
    if (k < 0) return { error: "That shot was removed while it was re-rendering — nothing was replaced." };
    const next = cur.slice();
    next[k] = { ...cur[k], url: `/renders/${clipName}` };
    return next;
  });
  return { ok: r.ok, videoUrl: r.videoUrl, error: r.error };
}
