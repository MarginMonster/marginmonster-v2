/* Serves Ad Template assets: statue-preview tiles the merchants browse, and
 * the clean plates the staged generator references. Self-building — a request
 * for a missing preview kicks off its render; a neutral placeholder serves
 * until it's ready. Public, read-only, key-allowlisted. */

import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";
import { adTemplateFile, ensureAdTemplate, ensureAllAdTemplates, ensurePhCover, phCoverFile } from "../lib/image-generation.server";
import { AD_TEMPLATE_BY_KEY } from "../lib/ad-templates";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  // The Product Highlight cover — a cinematic hero shot of the EASYMODE
  // bottle, self-forged like everything else. Old static art serves while
  // it cooks (no-store so the upgrade appears the moment it lands).
  if (params.file === "phcover.jpg") {
    const real = phCoverFile();
    if (real) {
      return new Response(new Uint8Array(fs.readFileSync(real)), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=600" },
      });
    }
    ensurePhCover();
    const fb = path.join(process.cwd(), "public", "content-types", "ph.png");
    if (!fs.existsSync(fb)) return new Response("Not ready", { status: 404 });
    return new Response(new Uint8Array(fs.readFileSync(fb)), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  }

  const m = (params.file || "").match(/^(preview|plate)-([a-z]+)\.jpg$/);
  const kind = m?.[1] as "preview" | "plate" | undefined;
  const key = m?.[2] || "";
  if (!kind || !AD_TEMPLATE_BY_KEY[key]) return new Response("Not found", { status: 404 });

  const real = adTemplateFile(kind, key);
  if (real) {
    return new Response(new Uint8Array(fs.readFileSync(real)), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=600" },
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
