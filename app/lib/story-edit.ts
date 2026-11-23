/* EDIT A FINISHED NARRATED STORY — its words, with the pictures it already has.
 *
 * A finished story could not be touched: a wrong word in the narration meant making the whole story
 * again — new pictures, a different-looking story, minutes of waiting. Every rival lets you "edit the
 * script and regenerate". Here the pieces were already on the shelf: the Movie Maker's storyboard is
 * where a story's words and pictures are edited BEFORE it is made, and the render already takes a
 * storyboard whose pictures are approved and draws none of them again.
 *
 * So "Edit story" on a finished narrated story opens that same storyboard with the story loaded — the
 * scenes' words, and the very pictures it was made with — and Generate tells it again as a new piece:
 * the same pictures (only a scene that was added, or a picture the member redrew, is drawn), the same
 * narrator, the same music bed, the same language. The original is never touched.
 *
 * This file is the deciding part: what the storyboard is handed, and what a re-telling carries over
 * from the story it was opened from. Pure — the database and the disk are story-edit.server.ts. */
import { heroOf } from "./film-heroes.ts";
import { trimTitle } from "./text-trim.ts";
import { isNarratedStory, storyLangOf, toldFrom } from "./story-translate.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const parse = (raw: unknown): Obj => {
  if (isObj(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try { const o = JSON.parse(raw); return isObj(o) ? o : {}; } catch { return {}; }
};
const oneLine = (s: string): string => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/** The fewest and the most scenes a narrated story is told in (film-engine's own limits). */
export const EDIT_MIN_SCENES = 3;
export const EDIT_MAX_SCENES = 12;

export type EditScene = { visual: string; caption: string; where?: string; shot?: string; tone?: string; kind?: "perform" | "broll" };
export type StoryToEdit = {
  /** the story it was opened from (this shop's own — the loader checked) */
  from: string;
  title: string;
  /** the Movie Maker's format card it is told as, and that card's engine */
  heroId: string;
  template: string;
  aspect: "9:16" | "16:9" | "1:1";
  captions: "off" | "bold" | "subtitles";
  narrator: string;
  /** the language it is told in (a telling in another language is edited in that language) */
  lang: string;
  cast: Array<{ name: string; faceUrl?: string }>;
  /** the idea it was made from */
  topic: string;
  treatment: { title: string; scenes: EditScene[]; musicMood: string; cast: string[] };
  /** one for each scene, in order — or all null when they were not kept (the storyboard says so, and
   *  the story is then drawn again) */
  pictures: (string | null)[];
  picturesKept: boolean;
};

/**
 * What the storyboard is handed for a finished piece — or null when it is not one that can be opened
 * there: not a narrated story, a format that no longer exists, or fewer scenes than a story can have.
 * `pictures` = what was found for it on disk (one per scene, in order), or null.
 */
export function storyToEditFrom(
  asset: { id: string; title?: string | null; metaJson: unknown; bodyJson: unknown },
  pictures: ReadonlyArray<string> | null,
  shopLang?: string | null,
): StoryToEdit | null {
  if (!isNarratedStory(asset.metaJson)) return null;
  const meta = parse(asset.metaJson);
  const body = parse(asset.bodyJson);
  const tr = body.treatment;
  if (!isObj(tr) || !Array.isArray(tr.scenes)) return null;
  const hero = heroOf(str(meta.template), true);
  if (!hero) return null;
  const scenes: EditScene[] = tr.scenes.filter(isObj).slice(0, EDIT_MAX_SCENES).map((s) => ({
    visual: oneLine(str(s.visual)).slice(0, 600),
    caption: oneLine(str(s.caption)).slice(0, 600),
    ...(str(s.where) ? { where: oneLine(str(s.where)).slice(0, 120) } : {}),
    ...(str(s.shot) ? { shot: oneLine(str(s.shot)).slice(0, 60) } : {}),
    ...(str(s.tone) ? { tone: oneLine(str(s.tone)).slice(0, 60) } : {}),
    ...(s.kind === "perform" || s.kind === "broll" ? { kind: s.kind } : {}),
  }));
  // (a story is told in the scenes that have something to say — as the render itself does)
  if (scenes.length !== tr.scenes.length || scenes.filter((s) => s.caption).length < EDIT_MIN_SCENES) return null;
  const kept = !!pictures && pictures.length === scenes.length && pictures.every((p) => typeof p === "string" && !!p);
  const aspect = str(meta.aspect);
  const captions = str(meta.captions);
  return {
    from: asset.id,
    // (what the storyboard CALLS the story it has open — short enough for one line on a phone)
    title: trimTitle(oneLine(str(tr.title)) || oneLine(asset.title || ""), 48),
    heroId: hero.id,
    template: hero.tmpl,
    aspect: aspect === "16:9" || aspect === "1:1" ? aspect : "9:16",
    captions: captions === "off" || captions === "subtitles" ? captions : "bold",
    narrator: str(meta.narrator).slice(0, 80),
    lang: storyLangOf(asset.metaJson, shopLang),
    cast: (Array.isArray(meta.cast) ? meta.cast : []).filter(isObj).slice(0, 4)
      .map((c) => ({ name: oneLine(str(c.name)).slice(0, 40), ...(str(c.faceUrl) ? { faceUrl: str(c.faceUrl).slice(0, 2000) } : {}) }))
      .filter((c) => c.name),
    topic: str(body.prompt).slice(0, 2000),
    treatment: {
      // (the story's own title, whole: the render cuts it at a word for the library)
      title: oneLine(str(tr.title)).slice(0, 200),
      scenes,
      musicMood: oneLine(str(tr.musicMood)).slice(0, 200),
      cast: (Array.isArray(tr.cast) ? tr.cast : []).map((c) => oneLine(str(c)).slice(0, 300)).filter(Boolean).slice(0, 8),
    },
    pictures: kept ? pictures!.map((p) => p) : scenes.map(() => null),
    picturesKept: kept,
  };
}

/**
 * What a re-telling carries over from the story it was opened from — read from THAT story's own record
 * on the server, never from the page: the language it is told in, the first story it is a telling of
 * (so an edited Spanish telling is still the family's Spanish telling), and its music bed.
 * Null when the piece is not a narrated story.
 */
export function editCarry(meta: unknown, shopLang?: string | null): { lang: string; translatedFrom: string; music: string } | null {
  if (!isNarratedStory(meta)) return null;
  const m = parse(meta);
  const music = str(m.music).split(/[?#]/)[0];
  return {
    lang: storyLangOf(meta, shopLang),
    translatedFrom: toldFrom(meta).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64),
    music: music.slice(Math.max(music.lastIndexOf("/"), music.lastIndexOf("\\")) + 1),
  };
}
