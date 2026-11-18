/* CAPTIONS ON A FINISHED FILM — the spoken lines, on screen, in time with each voice.
 *
 * The owner, 2026-11-17: "Subtitle options / like captions need added". A narrated story draws its
 * captions as it is cut (narrated-story.server.ts); an ACTED film is made of clips whose speech the video
 * model performed, so its captions are put on afterwards, here:
 *
 *   1. the film's own sound is listened to (word timings)
 *   2. each shot's line — exactly as it was written — is laid over the part of the film it is spoken in
 *   3. the cards are burnt in, in the chosen style (bold / subtitles — see narrated-core.ts)
 *
 * It never costs a film: anything that goes wrong here leaves the film as it was, without captions, and
 * says so in the log and in what it returns. */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { checkpointJob, ffprobeDuration, repPoll, resolveTextFont, runFfmpeg } from "./ugc-ad-pipeline.server";
import { createWhisperx, wordsFromWhisperx } from "./faceless-video.server";
import { mirrorRender } from "./object-storage.server";
import { boldCards, captionFilters, sceneWindows, scriptWordTimes, subtitleCards, subtitleChars, type CaptionStyle, type Card, type Window, type WordT } from "./narrated-core";

const RENDERS = () => path.join(process.cwd(), "data", "renders");

/** Burn captions into the film at `filmPath` (replacing it). `lines[i]` is what is SAID in shot i, with no
 *  speaker labels; `clipDurs[i]` how long shot i runs. Returns the style that was drawn, or "off" when the
 *  film was left as it was. */
export async function captionFilm(o: {
  filmPath: string; lines: string[]; clipDurs: number[]; style: CaptionStyle; english: boolean; jobId?: string;
}): Promise<CaptionStyle> {
  if (o.style === "off" || !fs.existsSync(o.filmPath)) return "off";
  const lines = o.lines.map((l) => (l || "").replace(/\s+/g, " ").trim());
  if (!lines.some(Boolean)) return "off";
  const beat = async () => { if (o.jobId) await checkpointJob(o.jobId, { ckBeat: Date.now() }); };
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const id = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
  const audio = path.join(RENDERS(), `cap-${id}.mp3`);
  const tmp = path.join(RENDERS(), `cap-${id}.mp4`);
  try {
    const total = ffprobeDuration(o.filmPath);
    if (!(total > 1)) return "off";
    // the frame, from the film itself
    const probe = await runFfmpeg(["-i", o.filmPath, "-frames:v", "1", "-f", "null", "-"]);
    const size = /Video:[^\n]*?\b(\d{3,5})x(\d{3,5})\b/.exec(probe.stderr);
    if (!size) return "off";
    const W = Number(size[1]), H = Number(size[2]);

    // 1) what is heard, and when (English: the aligner; otherwise the shots' own lengths time the lines)
    let words: WordT[] = [];
    if (o.english && base) {
      try {
        const ex = await runFfmpeg(["-y", "-i", o.filmPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audio]);
        if (ex.status === 0 && fs.existsSync(audio)) {
          try { await mirrorRender(path.basename(audio), fs.readFileSync(audio)); } catch { /* the disk copy is served */ }
          words = wordsFromWhisperx(await repPoll(await createWhisperx(`${base}/renders/${path.basename(audio)}`), 5 * 60_000, "film-captions"));
        }
      } catch (e) { console.error(`[captions] could not listen to the film — timing the lines by shot length: ${e instanceof Error ? e.message.slice(0, 140) : e}`); }
      await beat();
    }

    // 2) each shot's line over its own part of the film
    let windows: Window[];
    if (words.length) windows = sceneWindows(lines, words, total);
    else {
      const sum = o.clipDurs.reduce((a, b) => a + (b > 0 ? b : 0), 0) || total;
      let t = 0;
      windows = lines.map((_, i) => { const d = ((o.clipDurs[i] > 0 ? o.clipDurs[i] : sum / lines.length) / sum) * total; const w = { t0: t, t1: Math.min(total, t + d) }; t += d; return w; });
    }
    const timed = words.length ? scriptWordTimes(lines, words, windows) : scriptWordTimes(lines, [], windows);
    const cards: Card[] = o.style === "bold" ? boldCards(timed) : subtitleCards(lines, windows, subtitleChars(W, H), timed);
    let font = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
    try { font = await resolveTextFont(lines.join(" ")); } catch { /* keep Poppins */ }
    const filters = captionFilters(cards, o.style, font, W, H);
    if (!filters.length) return "off";

    // 3) burn them in; the sound is not touched
    const run = await runFfmpeg(["-y", "-i", o.filmPath, "-vf", filters.join(","), "-threads", "2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", tmp]);
    await beat();
    if (run.status !== 0 || !fs.existsSync(tmp) || Math.abs(ffprobeDuration(tmp) - total) > 0.5) {
      console.error(`[captions] the captions could not be drawn — the film ships without them: ${(run.stderr || "").slice(-200)}`);
      return "off";
    }
    fs.renameSync(tmp, o.filmPath);
    console.log(`[captions] ${o.style}: ${cards.length} cards on a ${Math.round(total)}s film (${words.length ? "timed to the voices" : "timed by shot length"})`);
    return o.style;
  } catch (e) {
    console.error(`[captions] failed — the film ships without captions: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    return "off";
  } finally {
    for (const f of [audio, tmp]) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* best effort */ } }
  }
}
