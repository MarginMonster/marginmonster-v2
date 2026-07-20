import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { db } from "../db.server";
import { parseSchedule } from "../lib/questlines";

/* The attribution turnstile. Every auto-posted caption links here instead of
 * the raw product page — we count the click on the exact campaign slot that
 * earned it, then forward to the storefront with UTM tags so the merchant's
 * own Shopify analytics attributes any sale to utm_campaign=<template>.
 * (In-app dollar attribution lands with the read_orders PCD approval.)
 *
 * PUBLIC route — clicked from TikTok/IG/FB, no session. Never breaks the
 * shopper: any failure still redirects somewhere sensible. */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const qid = params.qid || "";
  const idx = parseInt(params.idx || "-1", 10);

  try {
    const q = await db.questline.findUnique({
      where: { id: qid },
      include: { shop: { select: { domain: true } } },
    });
    if (q) {
      const schedule = parseSchedule(q.scheduleJson);
      const slot = schedule.slots.find((s) => s.idx === idx);

      // count the click on its slot (single-instance worker → no race drama)
      if (slot) {
        slot.clicks = (slot.clicks || 0) + 1;
        await db.questline.update({
          where: { id: q.id },
          data: { scheduleJson: JSON.stringify(schedule) },
        });
        // gold-rush achievements — a real shopper just walked the plank
        try {
          const { unlockAchievement } = await import("../lib/xp.server");
          const total = schedule.slots.reduce((n, s) => n + (s.clicks || 0), 0);
          if (total >= 1) await unlockAchievement(q.shopId, "GOLD_RUSH");
          if (total >= 25) await unlockAchievement(q.shopId, "TREASURE_HUNTER");
        } catch { /* never break a shopper's redirect */ }
      }

      const base = slot?.productUrl || `https://${q.shop.domain}`;
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
  // unknown quest → the app's marketing page beats a 404 for a curious shopper
  return redirect("https://apps.shopify.com", 302);
};
