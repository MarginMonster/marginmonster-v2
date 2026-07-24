import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";

/* Serves assembled UGC ad videos from the runtime render directory.
 * (Runtime-generated files can't live in public/ — Vite copies that at build
 * time — so they sit in data/renders and are served here.)
 *
 * CRITICAL: never hand a raw Node read stream to the Response. `<video>` fires
 * Range requests and aborts connections; a stream 'error' with no listener is
 * an uncaught exception that CRASHES the whole Node process (the "app crashes
 * when the video is delivered, reload works" bug). We read bytes into a buffer
 * and always return a plain Response — nothing can throw uncaught.
 *
 * These files live on a PERSISTENT Render disk (render.yaml: disk "renders"
 * mounted at /app/data/renders), so they survive deploys and restarts — Kept
 * content is durable. The disk is single-instance with no redundancy, so
 * moving to object storage (R2/S3) is still the right call before scaling out
 * or going standalone. */
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  try {
    const name = params.file || "";
    // allow the image ad formats too — this guard used to be .mp4-only, which
    // 404'd every img-*.jpg and made all image ads render blank.
    if (!/^[a-zA-Z0-9_-]+\.(mp4|jpe?g|png|webp)$/.test(name)) {
      return new Response("Not found", { status: 404 });
    }
    const filePath = path.join(process.cwd(), "data", "renders", name);
    if (!fs.existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }
    const size = fs.statSync(filePath).size;
    const ext = name.split(".").pop() as string;
    const mime = ext === "mp4" ? "video/mp4" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const baseHeaders: Record<string, string> = {
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    };

    // Range request (video scrubbing, iOS/Safari) → 206 with just that slice.
    const range = request.headers.get("range");
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        return new Response("Range not satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
        });
      }
      // cap slice size so a hostile Range can't balloon memory
      end = Math.min(end, size - 1, start + 8 * 1024 * 1024 - 1);
      const fd = fs.openSync(filePath, "r");
      try {
        const len = end - start + 1;
        const buf = Buffer.allocUnsafe(len);
        fs.readSync(fd, buf, 0, len, start);
        return new Response(buf, {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": String(len),
          },
        });
      } finally {
        fs.closeSync(fd);
      }
    }

    // No range → whole file as a buffer (these clips are a few MB).
    const buf = fs.readFileSync(filePath);
    return new Response(buf, { headers: { ...baseHeaders, "Content-Length": String(size) } });
  } catch (e) {
    console.error("[renders] serve failed:", e);
    return new Response("Server error", { status: 500 });
  }
};
