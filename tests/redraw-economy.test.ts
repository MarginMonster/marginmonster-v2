/* A TOLD STORY'S PICTURES: STOP PAYING FOR REDRAWS THE CHECKS GET WRONG (2026-11-26).
 *
 * Read off Render's own log for a day of live told TEST stories (2026-11-25 04:00Z → 2026-11-26 03:40Z: eleven made in
 * one press, 59 scenes — tests/redraw-day.json, each go's faults as the log printed them): 122 scene pictures, 2.07 a
 * scene. "Stared into the lens" was called on 58 goes and "the place came out run-down" on 29; the rejected and the kept
 * goes of two of the stories ("Circling in the Dark", "The Warmth by the Oven") were saved from the picture model's own
 * record while it still held them and LOOKED at: of their eleven stares two were stares, and none of their six run-down
 * calls was anything but the old roller rink the story was set in. So:
 *   · the run-down look counts only where no words of the story ask for a worn place (story-picture.ts → wornAsked);
 *   · a stare counts only where the shot is not facing us — never in a WALKING, an OVER THE SHOULDER or a WIDE, nor where
 *     the scene's words have them look our way (story-picture.ts → stareCounts);
 *   · a story's redraws are capped at half its scenes, rounded up — a stare or a worn place from half of it; a hard fault
 *     is never refused, and counted (story-picture.ts → redrawCap, faultTier, spendRedraw — review of S14b);
 *   · a band a crop puts right, with nothing else wrong, is covered at once and never drawn again (coverNow).
 * Replayed through these rules the same day draws 82 pictures, 1.39 a scene. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type FrameBand } from "../app/lib/full-frame.ts";
import {
  EYES_FIRST, coverNow, faultTier, redrawCap, redrawPurse, spendRedraw, stareCounts, storyExtrasPrompt, storyFaults, wornAsked, wornPlaces, wornSaid,
  type StoryCheck,
} from "../app/lib/story-picture.ts";
import { sceneShot } from "../app/lib/story-shots.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => fs.readFileSync(path.join(here, "..", ...p), "utf8").replace(/\r\n/g, "\n");
type Scene = { v: string; c?: string; goes: string[][]; looked?: string };
type Story = { title: string; scenes: Scene[] };
const day = JSON.parse(read("tests", "redraw-day.json")) as { stories: Story[] };
const story = (t: string): Story => day.stories.find((s) => s.title.includes(t))!;
const wordsOf = (s: Story): string => s.scenes.map((x) => `${x.v} ${x.c || ""}`).join(" ");

test("the run-down look listens to the story: a worn place its words ask for is no fault — the ordinary home still is", () => {
  const rink = story("Circling in the Dark");
  // its own words: "The old roller rink had been closed for hours…"
  assert.equal(wornAsked(`${rink.scenes[0].v} ${rink.scenes[0].c}`, wordsOf(rink)), true);
  // …and the scenes after it, whose own words only say "the dark rink floor" — the story said the rink is old
  assert.equal(wornSaid(`${rink.scenes[2].v} ${rink.scenes[2].c}`), false, "its own words do not say it");
  assert.equal(wornAsked(`${rink.scenes[2].v} ${rink.scenes[2].c}`, wordsOf(rink)), true, "the story's do");
  assert.deepEqual(wornPlaces(wordsOf(rink)), ["rink", "floor"]);
  // the worn concrete pier, the ferry's worn plank deck, boot-prints in dust, the dusty velvet rope
  const ferry = story("Eleven Went Aboard");
  assert.equal(wornAsked(ferry.scenes[8].v, wordsOf(ferry)), true);
  assert.equal(wornAsked(ferry.scenes[7].v, wordsOf(ferry)), true, "…beside the pier");
  assert.deepEqual(wornPlaces("WIDE: the ferry's worn plank deck seen whole"), ["plank", "deck", "ferry"]);
  assert.equal(wornSaid(story("Two Sets of Footprints").scenes[0].v), true);
  assert.equal(wornSaid(story("The Hour It Arrives").scenes[2].v), true);
  // more ways a story says it
  assert.deepEqual(wornPlaces("The house was abandoned years ago"), ["house"]);
  assert.deepEqual(wornPlaces("an old low black wooden ferry with a wheelhouse"), ["ferry"]);
  assert.deepEqual(wornPlaces("a long-closed rink, dark"), ["rink"]);
  assert.equal(wornAsked("WIDE: the mill floor at night", "an old mill on the river"), true, "an old mill, named again");
  assert.deepEqual(wornPlaces("the boarded up house at the end of the lane"), ["house"], "worn words two words long");
  assert.equal(wornAsked("WIDE: the attic, boxes stacked", "she clears out her late mother's dusty attic"), true);
  assert.equal(wornAsked("WIDE: the kitchen", "the old kitchen, its peeling wallpaper"), true, "old AND peeling: worn");
  // NOT ASKED — what LIVED_IN was made for, and words that only look like it
  const hospital = story("The Dent in the Pillow");
  for (const s of hospital.scenes) assert.equal(wornAsked(s.v, wordsOf(hospital)), false, `a working hospital: ${s.v.slice(0, 40)}`);
  assert.equal(wornAsked("NEAR AND FAR: from inside the dark hallway, Nadia stands close to the camera at the edge of the frame", "two children home alone at night; a ghost lady at the glass"), false, "the ordinary home");
  assert.equal(wornAsked("WIDE: inside Room 14 …", "a working small-town hospital; room 14 has been unused for a year"), false, "unused for a while is still kept (LIVED_IN)");
  assert.equal(wornAsked("WIDE: inside the bakery, Fergus stands frozen in the doorway, and near it Imelda lies curled asleep in her worn green coat.", ""), false, "a worn coat is not a worn bakery");
  assert.equal(wornAsked("CLOSE: Ottavia's face, flour dust on her cheek", ""), false, "flour dust");
  assert.equal(wornAsked("CLOSE: the skater in a faded pastel roller-rink dress", ""), false, "a hyphened word is one word");
  assert.equal(wornAsked("WIDE: the living room, an old photo on the wall above the sofa", ""), false, "an old photo ON the wall is not an old wall");
  assert.equal(wornAsked("WIDE: the kitchen, spotless, no dust anywhere", ""), false, "said NOT to be");
  assert.equal(wornAsked("WIDE: the farmhouse kitchen at night", "an old man lives on the hill"), false, "an old man is not an old place");
  // LIVED_IN, read as a warm story's writer writes a home (review of S14b, 2026-11-26): an old HOME is a home its people live
  // in, not a dingy one — and dirt said of a person or a thing, or dust in the light, asks for no worn room
  assert.equal(wornAsked("WIDE: the farmhouse kitchen at night", "an old farmhouse on the hill"), false, "an old farmhouse is somebody's home");
  for (const [scene, story] of [
    ["WIDE: the living room of their old house, the family laughing", ""],
    ["WIDE: the old family farmhouse kitchen, warm and bright", ""],
    ["WIDE: the hallway at night, the two kids in pyjamas", "Two kids home alone in their grandmother's old house; a ghost lady at the glass"],
    ["WIDE: inside the house", "the house was old but loved, freshly painted"],
    ["WIDE: the kitchen, morning sun, dust motes drifting in the light", ""],
    ["WIDE: the bedroom, dusty sunlight through the curtains", ""],
    ["CLOSE: Grandma peeling apples at the kitchen table", ""],
    ["CLOSE: Tom wipes the grime from his face in the bathroom", ""],
    ["CLOSE: Ben's filthy hands at the kitchen sink", ""],
    ["WIDE: the bedroom, the rusty bike leaning by the window", ""],
    ["WIDE: the living room, the cake ruined on the floor", ""],
    ["WIDE: the kitchen at night, Lena alone", "Lena feels abandoned after her husband leaves"],
    ["WIDE: the house at night", "Their marriage is crumbling in the house they built together"],
    ["WIDE: the chapel, light through its stained glass windows", ""],
  ])assert.equal(wornAsked(scene, story), false, `${scene} / ${story}`);
  // …and the day's own: the words still answer 19 of its 29 run-down calls, as before this review
  let calls = 0, answered = 0;
  for (const s of day.stories) for (const sc of s.scenes) for (const go of sc.goes) if (go.includes("G")) { calls++; if (wornAsked(`${sc.v} ${sc.c || ""}`, wordsOf(s))) answered++; }
  assert.deepEqual([calls, answered], [29, 19]);
});

test("a stare counts only where the shot is not facing us — the cases read off the rejected pictures", () => {
  const rink = story("Circling in the Dark");
  const shotOf = (s: Scene) => sceneShot({ visual: s.v });
  // WALKING toward the camera: she faces us (three goes, the third looking well aside, all called stares)
  assert.equal(shotOf(rink.scenes[0]), "walk");
  assert.equal(stareCounts("walk", rink.scenes[0].v), false);
  // a close-up whose words have her look just past the camera's edge (two goes drawn exactly so)
  assert.equal(stareCounts(shotOf(rink.scenes[3]), rink.scenes[3].v), false);
  // NEAR AND FAR, a face near the lens staring down it while the moment is the skater far behind: STILL a fault (right twice)
  assert.equal(stareCounts(shotOf(rink.scenes[2]), rink.scenes[2].v), true);
  // OVER THE SHOULDER: Imelda looks up at HIM (three goes); WIDE: Fergus small in the doorway
  const oven = story("The Warmth by the Oven");
  assert.equal(stareCounts(shotOf(oven.scenes[3]), oven.scenes[3].v), false);
  assert.equal(stareCounts(shotOf(oven.scenes[1]), oven.scenes[1].v), false);
  // a plain close-up about something else is still looked at
  assert.equal(stareCounts("close", "CLOSE: Verity's face lit by the glow of the call-button panel, eyes fixed on one small red light"), true);
  assert.equal(stareCounts("two", "TOGETHER: Halina and Radek facing each other at the harbour dock"), true);
  assert.equal(stareCounts(null, "Inside the dark bedroom, Edvin stands at the window looking out"), true, "a scene with no shot: its words decide");
  for (const w of ["his gaze fixed past us toward the brass elevator doors", "she turns to face the camera", "looking straight at us", "the woman strides toward camera through shallow water"]) assert.equal(stareCounts("close", w), false, w);
  // the reader writes down where the eyes point before it answers — the question it was tuned with kept word for word
  const q = storyExtrasPrompt("CLOSE: Delphine's face, frozen mid-breath", ["Delphine: a night guard"]);
  assert.ok(q.includes(`look straight into the camera, eyes on the lens as if posing for a photograph? Somebody looking at something to one side of the camera, or seen from the side or from behind, does not. ${EYES_FIRST} `));
  assert.ok(EYES_FIRST.includes("only eyes that meet the lens itself count — eyes on something just beside the camera or past its edge, or a face turned even a little away, do not."));
  assert.ok(q.includes("\"eyes\": [\"whose face, and where its eyes point, in a few words — for each face you can see\"], \"intoLens\": [\"the name of each person looking straight into the camera — an empty list when nobody does\"]"));
});

const TALL = { w: 1536, h: 2752 };
const sliver: FrameBand = { sides: ["top"], doubled: [], box: { x: 0, y: 0.05, w: 1, h: 0.95 }, keeps: 0.95, frame: "tall", size: TALL };
const bakery: FrameBand = { sides: ["top", "bottom"], doubled: ["top"], box: { x: 0, y: 0.31, w: 1, h: 0.36 }, keeps: 0.36, frame: "tall", size: TALL };

test("the worst faults first: hard ones break the story or cannot be shown, a stare and a worn place are soft", () => {
  const clean: StoryCheck = { seen: [true], panels: false };
  assert.equal(faultTier(clean), "");
  assert.equal(faultTier(null), "");
  for (const hard of [{ unclothed: true }, { panels: true }, { inset: true }, { seen: [false] }, { twice: [true] }, { extra: true }, { outside: true }, { notNight: true }, { band: bakery }] as Array<Partial<StoryCheck>>) {
    assert.equal(faultTier({ ...clean, ...hard }), "hard", JSON.stringify(hard).slice(0, 40));
    assert.equal(faultTier({ ...clean, ...hard, lens: ["X"], grimy: true }), "hard", "hard whatever soft is with it");
  }
  assert.equal(faultTier({ ...clean, lens: ["Delphine"] }), "soft");
  assert.equal(faultTier({ ...clean, grimy: true }), "soft");
  assert.equal(faultTier({ ...clean, grimy: true, band: sliver }), "soft");
  // A BAND A CROP PUTS RIGHT, AND NOTHING ELSE: no redraw — covered now (it still weighs 1 among the goes, as S14 set it)
  assert.equal(faultTier({ ...clean, band: sliver }), "");
  assert.equal(storyFaults({ ...clean, band: sliver }), 1);
  assert.equal(coverNow({ ...clean, band: sliver }), true);
  assert.equal(coverNow({ ...clean, band: sliver, lens: ["X"] }), false, "a stare with it: drawn again while the purse lasts");
  assert.equal(coverNow({ ...clean, band: bakery }), false, "a band no crop puts right is drawn again");
  assert.equal(coverNow({ ...clean, band: { ...sliver, ground: true } }), false, "a picture on a sheet's ground is drawn again");
  assert.equal(coverNow(clean), false);
});

test("a story's redraws are capped at half its scenes — a stare or a worn place may spend only half of that; a hard fault is never refused", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 13, 32].map(redrawCap), [0, 1, 1, 2, 2, 3, 3, 7, 16]);
  // soft faults alone: at most 1.5 draws a scene (1.6 at five, 2 for one re-rolled scene)
  for (const n of [4, 5, 6, 13, 32]) assert.ok((n + redrawCap(n)) / n <= 1.6, String(n));
  const p = redrawPurse(5);
  assert.deepEqual(p, { cap: 3, soft: 2, spent: 0, spentSoft: 0 });
  assert.equal(spendRedraw(p, "soft"), true);
  assert.equal(spendRedraw(p, "soft"), true);
  assert.equal(spendRedraw(p, "soft"), false, "the soft half is spent");
  assert.equal(spendRedraw(p, "hard"), true, "…a hard fault is drawn again");
  // NEVER LET THROUGH TO SAVE MONEY (review of S14b): past the cap, somebody missing, bare, split or a stranger is still drawn again
  assert.equal(spendRedraw(p, "hard"), true, "past the cap: still drawn again");
  assert.equal(spendRedraw(p, "hard"), true);
  assert.deepEqual(p, { cap: 3, soft: 2, spent: 5, spentSoft: 2 }, "…and counted");
  assert.equal(spendRedraw(redrawPurse(5), ""), false, "nothing wrong: nothing to spend");
  // the hard faults' spending leaves less for the soft ones — the cap cuts the soft faults first
  const q = redrawPurse(4);
  assert.equal(spendRedraw(q, "hard") && spendRedraw(q, "hard"), true);
  assert.equal(spendRedraw(q, "soft"), false, "hard faults spent the cap: no stare is drawn again");
  assert.equal(spendRedraw(q, "hard"), true, "…a hard one still is");
  // one re-rolled scene (or two): one redraw for a soft fault — and a hard one after it is not refused
  const one = redrawPurse(1);
  assert.equal(spendRedraw(one, "soft"), true);
  assert.equal(spendRedraw(one, "soft"), false);
  assert.equal(spendRedraw(one, "hard"), true, "a stare spent the only redraw: a scene with somebody missing is still drawn again");
  const two = redrawPurse(2);
  assert.equal(spendRedraw(two, "hard"), true);
  assert.equal(spendRedraw(two, "soft"), false);
  // STORY_REDRAW_CAP=off: three goes a scene, as before
  assert.deepEqual(redrawPurse(5, false), { cap: 10, soft: 10, spent: 0, spentSoft: 0 });
});

/** The redraw loop's decisions over one story's logged goes, four scenes at a time (narrated-story.server.ts →
 *  narratedSceneSeeds): which go each scene keeps, and how many pictures it drew. `rules` false = as before. */
