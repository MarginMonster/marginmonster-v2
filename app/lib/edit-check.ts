/* AN EDIT THE MODEL DID NOT MAKE IS NOT CHARGED.
 *
 * A photo edit is one paid ask of a picture model: "make the shirt a purple hoodie". Now and then the
 * model hands the photo back unchanged — it declines quietly, no error — and the customer has paid for
 * their own picture (the owner's "Make him a demon", 2026-11-18: it came back essentially the same and
 * cost 5 tokens). Rival tools' customers name this more than almost anything: credits spent on a result
 * that is not what was asked for, and nobody to give them back.
 *
 * Counting pixels cannot tell: the model's "unchanged" copy differed from its source MORE than a real
 * eye-colour edit did (mean difference 7.8 against 2.2, measured). So the result is LOOKED AT: original
 * and result, and the request, to a vision reader that writes down what differs before it answers.
 *   · not made → the edit is asked for once more, more plainly;
 *   · still not made → the result is kept and shown (it is what the model gave), marked `declined`, and
 *     the job gives the tokens back (job-queue.server.ts);
 *   · a look that fails or cannot be read changes nothing: the edit stands, charged, as before.
 */
import { firstJson } from "./first-json.ts";

/** The question. Image 1 = the original, image 2 = the result. */
export function editCheckPrompt(request: string): string {
  const ask = (request || "").replace(/\s+/g, " ").trim().slice(0, 300);
  return `Image 1 is a photo. Image 2 is what came back after this edit was requested: "${ask}". First write down, in a few words, every visible difference between image 1 and image 2 (or "none"). Then say whether the requested change was MADE. Made fully or partly counts as made, and so does a change that is not exactly what was asked but is clearly an attempt at it. It was NOT made only if image 2 is the same picture as image 1 — identical, or differing only in rendering details such as sharpness, a slight colour shift, compression or a small crop. Reply with ONLY this JSON: {"differences": "…", "made": true or false}.`;
}

export type EditCheck = { made: boolean; differences: string };
/** The answer — null when it cannot be read (the caller then changes nothing). */
export function parseEditCheck(raw: string): EditCheck | null {
  const j = firstJson(raw);
  if (!j || typeof j.made !== "boolean") return null;
  return { made: j.made, differences: typeof j.differences === "string" ? j.differences.replace(/\s+/g, " ").trim().slice(0, 200) : "" };
}

/** How the second ask begins — the same request, said so it cannot be read as "leave it". */
export const EDIT_RETRY_LEAD = "Apply this change clearly and visibly — the result must look different from the original exactly where the change is asked for: ";

/** WHAT A PAGE SAYS about a finished edit, read off the piece's own metaJson: was it made, and how many
 *  tokens came back. Until 2026-11-22 the refund was silent — the picture came back as it went in and
 *  nothing on the page said why, or that it had cost nothing: it read as "it charged me and did nothing".
 *  `returned` is absent while the refund has not been noted yet (it is written a moment after the piece
 *  is saved) and for a make that was free. */
export function editNote(metaJson: string | null | undefined): { notMade?: boolean; returned?: number } {
  try {
    const m = JSON.parse(metaJson || "{}") as { declined?: unknown; tokensReturned?: unknown };
    if (!m || m.declined !== true) return {};
    const n = typeof m.tokensReturned === "number" && Number.isFinite(m.tokensReturned) && m.tokensReturned > 0 ? Math.round(m.tokensReturned) : 0;
    return n ? { notMade: true, returned: n } : { notMade: true };
  } catch { return {}; }
}

/** Which photo edits are a free-text ask that a model can quietly decline. (Background removal, upscaling
 *  and colourising are mechanical: there is nothing to decline.) */
export const canBeDeclined = (editOp: string): boolean => editOp === "describe" || editOp === "replace" || editOp === "restyle" || editOp === "cartoonize";
