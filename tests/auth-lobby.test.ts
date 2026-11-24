/* THE LOBBY — the sign-in screens as the front of a cinema that is showing what the app makes.
 *
 * The owner, 2026-11-24, with a phone screenshot of /web/login: "Mobile login page looks 'Why do I even have
 * this app' when it should read holy shit this app is amazing. I'm assuming desktop has same problem. Needs
 * art and badass cinema". The screen was a cream card on a pale page; nothing on it showed what the app makes.
 *
 * So the four doors (log in, sign up, forgot, reset) stand in one room, app/components/AuthLobby.tsx: a
 * marquee sign, a wall of cards drifting past, a screen on a wide screen, and the form printed on an
 * admission ticket.
 *
 * The same day, with that live on his phone:
 *   "The cheap shimmer on the covers here also need to go - and they should be playing the video as a bigger
 *    flex, not just a still"
 *   "But the Admit one light cream card over the dark is extremely attractive bro."
 *   "But it kinda makes the app appear to only do movies 'make a movie' needs others flexed I think also
 *    (presenter with product in the now showing cards)"
 *   "Remember to visualize the app having 'Main Houses' Film, ads, creation"
 *
 * So: no light crosses a card; every card PLAYS its own clip while it is in view; the wall and the screen
 * show every house (an ad with a presenter holding a product, a Creator piece, the cast, auto-posting — each
 * billed under its house's name the way a film is billed under its format); the line says films, ads,
 * anything; and the ticket is exactly as it was.
 *
 * What must stay true, and is held here:
 *   · the forms are the forms they were — every field, hidden input, link and error line
 *   · only the app's own showcase art is shown, and each piece is a file that is there
 *   · a clip is fetched when its card is first in view, plays only while it is in view, stops when the tab is
 *     hidden; never with "reduce motion" or "save data"; never more than six at once; a failed one stays a still
 *   · everything that moves stands still for anyone who asks for less motion
 *   · the words on the dark read (4.5:1 or better), fields stay 16px, a finger gets 44px
 *   · every word is in all five languages
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILM_HEROES } from "../app/lib/film-heroes.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// (a checkout with CRLF line endings must read the same as one with LF)
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const exists = (...p: string[]) => fs.existsSync(path.join(root, ...p));
const sizeOf = (...p: string[]) => fs.statSync(path.join(root, ...p)).size;
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const lobby = read("app", "components", "AuthLobby.tsx");
const CSS_OPEN = "export const AUTH_LOBBY_CSS = `";
const DARK_OPEN = "export const AUTH_LOBBY_DARK_CSS = `";
const sheetText = (open: string) => { const at = lobby.indexOf(open); assert.ok(at > 0, open); return lobby.slice(at + open.length, lobby.indexOf("`;", at)); };
/** The lobby's own sheet — drawn by day and by night… */
const baseCss = sheetText(CSS_OPEN);
/** …and the night's, put on the shell only when the visitor's theme is dark. */
const darkCss = sheetText(DARK_OPEN);
/** Both, as a visitor has them at night (by day there is only the first). */
const css = baseCss + darkCss;
const component = lobby.slice(0, lobby.indexOf(CSS_OPEN));
const DOORS = ["web.login.tsx", "web.signup.tsx", "web.forgot.tsx", "web.reset.$token.tsx"];
const door = (f: string) => read("app", "routes", f);
/** A list the component declares, e.g. WALL_ORDER = ["a", "b"]. */
const list = (name: string) => {
  const m = new RegExp(`const ${name} = (?:new Set\\()?\\[([^\\]]+)\\]`).exec(lobby);
  assert.ok(m, name);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};
const HOUSES = ["ad", "creator", "cast", "autopost"];
const FILMS = FILM_HEROES.map((h) => h.media);

/** The stylesheet as its rules: the selector, the declarations, and the @media it stands in ("" for none). */
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
const sheet = rules(css);

