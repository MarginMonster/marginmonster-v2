/* EVERY ENGINE KEY, WALKED: THE MODEL IT RENDERS ON IS THE ENGINE THE MEMBER PAID FOR.
 *
 * Found 2026-11-24: a member who picked Seedance (+75 tokens) and got Seedance 2.5 on fal was refunded the 75,
 * because engine-delivery.ts did not know the name "bytedance/seedance-2.5/image-to-video" — an unknown model
 * reads as the free default, on purpose. The engine tables lived in ugc-ad-pipeline.server.ts, which talks to
 * the database, so no test could walk them. They live in animate-engines.ts now, and this walks every key —
 * the picker's (video-engines.ts) and the ones the server names itself — through every host, so the next
 * engine added cannot be refunded for being delivered.
 *
 * The same day: four Replicate fallbacks 404'd (their model pages and llms.txt), and Seedance 2.5 was found at
 * half the price on Replicate. The Replicate bodies below are checked against the input schemas Replicate
 * published that day (replicate.com/<owner>/<model>/llms.txt and the schema on the model page). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  animateInputFor, animateModelFor, animateRoute, falAnimateModelFor, replicateFirstModelFor, voiceoverMotionInput,
  DEFAULT_ANIMATE_MODEL, DEFAULT_FAL_ANIMATE_MODEL, SOUND_ENGINE_KEY, SOUND_FAL_ANIMATE_MODEL, VOICEOVER_MOTION_MODEL,
} from "../app/lib/animate-engines.ts";
import { engineKeyForModel, surchargeShortfall } from "../app/lib/engine-delivery.ts";
import { VIDEO_ENGINES, engineSurcharge } from "../app/lib/video-engines.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

/** Every key a caller can hand animateCreate: nothing; the picker's keys (and "auto" as a word — the Buddy and
 *  the Studio's presenter/Commercial paths put it in the payload as is); and the server's own: "kling3", the
 *  sound engine, and "kling25" (video-generation's "retry on the Replicate default"). */
const KEYS: (string | undefined)[] = [undefined, "", ...VIDEO_ENGINES.map((e) => e.key), "kling3", SOUND_ENGINE_KEY, "kling25"];

/** Keys that are another name for an engine on the list — the same engine, so the same picker key. */
const SAME_ENGINE: Record<string, string> = {
  "": "kling", auto: "kling", kling3: "kling", // "Auto IS Kling 3 Pro" (video-engines.ts)
  kling25: "kling", // "the Replicate default", which is what the default engine is on Replicate
};
const engineOf = (key: string | undefined) => SAME_ENGINE[key ?? ""] ?? key;

test("every engine key's own model, on every host, maps back to that engine", () => {
  for (const key of KEYS) {
    const want = engineOf(key);
    const fal = falAnimateModelFor(key);
    if (fal) assert.equal(engineKeyForModel(fal), want, `fal model ${fal} for "${key}"`);
    const first = replicateFirstModelFor(key);
    if (first) assert.equal(engineKeyForModel(first), want, `Replicate-first model ${first} for "${key}"`);
    const rep = animateModelFor(key);
    if (rep === DEFAULT_ANIMATE_MODEL) {
      // no Replicate copy of its own: landing on the default is the documented step down, and a premium
      // pick is refunded in full for it (veo31's 75), a free one owes nothing
      assert.equal(surchargeShortfall(key, rep), engineSurcharge(key), `"${key}" on the default`);
    } else {
      assert.equal(engineKeyForModel(rep), want, `Replicate model ${rep} for "${key}"`);
    }
  }
});

test("every rung before the last resort is known by name and owes the member nothing", () => {
  for (const key of KEYS) for (const falOn of [true, false]) {
    const route = animateRoute(key, falOn);
    assert.deepEqual(route[route.length - 1], { host: "replicate", model: DEFAULT_ANIMATE_MODEL }, `"${key}" ends on the default`);
    for (const r of route.slice(0, -1)) {
      assert.notEqual(engineKeyForModel(r.model), "auto", `${r.model} (a rung of "${key}") is unknown to engine-delivery.ts — it would be refunded`);
      assert.equal(surchargeShortfall(key, r.model), 0, `${r.model} is the engine "${key}" paid for`);
    }
    if (!falOn) assert.ok(route.every((r) => r.host === "replicate"), `"${key}": no fal without a key`);
  }
});