function replay(s: Story, rules: boolean): { draws: number; kept: number[]; counted: Record<string, number>; purse: ReturnType<typeof redrawPurse>; hardKept: number } {
  const words = wordsOf(s);
  const purse = redrawPurse(s.scenes.length, rules);
  const kept: number[] = new Array(s.scenes.length).fill(-1);
  const counted: Record<string, number> = {};
  // (a scene kept with a hard fault while it still had goes — what the budget must never do)
  let draws = 0, next = 0, hardKept = 0;
  const lanes: Array<{ i: number; a: number } | null> = [null, null, null, null];
  const take = (w: number) => { lanes[w] = next < s.scenes.length ? { i: next++, a: 0 } : null; };
  for (let w = 0; w < 4; w++) take(w);
  while (lanes.some(Boolean)) {
    for (let w = 0; w < 4; w++) {
      const job = lanes[w];
      if (!job) continue;
      const sc = s.scenes[job.i];
      draws++;
      const worn = wornAsked(`${sc.v} ${sc.c || ""}`, words), stare = stareCounts(sceneShot({ visual: sc.v }), sc.v);
      const f = (sc.goes[job.a] || []).map((x) => x.replace("*", "")).filter((x) => !rules || (x === "L" ? stare : x === "G" ? !worn : true));
      for (const x of f) counted[x] = (counted[x] || 0) + 1;
      const check: StoryCheck = { seen: [!f.includes("C")], panels: false, ...(f.includes("X") ? { extra: true } : {}), ...(f.includes("O") ? { outside: true } : {}), ...(f.includes("L") ? { lens: ["x"] } : {}), ...(f.includes("G") ? { grimy: true } : {}) };
      const tier = f.includes("B") ? "hard" : faultTier(check);
      if (tier && job.a < 2 && spendRedraw(purse, tier)) { job.a++; continue; }
      if (tier === "hard" && job.a < 2) hardKept++;
      kept[job.i] = job.a;
      take(w);
    }
  }
  return { draws, kept, counted, purse, hardKept };
}

