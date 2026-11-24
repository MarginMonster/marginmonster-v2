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
 *
 * …AND THE COMMERCIAL'S OWN ENGINE WAS ASKED WRONG (found 2026-11-24). Kling 2.6 Pro was sent the Kling 2.5
 * body: `image_url` where fal's schema REQUIRES `start_image_url`, and no `generate_audio` — whose default
 * there is TRUE, $0.14 a second against $0.07 silent. The last test below checks the body of every fal id
 * that goes through falVideoBody against the schema fal published that day.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_NEGATIVE_PROMPT, falVideoBody, klingThreeSeconds, klingTwoSeconds, modelMakesSound, seedanceSeconds } from "../app/lib/fal-video-body.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const V3_PRO = "fal-ai/kling-video/v3/pro/image-to-video";
const O3_STD = "fal-ai/kling-video/o3/standard/image-to-video";
const K25 = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
const K26 = "fal-ai/kling-video/v2.6/pro/image-to-video";
const SEEDANCE = "bytedance/seedance-2.5/image-to-video";
const SEEDANCE_V1 = "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video";
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
  // Veo, Kling 2.6 and Seedance 2.5 make sound unless told not to (their schemas' default is true) — so the
  // flag is always sent, and it is true only when asked
  for (const m of [VEO, K26, SEEDANCE]) {
    assert.equal(falVideoBody(m, seed).generate_audio, false, `${m}: nothing said`);
    assert.equal(falVideoBody(m, { ...seed, generateAudio: false }).generate_audio, false, m);
    assert.equal(falVideoBody(m, { ...seed, generateAudio: true }).generate_audio, true, m);
  }
  // engines with no sound of their own are never sent the flag
  for (const m of [K25, SEEDANCE_V1]) assert.ok(!("generate_audio" in falVideoBody(m, { ...seed, generateAudio: true })), m);
  for (const m of [V3_PRO, O3_STD, VEO, K26, SEEDANCE]) assert.ok(modelMakesSound(m), m);
  for (const m of [K25, SEEDANCE_V1]) assert.ok(!modelMakesSound(m), m);
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

test("Kling 2.x makes five or ten seconds; any other ask lands on the nearer — never a length fal refuses", () => {
  assert.equal(klingTwoSeconds(undefined), 5);
  assert.equal(klingTwoSeconds(NaN), 5);
  assert.equal(klingTwoSeconds(3), 5);
  assert.equal(klingTwoSeconds(5), 5);
  assert.equal(klingTwoSeconds(7), 5);
  assert.equal(klingTwoSeconds(7.5), 10);
  assert.equal(klingTwoSeconds(10), 10);
  assert.equal(klingTwoSeconds(15), 10, "a fifteen-second Creator video picked on Kling 2.x comes back ten");
  for (const m of [K25, K26]) {
    assert.equal(falVideoBody(m, { ...seed, durationSec: 15 }).duration, "10", m);
    assert.equal(falVideoBody(m, { ...seed, durationSec: 6 }).duration, "5", m);
  }
  // Seedance 2.5: any whole second from 4 to 30
  assert.equal(seedanceSeconds(undefined), 5);
  assert.equal(seedanceSeconds(2), 4);
  assert.equal(seedanceSeconds(9.6), 10);
  assert.equal(seedanceSeconds(45), 30);
  assert.equal(falVideoBody(SEEDANCE, { ...seed, durationSec: 15 }).duration, "15");
});

