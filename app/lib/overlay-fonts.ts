/* THE TWO FACES A PHONE'S CAMERA SCREEN IS SET IN — where they come from, and what counts as having them.
 *
 * The found-footage "phone" look (camera-dress.ts) draws a phone's own recording screen over a take. A real
 * one — the owner sent a screenshot of his, 2026-11-24 — sets its labels (HD, RES, VIDEO, PHOTO) in a light,
 * regular sans and its numbers (0.5, 1×, the running time) in fixed-width figures. The repo carries one
 * font, Poppins Bold: every label came out heavy and the time jittered as its digits changed width.
 *
 * So two open faces (both SIL Open Font License) are fetched once to the persistent disk the first time a
 * take needs them — the way the Chinese caption font is (caption-font.ts): more than one source, a pinned
 * release first (it cannot be moved from under us), and the bytes checked to BE a font before they are kept.
 * A take never waits on them and never fails for them: no face → the look is drawn with Poppins, as it was.
 *
 * Pure (no network, no disk): tests/overlay-fonts.test.ts holds it. The fetching is overlay-fonts.server.ts. */

import { fontMagic } from "./caption-font.ts";

export type OverlayFace = { key: "thin" | "mono"; file: string; sources: readonly string[]; minBytes: number };

/** The regular sans (labels) and the monospace (numbers). Both addresses of each answered on 2026-11-24 —
 *  258,992 and 273,900 bytes. */
export const OVERLAY_FACES: readonly OverlayFace[] = [
  {
    key: "thin", file: "Inter-Regular.otf", minBytes: 150_000,
    sources: [
      "https://raw.githubusercontent.com/rsms/inter/v3.19/docs/font-files/Inter-Regular.otf",
      "https://cdn.jsdelivr.net/gh/rsms/inter@v3.19/docs/font-files/Inter-Regular.otf",
    ],
  },
  {
    key: "mono", file: "JetBrainsMono-Regular.ttf", minBytes: 150_000,
    sources: [
      "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/ttf/JetBrainsMono-Regular.ttf",
      "https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@v2.304/fonts/ttf/JetBrainsMono-Regular.ttf",
    ],
  },
];

/** Is this download really that face — big enough to be a whole font, and a font at all? (An error page
 *  saved under a font's name is neither.) */
export const looksLikeFace = (face: OverlayFace, bytes: ArrayLike<number> | null | undefined): boolean =>
  !!bytes && bytes.length >= face.minBytes && fontMagic(bytes);