test("the measured day, replayed: 122 pictures as it was, 82 with the checks that listen and the cap", () => {
  let before = 0, after = 0, scenes = 0;
  const was: Record<string, number> = {}, now: Record<string, number> = {};
  for (const s of day.stories) {
    const a = replay(s, false), b = replay(s, true);
    before += a.draws; after += b.draws; scenes += s.scenes.length;
    for (const [k, v] of Object.entries(a.counted)) was[k] = (was[k] || 0) + v;
    for (const [k, v] of Object.entries(b.counted)) now[k] = (now[k] || 0) + v;
    // (the soft faults within their half of the cap and within the cap; the hard ones never refused, every redraw a picture)
    assert.ok(b.purse.spentSoft <= b.purse.soft && b.purse.spentSoft <= b.purse.cap, `${s.title}: the soft faults within the cap`);
    assert.equal(b.hardKept, 0, `${s.title}: no hard fault kept while it had goes left`);
    assert.equal(b.draws, s.scenes.length + b.purse.spent, `${s.title}: every redraw counted`);
    assert.ok(b.kept.every((k) => k >= 0), `${s.title}: every scene keeps a picture`);
  }
  assert.equal(scenes, 59);
  assert.equal(before, 122, "as the log drew them (one go read from the next)");
  // (79 when the cap refused hard faults too — review of S14b: "The Dent in the Pillow" kept somebody missing to save 3)
  assert.equal(after, 82);
  assert.ok(after / scenes < 1.4);
  assert.equal(was.L, 58);
  assert.equal(was.G, 29);
  // the hard faults are all still drawn for, whatever the purse holds — a stranger, the looker outside, somebody missing
  // (fewer of them are SEEN: a go the old loop drew only for a stare is not drawn — the hardKept count above is the rule)
  assert.ok(now.C >= 7 && now.X >= 2 && now.O === 1, JSON.stringify(now));
  // THE PICTURES THAT WERE LOOKED AT: "Circling in the Dark" keeps its first walk at us, the second NEAR AND FAR — the
  // one with the skater behind her, the film's own — and the first "just past the camera's edge"; 5 pictures, not 10
  const rink = replay(story("Circling in the Dark"), true);
  assert.deepEqual(rink.kept, [0, 0, 1, 0]);
  assert.equal(rink.draws, 5);
  assert.equal(replay(story("Circling in the Dark"), false).draws, 10);
  // "The Warmth by the Oven": Imelda looking up at him over his shoulder, Fergus small in the doorway — each its first go
  assert.deepEqual(replay(story("The Warmth by the Oven"), true).kept, [0, 0, 0, 0, 0]);
});