test("each engine gets its own field names and nothing its schema lacks", () => {
  // O3: image_url, and no negative_prompt (not in its schema)
  assert.deepEqual(Object.keys(falVideoBody(O3_STD, { ...seed, negativePrompt: "x" })).sort(), ["duration", "generate_audio", "image_url", "prompt"]);
  // V3: start_image_url, and the caller's own negative prompt when it names one
  assert.equal(falVideoBody(V3_PRO, { ...seed, negativePrompt: "talking, mouth opening" }).negative_prompt, "talking, mouth opening");
  // Kling 2.5 Turbo: image_url, no sound of its own — exactly as before
  assert.deepEqual(falVideoBody(K25, seed), { prompt: "a hero shot", image_url: "https://x.test/renders/seed.jpg", duration: "5", negative_prompt: DEFAULT_NEGATIVE_PROMPT });
  // Kling 2.6 Pro: its seed is start_image_url (required), and its sound is said out loud
  assert.deepEqual(falVideoBody(K26, { ...seed, durationSec: 10, negativePrompt: "blur" }), { prompt: "a hero shot", start_image_url: "https://x.test/renders/seed.jpg", duration: "10", generate_audio: false, negative_prompt: "blur" });
  // Seedance 2.5: prompt + image_url + resolution + duration + generate_audio; no negative prompt, no aspect
  assert.deepEqual(falVideoBody(SEEDANCE, { ...seed, negativePrompt: "x", generateAudio: true }), { prompt: "a hero shot", image_url: "https://x.test/renders/seed.jpg", resolution: "720p", duration: "5", generate_audio: true });
  // Seedance 1 Pro Fast (a story's moving pictures): as before — 720p asked by name, no sound flag
  assert.deepEqual(falVideoBody(SEEDANCE_V1, { ...seed, durationSec: 9, generateAudio: true }), { prompt: "a hero shot", image_url: "https://x.test/renders/seed.jpg", resolution: "720p", duration: "9" });
  // Veo: its frame is a flag — vertical unless the caller wants wide (it was always 9:16, so a wide
  // Creator video picked on Ultra came back vertical and was refunded after we had paid for it)
  assert.deepEqual(falVideoBody(VEO, seed), { prompt: "a hero shot", image_url: "https://x.test/renders/seed.jpg", aspect_ratio: "9:16", generate_audio: false });
  assert.equal(falVideoBody(VEO, { ...seed, aspect: "16:9" }).aspect_ratio, "16:9");
  assert.equal(falVideoBody(VEO, { ...seed, aspect: "1:1" }).aspect_ratio, "9:16", "Veo has no square");
  // the engines that follow the seed's own shape are never sent one
  for (const m of [V3_PRO, O3_STD, K25, K26, SEEDANCE, SEEDANCE_V1]) assert.ok(!("aspect_ratio" in falVideoBody(m, { ...seed, aspect: "16:9" })), m);
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
  // and the adapter hands the wish straight through — to fal, and to Replicate (animate-engines.ts)
  const ugc = read("app", "lib", "ugc-ad-pipeline.server.ts");
  assert.ok(ugc.includes("opts: { startImage: string; prompt: string; negativePrompt?: string; durationSec?: number; generateAudio?: boolean; aspect?: string }"));
  assert.ok(ugc.includes("const rid = await falVideoSubmit(model, opts);"));
  assert.ok(ugc.includes("return { id: await repCreate(model, animateInputFor(model, opts)), model };"));
});

