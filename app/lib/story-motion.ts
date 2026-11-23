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
 * at the story's own size; Kling 2.5 Turbo is $0.042 a second.)
 *
 * Everything here is plain logic (tests/story-motion.test.ts); the calls are in story-motion.server.ts.
 * A scene whose clip cannot be made keeps its still picture and its slow push-in — motion never costs a
 * story. STORY_MOTION=off in the environment turns the whole thing off. */

export const STORY_MOTION_MODEL = "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video";
/** What the piece records as its motion engine. */
export const STORY_MOTION_ENGINE = "seedance-1-pro-fast";
/** The engine's own limits, in whole seconds. */
export const MOTION_MIN_S = 2;
export const MOTION_MAX_S = 12;
/** What a second of it costs at the story's size (see the header). */
export const MOTION_USD_PER_SECOND = 0.0216;
/** No more scenes than this are brought to life in one story — the most a story can have (web.film's
 *  narratedScenes.max), so a story never moves for ten scenes and stands still for its last two. */
export const MOTION_MAX_SCENES = 12;
/** How long a story takes to make, in seconds, by its scenes: the voice, the listening, the pictures and
 *  the cut — and, when its pictures move, a clip a scene (about a minute each, three at a time) and the
 *  time to bring each to the story's size. A first estimate; the live site is the measure. */
export const storyTypicalSeconds = (scenes: number, moves: boolean): number =>
  60 + Math.max(1, scenes) * 12 + (moves ? 40 + Math.ceil(Math.max(1, scenes) / 3) * 75 + Math.max(1, scenes) * 8 : 0);
/** A clip shorter than its scene is played this much slower at most — past that its last frame holds. */
export const MOTION_STRETCH_MAX = 1.25;
/** A clip made for one telling serves another (the same pictures told again in another language, or with
 *  a line changed) when it covers at least this share of the scene as it is told now. */
export const MOTION_REUSE_SHARE = 0.6;

/** Is the motion on? (`falOn` = the provider's key is set.) */
export const motionOn = (env: Record<string, string | undefined> | undefined, falOn: boolean): boolean =>
  falOn && String(env?.STORY_MOTION || "").trim().toLowerCase() !== "off";

/** The length asked for: the scene's own, in whole seconds, within what the engine makes. */
export function motionSeconds(sceneSeconds: number): number {
  const n = Math.ceil(Number(sceneSeconds) - 1e-6);
  return Number.isFinite(n) ? Math.max(MOTION_MIN_S, Math.min(MOTION_MAX_S, n)) : 5;
}

/** May a clip `have` seconds long stand for a scene told in `need` seconds? */
export const motionReusable = (have: number, need: number): boolean =>
  have > 1 && need > 0 && have >= Math.min(need, MOTION_MAX_S) * MOTION_REUSE_SHARE;

/** What the engine is told. `visual` is the scene as the story's writer described it — what is IN the
 *  picture and what is happening; the rest is the same for every scene. */
export function motionPrompt(visual: string): string {
  const what = String(visual || "").replace(/\s+/g, " ").trim().slice(0, 600);
  return `${what ? `${what} ` : ""}One continuous shot of this exact picture coming to life: the people and creatures in it breathe, blink and move a little, naturally, as they would in this moment; hair, cloth, leaves, water, light and weather move. Nobody speaks — mouths stay closed, or only smile, gasp or react. The camera drifts slowly forward, steady and smooth. Everyone and everything stays exactly as drawn — the same faces, the same designs, the same place; nothing new appears, nobody leaves, no cuts, no writing.`;
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
