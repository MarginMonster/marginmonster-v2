/* THE LOBBY — the sign-in screens as the front of a cinema that is showing the app's own films.
 *
 * The owner, 2026-11-24, with a phone screenshot of /web/login: "Mobile login page looks 'Why do I even have
 * this app' when it should read holy shit this app is amazing. I'm assuming desktop has same problem. Needs
 * art and badass cinema". The screen was a cream card on a pale page; nothing on it showed what the app makes.
 *
 * Now the four doors (log in, sign up, forgot, reset) stand in one room, app/components/AuthLobby.tsx: a
 * marquee sign, the Movie Maker's nine posters drifting past, a screen playing four of the films on a wide
 * screen, and the form printed on an admission ticket.
 *
 * What must stay true, and is held here:
 *   · the forms are the forms they were — every field, hidden input, link and error line
 *   · only the landing's own pictures are shown (generated actors and cartoons), and each is a file that is there
 *   · a phone fetches no film; the clips are added by the browser, on a wide screen that wants them moving
 *   · everything that moves stands still for anyone who asks for less motion
 *   · the words on the dark read (4.5:1 or better), fields stay 16px, a finger gets 44px
 *   · every word is in all five languages
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILM_HEROES } from "../app/lib/film-heroes.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// (a checkout with CRLF line endings must read the same as one with LF)
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const exists = (...p: string[]) => fs.existsSync(path.join(root, ...p));
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const lobby = read("app", "components", "AuthLobby.tsx");
const CSS_OPEN = "export const AUTH_LOBBY_CSS = `";
const css = lobby.slice(lobby.indexOf(CSS_OPEN) + CSS_OPEN.length, lobby.indexOf("`;", lobby.indexOf(CSS_OPEN)));
const component = lobby.slice(0, lobby.indexOf(CSS_OPEN));
const DOORS = ["web.login.tsx", "web.signup.tsx", "web.forgot.tsx", "web.reset.$token.tsx"];
const door = (f: string) => read("app", "routes", f);
/** A list the component declares, e.g. WALL_ORDER = ["a", "b"]. */
const list = (name: string) => {
  const m = new RegExp(`const ${name} = (?:new Set\\()?\\[([^\\]]+)\\]`).exec(lobby);
  assert.ok(m, name);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};

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
    assert.ok(src.includes('import { AuthLobby } from "../components/AuthLobby";'), f);
    assert.ok(src.includes("<AuthLobby lang={lang}>"), `${f}: read in the page's own language`);
    // the room is the lobby's: no door keeps a card or a stylesheet of its own
    assert.ok(!src.includes('className="wb-auth wb-card"') && !src.includes("AUTH_FX") && !src.includes("<style"), f);
    // …and none of them draws a picture or a film itself
    assert.ok(!/<img|<video|\/landing\//.test(src), f);
    // every form still posts back to its own door
    const forms = count(src, "<Form ");
    assert.ok(forms >= 1 && forms === count(src, '<Form method="post">'), `${f}: every form posts to its own door`);
    assert.ok(src.includes('<input type="hidden" name="lang" value={lang} />'), `${f}: the language is still posted`);
    // a dark page gets a dark bar on a phone
    assert.ok(src.includes('{ name: "theme-color", content: "#130E0B" }'), f);
  }
  assert.equal(count(lobby, '<div className="lb-ticket wb-auth wb-card">'), 1, "one ticket, and it is still the shell's card");
  assert.ok(lobby.includes("{children}"));

  const login = door("web.login.tsx");
  assert.ok(login.includes('export const meta = () => [{ title: "Log in · EasyMode" }, { name: "theme-color", content: "#130E0B" }];'));
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

