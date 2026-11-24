/* A PICTURE EDIT IS ASKED ITS FRAME IN THE FIELD ITS ENGINE HAS.
 *
 * Found 2026-11-24: the compose engine and the Commercial's keyframe and brand-still edits sent nano-banana-pro/edit
 * Seedream's fields — `image_size` ("portrait_4_3", "portrait_16_9", "square_hd") and `max_images` — which its
 * schema (fal, read that day) does not have. fal ignored them, so every one of those pictures came back at the
 * engine's DEFAULT frame, "auto". Finished ads are made at that frame, so it is KEPT, by name; the frame each
 * caller meant is recorded (MEANT_FRAME) for the owner to turn on. Seedream, still reachable through COMPOSE_MODEL
 * for the harness's engine A/B, is sent exactly what it was sent before. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEANT_FRAME, editCountFields, editFrameFields, isNanoBanana } from "../app/lib/edit-frame.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

/* fal's nano-banana-pro/edit input schema, read 2026-11-24 (https://fal.ai/api/openapi/queue/openapi.json?
 * endpoint_id=fal-ai/nano-banana-pro/edit): the fields a compose sends must be among these. */
const NBP_EDIT_FIELDS = ["system_prompt", "history", "top_p", "return_history", "aspect_ratio", "num_images", "include_thoughts", "max_output_tokens", "resolution", "context", "seed", "temperature", "prompt", "safety_tolerance", "limit_generations", "sync_mode", "output_format", "thinking_level", "image_urls", "enable_web_search"];
const NBP_ASPECTS = ["auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16", "4:1", "1:4", "8:1", "1:8"];

test("nano-banana is asked its frame by aspect_ratio — its own default, by name — and nothing its schema lacks", () => {
  for (const m of ["fal-ai/nano-banana-pro/edit", "fal-ai/nano-banana/edit", "fal-ai/nano-banana-pro"]) {
    assert.ok(isNanoBanana(m), m);
    for (const meant of ["portrait_4_3", "portrait_16_9", "square_hd"] as const) {
      const f = { ...editFrameFields(m, meant), ...editCountFields(m, 2) };
      assert.deepEqual(f, { aspect_ratio: "auto", num_images: 2 }, `${m} ${meant}`);
      for (const k of Object.keys(f)) assert.ok(NBP_EDIT_FIELDS.includes(k), `${k} is not in nano-banana-pro/edit's schema`);
      assert.ok(NBP_ASPECTS.includes(String(f.aspect_ratio)));
    }
  }
});

test("Seedream (the harness can still swap it in) keeps exactly the fields it was sent", () => {
  const m = "fal-ai/bytedance/seedream/v4/edit";
  assert.ok(!isNanoBanana(m));
  assert.deepEqual({ ...editFrameFields(m, "portrait_4_3"), ...editCountFields(m, 2) }, { image_size: "portrait_4_3", num_images: 2, max_images: 2 });
});

test("what each caller meant is on record for the owner — and not yet asked for", () => {
  assert.deepEqual(MEANT_FRAME, { portrait_4_3: "3:4", portrait_16_9: "9:16", square_hd: "1:1" });
  const fal = read("app", "lib", "fal-image.server.ts");
  assert.ok(fal.includes("...editFrameFields(model, \"portrait_4_3\"),"));
  assert.ok(fal.includes("...editCountFields(model, numImages),"));
  assert.ok(fal.includes("const submit = await fetch(`https://queue.fal.run/${model}`, {"), "the fields are chosen for the engine that is called");
  const com = read("app", "lib", "commercial-ad-pipeline.server.ts");
  assert.ok(com.includes("...editFrameFields(model, \"portrait_16_9\"),"), "a Commercial keyframe");
  assert.ok(com.includes("...editFrameFields(model, portrait ? \"portrait_4_3\" : \"square_hd\"),"), "a brand still edit (forged portraits)");
  // no bare Seedream field is left to be ignored
  for (const src of [fal, com]) {
    assert.ok(!/\bimage_size:/.test(src), "image_size only through editFrameFields");
    assert.ok(!/\bmax_images:/.test(src), "max_images only through editCountFields");
  }
  // the text-to-image calls already used the field their schema has, and still do
  assert.equal(com.split("aspect_ratio: \"9:16\",").length - 1, 2, "the service opener and the end-card");
});
