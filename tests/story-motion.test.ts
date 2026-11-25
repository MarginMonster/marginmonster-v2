/* A STORY'S PICTURES MOVE.
 *
 * A tester, 2026-11-23, on Moral Story, Horror Story and Short Story alike: "they only stop screen on one
 * image and play voice … change picture like screen not moving anything … previously they work good but
 * now … they just play voice and pics, not scene like video." A narrated story was a voice over still
 * pictures with a push-in too slow to see.
 *
 * Each scene's own picture is now played as one continuous moving shot for as long as the scene is told
 * (app/lib/story-motion.ts, story-motion.server.ts). Tried that day on real story pictures; the cut was run
 * for real with these very filter chains: 251 + 438 + 186 frames asked, 875 made.
 *
 *   1. THE ARITHMETIC is run here: the length asked for, how a clip fills a scene it is shorter than, when a
 *      kept clip serves another telling, what it costs.
 *   2. THE PROMISES that keep a story safe are pinned by reading the source: a scene whose clip fails keeps
 *      its still, a cut that fails with clips is made again without them, a clip is asked for once. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MOTION_KEEP_DAYS, MOTION_MAX_S, MOTION_MAX_SCENES, MOTION_MIN_S, MOTION_REUSE_SHARE, MOTION_STRETCH_MAX, MOTION_USD_PER_SECOND,
  STORY_MOTION_MODEL, fitMotion, isMotionClip, motionChain, motionCost, motionName, motionOn, motionPrompt, motionReusable, motionSeconds, seedName, servable, storyTypicalSeconds,
} from "../app/lib/story-motion.ts";
import { falVideoBody } from "../app/lib/fal-video-body.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("a scene is ONE clip as long as it is told — within what the engine makes", () => {
  assert.equal(MOTION_MIN_S, 2);
  assert.equal(MOTION_MAX_S, 12);
  assert.equal(motionSeconds(8.37), 9, "a whole second more than it needs, never less");
  assert.equal(motionSeconds(10), 10);
  assert.equal(motionSeconds(10.01), 11);
  assert.equal(motionSeconds(14.6), 12, "the longest it makes");
  assert.equal(motionSeconds(1.2), 2, "the shortest");
  assert.equal(motionSeconds(NaN), 5);
  // what is asked of the provider: the picture, the words, 720p, the seconds as it wants them — and nothing
  // it would refuse (it takes no negative prompt and no sound)
  const body = falVideoBody(STORY_MOTION_MODEL, { startImage: "https://x.test/renders/img-1.jpg", prompt: "p", durationSec: motionSeconds(9.4) });
  assert.deepEqual(body, { prompt: "p", image_url: "https://x.test/renders/img-1.jpg", resolution: "1080p", duration: "10" });
  assert.equal(STORY_MOTION_MODEL, "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video");
});

test("a clip shorter than its scene is slowed a little, then its last frame holds — a longer one is simply cut", () => {
  assert.deepEqual(fitMotion(10.04, 8.37), { speed: 1, hold: 0 });
  assert.deepEqual(fitMotion(10, 10), { speed: 1, hold: 0 });
  const slow = fitMotion(10, 12);
  assert.ok(Math.abs(slow.speed - 1.2) < 1e-9 && slow.hold === 0, "slowed to fit, nothing held");
  const long = fitMotion(10.04, 14.6);
  assert.equal(long.speed, MOTION_STRETCH_MAX, "never slower than this");
  assert.ok(Math.abs(long.hold - (14.6 - 10.04 * 1.25)) < 1e-9);
  assert.ok(long.hold > 2 && long.hold < 2.1);
  // nothing known about the clip: it is used as it is
  assert.deepEqual(fitMotion(0, 9), { speed: 1, hold: 0 });
  assert.deepEqual(fitMotion(NaN, 9), { speed: 1, hold: 0 });
  // the chain: slowed BEFORE it is put on the story's thirty frames a second, the story's own size, a
  // second of held frame always there to be trimmed, and exactly the frames of its window
  const chain = motionChain(long, 438, 720, 1280);
  assert.equal(chain, "setpts=1.2500*PTS,fps=30,scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=3.05,trim=end_frame=438,setpts=PTS-STARTPTS");
  assert.equal(motionChain({ speed: 1, hold: 0 }, 251, 1280, 720), "fps=30,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=1.00,trim=end_frame=251,setpts=PTS-STARTPTS");
  // the still beside it is the same kind of picture (two different pixel formats cannot be joined)
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("? `[${i}:v]${motionChain(m.fit, frames[i], o.W, o.H)}[c${i}]`"));
  assert.ok(nar.includes("? `[${i}:v]${kenBurns(i, frames[i], o.W, o.H)},format=yuv420p[c${i}]`"));
});

test("the same picture told again moves without being paid for twice — a re-drawn one does not", () => {
  assert.equal(motionName("/data/renders/img-1795454456667-16cc1ad934d7cdf1c9.jpg"), "img-1795454456667-16cc1ad934d7cdf1c9.mv.mp4");
  assert.equal(motionName("C:\\data\\renders\\nst-17-2-ab-n.jpg"), "nst-17-2-ab-n.mv.mp4", "a picture with its bars cropped off is its own picture");
  assert.equal(motionName("x.PNG"), "x.mv.mp4");
  assert.notEqual(motionName("img-1.jpg"), motionName("img-2.jpg"));
  assert.ok(isMotionClip("img-1.mv.mp4") && !isMotionClip("nar-1.mp4") && !isMotionClip("img-1.mv.mp4.raw.mp4"));
  // told again in Spanish the scene runs 11.2 s where it ran 10: the ten-second clip serves
  assert.equal(motionReusable(10.04, 11.2), true);
  assert.equal(motionReusable(10.04, 16), true, "a scene past the engine's twelve seconds is asked about as twelve");
  assert.equal(motionReusable(5, 12), false, "too short to stand for it");
  assert.equal(motionReusable(0, 5), false);
  assert.equal(motionReusable(0.8, 1.2), false, "a file that hardly plays is not a clip");
  assert.equal(MOTION_REUSE_SHARE, 0.6);
  // a kept clip is a cache: cleared after a week, and only ever by its own name
  assert.equal(MOTION_KEEP_DAYS, 7);
});

test("what it is told — the scene as written, nobody talking, nothing changed", () => {
  const p = motionPrompt("Pip and Tansy walk together along the path,\n Pip balancing apples atop Tansy's broad shell.");
  // THE PICTURE IS HELD: the engine's instructions lead, and the scene's own words come last, as what the
  // picture SHOWS — leading the prompt, they were acted out (a werewolf standing over a puddle leapt,
  // dropped to all fours and grew extra figures behind him: live, 2026-11-24)
  assert.ok(p.startsWith("One continuous shot of this exact picture coming to life. Everybody holds their place; only small movement."));
  // …and the scene's WORDS are not sent at all: even last, "inside the stone ring" grew a glowing ring
  assert.ok(!p.includes("Pip") && !p.includes("Tansy") && !p.includes("What the picture shows"), "the picture is the scene — the engine is told only how to let it breathe");
  assert.ok(p.endsWith("The same faces, the same designs, the same place; no cuts, no writing."));
  assert.ok(p.includes("HOLD THE PICTURE: everybody keeps the body, the pose, the size and the place they have in the picture for the whole shot."));
  assert.ok(p.includes("nothing is added, nothing is taken away, nothing changes."), "(not \"nothing leaves\": to an engine, leaves are leaves)");
  // NOTHING IS NAMED THAT MAY NOT BE IN THE PICTURE — not even after a "no": the rules once said "a fire or a
  // flame stays exactly the size it is", and a story set in an office corridor had flames in three clips
  for (const shot of [undefined, "wide", "walk", "depth", "over", "close", "low", "two", "detail"]) {
    const m = motionPrompt("anything", shot);
    assert.ok(!/\b(?:fire|flames?|creatures?|monsters?|hands?|rain|mist|leaves|water|smoke|blood|jump|lunge|crouch|fall)\b/i.test(m), `${shot}: ${m}`);
    // (a close shot IS a face, so its eyes may move; nowhere else are eyes spoken of)
    assert.equal(/\beyes?\b/i.test(m), shot === "close", `${shot}: eyes`);
  }
  // …and it follows how the scene is SEEN: somebody caught mid-stride walks; a face barely moves
  const walk = motionPrompt("Howl walks toward the camera through the pines.", "walk");
  assert.ok(walk.includes("Whoever is mid-stride walks slowly and steadily toward the camera") && walk.includes("Apart from that walk, HOLD THE PICTURE: everybody keeps the body, the build and the clothes"));
  assert.ok(motionPrompt("A face.", "close").includes("Almost still: a breath, the eyes moving, one slow blink."));
  assert.equal(motionPrompt("x", "nonsense"), motionPrompt("x"), "an unknown shot is no shot");
  assert.ok(p.includes("Nobody speaks; mouths stay closed."), "a told story: a mouth moving under the narrator reads as a fault");
  assert.ok(p.includes("The same faces, the same designs, the same place; no cuts, no writing."));
  assert.ok(p.includes("The camera drifts slowly forward, steady and smooth."));
  // a scene with nothing written still moves; a very long description is cut, the rules never are
  assert.ok(motionPrompt("").startsWith("One continuous shot") && !motionPrompt("").includes("What the picture shows"));
  const long = motionPrompt("x".repeat(2000));
  assert.ok(long.length < 1100 && long.endsWith("no cuts, no writing.") && !long.includes("xxx"), "however long the scene's words, the engine gets the rules and nothing else");
});

test("what it costs is known, and it can be turned off", () => {
  // (1080p since 2026-11-25 — the owner: "yes obviously upgrade the best image possible"; it was 720p, $0.0216)
  assert.equal(MOTION_USD_PER_SECOND, 0.0486);
  // fal's page: $1 per million tokens, tokens = height × width × fps × seconds / 1024
  assert.ok(Math.abs((1080 * 1920 * 24) / 1024 / 1_000_000 - MOTION_USD_PER_SECOND) < 1e-9);
  assert.equal(motionCost([12, 10, 9, 10, 12, 12]), 3.16, "a six-scene story of about a minute");
  assert.equal(motionCost([]), 0);
  assert.equal(motionOn({}, true), true);
  assert.equal(motionOn({ STORY_MOTION: "off" }, true), false);
  assert.equal(motionOn({ STORY_MOTION: " OFF " }, true), false);
  assert.equal(motionOn({ STORY_MOTION: "on" }, true), true);
  assert.equal(motionOn({}, false), false, "no provider key: the stories are told over stills, as before");
  assert.equal(motionOn(undefined, true), true);
  // every scene of the longest story a maker can ask for moves — never ten that do and two that stand still
  assert.equal(MOTION_MAX_SCENES, 12);
  // (2026-11-25: a story may be five minutes — 32 scenes, the engine's own limit, which the page now offers — and
  //  it is brought to life in runs of MOTION_MAX_SCENES, so every scene of it still moves)
  assert.ok(read("app", "routes", "web.film.tsx").includes("narratedScenes: { min: NARRATED_MIN_SCENES, max: NARRATED_MAX_SCENES, def: NARRATED_DEFAULT_SCENES },"));
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("for (let from = 0; from < N; from += MOTION_MAX_SCENES) {"));
  assert.equal(motionCost(Array.from({ length: 12 }, () => 12)), 7, "the most a story's motion can cost (at 1080p)");
});

test("the wait is said honestly: a story whose pictures move takes minutes longer", () => {
  // over stills, as it was measured: sixty seconds and twelve a scene
  assert.equal(storyTypicalSeconds(6, false), 132);
  assert.equal(storyTypicalSeconds(4, false), 108);
  // moving: a clip a scene, three at a time, and each brought to size — as MEASURED on the live site
  // (six scenes, pictures kept: 176 s moving against about 72 s over stills → about a hundred seconds more)
  assert.equal(storyTypicalSeconds(6, true), 132 + 20 + 2 * 30 + 6 * 4);
  assert.equal(storyTypicalSeconds(6, true) - storyTypicalSeconds(6, false), 104);
  assert.equal(storyTypicalSeconds(3, true), 96 + 20 + 30 + 12);
  assert.ok(storyTypicalSeconds(12, true) < 12 * 60, "the longest story is still under twelve minutes");
  assert.equal(storyTypicalSeconds(0, false), storyTypicalSeconds(1, false));
  // the Archive's card counts down from it, and the builder says it beside Generate
  const arch = read("app", "routes", "web.archive.tsx");
  assert.ok(arch.includes("? storyTypicalSeconds(typeof p.filmScenes === \"number\" ? p.filmScenes : 6, storyMotionOn(p.filmPictures))"), "a story asked for over still pictures is timed as one (tests/video-ladder.test.ts)");
  const film = read("app", "routes", "web.film.tsx");
  assert.ok(film.includes("storyMotion: storyMotionOn(),"));
  assert.ok(film.includes("if (opts.moves) { const s = storyTypicalSeconds(n, true); lo = Math.max(3, Math.round((s * 0.8) / 60)); hi = Math.round((s * 1.35) / 60); }"));
  // (…unless its maker chose STILL pictures on the storyboard's Motion card — tests/video-ladder.test.ts)
  assert.ok(film.includes("narrated, moves: d.storyMotion && pictures !== \"still\", scenes, engine: dialogueEngine })}"));
  // …and the storyboard says the pictures will move, in every language
  assert.ok(film.includes("{d.storyMotion && pictures !== \"still\" ? <> {t(\"In the finished story every picture moves.\")}</> : null}"));
  assert.equal(read("app", "lib", "ui-i18n-dict.ts").split("\n  \"In the finished story every picture moves.\": ").length - 1, 5);
});

test("a kept clip is cleared after a week — by its own name, and nothing else is touched", () => {
  const sc = read("app", "lib", "storage-cleanup.server.ts");
  assert.ok(sc.includes("if (!isMotionClip(n)) continue;"));
  assert.ok(sc.includes("const cutoff = now - MOTION_KEEP_DAYS * 86_400_000;"));
  assert.ok(sc.includes("if (st.isFile() && st.mtimeMs < cutoff) { fs.rmSync(fp, { force: true }); freed++; }"));
  assert.ok(sc.includes("await purgeOverlaySources(rendersDir, now);\n  purgeMotionClips(rendersDir, now);"));
  // the operator is shown what moved and what was paid for; a member is not sent it
  const arch = read("app", "routes", "web.archive.tsx");
  assert.ok(arch.includes("opsMotion: operator ? (() => { try { const m = JSON.parse(a.metaJson || \"{}\").motion; return m && typeof m === \"object\" ? m : undefined; } catch { return undefined; } })() : undefined,"));
  assert.ok(!arch.includes("a.opsMotion") && !arch.includes("viewer.opsMotion"));
});

test("the picture a clip is made from can be FETCHED — the name the app's own address serves", () => {
  // The first story made with moving pictures on the live site (2026-11-23): all six clips refused,
  // "Failed to download the file" — the cropped picture was "<picture>.jpg.n.jpg", and /renders serves
  // one-dot names only. The story shipped over its stills; its own record said why.
  const route = read("app", "routes", "renders.$file.tsx");
  assert.ok(route.includes("/^[a-zA-Z0-9_-]+\\.(mp4|mp3|jpe?g|png|webp|srt)$/.test(name)"), "the route's own rule");
  for (const picture of ["/data/renders/img-1795456790000-ab12cd34ef.jpg", "C:\\data\\renders\\nst-1795456790000-3-9f8e7d.jpg", "x.PNG", "y.webp"]) {
    const seed = seedName(picture);
    const base = seed.replace(/\\/g, "/").split("/").pop()!;
    assert.ok(servable(base), base);
    assert.ok(/-n\.jpg$/.test(base));
    assert.ok(/^[a-zA-Z0-9_-]+\.(mp4|mp3|jpe?g|png|webp|srt)$/.test(base), "by the route's rule itself");
  }
  assert.equal(seedName("/data/renders/img-1.jpg"), "/data/renders/img-1-n.jpg");
  assert.equal(servable("img-1.jpg.n.jpg"), false, "the name that was refused");
  assert.equal(servable("../etc/passwd.jpg"), false);
  assert.equal(servable("img-1.mv.mp4"), false);
  // the cut and the engine are given the same picture, and a name that cannot be served is caught at once
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("export async function withoutBars(s: string): Promise<string> {\n  const n = seedName(s);"));
  const srv = read("app", "lib", "story-motion.server.ts");
  assert.ok(srv.includes("if (!servable(path.basename(seed)) || !fs.existsSync(seed)) throw new Error("));
});

test("a clip never costs a story", () => {
  const srv = read("app", "lib", "story-motion.server.ts");
  // each scene by itself: one that fails is written down and keeps its still
  assert.ok(srv.includes("try { out.clips[i] = await clipFor(i); }\n        catch (e) { out.faults.push({ scene: i + 1, error: "));
  // asked for ONCE: a kept clip is used, a job that starts again picks its request up by id
  assert.ok(srv.includes("if (fs.existsSync(file) && motionReusable(seconds(file), need)) { out.reused++; return file; }"));
  assert.ok(srv.includes("let id = ids[name];\n      if (!id) {\n") && srv.includes("        id = await falVideoSubmit(STORY_MOTION_MODEL, "));
  assert.ok(srv.includes("ids[name] = id;\n        await saveIds();"), "the id is saved before the wait");
  assert.ok(srv.includes("out.made++;\n      out.seconds += ask; // counted when the clip is MADE"), "a request the provider refuses is not counted as paid for");
  assert.ok(srv.includes("if (!/still running/.test(e instanceof Error ? e.message : \"\")) { delete ids[name];"), "a clip still being made keeps its id for the next try");
  // one clip a picture — a scene that borrowed its neighbour's picture does not buy a second
  assert.ok(srv.includes("const had = making.get(name);\n    if (had) return had;"));
  // the job says it is alive while it waits, and the wait is bounded
  assert.ok(srv.includes("setInterval(() => { void checkpointJob(o.jobId!, { ckBeat: Date.now() }).catch(() => undefined); }, 45_000)"));
  assert.ok(srv.includes("const CLIP_WAIT_MS = 7 * 60_000;"));
  assert.ok(srv.includes("while (next < Math.min(N, MOTION_MAX_SCENES)) {"));
  // kept small: the story's own size, no sound
  assert.ok(srv.includes("\"-an\", \"-vf\", `scale=${o.W}:${o.H}:force_original_aspect_ratio=increase,crop=${o.W}:${o.H},setsar=1`,"));

  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("if (storyMotionOn(opts.pictures)) {\n    try {"), "the whole step is tried, and a story is told over stills if it cannot be");
  assert.ok(nar.includes("the pictures could not be brought to life — told over the still pictures"));
  // the engine is given the picture that goes into the cut (bars cropped off), and each scene's own length
  assert.ok(nar.includes("for (const s of stills) seeds.push(await withoutBars(s));"));
  assert.ok(nar.includes("told: windows.map((w, i) => (i === windows.length - 1 ? end : w.t1) - w.t0),"));
  assert.ok(nar.includes("await assembleNarrated({ stills, clips: motion?.clips, windows,"));
  // the cut: with the moving scenes first — and if that fails, the same story from its stills
  assert.ok(nar.includes("if (anyMoves) {\n      const run = await runFfmpeg(build(true, true, true));\n      if (run.status === 0 && produced()) return;"));
  assert.ok(nar.includes("const run = await runFfmpeg(build(withCaps, kb, mus, false, false));"), "every older rung is cut without clips");
  assert.ok(nar.includes("if (!c || !fs.existsSync(c)) return null;"), "a clip that is not on the disk is not a clip");
  // the piece says what moved, what was paid for, and why any scene did not
  assert.ok(nar.includes("...(motion ? { motion: { engine: STORY_MOTION_ENGINE, scenes: motion.clips.filter(Boolean).length, of: stills.length, made: motion.made, reused: motion.reused, seconds: motion.seconds, ...(motion.faults.length ? { faults: motion.faults.slice(0, 8) } : {}), ...(motion.looks.length ? { looks: motion.looks.slice(0, 12) } : {}) } } : {}),"));
  // a job that starts again is handed the clips it was waiting for
  const jq = read("app", "lib", "job-queue.server.ts");
  assert.ok(jq.includes("ckMotion: payload.ckMotion as string | undefined,"));
});

test("a story's writer is ASKED for its title", () => {
  // A story made on the live site, 2026-11-23, was called "Moral Story — A boastful young rooster named
  // Bram wants the whole…": the writer had left the title out (it was optional), and the story was named
  // after the maker's idea, cut where eighty characters ran out.
  const engine = read("app", "lib", "film-engine.server.ts");
  assert.ok(engine.includes('required: ["scenes", "musicMood", "title"],'));
  assert.ok(engine.includes("Also give musicMood (a short phrase for the backing track) and a short title."));
  // (should one still come back without a title, the idea stands in, cut at a whole word with an ellipsis)
  assert.ok(engine.includes("let outTitle = (parsed.title || topic || tmpl.name).slice(0, 80);"));
});

test("the status page says how full the renders disk is, and what the kept clips take", () => {
  // Moving pictures keep a clip a scene for a week, and nobody can read the server's log where the
  // cleanup sweep prints the disk's fill: the figure is on /art-status, numbers only.
  const st = read("app", "routes", "art-status.tsx");
  assert.ok(st.includes("disk: rendersDisk(),"));
  assert.ok(st.includes("if (!isMotionClip(n)) continue;"));
  assert.ok(st.includes("return { totalGb: r1(totalGb), freeGb: r1(freeGb), usedPct: totalGb > 0 ? Math.round((1 - freeGb / totalGb) * 100) : 0, storyClips, storyClipsMb: Math.round(bytes / 1e6) };"));
  assert.ok(st.includes("} catch { return null; }"), "a platform without the call answers nothing rather than failing the page");
});

/* THE CLIP IS LOOKED AT (2026-11-25): the lake woman's too-wide smile softened into an ordinary face as her clip moved, a
 * faceless shadow grew a hood. Each new clip's LAST frame is now looked at beside its picture — written down on the
 * piece while the question is new; MOTION_DRIFT=enforce drops a drifted clip once it has been checked by eye. */
