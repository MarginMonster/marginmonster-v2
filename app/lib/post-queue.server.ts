/* The posting queue — "Add any piece to your queue and it posts itself at the next good time."
 *
 * Rows are ScheduledPost. PENDING waits for its dueAt; the worker CLAIMS a due row (PENDING → POSTING,
 * conditional), posts it through postAssetToSocials — the Archive's own Post button — and records POSTED
 * or FAILED. The slot maths is pure and lives in post-queue.ts.
 *
 * THIS POSTS PUBLICLY TO PEOPLE'S REAL ACCOUNTS. A post cannot be taken back, so the one rule above all
 * others here is: never send the same row twice.
 *
 *   - The read is not the claim. Only the caller whose updateMany flips PENDING → POSTING (count === 1)
 *     may post; every other tick, instance or overlapping drain moves on.
 *   - A row left in POSTING (a crash or a deploy mid-post) is never put back to PENDING by the machine.
 *     After 15 minutes it becomes FAILED "interrupted" — unless the piece's own record shows it went out
 *     after the claim, in which case it is POSTED. Only the member can send an interrupted row again, and
 *     the page tells them to look at their accounts first.
 *   - Every write after the post is pinned to status POSTING, so a reaped or edited row is never
 *     overwritten blind.
 */

import { db } from "../db.server";
import { linkedFromCache, socialProviderEnabled } from "./social-provider.server";
import { cadenceOf } from "./creator-series.server";
import { POSTABLE_PLATFORMS, postAssetToSocials } from "./post-asset.server";
import { QUEUE_CAP, nextFreeSlots, normalizePerDay } from "./post-queue.ts";

/** A claimed row older than this is not slow, it is orphaned — see the header. */
export const POSTING_STUCK_MS = 15 * 60_000;
/** Due rows taken per tick, oldest first. */
const PER_TICK = 5;
/** The queue is looked at this often (the worker calls far more often; this keeps it to one query). */
const SCAN_EVERY_MS = 20_000;
/** A tick still running after this is wedged on a promise that will not settle; a fresh one may start
 *  (the claim makes an overlap harmless — it can only stop a second send, never cause one). */
const TICK_DEADLINE_MS = 20 * 60_000;

const ACTIVE = ["PENDING", "POSTING"];

