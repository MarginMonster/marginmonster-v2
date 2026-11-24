/* LIGHT BY DEFAULT, DARK BY CHOICE.
 *
 * The sign-in screen became a cinema lobby in the dark (components/AuthLobby.tsx). The owner, looking at it
 * on his laptop, 2026-11-24: "Looks pretty clean, but maybe we do a dark green background instead of the
 * brown" — then: "or maybe same concept but with the lite theme show both" — then: "dark mode toggle in
 * setting but keeep it light". Both were built and photographed side by side, and on seeing them he chose:
 * "Make dark default, that looks slick as tits". After a morning of using the app that way, the same day,
 * he turned it back: "Light mode as the default - dark mode as option."
 *
 * So every room is LIGHT unless its member turns the lights down, with the switch in the account menu. The
 * choice is kept in a cookie (as the Creator / Ad Maker choice is), so the server draws the right room from
 * the first paint — no flash of the other one — and the sign-in screen of a browser that chose the dark is
 * dark the next time too. A browser that already chose, either way, keeps its choice: only the ones that
 * never touched the switch change.
 *
 * Plain logic (tests/theme.test.ts); the hook that reads and sets it is use-theme.ts. */

export type Theme = "light" | "dark";
export const THEME_COOKIE = "emTheme";
/** What a visitor who never chose gets. */
export const DEFAULT_THEME: Theme = "light";

/** Exactly "dark" is the dark theme and exactly "light" the light one; anything else is the default. (It
 *  names BOTH, so that turning the default over can never turn somebody's own choice over with it.) */
export const themeOf = (v: unknown): Theme => {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "dark" ? "dark" : s === "light" ? "light" : DEFAULT_THEME;
};

/** The theme a request asks for, from its Cookie header. */
export function readThemeCookie(cookie: string | null | undefined): Theme {
  const m = /(?:^|;\s*)emTheme=([a-z]+)(?:;|$)/i.exec(cookie || "");
  return themeOf(m?.[1]);
}

/** The cookie that keeps it: a year, the whole site, sent on ordinary navigations. */
export const themeCookie = (t: Theme, secure: boolean): string =>
  `${THEME_COOKIE}=${themeOf(t)}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;

/** WHAT THE DARK COVERS TODAY, in the menu's own words — the switch promises no more than it does. A page
 *  not named here looks the same either way (and says nothing about it). */
export const DARK_ROOMS = ["the sign-in screen", "the Movie Maker"] as const;
