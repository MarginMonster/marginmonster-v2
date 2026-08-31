import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { db } from "../db.server";
import { clientIp, rateLimit } from "../lib/rate-limit.server";
import { parseSchedule } from "../lib/questlines";

/* The attribution turnstile. Every auto-posted caption links here instead of
 * the raw product page — we count the click on the exact campaign slot that
 * earned it, then forward to the storefront with UTM tags so the merchant's
 * own Shopify analytics attributes any sale to utm_campaign=<template>.
 * (In-app dollar attribution lands with the read_orders PCD approval.)
 *
 * PUBLIC route — clicked from TikTok/IG/FB, no session. Never breaks the
 * shopper: any failure still redirects somewhere sensible. */
/* One source cannot run the click counter up.
 *
 * These numbers are shown to the merchant as results, and they unlock
 * achievements that pay tokens — GOLD_RUSH at one click and TREASURE_HUNTER at
 * twenty-five, 55 tokens between them. The route is a public GET with the id
 * in the caption of every post, so anybody could curl it in a loop: real money
 * out of nothing, and a Results page reporting engagement that never happened.
 *
 * Counting is what gets throttled, never the redirect — a shopper must always
 * reach the product. Three per source per ten minutes is far above what a
 * person does with one link and far below what a loop needs. It is a floor,
 * not a bot defence: link previewers and shared NATs will still be counted.
 */
const CLICK_LIMIT = 3;
const CLICK_WINDOW_MS = 10 * 60_000;

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const qid = params.qid || "";
  const idx = parseInt(params.idx || "-1", 10);
  const countable = rateLimit(`click:${clientIp(request)}:q:${qid}:${idx}`, CLICK_LIMIT, CLICK_WINDOW_MS).ok;

  try {
    const q = await db.questline.findUnique({
      where: { id: qid },
      include: { shop: { select: { domain: true, storeUrl: true } } },
    });
    if (q) {
      const schedule = parseSchedule(q.scheduleJson);
      const slot = schedule.slots.find((s) => s.idx === idx);

      // Count the click with a compare-and-swap, writing back only this slot.
      //
      // The old note here said "single-instance worker → no race drama". That
      // was the wrong invariant: the worker is imported into shopify.server.ts
      // and shares this process's event loop, so the collision was never
      // worker-against-worker — it was this route against the auto-poster.
      // postDueSlots stamps a slot POSTED with the platforms it reached, and a
      // shopper click landing in between wrote this stale blob back over it.
      // postedTo is the only thing stopping a re-publish to an account that
      // already took the post, so erasing it made the next scan post again:
      // duplicate posts on the merchant's real accounts, caused by a shopper
      // clicking a link. This is the highest-frequency writer of this blob and
      // it is public, so it collides precisely during a publish window.
      if (slot && countable) {
        let total = 0;
        for (let attempt = 0; attempt < 3; attempt++) {
          const fresh = await db.questline.findUnique({ where: { id: q.id }, select: { scheduleJson: true } });
          if (!fresh) break;
          const current = parseSchedule(fresh.scheduleJson);
          const target = current.slots.find((x) => x.idx === idx);
          if (!target) break;
          target.clicks = (target.clicks || 0) + 1;
          const done = await db.questline.updateMany({
            where: { id: q.id, scheduleJson: fresh.scheduleJson },
            data: { scheduleJson: JSON.stringify(current) },
          });
          if (done.count === 1) {
            total = current.slots.reduce((n, x) => n + (x.clicks || 0), 0);
            break;
          }
          // Something else committed in between — read it again and re-apply.
        }
        // gold-rush achievements — a real shopper just walked the plank
        try {
          const { unlockAchievement } = await import("../lib/xp.server");
          if (total >= 1) await unlockAchievement(q.shopId, "GOLD_RUSH");
          if (total >= 25) await unlockAchievement(q.shopId, "TREASURE_HUNTER");
        } catch { /* never break a shopper's redirect */ }
      }

      // Same as the asset turnstile: a web shop's domain is synthetic and dead,
      // so prefer the slot's own product link, then the crawled storefront.
      const base =
        slot?.productUrl ||
        q.shop.storeUrl ||
        (/\.easymode\.app$/i.test(q.shop.domain) ? "https://easymodeapp.com" : `https://${q.shop.domain}`);
      const u = new URL(base);
      u.searchParams.set("utm_source", "easymode");
      u.searchParams.set("utm_medium", "social");
      u.searchParams.set("utm_campaign", q.template.toLowerCase());
      u.searchParams.set("utm_content", `day${slot?.day ?? 0}`);
      return redirect(u.toString(), 302);
    }
  } catch (e) {
    console.error("[go] click redirect failed:", e);
  }
  // unknown quest → OUR front door beats a 404 for a curious shopper. (This
  // used to send them to the Shopify App Store — a dead end for the web
  // product's merchants, whose stores may not be Shopify at all.)
  return redirect("https://easymodeapp.com", 302);
};
