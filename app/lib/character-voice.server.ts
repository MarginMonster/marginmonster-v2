/* Speaking in a character voice — the server half of character-voices.ts / character-voice-core.ts.
 *
 * One function, used by every pipeline that needs a character to SAY something (a talking ad, a cartoon
 * ad, a narrated story): the line is acted by ElevenLabs v3 passage by passage, joined, and — for a
 * monster — put through its creature chain. The result is an mp3 on the renders disk, exactly like every
 * other voice track the pipelines make, so what follows (lip-sync, captions, the mix) does not change.
 *
 * And one for film clips, where the video model acts the voice itself: the SAME chain is laid over that
 * clip's own audio, in sync, so a werewolf sounds like a werewolf in a film too.
 *
 * A character voice is not substitutable. If it cannot be performed the caller's job fails — and a
 * failed job is retried and then refunded — rather than a stock announcer speaking for a ghost. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { downloadBuffer, ffprobeDuration, repCreate, repPoll, runFfmpeg } from "./ugc-ad-pipeline.server";
import { mirrorRender } from "./object-storage.server";
import { characterVoice, type CharacterVoice, type CreatureChain } from "./character-voices";
import { actedPassages, chainGraph, elevenInput } from "./character-voice-core";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
const ELEVEN = "elevenlabs/v3";
/** Passages acted at once: a narration is a handful of them, and two at a time keeps well inside the
 *  provider's rate limit while halving the wait. */
const AT_ONCE = 2;

async function actPassage(input: Record<string, unknown>, stage: string): Promise<Buffer> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = await repPoll(await repCreate(ELEVEN, input), 4 * 60_000, stage);
      const buf = await downloadBuffer(url);
      if (buf.length > 2_000) return buf;
      last = new Error("the voice came back empty");
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export type SpokenLine = {
  /** The mp3 on the renders disk, its file name, and its /renders URL (relative — prefix the app's
   *  origin for anything a provider has to fetch). */
  path: string; name: string; url: string;
  seconds: number;
};

/** Perform `text` in a character voice. Throws if `voiceId` is not a character voice, or the voice
 *  cannot be performed. `lang` is the two-letter language the text is written in (default English). */
export async function speakCharacter(voiceId: string, text: string, opts: { lang?: string | null; stage?: string } = {}): Promise<SpokenLine> {
  const voice = characterVoice(voiceId);
  if (!voice) throw new Error(`[character-voice] "${voiceId}" is not a character voice`);
  return speakAs(voice, voiceId, text, opts);
}

/** Read `text` in one of ElevenLabs' own stock voices ("Mark", "Hope"…), plainly: no acting directions, no
 *  creature chain — the same passages, joins and loudness as a character's. For a language the everyday
 *  speech model has no voice for: a story told in Urdu (story-voice.ts). Throws when it cannot be read. */
export async function speakStock(elevenVoice: string, text: string, opts: { lang?: string | null; stage?: string } = {}): Promise<SpokenLine> {
  const plain: CharacterVoice = {
    id: `stock:${elevenVoice}`, key: elevenVoice, label: elevenVoice, blurb: "", kind: "cartoon", gender: "m", style: "",
    acting: { voice: elevenVoice, before: "", stability: 0.5, style: 0, speed: 1 },
  };
  return speakAs(plain, plain.id, text, opts);
}

