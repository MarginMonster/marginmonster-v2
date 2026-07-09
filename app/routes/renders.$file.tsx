import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";

/* Streams assembled UGC ad videos from the runtime render directory.
 * (Runtime-generated files can't go in public/ — Vite copies that at build
 * time — so they live in data/renders and are served through this route.)
 * NOTE: Render's disk is ephemeral — files survive restarts within a deploy
 * but not redeploys. Durable storage (R2/S3) is the known follow-up. */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const name = params.file || "";
  if (!/^[a-zA-Z0-9_-]+\.mp4$/.test(name)) {
    throw new Response("Not found", { status: 404 });
  }
  const filePath = path.join(process.cwd(), "data", "renders", name);
  if (!fs.existsSync(filePath)) throw new Response("Not found", { status: 404 });
  const stat = fs.statSync(filePath);
  const stream = fs.createReadStream(filePath);
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
    },
  });
};
