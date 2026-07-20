/* 📧 EMAIL SENDING PROVIDER — Resend (provider-swappable, the same shape as
 * social-provider.server.ts). Everything is env-gated on EMAIL_API_KEY +
 * EMAIL_FROM: without them the app behaves as if email simply isn't connected
 * yet — nothing sends and the UI shows a Connect state. Swap Resend for
 * Postmark / SES / SendGrid by rewriting only this file.
 *
 * DELIVERABILITY NOTE: EMAIL_FROM must be an address on a domain you've verified
 * with the provider (SPF + DKIM, ideally DMARC). Sending customer email in bulk
 * also requires Shopify Protected Customer Data approval for read_customers. */

const RESEND_API = "https://api.resend.com/emails";

/** True only when a provider key AND a verified from-address are both set. */
export function emailEnabled(): boolean {
  return !!(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);
}

export function emailFrom(): string {
  return process.env.EMAIL_FROM || "";
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/** Send one email. No-op (ok:false) when email isn't connected — callers treat
 *  that as "staged, not live" rather than an error. */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<SendResult> {
  if (!emailEnabled()) {
    return { ok: false, error: "Email is not connected yet (EMAIL_API_KEY / EMAIL_FROM unset)." };
  }
  try {
    const r = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.EMAIL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });
    if (!r.ok) {
      return { ok: false, error: `email provider ${r.status}: ${(await r.text()).slice(0, 200)}` };
    }
    const j = (await r.json()) as { id?: string };
    return { ok: true, id: j.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
