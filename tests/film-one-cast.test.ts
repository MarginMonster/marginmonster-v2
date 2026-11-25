/* ONE PLACE TO CAST A FILM (2026-11-25).
 *
 * The owner, with photos of the Movie Maker: "It looks like there is two cast selection cards per story
 * (Bottom one comes across as extra)" — and, after trying a Moral Film: "again moral film also expands the
 * second cast option at the bottom, but we can do this in the top".
 *
 * What he saw: the step card "THE STARS · Cast" picks who stars BEFORE a script exists, and once the script
 * was written a whole second section — "Cast your movie" — opened under it for the script's characters (a
 * face, a look and a voice each). Two places for one decision.
 *
 * Now the Cast STEP is the only cast UI on the page, for every story format:
 *   - before a script its panel is what it was: "We cast it", or pick who stars;
 *   - once an acted film HAS a script the SAME panel holds the script's characters — every control the old
 *     section had — and the picker of before sits behind one quiet line, "Start over with different stars"
 *     (a pick there rewrites the script, so it still asks twice);
 *   - the step's CARD says what is true at a glance: the characters' faces (lettered discs for those not
 *     cast), their names, "1/2 cast" — and, until it has been opened once, asks to be;
 *   - nothing opens by itself and Generate waits on none of it; what is set still reaches the form.
 *
 * The page cannot run here (no local database): the card's summary is RUN below from the route's own source,
 * the wiring is pinned, and the markup itself was photographed in a harness built from the route's own JSX. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const ui = read("app", "routes", "web.film.tsx");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const between = (s: string, from: string, to: string) => {
  const a = s.indexOf(from);
  assert.ok(a >= 0, `missing: ${from}`);
  const b = s.indexOf(to, a + from.length);
  assert.ok(b > a, `missing after ${from}: ${to}`);
  return s.slice(a, b);
};

// THE CAST STEP: its card, and its panel (the panels of the other steps follow it)
const card = between(ui, "            {/* 1 · Cast — the ONE place a film is cast.", "            {/* (How it's told is not a step any more");
const panel = between(ui, '            {storyCard === "cast" && (', '            {storyCard === "length" && (');
// THE STORY FORM (the only paid step): everything a film is made from is posted from here
const form = between(ui, '<Form method="post" onSubmit={() => { sigAtSubmit.current = storySig; }}>', "</Form>");

test("the page has exactly ONE cast UI: the bottom section is gone, and its rows are inside the Cast step's panel", () => {
  // the second place — its card, its heading — is no longer in the route
  assert.ok(!ui.includes("fs-caststage"));
  assert.ok(!ui.includes('t("Cast your movie")'));
  assert.ok(!ui.includes("{treatment && isStoryboard && !narrated && cast.length > 0 && (() => {"), "nothing else opens when a script arrives");
  // ONE list of the script's characters on the page, and it is in the step's panel
  assert.equal(count(ui, '<div className="fs-cast">'), 1);
  assert.equal(count(ui, "{cast.map((c, i) => {"), 1);
  assert.ok(panel.includes('<div className="fs-cast">\n                    {cast.map((c, i) => {'));
  // …shown once an ACTED film has its script — one definition, used by the card and the panel alike
  assert.equal(count(ui, "const scripted = !!treatment && isStoryboard && !narrated && cast.length > 0;"), 1);
  assert.ok(panel.includes('<div className={`mm-opts mm-opts-grid${scripted ? " mm-castpanel" : ""}`} style={{ order: 2 }}>'), "the same panel, right under the step's card");
  assert.ok(panel.includes("{scripted && (<>"));
  // the step is the story builder's, so it is there for every story format, acted or told
  const builder = between(ui, "      {isStoryboard && (() => {", "\n        );\n      })()}");
  assert.ok(builder.includes(card) && builder.includes(panel));
  assert.equal(count(ui, 'onClick={() => tapStory("cast")}'), 1, "one card opens it");

  // EVERYTHING THE BOTTOM SECTION DID, here and still wired to the same handlers:
  for (const k of [
    // a face: cast one (the dashed frame), or cast another
    '<button type="button" className="fs-actor-face fs-actor-cast" disabled={castingIndex !== null} onClick={() => makePortrait(i)} aria-label={t("Cast {name}", { name: c.name })}>',
    '<span className="fs-actor-empty"><Ico n="camera" size={22} /><b>{cbusy ? t("Casting…") : t("Cast a face")}</b></span>',
    '{c.faceUrl && <button type="button" className="fs-actor-recast" disabled={castingIndex !== null} onClick={() => makePortrait(i)}><Ico n="refresh" size={11} /> {t("Re-cast")}</button>}',
    // the name and the look (the cartoon wording for a Kids Cartoon)
    '<input className="fs-actor-name fs-actor-name-in" value={c.name} onChange={(e) => setCastName(i, e.target.value)} placeholder={t("Character name")} maxLength={40} disabled={castingIndex !== null} aria-label={t("Character name")} />',
    'onChange={(e) => setCastDesc(i, e.target.value)} placeholder={tmpl?.cartoon ? t("Describe this cartoon character — look, colors, personality") : t("Describe this character — look, age, vibe")} rows={2} maxLength={400}',
    // the voice, and hearing it
    '<select aria-label={t("Voice for {name}", { name: c.name })} value={c.voiceId || ""} disabled={castingIndex !== null} onChange={(e) => setCastVoice(i, e.target.value)}>',
    '<button type="button" className="fs-voice-play" disabled={!c.voiceId} onClick={() => playVoice(c.voiceId)} aria-label={t("Hear this voice")} title={t("Hear this voice")}><Ico n="sound" size={14} /></button>',
    // a presenter, a photo of the maker's own, removing a character
    '<summary><Ico n="presenter" size={13} /> {t("Pick a presenter")}</summary>',
    "disabled={castingIndex !== null} title={r.name} onClick={() => castPresenter(i, r)}",
    '<summary>{t("Use my own photo")}</summary>',
    'disabled={castingIndex !== null} title={g.title || t("Use this image")} onClick={() => useCastFace(i, g.url)}>',
    '<input className="fs-shot-url" type="url" maxLength={2000} defaultValue="" placeholder={t("…or paste an image URL")} onChange={(e) => useCastFace(i, e.target.value)} />',
    '{cast.length > 1 && <button type="button" className="fs-actor-del" disabled={castingIndex !== null} onClick={() => removeCastMember(i)} title={t("Remove this character")}>✕ {t("Remove")}</button>}',
    // another character (a cartoon one in a Kids Cartoon), up to eight
    '<button type="button" className="fs-cast-add" onClick={addCastMember} disabled={cast.length >= 8 || castingIndex !== null}>',
    '<span aria-hidden="true">＋</span> {tmpl?.cartoon ? t("Add a cartoon character") : t("Add a character")}',
    // Lock these voices (beta), with both of its explanations
    "{cast.some((c) => c.voiceId) && (\n                    <label className=\"fs-lockvoice\">",
    '<input type="checkbox" checked={lockVoices} onChange={(e) => setLockVoices(e.target.checked)} />',
    '<b><Ico n="mic" size={13} /> {t("Lock these voices")} <span className="fs-lockvoice-beta">{t("beta")}</span></b>',
    't("Your own voice is in this cast, so every character speaks in exactly the voice picked for them — in every shot.")',
    // a portrait that failed says so, where it was asked for
    '{portraitFetcher.data?.error && <p className="fs-err">{portraitFetcher.data.error}</p>}',
  ]) {
    assert.equal(count(panel, k), 1, k);
    assert.equal(count(ui, k), 1, `only in the panel: ${k}`);
  }
  // …and the panel still says how far the casting is — the count, then "Cast locked"
  assert.ok(panel.includes('{castSum.all ? <><Ico n="check" size={13} /> {t("Cast locked")}</> : t("{done}/{total} cast", { done: castSum.done, total: castSum.total })}'));
  assert.ok(panel.includes('{castSum.all ? t("Every shot now stars the same faces — nobody morphs. Roll camera. 🎬") : t("Give each character a face and a voice once — every shot reuses them. Tap a frame to cast it.")}'));
  // one heading for the step, with or without a script
  assert.equal(count(ui, "{t(\"Who's in it?\")}"), 1);
  assert.ok(panel.includes("<div className=\"fs-cast-head\">\n                  <div className=\"mm-opts-h\">{t(\"Who's in it?\")}</div>"));
});

test("the picker of BEFORE the script is not beside the characters: it is behind \"Start over with different stars\", and still asks twice", () => {
  // with a script the picker shows only when asked for; with none it is the panel, as it was
  assert.equal(count(panel, "{(!scripted || castOver) && (<>"), 1);
  const picker = between(panel, "{(!scripted || castOver) && (<>", "                </>)}\n              </div>");
  assert.ok(picker.includes('<div className="mm-artistpick">') && picker.includes('{t("We cast it")}') && picker.includes("{rosterFor(template).map((r) => {"));
  assert.equal(count(panel, '<div className="mm-artistpick">'), 1, "one picker, shown in either state — not a copy");
  // the line that opens it: one button, under the characters, that says what it is
  // (…and not while a face is being cast: the portrait lands by row NUMBER, so a story started over under it
  // would hand it to another story's character — reviewer, 2026-11-25)
  assert.ok(panel.includes('<button type="button" className={`mm-castover${castOver ? " on" : ""}`} aria-expanded={castOver} disabled={castingIndex !== null} onClick={() => { setCastOver((v) => !v); setWipeArm(""); }}>\n                    <Ico n="refresh" size={13} /> {t("Start over with different stars")}\n                  </button>'));
  assert.ok(ui.includes(".mm-castover:disabled{opacity:.5;cursor:default;}"));
  assert.ok(panel.indexOf('t("Start over with different stars")') > panel.indexOf('<div className="fs-cast">'), "under the script's characters");
  assert.ok(panel.indexOf('t("Start over with different stars")') < panel.indexOf('<div className="mm-artistpick">'), "and above the picker it opens");
  assert.equal(count(ui, 't("Start over with different stars")'), 1);
  // THE ARMING IS THE EXISTING ONE: every face in it goes through orArm, and the second tap is what wipes
  assert.ok(picker.includes('onClick={() => orArm("cast:", storyPick.length > 0, () => setStoryPick([]))}'));
  assert.ok(picker.includes("onClick={() => orArm(`cast:${r.id}`, true, () => toggleStoryPick(r.id))}"));
  assert.ok(picker.includes('{wipeNote("cast:")}'), "it says what the second tap does, right under the faces");
  assert.ok(ui.includes('? <p className="mm-note mm-shape-warn" role="status">{t("That starts your script over — tap it again to go ahead.")}</p>'));
  // a different cast IS a different story: the pick wipes the script and its characters (as before)…
  assert.ok(ui.includes("useEffect(() => { setTreatment(null); setSeeds(null); setFrames([]); setCast([]); }, [told, storyPick.join(\",\")]);"));
  // …and with the script gone the line closes, so the next script does not open with the picker out
  assert.ok(ui.includes("const [castOver, setCastOver] = useState(false);\n  useEffect(() => { if (!scripted) setCastOver(false); }, [scripted]);"));
  // closing the line drops a half-made choice (an armed face must not stay armed out of sight)
  assert.ok(panel.includes('setCastOver((v) => !v); setWipeArm("");'));
});

test("what the step sets still reaches the story form — the hidden inputs live in the form, not in the panel", () => {
  for (const k of [
    // the stars picked before the script
    '{isStoryboard && pickedCast.length > 0 && <input type="hidden" name="filmCast" value={filmCastJson} />}',
    // the script's characters: name, face, voice — and what a character IS when it is not a person
    '{isStoryboard && !narrated && cast.some((c) => c.faceUrl || c.voiceId) && <input type="hidden" name="cast" value={JSON.stringify(cast.map((c) => ({ name: c.name, faceUrl: c.faceUrl, voiceId: c.voiceId, ...(c.faceUrl && c.kind && c.kind !== "person" ? { kind: c.kind, look: c.look || "" } : {}) })))} />}',
    // Lock these voices
    '{isStoryboard && !narrated && lockVoices && cast.some((c) => c.voiceId) && <input type="hidden" name="filmLockVoices" value="1" />}',
  ]) {
    assert.equal(count(form, k), 1, k);
    assert.equal(count(ui, k), 1, k);
  }
  // the panel posts nothing itself, and is not inside the form (it is far above it)
  assert.ok(!panel.includes('type="hidden"') && !card.includes('type="hidden"'));
  assert.ok(ui.indexOf(panel) < ui.indexOf(form));
  // Generate waits on none of it: whoever has no face gets one invented, as before — what makes the button live
  // names neither the cast nor the script's characters (whatever else it comes to depend on)
  const canGo = (ui.match(/\n  const canGo = [^\n]+;\n/) || [""])[0];
  assert.ok(canGo.includes("d.hasPlan") && !/cast|scripted|faceUrl/i.test(canGo), canGo);
  // …and the film that was SENT is still judged on the cast as it stands (a new face is another film)
  const storySig = (ui.match(/\n  const storySig = [^\n]+;\n/) || [""])[0];
  assert.ok(storySig.includes("cast.map((c) => [c.name, c.faceUrl, c.voiceId])") && storySig.includes("storyPick") && storySig.includes("lockVoices"), storySig);
});

/* THE CARD'S SUMMARY, RUN — the route's own function, compiled as it stands. */
type Summary = { names: string; discs: Array<{ name: string; img: string | null; letter: string }>; more: number; done: number; total: number; all: boolean };
const castCardSummary: (cast: Array<{ name: string; faceUrl: string | null }>) => Summary = (() => {
  const src = between(ui, "const CAST_CARD_NAMES = 3;", "\n}\n") + "\n}\n";
  assert.ok(src.includes("function castCardSummary(cast: Array<{ name: string; faceUrl: string | null }>) {"));
  const ts = createRequire(import.meta.url)("typescript");
  const js: string = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(`${js}\nreturn castCardSummary;`)();
})();