test("wired: the loop listens to the story, spends from the story's purse, covers a sliver at once", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("import { coverNow, faultTier, redrawPurse, spendRedraw, stareCounts, wornAsked } from \"./story-picture\";"));
  const fn = nar.slice(nar.indexOf("export async function narratedSceneSeeds("), nar.indexOf("export async function recastStoryCharacter("));
  // one purse for this drawing of the story, shared by the four scenes drawn side by side
  assert.ok(fn.includes("const purse = redrawPurse(todo.length, process.env.STORY_REDRAW_CAP !== \"off\");"));
  assert.ok(fn.includes("const storyWords = [idea, ...scenes.map((s) => `${s?.visual || \"\"} ${s?.caption || \"\"}`), ...placeList].join(\" \");"));
  assert.ok(fn.indexOf("const purse = redrawPurse(") < fn.indexOf("const worker = async () => {"), "made once, before the workers");
  // the scene's own words and its place's, against the story's
  assert.ok(fn.includes("const wornHere = wornAsked(`${written} ${scene.caption || \"\"} ${setAt ? `${setAt.name}: ${setAt.look}` : \"\"}`, storyWords);"));
  assert.ok(fn.includes("const stareHere = stareCounts(cam, written);"));
  assert.ok(fn.includes("const grimy = tmpl.childSafe || wornHere ? null : parseStoryGrime(String(grimeRaw || \"\"));"));
  assert.ok(fn.includes("...(lens?.length && stareHere ? { lens } : {})"));
  // the decision after a faulted go: cover a sliver now, else spend — the worst first — else keep the best try
  const loop = fn.slice(fn.indexOf("for (let a = 0; a < 3 && !img; a++) {"), fn.indexOf("out[i] = img;"));
  assert.ok(loop.includes("const cover = coverNow(seenAs);\n        const tier = faultTier(seenAs);\n        const again = !cover && a < 2 && spendRedraw(purse, tier);"));
  assert.ok(loop.includes("if (!best || faults < best.faults) best = { img: got, faults, check: seenAs! };"), "the best try is still the one kept");
  assert.ok(loop.indexOf("if (!best || faults < best.faults)") < loop.indexOf("const again = !cover"), "the go is weighed before the purse is asked");
  assert.ok(loop.includes("— ${then}`);\n        if (!again) break;\n      }"), "past the purse the loop ends on its best try, and says so");
  assert.ok(loop.includes("\"a band a crop puts right, and nothing else — covered, not drawn again\""));
  assert.ok(loop.includes("the story's redraws for a stare or a worn place are spent (${purse.spent} of ${purse.cap} in all, ${purse.spentSoft} of ${purse.soft} on these) — keeping its best try"), "only a soft fault is ever refused");
  // …and the cover is the one after the goes (S14): a sliver kept as best is cut to its content there
  assert.ok(loop.indexOf("if (!again) break;") < loop.indexOf("if (!img && best?.check.band) {"));
  // a letterboxed picture and a framed panel are hard faults that spend too
  assert.ok(loop.includes("if (got && (await letterboxed(got))) { barred = got; const more = a < 2 && spendRedraw(purse, \"hard\");") && loop.includes("if (more) continue; break; }"));
  assert.ok(loop.includes("if (got && withPlace && (await framedPanel(got))) { framedGoes++; fix = FRAMED_FIX; const more = a < 2 && spendRedraw(purse, \"hard\");"));
  // what it spent: in the log, in what it hands back, and on the piece
  assert.ok(fn.includes("if (got) drawnPictures++;"));
  assert.ok(fn.includes("console.log(`[narrated] the pictures: ${todo.length} scene${todo.length === 1 ? \"\" : \"s\"}, ${drawnPictures} drawn (${(drawnPictures / todo.length).toFixed(2)} a scene), ${purse.spent} of ${purse.cap} redraws spent"));
  assert.ok(fn.includes("draws: { scenes: todo.length, pictures: drawnPictures, cap: purse.cap, spent: purse.spent } };"));
  assert.ok(nar.includes("pictureDraws = drawn.draws;") && nar.includes("...(pictureDraws ? { pictureDraws } : {}),"));
});
