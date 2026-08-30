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

import { anthropicText, anthropicVision } from "./anthropic.server";
import { explicitCm } from "./product-scale.ts";
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
        `What are the PHYSICAL DIMENSIONS of this product?`,
        `Title: "${productTitle.slice(0, 180)}"`,
        productDescription ? `Description: ${productDescription.slice(0, 300)}` : "",
        ``,
        `If you RECOGNISE this product or its product line, use the real published`,
        `dimensions — most retail packaging is standardised and publicly`,
        `documented. A Pokémon TCG booster box is about 13 x 7 x 20 cm; a Funko`,
        `Pop box is about 9 x 9 x 16 cm. Prefer a known spec over a guess.`,
        ``,
        `Quantity words decide WHAT you are measuring: "CASE X12" or "20 Booster`,
        `Boxes" is a shipping case holding that many units, which is much larger`,
        `than one unit. "6 Blind Box dolls" is a retail display box. "8 per set"`,
        `is a small set box.`,
        ``,
        `Return ONLY JSON: {"cm": <number>, "known": <true|false>} — cm is the`,
        `LONGEST dimension in centimetres of the thing a customer receives, and`,
        `known is true only if you are recalling a real spec rather than`,
        `estimating. Rough anchors if you must estimate: a booster pack ~10, a`,
        `booster box ~20, a 12-box case ~40, a blind-box display ~25, a mug ~12,`,
        `a folded t-shirt ~30, a skateboard ~80, an office chair ~110.`,
      ].filter(Boolean).join("\n"),
      { model: "claude-sonnet-5", maxTokens: 80 }
    );
    const m = raw && raw.match(/\{[\s\S]*?\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as { cm?: unknown; known?: unknown };
    const cm = typeof j.cm === "number" ? j.cm : parseFloat(String(j.cm));
    if (!Number.isFinite(cm) || cm < 2 || cm > 400) return null;
    const rounded = Math.round(cm);
    if (j.known === true) console.log(`[scale:text] recognised "${productTitle.slice(0, 50)}" → ${rounded}cm from a known spec`);
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

/** Size what is ACTUALLY PICTURED, which is not always what the SKU contains.
 *
 *  This is the failure the title-only path cannot see. A listing reading
 *  "CASE (20Box) … Booster Boxes" is a ~40cm shipping case, and the inference
 *  correctly says so — but the merchant's photo shows ONE booster box, because
 *  that is the appealing shot. Compose then scales single-box artwork to case
 *  dimensions and out comes a booster box the size of a microwave, which is
 *  exactly what a merchant reported.
 *
 *  Looking the dimensions up externally cannot fix this: an external source
 *  would also say a 20-box case is ~40cm, and we would render the same giant
 *  box. The only thing that resolves it is looking at the photo. */
export async function scaleFromPhoto(
  imageUrl: string,
  productTitle: string
): Promise<ScaleHint | null> {
  if (!imageUrl) return null;
  try {
    const raw = await anthropicVision(
      [
        `This is a product photo from a shop listing titled: "${productTitle.slice(0, 180)}".`,
        ``,
        `Size WHAT YOU CAN SEE IN THE PHOTO, not what the listing says the order`,
        `contains. These often differ: a listing for a 20-box case is usually`,
        `photographed as a single box, and a multipack is usually photographed as`,
        `one unit. If the photo shows one unit, size that ONE unit.`,
        ``,
        `Return ONLY JSON: {"cm": <number>, "units": <number>, "what": "<3 words>"}`,
        `where cm is the longest dimension of the object as pictured. For`,
        `reference: a trading-card booster pack is ~10, a single booster box ~14,`,
        `a 12-box case ~40, a mug ~12, a folded t-shirt ~30, a skateboard ~80.`,
      ].join("\n"),
      [imageUrl],
      { model: "claude-haiku-4-5-20251001", maxTokens: 90 }
    );
    const m = raw && raw.match(/\{[\s\S]*?\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as { cm?: unknown; units?: unknown; what?: unknown };
    const cm = typeof j.cm === "number" ? j.cm : parseFloat(String(j.cm));
    if (!Number.isFinite(cm) || cm < 2 || cm > 400) return null;
    const rounded = Math.round(cm);
    console.log(`[scale:photo] "${String(j.what || "").slice(0, 40)}" ×${j.units ?? "?"} → ${rounded}cm`);
    return { sizeClass: classifySize(rounded), cm: rounded, phrase: scalePhrase(rounded) };
  } catch {
    return null; // no hint → the title path stands, i.e. today's behaviour
  }
}

/** The whole ladder, in order of how much each source actually knows.
 *
 *  1. The merchant's own choice — they have held the thing.
 *  2. The PHOTO, when there is one. It is the only source that knows what the
 *     composite is going to depict.
 *  3. The title/description. Right about the SKU, blind to the photo.
 *
 *  A photo and a title that disagree by more than 2x is the case-vs-unit
 *  mismatch above, so it gets logged: that disagreement is the single best
 *  signal we have that a listing's photo undersells what is being sold, and
 *  it is worth surfacing to merchants later.
 *
 *  SCALE_VISION=0 drops step 2 and restores the title-only behaviour. */
export async function resolveProductScale(opts: {
  productTitle: string;
  productDescription?: string;
  productImageUrl?: string;
  productSize?: string | null;
}): Promise<ScaleHint | null> {
  const chosen = scaleFromChoice(opts.productSize);
  if (chosen) return chosen;

  const [fromPhoto, fromText] = await Promise.all([
    opts.productImageUrl && process.env.SCALE_VISION !== "0"
      ? scaleFromPhoto(opts.productImageUrl, opts.productTitle)
      : Promise.resolve(null),
    inferProductScale(opts.productTitle, opts.productDescription),
  ]);

  if (fromPhoto && fromText) {
    const ratio = Math.max(fromPhoto.cm, fromText.cm) / Math.min(fromPhoto.cm, fromText.cm);
    if (ratio >= 2) {
      console.log(`[scale] photo says ${fromPhoto.cm}cm, listing says ${fromText.cm}cm for "${opts.productTitle.slice(0, 60)}" — trusting the photo, since that is what gets composed`);
    }
  }
  return fromPhoto || fromText;
}
