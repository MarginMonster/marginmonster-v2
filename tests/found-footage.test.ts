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

test("ONE SCREEN: what was caught — one box first, the cards its starters — the camera, the cut, the settings that apply, the reel, one button; the last tap wins and the button names the pair", () => {
  const ui = read("app", "routes", "web.found-footage.tsx");
  // the parts, in order — and the box is the first thing under "What was caught on camera?", above every card; then
  // the step cards (2026-11-25: the Movie Maker's — the camera, the cut, the settings), the reel, the button
  const at = ['{t("What was caught on camera?")}', '<textarea id="ff-own-in"', "{FOOTAGE_SHELVES.map((sh) => (", '{t("The camera")}', '{t("The cut")}', '{t("The settings")}', '<section className={`ff-reel', 'className={`ff-go'].map((m) => ui.indexOf(m));
  assert.ok(at.every((x, i) => x > 0 && (i === 0 || x > at[i - 1])), "in order");
  // ALWAYS THERE (the owner: "These found footage options leave zero room for creativity, it's just what happens"):
  // the box sits right under its heading, which is its label — never behind a button
  assert.ok(ui.includes('<h2 className="ff-lbl" id="ff-what"><span className="ff-n">1</span> <label htmlFor="ff-own-in">{t("What was caught on camera?")}</label></h2>\n        <textarea id="ff-own-in"'));
  // (…and "not limited" — the owner, 2026-11-25: the box says a film is whatever a camera could catch, not only a scare)
  assert.ok(ui.includes('placeholder={t("Anything a camera could catch — a haunting, the dog raiding the fridge, a meteor over the road. Or tap a card below.")}'));
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
  // …and a FILM of their own words is not told it must frighten ("not limited"): one take keeps the line it had
  assert.ok(ui.includes(': film ? t("Say where it happens, who is there, and how it ends — the writer builds the moments.")\n              : t("Slow and still is what frightens.'));
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
  // every scare as a card ON ITS SHELF (the body cam has its own: a scare, and a police drama), every camera as a card —
  // in the order the owner named them (2026-11-25: "House cam, Body cam, phone or cam recording")
  assert.ok(ui.includes("{shelfScares(sh.family).map((s) => {") && ui.includes("{CAMERAS.map((c) => {"));
  assert.ok(ui.includes('const CAM_ORDER: readonly CameraLook[] = ["house", "bodycam", "phone", "camcorder", "bare"];'));
  assert.ok(ui.includes('{s.genre === "drama" ? t("Drama") : t("Horror")}'));
  // settings only where they apply: the house's for the house camera, the shape for the two that can shoot either
  assert.ok(ui.includes("const settings = house || shapeChoosable(pick.camera);") && ui.includes("{settings && ("));
  for (const s of ['label={t("Time-lapse")}', 'label={t("Night vision")}', '{t("Room")}', '{t("Shape")}']) assert.ok(ui.includes(s), s);
  // the room is a ready-made scare's own; any ONE take the writer writes picks one (a house card's version starts in its
  // room) — and the house's kept rooms say their camera. A FILM's moments each have their own room, on the reel.
  assert.ok(ui.includes("const hs = edited ? undefined : houseCard;") && ui.includes("const roomKey = hs ? hs.room : room;") && ui.includes("const roomPick = written && !film;") && ui.includes("{roomPick ? ("));
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
  // …and, to both makers of one take, the roll that was in the air when the job stopped and the host the kept roll came from
  assert.equal(count(branch, 'ckRoll: ck("ckRoll"), ckRaw: ck("ckRaw"), ckHost: ck("ckHost"),'), 2);
  // a take of the member's own words reaches either maker with the card those words started from (take.ts → footageJob)
  // — and a FILM's maker, the third (2026-11-25: footage-film.server.ts; it was 2 when there were two makers)
  assert.equal(count(branch, 'idea: ck("takeOwn"),'), 3);
  assert.equal(count(branch, 'from: ck("takeFrom"),'), 2, "the card a take's own words started from reaches both makers");
  // A FILM — the outline the member approved, or more than one moment asked for — goes to the film's maker, with the
  // payload itself as what it resumes from (its own checkpoints, and the one take's it can fall back to); a film from a
  // card left as it was starts from that card. ANYTHING ELSE is one take, by the same two calls as ever.
  assert.ok(branch.includes('const takeFilm = !!ck("takeOutline") || (typeof payload.takeMoments === "number" && payload.takeMoments > 1);'));
  assert.ok(branch.includes('const takeAssetId = takeFilm\n          ? await (await import("./footage-film.server")).generateFootageFilm({'));
  assert.ok(branch.includes('outline: (await import("./footage-film")).cleanFootageOutline(ck("takeOutline")) || undefined,'), "what the page sent is cleaned again before it is filmed");
  assert.ok(branch.includes('from: ck("takeFrom") || ck("takeIdea"),') && branch.includes('moments: typeof payload.takeMoments === "number" ? payload.takeMoments : undefined,') && branch.includes("resume: ck,"));
  assert.ok(branch.includes('          : payload.takeCamera === "house"\n          ? await (await import("./house-take.server")).generateHouseTake({'));
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
  // (…each drawn CLOTHED where somebody is in it — take.server.ts → drawClothed, 2026-11-25: tests/clothed.test.ts)
  assert.ok(srv.includes("set = p ? (scare.set.trim() ? await drawDressed(p, [roomPic], \"the room as the take finds it\") : await draw(p, [roomPic])) : roomPic;"));
  assert.ok(srv.includes("scene = await drawDressed(houseScenePrompt(scare, { kept: !!known, ir }), known ? [set, known] : [set], \"the scene\");"));
  // the roll starts on the room as the take finds it and is told to arrive at the scene, fifteen seconds, wide
  // (fifteen unless a found-footage FILM's moment asks for fewer — never under ten, never over the walk-in's fifteen)
  assert.ok(srv.includes("const seconds = Math.max(10, Math.min(HOUSE_TAKE_SECONDS, Math.round(o.seconds ?? HOUSE_TAKE_SECONDS)));"));
  // (…flying(): a roll this job asked for before it was stopped is waited for, never asked — and paid — for again)
  assert.ok(srv.includes('rollTake({ ...flying(), first: imageRef(base, set), scene: imageRef(base, scene), direction, aspect: "16:9", seconds })'));
  assert.ok(srv.includes("const flying = inTheAir(rawName ? undefined : resume.ckRoll, ckpt);"));
  // no words, no cut: listened to and looked at, and rolled once more if the engine spoke or CUT — the handheld take's
  // own rule (a camera screwed to the wall never cuts) — but never trimmed: the house's clock runs from its first frame
  // (`more` is TAKE_REROLLS for one take; a film's moment hands in its own, from the few the film has for all of them)
  assert.ok(srv.includes("const more = o.rerolls ?? rerolls;"));
  assert.ok(srv.includes("for (let again = 0; again < more() && rollFaulty({ cuts: cuts.length, words: said(spoke) }, true); again++) {"));
  assert.ok(srv.includes("cuts = await cutsIn(path.join(dir, rawName));") && srv.includes("if (betterRoll({ cuts: nextCuts.length, words: said(nextSpoke) }, { cuts: cuts.length, words: said(spoke) }, true)) {"));
  assert.ok(!srv.includes("takecut-") && !srv.includes("TRIM_WITHIN"));
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

/* 2026-11-25, the owner: "Found footage needs redone … It currently appears to pipeline singular events". A FILM
 * (app/lib/footage-film.server.ts) makes each house moment with makeHouseTake; what it hands in is held here — and one
 * take hands in none of it. */
test("A FILM'S HOUSE MOMENT is made by makeHouseTake: it arrives written, with the clock its card says, the film's own thing and the best pictures", () => {
  const srv = read("app", "lib", "house-take.server.ts");
  // it arrives written — after a resumed job's own checkpoint, before any ready-made scare
  const at = ["if (resume.ckScare) scare = JSON.parse(resume.ckScare);", "else if (o.scare) scare = o.scare;", "else if (ready) scare = { ...ready, title: ready.name };"].map((m) => srv.indexOf(m));
  assert.ok(at[0] > 0 && at[0] < at[1] && at[1] < at[2], "in that order");
  // the same one walks into every moment: the picture the film's thing was first drawn in is the second reference —
  // handed in, never kept in the shop's house
  assert.ok(srv.includes("const known = o.thingPic || thingImg(house, scare.thing.key);"));
  assert.ok(srv.includes("if (!known && scare.thing.key) {"), "only a thing with a key of its own is kept in the house");
  // THE CLOCK ITS CARD SAYS, and the house's own night stays where it was
  assert.ok(srv.includes("else if (o.clock) cut = { clock: o.clock, night: house.night };"));
  assert.ok(srv.indexOf("if (resume.ckCut) cut = JSON.parse(resume.ckCut);") < srv.indexOf("else if (o.clock) cut = { clock: o.clock, night: house.night };"));
  // the best pictures ("upgrade the best image possible"): the strongest model at 2K, the everyday one behind it —
  // and one take draws on the everyday one, as it always has
  assert.ok(srv.includes('drawPicture({ prompt, ...(refs.length ? { image_input: refs.map((r) => imageRef(base, r)) } : {}), aspect_ratio: "16:9", output_format: "jpg" }, !!o.best);'));
  const take = read("app", "lib", "take.server.ts");
  const draw = take.slice(take.indexOf("export async function drawPicture("), take.indexOf("/** The take itself, started on `first`"));
  assert.ok(draw.includes("export async function drawPicture(input: Record<string, unknown>, best = false): Promise<string> {"));
  assert.ok(draw.includes('if (best) {\n    try { return await persistRemote(await repRun("google/nano-banana-pro", { ...input, resolution: "2K" }, 180_000), "jpg"); }'));
  assert.ok(draw.includes('return persistRemote(await repRun("google/nano-banana", input), "jpg");'));
  // a roll spent again says so (the film counts them: one a moment, three a film)
  assert.ok(srv.includes("— rolled again`);\n      o.onReroll?.();"));
});

test("the Archive's in-progress card expects a take to take about eight and a half minutes (not a single clip's three)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../app/routes/web.archive.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(src.includes("const TAKE_TYPICAL_SEC = 510;"));
  assert.ok(src.includes(': (j.type === "GENERATE_VIDEO_AD" && p.contentType === "take") ? TAKE_TYPICAL_SEC'));
});

/* THEIR WORDS ARE KEPT (2026-11-25): in the first build of the box, a card tapped while the box held the member's own words
 * replaced them for good — a stray tap on a shelf lost a paragraph. Now they stay one tap away until they type again. */
test("a card tapped over the member's own words keeps them one tap away", () => {
  const page = read("app", "routes", "web.found-footage.tsx");
  assert.ok(page.includes("const [kept, setKept] = useState<{ words: string; pick: FootagePick } | null>(null);"));
  assert.ok(page.includes("if (written && own.trim().length >= 8) setKept({ words: own, pick });"), "saved only when the box held their words");
  assert.ok(page.includes("const bringBack = () => { if (!kept) return; setPick(kept.pick); setOwn(kept.words); setKept(null); };"));
  assert.ok(page.includes("setOwn(words);\n    setKept(null);"), "typing again lets the old words go");
  assert.ok(page.includes("{!edited && kept && <button type=\"button\" className=\"ff-undo\" onClick={bringBack}><Ico n=\"refresh\" size={12} /> {t(\"Bring back your words\")}</button>}"));
  assert.equal(read("app", "lib", "ui-i18n-dict.ts").split("\"Bring back your words\":").length - 1, 5, "es, fr, de, zh and ur");
});

/* 2026-11-25, the owner: "Found footage needs redone … It currently appears to pipeline singular events But needs to be
 * more like \"Found Footage\" House cam, Body cam, phone or cam recording, with describe events flow like the others -
 * make it look banging and not limited". The page became a film builder over footage-film.ts (stream S1's engine): what
 * it asks the server for, what it posts, and what the server does with it are held here. */

const page = () => read("app", "routes", "web.found-footage.tsx");
const actionOf = (ui: string) => ui.slice(ui.indexOf("export const action"), ui.indexOf("/** A camera card's screen"));

test("FOUR INTENTS: one take, exactly as it was; the moments written (free); one moment written again (free); the reel rolled — each behind the admin gate and the plan", () => {
  const action = actionOf(page());
  assert.ok(page().includes('const INTENTS = ["take", "outline", "rewrite", "film"];'));
  assert.ok(action.includes('if (!INTENTS.includes(intent)) return json({ error: tr(lang, "Unknown action.") }, { status: 400 });'));
  // the gate and the plan come before anything any intent does
  const first = Math.min(...['if (intent === "outline" || intent === "rewrite") {', 'if (intent === "film") {', "const job = footageJob("].map((m) => action.indexOf(m)));
  for (const g of ["isAdminEmail(account.email)", "if (!shop.activePlan?.active)", 'capabilitiesFor(shop.activePlan).has("creatorvideo")']) assert.ok(action.indexOf(g) > 0 && action.indexOf(g) < first, g);
  // "outline": the same choices one press would film (footage-film.ts → footageOutlineAsk), then the writer — free
  assert.ok(action.includes('const ask = footageOutlineAsk({ scare: form.get("scare"), own: form.get("own"), camera: form.get("camera"), aspect: form.get("aspect"), lapse: form.get("lapse"), ir: form.get("ir"), room: form.get("room"), moments: form.get("moments") }, (s) => tr(lang, s));'));
  assert.ok(action.includes("try { return json({ ok: true as const, outline: await writer.writeFootageOutline(ask) }); }"));
  // "rewrite": the outline the page sent is cleaned before the writer sees it, and the index must be one of its moments
  assert.ok(action.includes('const outline = cleanFootageOutline(form.get("outline"));'));
  assert.ok(action.includes("if (!outline || !Number.isInteger(index) || index < 0 || index >= outline.moments.length) return json({ error: tr(lang, FOOTAGE_OUTLINE_UNREADABLE) }, { status: 400 });"));
  assert.ok(action.includes('moment: await writer.rewriteFootageMoment({ outline, index, note: String(form.get("note") || "").slice(0, 300) })'));
  // the writer's refusals reach the member only as words the page can show; anything else it throws is "try again"
  assert.ok(action.includes("return tr(lang, [writer.FOOTAGE_WRITER_BUSY, writer.FOOTAGE_NEEDS_IDEA, FOOTAGE_OUTLINE_UNREADABLE].includes(m) ? m : writer.FOOTAGE_WRITER_BUSY);"));
  // "film": the reel the member approved, cleaned again on the server (footageFilmJob) — then queued like one take
  assert.ok(action.includes('const film = footageFilmJob({ scare: form.get("scare"), own: form.get("own"), camera: form.get("camera"), aspect: form.get("aspect"), lapse: form.get("lapse"), ir: form.get("ir"), room: form.get("room"), outline: form.get("outline") }, (s) => tr(lang, s));'));
  assert.ok(action.includes("return roll(film);") && action.includes("return roll(job);"));
  // ONE queue for both: three in the making at once (a film counts as one), nothing charged
  const roll = action.slice(action.indexOf("const roll = async"), action.indexOf('if (intent === "film") {'));
  assert.ok(roll.includes("if (making >= 3)") && roll.includes('await enqueueJob(shop.id, "GENERATE_VIDEO_AD", job.payload);'));
  // the writer is the film's server module, loaded only when it is asked for (as the loader loads the house)
  assert.ok(action.includes('const writer = await import("../lib/footage-film.server");'));
  const srv = read("app", "lib", "footage-film.server.ts");
  for (const k of ["export const FOOTAGE_WRITER_BUSY", "export const FOOTAGE_NEEDS_IDEA", "export async function writeFootageOutline(", "export async function rewriteFootageMoment("]) assert.ok(srv.includes(k), k);
});

test("ONE MOMENT IS TODAY'S TAKE: the cut at one posts exactly the form one take always posted", () => {
  const ui = page();
  // a film of three unless they say; one is the single take
  assert.ok(ui.includes("const [count, setCount] = useState(3);") && ui.includes("const film = count > 1;"));
  const at = ui.indexOf("{!film ? (");
  const form = ui.slice(at, ui.indexOf("</fetcher.Form>", at)).split("\n").slice(1).map((l) => l.trim());
  assert.deepEqual(form.slice(0, 11), [
    "<fetcher.Form method=\"post\" onSubmit={() => setSentSig(sig)}>",
    "<input type=\"hidden\" name=\"intent\" value=\"take\" />",
    "<input type=\"hidden\" name=\"scare\" value={pick.scare} />",
    "<input type=\"hidden\" name=\"camera\" value={pick.camera} />",
    "<input type=\"hidden\" name=\"aspect\" value={aspect} />",
    "{/* the words in the box, always — the server decides whether they are still the card's (footageJob) */}",
    "{own.trim() ? <input type=\"hidden\" name=\"own\" value={own} /> : null}",
    "{house && <input type=\"hidden\" name=\"lapse\" value={lapseOn ? \"1\" : \"0\"} />}",
    "{house && <input type=\"hidden\" name=\"ir\" value={ir ? \"1\" : \"0\"} />}",
    "{house && <input type=\"hidden\" name=\"room\" value={roomKey} />}",
    "<button type=\"submit\" className={`ff-go${rolling ? \" is-rolling\" : \"\"}`} disabled={!canGo}>",
  ]);
  // …with the time-lapse the scare starts with, as before (a FILM's starts off — footageFilmJob)
  assert.ok(ui.includes("const lapseOn = lapse ?? (film ? false : !!houseCard?.lapseOn);"));
});

test("THE CUT: one control — a strip of film over a real range input, one take to eight moments, with the length and how long it takes", () => {
  const ui = page();
  assert.ok(ui.includes('<input id={id} className="ff-cut-in" type="range" min={1} max={FOOTAGE_MAX_MOMENTS} step={1} value={n}'));
  assert.ok(ui.includes('aria-label={t("How many moments?")}') && ui.includes("aria-valuetext={"));
  // one take is called what it is, with its length; a film says its moments, its length and how long it takes to make
  assert.ok(ui.includes('const count = n === 1 ? t("One take · {s} s", { s: secs }) : t("{n} moments", { n });'));
  assert.ok(ui.includes("const [lo, hi] = n === 1 ? footageEta(camera) : footageFilmEta({ camera, moments: ms });"));
  // (a reel of that many moments is reckoned by its own seconds; before one is written, each at its camera's usual length)
  assert.ok(ui.includes("const ms = written && written.length === n ? [...written] : standIn(camera, n);"));
  assert.ok(ui.includes("const standIn = (camera: CameraLook, n: number): FootageMoment[] => Array.from({ length: n }, () => ({ when: \"\", line: \"\", seconds: momentSeconds(camera, undefined) }));"));
  // the button's estimate is the same reckoning
  assert.ok(ui.includes("const [lo, hi] = film ? footageFilmEta({ camera: pick.camera, moments: plan }) : footageEta(pick.camera);"));
});

test("THE REEL: what is posted is the reel as the member left it — and the server cleans it, keeps their words, and films exactly that", async () => {
  const ui = page();
  const { footageFilmJob, cleanFootageOutline, FOOTAGE_OUTLINE_UNREADABLE, FOOTAGE_OUTLINE_OTHER_CAMERA, FOOTAGE_LIMITS } = await import("../app/lib/footage-film.ts");
  // the page: every moment with a line, in the member's order, on the camera now picked — its own key left behind
  assert.ok(ui.includes("moments: r.moments.filter((m) => filmable(m.line)).map(({ key: _key, ...m }) => m),"));
  assert.ok(ui.includes('const filmable = (line: string): boolean => line.replace(/[^\\p{L}\\p{N}]+/gu, "").length >= 4;'));
  assert.ok(ui.includes('const posted = film && shown && !otherCam ? JSON.stringify(outlineOf(shown, pick.camera, aspect)) : "";'));
  assert.ok(ui.includes('<input type="hidden" name="intent" value="film" />') && ui.includes('<input type="hidden" name="outline" value={posted} />'));
  // (a moment with no words yet stops the roll, and says which)
  assert.ok(ui.includes("const canRoll = d.canFilm && !!posted && blank < 0 && !retaking && !writing && !busy && !rolling;"));
  // AS POSTED: a phone film the member edited — a line rewritten, a card retyped in lower case, too many seconds, a key
  const reel = {
    v: 1, title: "TEST · Biscuit and the Fridge, the whole sorry saga of a terrier and a door", camera: "phone", aspect: "9:16", kind: "plain",
    place: "A small kitchen in a made-up flat: yellow cupboards, a humming fridge.", thing: "Biscuit, a scruffy brown terrier with a red collar.",
    moments: [
      { key: "m1", when: "day 1 · 7:42 pm", line: "My own line: Biscuit pretends to sleep, one eye open on the fridge.", seconds: 30 },
      { key: "m2", when: "DAY 3 · 2:05 AM", line: "Caught: Biscuit noses the fridge door open, the bell on his collar jingling.", seconds: 10 },
    ],
  };
  const form = { scare: "own", own: "Our dog keeps raiding the fridge at night", camera: "camcorder", aspect: "16:9", outline: JSON.stringify(reel) };
  const job = footageFilmJob(form);
  assert.ok(job.ok);
  if (!job.ok) return;
  assert.equal(job.moments, 2);
  const filmed = JSON.parse(String(job.payload.takeOutline));
  // the camera on the form wins (carried the same way: a phone's moments, filmed on a camcorder), its shape with it
  assert.equal(filmed.camera, "camcorder");
  assert.equal(filmed.aspect, "16:9");
  // their words are the words filmed; the card is a card; the seconds are a moment's; nothing else of the page's survives
  assert.equal(filmed.moments[0].line, "My own line: Biscuit pretends to sleep, one eye open on the fridge.");
  assert.equal(filmed.moments[0].when, "DAY 1 · 7:42 PM");
  assert.equal(filmed.moments[0].seconds, 12);
  assert.ok(!("key" in filmed.moments[0]) && !("key" in filmed.moments[1]));
  assert.ok(filmed.title.length <= FOOTAGE_LIMITS.title);
  // …and it is exactly what cleanFootageOutline makes of it — the job the queue runs cleans it once more (job-queue.server.ts)
  assert.deepEqual(filmed, { ...cleanFootageOutline(reel), camera: "camcorder", aspect: "16:9" });
  // a house's rooms cannot be walked through with a phone: refused, in words the page shows
  const other = footageFilmJob({ ...form, camera: "house" });
  assert.deepEqual(other, { ok: false, error: FOOTAGE_OUTLINE_OTHER_CAMERA });
  assert.ok(ui.includes('t("These moments were written for the {camera} — write them again for this camera."'), "the page says so before the server has to");
  // what is not an outline is refused; an outline cut down to one moment is ONE take, queued as one always is
  assert.deepEqual(footageFilmJob({ ...form, outline: "{not json" }), { ok: false, error: FOOTAGE_OUTLINE_UNREADABLE });
  const one = footageFilmJob({ ...form, outline: JSON.stringify({ ...reel, moments: [reel.moments[0]] }) });
  assert.ok(one.ok && one.moments === 1 && !("takeOutline" in one.payload) && one.payload.contentType === "take");
  // a HOUSE film: night vision on, the time-lapse off unless switched on
  const house = { ...reel, camera: "house", aspect: "16:9", moments: reel.moments.map((m, i) => ({ ...m, room: i ? "kitchen" : "living", seconds: 15 })) };
  const hj = footageFilmJob({ scare: "own", own: "x", camera: "house", aspect: "16:9", lapse: "0", ir: "1", outline: JSON.stringify(house) });
  assert.ok(hj.ok && hj.payload.takeLapse === false && hj.payload.takeIr === true);
  if (hj.ok) assert.deepEqual(JSON.parse(String(hj.payload.takeOutline)).moments.map((m: { room: string }) => m.room), ["living", "kitchen"]);
});

test("THE WRITER, ASKED BY THE PAGE: the moments from what one press would film; one moment again — a new one says where it sits", async () => {
  const ui = page();
  const { footageOutlineAsk, cleanFootageOutline } = await import("../app/lib/footage-film.ts");
  // the writer's form: the card, the camera, the shape, the words, the house's settings, and how many moments
  const fields = ui.slice(ui.indexOf("const writeFields = ("), ui.indexOf("const writeErr ="));
  for (const f of ['name="intent" value="outline"', 'name="scare" value={pick.scare}', 'name="camera" value={pick.camera}', 'name="aspect" value={aspect}', 'name="own" value={own}', 'name="lapse"', 'name="ir"', 'name="moments" value={count}']) assert.ok(fields.includes(f), f);
  // what the server makes of it: a card left as it was is its own words and where the film starts
  const ask = footageOutlineAsk({ scare: "overbed", camera: "house", aspect: "16:9", lapse: "0", ir: "1", moments: "4" });
  assert.ok(ask.ok && ask.from === "overbed" && ask.camera === "house" && ask.count === 4 && ask.idea.length > 20);
  // words of their own too few to write from: said, in the page's words
  const none = footageOutlineAsk({ scare: "own", own: "dog", camera: "phone", moments: "3" });
  assert.deepEqual(none, { ok: false, error: "Say what happens, in a few words." });
  // ANOTHER TAKE: the reel as it stands, the moment by its place in it — a moment with no words yet is left out of what
  // is posted, except the one being written, which says where it sits (the server drops a moment without a line, and the
  // index would point at the wrong one)
  assert.ok(ui.includes("const list = r.moments.filter((m) => m.key === key || filmable(m.line));"));
  assert.ok(ui.includes("moments: list.map(({ key: k, ...m }) => (k === key && !filmable(m.line) ? { ...m, line: NEW_MOMENT } : m))"));
  assert.ok(ui.includes('retake.submit({ intent: "rewrite", outline: JSON.stringify(posted), index: String(index) }, { method: "post" });'));
  const NEW_MOMENT = /const NEW_MOMENT = ("[^"]+");/.exec(ui)?.[1];
  assert.ok(NEW_MOMENT);
  const posted = { v: 1, title: "TEST", camera: "phone", aspect: "9:16", kind: "scare", place: "A made-up hallway, long and dark.", thing: "", moments: [
    { when: "NIGHT 1", line: "Something far off at the end of the hall.", seconds: 8 },
    { when: "", line: JSON.parse(NEW_MOMENT), seconds: 10 },
    { when: "NIGHT 3", line: "It is right outside the door.", seconds: 10 },
  ] };
  const clean = cleanFootageOutline(JSON.stringify(posted));
  assert.ok(clean && clean.moments.length === 3 && clean.moments[1].line === JSON.parse(NEW_MOMENT), "the new moment keeps its place");
  // + ADD A MOMENT goes in just before the payoff (the last moment stays the last), and the writer fills it in
  assert.ok(ui.includes("const at = Math.max(0, reel.moments.length - 1);") && ui.includes("askAgain(next, m.key);"));
  // the answer is put back by the moment's KEY — wherever the member moved it meanwhile
  assert.ok(ui.includes("setReel((x) => (x ? { ...x, moments: x.moments.map((y) => (y.key === key ? { ...m, key } : y)) } : x));"));
});

test("THE REEL IS KEPT FOR THE TAB: a phone that reloads the page never loses a written and changed reel — and what comes back is cleaned", () => {
  const ui = page();
  assert.ok(ui.includes('const REEL_KEPT = "ff-reel-v1";'));
  // saved whenever it changes, with the words in the box and the card it was written from (so it is not "changed")
  // (…and the shape, night vision and time-lapse they picked, and which film this tab already rolled)
  assert.ok(ui.includes("try { window.sessionStorage.setItem(REEL_KEPT, JSON.stringify({ reel: { ...reel, moments: reel.moments.map(({ key: _key, ...m }) => m) }, from: reelFrom, count, pick, own, wide, lapse, ir, rolled: rolledAs })); }"));
  // put back once, on arrival — never over a link that asked for a card or a camera — through the engine's own cleaning
  const at = ui.indexOf("window.sessionStorage.getItem(REEL_KEPT)");
  const restore = ui.slice(ui.lastIndexOf("useEffect(() => {", at), ui.indexOf("}, []);", at));
  assert.ok(restore.includes('if (params.get("scare") || params.get("camera")) return;'));
  assert.ok(restore.includes("const o = k ? cleanFootageOutline(k.reel) : null;") && restore.includes("setReel(reelOf(o));"));
  // a card that cannot be filmed on that camera is not brought back with it (the rules a tap obeys)
  assert.ok(restore.includes("setPick({ scare: (key === OWN_SCARE || footageScare(key)) && fits(key, cam) ? key : OWN_SCARE, camera: cam });"));
  // a browser that keeps nothing (a private window) simply starts empty
  assert.ok(restore.includes("catch { /* a nicety: a browser that keeps nothing simply starts empty */ }"));
  // the member's shape comes back — not the reel's own (a phone's reel picked up on a camcorder, Wide, came back Tall)
  assert.ok(restore.includes('setWide(k.wide === "9:16" || k.wide === "16:9" ? k.wide : o.aspect);'));
  assert.ok(restore.includes('if (typeof k.lapse === "boolean") setLapse(k.lapse);') && restore.includes('if (typeof k.ir === "boolean") setIr(k.ir);'));
  // A REEL ROLLED IS NOT ROLLED TWICE BY A RELOAD (review, 2026-11-25): the film it rolled is kept, compared as the server
  // will film it, and the button stays REC until the film changes
  assert.ok(restore.includes('if (typeof k.rolled === "string") setRolledAs(k.rolled);'));
  assert.ok(ui.includes("const filmSig = useMemo(() => { const o = posted ? cleanFootageOutline(posted) : null; return o ? JSON.stringify([o, house ? [lapseOn, ir] : 0]) : \"\"; }, [posted, house, lapseOn, ir]);"));
  assert.ok(ui.includes("const rolling = (!!data?.ok && !busy && sentSig === sig) || (film && !busy && !!filmSig && rolledAs === filmSig);"));
  assert.ok(ui.includes("useEffect(() => { if (film && data?.ok && fetcher.state === \"idle\" && sentSig === sig && filmSig) setRolledAs(filmSig); }, [data, fetcher.state]);"));
  // (rolledAs is declared before the effect that keeps it: a dependency list read before its useState is a crash)
  assert.ok(ui.indexOf("const [rolledAs, setRolledAs] = useState<string | null>(null);") < ui.indexOf("window.sessionStorage.setItem(REEL_KEPT"));
});

test("a rolled reel, kept and brought back by a reload, is recognised as the SAME film (cleaning it twice changes nothing)", async () => {
  const { cleanFootageOutline } = await import("../app/lib/footage-film.ts");
  // as a member leaves it: a "quoted" word, stray spaces, a lower-case card, a long card, seconds out of range, an empty title
  const reel = { v: 1, title: "  ", camera: "house", aspect: "9:16", kind: "scare", place: "  A made-up TEST house,   all \"wooden\" floors.", thing: "none", moments: [
    { when: "night 1 · 2:14 am", line: "  The \"blanket\" slides   off the sofa.  ", seconds: 3, room: "nope" },
    { when: "TUESDAY 14 OCTOBER · 11:52 PM", line: "Something tall stands at the end of the hallway.", seconds: 99 },
    { when: "", line: "ok", seconds: 10 },
  ] };
  const once = cleanFootageOutline(JSON.stringify(reel));
  assert.ok(once);
  assert.deepEqual(cleanFootageOutline(JSON.stringify(once)), once);
});

test("WHILE THE WRITER WRITES, the tape's label says the film the cut asked for — its own length, never a fixed 'half a minute'", async () => {
  const ui = page();
  const { footageSeconds, momentSeconds } = await import("../app/lib/footage-film.ts");
  assert.ok(!ui.includes("about half a minute"));
  assert.ok(ui.includes("const asked = standIn(pick.camera, count);") && ui.includes("const askedEta = footageFilmEta({ camera: pick.camera, moments: asked });"));
  assert.ok(ui.includes('{t("{n} moments", { n: count })} · ≈ {clockOf(footageSeconds({ moments: asked }))} · {t("ready in ~{lo}–{hi} min", { lo: askedEta[0], hi: askedEta[1] })}'));
  // eight house moments are over two minutes of film — what the label printed as "about half a minute"
  const eight = Array.from({ length: 8 }, () => ({ when: "", line: "", seconds: momentSeconds("house", undefined) }));
  assert.ok(footageSeconds({ moments: eight }) > 120);
});

test("THE REEL'S LIMITS: the engine's own — words, seconds, moments; removing asks twice; a moment being written again is left alone", async () => {
  const ui = page();
  const { momentSeconds, FOOTAGE_MAX_MOMENTS } = await import("../app/lib/footage-film.ts");
  // every box is held to what the engine keeps (FOOTAGE_LIMITS: title 60, place 280, thing 280, card 28, line 180)
  for (const k of ["title", "place", "thing", "when", "line"]) assert.ok(ui.includes(`maxLength={FOOTAGE_LIMITS.${k}}`), k);
  // a moment's seconds: the engine's span for its camera — 6 to 12 held or worn, 10 to 15 on a wall
  assert.ok(ui.includes('const secondsSpan = (camera: CameraLook): [number, number] => (camera === "house" ? [10, HOUSE_TAKE_SECONDS] : [6, 12]);'));
  assert.deepEqual([momentSeconds("phone", 5), momentSeconds("phone", 13), momentSeconds("house", 9), momentSeconds("house", 16)], [6, 12, 10, 15]);
  // two moments at least (fewer is one take: the cut does that), eight at most
  assert.ok(ui.includes("disabled={shown.moments.length <= 2 || mine}"));
  assert.ok(ui.includes("{shown.moments.length < FOOTAGE_MAX_MOMENTS && !otherCam && (") && FOOTAGE_MAX_MOMENTS === 8);
  // removing is a second tap ("Remove?"), and lets go by itself
  assert.ok(ui.includes("if (armDel !== key) { setArmDel(key); return; }") && ui.includes('{armDel === m.key ? t("Remove?") : <Ico n="x" size={14} />}'));
  assert.ok(ui.includes("useEffect(() => { if (!armDel) return; const id = window.setTimeout(() => setArmDel(null), 3500); return () => window.clearTimeout(id); }, [armDel]);"));
  // writing it all again replaces the reel: a second tap too
  assert.ok(ui.includes('{armAgain ? t("Tap again — this replaces the reel") : t("Write it again — free")}'));
  // a card retyped is a card (footage-film.ts → cardWords) once the member leaves it — never an empty one
  assert.ok(ui.includes("onBlur={(e) => change(m.key, { when: cardWords(e.target.value) || `NIGHT ${n}` })}"));
  // a moment the writer is writing again cannot be moved, removed, retyped or re-timed until its answer is in — and one
  // is written again at a time
  for (const s of ["disabled={i === 0 || mine}", "disabled={i === shown.moments.length - 1 || mine}", "placeholder={`NIGHT ${n}`} disabled={mine}", "disabled={m.seconds <= loS || mine}", "disabled={m.seconds >= hiS || mine}", "disabled={retaking || writing || otherCam}"]) assert.ok(ui.includes(s), s);
  assert.ok(ui.includes("const retaking = retake.state !== \"idle\" || !!retakeKey;") && ui.includes("if (retake.state !== \"idle\") return;"));
});

test("THE REEL'S LOOK: every frame in its own camera's viewfinder, its clock read from its card, ticking — unless less motion was asked for", () => {
  const ui = page();
  // the marks each camera burns into its takes (camera-dress.ts): the house's date and CAM; the body cam's stamp and its
  // AI DRAMATIZATION; the camcorder's REC, tape counter and its date (footage-film.ts → camStamp); the phone's red timer
  assert.ok(ui.includes('{camera === "house" && <><b className="tl">{clock.date} {hms(clock.start + s)}</b>{cam ? <b className="bl">{cam}</b> : null}</>}'));
  assert.ok(ui.includes('{camera === "bodycam" && <><b className="tr">{clock.date.slice(0, 10)} T{hms(clock.start + s)} -0500<br />BODYCAM 412</b><b className="bl dim">AI DRAMATIZATION</b></>}'));
  assert.ok(ui.includes('<b className="bl">SP {hms(s)}</b>') && ui.includes('<b className="br ff-vf-date">{stamp.date}<br />{stamp.time}</b>') && ui.includes("const stamp = camStamp(clock);"));
  assert.ok(ui.includes('{camera === "phone" && <><b className="tc ff-vf-timer">{hms(s)}</b><i className="ff-vf-stop" /></>}'));
  // each frame's clock is the one its card gives it — the way the server works out the film's (footage-film.ts)
  assert.ok(ui.includes('const clocks = useMemo(() => footageClocks(whens.split("\\n"), today, 7), [whens, today]);'));
  // a house camera's CAM numbers: the shop's own rooms first, then each new room in the order the film comes to it
  assert.ok(ui.includes('const houseCams = shown ? [...new Set([...d.kept, ...shown.moments.map((m) => m.room || "living")])] : d.kept;'));
  // the clocks run — but not for a member who asked for less motion; and none of the new movement plays for them
  const vf = ui.slice(ui.indexOf("function Viewfinder("), ui.indexOf("export default function FoundFootage()"));
  assert.ok(vf.includes('if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;'));
  const reduce = /@media\(prefers-reduced-motion:reduce\)\{([^\n]*)\}/.exec(ui)?.[1] || "";
  for (const sel of [".ff-cut-film i.at::after", ".ff-vf-dot", ".ff-vf-osd", ".ff-vf-grain", ".ff-vf-scan::after", ".ff-mo.is-retaking .ff-dice", ".ff-reel.is-writing .ff-mo", ".ff-reel:not(.is-writing) .ff-vf-screen"]) assert.ok(reduce.includes(sel), sel);
  // (the written reel develops as it arrives — from a blown-out white to its picture, one frame after another)
  assert.ok(ui.includes(".ff-reel:not(.is-writing) .ff-vf-screen{animation:ffdev .9s ease-out both;animation-delay:calc(var(--i,0) * 160ms);}"));
  // phone-first: every box on the reel is 16px (a phone never zooms in on it); every tap is 44px
  for (const r of [/\.ff-vf-line\{[^}]*font:600 16px/, /\.ff-case textarea\{[^}]*font:500 16px/, /\.ff-room-pick\{[^}]*font:600 16px/, /\.ff-mo-card input\{[^}]*font:700 17px/, /\.ff-tape-title,\.ff-tape-name\{[^}]*font:800 20px/]) assert.ok(r.test(ui), String(r));
  for (const r of [/\.ff-ico-btn\{[^}]*min-width:44px;height:44px/, /\.ff-dicebtn\{[^}]*min-height:44px/, /\.ff-secs button\{width:44px;height:44px/, /\.ff-again-btn\{[^}]*min-height:44px/, /\.ff-chip\{[^}]*min-height:44px/, /\.ff-seg button\{[^}]*min-height:44px/, /\.ff-cut-in::-webkit-slider-thumb\{-webkit-appearance:none;width:44px/]) assert.ok(r.test(ui), String(r));
  // ON AN URDU PAGE (right to left): a camera's marks are still burned in left to right; a card is Latin capitals; every
  // box of the member's words takes its words' own direction (a reel is in the idea's language, not the page's); and a
  // mono label's letter-spacing never pulls a joined script apart
  assert.ok(ui.includes(".ff-vf{direction:ltr;}") && ui.includes('return <textarea ref={ref} rows={1} dir="auto" {...props} />;') && ui.includes('<input dir="ltr" value={m.when}'));
  assert.ok(ui.includes("[dir=rtl] .ff-mo-n,[dir=rtl] .ff-case label>span,[dir=rtl] .ff-tape-stamp,[dir=rtl] .ff-tape-sum,[dir=rtl] .ff-step-kick,[dir=rtl] .ff-shelf-h b{letter-spacing:0;}"));
  // the reel is tape in either theme: black — and in the dark it gets the gold edge every card has
  assert.ok(ui.includes(".ff-dark .ff-reel{box-shadow:0 0 0 1px rgba(231,200,121,.45)"));
});

test("every new word on the builder — and every refusal a film can give — is in all five languages", async () => {
  const ui = page();
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  const words = new Set<string>();
  for (const m of ui.matchAll(/\bt(?:r)?\(\s*(?:lang\s*,\s*)?("(?:[^"\\]|\\.)*")/g)) words.add(JSON.parse(m[1]));
  const { FOOTAGE_OUTLINE_UNREADABLE, FOOTAGE_OUTLINE_OTHER_CAMERA } = await import("../app/lib/footage-film.ts");
  words.add(FOOTAGE_OUTLINE_UNREADABLE);
  words.add(FOOTAGE_OUTLINE_OTHER_CAMERA);
  // (the writer's own two live in its server module, which a test cannot load: read as written)
  const srv = read("app", "lib", "footage-film.server.ts");
  for (const k of ["FOOTAGE_WRITER_BUSY", "FOOTAGE_NEEDS_IDEA"]) words.add(JSON.parse(new RegExp(`export const ${k} = ("[^"]+");`).exec(srv)![1]));
  const blocks = ["es", "fr", "de", "zh", "ur"];
  for (let i = 0; i < blocks.length; i++) {
    const from = dict.indexOf(`const ${blocks[i]}: Record<string, string> = {`);
    const block = dict.slice(from, i + 1 < blocks.length ? dict.indexOf(`const ${blocks[i + 1]}: Record<string, string> = {`) : dict.length);
    const missing = [...words].filter((w) => !block.includes(`\n  ${JSON.stringify(w)}:`));
    assert.deepEqual(missing, [], `${blocks[i]}: untranslated`);
  }
  // a placeholder is carried over word for word in every translation
  const ph = (s: string) => (s.match(/\{[a-z]+\}/g) || []).sort().join(",");
  for (const w of [...words].filter((x) => /\{[a-z]+\}/.test(x))) {
    const found = [...dict.matchAll(new RegExp(`\\n  ${JSON.stringify(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: ("(?:[^"\\\\]|\\\\.)*"),`, "g"))];
    assert.ok(found.length >= 5, `${w}: ${found.length} translations read`);
    for (const m of found) assert.equal(ph(JSON.parse(m[1])), ph(w), w);
  }
});
