/* A LYRIC VIDEO, MADE — the listening, the drawing and the encoding. Every decision is in lyric-video.ts.
 *
 *   1. THE SONG      the member's own upload, read off our disk (api.film-song-upload); longer than
 *                    LYRIC_MAX_SECONDS, and the video is that long
 *   2. THE WORDS     heard the way the app hears singing (lyric-sync.ts, film-captions.server.ts): a full-rate
 *                    copy, the vocal separated first and heard softly, the whole mix as the way back; pasted
 *                    lyrics are laid over the listen that matched most of them. With nothing pasted, the vocal
 *                    and the mix are both heard, and each keeps only the words where the vocal is SOUNDING
 *   3. THE BEAT      the song decoded to mono samples, its beat and bars found (lyric-video.ts → beatGrid)
 *   4. THE PLAN      the scenes, every cut on a beat (scenePlan)
 *   5. THE LOOK      the art direction from a writer (a fallback when it fails), then every picture drawn by the
 *                    everyday picture model, three at a time — none with text in it
 *   6. THE CUT       the lyrics file (lyricAss), and the video encoded in pieces of whole shots (no encode runs
 *                    long), joined, the song as the sound
 *   7. THE PIECE     a VIDEO_AD in the Archive: "Lyric Video — <title>"
 *
 * RESUMES: the heard words, the plan, the direction and every picture as it is drawn are checkpointed on the
 * job (ckLv…), so a restart picks up where it stopped and never pays for a picture twice.
 *
 * A SONG FROM A LINK (songFromLink, below) — YouTube only, and only once the member has confirmed the song is
 * theirs or they have its owner's permission (the owner, 2026-11-24). Admin-only until the owner sets a price
 * (api.lyric-video.tsx); no tokens are charged. */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { checkpointJob, download, ffmpegBin, ffprobeDuration, repPoll, resolveTextFont, runFfmpeg } from "./ugc-ad-pipeline.server";
