/* THE CAST ID CARD WHERE THE CAST IS CHOSEN (2026-11-22).
 *
 * The owner asked for an ID card "on hover or avatar inspection … with descriptions along with the 3D
 * animation". The Presenters section had it (tests/presenter-idcard.test.ts); the Movie Maker, where a
 * member actually PICKS their cast, did not. Now every picker of a face there has it:
 *   - the story formats' cast step, the music video's star and co-stars, a scene's "add to this scene",
 *     and the acted film's roster — ONE hook (useCastPeek) and ONE layer (<CastPeek>) for all four;
 *   - with a mouse: the same floating card, the same delay and placement, their figure turning;
 *   - with a finger: a tap still picks; HOLD a face and its card opens as a sheet, with one button that
 *     picks them. A hold is never also a pick. One quiet line says so, on touch screens only.
 * What the card says is ONE mapping (idCardOf, in the card's own module) for both pages, and the loader
 * sends only what the card reads — the turning figure's frames are fetched when a card is shown.
 *
 * Not looked at on a real phone or in a running app (there is no local database): the hook itself is RUN
 * below, with made-up faces, against a stand-in for React's hooks and a mock clock. */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const film = read("app", "routes", "web.film.tsx");
const page = read("app", "routes", "web.presenters.tsx");
const card = read("app", "components", "CastIdCard.tsx");
const between = (s: string, from: string, to: string) => {
  const a = s.indexOf(from);
  assert.ok(a >= 0, `missing: ${from}`);
  const b = s.indexOf(to, a + from.length);
  assert.ok(b > a, `missing after ${from}: ${to}`);
  return s.slice(a, b);
};

/* THE REAL MODULE, RUN — compiled as it is, with stand-ins for what it draws with, and (for the hook) a
 * small stand-in for React's useState / useRef / useEffect: enough to call the hook, act on what it hands
 * a face, and call it again, as a re-render would. */
