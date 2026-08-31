/* Diagnostics for the self-forging art systems — open /art-status in a
 * browser to see exactly which style tiles / ad-template files exist on the
 * server's disk and why any render failed (the builders' recent activity
 * log). Read-only, no secrets: env vars are reported as present/absent only. */

import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";
import { artLogEntries } from "../lib/art-log.server";
import { stripeWebhookReady } from "../lib/stripe.server";

/** Upload-directory health WITHOUT naming the files. See the call site. */
function uploadHealth(dir: string): { count: number; emptyFiles: number; totalKb: number; newest: string | null } {
  try {
    const files = fs.readdirSync(dir).filter((f) => !f.startsWith("."));
    let totalKb = 0;
    let emptyFiles = 0;
    let newest = 0;
    for (const f of files) {
      const st = fs.statSync(path.join(dir, f));
      totalKb += Math.round(st.size / 1024);
      if (st.size === 0) emptyFiles++;
      newest = Math.max(newest, st.mtime.getTime());
    }
    return { count: files.length, emptyFiles, totalKb, newest: newest ? new Date(newest).toISOString() : null };
  } catch {
    return { count: 0, emptyFiles: 0, totalKb: 0, newest: null };
  }
}

function listDir(dir: string): { name: string; kb: number; mtime: string }[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => !f.startsWith("."))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, kb: Math.round(st.size / 1024), mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  } catch {
    return [];
  }
}

/** Generation health — why merchant renders fail, readable without shell
 * access. Public, so it carries NO merchant content: job type/status/age and
 * the error MESSAGE only, with URLs, emails and long tokens scrubbed. */
function scrub(s: string): string {
  return s
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, "[email]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]")
    .slice(0, 300);
}

async function generationHealth(includeFailureText = false) {
  try {
    const { db } = await import("../db.server");
    const since = new Date(Date.now() - 24 * 3600_000);
    const jobs = await db.job.findMany({
      where: { type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_BLOG_POST"] }, updatedAt: { gte: since } },
      orderBy: { updatedAt: "desc" },
      take: 60,
      select: { type: true, status: true, attempts: true, updatedAt: true, lastError: true },
    });
    const counts: Record<string, number> = {};
    for (const j of jobs) counts[`${j.type.replace("GENERATE_", "").toLowerCase()}:${j.status}`] = (counts[`${j.type.replace("GENERATE_", "").toLowerCase()}:${j.status}`] || 0) + 1;
    const failures = jobs
      .filter((j) => j.lastError)
      .slice(0, 10)
      .map((j) => ({
        type: j.type.replace("GENERATE_", "").toLowerCase(),
        status: j.status,
        attempts: j.attempts,
        minsAgo: Math.round((Date.now() - j.updatedAt.getTime()) / 60000),
        error: scrub(j.lastError || ""),
      }));
    return { last24h: counts, failures: includeFailureText ? failures : [] };
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 160) : "unavailable" };
  }
}

/** The shared diagnostics key, exactly as api.diag.tsx checks it: unset in
 *  the environment means nobody has it. */
function hasDiagKey(request: Request): boolean {
  const key = process.env.PURGE_KEY;
  if (!key) return false;
  return new URL(request.url).searchParams.get("key") === key;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const cwd = process.cwd();
  const body = {
    now: new Date().toISOString(),
    env: {
      REPLICATE_API_TOKEN: !!process.env.REPLICATE_API_TOKEN,
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      FAL_KEY: !!process.env.FAL_KEY,
      SHOPIFY_APP_URL: !!process.env.SHOPIFY_APP_URL,
      // Web front-door readiness (booleans only — never values)
      STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
      // True when the self-provisioned (or env-set) webhook signing secret exists.
      STRIPE_WEBHOOK: await stripeWebhookReady().catch(() => false),
      SESSION_SECRET: !!process.env.SESSION_SECRET,
      UPLOADPOST_API_KEY: !!process.env.UPLOADPOST_API_KEY,
      RESEND_API_KEY: !!process.env.RESEND_API_KEY,
      // DEV_GRANT_KEY is deliberately NOT reported. This route is public — no
      // authentication anywhere in it — and that flag answers "is the
      // token-granting route armed right now?" for anyone who asks. Knowing
      // when a backdoor is open is most of the work of using one, and the key
      // itself travels in a query string, which lands in access logs. The
      // answer belongs in the Render dashboard, next to the variable.
    },
    // Merchant photo uploads. This route has no authentication — the header
    // above says to open it in a browser — and /uploads/:file is protected by
    // nothing but the unguessability of its random filenames. Listing those
    // names here handed out the key: it turned a private store of merchants'
    // own product and mascot photographs into a public directory, readable by
    // anyone, across every shop on the instance.
    //
    // The diagnostic this was for — "are uploads present and non-empty, or is
    // the upload path broken" — needs counts, not names.
    uploads: uploadHealth(path.join(cwd, "data", "renders", "uploads")),
    styleTiles: listDir(path.join(cwd, "data", "renders", "style-tiles")),
    adTemplates: listDir(path.join(cwd, "data", "renders", "ad-templates")),
    // FAILURE TEXT NAMES FILES. A pipeline error carries the render it was
    // working on, and /renders is public by necessity — so an anonymous
    // caller could read a failure here, lift the filename out of it, and
    // fetch another merchant's forged presenter or paid video. The aggregate
    // counts are safe and stay public; the messages need the same diagnostics
    // key the activity log already requires.
    generation: await generationHealth(hasDiagKey(request)),
    // Merchant-specific render activity only with the diagnostics key — the
    // same PURGE_KEY gate api.diag.tsx uses. Without it this page still
    // answers the question it exists for ("did the app's own art build?")
    // but stops publishing other shops' product names and ad copy.
    activity: artLogEntries(hasDiagKey(request)),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
