/* WHICH JOBS MAY RUN AT THE SAME TIME — and whose turn it is.
 *
 * The worker ran ONE job at a time for the whole site, of any kind. So a five-token picture, a new
 * member's catalogue import, a blog post and a welcome email all stood in one line behind whichever film
 * was rendering — 25 minutes for a short film, up to 65 for a long one (seen 2026-11-23: a second member's
 * job waiting behind the first's, and everything of mine behind both).
 *
 * "One at a time" was there for a reason, and the reason is narrower than the rule: two VIDEO renders at
 * once took the server down (2026-11-03 — the encodes together went past its memory). That is about video
 * encodes. It says nothing about a picture drawn by a remote model, or a page of text.
 *
 * So: lanes, and one job at a time IN EACH.
 *   render  — films, music videos, commercials, ads, video edits: many clips from a video model, 10 to 65
 *             minutes. Exactly as before: never two at once.
 *   story   — a narrated story or a faceless video: a script, a voice, pictures, ONE encode — a minute or
 *             two. It used to wait behind whatever film was rendering (see STORY_MARK below).
 *   picture — pictures, songs, presenter and companion forges: a remote model and a single frame drawn here.
 *   desk    — words and network only: catalogue imports, the brand profile, blog posts, emails, launches.
 * What takes the memory is still never doubled: every encode waits its turn (ffmpeg-turn.ts). Measured
 * on the live server, 2026-11-23 (limit 2,048 MB): idle about 110 MB; a story's encode about 360 MB with
 * a picture being made beside it; the highest minute of another member's render 538 MB.
 *
 * A job type nobody listed here runs in the render lane. The careful lane is the default, so a new kind
 * of job cannot start overlapping a render because somebody forgot this file.
 *
 * Pure: no database, no clock of its own. The queue (job-queue.server.ts) asks it. */

export type Lane = "render" | "story" | "picture" | "desk";

export const LANES: readonly Lane[] = ["render", "story", "picture", "desk"];

/** HOW A STORY JOB IS KNOWN. A narrated story and a faceless video are GENERATE_VIDEO_AD jobs like a film;
 *  what tells them apart is inside the payload, where the database cannot reason — but it can look for a
 *  piece of text. So the decision is made ONCE, when the job is queued (job-queue → enqueueJob, with
 *  storyKindOf below), and written into the payload as `__lane: "story"`. This is that field exactly as
 *  JSON.stringify writes it; a quote inside a typed value is always escaped, so no member's words can
 *  spell it. A video job without the mark — every job queued before this existed — is a render. */
export const STORY_MARK = '"__lane":"story"';

/** Is this the payload of a story job — and which kind? THE SAME TWO TESTS THE WORKER USES to choose the
 *  pipeline (job-queue → runJob): a faceless video; a film told by a narrator, in a format that can be.
 *  `canNarrate` is film-engine's (handed in: this file knows no formats). */
export function storyKindOf(p: { contentType?: unknown; filmMode?: unknown; filmTemplate?: unknown }, canNarrate: (template: string | undefined) => boolean): "faceless" | "narrated" | null {
  if (p.contentType === "faceless") return "faceless";
  if (p.contentType === "film" && p.filmMode === "narrated" && canNarrate(typeof p.filmTemplate === "string" ? p.filmTemplate : undefined)) return "narrated";
  return null;
}

/** A remote model does the work; what happens here is a download and a single frame. */
export const PICTURE_TYPES: readonly string[] = ["GENERATE_IMAGE_AD", "GENERATE_SONG", "FORGE_COMPANION", "FORGE_CUSTOM_AVATAR"];

/** Words and network calls only — nothing is drawn or encoded here. */
export const DESK_TYPES: readonly string[] = [
  "GENERATE_BRAND_PROFILE",
  "IMPORT_CATALOG",
  "GENERATE_BLOG_POST",
  "SEND_ABANDONED_CART",
  "SEND_WELCOME",
  "SEND_POST_PURCHASE",
  "SEND_WINBACK",
  "LAUNCH_CAMPAIGN",
  "DECISIONING_PASS",
];

/** The lane a job runs in. `payload` is the job's payload as stored (text); without it a video job is a render. */
export function laneOf(type: string, payload?: string | null): Lane {
  if (PICTURE_TYPES.includes(type)) return "picture";
  if (DESK_TYPES.includes(type)) return "desk";
  if (type === "GENERATE_VIDEO_AD" && typeof payload === "string" && payload.includes(STORY_MARK)) return "story";
  return "render";
}

/** What selects a lane's jobs in the database — the same answer as laneOf, for every job. The render
 *  lane is "everything not named elsewhere": a type added to the database and to nothing else lands
 *  there, and so does a video job that carries no mark. The two video lanes are EXCLUSIVE: a story is
 *  never taken by the render lane (two stories would run at once), nor a film by the story lane. */
export type LaneWhere = {
  type: string | { in: string[] } | { notIn: string[] };
  payload?: { contains: string };
  NOT?: { type: string; payload: { contains: string } };
};
export function laneWhere(lane: Lane): LaneWhere {
  if (lane === "picture") return { type: { in: [...PICTURE_TYPES] } };
  if (lane === "desk") return { type: { in: [...DESK_TYPES] } };
  if (lane === "story") return { type: "GENERATE_VIDEO_AD", payload: { contains: STORY_MARK } };
  // NOT (a video job AND marked): the mark means something on that kind of job only. Written as a bare
  // "payload does not contain the mark", a job of any OTHER kind that carried the text would have been
  // selected by no lane at all, and waited for ever.
  return { type: { notIn: [...PICTURE_TYPES, ...DESK_TYPES] }, NOT: { type: "GENERATE_VIDEO_AD", payload: { contains: STORY_MARK } } };
}

