import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";

/** Diagnostic: run a trivial Admin API query with the stored session and
 *  return the FULL raw response (status, headers, body) + session details so
 *  we can see exactly why Shopify 403s. Protected by the shared key. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== (process.env.PURGE_KEY || "adarcade-fix-2026")) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  const shop = url.searchParams.get("shop");
  if (!shop) return json({ error: "shop required" }, { status: 400 });
  const domain = shop.includes(".myshopify.com") ? shop : `${shop}.myshopify.com`;

  let session: { isOnline?: boolean; scope?: string | null; accessToken?: string } = {};
  try {
    const ctx = await unauthenticated.admin(domain);
    session = {
      isOnline: ctx.session.isOnline,
      scope: ctx.session.scope,
      accessToken: ctx.session.accessToken,
    };
    try {
      const res = await ctx.admin.graphql(`{ shop { name myshopifyDomain } }`);
      const body = await res.text();
      return json({
        result: "responded",
        httpStatus: res.status,
        session: { isOnline: session.isOnline, scope: session.scope, tokenPrefix: session.accessToken?.slice(0, 6), tokenLen: session.accessToken?.length },
        headers: Object.fromEntries(res.headers.entries()),
        body: body.slice(0, 1200),
      });
    } catch (thrown) {
      if (thrown instanceof Response) {
        const t = await thrown.text().catch(() => "(no body)");
        return json({
          result: "threwResponse",
          httpStatus: thrown.status,
          statusText: thrown.statusText,
          session: { isOnline: session.isOnline, scope: session.scope, tokenPrefix: session.accessToken?.slice(0, 6), tokenLen: session.accessToken?.length },
          headers: Object.fromEntries(thrown.headers.entries()),
          body: t.slice(0, 1200),
        });
      }
      return json({ result: "threwError", error: String(thrown), session: { isOnline: session.isOnline, scope: session.scope } });
    }
  } catch (e) {
    return json({ result: "noSession", error: e instanceof Error ? e.message : String(e) });
  }
};
