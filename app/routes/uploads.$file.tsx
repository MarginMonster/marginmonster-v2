/* Serves merchant-uploaded product photos (web studio "upload a photo").
 * Files live on the persistent disk under data/renders/uploads and must be
 * publicly fetchable — the render engines pull them by URL. Name-allowlisted,
 * read-only, immutable cache. */

import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";
import { isServableUploadName } from "../lib/upload-names";

const TYPE: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const name = params.file || "";
  if (!isServableUploadName(name)) return new Response("Not found", { status: 404 });
  const p = path.join(process.cwd(), "data", "renders", "uploads", name);
  if (!fs.existsSync(p)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(p)), {
    headers: {
      "Content-Type": TYPE[name.split(".").pop() || "jpg"],
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
