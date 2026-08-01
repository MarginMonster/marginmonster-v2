/* How BIG is this thing, really?
 *
 * A presenter-holding shot is composed from a product photo on a white
 * background, and a cutout carries no scale — so the image model guesses, and
 * guesses inconsistently: a 12-box case comes out palm-sized, a single blind
 * box comes out the size of a television. "Keep it at its true real-world
 * size" is an instruction the model has no way to follow.
 *
 * It doesn't have to guess. Merchant titles are full of scale: "CASE X12",
 * "20 Booster Boxes", "6 Blind Box dolls", "8 per set", "500ml", "30cm". This
 * turns that into a concrete physical brief the composer CAN follow — a width
 * in centimetres and a human comparison ("about shoulder-width, needs both
 * hands"), which is the language these models actually respond to.
 *
 * Free path first (explicit dimensions in the text), then one cheap Claude
 * call, then nothing — a missing hint just restores today's behaviour. */

import { anthropicText } from "./anthropic.server";
import { classifySize, SIZE_CHOICES, type SizeClass } from "./product-scale";

export { SIZE_CHOICES, type SizeClass };

export interface ScaleHint {
  sizeClass: SizeClass;
  /** Longest dimension, centimetres. */
  cm: number;
  /** Ready-to-paste sentence for an image prompt. */
  phrase: string;
}

/** The sentence the image models respond to: a number AND a body comparison.
 *  "True real-world size" is unfollowable; "about as wide as their shoulders,
 *  held with both hands" is not. */
export function scalePhrase(cm: number): string {
  const c = classifySize(cm);
  if (c === "palm") {
    return `SCALE: this product is small — roughly ${cm}cm at its longest, about the length of a hand. It sits comfortably in ONE hand and must NOT be enlarged to fill the frame; it should look small against the presenter's body.`;
  }
  if (c === "two-hand") {
    return `SCALE: this product is roughly ${cm}cm at its longest — about the width of the presenter's chest, too big for one hand. It is held with BOTH hands, and clearly spans a good part of their torso.`;
  }
  if (c === "large") {
    return `SCALE: this product is large — roughly ${cm}cm at its longest, about shoulder-width or bigger. It is held with both hands and reaches from about the presenter's waist to their chin, or rests on a surface beside them.`;
  }
  return `SCALE: this product is BIG — roughly ${cm}cm at its longest, comparable to the presenter's own height. It stands on the floor beside them or is held upright with both hands, and may extend past the top or bottom of the frame. It must NEVER be shrunk into a hand-held object.`;
}

/** Dimensions stated outright in the text — free, exact, no model call.
 *  Handles cm / mm / m and inches, taking the LARGEST number found. */
function explicitCm(text: string): number | null {
  let best = 0;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(cm|mm|m|in|inch|inches|")\b/gi)) {
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) continue;
    const unit = m[2].toLowerCase();
    const cm = unit === "mm" ? n / 10 : unit === "m" ? n * 100 : unit === "cm" ? n : n * 2.54;
    // Ignore absurd readings — "2026" in a title isn't a measurement, and a
    // 0.2cm product isn't real.
    if (cm >= 2 && cm <= 400) best = Math.max(best, cm);
  }
  return best || null;
}

/** Best guess at a product's physical size. Never throws — callers treat null
 *  as "no hint", which is exactly today's behaviour. */
export async function inferProductScale(
  productTitle: string,
  productDescription?: string
): Promise<ScaleHint | null> {
  const text = `${productTitle || ""} ${productDescription || ""}`.trim();
  if (!text) return null;

  const stated = explicitCm(text);
  if (stated) {
    return { sizeClass: classifySize(stated), cm: Math.round(stated), phrase: scalePhrase(Math.round(stated)) };
  }

  try {
    const raw = await anthropicText(
      [
        `Estimate the PHYSICAL SIZE of this product from its listing title.`,
        `Title: "${productTitle.slice(0, 180)}"`,
        productDescription ? `Description: ${productDescription.slice(0, 300)}` : "",
        ``,
        `Quantity words are the strongest clue: "CASE X12" or "20 Booster Boxes"`,
        `means a shipping case holding that many units, which is large. "6 Blind`,
        `Box dolls" is a retail display box. "8 per set" is a small set box.`,
        ``,
        `Return ONLY JSON: {"cm": <number>} — the LONGEST dimension in`,
        `centimetres of the thing a customer receives. Be realistic: a single`,
        `trading-card booster pack is ~10, a booster box ~14, a 12-box case ~40,`,
        `a blind-box display case ~25, a mug ~12, a t-shirt folded ~30, a`,
        `skateboard ~80, an office chair ~110.`,
      ].filter(Boolean).join("\n"),
      { model: "claude-sonnet-5", maxTokens: 60 }
    );
    const m = raw && raw.match(/\{[\s\S]*?\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as { cm?: unknown };
    const cm = typeof j.cm === "number" ? j.cm : parseFloat(String(j.cm));
    if (!Number.isFinite(cm) || cm < 2 || cm > 400) return null;
    const rounded = Math.round(cm);
    return { sizeClass: classifySize(rounded), cm: rounded, phrase: scalePhrase(rounded) };
  } catch {
    return null;
  }
}

/** A merchant's explicit choice always beats inference — they've held it. */
export function scaleFromChoice(key: string | undefined | null): ScaleHint | null {
  const c = SIZE_CHOICES.find((s) => s.key === key);
  return c ? { sizeClass: c.key, cm: c.cm, phrase: scalePhrase(c.cm) } : null;
}
