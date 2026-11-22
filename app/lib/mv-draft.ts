/* A MUSIC VIDEO IN THE MAKING IS KEPT.
 *
 * The song, the six pictures, who is in each, what they wear, the lines that were re-written by hand — a
 * storyboard is ten minutes of somebody's work and it lived only in the open page. A refresh lost it. So
 * did every update we shipped: the next tap landed on "EasyMode just updated", whose reload came back to
 * an empty Movie Maker (seen while testing on the live site, 2026-11-22 — and the page said "Nothing's
 * lost on your end").
 *
 * So a music video with a storyboard is written to this browser as it changes, and offered back — one
 * card, "Your music video is still here" — the next time Movie Maker opens. Nothing is restored unasked
 * (what is on the screen is never replaced behind the maker's back), and nothing is thrown away by
 * saying "Not now": the kept video is only replaced by the next storyboard, or by its own age.
 *
 * Pure: what is kept, how it is read back, and when it is too old or too broken to offer. No storage, no
 * clock of its own — the page hands both in.
 */

export const MV_DRAFT_KEY = "mm-mv-draft-v1";
/** How long a kept video is offered back (the pictures themselves stay on our disk far longer). */
export const MV_DRAFT_HOURS = 72;

type Person = { img: string; name: string };
export type MvDraftSeeds = {
  imgs: (string | null)[];
  treatment: { title?: string; scenes: Array<Record<string, unknown>>; [k: string]: unknown };
  propForScene: Record<number, string>;
  artistRef: string | null; castRef: string | null; castRefs: string[];
  faults?: (number | null)[]; checks?: unknown[];
};
/** Everything the Music Video builder needs to be exactly where it was. */
export type MvDraft = {
  v: 1;
  /** when it was last written (ms) */
  at: number;
  template: string;
  topic: string; genre: string; pace: string; seconds: number; scenes: number;
  aspect: "9:16" | "16:9" | "1:1"; lyrics: string;
  artist: string; artistGender: "m" | "f"; singVoice: boolean;
  customArtists: Person[]; cast: Person[]; feat: string[];
  props: string[]; customProps: Array<{ key: string; label: string; img: string }>;
  songSource: "write" | "upload"; songUrl: string;
  seeds: MvDraftSeeds;
  castForScene: Record<number, string[]>;
  sceneOutfits: Record<number, Record<string, string>>;
};

/** The most a kept video may weigh as text — a storyboard is a few kilobytes; far more than that is not one. */
export const MV_DRAFT_MAX_CHARS = 200_000;

/** What is written to the browser: the video as it stands, stamped. "" when it is too big to be one. */
export function packDraft(d: Omit<MvDraft, "v" | "at">, now: number): string {
  const s = JSON.stringify({ ...d, v: 1, at: now });
  return s.length <= MV_DRAFT_MAX_CHARS ? s : "";
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const people = (v: unknown, max: number): Person[] =>
  (Array.isArray(v) ? v : []).filter((x) => x && typeof x.img === "string" && x.img).slice(0, max).map((x) => ({ img: str(x.img, 2000), name: str(x.name, 60) }));
const strings = (v: unknown, max: number, each = 2000): string[] => (Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && x).slice(0, max).map((x) => (x as string).slice(0, each));
const byScene = <T,>(v: unknown, read: (x: unknown) => T | null): Record<number, T> => {
  const out: Record<number, T> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) { const n = Number(k); const r = Number.isInteger(n) && n >= 0 && n < 64 ? read(x) : null; if (r !== null) out[n] = r; }
  return out;
};

/** A kept video, read back — or null when there is none worth offering: nothing stored, not ours, older
 *  than MV_DRAFT_HOURS, or without a storyboard that has at least one picture and a scene for each. What
 *  comes back is only ever the shapes the builder expects; anything else in the text is dropped. */
