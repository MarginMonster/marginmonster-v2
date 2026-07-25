/* Serves Ad Template assets: statue-preview tiles the merchants browse, and
 * the clean plates the staged generator references. Self-building — a request
 * for a missing preview kicks off its render; a neutral placeholder serves
 * until it's ready. Public, read-only, key-allowlisted. */

import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";
import { adTemplateFile, ensureAdTemplate, ensureAllAdTemplates } from "../lib/image-generation.server";
import { AD_TEMPLATE_BY_KEY } from "../lib/ad-templates";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const m = (params.file || "").match(/^(preview|plate)-([a-z]+)\.jpg$/);
  const kind = m?.[1] as "preview" | "plate" | undefined;
  const key = m?.[2] || "";
  if (!kind || !AD_TEMPLATE_BY_KEY[key]) return new Response("Not found", { status: 404 });

  const real = adTemplateFile(kind, key);
  if (real) {
    return new Response(new Uint8Array(fs.readFileSync(real)), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
    });
  }

  // Build it (and its siblings) in the background. Best available stand-in
  // while it cooks: the real plate (scene without the statue), then a generic.
  ensureAdTemplate(key);
  ensureAllAdTemplates().catch(() => { /* best-effort */ });
  const plate = adTemplateFile("plate", key);
  if (plate) {
    return new Response(new Uint8Array(fs.readFileSync(plate)), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
    });
  }
  const fb = path.join(process.cwd(), "public", "content-types", "ph.png");
  if (!fs.existsSync(fb)) return new Response("Not ready", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(fb)), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
};
