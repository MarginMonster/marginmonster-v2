/* HOW A FILM'S CAPTION CARDS BECOME ffmpeg FILTERS — one place for the two ways they are drawn.
 *
 * Bold and Subtitles are drawtext filters (narrated-core → captionFilters). Highlight lights the word
 * being said, which drawtext cannot do (one string, one colour): it is an .ass file handed to the
 * subtitle renderer (narrated-core → highlightAss).
 *
 * `styled` is the look that was asked for when it needs that file; `plain` is always there and is what
 * the same cards look like drawn by drawtext (Highlight's plain look is Bold). A caller tries `styled`
 * first and falls back to `plain` — a renderer that cannot read the file or find the font must never
 * cost a film its captions. `cleanup()` removes the file. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { captionFilters, hasWide, highlightAss, type CaptionStyle, type Card } from "./narrated-core";

/** A path as it is written inside a filter: forward slashes, and the colon of a drive letter escaped. */
const inFilter = (p: string): string => p.replace(/\\/g, "/").replace(/:/g, "\\:");

/** The family name the subtitle renderer looks a font file up by. */
export const fontFamilyOf = (fontFile: string): string => (/NotoSansSC/i.test(path.basename(fontFile)) ? "Noto Sans SC" : "Poppins");

export function captionGraph(cards: Card[], style: CaptionStyle, fontFile: string, W: number, H: number): { styled: string[] | null; plain: string[]; cleanup: () => void } {
  const plain = captionFilters(cards, style, fontFile, W, H);
  let file = "";
  let styled: string[] | null = null;
  // (a script without spaces is drawn plain for now: the renderer's size for that font is not measured)
  if (style === "highlight" && plain.length && !cards.some((c) => hasWide(c.text))) {
    try {
      const ass = highlightAss(cards, fontFamilyOf(fontFile), W, H);
      if (ass) {
        const dir = path.join(process.cwd(), "data", "renders");
        fs.mkdirSync(dir, { recursive: true });
        file = path.join(dir, `cap-${Date.now()}-${crypto.randomBytes(5).toString("hex")}.ass`);
        fs.writeFileSync(file, ass, "utf8");
        styled = [`ass=filename='${inFilter(file)}':fontsdir='${inFilter(path.dirname(fontFile))}'`];
      }
    } catch (e) {
      console.error(`[captions] the highlight file could not be written — drawn as Bold: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
      styled = null;
    }
  }
  return { styled, plain, cleanup: () => { try { if (file && fs.existsSync(file)) fs.unlinkSync(file); } catch { /* best effort */ } } };
}