test("RUN: the card's after-script summary — names, a disc each, how many have a face", () => {
  // made-up characters; pictures that are only paths
  const A = { name: "Araceli", faceUrl: null }, T = { name: "Tuan", faceUrl: null };
  // nobody cast yet: both named, a lettered disc each, 0 of 2
  assert.deepEqual(castCardSummary([A, T]), {
    names: "Araceli · Tuan",
    discs: [{ name: "Araceli", img: null, letter: "A" }, { name: "Tuan", img: null, letter: "T" }],
    more: 0, done: 0, total: 2, all: false,
  });
  // one cast: their picture is on their disc, the other keeps their letter — "1/2 cast"
  const one = castCardSummary([{ ...A, faceUrl: "/renders/test-araceli.jpg" }, T]);
  assert.deepEqual([one.done, one.total, one.all], [1, 2, false]);
  assert.deepEqual(one.discs.map((d) => d.img || d.letter), ["/renders/test-araceli.jpg", "T"]);
  // everyone cast: the tick
  const both = castCardSummary([{ ...A, faceUrl: "/renders/a.jpg" }, { ...T, faceUrl: "/renders/t.jpg" }]);
  assert.deepEqual([both.done, both.total, both.all], [2, 2, true]);
  // nobody at all is not "all cast" (no script, or its characters removed)
  assert.deepEqual(castCardSummary([]), { names: "", discs: [], more: 0, done: 0, total: 0, all: false });
  // EIGHT are allowed: three names and "+5", five discs and three more — a card half a phone wide stays a glance
  const eight = castCardSummary(["Ana", "Bo", "Cy", "Dot", "Eli", "Flo", "Gus", "Hal"].map((name, k) => ({ name, faceUrl: k === 1 ? "/renders/bo.jpg" : null })));
  assert.equal(eight.names, "Ana · Bo · Cy +5");
  assert.equal(eight.discs.length, 5);
  assert.equal(eight.more, 3);
  assert.deepEqual([eight.done, eight.total, eight.all], [1, 8, false]);
  // exactly three names: no "+0"
  assert.equal(castCardSummary(["Ana", "Bo", "Cy"].map((name) => ({ name, faceUrl: null }))).names, "Ana · Bo · Cy");
  // a character added a moment ago has no name yet: counted, shown as "?", not named — and spaces are not a name
  const added = castCardSummary([A, { name: "", faceUrl: null }, { name: "   ", faceUrl: null }]);
  assert.equal(added.names, "Araceli");
  assert.equal(added.total, 3);
  assert.deepEqual(added.discs.map((d) => d.letter), ["A", "?", "?"]);
  // the letter is the name's first CHARACTER, upper-cased — in any script, and never half of one
  assert.deepEqual(castCardSummary([{ name: "  élodie", faceUrl: null }, { name: "زینب", faceUrl: null }, { name: "小明", faceUrl: null }, { name: "𝒜da", faceUrl: null }]).discs.map((d) => d.letter), ["É", "ز", "小", "𝒜"]);
  // an empty picture is no picture
  assert.equal(castCardSummary([{ name: "Ana", faceUrl: "" }]).done, 0);
});

