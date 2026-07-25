/* Diagnostics for the self-forging art systems — open /art-status in a
 * browser to see exactly which style tiles / ad-template files exist on the
 * server's disk and why any render failed (the builders' recent activity
 * log). Read-only, no secrets: env vars are reported as present/absent only. */

import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";
import { artLogEntries } from "../lib/art-log.server";

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

export const loader = async (_args: LoaderFunctionArgs) => {
  const cwd = process.cwd();
  const body = {
    now: new Date().toISOString(),
    env: {
      REPLICATE_API_TOKEN: !!process.env.REPLICATE_API_TOKEN,
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      FAL_KEY: !!process.env.FAL_KEY,
      SHOPIFY_APP_URL: !!process.env.SHOPIFY_APP_URL,
    },
    styleTiles: listDir(path.join(cwd, "data", "renders", "style-tiles")),
    adTemplates: listDir(path.join(cwd, "data", "renders", "ad-templates")),
    activity: artLogEntries(),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
