/* THE MOVIE MAKER'S TWO THEMES — its posters in rows (both), its gold rosettes (both), its dark theater (the default).
 *
 * The sign-in screens became a cinema's lobby (tests/auth-lobby.test.ts), and the owner, 2026-11-24:
 *   "I'm really fond of that dark style screen"
 *   "the Admit one light cream card over the dark is extremely attractive bro"
 *   "i typed money theater but really meant to say movie theater - but we can extend it to the film section
 *    and if we like it we move futher. I think we still need some gold spinners in there for asthetic"
 * then, with the posters on his phone:
 *   "the film section needs sideways scroll for options instead of that layout"
 * then, of the first (brown-black) dark:
 *   "Looks pretty clean, but maybe we do a dark green background instead of the brown"
 *   "dark mode toggle in setting but keeep it light" — and, having seen the two side by side: "Make dark default"
 * then, of the dark's first shelves (each a deep green "poster case"), beside the sign-in ticket:
 *   "Now buddy, these cards even in dark should take on the lighter theme overlay like login right? To make it flow"
 *
 * So app/routes/web.film.tsx carries:
 *   THE ROWS     (the page's stylesheet, both themes) each shelf is ONE row of its posters, swiped sideways
 *   THE GOLD     (the page's stylesheet, both themes) three slow gold rosettes where no word stands
 *   FS_THEATER   the DARK theme — a deep green movie theater — mounted only while the theme is dark
 *
 * What must stay true, and is held here:
 *   · the theater is mounted only in the dark theme (the default — lib/theme.ts), only on this page, and its
 *     page rules cannot reach another section; the light theme is the cream page it was
 *   · THE PAGE IS DARK, EVERY CARD IS LIGHT: a shelf, a poster, a ticket, every sheet a member works in is the
 *     cream card it is in the light theme, with its own ink — the dark gives a card an edge and a shadow, no more
 *   · the dark is a deep green (not brown), and every word that stands on it reads (4.5:1 or better)
 *   · the gold rosettes are the app's own, slow and faint, and never over a word
 *   · a shelf is one row: about 2.3 posters on a phone with the next one peeking, four across on a wide
 *     screen — and the page itself never scrolls sideways
 *   · it is still the same list of buttons in the same order; a tapped poster still pops
 *   · everything that moves stands still for anyone who asks for less motion
 *   · no control does anything it did not do, no word was added, no file but the rosette is asked for
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILM_HEROES, heroShelves } from "../app/lib/film-heroes.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// (a checkout with CRLF line endings must read the same as one with LF)
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const exists = (...p: string[]) => fs.existsSync(path.join(root, ...p));
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const page = read("app", "routes", "web.film.tsx");
const shell = read("app", "routes", "web.tsx");
/** A stylesheet the page declares: the text between `const NAME = \`` and its closing backtick. */
const sheetOf = (name: string) => {
  const open = `const ${name} = \``;
  const a = page.indexOf(open);
  assert.ok(a > 0, name);
  return page.slice(a + open.length, page.indexOf("`;", a));
};
const theater = sheetOf("FS_THEATER");
const base = sheetOf("FS_STYLE");
const ROWS_OPEN = "/* ───────── THE ROWS — each shelf is ONE row of its posters, swiped sideways ─────────";
const GOLD_OPEN = "/* ───────── THE GOLD — the app's rosette, slow and faint, in BOTH themes ─────────";
assert.equal(count(base, ROWS_OPEN), 1);
assert.equal(count(base, GOLD_OPEN), 1);
assert.ok(base.indexOf(ROWS_OPEN) < base.indexOf(GOLD_OPEN));
/** The page's rules before the two added blocks; the rows' own; the gold's own (the last of the sheet). */
const before = base.slice(0, base.indexOf(ROWS_OPEN));
const rows = base.slice(base.indexOf(ROWS_OPEN), base.indexOf(GOLD_OPEN));
const gold = base.slice(base.indexOf(GOLD_OPEN));
/** The page's code: everything above its stylesheets. */
const ui = page.slice(0, page.indexOf("const FS_STYLE = `"));

/** A stylesheet as its rules: the selector, the declarations, and the @media / @supports it stands in ("" for none). */
function rules(sheet: string): { media: string; sel: string; body: string }[] {
  const out: { media: string; sel: string; body: string }[] = [];
  const walk = (s: string, media: string) => {
    let pos = 0;
    for (;;) {
      const open = s.indexOf("{", pos);
      if (open < 0) break;
      const head = s.slice(pos, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < s.length && depth > 0) { if (s[j] === "{") depth++; else if (s[j] === "}") depth--; j++; }
      const body = s.slice(open + 1, j - 1);
      if (head.startsWith("@media") || head.startsWith("@supports")) walk(body, head);
      else if (!head.startsWith("@keyframes")) out.push({ media, sel: head, body });
      pos = j;
    }
  };
  walk(sheet.replace(/\/\*[\s\S]*?\*\//g, ""), "");
  return out;
}
const T = rules(theater);
const R = rules(rows);
const G = rules(gold);
const parts = (r: { sel: string }) => r.sel.split(",").map((s) => s.trim());
const named = (r: { media: string; sel: string }) => (r.media ? `${r.media} ` : "") + r.sel;
/** The names of the properties a rule sets. */
const props = (body: string) => body.split(";").map((d) => d.trim()).filter(Boolean).map((d) => d.slice(0, d.indexOf(":")));
const isPage = (s: string) => s.startsWith(".fs-theater ") || s.startsWith("[dir=rtl] .fs-theater ");
const pageRules = T.filter((r) => parts(r).every(isPage));
const shellRules = T.filter((r) => !parts(r).some(isPage));

/** WCAG contrast of two #RRGGBB colours. */
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
/** `top` laid over `under` at `alpha`. */
const over = (top: string, under: string, alpha: number) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(top.slice(i, i + 2), 16) * alpha + parseInt(under.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, "0")).join("");
const hexOf = (rgb: string) => "#" + rgb.split(",").map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
/** Is it a green — more green in it than red or blue? (the dark is a deep green, not a brown) */
const isGreen = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return g > r && g > b; };

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...sources(rel));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