import { createWhisperx, pictureRefused } from "./faceless-video.server";
import { persistRemote, repRun } from "./image-generation.server";
import { mirrorRender } from "./object-storage.server";
import { readVoiceSound } from "./voice-sound.server";
import { fontFamilyOf } from "./caption-burn.server";
import { canDraw, readFontMetrics } from "./font-metrics";
import { LISTEN_AUDIO, heardTooLittle, lyricWordTimes } from "./lyric-sync";
import { barBox, listenedWords, type WordT } from "./narrated-core";
import {
  DIRECTION_SCHEMA, LINK_FETCHES_A_DAY, LINK_MSG, LINK_TIMEOUT_MS, LYRIC_FPS, LYRIC_MAX_SECONDS, NO_GRID, beatGrid, chooseLines,
  chunkGraph, directionBrief, fallbackDirection, linkFailure, linkTitleOf, lyricAccent, lyricAss, lyricFrame, lyricLookOf,
  lyricShapeOf, parseDirection, pastedLines, planOk, renderChunks, scenePlan, scrimAlpha, shotFrames, shotPulses, songFileOf,
  songRightsOf, songTitleOf, stillPrompt, toolDetail, voicedWords, youTubeId, youTubeWatch, ytDlpArgs,
  type ArtDirection, type BeatGrid, type CropBox, type LyricLine, type LyricLook, type LyricShape, type ScenePlan,
} from "./lyric-video";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
const stamp = () => `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 180);
/** A path as it is written inside a filter: forward slashes, and the colon of a drive letter escaped. */
const inFilter = (p: string): string => p.replace(/\\/g, "/").replace(/:/g, "\\:");

/* ---------------------------------------------------------------------------------------------------------
 * THE LINK — a song from a YouTube address
 * ------------------------------------------------------------------------------------------------------- */

/** Where the fetching tool is. The image installs it (scripts/fetch-yt-dlp.mjs, run by the Dockerfile) with the
 *  JavaScript runtime YouTube's pages need (Deno — the image's Node is too old for it). A machine without it
 *  answers every link "upload the file instead". */
export const ytDlpBin = (): string => process.env.YT_DLP_PATH || "/usr/local/bin/yt-dlp";
/** The PO-token program yt-dlp's plugin calls (scripts/fetch-yt-dlp.mjs installs both): YouTube's answer to a cloud
 *  server was "Sign in to confirm you're not a bot" on the first live try (2026-11-24). Used when it is there. */
export const potBin = (): string => process.env.BGUTIL_POT_PATH || "/usr/local/bin/bgutil-pot";

/** Each account's fetches in the last day. Kept in memory: a restart forgets them, which only ever errs kind. */
const fetchedAt = new Map<string, number[]>();

type Ran = { code: number | null; out: string; err: string; timedOut: boolean };
/** Run a tool to its end or to `ms`, keeping the tail of what it printed. Never throws. */
function runTool(bin: string, args: string[], ms: number): Promise<Ran> {
  return new Promise((resolve) => {
    let out = "", err = "", timedOut = false, settled = false;
    const keep = (s: string, c: Buffer) => { const n = s + c.toString(); return n.length > 65536 ? n.slice(-32768) : n; };
    let child: ReturnType<typeof spawn>;
    try { child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { resolve({ code: null, out: "", err: short(e), timedOut: false }); return; }
    const timer = setTimeout(() => { timedOut = true; try { child.kill("SIGKILL"); } catch { /* gone */ } }, ms);
    const finish = (code: number | null) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code, out, err, timedOut }); };
    child.stdout?.on("data", (c: Buffer) => { out = keep(out, c); });
    child.stderr?.on("data", (c: Buffer) => { err = keep(err, c); });
    child.on("error", (e) => { err += `\n${short(e)}`; finish(null); });
    child.on("close", (code) => finish(code));
  });
}

export type FromLink =
  | { ok: true; songPath: string; name: string; title: string; seconds: number | null; source: string }
  /** detail: what the tool said, for an operator (toolDetail) — never shown to a member */
  | { ok: false; message: string; why: string; detail?: string };

/** A SONG FROM A LINK. The owner, 2026-11-24: "use YouTube link but include regulatory things like 'you must have
 *  permissions from song owner'". So it is fetched only for a member who has confirmed they own the song or have its
 *  owner's permission (api.lyric-video.tsx refuses before this is called; the piece keeps the confirmation), and
 *  only from YouTube: the video's id is read out of the link and the address written again from it. The audio of
 *  that one video is fetched — no playlist, nothing live, nothing over LINK_MAX_SECONDS — and kept beside the
 *  uploads as mvsong-<hex>.m4a (or .mp3 when YouTube had no AAC), exactly where an upload goes: everything after it
 *  is as for an upload. It runs inside the member's request, so it never waits for the encoder's turn (a film may
 *  hold it for minutes): AAC is kept as it is, and anything else is converted by its own short ffmpeg. */
export async function songFromLink(link: string, o: { shopId?: string; log?: (s: string) => void } = {}): Promise<FromLink> {
  const log = o.log || ((s: string) => console.log(`[lyricvideo] ${s}`));
  const id = youTubeId(link);
  if (!id) return { ok: false, message: LINK_MSG.notYouTube, why: "not a YouTube video link" };
  const bin = ytDlpBin();
  if (!fs.existsSync(bin)) return { ok: false, message: LINK_MSG.noTool, why: `no ${bin}` };
  if (o.shopId) {
    const now = Date.now();
    const recent = (fetchedAt.get(o.shopId) || []).filter((t) => now - t < 24 * 3600_000);
    if (recent.length >= LINK_FETCHES_A_DAY) return { ok: false, message: LINK_MSG.many, why: "the day's fetches are used" };
    recent.push(now);
    fetchedAt.set(o.shopId, recent);
  }
  const source = youTubeWatch(id);
  const dir = RENDERS();
  fs.mkdirSync(dir, { recursive: true });
  const tag = crypto.randomBytes(8).toString("hex");
  const mine = (): string[] => { try { return fs.readdirSync(dir).filter((f) => f.startsWith(`ytsrc-${tag}.`)); } catch { return []; } };
  const t0 = Date.now();
  try {
    const pot = potBin();
    // YT_DLP_PROXY: where the fetch goes out from — YouTube blocks the server's own address (ytDlpArgs)
    const ran = await runTool(bin, ytDlpArgs(source, path.join(dir, `ytsrc-${tag}.%(ext)s`), { potCli: fs.existsSync(pot) ? pot : undefined, verbose: true, proxy: process.env.YT_DLP_PROXY || undefined }), LINK_TIMEOUT_MS);
    const files = mine();
    const media = files.find((f) => !/\.(?:json|part|ytdl|tmp|temp)$/i.test(f) && !/\.part-Frag/i.test(f));
    if (!media) {
      const why = linkFailure(ran);
      const detail = toolDetail(ran.out, ran.err);
      log(`link ${id}: not fetched (${why}; exit ${ran.code}${ran.timedOut ? ", timed out" : ""}): ${detail.replace(/\s+/g, " ").slice(-600)}`);
      return { ok: false, message: LINK_MSG[why], why, detail };
    }
    let info: Record<string, unknown> | null = null;
    const json = files.find((f) => f.endsWith(".info.json"));
    if (json) { try { info = JSON.parse(fs.readFileSync(path.join(dir, json), "utf8")) as Record<string, unknown>; } catch { info = null; } }
    const name = `mvsong-${crypto.randomBytes(10).toString("hex")}`;
    let out = "";
    if (/\.m4a$/i.test(media)) {
      out = path.join(dir, `${name}.m4a`);
      fs.renameSync(path.join(dir, media), out);
    } else {
      out = path.join(dir, `${name}.mp3`);
      const ex = await runTool(ffmpegBin(), ["-y", "-v", "error", "-i", path.join(dir, media), "-vn", "-map", "0:a:0", "-c:a", "libmp3lame", "-q:a", "2", out], 60_000);
      if (ex.code !== 0 || !fs.existsSync(out)) {
        try { fs.rmSync(out, { force: true }); } catch { /* best effort */ }
        log(`link ${id}: fetched (${media}) but not made an MP3: ${ex.err.replace(/\s+/g, " ").slice(-200)}`);
        return { ok: false, message: LINK_MSG.failed, why: "the audio could not be read" };
      }
    }
    if (fs.statSync(out).size < 4096) {
      try { fs.rmSync(out, { force: true }); } catch { /* best effort */ }
      return { ok: false, message: LINK_MSG.failed, why: "the audio came out empty" };
    }
    let seconds: number | null = typeof info?.duration === "number" && (info.duration as number) > 0 ? (info.duration as number) : null;
    if (seconds === null) { try { seconds = ffprobeDuration(out); } catch { seconds = null; } }
    const title = linkTitleOf(info as { title?: unknown; track?: unknown; artist?: unknown } | null);
    log(`link ${id}: fetched in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${path.basename(out)} (${seconds ? `${Math.round(seconds)}s` : "length unknown"})`);
    return { ok: true, songPath: out, name: (typeof info?.title === "string" ? (info.title as string) : title).slice(0, 200), title, seconds, source };
  } finally {
    for (const f of mine()) { try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* best effort */ } }
  }
}

/* ---------------------------------------------------------------------------------------------------------
 * 2. THE WORDS
 * ------------------------------------------------------------------------------------------------------- */

/** How a file on this disk is made reachable by the listening service: on the live site, by its address on our
 *  own /renders route (and the object-store mirror). A local run hands in its own way. */
export type Publish = (file: string) => Promise<string>;
const publishRender: Publish = async (file) => {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("no public address to listen from (SHOPIFY_APP_URL)");
  try { await mirrorRender(path.basename(file), fs.readFileSync(file)); } catch { /* the disk copy is served */ }
  return `${base}/renders/${path.basename(file)}`;
};

export type Heard = {
  words: WordT[];
  /** which listen was kept: the vocal alone, the whole mix heard softly, or the whole mix on the stock settings */
  via: "vocal" | "mix" | "mix-stock";
  language: string | null;
  /** where the separated vocal is sounding (seconds) — [] when it could not be separated */
  voiced: Array<[number, number]>;
};

/** EVERY SUNG WORD, WITH ITS TIME. `pasted` = the member's pasted lyric lines ([] for none). Throws only when
 *  the song cannot be heard at all. */
export async function hearLyricSong(o: { songPath: string; seconds: number; pasted: string[]; jobId?: string; publish?: Publish; log?: (s: string) => void }): Promise<Heard> {
  const log = o.log || ((s: string) => console.log(`[lyricvideo] ${s}`));
  const beat = async () => { if (o.jobId) await checkpointJob(o.jobId, { ckBeat: Date.now() }); };
  const publish = o.publish || publishRender;
  const id = stamp();
  const copy = path.join(RENDERS(), `lyv-${id}.mp3`);
  const vocalFile = path.join(RENDERS(), `lyvv-${id}.mp3`);
  fs.mkdirSync(RENDERS(), { recursive: true });
  try {
    // the song at full rate (a 16 kHz copy loses the singing — lyric-sync.ts has the measurements)
    const ex = await runFfmpeg(["-y", "-i", o.songPath, "-vn", "-t", String(o.seconds), ...LISTEN_AUDIO, copy]);
    if (ex.status !== 0 || !fs.existsSync(copy)) throw new Error(`the song could not be read: ${(ex.stderr || "").slice(-160)}`);
    const mixUrl = await publish(copy);
    const listen = async (src: string, sung: boolean): Promise<{ words: WordT[]; language: string | null }> => {
      const raw = (await repPoll(await createWhisperx(src, null, { sung }), 5 * 60_000, "lyricvideo-listen")) as unknown as { detected_language?: unknown } | null;
      await beat();
      return { words: listenedWords(raw), language: typeof raw?.detected_language === "string" ? raw.detected_language : null };
    };
    // THE VOCAL ALONE — and where it is sounding
    let vocalUrl = "";
    let voiced: Array<[number, number]> = [];
    try {
      const { separateSong } = await import("./singing-voice.server");
      vocalUrl = (await separateSong(mixUrl)).vocals;
      await beat();
      await download(vocalUrl, vocalFile);
      const sound = await readVoiceSound(vocalFile, o.seconds);
      voiced = (sound.speech[1] || []).map(([a, b]) => [a, b] as [number, number]);
      log(`the vocal, separated: sounding in ${voiced.length} stretches${sound.unread ? ` (not read: ${sound.unread})` : ""}`);
    } catch (e) { log(`the vocal could not be separated — the whole mix is heard: ${short(e)}`); }

    type Try = { via: Heard["via"]; words: WordT[]; language: string | null };
    const tries: Try[] = [];
    if (o.pasted.length) {
      // PASTED LYRICS: the listen that matches most of them (the order captionLyrics uses for a song we wrote)
      const matched = (t: Try) => lyricWordTimes(o.pasted, t.words).matched;
      if (vocalUrl) { try { tries.push({ via: "vocal", ...(await listen(vocalUrl, true)) }); } catch (e) { log(`listening to the vocal failed: ${short(e)}`); } }
      const best = () => tries.reduce<Try | null>((b, t) => (!b || matched(t) > matched(b) ? t : b), null);
      const enough = () => { const b = best(); return !!b && !heardTooLittle(lyricWordTimes(o.pasted, b.words)); };
      if (!enough()) { try { tries.push({ via: "mix", ...(await listen(mixUrl, true)) }); } catch (e) { log(`listening to the mix failed: ${short(e)}`); } }
      if (!enough()) { try { tries.push({ via: "mix-stock", ...(await listen(mixUrl, false)) }); } catch (e) { log(`the second listen to the mix failed: ${short(e)}`); } }
      const b = best();
      if (!b) throw new Error("the song could not be heard");
      for (const t of tries) log(`heard on ${t.via}: ${t.words.length} words, ${matched(t)}/${lyricWordTimes(o.pasted, t.words).total} lyric words matched`);
      return { words: b.words, via: b.via, language: b.language, voiced };
    }
    // NOTHING PASTED: the vocal (softly) and the whole mix (stock) heard side by side; each keeps the words where
    // the vocal is sounding (on a vocal alone the listener writes a "thank you" into the quiet); more kept wins
    const [v, m] = await Promise.all([
      vocalUrl ? listen(vocalUrl, true).catch((e) => { log(`listening to the vocal failed: ${short(e)}`); return null; }) : Promise.resolve(null),
      listen(mixUrl, false).catch((e) => { log(`listening to the mix failed: ${short(e)}`); return null; }),
    ]);
    if (v) tries.push({ via: "vocal", words: voicedWords(v.words, voiced), language: v.language });
    if (m) tries.push({ via: "mix-stock", words: voicedWords(m.words, voiced), language: m.language });
    if (!tries.some((t) => t.words.length >= 3)) {
      try { const s = await listen(mixUrl, true); tries.push({ via: "mix", words: voicedWords(s.words, voiced), language: s.language }); } catch (e) { log(`a soft listen to the mix failed: ${short(e)}`); }
    }
    if (!tries.length) throw new Error("the song could not be heard");
    log(`heard: ${[v ? `vocal ${v.words.length}` : "", m ? `mix ${m.words.length}` : ""].filter(Boolean).join(", ")} words; kept where the vocal sounds — ${tries.map((t) => `${t.via} ${t.words.length}`).join(", ")}`);
    const b = tries.reduce((x, t) => (t.words.length > x.words.length * 1.1 ? t : x));
    return { words: b.words, via: b.via, language: b.language, voiced };
  } finally {
    for (const f of [copy, vocalFile]) { try { fs.rmSync(f, { force: true }); } catch { /* best effort */ } }
  }
}

/* ---------------------------------------------------------------------------------------------------------
 * 3. THE BEAT
 * ------------------------------------------------------------------------------------------------------- */

/** The song's beat and bars (lyric-video.ts → beatGrid), from its first `seconds`. Never throws: no grid
 *  means the scenes are cut on the sung lines. */
export async function songGrid(songPath: string, seconds: number, lineStarts: number[]): Promise<BeatGrid> {
  const raw = path.join(RENDERS(), `lyvb-${stamp()}.f32`);
  try {
    const r = await runFfmpeg(["-y", "-i", songPath, "-t", String(seconds), "-ac", "1", "-ar", "11025", "-f", "f32le", raw]);
    if (r.status !== 0 || !fs.existsSync(raw)) return NO_GRID;
    const buf = fs.readFileSync(raw);
    const pcm = new Float32Array(buf.byteLength >> 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = buf.readFloatLE(i * 4);
    return beatGrid(pcm, 11025, lineStarts);
  } catch (e) {
    console.error(`[lyricvideo] the beat could not be found — cutting on the lines: ${short(e)}`);
    return NO_GRID;
  } finally { try { fs.rmSync(raw, { force: true }); } catch { /* nothing written */ } }
}

/* ---------------------------------------------------------------------------------------------------------
 * 5. THE LOOK, AND THE PICTURES
 * ------------------------------------------------------------------------------------------------------- */

/** One art direction for the whole song — the writer's, or the look's own when the writer fails. */
export async function lyricDirection(o: { title: string; sections: string[]; look: LyricLook; shape: LyricShape; log?: (s: string) => void }): Promise<ArtDirection> {
  const log = o.log || ((s: string) => console.log(`[lyricvideo] ${s}`));
  try {
    const raw = await anthropicText(directionBrief(o), { model: "claude-sonnet-5", maxTokens: 2500, jsonSchema: DIRECTION_SCHEMA });
    const d = parseDirection(raw, { sections: o.sections, look: o.look });
    if (d) return d;
    log("the writer's answer was not a direction — the look's own is used");
  } catch (e) { log(`the writer did not answer — the look's own direction is used: ${short(e)}`); }
  return fallbackDirection({ sections: o.sections, look: o.look });
}

