/* THE APP PERFORMS — four small moments made of the member's own film.
 *
 * The owner, twice (2026-11-23, 2026-11-24): "genius level artistic detail additions that make the app feel
 * alive". What he has praised is the turning figure on a cast card and a page whose hero art is his own
 * cast: the app's chrome made out of the member's OWN content, with motion, at the moments that matter.
 *
 *   THE SLATE      pressing Generate is "action!" — a slate claps, and it is THIS film's slate
 *   NOW SHOWING    a finished film is announced as a premiere: its own poster, a marquee, its cast
 *   THE WALK-ON    the storyboard's cast come on one by one, then its places
 *   THE SHELF      a film's poster in the Archive catches the light
 *
 * All four are drawn by the page (no picture is made, nothing is charged), say nothing aloud, and stand
 * still for anyone who asks for less motion. Looked at on a TEST page built from the pages' own css
 * (scratchpad mvfix/make-alive-mock.cjs) before they were shipped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { slateTitle } from "../app/lib/film-slate.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// (a checkout with CRLF line endings must read the same as one with LF)
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("the slate is headed with the film's title — or, before a word is written, the idea's first words", () => {
  assert.equal(slateTitle("The Keeper of the Hour", "anything", "Short Story"), "The Keeper of the Hour");
  assert.equal(slateTitle("  The  Keeper of\nthe Hour ", "", "Short Story"), "The Keeper of the Hour", "one line");
  // made in one press there is no title yet: the first seven words of the idea, then an ellipsis
  assert.equal(slateTitle("", "a retired clockmaker named Edda still winds the old clock tower every evening", "Short Story"), "a retired clockmaker named Edda still winds…");
  assert.equal(slateTitle(null, "two market sellers", "Short Film"), "two market sellers");
  // no idea either ("surprise me"): the format's own name
  assert.equal(slateTitle(undefined, "   ", "Horror Story"), "Horror Story");
  assert.ok(slateTitle("x".repeat(200), "", "f").length <= 80);
});

test("the slate claps ONCE when a film is sent off: this film's title, its director (you), its scenes, today", () => {
  const page = read("app", "routes", "web.film.tsx");
  const fn = page.slice(page.indexOf("function Slate({ title, format, scenes }"), page.indexOf("type CastMember = {"));
  assert.ok(fn.includes("<div className=\"fs-slate\" role=\"img\" aria-label={t(\"Slate: {title}\", { title })}>"), "one picture to a screen reader, named by the film");
  assert.ok(fn.includes("<div className=\"fs-slate-prod\"><i>{t(\"Production\")}</i><b>{title}</b></div>"));
  assert.ok(fn.includes("<span><i>{t(\"Director\")}</i><b>{t(\"You\")}</b></span>"), "directed by the member");
  assert.ok(fn.includes("<span><i>{t(\"Scenes\")}</i><b>{scenes}</b></span>"));
  assert.ok(fn.includes("<div className=\"fs-slate-fmt\">{format}</div>"));
  // the date is the member's own day: read in the browser, never on the server
  assert.ok(fn.includes("useEffect(() => { try { setWhen(new Date().toLocaleDateString(undefined, { month: \"short\", day: \"numeric\" })); } catch { setWhen(\"\"); } }, []);"));
  // shown with the "Rolling!" notice — the title the storyboard has, else the idea, else the format
  assert.ok(page.includes("<Slate title={slateTitle(seeds?.treatment?.title || treatment?.title, topic, t(hero?.name || \"Film\"))} format={t(hero?.name || \"Film\")} scenes={scenes} />"));
  assert.ok(page.indexOf("<Slate title=") < page.indexOf("{t(\"Rolling! Your film is rendering"), "the slate, then the words");
  // one clap (the stick is hinged at its left end and bounces once); shut for anyone who asks for less motion
  assert.ok(page.includes("transform-origin:9px 60%;animation:fsClap .66s cubic-bezier(.45,0,.9,.45) .18s both;"));
  assert.ok(page.includes("@keyframes fsClap{0%{transform:rotate(-15deg)}58%{transform:rotate(0deg)}72%{transform:rotate(-2.6deg)}100%{transform:rotate(0deg)}}"));
  assert.ok(!/fsClap[^;}]*infinite/.test(page), "once");
  assert.ok(page.includes("@media(prefers-reduced-motion:reduce){.fs-slate-stick{animation:none;}}"));
  // it fits a phone: never wider than its card
  assert.ok(page.includes(".fs-slate{position:relative;z-index:2;width:min(100%,290px);"));
  assert.ok(!/<audio|new Audio\(/.test(fn), "it says nothing aloud");
});

test("a finished film is announced as a premiere — when it made its own poster", () => {
  const lib = read("app", "lib", "ready-notice.ts");
  assert.ok(lib.includes("poster?: string | null;") && lib.includes("cast?: string[] };"));
  const srv = read("app", "lib", "ready-notice.server.ts");
  assert.ok(srv.includes("select: { id: true, title: true, createdAt: true, metaJson: true },"));
  assert.ok(srv.includes("const poster = posterOf(v.metaJson);"), "only one of OUR render pictures is believed");
  assert.ok(srv.includes("const cast = poster ? storyStars(v.metaJson).map((s) => s.name).slice(0, 3) : [];"));
  assert.ok(srv.includes("...(poster ? { poster, cast } : {}) } };"), "a piece with no poster is announced exactly as before");
  const shell = read("app", "routes", "web.tsx");
  const fn = shell.slice(shell.indexOf("function ReadyNotice("), shell.indexOf("export default function WebLayout()"));
  assert.ok(fn.includes("if (piece.poster) {"));
  assert.ok(fn.includes("<div className=\"wb-ready is-premiere\" role=\"status\" aria-live=\"polite\">"));
  // the poster opens the film; it is not a second thing to tab to or hear
  assert.ok(fn.includes("<Link className=\"wb-ready-poster\" to={to} onClick={() => setPiece(null)} tabIndex={-1} aria-hidden=\"true\"><img src={piece.poster} alt=\"\" /></Link>"));
  assert.ok(fn.includes("{t(\"Now showing\")}"));
  // the film's own title (without the format in front), and who is in it — the format when nobody is billed
  assert.ok(fn.includes("const name = cut >= 0 ? piece.title.slice(cut + 3) : piece.title;"));
  assert.ok(fn.includes("const billed = (piece.cast || []).filter(Boolean).slice(0, 3).join(\" · \") || (cut >= 0 ? piece.title.slice(0, cut) : \"\");"));
  assert.ok(fn.includes("<Link className=\"wb-ready-go\" to={to} onClick={() => setPiece(null)}>{t(\"Watch it\")}</Link>"));
  assert.equal(fn.split("className=\"wb-ready-x\" aria-label={t(\"Dismiss\")}").length - 1, 2, "it can always be dismissed");
  // the light crosses the poster twice and stops; the marquee's bulbs chase; neither for reduced motion
  assert.ok(shell.includes("animation:wbShine 1.5s ease-out .55s 2 backwards;"));
  assert.ok(shell.includes("@media(prefers-reduced-motion:reduce){.wb-ready-poster::after{animation:none;}.wb-ready-bulbs i{animation:none;opacity:.9;}}"));
  // a phone: the marquee keeps to one line, and the buttons stay thumb-sized
  assert.ok(shell.includes(".wb-ready.is-premiere .wb-ready-bulbs.is-after{display:none;}"));
  assert.ok(shell.includes(".wb-ready-now{display:inline-flex;") && shell.includes("white-space:nowrap;}"));
  assert.ok(shell.includes(".wb-ready-go,.wb-ready-x{min-height:44px;}"));
});

test("the storyboard's cast walk on one by one, then its places", () => {
  const page = read("app", "routes", "web.film.tsx");
  assert.ok(page.includes("{stars.map((c, k) => {"));
  assert.ok(page.includes("className=\"mm-star\" style={{ [\"--i\" as string]: k }}>"));
  assert.ok(page.includes("className=\"mm-star is-place\" style={{ [\"--i\" as string]: stars.length + k }}>"), "the places after the last of the cast");
  assert.ok(page.includes(".mm-stars-row .mm-star{animation:mmStarOn .52s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,0) * 120ms);}"));
  assert.ok(page.includes("@media(prefers-reduced-motion:reduce){.mm-stars-row .mm-star{animation:none;}}"));
  // a card is keyed by who it is AND their picture: a character drawn again is a new card, and walks on again
  assert.ok(page.includes("<div key={`${c.name}|${c.img}`} className=\"mm-star\""));
});

test("a film's poster on the shelf catches the light — once as the shelf comes up, again under a pointer", () => {
  const arc = read("app", "routes", "web.archive.tsx");
  assert.ok(arc.includes("className={`wa-poster${a.poster ? \" has-poster\" : \"\"}`} style={a.poster ? { [\"--k\" as string]: Math.min(k, 11) } : undefined}"), "only a film that made its own poster; one after another, the first dozen");
  assert.ok(arc.includes("animation:waShine 1.25s ease-out calc(.35s + var(--k,0) * 110ms) 1 backwards;"), "once");
  assert.ok(arc.includes("@media(hover:hover){\n  .wa-poster.has-poster:hover img{transform:scale(1.035);}"), "a pointer only: a finger's tap opens the film");
  assert.ok(arc.includes("@media(prefers-reduced-motion:reduce){.wa-poster.has-poster::after{animation:none;}"));
  // the light is drawn over the picture and never takes a tap from it
  assert.ok(arc.includes(".wa-poster.has-poster::after{content:\"\";position:absolute;inset:0;pointer-events:none;"));
});

test("every word these four show is in all five languages", () => {
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Production", "Director", "You", "Date", "Now showing", "Slate: {title}", "Scenes", "Watch it", "Dismiss"]) {
    assert.ok(dict.split(`${JSON.stringify(k)}:`).length - 1 >= 5, k);
  }
});
