/* A STORY'S PICTURES MOVE.
 *
 * A narrated story was a storyteller's voice over one still picture a scene — with a 10% push-in spread
 * over ten seconds, which nobody sees. A tester, 2026-11-23, on Moral Story, Horror Story and Short Story
 * alike: "they only stop screen on one image and play voice … change picture like screen not moving
 * anything … previously they work good but now … they just play voice and pics, not scene like video."
 *
 * So each scene's picture is brought to life: an image-to-video model plays THAT EXACT PICTURE as one
 * continuous shot for as long as the scene is told — the people in it breathe and react, cloth and leaves
 * and weather move, the camera drifts — and the storyteller speaks over it. Nobody talks on screen: this is
 * a told story, and a mouth moving under somebody else's voice reads as a dubbing fault.
 *
 * Tried the same day on real story pictures (a cartoon hedgehog and tortoise, a painted lighthouse keeper):
 * designs and faces held for the whole ten seconds; the keeper lifts his lantern and looks up the stair,
 * lightning walks the sky behind the lamp room.
 *
 * THE ENGINE — Seedance 1 Pro Fast on fal: any whole length from 2 to 12 seconds, so a scene is ONE clip and
 * nothing is looped or played backwards. fal's own price page, read 2026-11-23: $1 per million video
 * tokens, tokens = height × width × 24 fps × seconds / 1024 — 720×1280 is $0.0216 a second, so a 66-second
 * story costs about $1.43 in motion. (480p is $0.0096 a second and visibly soft against the drawn picture
 * at the story's own size. Kling 2.5 Turbo PRO — the endpoint this app calls, fal-ai/kling-video/v2.5-turbo/
 * pro — is $0.07 a second ($0.35 for five seconds, $0.07 each second after: its fal page, read 2026-11-24);
 * the $0.042 once written here is the STANDARD tier's price, which nothing here calls.)
 *
 * Everything here is plain logic (tests/story-motion.test.ts); the calls are in story-motion.server.ts.
 * A scene whose clip cannot be made keeps its still picture and its slow push-in — motion never costs a
 * story. STORY_MOTION=off in the environment turns the whole thing off. */

import { isStoryShot, shotMotion } from "./story-shots.ts";

export const STORY_MOTION_MODEL = "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video";
/** What the piece records as its motion engine. */
export const STORY_MOTION_ENGINE = "seedance-1-pro-fast";
/** The engine's own limits, in whole seconds. */
export const MOTION_MIN_S = 2;
export const MOTION_MAX_S = 12;
/** What a second of it costs at the story's size (see the header) — 1080p since 2026-11-25 (the owner: "yes
 *  obviously upgrade the best image possible"): 1920 × 1080 × 24 / 1024 tokens a second at $1 a million. */
export const MOTION_USD_PER_SECOND = 0.0486;
/** No more scenes than this are brought to life in one story — the most a story can have (web.film's
 *  narratedScenes.max), so a story never moves for ten scenes and stands still for its last two. */
export const MOTION_MAX_SCENES = 12;
/** How long a story takes to make, in seconds, by its scenes: the voice, the listening, the pictures and
 *  the cut — and, when its pictures move, a clip a scene (three at a time) and the time to bring each to
 *  the story's size. MEASURED on the live site, 2026-11-23: a six-scene story whose pictures were kept
 *  took 176 seconds with all six scenes moving, against about 72 over stills — the motion added about a
 *  hundred seconds (the first guess here, 75 seconds a wave of three, made the page say "5–8 min" for a
 *  story that landed in three). */
export const storyTypicalSeconds = (scenes: number, moves: boolean): number =>
  60 + Math.max(1, scenes) * 12 + (moves ? 20 + Math.ceil(Math.max(1, scenes) / 3) * 30 + Math.max(1, scenes) * 4 : 0);
/** A clip shorter than its scene is played this much slower at most — past that its last frame holds. */
export const MOTION_STRETCH_MAX = 1.25;
/** A clip made for one telling serves another (the same pictures told again in another language, or with
 *  a line changed) when it covers at least this share of the scene as it is told now. */
export const MOTION_REUSE_SHARE = 0.6;

/** THE LADDER (the owner, 2026-11-24): "a hierarchy for the video system (narrated with stills / simple,
 *  narrated with stills to video mid, and acted premium)". A told story is its first two rungs, and which
 *  one is its MAKER'S choice, story by story: "still" — told over its still pictures, each with its slow
 *  push-in (the simple rung: nothing is spent on motion); or "moving" — every picture brought to life
 *  (what a story is unless it says otherwise). The third rung is another way of telling: an acted film. */