/** A picture, as kept: its /renders address and the box its real content sits in when it came with black bars. */
export type StillRec = { src: string; crop: CropBox | null };
const diskOf = (src: string): string => path.join(RENDERS(), path.basename(src.split("?")[0]));

/** Every picture of the direction that is not drawn yet, three at a time — each checkpointed the moment it
 *  exists (`onDrawn`). A picture the model refuses is asked for again without its stretch's words, then as light
 *  and colour alone; one that fails three times is left empty (its neighbour stands in). */
export async function drawStills(o: { direction: ArtDirection; look: LyricLook; shape: LyricShape; have: Array<StillRec | null>; onDrawn: (i: number, rec: StillRec) => Promise<void>; log?: (s: string) => void }): Promise<Array<StillRec | null>> {
  const log = o.log || ((s: string) => console.log(`[lyricvideo] ${s}`));
  const n = o.direction.pictures.length;
  const out: Array<StillRec | null> = Array.from({ length: n }, (_, i) => {
    const h = o.have[i];
    return h && typeof h.src === "string" && fs.existsSync(diskOf(h.src)) ? h : null;
  });
  const todo = out.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
  let next = 0;
  const one = async (i: number): Promise<void> => {
    let plain: boolean | "abstract" = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const url = await repRun("google/nano-banana", { prompt: stillPrompt(o.direction, i, o.look, o.shape, plain), aspect_ratio: o.shape, output_format: "jpg" }, 150_000);
        const src = await persistRemote(url, "jpg");
        let crop: CropBox | null = null;
        try { crop = barBox((await runFfmpeg(["-loop", "1", "-i", diskOf(src), "-vf", "cropdetect=limit=10:round=2:reset=0", "-frames:v", "5", "-f", "null", "-"])).stderr); } catch { /* as it is */ }
        out[i] = { src, crop };
        await o.onDrawn(i, out[i]!);
        return;
      } catch (e) {
        const msg = short(e);
        // a refusal is about what was asked: ask for less (its words gone, then light and colour alone); any other
        // failure is asked again as it was
        if (pictureRefused(msg)) plain = plain === false ? true : "abstract";
        const last = attempt === 2;
        log(`picture ${i + 1} ${last ? "failed three times — a neighbour stands in" : pictureRefused(msg) ? (plain === "abstract" ? "refused again — asked for light and colour alone" : "refused — asked again without its words") : "failed — asked again"}: ${msg}`);
      }
    }
  };
  const worker = async () => { while (next < todo.length) await one(todo[next++]); };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}

