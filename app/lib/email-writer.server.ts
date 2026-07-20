/* ✍️ AI EMAIL WRITER — the wedge against Klaviyo. Klaviyo makes merchants build
 * emails and flows by hand (often with a paid consultant). EasyMode's AI writes
 * the whole thing in the brand voice. Reuses anthropicText; no customer data
 * required to WRITE (that only matters at SEND time). */

import { anthropicText } from "./anthropic.server";
import type { EmailKind } from "./email-kinds";

export type { EmailKind };

const KIND_BRIEF: Record<EmailKind, string> = {
  broadcast: "a one-off marketing broadcast that drives clicks to the featured product or store",
  abandoned_cart:
    "an abandoned-cart recovery email that warmly nudges the shopper to finish checking out — helpful and inviting, a gentle nudge of urgency, never guilt-trippy",
  welcome:
    "a warm welcome email for a brand-new subscriber that introduces the brand's personality and invites a first purchase",
  winback:
    "a win-back email that re-engages a customer who hasn't bought in a while, with a genuine 'we miss you' warmth",
  post_purchase:
    "a post-purchase thank-you that makes the buyer feel great about their order and gently teases what to explore next",
};

export interface WrittenEmail {
  subject: string;
  preheader: string;
  html: string;
}

interface Section {
  heading?: string;
  text: string;
}

export async function writeMarketingEmail(
  brandProfile: { voiceJson: string },
  input: {
    kind: EmailKind;
    productTitle?: string;
    productDescription?: string;
    topic?: string;
    storeName?: string;
  }
): Promise<WrittenEmail> {
  let voice: { tone?: string; values?: string; samplePhrases?: string[] } = {};
  try { voice = JSON.parse(brandProfile.voiceJson); } catch { /* defaults */ }

  const prompt = `You are the email copywriter for ${input.storeName || "an ecommerce brand"}.
Brand voice — tone: ${voice.tone || "friendly and warm"}; values: ${voice.values || "quality, care"}; sample phrases: ${(voice.samplePhrases || []).join("; ") || "n/a"}.
Write ${KIND_BRIEF[input.kind]}.
${input.productTitle ? `Featured product: ${input.productTitle}.${input.productDescription ? ` ${input.productDescription}` : ""}` : ""}
${input.topic ? `Angle / topic: ${input.topic}` : ""}

Return STRICT JSON only (no markdown, no prose around it):
{"subject":"under 50 chars, high open-rate, no emojis","preheader":"under 90 chars","body_sections":[{"heading":"short heading or empty","text":"1-3 sentences"}],"cta_text":"button label under 22 chars"}
Rules: 2 to 4 body sections, tight and scannable, on-brand, no fake discounts or claims.`;

  let raw = "";
  try {
    raw = await anthropicText(prompt, { maxTokens: 900 });
  } catch (e) {
    throw new Error((e as Error).message);
  }

  let parsed: {
    subject?: string;
    preheader?: string;
    body_sections?: Section[];
    cta_text?: string;
  } = {};
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    parsed = {};
  }

  const subject = (parsed.subject || `${input.productTitle || "Something new"} — just for you`).slice(0, 80);
  const preheader = (parsed.preheader || "").slice(0, 140);
  const sections: Section[] =
    parsed.body_sections && parsed.body_sections.length
      ? parsed.body_sections.slice(0, 4)
      : [{ text: "We've got something we think you'll love. Take a look." }];
  const cta = (parsed.cta_text || "Shop now").slice(0, 24);

  return { subject, preheader, html: renderEmailHtml({ subject, preheader, sections, cta, storeName: input.storeName || "" }) };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Clean, responsive, email-client-safe HTML (table layout, inline styles). */
function renderEmailHtml(e: {
  subject: string;
  preheader: string;
  sections: Section[];
  cta: string;
  storeName: string;
}): string {
  const body = e.sections
    .map(
      (s) => `
      ${s.heading ? `<tr><td style="padding:0 32px 6px;font:700 18px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14121F;">${esc(s.heading)}</td></tr>` : ""}
      <tr><td style="padding:0 32px 16px;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#4A4664;">${esc(s.text)}</td></tr>`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(e.subject)}</title></head>
<body style="margin:0;padding:0;background:#F4F0E6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(e.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F0E6;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(20,18,31,.08);">
      <tr><td style="height:6px;background:linear-gradient(90deg,#F0B429,#C98F12);"></td></tr>
      <tr><td style="padding:26px 32px 4px;font:800 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#C98F12;">${esc(e.storeName || "Your store")}</td></tr>
      <tr><td style="padding:8px 32px 18px;font:800 24px/1.25 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14121F;">${esc(e.subject)}</td></tr>
      ${body}
      <tr><td style="padding:8px 32px 30px;">
        <a href="#" style="display:inline-block;background:#14121F;color:#FFD778;text-decoration:none;font:800 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:14px 26px;border-radius:10px;">${esc(e.cta)} &nbsp;→</a>
      </td></tr>
      <tr><td style="padding:18px 32px 26px;border-top:1px solid #EEE9DC;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8A8598;">
        Sent with 🏝️ EasyMode · <a href="#" style="color:#8A8598;">Unsubscribe</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
