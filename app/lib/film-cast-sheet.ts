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

/** Room for these prompts (the picture model reads far more than the old 500-character cut). A scene's
 *  has to hold the lead, the scene, where it is, who is who and the style — whole, all five. */
export const SHEET_PROMPT_MAX = 1200;
export const SCENE_PROMPT_MAX = 1700;

const tidy = (s: string, max: number): string => (s || "").replace(/\s+/g, " ").trim().slice(0, max);
/** Cut at a whole word, and never left hanging on a joining word ("…big sparkly blue eyes and a"). */
const wordCut = (s: string, max: number): string => {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  let out = t.slice(0, max).replace(/\s+\S*$/, "");
  for (let k = 0; k < 4; k++) out = out.replace(/[\s,;:—–-]+$/, "").replace(/\s+(?:and|or|with|a|an|the|on|in|of|at|to|its|his|her|their)$/i, "");
  return out;
};

/** WHO IS WHO on the sheet.
 *
 *  A scene's words call its characters by NAME — "Puddleton leaps into the puddle while Quacky and Bibbles
 *  clap" — and a cast sheet has no name tags. The first film drawn from a right sheet (2026-11-22) kept
 *  all three ducks the same in every scene, and the duck that leapt was Bibbles: the model had three
 *  ducks, three names and nothing to join them with. So each name comes with the look the writer gave it,
 *  in the writer's own words ("Puddleton = a round cheerful baby duck with bright yellow fluff…"). The
 *  key is a legend, not a guest list: only the ones the scene names are in the picture. */
export function whoIsWho(cast: string[], room = 440): string {
  const rows = (cast || [])
    .map((c) => /^([^,—:–(]{1,40}?)\s*[,—:–(]\s*(.+)$/.exec(tidy(c, 400)))
    .filter((m): m is RegExpExecArray => !!m && !!m[2].trim())
    .slice(0, 6)
    .map((m) => ({ name: m[1].trim(), look: m[2].trim().replace(/[.)\s]+$/, "") }));
  if (!rows.length) return "";
  const lead = " Who is who on the cast sheet (only the ones the scene names are in the picture): ";
  // Every look whole when they fit; when they do not, a short one's unused room goes to the long ones
  // (three looks of 135, 105 and 107 characters in a room for 400 were cut at an equal 134 — "…a tiny red
  // rain boot on each webbed").
  const avail = room - rows.reduce((n, r) => n + r.name.length + 5, 0);
  let share = Math.max(36, Math.floor(avail / rows.length));
  if (rows.reduce((n, r) => n + r.look.length, 0) > avail) {
    const short = rows.filter((r) => r.look.length <= share);
    const long = rows.length - short.length;
    if (long > 0) share = Math.max(36, Math.floor((avail - short.reduce((n, r) => n + r.look.length, 0)) / long));
  } else share = 400;
  return `${lead}${rows.map((r) => `${r.name} = ${wordCut(r.look, share)}`).join("; ")}.`;
}

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

/** WHERE a scene is, when the writer said — the place and its weather. Each scene is drawn on its own from
 *  its own words, and the writer's "where" was never among them: a rainy-day song's third scene, whose
 *  words were about the umbrella and not the rain, was drawn on a sunny lawn (same film). */
const whereLine = (where: string | undefined): string => {
  const w = wordCut((where || "").replace(/[.!?\s]+$/, ""), 130);
  return w ? ` Where: ${w}.` : "";
};

/** A scene, drawn from the cast sheet: told the sheet is its cast, then the scene, where it is, who is
 *  who, and the style. The scene's own words are what gives when room is short — never cut blind off the
 *  end, where the style is. */
export function sceneFromSheetPrompt(o: { safe?: string; visual: string; style: string; cast?: string[]; where?: string }): string {
  const head = `${o.safe || ""}${SHEET_LEAD}`;
  const tail = `${whereLine(o.where)}${whoIsWho(o.cast || [])} Style: ${tidy(o.style, 260)}.`;
  const v = wordCut(o.visual, Math.max(200, Math.min(520, SCENE_PROMPT_MAX - head.length - tail.length - 1)));
  return `${head}${v}${/[.!?]$/.test(v) ? "" : "."}${tail}`.slice(0, SCENE_PROMPT_MAX);
}

/** A scene with NO sheet to draw from (the sheet could not be made): the cast in words, in full. */
export function sceneInWordsPrompt(o: { safe?: string; visual: string; cast: string[]; style: string; where?: string }): string {
  const v = tidy(o.visual, 420);
  const cast = (o.cast || []).map((c) => tidy(c, 160)).filter(Boolean).slice(0, 6);
  const bible = cast.length ? ` Recurring cast, keep EVERY character identical in every scene: ${cast.join("; ")}.` : "";
  return `${o.safe || ""}${v}${/[.!?]$/.test(v) ? "" : "."}${whereLine(o.where)}${bible} Style: ${tidy(o.style, 260)}.`.slice(0, SCENE_PROMPT_MAX);
}

/** What the WRITER is told about a scene's picture in the formats drawn this way. Each picture is made on
 *  its own, by a model that has read none of the others — so what must be the same from scene to scene
 *  has to be SAID in each one. (Same film: the "one umbrella" the song is about was blue, yellow and red
 *  in one scene and white with red dots in the next.) */
export const VISUAL_STANDS_ALONE = `Each VISUAL is drawn ON ITS OWN by an artist who has not read the others, so each one says everything it needs: ONE moment (a single frame, never a sequence); every character in it called by their NAME alone, spelt as in "cast" (the name only — never their description again: the artist has the cast sheet); and anything seen in more than one scene — an umbrella, a kite, a toy, a car — described with the SAME few words, ITS COLOURS INCLUDED, every time it appears ("the red umbrella with white dots", never just "the umbrella"). Also return "where" for every scene: the place AND its weather or time of day in a few words — one world for the whole film (a rainy-day story is raining in every scene). Nothing in a picture is WRITTEN: no signs, labels or words.`;