/* ---------------------------------------------------------------------------------------------------------
 * 6. THE CUT
 * ------------------------------------------------------------------------------------------------------- */

/** Encode the video: the shading picture, then the shots in pieces of whole shots (each with the lyrics drawn
 *  at its place in the song), then the pieces joined with the song as the sound. Throws when it cannot. */
export async function renderLyricVideo(o: {
  songPath: string; seconds: number; songSeconds: number; plan: ScenePlan; stills: StillRec[]; ass: string; fontFile: string;
  look: LyricLook; W: number; H: number; outPath: string; jobId?: string; log?: (s: string) => void;
}): Promise<void> {
  const log = o.log || ((s: string) => console.log(`[lyricvideo] ${s}`));
  const beat = async () => { if (o.jobId) await checkpointJob(o.jobId, { ckBeat: Date.now() }); };
  const id = stamp();
  const dir = RENDERS();
  const temp: string[] = [];
  const tmp = (name: string) => { const f = path.join(dir, `lyv-${id}-${name}`); temp.push(f); return f; };
  try {
    const assFile = tmp("lyrics.ass");
    if (o.ass) fs.writeFileSync(assFile, o.ass, "utf8");
    const assFilter = o.ass ? `ass=filename='${inFilter(assFile)}':fontsdir='${inFilter(path.dirname(o.fontFile))}'` : null;
    // the shading under the words: drawn once, as a picture
    const scrim = tmp("scrim.png");
    const s = await runFfmpeg(["-y", "-f", "lavfi", "-i", `color=c=black:s=${o.W}x${o.H}:d=1`, "-vf", `format=rgba,geq=r='0':g='0':b='0':a='${scrimAlpha(o.look)}'`, "-frames:v", "1", scrim]);
    if (s.status !== 0 || !fs.existsSync(scrim)) throw new Error(`the shading could not be drawn: ${(s.stderr || "").slice(-200)}`);
    const frames = shotFrames(o.plan.shots, LYRIC_FPS);
    const chunks = renderChunks(frames);
    const pieces: string[] = [];
    const total = frames.reduce((a, b) => a + b, 0);
    for (let c = 0; c < chunks.length; c++) {
      const ch = chunks[c];
      const shots = o.plan.shots.slice(ch.from, ch.to + 1);
      const fr = frames.slice(ch.from, ch.to + 1);
      const last = c === chunks.length - 1;
      const graph = chunkGraph({
        shots, frames: fr, W: o.W, H: o.H, frame0: ch.frame0, assFilter,
        crops: shots.map((sh) => o.stills[sh.pic]?.crop || null),
        pulses: shots.map((sh, k) => shotPulses(sh, fr[k], o.plan.grid, o.look, LYRIC_FPS)),
        fadeOut: last ? { at: Math.max(0, ch.frames / LYRIC_FPS - 0.8), d: 0.8 } : null,
      });
      const graphFile = tmp(`graph${c}.txt`);
      fs.writeFileSync(graphFile, graph, "utf8");
      const piece = tmp(`piece${c}.mp4`);
      const args = ["-y"];
      for (const sh of shots) args.push("-i", diskOf(o.stills[sh.pic].src));
      args.push("-i", scrim); // one frame, held by the overlay for the whole piece
      args.push("-filter_complex_script", graphFile, "-map", "[v]", "-an", "-frames:v", String(ch.frames), "-r", String(LYRIC_FPS),
        "-threads", "2", "-filter_complex_threads", "2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-maxrate", "6M", "-bufsize", "12M", "-pix_fmt", "yuv420p", piece);
      const t0 = Date.now();
      const r = await runFfmpeg(args);
      if (r.status !== 0 || !fs.existsSync(piece)) throw new Error(`piece ${c + 1} of ${chunks.length} did not encode: ${(r.stderr || "").slice(-300)}`);
      pieces.push(piece);
      log(`piece ${c + 1}/${chunks.length}: ${shots.length} shots, ${ch.frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      await beat();
    }
    // the pieces joined (the same encoder settings: copied, not encoded again), the song as the sound
    const list = tmp("pieces.txt");
    fs.writeFileSync(list, pieces.map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
    const capped = o.songSeconds > o.seconds + 0.25;
    const join = await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-i", o.songPath, "-map", "0:v", "-map", "1:a",
      "-c:v", "copy", ...(capped ? ["-af", `afade=t=out:st=${Math.max(0, o.seconds - 2).toFixed(2)}:d=2`] : []),
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-t", (total / LYRIC_FPS).toFixed(3), "-movflags", "+faststart", o.outPath]);
    if (join.status !== 0 || !fs.existsSync(o.outPath)) throw new Error(`the video could not be put together: ${(join.stderr || "").slice(-300)}`);
    const got = ffprobeDuration(o.outPath);
    if (Math.abs(got - total / LYRIC_FPS) > 0.35) throw new Error(`the video came out ${got.toFixed(2)}s long, not ${(total / LYRIC_FPS).toFixed(2)}s`);
  } finally {
    for (const f of temp) { try { fs.rmSync(f, { force: true }); } catch { /* best effort */ } }
  }
}

/* ---------------------------------------------------------------------------------------------------------
 * THE WHOLE MAKING
 * ------------------------------------------------------------------------------------------------------- */

export type LyricVideoOptions = {
  shopId: string;
  /** the address api.film-song-upload handed back (only our own uploads are read) */
  songUrl: string;
  /** the name of the file the member dropped (the title comes from it when none is given) */
  songName?: string;
  title?: string;
  /** the member's pasted lyrics ("" for none) */
  lyrics?: string;
  look?: unknown;
  shape?: unknown;
  section?: string;
  jobId?: string;
  resume?: { ckLvHeard?: string; ckLvPlan?: string; ckLvDirection?: string; ckLvStills?: string };
  /** the member's confirmation that the song is theirs or they have its owner's permission (songRightsOf) —
   *  kept on the piece */
  songRights?: unknown;
};

export type LyricVideoMade = { outName: string; outPath: string; title: string; lines: LyricLine[]; plan: ScenePlan; ass: string; meta: Record<string, unknown> };

/** Everything but the Archive row — what the job runs, and what a local proof runs (with its own `publish`, the
 *  song as a file on its disk, and `onCheckpoint` to keep what a job would have checkpointed). */
export async function makeLyricVideo(o: LyricVideoOptions & { songPath?: string; publish?: Publish; log?: (s: string) => void; onCheckpoint?: (patch: Record<string, unknown>) => Promise<void> }): Promise<LyricVideoMade> {
  const log = o.log || ((s: string) => console.log(`[lyricvideo] ${s}`));
  const ckpt = async (patch: Record<string, unknown>) => {
    if (o.onCheckpoint) await o.onCheckpoint(patch);
    if (o.jobId) await checkpointJob(o.jobId, patch);
  };
  const resume = o.resume || {};
  const look = lyricLookOf(o.look);
  const shape = lyricShapeOf(o.shape);
  const { W, H } = lyricFrame(shape);
  fs.mkdirSync(RENDERS(), { recursive: true });

  // 1) THE SONG — our own upload, on this disk
  let songPath = o.songPath || "";
  if (!songPath) {
    const name = songFileOf(o.songUrl);
    if (!name) throw new Error("[NO-RETRY] [lyricvideo] that song is not one of our uploads");
    songPath = path.join(RENDERS(), name);
    if (!fs.existsSync(songPath)) {
      const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
      if (!base) throw new Error("[NO-RETRY] [lyricvideo] the song file is gone");
      await download(`${base}/renders/${name}`, songPath);
    }
  }
  const songSeconds = ffprobeDuration(songPath);
  if (!(songSeconds >= 5)) throw new Error("[NO-RETRY] [lyricvideo] that song is too short to make a video of");
  const seconds = Math.min(songSeconds, LYRIC_MAX_SECONDS);
  const title = (o.title || "").replace(/\s+/g, " ").trim().slice(0, 80) || songTitleOf(o.songName || "");
  const pasted = pastedLines(o.lyrics || "");

  // 2) THE WORDS
  let heard: Heard | null = null;
  if (resume.ckLvHeard) { try { heard = JSON.parse(resume.ckLvHeard) as Heard; } catch { heard = null; } }
  if (!heard || !Array.isArray(heard.words)) {
    heard = await hearLyricSong({ songPath, seconds, pasted, jobId: o.jobId, publish: o.publish, log });
    const r2 = (x: number) => Math.round(x * 1000) / 1000;
    await ckpt({ ckLvHeard: JSON.stringify({ ...heard, words: heard.words.map((w) => ({ word: w.word, start: r2(w.start), end: r2(w.end) })), voiced: heard.voiced.map(([a, b]) => [r2(a), r2(b)]) }) });
  }
  const chosen = chooseLines({ pasted, heard: heard.words });
  const lines = chosen.lines.filter((l) => l.t0 < seconds - 0.2).map((l) => ({ ...l, words: l.words.filter((w) => w.t0 < seconds - 0.2) }));
  log(`words: ${lines.reduce((n, l) => n + l.words.length, 0)} in ${lines.length} lines, from ${chosen.from === "pasted" ? `the pasted lyrics (${chosen.matched}/${chosen.total} heard)` : "what was heard"}; listened on ${heard.via}; language ${heard.language || "?"}`);

  // 3) THE BEAT and 4) THE PLAN (checkpointed: a resumed job cuts exactly the plan its pictures were drawn for)
  let plan: ScenePlan | null = null;
  if (resume.ckLvPlan) { try { const p = JSON.parse(resume.ckLvPlan); plan = planOk(p) ? p : null; } catch { plan = null; } }
  if (!plan) {
    const grid = await songGrid(songPath, seconds, lines.map((l) => l.t0));
    plan = scenePlan({ duration: seconds, grid, lines });
    await ckpt({ ckLvPlan: JSON.stringify(plan) });
  }
  log(`plan: ${plan.sections.length} pictures, ${plan.shots.length} shots over ${plan.duration.toFixed(1)}s; ${plan.grid.beats.length ? `${plan.grid.bpm} bpm, ${plan.grid.bars.length} bars` : "no steady beat — cut on the lines"}`);

  // 5) THE LOOK, AND THE PICTURES
  let direction: ArtDirection | null = null;
  if (resume.ckLvDirection) { try { direction = JSON.parse(resume.ckLvDirection) as ArtDirection; } catch { direction = null; } }
  if (!direction || !Array.isArray(direction.pictures) || direction.pictures.length !== plan.sections.length) {
    direction = await lyricDirection({ title, sections: plan.sections.map((s) => s.text), look, shape, log });
    await ckpt({ ckLvDirection: JSON.stringify(direction) });
  }
  log(`look: ${direction.from} — ${direction.style.slice(0, 120)}`);
  let have: Array<StillRec | null> = [];
  if (resume.ckLvStills) { try { have = JSON.parse(resume.ckLvStills); } catch { have = []; } }
  const kept = have.slice();
  const drawn = await drawStills({
    direction, look, shape, have, log,
    onDrawn: async (i, rec) => { kept[i] = rec; await ckpt({ ckLvStills: JSON.stringify(kept) }); },
  });
  if (!drawn.some(Boolean)) throw new Error("[lyricvideo] no picture could be drawn");
  // a picture that could not be drawn: its neighbour stands in (moving another way)
  const stills: StillRec[] = drawn.map((r, i) => r || drawn.slice(0, i).reverse().find(Boolean) || drawn.find(Boolean)!) as StillRec[];
  const missing = drawn.filter((r) => !r).length;

  // 6) THE LYRICS AND THE CUT
  const allText = lines.map((l) => l.text).join(" ") + " " + title;
  let fontFile = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
  try { fontFile = await resolveTextFont(allText); } catch (e) { log(`no font for these words — drawn in Poppins: ${short(e)}`); }
  const metrics = readFontMetrics(new Uint8Array(fs.readFileSync(fontFile)));
  if (!metrics) throw new Error("[lyricvideo] the lyrics' font could not be read");
  if (!canDraw(metrics, allText)) log("some of these letters are not in the font — the renderer will look for them");
  const accent = lyricAccent(direction, look);
  const cuts = plan.sections.slice(1).map((s) => s.t0);
  const ass = lyricAss({ look, lines, W, H, metrics, family: fontFamilyOf(fontFile), accent, bars: plan.grid.bars, cuts, title, duration: plan.duration });
  const outName = `lyricvideo-${stamp()}.mp4`;
  const outPath = path.join(RENDERS(), outName);
  const t0 = Date.now();
  await renderLyricVideo({ songPath, seconds: plan.duration, songSeconds, plan, stills, ass, fontFile, look, W, H, outPath, jobId: o.jobId, log });
  log(`encoded in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${outName} (${(fs.statSync(outPath).size / 1e6).toFixed(1)} MB)`);
  try { await mirrorRender(outName, fs.readFileSync(outPath)); } catch { /* the disk copy is served */ }

  const meta: Record<string, unknown> = {
    kind: "lyricvideo", template: "lyricvideo", section: o.section || "creator", look, aspect: shape,
    seconds: Math.round(plan.duration), songSeconds: Math.round(songSeconds), bpm: plan.grid.bpm || null,
    pictures: plan.sections.length, shots: plan.shots.length, picturesMissing: missing,
    words: lines.reduce((n, l) => n + l.words.length, 0), lyricsFrom: chosen.from, ...(pasted.length ? { lyricsMatched: `${chosen.matched}/${chosen.total}` } : {}),
    listen: heard.via, language: heard.language,
    direction: { from: direction.from, style: direction.style, palette: direction.palette },
    stills: stills.map((s) => s.src),
  };
  return { outName, outPath, title, lines, plan, ass, meta };
}

/** Make a lyric video and put it in the Archive. Returns the new piece's id. The piece is born carrying its section
 *  and the job that made it (what "my piece" is looked up by — image-generation.server.ts → tagAssetSection writes
 *  the same two fields onto a piece made elsewhere; here they are simply there from the start). */
export async function generateLyricVideo(o: LyricVideoOptions): Promise<string> {
  const made = await makeLyricVideo(o);
  // THE RECORD OF WHOSE SONG IT IS, on the piece itself (a job row is not kept for ever): when the member
  // confirmed they own it or have its owner's permission, and the YouTube address it was fetched from
  const rights = songRightsOf(o.songRights);
  const asset = await db.asset.create({
    data: {
      shopId: o.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `Lyric Video — ${(made.title || "your song").slice(0, 60)}`,
      bodyJson: JSON.stringify({ style: "LYRICVIDEO", videoUrl: `/renders/${made.outName}`, prompt: made.title || "" }),
      metaJson: JSON.stringify({ ...made.meta, ...(o.jobId ? { jobId: o.jobId } : {}), ...(rights ? { songRights: rights } : {}) }),
    },
  });
  return asset.id;
}
