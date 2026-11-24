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
import { assembleTestMovie, renderDialogueClipTo, extractLastFrame, splitExchange, KLING_HOST_LABEL, type KlingHost } from "./film-dialogue.server";
import { ensureVoiceModel, revoiceClip } from "./singing-voice.server";
import { characterVoice } from "./character-voices";
import { chainClipVoice } from "./character-voice.server";
import { mirrorRender } from "./object-storage.server";
import { levelFilm } from "./film-loudness.server";
import { captionFilm } from "./film-captions.server";
import { captionStyleOf, type CaptionStyle } from "./narrated-core";
import { normalizeContentLang } from "./content-lang";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
const toLocal = (u: string) => path.join(RENDERS(), path.basename((u || "").split("?")[0]));
const newName = (suffix: string) => `tm-edit-${Date.now()}-${crypto.randomBytes(5).toString("hex")}${suffix}.mp4`;

/** One shot of a finished film. `seed` + `prompt` + `dur` are what it was rendered from (a re-roll
 *  renders from them again); `chained` = it continues the previous shot (seeded from its last frame);
 *  `voice` = the cast voice that was put on it ("Lock these voices"), so a re-roll gets it too. */
export type Shot = { url: string; caption?: string; seed?: string; prompt?: string; dur?: number; chained?: boolean; voice?: string; /** a cut to another place, or to the reveal: joined STRAIGHT (film-dialogue.server.ts → assembleTestMovie) */ cut?: "hard" };
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

/** What shot `s` SAYS, without speaker labels, for its captions. A shot keeps its first 200 characters of
 *  the scene's caption; when that was cut short, the film's own script has the whole of it. */
function spokenLine(s: Shot, film: Film): string {
  let cap = s.caption || "";
  if (cap.length >= 200) {
    const scenes = (film.body.treatment as { scenes?: Array<{ caption?: string }> } | undefined)?.scenes;
    const full = Array.isArray(scenes) ? scenes.map((sc) => sc?.caption || "").find((c) => c.length > cap.length && c.startsWith(cap)) : undefined;
    if (full) cap = full;
  }
  return splitExchange(cap).map((t) => t.line).join(" ").replace(/\s+/g, " ").trim();
}

/** Cut the film from its shots the way the render does: the crossfade assembler (a shot that continues
 *  the last one gets the invisible short dissolve, a new picture the softer one), the film levelled to
 *  the catalogue's loudness, and — when the film was made with captions — its captions drawn again,
 *  in time with the voices. Edits used to re-assemble the clips only, so trimming or re-rolling one shot
 *  quietly took the film's captions off, made it ~8 dB quieter and hardened every soft seam.
 *  Returns the caption style the new cut carries. */
async function finishCut(film: Film, shopId: string, parts: Array<{ shot: Shot; path: string }>, outPath: string, opts: { listenMs?: number } = {}): Promise<CaptionStyle> {
  // (a shot the film was cut to STRAIGHT — another place, the reveal — stays a straight cut when the film is
  //  cut again after a trim or a re-roll; it used to dissolve back into the new place)
  const soft = new Set<number>(), hard = new Set<number>();
  parts.forEach((p, i) => { if (i > 0 && p.shot.cut === "hard") hard.add(i); else if (i > 0 && !p.shot.chained) soft.add(i); });
  await assembleTestMovie(parts.map((p) => p.path), outPath, undefined, soft, film.aspect, hard);
  if (!(fs.existsSync(outPath) && ffprobeDuration(outPath) > 1)) return "off";
  try { await levelFilm(outPath); } catch { /* left as it was */ }
  const style = captionStyleOf(film.meta.captions, "off");
  if (style === "off") return "off";
  const lang = (await db.shop.findFirst({ where: { id: shopId }, select: { contentLang: true } }))?.contentLang;
  return captionFilm({
    filmPath: outPath, style, lang: normalizeContentLang(lang), listenMs: opts.listenMs,
    lines: parts.map((p) => spokenLine(p.shot, film)),
    clipDurs: parts.map((p) => { try { return ffprobeDuration(p.path); } catch { return 0; } }),
  });
}

/** Re-cut the film with `change` applied to its CURRENT shot list and save it — without overwriting
 *  an edit that landed while this one was working. `change` returns the new list, or an error to stop.
 *  `listenMs` = how long the captions may wait to hear the voices (the quick edits answer a request). */