export type StoryPictures = "still" | "moving";
export const storyPicturesOf = (v: unknown): StoryPictures => (String(v ?? "").trim().toLowerCase() === "still" ? "still" : "moving");
/** WAS THIS FINISHED STORY TOLD OVER STILL PICTURES? Its record says so under `rung` (since the review of S13,
 *  2026-11-26); a story made before then said `pictures: "still"` — written over its own picture list, which is why it
 *  moved to a key of its own. Read by Another language, Edit story and Next episode, so each keeps the maker's rung. */
export const storyIsStill = (meta: Record<string, unknown> | null | undefined): boolean =>
  !!meta && (meta.rung === "still" || meta.pictures === "still");
/** The three rungs, by what a piece is. */
export type VideoRung = "simple" | "moving" | "acted";
export const videoRung = (o: { narrated: boolean; pictures?: unknown }): VideoRung =>
  !o.narrated ? "acted" : storyPicturesOf(o.pictures) === "still" ? "simple" : "moving";

/** Is the motion on — for this story? (`falOn` = the provider's key is set; `pictures` = its maker's
 *  choice, when it made one.) */
export const motionOn = (env: Record<string, string | undefined> | undefined, falOn: boolean, pictures?: unknown): boolean =>
  falOn && String(env?.STORY_MOTION || "").trim().toLowerCase() !== "off" && storyPicturesOf(pictures) === "moving";

/** The length asked for: the scene's own, in whole seconds, within what the engine makes. */
export function motionSeconds(sceneSeconds: number): number {
  const n = Math.ceil(Number(sceneSeconds) - 1e-6);
  return Number.isFinite(n) ? Math.max(MOTION_MIN_S, Math.min(MOTION_MAX_S, n)) : 5;
}

/** May a clip `have` seconds long stand for a scene told in `need` seconds? */
export const motionReusable = (have: number, need: number): boolean =>
  have > 1 && need > 0 && have >= Math.min(need, MOTION_MAX_S) * MOTION_REUSE_SHARE;

/** What the engine is told. THE PICTURE IS HELD: it comes first, and the scene's own words come last, as
 *  what the picture SHOWS — not as something to act out. (They used to lead the prompt. A scene written
 *  "Howl's eyes reflect in a dark puddle… a second pair of eyes behind him" was a correct still of a
 *  werewolf standing over a puddle; the engine read the words and made him leap, drop to all fours and
 *  grow extra figures behind him, and in another scene blew a small campfire up to fill the frame — live,
 *  2026-11-24, the owner: "characters breaking".) `shot` is how the scene is seen (story-shots.ts): somebody
 *  caught mid-stride walks toward us; a face barely moves; with no plan, the small motion of every scene.
 *  …AND THE SCENE'S WORDS ARE NOT SENT AT ALL. Moved to the end of the prompt as "what the picture shows",
 *  they were still acted out in the first whole story made that way: "inside the stone ring" grew a glowing
 *  ring around the woman standing in it, and "small figures pacing… chanting" grew extra figures. The
 *  picture is the scene; the engine is told only how to let it breathe. (`visual` stays in the signature:
 *  every caller has it, and a later engine may want it.) */
export function motionPrompt(_visual: string, shot?: string | null): string {
  const what = "";
  const seen = isStoryShot(shot) ? shot : null;
  const move = shotMotion(seen) || "Everybody holds their place; only small movement. The camera drifts slowly forward, steady and smooth.";
  // (NOTHING IS NAMED THAT MAY NOT BE IN THE PICTURE — no "fire", no "creature", no "rain", not even after a
  //  "no": the engine draws what it is told about. The first story checked after the rules named them had
  //  flames in an office corridor.)
  const hold = seen === "walk"
    ? "Apart from that walk, HOLD THE PICTURE: everybody keeps the body, the build and the clothes they have in the picture for the whole shot."
    : "HOLD THE PICTURE: everybody keeps the body, the pose, the size and the place they have in the picture for the whole shot.";
  // (EVERY FACE STAYS THAT FACE: the ghost lady's face at a window — wax-pale, a smile far too wide — turned
  //  into an ordinary pleasant woman's as the clip went on, and read as the children's mother, 2026-11-24.
  //  Said without naming what a face is like: the engine draws what it is told about.)
  return `One continuous shot of this exact picture coming to life. ${move} ${hold} Everything stays exactly as it is in the picture — the same shapes, the same colours, the same light, the same place; nothing is added, nothing is taken away, nothing changes. What moves is small and natural: breathing, a slow blink, a slight turn of the head, a small shift of weight. Every face stays exactly the face it is — its features, its skin, its smile — never turning into another face or a more ordinary one. Nobody speaks; mouths stay closed. The same faces, the same designs, the same place; no cuts, no writing.${what ? ` (What the picture shows: ${what})` : ""}`;
}

/** How a clip `have` seconds long fills a scene told in `need` seconds: as it is when it is long enough
 *  (the cut trims it); else slowed a little (never past MOTION_STRETCH_MAX), and whatever is still
 *  missing after that is its last frame, held. */
