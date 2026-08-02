/* The golden-set ad QA core.
 *
 * Shared by two front ends:
 *   scripts/ad-qa.ts   — CLI, for GitHub Actions
 *   app/routes/web.qa  — an owner-only page on the live server
 *
 * The second exists because the API keys live in Render's environment, not in
 * GitHub Actions secrets. Copying them into GitHub would mean the same
 * credential sitting in two places, which is one more place it can leak from
 * and one more place it can go stale. Running the harness where the keys
 * already are avoids all of that.
 *
 * Everything here calls runFormatRung — the SAME function the live pipeline
 * uses. A harness that exercises a parallel copy of the pipeline proves
 * nothing about the pipeline.
 */

import fs from "node:fs";
import path from "node:path";
import { runFormatRung } from "./image-generation.server";
import { anthropicVision } from "./anthropic.server";
import { AD_FORMAT_BY_KEY } from "./ad-formats";
import { mirrorRender } from "./object-storage.server";

export interface GoldenProduct {
  title: string;
  imageUrl: string;
  /** Free-text note for the reviewer — why this product earns a slot. */
  why?: string;
}

export interface Rubric {
  productIntact: boolean;
  textSensible: boolean;
  textMatches: boolean;
  noSourceText: boolean;
  anatomyOk: boolean;
  scalePlausible: boolean;
  wouldShip: boolean;
  notes: string;
}

export interface Cell {
  product: string;
  format: string;
  ok: boolean;
  retried: boolean;
  fallback: string | null;
  qaReason: string;
  copy: Record<string, string> | null;
  /** Flat filename under data/renders, served at /renders/<file>. */
  file: string | null;
  rubric: Rubric | null;
  ms: number;
  error?: string;
}

export interface QaReport {
  ranAt: string;
  formats: string[];
  cells: Cell[];
  truncated: number;
}

export const RUBRIC_KEYS: (keyof Rubric)[] = [
  "productIntact", "textSensible", "textMatches", "noSourceText",
  "anatomyOk", "scalePlausible", "wouldShip",
];

const renderDir = () => path.join(process.cwd(), "data", "renders");

/* ---------- the golden set ---------- */

/** Build a set from a live storefront, deterministically.
 *
 *  Sorted by title rather than feed order: a set that reshuffles between runs
 *  cannot tell you whether a prompt edit made things better or worse. */
export async function discoverGoldenSet(storeUrl: string, size = 8): Promise<GoldenProduct[]> {
  const { discoverCatalog } = await import("./catalog-import.server");
  const { products } = await discoverCatalog(storeUrl, 120);
  return products
    .filter((p) => p.imageUrl)
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, size)
    .map((p) => ({ title: p.title, imageUrl: p.imageUrl as string }));
}

/* ---------- the rubric ---------- */

/** A richer score than the production gate.
 *
 *  qaFormat (the live gate) answers one question: ship or don't. Correct at
 *  generation time, useless for tracking a prompt change — "pass rate went
 *  61% → 68%" hides WHICH failure moved. Scoring dimensions separately makes
 *  a regression attributable. */
export async function scoreAd(productImageUrl: string, adUrl: string, expected: string[]): Promise<Rubric | null> {
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
    console.error("[ad-qa] rubric failed:", e instanceof Error ? e.message.slice(0, 140) : e);
    return null;
  }
}

/* ---------- running ---------- */

async function saveRender(url: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(renderDir(), { recursive: true });
    fs.writeFileSync(path.join(renderDir(), name), buf);
    try { await mirrorRender(name, buf); } catch { /* local copy is enough for a report */ }
    return true;
  } catch { return false; }
}

