/* ONE ENCODE AT A TIME, FOR EVERY JOB.
 *
 * Jobs overlap now (job-lanes.ts): a film can be in the making while a picture is. What must still never
 * overlap is the part that takes the memory — two ffmpeg processes — because that is what took the server
 * down on 2026-11-03. So every encode a JOB starts asks for its turn here, and runs when the one before
 * it has ended.
 *
 * ONLY A JOB TAKES A TURN. The same runners are used by web requests — the first thumbnail of a video,
 * "does this storyboard picture have black bars", a quick edit in the film editor, a brand logo — and by
 * the app's own art. Those ran at once before jobs took turns, and they still do: a member looking at
 * their Archive must not wait for somebody else's film to finish encoding before a thumbnail appears.
 * (They could already overlap a render before any of this; nothing here makes that more likely.) What
 * counts as a job is whatever runs inside `asJob` — the worker wraps each job in it.
 *
 * The wait has an end. Each runner kills its own ffmpeg at a hard ceiling (10 minutes for a video, 90
 * seconds for a still), so a turn is normally given up long before this; but a turn that somehow never
 * ended must not stop every other encode for good. A stopped worker is worse than a rare overlap — the
 * same reasoning as the worker's own time-bounded slot. Past the bound the next one starts anyway.
 *
 * A job that is waiting is ALIVE, and says so: the worker's reaper reads "not touched for 25 minutes" as
 * abandoned, and a picture's many small stills can each wait behind one of a film's encodes. While a
 * job waits or encodes, its `beat` is called once a minute.
 *
 * Turns are taken in the order they were asked for. Nothing here knows what ffmpeg is: `run` is whatever
 * the caller wants done alone. */
import { AsyncLocalStorage } from "node:async_hooks";

/** Above the longest hard ceiling any runner has (10 minutes), with room to spare. */
export const FFMPEG_TURN_WAIT_MS = 12 * 60_000;
/** How often a waiting or encoding job says it is alive. Far inside the reaper's 25 minutes. */
export const TURN_BEAT_MS = 60_000;

type Job = { beat?: () => unknown };
const job = new AsyncLocalStorage<Job>();

/** Everything `work` does — every await, however deep, in whichever module — is a job's work: its encodes
 *  take turns. `beat` is called once a minute while one of them waits or runs (it must never throw). */
export function asJob<T>(work: () => Promise<T>, beat?: () => unknown): Promise<T> {
  return job.run({ beat }, work);
}

/** True inside `asJob`. */
export function inJob(): boolean {
  return !!job.getStore();
}

let last: Promise<void> = Promise.resolve();
let waiting = 0;
let running = 0;

/** Run `run` when every turn asked for before it has ended (or `maxWaitMs` has gone by) — whoever asks.
 *  For work that is never urgent and is heavy: a presenter's 3D view is built this way. */
export function ffmpegTurnAlways<T>(run: () => Promise<T>, maxWaitMs: number = FFMPEG_TURN_WAIT_MS, beat?: () => unknown, beatMs: number = TURN_BEAT_MS): Promise<T> {
  const before = last;
  let bound: ReturnType<typeof setTimeout> | undefined;
  const alive = beat
    ? setInterval(() => { try { void Promise.resolve(beat()).catch(() => { /* a beat that fails is skipped */ }); } catch { /* same */ } }, beatMs)
    : undefined;
  if (alive && typeof alive.unref === "function") alive.unref();
  waiting++;
  const myTurn = Promise.race([
    before,
    new Promise<void>((resolve) => { bound = setTimeout(resolve, maxWaitMs); }),
  ]).then(() => { if (bound) clearTimeout(bound); });
  const mine = myTurn.then(() => {
    waiting--;
    running++;
    // `run` may throw before it returns a promise; that is a failed turn like any other
    return Promise.resolve().then(run).finally(() => { running--; if (alive) clearInterval(alive); });
  });
  // whatever became of this turn, the next one may go when it has ended
  last = mine.then(() => undefined, () => undefined);
  return mine;
}

/** A job's encode waits its turn; anything else runs at once, as it always did. */
export function ffmpegTurn<T>(run: () => Promise<T>, maxWaitMs: number = FFMPEG_TURN_WAIT_MS): Promise<T> {
  const mine = job.getStore();
  if (!mine) return Promise.resolve().then(run);
  return ffmpegTurnAlways(run, maxWaitMs, mine.beat);
}

/** For the status page: how many encodes are running (1 unless a turn overran its bound) and waiting. */
export function ffmpegTurns(): { running: number; waiting: number } {
  return { running, waiting };
}
