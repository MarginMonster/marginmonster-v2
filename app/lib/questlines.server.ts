import { db } from "../db.server";
import { spendTokens, refundTokens } from "./tokens.server";
import { awardXp, unlockAchievement, checkLevelAchievements } from "./xp.server";
import { enqueueJob } from "./job-queue.server";
import { zonedInstant, calendarDaysBetween, zonedDateString } from "./timezone";
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

/* EDIT THE SCHEDULE UNDER A COMPARE-AND-SWAP.
 *
 * scheduleJson is one JSON blob holding every slot, and a dozen places write
 * it. Two of them were already conditional and for good reason: the poster
 * (social-post.server.ts) stamps a slot POSTED with the accounts it reached,
 * and the public click turnstile (/go/:qid/:idx) counts clicks. Everything in
 * THIS file read the blob, changed one field, and wrote the whole thing back.
 *
 * Those writers are merchant clicks — move a drop, retry it, forge it early,
 * swap a product — and they run in HTTP actions on the same event loop as the
 * worker. A click landing mid-publish wrote back a copy read before the
 * publish, erasing the POSTED status and the postedTo record with it. The next
 * scan then posts again to accounts that already have it. The same collision
 * in the other direction leaves a slot stuck FORGING, which never publishes
 * because postDueSlots only sends READY.
 *
 * `apply` runs against a FRESH copy and may run more than once, so it must be
 * pure — do any spending or enqueueing outside it. Re-evaluating each caller's
 * own guards against current state is not a side effect of this design, it is
 * the point: "that drop already posted" should be answered from the row, not
 * from a copy taken before the merchant clicked. */
type ScheduleEdit<T> = { error: string } | { data?: Record<string, unknown>; result: T };

async function editSchedule<T>(
  questlineId: string,
  apply: (schedule: QuestSchedule) => ScheduleEdit<T>
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await db.questline.findUnique({ where: { id: questlineId }, select: { scheduleJson: true } });
    if (!row) return { ok: false, error: "Campaign not found." };
    const schedule = parseSchedule(row.scheduleJson);
    const out = apply(schedule);
    if ("error" in out) return { ok: false, error: out.error };
    const done = await db.questline.updateMany({
      where: { id: questlineId, scheduleJson: row.scheduleJson },
      data: { scheduleJson: JSON.stringify(schedule), ...(out.data || {}) },
    });
    if (done.count === 1) return { ok: true, result: out.result };
    // Something else committed in between — read it again and re-decide.
  }
  return { ok: false, error: "That campaign is being updated right now — try again in a moment." };
}
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

/** Why this shop cannot schedule this content type, or null if it can.
 *
 *  Checked BEFORE any spend. acceptQuestline already refuses a plan whose
 *  tier does not include video; adding a drop to an existing campaign did
 *  not, so a Starter merchant could tap a day on the calendar, pick
 *  "Video — 150", and lose 150 tokens — half their monthly allowance — for
 *  content their tier forbids and the generator refuses downstream. */
async function capabilityBlock(shopId: string, type: "video" | "image" | "blog"): Promise<string | null> {
  const shop = await db.shop.findUnique({ where: { id: shopId }, include: { activePlan: true } });
  if (!shop?.activePlan?.active) return "Choose a plan first to schedule drops.";
  const { capabilitiesFor } = await import("./capabilities.server");
  const caps = capabilitiesFor(shop.activePlan);
  if (!caps.has(type)) {
    return type === "video"
      ? "Videos unlock on the Studio plan — schedule an image or an article on this one."
      : `Your plan doesn't include ${type} drops.`;
  }
  return null;
}

/** The merchant’s IANA zone, or null. Every wall time in a schedule is theirs,
 *  not the container’s. */
async function tzFor(shopId: string): Promise<string | null> {
  const row = await db.shop.findUnique({ where: { id: shopId }, select: { timezone: true } });
  return row?.timezone ?? null;
}

