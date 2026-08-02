/* The golden-set ad QA harness.
 *
 * WHY THIS EXISTS
 * Every generation-quality bug we have shipped was found the same way: a
 * merchant (usually the founder, on a phone, at midnight) noticed it in the
 * Archive. The causes were almost never model weakness — they were our own
 * prompts contradicting themselves ("candid smartphone SELFIE" while demanding
 * both hands on the product; "five fingers per hand" plus a thumb; "offer is a
 * short offer like 20% OFF" on a merchant running no sale). Those are all
 * findable by rendering a fixed set of products and LOOKING at the result.
 *
 * So: a fixed golden set, the real pipeline, a vision rubric, a contact sheet.
 * Run it before a prompt change ships, not after.
 *
 * IMPORTANT: this calls runFormatRung — the SAME function the live pipeline
 * calls — rather than re-implementing the steps. A harness that tests a
 * parallel copy of the pipeline proves nothing about the pipeline.
 *
 * Runs in GitHub Actions because the dev sandbox has no AI keys and no egress
 * beyond GitHub. Needs ANTHROPIC_API_KEY and REPLICATE_API_TOKEN.
 *
 * Costs real money: one nano-banana render per cell, two if QA rejects the
 * first, plus two vision calls. MAX_RENDERS is a hard stop, not a suggestion.
 */

import fs from "node:fs";
import path from "node:path";
import { runFormatRung } from "../app/lib/image-generation.server";
import { anthropicVision } from "../app/lib/anthropic.server";
import { AD_FORMAT_BY_KEY, AD_FORMATS } from "../app/lib/ad-formats";

interface GoldenProduct {
  title: string;
  imageUrl: string;
  /** Free-text note for the reviewer — why this product is in the set. */
  why?: string;
}

interface Rubric {
  productIntact: boolean;
  textSensible: boolean;
  textMatches: boolean;
  noSourceText: boolean;
  anatomyOk: boolean;
  scalePlausible: boolean;
  wouldShip: boolean;
  notes: string;
}

interface Cell {
  product: string;
  format: string;
  ok: boolean;
  retried: boolean;
  fallback: string | null;
  qaReason: string;
  copy: Record<string, string> | null;
  file: string | null;
  rubric: Rubric | null;
  ms: number;
  error?: string;
}

const OUT = process.env.QA_OUT || "qa-out";
const MAX_RENDERS = Number(process.env.MAX_RENDERS || 24);
const CONCURRENCY = Number(process.env.QA_CONCURRENCY || 3);

/* ---------- the golden set ---------- */

/** Load the committed golden set, or discover one from a live storefront.
 *
 *  Discovery is the bootstrap path: the first run prints a JSON block to
 *  commit as qa/golden-set.json. After that the set is FIXED, which is the
 *  whole point — a golden set that changes underneath you can't show whether
 *  a prompt edit made things better or worse. */
async function loadGoldenSet(): Promise<GoldenProduct[]> {
  const file = process.env.GOLDEN_SET || "qa/golden-set.json";
  if (fs.existsSync(file)) {
    const set = JSON.parse(fs.readFileSync(file, "utf8")) as GoldenProduct[];
    console.log(`[qa] golden set: ${set.length} products from ${file}`);
    return set;
  }
  const storeUrl = process.env.STORE_URL;
  if (!storeUrl) {
    throw new Error(`No ${file} and no STORE_URL to discover one from. Pass STORE_URL to seed the set.`);
  }
  console.log(`[qa] no ${file} — discovering a set from ${storeUrl}`);
  const { discoverCatalog } = await import("../app/lib/catalog-import.server");
  const { products } = await discoverCatalog(storeUrl, 120);
  const set = products
    .filter((p) => p.imageUrl)
    .sort((a, b) => a.title.localeCompare(b.title)) // deterministic, not "whatever the feed returned today"
    .slice(0, Number(process.env.SEED_SIZE || 8))
    .map((p) => ({ title: p.title, imageUrl: p.imageUrl as string }));
  console.log(`\n[qa] ---- commit this as ${file} ----\n${JSON.stringify(set, null, 2)}\n[qa] ---- end ----\n`);
  return set;
}

/* ---------- the rubric ---------- */

/** A richer score than the production gate.
 *
 *  qaFormat (the live gate) answers one question: ship or don't. That's the
 *  right call at generation time but useless for tracking whether a prompt
 *  edit helped — "pass rate went from 61% to 68%" hides WHICH failure moved.
 *  This scores the dimensions separately so a regression is attributable. */