async function speakAs(voice: CharacterVoice, voiceId: string, text: string, opts: { lang?: string | null; stage?: string }): Promise<SpokenLine> {
  const prompts = actedPassages(voice, text);
  if (!prompts.length) throw new Error("[character-voice] nothing to say");
  const stage = opts.stage || "character-voice";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cvo-"));
  try {
    // 1) the takes, in order
    const takes: string[] = new Array(prompts.length);
    let next = 0;
    const worker = async () => {
      while (next < prompts.length) {
        const i = next++;
        const buf = await actPassage(elevenInput(voice, prompts[i], opts.lang), `${stage}-${i}`);
        takes[i] = path.join(tmp, `take-${i}.mp3`);
        fs.writeFileSync(takes[i], buf);
      }
    };
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, prompts.length) }, () => worker()));

    // 2) one continuous take (a short breath between passages), then the chain and one loudness
    const joined = path.join(tmp, "joined.wav");
    if (takes.length === 1) {
      const r = await runFfmpeg(["-y", "-i", takes[0], "-ar", "44100", "-ac", "1", joined]);
      if (r.status !== 0) throw new Error(`[character-voice] couldn't read the take: ${r.stderr.slice(-200)}`);
    } else {
      const args = ["-y"];
      takes.forEach((t) => args.push("-i", t));
      const parts = takes.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono${i < takes.length - 1 ? ",apad=pad_dur=0.25" : ""}[p${i}]`);
      const graph = `${parts.join(";")};${takes.map((_, i) => `[p${i}]`).join("")}concat=n=${takes.length}:v=0:a=1[j]`;
      const r = await runFfmpeg([...args, "-filter_complex", graph, "-map", "[j]", joined]);
      if (r.status !== 0) throw new Error(`[character-voice] couldn't join the takes: ${r.stderr.slice(-200)}`);
    }
    const name = `cvo-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.mp3`;
    const out = path.join(RENDERS(), name);
    fs.mkdirSync(RENDERS(), { recursive: true });
    const r = await runFfmpeg(["-y", "-i", joined, "-filter_complex", chainGraph(voice.acting.chain), "-map", "[n]", "-ar", "44100", "-b:a", "160k", out]);
    if (r.status !== 0 || !fs.existsSync(out) || fs.statSync(out).size < 2_000) throw new Error(`[character-voice] the ${voice.acting.chain || "final"} pass failed: ${r.stderr.slice(-240)}`);
    try { await mirrorRender(name, fs.readFileSync(out)); } catch { /* the disk copy is what is served */ }
    let seconds = 0;
    try { seconds = ffprobeDuration(out); } catch { /* the caller measures what it needs */ }
    console.log(`[character-voice] ${voice.label} (${voiceId}) — ${prompts.length} passage${prompts.length === 1 ? "" : "s"}, ${text.length} chars, ${seconds.toFixed(1)}s${voice.acting.chain ? `, ${voice.acting.chain} chain` : ""}`);
    return { path: out, name, url: `/renders/${name}`, seconds };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Lay a creature chain over a film clip's OWN audio, in sync with the picture (the video is copied,
 *  not re-encoded). Returns the new clip's path — or the original path when there is nothing to do or
 *  the pass fails: a film is never lost over a voice effect. */
export async function chainClipVoice(clipPath: string, chain: CreatureChain | undefined): Promise<string> {
  if (!chain || !fs.existsSync(clipPath)) return clipPath;
  const out = path.join(path.dirname(clipPath), `tmc-${Date.now()}-${crypto.randomBytes(5).toString("hex")}.mp4`);
  try {
    let dur = 0;
    try { dur = ffprobeDuration(clipPath); } catch { /* unknown — let ffmpeg end on the video */ }
    const args = ["-y", "-i", clipPath, "-filter_complex", `${chainGraph(chain, { inSync: true })};[n]apad[a]`, "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "44100"];
    if (dur > 0) args.push("-t", dur.toFixed(3)); else args.push("-shortest");
    args.push("-movflags", "+faststart", out);
    const r = await runFfmpeg(args);
    if (r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 10_000) return out;
    console.error(`[character-voice] ${chain} chain not applied to ${path.basename(clipPath)}: ${r.stderr.slice(-200)}`);
  } catch (e) {
    console.error(`[character-voice] ${chain} chain not applied to ${path.basename(clipPath)}: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
  }
  try { fs.rmSync(out, { force: true }); } catch { /* nothing written */ }
  return clipPath;
}