test("the theater is the DARK theme's, and only this page's: mounted while the theme is dark, never in the light", () => {
  // the theme is the shell's (lib/theme.ts, lib/use-theme.ts — dark unless a member chose the light): this page only reads it
  assert.ok(ui.includes('import { useTheme } from "../lib/use-theme";') && ui.includes('import { themeOf } from "../lib/theme";'));
  assert.equal(count(ui, "const theme = useTheme();"), 1);
  assert.ok(ui.indexOf("export default function FilmStudio()") < ui.indexOf("const theme = useTheme();"));
  // ONE mark on this route's root: its theme — and, in the dark only, the class every theater rule hangs on
  assert.equal(count(ui, "<div className={`fs-wrap${theme === \"dark\" ? \" fs-theater\" : \"\"}`} data-theme={theme}>"), 1);
  // the theater's stylesheet is mounted by this page, and only in the dark: in the light theme not one of
  // its rules is on the page — the shell's included — so the light Movie Maker is the cream page it was
  assert.equal(count(ui, "{theme === \"dark\" && <style dangerouslySetInnerHTML={{ __html: FS_THEATER }} />}"), 1);
  assert.equal(count(ui, "FS_THEATER }"), 1, "mounted in one place");
  assert.ok(ui.includes("<style dangerouslySetInnerHTML={{ __html: FS_STYLE }} />"), "the page's own stylesheet is in both themes");
  assert.ok(!/fs-theater|\[data-theme/.test(base), "nothing in the page's own stylesheet waits on the theme: what both themes share is simply there");
  // a dark page gets a dark bar on a phone — in the dark only (the shell's loader says which; the hook reads the same)
  assert.ok(ui.includes('const shell = matches.find((m) => m.id === "routes/web")?.data as { theme?: unknown } | undefined;'));
  assert.ok(ui.includes('return [{ title: "Movie Maker · EasyMode" }, ...(themeOf(shell?.theme) === "dark" ? [{ name: "theme-color", content: "#0A1C13" }] : [])];'));
  assert.ok(read("app", "lib", "use-theme.ts").includes('useRouteLoaderData("routes/web")'), "the same loader the hook reads");
  // no other file knows of the theater — not the shell, not the cast page, not the Archive
  for (const f of sources("app")) {
    if (f === "app/routes/web.film.tsx") continue;
    assert.ok(!/fs-theater|FS_THEATER/.test(read(...f.split("/"))), `${f} knows of the theater`);
  }
  // EVERY rule is either the page's (anchored on .fs-theater, which the root carries in the dark only — so
  // it can match nothing outside this route's root) or one of the shell's — and a rule is never half of each
  for (const r of T) assert.ok(parts(r).every(isPage) || !parts(r).some(isPage), r.sel);
  assert.ok(pageRules.length >= 20 && pageRules.length + shellRules.length === T.length);
  // a page rule never reaches for the shell
  for (const r of pageRules) assert.ok(!/\.(wb|lt)-|(^|[\s,>])(html|body)\b/.test(r.sel), r.sel);
  // THE SHELL'S: exactly these, and nothing else — each is there only while this stylesheet is (the lobby's way)
  assert.deepEqual(shellRules.map(named), [
    "html,body",
    "html",
    "body",
    "html .wb",
    "html .wb::before,html .wb::after",
    "html .wb::before",
    "html .wb::after",
    ".wb .wb-brand",
    ".wb .wb-brand b",
    ".wb .wb-crest img",
    ".wb .lt-btn",
    ".wb .lt-btn:hover,.wb .lt-btn[aria-expanded=\"true\"]",
    ".wb .lt-btn .lt-glyph",
    ".wb .lt-btn .lt-caret",
    ".wb .wb-brand::after,.wb .lt-btn::after",
    ".wb .wb-tab:not(.on)",
    ".wb .wb-tab:hover:not(.on)",
    ".wb .wb-tab.on",
    ".wb .wb-chip",
    ".wb .wb-chip:hover,.wb .wb-chip.on",
    ".wb .wb-admin",
    ".wb .wb-admin:hover",
    ".wb .wb-nav a:focus-visible,.wb .wb-nav button:focus-visible",
    "@media(max-width:760px) .wb .wb-bottom",
    "@media(max-width:760px) .wb .wb-bt",
    "@media(max-width:760px) .wb .wb-bt.on",
    "@media(max-width:760px) .wb .wb-bt.on .wb-bt-ic",
    "@media(max-width:760px) .wb .wb-bt-mid",
    "@media(max-width:760px) .wb .wb-bottom a:focus-visible",
    "@media(prefers-reduced-motion:reduce) html .wb::before,html .wb::after",
  ]);
  // every one that names a shell class outranks the shell's own rule (.wb x beats x), whatever the order
  for (const r of shellRules) for (const s of parts(r)) assert.ok(s === "html" || s === "body" || s.startsWith("html .wb") || s.startsWith(".wb "), s);
  // …and only PAINTS it: the shell's layout — its paddings, its sizes, where Helpurr floats — is not touched
  const PAINT = new Set(["background", "background-image", "scrollbar-color", "color", "filter", "border-color", "box-shadow", "opacity", "outline-color", "animation", "position", "content", "inset"]);
  for (const r of shellRules) for (const p of props(r.body)) assert.ok(PAINT.has(p), `${r.sel} sets ${p}`);
  for (const r of shellRules.filter((x) => /position:|inset:/.test(x.body))) assert.ok(/^\.wb \.wb-brand(::after)?(,|$)|^\.wb \.lt-btn$/.test(r.sel), `${r.sel}: only the two 44px hit areas are positioned`);
  assert.ok(!/\.(wb-main|mm-fab|wb-ready|wb-menu|lt-menu)\b/.test(theater), "the page's padding, Helpurr, the notice and the menus are the shell's");
  // the page's own ink does not depend on the room's colour: the dark is a background, never a colour to inherit
  assert.ok(!/(^|\})html \.wb\{[^}]*[;{]color:/.test(theater.replace(/\n/g, "")));
  assert.ok(!T.some((r) => parts(r).some((s) => s === ".fs-theater")), "no rule on the root itself: nothing is inherited from it");
  // (the page's own scrollbar goes dark; every picker inside a cream card keeps the bar it had)
  assert.ok(theater.includes("body{scrollbar-color:auto;}"));
  // the stylesheets are plain text in a template: nothing interpolated, no escape to lose
  for (const s of [theater, rows, gold]) assert.ok(!s.includes("${") && !s.includes("\\"));
});

test("the dark is a DEEP GREEN, not a brown (\"maybe we do a dark green background instead of the brown\")", () => {
  // the room: a near-black green, a lighter green where the light falls from above, the app's own green low in the far corner
  assert.ok(theater.includes("html,body{background:#0A1C13;}") && theater.includes("html{scrollbar-color:#2A5A41 #0A1C13;}"));
  assert.ok(theater.includes("html .wb{background:radial-gradient(1200px 520px at 50% -160px,rgba(36,120,78,.36),rgba(36,120,78,0) 70%),radial-gradient(900px 520px at 0% 100%,rgba(12,122,70,.2),rgba(12,122,70,0) 70%),#0A1C13;}"));
  // a phone's tab bar: a green of the same family (the Archive's series band is #102A1D)
  assert.ok(theater.includes(".wb .wb-bottom{background:#0F2A1C;"));
  // every solid colour the theater paints a dark SURFACE with — the room, its light, the page's scrollbar, the
  // tab bar — is a green, and a dark one. (A shelf is NOT one of them any more: it is a cream card — below.)
  const surfaces = ["#0A1C13", "#2A5A41", hexOf("36,120,78"), "#0F2A1C"];
  for (const c of surfaces) assert.ok(isGreen(c) && lum(c) < 0.16, c);
  // …and nothing of the first lobby's brown-black is left in it, nor of the deep green "poster cases" the shelves were
  assert.ok(!/#130E0B|#1C1511|#221912|#17110D|#2A2018|#241B15|#3D3024|#0A0705|rgba\((19,14,11|10,7,5),/i.test(theater));
  assert.ok(!/#153826|#1C4531|rgba\(5,18,12,/i.test(theater.replace(/\/\*[\s\S]*?\*\//g, "")));
  // every colour written in the sheet is one of: those three greens · the gold (and, once, the shell's deeper
  // gold: for the one gold thing that stands on cream) · the cream (and the ticket's paper) and the soft cream
  // of words on the dark · the error's red · black for a shadow
  const hexes = [...new Set([...theater.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g)].map((m) => m[0].toUpperCase()))].sort();
  assert.deepEqual(hexes, ["#000", "#0A1C13", "#0F2A1C", "#2A5A41", "#B08526", "#D8CFBA", "#E7C879", "#F7F0DE", "#FFB4A6", "#FFFDF7"]);
  assert.equal(count(theater.replace(/\/\*[\s\S]*?\*\//g, ""), "#B08526"), 1);
  // the hero is the page's own deep green band, and the shade its words stand on the page's own: the theater
  // repaints neither (it gives the hero and a format's banner a thin gold edge, and that is all)
  assert.ok(before.includes("background:radial-gradient(130% 150% at 80% 0%,#2C6549,#1A4A33 52%,#0F3323);}"));
  assert.ok(!/\.fs-head-scrim|\.fs-reel|\.fs-hero-scrim/.test(theater));
  for (const r of T.filter((x) => /\.fs-(head|hero|head-tag|hero-back)(:hover)?$/.test(x.sel))) assert.ok(props(r.body).every((p) => p === "box-shadow" || p === "border-color"), `${r.sel} sets ${props(r.body)}`);
  assert.ok(theater.includes(".fs-theater .fs-head{box-shadow:0 0 0 1px rgba(231,200,121,.45),0 0 0 6px rgba(231,200,121,.07),") && theater.includes(".fs-theater .fs-hero{box-shadow:0 0 0 1px rgba(231,200,121,.45),"));
  // gold stays gold, and the cream cards stay cream (next test)
  assert.ok(count(theater, "#E7C879") >= 10 && read("app", "components", "AuthLobby.tsx").includes("#E7C879"), "the lobby's own gold");
});

test("the cream cards are kept (\"the Admit one light cream card over the dark is extremely attractive\")", () => {
  // every sheet a member works on is the rule it was — its paper, its border, its ink
  for (const k of [
    ".fs-card{background:linear-gradient(180deg,#fff,#FDFCF8);border:1px solid var(--line,#E4DFCF);border-radius:20px;padding:18px 20px;margin:14px 0;",
    ".fs-go-card{border-color:transparent;box-shadow:0 0 0 1.5px var(--green,#0C7A46),0 18px 40px rgba(12,122,70,.12);}",
    ".mm-topic{margin:16px 0 0;background:var(--panel,#FDFBF4);border:1.5px solid var(--line,#E4DFCF);border-radius:18px;padding:16px 18px;",
    ".mm-topic input,.mm-topic textarea{width:100%;border:1.5px solid var(--line,#E4DFCF);border-radius:12px;padding:12px 14px;font-size:14.5px;font-family:Poppins,sans-serif;color:var(--ink,#14201A);background:#fff;box-sizing:border-box;}",
    ".mm-card{position:relative;text-align:left;cursor:pointer;background:#fff;border:1.5px solid var(--line,#E4DFCF);border-radius:18px;padding:15px 16px;",
    ".mm-opts{margin:13px 0 0;background:var(--panel,#FDFBF4);border:1.5px solid var(--green,#0C7A46);border-radius:18px;padding:16px 18px;",
    ".mm-gen{margin:18px 0 0;background:var(--panel,#FDFBF4);border:1.5px solid transparent;border-radius:20px;padding:18px;",
    ".mm-sc{display:flex;flex-direction:column;border:1.5px solid var(--line,#E4DFCF);border-radius:14px;background:#fff;overflow:hidden;",
    ".mm-sc-drawer{grid-column:1/-1;display:flex;flex-direction:column;gap:10px;border:1.5px solid var(--green,#0C7A46);border-radius:14px;background:#FFFDF7;",
    ".fs-peek-sheet{box-sizing:border-box;width:100%;max-width:400px;",
  ]) assert.equal(count(before, k), 1, k);
  // the theater names a working card in ONE rule — the gold edge the ticket has, around the two big sheets
  // (the paid step keeps its green ring) — and paints nothing inside any of them
  const WORK = /\.(mm-topic|fs-card|fs-go-card|mm-card|mm-opts|mm-gen|mm-grid|mm-sc|mm-sc-[a-z]+|mm-sd-[a-z]+|mm-sw-[a-z]+|mm-sb-(list|prog|flag|reroll|num)|fs-loc|fs-actor|fs-cast|fs-shot|fs-msg|fs-chat|mm-vo|mm-cap|mm-lenopt|mm-told|mm-aspect|fs-rface|mm-ptile|mm-gtile|mm-castmem|mm-twovoice|mm-wd2|fs-in|fs-sel|fs-ta|fs-go|mm-go|fs-write|mm-preview-btn|fs-slate|mm-star|mm-stars|fs-peek|mm-lightbox|pc-id|cf|vp)(?![a-z0-9-])/;
  const touched = T.filter((r) => WORK.test(r.sel));
  assert.deepEqual(touched.map((r) => r.sel), [".fs-theater .mm-topic,.fs-theater .fs-card:not(.fs-go-card)"]);
  assert.equal(touched[0].body, "box-shadow:0 0 0 1px rgba(231,200,121,.5),0 22px 40px -28px #000;");
  // …and the two blocks both themes share name none of them at all
  assert.ok(![...R, ...G].some((r) => WORK.test(r.sel)));
  // (the slate that claps, the cast walking on and the Starring strip are inside those cards: as they were)
  for (const k of [".fs-slate{position:relative;z-index:2;width:min(100%,290px);", ".mm-stars-row .mm-star{animation:mmStarOn .52s cubic-bezier(.2,.8,.2,1) both;", ".mm-stars-h b{font-family:Poppins,sans-serif;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--ink,#14201A);}"]) assert.ok(before.includes(k), k);
  // it never re-inks the page: no palette token is redefined, so a card's own colours resolve as they did
  assert.ok(!/--(ink|ink2|ink3|line|line2|green|green2|green-d|panel|card|paper|mint|cream|gold|gold-deep|fs-gold|fs-gold-lt|shelf|shelf-soft)\s*:/.test(theater + rows + gold));
  // a rule may put a COLOUR on words only where they stand on the dark: the hero's line, the Next-episode
  // sign, and the few lines a builder lays straight on the page. (Not one word of a shelf: a shelf is a card.)
  assert.deepEqual(pageRules.filter((r) => /(^|;)color:/.test(r.body)).map((r) => r.sel), [
    ".fs-theater .fs-head-copy b em",
    ".fs-theater .fs-eps-h",
    ".fs-theater .mm-hint",
    ".fs-theater .mm > .mm-preview .fs-treat-ttl",
    ".fs-theater .mm > .mm-preview .fs-treat-mood",
    ".fs-theater .mm > .fs-err",
    ".fs-theater .mm > .mm-storyboard > .mm-sb-head",
  ]);
  assert.ok(![...R, ...G].some((r) => /(^|;)color:/.test(r.body)), "the rows and the gold colour no word in either theme");
  // …and each of those really is on the page, not in a card: the hint between the idea box and the steps,
  // and the Music Video's three (its builder is the one that lays the storyboard straight on the page — a
  // told story's is inside its cream card, and is NOT matched by a child selector from .mm)
  assert.ok(ui.includes("<div className=\"mm-hint\"><span aria-hidden=\"true\">✎</span>"));
  const mv = ui.slice(ui.indexOf("{tmpl?.lipSyncSinger && (\n        <div className=\"mm\">"), ui.indexOf("{/* The classic long-form flow"));
  assert.ok(mv.length > 2000 && mv.includes("<div className=\"mm-preview\">\n              <div className=\"fs-treat\">"));
  assert.ok(mv.includes("          {treatmentFetcher.data?.error && <p className=\"fs-err\">{treatmentFetcher.data.error}</p>}\n\n"));
  assert.ok(mv.includes("          {storyboard(true, undefined, true)}\n"));
  assert.ok(ui.includes("<div className=\"fs-card fs-narr\">") && ui.includes("return (\n    <div className=\"mm-storyboard\">"));
  // in the dark a Next-episode card is a cream card too — the lobby ticket's own paper, its own ink
  const lobby = read("app", "components", "AuthLobby.tsx");
  const PAPER = "background:linear-gradient(176deg,#FFFDF7,#F7F0DE);";
  assert.ok(lobby.includes(PAPER), "the ticket's paper");
  assert.ok(theater.includes(".fs-theater .fs-ep-card{border-color:rgba(231,200,121,.7);" + PAPER));
  assert.ok(!T.some((r) => /\.fs-ep-txt (b|span)/.test(r.sel)), "a ticket's words: as they were");

  // A SHELF IS THE LIGHT THEME'S OWN SHELF CARD. They were deep green "poster cases" in the first dark, and
  // the owner, with the Films shelf beside the sign-in ticket: "these cards even in dark should take on the
  // lighter theme overlay like login right? To make it flow". So in the dark the page's own rules draw it —
  // its cream ground, its ink title and grey line, its coloured bar and tag, its white poster cards …
  for (const k of [
    ".fs-shelf{position:relative;border-radius:22px;padding:14px 14px 14px;border:1px solid var(--line,#E4DFCF);background:linear-gradient(180deg,#FFFEFA,#FBF8F0);transition:background .3s ease,border-color .3s ease;}",
    ".fs-shelf::before{content:\"\";position:absolute;left:0;top:18px;bottom:18px;width:4px;border-radius:0 4px 4px 0;background:var(--shelf);opacity:.85;}",
    ".fs-shelf-ico{flex:none;width:38px;height:38px;border-radius:12px;display:grid;place-items:center;color:#fff;background:var(--shelf);box-shadow:0 10px 18px -10px var(--shelf);}",
    ".fs-shelf-name{margin:0;font-family:Poppins,sans-serif;font-size:19px;font-weight:800;letter-spacing:-.015em;line-height:1.15;color:var(--ink,#14201A);}",
    ".fs-shelf-txt span{font-size:12.5px;font-weight:600;line-height:1.35;color:var(--ink2,#55605A);}",
    ".fs-shelf-tag{flex:none;font-style:normal;font-family:Poppins,sans-serif;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;color:var(--shelf);background:var(--shelf-soft);border-radius:999px;padding:5px 10px;}",
    ".fs-fmt{position:relative;flex:0 0 130px;scroll-snap-align:start;text-align:left;cursor:pointer;border:1.5px solid var(--line,#E4DFCF);background:#fff;border-radius:15px;padding:0;overflow:hidden;transition:transform .16s,box-shadow .16s,border-color .16s;box-shadow:0 1px 2px rgba(20,32,26,.05);}",
    ".fs-fmt:hover{transform:translateY(-3px);box-shadow:0 12px 26px -16px rgba(20,32,26,.28);}",
  ]) assert.equal(count(before, k), 1, k);
  // … and the theater says FOUR things about a shelf and its posters, and no more: the card's edge, the card's
  // shadow, the bar a mouse gives a row (its track would stand out past the card's round corner — the rows'
  // test), and the ring on the one poster that flies (it leaves its card and crosses the dark page)
  const ofShelf = T.filter((r) => /\.fs-(shelf|shelves|fmt)/.test(r.sel));
  assert.deepEqual(ofShelf.map((r) => [r.sel, r.body]), [
    [".fs-theater .fs-shelf", "border-color:rgba(231,200,121,.6);background-clip:padding-box;"],
    [".fs-theater .fs-shelves:not(.throw) .fs-shelf", "box-shadow:0 34px 60px -30px #000,0 14px 26px -16px rgba(0,0,0,.55);"],
    [".fs-theater .fs-shelf .fs-fmtgrid", "scrollbar-color:#B08526 transparent;"],
    [".fs-theater .fs-fmtgrid.throw .fs-fmt.zoom", "box-shadow:0 0 0 2px #E7C879,0 24px 40px -20px #000;"],
  ]);
  // (nothing of the cases is left: no ground of its own, no strip of light, no pale title, no dark tag, no
  //  gold-edged poster, no pale finial)
  assert.ok(!/--lit|--fs-rose|\.fs-shelf::before|\.fs-shelf-(ico|name|txt|tag)|\.fs-theater \.fs-fmt[{:]|\.fs-fmtgrid::after/.test(theater.replace(/\/\*[\s\S]*?\*\//g, "")));
  // WHAT A CREAM CARD NEEDS TO SIT ON A DARK PAGE, the way the ticket has it: a gold hairline for an edge — the
  // card's own 1px border in the lobby's gold, with the dark under it rather than the cream (so it is the same
  // dim gold line the ticket's is) — and a deep, doubled shadow, the ticket's own first
  const ticket = /\.lb\.is-dark\{[^}]*--lb-edge:([^;]+);--lb-drop:([^;]+);\}/.exec(lobby);
  assert.ok(ticket, "the ticket's edge and its shadow, in the dark");
  assert.ok(ofShelf[0].body.startsWith(`border-color:${ticket[1]};`), "a shelf's hairline is the ticket's own");
  assert.ok(ofShelf[1].body.startsWith(`box-shadow:${ticket[2]},`), "a shelf's first shadow is the ticket's own — and a second, closer one lies under it");
  assert.equal(count(ofShelf[1].body, "px #000,") + count(ofShelf[1].body, "rgba(0,0,0,"), 2, "doubled");
});

test("the words read: 4.5:1 or better on the dark — the page, under its light, the bar — and a shelf's are its own ink on its own cream", () => {
  const DARK = "#0A1C13";
  // the page is lightest where the light from above falls: that green at its fullest over the dark…
  const LIT = over(hexOf("36,120,78"), DARK, 0.36);
  // …and where a line of one of the room's two rosettes (gold, at .14 at most) passes behind a word under that light
  const LINE = over("#E7C879", LIT, 0.14);
  assert.ok(theater.includes("html .wb::before{opacity:.14;}") && theater.includes("html .wb::after{opacity:.11;}"));
  const onPage: [string, string][] = [
    ["the logo; a song's title", "#FFFDF7"], ["the logo's second half; the hero's line; the Next-episode sign", "#E7C879"],
    ["the tabs; the hint; a song's mood; the storyboard's note", "#D8CFBA"], ["an error", "#FFB4A6"],
  ];
  for (const [what, colour] of onPage) assert.ok(contrast(colour, DARK) >= 4.5 && contrast(colour, LIT) >= 4.5 && contrast(colour, LINE) >= 4.5, `${what}: ${contrast(colour, LINE).toFixed(2)}`);
  for (const k of [
    ".wb .wb-brand{position:relative;color:#FFFDF7;}", ".wb .wb-brand b{color:#E7C879;}", ".wb .wb-tab:not(.on){color:#D8CFBA;}", ".wb .wb-tab:hover:not(.on){color:#FFFDF7;background:rgba(255,253,247,.08);}",
    ".fs-theater .mm-hint{color:#D8CFBA;}", ".fs-theater .mm > .mm-preview .fs-treat-ttl{color:#FFFDF7;}", ".fs-theater .mm > .mm-preview .fs-treat-mood{color:#D8CFBA;}",
    ".fs-theater .mm > .fs-err{color:#FFB4A6;}", ".fs-theater .mm > .mm-storyboard > .mm-sb-head{color:#D8CFBA;}", ".fs-theater .fs-head-copy b em{color:#E7C879;}",
    ".fs-theater .fs-eps-h{color:#E7C879;font-size:12px;letter-spacing:.24em;text-transform:uppercase;",
  ]) assert.ok(theater.includes(k), k);
  // (what those lines ARE in the light theme is ink or green — unreadable on the dark; that is why each is named above)
  for (const k of [".mm-hint{font-size:12.5px;color:var(--ink2,#4A554E);", ".fs-eps-h{margin:0 0 8px;font-family:Poppins,sans-serif;font-size:14px;font-weight:800;color:var(--ink,#14201A);}", ".mm-sb-head{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:800;color:var(--green,#0C7A46);", ".fs-err{font-size:12.5px;color:#B3421E;"]) assert.ok(before.includes(k), k);
  for (const was of ["#14201A", "#4A554E", "#0C7A46", "#B3421E"]) assert.ok(contrast(was, DARK) < 4.5, was);
  // the language pill: cream words on dark glass (7% cream over the lit dark); the tab you are on and the
  // account chip are the shell's cream cards, with their own ink
  assert.ok(theater.includes(".wb .lt-btn{position:relative;background:rgba(255,253,247,.07);border-color:rgba(231,200,121,.5);color:#FFFDF7;box-shadow:none;}"));
  assert.ok(contrast("#FFFDF7", over("#FFFDF7", LIT, 0.07)) >= 4.5);
  assert.ok(shell.includes(".wb-tab.on{background:var(--card);border:1px solid var(--line);color:var(--ink);"));
  assert.ok(contrast("#14201A", "#FDFCF7") >= 4.5);

  // A SHELF: in the dark it is the light theme's cream card (it was a deep green tray, its words re-inked
  // pale), so its words are the page's own ink on the page's own cream — the pairs the light theme has
  const [CARD_TOP, CARD_FOOT] = ["#FFFEFA", "#FBF8F0"];
  assert.ok(before.includes("background:linear-gradient(180deg,#FFFEFA,#FBF8F0);"), "the card's cream, from its top to its foot");
  assert.ok(before.includes(".fs-shelf-name{margin:0;") && before.includes("color:var(--ink,#14201A);}") && before.includes(".fs-shelf-txt span{font-size:12.5px;font-weight:600;line-height:1.35;color:var(--ink2,#55605A);}"));
  for (const ground of [CARD_TOP, CARD_FOOT]) {
    assert.ok(contrast("#14201A", ground) >= 4.5, `a shelf's name on ${ground}`);
    assert.ok(contrast("#55605A", ground) >= 4.5, `a shelf's line on ${ground}: ${contrast("#55605A", ground).toFixed(2)}`);
  }
  // the card stands off the dark by far more than its hairline needs to say
  assert.ok(contrast(CARD_FOOT, DARK) >= 15 && contrast(CARD_FOOT, LIT) >= 10);
  // its tag: each shelf's accent on that accent's own soft plate, over the cream of the card's first quarter
  // (the heading is the first 52px of a card some 300 tall)
  const HEAD = over(CARD_FOOT, CARD_TOP, 0.25);
  const accents: [string, string, number][] = [];
  for (const key of ["told", "acted", "sung"]) {
    const m = new RegExp(`\\.fs-shelf\\.is-${key}\\{--shelf:(#[0-9A-F]{6});--shelf-soft:rgba\\(([\\d,]+),(\\.\\d+)\\);\\}`).exec(before);
    assert.ok(m && hexOf(m[2]) === m[1], `${key}: the plate is the accent's own colour`);
    accents.push([key, m[1], Number(m[3])]);
  }
  assert.deepEqual(accents, [["told", "#A8741B", 0.1], ["acted", "#0C7A46", 0.09], ["sung", "#6B4BC8", 0.09]]);
  const tagOn = (accent: string, a: number) => contrast(accent, over(accent, HEAD, a));
  for (const [key, accent, a] of accents.filter(([k]) => k !== "told")) assert.ok(tagOn(accent, a) >= 4.5, `${key}: its tag is ${tagOn(accent, a).toFixed(2)}`);
  // …EXCEPT ONE, said as it is: "NARRATED" in the Stories' gold-brown is about 3.5:1 on its plate — under 4.5.
  // It is the LIGHT theme's own colour on the light theme's own card (the page's stylesheet, both themes), so
  // it is not the theater's to change, and was reported with this change. If this line fails because the tag
  // now reads, hold it to 4.5 with the other two.
  const told = tagOn(accents[0][1], accents[0][2]);
  assert.ok(told >= 3.4 && told < 4.5, `the Stories' tag is ${told.toFixed(2)}`);
  // (each shelf's icon is white on its accent: a picture, 3:1)
  for (const [key, accent] of accents) assert.ok(contrast("#FFFFFF", accent) >= 3, `${key}: the icon on ${accent}`);
  // (not one of the dark's pale colours would read on the cream: that is why none is said for a shelf any more)
  for (const pale of ["#FFFDF7", "#D8CFBA", "#E7C879"]) assert.ok(contrast(pale, CARD_TOP) < 1.7, pale);

  // A POSTER and A TICKET: the ink they had, on the ticket's paper
  for (const k of [".fs-fmt-sub{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;padding:9px 11px 12px;font-size:12px;font-weight:700;color:var(--ink,#14201A);line-height:1.34;}", ".fs-fmt-sub em{font-style:normal;font-weight:600;color:var(--ink2,#55605A);}", ".fs-ep-txt span{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:800;color:#0A5E37;}"]) assert.ok(before.includes(k), k);
  for (const paper of ["#FFFDF7", "#F7F0DE"]) for (const ink of ["#14201A", "#55605A", "#0A5E37"]) assert.ok(contrast(ink, paper) >= 4.5, `${ink} on ${paper}`);

  // A PHONE'S TAB BAR: deep green glass, its words cream, the section you are in gold (the white pill was the
  // brightest thing in the room; left white, its green "Dashboard" would still read — on the dark it would not)
  const bar = /\.wb \.wb-bottom\{background:(#[0-9A-F]{6});border-color:rgba\(231,200,121,\.42\);box-shadow:0 14px 34px rgba\(0,0,0,\.6\);\}/.exec(theater);
  assert.ok(bar && isGreen(bar[1]));
  for (const k of [".wb .wb-bt{color:#D8CFBA;}", ".wb .wb-bt.on{color:#E7C879;}", ".wb .wb-bt.on .wb-bt-ic{background:rgba(231,200,121,.16);}", ".wb .wb-bt-mid{color:#D8CFBA;}"]) assert.ok(theater.includes(k), k);
  assert.ok(contrast("#D8CFBA", bar[1]) >= 4.5 && contrast("#E7C879", over("#E7C879", bar[1], 0.16)) >= 4.5);
  assert.ok(shell.includes(".wb-bt-mid{color:var(--green);}") && contrast("#0C7A46", bar[1]) < 4.5);
  assert.ok(shell.includes(".wb-bt-mid .wb-bt-ic{width:40px;height:40px;border-radius:50%;background:var(--green);color:#fff;"), "the Dashboard's own green button is still that");

  // a ring that is seen: gold where it is drawn on the dark (3:1 for a ring) — a ticket's, the hero's two
  // buttons, the header's, the tab bar's …
  assert.ok(theater.includes(".fs-theater .fs-ep-card:focus-visible,.fs-theater .fs-head-tag:focus-visible,.fs-theater .fs-hero-back:focus-visible{outline:2px solid #E7C879;outline-offset:2px;}"));
  assert.ok(theater.includes(".wb .wb-nav a:focus-visible,.wb .wb-nav button:focus-visible{outline-color:#E7C879;}") && theater.includes(".wb .wb-bottom a:focus-visible{outline-color:#E7C879;}"));
  assert.ok(contrast("#E7C879", LIT) >= 3 && contrast("#E7C879", bar[1]) >= 3);
  // … and the shell's own green everywhere else
  assert.ok(shell.includes("outline:2px solid var(--green2,#12A85E);outline-offset:2px;") && contrast("#12A85E", DARK) >= 3, "a white step card's ring is drawn on the dark around it");
  // A POSTER'S ring is drawn on its shelf — cream now — so the theater no longer names it (gold would not be
  // seen there at all). It is the ring the light theme has, on the same card: the shell's green, about 3:1
  // on that cream (2.9 at the card's foot — the shell's own colour, not the theater's to change)
  assert.equal(count(theater, ":focus-visible"), 6, "the three above, and the shell's three");
  assert.ok(!/\.fs-fmt[^,{]*:focus/.test(theater) && !/\.fs-fmt[^,{]*:focus/.test(base), "a poster's ring is the shell's");
  for (const ground of [CARD_TOP, CARD_FOOT]) assert.ok(contrast("#12A85E", ground) >= 2.9 && contrast("#E7C879", ground) < 1.7, ground);
});

test("the gold: the app's own rosette, slow and faint, in BOTH themes — and never over a word", () => {
  // the only file any of the three stylesheets asks for
  for (const s of [theater, gold]) assert.deepEqual([...new Set([...s.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]))], ["/gstyle-rosette.svg"]);
  assert.ok(exists("public", "gstyle-rosette.svg") && !/url\(/.test(rows) && !/https?:|@import|@font-face/.test(theater + rows + gold));
  // every pseudo-element the three draw is empty: no word is written by a stylesheet
  assert.deepEqual([...new Set([...(theater + rows + gold).matchAll(/[;{]content:([^;]+);/g)].map((m) => m[1]))], ['""']);

  // THE PAGE'S OWN THREE — in the page's stylesheet, so in the light theme and in the dark:
  const three = G.filter((r) => /rosette\.svg/.test(r.body) && !r.media.startsWith("@supports"));
  assert.deepEqual(three.map(named), ["@media(max-width:640px) .fs-head::after", ".fs-hero::after", ".fs-shelf .fs-fmtgrid::after"]);
  for (const r of three) {
    // faint, slow, a picture only: it takes no tap and says nothing
    const o = /(?:^|;)opacity:(\.\d+);/.exec(r.body);
    assert.ok(o && Number(o[1]) >= 0.2 && Number(o[1]) <= 0.5, r.sel);
    assert.ok(r.body.includes("pointer-events:none;") && r.body.includes("animation:fsThTurn 170s linear infinite;"), r.sel);
  }
  assert.ok(gold.includes("@keyframes fsThTurn{to{transform:rotate(360deg)}}"), "it only turns: once in nearly three minutes");
  assert.equal(count(gold, "@keyframes") + count(theater, "@keyframes") + count(rows, "@keyframes"), 1);
  // it is the figure the app spins everywhere — gold, as the Presenters' hero has had one in its corner
  assert.ok(read("app", "routes", "web.presenters.tsx").includes("background:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.28;mix-blend-mode:screen;pointer-events:none;will-change:transform;animation:phspin 115s linear infinite;}"));

  // 1 · A PHONE'S HERO, its far bottom corner — gold on the hero's deep green in either theme. The hero's
  //     words keep to the first 60% of it and its tag to the top (the page's own rules, at this very width).
  const hero = three[0].body;
  assert.ok(hero.startsWith("content:\"\";position:absolute;z-index:2;right:-96px;bottom:-100px;width:200px;height:200px;"));
  // (read right to left the hero's words start from the right — it is a flex row — so the free corner is the left one)
  assert.ok(gold.includes("  [dir=rtl] .fs-head::after{right:auto;left:-96px;}\n}"));
  assert.ok(before.includes(".fs-head{position:relative;overflow:hidden;border-radius:20px;margin-bottom:16px;min-height:200px;display:flex;align-items:center;"), "cut off by the hero's own edge");
  assert.ok(before.includes("@media(max-width:640px){.fs-head{padding:18px;min-height:114px;}.fs-head-copy{max-width:60%;}"));
  assert.ok(before.includes("@media(max-width:640px){.fs-head-tag{top:12px;bottom:auto;right:12px;"));
  assert.ok(before.includes(".fs-head-copy{position:relative;z-index:3;") && before.includes(".fs-head-scrim{position:absolute;inset:0;z-index:2;"), "over the shade, under the words");
  for (let vw = 320; vw <= 640; vw += 10) {
    const heroW = vw - 2 * 16; // the page's gutter on a phone
    const wordsEnd = 18 + 0.6 * (heroW - 2 * 18); // the hero's padding, then 60% of what is inside it
    assert.ok(heroW - (200 - 96) >= wordsEnd, `${vw}px: the rosette starts ${heroW - 104}, the words end ${wordsEnd}`);
  }
  assert.ok(!G.some((r) => r.sel === ".fs-head::after" && r.media === ""), "nowhere wider: there the tag sits in that corner");

  // 2 · A FORMAT'S BANNER, its top right corner: its name and line are bottom left, the way back top left
  const banner = three[1].body;
  assert.ok(banner.startsWith("content:\"\";position:absolute;z-index:2;top:-92px;right:-92px;width:184px;height:184px;"));
  assert.ok(gold.includes("@media(min-width:960px){.fs-hero::after{top:-140px;right:-120px;width:300px;height:300px;}}"));
  for (const k of [".fs-hero{position:relative;height:150px;border-radius:16px;overflow:hidden;", ".fs-hero-back{position:absolute;top:19px;left:12px;z-index:4;", ".fs-hero-ttl{position:absolute;left:16px;bottom:27px;z-index:3;", ".fs-hero-sub{position:absolute;left:16px;bottom:14px;z-index:3;", "@media(min-width:960px){.fs-hero{height:260px;}"]) assert.ok(before.includes(k), k);
  // (a phone's banner is 150 tall: the rosette reaches 92 down, and the name starts 27 + a line up from the foot)
  assert.ok(184 - 92 <= 150 - 14 - 20 - 20 && 300 - 140 <= 260 - 14 - 20 - 44);

  // 3 · THE FINIAL: where a row of posters ends. It is an item OF the row — after the last poster, in the row's
  //     own flow — so it can lie under nothing and nothing can lie under it.
  const finial = three[2].body;
  assert.ok(finial.startsWith("flex:0 0 auto;align-self:center;width:calc(var(--pw) * .86);aspect-ratio:1;margin-inline:6px 14px;"));
  assert.ok(!finial.includes("position:") && !finial.includes("content:"), "in flow — and drawn only where the rules below say");
  assert.ok(gold.includes("@media(max-width:979px){.fs-shelf .fs-fmtgrid::after{content:\"\";}}"), "every row that runs off the screen ends in one");
  assert.ok(gold.includes("@media(min-width:640px){.fs-shelf .fs-fmtgrid::after{width:calc(var(--pw) * .62);}}"), "smaller beside a wide poster: never taller than the row");
  // (a phone's poster is 4:5 over three lines of 12px; a wide one 16:9 over two of 13.5px — the finial is a square)
  for (const w of [110, 146, 190]) assert.ok(0.86 * w <= 1.25 * w + 3 * 1.34 * 12 + 21);
  for (const w of [172, 214, 318, 440]) assert.ok(0.62 * w <= 0.5625 * w + 2 * 1.34 * 13.5 + 25);
  // four stand across from 980px: only a row with a place to spare has one, in the middle of the room left
  assert.ok(gold.includes("@media(min-width:980px){\n  .fs-shelf .fs-fmtgrid::after{margin-inline:auto;}\n  .fs-shelf .fs-fmtgrid:has(> .fs-fmt:last-child:not(:nth-child(4n)))::after{content:\"\";}\n}"));
  const spare = heroShelves(FILM_HEROES).map((s) => [s.name, s.heroes.length % 4 !== 0]);
  assert.deepEqual(spare, [["Stories", true], ["Films", false], ["Music videos", true]], "two on a wide screen: Stories and Music videos");
  // it goes with the row when a format is entered
  assert.ok(gold.includes(".fs-shelf .fs-fmtgrid.throw::after{opacity:0;}"));
  // IT IS DRAWN THROUGH the rosette (a mask), in the shell's deep gold: it stands on a shelf's cream, where the
  // bright cut all but vanishes. And it stands on that cream in BOTH themes — in the dark a shelf is the same
  // cream card — so the theater does not re-cut it (it did, in the lobby's pale gold, while the shelves were
  // dark cases: pale gold on cream is no more seen than the bright cut). Where a browser cannot mask, it is
  // the bright cut as it comes (never a gold square).
  assert.ok(gold.includes(".fs-shelf{--fs-rose:#B08526;}") && shell.includes("--gold:#B08526;"), "the shell's own gold");
  assert.ok(gold.includes("@supports ((-webkit-mask-image:none) or (mask-image:none)){.fs-shelf .fs-fmtgrid::after{background:var(--fs-rose);-webkit-mask:url(/gstyle-rosette.svg) center/contain no-repeat;mask:url(/gstyle-rosette.svg) center/contain no-repeat;}}"));
  assert.ok(finial.includes("background:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.5;"));
  assert.ok(!/--fs-rose|\.fs-fmtgrid::after/.test(theater.replace(/\/\*[\s\S]*?\*\//g, "")), "the same finial in the dark: the theater says nothing of it");
  assert.ok(contrast("#B08526", "#FBF8F0") >= 3 && contrast("#FFD24A", "#FBF8F0") < 1.6 && contrast("#E7C879", "#FBF8F0") < 1.6, "seen on the cream card, where the bright cut and the lobby's pale gold are not");
  assert.ok(before.includes("background:linear-gradient(180deg,#FFFEFA,#FBF8F0);"), "a shelf's cream, in both themes");

  // THE ROOM'S TWO GREAT ROSETTES are the shell's own: fixed behind every page, taking no tap, turning once
  // in three and a half minutes and more — green on the cream, as they always were. In the DARK they are only
  // re-cut in gold and made faint; nothing about where they are or how they move is this page's.
  assert.ok(shell.includes(".wb::before,.wb::after{content:\"\";position:fixed;z-index:0;pointer-events:none;\n  background-repeat:no-repeat;background-position:center;background-size:contain;}"));
  assert.ok(shell.includes("background-image:url(/gstyle-rosette-green.svg);animation:wbDrift 210s linear infinite;}") && shell.includes("background-image:url(/gstyle-rosette-green.svg);animation:wbDriftBack 260s linear infinite;}"));
  assert.ok(theater.includes("html .wb::before,html .wb::after{background-image:url(/gstyle-rosette.svg);}\nhtml .wb::before{opacity:.14;}\nhtml .wb::after{opacity:.11;}"));
  // BEHIND the page — its header and everything in it are drawn above them — so never over a word
  assert.ok(shell.includes(".wb-hud,.wb-main{position:relative;z-index:1;}") && shell.includes(".wb-nav{position:relative;z-index:30;"));
  assert.ok(!/position:fixed|z-index:/.test(theater), "the theater lays nothing fixed over the page, and lifts nothing above it");
  assert.ok(!/position:fixed/.test(gold + rows));
});

test("everything that moves stands still for anyone who asks for less motion", () => {
  const still = G.filter((r) => r.media === "@media(prefers-reduced-motion:reduce)");
  const stilled = new Set(still.filter((r) => /(^|;)animation:none;/.test(r.body)).flatMap(parts));
  const moving = G.filter((r) => !r.media.includes("prefers-reduced-motion") && /(^|;)animation(-name)?:(?!none)/.test(r.body)).flatMap(parts);
  assert.deepEqual([...new Set(moving)].sort(), [".fs-head::after", ".fs-hero::after", ".fs-shelf .fs-fmtgrid::after"], "the page's three rosettes, and nothing else");
  for (const sel of moving) assert.ok(stilled.has(sel), `${sel} must stop`);
  // the one thing that fades (a row's finial, as a format is entered) does not
  const fading = G.filter((r) => !r.media.includes("prefers-reduced-motion") && /(^|;)transition:(?!none)/.test(r.body)).flatMap(parts);
  assert.deepEqual(fading, [".fs-shelf .fs-fmtgrid::after"]);
  assert.ok(still.some((r) => r.sel === ".fs-shelf .fs-fmtgrid::after" && r.body === "transition:none;"));
  // …and the banner's slow drift, which the page's own reduced-motion rule named the wrong element for, stops
  assert.ok(before.includes(".fs-hero-blur{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(28px) brightness(.5) saturate(1.12);transform:scale(1.2);z-index:0;animation:fsken 18s ease-in-out infinite alternate;}"));
  assert.ok(stilled.has(".fs-hero-blur"));
  // the theater moves nothing of its own; the room's two are moved by the shell, which stops them itself —
  // and the theater says so again, in case
  assert.ok(!T.some((r) => !r.media.includes("prefers-reduced-motion") && /(^|;)(animation|transition)(-name)?:/.test(r.body)));
  assert.ok(shell.includes("@media (prefers-reduced-motion:reduce){.wb::before,.wb::after{animation:none}}"));
  assert.ok(theater.includes("@media(prefers-reduced-motion:reduce){\n  html .wb::before,html .wb::after{animation:none;}\n}"));
  // the rows move nothing by themselves: no animation, no transition, no scripted or "smooth" scrolling
  assert.ok(!/[;{](animation|animation-name|transition|scroll-behavior):/.test(rows.replace(/\/\*[\s\S]*?\*\//g, "")));
  assert.ok(R.length >= 15);
  // what the page already stilled is still stilled (the posters' walk into a format, the stage, the slate)
  for (const k of ["  .fs-fmtgrid.throw .fs-fmt,.fs-fmtgrid.throw .fs-fmt.zoom{transition:none;opacity:1;transform:none;}", "@media(prefers-reduced-motion:reduce){.fs-slate-stick{animation:none;}}", "@media(prefers-reduced-motion:reduce){.fs-shelf,.fs-shelf-h{transition:none;}}"]) assert.ok(before.includes(k), k);
});

/** THE ROWS' own numbers, read out of the stylesheet. */
const num = (re: RegExp, sheet = rows) => { const m = re.exec(sheet); assert.ok(m, String(re)); return Number(m[1]); };
const ROW = {
  ps: num(/\.fs-shelf\{--tp:14px;--ps:(\d+)px;/), gap: num(/--gap:(\d+)px;/), peWide: num(/--ps:14px;--pe:(\d+)px;/), pe: num(/@media\(max-width:979px\)\{\n  \.fs-shelf\{--pe:(\d+)px;/),
  phone: num(/--pw:min\(calc\(\(100% \+ var\(--pe\) - 2 \* var\(--gap\)\) \/ ([\d.]+)\),190px\);/), tablet: num(/--pw:calc\(\(100% \+ var\(--pe\) - 3 \* var\(--gap\)\) \/ ([\d.]+)\);/),
};
/** A row on a screen `vw` wide: its posters' width, and how many of them show before the screen's edge. */
function rowAt(vw: number): { w: number; shown: number; rowWidth: number; trayEnd: number } {
  const gut = vw <= 760 ? 16 : Math.min(56, Math.max(18, 0.03 * vw)); // the shell's .wb-main padding
  if (vw >= 980) {
    const row = vw - 2 * gut - 2; // the tray, inside its two borders (the row runs from one to the other)
    const w = (row - ROW.ps - ROW.peWide - 3 * ROW.gap) / 4;
    return { w, shown: (row - ROW.ps - ROW.peWide + ROW.gap) / (w + ROW.gap), rowWidth: row, trayEnd: vw - gut };
  }
  const row = vw - gut - 1; // the tray runs to the screen's edge: one border, at its start
  const inside = row - ROW.ps - ROW.pe;
  const w = vw <= 639 ? Math.min((inside + ROW.pe - 2 * ROW.gap) / ROW.phone, 190) : (inside + ROW.pe - 3 * ROW.gap) / ROW.tablet;
  const room = row - ROW.ps; // from the first poster's edge to the screen's
  const whole = Math.floor((room + ROW.gap) / (w + ROW.gap));
  return { w, shown: whole + Math.min(1, Math.max(0, room - whole * (w + ROW.gap)) / w), rowWidth: row, trayEnd: gut + (vw - gut) };
}

test("each shelf is ONE row, swiped sideways, in both themes: 2.3 posters on a phone with the next one peeking, four across on a wide screen", () => {
  // the list is the list it was — the same shelves, the same buttons in the same order, nothing taken out of
  // the tab order — and the element that was the grid is the row (no markup changed)
  for (const k of [
    "{heroShelves(heroes).map((sh) => (",
    "<section key={sh.key} className={`fs-shelf is-${sh.key}`} aria-labelledby={`fs-shelf-${sh.key}`}>",
    "<div className={`fs-fmtgrid${anim === \"in\" ? \" throw\" : \"\"}`} role=\"tablist\" aria-label={t(sh.name)}>",
    "{sh.heroes.map((h) => (",
    "<button type=\"button\" role=\"tab\" key={h.id} className={`fs-fmt${zoomKey === h.id ? \" zoom\" : \"\"}${h.told === \"narrated\" ? \" is-told\" : \"\"}`}\n                aria-selected={heroId === h.id} onClick={() => enterFormat(h.id)}>",
    "<span className=\"fs-fmt-label\"><b>{t(h.name)}</b></span>",
    "{h.kick ? <span className=\"fs-fmt-sub\">{t(h.kick)}{h.meta ? <em> · {t(h.meta)}</em> : null}</span> : null}",
  ]) assert.equal(count(ui, k), 1, k);
  const shelvesJsx = ui.slice(ui.indexOf("{heroShelves(heroes).map((sh) => ("), ui.indexOf("{entered && ("));
  assert.ok(shelvesJsx.length > 1200 && !/tabIndex|inert|scrollIntoView|scrollTo|scrollLeft|scrollBy/.test(shelvesJsx), "every poster is reached by Tab and brought into view by the browser; the row is moved by a finger, a wheel or the keyboard — never by script");
  // the page's own rules above the rows are as they were (other tests pin them too): the shelves, their
  // accents, the four columns a wide screen had
  for (const k of [".fs-shelves{display:grid;gap:18px;margin:18px 0 6px;}", ".fs-shelf .fs-fmtgrid{margin:0;}", "@media(min-width:980px){.fs-shelf .fs-fmtgrid{grid-template-columns:repeat(4,minmax(0,1fr));}}", ".fs-fmtgrid .fs-fmt{flex:none;width:auto;transform-origin:center;}"]) assert.ok(before.includes(k), k);
  // BOTH THEMES: not one of the rows' rules waits on the theme (they are in the page's stylesheet, said by the page's own classes)
  for (const r of R) assert.ok(/^\.fs-(wrap|shelves|shelf|shelf-h|eps-row)\b/.test(r.sel), r.sel);

  // THE ROW: a flex row that scrolls sideways and snaps poster by poster; momentum; a swipe at its end does
  // not drag the page or the browser's "back"; no bar on a touch screen, a thin one where there is a mouse
  assert.ok(rows.includes(".fs-shelf .fs-fmtgrid{display:flex;align-items:flex-start;gap:var(--gap);margin-block:-28px 0;margin-inline:calc(var(--tp) * -1);padding-block:28px 24px;padding-inline:var(--ps) var(--pe);overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-padding-inline:var(--ps) var(--pe);overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none;}"));
  assert.ok(before.includes(".fs-fmt{position:relative;flex:0 0 130px;scroll-snap-align:start;"), "each poster is a place the row stops");
  assert.ok(rows.includes(".fs-shelf .fs-fmtgrid::-webkit-scrollbar{display:none;}") && rows.includes("@media(hover:hover) and (pointer:fine){.fs-shelf .fs-fmtgrid{scrollbar-width:thin;}}"));
  // IN THE DARK that thin bar loses its TRACK. A track is a square, and the row runs to the card's round
  // corner: left as the browser draws it, a white corner stands out past the card's, on the dark page
  // (PHOTOGRAPHED at 800px and 560px with the bars drawn). So: no track, and the thumb in the finial's own
  // deep gold — which is seen on the cream (3:1 for a control), where the lobby's pale gold would not be.
  assert.ok(theater.includes(".fs-theater .fs-shelf .fs-fmtgrid{scrollbar-color:#B08526 transparent;}") && gold.includes(".fs-shelf{--fs-rose:#B08526;}"));
  for (const ground of ["#FFFEFA", "#FBF8F0"]) assert.ok(contrast("#B08526", ground) >= 3 && contrast("#E7C879", ground) < 1.7, ground);
  // (the theater gives the page's own bar its greens, and hands every other bar inside the page back)
  assert.ok(theater.includes("html{scrollbar-color:#2A5A41 #0A1C13;}") && theater.includes("body{scrollbar-color:auto;}") && count(theater, "scrollbar-color:") === 3);
  assert.ok(rows.includes(".fs-shelf .fs-fmtgrid .fs-fmt{flex:0 0 var(--pw);min-width:0;}"));
  assert.deepEqual([ROW.ps, ROW.gap, ROW.pe, ROW.peWide, ROW.phone, ROW.tablet], [14, 12, 16, 14, 2.3, 3.3]);
  assert.ok(rows.includes(".fs-shelf{--tp:14px;--ps:14px;--pe:14px;--gap:12px;--pw:calc((100% - 3 * var(--gap)) / 4);min-width:0;padding-bottom:0;}"), "four across where there is room");
  // (the row spans the tray from border to border: it takes back the tray's own padding, which is 14 — 10 on a small phone)
  assert.ok(before.includes(".fs-shelf{position:relative;border-radius:22px;padding:14px 14px 14px;border:1px solid var(--line,#E4DFCF);") && before.includes("@media(max-width:420px){.fs-shelf{padding:12px 10px 12px;border-radius:18px;}"));
  assert.ok(rows.includes("@media(max-width:420px){.fs-shelf{--tp:10px;}}"));

  // A PHONE: two whole posters and three tenths of the third, whatever the phone
  for (const vw of [320, 360, 375, 390, 412, 430, 480]) {
    const r = rowAt(vw);
    assert.ok(Math.abs(r.shown - 2.3) < 1e-9, `${vw}px shows ${r.shown}`);
    assert.ok(r.w >= 110 && r.w <= 190, `${vw}px: a poster is ${r.w.toFixed(1)} wide`);
    assert.ok(0.3 * r.w >= 30, `${vw}px: ${(0.3 * r.w).toFixed(1)}px of the next poster shows`);
  }
  // (MEASURED on the TEST page at 390px, in both themes: the row 17→390, its posters 31.0→176.6, 188.6→334.3,
  //  346.3→491.9 — the sum below, to the tenth)
  assert.ok(Math.abs(rowAt(390).w - 145.65) < 0.01 && Math.abs(0.3 * rowAt(390).w - 43.7) < 0.01, "390px: posters 145.7 wide, 43.7px of the third");
  assert.ok(Math.abs(17 + ROW.ps + 2 * (rowAt(390).w + ROW.gap) - 346.3) < 0.05);
  // (a very wide phone shows more of them rather than bigger ones)
  for (const vw of [520, 600, 639]) assert.ok(rowAt(vw).w === 190 && rowAt(vw).shown > 2.3, `${vw}px`);
  // A TABLET: three and three tenths
  for (const vw of [640, 768, 834, 979]) assert.ok(Math.abs(rowAt(vw).shown - 3.3) < 1e-9, `${vw}px shows ${rowAt(vw).shown}`);
  // A WIDE SCREEN: four, exactly — as wide as the four columns were
  for (const vw of [980, 1280, 1440, 1920]) {
    const r = rowAt(vw);
    assert.ok(Math.abs(r.shown - 4) < 1e-9, `${vw}px shows ${r.shown}`);
    const gut = Math.min(56, Math.max(18, 0.03 * vw));
    assert.ok(Math.abs(r.w - (vw - 2 * gut - 2 - 28 - 36) / 4) < 1e-9, "the tray's inside (two borders, two paddings of 14), three gaps of 12");
  }
  // with today's shelves: a phone scrolls Stories and Films, and Music videos' two stand whole
  const shelves = heroShelves(FILM_HEROES).map((s) => s.heroes.length);
  assert.deepEqual(shelves, [3, 4, 2]);
  assert.ok(Math.max(...shelves) <= 4, "nothing scrolls on a wide screen today — a fifth poster on a shelf would");

  // THE PAGE NEVER SCROLLS SIDEWAYS. The tray runs to the screen's edge by taking back the page's own gutter
  // — the shell's .wb-main padding, width for width — and not a pixel more.
  assert.ok(shell.includes(".wb-main{max-width:none;margin:0 auto;padding:10px clamp(18px,3vw,56px) 70px;}"));
  const phoneShell = shell.slice(shell.indexOf("@media(max-width:760px){\n  .wb-nav{padding:12px 16px;gap:10px;}"));
  assert.ok(phoneShell.indexOf("  .wb-main{padding:10px 16px calc(98px + env(safe-area-inset-bottom,0px));}") > 0);
  assert.ok(rows.includes(".fs-wrap{--fs-gut:0px;}\n@media(max-width:979px){.fs-wrap{--fs-gut:clamp(18px,3vw,56px);}}\n@media(max-width:760px){.fs-wrap{--fs-gut:16px;}}"));
  assert.ok(rows.includes("  .fs-shelf{--pe:16px;--pw:calc((100% + var(--pe) - 3 * var(--gap)) / 3.3);margin-inline-end:calc(var(--fs-gut) * -1);border-inline-end-width:0;border-start-end-radius:0;border-end-end-radius:0;}"));
  assert.equal(count(rows, "var(--fs-gut) * -1"), 2, "the tray and the Next-episode row: each by the gutter, once");
  for (const vw of [320, 390, 760, 761, 979]) assert.equal(rowAt(vw).trayEnd, vw, `${vw}px: the tray ends at the screen's edge`);
  for (const vw of [980, 1440]) assert.ok(rowAt(vw).trayEnd < vw, "framed on all four sides where four fit");
  // a row can be as long as it likes: the shelf's column cannot be pushed wider than the page by its posters
  assert.ok(rows.includes(".fs-shelves{grid-template-columns:minmax(0,1fr);}") && rows.includes("min-width:0;padding-bottom:0;}"));
  // nothing a row holds leaves it: it is cut off at its own edges (the tray's), top and bottom too
  assert.ok(rows.includes("overflow-x:auto;overflow-y:hidden;"));
  // the heading keeps its place: its tag stands where the page's gutter is, not against the glass
  assert.ok(rows.includes("  .fs-shelf-h{margin-inline-end:calc(2px + var(--fs-gut));}"));
  // the Next-episode row is the same kind of row, to the same edge
  assert.ok(rows.includes(".fs-eps-row{margin-inline-end:calc(var(--fs-gut) * -1);padding-inline-end:16px;scroll-padding-inline-end:16px;}"));
  assert.ok(before.includes(".fs-eps-row{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 2px 6px;scrollbar-width:none;}"));
  // right-to-left: every one of those is said by its logical side, so the row runs off the other edge
  const flat = rows.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/margin-(left|right)|padding-(left|right)|border-(left|right)|border-(top|bottom)-(left|right)-radius/.test(flat));
});

test("a tapped poster still pops where it stands — inside a row that keeps room for it", () => {
  // the walk into a format is the page's own, untouched: the tapped poster grows, the others fall away
  assert.ok(ui.includes("setZoomKey(key); setAnim(\"in\");") && ui.includes("window.setTimeout(() => { if (key !== heroId) switchHero(key); setEntered(true); setAnim(\"\"); setZoomKey(null); }, reduce ? 0 : 400);"));
  const pop = /\.fs-fmtgrid\.throw \.fs-fmt\.zoom\{opacity:1;z-index:6;will-change:transform;transform:scale\(([\d.]+)\);/.exec(before);
  assert.ok(pop && before.includes(".fs-fmtgrid.throw .fs-fmt{opacity:0;transform:scale(.72) translateY(26px);"));
  const grow = (Number(pop[1]) - 1) / 2; // it grows from its middle: this much of its size on every side
  // A row cuts off what leaves it — so it keeps air of its own for the pop: 28px above (taken back from the
  // heading's margin, so nothing moved) and 24 below (the tray's own foot, which it replaces)
  assert.ok(rows.includes("margin-block:-28px 0;") && rows.includes("padding-block:28px 24px;") && rows.includes("padding-bottom:0;}"));
  assert.ok(before.includes(".fs-shelf-h{display:flex;align-items:center;gap:11px;margin:0 2px 12px 6px;"));
  const heightAt = (vw: number, w: number) => (vw <= 639 ? 1.25 * w + 3 * 1.34 * 12 + 21 : 0.5625 * w + 2 * 1.34 * 13.5 + 25); // its picture, then its line
  for (const vw of [320, 360, 390, 430, 480, 639, 640, 768, 979]) {
    const { w } = rowAt(vw);
    assert.ok(grow * heightAt(vw, w) <= 24.6, `${vw}px: the pop grows ${(grow * heightAt(vw, w)).toFixed(1)}px up and down`);
    assert.ok(grow * w <= ROW.ps + 8, `${vw}px: and ${(grow * w).toFixed(1)}px to each side`);
  }
  // (MEASURED on the TEST page at 390px: a poster is 250.8 tall — and the third, which was only peeking at
  //  346→492, popped at 203→372 inside a row that is 17→390, 8px clear above and 4 below)
  assert.ok(Math.abs(heightAt(390, rowAt(390).w) - 250.8) < 3.2);
  // …and the heights that sum assumes are the page's own: 4:5 pictures on a phone, 16:9 from 640px
  assert.ok(before.includes(".fs-fmt-cover{position:relative;display:block;aspect-ratio:4/5;overflow:hidden;background:#20302A;}") && before.includes("@media(min-width:640px){.fs-fmt-cover{aspect-ratio:16/9;}}"));
  assert.ok(before.includes("@media(min-width:640px){.fs-fmt-sub{padding:11px 16px 14px;font-size:13.5px;}}"));
  // where four fit there is nothing to scroll, so nothing is cut at all (a browser that cannot ask ":has"
  // keeps the row clipped — still a row, still safe)
  assert.ok(rows.includes("@media(min-width:980px){.fs-shelf .fs-fmtgrid:not(:has(> .fs-fmt:nth-child(5))){overflow:visible;}}"));
  // A POSTER THAT WAS ONLY PEEKING is brought inside the row as it pops (it cannot fly half off the screen):
  // sticky to both of the row's edges, only while it is the one flying
  assert.ok(rows.includes(".fs-shelf .fs-fmtgrid.throw .fs-fmt.zoom{position:sticky;left:var(--ps);right:var(--ps);}"));
  assert.equal(count(rows, "position:"), 1);
  // as it flies it leaves its cream card and crosses the dark page, where its own shadow could not be seen:
  // there it flies in a ring of gold (2px: inside the row's air)
  assert.ok(theater.includes(".fs-theater .fs-fmtgrid.throw .fs-fmt.zoom{box-shadow:0 0 0 2px #E7C879,0 24px 40px -20px #000;}"));
  // THE SHELVES STILL FALL AWAY — the cream card, its bar, its heading — by the page's own rules, and the
  // theater leaves nothing of a card behind as a poster flies:
  const FALL = ".fs-shelves.throw .fs-shelf";
  assert.ok(before.includes(FALL + "{background:transparent;border-color:transparent;}") && before.includes(".fs-shelves.throw .fs-shelf::before,.fs-shelves.throw .fs-shelf-h{opacity:0;}"));
  const classes = (sel: string) => count(sel, ".");
  const cards = T.filter((r) => /\.fs-shelf$/.test(r.sel));
  assert.deepEqual(cards.map((r) => r.sel), [".fs-theater .fs-shelf", ".fs-theater .fs-shelves:not(.throw) .fs-shelf"]);
  // · its gold EDGE is said by a rule of TWO classes: the page's falling-away rule has three, and takes it
  assert.deepEqual(props(cards[0].body), ["border-color", "background-clip"]);
  assert.ok(classes(cards[0].sel) === 2 && classes(FALL) === 3 && classes(cards[0].sel) < classes(FALL));
  // · its SHADOW is cast only while the shelves stand (the rule cannot match a shelf that is falling away,
  //   and the page gives a shelf no shadow of its own to go back to)
  assert.deepEqual(props(cards[1].body), ["box-shadow"]);
  assert.ok(cards[1].sel.includes(".fs-shelves:not(.throw) "));
  assert.ok(![...base.matchAll(/\.fs-shelf\{[^}]*\}/g)].some((m) => /box-shadow/.test(m[0])));
  // · and it says nothing at all OF a shelf that is falling away
  assert.ok(!/\.fs-theater \.fs-shelves\.throw/.test(theater));
});

test("a poster's words are never cut by the narrower card, and every card is the same height", () => {
  // a phone's card is 146 wide where it was 161: the line under the name gets a third line there…
  assert.ok(rows.includes("@media(max-width:639px){.fs-shelf .fs-fmt-sub{-webkit-line-clamp:3;min-height:calc(1.34em * 3 + 21px);}}"));
  // …and every card keeps room for the same number of lines, so a row's cards end on one line
  assert.ok(rows.includes(".fs-shelf .fs-fmt-sub{min-height:calc(1.34em * 2 + 21px);}") && rows.includes("@media(min-width:640px){.fs-shelf .fs-fmt-sub{min-height:calc(1.34em * 2 + 25px);}}"));
  assert.ok(shell.includes("*{box-sizing:border-box}"), "(the 21 and 25 are the line's own padding: a box is measured with it)");
  // the longest line a poster carries is about 45 characters (film-heroes.ts): three lines of a 146px card hold it
  const longest = Math.max(...FILM_HEROES.map((h) => (h.kick + (h.meta ? ` · ${h.meta}` : "")).length));
  assert.ok(longest <= 45, String(longest));
  const perLine = (rowAt(390).w - 2 * 11) / 6.6; // 12px bold, about 6.6px a character at its widest
  assert.ok(3 * (perLine - 4) >= longest, `three lines hold ${Math.floor(3 * (perLine - 4))} characters, breaking at words`);
  // a name that is one long word (a German one) breaks instead of running out of its card
  assert.ok(rows.includes(".fs-shelf .fs-fmt-label b{overflow-wrap:anywhere;}"));
  // a finger gets far more than 44px of every poster, and the theater's small targets are made up to it
  assert.ok(rowAt(320).w >= 100);
  assert.ok(theater.includes("@media(max-width:640px){.fs-theater .fs-head-tag::after{content:\"\";position:absolute;inset:-8px -4px;}}") && before.includes("min-height:28px;padding:4px 10px 4px 9px;font-size:11px;}"), "28 + 8 + 8");
  assert.ok(theater.includes(".wb .wb-brand::after,.wb .lt-btn::after{content:\"\";position:absolute;inset:-7px -3px;}"), "the logo (30) and the language pill (32)");
  assert.ok(before.includes(".fs-hero-back{min-height:40px;}") && before.includes(".fs-ep-card{flex:0 0 auto;width:min(240px,74vw);min-height:64px;"));
  // the theater makes no type smaller than the page's smallest label, and resizes no control
  for (const r of pageRules) {
    const fsz = /font-size:([\d.]+)px/.exec(r.body);
    if (fsz) assert.ok(Number(fsz[1]) >= 12, r.sel);
    assert.ok(!/(^|;)(min-|max-)?(height|width):/.test(r.body) || /::(before|after)$/.test(r.sel), `${r.sel} resizes something`);
  }
});

test("in the dark the Next-episode cards are tickets under a sign in gold — and a shelf keeps its own coloured bar", () => {
  // the sign: gold, sign-painted — its letter-spacing given up where a script joins its letters
  assert.ok(theater.includes("text-transform:uppercase;text-shadow:0 0 14px rgba(231,200,121,.5);}") && theater.includes("[dir=rtl] .fs-theater .fs-eps-h{letter-spacing:0;font-size:13.5px;}"));
  // the heading is still the page's heading, in the page's words
  assert.ok(ui.includes("<h2 id=\"fs-eps-h\" className=\"fs-eps-h\">{t(\"Next episode\")}</h2>"));
  // the perforation between a ticket's picture and its words (the brown of the print on the lobby's ticket)
  assert.ok(theater.includes(".fs-theater .fs-ep-txt{align-self:stretch;justify-content:center;padding-inline-start:10px;border-inline-start:2px dashed rgba(107,79,14,.42);}"));
  assert.ok(before.includes(".fs-ep-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;}"), "a column: \"centre\" keeps its two lines in the middle of the card");
  // a shelf: its accent is the bar down its side, as in the light theme (while the shelves were dark cases it
  // was a strip of light along the top) — the theater draws no pseudo-element of a shelf's at all
  assert.ok(before.includes(".fs-shelf::before{content:\"\";position:absolute;left:0;top:18px;bottom:18px;width:4px;border-radius:0 4px 4px 0;background:var(--shelf);opacity:.85;}"));
  assert.ok(!T.some((r) => /\.fs-(shelf|fmt)[^,]*::(before|after)/.test(r.sel)));
  // the shelves' words are not a theme's to change: three shelves, their names, lines and tags
  assert.deepEqual(heroShelves(FILM_HEROES).map((s) => [s.name, s.tag, s.line]), [
    ["Stories", "Narrated", "A narrator tells it over moving pictures · ready in minutes"],
    ["Films", "Acted", "Actors speak the lines on camera"],
    ["Music videos", "Sung", "Your artist sings on camera"],
  ]);
  // no gradient fades to the bare keyword (an old Safari greys it): every one ends in its own colour at nothing
  // (the one "transparent" in the sheet is a row's bar's track, which is no gradient)
  assert.ok(!/transparent/.test(theater.replace(/\/\*[\s\S]*?\*\//g, "").replace("scrollbar-color:#B08526 transparent;", "")));
});