async function score(productImageUrl: string, adUrl: string, expected: string[]): Promise<Rubric | null> {
  try {
    const raw = await anthropicVision(
      [
        `Image 1 is a merchant's real product photo. Image 2 is an advertisement our system generated from it.`,
        `Judge image 2 strictly, as an art director signing off on a paid ad. Answer each field independently.`,
        `These exact text strings were requested: ${expected.slice(0, 10).map((s) => `"${s.slice(0, 90)}"`).join(", ")}.`,
        ``,
        `productIntact: is the product in image 2 the SAME product as image 1 — same shape, colors, packaging artwork, logos — not warped, restyled or reinvented?`,
        `textSensible: does every line of the ad's own text read as grammatical English that makes sense? A repeated word or phrase ("we still each still got", "first try first try") is a FAILURE even though each word is spelled correctly. Read for sense, not spelling.`,
        `textMatches: does the ad's text actually say the requested strings above, none missing, none invented?`,
        `noSourceText: the product's OWN packaging text is fine and expected. But has any marketing text, watermark, price badge or caption from the SOURCE photo's background been copied into the ad? That is a failure.`,
        `anatomyOk: if a person appears — correct hands (four fingers and one thumb each, never six digits), exactly two hands, no extra or disembodied limb, no arm reaching at the camera as if holding it. If no person appears, answer true.`,
        `scalePlausible: is the product shown at a believable real-world size relative to anything it is next to (a hand, a person, furniture)? A shrunk or giant product is a failure. If there is nothing to judge against, answer true.`,
        `wouldShip: would you let a paying merchant post this as-is?`,
        `notes: one short sentence naming the single worst problem, or "clean" if there is none.`,
        ``,
        `Reply ONLY JSON: {"productIntact":bool,"textSensible":bool,"textMatches":bool,"noSourceText":bool,"anatomyOk":bool,"scalePlausible":bool,"wouldShip":bool,"notes":"..."}`,
      ].join("\n"),
      [productImageUrl, adUrl]
    );
    const m = raw && raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]) as Rubric;
  } catch (e) {
    console.error("[qa] rubric failed:", e instanceof Error ? e.message.slice(0, 140) : e);
    return null;
  }
}

/* ---------- run ---------- */

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return false;
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch { return false; }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

