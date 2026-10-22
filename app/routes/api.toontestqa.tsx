import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "../db.server";
import { generateCartoonAd } from "~/lib/cartoon-ad-pipeline.server";

/* TEMPORARY QA ROUTE — delete right after the cartoon test gen (owner-requested
 * validation of the scrub + Option A no-presenter path). Guarded by a random
 * key so it can't be triggered by anyone else. Calls generateCartoonAd directly
 * (NOT through the queue), so it does NOT debit any merchant tokens — it only
 * costs raw render COGS. fire-and-forget; poll with ?poll=1. */
const KEY = "tt-7q2m9x4b";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== KEY) return new Response("not found", { status: 404 });

  if (url.searchParams.get("cleanup")) {
    // Remove the test assets this route created, so they don't clutter the
    // shop's gallery. Title-scoped to "ToonTest" — only our own artifacts.
    const del = await db.asset.deleteMany({ where: { title: { contains: "ToonTest" } } });
    return Response.json({ deleted: del.count });
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
        return { id: r.id, title: r.title, status: r.status, videoUrl: v.videoUrl, keyframeUrl: v.keyframeUrl, engine: v.engine, script: v.script, at: r.createdAt };
      })
    );
  }

  const go = url.searchParams.get("go"); // "solo" (no presenter, Option A) | "avatar" (presenter)
  if (go !== "solo" && go !== "avatar") return Response.json({ error: "pass go=solo|avatar or poll=1" }, { status: 400 });

  const shop = await db.shop.findFirst({ where: { brandProfile: { isNot: null } }, include: { brandProfile: true } });
  if (!shop?.brandProfile) return Response.json({ error: "no shop with a brandProfile" }, { status: 500 });

  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const productImageUrl = `${base}/_toontest-product.jpg`;
  const productTitle = go === "avatar" ? "ToonTest Host Sparkling Water" : "ToonTest Solo Sparkling Water";
  const productDescription =
    "A crisp, lightly carbonated spring water in a slim 16oz can. Zero sugar, zero calories, a clean mineral finish. Sold as a 12-pack.";

  // Minutes-long render — do NOT await (a loader can't hold the HTTP response
  // that long). Poll ?poll=1 for the finished asset.
  void generateCartoonAd({
    shopId: shop.id,
    brandProfile: shop.brandProfile,
    productTitle,
    productDescription,
    productImageUrl,
    styleKey: "pixar",
    avatarId: go === "avatar" ? "amara" : undefined,
    origin: "toontest",
  })
    .then((id) => console.log("[toontest] done", go, id))
    .catch((e) => console.error("[toontest] FAILED", go, e instanceof Error ? e.stack : e));

  return Response.json({ started: true, go, shopId: shop.id, productImageUrl, avatarId: go === "avatar" ? "amara" : null });
}
