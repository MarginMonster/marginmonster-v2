/* THE PLACE REMEMBERS, IN THE FILM (2026-11-25, stream S12) — film-dialogue.server.ts: the wiring a test cannot run (it
 * calls the picture editors and the video engine), pinned to its source. What the words are is held in
 * tests/place-state.test.ts and tests/place-state-reveal.test.ts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const eng = read("app/lib/film-dialogue.server.ts");
const loopAt = eng.indexOf("for (let i = clips.length; i < treatment.scenes.length; i++) {");

test("what each scene does to its place is read off its own words, for a staged two-hander only", () => {
  assert.ok(eng.includes("const placeOn = staged && !cartoon && isTwoHander;"), "never a cartoon; a film that is not staged or not a two-hander is made as it was");
  // (a copy of an earlier scene in the same place does nothing — sceneEvent — and the state is since the film came there)
  assert.ok(eng.includes("const changeWords = scenesArr.map((_, j) => sceneEvent("));
  assert.ok(eng.includes("const stateAt = (i: number): PlaceState | null => (placeOn ? placeStateAt(placeScenes, i, (j) => j >= arrivedAt(i) && locKeyAt(j) === locKeyAt(i)) : null);"));
});

test("the picture of a change: an edit of the shot's OWN start picture, looked at, checkpointed and read back after a restart", () => {
  const at = eng.indexOf("const placeChange = placeOn && !revealed && !approvedFrames[i] ? changeAt(i) : null;");
  assert.ok(at > loopAt && at > eng.indexOf("if (!seedAbs) throw new Error(`[testmovie] scene ${i + 1}: no seed frame`);", loopAt), "after the shot's seed is settled — whatever seeds it");
  assert.ok(eng.includes("const changing = !!placeChange && changesState(placeBefore, placeChange);"), "only what is not already so");
  // nano-banana-pro, then Seedream 4.5, on the shot's own start picture (flux-kontext-pro left the door open: not asked)
  const pro = eng.indexOf("[\"google/nano-banana-pro\", { prompt: ask, image_input: [seedAbs], aspect_ratio: aspect, output_format: \"jpg\", resolution: \"2K\" }],", at);
  const sd = eng.indexOf("[\"bytedance/seedream-4.5\", { prompt: ask, image_input: [seedAbs], aspect_ratio: aspect, size: \"2K\", max_images: 1 }],", at);
  assert.ok(pro > at && sd > pro);
  const block = eng.slice(at, eng.indexOf("// Does this shot CONTINUE the last one", at));
  assert.ok(!block.includes("flux-kontext-pro"), "the editor that left the door open is not asked");
  assert.ok(block.includes("pic = drawn ? (await clothedOrDropped(drawn, aspect)) || \"\" : \"\";"), "looked at like every film picture");
  assert.ok(block.includes("kept: stateNow(stateApart(placeBefore, placeChange))"), "told what was already done there, and that it stays");
  // checkpointed the moment it is drawn, and a restart takes it back (never drawn twice) — the same words, still on disk
  assert.ok(block.includes("let pic = changes[i]?.url && changes[i].words === words ? changes[i].url : \"\";"));
  assert.ok(block.includes("await ckpt({ ckChanges: JSON.stringify(changes) });"));
  assert.ok(eng.includes("const r = JSON.parse(resume.ckChanges ?? (await keptOnJob(\"ckChanges\")) ?? \"null\");") && eng.includes("if (v && typeof v.url === \"string\" && onDisk(v.url)) changes[Number(k)] = {"));
  assert.ok(eng.includes("/** each picture of a change done to a place (below — S12) — read from the job's own row when the worker does not hand it over */ ckChanges?: string;"));
  // a picture that will not come leaves the shot as it is made today
  assert.ok(block.includes("else console.error(`[testmovie] shot ${i + 1}: the picture of what it does to its place did not come — the shot is made as it always was`);"));
});

