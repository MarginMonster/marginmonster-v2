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
): Promise<{ ok: boolean; pending?: string; urls?: Record<string, string> }> {
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

  // ATTRIBUTION: the caption links through OUR /go turnstile, which counts
  // the click on this exact slot and forwards to the product with UTM tags —
  // the "which post made money" loop starts at this line.
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const goUrl = base ? `${base}/go/${item.questlineId}/${item.slotIdx}` : "";

  // AI caption + per-platform hashtags (cached on the asset after the first
  // spend). Falls back to the plain caption if generation fails — a post
  // never blocks on the writer.
  const isVideo = item.type === "video";
  const { getOrMakeCaptions, buildPostTitle, fallbackCaption } = await import("./social-caption.server");
  const captions = await getOrMakeCaptions(item.assetId, item.shopId, {
    productTitle: item.productTitle,
    topic: item.topic,
    isVideo,
    platforms,
  });
  const fbText = fallbackCaption({ productTitle: item.productTitle, topic: item.topic, isVideo, platforms }).text;

  // Each platform gets its own tailored caption + tag set, so we post
  // per-platform rather than one blanket call.
  const urls: Record<string, string> = {};
  let anyOk = false;
  let lastErr: string | undefined;
  for (const p of platforms) {
    const title = buildPostTitle(captions[p], goUrl, fbText);
    const res = await publishPost(profileKey, { title, mediaUrl, isVideo, platforms: [p] });
    if (res.ok) {
      anyOk = true;
      if (res.urls) Object.assign(urls, res.urls);
    } else {
      lastErr = res.error;
    }
  }
  return anyOk ? { ok: true, urls } : { ok: false, pending: lastErr };
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
      select: { id: true, domain: true, socialProfileKey: true, socialsJson: true },
    });
    const { linkedFromCache } = await import("./social-provider.server");
    const byShop = new Map(shops.map((s) => [s.id, { domain: s.domain, profileKey: s.socialProfileKey, linked: linkedFromCache(s.socialsJson) }]));

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

        // Blogs publish to the store's Online Store blog (SEO), not to socials —
        // no linked account required. This is the "Get Found" delivery path.
        if (s.type === "blog") {
          if (!s.assetId || !link?.domain) continue;
          const { publishBlogAsset } = await import("./blog-publish.server");
          const br = await publishBlogAsset(link.domain, s.assetId);
          if (br.ok) {
            s.status = "POSTED";
            if (br.url) s.postedUrls = { blog: br.url };
            changed = true;
            posted++;
          } else {
            console.log(`[blog-publish] slot ${q.id}#${s.idx} pending: ${br.error}`);
          }
          continue;
        }

        if (!link?.profileKey || link.linked.length === 0) continue; // nothing linked yet
        // Social Media Plans scope a plan to specific accounts — post only there.
        const targets = schedule.platforms?.length ? link.linked.filter((p) => schedule.platforms!.includes(p)) : link.linked;
        if (targets.length === 0) continue;
        const res = await publishContent(targets, link.profileKey, {
          shopId: q.shopId, questlineId: q.id, slotIdx: s.idx,
          type: s.type, productTitle: s.productTitle, topic: s.topic, assetId: s.assetId,
        });
        if (res.ok) {
          s.status = "POSTED";
          if (res.urls && Object.keys(res.urls).length) s.postedUrls = res.urls;
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
