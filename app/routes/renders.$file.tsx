import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";
import { getObject, renderKey, storageEnabled } from "../lib/object-storage.server";

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
    // The ONLY zips served are the avatar-voice engine's own (singing-voice.server.ts): the speech
    // dataset it hands the RVC trainer and the trained voice model the cover model downloads. Their
    // names carry an HMAC of the voice id, so they can't be guessed.
    const isVoiceZip = /^rvc(voice|data)-[a-zA-Z0-9_-]+\.zip$/.test(name);
    if (!isVoiceZip && !/^[a-zA-Z0-9_-]+\.(mp4|mp3|jpe?g|png|webp)$/.test(name)) {
      return new Response("Not found", { status: 404 });
    }
    const filePath = path.join(process.cwd(), "data", "renders", name);
    if (isVoiceZip) {
      // A voice model is ~145 MB — never buffer it whole (the media path below reads the file into
      // memory, fine for a few-MB clip). Pull-based web stream over a file descriptor: no Node stream
      // 'error' event to go uncaught (the crash the note above warns about), and the fd is closed on
      // finish, error or client disconnect.
      if (!fs.existsSync(filePath)) return new Response("Not found", { status: 404 });
      const size = fs.statSync(filePath).size;
      let fd: number | null = null;
      let pos = 0;
      const close = () => { if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } fd = null; } };
      const body = new ReadableStream<Uint8Array>({
        start() { fd = fs.openSync(filePath, "r"); },
        pull(controller) {
          try {
            if (fd === null || pos >= size) { close(); controller.close(); return; }
            const len = Math.min(1024 * 1024, size - pos);
            const buf = Buffer.allocUnsafe(len);
            const n = fs.readSync(fd, buf, 0, len, pos);
            if (n <= 0) { close(); controller.close(); return; }
            pos += n;
            controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, n));
            if (pos >= size) { close(); controller.close(); }
          } catch (e) { close(); controller.error(e); }
        },
        cancel() { close(); },
      });
      return new Response(body, { headers: { "Content-Type": "application/zip", "Content-Length": String(size), "Cache-Control": "private, no-store" } });
    }
    // Read-fallback: if the file isn't on the local disk (fresh instance, or a
    // disk that was resized/recreated), pull it from durable object storage and
    // rehydrate the local copy so subsequent requests are fast. This is what
    // makes "Kept" content survive any deploy or disk change.
    if (!fs.existsSync(filePath) && storageEnabled()) {
      const obj = await getObject(renderKey(name));
      if (obj) {
        try {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          // Write to a neighbour and rename, because a plain write is not
          // atomic. A deploy or an OOM part-way through leaves a TRUNCATED
          // file at filePath — and everything downstream then treats it as
          // real: existsSync is true so this rehydrate never runs again, and
          // the route serves the broken bytes with Cache-Control immutable.
          // A merchant's Kept ad would be permanently half an image.
          //
          // rename(2) within the same directory is atomic, so a reader sees
          // either no file or the whole file, never part of one.
          const tmpPath = `${filePath}.rehydrating-${process.pid}-${Date.now()}`;
          try {
            fs.writeFileSync(tmpPath, obj.buf);
            fs.renameSync(tmpPath, filePath);
          } catch (err) {
            try { fs.rmSync(tmpPath, { force: true }); } catch { /* nothing to clean */ }
            throw err;
          }
        } catch (e) {
          // If we can't write locally (disk full), still serve from memory.
          console.error("[renders] rehydrate write failed:", e instanceof Error ? e.message : e);
          const mime = obj.contentType;
          return new Response(new Uint8Array(obj.buf), {
            headers: { "Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000, immutable", "Content-Length": String(obj.buf.length) },
          });
        }
      }
    }
    if (!fs.existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }
    const size = fs.statSync(filePath).size;
    const ext = name.split(".").pop() as string;
    const mime = ext === "mp4" ? "video/mp4" : ext === "mp3" ? "audio/mpeg" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
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
        return new Response(new Uint8Array(buf), {
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
    return new Response(new Uint8Array(buf), { headers: { ...baseHeaders, "Content-Length": String(size) } });
  } catch (e) {
    console.error("[renders] serve failed:", e);
    return new Response("Server error", { status: 500 });
  }
};