export function fitMotion(have: number, need: number): { speed: number; hold: number } {
  if (!(have > 0) || !(need > 0) || have >= need) return { speed: 1, hold: 0 };
  const speed = Math.min(need / have, MOTION_STRETCH_MAX);
  return { speed, hold: Math.max(0, need - have * speed) };
}

/** The filter chain that turns one clip into exactly `frames` frames of the story (W×H, 30 a second) —
 *  the twin of kenBurns() for a scene that moves. A second of held last frame is always there to be
 *  trimmed, so rounding can never leave a scene a frame short of its window. */
export function motionChain(fit: { speed: number; hold: number }, frames: number, W: number, H: number): string {
  const slow = fit.speed > 1.0005 ? `setpts=${fit.speed.toFixed(4)}*PTS,` : "";
  return `${slow}fps=30,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${(fit.hold + 1).toFixed(2)},trim=end_frame=${Math.max(2, Math.round(frames))},setpts=PTS-STARTPTS`;
}

/** The picture as it goes into the cut — its black bars cropped off — is written beside the picture
 *  under THIS name. One dot, on purpose: the engine fetches it from the app's own /renders address, and
 *  that route serves only names of letters, digits, "-" and "_" with one ending. (The first story made
 *  with moving pictures on the live site, 2026-11-23, had every clip refused — "Failed to download the
 *  file" — because the cropped picture was called "<picture>.jpg.n.jpg", which that route answers with
 *  a 404. The story shipped over its stills, and its own record said why.) */
export const seedName = (pictureFile: string): string =>
  `${String(pictureFile).replace(/\.(?:jpe?g|png|webp)$/i, "")}-n.jpg`;
/** Can the app's own /renders address serve a file of this name? (The rule of routes/renders.$file.tsx
 *  for pictures.) */
export const servable = (name: string): boolean => /^[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/.test(name);

/* THE CLIP IS LOOKED AT (2026-11-25). Every picture is looked at before it is kept; the clip made FROM it was not —
 * and the motion engine changed what the picture had settled: the lake woman's too-wide smile softened into an
 * ordinary woman's face, a faceless shadow grew a hood, a ghost's face became the children's mother. So the clip's
 * LAST frame is looked at beside the picture it was made from. While the question is new, the answer is only
 * written down on the piece (MOTION_DRIFT=enforce, once it has been checked by eye, drops a drifted clip and leaves
 * the scene its still). */
export function driftPrompt(): string {
  return `The FIRST image is a still picture from a film. The SECOND image is the LAST frame of the same shot, after the picture was brought to life for a few seconds. Small, natural movement is expected and is NOT a change: a breath, a blink, a slightly turned head or a step, the camera drifting a little closer, light flickering. First write down, in a few words, what is different between the two. Then say whether anything CHANGED that should not have: a face that became a different face, or lost what made it frightening (a smile far too wide that is now an ordinary smile, sunken dark eyes that are now ordinary eyes); a person or a creature that appeared, vanished or became somebody else; a hood, a mask or clothes that appeared on a figure that had none; the place itself turning into another place. Reply with ONLY this JSON: {"different": "…", "drifted": true or false}.`;
}
/** …its answer: the change it names, or "" when nothing drifted; null when it cannot be read. */
export function parseDrift(raw: string): { drifted: boolean; what: string } | null {
  const s = String(raw || "");
  const a = s.indexOf("{"), b = s.indexOf("}", a);
  if (a < 0 || b < 0) return null;
  try {
    const j = JSON.parse(s.slice(a, b + 1)) as { different?: unknown; drifted?: unknown };
    if (typeof j.drifted !== "boolean") return null;
    return { drifted: j.drifted, what: String(j.different ?? "").replace(/\s+/g, " ").trim().slice(0, 140) };
  } catch { return null; }
}
/** Is a drifted clip DROPPED (its scene keeps its still), or only written down? */
export const driftEnforced = (env: Record<string, string | undefined> = {}): boolean => String(env.MOTION_DRIFT || "").trim().toLowerCase() === "enforce";

/** Where a picture's clip is kept: beside the picture, under the picture's own name — so the same
 *  picture told again (another language, a changed line) finds it, and a re-drawn picture does not. */
export const motionName = (pictureFile: string): string =>
  `${String(pictureFile).replace(/\\/g, "/").split("/").pop()!.replace(/\.(?:jpe?g|png|webp)$/i, "")}.mv.mp4`;

/** A kept clip is a cache and nothing else: this many days after it was made it is cleared. */
export const MOTION_KEEP_DAYS = 7;
export const isMotionClip = (name: string): boolean => /\.mv\.mp4$/.test(name);

/** What the motion of a story costs, from the seconds asked for. */
export const motionCost = (seconds: number[]): number =>
  Math.round(seconds.reduce((sum, s) => sum + (s > 0 ? s : 0), 0) * MOTION_USD_PER_SECOND * 100) / 100;
