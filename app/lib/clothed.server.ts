/* EVERYBODY IN A FILM'S PICTURE IS CLOTHED — LOOKED AT, wherever a picture is drawn for a film.
 *
 * 2026-11-25: three acted lake films in a row drew "a woman standing waist-deep in the lake" unclothed, and none of
 * them could be sent to the owner. What fixed the acted film's MASTER (image-generation.server.ts →
 * renderSideBySideTwoShot, tests/clothed.test.ts) was a look: the picture is asked whether anybody in it is unclothed
 * (story-picture.ts → unclothedPrompt); a picture with somebody bare is drawn once more with the clothes said FIRST
 * (CLOTHED_FIRST), and if the model still will not, that one figure is dressed by ONE edit (clothedEdit) on the
 * strongest picture model. The same picture models drew every other picture in the app's films — a told story's
 * scenes and portraits, a found-footage take's scene, a house camera's room as the take finds it, an acted horror
 * film's reveal and its thing's portrait — with no such look, or (the sighting, the thing's portrait) with a copy of
 * it. This is the ONE sequence all of them use:
 *
 *     look  →  (drawn again, clothes first)  →  (dressed by one edit)  →  the picture to use
 *
 * COST: one vision question per picture — none when the caller already asked it in its own look (a told story asks
 * it inside the question that lists the people in the picture); a redraw or an edit only on a fault.
 * NEVER A FILM LOST TO A LOOK: a look that cannot be made reads as clothed; a redraw or an edit that fails or throws
 * leaves the picture as it was. What becomes of a picture STILL unclothed after its edit is the caller's to say:
 *   "keep"  the edited picture is used, and the log says to look at this film (a master, a take's scene — a film
 *           cannot be made without them);
 *   "drop"  null — for a picture the caller can go on without: the next model of a ladder (the thing's portrait, a
 *           sighting), or the reveal falling back as it does when its picture will not come.
 *
 * Nothing here is drawn or asked at import: the vision reader and the picture models are reached lazily, so the
 * sequence itself is tested with stand-ins (tests/clothed.test.ts). */
import { STORY_MODEL, clothedEdit, parseUnclothed, storyPictureInput, unclothedPrompt } from "./story-picture.ts";

/** What a look read off a picture: whether anybody in it is unclothed, and where that one is ("" when nobody is). */
export type ClothedLook = { unclothed: boolean; who: string };

const NOBODY: ClothedLook = { unclothed: false, who: "" };
const short = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 140);

/** THE LOOK, asked on its own: is anybody in this picture unclothed? `ref`: an address a model can fetch, or the
 *  picture inline. A look that cannot be made answers "clothed" — never a picture lost to its check. */
export async function lookClothed(ref: string): Promise<ClothedLook> {
  try {
    const { anthropicVision } = await import("./anthropic.server");
    return parseUnclothed(String((await anthropicVision(unclothedPrompt(), [ref], { maxTokens: 120, model: "claude-sonnet-4-6" })) || ""));
  } catch { return NOBODY; }
}

/** THE EDIT that dresses the one figure (story-picture.ts → clothedEdit): THAT picture (`ref`, as a model is handed
 *  it), on the strongest picture model, at the picture's own shape — kept on the renders disk. Throws when it will not
 *  come (keepClothed catches it). */
export async function clothedEditOn(ref: string, who: string, aspect: string): Promise<string> {
  const { persistRemote, repRun } = await import("./image-generation.server");
  return persistRemote(await repRun(STORY_MODEL, storyPictureInput(STORY_MODEL, { prompt: clothedEdit(who), refs: [ref], aspect }), 150_000), "jpg");
}

/** KEEP IT CLOTHED: the picture to use, after the look and — only on a fault — the redraw and the edit.
 *    url     the picture as it was drawn (a /renders path, or a model's own address)
 *    ref     how a model is handed a picture: an absolute address, or the picture inline on a local run (default: as it is)
 *    seen    what the caller's own look already read off it — then nothing is asked here before the redraw
 *    redraw  the same picture drawn once more with CLOTHED_FIRST said first (none: straight to the edit)
 *    edit    the edit that dresses the one figure, handed the picture (`ref`ed) and where that figure is (none: no edit)
 *    still   what becomes of a picture still unclothed at the end: "keep" (default) or "drop" (null) — see above
 *    look    the look itself (default lookClothed — a test hands a stand-in)
 *    log     where each step is said
 *  A redraw replaces the picture only when ITS look is clean; the edit is made of the picture as first drawn. */
export async function keepClothed(o: {
  url: string;
  ref?: (u: string) => string;
  seen?: ClothedLook | null;
  redraw?: (() => Promise<string | null | undefined>) | null;
  edit?: ((ref: string, who: string) => Promise<string | null | undefined>) | null;
  still?: "keep" | "drop";
  look?: (ref: string) => Promise<ClothedLook>;
  log?: (line: string) => void;
}): Promise<string | null> {
  const ref = (u: string): string => { try { return (o.ref ? o.ref(u) : u) || u; } catch { return u; } };
  const look = async (u: string): Promise<ClothedLook> => { try { return (await (o.look || lookClothed)(ref(u))) || NOBODY; } catch { return NOBODY; } };
  const say = (line: string): void => { try { o.log?.(line); } catch { /* the picture is what matters */ } };
  const drop = o.still === "drop";
  if (!o.url) return drop ? null : o.url;
  const seen = o.seen || (await look(o.url));
  if (!seen.unclothed) return o.url;
  say(`an unclothed figure (${seen.who || "somewhere in it"})${o.redraw ? " — drawn again, clothes first" : o.edit ? " — dressed by one edit" : ""}`);
  // (1) drawn once more, the clothes said first — kept only if ITS look is clean
  if (o.redraw) {
    try {
      const again = await o.redraw();
      if (again && !(await look(again)).unclothed) return again;
      say(again ? "the clothes-first redraw is unclothed too" : "the clothes-first redraw did not come");
    } catch (e) { say(`the clothes-first redraw failed — ${short(e)}`); }
  }
  // (2) ONE edit of the picture as it was first drawn, dressing that one figure — looked at again
  if (o.edit) {
    try {
      const edited = await o.edit(ref(o.url), seen.who);
      if (edited) {
        if (!(await look(edited)).unclothed) { say("dressed by one edit"); return edited; }
        if (!drop) { say("STILL an unclothed figure after the edit — the edited picture is kept; look at this film"); return edited; }
      } else say("the clothing edit did not come");
    } catch (e) { say(`the clothing edit failed — ${short(e)}`); }
  }
  // (3) still unclothed: the caller's choice — dropped, or the picture it had
  if (drop) { say("still an unclothed figure — the picture is dropped"); return null; }
  say("still an unclothed figure — the picture is kept as it was; look at this film");
  return o.url;
}