test("the looped ads ask for ten seconds by name, on Kling only; a commercial beat takes the default five", () => {
  for (const f of ["cartoon-ad-pipeline.server.ts", "jingle-ad-pipeline.server.ts"]) {
    assert.equal(count(read("app", "lib", f), "durationSec: !params.videoEngine || params.videoEngine.startsWith(\"kling\") ? 10 : undefined,"), 1, f);
  }
  const com = read("app", "lib", "commercial-ad-pipeline.server.ts");
  assert.ok(com.includes("opts: { startImage: string; prompt: string; negativePrompt?: string },"), "five beats × the default five seconds");
  // …on ITS OWN engine: the Commercial is pinned to Kling 2.6 Pro (silent, $0.35 a clip), so it was never
  // one of the clips the Kling 3 default over-rendered — and it must not drift onto that default unpriced.
  // Kling 2.6 Pro DOES make sound when not told otherwise ($0.70 a clip), so the beat says no by name, and
  // its seed goes in the field its schema requires.
  assert.ok(com.includes("const motionEngine: string | undefined = \"kling26\";"));
  assert.deepEqual(falVideoBody(K26, seed), { prompt: "a hero shot", start_image_url: "https://x.test/renders/seed.jpg", duration: "5", generate_audio: false, negative_prompt: DEFAULT_NEGATIVE_PROMPT });
  assert.ok(com.includes("const clipSecs = opts.clipPaths.map((_, i) => opts.clipSecs?.[i] ?? opts.clipSec ?? COMMERCIAL_BEAT_SEC);"), "which is what its assembler cuts to");
  assert.ok(read("app", "lib", "commercial-captions.ts").includes("export const COMMERCIAL_BEAT_SEC = 5;"));
  // the Replicate copies of Kling 2.x only know 5 and 10 too (animate-engines.ts)
  const eng = read("app", "lib", "animate-engines.ts");
  assert.ok(eng.includes("return { start_image: opts.startImage, prompt: opts.prompt, negative_prompt: neg, duration: klingTwoSeconds(opts.durationSec) };"));
});

