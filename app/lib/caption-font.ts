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

/* THE FONTS FOR WORDS THAT ARE SHAPED — Hindi and Urdu (content-lang.ts → needsShaping). They are drawn by
 * the subtitle renderer (libass, which shapes them), never by drawtext, from fonts SHIPPED in public/fonts:
 * they are small, so — unlike the Chinese one — nothing is fetched and nothing can fail to arrive.
 *   Devanagari  Poppins-Bold.ttf, the caption font itself: it has Devanagari, conjuncts and all (drawn and
 *               looked at, 2026-11-24: क्षेत्र धर्म विद्यालय स्त्री क्रिकेट शुद्ध कार्य — every one right)
 *   Urdu        NotoNastaliqUrdu-Bold.ttf (Google's Noto, SIL Open Font License; the "full" build from
 *               notofonts.github.io, 296,168 bytes — it has Latin too, so a brand name in an Urdu line is
 *               drawn in the same face). Nastaliq is how Urdu is written and read in Pakistan; Naskh reads
 *               as Arabic.
 * `box` / `top` / `bottom`: the font's own OS/2 "win" box in ems, as font-metrics.ts reads it (a test holds
 * them to the files) — the renderer sizes a font by that box, not by its em, and stands a line on its foot.
 * The rest is the look, measured on rendered frames (scratchpad langs/measure-glyph.mjs): */
export type ShapedFace = {
  family: string;
  file: string;
  box: number; top: number; bottom: number;
  /** the em it is drawn at ÷ the em of the Latin card in the same place (Nastaliq's letters sit small in their em) */
  scale: number;
  /** the widest one counted letter (narrated-core → textWidth) was measured to draw, in ems, with room to
   *  spare: Hindi in Poppins 0.48–0.58 (Latin capitals 0.59), Urdu in Nastaliq 0.38–0.47 */
  glyph: number;
  /** from one subtitle line's baseline to the next, in ems (Nastaliq's words are 2–2.5 ems tall) */
  lineGap: number;
  /** subtitles on a dark box like the Latin ones — or outlined, with a shadow: the renderer boxes every
   *  letter, and Nastaliq's tall sloping words make that a ragged ladder (looked at) */
  boxed: boolean;
};
export const SHAPED_FACES: Readonly<Record<"deva" | "urdu", ShapedFace>> = {
  deva: { family: "Poppins", file: "Poppins-Bold.ttf", box: 1.762, top: 1.135, bottom: 0.627, scale: 1, glyph: 0.62, lineGap: 1.85, boxed: true },
  urdu: { family: "Noto Nastaliq Urdu", file: "NotoNastaliqUrdu-Bold.ttf", box: 3.286, top: 1.904, bottom: 1.382, scale: 1.15, glyph: 0.5, lineGap: 2.5, boxed: false },
};
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const DEVANAGARI = /[ऀ-ॿ꣠-ꣿ]/;
/** The face that draws these words — Urdu (any Arabic-script word) in Nastaliq, Hindi in Poppins — or null
 *  when neither does (another shaped script: no words, never boxes). */
export function shapedFaceFor(text: string): ShapedFace | null {
  if (ARABIC_SCRIPT.test(text)) return SHAPED_FACES.urdu;
  if (DEVANAGARI.test(text)) return SHAPED_FACES.deva;
  return null;
}
