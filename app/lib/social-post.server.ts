import { db } from "../db.server";
import { parseSchedule } from "./questlines";

/* The auto-posting engine (v0 scaffold).
 *
 * The campaign scheduler forges content ~24h early and marks slots READY.
 * This engine's job: when a READY slot's post time arrives AND the shop has
 * the platform connected, publish it and mark the slot POSTED.
 *
 * HONESTY RULE: a slot only ever becomes POSTED on a confirmed API success.
 * The publish call below is the single integration point for the TikTok
 * Content Posting API / Meta Content Publishing API — wire credentials +
 * calls there and the whole pipeline lights up end to end. Until then, due
 * slots stay READY and we just log the backlog (throttled).
 */

type Publishable = {
  shopId: string;
  questlineId: string;
  slotIdx: number;
  type: string;
  productTitle: string;
  topic?: string;
  assetId?: string;
};

/** THE integration point — now live via the upload-post provider. Returns
 *  ok only on a confirmed provider success. Blogs aren't social posts (they
 *  publish to the store), so they're skipped here. */
async function publishContent(
  linked: string[],
  profileKey: string,
  item: Publishable
): Promise<{ ok: boolean; pending?: string }> {
  if (item.type === "blog") return { ok: false, pending: "blog-not-social" };
  if (!item.assetId) return { ok: false, pending: "no-asset" };
  const { publishPost, socialProviderEnabled } = await import("./social-provider.server");
  if (!socialProviderEnabled()) return { ok: false, pending: "provider-key" };

  const asset = await db.asset.findUnique({ where: { id: item.assetId }, select: { bodyJson: true } });
  if (!asset) return { ok: false, pending: "asset-missing" };
  let mediaUrl: string | undefined;
  try {
    const body = JSON.parse(asset.bodyJson);
    mediaUrl = body.videoUrl || body.imageUrl || body.url;
  } catch { /* fall through */ }
  if (!mediaUrl) return { ok: false, pending: "no-media" };

  const platforms = linked.filter((p) => ["tiktok", "instagram", "facebook"].includes(p));
  if (platforms.length === 0) return { ok: false, pending: "no-platforms" };

  const title = `${item.productTitle}${item.topic ? ` — ${item.topic}` : ""}`.trim() || "New from our shop";
  const res = await publishPost(profileKey, {
    title,
    mediaUrl,
    isVideo: item.type === "video",
    platforms,
  });
  return res.ok ? { ok: true } : { ok: false, pending: res.error };
}

let lastScan = 0;
const SCAN_EVERY_MS = 5 * 60_000;

/** Called from the worker tick. Cheap, throttled, and never lies. */
export async function postDueSlots(): Promise<void> {
  const now = Date.now();
  if (now - lastScan < SCAN_EVERY_MS) return;
  lastScan = now;

  try {
    const active = await db.questline.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, shopId: true, scheduleJson: true },
    });
    if (active.length === 0) return;

    // provider link state per shop (from the cached socialsJson)
    const shopIds = [...new Set(active.map((q) => q.shopId))];
    const shops = await db.shop.findMany({
      where: { id: { in: shopIds } },
      select: { id: true, socialProfileKey: true, socialsJson: true },
    });
    const { linkedFromCache } = await import("./social-provider.server");
    const byShop = new Map(shops.map((s) => [s.id, { profileKey: s.socialProfileKey, linked: linkedFromCache(s.socialsJson) }]));

    let due = 0;
    let posted = 0;
    for (const q of active) {
      const schedule = parseSchedule(q.scheduleJson);
      let changed = false;
      for (const s of schedule.slots) {
        if (s.status !== "READY") continue;
        if (new Date(`${s.date}T${s.time}:00`).getTime() > now) continue;
        due++;
        const link = byShop.get(q.shopId);
        if (!link?.profileKey || link.linked.length === 0) continue; // nothing linked yet
        const res = await publishContent(link.linked, link.profileKey, {
          shopId: q.shopId, questlineId: q.id, slotIdx: s.idx,
          type: s.type, productTitle: s.productTitle, topic: s.topic, assetId: s.assetId,
        });
        if (res.ok) {
          s.status = "POSTED";
          changed = true;
          posted++;
        }
      }
      if (changed) {
        await db.questline.update({ where: { id: q.id }, data: { scheduleJson: JSON.stringify(schedule) } });
      }
    }
    if (due > 0) {
      console.log(`[social-post] ${due} slot(s) past post time (${posted} posted; publisher pending platform APIs)`);
    }
  } catch (e) {
    console.error("[social-post] scan failed (non-fatal):", e);
  }
}
