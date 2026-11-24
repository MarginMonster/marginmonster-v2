/* ONLY THE TWO ON SCREEN SPEAK.
 *
 * An acted film is shot as a TWO-SHOT: two people in a place, one speaking at a time (film-dialogue →
 * the location's master). A line the writer gives to anybody else has nowhere to come from — the video
 * model puts it in whichever mouth is in the frame.
 *
 * Made as a customer on 2026-11-23, "Moral Film — The Wallet at the Market": a girl finds a wallet, her
 * grandfather helps her give it back. The writer closed on the fruit seller — "MR. ALVAREZ: I can't thank
 * you enough, young lady, this wallet means more to me than you know." Mr. Alvarez was never on screen.
 * The GRANDFATHER said it, to his own granddaughter, and the ending made no sense. (Found by listening to
 * the finished film and looking at whose mouth moved.)
 *
 * So, as with the lines that run too long (dialogue-fit.ts): the writer is told, and then it is CHECKED.
 * In each place the first two speakers are the two on screen; a line by anyone else there goes back ONCE,
 * to be rewritten so that one of the two says it — reporting what the third person said or did, as people
 * do. A rewrite is only taken when it IS one of the two's line. Pure: the model call is the caller's.
 */
import { LINE_WORDS_MAX, LINE_WORDS_MIN, LINE_WORDS_WANT, splitLine } from "./dialogue-fit.ts";

/** How one speaker is told from another: the LAST word of the label, bare — "GRANDPA JOE" and "Joe" are
 *  one man, "MR. ALVAREZ" is another. (It is also the word the shot builder reads the speaker by:
 *  film-dialogue → splitExchange.) */
