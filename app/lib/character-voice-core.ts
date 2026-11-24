/* How a character voice is PERFORMED — the parts that are plain logic (no network, no disk), so the
 * tests can hold them to the takes the owner approved.
 *
 * A character line is made in two moves (see character-voices.ts for who picked what, and why):
 *   1. THE TAKE    ElevenLabs v3 acts the line. Acting directions ride INSIDE the text as [tags]; the
 *                  approved takes all have the same shape — tags that open the line, one more dropped in
 *                  after the first sentence, one that closes it:
 *                    "[guttural] [feral snarl] You shouldn't have come out here. [low growl] Not… tonight. [roars]"
 *   2. THE CHAIN   a monster's take then goes through a creature chain in ffmpeg, the way a film does it.
 *                  "big(r)" lowers pitch AND formants together (a bigger throat, not a slowed-down voice)
 *                  and keeps the length, so a chained line still fits the mouth that speaks it.
 *
 * The filter graphs below are the ones the approved samples were made with, character for character. */

import type { CharacterVoice, CreatureChain } from "./character-voices";

/** The longest passage handed to the voice model in one go. A long narration is acted passage by
 *  passage — short enough that the performance holds, long enough that it flows. */
export const PASSAGE_MAX = 600;

/** A sentence ends at . ! ? … (and any closing quote) when what follows STARTS a sentence — a capital or
 *  a digit. "I've been waiting... such a long time." is one sentence: the dots are a pause, and a mid-line
 *  direction dropped into that pause is not where the approved takes have it. (。！？ end one outright, and
 *  so do Urdu's ۔ ؟ and Hindi's । ॥ — scripts with no capitals: a long story told in them was otherwise
 *  cut into passages in the middle of a sentence, with a breath where none is.) */
const sentencesOf = (text: string): string[] =>
  text.replace(/\s+/g, " ").trim()
    .split(/(?<=[.!?…]["'”’)\]]?)\s+(?=["'“‘(\[]?[\p{Lu}\p{N}])|(?<=[。！？])\s*|(?<=[۔؟।॥])\s+|(?<=[!?]["'”’)\]]?)\s+(?=[ऀ-ॿ؀-ۿ])/u)
    .map((s) => s.trim()).filter(Boolean);

/** Cut a text into passages at sentence ends, none longer than PASSAGE_MAX (a single sentence longer
 *  than that is cut at a word). Nothing is dropped and nothing is reordered. */
export function passagesOf(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (const sentence of sentencesOf(text)) {
    let s = sentence;
    while (s.length > PASSAGE_MAX) {
      push();
      const cut = s.lastIndexOf(" ", PASSAGE_MAX);
      const at = cut > PASSAGE_MAX * 0.5 ? cut : PASSAGE_MAX;
      out.push(s.slice(0, at).trim());
      s = s.slice(at).trim();
    }
    if (cur && cur.length + 1 + s.length > PASSAGE_MAX) push();
    cur = cur ? `${cur} ${s}` : s;
  }
  push();
  return out;
}

/** Square brackets are how the voice model is DIRECTED — a maker's own text must not be able to slip a
 *  direction in (or have "[sic]" performed). Round ones read the same aloud. */
const spoken = (text: string): string => text.replace(/\[/g, "(").replace(/\]/g, ")");

/** What the voice model is given for each passage of `text`, in order: the voice's opening tags, the
 *  passage, its one mid-line tag after the first sentence (when there is a second sentence to put it
 *  before), and — on the last passage only — the closing tag. */
export function actedPassages(voice: CharacterVoice, text: string): string[] {
  const a = voice.acting;
  const passages = passagesOf(spoken(text));
  return passages.map((p, i) => {
    const s = sentencesOf(p);
    const body = a.between && s.length > 1 ? `${s[0]} ${a.between} ${s.slice(1).join(" ")}` : p;
    const tail = i === passages.length - 1 && a.after ? ` ${a.after}` : "";
    return `${a.before} ${body}${tail}`.trim();
  });
}

/** What the voice model is asked, for one passage. */
export function elevenInput(voice: CharacterVoice, prompt: string, lang?: string | null): Record<string, unknown> {
  const a = voice.acting;
  return { prompt, voice: a.voice, stability: a.stability, style: a.style, speed: a.speed, similarity_boost: 0.75, language_code: /^[a-z]{2}$/.test(lang || "") ? lang : "en" };
}

/** "A bigger throat": pitch and formants down by `r` (or up, above 1), length unchanged. */
const big = (r: number) => `asetrate=44100*${r},aresample=44100,atempo=${(1 / r).toFixed(4)}`;

/** The ghost's swell arrives BEFORE the line, so the line itself starts this much later in the chained
 *  audio. Fine for a voice-over; on a film clip the line has to stay under the mouth — see chainGraph. */
export const GHOST_LEAD_S = 1;

/** The creature chains, each reading [0:a] and ending in [o] — exactly as the approved takes were made. */
export const CREATURE_CHAINS: Record<CreatureChain, string> = {
  // formants down, a sub layer, three fading echoes, the top rolled off — a voice at the bottom of a well
  hollow: `[0:a]aresample=44100,${big(0.88)},asubboost,aecho=0.8:0.75:90|180|270:0.4|0.25|0.15,lowpass=f=3200[o]`,
  // formants down and driven into soft clipping, an octave-down double underneath, a chorus — a throat full of teeth
  feral2: `[0:a]aresample=44100,asplit=2[a][b];[a]${big(0.84)},volume=5dB,asoftclip=type=atan:threshold=0.5[a1];[b]asetrate=44100*0.5,aresample=44100,atempo=2.0,lowpass=f=700,volume=0.7[b1];[a1][b1]amix=inputs=2:normalize=0,chorus=0.6:0.9:25:0.4:0.25:2[o]`,
  // the dry line, a reverse-reverb swell that arrives before each word, a whisper double a hair late and sharp, then a long echo
  ghost: `[0:a]aresample=44100,highpass=f=150,asplit=3[d][r][w];[r]areverse,apad=pad_dur=1.0,aecho=0.8:0.9:350|700:0.55|0.35,areverse,volume=0.7[rr];[d]adelay=${GHOST_LEAD_S * 1000}:all=1[dd];[w]adelay=${GHOST_LEAD_S * 1000 + 40}:all=1,${big(1.03)},volume=0.35[ww];[dd][rr][ww]amix=inputs=3:normalize=0,aecho=0.8:0.8:180|420:0.3|0.2[o]`,
};

/** The whole audio graph for a finished character line: the chain (if the voice has one), then one
 *  loudness for every voice so no character is quieter than another. Reads [0:a], ends in [n].
 *  `inSync` keeps the line where it was in time — for audio that belongs to a picture: the ghost's
 *  lead-in is trimmed back off, so her words stay under her mouth (the swell that leads each LATER word
 *  is inside the clip and stays). */
export function chainGraph(chain: CreatureChain | undefined, opts: { inSync?: boolean } = {}): string {
  const loud = "loudnorm=I=-16:TP=-1.5:LRA=11";
  if (!chain) return `[0:a]aresample=44100,${loud}[n]`;
  const resync = opts.inSync && chain === "ghost" ? `atrim=start=${GHOST_LEAD_S},asetpts=PTS-STARTPTS,` : "";
  return `${CREATURE_CHAINS[chain]};[o]${resync}${loud}[n]`;
}
