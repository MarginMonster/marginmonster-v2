/* FOUND FOOTAGE, WIRED: the builder page (app/routes/web.found-footage.tsx), the queue's branch for a take
 * (app/lib/job-queue.server.ts) and the house camera's take (app/lib/house-take.server.ts).
 *
 * The owner, 2026-11-24: "make it easymode and selectable good UI interface" — "Found footage from house camera
 * POVs also" — "Found footage would need to remember rooms even when panning to other cams in the house" — and on
 * the first house cut: "he needs to walk into the room no time lapse, then time lapse".
 *
 * Held here: the page is the owner's alone until this tier has a name and a price; a take is queued as ONE job
 * that resumes where it stopped; a house take keeps the shop's house on its own record and starts from it; and
 * every word on the page can be translated.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (src: string, piece: string) => src.split(piece).length - 1;

test("the builder is the OWNER'S ALONE until the tier has a name and a price: the page does not exist for anybody else, and its action refuses", () => {
  const ui = read("app", "routes", "web.found-footage.tsx");
  const loader = ui.slice(ui.indexOf("export const loader"), ui.indexOf("export const action"));
  const action = ui.slice(ui.indexOf("export const action"), ui.indexOf("/** A camera card's screen"));
  assert.ok(loader.includes('if (!isAdminEmail(account.email)) throw new Response("Not found", { status: 404 });'));
  assert.ok(action.includes('if (!isAdminEmail(account.email)) return json({ error: "Not found" }, { status: 404 });'));
  assert.ok(action.indexOf("isAdminEmail") < action.indexOf("enqueueJob"), "the gate comes before anything is queued");
  // what is queued is what take.ts decided — the page sends choices, never a payload; whether a card's words were
  // changed is decided there too, in English and in the words the member was shown (their language)
  assert.ok(action.includes('const job = footageJob({ scare: form.get("scare"), own: form.get("own"), camera: form.get("camera"), aspect: form.get("aspect"), lapse: form.get("lapse"), ir: form.get("ir"), room: form.get("room") }, (s) => tr(lang, s));'));
  assert.ok(action.includes('await enqueueJob(shop.id, "GENERATE_VIDEO_AD", job.payload);'));
  // a plan with video, and never more than three takes in the making at once
  assert.ok(action.includes('capabilitiesFor(shop.activePlan).has("creatorvideo")'));
  assert.ok(action.includes("if (making >= 3)"));
  // not charged while it has no price: nothing is spent, so nothing has to be given back
  assert.ok(!/spendTokens|prePaid|chargedTokens/.test(ui));
});

test("ONE SCREEN: what happens — one box first, the cards its starters — the camera, the settings that apply, one button; the last tap wins and the button names the pair", () => {
  const ui = read("app", "routes", "web.found-footage.tsx");
  // the parts, in order — and the box is the first thing under "What happens?", above every card
  const at = ['{t("What happens?")}', '<textarea id="ff-own-in"', "{FOOTAGE_SHELVES.map((sh) => (", '{t("The camera")}', '{t("Scene settings")}', 'className={`ff-go'].map((m) => ui.indexOf(m));
  assert.ok(at.every((x, i) => x > 0 && (i === 0 || x > at[i - 1])), "in order");
  // ALWAYS THERE (the owner: "These found footage options leave zero room for creativity, it's just what happens"):
  // the box sits right under its heading, which is its label — never behind a button
  assert.ok(ui.includes('<h2 className="ff-lbl" id="ff-what"><span className="ff-n">1</span> <label htmlFor="ff-own-in">{t("What happens?")}</label></h2>\n        <textarea id="ff-own-in"'));
  assert.ok(ui.includes('placeholder={t("Write it your way — or tap a scare below to start from it")}'));
  assert.ok(ui.includes('{t("Write what happens, pick what it was shot on — we film it.")}'));
  // "Describe your own" is gone: the box is it
  for (const gone of ["Describe your own", "chooseScare(OWN_SCARE)", "ff-own-box", "isOwn", '"What happens")']) assert.ok(!ui.includes(gone), gone);
  // it opens with no card picked and the box empty — a link can still open it on a card, through the rules a tap obeys
  assert.ok(ui.includes('let p: FootagePick = { scare: OWN_SCARE, camera: "phone" };'));
  assert.ok(ui.includes('const [own, setOwn] = useState(() => { const s = footageScare(pick.scare); return s ? t(s.premise) : ""; });'));
  // EVERY CARD IS A STARTER: a tap picks it (the camera follows — take.ts → pickScare) and puts its own words in the box
  assert.ok(ui.includes("setPick((p) => pickScare(p, key, lastHand));\n      setOwn(t(s.premise));"));
  // whose take the words make is take.ts's question — cardUnchanged — and the server asks it again
  assert.ok(ui.includes("const edited = !!scare && !cardUnchanged(own, scare.premise, t);") && ui.includes("const written = !scare || edited;"));
  // the line under the box says which: the card's as it is, the member's version of it (with a way back), or their own
  for (const s of ['t("Ready-made. Change any words to make it yours.")', 't("Your version of “{name}”", { name: t(scare?.name || "") })', '{t("Undo")}', `t("Slow and still is what frightens. It never speaks — nobody's words are put in its mouth.")`]) assert.ok(ui.includes(s), s);
  assert.ok(ui.includes("const undo = () => { if (scare) setOwn(t(scare.premise)); };") && ui.includes('<span role="status">'));
  // THEIR WORDS ARE NEVER THROWN AWAY: the card being changed, tapped again, keeps them; a camera that cannot film that
  // card makes them their own idea; an emptied box picks no card
  assert.ok(ui.includes("if (!(pick.scare === key && edited)) {"));
  assert.ok(ui.includes("if (edited && !fits(pick.scare, cam)) { setPick({ scare: OWN_SCARE, camera: cam }); return; }"));
  assert.ok(ui.includes("if (!words.trim() && scare) setPick((p) => ({ ...p, scare: OWN_SCARE }));"));
  // …and a camera that brings another card with it (the last tap wins — take.ts → pickCamera) brings that card's words
  assert.ok(ui.includes("const next = pickCamera(pick, cam);") && ui.includes("if (s) { setOwn(t(s.premise));"));
  // the words go with the form whenever there are any — the server decides whose take they make
  assert.ok(ui.includes('{own.trim() ? <input type="hidden" name="own" value={own} /> : null}'));
  // PHONE-FIRST: the box grows with its words, at 16px (a phone never zooms in on it); a card tapped far below brings
  // the page up to the box, so its words are seen arriving
  assert.ok(ui.includes("el.style.height = `${el.scrollHeight + 3}px`;") && /\.ff-own-in\{[^}]*font-size:16px/.test(ui));
  // (measured again once the web font is in: measured before it, a card's last line was cut off — seen at 390 px)
  assert.ok(ui.includes("document.fonts?.ready.then(fit).catch(() => undefined);"));
  assert.ok(ui.includes('el.scrollIntoView({ block: "start", behavior:') && ui.includes("showBox();"));
  // every scare as a card ON ITS SHELF (the body cam has its own: a scare, and a police drama), every camera as a card
  assert.ok(ui.includes("{shelfScares(sh.family).map((s) => {") && ui.includes("{CAMERA_LOOKS.map((c) => {"));
  assert.ok(ui.includes('{s.genre === "drama" ? t("Drama") : t("Horror")}'));
  // settings only where they apply: the house's for the house camera, the shape for the two that can shoot either
  assert.ok(ui.includes("const settings = house || shapeChoosable(pick.camera);") && ui.includes("{settings && ("));
  for (const s of ['label={t("Time-lapse")}', 'label={t("Night vision")}', '{t("Room")}', '{t("Shape")}']) assert.ok(ui.includes(s), s);
  // the room is a ready-made scare's own; any take the writer writes picks one (a house card's version starts in its
  // room) — and the house's kept rooms say their camera
  assert.ok(ui.includes("const hs = edited ? undefined : houseCard;") && ui.includes("const roomKey = hs ? hs.room : room;") && ui.includes("{written ? ("));
  // the button names the take and its camera — the card's name, or "Film it" for words of their own — says how long,
  // and becomes the REC light while it rolls
  assert.ok(ui.includes('const goLabel = written ? t("Film it · {camera}", { camera: t(camName) }) : t("Film “{name}” · {camera}"') && ui.includes('t("~{lo}–{hi} min", { lo, hi })') && ui.includes('t("REC — rolling. It lands in your Archive.")'));
  // the camera loops play only while seen; a member who asked for less motion gets the still
  assert.ok(ui.includes('window.matchMedia?.("(prefers-reduced-motion: reduce)").matches') && ui.includes("new IntersectionObserver("));
  // a stylesheet is never a child of <style> (tests/style-tags.test.ts); light by default, the shell's dark only in the dark
  assert.ok(ui.includes("<style dangerouslySetInnerHTML={{ __html: FF_STYLE }} />"));
  assert.equal(count(ui, '{theme === "dark" && <style dangerouslySetInnerHTML={{ __html: THEATER_SHELL_CSS + FF_DARK }} />}'), 1);
  // every dark rule of this page names this page
  const dark = ui.slice(ui.indexOf("const FF_DARK = `"));
  for (const line of dark.split("\n").slice(1).filter((l) => /^\./.test(l))) assert.ok(line.startsWith(".ff-dark "), line);
});

test("every word on the builder can be translated (the shared dictionary has each one)", async () => {
  const ui = read("app", "routes", "web.found-footage.tsx");
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  const es = dict.slice(dict.indexOf("const es:"), dict.indexOf("const fr:"));
  const words = new Set<string>();
  for (const m of ui.matchAll(/\bt(?:r)?\(\s*(?:lang\s*,\s*)?("(?:[^"\\]|\\.)*")/g)) words.add(JSON.parse(m[1]));
  // …and the words that come from the recipes (cards — and the words each one puts in the box — cameras, rooms, the
  // builder's refusals)
  const { FOOTAGE_SCARES, FOOTAGE_SHELVES, footageJob } = await import("../app/lib/take.ts");
  const { CAMERA_LOOKS } = await import("../app/lib/camera-dress.ts");
  const { HOUSE_ROOMS } = await import("../app/lib/house-cam.ts");
  for (const s of FOOTAGE_SCARES) { words.add(s.name); words.add(s.line); words.add(s.premise); }
  for (const s of FOOTAGE_SHELVES) { words.add(s.name); words.add(s.line); }
  for (const c of CAMERA_LOOKS) { words.add(c.name); words.add(c.line); }
  for (const r of HOUSE_ROOMS) words.add(r.name);
  for (const f of [{ camera: "x" }, { camera: "phone", scare: "x" }, { camera: "house", scare: "smile" }, { camera: "phone", scare: "own", own: "" }]) {
    const r = footageJob(f);
    if (!r.ok) words.add(r.error);
  }
  const missing = [...words].filter((w) => !es.includes(`\n  ${JSON.stringify(w)}:`));
  assert.deepEqual(missing, [], "untranslated");
});

test("THE QUEUE'S BRANCH: one take, handheld or house, resumed from its own checkpoints — a render-lane job like a film", () => {
  const q = read("app", "lib", "job-queue.server.ts");
  const at = q.indexOf('if (payload.contentType === "take") {');
  assert.ok(at > 0 && at < q.indexOf('if (payload.contentType === "film") {'), "before the films, after the faceless videos");
  const branch = q.slice(at, q.indexOf("\n        break;\n      }", at));
  assert.ok(branch.includes('assertCapability(shop.activePlan, "creatorvideo");'));
  assert.ok(branch.includes('payload.takeCamera === "house"') && branch.includes('(await import("./house-take.server")).generateHouseTake({') && branch.includes('(await import("./take.server")).generateTake({'));
  // everything each pipeline checkpoints comes back on a resume (a retry from the Archive clears ck… first)
  for (const k of ["ckScare", "ckHouse", "ckSet", "ckScene", "ckRaw", "ckSpoke", "ckCut", "ckTake", "ckStill", "ckOpens"]) assert.ok(branch.includes(`${k}: ck("${k}")`), k);
  // a take of the member's own words reaches either maker with the card those words started from (take.ts → footageJob)
  assert.equal(count(branch, 'idea: ck("takeOwn"),'), 2);
  assert.equal(count(branch, 'from: ck("takeFrom"),'), 2, "the card a take's own words started from reaches both makers");
  // the piece is created carrying its section and its job (as the lyric video's is) — nothing is tagged after
  assert.ok(!branch.includes("tagAssetSection("));
  for (const f of ["take.server.ts", "house-take.server.ts"]) {
    const srv = read("app", "lib", f);
    assert.ok(srv.includes('section: opts.section || "creator"') && srv.includes("...(opts.jobId ? { jobId: opts.jobId } : {}),"), f);
  }
  // no lane mark: it runs in the render lane, never beside another render (job-lanes.ts)
  assert.ok(!branch.includes("__lane"));
});

test("A HOUSE TAKE KEEPS THE HOUSE: the room is drawn once and kept on the take's own record, and the next take starts from it", () => {
  const srv = read("app", "lib", "house-take.server.ts");
  // where the house is: on the newest house take of this shop that carries one
  assert.ok(srv.includes(`export const HOUSE_NEEDLE = '"house":{"v":1';`));
  assert.ok(srv.includes("where: { shopId, type: \"VIDEO_AD\", metaJson: { contains: HOUSE_NEEDLE } }, orderBy: { createdAt: \"desc\" }"));
  assert.ok(srv.includes("// THE HOUSE as it now stands — its rooms, the things seen in it, its night: the next house take starts here\n        house: m.house,"));
  // a room it has is used as drawn; one it has not is drawn — the house's first from words, any other FROM the first
  assert.ok(srv.includes("const plan = roomToDraw(house, scare.room);") && srv.includes("house = withRoom(house, room.key, await draw(roomPrompt(room, plan.first), plan.from ? [plan.from] : []));"));
  // the room as the take finds it is drawn FROM the room; the scene FROM that (with the thing the house has seen)
  assert.ok(srv.includes("set = p ? await draw(p, [roomPic]) : roomPic;"));
  assert.ok(srv.includes("scene = await draw(houseScenePrompt(scare, { kept: !!known, ir }), known ? [set, known] : [set]);"));
  // the roll starts on the room as the take finds it and is told to arrive at the scene, fifteen seconds, wide
  assert.ok(srv.includes('rollTake({ first: imageRef(base, set), scene: imageRef(base, scene), direction, aspect: "16:9", seconds: HOUSE_TAKE_SECONDS })'));
  // no words: listened to and rolled once more if the engine spoke — the handheld take's own rule
  assert.ok(srv.includes("for (let again = 0; again < rerolls() && wordsIn(spoke) > 0; again++) {"));
  // nobody speaks over it: the room lifted with its hiss — and the house look with the house's night
  assert.ok(srv.includes("const roomed = await roomTake(rawName);"));
  assert.ok(srv.includes('dressTake(soundPath, { look: "house", w: size.w || 1280, h: size.h || 720, clock: cut.clock, timelapse: lapse, seconds: rawSeconds, camName: cam, ir })'));
  assert.ok(srv.includes("cut = houseNight({ prev: house.night, seconds: rawSeconds, lapse, today:"));
  // the time-lapse is the scare's window, and only when the setting is on
  assert.ok(srv.includes("const lapse = (o.lapse ?? scare.lapseOn) ? timeLapseOf(scare.lapse, rawSeconds) : null;"));
  // every step that costs is checkpointed, and a resumed job takes what it already has
  for (const k of ["ckScare", "ckHouse", "ckSet", "ckScene", "ckRaw", "ckSpoke", "ckCut"]) assert.ok(srv.includes(`await ckpt({ ${k}:`), k);
  // A HOUSE CARD'S WORDS CHANGED: the writer starts from that card, in the room picked (else the card's own) — and a
  // writer that fails falls back to that card as it is
  assert.ok(srv.includes("const from = houseScare(o.from);") && srv.includes('const room = houseRoom(o.room) || (from ? houseRoom(from.room) : undefined) || houseRoom("living");'));
  assert.ok(srv.includes('houseWriterBrief(o.idea || "", room, from)') && srv.includes("const fallback = from || HOUSE_SCARES[0];") && srv.includes("scare = written || { ...fallback, title: fallback.name };"));
  assert.ok(srv.includes("...(opts.from && opts.idea ? { from: opts.from } : {}),"), "the piece says which card it was written from");
  // the making runs without the database (a local run uses it); only generateHouseTake reads and writes rows
  const make = srv.slice(srv.indexOf("export async function makeHouseTake"), srv.indexOf("export async function generateHouseTake"));
  assert.ok(!make.includes("db."), "makeHouseTake touches no row");
});

test("the Archive's in-progress card expects a take to take about eight and a half minutes (not a single clip's three)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../app/routes/web.archive.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(src.includes("const TAKE_TYPICAL_SEC = 510;"));
  assert.ok(src.includes(': (j.type === "GENERATE_VIDEO_AD" && p.contentType === "take") ? TAKE_TYPICAL_SEC'));
});