function slotRunAt(slot: QuestSlot, tz?: string | null): Date {
  // The slot's time is a WALL time in the merchant's day, not a UTC instant.
  const post = zonedInstant(slot.date, slot.time, tz);
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
  const tz = await tzFor(params.shopId);
  let firstVideoBoosted = false;

  // WHAT EACH DROP ACTUALLY COST, AND WHICH BUCKET PAID FOR IT.
  //
  // These payloads carried prePaid and nothing else, so a drop that failed
  // permanently refunded REFUND_BY_TYPE — the full list price — into the
  // expiring monthly allowance. Both halves of that are wrong:
  //
  //   the AMOUNT, because a campaign is bought at a plan discount. A 700-token
  //   questline whose slots list at 900 refunded 25 for a failed image the
  //   merchant paid about 19 for. Tokens minted, per failure.
  //
  //   the BUCKET, because spendTokens draws the expiring allowance first and
  //   the purchased top-up only after it runs out. A campaign funded from
  //   bought, never-expiring tokens got its refunds back as allowance, which
  //   expires at the next period roll. The merchant paid cash for those.
  //
  // Apportioned by list price so the parts sum back to the whole, floored so
  // rounding can only ever under-refund.
  const listOf = (t: string) => (t === "video" ? TOKEN_COST.video : t === "image" ? TOKEN_COST.image : t === "blog" ? TOKEN_COST.blog : 0);
  const listTotal = slots.reduce((sum, sl) => sum + listOf(sl.type), 0);
  const chargeFor = (t: string) => (listTotal > 0 ? Math.floor((listOf(t) * cost) / listTotal) : 0);
  const extraFor = (charged: number) => (cost > 0 ? Math.floor((charged * acceptFromExtra) / cost) : 0);

  for (const slot of slots) {
    const objective = objectives.find((o) => o.type === slot.type);
    const chargedTokens = chargeFor(slot.type);
    const base = {
      productTitle: slot.productTitle,
      productImageUrl: slot.productImageUrl || undefined,
      questlineId: q.id,
      objectiveKey: objective?.key,
      slotIdx: slot.idx,
      prePaid: true,
      chargedTokens,
      chargedFromExtra: extraFor(chargedTokens),
    };
    let runAt = slotRunAt(slot, tz);
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
  const tz = await tzFor(shopId);
  const start = q.createdAt.getTime();
  // Calendar days, not rounded timestamps: q.createdAt is a real time of day,
  // so subtracting it from a midnight and rounding made the second calendar
  // day come out as "day 1" for any campaign created in the afternoon.
  slot.day = Math.max(1, calendarDaysBetween(zonedDateString(new Date(start), tz), date) + 1);
  await db.questline.update({ where: { id: q.id }, data: { scheduleJson: JSON.stringify(schedule) } });

  // Move the matching pending job's runAt
  try {
    const jobs = await db.job.findMany({ where: { shopId, status: "PENDING", payload: { contains: questlineId } } });
    for (const j of jobs) {
      try {
        const p = JSON.parse(j.payload);
        if (p.questlineId === questlineId && p.slotIdx === slotIdx) {
          await db.job.update({ where: { id: j.id }, data: { runAt: slotRunAt(slot, tz) } });
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
  // The tier's capabilities apply to a drop added later, not just to the
  // campaign accepted up front — see capabilityBlock.
  const capBlock = await capabilityBlock(shopId, type);
  if (capBlock) return { ok: false, error: capBlock };

  const dtz = await tzFor(shopId);
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

  // Everything below is recomputed per attempt against a FRESH read, because
  // the next slot index is derived from the schedule: two drops added at once,
  // or one added while the worker marks another READY, both computed the same
  // idx from the same stale copy and the second write erased the first. The
  // enqueued job then pointed at a slot that no longer existed.
  let idx = 0;
  let item: { title: string; image: string | null } = { title: "", image: null };
  let obj!: { key: string; label: string; type: string; target: number; done: number };
  let slot!: QuestSlot;
  let committed = false;

  for (let attempt = 0; attempt < 4 && !committed; attempt++) {
  const row = await db.questline.findUnique({ where: { id: q.id }, select: { scheduleJson: true, objectivesJson: true } });
  if (!row) return { ok: false, error: "Campaign not found." };
  const schedule = parseSchedule(row.scheduleJson);
  const objectives: { key: string; label: string; type: string; target: number; done: number }[] = JSON.parse(row.objectivesJson);
  idx = schedule.slots.reduce((m, s) => Math.max(m, s.idx), -1) + 1;
  const typeCount = schedule.slots.filter((s) => s.type === type).length;
  // rotate the bag: give the new drop the least-recently-used packed item
  const uniq: { title: string; image: string | null }[] = [];
  for (const s of schedule.slots) {
    if (s.productTitle && !uniq.some((u) => u.title === s.productTitle)) uniq.push({ title: s.productTitle, image: s.productImageUrl });
  }
  item = uniq.length ? uniq[idx % uniq.length] : { title: q.productTitle || "", image: q.productImageUrl };
  if (opts.productTitle) {
    const picked = uniq.find((u) => u.title === opts.productTitle);
    if (picked) item = picked;
  }

  const date = new Date(q.createdAt.getTime() + (day - 1) * 86400000).toISOString().slice(0, 10);
  const nowHM = new Date().toISOString().slice(11, 16);
  const defTime = type === "video" ? "19:00" : type === "blog" ? "09:00" : "12:00";
  const chosenTime = opts.time && /^\d{2}:\d{2}$/.test(opts.time) ? opts.time : defTime;
  slot = {
    idx, day, date,
    time: opts.instant ? nowHM : chosenTime,
    type, spot: spotName(type, typeCount),
    productTitle: item.title, productImageUrl: item.image,
    status: "SCHEDULED" as const,
    topic: (opts.direction || "").trim().slice(0, 160) || undefined,
  };
  schedule.slots.push(slot);

  const found = objectives.find((o) => o.type === type);
  if (found) { found.target += 1; obj = found; }
  else {
    obj = { key: `${type}-x${idx}`, label: type === "video" ? "UGC videos with your Brand Face" : type === "image" ? "Scroll-stopping image ads" : "SEO blog posts", type, target: 1, done: 0 };
    objectives.push(obj);
  }
  const post = objectives.find((o) => o.type === "post");
  if (post) post.target += 1;
  const totalTarget = objectives.reduce((s, o) => s + o.target, 0);
  const totalDone = objectives.reduce((s, o) => s + o.done, 0);

  const applied = await db.questline.updateMany({
    where: { id: q.id, scheduleJson: row.scheduleJson, objectivesJson: row.objectivesJson },
    data: {
      scheduleJson: JSON.stringify(schedule),
      objectivesJson: JSON.stringify(objectives),
      progress: totalTarget ? Math.round((totalDone / totalTarget) * 100) : 0,
    },
  });
  if (applied.count === 1) committed = true;
  }

  if (!committed) {
    // The charge above already happened, so hand it back rather than leaving
    // the merchant paying for a drop that was never added.
    await db.questline.update({
      where: { id: q.id },
      data: { tokenCost: { decrement: cost }, tokenFromExtra: { decrement: addedFromExtra } },
    }).catch(() => { /* the abandon cap is the backstop */ });
    await refundTokens(shopId, cost, addedFromExtra).catch(() => { /* logged inside */ });
    return { ok: false, error: "That campaign is being updated right now — try again in a moment." };
  }

  const direction = (opts.direction || "").trim().slice(0, 160) || undefined;
  const base = {
    productTitle: item.title, productImageUrl: item.image || undefined,
    // the merchant's topic steers the script/article (video: customPrompt,
    // blog: description; image gen picks it up when it learns directions)
    customPrompt: direction, productDescription: direction,
    questlineId: q.id, objectiveKey: obj.key, slotIdx: idx, prePaid: true,
  };
  const runAt = opts.instant ? new Date() : slotRunAt(slot, dtz);
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
  // Same gate as addDrop and acceptQuestline.
  const manualCapBlock = await capabilityBlock(shopId, type);
  if (manualCapBlock) return { ok: false, error: manualCapBlock };
  const mtz = await tzFor(shopId);
  // The merchant typed a wall time in THEIR day.
  const post = zonedInstant(date, time, mtz);
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

  const direction = (params.direction || "").trim().slice(0, 160) || undefined;
  // Recomputed per attempt against a fresh read — the next index comes from
  // the schedule, and the MANUAL container is shared by every one-off drop the
  // shop ever makes, so it is the most contended blob in the app. Two drops
  // added together derived the same idx from the same stale copy, and the
  // second write erased the first along with the job pointing at it.
  let idx = 0;
  let obj!: { key: string; label: string; type: string; target: number; done: number };
  let slot!: QuestSlot;
  let committed = false;
  for (let attempt = 0; attempt < 4 && !committed; attempt++) {
  const row = await db.questline.findUnique({ where: { id: q.id }, select: { scheduleJson: true, objectivesJson: true } });
  if (!row) return { ok: false, error: "Campaign not found." };
  const schedule = parseSchedule(row.scheduleJson);
  const objectives: { key: string; label: string; type: string; target: number; done: number }[] = JSON.parse(row.objectivesJson || "[]");
  idx = schedule.slots.reduce((m, s) => Math.max(m, s.idx), -1) + 1;
  const typeCount = schedule.slots.filter((s) => s.type === type).length;
  const day = Math.max(1, calendarDaysBetween(zonedDateString(q.createdAt, mtz), date) + 1);
  slot = {
    idx, day, date, time, type, spot: spotName(type, typeCount),
    productTitle: params.product.title, productImageUrl: params.product.image || null, productUrl: params.product.url || null,
    status: "SCHEDULED", topic: direction,
  };
  schedule.slots.push(slot);
  if (params.platforms?.length) schedule.platforms = params.platforms;

  const found = objectives.find((o) => o.type === type);
  if (found) { found.target += 1; obj = found; }
  else { obj = { key: `${type}-m${idx}`, label: type === "video" ? "UGC videos" : type === "image" ? "Image ads" : "SEO blog posts", type, target: 1, done: 0 }; objectives.push(obj); }

  const applied = await db.questline.updateMany({
    where: { id: q.id, scheduleJson: row.scheduleJson, objectivesJson: row.objectivesJson },
    data: { scheduleJson: JSON.stringify(schedule), objectivesJson: JSON.stringify(objectives) },
  });
  if (applied.count === 1) committed = true;
  }

  if (!committed) {
    // The tokens were taken before the container was touched, so give them
    // back rather than charging for a drop that was never scheduled.
    await db.questline.update({
      where: { id: q.id },
      data: { tokenCost: { decrement: cost }, tokenFromExtra: { decrement: oneOffFromExtra } },
    }).catch(() => { /* the abandon cap is the backstop */ });
    await refundTokens(shopId, cost, oneOffFromExtra).catch(() => { /* logged inside */ });
    return { ok: false, error: "That campaign is being updated right now — try again in a moment." };
  }

  const base = {
    productTitle: params.product.title, productImageUrl: params.product.image || undefined,
    customPrompt: direction, productDescription: direction,
    questlineId: q.id, objectiveKey: obj.key, slotIdx: idx, prePaid: true,
  };
  const runAt = slotRunAt(slot, mtz);
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
  try {
    // Moving the job's runAt first: it is idempotent, so a lost race on the
    // schedule below costs nothing but the label.
    const jobs = await db.job.findMany({ where: { shopId, status: "PENDING", payload: { contains: questlineId } } });
    let moved = false;
    for (const jb of jobs) {
      try { const p = JSON.parse(jb.payload); if (p.questlineId === questlineId && p.slotIdx === slotIdx) { await db.job.update({ where: { id: jb.id }, data: { runAt: new Date() } }); moved = true; } } catch { /* skip */ }
    }
    if (!moved) return { ok: false, error: "No pending job for this drop yet — try again shortly." };
    // The status guard is re-checked against the CURRENT schedule: between the
    // page render and this click the poster may have taken the slot.
    const r = await editSchedule(q.id, (schedule) => {
      const slot = schedule.slots.find((x) => x.idx === slotIdx);
      if (!slot) return { error: "Drop not found." };
      if (slot.status !== "SCHEDULED") return { error: "That drop is already being made." };
      slot.status = "FORGING";
      return { result: true };
    });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
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

  // CLAIM THE SLOT BEFORE SPENDING. The POSTED guard above answers from a copy
  // read before the merchant clicked, and the poster writes that field from
  // the worker. Charging first and then discovering the drop had just gone out
  // would leave the merchant paying for a regeneration of something already
  // published — so the claim goes first and the wallet is only touched once it
  // has been won.
  const claim = await editSchedule(q.id, (fresh) => {
    const target = fresh.slots.find((x) => x.idx === slotIdx);
    if (!target) return { error: "Drop not found." };
    if (target.status === "POSTED") return { error: "That drop already posted." };
    // Deliberately NOT refusing a slot already marked FORGING. Retry is the
    // merchant's escape hatch for a drop whose job died without reporting back,
    // and that leaves the slot exactly there.
    target.status = "FORGING";
    target.assetId = undefined;
    return { result: true };
  });
  if (!claim.ok) return { ok: false, error: claim.error };

  try { await spendTokens(shopId, cost); } catch (e) {
    // Hand the slot back — it is not being forged after all.
    await editSchedule(q.id, (fresh) => {
      const target = fresh.slots.find((x) => x.idx === slotIdx);
      if (!target || target.status !== "FORGING") return { error: "moved on" };
      target.status = "SCHEDULED";
      return { result: true };
    });
    return { ok: false, error: e instanceof Error ? e.message : "Not enough tokens." };
  }
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
          // Only while it is still PENDING and still holds the payload we
          // read. A job claimed between the scan and this write is already
          // rendering and checkpointing into that same field — overwriting it
          // would erase its resume state and re-buy the stages it had done.
          await db.job.updateMany({
            where: { id: j.id, status: "PENDING", payload: j.payload },
            data: { payload: JSON.stringify(p) },
          });
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
): Promise<{ ok: true; id: string; scheduled: number; skipped: number } | { ok: false; error: string }> {
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

  // DON'T DOUBLE-BOOK.
  //
  // Nothing stopped the same asset being scheduled into two live campaigns:
  // pick five things, repost, then pick the same five again, and the poster
  // dutifully publishes each of them twice to the merchant's real accounts.
  // Duplicate posts are the one thing every platform punishes. Anything
  // already sitting in a slot that has not gone out yet is dropped here.
  // Something already POSTED is fair game — reposting last month's winner is
  // the whole point of this screen.
  const live = await db.questline.findMany({
    where: { shopId, status: { in: ["ACTIVE", "PAUSED"] } },
    select: { scheduleJson: true },
  });
  const pending = new Set<string>();
  for (const l of live) {
    for (const s of parseSchedule(l.scheduleJson).slots) {
      // POSTED is done and FAILED will never fire, so neither blocks a repost.
      if (s.assetId && s.status !== "POSTED" && s.status !== "FAILED") pending.add(s.assetId);
    }
  }
  // Counted off the real assets, not the raw ids, so junk on the wire cannot
  // inflate the number we report back.
  const skipped = assets.filter((a) => pending.has(a.id)).length;

  // Keep the merchant's chosen order; findMany doesn't preserve it.
  const byId = new Map(assets.map((a) => [a.id, a]));
  const ordered = ids.map((i) => byId.get(i)).filter(Boolean).filter((a) => !pending.has(a!.id)) as typeof assets;
  if (!ordered.length) {
    return {
      ok: false,
      error:
        skipped === 1
          ? "That one is already scheduled to go out — check Running above."
          : "Those are all already scheduled to go out — check Running above.",
    };
  }

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
  return { ok: true, id: q.id, scheduled: slots.length, skipped };
}

export async function abandonQuestline(shopId: string, questlineId: string): Promise<{ ok: boolean; refunded: number }> {
  const q = await db.questline.findFirst({ where: { id: questlineId, shopId } });
  if (!q) return { ok: false, refunded: 0 };

  // CLAIM IT BY DELETING IT, BEFORE ANY REFUND WORK.
  //
  // The row was read here and deleted at the very END, with a job findMany,
  // a per-job delete loop, a second findMany and the refund pricing in
  // between — every one of them an await on the event loop this shares with
  // every HTTP handler. Two overlapping Stop clicks (a double-tap, a retried
  // submit) both read the same live row, both priced the same refund and
  // both called refundTokens: the merchant was paid twice for one campaign,
  // into the permanent tokensExtra bucket.
  //
  // deleteMany is the claim. Exactly one caller can see count === 1, and it
  // is the one that does the refund. No new status value, so nothing else in
  // this file has to learn about a half-abandoned questline.
  const claimedQuest = await db.questline.deleteMany({ where: { id: q.id, shopId } });
  if (claimedQuest.count !== 1) return { ok: false, refunded: 0 };

  const schedule = parseSchedule(q.scheduleJson);

  // Cancel unstarted jobs for this quest. This runs BEFORE the refund is
  // priced, so anything the worker claims in the meantime is caught by the
  // claimed-slot query below rather than slipping between the two.
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

  // WORK THE WORKER HAS ALREADY STARTED IS NOT REFUNDABLE.
  //
  // A slot only leaves "SCHEDULED" when its job REPORTS BACK
  // (onQuestlineObjectiveDone writes READY or FAILED). The scheduled drip
  // never marks it FORGING on the way in — only the two merchant-driven
  // paths, generateSlotEarly and retrySlot, do that. So for the whole
  // several-minute life of a video render the slot still reads SCHEDULED,
  // and this refund used to pay it back in full. The job is IN_PROGRESS by
  // then, so the cleanup above cannot cancel it either: the render finishes,
  // the asset lands in the Archive, and the tokens are already back in the
  // merchant's wallet. Accept a questline, wait for a video to start,
  // abandon — a free render, repeatable, at our provider cost every time.
  //
  // The provider has been paid the moment the job is claimed, so a claimed
  // slot is spent money whatever the slot's own status says.
  const claimed = new Set<number>();
  try {
    const started = await db.job.findMany({
      where: { shopId, status: { in: ["IN_PROGRESS", "COMPLETED"] }, payload: { contains: questlineId } },
      select: { payload: true },
    });
    for (const j of started) {
      try {
        const p = JSON.parse(j.payload);
        if (p.questlineId === questlineId && typeof p.slotIdx === "number") claimed.add(p.slotIdx);
      } catch { /* skip */ }
    }
  } catch (e) {
    // Cannot tell what has started. Refunding blind is the expensive
    // mistake, so treat every slot as claimed and refund nothing.
    console.error("[questline] abandon could not read in-flight jobs — refunding nothing:", e);
    for (const s of schedule.slots) claimed.add(s.idx);
  }

  let refund = 0;
  for (const s of schedule.slots) {
    if (s.status === "SCHEDULED" && !claimed.has(s.idx)) {
      refund += s.type === "video" ? TOKEN_COST.video : s.type === "image" ? TOKEN_COST.image : s.type === "blog" ? TOKEN_COST.blog : 0;
    }
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
  // Already deleted above — that delete WAS the claim.
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

    // ELAPSED IS COMPUTED FIRST, AND IT OVERRIDES EVERYTHING.
    //
    // The content gate used to sit above this and return outright. But
    // onQuestlineObjectiveDone only increments `done` when ok === true, so a
    // drop that fails permanently — three attempts burned, or a deploy
    // killing a render mid-flight — leaves its objective one short FOREVER.
    // The questline then pinned itself ACTIVE with no path out: xpReward (550
    // to 3,000) never paid, the card never cleared, and it kept counting
    // against the running-campaigns cap that gates accepting a new one. The
    // doc comment two paragraphs up already promises this cannot happen.
    //
    // Once the whole schedule is a day past its last slot there is nothing
    // left to wait for, whatever the counters say.
    const lastSlotMs = schedule.slots.reduce((m, s) => {
      const t = new Date(`${s.date}T${s.time}:00`).getTime();
      return Number.isFinite(t) && t > m ? t : m;
    }, 0);
    // Parsed without the shop's timezone, which is worth at most ±14h — well
    // inside the GEN_LEAD_MS day of slack this adds on top.
    const scheduleElapsed = lastSlotMs > 0 && Date.now() > lastSlotMs + GEN_LEAD_MS;

    const allContentDone = objectives.filter((o) => o.type !== "post").every((o) => o.done >= o.target);
    const postsSettled = schedule.slots.every((s) => s.status === "POSTED" || s.status === "FAILED");

    // Still genuinely running: content outstanding, drops still owed, and the
    // schedule has not run out. Stay ACTIVE so the poster keeps scanning.
    if (!scheduleElapsed && (!allContentDone || !postsSettled)) return;
    if (!allContentDone) {
      console.warn(`[questline] ${questlineId} settling with content still short — its schedule elapsed, so something failed permanently`);
    }

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
    // THE WORKER'S OWN WRITE HAS TO BE CONDITIONAL TOO.
    //
    // This reads both blobs, computes over them, awaits, and wrote the whole
    // lot back. It is the counterpart to the merchant-facing writers that were
    // made conditional: with only one side guarded, this one still overwrites
    // theirs — and worse, it can land on top of the poster's POSTED stamp,
    // which erases the record of which accounts already have the drop and lets
    // the next scan publish it to them again.
    //
    // Everything inside the loop is pure. The one await that used to sit in the
    // middle — the PERFECT_WEEK unlock — is hoisted out, so a retried attempt
    // cannot fire it twice and a lost race cannot fire it at all.
    let committed = false;
    let perfectWeek = false;
    let weeklyBonus = 0;
    let allContentDone = false;

    for (let attempt = 0; attempt < 4 && !committed; attempt++) {
      const q = await db.questline.findUnique({ where: { id: questlineId } });
      if (!q || q.status === "COMPLETE") return;
      const objectives: Objective[] = JSON.parse(q.objectivesJson);
      const schedule = parseSchedule(q.scheduleJson);

      // Mark the map slot
      const slot = slotIdx != null ? schedule.slots.find((s) => s.idx === slotIdx) : undefined;
      if (slot) {
        // Never demote a drop that has already gone out. The poster owns that
        // status, and it carries the postedTo record with it.
        if (slot.status !== "POSTED") {
          slot.status = ok ? "READY" : "FAILED";
          if (ok && assetId) slot.assetId = assetId;
        } else if (ok && assetId && !slot.assetId) {
          slot.assetId = assetId;
        }
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
      allContentDone = contentObjs.every((o) => o.done >= o.target);

      // Weekly bonus: all of a week's slots forged -> +100 XP, once per week.
      perfectWeek = false;
      weeklyBonus = 0;
      if (ok && slot) {
        const week = Math.ceil(slot.day / 7);
        if (!schedule.weeksAwarded.includes(week)) {
          const weekSlots = schedule.slots.filter((s) => Math.ceil(s.day / 7) === week);
          if (weekSlots.length > 0 && weekSlots.every((s) => s.status === "READY" || s.status === "POSTED")) {
            schedule.weeksAwarded.push(week);
            weeklyBonus = WEEK_BONUS_XP;
            perfectWeek = true;
          }
        }
      }

      const done = await db.questline.updateMany({
        where: { id: questlineId, scheduleJson: q.scheduleJson, objectivesJson: q.objectivesJson },
        data: {
          objectivesJson: JSON.stringify(objectives),
          scheduleJson: JSON.stringify(schedule),
          progress,
          // NOT status:"COMPLETE" here. Forging the last piece is not finishing
          // the campaign — the drop still has to post, up to a day later. See
          // settleQuestlineIfDone.
        },
      });
      if (done.count === 1) committed = true;
      // Otherwise something else moved the campaign — read it again and
      // recompute against what is actually there.
    }

    if (!committed) {
      console.warn(`[questline] ${questlineId}: progress for slot ${slotIdx} lost four races — not recorded`);
      return;
    }

    if (perfectWeek) {
      try { await unlockAchievement(shopId, "PERFECT_WEEK"); } catch { /* non-fatal */ }
    }
    if (ok) await awardXp(shopId, 25 + weeklyBonus);

    // The forge may genuinely be the last thing outstanding (a schedule whose
    // slots have all already posted, or one that has fully elapsed), so ask.
    if (allContentDone) await settleQuestlineIfDone(questlineId);
  } catch (e) {
    console.error("[questline] progress update failed (non-fatal):", e);
  }
}