async function saveCut(assetId: string, shopId: string, change: (shots: Shot[]) => Shot[] | { error: string }, opts: { listenMs?: number } = {}): Promise<CutResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const film = await loadFilm(assetId, shopId);
    if (!film) return { ok: false, error: "Film not found." };
    const next = change(film.shots);
    if (!Array.isArray(next)) return { ok: false, error: next.error };

    // Re-assemble the film from the updated shots, finished the way the render finishes it.
    const parts = next.map((shot) => ({ shot, path: toLocal(shot.url) })).filter((p) => fs.existsSync(p.path));
    if (!parts.length) return { ok: false, error: "No shot media left to assemble." };
    const outName = newName("");
    const outPath = path.join(RENDERS(), outName);
    try {
      await finishCut(film, shopId, parts, outPath, opts);
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

  // These answer the editor's request directly, so the captions wait at most this long to hear the voices
  // (then they are timed by shot length) — a minute-long spinner on a trim is not "quick".
  const QUICK = { listenMs: 40_000 };
  if (opts.op === "delete") {
    return saveCut(opts.assetId, opts.shopId, (cur) => {
      const k = find(cur);
      if (k < 0) return { error: "That shot no longer exists." };
      if (cur.length <= 1) return { error: "Can't delete the only shot." };
      return cur.filter((_, j) => j !== k);
    }, QUICK);
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
  }, QUICK);
}

/** The cast voice a shot carried, put on a new take of it: a creature's line goes through its creature
 *  chain (never the re-voice trainer), a cast member's through their re-voice. Fails open, like the
 *  render: a voice that can't be applied keeps the take as it is. */
async function applyShotVoice(clip: string, shot: Shot): Promise<string> {
  const creature = characterVoice(shot.voice);
  if (creature) return chainClipVoice(clip, creature.acting.chain);
  if (!shot.voice) return clip;
  try {
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    const model = await ensureVoiceModel(shot.voice, base);
    return await revoiceClip(clip, model.url, base, { voiceId: shot.voice });
  } catch (e) {
    console.error(`[regen] cast voice not applied to the new take: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    return clip;
  }
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
    // a shot that continues the previous one keeps its opening frames, exactly as in the first render,
    // and the film's last shot keeps its beat of quiet after the line
    newClip = await renderDialogueClipTo(engine, shot.seed, shot.prompt, dur, film.aspect, `regen-${i}`, !!shot.chained, undefined, { last: i === film.shots.length - 1 });
  } catch (e) {
    return { ok: false, error: `Shot re-render failed: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"}` };
  }
  // The video model acts every take in a voice of its own. If this shot carried a cast voice, the new
  // take gets the same one — otherwise the re-rolled shot would be the only line in the film spoken by
  // a stranger.
  newClip = await applyShotVoice(newClip, shot);
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

/** ENGINE TEST — one shot of a finished Kling film rendered again from exactly what it was made from
 *  (its stored seed, prompt and length) on another host, and kept as its OWN archive piece next to the
 *  film so the two can be watched and heard side by side. The film itself is never touched (no saveCut).
 *  Admin-only, queued from the shot editor. It exists to answer one question by ear: does fal's copy of
 *  Kling 3 Omni (half the price) sound and look like the Replicate one every approved film came from?
 *  No cast voice is laid over the new take — the comparison is of what each host's model performs. */
export async function engineTestFilmShot(opts: { assetId: string; shopId: string; shotIndex: number; host: KlingHost }): Promise<{ ok: boolean; assetId?: string; error?: string }> {
  const film = await loadFilm(opts.assetId, opts.shopId);
  if (!film) return { ok: false, error: "Film not found." };
  if (film.meta.engine === "veo") return { ok: false, error: "That film was made on Veo — the engine test compares Kling hosts." };
  const i = opts.shotIndex;
  const shot = film.shots[i];
  if (!shot) return { ok: false, error: "That shot no longer exists." };
  if (!shot.seed || !shot.prompt) return { ok: false, error: "This shot predates regenerate — it has no stored seed and prompt." };
  const dur = typeof shot.dur === "number" && shot.dur > 0 ? shot.dur : 8;
  const t0 = Date.now();
  let clip: string;
  try {
    clip = await renderDialogueClipTo("kling3", shot.seed, shot.prompt, dur, film.aspect, `enginetest-${i}`, !!shot.chained, opts.host);
  } catch (e) {
    return { ok: false, error: `Engine test render failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}` };
  }
  const clipName = path.basename(clip);
  try { await mirrorRender(clipName, fs.readFileSync(clip)); } catch { /* non-fatal */ }
  const filmTitle = (await db.asset.findFirst({ where: { id: opts.assetId, shopId: opts.shopId }, select: { title: true } }))?.title || "a film";
  const a = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `Engine test · ${KLING_HOST_LABEL[opts.host]} · shot ${i + 1} of ${filmTitle}`.slice(0, 190),
      bodyJson: JSON.stringify({ style: "ENGINETEST", videoUrl: `/renders/${clipName}`, prompt: "" }),
      metaJson: JSON.stringify({
        kind: "enginetest", section: "creator", abOf: opts.assetId, shot: i, host: opts.host,
        original: shot.url, originalWasRevoiced: !!shot.voice, seconds: Math.round(ffprobeDuration(clip) * 10) / 10,
        renderSeconds: Math.round((Date.now() - t0) / 1000), aspect: film.aspect,
      }),
    },
  });
  console.log(`[enginetest] shot ${i + 1} of ${opts.assetId} on ${opts.host} → ${clipName} (${Math.round((Date.now() - t0) / 1000)} s) asset ${a.id}`);
  return { ok: true, assetId: a.id };
}

