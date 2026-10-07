/* THE server-side gate for the two-currency rule: the TIER decides which
 * generators are unlocked; tokens only meter volume. Every generation entry
 * point (studio action, archive retry/remix, worker) calls assertCapability
 * before spending a token — the UI lock badges are cosmetics, this is the law.
 *
 * Trial: the FULL plan experience — every generator the tier (or Studio,
 * whichever is broader) includes, so merchants taste everything before the
 * first charge. The TRIAL_TOKEN_CAP in tokens.server.ts is the guardrail:
 * capability locks during trial just read as broken ("I'm on Studio but
 * Studio features are locked"). */

import type { Plan } from "@prisma/client";
import {
  CAPABILITY_LABEL,
  CAPABILITY_TIER,
  PLAN_BY_KEY,
  TIER_CAPABILITIES,
  resolveTierKey,
  type Capability,
  type PlanKey,
} from "./plan-config";

type PlanLike = Pick<Plan, "type" | "active"> & { trialEndsAt?: Date | string | null; creatorAddon?: boolean | null };

export class CapabilityLockedError extends Error {
  capability: Capability;
  neededTier: PlanKey;
  constructor(cap: Capability, trialLocked: boolean) {
    const tier = CAPABILITY_TIER[cap];
    super(
      trialLocked
        ? `${CAPABILITY_LABEL[cap]} unlocks when your free trial converts — hang tight, it's days away.`
        : `${CAPABILITY_LABEL[cap]} is part of the ${PLAN_BY_KEY[tier].name} plan ($${PLAN_BY_KEY[tier].price}/mo). Upgrade on the Plans page to unlock it.`
    );
    this.name = "CapabilityLockedError";
    this.capability = cap;
    this.neededTier = tier;
  }
}

export function isTrialing(plan: PlanLike | null | undefined): boolean {
  if (!plan?.trialEndsAt) return false;
  return new Date(plan.trialEndsAt).getTime() > Date.now();
}

/** What this plan can generate RIGHT NOW (tier + trial rules applied). */
export function capabilitiesFor(plan: PlanLike | null | undefined): Set<Capability> {
  if (!plan || !plan.active) return new Set();
  const tier = resolveTierKey(plan.type) || "STARTER";
  // Trial tastes everything a MARKETING tier includes (plus a look at Creator).
  // But a standalone CREATOR trial must NOT get the Studio blanket — that would
  // hand a $6.99 image-only plan the video/anthem path it's designed to never
  // reach, so a trial-then-cancel could run real video COGS for free.
  const isCreatorTier = PLAN_BY_KEY[tier]?.section === "creator";
  const caps = isTrialing(plan)
    ? (isCreatorTier
        ? new Set<Capability>([...TIER_CAPABILITIES[tier], "creator"])
        : new Set<Capability>([...TIER_CAPABILITIES.STUDIO, ...TIER_CAPABILITIES[tier], "creator"]))
    : new Set<Capability>(TIER_CAPABILITIES[tier]);
  // The $6.99 Creator add-on unlocks the Creator section on top of a marketing
  // tier. (The CREATOR and ANTHEM/Legend tiers already include "creator".)
  if (plan.creatorAddon) caps.add("creator");
  return caps;
}

/** Throws CapabilityLockedError (with an upgrade-ready message) if locked. */
export function assertCapability(plan: PlanLike | null | undefined, cap: Capability): void {
  if (capabilitiesFor(plan).has(cap)) return;
  // "Locked by trial" vs "locked by tier" get different copy: an Anthem-tier
  // merchant in trial WILL have the cap at conversion — don't tell them to upgrade.
  const tier = plan ? resolveTierKey(plan.type) : null;
  const wouldHaveIt = !!tier && (TIER_CAPABILITIES[tier] as readonly Capability[]).includes(cap);
  throw new CapabilityLockedError(cap, isTrialing(plan) && wouldHaveIt);
}

/** Which capability a video generation needs, by studio content type. */
export function videoCapabilityFor(contentType: string | null | undefined): Capability {
  if (contentType === "jingle") return "anthem";
  if (contentType === "cartoon") return "cartoon";
  return "video";
}