test("the step's CARD says what is true: before a script as it was; after, the script's characters", () => {
  // it is computed once, from the cast as it stands, for the card and the panel
  assert.ok(ui.includes("        const castSum = castCardSummary(cast);"));
  assert.equal(count(ui, "castCardSummary(cast)"), 1);
  // AFTER a script: a face or the icon, the names, a disc each, the count — or the tick when all have faces
  assert.ok(card.includes("{scripted ? (<>"));
  const after = between(card, "{scripted ? (<>", "              </>) : (<>");
  assert.ok(after.includes('<span className="mm-val mm-cast-names">{castSum.names}</span>'));
  assert.ok(after.includes('? <span key={k} className={`mm-card-castface${k === 0 ? " lead" : ""}`} style={{ backgroundImage: `url(${c.img})`, backgroundPosition: "center top", ["--i" as string]: k }} title={c.name} />'), "a portrait is shown from the head down");
  assert.ok(after.includes(': <span key={k} className="mm-card-castface is-open" style={{ ["--i" as string]: k }} title={c.name}>{c.letter}</span>))}'), "a lettered disc for one not cast yet");
  assert.ok(after.includes('{castSum.more > 0 && <span className="mm-card-castface is-more" style={{ ["--i" as string]: castSum.discs.length }}>+{castSum.more}</span>}'));
  assert.ok(after.includes('<span className={`mm-cast-count${castSum.all ? " done" : ""}`}>{castSum.all ? <><Ico n="check" size={12} /> {t("Cast")}</> : t("{done}/{total} cast", { done: castSum.done, total: castSum.total })}</span>'));
  // (the discs are decoration for the eye; the names and the count are what is read out)
  assert.ok(after.includes('<span className="mm-card-cast" aria-hidden="true">') && !after.includes('<span className="mm-cast-count" aria-hidden'));
  // BEFORE a script the card is what it was — the picked stars, the characters a told story brings back, or:
  const before = card.slice(card.indexOf("              </>) : (<>"));
  assert.ok(before.includes(': t("We invent them · or pick your own")}</span>'));
  assert.ok(before.includes("{pickedCast.length ? <><Ico n=\"check\" size={12} /> {pickedCast.map((r) => r.name).join(\" + \")}</>"));
  assert.ok(before.includes("{!pickedCast.length && seriesOwn.length > 1 && ("));
  // the lettered disc is an empty frame in the step's own violet; the count turns green when everyone is cast
  assert.ok(ui.includes(".mm-card-castface.is-open{background:#F3EFFB;border:1.5px dashed #A792D6;color:#6C4FB0;box-shadow:none;}"));
  assert.ok(ui.includes(".mm-cast-count.done{color:#fff;background:var(--green,#0C7A46);border-color:var(--green,#0C7A46);}"));
  // eight names never push the card wider than its column: two lines, then cut
  assert.ok(ui.includes(".mm-cast-names{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;"));
  assert.ok(ui.includes(".mm-cast-line{display:flex;align-items:center;justify-content:space-between;gap:6px 8px;flex-wrap:wrap;margin-top:9px;}"), "the count drops under the discs when they do not fit beside it");
});

