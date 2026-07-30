/* Diagnostics for the self-forging art systems — open /art-status in a
 * browser to see exactly which style tiles / ad-template files exist on the
 * server's disk and why any render failed (the builders' recent activity
 * log). Read-only, no secrets: env vars are reported as present/absent only. */

import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";
import { artLogEntries } from "../lib/art-log.server";
import { stripeWebhookReady } from "../lib/stripe.server";

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

async function generationHealth() {
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
    return { last24h: counts, failures };
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 160) : "unavailable" };
  }
}

export const loader = async (_args: LoaderFunctionArgs) => {
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
    },
    // Merchant photo uploads — if these are missing or 0 KB, the studio's
    // upload path is broken and every render fails on an unfetchable input.
    uploads: listDir(path.join(cwd, "data", "renders", "uploads")).slice(-12),
    styleTiles: listDir(path.join(cwd, "data", "renders", "style-tiles")),
    adTemplates: listDir(path.join(cwd, "data", "renders", "ad-templates")),
    generation: await generationHealth(),
    activity: artLogEntries(),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
