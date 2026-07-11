import { db } from "../db.server";
import { spendTokens } from "./tokens.server";
import { awardXp, unlockAchievement, checkLevelAchievements } from "./xp.server";
import { enqueueJob } from "./job-queue.server";
import { QUESTLINE_BY_KEY, questlineTokenCost, type ObjectiveType } from "./questlines";

/* Questline orchestration. Accepting a questline charges its full token cost
 * up front, then fans its content out as pre-paid generation jobs. Each job
 * that completes ticks the matching objective and drops milestone XP; when
 * every content objective is done the questline completes and pays its reward. */

type Objective = { key: string; label: string; type: ObjectiveType; target: number; done: number };

export async function acceptQuestline(params: {
  shopId: string;
  templateKey: string;
  avatarId: string | null;
  avatarVariant: number;
  reviewMode: "REVIEW_FIRST" | "SET_AND_FORGET";
  productTitle: string;
  productImageUrl?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const def = QUESTLINE_BY_KEY[params.templateKey];
  if (!def) return { ok: false, error: "Unknown questline." };
  if (!params.productTitle?.trim()) return { ok: false, error: "Pick a product for this questline." };

  const shop = await db.shop.findUnique({ where: { id: params.shopId }, include: { activePlan: true } });
  if (!shop?.activePlan) return { ok: false, error: "Choose a plan first to run questlines." };

  const cost = questlineTokenCost(def);
  try {
    await spendTokens(params.shopId, cost); // reserve the whole mission up front
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Not enough tokens." };
  }

  const objectives: Objective[] = def.objectives.map((o, i) => ({
    key: `${o.type}-${i}`,
    label: o.label,
    type: o.type,
    target: o.target,
    done: 0,
  }));

  const q = await db.questline.create({
    data: {
      shopId: params.shopId,
      template: def.key,
      name: def.name,
      status: "ACTIVE",
      avatarId: params.avatarId,
      avatarVariant: params.avatarVariant,
      reviewMode: params.reviewMode,
      productTitle: params.productTitle.trim(),
      productImageUrl: params.productImageUrl || null,
      objectivesJson: JSON.stringify(objectives),
      tokenCost: cost,
      xpReward: def.xpReward,
      progress: 0,
    },
  });

  // Fan out the content objectives as PRE-PAID jobs (skip per-item charging —
  // the whole questline was paid on accept). "post" objectives tick when their
  // matching content is generated (real platform posting lands with the API
  // integrations track).
  for (const obj of objectives) {
    if (obj.type === "post") continue;
    for (let n = 0; n < obj.target; n++) {
      if (obj.type === "video") {
        await enqueueJob(params.shopId, "GENERATE_VIDEO_AD", {
          productTitle: params.productTitle.trim(),
          productImageUrl: params.productImageUrl || undefined,
          avatarId: params.avatarId || undefined,
          avatarVariant: params.avatarVariant,
          questlineId: q.id,
          objectiveKey: obj.key,
          prePaid: true,
        });
      } else if (obj.type === "image") {
        await enqueueJob(params.shopId, "GENERATE_IMAGE_AD", {
          productTitle: params.productTitle.trim(),
          productImageUrl: params.productImageUrl || undefined,
          questlineId: q.id,
          objectiveKey: obj.key,
          prePaid: true,
        });
      } else if (obj.type === "blog") {
        await enqueueJob(params.shopId, "GENERATE_BLOG_POST", {
          productTitle: params.productTitle.trim(),
          questlineId: q.id,
          objectiveKey: obj.key,
          prePaid: true,
        });
      }
    }
  }

  return { ok: true, id: q.id };
}

/** Called from the job queue when a questline-tagged content job finishes.
 *  Ticks the objective, drips milestone XP, and completes the questline +
 *  drops its reward when all content is done. Fully non-fatal. */
export async function onQuestlineObjectiveDone(questlineId: string, objectiveKey: string, shopId: string): Promise<void> {
  try {
    const q = await db.questline.findUnique({ where: { id: questlineId } });
    if (!q || q.status === "COMPLETE") return;
    const objectives: Objective[] = JSON.parse(q.objectivesJson);

    const obj = objectives.find((o) => o.key === objectiveKey);
    if (obj && obj.done < obj.target) obj.done += 1;

    // "post" objectives track content pieces posted — mirror the matching
    // content type's progress (posting itself lights up with the API track).
    const post = objectives.find((o) => o.type === "post");
    if (post) {
      const contentDone = objectives.filter((o) => o.type !== "post").reduce((s, o) => s + o.done, 0);
      post.done = Math.min(post.target, contentDone);
    }

    const totalTarget = objectives.reduce((s, o) => s + o.target, 0);
    const totalDone = objectives.reduce((s, o) => s + o.done, 0);
    const progress = totalTarget ? Math.round((totalDone / totalTarget) * 100) : 100;
    const contentObjs = objectives.filter((o) => o.type !== "post");
    const allContentDone = contentObjs.every((o) => o.done >= o.target);

    await db.questline.update({
      where: { id: questlineId },
      data: {
        objectivesJson: JSON.stringify(objectives),
        progress,
        ...(allContentDone ? { status: "COMPLETE", completedAt: new Date() } : {}),
      },
    });

    // Milestone XP per objective step (small, keeps the dopamine flowing).
    await awardXp(shopId, 25);

    if (allContentDone) {
      const res = await awardXp(shopId, q.xpReward);
      if (res?.leveledUp) await checkLevelAchievements(shopId, res.level);
      await unlockAchievement(shopId, "QUEST_COMPLETE");
    }
  } catch (e) {
    console.error("[questline] progress update failed (non-fatal):", e);
  }
}
