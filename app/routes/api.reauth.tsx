import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "../db.server";

/**
 * One-time maintenance endpoint: purge a shop's stored session so the next
 * embedded load is forced to mint a FRESH token via token exchange. Legacy
 * OAuth offline tokens are now 403-rejected by Shopify, and the SDK reuses an
 * active (never-expiring) offline session instead of re-exchanging — so the
 * only way out is to delete the stale session. Protected by a shared key.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const shop = url.searchParams.get("shop");

  if (key !== (process.env.PURGE_KEY || "adarcade-fix-2026")) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  if (!shop) return json({ error: "shop query param required" }, { status: 400 });

  const domain = shop.includes(".myshopify.com") ? shop : `${shop}.myshopify.com`;

  const sessions = await db.session.deleteMany({ where: { shop: domain } });
  // Also clear the manually-stored legacy token on the shop row (unused now,
  // but keeps things clean). Keep the shop record + its data intact.
  let shopCleared = false;
  try {
    const s = await db.shop.findUnique({ where: { domain } });
    if (s) {
      await db.shop.update({ where: { id: s.id }, data: { accessToken: "" } });
      shopCleared = true;
    }
  } catch {
    /* non-fatal */
  }

  return json({
    ok: true,
    shop: domain,
    sessionsDeleted: sessions.count,
    shopCleared,
    next: "Reload the app in Shopify admin — it will token-exchange a fresh token.",
  });
};
