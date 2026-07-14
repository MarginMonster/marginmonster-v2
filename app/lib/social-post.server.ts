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
};

/** THE integration point. Return { ok: true } only on real platform success. */
async function publishContent(
  _platforms: { meta: boolean; tiktok: boolean },
  _item: Publishable
): Promise<{ ok: boolean; pending?: string }> {
  // TODO(next track): TikTok Content Posting API + Meta Graph publishing.
  // Requires platform app credentials + review; see project memory.
  return { ok: false, pending: "platform-api" };
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

    // connected platforms per shop (one query for all)
    const shopIds = [...new Set(active.map((q) => q.shopId))];
    const accounts = await db.adAccount.findMany({
      where: { shopId: { in: shopIds } },
      select: { shopId: true, platform: true },
    });
    const connected = new Map<string, { meta: boolean; tiktok: boolean }>();
    for (const a of accounts) {
      const c = connected.get(a.shopId) || { meta: false, tiktok: false };
      if (a.platform === "META") c.meta = true;
      if (a.platform === "TIKTOK") c.tiktok = true;
      connected.set(a.shopId, c);
    }

    let due = 0;
    let posted = 0;
    for (const q of active) {
      const schedule = parseSchedule(q.scheduleJson);
      let changed = false;
      for (const s of schedule.slots) {
        if (s.status !== "READY") continue;
        if (new Date(`${s.date}T${s.time}:00`).getTime() > now) continue;
        due++;
        const plats = connected.get(q.shopId);
        if (!plats || (!plats.meta && !plats.tiktok)) continue; // nothing to post to yet
        const res = await publishContent(plats, {
          shopId: q.shopId, questlineId: q.id, slotIdx: s.idx,
          type: s.type, productTitle: s.productTitle, topic: s.topic,
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
