import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "../db.server";
import { generateCartoonAd } from "~/lib/cartoon-ad-pipeline.server";

/* TEMPORARY QA ROUTE — delete after validating the cartoon+product change.
 * Key-guarded; calls generateCartoonAd directly (no token debit, just render
 * COGS). fire-and-forget; poll with ?poll=1; clean up with ?cleanup=1. */
const KEY = "tt-7q2m9x4b";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== KEY) return new Response("not found", { status: 404 });

  if (url.searchParams.get("cleanup")) {
    const del = await db.asset.deleteMany({ where: { title: { contains: "ToonTest" } } });
    return Response.json({ deleted: del.count });
  }

  if (url.searchParams.get("compose")) {
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    const productImageUrl = `${base}/_toontest-product.jpg`;
    const out: Record<string, unknown> = {};
    // Isolate resolveProductScale (the suspect) from the compose.
    let scaleHint: string | undefined;
    try {
      const { resolveProductScale } = await import("~/lib/product-scale.server");
      const hint = await resolveProductScale({ productTitle: "ToonTest Sparkling Water", productDescription: "A crisp, lightly carbonated spring water in a slim 16oz can.", productImageUrl });
      out.hint = hint; scaleHint = hint?.phrase;
    } catch (e) { out.scaleErr = e instanceof Error ? e.message : String(e); }
    try {
      const { composeHoldingFrames } = await import("~/lib/fal-image.server");
      out.frames = await composeHoldingFrames(`${base}/avatars/valentina_0.jpg`, productImageUrl, "ToonTest Sparkling Water", 1, "hold", undefined, scaleHint);
    } catch (e) { out.composeErr = e instanceof Error ? e.message : String(e); }
    return Response.json(out);
  }

  if (url.searchParams.get("poll")) {
    const rows = await db.asset.findMany({
      where: { title: { contains: "ToonTest" } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, title: true, status: true, bodyJson: true, createdAt: true },
    });
    return Response.json(
      rows.map((r) => {
        let v: Record<string, unknown> = {};
        try { v = JSON.parse(r.bodyJson || "{}"); } catch { /* ignore */ }
        return { id: r.id, title: r.title, status: r.status, videoUrl: v.videoUrl, keyframeUrl: v.keyframeUrl, engine: v.engine, composeDbg: v.composeDbg, script: v.script, at: r.createdAt };
      })
    );
  }

  const go = url.searchParams.get("go"); // "avatar" = presenter+product (the new path)
  if (go !== "avatar") return Response.json({ error: "pass go=avatar, poll=1, or cleanup=1" }, { status: 400 });

  const shop = await db.shop.findFirst({ where: { brandProfile: { isNot: null } }, include: { brandProfile: true } });
  if (!shop?.brandProfile) return Response.json({ error: "no shop with a brandProfile" }, { status: 500 });

  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");

  void generateCartoonAd({
    shopId: shop.id,
    brandProfile: shop.brandProfile,
    productTitle: "ToonTest Sparkling Water",
    productDescription: "A crisp, lightly carbonated spring water in a slim 16oz can. Zero sugar, zero calories, a clean mineral finish.",
    productImageUrl: `${base}/_toontest-product.jpg`,
    styleKey: "pixar",
    avatarId: "valentina", // presenter → compose holding product → cartoonize → omni → endcard
    origin: "toontest",
  })
    .then((id) => console.log("[toontest] done", id))
    .catch((e) => console.error("[toontest] FAILED", e instanceof Error ? e.stack : e));

  return Response.json({ started: true, shopId: shop.id, avatarId: "valentina", productImageUrl: `${base}/_toontest-product.jpg` });
}