const require = createRequire(import.meta.url);
type Peek = {
  at: { id: string; anchor: unknown } | null;
  held: { id: string; anchor: unknown } | null;
  bind: (id: string) => Record<string, (e?: unknown) => void> & { "data-cast-hold": string };
  close: () => void;
};
type Mod = {
  idCardOf: (c: Record<string, unknown>, t: (s: string) => string) => Record<string, unknown>;
  useCastPeek: (enabled?: boolean) => Peek;
  CAST_HOLD_MS: number; CAST_HOLD_SLOP: number; CAST_ENERGY: Record<string, string>;
};
const js: string = (() => {
  const ts = require("typescript");
  return ts.transpileModule(card, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
})();
const load = (react: unknown): Mod => {
  const React = require("react") as { createElement: (...a: unknown[]) => unknown };
  const standIns: Record<string, unknown> = {
    react: react || React,
    "../lib/icons": { Ico: () => null },
    "../lib/ui-lang": { useT: () => (s: string) => s },
    "./SpinStage": { SpinStage: () => null },
  };
  const m = { exports: {} as Record<string, unknown> };
  new Function("exports", "require", "module", js)(m.exports, (spec: string) => (spec in standIns ? standIns[spec] : require(spec)), m);
  return m.exports as unknown as Mod;
};

function hooks() {
  const slots: unknown[] = [];
  let at = 0;
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const useEffect = (fn: () => void | (() => void), deps?: unknown[]) => {
    const k = at++;
    const prev = slots[k] as { deps?: unknown[]; cleanup?: void | (() => void) } | undefined;
    if (prev && same(prev.deps, deps)) return;
    if (prev && typeof prev.cleanup === "function") prev.cleanup();
    slots[k] = { deps, cleanup: fn() };
  };
  const react = {
    useState: (init: unknown) => {
      const k = at++;
      if (!(k in slots)) slots[k] = typeof init === "function" ? (init as () => unknown)() : init;
      return [slots[k], (v: unknown) => { slots[k] = typeof v === "function" ? (v as (p: unknown) => unknown)(slots[k]) : v; }];
    },
    useRef: (init: unknown) => { const k = at++; if (!(k in slots)) slots[k] = { current: init }; return slots[k]; },
    useEffect,
    useLayoutEffect: useEffect,
  };
  return { react, begin: () => { at = 0; } };
}

test("ONE mapping: what a card says comes from the card's own module, for the Presenters section and the Movie Maker alike", () => {
  // it lives in the card's module…
  assert.ok(card.includes("export const idCardOf = (c: CastCardSource, t: Tr) => ({"));
  assert.ok(card.includes("export const castVoiceWord = ("));
  assert.ok(card.includes("export function castAgeText(desc: string): string {"));
  assert.ok(card.includes("export const castSentence = (s: string) => {"));
  // …and neither page keeps a copy of its own
  for (const src of [page, film]) {
    assert.ok(!/const idCardOf\b|const ENERGY\b|const DECADE\b|function ageText\(a/.test(src));
  }
  // the Presenters section uses it, as it was (it only counts a member's outfits from their looks)…
  assert.ok(page.includes("import { CastIdCard, CastFigure, CastHoverCard, useCastHover, CAST_ID_CSS, idCardOf, castVoiceWord, castAgeText, castSentence } from \"../components/CastIdCard\";"));
  assert.ok(page.includes("const cardOf = (c: Member, t: T) => idCardOf({ ...c, outfits: c.looks.length, has3d: c.looks.some((l) => !!l.spin) }, t);"));
  assert.equal(count(page, "{...cardOf("), 2, "the character view and the floating card");
  // …and so does the Movie Maker, for every face it shows a card for
  assert.ok(film.includes("import { CastFigure, CastHoverCard, CastIdCard, CAST_ID_CSS, castAgeText, castSentence, idCardOf, useCastPeek, type CastCardSource } from \"../components/CastIdCard\";"));
  assert.equal(count(film, "idCardOf("), 1);
  assert.ok(film.includes("...idCardOf({ ...c, id: x.r.id, name: x.r.name, kind: x.r.kind, custom: x.r.custom }, t),"));
  // the loader's text comes through the same helpers the Presenters loader uses
  assert.ok(page.includes("const ageText = (a: Avatar): string => castAgeText(a.desc);") && page.includes("const sentence = castSentence;"));
  assert.ok(film.includes("vibe: a.vibe, about: castSentence(a.desc), age: castAgeText(a.desc), energy: a.energy,"));

  // RUN: a face as the Movie Maker's loader sends it gives the card the Presenters section would show
  const mod = load(null);
  const t = (s: string) => `[${s}]`;
  const face = { id: "zz-test", name: "Test Person", kind: "person", custom: false, vibe: "Fake host", about: "A made-up person.", age: "Mid 20s", energy: "hype", voice: "Bright", voiceOwn: false, signature: true, outfits: 2, has3d: true };
  assert.deepEqual(mod.idCardOf(face, t), { id: "zz-test", name: "Test Person", kind: "person", role: "Fake host", age: "Mid 20s", energy: "[Upbeat]", voice: "[Bright]", outfits: 2, has3d: true, about: "A made-up person." });
  // no voice chosen: a designed one is their "Signature", anyone else's is "Automatic"; a recorded one is its own name
  assert.equal(mod.idCardOf({ ...face, voice: "" }, t).voice, "[Signature]");
  assert.equal(mod.idCardOf({ ...face, voice: "", signature: false }, t).voice, "[Automatic]");
  assert.equal(mod.idCardOf({ ...face, voice: "Grandad's voice", voiceOwn: true }, t).voice, "Grandad's voice");
  assert.deepEqual(mod.CAST_ENERGY, { hype: "Upbeat", warm: "Warm", calm: "Calm" });
});

test("the loader sends what the card reads — text and counts, never the figure's frames", () => {
  const loader = between(film, "export const loader = async", "  return json({");
  const cardOf = between(loader, "  const cardOf = (a: Avatar)", "  const roster = favouritesFirst([");
  const fields = [...between(cardOf, "    return {", "    };\n").replace("Array.from({ length: outfits }", "").matchAll(/(?:^|[\s,{])([a-zA-Z0-9]+):/g)].map((m) => m[1]);
  assert.deepEqual(fields.sort(), ["about", "age", "cut", "energy", "has3d", "outfits", "signature", "spin", "vibe", "voice", "voiceOwn"].sort());
  // only the BUILT-IN faces have a card; one the shop made (or an uploaded photo) behaves as it did
  assert.equal(count(loader, "card: cardOf(a) })"), 2, "the live presenters and the stock characters");
  assert.ok(loader.includes('look: (c.desc || "").slice(0, 220), card: null })'), "the shop's own faces: no card");
  assert.ok(film.includes("if (!r?.card) return undefined; // a face the shop made, or an uploaded photo: no card — as before"));
  // THE FRAMES are not in it: a rotation is ONE descriptor (where its frames are, how many, how big) — no
  // frame list, no per-outfit pictures, nothing inlined
  assert.ok(cardOf.includes("cut: stockCut(a.id, 0), spin: stockSpin(a.id, 0),"));
  assert.ok(!/spinFrame|looks\s*:|imgs\s*:|base64|data:image|\.map\(\(v\) => avatarImg/.test(cardOf));
  assert.ok(!film.includes("spinFrame") && !film.includes("<SpinStage"), "the page never draws a frame itself");
  // …they are fetched by the turning figure, which exists only inside a card that is being shown
  assert.equal(count(film, "<CastFigure"), 1);
  const peekCard = between(film, "function peekCard(", "/** THE CAST ID CARD of the Movie Maker's pickers");
  assert.ok(peekCard.includes("figure: <CastFigure spin={c.spin} img={c.cut || x.r.img} name={x.r.name} />,"));
  assert.equal(count(film, "peekCard("), 3, "defined once, used by the floating card and by the sheet");
  // what the voice is called: the shop's own recording, a character voice, a catalogue voice — as on Presenters
  assert.ok(cardOf.includes('voice: own ? own.label : characterVoice(vid)?.label || AVATAR_VOICES.find((v) => v.id === vid)?.label || "",'));
  assert.ok(cardOf.includes("const vid = stockVoice[a.id] || a.voiceId || \"\";"));
  assert.ok(page.includes("...voiceInfo(stockVoice[a.id] || a.voiceId, a.id),"), "the same voice the Presenters loader reads");
  // outfits: the ones they came with and the ones saved for them, as the Presenters section counts them
  assert.ok(cardOf.includes("const outfits = Math.min(OUTFITS.length, stockLooks(a.id));"));
  assert.ok(cardOf.includes("outfits: outfits + (savedLooks[a.id] || []).length,"));
  assert.ok(page.includes("Array.from({ length: Math.min(OUTFITS.length, stockLooks(a.id)) }"));
  // the cloned voices are read once, and still go to the page as before
  assert.equal(count(loader, "shopVoiceClones(shop.id)"), 1);
  assert.ok(film.includes("    myVoices,\n    perScene: FILM_PER_SCENE,"));
});

test("ONE hook and ONE layer, wired into all four pickers — and a face's card picks exactly what a tap on it picks", () => {
  assert.equal(count(film, "useCastPeek("), 1);
  assert.ok(film.includes("const peek = useCastPeek(!zoomImg);"), "never over the enlarged scene still");
  assert.equal(count(film, "<CastPeek "), 1);
  assert.ok(film.includes("<CastPeek peek={peek} targets={peekTargets} />"));
  assert.equal(count(film, "peek.bind("), 1, "every face goes through peekOn");
  assert.equal(count(film, "<CastHoverCard"), 1);
  assert.equal(count(film, "createPortal(\n    <div className=\"fs-peek\""), 1);

  // THE FOUR PICKERS
  const story = between(film, "{rosterFor(template).map((r) => {\n                    const on = storyPick.includes(r.id);", '{wipeNote("cast:")}');
  const star = between(film, "{mvRoster.map((r) => (\n                  <button type=\"button\" key={r.id}", "{artistMakerOpen && (");
  const costar = between(film, '<div className="mm-artistpick mm-castpick">', "</div>\n              </div>\n            </div>\n          )}");
  const scene = between(film, '<div className="mm-sc-castpick">', '<div className="mm-cp-hint">{draftLead');
  const actor = between(film, '<div className="fs-roster" role="list" aria-label={t("Your presenters")}>', "</details>");
  assert.equal(count(story, "{...peekOn(`story:${r.id}`, r, on,"), 1);
  assert.equal(count(star, "{...peekOn(`star:${r.id}`, r, artistPick === r.img,"), 1);
  assert.equal(count(costar, "{...peekOn(`co:${r.id}`, r, castExtra.some((m) => m.img === r.img),"), 1);
  assert.equal(count(scene, "{...peekOn(`scene:"), 3, "the star, a co-star, a face from the roster");
  assert.equal(count(scene, "faceOfImg("), 3, "a scene keeps faces by picture: who they are comes from the roster");
  assert.equal(count(actor, "{...peekOn(`actor${i}:${r.id}`, r, c.faceUrl === r.img,"), 1);
  assert.equal(count(film, "{...peekOn("), 7);

  // EVERY face's card picks what a tap on that face does — the same words, so they cannot drift apart
  let at = film.indexOf("{...peekOn(");
  while (at >= 0) {
    const tag = film.slice(film.lastIndexOf("<button", at), at);
    const on = tag.indexOf("onClick={") + "onClick={".length;
    let depth = 1, i = on;
    while (depth && i < tag.length) { if (tag[i] === "{") depth++; else if (tag[i] === "}") depth--; i++; }
    const onClick = tag.slice(on, i - 1);
    assert.ok(onClick.length > 10, tag);
    const call = film.slice(at, film.indexOf("\n", at));
    assert.ok(call.includes(`, ${onClick}`), `${call}\n  should pick with: ${onClick}`);
    at = film.indexOf("{...peekOn(", at + 1);
  }
  // a face that cannot be picked right now says so on its card (the button is there, and off)
  assert.ok(story.includes(", !on && storyPick.length >= maxPick)}"));
  assert.ok(costar.includes(", castExtra.length >= MAX_COSTARS)}"));
  assert.ok(actor.includes(", castingIndex !== null)}"));

  // NOTHING NEW TO TAP on a face: the pickers gained attributes, not buttons
  for (const region of [story, star, costar, scene, actor]) assert.ok(!/fs-peek|<CastIdCard|aria-label=\{t\("(Show|See|View)/.test(region));
  // THE SHEET: their card, a close control with a 44px hit area, and ONE button that picks them
  const sheet = between(film, "function CastPeekSheet(", "export default function FilmStudio()");
  assert.equal(count(sheet, "<button"), 2);
  assert.ok(sheet.includes('<button type="button" className="fs-peek-x" onClick={onClose} aria-label={t("Close")}>'));
  assert.ok(sheet.includes('{x.picked ? <><Ico n="check" size={14} /> {t("Picked")}</> : t("Pick {name}", { name: x.r.name })}'));
  assert.ok(sheet.includes("disabled={x.picked || x.disabled} onClick={() => { x.pick(); onClose(); }}>"));
  assert.ok(sheet.includes('role="dialog" aria-modal="true" aria-label={x.r.name}'));
  assert.ok(sheet.includes("useModalA11y<HTMLDivElement>(true, onClose)"), "Escape closes it; focus goes in, and back");
  assert.ok(film.includes(".fs-peek-x{display:grid;place-items:center;width:44px;height:44px;"));
  // the finger that opened it is still down: its lifting cannot press anything in the sheet
  assert.ok(sheet.includes("onPointerDownCapture={() => { armed.current = true; }}"));
  assert.ok(sheet.includes("onClickCapture={(e) => { if (!armed.current && e.detail !== 0) { e.preventDefault(); e.stopPropagation(); } }}"));
  // and the page's look: the cream sheet, the green line, Poppins on the button — and less motion honoured
  assert.ok(film.includes("${SPIN_STAGE_CSS}\n${CAST_ID_CSS}\n"));
  assert.equal(count(film, "${CAST_ID_CSS}"), 1);
  assert.ok(film.includes("@media(prefers-reduced-motion:reduce){.fs-peek-sheet{animation:none;}}"));
});

test("on a touch screen only: one quiet line of help, under the first picker of each flow", () => {
  assert.equal(count(film, 't("Hold a face to see their card.")'), 1);
  assert.ok(film.includes('const peekHint = <p className="fs-peek-hint">{t("Hold a face to see their card.")}</p>;'));
  // under the story's cast, the music video's star, and the FIRST actor's roster — nowhere else
  assert.equal(count(film, "{peekHint}"), 2);
  assert.equal(count(film, "{i === 0 && peekHint}"), 1);
  assert.ok(film.includes("                </div>\n                {peekHint}\n                {wipeNote(\"cast:\")}"));
  assert.ok(film.includes("              </div>\n              {peekHint}\n              {artistMakerOpen && ("));
  // hidden unless the device has no hover and a coarse pointer — a phone, a tablet
  assert.ok(film.includes(".fs-peek-hint{display:none;"));
  assert.ok(film.includes("@media(hover:none) and (pointer:coarse){.fs-peek-hint{display:block;}}"));
  assert.equal(count(film, ".fs-peek-hint{display:block;}"), 1);
  // holding a face selects no text and raises no callout
  assert.ok(film.includes("[data-cast-hold],[data-cast-hold] *{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;}"));
});

test("RUN: a tap picks, a hold opens the card and does NOT also pick, a drift or a scroll is neither", (tt) => {
  const listeners: Record<string, Array<(e?: unknown) => void>> = {};
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document };
  g.window = {
    addEventListener: (type: string, f: (e?: unknown) => void) => { (listeners[type] ||= []).push(f); },
    removeEventListener: (type: string, f: (e?: unknown) => void) => { listeners[type] = (listeners[type] || []).filter((x) => x !== f); },
    matchMedia: () => ({ matches: false }),
  };
  g.document = { addEventListener: () => {}, removeEventListener: () => {} };
  mock.timers.enable({ apis: ["setTimeout"] });
  tt.after(() => { mock.timers.reset(); g.window = saved.window; g.document = saved.document; });

  const h = hooks();
  const mod = load(h.react);
  const HOLD = mod.CAST_HOLD_MS;
  assert.equal(HOLD, 500, "about half a second");
  assert.equal(mod.CAST_HOLD_SLOP, 10);
  let enabled = true;
  const render = () => { h.begin(); return mod.useCastPeek(enabled); };
  const face = { isConnected: true, matches: () => false, contains: () => false, getBoundingClientRect: () => ({ left: 0, top: 0, right: 66, bottom: 84 }) };
  const ptr = (pointerType: string, x = 30, y = 30, pointerId = 1, isPrimary = true) => ({ pointerType, clientX: x, clientY: y, pointerId, isPrimary, currentTarget: face });
  const ev = (detail = 1) => ({ detail, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });

  let peek = render();
  let b = peek.bind("story:zz");
  assert.equal(b["data-cast-hold"], "", "the face is marked for the page's CSS (no text selection, no callout)");
  // the mouse's own handlers are still on it: the floating card, as on Presenters
  for (const k of ["onPointerEnter", "onPointerLeave", "onFocus", "onBlur"]) assert.equal(typeof b[k], "function", k);

  // A TAP: down, up a moment later — the click goes through untouched, nothing opens
  b.onPointerDown(ptr("touch"));
  mock.timers.tick(150);
  b.onPointerUp();
  let click = ev();
  b.onClickCapture(click);
  assert.ok(!click.prevented && !click.stopped, "a tap picks, as before");
  mock.timers.tick(1000);
  assert.equal(render().held, null);

  // A HOLD: nothing just before half a second, the card at half a second — on that face
  b.onPointerDown(ptr("touch"));
  mock.timers.tick(HOLD - 1);
  assert.equal(render().held, null);
  mock.timers.tick(1);
  peek = render();
  assert.equal(peek.held?.id, "story:zz");
  assert.equal(peek.held?.anchor, face);
  assert.equal(peek.at, null, "no floating card while the sheet is up");
  // …and the click its lifting may send is SWALLOWED — the hold does not also pick
  b = peek.bind("story:zz");
  b.onPointerUp();
  click = ev();
  b.onClickCapture(click);
  assert.ok(click.prevented && click.stopped, "a long press must not also pick");
  // only that one click
  click = ev();
  b.onClickCapture(click);
  assert.ok(!click.prevented);
  peek.close();
  assert.equal(render().held, null);

  // a hold, then (no click came) — the NEXT press starts clean: its tap picks
  b.onPointerDown(ptr("touch"));
  mock.timers.tick(HOLD);
  peek = render();
  assert.ok(peek.held);
  b.onPointerDown(ptr("touch"));
  b.onPointerUp();
  click = ev();
  b.onClickCapture(click);
  assert.ok(!click.prevented, "a fresh tap is never eaten by an old hold");
  peek.close();
  // …and a keyboard's click (detail 0) is never swallowed
  b.onPointerDown(ptr("touch"));
  mock.timers.tick(HOLD);
  click = ev(0);
  b.onClickCapture(click);
  assert.ok(!click.prevented);
  render().close();

  // A DRIFT past the slop is a scroll / a swipe along the row: no card
  b.onPointerDown(ptr("touch", 30, 30));
  b.onPointerMove(ptr("touch", 30, 41));
  mock.timers.tick(HOLD * 2);
  assert.equal(render().held, null);
  // …a wobble inside it is still a hold
  b.onPointerDown(ptr("touch", 30, 30));
  b.onPointerMove(ptr("touch", 36, 36));
  mock.timers.tick(HOLD);
  assert.ok(render().held);
  render().close();
  // the browser taking the touch for a scroll (pointercancel): no card
  b.onPointerDown(ptr("touch"));
  b.onPointerCancel();
  mock.timers.tick(HOLD * 2);
  assert.equal(render().held, null);
  // a scroll anywhere on the page (a row of faces sliding under a still finger): no card
  b.onPointerDown(ptr("touch"));
  assert.ok((listeners.scroll || []).length >= 1);
  for (const f of listeners.scroll) f({ type: "scroll" });
  mock.timers.tick(HOLD * 2);
  assert.equal(render().held, null);
  // lifting early: no card
  b.onPointerDown(ptr("touch"));
  mock.timers.tick(HOLD - 100);
  b.onPointerUp();
  mock.timers.tick(HOLD);
  assert.equal(render().held, null);
  // a second finger is not a hold of its own
  b.onPointerDown(ptr("touch", 30, 30, 2, false));
  mock.timers.tick(HOLD * 2);
  assert.equal(render().held, null);
  // A MOUSE never holds (it has the floating card), and its click is never touched
  b.onPointerDown(ptr("mouse"));
  mock.timers.tick(HOLD * 2);
  assert.equal(render().held, null);
  click = ev();
  b.onClickCapture(click);
  assert.ok(!click.prevented);
  // nor does a right-click: the browser's own menu is left alone
  const right = ev();
  b.onContextMenu(right);
  assert.ok(!right.prevented);

  // THE PHONE'S LONG-PRESS MENU (Android raises "contextmenu"): refused, and the card opens at once
  b.onPointerDown(ptr("touch"));
  mock.timers.tick(300);
  const menu = ev();
  b.onContextMenu(menu);
  assert.ok(menu.prevented, "no browser menu over a face");
  peek = render();
  assert.equal(peek.held?.id, "story:zz");
  mock.timers.tick(HOLD * 2);
  click = ev();
  peek.bind("story:zz").onClickCapture(click);
  assert.ok(click.prevented, "…and still no pick");
  peek.close();

  // SOMETHING OPEN OVER THE PICKERS (the enlarged scene still): no hold, and an open card closes
  b.onPointerDown(ptr("touch"));
  mock.timers.tick(HOLD);
  assert.ok(render().held);
  enabled = false;
  peek = render();
  assert.equal(peek.held, null);
  b = peek.bind("story:zz");
  b.onPointerDown(ptr("touch"));
  mock.timers.tick(HOLD * 2);
  assert.equal(render().held, null);
});

test("the hook only listens: it prevents nothing but the hold's own click and the phone's menu over a held face", () => {
  const hook = card.slice(card.indexOf("export function useCastPeek("));
  assert.equal(count(hook, "preventDefault()"), 3, "the swallowed click, the menu while a finger rests on a face, the menu after a hold");
  assert.equal(count(hook, "stopPropagation()"), 1, "the swallowed click only");
  assert.ok(hook.includes('if (!enabled || e.pointerType === "mouse" || !e.isPrimary) return;'));
  assert.ok(hook.includes("if (!swallow.current || e.detail === 0) return;"));
  assert.ok(hook.includes("const hover = useCastHover(enabled && !held);"), "the mouse's card is useCastHover itself, unchanged");
  assert.ok(hook.includes('window.addEventListener("scroll", onScroll, { capture: true, passive: true });'));
  assert.ok(hook.includes('window.removeEventListener("scroll", onScroll, true);'));
});
