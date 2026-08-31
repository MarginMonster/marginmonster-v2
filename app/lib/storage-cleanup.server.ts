import { db } from "../db.server";
import fs from "node:fs";
import path from "node:path";
import { parseSchedule } from "./questlines";
import { deleteObject, renderKey } from "./object-storage.server";

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

/** The pre-overlay stills nothing ever points at.
 *
 * overlayAdText writes "<name>-ad.jpg" beside the clean "<name>.jpg" and the
 * asset records only the overlaid file. The clean still is therefore orphaned
 * the instant it is made: no row names it, and the sweep above only deletes
 * files an asset names. That is a second full-size JPEG per image ad sitting
 * on the renders disk forever — which is also the disk the headroom warning
 * above is watching.
 *
 * Deliberately narrow. A file qualifies only if its overlaid twin exists
 * (proving it was a source rather than a delivered ad), it is old enough that
 * nothing in flight could want it, and no asset mentions it — an ad that
 * shipped WITHOUT the overlay is named by its own asset and stays. Custom
 * avatars, ad-template art and every other file on the disk are never
 * candidates, and subdirectories are skipped outright.
 */
const ORPHAN_GRACE_DAYS = 7;
const ORPHAN_PER_SWEEP = 100;

async function purgeOverlaySources(rendersDir: string, now: number): Promise<void> {
  let names: string[];
  try { names = fs.readdirSync(rendersDir); } catch { return; }
  const present = new Set(names);
  const cutoff = now - ORPHAN_GRACE_DAYS * 86_400_000;

  const candidates: string[] = [];
  for (const n of names) {
    if (!n.endsWith(".jpg") || n.endsWith("-ad.jpg")) continue;
    if (!present.has(n.replace(/.jpg$/, "-ad.jpg"))) continue; // no overlaid twin — not a source
    try {
      const st = fs.statSync(path.join(rendersDir, n));
      if (st.isFile() && st.mtimeMs < cutoff) candidates.push(n);
    } catch { /* vanished mid-sweep */ }
    if (candidates.length >= ORPHAN_PER_SWEEP) break;
  }
  if (!candidates.length) return;

  let freed = 0;
  for (const n of candidates) {
    try {
      if (await db.asset.count({ where: { bodyJson: { contains: `/renders/${n}` } } })) continue;
      const fp = path.join(rendersDir, n);
      if (!fp.startsWith(rendersDir)) continue;
      fs.rmSync(fp, { force: true });
      try { await deleteObject(renderKey(n)); } catch { /* non-fatal */ }
      freed++;
    } catch { /* ignore one bad file */ }
  }
  if (freed) console.log(`[storage-cleanup] removed ${freed} orphaned pre-overlay still(s)`);
}

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

  // Runs before the early returns below — orphans exist whether or not there
  // is any stale asset to clear this round.
  await purgeOverlaySources(rendersDir, now);

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

    // DELETE THE ROW FIRST, AND ONLY UNLINK WHAT THE DELETE ACTUALLY CLAIMED.
    //
    // This snapshotted up to 1000 PENDING rows, then unlinked every render
    // file — from disk AND from object storage, each an awaited network call —
    // and only afterwards deleted the rows, keyed on id alone. A merchant who
    // pressed Keep during that window (the Archive marks the asset APPROVED,
    // which is not PENDING) had their file destroyed anyway: the unlink did
    // not re-check, and the final deleteMany did not either. The one action
    // the whole 30-day countdown tells them to take could lose the thing it
    // was meant to save.
    //
    // Per row now: the status-guarded delete IS the claim, and the bytes go
    // only when it wins. The exposure shrinks from a whole sweep to one asset.
    let cleared = 0;
    for (const a of doomed) {
      try {
        const { count } = await db.asset.deleteMany({ where: { id: a.id, status: "PENDING" } });
        if (count !== 1) continue; // Kept, posted or already gone — leave the file alone
        cleared++;
        const b = JSON.parse(a.bodyJson || "{}");
        for (const u of [b.videoUrl, b.imageUrl]) {
          if (typeof u === "string" && u.startsWith("/renders/")) {
            const base = path.basename(u);
            const fp = path.join(rendersDir, base);
            if (fp.startsWith(rendersDir)) fs.rmSync(fp, { force: true });
            try { await deleteObject(renderKey(base)); } catch { /* non-fatal */ }
          }
        }
      } catch (e) { console.error(`[storage-cleanup] row ${a.id} failed (non-fatal):`, e); }
    }

    if (cleared) console.log(`[storage-cleanup] cleared ${cleared} un-kept media asset(s) older than ${CACHE_DAYS}d`);
  } catch (e) {
    console.error("[storage-cleanup] sweep failed (non-fatal):", e);
  }
}