test("THE BUG: Seedance 2.5 delivered is Seedance 2.5 paid for, on either host", () => {
  assert.equal(engineKeyForModel("bytedance/seedance-2.5/image-to-video"), "seedance");
  assert.equal(engineKeyForModel("bytedance/seedance-2.5"), "seedance");
  assert.equal(surchargeShortfall("seedance", "bytedance/seedance-2.5/image-to-video"), 0);
  assert.equal(surchargeShortfall("seedance", "bytedance/seedance-2.5"), 0);
  // and the free default is still a downgrade that is refunded
  assert.equal(surchargeShortfall("seedance", DEFAULT_ANIMATE_MODEL), 75);
});

test("the routes, rung by rung — Seedance 2.5 goes to Replicate first, every other engine as before", () => {
  const R = (model: string) => ({ host: "replicate", model });
  const F = (model: string) => ({ host: "fal", model });
  const D = R(DEFAULT_ANIMATE_MODEL);
  assert.deepEqual(animateRoute(undefined, true), [F(DEFAULT_FAL_ANIMATE_MODEL), D]);
  assert.deepEqual(animateRoute("kling", true), [F(DEFAULT_FAL_ANIMATE_MODEL), D]);
  assert.deepEqual(animateRoute(SOUND_ENGINE_KEY, true), [F(SOUND_FAL_ANIMATE_MODEL), F(DEFAULT_FAL_ANIMATE_MODEL), D]);
  assert.deepEqual(animateRoute("kling26", true), [F("fal-ai/kling-video/v2.6/pro/image-to-video"), R("kwaivgi/kling-v2.6"), D]);
  assert.deepEqual(animateRoute("kling25fal", true), [F("fal-ai/kling-video/v2.5-turbo/pro/image-to-video"), D]);
  assert.deepEqual(animateRoute("veo31", true), [F("fal-ai/veo3.1/fast/image-to-video"), D]);
  assert.deepEqual(animateRoute("veo", true), [R("google/veo-3.1-fast"), D]);
  assert.deepEqual(animateRoute("hailuo", true), [R("minimax/hailuo-02"), D]);
  assert.deepEqual(animateRoute("kling25", true), [D]);
  // Replicate's Seedance 2.5 is $0.2312 a second at 720p, fal's about $0.473 (both pages read 2026-11-24):
  // Replicate first, fal second, then the older Seedance, then the default
  assert.deepEqual(animateRoute("seedance", true), [R("bytedance/seedance-2.5"), F("bytedance/seedance-2.5/image-to-video"), R("bytedance/seedance-1-pro"), D]);
  assert.deepEqual(animateRoute("seedance", false), [R("bytedance/seedance-2.5"), R("bytedance/seedance-1-pro"), D]);
  // without a fal key every route is its Replicate rungs alone
  assert.deepEqual(animateRoute(undefined, false), [D]);
  assert.deepEqual(animateRoute("kling26", false), [R("kwaivgi/kling-v2.6"), D]);
  // "auto" as a word has no fal case — it renders on the Replicate default (reported to the owner, not changed:
  // which model a format renders on is his call)
  assert.deepEqual(animateRoute("auto", true), [D]);
});

test("the retired Replicate slugs are gone from every engine table, and their keys with them", () => {
  const dead = ["kwaivgi/kling-v2.6-pro", "google/veo-3-fast", "kwaivgi/kling-v2.1-master", "kwaivgi/kling-v1.6-standard"];
  for (const key of [...KEYS, "kling21", "kling16"]) {
    for (const r of animateRoute(key, true)) assert.ok(!dead.includes(r.model), `${r.model} is dead`);
  }
  // nothing in the motion code names one (engine-delivery.ts keeps them only to read old records by)
  for (const f of ["animate-engines.ts", "ugc-ad-pipeline.server.ts", "video-generation.server.ts", "commercial-ad-pipeline.server.ts", "music-video-pipeline.server.ts", "fal-video-body.ts"]) {
    const src = read("app", "lib", f);
    for (const d of dead) assert.ok(!src.includes(`"${d}"`), `${f} still calls ${d}`);
  }
  // "kling21" / "kling16" were never picker keys and nothing passes them: a key nobody can send is gone
  assert.ok(!VIDEO_ENGINES.some((e) => e.key === "kling21" || e.key === "kling16"));
  assert.equal(animateModelFor("kling21"), DEFAULT_ANIMATE_MODEL);
  assert.equal(animateModelFor("kling16"), DEFAULT_ANIMATE_MODEL);
});

