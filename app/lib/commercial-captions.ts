/* THE WORDS ON A COMMERCIAL'S SCREEN — which line belongs to which stretch of the ad.
 *
 * A Commercial is a run of scenes of one length, each with the narrator's line for it, and then the
 * closing shot of the product with the tagline spoken over it. Until 2026-11-23 none of those words were
 * ever on screen, so with the sound off — how most people meet an ad — it said nothing. The films'
 * caption step (film-captions.server.ts → captionFilm) takes "what is said in shot i" and "how long shot
 * i runs"; this is that list for a commercial. Pure, so the alignment is tested.
 */

/** Seconds of each scene in the finished ad (the assembler cuts every clip to this). */
export const COMMERCIAL_BEAT_SEC = 5;
/** Seconds of the closing product shot. */
export const COMMERCIAL_PACK_SEC = 4;

const clean = (v: string | null | undefined) => (v || "").replace(/\s+/g, " ").trim();

/** One line per scene that was actually rendered — a scene with no line keeps its place as an empty
 *  one, so every later line still sits over its own scene — and the tagline over the closing shot. */
export function commercialCaptionPlan(
  narrations: ReadonlyArray<string | null | undefined>,
  tagline: string | null | undefined,
  sceneCount: number,
): { lines: string[]; clipDurs: number[] } {
  const n = Math.max(0, Math.floor(sceneCount) || 0);
  const lines: string[] = [];
  const clipDurs: number[] = [];
  for (let i = 0; i < n; i++) { lines.push(clean(narrations[i])); clipDurs.push(COMMERCIAL_BEAT_SEC); }
  lines.push(clean(tagline));
  clipDurs.push(COMMERCIAL_PACK_SEC);
  return { lines, clipDurs };
}