/** ENGINE TEST · WHOLE FILM — every shot of a finished Kling film made again on another host from exactly
 *  what it was made from (stored seed, prompt and length; a shot that continued the previous one continues
 *  THIS version's previous take, from its real last frame, as the render chains), with the film's cast
 *  voices, then cut, levelled and captioned the way the render finishes a film. Kept as its own film in the
 *  Archive, editable like any other; the original is never touched. It answers the question one shot
 *  can't: does a whole film still come out right on the cheaper host? Admin-only, on the worker. */
export async function engineTestFilm(opts: { assetId: string; shopId: string; host: KlingHost }): Promise<{ ok: boolean; assetId?: string; error?: string }> {
  const film = await loadFilm(opts.assetId, opts.shopId);
  if (!film) return { ok: false, error: "Film not found." };
  if (film.meta.engine === "veo") return { ok: false, error: "That film was made on Veo — the engine test compares Kling hosts." };
  if (!film.shots.length) return { ok: false, error: "This film has no shots to render." };
  if (film.shots.some((s) => !s.seed || !s.prompt)) return { ok: false, error: "This film predates regenerate — its shots have no stored seed and prompt." };
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const t0 = Date.now();
  const parts: Array<{ shot: Shot; path: string }> = [];
  let prevLast: string | undefined;
  for (let i = 0; i < film.shots.length; i++) {
    const shot = film.shots[i];
    const dur = typeof shot.dur === "number" && shot.dur > 0 ? shot.dur : 8;
    const seed = shot.chained && prevLast ? prevLast : (shot.seed as string);
    let clip: string;
    try {
      clip = await renderDialogueClipTo("kling3", seed, shot.prompt as string, dur, film.aspect, `enginefilm-${i}`, !!shot.chained, opts.host, { last: i === film.shots.length - 1 });
    } catch (e) {
      return { ok: false, error: `Shot ${i + 1} did not render: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}` };
    }
    clip = await applyShotVoice(clip, shot);
    try { await mirrorRender(path.basename(clip), fs.readFileSync(clip)); } catch { /* non-fatal */ }
    const last = await extractLastFrame(clip);
    prevLast = last && base ? `${base}${last}` : undefined;
    parts.push({ shot: { ...shot, url: `/renders/${path.basename(clip)}`, ...(shot.chained ? { seed } : {}) }, path: clip });
    console.log(`[enginetest] film ${opts.assetId} shot ${i + 1}/${film.shots.length} on ${opts.host} → ${path.basename(clip)} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  const outName = newName("-engine");
  const outPath = path.join(RENDERS(), outName);
  let captions: CaptionStyle = "off";
  try {
    captions = await finishCut(film, opts.shopId, parts, outPath);
  } catch (e) {
    return { ok: false, error: `The cut failed: ${e instanceof Error ? e.message.slice(0, 100) : "unknown"}` };
  }
  if (!(fs.existsSync(outPath) && ffprobeDuration(outPath) > 1)) return { ok: false, error: "The cut produced no film." };
  try { await mirrorRender(outName, fs.readFileSync(outPath)); } catch { /* non-fatal */ }
  const filmTitle = (await db.asset.findFirst({ where: { id: opts.assetId, shopId: opts.shopId }, select: { title: true } }))?.title || "a film";
  const a = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `Engine test · ${KLING_HOST_LABEL[opts.host]} · ${filmTitle}`.slice(0, 190),
      bodyJson: JSON.stringify({ style: "ENGINETEST", videoUrl: `/renders/${outName}`, prompt: "", ...(film.body.treatment ? { treatment: film.body.treatment } : {}) }),
      metaJson: JSON.stringify({
        kind: "enginetest", whole: true, section: "creator", abOf: opts.assetId, host: opts.host,
        original: typeof film.body.videoUrl === "string" ? film.body.videoUrl : null,
        seconds: Math.round(ffprobeDuration(outPath) * 10) / 10, renderSeconds: Math.round((Date.now() - t0) / 1000),
        aspect: film.aspect, engine: "kling3", captions, scenes: parts.length,
        shots: parts.map((p) => p.shot),
      }),
    },
  });
  console.log(`[enginetest] whole film ${opts.assetId} on ${opts.host} → ${outName} (${Math.round((Date.now() - t0) / 1000)} s, captions ${captions}) asset ${a.id}`);
  return { ok: true, assetId: a.id };
}
