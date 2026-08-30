import type { Plan } from "@prisma/client";
import { db } from "../db.server";
import { TOKEN_COST, TOKEN_ACTION_LABEL, PLAN_BY_KEY, TRIAL_TOKEN_CAP, resolveTierKey, type TokenAction } from "./plan-config";
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

/**
 * Display-safe balance for read-side loaders. If the billing period has already
 * elapsed but no spend has rolled it over yet, this returns the balance the
 * merchant WILL have (full monthly allowance), so pages never flash "0 tokens"
 * for the gap between period-end and the next spend. Pure — never writes.
 */
export function tokensRemainingLive(
  plan: (Pick<Plan, "type" | "tokensIncluded" | "tokensUsed" | "tokensExtra" | "periodStart"> & { trialEndsAt?: Date | string | null }) | null | undefined
): number {
  if (!plan) return 0;
  const elapsed = Date.now() - new Date(plan.periodStart).getTime() >= PERIOD_MS;
  const tier = resolveTierKey(plan.type);
  const included = elapsed ? (tier ? PLAN_BY_KEY[tier].monthlyTokens : plan.tokensIncluded) : plan.tokensIncluded;
  const used = elapsed ? 0 : plan.tokensUsed;
  const normal = Math.max(0, included - used) + plan.tokensExtra;
  // During the free trial the wallet is hard-capped: show the capped number so
  // the HUD never promises tokens the spend path will refuse.
  if (planTrialing(plan)) return Math.min(normal, Math.max(0, TRIAL_TOKEN_CAP - plan.tokensUsed));
  return normal;
}

/** True while the plan's free-trial window is still open. */
export function planTrialing(plan: { trialEndsAt?: Date | string | null } | null | undefined): boolean {
  return !!plan?.trialEndsAt && new Date(plan.trialEndsAt).getTime() > Date.now();
}

/** Roll the monthly allowance over if the billing period has elapsed. Returns
 *  the (possibly refreshed) plan. */
export async function refreshPeriod(plan: Plan): Promise<Plan> {
  if (Date.now() - new Date(plan.periodStart).getTime() < PERIOD_MS) return plan;
  const tier = resolveTierKey(plan.type);
  const monthly = tier ? PLAN_BY_KEY[tier].monthlyTokens : plan.tokensIncluded;
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

/** What this plan can actually spend right now.
 *
 *  The trial branch is the whole point. `tokensUsed` only ever tracks the
 *  ALLOWANCE leg — once it reaches tokensIncluded it stops moving, because
 *  further spend comes out of tokensExtra. So a cap written as
 *  `TRIAL_TOKEN_CAP - tokensUsed` silently stopped counting the moment the
 *  allowance ran out, and a trialist with any purchased tokens could drain all
 *  of them inside a trial they were still free to cancel — real COGS, no
 *  revenue. (Starter's 300 monthly is below the 400 cap, so this was reachable
 *  on the cheapest plan.)
 *
 *  Holding top-ups back during the trial is what assertTrialCap's contract
 *  always claimed ("purchased top-ups are held until the trial converts") and
 *  what the HUD already displayed. Making it true here also keeps tokensUsed a
 *  COMPLETE record of trial spend, which is what makes the ceiling keep working. */
function spendableNow(plan: Plan): number {
  const allowance = Math.max(0, plan.tokensIncluded - plan.tokensUsed);
  if (planTrialing(plan)) return Math.min(allowance, Math.max(0, TRIAL_TOKEN_CAP - plan.tokensUsed));
  return allowance + plan.tokensExtra;
}

/** Hard trial ceiling: during the free trial, total spend can't pass
 *  TRIAL_TOKEN_CAP — and purchased top-ups are held (not spendable) until the
 *  trial converts, so a cancelled trial can never burn real COGS at scale. */
function assertTrialCap(plan: Plan, amount: number): void {
  if (!planTrialing(plan)) return;
  const spendable = spendableNow(plan);
  if (spendable < amount) {
    const e = new Error(
      `Free trials include ${TRIAL_TOKEN_CAP} tokens and you have ${spendable} left. Your full monthly allowance${plan.tokensExtra > 0 ? " (and your purchased tokens)" : ""} unlocks the moment the trial converts.`
    );
    e.name = "InsufficientTokensError";
    throw e;
  }
}

/** Spend tokens for an action. Throws InsufficientTokensError if the wallet
 *  can't cover it. Deducts from the monthly allowance first, then top-up. */
export async function chargeTokens(shopId: string, action: TokenAction): Promise<{ remaining: number; charged: number }> {
  const cost = TOKEN_COST[action];
  let plan = await db.plan.findUnique({ where: { shopId } });
  if (!plan) throw new Error("No active plan. Choose a plan on the Plans page first.");
  if (!plan.active) throw new Error("Your subscription is paused — resubscribe on the Packages page to keep going.");
  plan = await refreshPeriod(plan);
  assertTrialCap(plan, cost);

  // spendableNow, not tokensRemaining: during a trial the purchased top-up is
  // held back, so the raw wallet total would let a spend through that the cap
  // is supposed to refuse.
  const remaining = spendableNow(plan);
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
  if (!plan.active) throw new Error("Your subscription is paused — resubscribe on the Packages page to keep going.");
  plan = await refreshPeriod(plan);
  assertTrialCap(plan, amount);

  const remaining = spendableNow(plan);
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
