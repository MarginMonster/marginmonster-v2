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
  // Recent finished takes with the engine that produced them (heygen-fal vs
  // omni-human vs kling-voiceover) — verifies the premium engine engaged.
  if (url.searchParams.get("mode") === "takes") {
    const assets = await db.asset.findMany({
      where: { type: "VIDEO_AD" },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { createdAt: true, title: true, bodyJson: true },
    });
    return json({
      takes: assets.map((a) => {
        let engine = "?", hasUrl = false, fileExists = false;
        try {
          const b = JSON.parse(a.bodyJson);
          engine = b.engine || "minimax-showcase";
          hasUrl = !!b.videoUrl;
          if (typeof b.videoUrl === "string" && b.videoUrl.startsWith("/renders/")) {
            const fs = require("node:fs") as typeof import("node:fs");
            const path = require("node:path") as typeof import("node:path");
            fileExists = fs.existsSync(path.join(process.cwd(), "data", "renders", path.basename(b.videoUrl)));
          }
        } catch { /* skip */ }
        return { at: a.createdAt, title: a.title?.slice(0, 40), engine, hasUrl, fileExists };
      }),
    });
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
        fal: !!process.env.FAL_KEY,
      },
      counts: jobs.reduce((m: Record<string, number>, j) => { m[j.status] = (m[j.status] || 0) + 1; return m; }, {}),
      jobs: jobs.map((j) => {
        let ck: string[] = [];
        let falErr: string | null = null;
        try {
          const p = JSON.parse(j.payload);
          ck = ["ckScript", "ckAudioUrl", "ckOmniId", "ckTalkingUrl"].filter((k) => p[k]);
          falErr = typeof p.ckFalError === "string" ? p.ckFalError : null;
        } catch { /* skip */ }
        return {
          type: j.type, status: j.status, attempts: j.attempts,
          ageMin: Math.round((now - j.updatedAt.getTime()) / 60000),
          dueMin: j.runAt ? Math.round((j.runAt.getTime() - now) / 60000) : "now",
          stage: ck.length ? ck[ck.length - 1] : "start",
          falErr,
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
