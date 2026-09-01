import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
// ESM bundle — require() does NOT exist at runtime here (it crashed mode=disk
// and silently no-op'd the takes fileExists probe). Use real imports.
import fs from "node:fs";
import path from "node:path";
import { unauthenticated } from "../shopify.server";
import { db } from "../db.server";

/** Diagnostic: run a trivial Admin API query with the stored session and
 *  return the FULL raw response (status, headers, body) + session details so
 *  we can see exactly why Shopify 403s. Protected by the shared key. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  // Disabled unless PURGE_KEY is explicitly set on the server (unset in prod →
  // this debug endpoint is fully dead). No hardcoded fallback secret.
  if (!process.env.PURGE_KEY || url.searchParams.get("key") !== process.env.PURGE_KEY) {
    return json({ error: "not found" }, { status: 404 });
  }
  /** Every merchant-data mode names its shop. A debug endpoint that reads
   *  across tenants is a liability the moment its key leaks, and none of these
   *  modes actually need the fleet — you are always debugging one merchant. */
  type Scoped =
    | { target: { id: string; domain: string }; error?: undefined }
    | { error: string; status: number; target?: undefined };
  const scopedShop = async (): Promise<Scoped> => {
    const who = (url.searchParams.get("shop") || "").trim();
    if (!who) return { error: "Name a shop: &shop=<domain or shop id>. This endpoint never reads across shops.", status: 400 };
    const target = await db.shop.findFirst({
      where: { OR: [{ id: who }, { domain: who }] },
      select: { id: true, domain: true },
    });
    return target ? { target } : { error: `No shop matching "${who}".`, status: 404 };
  };

  // Billing forensics — the last failed billing.request (status/headers/body/
  // session snapshot) captured in memory by recordBillingFailure.
  if (url.searchParams.get("mode") === "billing") {
    const { lastBillingFailure } = await import("../lib/billing-debug.server");
    return json({ lastFailure: lastBillingFailure() });
  }

  // Voice-casting audit — every presenter's derived traits + the exact voice
  // the scorer gives them. Curate mismatches into VOICE_OVERRIDES.
  if (url.searchParams.get("mode") === "voices") {
    const { AVATARS } = await import("../lib/avatars");
    const { pickVoice } = await import("../lib/ugc-ad-pipeline.server");
    return json({
      voices: AVATARS.map((a) => ({
        id: a.id, name: a.name, vibe: a.vibe,
        gender: a.gender, age: a.ageBand, energy: a.energy,
        voice: pickVoice(a),
      })),
    });
  }

  // Premium-voice health, RUN FROM PRODUCTION. CI proved all 21 designed
  // (ttv-voice-*) voices resolve under the CI FAL_KEY — but designed voices are
  // scoped to the fal ACCOUNT that created them, so if prod holds a different
  // key every premium presenter silently downgrades to a generic stock read.
  // This speaks two words through each designed voice with the key prod is
  // actually running, which settles it. Doubles as the keepalive the ledger
  // always wanted: an unused designed voice is reaped by fal.
  if (url.searchParams.get("mode") === "voicehealth") {
    const { falTts, falEnabled } = await import("../lib/fal-video.server");
    if (!falEnabled()) return json({ error: "FAL_KEY not set in this environment" }, { status: 500 });
    const ledger = (await import("../lib/voice-design-ledger.json")).default as {
      designed: Record<string, { voiceId: string }>;
    };
    const rows: { avatar: string; voiceId: string; alive: boolean; error?: string }[] = [];
    for (const [avatarId, entry] of Object.entries(ledger.designed)) {
      try {
        await falTts("Voice check.", entry.voiceId, 1, { lang: "en" }); // fixed English probe line
        rows.push({ avatar: avatarId, voiceId: entry.voiceId, alive: true });
      } catch (e) {
        rows.push({ avatar: avatarId, voiceId: entry.voiceId, alive: false, error: (e as Error).message.slice(0, 240) });
      }
    }
    const dead = rows.filter((r) => !r.alive);
    return json({ checked: rows.length, alive: rows.length - dead.length, dead: dead.length, rows });
  }

  // Did the premium voice actually SPEAK? Recent avatar takes with the voice we
  // cast vs the voice that came out — voiceFellBack marks a silent downgrade.
  if (url.searchParams.get("mode") === "voicetakes") {
    // ONE SHOP AT A TIME, always. This query used to select every VIDEO_AD in
    // the database — the only fleet-wide read in the app. It was dormant
    // (PURGE_KEY is unset in production, so the route 404s), but a debug
    // endpoint that can dump every merchant's takes the moment a key is set is
    // a liability, not a tool. Naming the shop costs the operator one query
    // param and removes the whole failure mode.
    const sc = await scopedShop();
    if (!sc.target) return json({ error: sc.error }, { status: sc.status });
    const takes = await db.asset.findMany({
      where: { shopId: sc.target.id, type: "VIDEO_AD" },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, title: true, createdAt: true, bodyJson: true, metaJson: true },
    });
    return json({
      shop: sc.target.domain,
      takes: takes.map((t) => {
        const body = (() => { try { return JSON.parse(t.bodyJson || "{}"); } catch { return {}; } })();
        const meta = (() => { try { return JSON.parse(t.metaJson || "{}"); } catch { return {}; } })();
        return {
          id: t.id, at: t.createdAt, avatar: meta.avatarId || null,
          cast: body.voiceCast ?? body.voiceDelivery?.voice ?? null,
          spoke: body.voiceId ?? null,
          fellBack: body.voiceFellBack ?? null, // null = take predates this tracking
          why: body.voiceFallbackReason ?? null,
        };
      }),
    });
  }

  // Memory truth: what limit is this container ACTUALLY running under, and
  // how close to the ceiling are we? (cgroup v2 first, v1 fallback)
  if (url.searchParams.get("mode") === "mem") {
    const read = (p: string) => { try { return fs.readFileSync(p, "utf8").trim(); } catch { return null; } };
    const gb = (v: string | null) => {
      if (!v || v === "max") return v;
      const n = Number(v);
      return isNaN(n) ? v : `${(n / 1024 / 1024).toFixed(0)}MB`;
    };
    return json({
      cgroupV2: { limit: gb(read("/sys/fs/cgroup/memory.max")), current: gb(read("/sys/fs/cgroup/memory.current")), peak: gb(read("/sys/fs/cgroup/memory.peak")) },
      cgroupV1: { limit: gb(read("/sys/fs/cgroup/memory/memory.limit_in_bytes")), usage: gb(read("/sys/fs/cgroup/memory/memory.usage_in_bytes")), maxUsage: gb(read("/sys/fs/cgroup/memory/memory.max_usage_in_bytes")) },
      nodeRss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      uptimeMin: Math.round(process.uptime() / 60),
    });
  }

  // Disk-mount truth: is a persistent disk ACTUALLY mounted where the app
  // writes renders? Reads /proc/mounts + drops a sentinel file that must
  // survive the next deploy if the disk is real.
  if (url.searchParams.get("mode") === "disk") {
    const rendersDir = path.join(process.cwd(), "data", "renders");
    let mounts: string[] = [];
    try {
      mounts = fs.readFileSync("/proc/mounts", "utf8").split("\n")
        .filter((l) => l.includes("/app") || l.includes("render") || l.includes("/data"));
    } catch { mounts = ["(no /proc/mounts)"]; }
    let dirFiles: string[] = [];
    try { dirFiles = fs.readdirSync(rendersDir).slice(0, 20); } catch { dirFiles = ["(dir missing)"]; }
    const sentinelPath = path.join(rendersDir, ".sentinel");
    let sentinel = "";
    try { sentinel = fs.readFileSync(sentinelPath, "utf8"); } catch {
      try { fs.mkdirSync(rendersDir, { recursive: true }); fs.writeFileSync(sentinelPath, new Date().toISOString()); sentinel = "(just created)"; } catch (e) { sentinel = `(write failed: ${e})`; }
    }
    return json({ cwd: process.cwd(), rendersDir, mounts, dirFiles, sentinel });
  }

  // Recent finished takes with the engine that produced them (heygen-fal vs
  // omni-human vs kling-voiceover) — verifies the premium engine engaged.
  if (url.searchParams.get("mode") === "takes") {
    const sc = await scopedShop();
    if (!sc.target) return json({ error: sc.error }, { status: sc.status });
    const assets = await db.asset.findMany({
      where: { shopId: sc.target.id, type: "VIDEO_AD" },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { createdAt: true, title: true, bodyJson: true },
    });
    return json({
      shop: sc.target.domain,
      takes: assets.map((a) => {
        let engine = "?", hasUrl = false, fileExists = false, heldProduct = false;
        try {
          const b = JSON.parse(a.bodyJson);
          engine = b.engine || "minimax-showcase";
          hasUrl = !!b.videoUrl;
          heldProduct = b.heldProduct === true;
          if (typeof b.videoUrl === "string" && b.videoUrl.startsWith("/renders/")) {
            fileExists = fs.existsSync(path.join(process.cwd(), "data", "renders", path.basename(b.videoUrl)));
          }
        } catch { /* skip */ }
        return { at: a.createdAt, title: a.title?.slice(0, 40), engine, hasUrl, fileExists, heldProduct };
      }),
    });
  }

  // Job-state dump — why are videos "rendering forever"?
  if (url.searchParams.get("mode") === "jobs") {
    const sc = await scopedShop();
    if (!sc.target) return json({ error: sc.error }, { status: sc.status });
    const now = Date.now();
    const jobs = await db.job.findMany({
      where: { shopId: sc.target.id, type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_BLOG_POST", "FORGE_COMPANION"] } },
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