test("the wall bills all nine heroes under their own names, with the landing's own pictures — each a file that is there", () => {
  const wall = list("WALL_ORDER");
  const reel = list("REEL_ORDER");
  const tall = list("TALL_STILLS");
  // every hero's poster is on the wall once; the screen shows four of them
  assert.deepEqual([...wall].sort(), FILM_HEROES.map((h) => h.media).sort());
  assert.equal(new Set(wall).size, 9);
  assert.equal(reel.length, 4);
  for (const k of reel) assert.ok(wall.includes(k), k);
  // a poster is named by its hero (film-heroes.ts), never by a second list of names
  assert.ok(component.includes('const nameOf = (media: string) => FILM_HEROES.find((h) => h.media === media)?.name || "";'));
  assert.ok(component.includes("<b>{t(p.name)}</b>") && component.includes("<span className=\"lb-clip-tag\"><i />{t(c.name)}</span>"));
  // the files
  for (const k of wall) {
    const f = tall.includes(k) ? `film-still-${k}-tall.jpg` : `film-still-${k}.jpg`;
    assert.ok(exists("public", "landing", f), f);
  }
  for (const k of reel) for (const f of [`film-loop-${k}.jpg`, `film-loop-${k}.mp4`]) assert.ok(exists("public", "landing", f), f);
  // …and no picture from anywhere else: every path the component writes is one of these three under /landing
  const paths = [...component.matchAll(/`(\/[^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(paths, [
    "/landing/film-still-${key}-tall.jpg?v=${STILL_V}",
    "/landing/film-still-${key}.jpg?v=${STILL_V}",
    "/landing/film-loop-${key}.jpg?v=${LOOP_V}",
    "/landing/film-loop-${key}.mp4?v=${LOOP_V}",
  ]);
  assert.ok(!/["'`(]\/(uploads|_harness|avatars|renders|custom|vthumb|showcase)\b/.test(lobby), "never a member's picture, never a presenter's");
  assert.deepEqual([...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]), ["/gstyle-rosette.svg", "/gstyle-rosette.svg"], "the only file the stylesheet asks for is the brand's rosette (the green button already has it)");
  assert.ok(exists("public", "gstyle-rosette.svg"));
  // the same files, under the same cache versions and the same tall set, as the Movie Maker serves them
  const film = read("app", "routes", "web.film.tsx");
  for (const line of ["const LOOP_V = 5;", "const STILL_V = 8;"]) assert.ok(film.includes(line) && component.includes(line), line);
  const filmTall = /const TALL_STILLS = new Set\(\[([^\]]+)\]\)/.exec(film);
  assert.ok(filmTall);
  assert.deepEqual([...tall].sort(), [...filmTall[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort());
  // a picture's box is known before it arrives (nothing jumps), and it says nothing to a screen reader
  assert.ok(component.includes('<img src={p.src} alt="" width={p.w} height={p.h} decoding="async" />'));
  assert.ok(component.includes('<img src={c.still} alt="" width={720} height={404} loading="lazy" decoding="async" />'));
  assert.ok(css.includes(".lb-poster{position:relative;isolation:isolate;flex:0 0 auto;width:var(--pw);height:calc(var(--pw) * 1.25);"));
  // the whole stage is ONE picture to a screen reader, said once: what is showing
  assert.ok(component.includes('<div className="lb-stage" role="img" aria-label={`${t("Now showing")}: ${WALL.map((p) => t(p.name)).join(", ")}`}>'));
});

test("the wall never ends: the nine twice, moved left by exactly one set — and it cannot push the page sideways", () => {
  assert.ok(component.includes("{[0, 1].map((set) => WALL.map((p, k) => ("));
  assert.ok(css.includes(".lb-track{display:flex;width:max-content;animation:lbDrift 64s linear infinite;}"));
  assert.ok(css.includes("@keyframes lbDrift{to{transform:translate3d(-50%,0,0)}}"));
  // (a margin, not a gap: two sets with a gap between them are not twice one set)
  assert.ok(/\.lb-poster\{[^}]*margin-right:12px;/.test(css) && !/\.lb-track\{[^}]*gap:/.test(css));
  assert.ok(css.includes(".lb-wall{direction:ltr;overflow:hidden;"), "clipped, and it runs the same way in a right-to-left language");
  // a poster catches the light, one after another down the row — the same on both sets, so the seam cannot show
  assert.ok(component.includes('<div className="lb-poster" key={`${set}-${p.key}`} style={{ ["--k" as string]: k }}>'));
  assert.ok(css.includes("animation:lbShine 9s ease-out calc(.7s + var(--k,0) * .22s) infinite backwards;"));
  // one set is always wider than the strip it runs in (9 posters and their margins against the widest strip):
  // a phone (116–150 by its height, 136 where that cannot be asked), a tablet, a phone on its side, a wide screen
  const widths: [number, number][] = [[116, 599], [136, 599], [150, 959], [104, 959], [112, 680]];
  for (const [pw, strip] of widths) assert.ok(9 * (pw + 12) >= strip, `${pw}px posters in a ${strip}px strip`);
  assert.ok(css.includes(".lb{--pw:136px;") && css.includes(".lb{--pw:150px;") && css.includes(".lb{--pw:112px;") && css.includes(".lb{--pw:104px;}"));
  assert.ok(css.includes("@supports (height:1svh){@media(max-width:599px){.lb{--pw:clamp(116px,calc(20svh - 16px),150px);}}}"), "by the height the phone really has, bars showing");
  assert.ok(css.includes("max-width:clamp(380px,calc((100vh - 330px) * 1.7778),680px);"), "the wide strip is never wider than 680");
});

test("a phone fetches no film: the screen is for wide screens, and its clips are added only there", () => {
  // hidden by default, shown from 960px — the same width the component waits for before adding a clip
  const base = sheet.find((r) => r.sel === ".lb-screen" && r.media === "");
  assert.equal(base?.body, "display:none;");
  const wide = sheet.find((r) => r.sel === ".lb-screen" && r.media === "@media(min-width:960px)");
  assert.ok(wide && wide.body.startsWith("display:block;position:relative;aspect-ratio:16/9;"));
  assert.ok(component.includes('const SCREEN_MEDIA = "(min-width: 960px)";'));
  assert.ok(component.includes("const decide = () => setPlays(wide.matches && !calm.matches && !saving);"), "wide, wanting motion, and not saving data");
  assert.ok(component.includes("const [plays, setPlays] = useState(false);"), "never on the server: the page arrives with no clip in it");
  // the clip: silent, inline, looping, starting by itself, with its own first frame as the poster, and nothing to a screen reader
  assert.ok(component.includes('{plays && <video ref={startClip} src={c.clip} poster={c.still} muted loop playsInline autoPlay preload="metadata" aria-hidden="true" tabIndex={-1} />}'));
  assert.equal(count(component, "<video"), 1);
  assert.ok(!/<audio|new Audio\(|controls/.test(component));
  // its still is lazy: hidden on a phone, a lazy picture is never fetched
  assert.ok(component.includes('loading="lazy"') && count(component, 'loading="lazy"') === 1);
  // the wall's posters are NOT lazy, on purpose (they arrive by a transform; see the note at the top of the component)
  assert.ok(lobby.includes("NOT lazy, on purpose"));
});

test("everything that moves stands still for anyone who asks for less motion", () => {
  const still = sheet.filter((r) => r.media === "@media(prefers-reduced-motion:reduce)");
  const stilled = new Set(still.filter((r) => /(^|;)animation:none;/.test(r.body)).flatMap((r) => r.sel.split(",")));
  const moving = sheet.filter((r) => !r.media.includes("prefers-reduced-motion") && /(^|;)animation(-name)?:(?!none)/.test(r.body)).flatMap((r) => r.sel.split(","));
  assert.ok(moving.length >= 8, "the sign, the wall, the light, the screen, the watermark, the ticket, the busy dot");
  for (const sel of moving) assert.ok(stilled.has(sel), `${sel} must stop`);
  // the screen then holds its first frame, and the light is not left parked on a poster
  assert.ok(still.some((r) => r.sel === ".lb-clip:first-child" && r.body === "opacity:1;"));
  assert.ok(still.some((r) => r.sel === ".lb-poster::before" && r.body === "display:none;"));
  // nothing here is animated by script, and nothing makes a sound
  assert.ok(!/requestAnimationFrame|setInterval|setTimeout|\.animate\(/.test(component));
});

/** WCAG contrast of two #RRGGBB colours. */
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
/** `top` laid over `under` at `alpha`. */
const over = (top: string, under: string, alpha: number) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(top.slice(i, i + 2), 16) * alpha + parseInt(under.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, "0")).join("");

test("the words read: 4.5:1 or better on the dark, on the lit part of it, and on the ticket", () => {
  const DARK = "#130E0B";
  assert.ok(css.includes("html,body{background:#130E0B;}") && css.includes(",#130E0B;}"));
  // the lobby is lightest where the marquee's light falls: the gold at its fullest over the dark
  assert.ok(css.includes("radial-gradient(120% 56% at 50% -12%,rgba(231,200,121,.22),rgba(231,200,121,0) 60%)"));
  const LIT = over("#E7C879", DARK, 0.22);
  const onDark: [string, string][] = [
    ["the logo, the line", "#FFFDF7"], ["the sign, the line's second half, the logo's second half", "#E7C879"], ["a signed-in visitor's tabs", "#D8CFBA"],
  ];
  for (const [what, colour] of onDark) {
    assert.ok(css.includes(colour), what);
    assert.ok(contrast(colour, DARK) >= 4.5 && contrast(colour, LIT) >= 4.5, `${what}: ${contrast(colour, LIT).toFixed(2)}`);
  }
  // the language pill and the header's "Log in": cream words on dark glass (7% cream over the lit dark)
  assert.ok(css.includes(".wb .lt-btn,.wb .wb-login{position:relative;background:rgba(255,253,247,.07);border-color:rgba(231,200,121,.5);color:#FFFDF7;box-shadow:none;}"));
  assert.ok(contrast("#FFFDF7", over("#FFFDF7", LIT, 0.07)) >= 4.5);
  // a poster's name: white over the picture's own shade — even over a WHITE picture, and even three lines
  // of it in a language that needs the room (the name stands 9px up; three lines reach 46% of the poster)
  assert.ok(css.includes(".lb-poster::after{content:\"\";position:absolute;inset:0;z-index:1;background:linear-gradient(0deg,rgba(10,7,5,.95) 0%,rgba(10,7,5,.86) 22%,rgba(10,7,5,.62) 46%,rgba(10,7,5,.28) 62%,rgba(10,7,5,0) 78%);}"));
  assert.ok(contrast("#FFFFFF", over("#0A0705", "#FFFFFF", 0.62)) >= 4.5, "the shade at 46% up");
  assert.ok(css.includes(".lb-poster b{position:absolute;z-index:3;left:10px;right:10px;bottom:9px;"), "the name is above the shade and above the passing light");
  // (three lines in the tallest script — Urdu, line-height 1.5: 14px type on a phone's 136px poster, 12.5px on the wide screen's 112px one)
  assert.ok(css.includes("[dir=rtl] .lb-poster b{direction:rtl;text-align:right;letter-spacing:0;line-height:1.5;}") && css.includes(".lb-poster b{left:9px;right:9px;bottom:8px;font-size:12.5px;}"));
  assert.ok((9 + 3 * 14 * 1.5) / (136 * 1.25) <= 0.46 && (8 + 3 * 12.5 * 1.5) / (112 * 1.25) <= 0.46);
  // the button: full width, so its words sit mid-button — on the brand's deep green, never the shell's palest
  assert.ok(css.includes(".lb .lb-ticket .wb-btn:not(.ghost){background:linear-gradient(100deg,#0C7A46 30%,#0A6A3D 72%,#075530);}"));
  for (const green of ["#0C7A46", "#0A6A3D", "#075530"]) assert.ok(contrast("#FFFFFF", green) >= 4.5, green);
  // what is playing: white on its own dark pill, over any frame
  assert.ok(css.includes("background:rgba(10,7,5,.74);color:#fff;"));
  assert.ok(contrast("#FFFFFF", over("#0A0705", "#FFFFFF", 0.74)) >= 4.5);
  // the ticket is the shell's cream card: its own ink on its own paper, and the stub's print on the stub's gold
  assert.ok(css.includes("color:var(--ink,#14201A);background:linear-gradient(176deg,#FFFDF7,#F7F0DE);"));
  for (const paper of ["#FFFDF7", "#F7F0DE"]) for (const ink of ["#14201A", "#4A554E", "#0C7A46", "#7A2E1D"]) assert.ok(contrast(ink, paper) >= 4.5, `${ink} on ${paper}`);
  assert.ok(css.includes("background:linear-gradient(180deg,rgba(231,200,121,.34),rgba(231,200,121,.14));") && css.includes("color:#6B4F0E;"));
  assert.ok(contrast("#6B4F0E", over("#E7C879", "#F7F0DE", 0.34)) >= 4.5);
  // focus is seen on both: gold on the dark header, deep green on the paper (3:1 for a ring)
  assert.ok(css.includes(".wb .wb-nav a:focus-visible,.wb .wb-nav button:focus-visible{outline-color:#E7C879;}"));
  assert.ok(css.includes(".lb .lb-ticket :focus-visible{outline-color:#0C7A46;}"));
  assert.ok(contrast("#0C7A46", "#F7F0DE") >= 3 && contrast("#E7C879", LIT) >= 3);
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
  assert.ok(css.includes("html .wb{background:") && css.includes("html .wb::before,html .wb::after{display:none;}"));
  assert.ok(css.includes(".wb .wb-main{padding:0;}"));
  // the ticket's ink does not depend on the page's colour
  assert.ok(!/(^|\})html \.wb\{[^}]*[;{]color:/.test(css.replace(/\n/g, "")));
  // on a phone Helpurr stands at the foot of the page, under the ticket, with room kept for it…
  assert.ok(css.includes("@media(max-width:620px){\n  .wb .mm-fab{position:absolute;bottom:calc(14px + env(safe-area-inset-bottom,0px));}\n  .wb .wb-bottom ~ .mm-fab{position:fixed;bottom:calc(97px + env(safe-area-inset-bottom,0px));}\n}"));
  assert.ok(css.includes("@media(max-width:620px){.lb{padding-bottom:calc(86px + env(safe-area-inset-bottom,0px));}}"));
  assert.ok(shell.includes("@media(max-width:620px){.mm-fab{bottom:calc(97px + env(safe-area-inset-bottom,0px));right:16px;width:56px;height:56px}"), "56 tall, 16 from the edge: 86 keeps it clear");
  // …and on a wide screen the ticket keeps 100px from the right edge, where Helpurr floats (66 wide, 20 in)
  assert.ok(css.includes("padding:8px 100px 40px clamp(24px,3vw,56px);"));
  assert.ok(shell.includes(".mm-fab{position:fixed;z-index:10600;bottom:30px;right:20px;width:66px;height:66px;"));
});

test("the ticket: a stub, a perforation, two notches — decoration a screen reader never hears", () => {
  assert.ok(component.includes('<span className="lb-wm" aria-hidden="true" />'));
  assert.ok(component.includes('<div className="lb-stub" aria-hidden="true"><span>{t("Admit one")}</span><span className="lb-bars" /></div>'));
  // the notches sit on the perforation (the stub is 40 tall, its dashed line the last 2: centre 39, an 18px notch from 30)
  assert.ok(/\.lb-stub\{[^}]*height:40px;[^}]*border-bottom:2px dashed /.test(css));
  assert.ok(css.includes(".lb .lb-ticket::before,.lb .lb-ticket::after{content:\"\";position:absolute;z-index:2;top:30px;width:18px;height:18px;border-radius:50%;background:#130E0B;}"), "cut out in the lobby's own colour");
  // the watermark is under the print, and takes no tap
  assert.ok(css.includes(".lb-wm{position:absolute;inset:0;z-index:-1;border-radius:18px;overflow:hidden;pointer-events:none;}"));
  assert.ok(/\.lb \.lb-ticket\{[^}]*isolation:isolate;/.test(css));
  // the ticket comes up once
  assert.ok(css.includes("animation:lbTicketIn .55s cubic-bezier(.2,.7,.2,1) .05s backwards;") && !/lbTicketIn[^;}]*infinite/.test(css));
});

