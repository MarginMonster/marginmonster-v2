/* The theme, for a component: which one this visitor has (the shell's loader read it from their cookie),
 * and how to change it. See theme.ts for why it is light unless chosen otherwise. */

import { useRevalidator, useRouteLoaderData } from "@remix-run/react";
import { themeCookie, themeOf, type Theme } from "./theme";

/** "light" unless this browser chose the dark. The same on the server and in the browser (it comes from the
 *  shell's loader — routes/web — so nothing flashes on arrival). */
export function useTheme(): Theme {
  const shell = useRouteLoaderData("routes/web") as { theme?: unknown } | undefined;
  return themeOf(shell?.theme);
}

/** Change it: the cookie is written here and the loaders run again, so every room that has a dark side
 *  turns at once, without a reload. */
export function useSetTheme(): (t: Theme) => void {
  const rv = useRevalidator();
  return (t) => {
    try { document.cookie = themeCookie(t, location.protocol === "https:"); } catch { /* a nicety */ }
    rv.revalidate();
  };
}
