/* UI display language — the language the WEBSITE CHROME renders in: nav,
 * buttons, labels, headings, empty states, toasts, tooltips. DISTINCT from
 * content-lang.ts, which is the language the AI GENERATES content in. The two
 * are deliberately separate controls: a merchant can run the whole interface
 * in Spanish while still writing ads in English — "American merchants
 * advertising to Spanish communities, or vice versa."
 *
 * Source-keyed catalog: the KEY is the English string itself. An
 * un-translated string therefore falls back to readable English automatically,
 * and wrapping a new string needs no key invented for it — you just write
 * t("the English text"). Translations live in ui-i18n-dict.ts (one object per
 * non-English language). Pure data + helpers; client- and server-safe. */

import { UI_DICT } from "./ui-i18n-dict";

export const UI_LANGS = ["en", "es", "fr", "de", "zh", "ur"] as const;
export type UiLang = (typeof UI_LANGS)[number];

/** Native language names for the toggle (what a speaker calls their own
 *  language). Same keys as UI_LANGS. */
export const UI_LANG_NATIVE: Record<UiLang, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  zh: "中文",
  ur: "اردو",
};

/** Right-to-left languages — the UI sets <html dir="rtl"> for these. */
export const RTL_UI_LANGS: ReadonlySet<UiLang> = new Set<UiLang>(["ur"]);
export function uiLangDir(lang: UiLang): "rtl" | "ltr" {
  return RTL_UI_LANGS.has(lang) ? "rtl" : "ltr";
}

/** Narrow anything (cookie value, posted field, Accept-Language) to a language
 *  we actually render. Never throws; falls back to English. */
export function normalizeUiLang(v: string | null | undefined): UiLang {
  const c = String(v ?? "").toLowerCase().slice(0, 2);
  return (UI_LANGS as readonly string[]).includes(c) ? (c as UiLang) : "en";
}

/** Translate a source (English) string into `lang`, substituting {named}
 *  placeholders from params. English — or any key missing from the dictionary
 *  — returns the source unchanged, so the UI is ALWAYS readable, never blank
 *  and never a raw key. */
export function tr(
  lang: UiLang,
  source: string,
  params?: Record<string, string | number>,
): string {
  let out = source;
  if (lang !== "en") {
    const dict = UI_DICT[lang];
    const hit = dict ? dict[source] : undefined;
    if (hit) out = hit;
  }
  if (params) {
    for (const k of Object.keys(params)) {
      out = out.split("{" + k + "}").join(String(params[k]));
    }
  }
  return out;
}

/** Cookie that carries the chosen UI language site-wide. */
export const UI_LANG_COOKIE = "uiLang";

/** Read the chosen UI language from the request's cookies. Never throws. */
export function readUiLang(request: Request): UiLang {
  const raw = request.headers.get("Cookie") || "";
  const m = raw.match(/(?:^|;\s*)uiLang=([^;]+)/);
  return normalizeUiLang(m ? decodeURIComponent(m[1]) : null);
}

/** Set-Cookie value that persists the choice for a year, across the whole
 *  site. Lax so it rides top-level navigations; not HttpOnly on purpose — the
 *  landing page reads it client-side to seed its own copy swap. */
export function uiLangCookie(lang: UiLang): string {
  return `${UI_LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
