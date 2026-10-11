/* The UI-language React context + the useT() hook every component reaches for.
 *
 * The active language is resolved ONCE on the server (root loader reads the
 * uiLang cookie) and handed to <UiLangProvider> so SSR renders the chosen
 * language directly — no English-then-swap flash. useT() reads that context,
 * so any component, however deep, can translate without threading a prop. */

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { tr, type UiLang } from "./ui-i18n";

const UiLangContext = createContext<UiLang>("en");

export function UiLangProvider({ lang, children }: { lang: UiLang; children: ReactNode }) {
  return <UiLangContext.Provider value={lang}>{children}</UiLangContext.Provider>;
}

/** The active UI language, e.g. for the toggle's current value or <html lang>. */
export function useUiLang(): UiLang {
  return useContext(UiLangContext);
}

/** t("English text", {named}) → the string in the active language, with any
 *  {named} placeholders substituted. Stable per language (memoized). */
export function useT(): (source: string, params?: Record<string, string | number>) => string {
  const lang = useUiLang();
  return useMemo(
    () => (source: string, params?: Record<string, string | number>) => tr(lang, source, params),
    [lang],
  );
}
