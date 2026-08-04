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
      meta.clicks = (Number(meta.clicks) || 0) + 1;
      await db.asset.update({ where: { id }, data: { metaJson: JSON.stringify(meta) } });

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