test("a script that has just arrived makes the card ASK, once — nothing opens by itself", () => {
  // it asks while: there is a script, the step has not been opened since it came, and somebody has no face
  assert.ok(ui.includes("        const castNudge = scripted && !castSeen && !castSum.all;"));
  assert.ok(card.includes('{castNudge && <span className="mm-cast-nudge">{t("tap to give them faces (optional)")}</span>}'));
  // "opened once": the step open with a script on the page — and a script that is gone starts it again
  assert.ok(ui.includes("const [castSeen, setCastSeen] = useState(false);\n  useEffect(() => { if (!scripted) setCastSeen(false); else if (storyCard === \"cast\") setCastSeen(true); }, [scripted, storyCard]);"));
  // ONE soft pulse, kept for when the card is on screen (the script is written from the card below the steps)
  assert.ok(card.includes('<button type="button" ref={castCardRef} style={{ order: 1 }} className={`mm-card${storyCard === "cast" ? " on" : ""}${storyDone.cast ? " done" : ""}${castNudge && castLit ? " is-new" : ""}`} onClick={() => tapStory("cast")}>'));
  const lit = between(ui, "  const castCardRef = useRef<HTMLButtonElement | null>(null);", "  // THE LANGUAGE A STORY IS TOLD IN");
  assert.ok(lit.includes("if (!scripted || castSeen) { setCastLit(false); return; }"));
  assert.ok(lit.includes('if (!el || typeof IntersectionObserver === "undefined") { setCastLit(true); return; }'), "a browser without it pulses at once, as if seen");
  assert.ok(lit.includes("const io = new IntersectionObserver((seen) => { if (seen.some((e) => e.isIntersecting)) { setCastLit(true); io.disconnect(); } }, { threshold: 0.6 });"));
  assert.ok(lit.includes("return () => io.disconnect();"));
  assert.ok(ui.includes(".mm-card.is-new{border-color:var(--green2,#1EA85C);animation:mmCastNew 1.7s ease-out .15s 1;}"), "once — and no fill, so the card's own shadow comes back");
  assert.ok(ui.includes("@keyframes mmCastNew{0%{box-shadow:0 0 0 0 rgba(31,164,99,.5);}65%{box-shadow:0 0 0 13px rgba(31,164,99,0);}100%{box-shadow:0 0 0 0 rgba(31,164,99,0);}}"));
  // the discs walk on, one after another; none of it for someone who asked for less motion
  assert.ok(ui.includes(".mm-card.is-new .mm-card-castface{animation:mmCastOn .46s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,0) * 110ms + .2s);}"));
  assert.ok(ui.includes("@media(prefers-reduced-motion:reduce){.mm-card.is-new,.mm-card.is-new .mm-card-castface{animation:none;}}"));
  // NOTHING OPENS BY ITSELF: a script arriving does not open the step, and none of the step's own effects do —
  // it is opened by a tap (its card: `tapStory`)
  const arrives = between(ui, "  // When a fresh treatment arrives, adopt it (and lock the scene count to it) + cast.", "  // Store each actor's portrait as it's cast; clear the busy flag.");
  assert.ok(arrives.includes("setCast((prev) => keepCasting(castFromSeries(castFromPicked(deriveCast(tr2))), prev));") && !arrives.includes("setStoryCard"));
  const own = between(ui, "  const scripted = !!treatment && isStoryboard && !narrated && cast.length > 0;", "  // THE LANGUAGE A STORY IS TOLD IN");
  assert.ok(!own.includes("setStoryCard") && !own.includes("tapStory"));
  assert.ok(ui.includes("const tapStory = (key: StoryCard) => { setStoryCard((cur) => (cur === key ? null : key));"));
});