test("a video sold with sound tries two engines that make it before the silent default", async () => {
  const { animateRoute, DEFAULT_ANIMATE_MODEL, DEFAULT_FAL_ANIMATE_MODEL, SOUND_ENGINE_KEY, SOUND_FAL_ANIMATE_MODEL } = await import("../app/lib/animate-engines.ts");
  assert.equal(SOUND_ENGINE_KEY, "kling3s");
  assert.equal(SOUND_FAL_ANIMATE_MODEL, "fal-ai/kling-video/o3/standard/image-to-video");
  assert.deepEqual(animateRoute(SOUND_ENGINE_KEY, true), [
    { host: "fal", model: SOUND_FAL_ANIMATE_MODEL },
    { host: "fal", model: DEFAULT_FAL_ANIMATE_MODEL },
    { host: "replicate", model: DEFAULT_ANIMATE_MODEL },
  ]);
  // the pipelines that name these constants still find them where they always did
  const ugc = read("app", "lib", "ugc-ad-pipeline.server.ts");
  assert.ok(ugc.includes("export { DEFAULT_ANIMATE_MODEL, DEFAULT_FAL_ANIMATE_MODEL, SOUND_ENGINE_KEY, SOUND_FAL_ANIMATE_MODEL } from \"./animate-engines\";"));
  assert.ok(ugc.includes("const route = animateRoute(engineKey, falEnabled());"));
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

/* EVERY fal id that goes through falVideoBody, against the input schema fal published for it — read
 * 2026-11-24 from https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id> (components.schemas.*Input).
 * `fields` is every property the schema has, `required` its required list, `durations` its duration enum,
 * `soundByDefault` the default of its generate_audio (absent: the model has no such flag). */
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const KLING3_FIELDS = ["start_image_url", "prompt", "cfg_scale", "elements", "end_image_url", "multi_prompt", "duration", "generate_audio", "shot_type", "enable_safety_checker", "negative_prompt"];
const O3_I2V_FIELDS = ["prompt", "image_url", "end_image_url", "multi_prompt", "duration", "generate_audio", "shot_type", "enable_safety_checker"];
const O3_REF_FIELDS = ["start_image_url", "prompt", "elements", "end_image_url", "multi_prompt", "aspect_ratio", "generate_audio", "duration", "enable_safety_checker", "image_urls", "shot_type"];
const VEO_FIELDS = ["seed", "prompt", "resolution", "image_url", "duration", "aspect_ratio", "generate_audio", "safety_tolerance", "auto_fix", "negative_prompt"];
const SCHEMAS: Record<string, { required: string[]; fields: string[]; durations: string[]; soundByDefault?: boolean }> = {
  [K26]: { required: ["prompt", "start_image_url"], fields: ["start_image_url", "prompt", "end_image_url", "duration", "voice_ids", "generate_audio", "enable_safety_checker", "negative_prompt"], durations: ["5", "10"], soundByDefault: true },
  [K25]: { required: ["prompt", "image_url"], fields: ["duration", "prompt", "tail_image_url", "image_url", "enable_safety_checker", "cfg_scale", "negative_prompt"], durations: ["5", "10"] },
  [V3_PRO]: { required: ["start_image_url"], fields: KLING3_FIELDS, durations: range(3, 15), soundByDefault: true },
  [O3_STD]: { required: ["image_url"], fields: O3_I2V_FIELDS, durations: range(3, 15), soundByDefault: false },
  "fal-ai/kling-video/o3/pro/image-to-video": { required: ["image_url"], fields: O3_I2V_FIELDS, durations: range(3, 15), soundByDefault: false },
  "fal-ai/kling-video/o3/standard/reference-to-video": { required: [], fields: O3_REF_FIELDS, durations: range(3, 15), soundByDefault: false },
  "fal-ai/kling-video/o3/pro/reference-to-video": { required: [], fields: O3_REF_FIELDS, durations: range(3, 15), soundByDefault: false },
  [VEO]: { required: ["prompt", "image_url"], fields: VEO_FIELDS, durations: ["4s", "6s", "8s"], soundByDefault: true },
  "fal-ai/veo3.1/image-to-video": { required: ["prompt", "image_url"], fields: VEO_FIELDS, durations: ["4s", "6s", "8s"], soundByDefault: true },
  [SEEDANCE]: { required: ["image_url"], fields: ["end_user_id", "end_image_url", "duration", "resolution", "return_last_frame", "bitrate_mode", "draft", "codec", "generate_audio", "image_url", "aspect_ratio", "prompt", "output_format"], durations: ["auto", ...range(4, 30)], soundByDefault: true },
  [SEEDANCE_V1]: { required: ["prompt", "image_url"], fields: ["resolution", "camera_fixed", "num_frames", "image_url", "aspect_ratio", "seed", "enable_safety_checker", "duration", "prompt"], durations: range(2, 12) },
};

test("every fal engine is asked only for fields its schema has, with every field it requires, at a length it makes, and with its sound said out loud", () => {
  // the asks the pipelines really make: nothing said; a Creator video with sound at 10 or 15 s; a film shot
  // at 7.6 s; a three-second ask (Seedance 1 Pro Fast's caller never asks outside 2–12: story-motion.ts)
  const asks = [{}, { generateAudio: true, durationSec: 10 }, { generateAudio: true, durationSec: 15, aspect: "16:9" }, { durationSec: 7.6, negativePrompt: "x" }, { durationSec: 3, generateAudio: false }];
  // Seedance 1 Pro Fast is sent the length as asked: its one caller asks a whole second from 2 to 12
  // (motionSeconds, tests/story-motion.test.ts), so only such asks are put to it here
  const storyAsk = (d: number | undefined) => d === undefined || (Number.isInteger(d) && d >= 2 && d <= 12);
  for (const [model, s] of Object.entries(SCHEMAS)) {
    for (const a of asks) {
      if (model === SEEDANCE_V1 && !storyAsk((a as { durationSec?: number }).durationSec)) continue;
      const opts = { ...seed, referenceImages: ["https://x.test/renders/ref.jpg"], ...a };
      const body = falVideoBody(model, opts);
      const keys = Object.keys(body);
      for (const k of keys) assert.ok(s.fields.includes(k), `${model}: "${k}" is not in its schema`);
      for (const k of s.required) assert.ok(keys.includes(k), `${model}: required "${k}" is missing`);
      if ("duration" in body) assert.ok(s.durations.includes(String(body.duration)), `${model}: duration ${body.duration} is not one it makes`);
      if (s.soundByDefault !== undefined) assert.equal(body.generate_audio, opts.generateAudio === true, `${model}: sound is sent, and only when asked`);
      else assert.ok(!("generate_audio" in body), `${model} has no sound flag`);
    }
  }
});
