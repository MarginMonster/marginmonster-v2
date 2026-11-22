/* A FILM'S INVENTED CAST LOOKS THE SAME IN EVERY SCENE — the cast sheet has to show the CAST.
 *
 * The story engine keeps a film's invented characters consistent with one "cast sheet": a group portrait
 * drawn first, then every scene drawn FROM it. On a Kids Music Video made as a customer (2026-11-22) the
 * three ducks of the script were a white duck and two ducklings in one scene, three yellow chicks in the
 * next, and a duckling, a PINK CAT and a duck in glasses in the last.
 *
 * Cause, reproduced on the real picture model: the sheet's prompt was "<safety> <style>. A group portrait
 * of the recurring cast… The cast: <the characters>" and the picture call cuts a prompt at 500 characters.
 * The kids format's style text alone is 212 — so the characters were cut off before the model ever read
 * them, and it drew a cast of its own (a bear, a sun, a caterpillar, an elephant). Every scene was then
 * drawn "from" a sheet of strangers, with its own cast notes cut off the same way.
 *
 * So: the CAST comes first in the sheet's prompt and the style after it; the prompt is given room; and a
 * scene drawn from the sheet is TOLD that the sheet is its cast (measured: with a right sheet the scenes
 * hold all three characters, design for design).
 */

/** Room for these prompts (the picture model reads far more than the old 500-character cut). */
export const SHEET_PROMPT_MAX = 1200;
export const SCENE_PROMPT_MAX = 1000;

const tidy = (s: string, max: number): string => (s || "").replace(/\s+/g, " ").trim().slice(0, max);

/** The cast sheet: WHO first — every character, in the writer's own words — then how it is drawn. */
export function castSheetPrompt(o: { safe?: string; cast: string[]; style: string }): string {
  const names = (o.cast || []).map((c) => tidy(c, 400)).filter(Boolean).slice(0, 6);
  const style = tidy(o.style, 260);
  const frame = (cast: string) => `${o.safe || ""}A group portrait of this film's cast standing side by side — full body, each one clearly separate, clear consistent faces, plain neutral background. The cast, exactly these and nobody else: ${cast}. Drawn IN THE EXACT ART STYLE of the rest of the film: ${style}. No text.`;
  // every character gets an equal share of the room that is left, so a long cast shortens each one a
  // little instead of pushing the last character — or the style — off the end
  const room = SHEET_PROMPT_MAX - frame("").length - 2 * Math.max(0, names.length - 1);
  const each = Math.max(40, Math.floor(room / Math.max(1, names.length)));
  return frame(names.map((c) => tidy(c, each)).join("; ")).slice(0, SHEET_PROMPT_MAX);
}

/** What a scene drawn from the sheet is told about it. */
export const SHEET_LEAD = "The reference image is this film's CAST SHEET. Every character in this picture is one of the characters shown on it, drawn EXACTLY as there — the same kind of creature or person, colours, face, size and outfit. Nobody is redesigned and no new character is added. The scene: ";

/** A scene, drawn from the cast sheet. */
export function sceneFromSheetPrompt(o: { safe?: string; visual: string; style: string }): string {
  const v = tidy(o.visual, 520);
  return `${o.safe || ""}${SHEET_LEAD}${v}${/[.!?]$/.test(v) ? "" : "."} Style: ${tidy(o.style, 260)}.`.slice(0, SCENE_PROMPT_MAX);
}

/** A scene with NO sheet to draw from (the sheet could not be made): the cast in words, in full. */
export function sceneInWordsPrompt(o: { safe?: string; visual: string; cast: string[]; style: string }): string {
  const v = tidy(o.visual, 420);
  const cast = (o.cast || []).map((c) => tidy(c, 160)).filter(Boolean).slice(0, 6);
  const bible = cast.length ? ` Recurring cast, keep EVERY character identical in every scene: ${cast.join("; ")}.` : "";
  return `${o.safe || ""}${v}${/[.!?]$/.test(v) ? "" : "."}${bible} Style: ${tidy(o.style, 260)}.`.slice(0, SCENE_PROMPT_MAX);
}