export type Waiting = { id: string; shopId: string; createdAt: Date | number | string; attempts?: number; updatedAt?: Date | number | string };

const at = (v: Date | number | string): number => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : new Date(v).getTime());

/** A TRY THAT FAILED RESTS BEFORE THE NEXT. A failed job went straight back to waiting and was taken
 *  again on the very next look — so when the cause was a provider saying "too many requests", all three
 *  tries were spent inside the same busy minute and the piece failed for good (a refund, and nothing
 *  made). With jobs side by side, providers are asked for more at once, so this matters more. A job
 *  rests 30 seconds for each try it has had, counted from when it last changed. A job that was only put
 *  back by a restart keeps going at once — a restart hands its try back, so it has none against it. */
export const RETRY_REST_MS = 30_000;
export function resting(job: Waiting, now: number): boolean {
  const tries = job.attempts ?? 0;
  if (tries <= 0 || job.updatedAt == null) return false;
  return now < at(job.updatedAt) + RETRY_REST_MS * tries;
}

/** MEMBERS TAKE TURNS.
 *
 *  "Oldest job first" is fair to jobs and unfair to people: one member who queues five films holds
 *  everybody else for an hour, and a channel that makes its own drops can stand in front of a member who
 *  is sitting there waiting. So the order a lane tries its waiting jobs in is:
 *
 *   1. each member's OLDEST waiting job — the member served longest ago in this lane first, a member
 *      never served before anyone who has been; between equals, the older job;
 *   2. then everything else, oldest first (only reached if every claim above was lost to another process).
 *
 *  A member's own jobs still run in the order they were asked for — an import queued to correct an
 *  earlier one still lands second.
 *
 *  `lastServed` is when each member last had a job START in this lane (ms; absent = never). */
export function takeTurns<T extends Waiting>(waiting: T[], lastServed: ReadonlyMap<string, number>): T[] {
  const oldestFirst = [...waiting].sort((a, b) => at(a.createdAt) - at(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const heads: T[] = [];
  const rest: T[] = [];
  const seen = new Set<string>();
  for (const j of oldestFirst) {
    if (seen.has(j.shopId)) rest.push(j);
    else { seen.add(j.shopId); heads.push(j); }
  }
  heads.sort((a, b) => (lastServed.get(a.shopId) ?? 0) - (lastServed.get(b.shopId) ?? 0) || at(a.createdAt) - at(b.createdAt));
  return [...heads, ...rest];
}

/** How many waiting jobs a lane looks at each time it picks. Enough to see past one member's batch. */
export const LANE_LOOKAHEAD = 60;

/** THE ORDER THE LINE WILL REALLY BE SERVED IN — takeTurns, taken again after every job, as the lane does.
 *  (takeTurns alone answers "who is next"; a member's second waiting job comes round again only after
 *  everyone else has had a turn, and that is what a person waiting wants to know.) */
export function lineOrder<T extends Waiting>(waiting: T[], lastServed: ReadonlyMap<string, number>): T[] {
  const served = new Map(lastServed);
  // any time later than every real one, and later still for each job served in this walk-through
  let clock = Math.max(0, ...served.values()) + 1;
  let left = [...waiting];
  const order: T[] = [];
  while (left.length) {
    const next = takeTurns(left, served)[0];
    order.push(next);
    served.set(next.shopId, clock++);
    left = left.filter((j) => j.id !== next.id);
  }
  return order;
}

/** How many jobs start before this one: whatever the lane has in hand, and every waiting job that will be
 *  served first. Null when the job is not among the waiting ones looked at (far down a very long line). */
export function aheadInLine<T extends Waiting>(id: string, waiting: T[], lastServed: ReadonlyMap<string, number>, inHand: number): number | null {
  const at = lineOrder(waiting, lastServed).findIndex((j) => j.id === id);
  return at < 0 ? null : inHand + at;
}

/** The two things a lane needs from the queue. The real ones are database calls (job-queue.server.ts);
 *  handed in, so that taking a job can be tested without a database. */
export type QueueDoor<T extends Waiting> = {
  /** Jobs that could start now, of the lane this selects — oldest first, at most `take`. */
  waiting(lane: LaneWhere, take: number): Promise<T[]>;
  /** Try to take one. True ONLY for the caller that changed it from waiting to in hand: reading a job
   *  is not taking it (two ticks once read the same row and the same paid video was rendered twice). */
  claim(id: string): Promise<boolean>;
};

/** Take this lane's next job: the waiting jobs of ITS kinds, tried in turn-taking order, the first claim
 *  that is won. Null when nothing is waiting or every claim was lost to somebody else. Only a won claim
 *  counts as that member having been served. */
export async function claimNext<T extends Waiting>(lane: Lane, door: QueueDoor<T>, lastServed: Map<string, number>, now: number = Date.now()): Promise<T | null> {
  const waiting = (await door.waiting(laneWhere(lane), LANE_LOOKAHEAD)).filter((j) => !resting(j, now));
  for (const candidate of takeTurns(waiting, lastServed)) {
    if (await door.claim(candidate.id)) {
      lastServed.set(candidate.shopId, now);
      return candidate;
    }
  }
  return null;
}