test("each new clip's last frame is looked at beside its picture — written down, and dropped only when enforced", async () => {
  const sm = await import("../app/lib/story-motion.ts");
  const q = sm.driftPrompt();
  assert.ok(q.startsWith("The FIRST image is a still picture from a film. The SECOND image is the LAST frame of the same shot"));
  assert.ok(q.includes("a smile far too wide that is now an ordinary smile") && q.includes("a hood, a mask or clothes that appeared on a figure that had none"));
  assert.ok(q.includes("Small, natural movement is expected and is NOT a change"));
  assert.deepEqual(sm.parseDrift('{"different":"her smile became an ordinary closed smile","drifted":true}'), { drifted: true, what: "her smile became an ordinary closed smile" });
  assert.deepEqual(sm.parseDrift('```json {"different":"she blinked","drifted":false} ```'), { drifted: false, what: "she blinked" });
  assert.equal(sm.parseDrift("no idea"), null);
  assert.equal(sm.driftEnforced({}), false, "written down only, by default");
  assert.equal(sm.driftEnforced({ MOTION_DRIFT: " Enforce " }), true);
  const srv = read("app", "lib", "story-motion.server.ts");
  assert.ok(srv.includes("const r = await runFfmpeg([\"-y\", \"-sseof\", \"-0.25\", \"-i\", clip, \"-frames:v\", \"1\", \"-q:v\", \"3\", end]);"), "the clip's last frame, on our own disk");
  assert.ok(srv.includes("if (look.drifted && driftEnforced(process.env)) {"));
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("...(motion.looks.length ? { looks: motion.looks.slice(0, 12) } : {})"), "what it said is kept on the piece");
});
