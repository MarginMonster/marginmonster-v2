/* WHICH NEW PIECE IS THE ONE THE STAGE IS WAITING FOR.
 *
 * The Creator Studio's Stage shows "Making your video…" and then the piece that lands. It used to take
 * the FIRST new piece of any kind for the result, and the NEWEST job of any kind for a failure — which was
 * right only while jobs finished in the order they were asked for. They no longer do (job-lanes.ts): a
 * picture asked for through Helpurr while a video cooks is made at the same time and lands first.
 *
 * `noun` is what the Stage says it is making: "video", "image", "photo" (an edit), "song", "article".
 * Pictures and photo edits are made in the same lane, one after another, so either answers for the other.
 * Anything unrecognised keeps the old behaviour: the first new piece.
 *
 * Pure. */

/** Is this finished piece the kind the Stage is making? */
export function stageKindFits(noun: string, piece: { video: boolean; audio: boolean }): boolean {
  if (noun === "video") return piece.video;
  if (noun === "song") return piece.audio;
  if (noun === "image" || noun === "photo") return !piece.video && !piece.audio;
  return true;
}

/** Is a job of this kind ("video", "faceless", "song", "image", "photo") the one the Stage is making? */
export function stageJobFits(noun: string, kind: string): boolean {
  if (noun === "video") return kind === "video" || kind === "faceless";
  if (noun === "song") return kind === "song";
  if (noun === "image" || noun === "photo") return kind === "image" || kind === "photo";
  return true;
}
