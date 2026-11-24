/* KEEP IN MY CAST — a character a story invented joins the maker's own cast.
 *
 * The owner, 2026-11-24, asked whether a story's invented character should be savable as one of his
 * presenters: "yes do both". A story already draws ONE portrait of every character it invents
 * (tests/story-cast.test.ts). Keeping a character makes that portrait a PREVIEW in the one character
 * dialog — nothing is drawn again, nothing is charged — and from there it is registered exactly like any
 * other character: claimed once, charged once, by its kind, with a voice, and (for a person) its outfits
 * or (for a cartoon or a creature) the one look it has.
 *
 * What must hold:
 *   · only one of OUR render pictures can be adopted, by its bare name;
 *   · the kind and the voice group are a first GUESS from the writer's own words — the maker can change the
 *     kind before anything is charged, and what is registered is the kind they last chose;
 *   · adopting costs nothing and is not one of the day's free looks; adopting the same portrait twice is
 *     the same preview;
 *   · the way in is where the portrait is: its big view in the storyboard, and the film's "Starring" row
 *     in the Archive.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keepGuess, ownRenderPath } from "../app/lib/story-picture.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// (a checkout with CRLF line endings must read the same as one with LF: some pins below span two lines)
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("only one of our own render pictures can be kept, by its bare path", () => {
  assert.equal(ownRenderPath("/renders/img-1795480165824-e22ab06e7d02effa97.jpg"), "/renders/img-1795480165824-e22ab06e7d02effa97.jpg");
  assert.equal(ownRenderPath("https://easymodeapp.com/renders/img-1.jpg?v=3#x"), "/renders/img-1.jpg", "our own address, with its query, is the same picture");
  assert.equal(ownRenderPath("  /renders/a_b-C9.webp "), "/renders/a_b-C9.webp");
  for (const bad of ["", null, undefined, "/renders/../secret.jpg", "/renders/pic.jpg.n.jpg", "/uploads/shop-mascot-1.jpg", "/avatars/tom.png", "/renders/film.mp4", "javascript:alert(1)", "/renders/", "renders/x.jpg", "/renders/a b.jpg", "//evil.example/renders/x.jpg"]) {
    assert.equal(ownRenderPath(bad as string), null, String(bad));
  }
  // (an address on ANOTHER site is reduced to its path — and is then only ever read from OUR disk by that
  //  bare name, so it names one of our pictures or nothing)
  assert.equal(ownRenderPath("https://evil.example/renders/x.jpg"), "/renders/x.jpg");
});

test("what a story's character is, read off the writer's own words — a first guess", () => {
  // the lighthouse story, the rooster story and a ghost story — the cast as the writer described them
  assert.deepEqual(keepGuess("a weathered lighthouse keeper in his seventies with a thick white beard, deep-set grey eyes, a faded navy wool sweater and a worn oilskin coat"), { kind: "person", gender: "m" });
  assert.deepEqual(keepGuess("a young postwoman in her twenties with a dark braid tucked under a red knit cap, a yellow rain slicker, and sturdy rowing gloves"), { kind: "person", gender: "f" });
  assert.deepEqual(keepGuess("a sturdy harbor mechanic in her fifties with short grey hair, oil-stained overalls, and a thick canvas work apron"), { kind: "person", gender: "f" });
  assert.deepEqual(keepGuess("a proud rooster with glossy black-green tail feathers, a bright red comb, orange legs, and a puffed-out chest"), { kind: "cartoon", gender: "m" });
  assert.deepEqual(keepGuess("a small grey mouse with round ears, a long thin tail, tiny pink paws, and a tuft of white fur on his chest"), { kind: "cartoon", gender: "m" });
  assert.deepEqual(keepGuess("a drowned ghost in a rotted oilskin, her hair like wet rope, eyes like lamp glass"), { kind: "monster", gender: "f" });
  assert.equal(keepGuess("a hulking swamp creature with antlers and glowing eyes").kind, "monster");
  // WHAT THEY ARE is the start of the description — not what they carry, wear or stand beside
  assert.equal(keepGuess("a young baker with a cat on her shoulder").kind, "person");
  assert.equal(keepGuess("an old fisherman who fears the ghost of his brother").kind, "person");
  assert.equal(keepGuess("a night watchman in a wolf-fur coat, carrying a lantern").kind, "person");
  assert.equal(keepGuess("a little wind-up robot with one bent antenna").kind, "cartoon");
  // A HUMAN WORD MADE A CREATURE by what is said of it. The first one-press Horror Story (2026-11-24) wrote
  // its ghost with no monster word at all, and she was offered as a person (60 tokens, a presenter's outfits):
  assert.deepEqual(keepGuess("a pale drowned bride with waterlogged white wedding gown, black hollow eyes, dripping dark hair, and skin tinged blue-grey"), { kind: "monster", gender: "f" });
  assert.equal(keepGuess("a weathered night ferryman in his fifties with a grey-stubbled jaw, sunken eyes, a dark oilskin coat and a battered lantern").kind, "person", "…and the man she haunts is still a man");
  assert.equal(keepGuess("a headless rider in a black cloak").kind, "monster");
  assert.equal(keepGuess("a dead king on a throne of roots").kind, "monster");
  // …or a body no living person has, wherever the description mentions it
  assert.equal(keepGuess("a tall thin man with empty eye sockets and very long fingers").kind, "monster");
  assert.equal(keepGuess("a quiet girl in a nightgown, her skin tinged grey, her feet never touching the floor").kind, "monster");
  // kept narrow — these are living people, and a robot's lit eyes do not make it a monster
  assert.equal(keepGuess("a half-drowned sailor with a torn shirt").kind, "person");
  assert.equal(keepGuess("a dead-eyed clerk in a grey suit").kind, "person");
  assert.equal(keepGuess("a ghostly pale child in a nightgown").kind, "person");
  assert.equal(keepGuess("a tired widow with hollow eyes and a black shawl").kind, "person");
  assert.equal(keepGuess("a small tin robot with glowing blue eyes").kind, "cartoon");
  // nothing to go on: a person, offered the men's voices first (the maker changes either in the dialog)
  assert.deepEqual(keepGuess(""), { kind: "person", gender: "m" });
  assert.deepEqual(keepGuess("an elderly night watchman"), { kind: "person", gender: "m" });
  assert.equal(keepGuess("a tired mother of three").gender, "f");
  assert.equal(keepGuess("an old man who misses his wife").gender, "m", "he is the man; she is only mentioned");
});

test("adopting is free, draws nothing, and is the same preview when asked for twice", () => {
  const pv = read("app", "lib", "character-preview.server.ts");
  const fn = pv.slice(pv.indexOf("export function adoptPicture("), pv.indexOf("/** What a preview was drawn as"));
  assert.ok(!/reservePreview|repRun|brandStill|fetch\(/.test(fn), "no free look is taken and nothing is drawn or fetched");
  // the same story picture again → the same file, with the kind and the words given LAST
  assert.ok(fn.includes("const known = adoptedRecord(o.shopId, o.src);"));
  assert.ok(fn.includes("l.made[known.file] = { ...l.made[known.file], kind: o.kind, desc: o.desc, at: Date.now() };") && fn.includes("return known.file;"));
  // a new one: kept as one of the shop's own uploads, recorded with where it came from and NO reference picture
  // (registering then clears away what led to a character — never the approved picture itself)
  assert.ok(fn.includes("const name = saveReference(o.shopId, o.buf, o.ext);"));
  assert.ok(fn.includes("l.made[name] = { kind: o.kind, desc: o.desc, refFile: \"\", at: Date.now(), src: o.src };"));
  // never more than a handful waiting
  assert.ok(pv.includes("export const ADOPTED_MAX = 12;") && fn.includes("while (waiting.length >= ADOPTED_MAX) { const [file] = waiting.shift()!; removeUpload(file); delete l.made[file]; }"));
  // the ledger keeps where a preview was adopted from across a restart
  assert.ok(pv.includes("...(typeof r.src === \"string\" && r.src ? { src: r.src } : {}) };"));
  assert.ok(pv.includes("export type PreviewRecord = { kind: CharKind; desc: string; refFile: string; at: number; src?: string };"));
});

test("the server: only our own picture, screened words, and step two is the register every character has", () => {
  const api = read("app", "routes", "api.character.tsx");
  const at = api.indexOf("if (intent === \"adopt\") {");
  const reg = api.indexOf("if (intent === \"register\") {");
  assert.ok(at > 0 && reg > at, "adopt is its own step, before register");
  const fn = api.slice(at, reg);
  // behind the same two gates as every other step (a plan, and one with video)
  assert.ok(api.indexOf("if (!shop.activePlan?.active) return json(") < at && api.indexOf("if (!capabilitiesFor(shop.activePlan).has(\"video\")) {") < at);
  assert.ok(fn.includes("const src = ownRenderPath(String(form.get(\"img\") || \"\"));") && fn.includes("if (!src) return json({ error: tr(lang, \"That picture isn't one of your story's — open the story again.\") });"));
  assert.ok(fn.includes("buf = fs.readFileSync(path.join(process.cwd(), \"data\", \"renders\", path.basename(src)));"), "read from OUR disk by its bare name");
  assert.ok(fn.includes("const ext = pv.sniffImage(buf);"), "what the bytes are, not what the name says");
  // the words are screened like a typed description — once
  assert.ok(fn.includes("if (desc && (!known || known.rec.desc !== desc)) {") && fn.includes("const verdict = await screenCreatePrompt(desc);") && fn.includes("if (!verdict.ok) return json({ error: verdict.message });"));
  assert.ok(fn.includes("const file = pv.adoptPicture({ shopId: shop.id, kind, desc, src, buf, ext });"));
  assert.ok(fn.includes("return json({ preview: { file, refFile: \"\", kind, left: pv.previewsLeft(shop.id) } }, noStore);"), "the same answer a drawn preview gives");
  assert.ok(!/spendTokens|enqueueJob|reservePreview|customAvatar\.create/.test(fn), "nothing is charged, queued, counted or created by adopting");
  // …and registering is untouched: the kind (and so the price) is read from the record, never the form
  assert.ok(api.includes("const rec = pv.claimPreview(shop.id, fileName);") && api.includes("const kind = rec.kind;"));
  assert.ok(api.includes("const forgeCost = kind === \"person\" ? TOKEN_COST.avatarForge : TOKEN_COST.characterForge;"));
});

test("the dialog opens ON the character: their portrait, name and words — and the kind can still be changed", () => {
  const cf = read("app", "components", "CharacterForge.tsx");
  assert.ok(cf.includes("export type ForgeSeed = { img: string; name: string; look: string; kind: CharKind; gender: \"f\" | \"m\" };"));
  assert.ok(cf.includes("export function CharacterForge({ open, onClose, seed }: { open: boolean; onClose: () => void; seed?: ForgeSeed | null }) {"));
  // opened on a seed: filled in from the story and adopted at once
  assert.ok(cf.includes("const seedKey = open && seed ? seed.img : \"\";"));
  assert.ok(cf.includes("setName(seed.name.trim().slice(0, 40)); setGender(seed.gender); setVoice(voiceFor(seed.kind, seed.gender)); setEnergy(\"warm\"); setRegistering(false);"));
  assert.ok(cf.includes("adopt(seed, seed.kind);") && cf.includes("fd.set(\"intent\", \"adopt\");") && cf.includes("fd.set(\"img\", s.img);"));
  // the portrait is on screen at once (it is the story's own picture) — but Register waits for the preview
  assert.ok(cf.includes("<img src={preview ? `/uploads/${preview.file}` : seed ? seed.img : \"\"} alt={t(\"Your character\")} />"));
  assert.ok(cf.includes("disabled={drawing || registrar.state !== \"idle\" || !name.trim() || !canCreate || !preview} onClick={register}>"));
  // "a cartoon, not a person": the same portrait kept as another kind — the price on the button follows
  assert.ok(cf.includes("if (!seed || (k === kind && preview)) return;") && cf.includes("setKind(k); setVoice(voiceFor(k, gender));\n    adopt(seed, k);"));
  assert.ok(cf.includes("const cost = d ? (kind === \"person\" ? d.costs.person : d.costs.character) : null;"));
  // no "Try another" on a kept character (it would draw someone else); the plain dialog is as it was
  assert.ok(cf.includes("{!preview && !seed ? ("));
  assert.ok(cf.includes(") : preview ? (") && cf.includes("onClick={() => askPreview(preview.refFile)}"));
  // afterwards the maker stays with their story: "Done", and the cast opens beside it
  assert.ok(cf.includes("<button type=\"button\" className=\"wb-btn cf-go\" onClick={close}>{t(\"Done\")}</button>"));
  assert.ok(cf.includes("<Link className=\"cf-again\" to=\"/web/presenters?show=mine\" target=\"_blank\" rel=\"noopener\">{t(\"See your cast\")}</Link>"));
});

test("the way in is where the portrait is: its big view in the storyboard, and the film's cast in the Archive", () => {
  const film = read("app", "routes", "web.film.tsx");
  assert.ok(film.includes("const star = narrated ? (seeds?.castCards || []).find((c) => c.img === zoomImg) : undefined;"), "only a character the story invented — a picked presenter is already in the cast");
  assert.ok(film.includes("setKeep({ img: star.img, name: star.name, look: star.look, ...keepGuess(star.look) }); setZoomImg(null);"));
  assert.ok(film.includes("<CharacterForge open={!!keep} seed={keep} onClose={() => setKeep(null)} />"));
  assert.ok(film.includes("const FS_STYLE = `\n${VOICE_UI_CSS}\n${FORGE_CSS}\n${SPIN_STAGE_CSS}"), "the dialog's styles ride with the page");
  assert.ok(film.includes(".mm-lightbox-keep{position:fixed;left:50%;bottom:max(22px,env(safe-area-inset-bottom,0px));transform:translateX(-50%);"));
  assert.ok(film.includes("min-height:48px;max-width:calc(100vw - 32px);"), "a finger-sized button that never runs off a phone");
  const arc = read("app", "routes", "web.archive.tsx");
  assert.ok(arc.includes("{viewer.stars.map((c) => c.own ? ("));
  assert.ok(arc.includes("onClick={() => setKeep({ img: c.img, name: c.name, look: c.look || \"\", ...keepGuess(c.look || \"\") })} title={t(\"Keep {name} in your cast\", { name: c.name })}>"));
  assert.ok(arc.includes("{viewer.stars.some((c) => c.own) && <p className=\"wa-vstars-hint\">{t(\"Tap a character to keep them in your cast.\")}</p>}"));
  assert.ok(arc.includes("<CharacterForge open={!!keep} seed={keep} onClose={() => setKeep(null)} />"));
  assert.ok(arc.includes("const WA_CSS = `\n${VOICE_UI_CSS}\n${FORGE_CSS}\n"));
  // the viewer's keys stand down while the dialog is over it (Esc closed both; the arrows changed the piece behind a name box)
  assert.ok(arc.includes("keepOpen.current = !!keep;") && arc.includes("      if (keepOpen.current) return;\n      if (e.key === \"Escape\") { setViewer(null); return; }"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of [
    "Keep {name} in your cast", "Keep {name} in my cast", "Tap a character to keep them in your cast.",
    "Straight from your story — the same face. Name them, pick a voice and register; then cast them in any film.",
    "a person gets outfits; a cartoon or a creature keeps this look",
    "That picture isn't one of your story's — open the story again.", "That picture is no longer here — draw the story's cast again.",
    "We couldn't bring them over that time — nothing was charged. Try again.",
    // (the character dialog's older messages had never been translated)
    "Give your character a name.", "Not enough tokens to create a character.", "Couldn't register them — your tokens were returned. Try again.",
  ]) assert.equal(dict.split(`${JSON.stringify(k)}:`).length - 1, 5, k);
});
