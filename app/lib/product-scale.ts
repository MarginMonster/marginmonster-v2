/* Size classes, shared by the server (which builds the prompt brief) and the
 * Studio (which renders the picker). Kept OUT of product-scale.server.ts on
 * purpose: Remix strips .server modules from the client bundle, so a component
 * importing them fails the build. */

export type SizeClass = "palm" | "two-hand" | "large" | "floor";

/** Merchant-facing options, smallest first — the order they appear in the
 *  picker. `cm` is the representative longest dimension each class implies. */
export const SIZE_CHOICES: { key: SizeClass; label: string; cm: number }[] = [
  { key: "palm", label: "Fits in a palm", cm: 12 },
  { key: "two-hand", label: "Two hands", cm: 35 },
  { key: "large", label: "Large — chest-sized", cm: 60 },
  { key: "floor", label: "Floor-standing", cm: 120 },
];

export function classifySize(cm: number): SizeClass {
  if (cm <= 18) return "palm";
  if (cm <= 45) return "two-hand";
  if (cm <= 90) return "large";
  return "floor";
}

/** Dimensions stated outright in the text — free, exact, no model call.
 *  Handles cm / mm / m and inches, taking the LARGEST number found.
 *
 *  "in" IS NOT A UNIT UNLESS IT LOOKS LIKE ONE. The first version put a bare
 *  `in` in the alternation, so the commonest phrases in ecommerce copy parsed
 *  as measurements:
 *
 *    "3 IN 1 shampoo"   ->  3 inches   ->  7.6cm
 *    "12 in stock"      ->  12 inches  ->  30.5cm
 *
 *  and that number went straight into the SCALE line of a paid image prompt,
 *  telling the composer to draw a shampoo bottle the width of someone's hand or
 *  a ring the size of a dinner plate. A wrong size brief is worse than none: the
 *  no-hint path simply says nothing, while this actively misdirects the render.
 *
 *  So `in` is honoured only where a dimension would actually sit — at the end,
 *  before punctuation, or before an `x`/`by` in a dimension triple. Anything
 *  followed by another number or an ordinary word is not a measurement. */
const UNIT_RE = /(\d+(?:\.\d+)?)\s*(cm|mm|m|inch|inches|in|")(?![a-z])/gi;

/** What may legitimately follow a bare "in" that really means inches. */
const AFTER_IN_OK = /^(?:\s*$|[\s]*[,.;:)\]\/]|\s*(?:x|×|by)\b)/i;

export function explicitCm(text: string): number | null {
  let best = 0;
  for (const m of (text || "").matchAll(UNIT_RE)) {
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) continue;
    const unit = m[2].toLowerCase();

    if (unit === "in") {
      const after = (text || "").slice(m.index + m[0].length);
      if (!AFTER_IN_OK.test(after)) continue; // "3 in 1", "12 in stock", …
    }

    const cm = unit === "mm" ? n / 10 : unit === "m" ? n * 100 : unit === "cm" ? n : n * 2.54;
    // Ignore absurd readings — "2026" in a title isn't a measurement, and a
    // 0.2cm product isn't real.
    if (cm >= 2 && cm <= 400) best = Math.max(best, cm);
  }
  return best || null;
}