test("all four doors stand in the lobby — and each form is the form it was", () => {
  for (const f of DOORS) {
    const src = door(f);
    assert.ok(src.includes('import { AuthLobby, lobbyThemeColor } from "../components/AuthLobby";'), f);
    assert.ok(src.includes("<AuthLobby lang={lang}>"), `${f}: read in the page's own language`);
    // the room is the lobby's: no door keeps a card or a stylesheet of its own
    assert.ok(!src.includes('className="wb-auth wb-card"') && !src.includes("AUTH_FX") && !src.includes("<style"), f);
    // …and none of them draws a picture or a film itself
    assert.ok(!/<img|<video|\/landing\/|\/showcase\//.test(src), f);
    // every form still posts back to its own door
    const forms = count(src, "<Form ");
    assert.ok(forms >= 1 && forms === count(src, '<Form method="post">'), `${f}: every form posts to its own door`);
    assert.ok(src.includes('<input type="hidden" name="lang" value={lang} />'), `${f}: the language is still posted`);
    // a phone's own bar takes a colour from the door (WHICH colour is the door's to say: it must follow the
    // visitor's theme — the lobby names both, LOBBY_PAGE — and that is wired in the routes, not here)
    assert.ok(src.includes("lobbyThemeColor(matches)") && !/theme-color|#130E0B/i.test(src.replace(/\/\/[^\n]*/g, "")), `${f}: the bar's colour is the lobby's, in the visitor's light`);
  }
  assert.ok(component.includes('export const LOBBY_PAGE = { light: "#F4F1E6", dark: "#08150E" } as const;'));
  assert.equal(count(lobby, '<div className="lb-ticket wb-auth wb-card">'), 1, "one ticket, and it is still the shell's card");
  assert.ok(lobby.includes("{children}"));

  const login = door("web.login.tsx");
  assert.ok(login.includes('{ title: "Log in · EasyMode" }'));
  assert.ok(login.includes('if (await getWebIdentity(request)) throw redirect("/web");'));
  assert.ok(login.includes("{error && <div className=\"wb-err\" role=\"alert\" tabIndex={-1} ref={errRef}>{error}</div>}"));
  assert.ok(login.includes('<input type="hidden" name="tz" value={tz} />'));
  assert.ok(login.includes('<input className="wb-in" id="li-email" name="email" type="email" required autoComplete="email" placeholder={c.emailPlaceholder} autoFocus={!error} />'));
  assert.ok(login.includes('<input className="wb-in" id="li-pw" name="password" type={showPw ? "text" : "password"} required autoComplete="current-password" placeholder={c.passwordPlaceholder} />'));
  assert.ok(login.includes('<button type="button" className="wb-pw-eye" aria-label={showPw ? c.hidePw : c.showPw} aria-pressed={showPw} onClick={() => setShowPw((v) => !v)}>'));
  assert.ok(login.includes('<button className="wb-btn" type="submit" disabled={busy} aria-busy={busy}>'));
  assert.ok(login.includes('<Link to="/web/forgot">{c.forgot}</Link>'));
  assert.ok(login.includes('{c.newHere}<Link to="/web/signup">{c.createLink}</Link>'));
  assert.ok(login.includes("return webSessionRedirect(account);"));

  const signup = door("web.signup.tsx");
  assert.ok(signup.includes('<input type="hidden" name="tz" value={tz} />'));
  assert.ok(signup.includes('<input className="wb-in" id="su-name" name="name" autoComplete="organization" placeholder={c.namePlaceholder} autoFocus={!error} />'));
  assert.ok(signup.includes('className="wb-in" id="su-email" name="email" type="email" required autoComplete="email" placeholder={c.emailPlaceholder}'));
  assert.ok(signup.includes('className="wb-in" id="su-pw" name="password" type={showPw ? "text" : "password"} required minLength={8} autoComplete="new-password" placeholder={c.passwordPlaceholder}'));
  assert.ok(signup.includes('{emailHint && <div className="wb-hint" id="su-email-hint">{emailHint}</div>}'));
  assert.ok(signup.includes('{pwHint && <div className="wb-hint" id="su-pw-hint">{pwHint}</div>}'));
  assert.ok(signup.includes('<a href="/terms" target="_blank" rel="noreferrer">{c.consentTerms}</a>'));
  assert.ok(signup.includes('<a href="/privacy" target="_blank" rel="noreferrer">{c.consentPrivacy}</a>.'));
  assert.ok(signup.includes('{c.haveOne}<Link to="/web/login">{c.logInLink}</Link>'));
  assert.ok(signup.includes("const account = await createWebAccount(email, password, name || undefined, lang, timezone);"));

  const forgot = door("web.forgot.tsx");
  assert.equal(count(forgot, '<Form method="post">'), 2, "ask for the link, and ask again");
  assert.ok(forgot.includes('<input type="hidden" name="email" value={email} />'), "the resend still carries the address");
  assert.ok(forgot.includes('<input className="wb-in" id="fg-email" name="email" type="email" required autoComplete="email" placeholder={c.emailPlaceholder} value={email} onChange={(e) => setEmail(e.currentTarget.value)} autoFocus />'));
  assert.ok(forgot.includes('{error && <div className="wb-err" role="alert">{error}</div>}'));
  assert.ok(forgot.includes('<p className="wb-sub">{c.forgotOff.replace("{contact}", CONTACT)}</p>'), "email not switched on: still said, still no form");
  assert.ok(forgot.includes('<Link to="/web/login">{c.backToLogin}</Link>'));
  assert.ok(forgot.includes("return json({ sent: NEUTRAL });"));

  const reset = door("web.reset.$token.tsx");
  assert.equal(count(reset, "<AuthLobby lang={lang}>"), 3, "the form, the dead link and the unlinked account: the same room");
  assert.ok(reset.includes('name="password"') && reset.includes('autoComplete="new-password"') && reset.includes("minLength={8}"));
  assert.ok(reset.includes('{pwShort && <div className="wb-hint" id="rp-pw-hint">{c.resetShortPw}</div>}'));
  assert.ok(reset.includes('{error && <div className="wb-err" role="alert">{error}</div>}'));
  assert.ok(reset.includes('<Link to="/web/forgot">{c.resetNewLink}</Link>') && reset.includes('<Link to="/web/login">{c.backToLogin}</Link>'));
  assert.ok(reset.includes("return webSessionRedirect({ id: account.id, passwordHash: newHash });"));
});

test("the wall shows EVERY house, not films alone: all nine formats, and an ad, a Creator piece, the cast, auto-posting among them", () => {
  const wall = list("WALL_ORDER");
  assert.equal(new Set(wall).size, wall.length, "no card twice");
  // every hero's poster is on the wall once, and the four other houses each have a card
  assert.deepEqual(wall.filter((k) => !HOUSES.includes(k)).sort(), [...FILMS].sort());
  assert.deepEqual(wall.filter((k) => HOUSES.includes(k)).sort(), [...HOUSES].sort());
  assert.equal(wall.length, 13);
  // a phone shows the first three: they are not all films — a film, the ad, a film, then Creator
  assert.ok(!HOUSES.includes(wall[0]) && wall[1] === "ad" && !HOUSES.includes(wall[2]) && wall[3] === "creator");
  // …and round the whole wall (it has no end) never more than three films pass in a row
  const ring = [...wall, ...wall];
  let run = 0;
  for (const k of ring) { run = HOUSES.includes(k) ? 0 : run + 1; assert.ok(run <= 3, `four films in a row at ${k}`); }
  assert.ok(component.includes("const WALL: Card[] = WALL_ORDER.map((k) => (isHouse(k) ? HOUSE_CARDS[k] : film(k))).filter((c) => c.name);"));
  // the first six — all a wide screen shows as the page opens — are cards whose clip begins on the picture
  // their still shows (or that have no still): three formats' covers are a DIFFERENT picture from their
  // loop (in the Movie Maker too), and a card that turned into another picture in plain view would look broken
  for (const k of ["musicvideo", "horror", "kidsmusicvideo"]) assert.ok(wall.indexOf(k) >= 6, `${k} opens the wall`);

  // a film is billed under its format (film-heroes.ts), a piece from another house under the house's own
  // name — the nav's, so it is the name the visitor will see once inside
  assert.ok(component.includes('const nameOf = (media: string) => FILM_HEROES.find((h) => h.media === media)?.name || "";'));
  assert.ok(component.includes('const houses: Record<House, string> = { ad: t("Ad Maker"), creator: t("Creator"), cast: t("Presenters"), autopost: t("Auto-post") };'));
  assert.ok(component.includes("const billed = (c: { name: string; house?: House }) => (c.house ? houses[c.house] : t(c.name));"));
  assert.ok(component.includes("<b>{billed(c)}</b>") && component.includes("<span className=\"lb-clip-tag\"><i />{billed(c)}</span>"));
  const shell = read("app", "routes", "web.tsx");
  for (const name of ["Ad Maker", "Creator", "Presenters", "Auto-post"]) assert.ok(shell.includes(`{t("${name}")}</Link>`), `${name} is the nav's own word`);
  // the whole stage is ONE picture to a screen reader, said once: what is showing — every house in it
  assert.ok(component.includes('<div className="lb-stage" role="img" aria-label={`${t("Now showing")}: ${WALL.map(billed).join(", ")}`}>'));

  // the screen (a wide screen only) is programmed the same way: a film, an ad, a music video, a Creator piece
  assert.deepEqual(list("REEL_ORDER"), ["testmovie", "ad", "musicvideo", "creator"]);
});

test("only the app's own showcase art, and every piece is a file that is there", () => {
  const wall = list("WALL_ORDER");
  const tall = list("TALL_STILLS");
  // the films: the Movie Maker's own posters, and the 4:5 loops its format cards play on a phone
  for (const k of wall.filter((x) => !HOUSES.includes(x))) {
    const still = tall.includes(k) ? `film-still-${k}-tall.jpg` : `film-still-${k}.jpg`;
    assert.ok(exists("public", "landing", still), still);
    assert.ok(exists("public", "landing", `film-loop-${k}-tall.mp4`), `film-loop-${k}-tall.mp4`);
  }
  for (const k of list("REEL_ORDER").filter((x) => !HOUSES.includes(x))) for (const f of [`film-loop-${k}.jpg`, `film-loop-${k}.mp4`]) assert.ok(exists("public", "landing", f), f);
  // every path the component writes — in a template…
  const templates = [...component.matchAll(/`(\/[^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(templates, [
    "/landing/film-still-${key}-tall.jpg?v=${STILL_V}",
    "/landing/film-still-${key}.jpg?v=${STILL_V}",
    "/landing/film-loop-${key}-tall.mp4?v=${LOOP_V}",
    "/landing/film-loop-${key}.jpg?v=${LOOP_V}",
    "/landing/film-loop-${key}.mp4?v=${LOOP_V}",
  ]);
  // …or written out: the other houses' pieces. Nothing else, from nowhere else.
  const written = [...new Set([...component.matchAll(/"(\/[a-z][^"]*\.(?:jpg|mp4)[^"]*)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(written, [
    "/landing/autopost-hero.jpg?v=2",
    "/landing/autopost-hero.mp4?v=6",
    "/landing/creator-hero.mp4?v=5",
    "/landing/lobby-ad.jpg?v=1",
    "/landing/lobby-ad.mp4?v=1",
    "/landing/marketing-hero.mp4?v=6",
    "/landing/presenter-hero.mp4?v=5",
  ]);
  for (const u of written) assert.ok(exists("public", ...u.split("?")[0].split("/").filter(Boolean)), u);
  assert.ok(!/["'`(]\/(uploads|_harness|avatars|renders|custom|vthumb)\b/.test(lobby), "never a member's picture, never a presenter's portrait, never an upload");
  assert.deepEqual([...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]))], ["/gstyle-rosette.svg"], "the only file the stylesheet asks for is the brand's rosette (the green button already has it): no picture of a lamp, no texture");
  assert.ok(exists("public", "gstyle-rosette.svg"));

  // the same files, under the same cache versions and the same tall set, as the Movie Maker serves them —
  // and the very loop its format card plays on a phone
  const film = read("app", "routes", "web.film.tsx");
  for (const line of ["const LOOP_V = 5;", "const STILL_V = 8;"]) assert.ok(film.includes(line) && component.includes(line), line);
  const filmTall = /const TALL_STILLS = new Set\(\[([^\]]+)\]\)/.exec(film);
  assert.ok(filmTall);
  assert.deepEqual([...tall].sort(), [...filmTall[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort());
  assert.ok(film.includes('v.src = `/landing/film-loop-${k}${window.matchMedia("(min-width:640px)").matches ? "" : "-tall"}.mp4?v=${LOOP_V}`;'));
  // the sections' clips are the Dashboard's own doors, at the Dashboard's own addresses: a visitor who signs
  // in has them already
  const dash = read("app", "routes", "web._index.tsx");
  // (a clip's number is 5 unless its door says otherwise — Auto-post's picture was replaced on 2026-11-24, so
  // its still is 2 and its clip 6, here and on the door)
  assert.ok(dash.includes("function PathImg({ img, v, cv = 5, eyebrow,") && dash.includes("<source src={`/landing/${img}-hero.mp4?v=${cv}`} type=\"video/mp4\" />"));
  assert.ok(dash.includes('img="autopost" v={2} cv={6}') && dash.includes("backgroundImage: `url(/landing/${img}-hero.jpg?v=${v})`"));
  assert.deepEqual([...dash.matchAll(/<PathImg [^>]*? img="([a-z]+)" v=\{\d+\} cv=\{(\d+)\}/g)].map((m) => `${m[1]}:${m[2]}`), ["marketing:6", "autopost:6"], "only the two replaced clips carry their own number");
  assert.ok(dash.includes('img="marketing" v={2} cv={6}'), "the Ad Maker's clip was made again, sharp (its still is the same picture)");
  assert.ok(read("app", "routes", "web.studio.tsx").includes('<HeroVideo name={casual ? "creator" : "marketing"} still={5} clip={casual ? 5 : 6} className="ws-cinehead-img" />'), "…and the Ad Maker's own header asks for the same address");
  // the clip the lobby's big screen plays is no longer a thumbnail's worth of video
  assert.ok(sizeOf("public", "landing", "marketing-hero.mp4") > 250_000, "a sharp loop, not the 64 KB one");
  assert.ok(read("app", "routes", "web.autopost.tsx").includes('<HeroVideo name="autopost" still={2} clip={6} className="ap-head-img" />'), "…and the section's own header asks for the same two addresses");
  for (const img of ["creator", "marketing", "presenter", "autopost"]) assert.ok(dash.includes(`img="${img}"`), img);

  // WHAT COMES WITH THE PAGE is light: a card's still is sent only when it is small. Two houses' only stills
  // are the 1344px section heroes — those two cards stand on their house's icon until their clip plays.
  const stills = [...wall.filter((k) => !HOUSES.includes(k)).map((k) => ["landing", tall.includes(k) ? `film-still-${k}-tall.jpg` : `film-still-${k}.jpg`]), ["landing", "lobby-ad.jpg"], ["landing", "autopost-hero.jpg"]];
  let total = 0;
  for (const [dir, f] of stills) { const n = sizeOf("public", dir, f); total += n; assert.ok(n <= 90_000, `${f} is ${n} bytes`); }
  assert.ok(total <= 520_000, `the wall's stills are ${total} bytes`);
  for (const heavy of ["creator-hero.jpg", "presenter-hero.jpg", "marketing-hero.jpg", "film-hero.jpg", "archive-hero.jpg"]) {
    assert.ok(!lobby.includes(`/${heavy}`), `${heavy} is not sent to a sign-in screen`);
    assert.ok(sizeOf("public", "landing", heavy) > 200_000, `${heavy} is the heavy one this is about`);
  }
  assert.ok(component.includes('creator: { key: "creator", house: "creator", name: "Creator", icon: "palette", clip: "/landing/creator-hero.mp4?v=5", at: "70% 50%" },'));
  assert.ok(component.includes('cast: { key: "cast", house: "cast", name: "Presenters", icon: "presenter", clip: "/landing/presenter-hero.mp4?v=5", at: "12% 50%", zoom: 1.15 },'));
  // (the icons are the nav's own for those houses, drawn by the app's own set)
  const icons = read("app", "lib", "icons.tsx");
  for (const n of ["palette", "presenter", "megaphone", "film"]) assert.ok(new RegExp(`\\n  ${n}: <`).test(icons), n);
  assert.ok(shell_has_icons());
  // WHAT A CARD FETCHES WHEN IT COMES INTO VIEW is light too — its own clip, once. No clip on the wall is
  // heavier than 300 KB; the first three (all a phone has in view as the page opens) are under 450 KB
  // together; the whole wall, once every card has passed, under 1.7 MB.
  const houseCards = component.slice(component.indexOf("const HOUSE_CARDS"), component.indexOf("const WALL_ORDER"));
  const clipOf = (k: string) => {
    if (!HOUSES.includes(k)) return ["landing", `film-loop-${k}-tall.mp4`];
    const m = new RegExp(`\\n  ${k}: \\{[^\\n]*?clip: "/(landing|showcase)/([^"?]+)`).exec(houseCards);
    assert.ok(m, `${k}'s clip`);
    return [m[1], m[2]];
  };
  const clipBytes = wall.map((k) => { const [dir, f] = clipOf(k); const n = sizeOf("public", dir, f); assert.ok(n <= 300_000, `${f} is ${n} bytes`); return n; });
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  assert.ok(sum(clipBytes.slice(0, 3)) <= 450_000, `a phone's first three clips are ${sum(clipBytes.slice(0, 3))} bytes`);
  assert.ok(sum(clipBytes) <= 1_700_000, `the wall's clips are ${sum(clipBytes)} bytes`);

  // the ad: a presenter holding a product — a commercial made with a stock presenter, never a custom one
  assert.ok(component.includes('ad: { key: "ad", house: "ad", name: "Ad Maker", still: { src: "/landing/lobby-ad.jpg?v=1", w: 540, h: 960 }, clip: "/landing/lobby-ad.mp4?v=1", at: "50% 45%" },'));
  // WHICH commercial it is, is held by its bytes: the owner asked for a "presenter with product in the now
  // showing cards". The one shown is Desmond, of the stock cast, holding a bottle of lemon-lime soda — in
  // files of the lobby's own (public/landing/lobby-ad.*), so that nothing else's change to a showcase file
  // can swap the card's picture. If the ad is ever replaced on purpose: LOOK at the new one (a stock
  // presenter, holding a product — never a custom presenter), then change these two lines.
  const AD_ART: [string, string][] = [
    ["lobby-ad.jpg", "9fe1116093c63d65313feb9b32210547a4b4e7ef5036499e2f1a27924914e085"],
    ["lobby-ad.mp4", "688cc2c5739ca4a664760453720aa56b4c34d499592a2a8e0b65f8c1bfc6d14f"],
  ];
  for (const [f, sha] of AD_ART) {
    const have = createHash("sha256").update(fs.readFileSync(path.join(root, "public", "landing", f))).digest("hex");
    assert.equal(have, sha, `public/landing/${f} is not the commercial with a presenter holding a product`);
  }
  assert.ok(read("app", "lib", "avatars-data.json").includes('["desmond", "DESMOND",'), "Desmond is one of the stock cast");
  // a picture's box is known before it arrives (nothing jumps), and it says nothing to a screen reader
  assert.ok(component.includes('? <img src={c.still.src} alt="" width={c.still.w} height={c.still.h} decoding="async" style={fit} />'));
  assert.ok(component.includes(': <span className="lb-ico"><Ico n={c.icon || "film"} size={40} /></span>}'));
  assert.ok(component.includes('? <img src={c.still} alt="" width={720} height={404} loading="lazy" decoding="async" />'));
  assert.ok(css.includes(".lb-poster{position:absolute;top:0;left:0;isolation:isolate;width:var(--pw);height:calc(var(--pw) * 1.25);"));
});
function shell_has_icons(): boolean {
  const shell = read("app", "routes", "web.tsx");
  return shell.includes('<Ico n="palette" size={22} />') && shell.includes('<Ico n="megaphone" size={22} />') && shell.includes('<Ico n="presenter" size={22} />');
}

test("the sign's lights are lamps (\"more realistic lights like a movie theater\"): tungsten glass in a dark channel, a pulse running through the words", () => {
  // each rail is a row of real lamps, counted from the words outward — so none is cut in half beside them
  assert.ok(component.includes("const LAMPS = Array.from({ length: 28 }, (_, i) => i);"));
  assert.ok(component.includes('<span className="lb-rail">{LAMPS.map((i) => <i key={i} />)}</span>'));
  assert.ok(component.includes('<span className="lb-rail is-after">{LAMPS.map((i) => <i key={i} />)}</span>'));
  const rail = sheet.find((r) => r.sel === ".lb-rail" && r.media === "");
  assert.ok(rail && rail.body.includes("display:flex;flex-direction:row-reverse;align-items:center;gap:8px;") && rail.body.includes("overflow:hidden;"), "before the words: from the words leftward, the rest cut off");
  assert.ok(sheet.some((r) => r.sel === ".lb-rail.is-after" && r.body.startsWith("flex-direction:row;")), "after them: rightward");
  // enough lamps for the longest rail there is (a tablet's, around two short words: ~420px at 16px a lamp);
  // a phone's rails never hold more than fourteen, and the rest are not drawn there
  assert.ok(28 * 16 >= 420);
  assert.ok(css.includes("@media(max-width:599px){.lb-rail i:nth-child(n+15){display:none;}}") && 14 * 16 >= (599 - 32 - 100) / 2 - 30);
  // THE GLASS: a hot centre a little off the middle, amber toward the rim; THE BLOOM: a tight glow and a wide
  // faint one. Pure CSS — no picture of a lamp anywhere.
  assert.ok(css.includes(".lb-rail i{position:relative;flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:radial-gradient(circle at 42% 36%,#FFFDF2 0,#FFF1BD 22%,#FFC95A 50%,#E08A1E 78%,#9A5410 100%);box-shadow:0 0 5px 1px rgba(255,190,90,.8),0 0 12px 3px rgba(255,160,50,.34);animation:lbLamp 2.4s linear infinite;}"));
  // THE CHANNEL it sits in: a dark trough, shadowed under its top lip, a thin gold line along the lower one
  assert.ok(css.includes(".lb-rail::before{content:\"\";position:absolute;left:0;right:0;top:50%;height:14px;margin-top:-7px;border-radius:7px;background:linear-gradient(180deg,#020604,#0D1F16);box-shadow:inset 0 1px 2px #000,inset 0 -1px 0 rgba(231,200,121,.16);}"));
  assert.ok(!/lbChase|repeat-x/.test(css), "the painted dots are gone");

  // THE CHASE. A sign, not a casino: no lamp ever goes out, and a lamp comes up fast and dies back slowly.
  const frames = /@keyframes lbLamp\{((?:[\d.]+%\{opacity:[\d.]+\})+)\}/.exec(css);
  assert.ok(frames);
  const stops = [...frames[1].matchAll(/([\d.]+)%\{opacity:([\d.]+)\}/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(stops, [[0, 0.56], [6, 1], [26, 1], [54, 0.56], [100, 0.56]]);
  assert.ok(Math.min(...stops.map((s) => s[1])) >= 0.5, "dimmed, never dark");
  assert.ok(6 - 0 < (54 - 26) / 3, "up in a seventh of a second, down in two thirds of one");
  // Four circuits, .6s apart. Read every lamp's place in the turn off the stylesheet, then follow the pulse
  // lamp by lamp: left to right along the first rail, THROUGH the words, and on along the second — each
  // lamp exactly .6s after the one on its left, never skipping, never turning back.
  const TURN = 2.4;
  const delayOf = (after: boolean, n: number) => {
    const residue = n % 4;
    const sel = `${after ? ".lb-rail.is-after" : ".lb-rail"} i:nth-child(4n${residue ? `+${residue}` : ""})`;
    const own = sheet.find((r) => r.sel === sel && r.media === "");
    const m = own && /animation-delay:(-?[\d.]+)s;/.exec(own.body);
    if (m) return Number(m[1]);
    assert.ok(!after, `${sel} must say its own delay (the first rail's would reach it)`);
    return 0;
  };
  const swellsAt = (after: boolean, n: number) => (TURN + delayOf(after, n)) % TURN; // begun x into the turn, it swells again TURN − x on
  const leftToRight: number[] = [];
  for (let n = 12; n >= 1; n--) leftToRight.push(swellsAt(false, n)); // the first rail is counted from the words outward
  for (let n = 1; n <= 12; n++) leftToRight.push(swellsAt(true, n));
  for (let i = 1; i < leftToRight.length; i++) {
    const gap = (leftToRight[i] - leftToRight[i - 1] + TURN) % TURN;
    assert.ok(Math.abs(gap - 0.6) < 1e-9, `lamp ${i} swells ${gap.toFixed(2)}s after the one on its left`);
  }
  assert.equal(new Set(leftToRight.map((x) => x.toFixed(1))).size, 4, "four circuits");
});

test("gold spinners (\"we still need some gold spinners in there\"): the app's own rosettes turn slowly in the dark, behind everything", () => {
  const shell = read("app", "routes", "web.tsx");
  // the shell's two ambient rosettes — the app's spinner, kept behind every page: fixed, under the page,
  // taking no tap, turning once in 210 and 260 seconds, wider than a phone
  assert.ok(shell.includes('.wb::before,.wb::after{content:"";position:fixed;z-index:0;pointer-events:none;'));
  assert.ok(shell.includes(".wb::before{top:-190px;right:-240px;width:660px;height:660px;opacity:.075;"));
  assert.ok(shell.includes(".wb::after{bottom:-290px;left:-270px;width:620px;height:620px;opacity:.05;"));
  assert.ok(shell.includes("animation:wbDrift 210s linear infinite;}") && shell.includes("animation:wbDriftBack 260s linear infinite;}"));
  // the page — the ticket with it — is above them: they are never over a word of the form
  assert.ok(shell.includes(".wb-hud,.wb-main{position:relative;z-index:1;}"));
  assert.ok(css.includes("color:var(--ink,#14201A);background:linear-gradient(176deg,#FFFDF7,#F7F0DE);"), "and the ticket's paper is solid");
  // at NIGHT they are the GOLD cut (the file the green button already has), low but seen — by day they stay
  // the shell's own green cut, as everywhere in the app: the day's sheet does not touch them
  assert.ok(darkCss.includes("html .wb::before,html .wb::after{background-image:url(/gstyle-rosette.svg);}"));
  assert.ok(!/html \.wb::(before|after)\{[^}]*(background|opacity)/.test(baseCss));
  assert.ok(read("public", "gstyle-rosette.svg").includes("stroke='#FFD24A'"));
  const seen = [...css.matchAll(/html \.wb::(before|after)\{opacity:(\.\d+);\}/g)].map((m) => [m[1], Number(m[2])]);
  assert.deepEqual(seen, [["before", 0.2], ["after", 0.15]]);
  // the lobby neither hides them nor adds a third
  assert.ok(!/\.wb::(?:before|after)\{[^}]*display:none/.test(css));
  assert.equal(count(css, "gstyle-rosette.svg"), 3, "the two spinners share one rule; the other two are the ticket's watermark");
});

test("no light crosses a card any more (\"the cheap shimmer on the covers … need to go\")", () => {
  assert.ok(!/lbShine|\.lb-poster::before|catches the light/.test(css));
  assert.ok(!/linear-gradient\(105deg/.test(css), "the diagonal white streak");
  // the one layer left over a card's picture is the shade its name stands on
  assert.equal(count(css, ".lb-poster::"), 1);
  assert.ok(css.includes(".lb-poster::after{content:\"\";position:absolute;inset:0;z-index:1;background:linear-gradient(0deg,"));
});

test("the wall never ends, and nothing jumps where it can be seen: each card is ONE element that comes round out of sight", () => {
  // one element a card — no second copy of the row (a card's clip is one player, not two)
  assert.ok(component.includes("{WALL.map((c, k) => {") && !/\[0, 1\]\.map/.test(component));
  assert.ok(component.includes('<div className="lb-track" style={{ ["--n" as string]: WALL.length }}>'));
  assert.ok(component.includes('<div className="lb-poster" key={c.key} style={{ ["--k" as string]: k }}>'));
  // card k stands k steps along (so the wall is a row even with no animation at all)…
  assert.ok(css.includes(".lb-track{position:relative;height:calc(var(--pw) * 1.25);--step:calc(var(--pw) + 12px);}"));
  assert.ok(css.includes("transform:translate3d(calc(var(--k,0) * var(--step)),0,0);"));
  // …and one animation carries every card from the LAST place to one step off the left edge, each begun as
  // far along as its own place: a step every 6.6 seconds
  assert.ok(css.includes("animation:lbPass calc(var(--n,13) * 6.6s) linear infinite;animation-delay:calc((var(--n,13) - 1 - var(--k,0)) * -6.6s);"));
  assert.ok(css.includes("@keyframes lbPass{from{transform:translate3d(calc((var(--n,13) - 1) * var(--step)),0,0)}to{transform:translate3d(calc(var(--step) * -1),0,0)}}"));
  assert.ok(!/lbDrift|width:max-content/.test(css), "the old double row is gone");
  assert.ok(css.includes(".lb-wall{direction:ltr;overflow:hidden;"), "clipped (it cannot push the page sideways), and it runs the same way in a right-to-left language");

  // the same sums the stylesheet does, walked for two turns of the wall on every layout: the cards start at
  // 0, 1, 2 … steps, stay one step apart, and a card only ever jumps back while it is out of sight
  const n = list("WALL_ORDER").length;
  const xOf = (k: number, t: number, step: number) => (n - 1) * step - ((((t / 6.6 + n - 1 - k) % n) + n) % n) * step;
  // [card width, widest strip it runs in]: a phone (116–150 by its height, 136 where that cannot be asked),
  // a tablet, a phone on its side, a wide screen
  // (by day a phone's posters are 8px narrower — the board takes room of its own: 110–142)
  const layouts: [number, number][] = [[110, 599], [116, 599], [136, 599], [142, 599], [150, 599], [150, 959], [104, 959], [112, 680]];
  assert.ok(css.includes(".lb{--pw:136px;") && css.includes(".lb{--pw:150px;") && css.includes(".lb{--pw:112px;") && css.includes(".lb{--pw:104px;}"));
  assert.ok(css.includes("@supports (height:1svh){@media(max-width:599px){.lb{--pw:clamp(116px,calc(20svh - 16px),150px);}}}"), "by the height the phone really has, bars showing");
  assert.ok(css.includes("@supports (height:1svh){@media(max-width:599px){.lb:not(.is-dark){--pw:clamp(110px,calc(20svh - 24px),142px);}}}"));
  // the wide strip is never wider than 680 — by day too: the board is 16px wider each side, the strip inside it the same
  assert.ok(css.includes("max-width:clamp(380px,calc((100vh - 480px) * 1.7778),680px);"));
  assert.ok(css.includes("padding:16px 16px 2px;border-radius:24px;max-width:clamp(412px,calc((100vh - 480px) * 1.7778 + 32px),712px);") && 712 - 2 * 16 === 680 && 412 - 2 * 16 === 380);
  for (const [pw, strip] of layouts) {
    const step = pw + 12;
    assert.ok((n - 1) * step >= strip, `${pw}px cards: the last place is out of sight of a ${strip}px strip`);
    for (let k = 0; k < n; k++) assert.ok(Math.abs(xOf(k, 0, step) - k * step) < 1e-6, `card ${k} starts at its own place`);
    for (let t = 0; t < 2 * n * 6.6; t += 0.1) {
      const xs = Array.from({ length: n }, (_, k) => xOf(k, t, step));
      const sorted = [...xs].sort((a, b) => a - b);
      for (let i = 1; i < n; i++) assert.ok(Math.abs(sorted[i] - sorted[i - 1] - step) < 1e-6, "one step apart");
      for (let k = 0; k < n; k++) {
        const next = xOf(k, t + 0.1, step);
        if (next > xs[k]) assert.ok(xs[k] + pw <= 0.1 * step / 6.6 + 1e-6 && next >= strip, `card ${k} jumps in sight (${pw}px cards, ${strip}px strip)`);
      }
    }
  }
});

/** The component's own tendWall(), lifted out of the source and run here against stand-in cards. */
function liveTendWall(): ((box: unknown, clips: unknown[], awake: boolean, viewHeight: number) => void) | null {
  const strip = (nodeModule as { stripTypeScriptTypes?: (code: string) => string }).stripTypeScriptTypes;
  if (typeof strip !== "function") return null;
  const from = component.indexOf("export function tendWall(");
  const to = component.indexOf("function useWallClips(");
  assert.ok(from > 0 && to > from);
  const consts = ["IN_VIEW", "MOST_AT_ONCE"].map((c) => { const m = new RegExp(`const ${c} = ([\\d.]+);`).exec(component); assert.ok(m, c); return `const ${c} = ${m[1]};`; }).join("\n");
  const js = strip(component.slice(from, to).replace("export function", "function"));
  return new Function(`${consts}\n${js}\nreturn tendWall;`)() as ReturnType<typeof liveTendWall>;
}
type FakeClip = { paused: boolean; muted: boolean; dataset: Record<string, string>; fetched: string[]; starts: number; refuse?: string; getAttribute(a: string): string | null; src: string; play(): Promise<void>; pause(): void; parentElement: { getBoundingClientRect(): { left: number; right: number; width: number } } };
const fakeClip = (place: () => number, pw: number, refuse?: string): FakeClip => {
  let src = "";
  const v: FakeClip = {
    paused: true, muted: false, dataset: { clip: "/landing/a-clip.mp4" }, fetched: [], starts: 0, refuse,
    getAttribute: (a) => (a === "src" ? src || null : null),
    get src() { return src; },
    set src(u: string) { src = u; v.fetched.push(u); },
    play() { v.starts++; if (v.refuse) return Promise.reject(Object.assign(new Error(v.refuse), { name: v.refuse })); v.paused = false; return Promise.resolve(); },
    pause() { v.paused = true; },
    parentElement: { getBoundingClientRect: () => ({ left: place(), right: place() + pw, width: pw }) },
  };
  return v;
};

test("a card PLAYS — only while it is in view: fetched once, stopped when it leaves or nobody is looking, never more than six", async (t) => {
  // the clip is added in the browser, after the page has arrived with its stills — and only for a visitor
  // who wants motion and is not saving data
  assert.ok(component.includes("const [motion, setMotion] = useState({ live: false, plays: false });"), "never on the server");
  assert.ok(component.includes("const decide = () => { const live = !calm.matches && !saving; setMotion({ live, plays: live && wide.matches }); };"));
  assert.ok(component.includes('const calm = window.matchMedia("(prefers-reduced-motion: reduce)");'));
  assert.ok(component.includes("const line = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;"));
  assert.ok(component.includes('const saving = !!line?.saveData || /2g$/.test(line?.effectiveType || "");'), "save-data, or a 2G line (\"slow-2g\", \"2g\")");
  for (const [type, slow] of [["slow-2g", true], ["2g", true], ["3g", false], ["4g", false], ["", false]] as const) assert.equal(/2g$/.test(type), slow, type);
  // silent, inline, looping, nothing fetched until it is asked for (no src of its own), its still as its
  // poster, nothing to a screen reader — on a phone too
  assert.ok(component.includes('{live && <video data-clip={c.clip} poster={c.still?.src} muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1} style={fit} onPlaying={showClip} onError={dropClip} />}'));
  assert.ok(!/<audio|new Audio\(|controls|autoPlay[^>]*data-clip|data-clip[^>]*autoPlay/.test(component));
  // it lies over its still unseen until it is REALLY playing — one that never starts is never seen
  assert.ok(css.includes(".lb-poster img,.lb-poster video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}"), "no layout shift: it fills the card the still already fills");
  assert.ok(css.includes(".lb-poster video{opacity:0;transition:opacity .45s ease;}") && css.includes(".lb-poster video.is-on{opacity:1;}"));
  assert.ok(component.includes('const showClip = (e: SyntheticEvent<HTMLVideoElement>) => { e.currentTarget.classList.add("is-on"); };'));
  assert.ok(component.includes('const dropClip = (e: SyntheticEvent<HTMLVideoElement>) => { e.currentTarget.dataset.off = "1"; };'));
  // the wall is looked at every 400 ms and whenever the tab is hidden or shown; leaving the page stops everything
  assert.ok(component.includes('const look = () => tendWall(box, clips, document.visibilityState === "visible", window.innerHeight);'));
  assert.ok(component.includes("const timer = window.setInterval(look, LOOK_MS);") && component.includes("const LOOK_MS = 400;"));
  assert.ok(component.includes('document.addEventListener("visibilitychange", look);'));
  assert.ok(component.includes('return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", look); for (const v of clips) v.pause(); };'));
  assert.ok(component.includes("const IN_VIEW = 0.12;") && component.includes("const MOST_AT_ONCE = 6;"));

  // …and the look itself, run for real
  const tend = liveTendWall();
  if (!tend) return t.skip("this Node cannot strip types from a snippet (module.stripTypeScriptTypes)");
  const n = list("WALL_ORDER").length;
  const xOf = (k: number, at: number, step: number) => (n - 1) * step - ((((at / 6.6 + n - 1 - k) % n) + n) % n) * step;
  for (const [pw, W, most] of [[136, 390, 4], [116, 390, 4], [150, 430, 4], [150, 959, 6], [104, 932, 6], [112, 680, 6]] as const) {
    const step = pw + 12;
    let now = 0;
    const clips = Array.from({ length: n }, (_, k) => fakeClip(() => xOf(k, now, step), pw));
    const box = { getBoundingClientRect: () => ({ left: 0, right: W, top: 90, bottom: 280 }) };
    let seen = 0;
    for (now = 0; now < 2 * n * 6.6; now += 0.4) {
      tend(box, clips, true, 760);
      let playing = 0;
      let held = 0;
      clips.forEach((v, k) => {
        const x = xOf(k, now, step);
        const inside = Math.min(x + pw, W) - Math.max(x, 0);
        if (!v.paused) { playing++; assert.ok(inside > 0, `a clip plays out of sight (${pw}/${W})`); }
        else if (inside >= pw * 0.12) held++;
      });
      assert.ok(playing <= most, `${playing} clips at once on a ${W}px strip`);
      assert.ok(!held || playing === 6, "a card in view waits only when six are already playing");
      seen = Math.max(seen, playing);
    }
    assert.equal(seen, most, `${W}px strip of ${pw}px cards`);
    // every card's clip was fetched exactly once in two turns of the wall, and none passed unplayed
    for (const v of clips) { assert.deepEqual(v.fetched, ["/landing/a-clip.mp4"]); assert.ok(v.starts >= 2 && v.starts <= 3); }
  }
  // a hidden tab, or a wall scrolled off the screen: everything stops, and nothing is fetched for it
  const three = [0, 148, 296].map((x) => fakeClip(() => x, 136));
  const at = (top: number) => ({ getBoundingClientRect: () => ({ left: 0, right: 390, top, bottom: top + 190 }) });
  tend(at(90), three, false, 760);
  assert.ok(three.every((v) => v.paused && !v.fetched.length), "nobody is looking: nothing is fetched");
  tend(at(900), three, true, 760);
  tend(at(-400), three, true, 760);
  assert.ok(three.every((v) => v.paused && !v.fetched.length), "the wall is scrolled away: nothing is fetched");
  tend(at(90), three, true, 760);
  assert.ok(three.every((v) => !v.paused));
  tend(at(90), three, false, 760);
  assert.ok(three.every((v) => v.paused), "the tab is hidden: they stop");
  tend(at(90), three, true, 760);
  assert.ok(three.every((v) => !v.paused && v.fetched.length === 1), "…and start again when it is back, without fetching again");
  // a sliver under the strip's fading edge is not "in view"; a playing clip plays until its card is wholly gone
  const sliver = fakeClip(() => 380, 136);
  tend(at(90), [sliver], true, 760);
  assert.ok(sliver.paused && !sliver.fetched.length);
  const leaving = fakeClip(() => -130, 136);
  leaving.paused = false;
  tend(at(90), [leaving], true, 760);
  assert.ok(!leaving.paused, "6px of it can still be seen");
  // a clip the browser will not start, or that is broken, is tried once and left a still; one that was only
  // stopped before it began (its card left, the tab was hidden) is not written off
  const refused = fakeClip(() => 100, 136, "NotAllowedError");
  const broken = fakeClip(() => 100, 136, "NotSupportedError");
  const stopped = fakeClip(() => 100, 136, "AbortError");
  for (let i = 0; i < 4; i++) { tend(at(90), [refused, broken, stopped], true, 760); await new Promise((r) => setTimeout(r, 2)); }
  assert.deepEqual([refused.starts, broken.starts, stopped.starts], [1, 1, 4]);
  assert.ok(refused.dataset.off && broken.dataset.off && !stopped.dataset.off);
});

test("the screen is for wide screens: a phone is sent none of it, and its clips are added only there", () => {
  // hidden by default, shown from 960px — the same width the component waits for before adding a clip
  const base = sheet.find((r) => r.sel === ".lb-screen" && r.media === "");
  assert.equal(base?.body, "display:none;");
  const wide = sheet.find((r) => r.sel === ".lb-screen" && r.media === "@media(min-width:960px)");
  assert.ok(wide && wide.body.startsWith("display:block;position:relative;aspect-ratio:16/9;"));
  assert.ok(component.includes('const SCREEN_MEDIA = "(min-width: 960px)";') && component.includes("const wide = window.matchMedia(SCREEN_MEDIA);"));
  // the clip: silent, inline, looping, starting by itself, and nothing to a screen reader
  assert.ok(component.includes('{plays && <video ref={startClip} src={c.clip} poster={c.still} muted loop playsInline autoPlay preload="metadata" aria-hidden="true" tabIndex={-1} />}'));
  assert.equal(count(component, "<video"), 2, "the wall's and the screen's, and no other");
  // a film's still is lazy: hidden on a phone, a lazy picture is never fetched (the two section clips have no
  // still light enough, and stand on their house's icon)
  assert.ok(count(component, 'loading="lazy"') === 1);
  assert.ok(component.includes(': <span className="lb-ico"><Ico n={c.icon || "film"} size={64} /></span>}'));
  assert.ok(component.includes('ad: { key: "ad", house: "ad", name: "Ad Maker", icon: "megaphone", clip: "/landing/marketing-hero.mp4?v=6" },'));
  // four clips, five seconds each
  assert.equal(list("REEL_ORDER").length, 4);
  assert.ok(css.includes(".lb-clip{position:absolute;inset:0;opacity:0;animation:lbReel 20s linear infinite;animation-delay:calc(var(--k,0) * 5s);}"));
  // the wall's stills are NOT lazy, on purpose (they arrive by a transform; see the note at the top of the component)
  assert.ok(lobby.includes("NOT\n * lazy on purpose"));
});

test("everything that moves stands still for anyone who asks for less motion", () => {
  const still = sheet.filter((r) => r.media === "@media(prefers-reduced-motion:reduce)");
  const stilled = new Set(still.filter((r) => /(^|;)animation:none;/.test(r.body)).flatMap((r) => r.sel.split(",")));
  const moving = sheet.filter((r) => !r.media.includes("prefers-reduced-motion") && /(^|;)animation(-name)?:(?!none)/.test(r.body)).flatMap((r) => r.sel.split(","));
  assert.deepEqual([...new Set(moving)].sort(), [".lb .lb-ticket", ".lb-clip", ".lb-poster", ".lb-rail i", ".lb-wm::after", ".wb-busy-dot"], "the sign's lamps, the cards, the screen, the watermark, the ticket coming up, the busy dot");
  for (const sel of moving) assert.ok(stilled.has(sel), `${sel} must stop`);
  // every lamp is then steadily lit (a lamp has no dimness of its own: it is only ever dimmed by the chase)…
  for (const r of sheet.filter((x) => /^\.lb-rail(\.is-after)? i\b/.test(x.sel))) assert.ok(!/opacity/.test(r.body), r.sel);
  // …the gold rosettes are at rest (the shell stops its own, and the lobby says so again)…
  assert.ok(stilled.has("html .wb::before") && stilled.has("html .wb::after"));
  assert.ok(read("app", "routes", "web.tsx").includes("@media (prefers-reduced-motion:reduce){.wb::before,.wb::after{animation:none}}"));
  // …the cards stand in a row at their own places, the screen holds its first frame…
  assert.ok(still.some((r) => r.sel === ".lb-clip:first-child" && r.body === "opacity:1;"));
  // …and no clip is ever added: the component does not draw one
  assert.ok(component.includes("const live = !calm.matches && !saving;") && component.includes("{live && <video ") && component.includes("{plays && <video "));
  // nothing here is animated by script (the one timer LOOKS at the wall; it moves nothing), and nothing makes a sound
  assert.ok(!/requestAnimationFrame|setTimeout|\.animate\(/.test(component));
  assert.equal(count(component, "setInterval"), 1);
});

/** WCAG contrast of two #RRGGBB colours. */
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
/** `top` laid over `under` at `alpha`. */
const over = (top: string, under: string, alpha: number) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(top.slice(i, i + 2), 16) * alpha + parseInt(under.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, "0")).join("");

test("BY NIGHT the words read: 4.5:1 or better on the dark green, on the lit part of it, under a spinner's line, and on the ticket", () => {
  // the night is GREEN ("maybe we do a dark green background instead of the brown"): a near-black green —
  // and not one of the old browns is left in either sheet
  const DARK = "#08150E";
  assert.ok(darkCss.includes("html,body{background:#08150E;}") && darkCss.includes(",#08150E;}"));
  for (const brown of ["#130E0B", "#241B15", "#1C150E", "#050302", "#0A0705", "#3D3024", "rgba(10,7,5"]) assert.ok(!css.includes(brown), brown);
  // it is lightest where the marquee's light falls from the top: a lighter green, at its fullest, over the dark
  assert.ok(darkCss.includes("radial-gradient(120% 56% at 50% -12%,rgba(30,140,88,.38),rgba(30,140,88,0) 60%)"));
  const LIT = over("#1E8C58", DARK, 0.38);
  const onDark: [string, string][] = [
    ["the logo, the line, a house's name", "#FFFDF7"], ["the sign, the line's second half, the logo's second half, the playbill's label", "#E7C879"], ["a signed-in visitor's tabs, the playbill's print", "#D8CFBA"],
  ];
  // (the lobby's own words take these from the night's names)
  assert.ok(baseCss.includes(".lb.is-dark{--lb-top:4px;--lb-page:#08150E;--lb-ink:#FFFDF7;--lb-accent:#E7C879;--lb-soft:#D8CFBA;--lb-label:#E7C879;"));
  for (const [what, colour] of onDark) {
    assert.ok(css.includes(colour), what);
    assert.ok(contrast(colour, DARK) >= 4.5 && contrast(colour, LIT) >= 4.5, `${what}: ${contrast(colour, LIT).toFixed(2)}`);
  }
  // the language pill and the header's "Log in": cream words on dark glass (7% cream over the lit dark)
  assert.ok(css.includes(".wb .lt-btn,.wb .wb-login{position:relative;background:rgba(255,253,247,.07);border-color:rgba(231,200,121,.5);color:#FFFDF7;box-shadow:none;}"));
  assert.ok(contrast("#FFFDF7", over("#FFFDF7", LIT, 0.07)) >= 4.5);
  // A GOLD SPINNER turns behind these words. It is behind the page — never OVER a word — but its line passes
  // UNDER them, and the ground is lighter there. The ceiling: the rosette's own line (its colour and its
  // strength read off the file) at the stronger spinner's opacity, over the lit dark at its fullest (which
  // is, in fact, above the top of the page). Every word on the dark still reads there.
  const line = /stroke='(#[0-9A-Fa-f]{6})' stroke-opacity='([\d.]+)'/.exec(read("public", "gstyle-rosette.svg"));
  assert.ok(line, "the rosette is one stroked line");
  const spinner = (which: string) => Number(new RegExp(`html \\.wb::${which}\\{opacity:(\\.\\d+);\\}`).exec(css)?.[1]) * Number(line[2]);
  const [upper, lower] = [spinner("before"), spinner("after")];
  assert.ok(upper > 0 && lower > 0 && upper >= lower, "the upper spinner is the stronger of the two");
  const LINED = over(line[1], LIT, upper);
  for (const [what, colour] of onDark) assert.ok(contrast(colour, LINED) >= 4.5, `${what}, over a line of a gold spinner: ${contrast(colour, LINED).toFixed(2)}`);
  assert.ok(contrast("#FFFDF7", over("#FFFDF7", LINED, 0.07)) >= 4.5, "the language pill, over a line of a gold spinner");
  // (on a very short screen the two spinners overlap — low on the screen, far under the marquee's light:
  // one line over the other, on the plain dark)
  const CROSSED = over(line[1], over(line[1], DARK, lower), upper);
  for (const [what, colour] of onDark) assert.ok(contrast(colour, CROSSED) >= 4.5, `${what}, where the two spinners cross: ${contrast(colour, CROSSED).toFixed(2)}`);
  // …and the foot of the page, where the playbill stands on a phone: a faint green light from the lower
  // corner — at its fullest — with BOTH spinners' lines over it
  assert.ok(darkCss.includes("radial-gradient(64% 42% at -6% 104%,rgba(12,122,70,.16),rgba(12,122,70,0) 70%)"));
  const FOOT = over(line[1], over(line[1], over("#0C7A46", DARK, 0.16), lower), upper);
  for (const [what, colour] of onDark) assert.ok(contrast(colour, FOOT) >= 4.5, `${what}, at the lit foot under both spinners: ${contrast(colour, FOOT).toFixed(2)}`);
  // a card's name: white over the picture's own shade — even over a WHITE picture (or a clip's brightest
  // frame), and even three lines of it in a language that needs the room (the name stands 9px up; three
  // lines reach 46% of the card)
  assert.ok(css.includes(".lb-poster::after{content:\"\";position:absolute;inset:0;z-index:1;background:linear-gradient(0deg,rgba(4,12,8,.95) 0%,rgba(4,12,8,.86) 22%,rgba(4,12,8,.62) 46%,rgba(4,12,8,.28) 62%,rgba(4,12,8,0) 78%);}"));
  assert.ok(contrast("#FFFFFF", over("#040C08", "#FFFFFF", 0.62)) >= 4.5, "the shade at 46% up");
  assert.ok(css.includes(".lb-poster b{position:absolute;z-index:3;left:10px;right:10px;bottom:9px;"), "the name is above the shade, and above the clip");
  // (three lines in the tallest script — Urdu, line-height 1.5: 14px type on a phone's 136px card, 12.5px on the wide screen's 112px one)
  assert.ok(css.includes("[dir=rtl] .lb-poster b{direction:rtl;text-align:right;letter-spacing:0;line-height:1.5;}") && css.includes(".lb-poster b{left:9px;right:9px;bottom:8px;font-size:12.5px;}"));
  assert.ok((9 + 3 * 14 * 1.5) / (136 * 1.25) <= 0.46 && (8 + 3 * 12.5 * 1.5) / (112 * 1.25) <= 0.46);
  // a house's icon, where a card has no still: gold on the card's own green, lit a little from above (a
  // picture, not words: 3:1 is asked; it has far more)
  assert.ok(css.includes(".lb-ico{position:absolute;inset:0;display:grid;place-items:start center;padding-top:20%;color:#E7C879;background:radial-gradient(circle at 50% 34%,rgba(52,180,116,.3),rgba(52,180,116,0) 66%);}"));
  assert.ok(css.includes("overflow:hidden;background:#12281C;") && contrast("#E7C879", over("#34B474", "#12281C", 0.3)) >= 4.5);
  // the button: full width, so its words sit mid-button — on the brand's deep green, never the shell's palest
  assert.ok(css.includes(".lb .lb-ticket .wb-btn:not(.ghost){background:linear-gradient(100deg,#0C7A46 30%,#0A6A3D 72%,#075530);}"));
  for (const green of ["#0C7A46", "#0A6A3D", "#075530"]) assert.ok(contrast("#FFFFFF", green) >= 4.5, green);
  // what is playing: white on its own dark pill, over any frame
  assert.ok(css.includes("background:rgba(4,12,8,.74);color:#fff;"));
  assert.ok(contrast("#FFFFFF", over("#040C08", "#FFFFFF", 0.74)) >= 4.5);
  // the ticket is the shell's cream card: its own ink on its own paper, and the stub's print on the stub's gold
  assert.ok(css.includes("color:var(--ink,#14201A);background:linear-gradient(176deg,#FFFDF7,#F7F0DE);"));
  for (const paper of ["#FFFDF7", "#F7F0DE"]) for (const ink of ["#14201A", "#4A554E", "#0C7A46", "#7A2E1D"]) assert.ok(contrast(ink, paper) >= 4.5, `${ink} on ${paper}`);
  assert.ok(css.includes("background:linear-gradient(180deg,rgba(231,200,121,.34),rgba(231,200,121,.14));") && css.includes("color:#6B4F0E;"));
  assert.ok(contrast("#6B4F0E", over("#E7C879", "#F7F0DE", 0.34)) >= 4.5);
  // focus is seen on both: gold on the dark header, deep green on the paper (3:1 for a ring)
  assert.ok(css.includes(".wb .wb-nav a:focus-visible,.wb .wb-nav button:focus-visible{outline-color:#E7C879;}"));
  assert.ok(css.includes(".lb .lb-ticket :focus-visible{outline-color:#0C7A46;}"));
  assert.ok(contrast("#0C7A46", "#F7F0DE") >= 3 && contrast("#E7C879", LIT) >= 3 && contrast("#E7C879", LINED) >= 3);
  const shell = read("app", "routes", "web.tsx");
  assert.ok(shell.includes("outline:2px solid var(--green2,#12A85E);outline-offset:2px;"), "the ring itself is the shell's");
});

test("a field stays 16px (a phone must not zoom), and a finger gets 44px", () => {
  const shell = read("app", "routes", "web.tsx");
  assert.ok(shell.includes(".wb-in,.wb-sel,.wb-ta{width:100%;padding:12px 13px;border-radius:11px;border:1px solid var(--line);background:#fff;font:inherit;font-size:16px;color:var(--ink);}"));
  // the lobby never makes a field's type smaller
  for (const r of sheet.filter((x) => /\.wb-in\b/.test(x.sel))) assert.ok(!/font(-size)?:/.test(r.body), r.sel);
  assert.ok(css.includes(".lb .lb-ticket .wb-in{min-height:46px;}"));
  assert.ok(css.includes(".lb .lb-ticket .wb-btn{display:block;width:100%;min-height:48px;"));
  assert.ok(css.includes(".wb-pw-eye{position:absolute;top:0;right:0;height:100%;width:46px;"));
  // a link under the form is a row of its own: two links can never share a finger
  assert.ok(css.includes(".lb .lb-row{display:flex;flex-wrap:wrap;align-items:center;column-gap:.32em;min-height:44px;margin:0;font-size:13.5px;}"));
  assert.ok(css.includes(".lb .lb-row a{display:inline-flex;align-items:center;min-height:44px;margin-block:0;padding-block:0;font-weight:600;}"));
  const rows = sheet.filter((r) => r.sel === ".lb .lb-row,.lb .lb-row a");
  assert.ok(rows.length === 1 && rows[0].media === "@media(min-width:960px)", "shorter rows only where there is a pointer's width");
  for (const f of DOORS) assert.ok(!/className="wb-note" style=/.test(door(f)), `${f}: a link's row is spaced by the lobby, not by hand`);
  assert.ok(count(door("web.login.tsx"), 'className="wb-note lb-row"') === 2 && door("web.signup.tsx").includes('<p className="wb-note lb-fine">'));
  assert.ok(css.includes("@media(max-width:640px){.lb .lb-fine a{padding-block:14px;}}"), "the small print's two links reach 44px");
  // the logo (30 tall) and the language pill (32) are reached from 44, without moving — and so is each
  // language in the pill's list (it opens over the page, outside the shell: reached by its own class)
  assert.ok(css.includes(".wb .wb-brand::after,.wb .lt-btn::after,.wb .wb-login::after{content:\"\";position:absolute;inset:-7px -3px;}"));
  assert.ok(css.includes("@media(max-width:640px){.lt-menu .lt-opt{min-height:44px;}}"));
  assert.ok(read("app", "components", "LangToggle.tsx").includes(".lt-opt{display:flex;align-items:center;gap:9px;width:100%;padding:9px 10px;"), "a flex row: taller, its words stay centred");
  // a card is a picture, not a button: nothing on the wall or the screen can be tapped or tabbed to
  const stage = component.slice(component.indexOf('<div className="lb-stage"'), component.indexOf('<div className="lb-booth">'));
  assert.ok(!/<a |<button|<Link|onClick|role="button"|tabIndex=\{0\}/.test(stage));
});

test("the dark arrives with the screen and leaves with it; Helpurr never stands on the form", () => {
  // the shell is restyled from the lobby's own <style>, which is mounted with the screen — web.tsx knows nothing of it
  assert.ok(component.includes("<style dangerouslySetInnerHTML={{ __html: AUTH_LOBBY_CSS }} />"));
  const shell = read("app", "routes", "web.tsx");
  assert.ok(!/\blb-|AuthLobby/.test(shell));
  // every rule that reaches outside the lobby outranks the shell's own (.wb x beats x), whatever the order
  for (const r of sheet.filter((x) => /\.(wb-main|wb-brand|wb-crest|lt-btn|wb-login|wb-tab|wb-admin|mm-fab)\b/.test(x.sel))) {
    for (const s of r.sel.split(",")) assert.ok(s.startsWith(".wb "), s);
  }
  assert.ok(css.includes("html .wb{background:") && css.includes("html .wb::before,html .wb::after{background-image:url(/gstyle-rosette.svg);}"));
  assert.ok(css.includes(".wb .wb-main{padding:0;}"));
  // the ticket's ink does not depend on the page's colour
  assert.ok(!/(^|\})html \.wb\{[^}]*[;{]color:/.test(css.replace(/\n/g, "")));
  // on a phone Helpurr stands at the foot of the page, under the ticket, with room kept for it…
  assert.ok(css.includes("@media(max-width:620px){\n  .wb .mm-fab{position:absolute;bottom:calc(14px + env(safe-area-inset-bottom,0px));}\n  .wb .wb-bottom ~ .mm-fab{position:fixed;bottom:calc(97px + env(safe-area-inset-bottom,0px));}\n}"));
  assert.ok(css.includes("@media(max-width:620px){.lb{padding-bottom:calc(86px + env(safe-area-inset-bottom,0px));}}"));
  assert.ok(shell.includes("@media(max-width:620px){.mm-fab{bottom:calc(97px + env(safe-area-inset-bottom,0px));right:16px;width:56px;height:56px}"), "56 tall, 16 from the edge: 86 keeps it clear");
  // …and on a wide screen the ticket keeps 100px from the right edge, where Helpurr floats (66 wide, 20 in)
  assert.ok(css.includes("padding:8px 100px 24px clamp(24px,3vw,56px);"));
  assert.ok(shell.includes(".mm-fab{position:fixed;z-index:10600;bottom:30px;right:20px;width:66px;height:66px;"));
});

test("TWO LIGHTS, ONE LOBBY (\"same concept but with the lite theme show both\" — then, on seeing both: \"Make dark default\"): by night unless this browser chose the day", () => {
  // which one: the hook that reads the shell's loader (the visitor's emTheme cookie) — the same on the server
  // and in the browser, so nothing flashes; DARK for anyone who never chose (theme.ts → DEFAULT_THEME)
  assert.ok(component.includes('import { useTheme } from "../lib/use-theme";'));
  assert.ok(component.includes('const dark = useTheme() === "dark";'));
  const hook = read("app", "lib", "use-theme.ts");
  assert.ok(hook.includes('const shell = useRouteLoaderData("routes/web") as { theme?: unknown } | undefined;') && hook.includes("return themeOf(shell?.theme);"));
  const themeSrc = read("app", "lib", "theme.ts");
  assert.ok(themeSrc.includes('export const DEFAULT_THEME: Theme = "dark";') && themeSrc.includes('export const themeOf = (v: unknown): Theme => (String(v ?? "").trim().toLowerCase() === "light" ? "light" : DEFAULT_THEME);'));
  // the night is ONE class on the lobby, and ONE more sheet for the shell — drawn only at night
  assert.ok(component.includes('<div className={dark ? "lb is-dark" : "lb"}>'));
  assert.ok(component.includes("<style dangerouslySetInnerHTML={{ __html: AUTH_LOBBY_CSS }} />"));
  assert.ok(component.includes("{dark && <style dangerouslySetInnerHTML={{ __html: AUTH_LOBBY_DARK_CSS }} />}"));
  assert.equal(count(component, "AUTH_LOBBY_DARK_CSS"), 1, "nowhere else");
  // the lobby has no switch of its own (the switch is in the account menu)
  assert.ok(!/useSetTheme|themeCookie|emTheme/.test(lobby));

  // BY DAY THE SHELL IS THE SHELL: the day's sheet repaints nothing outside the lobby — not the page, not the
  // header's words, not the rosettes. What it does to the shell is room and reach only.
  const dayRules = rules(baseCss).filter((r) => !r.media.includes("prefers-reduced-motion"));
  const reaching = dayRules.filter((r) => /^(html|body)\b|^\.wb |^\.lt-menu /.test(r.sel));
  assert.deepEqual(reaching.map((r) => r.sel), [
    ".wb .wb-main",
    ".wb .wb-brand,.wb .lt-btn,.wb .wb-login",
    ".wb .wb-brand::after,.wb .lt-btn::after,.wb .wb-login::after",
    ".lt-menu .lt-opt",
    ".wb .mm-fab",
    ".wb .wb-bottom ~ .mm-fab",
  ]);
  for (const r of reaching) assert.ok(!/(^|;)(background|background-image|background-color|color|border-color|opacity|filter|scrollbar-color|outline-color|box-shadow):/.test(r.body), `the day's sheet repaints the shell: ${r.sel}{${r.body}}`);
  // …and every rule of the night's sheet is the shell's (the lobby's own night is in the first sheet, under .is-dark)
  for (const r of rules(darkCss)) for (const s of r.sel.split(",")) assert.ok(/^(html\b|body\b|\.wb )/.test(s.trim()), `the night's sheet reaches into the lobby: ${s}`);
  assert.ok(!darkCss.includes(".lb"));

  // THE NAMES. Every colour that differs between the two lights is a name on the lobby: the day's values
  // first, the night's under .is-dark — and nothing else in the first sheet says .is-dark but the board
  // (which is the day's: .lb:not(.is-dark)) and a tablet's top margin
  const names = ["top", "page", "ink", "accent", "soft", "label", "rule", "chip", "edge", "drop"];
  const day = sheet.find((r) => r.sel === ".lb" && r.media === "" && r.body.includes("--lb-page"));
  const night = sheet.find((r) => r.sel === ".lb.is-dark" && r.media === "");
  assert.ok(day && night);
  for (const n of names) { assert.ok(new RegExp(`(^|;)--lb-${n}:`).test(day.body), `the day's ${n}`); assert.ok(new RegExp(`(^|;)--lb-${n}:`).test(night.body), `the night's ${n}`); }
  assert.deepEqual([...night.body.matchAll(/--lb-([a-z]+):/g)].map((m) => m[1]), names, "the night turns every name, and only names");
  assert.ok(day.body.includes("--lb-page:#F4F1E6;--lb-ink:#14201A;--lb-accent:#0A6A3D;--lb-soft:#4A554E;--lb-label:#6B4F0E;"));
  const darkSels = [...new Set(sheet.filter((r) => r.sel.includes("is-dark")).map((r) => `${r.media}|${r.sel}`))].sort();
  assert.deepEqual(darkSels, [
    "@media(max-width:599px)|.lb:not(.is-dark)",
    "@media(min-width:600px) and (max-width:959px)|.lb.is-dark",
    "@media(min-width:960px)|.lb:not(.is-dark) .lb-stage",
    "|.lb.is-dark",
    "|.lb:not(.is-dark) .lb-stage",
  ]);
  // the day's page is the shell's own paper, and its ink and soft print the shell's own tokens
  const shell = read("app", "routes", "web.tsx");
  for (const token of ["--paper:#F4F1E6;", "--ink:#14201A;", "--ink2:#4A554E;", "--green:#0C7A46;", "--gold:#B08526;"]) assert.ok(shell.includes(token), token);

  // BY DAY: THE BOARD. The sign and the wall stand on deep green across the cream page — a gold line along its
  // top and its foot on a phone, a panel with a gold edge on a wide screen. By night there is no board.
  const board = sheet.find((r) => r.sel === ".lb:not(.is-dark) .lb-stage" && r.media === "");
  assert.ok(board && board.body.includes("background:radial-gradient(80% 110% at 50% -10%,rgba(52,180,116,.22),rgba(52,180,116,0) 72%),linear-gradient(180deg,#123F2B,#0B2A1D);"));
  assert.ok(board.body.includes("box-shadow:inset 0 1px 0 rgba(231,200,121,.6),inset 0 -1px 0 rgba(231,200,121,.6),"));
  assert.ok(!sheet.some((r) => /^\.lb(\.is-dark)? \.lb-stage$|^\.lb-stage$/.test(r.sel) && /background/.test(r.body)), "by night the stage has no ground of its own");
  // (the sign's lamps and words, the cards and the screen are the same in both lights: nothing about them is named)
  for (const r of sheet.filter((x) => /\.lb-(rail|sign|poster|screen|clip|ico|track|wall)\b/.test(x.sel))) assert.ok(!r.body.includes("var(--lb-"), r.sel);
});

test("BY DAY the words read: ink, green and deep gold on the app's cream — under its tints and its rosettes too — and gold on the board", () => {
  const shell = read("app", "routes", "web.tsx");
  const PAPER = "#F4F1E6";
  // the shell's page is its paper under three faint tints, with two green rosettes turning behind it
  assert.ok(shell.includes("radial-gradient(72% 52% at 50% -8%,rgba(15,145,82,.14),transparent 62%)") && shell.includes("radial-gradient(54% 40% at 98% 64%,rgba(176,133,38,.075),transparent 68%)"));
  const green = /stroke='(#[0-9A-Fa-f]{6})' stroke-opacity='([\d.]+)'/.exec(read("public", "gstyle-rosette-green.svg"));
  assert.ok(green && shell.includes("width:660px;height:660px;opacity:.075;"));
  const rosette = 0.075 * Number(green[2]);
  // the two grounds a word of the lobby can stand on by day, each at its worst: the head of the page (its
  // green tint at its fullest) and the lower page (its gold tint at its fullest), under a rosette's line
  const HEAD = over(green[1], over("#0F9152", PAPER, 0.14), rosette);
  const LOWER = over(green[1], over("#B08526", PAPER, 0.075), rosette);
  const words: [string, string][] = [["the line, a house's name", "#14201A"], ["the line's second half", "#0A6A3D"], ["the playbill's print", "#4A554E"], ["the playbill's label", "#6B4F0E"]];
  for (const [what, colour] of words) for (const [where, ground] of [["the paper", PAPER], ["the head of the page", HEAD], ["the lower page", LOWER]]) {
    assert.ok(contrast(colour, ground) >= 4.5, `${what} on ${where}: ${contrast(colour, ground).toFixed(2)}`);
  }
  // (the brand's own green, #0C7A46, would be 3.7 on the tinted head of the page — so the line's second half
  // is the deeper green of the ticket's button)
  assert.ok(contrast("#0C7A46", HEAD) < 4.5 && css.includes("#0C7A46 30%,#0A6A3D 72%"));
  assert.ok(css.includes(".lb-line em{display:block;font-style:normal;color:var(--lb-accent);}") && css.includes("letter-spacing:-.02em;color:var(--lb-ink);overflow-wrap:anywhere;}"));
  // the sign's gold words, on the board where it is most lit
  const BOARD = over("#34B474", "#123F2B", 0.22);
  assert.ok(contrast("#E7C879", BOARD) >= 4.5, `the sign on the board: ${contrast("#E7C879", BOARD).toFixed(2)}`);
  assert.ok(css.includes("white-space:nowrap;color:#E7C879;text-shadow:0 0 14px rgba(231,200,121,.6);}"));
  // a house's icon: gold on a chip of the board's green (a picture: 3:1 is asked)
  assert.ok(baseCss.includes("--lb-chip:#103C2A;") && contrast("#E7C879", "#103C2A") >= 4.5);
  // THE TICKET still reads as a ticket on a cream page: the app's own gold round its edge (deeper than the
  // night's pale gold, which would vanish on cream), a doubled shadow under it, and its notches the page's colour
  assert.ok(baseCss.includes("--lb-edge:rgba(176,133,38,.8);--lb-drop:0 34px 60px -30px rgba(20,32,26,.62),0 12px 24px -16px rgba(20,32,26,.3);"));
  assert.ok(contrast(over("#B08526", PAPER, 0.8), PAPER) > contrast(over("#E7C879", PAPER, 0.6), PAPER) * 1.5, "the day's edge is far easier to see on cream than the night's would be");
  assert.ok(baseCss.includes("--lb-page:#F4F1E6;"));
});

test("THE PLAYBILL (\"we would also benefit here to showcase some features\"): the five houses, the nav's names and icons, a line each — and not a link among them", () => {
  // the houses he named — Film, Ads, Creation, Cast, Auto-post — under the names and icons the nav gives them
  const shell = read("app", "routes", "web.tsx");
  const houses: [string, string][] = [["Movie Maker", "filmreel"], ["Ad Maker", "megaphone"], ["Creator", "palette"], ["Presenters", "presenter"], ["Auto-post", "rocket"]];
  const rows = [...component.matchAll(/\{ key: "([a-z]+)", icon: "([a-z]+)", name: t\("([^"]+)"\), line: t\("([^"]+)"\) \},/g)].map((m) => ({ key: m[1], icon: m[2], name: m[3], line: m[4] }));
  assert.deepEqual(rows.map((r) => [r.name, r.icon]), houses);
  const icons = read("app", "lib", "icons.tsx");
  for (const [name, icon] of houses) {
    assert.ok(shell.includes(`<Ico n="${icon}" size={22} /></span><span>{t("${name}")}</span></Link>`), `${name} wears ${icon} in the nav`);
    assert.ok(new RegExp(`\\n  ${icon}: <`).test(icons), icon);
  }
  // one line each of what the house does: a sentence, no number, no price, nothing "free"
  for (const r of rows) {
    assert.ok(r.line.length >= 30 && r.line.length <= 76 && r.line.endsWith("."), r.line);
    assert.ok(!/\d|\$|free|best|#1|unlimited/i.test(r.line), r.line);
  }
  // a list under a small heading of its own; the icon says nothing to a screen reader (the name does)
  assert.ok(component.includes('<section className="lb-bill" aria-labelledby="lb-bill-h">'));
  assert.ok(component.includes('<h2 className="lb-bill-h" id="lb-bill-h">{t("Feature presentations")}</h2>'));
  assert.ok(component.includes('<span className="lb-bill-ico" aria-hidden="true"><Ico n={b.icon} size={18} /></span>'));
  assert.ok(component.includes("<b>{b.name}</b>") && component.includes('<span className="lb-bill-what">{b.line}</span>'));
  // NOT links: a visitor has nowhere to go yet (and nothing here can be tapped or tabbed to)
  const bill = component.slice(component.indexOf('<section className="lb-bill"'), component.indexOf("</section>"));
  assert.ok(bill.length > 200 && !/<a |<Link|<button|onClick|href=|role="button"|tabIndex/.test(bill));
  // AFTER the ticket: on a phone it stands below it (the ticket keeps the first screen)…
  assert.ok(component.indexOf('<div className="lb-booth">') < component.indexOf('<section className="lb-bill"'));
  assert.ok(baseCss.includes(".lb-bill{min-width:0;margin:26px 0 0;padding:0 16px;}"));
  assert.ok(sheet.some((r) => r.sel === ".lb-bill ul" && r.media === "" && r.body.includes("display:grid;gap:14px;max-width:440px;")), "one house a row, as wide as the ticket");
  // …and across the foot of a wide screen it is one row of five, under both columns
  const wide = (sel: string) => sheet.find((r) => r.sel === sel && r.media === "@media(min-width:960px)");
  assert.equal(wide(".lb-bill")?.body, "grid-column:1 / -1;margin:0;padding:0;");
  assert.ok(wide(".lb-bill ul")?.body.startsWith("grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.1fr) minmax(0,1fr);"), "five columns");
  assert.ok(wide(".lb")?.body.includes("row-gap:18px;align-items:center;align-content:center;"), "the two rows stay together in a tall window");
  // its print: 13px and up on a phone, 12.5 on a wide screen; names in the day's ink / the night's cream
  assert.ok(baseCss.includes(".lb-bill-what{font-size:13px;line-height:1.45;color:var(--lb-soft);}") && baseCss.includes("line-height:1.3;color:var(--lb-ink);}"));
  assert.ok(baseCss.includes("text-transform:uppercase;color:var(--lb-label);}") && baseCss.includes(".lb-bill-h::before,.lb-bill-h::after{content:\"\";flex:1 1 0;height:1px;background:var(--lb-rule);}"));
  // WITHOUT SCROLLING on a 1280 x 800 laptop: the header 68, the lobby's own 8 above and 24 below, the stage
  // (by day: the board's 16 + the sign 36 + the screen + the wall 174 + 2), 18, then the playbill — its label
  // 27 and a house of three lines 88 at most
  const screenH = 800 - 480;
  const stage = 16 + 36 + screenH + 174 + 2;
  assert.ok(68 + 8 + stage + 18 + (27 + 88) + 24 <= 800, `${68 + 8 + stage + 18 + 27 + 88 + 24}px of an 800px window`);
});

test("the ticket is exactly as it was (\"the Admit one light cream card over the dark is extremely attractive\")", () => {
  assert.ok(component.includes('<span className="lb-wm" aria-hidden="true" />'));
  assert.ok(component.includes('<div className="lb-stub" aria-hidden="true"><span>{t("Admit one")}</span><span className="lb-bars" /></div>'));
  // its paper, its gold edge, the way it comes up — once
  // (its edge and its shadow are named, so the day can have its own: at NIGHT they are what they always were)
  assert.ok(css.includes(".lb .lb-ticket{position:relative;isolation:isolate;max-width:440px;margin:0 auto;padding:0 22px 12px;border:0;border-radius:18px;color:var(--ink,#14201A);background:linear-gradient(176deg,#FFFDF7,#F7F0DE);box-shadow:0 0 0 1px var(--lb-edge),var(--lb-drop);animation:lbTicketIn .55s cubic-bezier(.2,.7,.2,1) .05s backwards;}"));
  assert.ok(baseCss.includes("--lb-edge:rgba(231,200,121,.6);--lb-drop:0 34px 60px -30px #000;}"), "the night's edge and shadow: 0 0 0 1px rgba(231,200,121,.6), 0 34px 60px -30px #000 — as before");
  assert.ok(!/lbTicketIn[^;}]*infinite/.test(css));
  // the stub, its perforation, its bars
  assert.ok(css.includes(".lb-stub{display:flex;align-items:center;justify-content:space-between;gap:12px;height:40px;margin:0 -22px 12px;padding:0 22px;border-bottom:2px dashed rgba(107,79,14,.5);border-radius:18px 18px 0 0;background:linear-gradient(180deg,rgba(231,200,121,.34),rgba(231,200,121,.14));font-family:Poppins,sans-serif;font-weight:800;font-size:10.5px;letter-spacing:.26em;text-transform:uppercase;color:#6B4F0E;}"));
  assert.ok(css.includes(".lb-bars{flex:0 0 auto;width:66px;height:16px;opacity:.7;background:repeating-linear-gradient(90deg,#14201A 0,"));
  // the notches sit on the perforation (the stub is 40 tall, its dashed line the last 2: centre 39, an 18px notch from 30)
  assert.ok(css.includes(".lb .lb-ticket::before,.lb .lb-ticket::after{content:\"\";position:absolute;z-index:2;top:30px;width:18px;height:18px;border-radius:50%;background:var(--lb-page);}"), "cut out in the page's own colour — the night's green, the day's cream");
  assert.ok(css.includes(".lb .lb-ticket::before{left:-9px;box-shadow:inset -1px 0 0 var(--lb-edge);}") && css.includes(".lb .lb-ticket::after{right:-9px;box-shadow:inset 1px 0 0 var(--lb-edge);}"));
  // the watermark is under the print, and takes no tap
  assert.ok(css.includes(".lb-wm{position:absolute;inset:0;z-index:-1;border-radius:18px;overflow:hidden;pointer-events:none;}"));
  assert.ok(css.includes("background:#0C7A46;opacity:.16;-webkit-mask-image:url(/gstyle-rosette.svg);"));
});

test("every word the lobby shows is in all five languages — and the line says films, ads, anything", () => {
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  const said = [...new Set([...component.matchAll(/\bt\("([^"]+)"\)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(said, [
    "A cast of people, cartoons and monsters. Or make your own.",
    "A presenter holds your product and sells it.",
    "Ad Maker", "Admit one", "Auto-post", "Creator",
    "Feature presentations",
    "Films. Ads. Anything.|Just describe it.",
    "Movie Maker", "Now showing",
    "Pictures, video and music from a prompt.",
    "Posted to your socials on a schedule, hands off.",
    "Presenters",
    "Short films, told stories, cartoons and music videos, from one sentence.",
  ]);
  for (const k of [...said, ...FILM_HEROES.map((h) => h.name)]) assert.equal(count(dict, `\n  ${JSON.stringify(k)}: `), 5, k);
  // no word is written into the markup untranslated
  const markupAt = component.indexOf("return (\n    <div className={dark ? \"lb is-dark\" : \"lb\"}>");
  assert.ok(markupAt > 0);
  const markup = component.slice(markupAt);
  assert.ok(!/>[^<>{}]*[A-Za-z]{3,}[^<>{}]*</.test(markup.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")), "bare words in the lobby's markup");
  // the lobby speaks the language the door is being read in (its own `lang`), through the app's one dictionary
  assert.ok(component.includes("const L = authLang(lang);") && component.includes("const t = (source: string) => tr(L, source);"));

  // THE LINE. It said "Make a movie." — and the app "appear[ed] to only do movies". It names films and ads
  // and leaves the rest open; the second half is the Movie Maker's own, word for word, in English.
  assert.ok(component.includes('const [lead, tail] = t("Films. Ads. Anything.|Just describe it.").split("|");'));
  assert.ok(component.includes('<p className="lb-line">{tail ? `${lead} ` : lead}{tail ? <em>{tail}</em> : null}</p>'));
  assert.ok(!component.includes('t("Make a movie.")'));
  const film = read("app", "routes", "web.film.tsx");
  assert.ok(film.includes('<b>{t("Make a movie.")} <em>{t("Just describe it.")}</em></b>'), "the Movie Maker keeps its own line");
  // ONE string for the two halves, so each language makes them agree (the Movie Maker's second half is
  // "describe HER / HIM" in Spanish and German — a film; here there is no film to agree with)
  const halves = [...dict.matchAll(/\n  "Films\. Ads\. Anything\.\|Just describe it\.": "([^"]+)",/g)].map((m) => m[1]);
  assert.equal(halves.length, 5);
  for (const h of halves) { const parts = h.split("|"); assert.equal(parts.length, 2, h); assert.ok(parts[0].trim().length >= 4 && parts[1].trim().length >= 4, h); }
  assert.ok(halves[0].endsWith("|Solo descríbelo.") && halves[2].endsWith("|Beschreib es einfach."), "neuter, where the Movie Maker's says la / ihn");
  // as short as the line it replaces had to be: a phone shows each half on one line
  for (const h of ["Films. Ads. Anything.|Just describe it.", ...halves]) for (const part of h.split("|")) assert.ok(part.length <= 26, part);
  // the two names the app keeps as they are in every language (its own sentences say "Abrir Ad Maker",
  // "Creator کھولیں") are in the dictionary as they are — so nothing is "missing", and nothing changed anywhere
  assert.equal(count(dict, '\n  "Ad Maker": "Ad Maker",'), 5);
  assert.ok(dict.includes('\n  "Open Ad Maker": "Abrir Ad Maker",') && dict.includes('\n  "Open Creator": "Creator کھولیں",') && dict.includes('\n  "Creator": "Creator",'));
  // it claims only what the pictures show: formats and houses by name, and the line — no numbers, no praise
  assert.ok(!/\d/.test(said.join(" ")));
});
