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
import { REEL_FRAMES, cookingReel, cookingTitle } from "../app/lib/story-picture.ts";

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
  // (a next episode made with the idea box empty has no title yet — but it has a series: seen live, the
  //  slate of "The Keeper of the Hour — Episode 2" said only "Short Story")
  assert.ok(page.includes("<Slate title={slateTitle(seeds?.treatment?.title || treatment?.title || (series ? `${series.title} — ${t(\"Episode {n}\", { n: series.episode })}` : \"\"), topic, t(hero?.name || \"Film\"))} format={t(hero?.name || \"Film\")} scenes={scenes} />"));
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

/* THE REEL. A story's pictures exist minutes before its film does, so the tile that says "Rendering · ~3 min
 * left" is not a spinner on a green card: the story's own pictures pass behind it. */
test("while a story renders, its own pictures pass behind the spinner — and the tile carries its title", () => {
  const six = Array.from({ length: 6 }, (_, k) => `/renders/img-${k}.jpg`);
  assert.equal(REEL_FRAMES, 4);
  // a storyboard's pictures are sent with the job (as the page had them: on any of our hosts)
  assert.deepEqual(cookingReel({ approvedSceneImgs: six.map((u) => `https://marginmonster-fiew.onrender.com${u}`) }), ["/renders/img-0.jpg", "/renders/img-2.jpg", "/renders/img-3.jpg", "/renders/img-5.jpg"], "four frames, first to last");
  // a story made in one press keeps each picture as it is drawn (a JSON list in the job's own notes)
  assert.deepEqual(cookingReel({ ckImages: JSON.stringify(six) }), ["/renders/img-0.jpg", "/renders/img-2.jpg", "/renders/img-3.jpg", "/renders/img-5.jpg"]);
  assert.deepEqual(cookingReel(JSON.stringify({ ckImages: JSON.stringify(six.slice(0, 3)) })), ["/renders/img-0.jpg", "/renders/img-1.jpg", "/renders/img-1.jpg", "/renders/img-2.jpg"], "three scenes: the middle one is held");
  assert.deepEqual(cookingReel({ approvedSceneImgs: [null, null], ckImages: JSON.stringify(six.slice(0, 2)) }), ["/renders/img-0.jpg", "/renders/img-0.jpg", "/renders/img-1.jpg", "/renders/img-1.jpg"], "nothing sent with the job: what it has drawn so far");
  // one picture is not a reel; a picture that is not ours is never shown
  assert.deepEqual(cookingReel({ ckImages: JSON.stringify(six.slice(0, 1)) }), []);
  assert.deepEqual(cookingReel({ approvedSceneImgs: ["https://evil.example/a.jpg", "/renders/../b.jpg", "/renders/ok-1.jpg", "/avatars/x.png", 7, null] }), []);
  assert.deepEqual(cookingReel({ approvedSceneImgs: ["https://evil.example/a.jpg", "/renders/ok-1.jpg", "/renders/ok-2.png"] }), ["/renders/ok-1.jpg", "/renders/ok-1.jpg", "/renders/ok-2.png", "/renders/ok-2.png"]);
  for (const bad of [null, undefined, "", "{", 4, [], {}, { ckImages: "not json" }]) assert.deepEqual(cookingReel(bad), []);
  // the title, once the writer has given it one: the job's own script, then the one the page approved
  assert.equal(cookingTitle({ ckTreatment: JSON.stringify({ title: "The  Keeper of\nthe Hour — Episode 2" }) }), "The Keeper of the Hour — Episode 2");
  assert.equal(cookingTitle({ approvedTreatment: JSON.stringify({ title: "The Bride of the Black Water", scenes: [] }) }), "The Bride of the Black Water");
  assert.equal(cookingTitle({ approvedTreatment: { title: "An object, not a string" } }), "An object, not a string");
  for (const none of [{}, { ckTreatment: "{" }, { ckTreatment: JSON.stringify({ title: 4 }) }, null, "x"]) assert.equal(cookingTitle(none), "");
  assert.ok(cookingTitle({ ckTreatment: JSON.stringify({ title: "x".repeat(300) }) }).length <= 80);

  // THE ARCHIVE: a film's tile only, never a failed one; its title where an ad's product would be named
  const arc = read("app", "routes", "web.archive.tsx");
  assert.ok(arc.includes("const isFilm = j.type === \"GENERATE_VIDEO_AD\" && p.contentType === \"film\";"));
  assert.ok(arc.includes("const reel = isFilm && !failed ? cookingReel(p) : [];"));
  assert.ok(arc.includes("productTitle: p.productTitle || (isFilm ? cookingTitle(p) : \"\"), reel, etaSec,"));
  assert.ok(arc.includes("className={`wb-cookimg${j.reel.length ? \" has-reel\" : \"\"}`}"));
  assert.ok(arc.includes("{j.reel.map((src, k) => <i key={`${k}|${src}`} style={{ backgroundImage: `url(${src})`, [\"--k\" as string]: k }} />)}"));
  assert.ok(arc.includes("<span className=\"wb-reel\" aria-hidden=\"true\">"), "decoration: the tile's words already say what is happening");
  // its look: four frames a cycle (each a quarter of it), held and let drift; still for reduced motion
  const shell = read("app", "routes", "web.tsx");
  assert.ok(shell.includes(".wb-reel i{position:absolute;inset:-4%;background-size:cover;background-position:center;opacity:0;animation:wbReel 12s linear infinite;animation-delay:calc(var(--k,0) * 3s);}"));
  assert.ok(shell.includes("@keyframes wbReel{0%{opacity:0;transform:scale(1)}4%{opacity:1}25%{opacity:1}30%{opacity:0;transform:scale(1.07)}100%{opacity:0;transform:scale(1.07)}}"));
  assert.equal(12 / REEL_FRAMES, 3, "a frame every three seconds of a twelve-second cycle");
  assert.ok(shell.includes("@media(prefers-reduced-motion:reduce){.wb-reel i{animation:none;}.wb-reel i:first-child{opacity:1;}}"));
  // the spinner and its words stay on top, and readable
  assert.ok(shell.includes(".wb-reel::after{content:\"\";position:absolute;inset:0;z-index:1;background:linear-gradient(rgba(10,14,12,.34),rgba(10,14,12,.6));}"));
  assert.ok(shell.includes(".wb-bufwrap{position:relative;z-index:1;display:grid;place-items:center;gap:9px;}"));
});
