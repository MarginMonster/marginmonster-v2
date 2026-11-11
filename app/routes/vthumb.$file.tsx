/* Poster thumbnails for the Archive video grid. The cards used to each mount a
 * <video preload="metadata"> and seek to #t=0.1 for a frame — but iOS Safari
 * won't paint a video frame without interaction, so every card sat BLACK while
 * it downloaded ~20MB of video metadata, and a gridful at once made the Archive
 * feel broken. This serves a tiny first-frame JPG instead: ffmpeg extracts one
 * frame the first time a thumb is requested, caches it to disk, and every later
 * request (and every other viewer) gets the cached ~20KB image, immutably. The
 * card becomes a plain <img> that paints instantly on every device. */

import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";
import { runFfmpeg } from "../lib/ugc-ad-pipeline.server";

// Only a plain render filename — letters/digits/._- ending in a video extension.
// No slashes, no "..", so the name can never escape data/renders.
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.(mp4|mov|webm|m4v)$/;

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const name = params.file || "";
  if (!SAFE.test(name) || name.includes("..")) return new Response("Not found", { status: 404 });

  const rendersDir = path.join(process.cwd(), "data", "renders");
  const video = path.join(rendersDir, name);
  if (!fs.existsSync(video)) return new Response("Not found", { status: 404 });

  const thumbsDir = path.join(rendersDir, "thumbs");
  const thumb = path.join(thumbsDir, `${name}.jpg`);

  if (!fs.existsSync(thumb)) {
    try {
      fs.mkdirSync(thumbsDir, { recursive: true });
      // Grab a frame ~0.6s in (0.1s can land on a black fade-in) and scale to a
      // card-sized poster. One cheap frame extract, cached forever after.
      await runFfmpeg(["-y", "-ss", "0.6", "-i", video, "-frames:v", "1", "-vf", "scale=400:-2", "-q:v", "4", thumb]);
    } catch { /* fall through to the 404 below */ }
  }
  if (!fs.existsSync(thumb)) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(fs.readFileSync(thumb)), {
    headers: {
      "Content-Type": "image/jpeg",
      // A video's first frame never changes — cache hard so the Archive is instant.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
