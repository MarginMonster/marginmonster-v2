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
import { useEffect, useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { requireWebIdentity } from "../lib/web-auth.server";
import { AD_FORMATS } from "../lib/ad-formats";
import {
  contactSheet, discoverGoldenSet, pool, runQaCell,
  type Cell, type GoldenProduct, type QaReport,
} from "../lib/ad-qa.server";

const CAP = 60; // fits a full sweep: every format once
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
    formats: AD_FORMATS.map((f) => ({ key: f.key, name: f.name, blurb: f.blurb })),
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

    const formats = String(form.get("formats") || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (!formats.length) return json({ error: "Pick at least one ad type." }, { status: 400 });

    // Products are chosen by index against the saved golden set. Falling back
    // to "the first N" keeps the older limit-based form working.
    const picked = String(form.get("products") || "")
      .split(",").map((s) => Number(s)).filter((n) => Number.isInteger(n) && n >= 0 && n < golden.length);
    const chosen = picked.length ? picked.map((i) => golden[i]) : golden.slice(0, Math.max(1, Number(form.get("limit")) || 3));
    if (!chosen.length) return json({ error: "Pick at least one product." }, { status: 400 });

    // Order matters once the cap bites. Nesting the loops (every product for
    // format 1, then format 2…) meant a 24-cell cap out of 320 tested only the
    // first THREE formats — so a run that looked broad was actually narrow, and
    // dimensions like anatomy scored a perfect 100% having never seen a format
    // with a person in it. Walk the grid diagonally instead: the cap now takes
    // a spread across formats and products rather than one corner of it.
    const want: { p: GoldenProduct; f: string }[] = [];
    const F = formats.length, P = chosen.length;
    for (let k = 0; k < F * P; k++) {
      const f = formats[k % F];
      const p = chosen[(Math.floor(k / F) + (k % F)) % P];
      want.push({ p, f });
    }
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

  // Presets exist because "which of the 49 do I test?" is a real question with
  // a boring answer most of the time. HANDS matters specifically: review cards
  // and comparison tables contain no people, so an anatomy score of 4/4 on
  // those formats is vacuous — it passed by default, having tested nothing.
  const PRESETS: { label: string; keys: string[]; why: string }[] = [
    { label: "Quick check", keys: ["review", "versus"], why: "the two that have been failing" },
    { label: "Text-heavy", keys: ["review", "chat", "versus", "tweet"], why: "most words = most ways to garble" },
    { label: "Hands & people", keys: ["handheld", "ugcframe"], why: "the only ones that test anatomy" },
    { label: "Every format", keys: d.formats.map((f) => f.key), why: `all ${d.formats.length}, one product each` },
  ];

  const [formats, setFormats] = useState<string[]>(["review", "versus"]);
  const [products, setProducts] = useState<number[]>(() => d.golden.map((_, i) => i).slice(0, 3));

  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const cells = formats.length * products.length;
  const over = Math.max(0, cells - d.cap);

  useEffect(() => {
    if (!d.running) return;
    const t = setInterval(() => rev.revalidate(), 5000);
    return () => clearInterval(t);
  }, [d.running, rev]);

  return (
    <div>
      <style>{QA_CSS}</style>
      <h1 className="wb-h1">Ad QA</h1>
      <p className="wb-sub">
        Makes real ads from real products and grades them, so bad ones turn up here instead of in a merchant&apos;s feed.
      </p>

      {a?.error && <div className="wb-err">{a.error}</div>}
      {a?.ok && <div className="wb-ok">{a.ok}</div>}

      <div className="wb-card">
        <div className="qa-h"><span className="qa-n">1</span><b>Test products</b>
          <span className="qa-hint">{d.golden.length ? "tap to include or exclude" : "none yet"}</span>
        </div>
        {d.golden.length > 0 ? (
          <div className="qa-grid prod">
            {d.golden.map((p, i) => (
              <button type="button" key={p.imageUrl}
                className={`qa-tile${products.includes(i) ? " on" : ""}`}
                onClick={() => setProducts((v) => toggle(v, i))}>
                <span className="qa-img" style={{ backgroundImage: `url(${p.imageUrl})` }}>
                  {products.includes(i) && <span className="qa-chk">✓</span>}
                </span>
                <span className="qa-cap">{p.title}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="wb-sub" style={{ marginTop: 6 }}>Pull a set from your storefront first.</p>
        )}
        <Form method="post" className="qa-seed">
          <input type="hidden" name="intent" value="seed" />
          <input className="wb-in" name="storeUrl" placeholder="shopmagicmonster.com" required />
          <input className="wb-in" name="size" defaultValue="6" style={{ maxWidth: 74 }} />
          <button className="wb-btn ghost" type="submit">{d.golden.length ? "Re-pull" : "Pull products"}</button>
        </Form>
        <p className="qa-note">
          The set stays fixed on purpose — if the products changed every run, the scores couldn&apos;t tell you
          whether a change helped.
        </p>
      </div>

      <div className="wb-card" style={{ marginTop: 14 }}>
        <div className="qa-h"><span className="qa-n">2</span><b>Ad types</b>
          <span className="qa-hint">{formats.length} selected</span>
        </div>
        <div className="qa-presets">
          {PRESETS.map((p) => (
            <button type="button" key={p.label} className="qa-preset" title={p.why} onClick={() => setFormats(p.keys)}>
              {p.label}<i>{p.why}</i>
            </button>
          ))}
        </div>
        <div className="qa-grid fmt">
          {d.formats.map((f) => (
            <button type="button" key={f.key}
              className={`qa-tile${formats.includes(f.key) ? " on" : ""}`}
              title={f.blurb}
              onClick={() => setFormats((v) => toggle(v, f.key))}>
              <span className="qa-img" style={{ backgroundImage: `url(/ad-templates/format-${f.key}.jpg?v=2)` }}>
                {formats.includes(f.key) && <span className="qa-chk">✓</span>}
              </span>
              <span className="qa-cap">{f.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="wb-card" style={{ marginTop: 14 }}>
        <div className="qa-h"><span className="qa-n">3</span><b>Run</b></div>
        {d.running ? (
          <>
            <p className="wb-sub" style={{ marginTop: 6 }}>
              Making ads… {d.running.done} of {d.running.total} — {d.running.note}
            </p>
            <div className="qa-bar"><i style={{ width: `${Math.round((d.running.done / Math.max(1, d.running.total)) * 100)}%` }} /></div>
          </>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="run" />
            <input type="hidden" name="formats" value={formats.join(",")} />
            <input type="hidden" name="products" value={products.join(",")} />
            {formats.length > 12 && products.length > 1 && (
              <p className="qa-warnline">
                {formats.length} formats × {products.length} products is {formats.length * products.length} ads — over the {d.cap} cap.
                For a full sweep use <b>one</b> product: <button type="button" className="qa-link" onClick={() => setProducts(products.slice(0, 1))}>use just the first product</button>.
              </p>
            )}
            <p className="qa-count">
              <b>{Math.min(cells, d.cap)} ads</b> — {formats.length} type{formats.length === 1 ? "" : "s"} × {products.length} product{products.length === 1 ? "" : "s"}.
              Each one is a real paid generation, and a rejected first attempt is retried once, so budget up to {Math.min(cells, d.cap) * 2} renders.
              {over > 0 && <> <span className="qa-over">{over} over the {d.cap} cap and will be skipped.</span></>}
            </p>
            <button className="wb-btn" type="submit" disabled={!cells}>Make {Math.min(cells, d.cap)} ads</button>
          </Form>
        )}
      </div>

      {d.sheet && (
        <div className="wb-card" style={{ marginTop: 14 }}>
          <div className="qa-h"><span className="qa-n">4</span><b>Results</b>
            <span className="qa-hint" suppressHydrationWarning>{d.ranAt ? new Date(d.ranAt).toLocaleString() : ""}</span>
          </div>
          <div dangerouslySetInnerHTML={{ __html: d.sheet }} />
        </div>
      )}
    </div>
  );
}

const QA_CSS = `
.qa-h{display:flex;align-items:center;gap:9px;margin-bottom:10px;}
.qa-h b{font-family:Poppins,sans-serif;font-size:14.5px;}
.qa-n{flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;
  background:linear-gradient(165deg,#12A85E,#0B6B3E);color:#fff;font-size:11.5px;font-weight:800;}
.qa-hint{margin-left:auto;font-size:11.5px;color:var(--ink2);font-weight:600;}
.qa-grid{display:grid;gap:10px;}
.qa-grid.prod{grid-template-columns:repeat(auto-fill,minmax(104px,1fr));}
.qa-grid.fmt{grid-template-columns:repeat(auto-fill,minmax(104px,1fr));max-height:290px;overflow-y:auto;
  padding:2px 12px 2px 2px;scrollbar-gutter:stable;}
.qa-tile{border:0;background:none;padding:0;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:5px;}
.qa-img{position:relative;display:block;width:100%;aspect-ratio:1;border-radius:11px;background:#EFEFE7 center/cover no-repeat;
  border:2px solid transparent;box-shadow:0 1px 4px rgba(20,32,26,.08);}
.qa-tile.on .qa-img{border-color:#12A85E;box-shadow:0 0 0 2px rgba(18,168,94,.2);}
.qa-tile:not(.on) .qa-img{opacity:.5;filter:grayscale(.5);}
.qa-chk{position:absolute;top:5px;right:5px;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;
  background:linear-gradient(165deg,#12A85E,#0B6B3E);color:#fff;font-size:11px;font-weight:800;}
.qa-cap{font-size:11px;font-weight:700;color:var(--ink2);line-height:1.25;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.qa-tile.on .qa-cap{color:var(--ink);}
.qa-presets{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;}
.qa-preset{border:1px solid var(--line);background:var(--card);border-radius:11px;padding:7px 12px;cursor:pointer;
  font-family:Poppins,sans-serif;font-weight:700;font-size:12px;color:var(--ink);display:flex;flex-direction:column;gap:1px;text-align:left;}
.qa-preset i{font-style:normal;font-weight:500;font-size:10.5px;color:var(--ink2);}
.qa-preset:hover{border-color:#12A85E;}
.qa-seed{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px;}
.qa-seed .wb-in{max-width:230px;}
.qa-note{font-size:11.5px;color:var(--ink2);margin:8px 0 0;line-height:1.45;}
.qa-count{font-size:13px;color:var(--ink2);margin:0 0 12px;line-height:1.5;}
.qa-count b{color:var(--ink);font-size:14px;}
.qa-over{color:#7A5A12;font-weight:700;}
.qa-warnline{background:#FDF4E3;border:1px solid #E8D3A6;color:#7A5A12;padding:9px 12px;border-radius:9px;
  font-size:12px;line-height:1.45;margin:0 0 10px;}
.qa-link{border:0;background:none;padding:0;font:inherit;font-weight:800;color:#0C7A46;cursor:pointer;text-decoration:underline;}
.qa-bar{height:7px;border-radius:99px;background:#E9EDE7;overflow:hidden;margin-top:8px;}
.qa-bar i{display:block;height:100%;background:linear-gradient(90deg,#12A85E,#0B6B3E);transition:width .4s;}
@media (max-width:520px){
  .qa-grid.prod,.qa-grid.fmt{grid-template-columns:repeat(auto-fill,minmax(88px,1fr));}
  .qa-seed .wb-in{max-width:100%;}
}
`;