test("every word the lobby shows is in all five languages — and it is said in the page's own", () => {
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  const said = [...component.matchAll(/\bt\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(said)].sort(), ["Admit one", "Just describe it.", "Make a movie.", "Now showing"]);
  for (const k of [...said, ...FILM_HEROES.map((h) => h.name)]) assert.equal(count(dict, `\n  ${JSON.stringify(k)}: `), 5, k);
  // no word is written into the markup untranslated
  const markup = component.slice(component.indexOf("return (\n    <div className=\"lb\">"));
  assert.ok(!/>[^<>{}]*[A-Za-z]{3,}[^<>{}]*</.test(markup.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")), "bare words in the lobby's markup");
  // the lobby speaks the language the door is being read in (its own `lang`), through the app's one dictionary
  assert.ok(component.includes("const L = authLang(lang);") && component.includes("const t = (source: string) => tr(L, source);"));
  // it claims only what the pictures show: the formats' names and the Movie Maker's own line — no numbers, no praise
  assert.ok(!/\d/.test(said.join(" ")));
  const film = read("app", "routes", "web.film.tsx");
  assert.ok(film.includes('<b>{t("Make a movie.")} <em>{t("Just describe it.")}</em></b>') && component.includes('<p className="lb-line">{t("Make a movie.")} <em>{t("Just describe it.")}</em></p>'));
});
