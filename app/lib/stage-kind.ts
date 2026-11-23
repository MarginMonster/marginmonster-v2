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

/* THE JOB ITSELF, WHEN IT IS KNOWN (2026-11-23, later the same day).
 *
 * Kind was not enough: a film made in the Movie Maker is a Creator video too, and so is a channel's own
 * drop — a member watching "Making your video…" could be handed either as the result, because it landed
 * first. Every piece now says which job made it (meta.jobId, written by the worker), and the Stage knows
 * which job it queued: so it waits for exactly that piece. The kind rule above stays for what cannot
 * say — a piece with no job on it, a page that does not know its job. */

/** What the Studio answers when a piece is queued ("video", "videoedit", "faceless", "image", "music") →
 *  does a job of this kind match it? */
export function queuedKindFits(queued: string, kind: string): boolean {
  if (queued === "video" || queued === "videoedit") return kind === "video";
  if (queued === "faceless") return kind === "faceless";
  if (queued === "music") return kind === "song";
  if (queued === "image") return kind === "image" || kind === "photo";
  return false;
}

/** The job this page has just queued: the newest job of that kind, made since `sinceMs`. `gens` is the
 *  loader's list, newest first — it comes back together with the action's answer, so the job just queued
 *  is on it. Null when it cannot be told (then the kind rule is used). */
export function queuedJob(queued: string, gens: ReadonlyArray<{ id: string; kind: string; at: string }>, sinceMs: number): string | null {
  const hit = gens.find((g) => queuedKindFits(queued, g.kind) && new Date(g.at).getTime() >= sinceMs);
  return hit ? hit.id : null;
}

/** Is this new piece the one the Stage is waiting for? With the job known: the piece that job made — or
 *  a piece of the right kind that carries no job at all (made before pieces said). A piece made by
 *  ANOTHER job is never the answer, whatever kind it is. Without the job: the kind rule. */
export function stagePieceFits(job: string | null | undefined, noun: string, piece: { jobId?: string | null; video: boolean; audio: boolean }): boolean {
  if (job && piece.jobId) return piece.jobId === job;
  return stageKindFits(noun, piece);
}

/** Is this job's failure the Stage's? With the job known: that job. Without: a job of the kind, started
 *  when this make was (`sinceMs`). */
export function stageFailureFits(job: string | null | undefined, noun: string, gen: { id: string; kind: string; at: string }, sinceMs: number): boolean {
  if (job) return gen.id === job;
  return stageJobFits(noun, gen.kind) && new Date(gen.at).getTime() >= sinceMs;
}
