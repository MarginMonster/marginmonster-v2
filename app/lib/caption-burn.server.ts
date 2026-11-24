/* HOW A FILM'S CAPTION CARDS BECOME ffmpeg FILTERS — one place for the two ways they are drawn.
 *
 * Bold and Subtitles are drawtext filters (narrated-core → captionFilters). Highlight lights the word
 * being said, which drawtext cannot do (one string, one colour): it is an .ass file handed to the
 * subtitle renderer (narrated-core → highlightAss).
 *
 * `styled` is the look that was asked for when it needs that file; `plain` is always there and is what
 * the same cards look like drawn by drawtext (Highlight's plain look is Bold). A caller tries `styled`
 * first and falls back to `plain` — a renderer that cannot read the file or find the font must never
 * cost a film its captions. `cleanup()` removes the file.
 *
 * HINDI AND URDU are the exception (content-lang.ts → needsShaping): drawtext cannot shape them, so EVERY
 * look is a file for the subtitle renderer (narrated-core → shapedAss), `plain` included — and with no face
 * here for the words, no words at all, never broken ones. A caller's ladder stays as it is: the look asked
 * for, the plain look, then the film without captions. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { captionFilters, hasWide, highlightAss, shapedAss, type CaptionStyle, type Card } from "./narrated-core";
import { needsShaping } from "./content-lang";
import { shapedFaceFor } from "./caption-font";

/** A path as it is written inside a filter: forward slashes, and the colon of a drive letter escaped. */
const inFilter = (p: string): string => p.replace(/\\/g, "/").replace(/:/g, "\\:");

/** The family name the subtitle renderer looks a font file up by. */
export const fontFamilyOf = (fontFile: string): string => (/NotoSansSC/i.test(path.basename(fontFile)) ? "Noto Sans SC" : /NotoNastaliqUrdu/i.test(path.basename(fontFile)) ? "Noto Nastaliq Urdu" : "Poppins");

export function captionGraph(cards: Card[], style: CaptionStyle, fontFile: string, W: number, H: number): { styled: string[] | null; plain: string[]; cleanup: () => void } {
  if (style !== "off" && cards.some((c) => needsShaping(c.text))) return shapedGraph(cards, style, fontFile, W, H);
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

/** Hindi / Urdu cards: Bold or Subtitles as `plain` (and Bold under Highlight), Highlight as `styled` —
 *  all drawn by the subtitle renderer from the face that has the script, found in the folder of the font
 *  the caller resolved (ugc-ad-pipeline.server.ts → resolveCaptionFont: public/fonts). No face, no font
 *  file there, or no file written: no words. */
function shapedGraph(cards: Card[], style: CaptionStyle, fontFile: string, W: number, H: number): { styled: string[] | null; plain: string[]; cleanup: () => void } {
  const files: string[] = [];
  const cleanup = () => { for (const f of files) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* best effort */ } } };
  const face = shapedFaceFor(cards.map((c) => c.text).join(" "));
  const fontsDir = path.dirname(fontFile);
  if (!face || !fs.existsSync(path.join(fontsDir, face.file))) {
    console.error(`[captions] no face here draws these words (${face ? `${face.file} is not in ${fontsDir}` : "a script with no face"}) — no captions`);
    return { styled: null, plain: [], cleanup };
  }
  const filterFor = (ass: string): string[] => {
    if (!ass) return [];
    const dir = path.join(process.cwd(), "data", "renders");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `cap-${Date.now()}-${crypto.randomBytes(5).toString("hex")}.ass`);
    fs.writeFileSync(file, ass, "utf8");
    files.push(file);
    return [`ass=filename='${inFilter(file)}':fontsdir='${inFilter(fontsDir)}'`];
  };
  try {
    const plain = filterFor(shapedAss(cards, style === "subtitles" ? "subtitles" : "bold", face, W, H));
    const styled = style === "highlight" && plain.length ? filterFor(shapedAss(cards, "highlight", face, W, H)) : [];
    return { styled: styled.length ? styled : null, plain, cleanup };
  } catch (e) {
    console.error(`[captions] the caption file could not be written — no captions: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
    cleanup();
    return { styled: null, plain: [], cleanup };
  }
}
