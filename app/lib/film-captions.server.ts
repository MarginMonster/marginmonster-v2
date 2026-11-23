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
import { LISTEN_AUDIO, heardTooLittle, lyricWordTimes } from "./lyric-sync";
import { captionGraph } from "./caption-burn.server";
import { boldCards, captionFilters, scriptWordTimes, subtitleCards, subtitleChars, trimToSound, type CaptionStyle, type Card, type Window, type WordT } from "./narrated-core";

const RENDERS = () => path.join(process.cwd(), "data", "renders");

/** Burn captions into the film at `filmPath` (replacing it). `lines[i]` is what is SAID in shot i, with no
 *  speaker labels; `clipDurs[i]` how long shot i runs. Returns the style that was drawn, or "off" when the
 *  film was left as it was. `listenMs` caps the wait for the word timings (a quick edit in the shot editor
 *  can't hold its request open for minutes); past it the lines are timed by shot length instead. */
export async function captionFilm(o: {
  filmPath: string; lines: string[]; clipDurs: number[]; style: CaptionStyle; /** the language it is spoken in (en, es, fr, de, zh) */ lang: string; jobId?: string; listenMs?: number;
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

    // 1) what is heard, and when — listened for in the language the film is spoken in (it is always
    //    named: told a Spanish voice is English, the listener translates it). Nothing heard, or no way
    //    to listen: the shots' own lengths time the lines.
    let words: WordT[] = [];
    if (base) {
      try {
        const ex = await runFfmpeg(["-y", "-i", o.filmPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audio]);
        if (ex.status === 0 && fs.existsSync(audio)) {
          try { await mirrorRender(path.basename(audio), fs.readFileSync(audio)); } catch { /* the disk copy is served */ }
          words = wordsFromWhisperx(await repPoll(await createWhisperx(`${base}/renders/${path.basename(audio)}`, o.lang || "en"), Math.max(10_000, Math.min(5 * 60_000, o.listenMs ?? 5 * 60_000)), "film-captions"));
        }
      } catch (e) { console.error(`[captions] could not listen to the film — timing the lines by shot length: ${e instanceof Error ? e.message.slice(0, 140) : e}`); }
      await beat();
    }

    // 2) each shot's line over its OWN stretch of the film: the clips' lengths say where the shots are
    //    (scaled to the finished film, whose dissolves shave a little off each cut). Inside a shot the
    //    heard words time the line — when most of it was heard. A voice the aligner could barely follow
    //    (the first real film had a snarling werewolf: 4 of his 15 words) starts at its first heard word
    //    and stays to the end of the shot, instead of vanishing while he is still talking.
    const sum = o.clipDurs.reduce((a2, d) => a2 + (d > 0 ? d : 0), 0) || total;
    let t = 0;
    const windows: Window[] = lines.map((_, i) => { const d = ((o.clipDurs[i] > 0 ? o.clipDurs[i] : sum / lines.length) / sum) * total; const w = { t0: t, t1: i === lines.length - 1 ? total : Math.min(total, t + d) }; t += d; return w; });
    // …and where a shot ends in quiet, its line's words stop when the sound does
    let said = windows;
    try { said = trimToSound(windows, (await runFfmpeg(["-i", o.filmPath, "-vn", "-af", "silencedetect=noise=-30dB:d=0.6", "-f", "null", "-"])).stderr); } catch { /* the whole shot */ }
    const timed = scriptWordTimes(lines, words, said, { minHeard: 0.6, lead: 0.25, tail: 0.3 });
    const cards: Card[] = o.style === "bold" || o.style === "highlight" ? boldCards(timed, o.lang) : subtitleCards(lines, windows, subtitleChars(W, H), timed);
    // 3) burn them in; the sound is not touched
    const drawn = await burnCards(o.filmPath, tmp, cards, o.style, lines.join(" "), W, H, total);
    await beat();
    if (!drawn) return "off";
    console.log(`[captions] ${o.style}: ${cards.length} cards on a ${Math.round(total)}s film (${words.length ? "timed to the voices" : "timed by shot length"})`);
    return o.style;
  } catch (e) {
    console.error(`[captions] failed — the film ships without captions: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    return "off";
  } finally {
    for (const f of [audio, tmp]) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* best effort */ } }
  }
}

/** Draw caption cards onto the film (via `tmp`, then over it). The font follows the text (a script
 *  Poppins can't draw gets a font that can). False — and the film untouched — when it can't be drawn. */
async function burnCards(filmPath: string, tmp: string, cards: Card[], style: CaptionStyle, sample: string, W: number, H: number, total: number): Promise<boolean> {
  let font = path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
  // (the resolver only fails for words Poppins cannot draw — Chinese with no font fetched: no captions
  //  then, the film as it is. Drawing them with Poppins made every caption a row of boxes.)
  try { font = await resolveTextFont(sample); }
  catch (e) { console.error(`[captions] no font for these words — the film ships without captions: ${e instanceof Error ? e.message.slice(0, 140) : e}`); return false; }
  // the look that was asked for (Highlight is a file for the subtitle renderer), then the same cards as
  // plain drawn text: a renderer that fails must not cost the film its words (caption-burn.server.ts)
  const cap = captionGraph(cards, style, font, W, H);
  const filters = cap.plain;
  if (!filters.length) { cap.cleanup(); return false; }
  const burn = (vf: string[]) => runFfmpeg(["-y", "-i", filmPath, "-vf", vf.join(","), "-threads", "2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", tmp]);
  const drawn = (r: { status: number | null }) => r.status === 0 && fs.existsSync(tmp) && Math.abs(ffprobeDuration(tmp) - total) <= 0.5;
  try {
    let run = cap.styled ? await burn(cap.styled) : null;
    if (run && !drawn(run)) console.error(`[captions] the highlight captions could not be drawn — drawn as Bold instead: ${(run.stderr || "").slice(-200)}`);
    if (!run || !drawn(run)) run = await burn(filters);
    if (!drawn(run)) {
      console.error(`[captions] the captions could not be drawn — the film ships without them: ${(run.stderr || "").slice(-200)}`);
      return false;
    }
  } finally { cap.cleanup(); }
  fs.renameSync(tmp, filmPath);
  return true;
}

/** The words of a song WE made, with the time each is sung — for a film that has to follow its song
 *  (sung-fit.ts). Heard softly first, as singing is; on the stock settings too when that catches little
 *  of the lyrics, and the better listen is kept. Throws when the song cannot be heard at all: the
 *  caller keeps the film as it was. */
export async function hearSong(o: { songPath: string; lyricLines: string[]; jobId?: string }): Promise<WordT[]> {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if (!base || !fs.existsSync(o.songPath)) throw new Error("no song to hear");
  const audio = path.join(RENDERS(), `lyr-${Date.now()}-${crypto.randomBytes(5).toString("hex")}.mp3`);
  try {
    const ex = await runFfmpeg(["-y", "-i", o.songPath, "-vn", ...LISTEN_AUDIO, audio]);
    if (ex.status !== 0 || !fs.existsSync(audio)) throw new Error("the song could not be read");
    try { await mirrorRender(path.basename(audio), fs.readFileSync(audio)); } catch { /* the disk copy is served */ }
    const url = `${base}/renders/${path.basename(audio)}`;
    const listen = async (sung: boolean): Promise<WordT[]> => {
      const words = wordsFromWhisperx(await repPoll(await createWhisperx(url, null, { sung }), 5 * 60_000, "song"));
      if (o.jobId) await checkpointJob(o.jobId, { ckBeat: Date.now() });
      return words;
    };
    let heard = await listen(true);
    if (heardTooLittle(lyricWordTimes(o.lyricLines, heard))) {
      const again = await listen(false);
      if (lyricWordTimes(o.lyricLines, again).matched > lyricWordTimes(o.lyricLines, heard).matched) heard = again;
    }
    return heard;
  } finally {
    try { if (fs.existsSync(audio)) fs.unlinkSync(audio); } catch { /* best effort */ }
  }
}

/** LYRICS ON SCREEN for a music video: the song is heard (whisperx, language detected), the heard words
 *  are matched to the lyric lines (lyric-sync.ts), and each line shows in its own words, in time with the
 *  singing. A song whose words barely match the lyrics (a merchant's own track) is captioned from what is
 *  heard instead. Never costs the video: anything that goes wrong leaves it as it was ("off").
 *
 *  HOW IT LISTENS (lyric-sync.ts has the measurements): the sound goes over at full rate — a first video
 *  came out with no words for its first sixteen seconds because a 16 kHz copy lost the singing. A song
 *  we wrote is heard on its VOCAL ALONE (the song is separated first): the whole mix hid the last line
 *  of another video under a busy outro. The mix is the way back, heard softly and then on the stock
 *  settings, and the best listen is kept. */
export async function captionLyrics(o: { filmPath: string; lyricLines: string[]; style: CaptionStyle; jobId?: string }): Promise<CaptionStyle> {
  if (o.style === "off" || !fs.existsSync(o.filmPath)) return "off";
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if (!base) return "off";
  const id = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
  const audio = path.join(RENDERS(), `lyr-${id}.mp3`);
  const tmp = path.join(RENDERS(), `lyr-${id}.mp4`);
  try {
    const total = ffprobeDuration(o.filmPath);
    if (!(total > 1)) return "off";
    const probe = await runFfmpeg(["-i", o.filmPath, "-frames:v", "1", "-f", "null", "-"]);
    const size = /Video:[^\n]*?\b(\d{3,5})x(\d{3,5})\b/.exec(probe.stderr);
    if (!size) return "off";
    const W = Number(size[1]), H = Number(size[2]);
    const ex = await runFfmpeg(["-y", "-i", o.filmPath, "-vn", ...LISTEN_AUDIO, audio]);
    if (ex.status !== 0 || !fs.existsSync(audio)) return "off";
    try { await mirrorRender(path.basename(audio), fs.readFileSync(audio)); } catch { /* the disk copy is served */ }
    const ours = o.lyricLines.some((l) => (l || "").trim());
    const mixUrl = `${base}/renders/${path.basename(audio)}`;
    const listen = async (src: string, sung: boolean): Promise<WordT[]> => {
      const words = wordsFromWhisperx(await repPoll(await createWhisperx(src, null, { sung }), 5 * 60_000, "lyrics"));
      if (o.jobId) await checkpointJob(o.jobId, { ckBeat: Date.now() });
      return words;
    };
    let heard: WordT[] = [];
    let r = lyricWordTimes(o.lyricLines, heard);
    if (ours) {
      // OUR OWN SONG — THE VOCAL ALONE FIRST. Even at full rate the whole mix can hide a line: on a real
      // video the last line (nine seconds of singing over a busy outro) was not heard at all on the mix,
      // and every word of it was on the separated vocal (55 of 55 against 42). Words the transcriber
      // invents in the vocal's silences match no lyric and are dropped.
      try {
        const { separateSong } = await import("./singing-voice.server");
        const stems = await separateSong(mixUrl);
        if (o.jobId) await checkpointJob(o.jobId, { ckBeat: Date.now() });
        heard = await listen(stems.vocals, true);
        r = lyricWordTimes(o.lyricLines, heard);
        console.log(`[lyrics] on the vocal alone: ${r.matched}/${r.total} lyric words heard`);
      } catch (e) { console.error(`[lyrics] the vocal could not be separated — listening to the whole mix: ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
    }
    if (!ours || heardTooLittle(r) || heard.length < 3) {
      // THE WHOLE MIX: somebody's own track is captioned from what is HEARD, so it gets the stock,
      // stricter listen (on a vocal alone the transcriber writes a "thank you" into the quiet); for our
      // own song it is the way back — softer detection first, the stock settings if that catches little.
      try {
        const mix = await listen(mixUrl, ours);
        const r1 = lyricWordTimes(o.lyricLines, mix);
        if (!ours || heard.length < 3 || r1.matched > r.matched) { heard = mix; r = r1; }
        if (ours && heardTooLittle(r)) {
          const again = await listen(mixUrl, false);
          const r2 = lyricWordTimes(o.lyricLines, again);
          console.log(`[lyrics] the mix caught ${r.matched}/${r.total} lyric words — a second listen caught ${r2.matched}`);
          if (r2.matched > r.matched) { heard = again; r = r2; }
        }
      } catch (e) {
        if (heard.length < 3) throw e;
        console.error(`[lyrics] listening to the mix failed — keeping what the vocal gave: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
      }
    }
    if (heard.length < 3) { console.log("[lyrics] too little was heard in the song — no lyrics on screen"); return "off"; }
    if (r.total === 0 || r.matched / r.total < 0.3) {
      // not the song these lyrics were written for: caption what is sung
      const { srtCues } = await import("./ad-pack");
      r = lyricWordTimes(srtCues(heard, { maxChars: 42, maxDur: 5, pause: 0.8 }).map((c) => c.text), heard);
    }
    if (!r.lines.length) return "off";
    const cards: Card[] = o.style === "bold" ? boldCards(r.timed) : subtitleCards(r.lines, r.windows, subtitleChars(W, H), r.timed);
    if (!(await burnCards(o.filmPath, tmp, cards, o.style, r.lines.join(" "), W, H, total))) return "off";
    console.log(`[lyrics] ${o.style}: ${cards.length} cards, ${r.matched}/${r.total} lyric words heard, ${r.lines.length} lines on a ${Math.round(total)}s video`);
    return o.style;
  } catch (e) {
    console.error(`[lyrics] failed — the video ships without lyrics on screen: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    return "off";
  } finally {
    for (const f of [audio, tmp]) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* best effort */ } }
  }
}
