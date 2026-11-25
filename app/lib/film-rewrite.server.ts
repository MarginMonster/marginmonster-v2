/* A DIRECTOR'S NOTE, CARRIED OUT — the making half of film-rewrite.ts (read that first: what a note is, the
 * six things that never bend, and how what comes back is checked).
 *
 * One call to the writer the films are written by (claude-sonnet-5 through anthropicText, the answer forced
 * into the schema), asked once and — when what came back could not be used — once more. It hands back the
 * scene's new lines, or null: the caller leaves the scene as it was and says so. It never throws.
 *
 * Free, like writing the script is: no tokens are spent until Generate.
 *
 * NOT RUN FROM HERE: the local writer key has no credit, so this call has never been made from this
 * checkout. What it sends (rewriteBrief, rewriteSchema) and what it takes back (parseRewriteLines) are
 * plain functions and are run in tests/film-kit.test.ts; the first real note is the lead's to press on the
 * live site (see the hand-over notes of 2026-11-25). */

import { anthropicText } from "./anthropic.server";
import { flowOf, parseBeat } from "./film-flow";
import { parseRewriteLines, rewriteBrief, rewriteSchema, speakersInPlace, type DirectorNote, type RewriteTemplate, type RewriteTreatment, type RewrittenLine } from "./film-rewrite";

/** A scene of up to a dozen lines with a tone each: well inside this. */
const REWRITE_MAX_TOKENS = 1400;

/** One scene's lines, rewritten to a note — or null when the writer could not be reached or what it wrote
 *  could not be used (twice). `speakers` is the film's cast as the page names them. */
export async function rewritePlace({ treatment, placeIndex, note, speakers, template }: {
  treatment: RewriteTreatment; placeIndex: number; note: DirectorNote; speakers: ReadonlyArray<string>; template?: RewriteTemplate | null;
}): Promise<RewrittenLine[] | null> {
  const scenes = treatment?.scenes || [];
  const loc = flowOf(scenes)[placeIndex];
  if (!loc) return null;
  const brief = rewriteBrief({ treatment, placeIndex, note, speakers, template });
  const who = speakersInPlace(scenes, placeIndex, speakers);
  const had = scenes.slice(loc.firstIdx, loc.lastIdx + 1).filter((s) => /[\p{L}\p{N}]/u.test(parseBeat(s.caption).line)).length;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await anthropicText(brief, {
        model: "claude-sonnet-5",
        maxTokens: REWRITE_MAX_TOKENS,
        jsonSchema: { name: "scene_rewrite", schema: rewriteSchema as unknown as Record<string, unknown> },
      });
      const lines = parseRewriteLines(raw, who, had || undefined);
      if (lines) {
        console.log(`[film-rewrite] scene ${placeIndex + 1}, note "${note.key}": ${had} line${had === 1 ? "" : "s"} -> ${lines.length}${attempt ? " (second ask)" : ""}`);
        return lines;
      }
      console.error(`[film-rewrite] scene ${placeIndex + 1}, note "${note.key}": the rewrite could not be used${attempt ? "" : " — asking once more"}: ${String(raw).slice(0, 200)}`);
    } catch (e) {
      console.error(`[film-rewrite] scene ${placeIndex + 1}, note "${note.key}": the writer failed${attempt ? "" : " — asking once more"}: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    }
  }
  return null;
}
