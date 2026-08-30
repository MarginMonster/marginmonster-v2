/* Serves Ad Template assets: statue-preview tiles the merchants browse, and
 * the clean plates the staged generator references. Self-building — a request
 * for a missing preview kicks off its render; a neutral placeholder serves
 * until it's ready. Public, read-only, key-allowlisted. */

import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";
import { adTemplateFile, BOTTLE_VARIANTS, bottlePreviewFile, ctCoverFile, ensureAdTemplate, ensureAllAdTemplates, ensureAllFormatPreviews, ensureBottlePreview, ensureCtCover, ensureFormatPreview, ensurePhCover, formatPreviewFile, phCoverFile, statueFile } from "../lib/image-generation.server";
import { AD_TEMPLATE_BY_KEY } from "../lib/ad-templates";
import { AD_FORMAT_BY_KEY } from "../lib/ad-formats";
import { merchantBusy } from "../lib/art-throttle.server";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  // The stand-in bottle cutout — public so nano-banana can fetch it as an
  // input image when forging format previews.
  if (params.file === "statue.png") {
    const s = statueFile();
    if (!s) return new Response("Not ready", { status: 404 });
    return new Response(new Uint8Array(fs.readFileSync(s)), {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=600" },
    });
  }

  // AD FORMAT previews — each a genuinely different composition, each starring
  // a different EasyMode hero product. While a format forges, the colorblock
  // preview stands in (no-store so the real one takes over).
  const fm = (params.file || "").match(/^format-([a-z]+)\.jpg$/);
  if (fm && AD_FORMAT_BY_KEY[fm[1]]) {
    const key = fm[1];
    const real = formatPreviewFile(key);
    if (real) {
      return new Response(new Uint8Array(fs.readFileSync(real)), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=600" },
      });
    }
    if (!(await merchantBusy())) ensureFormatPreview(key);
    ensureAllFormatPreviews().catch(() => { /* best-effort */ });
    const stand = adTemplateFile("preview", "colorblock");
    if (stand) {
      return new Response(new Uint8Array(fs.readFileSync(stand)), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
      });
    }
    const fbPh = path.join(process.cwd(), "public", "content-types", "ph.png");
    if (!fs.existsSync(fbPh)) return new Response("Not ready", { status: 404 });
    return new Response(new Uint8Array(fs.readFileSync(fbPh)), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  }
  // Bottle candidate previews — reviewable by direct link while they forge.
  const bm = (params.file || "").match(/^bottle-([a-z]+)\.jpg$/);
  if (bm && BOTTLE_VARIANTS[bm[1]]) {
    const real = bottlePreviewFile(bm[1]);
    if (real) {
      return new Response(new Uint8Array(fs.readFileSync(real)), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=600" },
      });
    }
    if (!(await merchantBusy())) ensureBottlePreview(bm[1]);
    return new Response("Rendering — refresh this link in ~30 seconds.", {
      status: 202, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", "Retry-After": "30" },
    });
  }
  // The Product Highlight cover — a cinematic hero shot of the EASYMODE
  // bottle, self-forged like everything else. Old static art serves while
  // it cooks (no-store so the upgrade appears the moment it lands).
  // Preset content-type covers (UGC Review / Unboxing / Satisfying Close-Up)
  // — self-forge like phcover; the Product Highlight art stands in meanwhile.
  const cc = (params.file || "").match(/^ctcover-(review|unboxing|asmr)\.jpg$/);
  if (cc) {
    const real = ctCoverFile(cc[1]);
    if (real) {
      return new Response(new Uint8Array(fs.readFileSync(real)), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=600" },
      });
    }
    if (!(await merchantBusy())) ensureCtCover(cc[1]);
    const stand = phCoverFile() || path.join(process.cwd(), "public", "content-types", "ph.png");
    if (!fs.existsSync(stand)) return new Response("Not ready", { status: 404 });
    return new Response(new Uint8Array(fs.readFileSync(stand)), {
      headers: { "Content-Type": stand.endsWith(".png") ? "image/png" : "image/jpeg", "Cache-Control": "no-store" },
    });
  }

  if (params.file === "phcover.jpg") {
    const real = phCoverFile();
    if (real) {
      return new Response(new Uint8Array(fs.readFileSync(real)), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=600" },
      });
    }
    if (!(await merchantBusy())) ensurePhCover();
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
  if (!(await merchantBusy())) ensureAdTemplate(key);
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
