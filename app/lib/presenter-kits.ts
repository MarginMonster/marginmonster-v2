/* Where a presenter's "character kit" lives and how its files are named — client-safe.
 *
 * A kit is, for each OUTFIT of a presenter: (a) the portrait with its background removed, so every
 * presenter can stand on the SAME backdrop, and (b) a full-body rotation — N transparent frames of
 * one full turn, in that outfit. Outfit 0 is the first (Casual); its rotation files carry no number,
 * outfit 2's are prefixed "2-".
 *
 *   stock cast        public/kits/<id>/o<N>.webp        public/kits/<id>/[<N>-]s<FF>.webp       (presenter-kits.json)
 *   custom presenter  /renders/kit<rowId>-o<N>.webp     /renders/kit<rowId>-[<N>-]s<FF>.webp    (CustomAvatar row)
 *
 * How they are made: app/lib/presenter-kit-core.ts. */

import KITS from "./presenter-kits.json";

/** One rotation: frame i is `${base}s${ii}.webp${q}`. `dir` is which way the recorded turn goes —
 *  1 when the face swings toward the RIGHT of the picture first, -1 when it swings LEFT — so the
 *  viewer can make a drag to the right always turn the presenter to the right. */
export type Spin = { base: string; q: string; n: number; w: number; h: number; dir: 1 | -1 };

/** What is recorded about one rotation, wherever it is stored. */
export type SpinMeta = { n: number; w: number; h: number; dir: number };

type StockKit = { cuts?: number; v?: number; spins?: Array<SpinMeta | null> };
const STOCK = KITS as Record<string, StockKit>;

/** The part of a rotation's file names that says which outfit it is. */
export const lookPrefix = (look: number): string => (look > 0 ? `${look}-` : "");

/** A stock presenter's rotation in one outfit — only a rotation that MEASURED as one real turn: the
 *  build writes `dir` 1 / -1 for those and 0 for a turn that has to be re-rolled, which is never shown. */
export function stockSpin(id: string, look = 0): Spin | null {
  const k = STOCK[id];
  const m = k?.spins?.[look];
  if (!k || !m || !m.n || !m.w || !m.h || (m.dir !== 1 && m.dir !== -1)) return null;
  return { base: `/kits/${id}/${lookPrefix(look)}`, q: `?v=${k.v || 1}`, n: m.n, w: m.w, h: m.h, dir: m.dir };
}

/** A stock presenter's cut-out portrait for one outfit, or null when it has not been made. */
export function stockCut(id: string, look = 0): string | null {
  const k = STOCK[id];
  return k && (k.cuts || 0) > look ? `/kits/${id}/o${look}.webp?v=${k.v || 1}` : null;
}

/** How many outfits of a stock presenter have a cut-out (most of the live cast has one portrait today). */
export const stockLooks = (id: string): number => Math.max(1, STOCK[id]?.cuts || 0);

/** A custom presenter's rotation in one outfit, from what its row recorded. `stamp` busts the year-long
 *  cache on /renders when a rotation is rebuilt under the same file names. */
export function customSpin(rowId: string, meta: SpinMeta | null | undefined, look: number, stamp: number): Spin | null {
  if (!meta || !meta.n || !meta.w || !meta.h) return null;
  return { base: `/renders/kit${rowId}-${lookPrefix(look)}`, q: stamp ? `?v=${stamp}` : "", n: meta.n, w: meta.w, h: meta.h, dir: meta.dir === -1 ? -1 : 1 };
}

export const customCut = (rowId: string, look: number): string => `/renders/kit${rowId}-o${look}.webp`;

export const spinFrame = (s: Spin, i: number): string => `${s.base}s${String(((i % s.n) + s.n) % s.n).padStart(2, "0")}.webp${s.q}`;
