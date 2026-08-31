import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { db } from "../db.server";
import { clientIp, rateLimit } from "../lib/rate-limit.server";

/* Asset-level attribution turnstile — the manual-post sibling of the
 * campaign-slot /go route. Every "Post now" caption links here, we count the
 * click on the exact piece that earned it, then forward to the product with
 * UTM tags so the merchant's own analytics attributes the sale.
 *
 * PUBLIC — clicked from TikTok/IG/FB, no session. Never breaks a shopper. */
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
  const id = params.assetId || "";
  const countable = rateLimit(`click:${clientIp(request)}:a:${id}`, CLICK_LIMIT, CLICK_WINDOW_MS).ok;
  try {
    const a = await db.asset.findUnique({
      where: { id },
      include: { shop: { select: { id: true, domain: true, storeUrl: true } } },
    });
    if (a) {
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(a.metaJson || "{}"); } catch { /* fresh */ }

      // COUNT THE CLICK WITHOUT CLOBBERING THE BLOB.
      //
      // This is a read-modify-write of metaJson from a PUBLIC route — the
      // highest-frequency writer of that field, reachable by anyone with the
      // link, and it shares an event loop with everything else. The sibling
      // /go/:qid/:idx route was fixed for exactly this and its comment spells
      // out why it matters; this one was left as it was.
      //
      // metaJson also holds postedTo — the record of which accounts already
      // have this piece, and the only thing stopping a second attempt from
      // posting again where it already landed (web.archive.tsx writes it after
      // the network round-trip, so its read is seconds stale). A shopper
      // clicking in that window wrote a blob back without postedTo, and the
      // merchant's next attempt duplicated posts on their real accounts.
      // Caused by a stranger tapping a link.
      //
      // A lost click count is nothing; a lost postedTo is not. So this gives
      // up rather than forcing the write.
      for (let attempt = 0; countable && attempt < 3; attempt++) {
        const fresh = await db.asset.findUnique({ where: { id }, select: { metaJson: true } });
        if (!fresh) break;
        let cur: Record<string, unknown> = {};
        try { cur = JSON.parse(fresh.metaJson || "{}"); } catch { /* fresh */ }
        cur.clicks = (Number(cur.clicks) || 0) + 1;
        const done = await db.asset.updateMany({
          where: { id, metaJson: fresh.metaJson },
          data: { metaJson: JSON.stringify(cur) },
        });
        if (done.count === 1) {
          // THE HEADER ABOVE PROMISES THESE AND NOTHING PAID THEM.
          //
          // “they unlock achievements that pay tokens — GOLD_RUSH at one click
          // and TREASURE_HUNTER at twenty-five, 55 tokens between them” was
          // copied from the campaign turnstile, which does award them. This
          // route counted the click and awarded nothing, so every click on a
          // manually-posted piece earned the merchant none of it.
          //
          // Non-fatal on purpose: a shopper must always reach the product,
          // whatever the wallet is doing.
          try {
            const { unlockAchievement } = await import("../lib/xp.server");
            await unlockAchievement(a.shop.id, "GOLD_RUSH");
            if ((Number(cur.clicks) || 0) >= 25) await unlockAchievement(a.shop.id, "TREASURE_HUNTER");
          } catch (e) {
            console.error("[go:a] click achievement failed (non-fatal):", e);
          }
          break;
        }
        // Something else committed in between — read it again and re-apply.
      }

      const title = typeof meta.productTitle === "string" ? meta.productTitle : undefined;
      // The exact page the merchant picked beats any lookup by title.
      let base = typeof meta.productUrl === "string" && /^https?:\/\//i.test(meta.productUrl) ? meta.productUrl : "";
      try {
        const { productLinkFor } = await import("../lib/catalog-import.server");
        if (!base) base = await productLinkFor(a.shop.id, title);
      } catch { /* fall through to the storefront */ }
      // A WEB SHOP'S `domain` IS NOT A REAL HOST.
      //
      // It is the synthetic web-<accountId>.easymode.app minted at signup, and
      // it does not resolve. Falling back to it meant that any piece whose
      // product could not be matched by title — a hand-typed title, anything
      // added by URL, every service, and every merchant who never ran an
      // import — sent its shoppers to a dead address. The storefront the
      // catalogue was crawled from is the honest fallback; the app's own front
      // door beats a dead host if we have neither.
      if (!base) base = a.shop.storeUrl || (/\.easymode\.app$/i.test(a.shop.domain) ? "https://easymodeapp.com" : `https://${a.shop.domain}`);
      const u = new URL(base);
      u.searchParams.set("utm_source", "easymode");
      u.searchParams.set("utm_medium", "social");
      u.searchParams.set("utm_campaign", "archive");
      u.searchParams.set("utm_content", id.slice(0, 12));
      return redirect(u.toString(), 302);
    }
  } catch (e) {
    console.error("[go:a] click redirect failed:", e);
  }
  return redirect("https://easymodeapp.com", 302);
};
