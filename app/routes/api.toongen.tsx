/* TEMPORARY dev route — fire a REAL cartoon gen on the production pipeline to
 * eyeball the new character-only + real-product-endcard behaviour. Key-gated.
 * Enqueues a GENERATE_VIDEO_AD(cartoon) job for an eligible shop as a FREE test
 * (prePaid+freeGen+chargedTokens:0 → no charge, no quota, no refund path), lets
 * the in-process worker run it end-to-end, and reports status + the video URL.
 * STRIP after. */
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "../db.server";
import { enqueueJob } from "../lib/job-queue.server";

const KEY = "toongen-7h2k9x4m-tmp";

export async function action({ request }: ActionFunctionArgs) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (String(body.key || "") !== KEY) return json({ error: "forbidden" }, { status: 403 });
  const op = String(body.op || "");
  try {
    if (op === "submit") {
      // An eligible shop: has a brand profile (the script writer needs it), an
      // active plan, and at least one catalogue product with a photo.
      const shop = await db.shop.findFirst({
        where: { brandProfile: { isNot: null }, activePlan: { is: { active: true } }, catalog: { some: { imageUrl: { not: null } } } },
        orderBy: { createdAt: "asc" },
        select: { id: true, domain: true },
      });
      if (!shop) return json({ error: "no eligible shop (brand profile + active plan + a product photo)" }, { status: 404 });
      const product = await db.catalogProduct.findFirst({
        where: { shopId: shop.id, imageUrl: { not: null } },
        orderBy: { position: "asc" },
        select: { title: true, imageUrl: true },
      });
      if (!product?.imageUrl) return json({ error: "no product photo" }, { status: 404 });
      const avatarId = String(body.avatarId || "mei");
      const cartoonStyle = String(body.cartoonStyle || "dreamanime");
      const jobId = await enqueueJob(shop.id, "GENERATE_VIDEO_AD", {
        contentType: "cartoon",
        productTitle: product.title,
        productImageUrl: product.imageUrl,
        avatarId,
        cartoonStyle,
        // FREE test: prePaid+freeGen means no charge, no video quota, no refund.
        prePaid: true,
        freeGen: true,
        chargedTokens: 0,
        initiator: "TEST",
      });
      return json({ jobId, shopId: shop.id, shop: shop.domain, product: product.title, avatarId, cartoonStyle });
    }
    if (op === "status") {
      const jobId = String(body.jobId || "");
      const job = await db.job.findUnique({ where: { id: jobId }, select: { status: true, attempts: true, lastError: true, shopId: true, updatedAt: true } });
      if (!job) return json({ error: "no such job" }, { status: 404 });
      let videoUrl: string | null = null;
      let assetId: string | null = null;
      if (job.status === "COMPLETED") {
        const asset = await db.asset.findFirst({
          where: { shopId: job.shopId, type: "VIDEO_AD", title: { contains: "cartoon" } },
          orderBy: { createdAt: "desc" },
          select: { id: true, bodyJson: true },
        });
        if (asset) { try { videoUrl = (JSON.parse(asset.bodyJson || "{}") as { videoUrl?: string }).videoUrl || null; assetId = asset.id; } catch { /* */ } }
      }
      return json({ status: job.status, attempts: job.attempts, error: job.lastError ? String(job.lastError).slice(0, 220) : null, ageMin: Math.round((Date.now() - job.updatedAt.getTime()) / 60000), videoUrl, assetId });
    }
    return json({ error: "bad op" }, { status: 400 });
  } catch (e) {
    return json({ error: String((e as Error).message || e).slice(0, 300) }, { status: 500 });
  }
}

export const loader = () => json({ ok: false });
