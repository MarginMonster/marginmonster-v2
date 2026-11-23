/* Kling reads 2,500 characters of prompt. For a week the Short Film clip prompt ran 2,700–3,100: one
 * provider refused every shot and the other quietly cut the end off — the camera-lock, no-sound-effects
 * and no-on-screen-text rules never reached the model (its own log said "Prompt too long, truncating to
 * 2500 chars"). These tests keep the prompt inside what the model actually reads, and make sure that
 * when something has to give, it is never those rules. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { KLING_PROMPT_MAX, clampKlingPrompt, clipRules, fitClipPrompt } from "../app/lib/clip-prompt.ts";

/** A stand-in for the talking directions: whole sentences, exactly `n` characters. */
function talk(n: number): string {
  let s = "";
  while (s.length < n) s += "Only one person speaks and says the line exactly once. ";
  return s.slice(0, n - 1).trimEnd().padEnd(n - 1, "x") + ".";
}

// Sizes measured from the two prompts production really sent on Nov 17 2026 (3,071 and 3,047 chars in
// total): about 1,460 characters of talking directions plus a ~115-character voice-timbre sentence.
const REAL_TALK = 1460;
const TIMBRE = " Madalynn's voice is warm, upbeat and easy to trust (a friendly female voice); keep this exact voice in every shot.";

const KINDS = [
  { cartoon: false, sing: false }, { cartoon: true, sing: false },
  { cartoon: false, sing: true }, { cartoon: true, sing: true },
];

test("the prompt that was being sent really was over the cap", () => {
  // talking + timbre + the old look / style / steady / no-text notes (819 + 64 + 230 + 381) and 4 spaces
  assert.ok(REAL_TALK + TIMBRE.length + 819 + 64 + 230 + 381 + 4 > KLING_PROMPT_MAX);
});

test("a typical shot carries every rule, in full, inside the cap", () => {
  for (const kind of KINDS) {
    const rules = clipRules(kind);
    const r = fitClipPrompt({ voice: talk(REAL_TALK), voiceDesc: TIMBRE, ...rules });
    assert.ok(r.prompt.length <= KLING_PROMPT_MAX, `${r.prompt.length} chars`);
    assert.equal(r.gaveUp, "", "nothing should have to give on a typical shot");
    for (const part of [TIMBRE.trim(), rules.look, rules.style, rules.steady, rules.noText]) assert.ok(r.prompt.includes(part));
  }
});

test("the standing rules stay inside their budget", () => {
  // A real shot's talking directions + voice timbre come to ~1,575 characters, leaving 925. If these
  // notes grow past 900 the full look-note stops fitting on ordinary shots — which is how this went
  // wrong the first time (they were 1,494).
  for (const kind of KINDS) {
    const r = clipRules(kind);
    const total = r.look.length + r.style.length + r.steady.length + r.noText.length + 4;
    assert.ok(total <= 900, `${JSON.stringify(kind)} standing rules are ${total} chars`);
    assert.ok(r.lookTight.length < r.look.length && r.lookShort.length < r.lookTight.length);
  }
});

test("a longer line steps the look-note down — never the camera, audio or no-text rules", () => {
  const rules = clipRules({ cartoon: false, sing: false });
  const r = fitClipPrompt({ voice: talk(1700), voiceDesc: TIMBRE, ...rules });
  assert.ok(r.prompt.length <= KLING_PROMPT_MAX);
  assert.match(r.gaveUp, /look-note/);
  assert.ok(!r.prompt.includes(rules.look));
  assert.ok(r.prompt.includes(rules.lookTight) || r.prompt.includes(rules.lookShort));
  assert.ok(r.prompt.includes(rules.steady) && r.prompt.includes(rules.noText));
  assert.ok(r.prompt.includes(TIMBRE.trim()), "the voice timbre is the last thing to go");
});

