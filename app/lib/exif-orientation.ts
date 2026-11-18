// PHONE PHOTOS ARE STORED SIDEWAYS.
//
// An iPhone writes a portrait photo's pixels the way the sensor sees them — landscape — and adds one EXIF
// tag (Orientation, 0x0112) that says "turn me 90° before you show me". Browsers honour the tag, so the
// photo looks upright on the Stage. The image models (nano-banana and friends) read the raw pixels and
// ignore the tag, so a portrait photo of a sleeping child came back as a landscape edit lying on its side
// (owner report 2026-11-18: "it keeps rotating the finish image").
//
// This file only READS the tag (pure, no I/O — testable anywhere). upright-photo.server.ts turns the pixels.

/** The EXIF orientation (1–8) of a JPEG, or 1 when there is none or it cannot be read. */
export function jpegOrientation(buf: Uint8Array): number {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) return 1;
    const marker = buf[off + 1];
    if (marker === 0xff) { off++; continue; } // fill byte
    if (marker === 0xd9 || marker === 0xda) return 1; // end of image / start of scan: no metadata after this
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { off += 2; continue; } // markers with no length
    const len = (buf[off + 2] << 8) | buf[off + 3];
    if (len < 2) return 1;
    const start = off + 4;
    const end = off + 2 + len;
    if (end > buf.length) return 1;
    // APP1 "Exif\0\0"
    if (marker === 0xe1 && len >= 16 && buf[start] === 0x45 && buf[start + 1] === 0x78 && buf[start + 2] === 0x69
      && buf[start + 3] === 0x66 && buf[start + 4] === 0 && buf[start + 5] === 0) {
      const o = tiffOrientation(buf, start + 6, end);
      if (o) return o;
    }
    off = end;
  }
  return 1;
}

/** Orientation from a TIFF header + IFD0 inside [t, end); 0 when absent. */
function tiffOrientation(buf: Uint8Array, t: number, end: number): number {
  if (t + 8 > end) return 0;
  const le = buf[t] === 0x49 && buf[t + 1] === 0x49; // "II" — Intel byte order
  const be = buf[t] === 0x4d && buf[t + 1] === 0x4d; // "MM" — Motorola byte order
  if (!le && !be) return 0;
  const u16 = (p: number) => (le ? buf[p] | (buf[p + 1] << 8) : (buf[p] << 8) | buf[p + 1]);
  const u32 = (p: number) => (le
    ? (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) >>> 0
    : ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0);
  if (u16(t + 2) !== 42) return 0;
  const ifd = t + u32(t + 4);
  if (ifd + 2 > end) return 0;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) return 0;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8); // SHORT, count 1: the value sits in the first two bytes of the value field
      return v >= 1 && v <= 8 ? v : 0;
    }
  }
  return 0;
}

/** The ffmpeg filter that stands pixels stored with this orientation upright; null when they already are.
 *  (The same table ImageMagick's -auto-orient uses: 2 flop, 3 rotate 180, 4 flip, 5 transpose,
 *  6 rotate 90° clockwise, 7 transverse, 8 rotate 90° counter-clockwise.) */
export function orientationFilter(o: number): string | null {
  switch (o) {
    case 2: return "hflip";
    case 3: return "hflip,vflip";
    case 4: return "vflip";
    case 5: return "transpose=0";
    case 6: return "transpose=1";
    case 7: return "transpose=3";
    case 8: return "transpose=2";
    default: return null;
  }
}
