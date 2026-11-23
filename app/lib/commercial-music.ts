/* THE MUSIC UNDER A COMMERCIAL.
 *
 * A Commercial was five scenes, a narrator and nothing else: the first one made as a customer after the
 * engine fix (2026-11-23, a blind-box toy) measured -27.5 LUFS — less than half as loud as a film or an
 * ad from this same app — with more than two seconds of DEAD SILENCE after every line (0.0–0.7, 3.2–5.4,
 * 8.5–10.6, 12.9–15.6 …). A television spot is never silent. It now plays over a bed of music, chosen by
 * the feel of the member's own direction, mixed the way a narrated story's is (the voice at -16 LUFS, the
 * bed well under it) and levelled like everything else we make.
 *
 * Pure: the picking and the filter are here so they can be tested; the pipeline only fetches and runs.
 */

/** How loud the bed sits under the voice — the narrated stories' own figure, proven by ear there. */
export const COMMERCIAL_BED_VOLUME = 0.18;
/** What the finished ad is levelled to (films: -16; a sung video: -14). */
export const COMMERCIAL_LUFS = -16;

const FEELS: Array<{ when: RegExp; music: string }> = [
  { when: /\b(funny|fun|playful|comed|quirky|silly|goofy|humou?r|joke|laugh)/i, music: "playful upbeat commercial underscore, bouncy ukulele, hand claps and light percussion, cheerful" },
  { when: /\b(luxur|premium|elegan|sophisticat|high[- ]end|refined|classy|minimal)/i, music: "elegant premium commercial underscore, sparse piano, airy pads, slow and confident" },
  { when: /\b(hype|energ|sport|fast|bold|intense|power|adrenalin|urgent|street)/i, music: "energetic modern commercial underscore, driving electronic beat, punchy bass, confident" },
  { when: /\b(emotional|heart|nostalg|warm|family|gift|cozy|cosy|tender|sentimental|touching|gentle)/i, music: "warm heartfelt commercial underscore, soft piano and strings, gentle and hopeful" },
  { when: /\b(spooky|scary|horror|dark|myster|eerie|halloween)/i, music: "mysterious cinematic underscore, low strings and soft pulses, intriguing, not frightening" },
  { when: /\b(kid|child|toy|cute|magic|dream|whimsic|bedtime)/i, music: "whimsical light commercial underscore, glockenspiel, pizzicato strings, soft and magical" },
];
/** A bed nobody would mind: the sound of most television spots. */
export const COMMERCIAL_MUSIC_DEFAULT = "uplifting cinematic commercial underscore, warm piano, soft strings and light modern percussion, hopeful";

/** The music prompt for a commercial, from what the member said they wanted (and, failing that, from
 *  what is being sold). The first feel named wins; with none, the default. Always instrumental — the
 *  narrator is the only voice — and loopable, because the bed is a short loop under a half-minute ad. */
export function commercialMusicPrompt(direction?: string | null, productTitle?: string | null): string {
  const said = (direction || "").trim();
  const hit = FEELS.find((f) => f.when.test(said)) || (!said ? FEELS.find((f) => f.when.test(productTitle || "")) : undefined);
  return `${hit ? hit.music : COMMERCIAL_MUSIC_DEFAULT}, instrumental, no vocals, loopable`;
}

/** The filter that lays the bed under the voice track: the voice brought to -16 LUFS and padded to the
 *  whole cut, the looped bed well under it with a short fade in and a long fade out, mixed without
 *  amix's own level change. Input 0 = the voice, input 1 = the bed (given with -stream_loop -1). */
export function commercialBedFilter(totalSec: number): string {
  const total = Math.max(1, totalSec);
  const fadeAt = Math.max(0, total - 1.6).toFixed(2);
  return (
    `[0:a]aresample=44100,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,apad=whole_dur=${total}[vo];` +
    `[1:a]aresample=44100,volume=${COMMERCIAL_BED_VOLUME},afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeAt}:d=1.6[bg];` +
    `[vo][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`
  );
}
