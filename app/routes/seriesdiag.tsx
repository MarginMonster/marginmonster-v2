// TEMPORARY owner-scoped diagnostic for Channels — reports why the logged-in
// shop's channel isn't dropping (own shop only; remove after diagnosing).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { getWebIdentity } from "../lib/web-auth.server";
import { debugDropOnce } from "../lib/creator-series.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const id = await getWebIdentity(request);
  if (!id) return new Response(JSON.stringify({ error: "not logged in" }), { status: 401, headers: { "Content-Type": "application/json" } });
  const out = await debugDropOnce(id.shop.id);
  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
};