export function readDraft(raw: string | null | undefined, now: number): MvDraft | null {
  if (!raw || raw.length > MV_DRAFT_MAX_CHARS) return null;
  let j: Record<string, unknown>;
  try { const p = JSON.parse(raw); if (!p || typeof p !== "object" || Array.isArray(p)) return null; j = p as Record<string, unknown>; } catch { return null; }
  if (j.v !== 1 || typeof j.at !== "number" || !(now - j.at >= 0) || now - j.at > MV_DRAFT_HOURS * 3_600_000) return null;
  const s = j.seeds as Record<string, unknown> | null | undefined;
  if (!s || typeof s !== "object") return null;
  const imgs = Array.isArray(s.imgs) ? s.imgs.slice(0, 24).map((x) => (typeof x === "string" && x ? x.slice(0, 2000) : null)) : [];
  const tr = s.treatment as { scenes?: unknown } | null | undefined;
  const scenes = tr && Array.isArray(tr.scenes) ? (tr.scenes as unknown[]).filter((x) => x && typeof x === "object" && typeof (x as { visual?: unknown }).visual === "string") : [];
  if (!imgs.some(Boolean) || !scenes.length || scenes.length !== imgs.length) return null;
  const template = str(j.template, 40);
  if (!template) return null;
  const aspect = j.aspect === "16:9" || j.aspect === "1:1" ? j.aspect : "9:16";
  return {
    v: 1, at: j.at, template,
    topic: str(j.topic, 300), genre: str(j.genre, 40), pace: str(j.pace, 12),
    seconds: Number.isFinite(j.seconds) && (j.seconds as number) > 0 ? Math.min(600, Math.round(j.seconds as number)) : 0,
    scenes: Number.isFinite(j.scenes) && (j.scenes as number) > 0 ? Math.min(24, Math.round(j.scenes as number)) : scenes.length,
    aspect, lyrics: str(j.lyrics, 20),
    artist: str(j.artist, 2000), artistGender: j.artistGender === "f" ? "f" : "m", singVoice: j.singVoice === true,
    customArtists: people(j.customArtists, 12), cast: people(j.cast, 4), feat: strings(j.feat, 4),
    props: strings(j.props, 12, 60),
    customProps: (Array.isArray(j.customProps) ? j.customProps : []).filter((x) => x && typeof x.key === "string" && typeof x.img === "string").slice(0, 12).map((x) => ({ key: str(x.key, 80), label: str(x.label, 80), img: str(x.img, 2000) })),
    songSource: j.songSource === "upload" ? "upload" : "write", songUrl: str(j.songUrl, 2000),
    seeds: {
      imgs,
      treatment: { ...(tr as Record<string, unknown>), scenes: scenes as Array<Record<string, unknown>> },
      propForScene: byScene(s.propForScene, (x) => (typeof x === "string" && x ? x.slice(0, 80) : null)),
      artistRef: str(s.artistRef, 2000) || null, castRef: str(s.castRef, 2000) || null, castRefs: strings(s.castRefs, 4),
      ...(Array.isArray(s.faults) ? { faults: s.faults.slice(0, 24).map((x) => (typeof x === "number" ? x : null)) } : {}),
      ...(Array.isArray(s.checks) ? { checks: s.checks.slice(0, 24) } : {}),
    },
    castForScene: byScene(j.castForScene, (x) => (Array.isArray(x) ? strings(x, 4) : null)),
    sceneOutfits: byScene(j.sceneOutfits, (x) => {
      if (!x || typeof x !== "object" || Array.isArray(x)) return null;
      const o: Record<string, string> = {};
      for (const [k, v] of Object.entries(x as Record<string, unknown>).slice(0, 4)) if (typeof v === "string") o[k.slice(0, 2000)] = v.slice(0, 200);
      return o;
    }),
  };
}

/** How many of a kept video's scenes have their picture — what the card says. */
export function draftScenes(d: MvDraft): number { return d.seeds.imgs.filter(Boolean).length; }