test("on a phone the rows are comfortable inside the panel: nothing sideways, pickers the full width, 44px to the thumb, 16px to type in", () => {
  const css = between(ui, "/* ONE PLACE TO CAST (2026-11-25): those rows INSIDE the Cast step's panel.", "@media(prefers-reduced-motion:reduce){.fs-go::after{display:none;}");
  const phone = between(css, "@media(max-width:560px){", "\n}\n");
  // the face beside the name and the look; the voice the full width under them; the options under that
  for (const k of [
    ".mm-castpanel .fs-actor-face{grid-row:1 / span 2;grid-column:1;}",
    ".mm-castpanel .fs-actor-name-in{grid-row:1;grid-column:2;min-height:44px;font-size:16px;}",
    ".mm-castpanel .fs-actor-voice{grid-row:3;grid-column:1 / -1;}",
    ".mm-castpanel .fs-actor-voice select{min-height:44px;font-size:16px;}",
    ".mm-castpanel .fs-voice-play{width:46px;}",
    ".mm-castpanel .fs-shot-url{font-size:16px;}",
    ".mm-castpanel .fs-cast-add{width:100%;justify-content:center;min-height:46px;box-sizing:border-box;}",
  ]) assert.ok(phone.includes(k), k);
  // the look: 16px in the reading face, growing with what is written where the browser can
  assert.ok(phone.includes(".mm-castpanel .fs-actor-desc-in{grid-row:2;grid-column:2;display:block;min-height:79px;max-height:230px;field-sizing:content;font-family:Inter,system-ui,sans-serif;font-weight:400;font-size:16px;line-height:1.36;}"));
  // every field a thumb types in, in the panel, is 16px (a smaller one makes an iPhone zoom the page)
  for (const field of [".fs-actor-name-in", ".fs-actor-desc-in", ".fs-actor-voice select", ".fs-shot-url"]) {
    const rule = new RegExp(`\\.mm-castpanel ${field.replace(/[.]/g, "\\.")}\\{[^}]*font-size:16px;`);
    assert.ok(rule.test(phone), field);
  }
  // the two ways to bring a face share a line; "Re-cast" and, at the far end, "Remove" the next
  assert.ok(phone.includes(".mm-castpanel .fs-actor-opts{grid-row:4;gap:12px 16px;}"));
  assert.ok(phone.includes(".mm-castpanel .fs-actor-opts > details{order:1;}") && phone.includes(".mm-castpanel .fs-actor-opts > .fs-actor-del{order:3;margin-inline-start:auto;}"));
  // the guarantees the old section had on a phone are the page's own rules still (tests/film-cast-picker-width.test.ts):
  // an opened picker takes the whole row, the row goes under the face, and the small controls have 44px to tap
  assert.ok(ui.includes(".fs-actor-opts > details[open]{flex:1 1 100%;min-width:0;}"));
  assert.ok(ui.includes("  .fs-actor-opts{grid-column:1 / -1;}"));
  for (const sel of [".fs-actor-del::after", ".fs-actor-recast::after", ".fs-shot-own summary::after"]) assert.ok(ui.includes(sel), sel);
  // the panel's own line is a full-size tap too, and the panel never needs more room than the phone has
  assert.ok(css.includes(".mm-castover{position:relative;display:flex;align-items:center;gap:7px;width:100%;min-height:44px;"));
  assert.ok(phone.includes(".mm-castpanel{padding:14px 12px;}"));
  assert.ok(phone.includes(".mm-story a.mm-pace-auto{min-height:44px;}"), "\"Create a new character\", under the faces");
  // (these phone rules come AFTER the page's general phone rules for a row, or they would lose to them)
  assert.ok(ui.indexOf(".mm-castpanel .fs-actor-face{grid-row:1 / span 2;grid-column:1;}") > ui.indexOf("  .fs-actor-face{grid-row:1 / span 3;}"));
  // where there is room the rows stay one under another, the full width of the panel: side by side, an opened
  // "Pick a presenter" was five faces across instead of thirteen (tried in the harness, and taken out)
  assert.ok(!/\.mm-castpanel \.fs-cast\{[^}]*grid-template-columns/.test(ui));
  assert.ok(ui.includes(".fs-cast{display:flex;flex-direction:column;gap:12px;margin-top:10px;}"));
});

