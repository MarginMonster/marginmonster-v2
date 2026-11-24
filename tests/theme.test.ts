/* LIGHT BY DEFAULT, DARK BY CHOICE.
 *
 * The owner, 2026-11-24, looking at the dark sign-in lobby on his laptop: "Looks pretty clean, but maybe we
 * do a dark green background instead of the brown" — "or maybe same concept but with the lite theme show
 * both" — "dark mode toggle in setting but keeep it light". Both were built and shown to him side by side,
 * and he chose: "Make dark default, that looks slick as tits". Later the same day, having used it:
 * "Light mode as the default - dark mode as option."
 *
 * So: every room is light unless its member turns the lights down, in the account menu. The choice lives
 * in a cookie the server reads, so the right room is drawn from the first paint — and the switch says
 * which rooms it turns, because not every page has a dark side yet. A browser that already chose keeps its
 * choice whichever way the default is turned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DARK_ROOMS, DEFAULT_THEME, THEME_COOKIE, readThemeCookie, themeCookie, themeOf } from "../app/lib/theme.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("it is light unless it is exactly dark — and a choice already made is never turned over with the default", () => {
  assert.equal(DEFAULT_THEME, "light", "\"Light mode as the default - dark mode as option.\"");
  assert.equal(themeOf("dark"), "dark");
  assert.equal(themeOf(" DARK "), "dark");
  assert.equal(themeOf("light"), "light");
  assert.equal(themeOf(" LIGHT "), "light");
  for (const v of [undefined, null, "", "auto", "darker", "lighter", "night", 0, false, true]) assert.equal(themeOf(v), "light", String(v));
  // BOTH names are read by name: the function must not lean on the default for either of them
  const src = read("app", "lib", "theme.ts");
  assert.ok(src.includes('return s === "dark" ? "dark" : s === "light" ? "light" : DEFAULT_THEME;'));
});

test("the cookie: read from a request, written for a year, for the whole site", () => {
  assert.equal(THEME_COOKIE, "emTheme");
  // a visitor who never chose — every first visit to the sign-in screen — gets the light
  assert.equal(readThemeCookie(null), "light");
  assert.equal(readThemeCookie(""), "light");
  assert.equal(readThemeCookie("emMode=casual"), "light");
  assert.equal(readThemeCookie("emMode=casual; emTheme=dark"), "dark");
  assert.equal(readThemeCookie("emTheme=dark; emMode=marketing"), "dark");
  assert.equal(readThemeCookie("emTheme=light"), "light");
  assert.equal(readThemeCookie("emTheme=purple"), "light", "anything else is the default");
  // another cookie whose name merely ENDS in emTheme is not it
  assert.equal(readThemeCookie("notemTheme=dark"), "light");
  assert.equal(themeCookie("dark", true), "emTheme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
  assert.equal(themeCookie("light", false), "emTheme=light; Path=/; Max-Age=31536000; SameSite=Lax");
  // what is written is what is read back
  for (const t of ["light", "dark"] as const) assert.equal(readThemeCookie(themeCookie(t, true).split(";")[0]), t);
});

test("the shell reads it for every visitor, signed in or not, and hands it down", () => {
  const shell = read("app", "routes", "web.tsx");
  assert.ok(shell.includes('const theme = readThemeCookie(request.headers.get("Cookie"));'));
  // a signed-out visitor (the sign-in screen) gets it too
  assert.ok(shell.includes("if (!id) return json({ authed: false, hud: EMPTY_HUD, isAdmin: false, savedMode, theme, cooking: 0, cookingAt: 0 });"));
  assert.ok(/return json\(\{\n    authed: true,\n    savedMode,\n    theme,/.test(shell));
  const hook = read("app", "lib", "use-theme.ts");
  assert.ok(hook.includes('const shell = useRouteLoaderData("routes/web") as { theme?: unknown } | undefined;'), "from the shell's loader: the server and the browser draw the same room");
  assert.ok(hook.includes("return themeOf(shell?.theme);"));
  // changing it writes the cookie and runs the loaders again — every room turns at once, no reload
  assert.ok(hook.includes('document.cookie = themeCookie(t, location.protocol === "https:");') && hook.includes("rv.revalidate();"));
});

test("the switch is in the account menu, says which way it is, and says what it turns", () => {
  const shell = read("app", "routes", "web.tsx");
  assert.ok(shell.includes('role="switch" aria-checked={theme === "dark"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>'));
  assert.ok(shell.includes('{t("Dark mode")}<small>{t("The sign-in screen and the Movie Maker, lights down.")}</small>'));
  // the rooms it names are the rooms that have a dark side
  assert.deepEqual([...DARK_ROOMS], ["the sign-in screen", "the Movie Maker"]);
  // …and both of them ask the same hook, so both follow the one switch
  assert.ok(read("app", "components", "AuthLobby.tsx").includes('const dark = useTheme() === "dark";'));
  assert.ok(read("app", "routes", "web.film.tsx").includes("const theme = useTheme();"));
  // which way it is, is shown by the knob's place — not by colour alone
  assert.ok(shell.includes(".wb-menu-theme.on .wb-menu-sw::after{transform:translateX(14px);}"));
  assert.ok(shell.includes('[dir="rtl"] .wb-menu-theme.on .wb-menu-sw::after{transform:translateX(-14px);}'));
  // …in all five languages
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Dark mode", "The sign-in screen and the Movie Maker, lights down."]) assert.ok(dict.split(`\n  ${JSON.stringify(k)}:`).length - 1 >= 5, k);
});
