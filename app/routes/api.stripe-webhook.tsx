/* Stripe webhook — the ONLY writer of web-billed plan state. The endpoint
 * self-provisions via the Stripe API at boot (see ensureStripeWebhook) with
 * events: checkout.session.completed, customer.subscription.updated,
 * customer.subscription.deleted. Signature-verified; unsigned = 400. */

import type { ActionFunctionArgs } from "@remix-run/node";
import {
  activateStripePlan,
  creditStripePack,
  deactivateStripePlan,
  verifyStripeSignature,
} from "../lib/stripe.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const raw = await request.text();
  if (!(await verifyStripeSignature(raw, request.headers.get("Stripe-Signature")))) {
    return new Response("Bad signature", { status: 400 });
  }
  let event: { type?: string; data?: { object?: Record<string, unknown> } } = {};
  try { event = JSON.parse(raw); } catch { return new Response("Bad payload", { status: 400 }); }
  const obj = event.data?.object || {};
  const meta = (obj.metadata || {}) as Record<string, string>;

  try {
    if (event.type === "checkout.session.completed") {
      const accountId = meta.accountId;
      if (accountId && meta.tierKey) {
        await activateStripePlan(accountId, meta.tierKey, (obj.subscription as string) || null, (obj.customer as string) || null);
      } else if (accountId && meta.packTokens) {
        // The checkout session id is the natural idempotency key — Stripe
        // retries this webhook, and a replay used to credit the pack twice.
        await creditStripePack(accountId, parseInt(meta.packTokens, 10) || 0, (obj.id as string) || null);
      }
    } else if (event.type === "customer.subscription.updated") {
      const accountId = meta.accountId;
      const status = obj.status as string;
      if (accountId && meta.tierKey) {
        if (status === "active" || status === "trialing") {
          // Keep type in sync (plan changes made in the Stripe portal land here).
          await activateStripePlan(accountId, meta.tierKey, (obj.id as string) || null, (obj.customer as string) || null);
        } else if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
          await deactivateStripePlan(accountId);
        }
      }
    } else if (event.type === "customer.subscription.deleted") {
      if (meta.accountId) await deactivateStripePlan(meta.accountId);
    }
  } catch (e) {
    console.error("[stripe-webhook]", event.type, e instanceof Error ? e.message : e);
    return new Response("Handler error", { status: 500 }); // Stripe retries
  }
  return new Response("ok");
};

export const loader = async () => new Response("POST only", { status: 405 });
