import type { Plan } from "@prisma/client";
import { db } from "../db.server";
import { TOKEN_COST, TOKEN_ACTION_LABEL, PLAN_BY_KEY, type TokenAction, type PlanKey } from "./plan-config";
import { onTokensSpent } from "./xp.server";

const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export class InsufficientTokensError extends Error {
  needed: number;
  remaining: number;
  constructor(needed: number, remaining: number, action: TokenAction) {
    super(
      `Not enough tokens for ${TOKEN_ACTION_LABEL[action]} — needs ${needed}, you have ${remaining}. Top up on the Plans page to keep going.`
    );
    this.name = "InsufficientTokensError";
    this.needed = needed;
    this.remaining = remaining;
  }
}

/** Total tokens available right now = (monthly allowance not yet used) + top-up. */
export function tokensRemaining(plan: Pick<Plan, "tokensIncluded" | "tokensUsed" | "tokensExtra">): number {
  return Math.max(0, plan.tokensIncluded - plan.tokensUsed) + plan.tokensExtra;
}

/** Roll the monthly allowance over if the billing period has elapsed. Returns
 *  the (possibly refreshed) plan. */
export async function refreshPeriod(plan: Plan): Promise<Plan> {
  if (Date.now() - new Date(plan.periodStart).getTime() < PERIOD_MS) return plan;
  const monthly = PLAN_BY_KEY[plan.type as PlanKey]?.monthlyTokens ?? plan.tokensIncluded;
  return db.plan.update({
    where: { id: plan.id },
    data: {
      periodStart: new Date(),
      tokensUsed: 0,
      tokensIncluded: monthly,
      blogUsed: 0,
      videoUsed: 0,
    },
  });
}

/** Spend tokens for an action. Throws InsufficientTokensError if the wallet
 *  can't cover it. Deducts from the monthly allowance first, then top-up. */
export async function chargeTokens(shopId: string, action: TokenAction): Promise<{ remaining: number; charged: number }> {
  const cost = TOKEN_COST[action];
  let plan = await db.plan.findUnique({ where: { shopId } });
  if (!plan) throw new Error("No active plan. Choose a plan on the Plans page first.");
  plan = await refreshPeriod(plan);

  const remaining = tokensRemaining(plan);
  if (remaining < cost) throw new InsufficientTokensError(cost, remaining, action);

  // Spend the monthly allowance first, overflow onto the purchased top-up.
  const fromAllowance = Math.min(cost, Math.max(0, plan.tokensIncluded - plan.tokensUsed));
  const fromExtra = cost - fromAllowance;
  await db.plan.update({
    where: { id: plan.id },
    data: {
      tokensUsed: { increment: fromAllowance },
      tokensExtra: { decrement: fromExtra },
    },
  });
  // Arcade progression: spending tokens earns XP (farm-proof — they paid).
  await onTokensSpent(shopId, cost);
  return { remaining: remaining - cost, charged: cost };
}

/** Spend a flat token amount (e.g. accepting a Questline up front). Throws if
 *  the wallet can't cover it. Same allowance-first, then top-up logic. */
export async function spendTokens(shopId: string, amount: number): Promise<{ remaining: number }> {
  if (amount <= 0) return { remaining: 0 };
  let plan = await db.plan.findUnique({ where: { shopId } });
  if (!plan) throw new Error("No active plan. Choose a plan on the Plans page first.");
  plan = await refreshPeriod(plan);

  const remaining = tokensRemaining(plan);
  if (remaining < amount) {
    const e = new Error(`Not enough tokens — needs ${amount}, you have ${remaining}. Top up on the Plans page.`);
    e.name = "InsufficientTokensError";
    throw e;
  }
  const fromAllowance = Math.min(amount, Math.max(0, plan.tokensIncluded - plan.tokensUsed));
  const fromExtra = amount - fromAllowance;
  await db.plan.update({
    where: { id: plan.id },
    data: { tokensUsed: { increment: fromAllowance }, tokensExtra: { decrement: fromExtra } },
  });
  await onTokensSpent(shopId, amount);
  return { remaining: remaining - amount };
}

/** Credit tokens back (e.g. abandoning a questline before its content was
 *  generated). Unwinds the monthly allowance first, overflow onto top-up. */
export async function refundTokens(shopId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  const plan = await db.plan.findUnique({ where: { shopId } });
  if (!plan) return;
  const toAllowance = Math.min(amount, plan.tokensUsed);
  const toExtra = amount - toAllowance;
  await db.plan.update({
    where: { id: plan.id },
    data: { tokensUsed: { decrement: toAllowance }, tokensExtra: { increment: toExtra } },
  });
}
