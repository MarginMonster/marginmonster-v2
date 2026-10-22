import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "../db.server";
import { generateCartoonAd } from "~/lib/cartoon-ad-pipeline.server";

/* TEMPORARY QA ROUTE — delete after the per-style cartoon test gens. Key-guarded;
 * calls generateCartoonAd directly (no token debit). ?go=avatar&style=<key>;
 * poll with ?poll=1; cleanup with ?cleanup=1. Asset title carries the style
 * name (recipe.name), so poll results are self-identifying. */
const KEY = "tt-7q2m9x4b";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== KEY) return new Response("not found", { status: 404 });

  if (url.searchParams.get("cleanup")) {
    const del = await db.asset.deleteMany({ where: { title: { contains: "ToonTest" } } });
    return Response.json({ deleted: del.count });
  }

  if (url.searchParams.get("poll")) {
    const rows = await db.asset.findMany({
      where: { title: { contains: "ToonTest" } },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, title: true, status: true, bodyJson: true, createdAt: true },
    });
    return Response.json(
      rows.map((r) => {
        let v: Record<string, unknown> = {};
        try { v = JSON.parse(r.bodyJson || "{}"); } catch { /* ignore */ }
        return { title: r.title, status: r.status, videoUrl: v.videoUrl, keyframeUrl: v.keyframeUrl, composeDbg: v.composeDbg, at: r.createdAt };
      })
    );
  }

  const go = url.searchParams.get("go");
  const style = url.searchParams.get("style") || "pixar";
  if (go !== "avatar") return Response.json({ error: "pass go=avatar&style=<key>, poll=1, or cleanup=1" }, { status: 400 });

  const shop = await db.shop.findFirst({ where: { brandProfile: { isNot: null } }, include: { brandProfile: true } });
  if (!shop?.brandProfile) return Response.json({ error: "no shop with a brandProfile" }, { status: 500 });

  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  void generateCartoonAd({
    shopId: shop.id,
    brandProfile: shop.brandProfile,
    productTitle: "ToonTest Sparkling Water",
    productDescription: "A crisp, lightly carbonated spring water in a slim 16oz can. Zero sugar, zero calories, a clean mineral finish.",
    productImageUrl: `${base}/_toontest-product.jpg`,
    styleKey: style,
    avatarId: "valentina",
    origin: "toontest",
  })
    .then((id) => console.log("[toontest]", style, "done", id))
    .catch((e) => console.error("[toontest]", style, "FAILED", e instanceof Error ? e.stack : e));

  return Response.json({ started: true, style, avatarId: "valentina" });
}