function parseList(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// ── the worker side ──────────────────────────────────────────────────────────────────────────────────

let lastScan = 0;
let runningSince = 0;

/** Worker entry. Self-throttled, never throws. */
export async function tickPostQueue(): Promise<void> {
  const now = Date.now();
  if (runningSince && now - runningSince < TICK_DEADLINE_MS) return;
  if (now - lastScan < SCAN_EVERY_MS) return;
  lastScan = now;
  const mine = (runningSince = now);
  try {
    await settleInterrupted(now);
    const due = await db.scheduledPost.findMany({
      where: { status: "PENDING", dueAt: { lte: new Date(now) } },
      orderBy: { dueAt: "asc" },
      take: PER_TICK,
      select: { id: true, shopId: true, assetId: true, platformsJson: true, caption: true },
    });
    // One post per shop per tick: a backlog (the worker was down, accounts were just linked) drains at a
    // human pace instead of landing on someone's account as a burst.
    const shopsThisTick = new Set<string>();
    for (const row of due) {
      if (shopsThisTick.has(row.shopId)) continue;
      shopsThisTick.add(row.shopId);
      try {
        await sendOne(row);
      } catch (e) {
        console.error(`[post-queue] row ${row.id} (non-fatal):`, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.error("[post-queue] scan failed (non-fatal):", e);
  } finally {
    if (runningSince === mine) runningSince = 0;
  }
}

/** POSTING rows nobody finished. Never re-sent by the machine — see the header. */
async function settleInterrupted(now: number): Promise<void> {
  const stuck = await db.scheduledPost.findMany({
    where: { status: "POSTING", updatedAt: { lt: new Date(now - POSTING_STUCK_MS) } },
    select: { id: true, updatedAt: true, asset: { select: { metaJson: true } } },
    take: 20,
  });
  for (const row of stuck) {
    // The claim stamped updatedAt. If the piece's own record says it was posted after that, the post went
    // out and only our bookkeeping was lost: call it POSTED, with the links the piece kept.
    let postedAfterClaim = false;
    let urls: Record<string, string> | null = null;
    try {
      const m = JSON.parse(row.asset?.metaJson || "{}") as { postedAt?: string; postedUrls?: Record<string, string> };
      const at = m.postedAt ? Date.parse(m.postedAt) : NaN;
      if (Number.isFinite(at) && at >= row.updatedAt.getTime()) {
        postedAfterClaim = true;
        urls = m.postedUrls && typeof m.postedUrls === "object" ? m.postedUrls : null;
      }
    } catch { /* unknown — treated as interrupted */ }
    await db.scheduledPost.updateMany({
      where: { id: row.id, status: "POSTING", updatedAt: row.updatedAt },
      data: postedAfterClaim
        ? { status: "POSTED", postedAt: new Date(), urlsJson: urls ? JSON.stringify(urls) : null, error: null }
        : { status: "FAILED", error: "interrupted" },
    });
  }
}

async function sendOne(row: { id: string; shopId: string; assetId: string; platformsJson: string; caption: string | null }): Promise<void> {
  // CLAIM FIRST. The findMany above is a list of candidates, not a licence to post.
  const claimedAt = new Date();
  const claim = await db.scheduledPost.updateMany({
    where: { id: row.id, status: "PENDING" },
    data: { status: "POSTING", updatedAt: claimedAt },
  });
  if (claim.count !== 1) return; // someone else has it, or the member removed it a moment ago

  const fail = (error: string) =>
    db.scheduledPost.updateMany({ where: { id: row.id, status: "POSTING" }, data: { status: "FAILED", error: error.slice(0, 160) } });

  // Belt and braces against a doubled row (two adds racing across instances): if this same piece went out
  // from the queue in the last ten minutes, or is going out right now, do not send it again.
  const twin = await db.scheduledPost.findFirst({
    where: {
      shopId: row.shopId,
      assetId: row.assetId,
      id: { not: row.id },
      OR: [{ status: "POSTING" }, { status: "POSTED", postedAt: { gte: new Date(claimedAt.getTime() - 10 * 60_000) } }],
    },
    select: { id: true },
  });
  if (twin) { await fail("duplicate"); return; }

  let r: Awaited<ReturnType<typeof postAssetToSocials>>;
  try {
    r = await postAssetToSocials({ shopId: row.shopId, assetId: row.assetId, caption: row.caption, platforms: parseList(row.platformsJson) });
  } catch (e) {
    // postAssetToSocials only throws before its first publish (see its header), so nothing went out.
    console.error(`[post-queue] row ${row.id} threw before posting:`, e instanceof Error ? e.message : e);
    await fail("error");
    return;
  }
  if (!r.ok) {
    await fail(r.code === "failed" ? `failed:${r.error || "unknown"}` : r.code);
    return;
  }
  const done = {
    status: "POSTED",
    postedAt: new Date(),
    urlsJson: JSON.stringify(r.postedUrls),
    // Landed somewhere = posted. The networks that refused are kept so the row can say so.
    error: r.missed.length ? `missed:${r.missed.join(",")}` : null,
  };
  const w = await db.scheduledPost.updateMany({ where: { id: row.id, status: "POSTING" }, data: done });
  if (w.count === 1) return;
  // Reaped to FAILED, or retried to PENDING, while the post was in flight — it DID go out. Record that,
  // so a pending retry is not sent a second time. (A retry already re-claimed and posting cannot be
  // stopped from here; the twin check above stops its next attempt.)
  await db.scheduledPost.updateMany({ where: { id: row.id, status: { in: ["FAILED", "PENDING"] } }, data: done });
}

// ── the member side (every call scoped by shopId) ────────────────────────────────────────────────────

/** Adds on one shop never interleave in this process: two quick taps on "Add to queue" must not both
 *  see the piece as not-yet-queued and queue it twice. */
const shopLocks = new Map<string, Promise<unknown>>();
function withShopLock<T>(shopId: string, fn: () => Promise<T>): Promise<T> {
  const prev = shopLocks.get(shopId) || Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => undefined);
  shopLocks.set(shopId, tail);
  tail.then(() => { if (shopLocks.get(shopId) === tail) shopLocks.delete(shopId); });
  return next;
}

export type QueueAddResult =
  | { ok: true; queued: number; skipped: number; firstDueAt: string | null; lastDueAt: string | null }
  | { error: "provider-off" | "no-accounts" | "full" | "nothing" };

/** Queue pieces at the next free slots, in the order given. Already-waiting pieces are skipped. */
export async function queueAdd(shopId: string, assetIdsRaw: string): Promise<QueueAddResult> {
  const ids = [...new Set(String(assetIdsRaw || "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, QUEUE_CAP);
  if (!ids.length) return { error: "nothing" };
  if (!socialProviderEnabled()) return { error: "provider-off" };
  return withShopLock(shopId, async () => {
    const shop = await db.shop.findUnique({ where: { id: shopId }, select: { timezone: true, queuePerDay: true, socialsJson: true } });
    if (!shop) return { error: "nothing" as const };
    // The cache is enough to refuse here; the post itself refreshes live.
    if (!linkedFromCache(shop.socialsJson).some((p) => POSTABLE_PLATFORMS.includes(p))) return { error: "no-accounts" as const };

    const [assets, waiting] = await Promise.all([
      db.asset.findMany({ where: { id: { in: ids }, shopId, type: { in: ["VIDEO_AD", "IMAGE_AD"] } }, select: { id: true, bodyJson: true } }),
      db.scheduledPost.findMany({ where: { shopId, status: { in: ACTIVE } }, select: { assetId: true, dueAt: true } }),
    ]);
    const hasMedia = new Set(
      assets
        .filter((a) => {
          try { const b = JSON.parse(a.bodyJson || "{}"); return !!(b.videoUrl || b.imageUrl); } catch { return false; }
        })
        .map((a) => a.id)
    );
    const already = new Set(waiting.map((w) => w.assetId));
    const room = Math.max(0, QUEUE_CAP - waiting.length);
    const toAdd = ids.filter((id) => hasMedia.has(id) && !already.has(id)).slice(0, room);
    if (!toAdd.length) {
      if (room === 0 && ids.some((id) => hasMedia.has(id) && !already.has(id))) return { error: "full" as const };
      return { ok: true as const, queued: 0, skipped: ids.length, firstDueAt: null, lastDueAt: null };
    }
    const last = waiting.reduce<number | null>((m, w) => (m == null || w.dueAt.getTime() > m ? w.dueAt.getTime() : m), null);
    const slots = nextFreeSlots({
      now: Date.now(),
      tz: shop.timezone,
      perDay: shop.queuePerDay,
      count: toAdd.length,
      taken: waiting.map((w) => w.dueAt),
      after: last,
    });
    const rows = toAdd.slice(0, slots.length).map((assetId, i) => ({ shopId, assetId, dueAt: slots[i], status: "PENDING", platformsJson: "[]" }));
    if (rows.length) await db.scheduledPost.createMany({ data: rows });
    return {
      ok: true as const,
      queued: rows.length,
      skipped: ids.length - rows.length,
      firstDueAt: rows.length ? rows[0].dueAt.toISOString() : null,
      lastDueAt: rows.length ? rows[rows.length - 1].dueAt.toISOString() : null,
    };
  });
}

type Done = { ok: true } | { error: "not-found" | "posting" | "started" };

/** Take a waiting or failed piece out of the queue. A post in flight cannot be stopped. */
export async function queueRemove(shopId: string, id: string): Promise<Done> {
  const r = await db.scheduledPost.updateMany({ where: { id, shopId, status: { in: ["PENDING", "FAILED"] } }, data: { status: "CANCELLED" } });
  if (r.count === 1) return { ok: true };
  const row = await db.scheduledPost.findFirst({ where: { id, shopId }, select: { status: true } });
  return { error: row?.status === "POSTING" ? "posting" : "not-found" };
}

/** Due now: the worker sends it on its next pass (within a minute). The slot it leaves stays free. */
export async function queuePostNow(shopId: string, id: string): Promise<Done> {
  const r = await db.scheduledPost.updateMany({ where: { id, shopId, status: "PENDING" }, data: { dueAt: new Date() } });
  return r.count === 1 ? { ok: true } : { error: "not-found" };
}

/** A failed piece goes again now. An interrupted one may already be live — the page says so first. */
export async function queueRetry(shopId: string, id: string): Promise<Done> {
  const r = await db.scheduledPost.updateMany({
    where: { id, shopId, status: "FAILED" },
    data: { status: "PENDING", dueAt: new Date(), error: null },
  });
  return r.count === 1 ? { ok: true } : { error: "not-found" };
}

/** Posts per day, then every waiting piece re-slotted in the same order. */
export async function setQueuePerDay(shopId: string, n: unknown): Promise<Done> {
  const perDay = normalizePerDay(n);
  return withShopLock(shopId, async () => {
    const shop = await db.shop.update({ where: { id: shopId }, data: { queuePerDay: perDay }, select: { timezone: true } });
    const now = Date.now();
    // Only pieces still waiting for a future slot; a piece already due (or "Post now") is left to go.
    const rows = await db.scheduledPost.findMany({
      where: { shopId, status: "PENDING", dueAt: { gt: new Date(now) } },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      select: { id: true, dueAt: true },
    });
    const slots = nextFreeSlots({ now, tz: shop.timezone, perDay, count: rows.length });
    for (let i = 0; i < rows.length && i < slots.length; i++) {
      if (rows[i].dueAt.getTime() === slots[i].getTime()) continue;
      await db.scheduledPost.updateMany({
        where: { id: rows[i].id, shopId, status: "PENDING", dueAt: rows[i].dueAt },
        data: { dueAt: slots[i] },
      });
    }
    return { ok: true as const };
  });
}

/** Skip a running Channel's next drop: its next drop moves on by one cadence interval. Pinned to the
 *  nextRunAt read, so a drop the worker has just started is never skipped after the fact. */
export async function skipChannelDrop(shopId: string, seriesId: string): Promise<Done> {
  const s = await db.creatorSeries.findFirst({ where: { id: seriesId, shopId, status: "ACTIVE" }, select: { nextRunAt: true, cadence: true } });
  if (!s?.nextRunAt) return { error: "not-found" };
  const interval = cadenceOf(s.cadence).intervalHours * 3600_000;
  const r = await db.creatorSeries.updateMany({
    where: { id: seriesId, shopId, status: "ACTIVE", nextRunAt: s.nextRunAt },
    data: { nextRunAt: new Date(s.nextRunAt.getTime() + interval) },
  });
  return r.count === 1 ? { ok: true } : { error: "started" };
}

// ── what the page shows ──────────────────────────────────────────────────────────────────────────────

export type ComingUpRow = {
  kind: "piece" | "drop";
  id: string;
  status: string; // PENDING | POSTING | FAILED | POSTED | ACTIVE (a channel drop)
  at: string; // ISO — dueAt, nextRunAt, or postedAt
  title: string;
  thumb: string | null;
  isVideo: boolean;
  networks: string[];
  error: string | null;
  urls: Record<string, string>;
  autoPost?: boolean;
};

const thumbOf = (bodyJson: string | null | undefined): { thumb: string | null; isVideo: boolean } => {
  try {
    const b = JSON.parse(bodyJson || "{}") as { videoUrl?: string; imageUrl?: string };
    // A cached first-frame JPG for a video (as the Archive does), never the video itself.
    if (b.videoUrl) return { thumb: `/vthumb/${String(b.videoUrl).split("?")[0].split("/").pop()}`, isVideo: true };
    if (b.imageUrl) return { thumb: String(b.imageUrl), isVideo: false };
  } catch { /* none */ }
  return { thumb: null, isVideo: false };
};
const titleOf = (title: string | null, metaJson: string | null | undefined): string => {
  try { const m = JSON.parse(metaJson || "{}"); if (m.productTitle) return String(m.productTitle); } catch { /* ignore */ }
  return title || "Untitled";
};

/** Everything "Coming up" lists for one shop. */
export async function loadComingUp(shopId: string, linked: string[]): Promise<{ upcoming: ComingUpRow[]; failed: ComingUpRow[]; posted: ComingUpRow[] }> {
  const now = Date.now();
  const assetSel = { select: { title: true, bodyJson: true, metaJson: true } } as const;
  const [waiting, failedRows, postedRows, drops] = await Promise.all([
    db.scheduledPost.findMany({ where: { shopId, status: { in: ACTIVE } }, orderBy: { dueAt: "asc" }, take: QUEUE_CAP + 10, include: { asset: assetSel } }),
    db.scheduledPost.findMany({ where: { shopId, status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 30, include: { asset: assetSel } }),
    db.scheduledPost.findMany({ where: { shopId, status: "POSTED", postedAt: { gte: new Date(now - 24 * 3600_000) } }, orderBy: { postedAt: "desc" }, take: 20, include: { asset: assetSel } }),
    db.creatorSeries.findMany({
      where: { shopId, status: "ACTIVE", nextRunAt: { not: null, lte: new Date(now + 7 * 24 * 3600_000) } },
      orderBy: { nextRunAt: "asc" },
      take: 20,
      select: { id: true, name: true, nextRunAt: true, platformsJson: true, autoPost: true },
    }),
  ]);
  const postable = linked.filter((p) => POSTABLE_PLATFORMS.includes(p));
  const piece = (r: (typeof waiting)[number], at: Date): ComingUpRow => {
    const want = parseList(r.platformsJson);
    let urls: Record<string, string> = {};
    try { const u = JSON.parse(r.urlsJson || "{}"); if (u && typeof u === "object") urls = u; } catch { /* none */ }
    return {
      kind: "piece", id: r.id, status: r.status, at: at.toISOString(),
      title: titleOf(r.asset.title, r.asset.metaJson), ...thumbOf(r.asset.bodyJson),
      networks: r.status === "POSTED" ? Object.keys(urls) : want.length ? want.filter((p) => postable.includes(p)) : postable,
      error: r.error, urls,
    };
  };
  const upcoming: ComingUpRow[] = [
    ...waiting.map((r) => piece(r, r.dueAt)),
    ...drops.map((s): ComingUpRow => {
      const want = parseList(s.platformsJson);
      return {
        kind: "drop", id: s.id, status: "ACTIVE", at: (s.nextRunAt as Date).toISOString(), title: s.name, thumb: null, isVideo: true,
        networks: s.autoPost ? (want.length ? want.filter((p) => postable.includes(p)) : postable) : [],
        error: null, urls: {}, autoPost: s.autoPost,
      };
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return {
    upcoming,
    failed: failedRows.map((r) => piece(r, r.updatedAt)),
    posted: postedRows.map((r) => piece(r, r.postedAt || r.updatedAt)),
  };
}
