import { db } from "../db.server";
import fs from "node:fs";
import path from "node:path";
import { parseSchedule } from "./questlines";

/* 30-day storage cache clear.
 *
 * Every generated video/photo lands in the Archive as PENDING. The merchant
 * either Keeps it (-> APPROVED), Posts it (-> PUBLISHED), or leaves it. Un-kept
 * media is just cache — it piles up on the renders disk and in the DB. This
 * sweep quietly clears PENDING media older than 30 days so storage stays lean,
 * WITHOUT ever deleting:
 *   - Kept (APPROVED) or Posted (PUBLISHED) content,
 *   - blogs (cheap text; they stay),
 *   - anything a plan still references (e.g. generated-early content waiting on
 *     its scheduled post).
 * Runs from the worker tick, self-throttled. Fully non-fatal.
 */

const CACHE_DAYS = 30;
const EVERY_MS = 6 * 60 * 60_000; // check a few times a day
let lastRun = 0;

export async function purgeStaleUnkept(): Promise<void> {
  const now = Date.now();
  if (now - lastRun < EVERY_MS) return;
  lastRun = now;

  const rendersDir = path.join(process.cwd(), "data", "renders");

  // Disk headroom watch — warn well before the renders disk fills so there's
  // time to grow it (or move to object storage) instead of renders failing.
  try {
    const st = fs.statfsSync(rendersDir);
    const totalGB = (st.blocks * st.bsize) / 1e9;
    const freeGB = (st.bavail * st.bsize) / 1e9;
    const usedPct = totalGB > 0 ? Math.round((1 - freeGB / totalGB) * 100) : 0;
    const line = `renders disk ${usedPct}% used (${freeGB.toFixed(1)}GB free of ${totalGB.toFixed(0)}GB)`;
    if (usedPct >= 80) console.warn(`[storage-cleanup] ⚠ ${line} — grow the disk or move to object storage soon`);
    else console.log(`[storage-cleanup] ${line}`);
  } catch { /* statfs unsupported on this platform — skip */ }

  try {
    const cutoff = new Date(now - CACHE_DAYS * 86_400_000);
    const stale = await db.asset.findMany({
      where: { type: { in: ["VIDEO_AD", "IMAGE_AD"] }, status: "PENDING", createdAt: { lt: cutoff } },
      select: { id: true, bodyJson: true, shopId: true },
      take: 1000,
    });
    if (!stale.length) return;

    // Protect any asset a questline slot still points at (scheduled/early drops).
    const shopIds = [...new Set(stale.map((a) => a.shopId))];
    const qls = await db.questline.findMany({ where: { shopId: { in: shopIds } }, select: { scheduleJson: true } });
    const referenced = new Set<string>();
    for (const q of qls) {
      for (const s of parseSchedule(q.scheduleJson).slots) {
        if (s.assetId) referenced.add(s.assetId);
      }
    }

    const doomed = stale.filter((a) => !referenced.has(a.id));
    if (!doomed.length) return;

    // Free the render files on disk before dropping the rows.
    for (const a of doomed) {
      try {
        const b = JSON.parse(a.bodyJson || "{}");
        for (const u of [b.videoUrl, b.imageUrl]) {
          if (typeof u === "string" && u.startsWith("/renders/")) {
            const fp = path.join(rendersDir, path.basename(u));
            if (fp.startsWith(rendersDir)) fs.rmSync(fp, { force: true });
          }
        }
      } catch { /* ignore a single bad row */ }
    }

    const res = await db.asset.deleteMany({ where: { id: { in: doomed.map((a) => a.id) } } });
    if (res.count) console.log(`[storage-cleanup] cleared ${res.count} un-kept media asset(s) older than ${CACHE_DAYS}d`);
  } catch (e) {
    console.error("[storage-cleanup] sweep failed (non-fatal):", e);
  }
}
