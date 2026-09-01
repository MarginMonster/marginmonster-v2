/* Reusing an empty-stage prompt as a scene the product stands IN.
 *
 * ad-templates.ts documents `plate` as "Prompt for the EMPTY plate (no
 * product, no statue — a clean stage)", and the values say so out loud:
 *
 *   "...completely empty scene with clear open floor space across the lower
 *    third where a product will stand, no objects, no text, photorealistic"
 *
 * The two-image path uses that correctly: render the empty plate, then
 * composite the product onto it. The ONE-image fallback — the path taken when
 * the plate render is unavailable, i.e. the already-degraded path — pasted the
 * same string in front of "Place the product from the provided image into that
 * scene". So the model was told the scene is completely empty and contains no
 * objects, and in the same breath to put an object in it.
 *
 * This strips only the emptiness assertions and keeps everything that makes
 * the backdrop itself: colour, material, lighting, quality. The clause that
 * describes WHERE the product stands is kept deliberately — on this path that
 * is a placement instruction, not a contradiction.
 */

/* The assertion sits at the START of a clause, and the rest of that clause is
 * often the part worth keeping — "completely empty scene WITH CLEAR OPEN FLOOR
 * SPACE ACROSS THE LOWER THIRD WHERE A PRODUCT WILL STAND" is an emptiness
 * claim glued to a placement instruction. So strip the assertion, not the
 * clause, and drop the clause only when nothing is left of it. */
const EMPTINESS =
  /^(completely\s+|entirely\s+|totally\s+)?(empty|bare|unoccupied)\s+(scene|stage|set|frame|room|space)\b\s*(with\s+)?|^no\s+objects?\b\s*|^nothing\s+in\s+(the\s+)?(scene|frame)\b\s*/i;

/**
 * Rewrite an empty-plate prompt for a scene that WILL contain the product.
 * Comma-separated clauses are the unit, matching how these prompts are written.
 */
export function occupiedPlate(plate: string): string {
  const kept: string[] = [];
  for (const raw of String(plate || "").split(",")) {
    const clause = raw.trim();
    if (!clause) continue;
    const rest = clause.replace(EMPTINESS, "").trim();
    if (rest) kept.push(rest);
  }
  return kept.join(", ");
}
