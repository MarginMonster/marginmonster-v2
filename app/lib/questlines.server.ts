import { db } from "../db.server";
import { spendTokens, refundTokens } from "./tokens.server";
import { awardXp, unlockAchievement, checkLevelAchievements } from "./xp.server";
import { enqueueJob } from "./job-queue.server";
import { TOKEN_COST } from "./plan-config";
import {
  QUESTLINE_BY_KEY, questlineTokenCost, questlineCostFor, spotName, parseSchedule,
  QUEST_DURATION_DAYS, type ObjectiveType, type QuestSlot, type QuestSchedule,
} from "./questlines";

/* Questline orchestration — 30-day expeditions. Accepting charges the full
 * token cost upfront, then the scheduler lays every deliverable onto the
 * calendar with a smart posting slot and a named map destination. Content
 * jobs run ~24h before their post date (drip, not dump); each completion
 * marks its map slot READY, drips XP, and pays weekly + completion bonuses. */

type Objective = { key: string; label: string; type: ObjectiveType; target: number; done: number };
type BagItem = { title: string; image: string | null; url?: string | null };

const GEN_LEAD_MS = 24 * 60 * 60 * 1000; // forge content a day before its slot
const WEEK_BONUS_XP = 100;

/* Platform-smart posting times per content type (heuristics now; learned
 * times when the platform metrics APIs land). */
const POST_TIME: Record<ObjectiveType, string> = {
  video: "19:00", // evening scroll peak
  image: "12:00", // lunch break
  blog: "09:00", // morning coffee reads
  post: "19:00",
};

/** Lay the quest's deliverables across the monthly segment: front-load
 *  slightly (first drop on day 2), space evenly, interleave types so the
 *  calendar feels varied, round-robin backpack items for even coverage. */
export function buildSchedule(templateKey: string, bag: BagItem[], start: Date): QuestSlot[] {
  const def = QUESTLINE_BY_KEY[templateKey];
  if (!def) return [];
  // Expand content objectives (posts mirror content, they don't get own slots)
  const pieces: ObjectiveType[] = [];
  for (const o of def.objectives) {
    if (o.type === "post") continue;
    for (let i = 0; i < o.target; i++) pieces.push(o.type);
  }
  // Interleave types: sort by fractional position within their own type count
  const counts: Record<string, number> = {};
  const seen: Record<string, number> = {};
  for (const p of pieces) counts[p] = (counts[p] || 0) + 1;
  const ordered = pieces
    .map((t) => {
      const pos = (seen[t] = (seen[t] || 0) + 1);
      return { t, k: pos / (counts[t] + 1) };
    })
    .sort((a, b) => a.k - b.k)
    .map((x) => x.t);

  const n = ordered.length;
  const spotCounters: Record<string, number> = {};
  return ordered.map((type, i) => {
    // days 2 .. duration-2, evenly spaced
    const day = Math.min(QUEST_DURATION_DAYS - 1, Math.max(2, Math.round(2 + (i * (QUEST_DURATION_DAYS - 4)) / Math.max(1, n - 1))));
    const date = new Date(start.getTime() + (day - 1) * 24 * 60 * 60 * 1000);
    const item = bag[i % Math.max(1, bag.length)] || { title: "", image: null };
    const sn = spotCounters[type] = (spotCounters[type] || 0);
    spotCounters[type]++;
    return {
      idx: i,
      day,
      date: date.toISOString().slice(0, 10),
      time: POST_TIME[type],
      type,
      spot: spotName(type, sn),
      productTitle: item.title,
      productImageUrl: item.image,
      productUrl: item.url || null,
      status: "SCHEDULED" as const,
    };
  });
}

function slotRunAt(slot: QuestSlot): Date {
  const post = new Date(`${slot.date}T${slot.time}:00`);
  const runAt = new Date(post.getTime() - GEN_LEAD_MS);
  return runAt.getTime() < Date.now() ? new Date() : runAt;
}

