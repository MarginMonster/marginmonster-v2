// Is a picture letterboxed? — pure, so it is unit-tested (tests/letterbox.test.ts).
//
// An image model asked for a "cinematic" frame sometimes hands back the picture with black bars baked
// in (seen 2026-11-17: a 1344×768 master with 66 px of black above and 68 px below). A film seeded from
// that frame carries the bars through every shot. ffmpeg's `cropdetect` says where the picture really
// is; this decides whether that is a letterbox worth cropping — and refuses to "fix" a frame that is
// merely dark along one edge (a night window, a doorway), which is not a bar.

export type CropBox = { w: number; h: number; x: number; y: number };

/** The last `crop=w:h:x:y` ffmpeg's cropdetect printed, and the frame size from the input stream line. */
export function parseCropdetect(stderr: string): { frame: { w: number; h: number }; crop: CropBox } | null {
  const size = /Stream #0:0[^\n]*?\b(\d{3,5})x(\d{3,5})\b/.exec(stderr || "");
  const all = [...(stderr || "").matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  const m = all[all.length - 1];
  if (!size || !m) return null;
  return { frame: { w: +size[1], h: +size[2] }, crop: { w: +m[1], h: +m[2], x: +m[3], y: +m[4] } };
}

/** The crop to apply, or null when the frame is not letterboxed / pillarboxed. Bars must be on BOTH
 *  sides of the picture, of about the same size, and together take 6–35 % of that dimension. */
export function letterboxCrop(frame: { w: number; h: number }, crop: CropBox): CropBox | null {
  const pair = (a: number, b: number, total: number) => {
    const sum = a + b;
    if (sum < total * 0.06 || sum > total * 0.35) return false;
    if (a < total * 0.02 || b < total * 0.02) return false; // one-sided darkness is not a bar
    return Math.abs(a - b) <= Math.max(8, 0.35 * Math.max(a, b));
  };
  const top = crop.y, bottom = frame.h - crop.h - crop.y;
  const left = crop.x, right = frame.w - crop.w - crop.x;
  if ([top, bottom, left, right].some((v) => v < 0)) return null;
  const letter = pair(top, bottom, frame.h);
  const pillar = pair(left, right, frame.w);
  if (!letter && !pillar) return null;
  // take off only the bars that qualified; leave the other dimension whole
  return {
    w: pillar ? crop.w : frame.w, x: pillar ? crop.x : 0,
    h: letter ? crop.h : frame.h, y: letter ? crop.y : 0,
  };
}
