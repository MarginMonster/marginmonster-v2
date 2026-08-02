/* CLI front end for the golden-set ad QA harness.
 *
 * The logic lives in app/lib/ad-qa.server.ts, shared with the /web/qa page on
 * the live server — one implementation, two ways in. See qa/README.md.
 *
 * This path needs ANTHROPIC_API_KEY and REPLICATE_API_TOKEN in the
 * environment. If your keys live in Render rather than GitHub Actions
 * secrets, use /web/qa instead — it runs the identical code where the keys
 * already are.
 */

import fs from "node:fs";
import path from "node:path";
import {
  contactSheet, discoverGoldenSet, pool, runQaCell, summaryMarkdown,
  type Cell, type GoldenProduct,
} from "../app/lib/ad-qa.server";
import { AD_FORMAT_BY_KEY, AD_FORMATS } from "../app/lib/ad-formats";

const OUT = process.env.QA_OUT || "qa-out";
const MAX_RENDERS = Number(process.env.MAX_RENDERS || 24);
const CONCURRENCY = Number(process.env.QA_CONCURRENCY || 3);

/** Load the committed set, or discover one and print it to commit.
 *
 *  After the first run the set is FIXED, which is the whole point — a golden
 *  set that changes underneath you can't show whether an edit helped. */
async function loadGoldenSet(): Promise<GoldenProduct[]> {
  const file = process.env.GOLDEN_SET || "qa/golden-set.json";
  if (fs.existsSync(file)) {
    const set = JSON.parse(fs.readFileSync(file, "utf8")) as GoldenProduct[];
    console.log(`[qa] golden set: ${set.length} products from ${file}`);
    return set;
  }
  const storeUrl = process.env.STORE_URL;
  if (!storeUrl) throw new Error(`No ${file} and no STORE_URL to discover one from.`);
  console.log(`[qa] no ${file} — discovering a set from ${storeUrl}`);
  const set = await discoverGoldenSet(storeUrl, Number(process.env.SEED_SIZE || 8));
  console.log(`\n[qa] ---- commit this as ${file} ----\n${JSON.stringify(set, null, 2)}\n[qa] ---- end ----\n`);
  return set;
}

async function main() {
  for (const k of ["ANTHROPIC_API_KEY", "REPLICATE_API_TOKEN"]) {
    if (!process.env[k]?.trim()) {
      console.error(`\n[qa] ${k} is not set in this environment.`);
      console.error(`[qa] Either add it as an Actions repository secret, or run the identical`);
      console.error(`[qa] harness at /web/qa on the live server, where the keys already are.\n`);
      process.exit(78); // neutral: nothing was tested, and that is not a code failure
    }
  }

  // Cheap validation first — a typo in FORMATS shouldn't cost a catalogue crawl.
  const raw = (process.env.FORMATS || "review,versus,callout,chat").trim();
  // "all" sweeps every template. Spelling out 49 keys by hand is how a sweep
  // quietly becomes a partial one because two got dropped from the list.
  const formats = /^all$/i.test(raw)
    ? AD_FORMATS.map((f) => f.key)
    : raw.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = formats.filter((f) => !AD_FORMAT_BY_KEY[f]);
  if (unknown.length) {
    console.error(`[qa] unknown formats: ${unknown.join(", ")}`);
    console.error(`[qa] available: ${AD_FORMATS.map((f) => f.key).join(", ")}`);
    process.exit(1);
  }

  const products = await loadGoldenSet();
  const chosen = products.slice(0, Number(process.env.LIMIT || products.length));
  const want: { p: GoldenProduct; f: string }[] = [];
  for (const f of formats) for (const p of chosen) want.push({ p, f });

  const truncated = Math.max(0, want.length - MAX_RENDERS);
  if (truncated) {
    console.warn(`[qa] ${want.length} cells requested but MAX_RENDERS=${MAX_RENDERS} — TRUNCATING. ${truncated} cells will NOT be tested.`);
    want.length = MAX_RENDERS;
  }

  // runQaCell writes into data/renders (that's where the server serves from);
  // copy them next to the report so the artifact is self-contained.
  fs.mkdirSync(path.join(OUT, "img"), { recursive: true });
  console.log(`[qa] ${want.length} cells · ${formats.length} formats × ${chosen.length} products · concurrency ${CONCURRENCY}`);

  const runId = "cli";
  const t0 = Date.now();
  const cells = await pool(want, CONCURRENCY, ({ p, f }, i) =>
    runQaCell(p, f, runId, i).then((c: Cell) => {
      const mark = c.error ? "ERR " : c.ok ? (c.retried ? "RTRY" : "ok  ") : "FELL";
      console.log(`[qa] ${mark} ${f.padEnd(12)} ${p.title.slice(0, 44).padEnd(44)} ${(c.ms / 1000).toFixed(1)}s ${c.rubric?.notes || c.qaReason || c.error || ""}`);
      if (c.file) {
        try { fs.copyFileSync(path.join(process.cwd(), "data", "renders", c.file), path.join(OUT, "img", c.file)); } catch { /* report still stands */ }
      }
      return c;
    })
  );

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ ranAt: new Date().toISOString(), formats, cells, truncated }, null, 2));
  fs.writeFileSync(path.join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><title>Ad QA — golden set</title><body style="margin:0;padding:24px;background:#F4F5EF">${contactSheet(cells, "img/", truncated)}</body>`);
  const md = summaryMarkdown(cells, truncated);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  console.log(`\n${md}\n`);
  console.log(`[qa] done in ${Math.round((Date.now() - t0) / 1000)}s → ${OUT}/index.html`);

  const floor = Number(process.env.FAIL_UNDER || 0);
  if (floor > 0) {
    const rate = (cells.filter((c) => c.ok).length / (cells.length || 1)) * 100;
    if (rate < floor) {
      console.error(`[qa] gate pass rate ${rate.toFixed(0)}% is below FAIL_UNDER=${floor}%`);
      process.exit(1);
    }
  }
}

main().catch((e) => { console.error("[qa] fatal:", e); process.exit(1); });
