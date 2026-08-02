/* Owner-only ad QA runner, on the live server.
 *
 * WHY HERE AND NOT IN CI: the API keys live in Render's environment. Copying
 * them into GitHub Actions secrets would put the same credential in two
 * places — one more thing to leak, one more thing to rotate, one more thing
 * to go stale. Running the harness where the keys already are avoids all of
 * it, and has the bonus that renders land straight on the persistent disk and
 * are viewable at a URL instead of a zip you have to download.
 *
 * DORMANT BY DEFAULT: with QA_KEY unset this route 404s — it does not exist in
 * production unless deliberately switched on, same discipline as /web/dev.
 *
 * IT SPENDS MONEY: one nano-banana render per cell, two if the gate rejects
 * the first, plus two Claude vision calls. Hence the hard cap, the
 * one-run-at-a-time lock, and the explicit cell count on the button.
 */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, isRouteErrorResponse, useActionData, useLoaderData, useRevalidator, useRouteError } from "@remix-run/react";
import { useEffect } from "react";
import fs from "node:fs";
import path from "node:path";
import { requireWebIdentity } from "../lib/web-auth.server";
import { AD_FORMATS } from "../lib/ad-formats";
import {
  contactSheet, discoverGoldenSet, pool, runQaCell,
  type Cell, type GoldenProduct, type QaReport,
} from "../lib/ad-qa.server";

const CAP = 24;
const CONCURRENCY = 2; // gentle: this is the box serving merchants

function assertEnabled(request: Request): void {
  const key = process.env.QA_KEY;
  if (!key) throw new Response("Not Found", { status: 404 });
  const given = new URL(request.url).searchParams.get("key") || "";
  if (given !== key) throw new Response("Not Found", { status: 404 });
}

const reportPath = () => path.join(process.cwd(), "data", "renders", "qa-report.json");
const goldenPath = () => path.join(process.cwd(), "data", "renders", "qa-golden.json");

/** In-flight state. Deliberately in-memory: a run that dies with the process
 *  should read as "not running", not wedge a database flag forever. */
let running: { started: number; done: number; total: number; note: string } | null = null;