test("a line too long for everything still ends with the camera, audio and no-text rules", () => {
  const rules = clipRules({ cartoon: false, sing: false });
  const r = fitClipPrompt({ voice: talk(2600), voiceDesc: TIMBRE, ...rules });
  assert.ok(r.prompt.length <= KLING_PROMPT_MAX);
  assert.ok(r.prompt.endsWith(`${rules.steady} ${rules.noText}`));
  assert.match(r.gaveUp, /line too long/);
});

test("whatever the sizes, the prompt is never over the cap and never loses the rules", () => {
  for (const kind of KINDS) {
    const rules = clipRules(kind);
    for (let n = 60; n <= 4200; n += 37) {
      const r = fitClipPrompt({ voice: talk(n), voiceDesc: n % 2 ? TIMBRE : "", ...rules });
      assert.ok(r.prompt.length <= KLING_PROMPT_MAX, `talk=${n}: ${r.prompt.length} chars`);
      assert.ok(r.prompt.endsWith(rules.noText), `talk=${n}: the no-text rule must be the last thing in the prompt`);
      assert.ok(r.prompt.includes(rules.steady), `talk=${n}: the camera / audio rule must be in the prompt`);
    }
  }
});

test("a prompt stored before this fix is cut at a whole sentence, not mid-word", () => {
  const stored = `${talk(1573)} ${"Keep everyone exactly as they are. ".repeat(40)}The camera stays locked. No on-screen text at all.`;
  assert.ok(stored.length > KLING_PROMPT_MAX);
  const cut = clampKlingPrompt(stored);
  assert.ok(cut.length <= KLING_PROMPT_MAX);
  assert.match(cut, /[.!?]$/);
  assert.ok(stored.startsWith(cut), "only the tail is removed");
});

test("a prompt that already fits is left alone", () => {
  assert.equal(clampKlingPrompt("She says one line.  Nothing else. "), "She says one line. Nothing else.");
  const exact = talk(KLING_PROMPT_MAX);
  assert.equal(clampKlingPrompt(exact), exact);
});

test("an acted, spoken, live-action shot has a living background — the speakers hold their places", () => {
  // A tester, 2026-11-23, on Short Film and Horror Film: "scenes looks more real, backend moves, live real
  // day life, not stuck." The note had told the model "identical … background throughout" and "Nobody
  // moves except natural talking" — and the people behind the speakers stood frozen for the whole shot.
  const r = clipRules({ cartoon: false, sing: false });
  for (const note of [r.look, r.lookTight]) {
    assert.ok(note.includes("The speakers hold their places"), "it is the speakers who stay put");
    assert.ok(/background stays (?:alive with gentle natural motion|gently alive)/.test(note));
    assert.ok(note.includes("nothing new enters"), "what is there moves; nobody walks in");
    assert.ok(!note.includes("Nobody moves"), "nobody is told to freeze");
    assert.ok(!/lighting and background/.test(note), "the background is no longer to be held identical");
    // everything that keeps a face a face is still there
    assert.ok(note.includes("Keep EVERYONE and the setting EXACTLY as in the starting image"));
    assert.ok(/Add NO new object; anything already held (?:keeps its exact|stays the same) size and shape in the same hand\./.test(note));
  }
  assert.ok(r.look.includes("every beard, mustache and bit of stubble stays exactly as it is"));
  assert.ok(r.look.includes("Do NOT morph, age or redraw anyone."));
  // the camera does not start to wander because the world does
  assert.ok(r.steady.startsWith("The camera stays LOCKED and level — no rotation, tilt, flip or zoom."));
  // a cartoon and a sung shot keep the note they were approved with
  for (const kind of [{ cartoon: true, sing: false }, { cartoon: false, sing: true }, { cartoon: true, sing: true }]) {
    const k = clipRules(kind);
    assert.ok(k.look.includes("Nobody moves except natural talking and small, subtle head and expression shifts."), JSON.stringify(kind));
    assert.ok(!k.look.includes("background stays alive"));
  }
  // the standing rules of the spoken shot sit exactly on their budget — a word more and a typical shot
  // would lose the full note
  assert.equal(r.look.length + r.style.length + r.steady.length + r.noText.length + 4, 900);
});
