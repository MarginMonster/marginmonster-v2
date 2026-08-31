/* Stripe webhook — the ONLY writer of web-billed plan state. The endpoint
 * self-provisions via the Stripe API at boot (see ensureStripeWebhook) with
 * events: checkout.session.completed, customer.subscription.updated,
 * customer.subscription.deleted. Signature-verified; unsigned = 400. */

import type { ActionFunctionArgs } from "@remix-run/node";
import { db } from "../db.server";
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
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const accountId = meta.accountId;
      // MONEY HAS TO HAVE ARRIVED.
      //
      // The comment below says "money has already moved by the time this
      // fires", which is true for a card and not for the delayed methods
      // Stripe enables automatically — ACH, SEPA, Bacs and friends complete
      // the session with payment_status "unpaid" and settle days later, or
      // fail. Nothing here ever looked at that field, so a plan was granted
      // and tokens credited before a penny landed. async_payment_succeeded is
      // now handled by this same branch, which is what actually fulfils those.
      const paid = obj.payment_status === "paid" || obj.payment_status === "no_payment_required";
      if (!paid) {
        console.log(`[stripe] session ${obj.id} is ${obj.payment_status} — waiting for it to settle before granting anything`);
        return new Response(null, { status: 200 });
      }
      // Money has already moved by the time this fires. Anything we fail to act
      // on here is a merchant who paid and received nothing — so an unhandled
      // paid session must NOT be ACKed, or Stripe never retries and the failure
      // never surfaces anywhere.
      if (accountId && !meta.tierKey && !meta.packTokens) {
        console.error(`[stripe-webhook] paid session ${obj.id} for account ${accountId} carries neither tierKey nor packTokens — cannot fulfil it`);
        return new Response("Unfulfillable session", { status: 500 }); // Stripe retries; it also shows up as failing
      }
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
          // ONLY FOR THE SUBSCRIPTION THE ACCOUNT IS ACTUALLY ON.
          //
          // Stripe does not guarantee webhook ordering, and this endpoint
          // manufactures out-of-order delivery itself by 500-ing on a
          // transient failure and being retried. activateStripePlan
          // unconditionally re-points the account at whatever subscription id
          // the event carries and then CANCELS whatever it pointed at before —
          // so a late "updated" for the subscription a merchant just upgraded
          // AWAY from would cancel the one they had just paid for and downgrade
          // them to the old tier. deactivateStripePlan has carried exactly this
          // guard for the mirror-image case all along; this side never got it.
          //
          // Establishing a NEW subscription is checkout.session.completed's
          // job. This event only keeps the live one in sync.
          const acct = await db.account.findUnique({ where: { id: accountId }, select: { stripeSubId: true } });
          const subId = (obj.id as string) || null;
          if (acct?.stripeSubId && subId && acct.stripeSubId !== subId) {
            console.warn(`[stripe] ignoring subscription.updated for ${subId} — the account is on ${acct.stripeSubId}`);
          } else {
            // Keep type in sync (plan changes made in the Stripe portal land here).
            await activateStripePlan(accountId, meta.tierKey, subId, (obj.customer as string) || null);
          }
        } else if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
          await deactivateStripePlan(accountId, (obj.id as string) || null);
        }
      }
    } else if (event.type === "customer.subscription.deleted") {
      if (meta.accountId) await deactivateStripePlan(meta.accountId, (obj.id as string) || null);
    }
  } catch (e) {
    console.error("[stripe-webhook]", event.type, e instanceof Error ? e.message : e);
    return new Response("Handler error", { status: 500 }); // Stripe retries
  }
  return new Response("ok");
};

export const loader = async () => new Response("POST only", { status: 405 });