export async function acceptQuestline(params: {
  shopId: string;
  templateKey: string;
  avatarId: string | null;
  avatarVariant: number;
  reviewMode: "REVIEW_FIRST" | "SET_AND_FORGET";
  bag: BagItem[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const def = QUESTLINE_BY_KEY[params.templateKey];
  if (!def) return { ok: false, error: "Unknown questline." };
  const bag = (params.bag || []).filter((b) => b.title?.trim()).slice(0, def.bagSize);
  if (bag.length === 0) return { ok: false, error: "Equip at least one item in the backpack." };

  const shop = await db.shop.findUnique({ where: { id: params.shopId }, include: { activePlan: true } });
  if (!shop?.activePlan) return { ok: false, error: "Choose a plan first to run questlines." };
  if (!shop.activePlan.active) return { ok: false, error: "Your subscription is paused — resubscribe on the Packages page to launch campaigns." };

  const cost = questlineCostFor(def, shop.activePlan.type); // Scale price break applies here
  try {
    await spendTokens(params.shopId, cost); // the whole month, reserved upfront
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Not enough tokens." };
  }

  const objectives: Objective[] = def.objectives.map((o, i) => ({
    key: `${o.type}-${i}`, label: o.label, type: o.type, target: o.target, done: 0,
  }));
  const slots = buildSchedule(def.key, bag, new Date());
  const schedule: QuestSchedule = { slots, weeksAwarded: [] };

  const q = await db.questline.create({
    data: {
      shopId: params.shopId,
      template: def.key,
      name: def.name,
      status: "ACTIVE",
      avatarId: params.avatarId,
      avatarVariant: params.avatarVariant,
      reviewMode: params.reviewMode,
      productTitle: bag.length === 1 ? bag[0].title : `${bag.length} items`,
      productImageUrl: bag[0].image || null,
      objectivesJson: JSON.stringify(objectives),
      scheduleJson: JSON.stringify(schedule),
      durationDays: QUEST_DURATION_DAYS,
      tokenCost: cost,
      xpReward: def.xpReward,
      progress: 0,
    },
  });

  // One PRE-PAID job per slot, scheduled to forge ~24h before its post time —
  // except the FIRST video, which forges IMMEDIATELY so the merchant sees a
  // finished take within minutes of signing (the demo moment).
  let firstVideoBoosted = false;
  for (const slot of slots) {
    const objective = objectives.find((o) => o.type === slot.type);
    const base = {
      productTitle: slot.productTitle,
      productImageUrl: slot.productImageUrl || undefined,
      questlineId: q.id,
      objectiveKey: objective?.key,
      slotIdx: slot.idx,
      prePaid: true,
    };
    let runAt = slotRunAt(slot);
    if (slot.type === "video" && !firstVideoBoosted) { firstVideoBoosted = true; runAt = new Date(); }
    if (slot.type === "video") {
      // holdProduct: campaign drips auto-compose the presenter holding the
      // product (hands-off in-hand demos; falls back to plain portrait)
      await enqueueJob(params.shopId, "GENERATE_VIDEO_AD", {
        ...base, avatarId: params.avatarId || undefined, avatarVariant: params.avatarVariant, holdProduct: true,
      }, runAt);
    } else if (slot.type === "image") {
      await enqueueJob(params.shopId, "GENERATE_IMAGE_AD", base, runAt);
    } else if (slot.type === "blog") {
      await enqueueJob(params.shopId, "GENERATE_BLOG_POST", base, runAt);
    }
  }

  // voyage achievements: first launch + running a fleet of 2 at once
  try {
    const running = await db.questline.count({ where: { shopId: params.shopId, status: { notIn: ["COMPLETE"] } } });
    await unlockAchievement(params.shopId, "FIRST_VOYAGE");
    if (running >= 2) await unlockAchievement(params.shopId, "FLEET_ADMIRAL");
  } catch { /* non-fatal */ }

  return { ok: true, id: q.id };
}

/** Reschedule a slot (map destinations are editable). Moves the post date/time
 *  and the pending generation job's runAt with it. */
export async function rescheduleSlot(shopId: string, questlineId: string, slotIdx: number, date: string, time: string): Promise<{ ok: boolean; error?: string }> {
  const q = await db.questline.findFirst({ where: { id: questlineId, shopId } });
  if (!q) return { ok: false, error: "Quest not found." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return { ok: false, error: "Bad date or time." };
  const schedule = parseSchedule(q.scheduleJson);
  const slot = schedule.slots.find((s) => s.idx === slotIdx);
  if (!slot) return { ok: false, error: "Stop not found." };
  if (slot.status === "READY" || slot.status === "POSTED") return { ok: false, error: "That content is already forged — its post slot can move, but it can't be re-generated." };

  slot.date = date;
  slot.time = time;
  const start = q.createdAt.getTime();
  slot.day = Math.max(1, Math.round((new Date(`${date}T00:00:00`).getTime() - start) / 86400000) + 1);
  await db.questline.update({ where: { id: q.id }, data: { scheduleJson: JSON.stringify(schedule) } });

  // Move the matching pending job's runAt
  try {
    const jobs = await db.job.findMany({ where: { shopId, status: "PENDING", payload: { contains: questlineId } } });
    for (const j of jobs) {
      try {
        const p = JSON.parse(j.payload);
        if (p.questlineId === questlineId && p.slotIdx === slotIdx) {
          await db.job.update({ where: { id: j.id }, data: { runAt: slotRunAt(slot) } });
        }
      } catch { /* skip */ }
    }
  } catch (e) {
    console.error("[questline] reschedule job move failed (non-fatal):", e);
  }
  return { ok: true };
}

/** Add an extra drop to a RUNNING campaign on a chosen day (clicked on the
 *  map). Charges tokens for the piece, appends the slot, grows the matching
 *  objective, and schedules the pre-paid forge job — fully automatic after. */
export async function addDrop(
  shopId: string, questlineId: string, day: number, type: "video" | "image" | "blog",
  opts: { instant?: boolean; productTitle?: string; direction?: string } = {}
): Promise<{ ok: boolean; error?: string; cost?: number }> {
  const q = await db.questline.findFirst({ where: { id: questlineId, shopId } });
  if (!q || q.status === "COMPLETE") return { ok: false, error: "Campaign not found or already complete." };
  const duration = q.durationDays || QUEST_DURATION_DAYS;
  const dayOf = Math.max(1, Math.min(duration, Math.floor((Date.now() - q.createdAt.getTime()) / 86400000) + 1));
  if (opts.instant) day = dayOf;
  if (day < dayOf || day > duration) return { ok: false, error: "Pick a day that's still ahead on this campaign." };

  const cost = type === "video" ? TOKEN_COST.video : type === "image" ? TOKEN_COST.image : TOKEN_COST.blog;
  try {
    await spendTokens(shopId, cost);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Not enough tokens." };
  }

  const schedule = parseSchedule(q.scheduleJson);
  const objectives: { key: string; label: string; type: string; target: number; done: number }[] = JSON.parse(q.objectivesJson);
  const idx = schedule.slots.reduce((m, s) => Math.max(m, s.idx), -1) + 1;
  const typeCount = schedule.slots.filter((s) => s.type === type).length;
  // rotate the bag: give the new drop the least-recently-used packed item
  const uniq: { title: string; image: string | null }[] = [];
  for (const s of schedule.slots) {
    if (s.productTitle && !uniq.some((u) => u.title === s.productTitle)) uniq.push({ title: s.productTitle, image: s.productImageUrl });
  }
  let item = uniq.length ? uniq[idx % uniq.length] : { title: q.productTitle || "", image: q.productImageUrl };
  if (opts.productTitle) {
    const picked = uniq.find((u) => u.title === opts.productTitle);
    if (picked) item = picked;
  }

  const date = new Date(q.createdAt.getTime() + (day - 1) * 86400000).toISOString().slice(0, 10);
  const nowHM = new Date().toISOString().slice(11, 16);
  const slot = {
    idx, day, date,
    time: opts.instant ? nowHM : type === "video" ? "19:00" : type === "blog" ? "09:00" : "12:00",
    type, spot: spotName(type, typeCount),
    productTitle: item.title, productImageUrl: item.image,
    status: "SCHEDULED" as const,
    topic: (opts.direction || "").trim().slice(0, 160) || undefined,
  };
  schedule.slots.push(slot);

  let obj = objectives.find((o) => o.type === type);
  if (obj) obj.target += 1;
  else {
    obj = { key: `${type}-x${idx}`, label: type === "video" ? "UGC videos with your Brand Face" : type === "image" ? "Scroll-stopping image ads" : "SEO blog posts", type, target: 1, done: 0 };
    objectives.push(obj);
  }
  const post = objectives.find((o) => o.type === "post");
  if (post) post.target += 1;
  const totalTarget = objectives.reduce((s, o) => s + o.target, 0);
  const totalDone = objectives.reduce((s, o) => s + o.done, 0);

  await db.questline.update({
    where: { id: q.id },
    data: {
      scheduleJson: JSON.stringify(schedule),
      objectivesJson: JSON.stringify(objectives),
      progress: totalTarget ? Math.round((totalDone / totalTarget) * 100) : 0,
    },
  });

  const direction = (opts.direction || "").trim().slice(0, 160) || undefined;
  const base = {
    productTitle: item.title, productImageUrl: item.image || undefined,
    // the merchant's topic steers the script/article (video: customPrompt,
    // blog: description; image gen picks it up when it learns directions)
    customPrompt: direction, productDescription: direction,
    questlineId: q.id, objectiveKey: obj.key, slotIdx: idx, prePaid: true,
  };
  const runAt = opts.instant ? new Date() : slotRunAt(slot);
  if (type === "video") {
    await enqueueJob(shopId, "GENERATE_VIDEO_AD", { ...base, avatarId: q.avatarId || undefined, avatarVariant: q.avatarVariant, holdProduct: true }, runAt);
  } else if (type === "image") {
    await enqueueJob(shopId, "GENERATE_IMAGE_AD", base, runAt);
  } else {
    await enqueueJob(shopId, "GENERATE_BLOG_POST", base, runAt);
  }
  return { ok: true, cost };
}

/** Swap a bag item mid-quest: every FUTURE (not yet forged) drop starring the
 *  old item now stars the new one. Forged content keeps its original star.
 *  Pending generation jobs are re-pointed too. */
export async function swapQuestlineItem(
  shopId: string, questlineId: string, fromTitle: string,
  to: { title: string; image: string | null }
): Promise<{ ok: boolean; swapped?: number; error?: string }> {
  const q = await db.questline.findFirst({ where: { id: questlineId, shopId } });
  if (!q) return { ok: false, error: "Quest not found." };
  if (!to.title?.trim()) return { ok: false, error: "Pick a replacement item." };
  const schedule = parseSchedule(q.scheduleJson);
  const changed = new Set<number>();
  for (const s of schedule.slots) {
    if (s.productTitle === fromTitle && (s.status === "SCHEDULED" || s.status === "FAILED")) {
      s.productTitle = to.title.trim();
      s.productImageUrl = to.image || null;
      changed.add(s.idx);
    }
  }
  if (changed.size === 0) return { ok: false, error: "Every drop starring that item is already forged — nothing left to swap." };

  await db.questline.update({
    where: { id: q.id },
    data: {
      scheduleJson: JSON.stringify(schedule),
      // keep the cover summary in step with the bag
      ...(q.productTitle === fromTitle ? { productTitle: to.title.trim(), productImageUrl: to.image || null } : {}),
    },
  });

  // Re-point the pending generation jobs for those slots.
  try {
    const jobs = await db.job.findMany({ where: { shopId, status: "PENDING", payload: { contains: questlineId } } });
    for (const j of jobs) {
      try {
        const p = JSON.parse(j.payload);
        if (p.questlineId === questlineId && typeof p.slotIdx === "number" && changed.has(p.slotIdx)) {
          p.productTitle = to.title.trim();
          p.productImageUrl = to.image || undefined;
          await db.job.update({ where: { id: j.id }, data: { payload: JSON.stringify(p) } });
        }
      } catch { /* skip */ }
    }
  } catch (e) {
    console.error("[questline] swap job re-point failed (non-fatal):", e);
  }
  return { ok: true, swapped: changed.size };
}

/** Abandon: refund tokens for slots whose content hasn't been generated yet
 *  (SCHEDULED with a still-pending job), cancel those jobs, delete the quest.
 *  Forged content stays in the library. */
export async function abandonQuestline(shopId: string, questlineId: string): Promise<{ ok: boolean; refunded: number }> {
  const q = await db.questline.findFirst({ where: { id: questlineId, shopId } });
  if (!q) return { ok: false, refunded: 0 };
  const schedule = parseSchedule(q.scheduleJson);
  let refund = 0;
  for (const s of schedule.slots) {
    if (s.status === "SCHEDULED") {
      refund += s.type === "video" ? TOKEN_COST.video : s.type === "image" ? TOKEN_COST.image : s.type === "blog" ? TOKEN_COST.blog : 0;
    }
  }
  // Cancel unstarted jobs for this quest
  try {
    const jobs = await db.job.findMany({ where: { shopId, status: "PENDING", payload: { contains: questlineId } } });
    for (const j of jobs) {
      try {
        const p = JSON.parse(j.payload);
        if (p.questlineId === questlineId) await db.job.delete({ where: { id: j.id } });
      } catch { /* skip */ }
    }
  } catch (e) {
    console.error("[questline] abandon job cleanup failed (non-fatal):", e);
  }
  if (refund > 0) {
    try { await refundTokens(shopId, refund); } catch (e) { console.error("[questline] refund failed:", e); refund = 0; }
  }
  await db.questline.delete({ where: { id: q.id } });
  return { ok: true, refunded: refund };
}

/** Called from the job queue when a questline-tagged content job finishes
 *  (ok=true) or permanently fails (ok=false). Marks the map slot, ticks the
 *  objective, drips step XP, pays weekly bonuses, and completes the quest +
 *  drops its reward when all content is done. Fully non-fatal. */
export async function onQuestlineObjectiveDone(questlineId: string, objectiveKey: string | undefined, shopId: string, slotIdx?: number, ok: boolean = true, assetId?: string): Promise<void> {
  try {
    const q = await db.questline.findUnique({ where: { id: questlineId } });
    if (!q || q.status === "COMPLETE") return;
    const objectives: Objective[] = JSON.parse(q.objectivesJson);
    const schedule = parseSchedule(q.scheduleJson);

    // Mark the map slot
    const slot = slotIdx != null ? schedule.slots.find((s) => s.idx === slotIdx) : undefined;
    if (slot) {
      slot.status = ok ? "READY" : "FAILED";
      if (ok && assetId) slot.assetId = assetId;
    }

    if (ok) {
      const obj = objectives.find((o) => o.key === objectiveKey);
      if (obj && obj.done < obj.target) obj.done += 1;
      // "post" objectives mirror content progress until platform posting lands.
      const post = objectives.find((o) => o.type === "post");
      if (post) {
        const contentDone = objectives.filter((o) => o.type !== "post").reduce((s, o) => s + o.done, 0);
        post.done = Math.min(post.target, contentDone);
      }
    }

    const totalTarget = objectives.reduce((s, o) => s + o.target, 0);
    const totalDone = objectives.reduce((s, o) => s + o.done, 0);
    const progress = totalTarget ? Math.round((totalDone / totalTarget) * 100) : 100;
    const contentObjs = objectives.filter((o) => o.type !== "post");
    const allContentDone = contentObjs.every((o) => o.done >= o.target);

    // Weekly bonus: all of a week's slots forged -> +100 XP, once per week.
    let weeklyBonus = 0;
    if (ok && slot) {
      const week = Math.ceil(slot.day / 7);
      if (!schedule.weeksAwarded.includes(week)) {
        const weekSlots = schedule.slots.filter((s) => Math.ceil(s.day / 7) === week);
        if (weekSlots.length > 0 && weekSlots.every((s) => s.status === "READY" || s.status === "POSTED")) {
          schedule.weeksAwarded.push(week);
          weeklyBonus = WEEK_BONUS_XP;
          try { await unlockAchievement(shopId, "PERFECT_WEEK"); } catch { /* non-fatal */ }
        }
      }
    }

    await db.questline.update({
      where: { id: questlineId },
      data: {
        objectivesJson: JSON.stringify(objectives),
        scheduleJson: JSON.stringify(schedule),
        progress,
        ...(allContentDone ? { status: "COMPLETE", completedAt: new Date() } : {}),
      },
    });

    if (ok) await awardXp(shopId, 25 + weeklyBonus);

    if (allContentDone) {
      const res = await awardXp(shopId, q.xpReward);
      if (res?.leveledUp) await checkLevelAchievements(shopId, res.level);
      await unlockAchievement(shopId, "QUEST_COMPLETE");
    }
  } catch (e) {
    console.error("[questline] progress update failed (non-fatal):", e);
  }
}
