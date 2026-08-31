import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { db } from "../db.server";

/* Asset-level attribution turnstile — the manual-post sibling of the
 * campaign-slot /go route. Every "Post now" caption links here, we count the
 * click on the exact piece that earned it, then forward to the product with
 * UTM tags so the merchant's own analytics attributes the sale.
 *
 * PUBLIC — clicked from TikTok/IG/FB, no session. Never breaks a shopper. */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const id = params.assetId || "";
  try {
    const a = await db.asset.findUnique({
      where: { id },
      include: { shop: { select: { id: true, domain: true } } },
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
      for (let attempt = 0; attempt < 3; attempt++) {
        const fresh = await db.asset.findUnique({ where: { id }, select: { metaJson: true } });
        if (!fresh) break;
        let cur: Record<string, unknown> = {};
        try { cur = JSON.parse(fresh.metaJson || "{}"); } catch { /* fresh */ }
        cur.clicks = (Number(cur.clicks) || 0) + 1;
        const done = await db.asset.updateMany({
          where: { id, metaJson: fresh.metaJson },
          data: { metaJson: JSON.stringify(cur) },
        });
        if (done.count === 1) break;
        // Something else committed in between — read it again and re-apply.
      }

      const title = typeof meta.productTitle === "string" ? meta.productTitle : undefined;
      let base = "";
      try {
        const { productLinkFor } = await import("../lib/catalog-import.server");
        base = await productLinkFor(a.shop.id, title);
      } catch { /* fall through to the storefront */ }
      if (!base) base = `https://${a.shop.domain}`;
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