function readReport(): QaReport | null {
  try { return JSON.parse(fs.readFileSync(reportPath(), "utf8")) as QaReport; } catch { return null; }
}
function readGolden(): GoldenProduct[] {
  try { return JSON.parse(fs.readFileSync(goldenPath(), "utf8")) as GoldenProduct[]; } catch { return []; }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  assertEnabled(request);
  await requireWebIdentity(request);
  const report = readReport();
  return json({
    golden: readGolden(),
    formats: AD_FORMATS.map((f) => ({ key: f.key, name: f.name })),
    running,
    cap: CAP,
    sheet: report ? contactSheet(report.cells, "/renders/", report.truncated) : null,
    ranAt: report?.ranAt || null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  assertEnabled(request);
  await requireWebIdentity(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "seed") {
    const url = String(form.get("storeUrl") || "").trim();
    if (!url) return json({ error: "Paste a store address first." }, { status: 400 });
    // Discovery talks to someone else's web server: a bad address, a site with
    // no readable product feed, or a timeout are all NORMAL outcomes, not
    // crashes. Letting them throw gave a blank "Application error" with no clue
    // what went wrong, which is the worst possible way to fail.
    try {
      const set = await discoverGoldenSet(url, Number(form.get("size")) || 6);
      if (!set.length) return json({ error: `Found no products with images at ${url}.` }, { status: 400 });
      fs.mkdirSync(path.dirname(goldenPath()), { recursive: true });
      fs.writeFileSync(goldenPath(), JSON.stringify(set, null, 2));
      return json({ ok: `Seeded ${set.length} products from ${url}.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[ad-qa] seed failed:", msg);
      return json({ error: `Couldn't read that store: ${msg.slice(0, 300)}` }, { status: 400 });
    }
  }

  if (intent === "run") {
    if (running) return json({ error: "A run is already going." }, { status: 409 });
    const golden = readGolden();
    if (!golden.length) return json({ error: "Seed the golden set first." }, { status: 400 });

    const formats = String(form.get("formats") || "review,versus")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const limit = Math.max(1, Number(form.get("limit") || 3));
    const chosen = golden.slice(0, limit);

    const want: { p: GoldenProduct; f: string }[] = [];
    for (const f of formats) for (const p of chosen) want.push({ p, f });
    // Truncation is reported, never silent — a partial run that reads like a
    // full one is how "we tested everything" quietly becomes untrue.
    const truncated = Math.max(0, want.length - CAP);
    want.length = Math.min(want.length, CAP);

    const runId = String(Date.now()).slice(-8);
    running = { started: Date.now(), done: 0, total: want.length, note: "starting" };

    // Fire and forget: the HTTP request must not hang for several minutes.
    // The page polls the loader for progress.
    void (async () => {
      try {
        const cells = await pool(want, CONCURRENCY, async ({ p, f }, i) => {
          const c = await runQaCell(p, f, runId, i);
          if (running) { running.done++; running.note = `${f} · ${p.title.slice(0, 30)}`; }
          return c;
        });
        const report: QaReport = { ranAt: new Date().toISOString(), formats, cells: cells as Cell[], truncated };
        fs.mkdirSync(path.dirname(reportPath()), { recursive: true });
        fs.writeFileSync(reportPath(), JSON.stringify(report, null, 2));
      } catch (e) {
        console.error("[ad-qa] run failed:", e instanceof Error ? e.message : e);
      } finally {
        running = null;
      }
    })();

    return json({ ok: `Started ${want.length} cells${truncated ? ` (${truncated} over the cap, skipped)` : ""}.` });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

/* Without this, ANY throw on this page renders the bare framework
 * "Application error" with no clue what broke — which is exactly what a
 * diagnostic tool must never do. */
export function ErrorBoundary() {
  const err = useRouteError();
  const msg = isRouteErrorResponse(err)
    ? `${err.status} ${err.statusText}${err.data ? ` — ${String(err.data).slice(0, 300)}` : ""}`
    : err instanceof Error ? err.message : String(err);
  return (
    <div className="wb-card">
      <b>Ad QA hit an error</b>
      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, marginTop: 8, color: "#7A2E1D" }}>{msg}</pre>
      <p className="wb-sub" style={{ marginTop: 8 }}>
        A 404 here means <code>QA_KEY</code> is unset in Render, or the <code>?key=</code> in the URL doesn&apos;t match it.
      </p>
    </div>
  );
}

export default function WebQa() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>() as { ok?: string; error?: string } | undefined;
  const rev = useRevalidator();

  // Poll while a run is in flight so progress and the finished sheet appear
  // without anyone hitting refresh.
  useEffect(() => {
    if (!d.running) return;
    const t = setInterval(() => rev.revalidate(), 5000);
    return () => clearInterval(t);
  }, [d.running, rev]);

  return (
    <div>
      <h1 className="wb-h1">Ad QA</h1>
      <p className="wb-sub">
        Renders the golden set through the real pipeline and scores every result. Costs real money —
        one render per cell, two if the gate rejects the first. Cap is {d.cap} cells.
      </p>

      {a?.error && <div className="wb-err">{a.error}</div>}
      {a?.ok && <div className="wb-ok">{a.ok}</div>}

      <div className="wb-card">
        <b>1 · Golden set</b>
        <p className="wb-sub" style={{ marginTop: 6 }}>
          {d.golden.length
            ? `${d.golden.length} products. Fixed — that's the point; a set that shifts can't show whether a change helped.`
            : "Not seeded yet. Pull a deterministic slice from a storefront."}
        </p>
        <Form method="post" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="hidden" name="intent" value="seed" />
          <input className="wb-in" name="storeUrl" placeholder="shopmagicmonster.com" required style={{ maxWidth: 260 }} />
          <input className="wb-in" name="size" defaultValue="6" style={{ maxWidth: 80 }} />
          <button className="wb-btn ghost" type="submit">Seed</button>
        </Form>
        {d.golden.length > 0 && (
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--ink2)" }}>
            {d.golden.map((p) => <li key={p.imageUrl}>{p.title}</li>)}
          </ul>
        )}
      </div>

      <div className="wb-card" style={{ marginTop: 14 }}>
        <b>2 · Run</b>
        {d.running ? (
          <p className="wb-sub" style={{ marginTop: 6 }}>
            Running… {d.running.done}/{d.running.total} — {d.running.note}
          </p>
        ) : (
          <Form method="post" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <input type="hidden" name="intent" value="run" />
            <input className="wb-in" name="formats" defaultValue="review,versus" style={{ maxWidth: 300 }} />
            <input className="wb-in" name="limit" defaultValue="3" style={{ maxWidth: 80 }} />
            <button className="wb-btn" type="submit" disabled={!d.golden.length}>Run</button>
          </Form>
        )}
        <p className="wb-sub" style={{ marginTop: 8, fontSize: 11.5 }}>
          Formats: {d.formats.map((f) => f.key).join(", ")}
        </p>
      </div>

      {d.sheet && (
        <div className="wb-card" style={{ marginTop: 14 }}>
          <b>3 · Last report</b>
          <p className="wb-sub" style={{ marginTop: 4, fontSize: 11.5 }}>{d.ranAt}</p>
          <div dangerouslySetInnerHTML={{ __html: d.sheet }} />
        </div>
      )}
    </div>
  );
}