export const speakerKey = (name: string | null | undefined): string => {
  const words = String(name || "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  return words[words.length - 1] || "";
};

/** The shots as the places they happen in: a shot with no place of its own is in the place before it. */
function places(wheres: ReadonlyArray<string | null | undefined>, n: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < n; i++) {
    const w = String(wheres[i] || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (w) cur = w;
    out.push(cur);
  }
  return out;
}

/** For every line: the two who are on screen in its place (their labels as first written there), and
 *  whether the line is one of theirs. A line with no speaker label is nobody's in particular and is left
 *  alone. */
export function castOnScreen(
  captions: ReadonlyArray<string | null | undefined>,
  wheres: ReadonlyArray<string | null | undefined> = [],
): Array<{ two: string[]; seen: boolean }> {
  const at = places(wheres, captions.length);
  const byPlace = new Map<string, string[]>();
  captions.forEach((c, i) => {
    const name = splitLine(c).name;
    const key = speakerKey(name);
    if (!key) return;
    const two = byPlace.get(at[i]) || [];
    if (two.length < 2 && !two.some((n) => speakerKey(n) === key)) two.push(name);
    byPlace.set(at[i], two);
  });
  return captions.map((c, i) => {
    const two = byPlace.get(at[i]) || [];
    const key = speakerKey(splitLine(c).name);
    return { two, seen: !key || two.some((n) => speakerKey(n) === key) };
  });
}

/** The lines spoken by somebody who is not on screen, by position. */
export function unseenLines(captions: ReadonlyArray<string | null | undefined>, wheres: ReadonlyArray<string | null | undefined> = []): number[] {
  return castOnScreen(captions, wheres).map((x, i) => (x.seen ? -1 : i)).filter((i) => i >= 0);
}

/** The one request: every line in order, the unseen ones marked with who IS on screen there. */
export function unseenAsk(captions: ReadonlyArray<string | null | undefined>, wheres: ReadonlyArray<string | null | undefined> = []): string {
  const cast = castOnScreen(captions, wheres);
  const sheet = captions.map((l, i) => {
    const mark = cast[i].seen ? "" : `[NOT ON SCREEN — only ${cast[i].two.join(" and ")} can be seen and heard here] `;
    return `${i + 1}. ${mark}${(l || "").replace(/\s+/g, " ").trim()}`;
  }).join("\n");
  return (
    `These are the lines of a short acted scene, in order, one speaker per line, each written as "NAME: what they say". ` +
    `The film shows only TWO people in each place, and only those two can be heard. The lines marked [NOT ON SCREEN] are spoken by somebody else — the viewer cannot see that person, so the line cannot be filmed.\n\n` +
    `${sheet}\n\n` +
    `Rewrite EVERY marked line so that one of the two people named in its mark says it instead — choose the one who did NOT speak the line before it when that reads naturally. Keep what happens in the story: what the other person said or did is REPORTED or reacted to by the speaker (for example "He says he can't thank us enough — look at his face!"), in the language the line is written in. ` +
    `Each rewritten line has ${LINE_WORDS_WANT[0]} to ${LINE_WORDS_WANT[1]} spoken words and is written as "NAME: what they say", with the name exactly as it appears in the mark.\n` +
    `Return "lines": exactly ${captions.length} entries, one for each line above in the same order — a marked line rewritten, every other line copied exactly as it is. No numbers, no marks.`
  );
}

/** The lines after the rewrites came back. Only a marked line can change, and only to a line that one of
 *  the two on screen says, and that is still a line (LINE_WORDS_MIN to a little over the limit). A wrong
 *  number of entries, or anything that is not a list of texts, changes nothing. */
export function takeSeen(
  captions: ReadonlyArray<string | null | undefined>,
  rewritten: unknown,
  wheres: ReadonlyArray<string | null | undefined> = [],
): string[] {
  const base = captions.map((c) => c || "");
  if (!Array.isArray(rewritten) || rewritten.length !== captions.length) return base;
  const cast = castOnScreen(captions, wheres);
  return base.map((orig, i) => {
    if (cast[i].seen) return orig;
    const r = rewritten[i];
    if (typeof r !== "string") return orig;
    const tidy = r.replace(/^\s*\d+\.\s*/, "").replace(/^\s*\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();
    const now = splitLine(tidy);
    const who = cast[i].two.find((n) => speakerKey(n) === speakerKey(now.name));
    const n = (now.said.match(/\S+/g) || []).length;
    if (!who || n < LINE_WORDS_MIN || n > LINE_WORDS_MAX + 4) return orig;
    // the speaker's label exactly as it was first written (the cast is matched by it)
    return `${who}: ${now.said}`;
  });
}

/* ---- THE CAST PICKED BEFORE A WORD WAS WRITTEN ---------------------------------------------------
 *
 * The Cast card ("THE STARS") is filled in on the setup screen. With a storyboard the picks become the
 * storyboard's cast, and the film is made from that. Made in ONE PRESS there is no storyboard — and the
 * picks were sent and then dropped. A Short Film made on the live site on 2026-11-24 with OMAR + ROSA
 * picked was acted by two strangers the writer invented, and its record said nobody was cast. (Found
 * because that film was made to look at its poster, and it had none: there was no cast to bill.)
 */

/** One of the maker's picks, as the page sends it. */
export type PickedCast = { name: string; faceUrl: string | null; kind: "person" | "cartoon" | "monster"; look: string; voiceId: string | null };
/** A cast member as an acted film is made from: who, their picture, the voice they speak in, what they are
 *  when that is not a person — and the words the writer is told about them. */
export type ActedCast = { name: string; faceUrl: string; voiceId: string | null; kind?: "cartoon" | "monster"; look?: string };

/** The picks as an acted film's cast. Only somebody with a PICTURE is cast (the film is drawn from it);
 *  nobody twice; each keeps their own voice when `voiceOk` says this shop may use it — any other id is
 *  dropped and the engine chooses (never an id the page made up, which could be another shop's voice). */
export function pickedAsCast(picked: ReadonlyArray<PickedCast | null | undefined>, voiceOk: (voiceId: string) => boolean): ActedCast[] {
  const out: ActedCast[] = [];
  for (const p of picked || []) {
    const name = String(p?.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const faceUrl = String(p?.faceUrl || "").trim().slice(0, 2000);
    if (!name || !faceUrl || out.some((c) => speakerKey(c.name) === speakerKey(name))) continue;
    const look = String(p?.look || "").replace(/\s+/g, " ").trim().slice(0, 220);
    const voiceId = p?.voiceId && voiceOk(p.voiceId) ? p.voiceId : null;
    out.push({ name, faceUrl, voiceId, ...(p?.kind === "cartoon" || p?.kind === "monster" ? { kind: p.kind } : {}), ...(look ? { look } : {}) });
  }
  return out;
}

/** Who the WRITER is told the cast is, when the script is written by the film itself: each one's name and
 *  the words they were described with (film-engine → "THE CAST IS ALREADY CHOSEN"). */
export function castForWriter(cast: ReadonlyArray<{ name?: string | null; faceUrl?: string | null; look?: string | null } | null | undefined> | null | undefined): Array<{ name: string; desc: string }> {
  return (cast || [])
    .filter((c): c is { name: string; faceUrl: string; look?: string | null } => !!c && !!String(c.name || "").trim() && !!c.faceUrl)
    .map((c) => ({ name: c.name.trim(), desc: String(c.look || "").replace(/\s+/g, " ").trim().slice(0, 220) }));
}