/** Flat, /renders-servable filename. That route only accepts [A-Za-z0-9_-]. */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export async function runQaCell(p: GoldenProduct, formatKey: string, runId: string, i: number): Promise<Cell> {
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
      const name = `qa-${runId}-${String(i).padStart(2, "0")}-${slug(formatKey)}.jpg`;
      if (await saveRender(r.imageUrl, name)) file = name;
    }
    // Score the rejects too — they're the interesting ones, and dropping them
    // would hide exactly the failure mode this is here to measure.
    const rubric = r.imageUrl && r.copy ? await scoreAd(p.imageUrl, r.imageUrl, Object.values(r.copy)) : null;

    return {
      ...base, ok: r.qaPass, retried: r.retried, fallback: r.fallback,
      qaReason: r.qaReason, copy: r.copy, file, rubric, ms: Date.now() - t0,
    };
  } catch (e) {
    return { ...base, ms: Date.now() - t0, error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
}

/** Small worker pool — this hits paid APIs from a live web server. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
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

export function summaryMarkdown(cells: Cell[], truncated = 0): string {
  const n = cells.length || 1;
  const passed = cells.filter((c) => c.ok).length;
  const shipped = cells.filter((c) => c.rubric?.wouldShip).length;
  const scored = cells.filter((c) => c.rubric);
  const lines = [
    `## Ad QA — golden set`, ``,
    `| | |`, `|---|---|`,
    `| cells | ${cells.length}${truncated ? ` (${truncated} not run — hit the cap)` : ""} |`,
    `| live gate passed | **${passed}/${n}** (${Math.round((passed / n) * 100)}%) |`,
    `| passed only on retry | ${cells.filter((c) => c.ok && c.retried).length} |`,
    `| would ship (art director) | **${shipped}/${n}** (${Math.round((shipped / n) * 100)}%) |`,
    ``, `### Rubric`, ``, `| dimension | clean |`, `|---|---|`,
  ];
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
  return lines.join("\n");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Contact sheet. `imgBase` is "" for the CLI (local files) or "/renders/" on
 *  the server, where the images are served off the persistent disk. */
export function contactSheet(cells: Cell[], imgBase = "", truncated = 0): string {
  const cards = cells.map((c) => {
    const bad = c.rubric ? RUBRIC_KEYS.filter((k) => k !== "wouldShip" && c.rubric![k] === false) : [];
    const state = c.error ? "err" : c.ok ? (c.retried ? "warn" : "ok") : "fail";
    const label = c.error ? "ERROR" : c.ok ? (c.retried ? "PASSED ON RETRY" : "PASSED") : "FELL BACK";
    const src = c.file ? `${imgBase}${c.file}` : "";
    return `<figure class="c ${state}">
      ${src ? `<a href="${src}" target="_blank"><img src="${src}" loading="lazy" alt=""></a>` : `<div class="noimg">no image</div>`}
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
  const scored = cells.filter((c) => c.rubric);
  const rows = RUBRIC_KEYS.map((k) => {
    const good = scored.filter((c) => c.rubric![k] !== false).length;
    // "0%" when nothing was scored reads as a catastrophic regression. A QA
    // report that misleads is worse than no report.
    const pct = scored.length ? `${Math.round((good / scored.length) * 100)}%` : "—";
    return `<tr><td>${k}</td><td>${scored.length ? `${good}/${scored.length}` : "not scored"}</td><td>${pct}</td></tr>`;
  }).join("");

  return `<style>
 .qa{font:14px/1.5 -apple-system,system-ui,sans-serif;color:#14201A}
 .qa h2{font-size:18px;margin:0 0 4px} .qa .sub{color:#4A554E;margin:0 0 16px;font-size:13px}
 .qa table{border-collapse:collapse;margin:0 0 20px;background:#fff;border:1px solid #E4DFCF;border-radius:10px;overflow:hidden}
 .qa td,.qa th{padding:6px 14px;border-bottom:1px solid #EFEBDD;text-align:left;font-size:12.5px}
 .qa .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
 .qa .c{margin:0;background:#fff;border:1px solid #E4DFCF;border-radius:12px;overflow:hidden}
 .qa .c.fail,.qa .c.err{border-color:#E8C4BC} .qa .c.warn{border-color:#E8D3A6}
 .qa .c img{width:100%;display:block;aspect-ratio:1;object-fit:cover;background:#EFEFE7}
 .qa .noimg{aspect-ratio:1;display:grid;place-items:center;color:#9AA69E;background:#EFEFE7;font-size:12px}
 .qa figcaption{padding:9px 11px}
 .qa .hd{display:flex;justify-content:space-between;align-items:center;gap:8px}
 .qa .pill{font-size:9px;font-weight:800;padding:2px 6px;border-radius:999px;background:#EAF6EF;color:#0C7A46;white-space:nowrap}
 .qa .pill.fail,.qa .pill.err{background:#FBEDEA;color:#7A2E1D} .qa .pill.warn{background:#FDF4E3;color:#7A5A12}
 .qa .pr{color:#4A554E;font-size:11px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .qa .bad{color:#7A2E1D;font-size:11px;margin-top:5px;font-weight:600}
 .qa .good{color:#0C7A46;font-size:11px;margin-top:5px;font-weight:600}
 .qa .nt{color:#4A554E;font-size:11px;margin-top:3px}
</style>
<div class="qa">
<h2>Golden set</h2>
<p class="sub">${cells.length} cells${truncated ? ` · ${truncated} not run (hit the cap)` : ""} · gate passed ${passed}/${n} (${Math.round((passed / n) * 100)}%) · would ship ${shipped}/${n} (${Math.round((shipped / n) * 100)}%)</p>
<table><tr><th>rubric dimension</th><th>clean</th><th></th></tr>${rows}</table>
<div class="grid">${cards}</div>
</div>`;
}