async function runCell(p: GoldenProduct, formatKey: string, i: number): Promise<Cell> {
  const t0 = Date.now();
  const base: Cell = {
    product: p.title, format: formatKey, ok: false, retried: false, fallback: null,
    qaReason: "", copy: null, file: null, rubric: null, ms: 0,
  };
  try {
    const f = AD_FORMAT_BY_KEY[formatKey];
    if (!f) return { ...base, ms: Date.now() - t0, error: `unknown format "${formatKey}"` };

    const r = await runFormatRung({
      formatKey: f.key, fields: f.fields, productTitle: p.title, productImageUrl: p.imageUrl,
    });

    let file: string | null = null;
    if (r.imageUrl) {
      const name = `${String(i).padStart(2, "0")}-${slug(formatKey)}-${slug(p.title)}.jpg`;
      if (await download(r.imageUrl, path.join(OUT, "img", name))) file = `img/${name}`;
    }
    // Score whatever came back, INCLUDING frames the live gate rejected — the
    // rejects are the interesting ones, and throwing them away would hide the
    // failure mode we are trying to measure.
    const rubric = r.imageUrl && r.copy ? await score(p.imageUrl, r.imageUrl, Object.values(r.copy)) : null;

    return {
      ...base, ok: r.qaPass, retried: r.retried, fallback: r.fallback,
      qaReason: r.qaReason, copy: r.copy, file, rubric, ms: Date.now() - t0,
    };
  } catch (e) {
    return { ...base, ms: Date.now() - t0, error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
}

/** Small worker pool — this hits paid APIs and a merchant-facing render queue. */
async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

/* ---------- reporting ---------- */

const RUBRIC_KEYS: (keyof Rubric)[] = ["productIntact", "textSensible", "textMatches", "noSourceText", "anatomyOk", "scalePlausible", "wouldShip"];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function contactSheet(cells: Cell[]): string {
  const cards = cells.map((c) => {
    const bad = c.rubric ? RUBRIC_KEYS.filter((k) => k !== "wouldShip" && c.rubric![k] === false) : [];
    const state = c.error ? "err" : c.ok ? (c.retried ? "warn" : "ok") : "fail";
    const label = c.error ? "ERROR" : c.ok ? (c.retried ? "PASSED ON RETRY" : "PASSED") : "FELL BACK";
    return `<figure class="c ${state}">
      ${c.file ? `<a href="${c.file}" target="_blank"><img src="${c.file}" loading="lazy" alt=""></a>` : `<div class="noimg">no image</div>`}
      <figcaption>
        <div class="hd"><b>${esc(c.format)}</b><span class="pill ${state}">${label}</span></div>
        <div class="pr">${esc(c.product)}</div>
        ${bad.length ? `<div class="bad">✗ ${bad.map(esc).join(" · ")}</div>` : c.rubric ? `<div class="good">✓ all rubric checks</div>` : ""}
        ${c.rubric?.notes ? `<div class="nt">${esc(c.rubric.notes)}</div>` : ""}
        ${!c.ok && c.qaReason ? `<div class="nt">gate: ${esc(c.qaReason)}</div>` : ""}
        ${c.error ? `<div class="bad">${esc(c.error)}</div>` : ""}
      </figcaption>
    </figure>`;
  }).join("\n");

  const n = cells.length || 1;
  const passed = cells.filter((c) => c.ok).length;
  const shipped = cells.filter((c) => c.rubric?.wouldShip).length;
  const rows = RUBRIC_KEYS.map((k) => {
    const scored = cells.filter((c) => c.rubric);
    const good = scored.filter((c) => c.rubric![k] !== false).length;
    // "0%" when nothing was scored reads as a catastrophic regression. Say
    // "not scored" instead — a QA report that misleads is worse than none.
    const pct = scored.length ? `${Math.round((good / scored.length) * 100)}%` : "—";
    return `<tr><td>${k}</td><td>${scored.length ? `${good}/${scored.length}` : "not scored"}</td><td>${pct}</td></tr>`;
  }).join("");

  return `<!doctype html><meta charset="utf-8"><title>Ad QA — golden set</title>
<style>
 body{font:14px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:24px;background:#F4F5EF;color:#14201A}
 h1{font-size:20px;margin:0 0 4px} .sub{color:#4A554E;margin:0 0 18px}
 table{border-collapse:collapse;margin:0 0 22px;background:#fff;border:1px solid #E4DFCF;border-radius:10px;overflow:hidden}
 td,th{padding:7px 14px;border-bottom:1px solid #EFEBDD;text-align:left;font-size:13px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
 .c{margin:0;background:#fff;border:1px solid #E4DFCF;border-radius:12px;overflow:hidden}
 .c.fail{border-color:#E8C4BC} .c.err{border-color:#E8C4BC} .c.warn{border-color:#E8D3A6}
 .c img{width:100%;display:block;aspect-ratio:1;object-fit:cover;background:#EFEFE7}
 .noimg{aspect-ratio:1;display:grid;place-items:center;color:#9AA69E;background:#EFEFE7}
 figcaption{padding:10px 12px}
 .hd{display:flex;justify-content:space-between;align-items:center;gap:8px}
 .pill{font-size:9.5px;font-weight:800;padding:2px 7px;border-radius:999px;background:#EAF6EF;color:#0C7A46;white-space:nowrap}
 .pill.fail,.pill.err{background:#FBEDEA;color:#7A2E1D} .pill.warn{background:#FDF4E3;color:#7A5A12}
 .pr{color:#4A554E;font-size:11.5px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .bad{color:#7A2E1D;font-size:11.5px;margin-top:6px;font-weight:600}
 .good{color:#0C7A46;font-size:11.5px;margin-top:6px;font-weight:600}
 .nt{color:#4A554E;font-size:11.5px;margin-top:4px}
</style>
<h1>Ad QA — golden set</h1>
<p class="sub">${cells.length} cells · gate passed ${passed}/${n} (${Math.round((passed / n) * 100)}%) · art-director "would ship" ${shipped}/${n} (${Math.round((shipped / n) * 100)}%)</p>
<table><tr><th>rubric dimension</th><th>clean</th><th></th></tr>${rows}</table>
<div class="grid">${cards}</div>`;
}

function markdown(cells: Cell[]): string {
  const n = cells.length || 1;
  const passed = cells.filter((c) => c.ok).length;
  const shipped = cells.filter((c) => c.rubric?.wouldShip).length;
  const lines = [
    `## Ad QA — golden set`,
    ``,
    `| | |`,
    `|---|---|`,
    `| cells | ${cells.length} |`,
    `| live gate passed | **${passed}/${n}** (${Math.round((passed / n) * 100)}%) |`,
    `| passed only on retry | ${cells.filter((c) => c.ok && c.retried).length} |`,
    `| would ship (art director) | **${shipped}/${n}** (${Math.round((shipped / n) * 100)}%) |`,
    ``,
    `### Rubric`,
    ``,
    `| dimension | clean |`,
    `|---|---|`,
  ];
  const scored = cells.filter((c) => c.rubric);
  for (const k of RUBRIC_KEYS) {
    const good = scored.filter((c) => c.rubric![k] !== false).length;
    lines.push(`| ${k} | ${scored.length ? `${good}/${scored.length}` : "not scored"} |`);
  }
  const bad = cells.filter((c) => !c.ok || c.rubric?.wouldShip === false || c.error);
  if (bad.length) {
    lines.push(``, `### Needs a look`, ``, `| format | product | what |`, `|---|---|---|`);
    for (const c of bad) {
      const what = c.error ? `error: ${c.error}` : !c.ok ? `fell back — ${c.qaReason || c.fallback}` : c.rubric?.notes || "would not ship";
      lines.push(`| ${c.format} | ${c.product.slice(0, 40)} | ${what.slice(0, 110).replace(/\|/g, "/")} |`);
    }
  }
  lines.push(``, `Full contact sheet is in the **ad-qa-report** artifact — open \`index.html\`.`);
  return lines.join("\n");
}

/* ---------- main ---------- */

async function main() {
  for (const k of ["ANTHROPIC_API_KEY", "REPLICATE_API_TOKEN"]) {
    if (!process.env[k]?.trim()) {
      console.error(`\n[qa] ${k} is not set.\n[qa] Add it under Settings → Secrets and variables → Actions → New repository secret.\n`);
      process.exit(78); // neutral: nothing was tested, and that is not a code failure
    }
  }

  // Validate the cheap thing first — a typo in FORMATS shouldn't cost a
  // catalogue crawl before it's reported.
  const formats = (process.env.FORMATS || "review,versus,callout,chat")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = formats.filter((f) => !AD_FORMAT_BY_KEY[f]);
  if (unknown.length) {
    console.error(`[qa] unknown formats: ${unknown.join(", ")}`);
    console.error(`[qa] available: ${AD_FORMATS.map((f) => f.key).join(", ")}`);
    process.exit(1);
  }

  const products = await loadGoldenSet();

  const limit = Number(process.env.LIMIT || products.length);
  const chosen = products.slice(0, limit);
  const cellsWanted: { p: GoldenProduct; f: string }[] = [];
  for (const f of formats) for (const p of chosen) cellsWanted.push({ p, f });

  if (cellsWanted.length > MAX_RENDERS) {
    // Loudly, not silently: a truncated run that reads like a full one is how
    // "we tested everything" becomes untrue.
    console.warn(`[qa] ${cellsWanted.length} cells requested but MAX_RENDERS=${MAX_RENDERS} — TRUNCATING. ${cellsWanted.length - MAX_RENDERS} cells will NOT be tested.`);
    cellsWanted.length = MAX_RENDERS;
  }

  fs.mkdirSync(path.join(OUT, "img"), { recursive: true });
  console.log(`[qa] ${cellsWanted.length} cells · ${formats.length} formats × ${chosen.length} products · concurrency ${CONCURRENCY}`);

  const t0 = Date.now();
  const cells = await pool(cellsWanted, CONCURRENCY, ({ p, f }, i) =>
    runCell(p, f, i).then((c) => {
      const mark = c.error ? "ERR " : c.ok ? (c.retried ? "RTRY" : "ok  ") : "FELL";
      console.log(`[qa] ${mark} ${f.padEnd(12)} ${p.title.slice(0, 44).padEnd(44)} ${(c.ms / 1000).toFixed(1)}s ${c.rubric?.notes || c.qaReason || c.error || ""}`);
      return c;
    })
  );

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ ranAt: new Date().toISOString(), formats, cells }, null, 2));
  fs.writeFileSync(path.join(OUT, "index.html"), contactSheet(cells));
  const md = markdown(cells);
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
