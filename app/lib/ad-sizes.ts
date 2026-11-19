// Every shape an ad needs, from one finished video. Ad networks each want their own: Reels / TikTok /
// Shorts are vertical 9:16, the Instagram and Facebook feeds favour 4:5, marketplaces and older feeds
// take 1:1, YouTube and websites 16:9. Rival tools hand marketers all four at once; this is ours.
//
// Nothing is ever cut off: our videos carry burned-in captions and products near the edges, so a crop
// could lose either. The whole picture is centred and the empty space filled with a soft, darkened blur of
// the same video — the standard look for a vertical video in a wide or square slot.

export type AdSize = "9x16" | "4x5" | "1x1" | "16x9";

export const AD_SIZES: Record<AdSize, { label: string; ratio: string; w: number; h: number; where: string }> = {
  "9x16": { label: "Vertical", ratio: "9:16", w: 1080, h: 1920, where: "Reels · TikTok · Shorts" },
  "4x5": { label: "Feed", ratio: "4:5", w: 1080, h: 1350, where: "Instagram & Facebook feed" },
  "1x1": { label: "Square", ratio: "1:1", w: 1080, h: 1080, where: "Feeds · Marketplace" },
  "16x9": { label: "Wide", ratio: "16:9", w: 1920, h: 1080, where: "YouTube · X · websites" },
};

export const AD_SIZE_KEYS = Object.keys(AD_SIZES) as AdSize[];

export function isAdSize(s: unknown): s is AdSize {
  return typeof s === "string" && Object.prototype.hasOwnProperty.call(AD_SIZES, s);
}

/** Is a srcW×srcH picture already this shape (within 2%)? Then it only needs scaling, no fill. */
export function sameShape(srcW: number, srcH: number, w: number, h: number): boolean {
  if (!(srcW > 0 && srcH > 0)) return false;
  return Math.abs(srcW / srcH - w / h) / (w / h) < 0.02;
}

/**
 * The ffmpeg -filter_complex graph (input [0:v], output [v]) that puts a srcW×srcH video into w×h without
 * cutting anything. Same shape → a plain scale. Otherwise: the background is the video itself, shrunk to
 * an eighth, cropped to fill, blurred and darkened a touch, then scaled back up (blurring the small copy
 * is many times cheaper than blurring a 1080p frame and looks the same); the whole video sits centred on
 * top. Every size is kept even so the result encodes as ordinary yuv420p H.264.
 */
export function sizeGraph(srcW: number, srcH: number, w: number, h: number): string {
  if (sameShape(srcW, srcH, w, h)) return `[0:v]scale=${w}:${h}:flags=lanczos,setsar=1,format=yuv420p[v]`;
  const bw = Math.max(16, Math.round(w / 8 / 2) * 2);
  const bh = Math.max(16, Math.round(h / 8 / 2) * 2);
  return [
    `[0:v]split=2[a][b]`,
    `[a]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=6:2,eq=brightness=-0.10,scale=${w}:${h}[bg]`,
    `[b]scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]`,
  ].join(";");
}