test("the shot ENDS on it: the end frame threads to both Kling hosts, is kept with the shot, and a re-roll ends on it again", () => {
  assert.ok(eng.includes("if (pic) { endImage = abs(pic);"));
  assert.ok(eng.includes("const clipUrl = await dialogueClip(dialogueEngine, seedAbs, prompt, `testmovie-${i}`, clipSecs, aspect, undefined, alive, endImage);"));
  const kling = eng.slice(eng.indexOf("async function klingDialogueClip("), eng.indexOf("async function dialogueClip("));
  assert.ok(kling.includes("endImage?: string): Promise<string> {"));
  assert.ok(kling.includes("repCreate(REP_KLING3, { prompt, start_image: seedAbs, ...(endImage ? { end_image: endImage } : {}), generate_audio: true, duration: dur, mode: \"pro\" })"), "Replicate's own field, read from its schema");
  assert.ok(kling.includes("falVideoSubmit(model, { startImage: seedAbs, prompt, generateAudio: true, durationSec: dur, ...(endImage ? { endImage } : {}) })"), "fal: only the O3 bodies send it (fal-video-body.ts)");
  // what the shot was keeps it — the checkpoint and the piece — and the editor's re-roll takes it
  assert.ok(eng.includes("/** the frame it ENDS on — the picture of what it did to its place (S12) */ end?: string };"));
  assert.ok(eng.includes("const shotEnds: (string | null)[] = clips.map((_, i) => kept[i]?.end || null);"));
  assert.ok(eng.includes("...(shotEnds[i] ? { end: shotEnds[i] as string } : {}),"));
  assert.ok(eng.includes("shotStaged.push(chainStaging); shotEnds.push(endImage || null);"));
  assert.ok(eng.includes("end: shotEnds[i] || undefined,"), "on the piece's shots");
  const regen = eng.slice(eng.indexOf("export async function renderDialogueClipTo("), eng.indexOf("async function heardWords("));
  assert.ok(regen.includes("opts: { last?: boolean; endImage?: string } = {}") && regen.includes("await dialogueClip(engine, seedAbs, prompt, stage, durSec, aspect, host, undefined, opts.endImage);"));
  // its tail — where the change is done — is kept, by the first take and by a re-roll alike (read off its prompt)
  assert.equal(eng.split("keepTail: clipEndsOnChange(prompt)").length - 1, 2);
  assert.ok(eng.includes("if (opts.keepTail) return t.path;"));
});

test("the place as it now is: every later picture there grows out of the change, and every later clip is told it stays", () => {
  // shownAt — the latest of the sightings AND the changes drawn there since the film came to the place
  assert.ok(eng.includes("const shownAt = (i: number): string => { for (let j = i - 1; j >= arrivedAt(i); j--) { if (changes[j]?.url) return changes[j].url; if (sightings[j]?.url) return sightings[j].url; } return \"\"; };"));
  // …so a re-anchor, a new angle, a sighting and THE REVEAL grow out of it (the reveal used the pristine master)
  assert.ok(eng.includes("const revealBase = abs(shownAt(i) || master.url);"));
  assert.ok(!eng.includes("image_input: [abs(master.url)") && !eng.includes("input_image: abs(master.url)"), "no editor is handed the pristine master any more");
  assert.equal(eng.split("abs(shownAt(i) || master.url)!, [faceFor(spkA), faceFor(spkB)]").length - 1, 2);
  assert.ok(eng.includes("const keptSo = placeNow ? ` The place as it is when this moment begins: ${placeNow}` : \"\";"));
  // the clip: where it ends, and what stays — in the camera-and-sound rules the prompt builder keeps whole
  assert.ok(eng.includes("const placeLines = placeOn ? [changing ? changeEndLine(placeChange) : \"\", stateLine(placeBefore, changeAt(i))].filter(Boolean).join(\" \") : \"\";"));
  assert.ok(eng.includes("if (placeLines) playRules = { ...playRules, steady: `${playRules.steady} ${placeLines}` };"));
  assert.ok(eng.indexOf("if (placeLines) playRules") < eng.indexOf("const fitted = fitClipPrompt({ voice: silent ? NOBODY_SPEAKS : voiceLine, voiceDesc: silent ? \"\" : voiceDesc, ...playRules });"), "said before the prompt is fitted");
  // the reveal at the cloth, the sighting as a shadow — while the tent is shut
  assert.ok(eng.includes("const cloth = placeOn && (clothPlace(whereAt[i], eventAt(i)) || shutCloth(placeBefore));"));
  assert.ok(eng.includes("const sightShadow = placeOn && shutCloth(placeBefore);") && eng.includes("const ref = theThing && !sightShadow ? thingRef() : null;"));
  // the piece says which shots changed their place
  assert.ok(eng.includes("...(Object.keys(changes).length ? { changes: Object.keys(changes).map(Number).sort((a, b) => a - b) } : {}),"));
});
