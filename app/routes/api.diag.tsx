import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import { db } from "../db.server";

/** Diagnostic: run a trivial Admin API query with the stored session and
 *  return the FULL raw response (status, headers, body) + session details so
 *  we can see exactly why Shopify 403s. Protected by the shared key. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== (process.env.PURGE_KEY || "adarcade-fix-2026")) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  // Job-state dump — why are videos "rendering forever"? No shop needed.
  if (url.searchParams.get("mode") === "jobs") {
    const now = Date.now();
    const jobs = await db.job.findMany({
      where: { type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_BLOG_POST", "FORGE_COMPANION"] } },
      orderBy: { updatedAt: "desc" },
      take: 25,
    });
    return json({
      envKeys: {
        replicate: !!process.env.REPLICATE_API_TOKEN,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        uploadpost: !!process.env.UPLOADPOST_API_KEY,
      },
      counts: jobs.reduce((m: Record<string, number>, j) => { m[j.status] = (m[j.status] || 0) + 1; return m; }, {}),
      jobs: jobs.map((j) => {
        let ck: string[] = [];
        try { const p = JSON.parse(j.payload); ck = ["ckScript", "ckAudioUrl", "ckOmniId", "ckTalkingUrl"].filter((k) => p[k]); } catch { /* skip */ }
        return {
          type: j.type, status: j.status, attempts: j.attempts,
          ageMin: Math.round((now - j.updatedAt.getTime()) / 60000),
          stage: ck.length ? ck[ck.length - 1] : "start",
          err: j.lastError?.slice(0, 140) || null,
        };
      }),
    });
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
