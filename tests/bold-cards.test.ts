/* BOLD CAPTION CARDS, CUT WHERE THEY READ BEST — and a faceless video you can hear.
 *
 * 2026-11-23: a faceless video made as a customer would make one ("a lighthouse keeper named Wren
 * Oakhollow and her cat Biscuit…") showed its words three at a time wherever the count ran out:
 * "KEEPER HEARD A", "FLATTENED, AND HE", "STOPPED, AND THE", "IT A SLOW" (the colon after "it" had
 * vanished). The same video measured -31.5 LUFS — fifteen decibels under everything else we make.
 *
 * The cards are now the best cut of each phrase: none ends on a word that leans on the next card, none
 * is a stray last word, a comma is where a card ends rather than something in the middle of one — by
 * language, since the leaning words are not the same ones. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOLD_LINE, PAUSE_PULL, boldCards, drawable, evenParts, saidUnits, sceneWindows, scriptWordTimes, subtitleCards, subtitleChars } from "../app/lib/narrated-core.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => fs.readFileSync(path.join(root, "app", "lib", f), "utf8").replace(/\r\n/g, "\n");
const cardsOf = (lines: string[], lang?: string): string[] => boldCards(scriptWordTimes(lines, [], sceneWindows(lines, [], lines.length * 6)), lang).map((c) => c.text);

// the script of the real video
const KEEPER = [
  "A lighthouse keeper heard a ship's bell on a night with no ships.",
  "Her name was Wren Oakhollow, and her only company was a cat named Biscuit.",
  "That night the fog rolled in thick, swallowing the sea whole.",
  "Then she heard it: a slow, clanging bell, somewhere out past the rocks.",
  "Biscuit's ears flattened, and he refused to go near the window.",
  "Wren checked the charts twice: no vessel was due for miles.",
  "The bell rang three times, then stopped, and the fog simply vanished.",
];

test("the real faceless script: no card ends on a word that leans on the next one", () => {
  const cards = cardsOf(KEEPER, "en");
  const all = cards.join(" | ");
  for (const bad of ["KEEPER HEARD A", "FLATTENED, AND HE", "STOPPED, AND THE", "IT A SLOW"]) assert.ok(!cards.includes(bad), `${bad} — in: ${all}`);
  for (const c of cards) assert.ok(!/ (A|AN|THE|AND|OR|OF|TO|IN|ON|AT|WITH|HER|HIS|NO)$/.test(c), `"${c}" ends leaning — in: ${all}`);
  // a name stays whole, a reveal stays a reveal
  assert.ok(cards.includes("WREN OAKHOLLOW"), all);
  assert.ok(cards.includes("HER NAME WAS"), all);
  assert.ok(cards.includes("NEAR THE WINDOW") && cards.includes("WITH NO SHIPS") && cards.includes("AND THE FOG"), all);
  // a comma ends a card; it is not found in the middle of one
  for (const c of cards) assert.ok(!c.includes(","), `"${c}" breathes in the middle`);
  assert.ok(cards.includes("HEARD IT") && cards.includes("A SLOW") && cards.includes("CLANGING BELL"), `the colon after "it" is a pause: ${all}`);
  // every word, once, in order
  const bare = (x: string) => x.replace(/[.,…]/g, "").replace(/\s+/g, " ").trim();
  assert.equal(bare(cards.join(" ")), bare(KEEPER.flatMap(saidUnits).join(" ").toUpperCase()));
});

test("no stray word closes a phrase, and one line is still one line", () => {
  for (const [lines, lang] of [
    [KEEPER, "en"],
    [["They say his name was Howl, once. A trucker who stopped here.", "The bell rang. He did not look up."], "en"],
    [["Nobody in Harlow Creek remembers who built the house at the end of Mill Road.", "In 1981, a boy named Tobias knocked anyway."], "en"],
    [["Dicen que el viejo teatro nunca se vacía del todo después de la medianoche.", "Gus forzó la puerta que no se abría desde hacía cincuenta años."], "es"],
    [["On dit que le vieux théâtre ne se vide jamais tout à fait après minuit.", "Une lumière vacilla dans la loge royale, celle scellée depuis des décennies."], "fr"],
    [["Man sagt, das alte Theater werde nach Mitternacht nie ganz leer.", "Ein Licht flackerte in der Königsloge, jener, die seit der Premiere versiegelt war."], "de"],
  ] as Array<[string[], string]>) {
    const cards = cardsOf(lines, lang);
    for (const c of cards) {
      assert.ok(c.split(" ").length <= 3, `${lang}: "${c}"`);
      assert.ok(c.length <= BOLD_LINE || !c.includes(" "), `${lang}: "${c}" is wider than the line`);
      assert.equal(c, c.toUpperCase());
      assert.ok(!/[.,…]$/.test(c), `${lang}: "${c}"`);
    }
    const bare = (x: string) => x.replace(/[.,…]/g, "").replace(/\s+/g, " ").trim();
    assert.equal(bare(cards.join(" ")), bare(lines.flatMap(saidUnits).join(" ").toUpperCase()), `${lang}: every word once, in order`);
  }
  const howl = cardsOf(["They say his name was Howl, once. A trucker who stopped here."], "en");
  assert.deepEqual(howl, ["THEY SAY", "HIS NAME WAS", "HOWL, ONCE", "A TRUCKER", "WHO STOPPED HERE"], "the two-word close keeps its comma rather than leave ONCE by itself");
  assert.deepEqual(cardsOf(["That night the fog rolled in thick, swallowing the sea whole."], "en").slice(-2), ["SWALLOWING", "THE SEA WHOLE"], "the lone word is never the LAST card");
});

test("the leaning words are each language's own", () => {
  // "die" is an article in German and a verb in English; "son" is "his" in French and a noun in English
  assert.deepEqual(cardsOf(["Brave men die young here."], "en"), ["BRAVE MEN DIE", "YOUNG HERE"]);
  assert.ok(!cardsOf(["Der Mann sah die alte Frau am Fenster."], "de").some((c) => c.endsWith(" DIE")), "German keeps an article with its noun");
  assert.ok(!cardsOf(["Il a pris son vieux manteau gris hier."], "fr").some((c) => c.endsWith(" SON")), "French keeps a possessive with its noun");
  assert.ok(!cardsOf(["Ella abrió la puerta vieja con una llave."], "es").some((c) => / (LA|UNA|CON)$/.test(c)));
  // an unknown language is cut as English; none at all is too
  assert.deepEqual(cardsOf(KEEPER.slice(0, 1), "xx"), cardsOf(KEEPER.slice(0, 1), "en"));
  assert.deepEqual(cardsOf(KEEPER.slice(0, 1)), cardsOf(KEEPER.slice(0, 1), "en"));
  // the callers say which language the words are in
  assert.ok(read("narrated-story.server.ts").includes("? boldCards(timed, normalizeContentLang(lang))"));
  assert.ok(read("faceless-video.server.ts").includes("const timed = scriptWordTimes(lines, words, beatWindows, undefined, speech, doubt.squeezed);\n    caps = boldCards(timed, lang);"));
  assert.ok(read("film-captions.server.ts").includes("o.style === \"bold\" || o.style === \"highlight\" ? boldCards(timed, o.lang) : subtitleCards(lines, windows, subtitleChars(W, H), timed);"));
});

test("what is drawn is still only what can be drawn", () => {
  for (const c of cardsOf(["It’s the boy's turn — \"now\", she said: 100% sure; isn't it?"], "en")) {
    assert.equal(c, drawable(c), c);
    assert.ok(!/['":;\\\[\]]/.test(c), c);
  }
});

test("a faceless video plays as loud as a story: the voice at -16, the music under it, mixed as they are", () => {
  const src = read("faceless-video.server.ts");
  assert.ok(src.includes("f.push(`[${N}:a]aresample=44100,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100[vo]`);"));
  assert.ok(src.includes("f.push(`[${N + 1}:a]aresample=44100,volume=0.18,afade=t=out:st=${Math.max(0, voDur - 1.5).toFixed(2)}:d=1.5[bg]`);"));
  assert.ok(src.includes("f.push(`[vo][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`);"), "amix halves its inputs unless told not to");
  assert.ok(src.includes("let aMap = \"[vo]\";"), "with no music the levelled voice is the sound");
  assert.ok(!src.includes("amix=inputs=2:duration=first:dropout_transition=0[aout]"), "the mix that halved the voice is gone");
  // the same recipe the stories use (they measure -16)
  const nar = read("narrated-story.server.ts");
  assert.ok(nar.includes("loudnorm=I=-16:TP=-1.5:LRA=11") && nar.includes("amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]"));
});

test("a faceless video has a title of its own, and no title is cut in the middle of a word", async () => {
  // the library showed "Faceless video — storytime: a lighthouse keeper named Wren Oakhollow and her " —
  // the topic, cut at sixty characters wherever that fell
  const src = read("faceless-video.server.ts");
  assert.ok(src.includes("title: { type: \"string\" },"), "the writer is asked for one");
  assert.equal(src.split("and a title: 2 to 6 words, what a viewer would call this video").length - 1, 2, "in both scripts");
  assert.ok(src.includes("That means every spoken LINE and the title."), "in the shop's language, like the lines");
  assert.ok(src.includes("title: `Faceless video — ${trimTitle((script.title || \"\").replace(/[\"“”]/g, \"\").trim() || topic, 60)}`,"), "its own title, else the topic — cut at a word");
  assert.ok(!src.includes("topic.slice(0, 60)"));
  assert.ok(read("music-video-pipeline.server.ts").includes("title: `Music Video — ${trimTitle(treatment.title || opts.topic || g.label, 60)}`,"));
  assert.ok(read("film-engine.server.ts").includes("title: `${tmpl.name} — ${trimTitle(treatment.title || opts.topic || product?.title || \"\", 60)}`,"));
  const { trimTitle } = await import("../app/lib/text-trim.ts");
  const cut = trimTitle("storytime: a lighthouse keeper named Wren Oakhollow and her cat Biscuit hear a ship's bell", 60);
  assert.ok(cut.length <= 60 && cut.endsWith("…") && !/\s…$/.test(cut), cut);
  assert.ok("storytime: a lighthouse keeper named Wren Oakhollow and her cat Biscuit hear a ship's bell".startsWith(cut.slice(0, -1)), "whole words only");
});

// ---- subtitles (the film look) ---------------------------------------------------------------------------
// 2026-11-23, the first wide story looked at with subtitles: a sentence too long for one card was cut one
// word before its comma ("…with barely a handful left" / "himself, offered Russo acorns…"), and a two-line
// card turned mid-clause ("He never shared a single one, terrified" / "winter would leave him…").
const FOX = [
  "Every autumn, young Russo the fox gathered acorns like his life depended on it. He never shared a single one, terrified winter would leave him with nothing.",
  "The more he piled up, the more alone and anxious he seemed to feel.",
  "Then old Bartholomew the badger, with barely a handful left himself, offered Russo acorns without a moment's hesitation.",
  "Russo finally understood: what we give away is never really lost.",
];

test("SUBTITLES turn and split at a pause when one is near the middle, evenly otherwise", () => {
  const wide = subtitleChars(1280, 720);
  const cards = subtitleCards(FOX, sceneWindows(FOX, [], 40), wide).map((c) => c.text);
  // a two-line card turns at the comma near its middle…
  assert.ok(cards.includes("He never shared a single one,\nterrified winter would leave him with nothing."), cards.join(" | "));
  assert.ok(cards.includes("The more he piled up,\nthe more alone and anxious he seemed to feel."), cards.join(" | "));
  assert.ok(cards.includes("Russo finally understood,\nwhat we give away is never really lost."), "the colon is a pause, drawn as a comma");
  // …and evenly when the only comma is far from it
  assert.ok(cards.includes("Every autumn, young Russo the fox gathered\nacorns like his life depended on it."), cards.join(" | "));
  // a sentence too long for one card is cut at its comma, not a word before it
  assert.ok(cards.includes("Then old Bartholomew the badger,\nwith barely a handful left himself,"), cards.join(" | "));
  assert.ok(cards.includes("offered Russo acorns without a moment’s hesitation."), cards.join(" | "));
  // the rules every card keeps, in every frame shape
  for (const [W, H] of [[1280, 720], [720, 1280], [720, 720]]) {
    const max = subtitleChars(W, H);
    const cs = subtitleCards(FOX, sceneWindows(FOX, [], 40), max);
    for (const c of cs) {
      const ls = c.text.split("\n");
      assert.ok(ls.length <= 2, c.text);
      for (const l of ls) assert.ok(l.length <= max, `${W}x${H}: "${l}" is ${l.length} of ${max}`);
    }
    assert.equal(cs.map((c) => c.text.replace(/\n/g, " ")).join(" "), FOX.flatMap(saidUnits).join(" "), `${W}x${H}: nothing lost, nothing added`);
  }
});

test("the even split is drawn to a pause only when asked, and only as far as PAUSE_PULL", () => {
  const sen = saidUnits("Then old Bartholomew the badger, with barely a handful left himself, offered Russo acorns without a moment's hesitation.");
  assert.equal(evenParts(sen, 2)[0].slice(-1)[0], "left", "plain: the evenest cut");
  assert.equal(evenParts(sen, 2, true)[0].slice(-1)[0], "himself,", "at pauses: the comma eleven letters on");
  assert.ok(PAUSE_PULL >= 8 && PAUSE_PULL <= 16);
  // a comma far from the even point does not pull the cut
  const far = saidUnits("Well, the old lighthouse keeper walked slowly down the long winding stairs to the cold wet rocks below");
  assert.deepEqual(evenParts(far, 2, true), evenParts(far, 2));
  // nothing changes where there is no pause at all
  const none = "the quick brown fox jumps over the lazy dog again and again".split(" ");
  assert.deepEqual(evenParts(none, 3, true), evenParts(none, 3));
});
