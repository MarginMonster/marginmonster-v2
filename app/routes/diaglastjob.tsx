// TEMPORARY owner-scoped diagnostic: returns the logged-in shop's own recent
// video jobs (status + lastError) so a failed faceless render's exact error is
// readable without the PURGE_KEY-gated /art-status. Own shop only (authenticated
// via the web session), so no cross-merchant data. Remove after diagnosing.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { getWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const id = await getWebIdentity(request);
  if (!id) return new Response(JSON.stringify({ error: "not logged in" }), { status: 401, headers: { "Content-Type": "application/json" } });
  const jobs = await db.job.findMany({
    where: { shopId: id.shop.id, type: "GENERATE_VIDEO_AD" },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { id: true, status: true, attempts: true, lastError: true, updatedAt: true, payload: true },
  });
  const out = jobs.map((j) => {
    let topic = "";
    let contentType = "";
    try { const p = JSON.parse(j.payload) as { topic?: string; contentType?: string }; topic = (p.topic || "").slice(0, 80); contentType = p.contentType || ""; } catch { /* ignore */ }
    return { id: j.id, status: j.status, attempts: j.attempts, contentType, topic, lastError: j.lastError, updatedAt: j.updatedAt };
  });
  return new Response(JSON.stringify({ shop: id.shop.id, jobs: out }, null, 2), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