test("small things seen in the photographs: a row's titles on one line, and a picked face's glow left whole", () => {
  // a taller Cast card left its neighbour's title floating mid-card (a button centres what it holds)
  assert.ok(ui.includes(".mm-story .mm-grid > .mm-card{display:flex;flex-direction:column;justify-content:flex-start;}"));
  // the story builder's strip of faces clipped the picked face's halo square
  assert.ok(ui.includes(".mm-story .mm-artistpick{padding:8px 8px 14px;margin:-6px -6px -4px;}"));
  assert.ok(ui.includes(".mm-story .mm-artistpick .fs-rface.on:not(.is-arm){box-shadow:0 0 0 2.5px var(--green,#0C7A46),0 0 9px -1px rgba(18,168,94,.55),0 5px 9px -5px rgba(12,122,70,.5);}"), "an armed face keeps its amber ring");
  // (both are the STORY builder's only: the Music Video's cards and strips are as they were)
  assert.equal(count(ui, ".mm-story .mm-grid > .mm-card{"), 1);
  assert.ok(ui.includes(".mm-artistpick{display:flex;gap:9px;overflow-x:auto;overflow-y:hidden;padding:2px 2px 10px;"));
});

test("every new line is translated", () => {
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Start over with different stars", "tap to give them faces (optional)"]) {
    assert.equal(count(ui, `t(${JSON.stringify(k)})`), 1, k);
    assert.equal(count(dict, `\n  ${JSON.stringify(k)}:`), 5, k);
  }
  // the lines the step took over from the section are the ones already translated
  for (const k of ["Who's in it?", "Cast locked", "{done}/{total} cast", "Cast", "Cast a face", "Re-cast", "Pick a presenter", "Use my own photo", "Remove", "Add a character", "Add a cartoon character", "Lock these voices"]) {
    assert.ok(ui.includes(`t(${JSON.stringify(k)}`), k);
    assert.equal(count(dict, `\n  ${JSON.stringify(k)}:`), 5, k);
  }
});
