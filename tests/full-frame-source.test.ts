/* A WIDE VIEW IN A TALL FRAME IS STILL A TALL PICTURE — stopped at the source (app/lib/story-shots.ts → frameShapeLine).
 *
 * 2026-11-26, "What His Hands Remember": "WIDE: inside the bakery, Humphrey stands small before the cast-iron oven…" in a
 * 9:16 story came back as a landscape of the bakery across the middle of the tall frame on an empty cream band. Test draws
 * of that scene's ask on the story's picture model (nano-banana-pro, 2K, the place's sheet and a portrait as references):
 * main's ask, 5 tries → 4 broken (an empty band above a cut-away room; the sheet's two views on its pale ground; a second
 * view stacked on top; a cut-away with plain ground above its walls) — with the frame's shape said, 5 → 1 (a band above a
 * cut-away) — with the frame's shape AND the place at full size said (story-picture.ts → PLACE_FULL_SIZE), 5 → 0. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STORY_SHOTS, TALL_FRAME_WIDE, WIDE_FRAME_TALL, cameraLine, frameShapeLine, shotListBrief } from "../app/lib/story-shots.ts";

test("a far view in a tall frame is told the frame is tall (and a full-height one in a wide frame, the other way)", () => {
  assert.equal(frameShapeLine("wide", "9:16"), TALL_FRAME_WIDE);
  assert.equal(frameShapeLine("depth", "9:16"), TALL_FRAME_WIDE);
  assert.ok(TALL_FRAME_WIDE.includes("composed for a TALL frame") && TALL_FRAME_WIDE.includes("never a wide picture inside a tall one"));
  assert.equal(frameShapeLine("close", "9:16"), "", "a face in a tall frame is a tall picture already");
  assert.equal(frameShapeLine("over", "9:16"), "");
  assert.equal(frameShapeLine("walk", "16:9"), WIDE_FRAME_TALL);
  assert.equal(frameShapeLine("low", "16:9"), WIDE_FRAME_TALL);
  assert.ok(WIDE_FRAME_TALL.includes("never a tall picture inside a wide one"));
  assert.equal(frameShapeLine("wide", "16:9"), "");
  assert.equal(frameShapeLine("wide", "1:1"), "");
  assert.equal(frameShapeLine(null, "9:16"), "");
  // the camera line: word for word as it was without a frame; the frame's shape after it when given one
  assert.equal(cameraLine("wide"), STORY_SHOTS.wide.camera);
  assert.equal(cameraLine("wide", "9:16"), `${STORY_SHOTS.wide.camera} ${TALL_FRAME_WIDE}`);
  assert.equal(cameraLine("close", "9:16"), STORY_SHOTS.close.camera);
  assert.equal(cameraLine(null, "9:16"), "");
});

test("the writer's WIDE line asks what fills the top and the bottom of the picture", () => {
  assert.ok(STORY_SHOTS.wide.write.startsWith("WIDE — the place is the picture: we see it whole, from far back, and whoever is in it is small in it (a quarter of the frame's height at most)"));
  assert.ok(STORY_SHOTS.wide.write.endsWith("; say what fills the TOP of the picture and what fills the BOTTOM (the ceiling and the floor, the sky and the ground)"));
  assert.ok(shotListBrief(["wide"]).includes("say what fills the TOP of the picture and what fills the BOTTOM"));
});
