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
export function buildSchedule(
  templateKey: string,
  bag: BagItem[],
  start: Date,
  /** Content types this surface cannot actually deliver. The web app can't
   *  publish articles — there is no Online Store blog behind a
   *  web-<id>.easymode.app shop — so scheduling one would park a slot that
   *  retries every five minutes and never posts. Dropping it beats shipping
   *  a drop that can't land. */
  excludeTypes: ObjectiveType[] = []
): QuestSlot[] {
  const def = QUESTLINE_BY_KEY[templateKey];
  if (!def) return [];
  // Expand content objectives (posts mirror content, they don't get own slots)
  const pieces: ObjectiveType[] = [];
  for (const o of def.objectives) {
    if (o.type === "post") continue;
    if (excludeTypes.includes(o.type)) continue;
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
  platforms?: string[]; // Social Media Plans: post this plan ONLY to these accounts
  /** Content types the calling surface can't deliver — see buildSchedule.
   *  Excluded types are dropped from the schedule, the objectives AND the
   *  price: charging a month of articles to a shop that can never publish one
   *  would be taking money for nothing. */
  excludeTypes?: ObjectiveType[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const def = QUESTLINE_BY_KEY[params.templateKey];
  if (!def) return { ok: false, error: "Unknown questline." };
  const bag = (params.bag || []).filter((b) => b.title?.trim()).slice(0, def.bagSize);
  if (bag.length === 0) return { ok: false, error: "Equip at least one item in the backpack." };

  const shop = await db.shop.findUnique({ where: { id: params.shopId }, include: { activePlan: true } });
  if (!shop?.activePlan) return { ok: false, error: "Choose a plan first to run questlines." };
  if (!shop.activePlan.active) return { ok: false, error: "Your subscription is paused — resubscribe on the Packages page to launch campaigns." };

  // TIER GATE — before any money moves. A campaign containing videos needs
  // the video capability; without this, Starter shops would be charged and
  // then watch every video slot fail-and-refund at the worker.
  const { capabilitiesFor } = await import("./capabilities.server");
  const caps = capabilitiesFor(shop.activePlan);
  if (def.objectives.some((o) => o.type === "video" && o.target > 0) && !caps.has("video")) {
    return { ok: false, error: "This plan includes videos, which unlock on the Studio plan ($59/mo). Run Get Found on Starter, or upgrade to launch this one." };
  }

  const excluded = params.excludeTypes || [];
  const usable = def.objectives.filter((o) => !excluded.includes(o.type));
  if (!usable.some((o) => o.target > 0)) {
    return { ok: false, error: "Nothing in this plan can be posted to your connected accounts." };
  }
  // Price the plan we are ACTUALLY going to run, not the one on the shelf.
  const cost = excluded.length
    ? questlineCostFor({ ...def, objectives: usable }, shop.activePlan.type)
    : questlineCostFor(def, shop.activePlan.type); // top-tier price break applies here
  let acceptFromExtra = 0;
  try {
    // fromExtra is kept because a refund has to go back into the bucket it
    // came out of. Without it, purchased tokens return as monthly allowance
    // and expire at the next period roll — the merchant paid cash for those.
    acceptFromExtra = (await spendTokens(params.shopId, cost)).fromExtra; // the whole month, reserved upfront
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Not enough tokens." };
  }

  const objectives: Objective[] = usable.map((o, i) => ({
    key: `${o.type}-${i}`, label: o.label, type: o.type, target: o.target, done: 0,
  }));
  const slots = buildSchedule(def.key, bag, new Date(), excluded);
  const schedule: QuestSchedule = { slots, weeksAwarded: [], ...(params.platforms?.length ? { platforms: params.platforms } : {}) };

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
      tokenFromExtra: acceptFromExtra,
      xpReward: def.xpReward,
      progress: 0,
    },
  });

  // FORMAT VARIETY — campaign image drops rotate through the proven ad
  // formats instead of defaulting to the same poster every time. Variety is
  // what makes a month of content feel hand-made (and keeps feeds fresh).
  const FORMAT_ROTATION = [
    "callout", "review", "chat", "versus", "offer", "ugcframe", "beforeafter", "stat",
    "tweet", "notes", "search", "threereasons", "pricemath", "faq", "ingredients", "handheld", "breakout",
  ];
  let imgFormatIdx = 0;

  // SHOWSTOPPER DROPS — the campaign wow factor on the Anthem tier: with
  // enough videos in the month, the middle one becomes a Cartoon Avatar drop
  // and the FINAL one the product's sung Anthem (the month ends on the
  // banger). Same token price per video; only the generator changes — and
  // only when the tier actually unlocks it.
  const videoIdxs = slots.filter((s) => s.type === "video").map((s) => s.idx);
  const anthemIdx = caps.has("anthem") && videoIdxs.length >= 3 ? videoIdxs[videoIdxs.length - 1] : -1;
  const cartoonIdx = caps.has("cartoon") && videoIdxs.length >= 4 ? videoIdxs[Math.floor(videoIdxs.length / 2)] : -1;

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
      const contentType = slot.idx === anthemIdx ? "jingle" : slot.idx === cartoonIdx ? "cartoon" : undefined;
      // holdProduct: campaign drips auto-compose the presenter holding the
      // product (hands-off in-hand demos; falls back to plain portrait)
      await enqueueJob(params.shopId, "GENERATE_VIDEO_AD", {
        ...base, avatarId: params.avatarId || undefined, avatarVariant: params.avatarVariant,
        contentType, cartoonStyle: contentType === "cartoon" ? "pixar" : undefined,
        holdProduct: !contentType,
      }, runAt);
    } else if (slot.type === "image") {
      await enqueueJob(params.shopId, "GENERATE_IMAGE_AD", {
        ...base, formatKey: FORMAT_ROTATION[imgFormatIdx++ % FORMAT_ROTATION.length],
      }, runAt);
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
  opts: { instant?: boolean; productTitle?: string; direction?: string; time?: string } = {}
): Promise<{ ok: boolean; error?: string; cost?: number }> {
  const q = await db.questline.findFirst({ where: { id: questlineId, shopId } });
  if (!q || q.status === "COMPLETE") return { ok: false, error: "Campaign not found or already complete." };
  const duration = q.durationDays || QUEST_DURATION_DAYS;
  const dayOf = Math.max(1, Math.min(duration, Math.floor((Date.now() - q.createdAt.getTime()) / 86400000) + 1));
  if (opts.instant) day = dayOf;
  if (day < dayOf || day > duration) return { ok: false, error: "Pick a day that's still ahead on this campaign." };

  const cost = type === "video" ? TOKEN_COST.video : type === "image" ? TOKEN_COST.image : TOKEN_COST.blog;
  let addedFromExtra = 0;
  try {
    addedFromExtra = (await spendTokens(shopId, cost)).fromExtra;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Not enough tokens." };
  }
  // A drop added after accept is charged separately and starts SCHEDULED, so
  // it is refundable — but tokenCost only ever held the ACCEPT price, and
  // abandon caps the refund at tokenCost. Every later drop was therefore paid
  // for and silently kept on abandon. tokenCost is now the running total of
  // everything charged for content that has not been generated yet.
  await db.questline.update({
    where: { id: q.id },
    data: { tokenCost: { increment: cost }, tokenFromExtra: { increment: addedFromExtra } },
  });

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
  const defTime = type === "video" ? "19:00" : type === "blog" ? "09:00" : "12:00";
  const chosenTime = opts.time && /^\d{2}:\d{2}$/.test(opts.time) ? opts.time : defTime;
  const slot = {
    idx, day, date,
    time: opts.instant ? nowHM : chosenTime,
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

/** Schedule a single one-off drop with NO plan — spends tokens directly and
 *  runs through the same forge + auto-post pipeline. All one-offs for a shop
 *  accumulate in a hidden "One-off drops" container questline (template
 *  MANUAL) so they show on the calendar and post on schedule. */
export async function addManualDrop(
  shopId: string,
  params: { date: string; time: string; type: "video" | "image" | "blog"; direction?: string; product?: { title: string; image: string | null; url?: string | null }; platforms?: string[] }
): Promise<{ ok: boolean; error?: string; cost?: number }> {
  const { date, time, type } = params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return { ok: false, error: "Bad date or time." };
  if (!["video", "image", "blog"].includes(type)) return { ok: false, error: "Unknown content type." };
  const post = new Date(`${date}T${time}:00`);
  if (isNaN(post.getTime())) return { ok: false, error: "Bad date or time." };
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  if (post.getTime() < todayStart.getTime()) return { ok: false, error: "Pick a day that hasn't passed." };
  if (!params.product?.title?.trim()) return { ok: false, error: "Pick a product to feature." };

  const shop = await db.shop.findUnique({ where: { id: shopId }, include: { activePlan: true } });
  if (!shop) return { ok: false, error: "Shop not found." };

  const cost = type === "video" ? TOKEN_COST.video : type === "image" ? TOKEN_COST.image : TOKEN_COST.blog;
  let oneOffFromExtra = 0;
  try {
    oneOffFromExtra = (await spendTokens(shopId, cost)).fromExtra;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Not enough tokens." };
  }

  let q = await db.questline.findFirst({ where: { shopId, template: "MANUAL", status: "ACTIVE" } });
  // Every one-off drop is charged, so every one has to raise the container's
  // refundable total. Setting it only on CREATE would leave a container
  // holding ten scheduled drops claiming the price of one — and because the
  // abandon cap is skipped entirely while tokenCost is 0, that would refund
  // LESS than doing nothing at all.
  if (q) {
    await db.questline.update({
      where: { id: q.id },
      data: { tokenCost: { increment: cost }, tokenFromExtra: { increment: oneOffFromExtra } },
    });
    q = { ...q, tokenCost: q.tokenCost + cost, tokenFromExtra: q.tokenFromExtra + oneOffFromExtra };
  }
  if (!q) {
    q = await db.questline.create({
      data: {
        shopId, template: "MANUAL", name: "One-off drops", status: "ACTIVE",
        avatarId: shop.brandAvatarId, avatarVariant: shop.brandAvatarVariant ?? 0,
        reviewMode: "REVIEW_FIRST", productTitle: "", productImageUrl: null,
        objectivesJson: "[]", scheduleJson: JSON.stringify({ slots: [], weeksAwarded: [] }),
        durationDays: 3650, tokenCost: cost, tokenFromExtra: oneOffFromExtra, xpReward: 0, progress: 0,
      },
    });
  }

  const schedule = parseSchedule(q.scheduleJson);
  const objectives: { key: string; label: string; type: string; target: number; done: number }[] = JSON.parse(q.objectivesJson || "[]");
  const idx = schedule.slots.reduce((m, s) => Math.max(m, s.idx), -1) + 1;
  const typeCount = schedule.slots.filter((s) => s.type === type).length;
  const day = Math.max(1, Math.round((new Date(`${date}T00:00:00`).getTime() - q.createdAt.getTime()) / 86400000) + 1);
  const direction = (params.direction || "").trim().slice(0, 160) || undefined;
  const slot: QuestSlot = {
    idx, day, date, time, type, spot: spotName(type, typeCount),
    productTitle: params.product.title, productImageUrl: params.product.image || null, productUrl: params.product.url || null,
    status: "SCHEDULED", topic: direction,
  };
  schedule.slots.push(slot);
  if (params.platforms?.length) schedule.platforms = params.platforms;

  let obj = objectives.find((o) => o.type === type);
  if (obj) obj.target += 1;
  else { obj = { key: `${type}-m${idx}`, label: type === "video" ? "UGC videos" : type === "image" ? "Image ads" : "SEO blog posts", type, target: 1, done: 0 }; objectives.push(obj); }

  await db.questline.update({ where: { id: q.id }, data: { scheduleJson: JSON.stringify(schedule), objectivesJson: JSON.stringify(objectives) } });

  const base = {
    productTitle: params.product.title, productImageUrl: params.product.image || undefined,
    customPrompt: direction, productDescription: direction,
    questlineId: q.id, objectiveKey: obj.key, slotIdx: idx, prePaid: true,
  };
  const runAt = slotRunAt(slot);
  if (type === "video") await enqueueJob(shopId, "GENERATE_VIDEO_AD", { ...base, avatarId: q.avatarId || undefined, avatarVariant: q.avatarVariant, holdProduct: true }, runAt);
  else if (type === "image") await enqueueJob(shopId, "GENERATE_IMAGE_AD", base, runAt);
  else await enqueueJob(shopId, "GENERATE_BLOG_POST", base, runAt);

  return { ok: true, cost };
}

/** Bring a scheduled drop's forge FORWARD — free (the tokens were pre-paid when
 *  the plan/drop was created). Posting still happens on schedule; this just lets
 *  the merchant see what's coming. Moves the pending job's runAt to now. */
export async function generateSlotEarly(shopId: string, questlineId: string, slotIdx: number): Promise<{ ok: boolean; error?: string }> {
  const q = await db.questline.findFirst({ where: { id: questlineId, shopId } });
  if (!q) return { ok: false, error: "Campaign not found." };
  const schedule = parseSchedule(q.scheduleJson);
  const slot = schedule.slots.find((s) => s.idx === slotIdx);
  if (!slot) return { ok: false, error: "Drop not found." };
  if (slot.status !== "SCHEDULED") return { ok: false, error: "That drop is already being made." };
  try {
    const jobs = await db.job.findMany({ where: { shopId, status: "PENDING", payload: { contains: questlineId } } });
    let moved = false;
    for (const jb of jobs) {
      try { const p = JSON.parse(jb.payload); if (p.questlineId === questlineId && p.slotIdx === slotIdx) { await db.job.update({ where: { id: jb.id }, data: { runAt: new Date() } }); moved = true; } } catch { /* skip */ }
    }
    if (!moved) return { ok: false, error: "No pending job for this drop yet — try again shortly." };
    slot.status = "FORGING";
    await db.questline.update({ where: { id: q.id }, data: { scheduleJson: JSON.stringify(schedule) } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't start early." };
  }
}

/** Retry a forged drop the merchant didn't like — spends tokens (the pre-paid
 *  forge was already used). Re-enqueues a fresh forge now; posting stays on
 *  schedule and picks up whatever's ready by then. */
export async function retrySlot(shopId: string, questlineId: string, slotIdx: number): Promise<{ ok: boolean; error?: string; cost?: number }> {
  const q = await db.questline.findFirst({ where: { id: questlineId, shopId } });
  if (!q) return { ok: false, error: "Campaign not found." };
  const schedule = parseSchedule(q.scheduleJson);
  const slot = schedule.slots.find((s) => s.idx === slotIdx);
  if (!slot) return { ok: false, error: "Drop not found." };
  if (slot.type !== "video" && slot.type !== "image" && slot.type !== "blog") return { ok: false, error: "Nothing to regenerate." };
  if (slot.status === "POSTED") return { ok: false, error: "That drop already posted." };
  const cost = slot.type === "video" ? TOKEN_COST.video : slot.type === "image" ? TOKEN_COST.image : TOKEN_COST.blog;
  try { await spendTokens(shopId, cost); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Not enough tokens." }; }

  slot.status = "FORGING";
  slot.assetId = undefined;
  await db.questline.update({ where: { id: q.id }, data: { scheduleJson: JSON.stringify(schedule) } });
  const objectives: { key: string; type: string }[] = JSON.parse(q.objectivesJson || "[]");
  const obj = objectives.find((o) => o.type === slot.type);
  const base = { productTitle: slot.productTitle, productImageUrl: slot.productImageUrl || undefined, customPrompt: slot.topic, productDescription: slot.topic, questlineId: q.id, objectiveKey: obj?.key, slotIdx, prePaid: true };
  if (slot.type === "video") await enqueueJob(shopId, "GENERATE_VIDEO_AD", { ...base, avatarId: q.avatarId || undefined, avatarVariant: q.avatarVariant, holdProduct: true }, new Date());
  else if (slot.type === "image") await enqueueJob(shopId, "GENERATE_IMAGE_AD", base, new Date());
  else await enqueueJob(shopId, "GENERATE_BLOG_POST", base, new Date());
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
  if (changed.size === 0) return { ok: false, error: "Every drop starring that item is already made — nothing left to swap." };

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
/** SCHEDULE WHAT THEY ALREADY MADE — a campaign built from Archive assets.
 *
 *  Every other campaign path pays to CREATE content and then posts it. But
 *  merchants accumulate a library: bursts they picked one winner from,
 *  last month's drops, things made and never posted. Making them re-buy that
 *  content to get it on a schedule is charging twice for the same asset.
 *
 *  The plumbing already supports it. The auto-poster keys off a slot being
 *  READY with an assetId — it never asks how the asset got there. So this
 *  writes slots that are READY from birth, and no generation job is ever
 *  queued. Cost is zero tokens, which is the entire point.
 *
 *  Spacing is even across the window rather than every-day-then-nothing: a
 *  feed that goes quiet after week one is the problem campaigns exist to
 *  solve, so 12 assets over 30 days posts every ~2.5 days, not 12 days
 *  straight. */
export async function scheduleExistingAssets(
  shopId: string,
  params: {
    assetIds: string[];
    /** How many days to spread them across. */
    days: number;
    /** Local HH:MM to post at. */
    time?: string;
    name?: string;
    platforms?: string[];
  }
): Promise<{ ok: true; id: string; scheduled: number } | { ok: false; error: string }> {
  const ids = [...new Set((params.assetIds || []).filter(Boolean))].slice(0, 60);
  if (!ids.length) return { ok: false, error: "Pick at least one thing from your Archive." };
  const days = Math.max(1, Math.min(90, Math.round(params.days || 30)));
  const time = /^\d{2}:\d{2}$/.test(params.time || "") ? (params.time as string) : "12:00";

  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) return { ok: false, error: "Shop not found." };

  // Only this shop's own postable assets — never trust ids off the wire.
  const assets = await db.asset.findMany({
    where: { shopId, id: { in: ids }, type: { in: ["VIDEO_AD", "IMAGE_AD", "BLOG_POST"] } },
    select: { id: true, type: true, title: true, bodyJson: true, metaJson: true },
  });
  if (!assets.length) return { ok: false, error: "None of those are postable — pick videos, images or articles." };
  // Keep the merchant's chosen order; findMany doesn't preserve it.
  const byId = new Map(assets.map((a) => [a.id, a]));
  const ordered = ids.map((i) => byId.get(i)).filter(Boolean) as typeof assets;

  const typeOf = (t: string): ObjectiveType => (t === "VIDEO_AD" ? "video" : t === "IMAGE_AD" ? "image" : "blog");
  const start = new Date();
  const step = ordered.length > 1 ? (days - 1) / (ordered.length - 1) : 0;

  const counts: Record<string, number> = {};
  const slots: QuestSlot[] = ordered.map((a, i) => {
    const type = typeOf(a.type);
    const dayOffset = Math.round(i * step);
    const when = new Date(start.getTime() + dayOffset * 86400000);
    const meta = (() => { try { return JSON.parse(a.metaJson || "{}"); } catch { return {}; } })() as Record<string, unknown>;
    const body = (() => { try { return JSON.parse(a.bodyJson || "{}"); } catch { return {}; } })() as Record<string, unknown>;
    counts[type] = (counts[type] || 0) + 1;
    return {
      idx: i,
      day: dayOffset + 1,
      date: when.toISOString().slice(0, 10),
      time,
      type,
      spot: spotName(type, counts[type] - 1),
      productTitle: (meta.productTitle as string) || a.title || "",
      productImageUrl: (meta.productImageUrl as string) || (body.imageUrl as string) || null,
      productUrl: (meta.productUrl as string) || null,
      // READY FROM BIRTH. This is the whole mechanism — the poster publishes
      // it on the date below and nothing ever generates.
      status: "READY",
      assetId: a.id,
    };
  });

  const q = await db.questline.create({
    data: {
      shopId,
      template: "REPOST",
      name: (params.name || "").trim().slice(0, 60) || "From my Archive",
      status: "ACTIVE",
      avatarId: shop.brandAvatarId,
      avatarVariant: shop.brandAvatarVariant ?? 0,
      reviewMode: "SET_AND_FORGET", // the merchant already reviewed this content
      productTitle: slots[0]?.productTitle || "",
      productImageUrl: slots[0]?.productImageUrl || null,
      objectivesJson: "[]",
      scheduleJson: JSON.stringify({
        slots,
        weeksAwarded: [],
        ...(params.platforms?.length ? { platforms: params.platforms } : {}),
      } satisfies QuestSchedule),
      durationDays: days,
      tokenCost: 0, // nothing was generated, so nothing is refundable
      xpReward: 0,
      progress: 0,
    },
  });
  return { ok: true, id: q.id, scheduled: slots.length };
}

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
  // Never refund more than was actually charged. The loop above re-prices the
  // unspent slots from the CURRENT TOKEN_COST table, but accept() charged
  // questlineCostFor(), which applies a tier discount (e.g. ANTHEM -15%). On a
  // discounted questline the re-priced sum exceeds the real charge, so
  // accept-then-abandon netted free tokens into the non-expiring `tokensExtra`
  // bucket — and it was loopable. `tokenCost` is the amount accept() persisted.
  if (q.tokenCost > 0) refund = Math.min(refund, q.tokenCost);

  if (refund > 0) {
    try {
      // Back into the buckets it came out of, in the SAME PROPORTION.
      //
      // Passing no split at all credited everything to the monthly allowance,
      // so tokens the merchant had BOUGHT came back as allowance and expired
      // at the next period roll. But refunding the purchased leg FIRST is the
      // opposite mistake: on a partial abandon it converts expiring allowance
      // into permanent tokensExtra — a mint, and the other failure refundTokens
      // documents. Cost 900 of which 600 purchased, half already forged: an
      // extra-first refund of 450 would credit all 450 to the permanent bucket
      // when only 300 of it was ever permanent.
      //
      // floor(), not round(), so rounding can never mint either.
      const fromExtra = q.tokenCost > 0
        ? Math.floor((refund * q.tokenFromExtra) / q.tokenCost)
        : 0;
      await refundTokens(shopId, refund, Math.min(refund, fromExtra));
    } catch (e) { console.error("[questline] refund failed:", e); refund = 0; }
  }
  await db.questline.delete({ where: { id: q.id } });
  return { ok: true, refunded: refund };
}

/** Finish a questline — but only once it has actually RUN, not merely rendered.
 *
 *  This used to be a `status: "COMPLETE"` flip inside onQuestlineObjectiveDone
 *  the moment every content objective was done. Content forges GEN_LEAD_MS (a
 *  full day) BEFORE its posting slot, so the last drops were still sitting
 *  READY, waiting for their time, when the quest was declared finished — and
 *  postDueSlots only ever scans `status: "ACTIVE"`. The campaign vanished from
 *  the poster's view and those final drops never went out. The merchant paid
 *  for them, watched the campaign turn green, and never saw them published.
 *
 *  So: complete when the content is done AND every slot has reached a terminal
 *  posting state. The elapsed-schedule backstop matters just as much — a slot
 *  that can NEVER post (socials unlinked, a platform permanently rejecting)
 *  must not pin the questline ACTIVE forever, which would strand its reward and
 *  keep it in the "running campaigns" count that gates accepting a new one.
 *
 *  Safe to call repeatedly and from anywhere; it no-ops unless the transition
 *  is genuinely due, so the reward pays exactly once. */
export async function settleQuestlineIfDone(questlineId: string): Promise<void> {
  try {
    const q = await db.questline.findUnique({ where: { id: questlineId } });
    if (!q || q.status === "COMPLETE") return;

    const objectives: Objective[] = JSON.parse(q.objectivesJson);
    const schedule = parseSchedule(q.scheduleJson);
    const allContentDone = objectives.filter((o) => o.type !== "post").every((o) => o.done >= o.target);
    if (!allContentDone) return;

    const postsSettled = schedule.slots.every((s) => s.status === "POSTED" || s.status === "FAILED");
    const lastSlotMs = schedule.slots.reduce((m, s) => {
      const t = new Date(`${s.date}T${s.time}:00`).getTime();
      return Number.isFinite(t) && t > m ? t : m;
    }, 0);
    const scheduleElapsed = lastSlotMs > 0 && Date.now() > lastSlotMs + GEN_LEAD_MS;
    if (!postsSettled && !scheduleElapsed) return; // drops still owed — stay ACTIVE so the poster keeps scanning

    // Conditional write: two callers race here (the forge path and the poster),
    // and the reward must not pay twice.
    const done = await db.questline.updateMany({
      where: { id: questlineId, status: { not: "COMPLETE" } },
      data: { status: "COMPLETE", completedAt: new Date() },
    });
    if (done.count !== 1) return; // the other caller got there first

    const res = await awardXp(q.shopId, q.xpReward);
    if (res?.leveledUp) await checkLevelAchievements(q.shopId, res.level);
    await unlockAchievement(q.shopId, "QUEST_COMPLETE");
  } catch (e) {
    console.error("[questline] settle failed (non-fatal):", e);
  }
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
        // NOT status:"COMPLETE" here. Forging the last piece is not finishing
        // the campaign — the drop still has to post, up to a day later. See
        // settleQuestlineIfDone.
      },
    });

    if (ok) await awardXp(shopId, 25 + weeklyBonus);

    // The forge may genuinely be the last thing outstanding (a schedule whose
    // slots have all already posted, or one that has fully elapsed), so ask.
    if (allContentDone) await settleQuestlineIfDone(questlineId);
  } catch (e) {
    console.error("[questline] progress update failed (non-fatal):", e);
  }
}
