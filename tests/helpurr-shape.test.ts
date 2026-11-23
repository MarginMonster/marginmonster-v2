/* A PICTURE ASKED FOR "WIDE" IS MADE WIDE.
 *
 * 2026-11-23, asked through Helpurr as a customer: "a cozy bookshop window on a rainy evening, warm light
 * inside, wide shot". The picture was good — and square. The chat's make tool had no way to say a shape at
 * all, though the Studio's own "Make an image" offers four. Helpurr can now say one, in the words people
 * use, and it reaches the same generator the Studio's frame picker feeds. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CREATE_ASPECT_VALUES, DEFAULT_CREATE_ASPECT, aspectForShape } from "../app/lib/create-models.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("a shape, as people say it, is one of the frames the Studio offers — or nothing", () => {
  assert.equal(aspectForShape("wide"), "16:9");
  assert.equal(aspectForShape("Landscape"), "16:9");
  assert.equal(aspectForShape("banner"), "16:9");
  assert.equal(aspectForShape("tall"), "9:16");
  assert.equal(aspectForShape(" vertical "), "9:16");
  assert.equal(aspectForShape("story"), "9:16");
  assert.equal(aspectForShape("phone"), "9:16");
  assert.equal(aspectForShape("portrait"), "4:5");
  assert.equal(aspectForShape("square"), "1:1");
  // a frame value is itself — the confirm button sends back what the tool prepared
  for (const v of CREATE_ASPECT_VALUES) assert.equal(aspectForShape(v), v);
  // anything else is no shape at all: the default is used, never an invented frame
  for (const junk of ["", "huge", "21:9", "16x9", null, undefined, 3, {}]) assert.equal(aspectForShape(junk), undefined, String(junk));
  // every answer is a frame the generator's own picker has
  for (const said of ["wide", "tall", "portrait", "square", "landscape", "vertical", "story", "phone", "banner"]) {
    assert.ok(CREATE_ASPECT_VALUES.includes(aspectForShape(said)!), said);
  }
  assert.equal(DEFAULT_CREATE_ASPECT, "1:1");
});

test("Helpurr's make tool can name the shape, and it reaches the job — paid and free alike", () => {
  const buddy = read("app", "routes", "api.buddy.tsx");
  assert.ok(buddy.includes('shape: { type: "string", enum: ["square", "portrait", "tall", "wide"], description: "create ONLY: the picture\'s shape.'));
  // prepared (the confirm button's spec carries it)…
  assert.ok(buddy.includes("const aspect = aspectForShape(input.shape);"));
  assert.ok(buddy.includes('const make: MakeSpec = { kind: "create", product: "", topic: prompt, presenter: false, direction: prompt, cost, ...(aspect ? { aspect } : {}), label };'));
  assert.ok(buddy.includes("const freeAspect = aspectForShape(input.shape);"));
  // …and made: validated AGAIN on the way in (the spec comes back from the browser), then handed to the generator
  assert.ok(buddy.includes("const createAspect = aspectForShape(spec.aspect); // only a shape the Studio itself offers"));
  assert.ok(buddy.includes("createImage: true, createPrompt: prompt, section: \"creator\",\n          ...(createAspect ? { createAspect } : {}),"));
  assert.ok(buddy.includes("const freeAspect = aspectForShape(spec.aspect);"));
  assert.ok(buddy.includes('...(freeAspect ? { createAspect: freeAspect } : {}), productTitle: prompt.slice(0, 60), prePaid: true, chargedTokens: 0, freeGen: true'));
  // the generator reads the same field the Studio's frame picker writes
  assert.ok(read("app", "lib", "job-queue.server.ts").includes('aspectRatio: typeof payload.createAspect === "string" ? payload.createAspect : undefined,'));
  assert.ok(read("app", "routes", "web.studio.tsx").includes('<input type="hidden" name="createAspect" value={createAspect} />'));
});
