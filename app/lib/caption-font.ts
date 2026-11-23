/* THE FONT FOR CHINESE WORDS — where it comes from, and what counts as having it.
 *
 * Poppins (in the repo) draws Latin text. Chinese and Japanese need Noto Sans SC: 8.5 MB, so it is not
 * in the repo — it is fetched once to the persistent disk the first time it is needed.
 *
 * 2026-11-23, the first Chinese story anyone looked at: every caption was a row of empty boxes. The one
 * address the font was fetched from did not exist (the file is under SubsetOTF/SC, not
 * OTF/SimplifiedChinese — a 404 since the day it was written), every caller but one caught the failure
 * and drew with Poppins anyway, and Poppins has no Chinese glyphs. Nothing failed, nothing was logged
 * where anyone reads, and every Chinese caption in the product — stories, films, ads, image ads — was
 * boxes.
 *
 * So: more than one source (a pinned release first — it cannot be moved from under us), the bytes are
 * checked to BE a font before they are kept, and the rule every caller follows is the one the font
 * resolver has always documented: no font for these words → draw no words. Never boxes.
 *
 * Pure (no network, no disk): tests/caption-font.test.ts holds it. */

/** The file name the font is kept under, in <data>/renders/fonts/. */
export const CJK_FONT_FILE = "NotoSansSC-Bold.otf";

/** Where it is fetched from, tried in order. All three answered with the same 8,543,168-byte OpenType
 *  file on 2026-11-23. */
export const CJK_FONT_SOURCES: readonly string[] = [
  "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Bold.otf",
  "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Bold.otf",
  "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/SC/NotoSansSC-Bold.otf",
];

/** No font with Chinese in it is smaller than this: an error page saved under a font's name is. */
export const CJK_FONT_MIN_BYTES = 1_000_000;

/** Do these first bytes open a font file (OpenType, TrueType or a collection)? */
export function fontMagic(head: ArrayLike<number> | null | undefined): boolean {
  if (!head || head.length < 4) return false;
  const tag = String.fromCharCode(head[0], head[1], head[2], head[3]);
  return tag === "OTTO" || tag === "ttcf" || tag === "true" || (head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0);
}

/** Is this download really the font — big enough to hold Chinese, and a font at all? */
export const looksLikeCjkFont = (bytes: ArrayLike<number> | null | undefined): boolean =>
  !!bytes && bytes.length >= CJK_FONT_MIN_BYTES && fontMagic(bytes);