const opts = { startImage: "https://x.test/renders/seed.jpg", prompt: "a hero shot" };

/* Replicate's published input schemas, read 2026-11-24 (llms.txt + the model page's schema). */
const REP_SCHEMAS: Record<string, { fields: string[]; durations?: number[]; sound?: boolean; enums?: Record<string, string[]> }> = {
  "kwaivgi/kling-v2.5-turbo-pro": { fields: ["prompt", "negative_prompt", "start_image", "end_image", "aspect_ratio", "duration"], durations: [5, 10] },
  "kwaivgi/kling-v2.6": { fields: ["prompt", "negative_prompt", "start_image", "aspect_ratio", "duration", "generate_audio"], durations: [5, 10], sound: true },
  "google/veo-3.1-fast": { fields: ["prompt", "aspect_ratio", "duration", "image", "last_frame", "negative_prompt", "resolution", "generate_audio", "seed"], durations: [4, 6, 8], sound: true, enums: { aspect_ratio: ["16:9", "9:16"] } },
  "bytedance/seedance-2.5": { fields: ["prompt", "image", "last_frame_image", "reference_images", "reference_videos", "reference_audios", "duration", "resolution", "aspect_ratio", "generate_audio", "watermark", "output_format", "seed"], durations: Array.from({ length: 27 }, (_, i) => i + 4), sound: true, enums: { resolution: ["480p", "720p"], aspect_ratio: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"] } },
  "bytedance/seedance-1-pro": { fields: ["prompt", "image", "last_frame_image", "duration", "resolution", "aspect_ratio", "fps", "camera_fixed", "seed"], durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  // "10 seconds is only available for 768p resolution" — its default resolution is 1080p
  "minimax/hailuo-02": { fields: ["prompt", "first_frame_image", "last_frame_image", "duration", "resolution", "prompt_optimizer"], durations: [6, 10], enums: { resolution: ["512p", "768p", "1080p"] } },
};

test("every Replicate engine on a route is asked only for fields its schema has, at a length it makes, its sound said out loud", () => {
  const models = new Set<string>();
  for (const key of KEYS) for (const r of animateRoute(key, true)) if (r.host === "replicate") models.add(r.model);
  for (const m of models) assert.ok(REP_SCHEMAS[m], `${m} is on a route but its schema is not checked here`);
  const asks = [{}, { generateAudio: true, durationSec: 10 }, { generateAudio: true, durationSec: 15, aspect: "16:9" }, { durationSec: 7.6, negativePrompt: "x" }];
  for (const [model, s] of Object.entries(REP_SCHEMAS)) for (const a of asks) {
    const o = { ...opts, ...a };
    const body = animateInputFor(model, o);
    for (const k of Object.keys(body)) assert.ok(s.fields.includes(k), `${model}: "${k}" is not in its schema`);
    // (Veo is never sent a length: it makes its own eight seconds, as it always has)
    if (s.durations && "duration" in body) assert.ok(s.durations.includes(body.duration as number), `${model}: ${body.duration} is not a length it makes`);
    for (const [f, allowed] of Object.entries(s.enums || {})) if (f in body) assert.ok(allowed.includes(String(body[f])), `${model}: ${f} ${body[f]}`);
    if (s.sound) assert.equal(body.generate_audio, o.generateAudio === true, `${model}: sound only when asked, and always said`);
    else assert.ok(!("generate_audio" in body), `${model} is not sent a sound flag`);
  }
});

test("each Replicate body, exactly", () => {
  // Kling 2.6 on Replicate (its page: "Kling 2.6 Pro"): generate_audio DEFAULTS TO TRUE — $0.14 a second
  // with sound, $0.07 silent — so a Commercial falling back here says no by name
  assert.deepEqual(animateInputFor("kwaivgi/kling-v2.6", { ...opts, negativePrompt: "blur" }), { start_image: opts.startImage, prompt: "a hero shot", negative_prompt: "blur", duration: 5, generate_audio: false });
  // Veo 3.1 Fast: vertical unless asked wide (its default is 16:9); sound only for a pipeline that ships it
  assert.deepEqual(animateInputFor("google/veo-3.1-fast", { ...opts, negativePrompt: "blur" }), { prompt: "a hero shot", image: opts.startImage, aspect_ratio: "9:16", generate_audio: false, negative_prompt: "blur" });
  assert.equal(animateInputFor("google/veo-3.1-fast", { ...opts, aspect: "16:9", generateAudio: true }).aspect_ratio, "16:9");
  // Seedance 2.5: the same output as fal's copy — 720p, the caller's seconds, the seed's shape ("adaptive" is
  // Replicate's word for fal's "auto": left out, its aspect_ratio would be 16:9)
  assert.deepEqual(animateInputFor("bytedance/seedance-2.5", { ...opts, durationSec: 10, generateAudio: true }), { prompt: "a hero shot", image: opts.startImage, duration: 10, resolution: "720p", aspect_ratio: "adaptive", generate_audio: true });
  assert.equal(animateInputFor("bytedance/seedance-2.5", opts).duration, 5);
  assert.equal(animateInputFor("bytedance/seedance-2.5", opts).generate_audio, false);
  // the default and the older Seedance: exactly as before
  assert.deepEqual(animateInputFor(DEFAULT_ANIMATE_MODEL, { ...opts, durationSec: 10 }), { start_image: opts.startImage, prompt: "a hero shot", negative_prompt: "object disappearing, product vanishing, flickering, fading in and out, morphing, distortion, extra objects, text, watermark, blur", duration: 10 });
  assert.deepEqual(animateInputFor("bytedance/seedance-1-pro", opts), { prompt: "a hero shot", image: opts.startImage, duration: 10, resolution: "720p" });
  // Hailuo 2: ten seconds exist only at 768p (its default, 1080p, makes six) — the owner's pick, 2026-11-24: "768p"
  assert.deepEqual(animateInputFor("minimax/hailuo-02", opts), { prompt: "a hero shot", first_frame_image: opts.startImage, duration: 10, resolution: "768p" });
  for (const a of [{}, { durationSec: 6 }, { durationSec: 15, aspect: "16:9" }]) {
    const b = animateInputFor("minimax/hailuo-02", { ...opts, ...a });
    assert.ok(!(b.duration === 10 && b.resolution !== "768p"), "never ten seconds at a resolution that has no ten seconds");
  }
});

test("the talking ad's last resort is a live model, no dearer than the one that died", () => {
  // kwaivgi/kling-v1.6-standard: 404 on 2026-11-24, $0.05 a second (its page as archived 2026-07-15).
  // Seedance 1 Lite: $0.036 a second at 720p (replicate.com/bytedance/seedance-1-lite, read 2026-11-24);
  // its schema: image, prompt, an integer duration (4–12), resolution — no negative_prompt, no cfg_scale.
  assert.equal(VOICEOVER_MOTION_MODEL, "bytedance/seedance-1-lite");
  assert.deepEqual(voiceoverMotionInput("data:image/jpeg;base64,AAA", "p"), { image: "data:image/jpeg;base64,AAA", prompt: "p", duration: 10, resolution: "720p" });
  const ugc = read("app", "lib", "ugc-ad-pipeline.server.ts");
  assert.ok(ugc.includes("const klingId = await repCreate(VOICEOVER_MOTION_MODEL, voiceoverMotionInput("));
  // the clip is still recorded and resumed as the silent voiceover clip it is
  assert.ok(ugc.includes("engine = \"kling-voiceover\";\n      await ckpt({ ckEngine: engine }); // written BEFORE the create — see above"));
  assert.ok(ugc.includes("await ckpt({ ckKlingId: klingId }); // DISTINCT from ckOmniId — silent clip"));
  assert.ok(ugc.includes("lipSynced: engine === \"omni-human\" || engine === \"heygen-fal\","));
});

test("the adapter walks the route and throws only the last rung's refusal", () => {
  const ugc = read("app", "lib", "ugc-ad-pipeline.server.ts");
  const fn = ugc.slice(ugc.indexOf("export async function animateCreate("), ugc.indexOf("/** A poll that can't read the prediction is NOT a failed prediction."));
  assert.ok(fn.includes("const route = animateRoute(engineKey, falEnabled());"));
  assert.ok(fn.includes("if (i === route.length - 1) throw e;"));
  assert.ok(fn.includes("return { id: `${FAL_ID}${model}|${rid}`, model };"), "a fal id still carries its provider, so resume polls the right host");
  // the engine tables are not kept in two places
  for (const name of ["function falAnimateModelFor", "function animateModelFor", "function animateInputFor"]) assert.ok(!ugc.includes(name), `${name} lives in animate-engines.ts only`);
});
