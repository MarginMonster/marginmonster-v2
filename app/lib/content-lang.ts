/* Content language — the language the AI GENERATES in (scripts, captions,
 * lyrics, articles, ad copy). Stored per shop (Shop.contentLang):
 *   · web accounts: seeded from the landing-page language at signup,
 *     changeable on the dashboard
 *   · Shopify merchants: auto-detected once from the store's primary locale
 * "en" / null = English. Pure data + string helpers; client-safe. */

export const CONTENT_LANGS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  zh: "Simplified Chinese",
};

export function normalizeContentLang(v: string | null | undefined): string {
  if (!v) return "en";
  const code = v.toLowerCase().slice(0, 2);
  return CONTENT_LANGS[code] ? code : "en";
}

/** Instruction line appended to every text-generation prompt. Empty for
 *  English so existing prompts stay byte-identical. */
export function langDirective(code: string | null | undefined): string {
  const c = normalizeContentLang(code);
  if (c === "en") return "";
  return ` IMPORTANT: Write ALL output in ${CONTENT_LANGS[c]} — every sentence, headline and line. Keep the brand and product names exactly as given (do not translate them).`;
}

/** True when the text needs a CJK-capable font for ffmpeg drawtext. */
export function hasCJK(s: string): boolean {
  return /[\u3000-\u9FFF\uF900-\uFAFF\u3040-\u30FF]/.test(s);
}
