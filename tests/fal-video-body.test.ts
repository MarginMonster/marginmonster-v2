/* WHAT A MOTION ENGINE IS ASKED FOR: THE RIGHT LENGTH, SOUND ONLY WHERE IT IS KEPT, AND THE "DO NOT".
 *
 * The request body used to be built inline in falVideoSubmit, untested. Its Kling 3 branch was written
 * for the film engine's dialogue shots (sound on; ten seconds unless told) — and Kling 3 Pro was already
 * the DEFAULT motion engine, whose callers say nothing about sound and, some of them, nothing about
 * length. So from 2026-11-06 every default-engine clip was rendered with generated sound and no negative
 * prompt — a cartoon's or an anthem's at ten seconds, $1.68 where $0.56 was meant (fal's price page:
 * $0.112 a second silent, $0.168 with sound); a kids' film scene $0.84 where $0.56 was meant — for sound
 * those pipelines then discard under their own voice and music. (The Commercial was never on that engine:
 * it is pinned to Kling 2.6 Pro, and a test below holds that true.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_NEGATIVE_PROMPT, falVideoBody, klingThreeSeconds, modelMakesSound } from "../app/lib/fal-video-body.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const V3_PRO = "fal-ai/kling-video/v3/pro/image-to-video";
const O3_STD = "fal-ai/kling-video/o3/standard/image-to-video";
const K25 = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
const K26 = "fal-ai/kling-video/v2.6/pro/image-to-video";
const SEEDANCE = "bytedance/seedance-2.5/image-to-video";
const VEO = "fal-ai/veo3.1/fast/image-to-video";
const seed = { startImage: "https://x.test/renders/seed.jpg", prompt: "a hero shot" };

test("Kling 3 Pro with nothing said: five seconds, silent, and told what not to do", () => {
  assert.deepEqual(falVideoBody(V3_PRO, seed), {
    prompt: "a hero shot",
    start_image_url: "https://x.test/renders/seed.jpg",
    duration: "5",
    generate_audio: false,
    negative_prompt: DEFAULT_NEGATIVE_PROMPT,
  });
});

test("sound is asked for, never assumed", () => {
  for (const m of [V3_PRO, O3_STD]) {
    assert.equal(falVideoBody(m, seed).generate_audio, false, `${m}: nothing said`);
    assert.equal(falVideoBody(m, { ...seed, generateAudio: false }).generate_audio, false);
    assert.equal(falVideoBody(m, { ...seed, generateAudio: true }).generate_audio, true);
  }
  // Veo makes sound unless told not to (its default is true, at half again the price) — so the flag is
  // always sent, and it is true only when asked
  assert.equal(falVideoBody(VEO, seed).generate_audio, false);
  assert.equal(falVideoBody(VEO, { ...seed, generateAudio: true }).generate_audio, true);
  // engines with no sound of their own are never sent the flag
  for (const m of [K25, K26, SEEDANCE]) assert.ok(!("generate_audio" in falVideoBody(m, { ...seed, generateAudio: true })), m);
  assert.ok(modelMakesSound(V3_PRO) && modelMakesSound(O3_STD) && modelMakesSound(VEO));
  assert.ok(!modelMakesSound(K25) && !modelMakesSound(SEEDANCE));
});

test("the length asked for is the length sent — whole seconds, 3 to 15 on Kling 3", () => {
  assert.equal(falVideoBody(V3_PRO, { ...seed, durationSec: 10 }).duration, "10");
  assert.equal(falVideoBody(O3_STD, { ...seed, durationSec: 15 }).duration, "15");
  assert.equal(klingThreeSeconds(undefined), 5);
  assert.equal(klingThreeSeconds(NaN), 5);
  assert.equal(klingThreeSeconds(0), 5);
  assert.equal(klingThreeSeconds(1), 3);
  assert.equal(klingThreeSeconds(40), 15);
  assert.equal(klingThreeSeconds(7.6), 8);
});

test("each engine gets its own field names and nothing its schema lacks", () => {
  // O3: image_url, and no negative_prompt (not in its schema)
  assert.deepEqual(Object.keys(falVideoBody(O3_STD, { ...seed, negativePrompt: "x" })).sort(), ["duration", "generate_audio", "image_url", "prompt"]);
  // V3: start_image_url, and the caller's own negative prompt when it names one
  assert.equal(falVideoBody(V3_PRO, { ...seed, negativePrompt: "talking, mouth opening" }).negative_prompt, "talking, mouth opening");
  // Kling 2.x: exactly as before
  assert.deepEqual(falVideoBody(K25, seed), { prompt: "a hero shot", image_url: "https://x.test/renders/seed.jpg", duration: "5", negative_prompt: DEFAULT_NEGATIVE_PROMPT });
  assert.deepEqual(falVideoBody(K26, { ...seed, durationSec: 10, negativePrompt: "blur" }), { prompt: "a hero shot", image_url: "https://x.test/renders/seed.jpg", duration: "10", negative_prompt: "blur" });
  // Seedance: prompt + image_url + resolution + duration, nothing else (anything else is a 422)
  assert.deepEqual(falVideoBody(SEEDANCE, { ...seed, negativePrompt: "x", generateAudio: true }), { prompt: "a hero shot", image_url: "https://x.test/renders/seed.jpg", resolution: "720p", duration: "5" });
  // Veo: its frame is a flag — vertical unless the caller wants wide (it was always 9:16, so a wide
  // Creator video picked on Ultra came back vertical and was refunded after we had paid for it)
  assert.deepEqual(falVideoBody(VEO, seed), { prompt: "a hero shot", image_url: "https://x.test/renders/seed.jpg", aspect_ratio: "9:16", generate_audio: false });
  assert.equal(falVideoBody(VEO, { ...seed, aspect: "16:9" }).aspect_ratio, "16:9");
  assert.equal(falVideoBody(VEO, { ...seed, aspect: "1:1" }).aspect_ratio, "9:16", "Veo has no square");
  // the engines that follow the seed's own shape are never sent one
  for (const m of [V3_PRO, O3_STD, K25, SEEDANCE]) assert.ok(!("aspect_ratio" in falVideoBody(m, { ...seed, aspect: "16:9" })), m);
});

test("the submit sends that body and nothing built beside it", () => {
  const src = read("app", "lib", "fal-video.server.ts");
  assert.ok(src.includes("import { falVideoBody, type FalVideoOpts } from \"./fal-video-body\";"));
  assert.ok(src.includes("  const body = falVideoBody(model, opts);"));
  assert.ok(!src.includes("generate_audio: opts.generateAudio !== false"), "the default-on is gone");
  assert.ok(!src.includes("opts.durationSec ?? 10"), "and so is the silent ten seconds");
});

test("a pipeline asks for sound exactly when it ships the clip's own sound", () => {
  // ships it: a Creator / product video (the file keeps the clip's audio) — all three of its renders ask
  const vid = read("app", "lib", "video-generation.server.ts");
  assert.equal(count(vid, "generateAudio: true, aspect }"), 3, "the first render, the inference retry and the fidelity re-roll — each with the frame the member picked");
  assert.ok(vid.includes("\"-map\", \"[v]\", \"-map\", \"0:a?\","), "…because this is the pipeline whose frame step carries the audio through");
  // ships it: a film's dialogue shot
  const dia = read("app", "lib", "film-dialogue.server.ts");
  assert.ok(dia.includes("falVideoSubmit(model, { startImage: seedAbs, prompt, generateAudio: true, durationSec: dur })"));
  // lay their own track over the clip: never ask
  for (const f of ["cartoon-ad-pipeline.server.ts", "jingle-ad-pipeline.server.ts", "commercial-ad-pipeline.server.ts", "film-engine.server.ts"]) {
    assert.equal(count(read("app", "lib", f), "generateAudio"), 0, `${f} pays for no sound it will discard`);
  }
  assert.ok(read("app", "lib", "music-video-pipeline.server.ts").includes("generateAudio: false"));
  // and the adapter hands the wish straight through
  const ugc = read("app", "lib", "ugc-ad-pipeline.server.ts");
  assert.ok(ugc.includes("opts: { startImage: string; prompt: string; negativePrompt?: string; durationSec?: number; generateAudio?: boolean; aspect?: string }"));
  assert.ok(ugc.includes("const rid = await falVideoSubmit(m, opts);"));
});

test("the looped ads ask for ten seconds by name, on Kling only; a commercial beat takes the default five", () => {
  for (const f of ["cartoon-ad-pipeline.server.ts", "jingle-ad-pipeline.server.ts"]) {
    assert.equal(count(read("app", "lib", f), "durationSec: !params.videoEngine || params.videoEngine.startsWith(\"kling\") ? 10 : undefined,"), 1, f);
  }
  const com = read("app", "lib", "commercial-ad-pipeline.server.ts");
  assert.ok(com.includes("opts: { startImage: string; prompt: string; negativePrompt?: string },"), "five beats × the default five seconds");
  // …on ITS OWN engine: the Commercial is pinned to Kling 2.6 Pro (no sound, $0.35 a clip), so it was never
  // one of the clips the Kling 3 default over-rendered — and it must not drift onto that default unpriced
  assert.ok(com.includes("const motionEngine: string | undefined = \"kling26\";"));
  assert.deepEqual(falVideoBody(K26, seed), { prompt: "a hero shot", image_url: "https://x.test/renders/seed.jpg", duration: "5", negative_prompt: DEFAULT_NEGATIVE_PROMPT });
  assert.ok(com.includes("const clipSecs = opts.clipPaths.map((_, i) => opts.clipSecs?.[i] ?? opts.clipSec ?? 5);"), "which is what its assembler cuts to");
  // the Replicate fallback only knows 5 and 10
  assert.ok(read("app", "lib", "ugc-ad-pipeline.server.ts").includes("duration: (opts.durationSec ?? 5) > 7 ? 10 : 5 };"));
});

test("a video sold with sound tries two engines that make it before the silent default", () => {
  const ugc = read("app", "lib", "ugc-ad-pipeline.server.ts");
  assert.ok(ugc.includes("export const SOUND_ENGINE_KEY = \"kling3s\";"));
  assert.ok(ugc.includes("export const SOUND_FAL_ANIMATE_MODEL = \"fal-ai/kling-video/o3/standard/image-to-video\";"));
  assert.ok(ugc.includes("const falModels = engineKey === SOUND_ENGINE_KEY ? [falModel, DEFAULT_FAL_ANIMATE_MODEL] : [falModel];"));
  const vid = read("app", "lib", "video-generation.server.ts");
  assert.ok(vid.includes("const engineKey = params.videoEngine ?? (params.creative ? SOUND_ENGINE_KEY : undefined);"), "a described Creator video on Auto; a picked engine and a product video keep theirs");
  assert.ok(vid.includes("const retryKey = engineKey === SOUND_ENGINE_KEY && ranModel !== DEFAULT_FAL_ANIMATE_MODEL ? \"kling\" : \"kling25\";"));
  // the member is never offered it as a choice: the server picks it
  assert.ok(!read("app", "lib", "video-engines.ts").includes("kling3s"));
  // what shipped is asked of the file and written on the piece
  assert.ok(vid.includes("sound = hasAudioStream(path.join(process.cwd(), \"data\", \"renders\", path.basename(storedUrl)));"));
  assert.ok(vid.includes("sound, engine: ranModel || undefined, seconds: params.durationSec || undefined,"));
  assert.ok(vid.includes("creative: params.creative || undefined }),"), "and that it is a described scene, not a product ad");
  // the Archive reads those back: a Creator video is not labelled "Product Highlight", and our own brief
  // to the engine is not printed under "Prompt"
  const arc = read("app", "routes", "web.archive.tsx");
  assert.ok(arc.includes("function creativeVideo(meta: Record<string, unknown>, body: Record<string, unknown>): boolean {"));
  assert.ok(arc.includes("return `Creator video${eng}${sec}${meta.sound === true ? \" · sound\" : meta.sound === false ? \" · silent\" : \"\"}`;"));
  assert.ok(arc.includes("if (creative) script = null;"));
  assert.ok(arc.includes("product: creative ? null : str(meta.productTitle),"));
  assert.ok(vid.includes("if (hasAudioStream(finalPath)) await levelFilm(finalPath, -16);"), "and it plays at the level of everything else we make");
});
