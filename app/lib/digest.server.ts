import { db } from "../db.server";
import { emailEnabled, sendEmail } from "./email-provider.server";
import { unsubscribeUrl } from "./unsubscribe.server";
import { publicWebUrl } from "./public-url.ts";

/* Monthly "here's what we made you" digest — a warm recap of the content
 * EasyMode produced, sent to engaged (paying) merchants who've connected an
 * email. It pulls lapsing users back into the app to see their content.
 *
 * Worker-driven, self-throttled, per-shop 30-day gate. Never throws. Only
 * sends when email is connected AND the store has an email on file AND an
 * active plan (never cold-emails non-customers). */

const EVERY_MS = 6 * 60 * 60_000;
let lastRun = 0;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function digestHtml(d: { storeName: string; total: number; videos: number; images: number; blogs: number; published: number; appUrl: string; optOutUrl: string }): string {
  const row = (label: string, n: number, emoji: string) =>
    n > 0 ? `<tr><td style="padding:6px 0;font-size:15px;color:#14201b;">${emoji} ${label}</td><td style="padding:6px 0;font-size:15px;font-weight:700;color:#0F7A46;text-align:right;">${n}</td></tr>` : "";
  const body = d.total > 0
    ? `<p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#3f4a43;">Here's everything EasyMode created for <b>${esc(d.storeName)}</b> this month — ready and waiting in your Archive.</p>
       <table style="width:100%;border-collapse:collapse;margin:0 0 8px;">
         ${row("Product videos", d.videos, "🎬")}
         ${row("Image ads", d.images, "🖼")}
         ${row("SEO blog posts", d.blogs, "✍️")}
         ${d.published > 0 ? `<tr><td colspan="2" style="padding:10px 0 0;border-top:1px solid #e4e8e0;font-size:14px;color:#6c7a70;">${d.published} went live this month 🎉</td></tr>` : ""}
       </table>`
    : `<p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#3f4a43;">It's a fresh month for <b>${esc(d.storeName)}</b> — the perfect time to spin up new content. A blog, an image ad, or a product video is a couple of taps away.</p>`;
  return `<div style="max-width:520px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f7f3;border-radius:18px;padding:32px 28px;">
    <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#0F7A46;font-weight:700;">Your EasyMode month 🏝️</div>
    <h1 style="font-size:26px;line-height:1.2;color:#14201b;margin:8px 0 18px;">${d.total > 0 ? `We made you ${d.total} new piece${d.total === 1 ? "" : "s"}` : "Ready when you are"}</h1>
    ${body}
    <a href="${d.appUrl}/app/archive" style="display:inline-block;margin-top:14px;background:linear-gradient(165deg,#12A85E,#0B6B3E);color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:13px 26px;border-radius:12px;">Open your Archive →</a>
    <p style="margin:22px 0 0;font-size:12px;color:#9aa197;">You're getting this because EasyMode is active on your store. Manage content anytime from your Shopify admin.${
      /^https?:\/\//.test(d.optOutUrl) ? ` · <a href="${esc(d.optOutUrl)}" style="color:#9aa197;">Unsubscribe from these summaries</a>` : ""
    }</p>
  </div>`;
}

export async function sendMonthlyDigests(): Promise<void> {
  const now = Date.now();
  if (now - lastRun < EVERY_MS) return;
  lastRun = now;
  if (!emailEnabled()) return;

  try {
    const cutoff = new Date(now - 30 * 86_400_000);
    const shops = await db.shop.findMany({
      where: {
        contactEmail: { not: null },
        activePlan: { is: { active: true } },
        OR: [{ lastDigestAt: null }, { lastDigestAt: { lt: cutoff } }],
      },
      select: { id: true, domain: true, contactEmail: true },
      take: 200,
    });
    if (!shops.length) return;

    // The brand's own domain, not the Shopify app's Render hostname.
    const appUrl = publicWebUrl();
    for (const s of shops) {
      if (!s.contactEmail) continue;
      const to = s.contactEmail.trim().toLowerCase();

      // Honour the opt-out. Same Subscriber row the one-click unsubscribe
      // (u.$token.tsx) and sendBrandEmail write/read, keyed on this shop's own
      // contactEmail — if that exact address unsubscribed, no digest goes out.
      const optedOut = await db.subscriber.findUnique({
        where: { shopId_email: { shopId: s.id, email: to } },
        select: { status: true },
      });
      if (optedOut && optedOut.status !== "subscribed") continue;

      // A working opt-out link for the footer + the List-Unsubscribe header.
      // publicWebUrl(), not the Shopify Render host, so the link is on the
      // brand domain. A missing signing secret must not kill the whole worker:
      // fall back to a header-less, link-less send (the opt-out note stays).
      let optOutUrl = "";
      try {
        optOutUrl = unsubscribeUrl(appUrl, s.id, to);
      } catch (e) {
        console.error("[digest] no unsubscribe link (signing secret unset?):", (e as Error).message);
      }

      const made = await db.asset.findMany({
        where: { shopId: s.id, createdAt: { gte: cutoff } },
        select: { type: true },
      });
      const published = await db.asset.count({ where: { shopId: s.id, status: "PUBLISHED", updatedAt: { gte: cutoff } } });
      const count = (t: string) => made.filter((a) => a.type === t).length;
      const videos = count("VIDEO_AD"), images = count("IMAGE_AD"), blogs = count("BLOG_POST");
      const total = videos + images + blogs;
      const storeName = s.domain.replace(/\.myshopify\.com$/, "").replace(/[-_]+/g, " ");
      const subject = total > 0
        ? `EasyMode made you ${total} piece${total === 1 ? "" : "s"} this month 🏝️`
        : `A fresh month of content awaits 🏝️`;
      const html = digestHtml({ storeName, total, videos, images, blogs, published, appUrl, optOutUrl });
      const r = await sendEmail({ to, subject, html, unsubscribeUrl: optOutUrl || undefined });
      if (r.ok) await db.shop.update({ where: { id: s.id }, data: { lastDigestAt: new Date() } });
    }
    console.log(`[digest] processed ${shops.length} shop(s)`);
  } catch (e) {
    console.error("[digest] send failed (non-fatal):", e);
  }
}
