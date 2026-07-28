#!/usr/bin/env node
/* Renders candidate EASYMODE stand-in bottles on GitHub Actions (open network
 * + the REPLICATE_API_TOKEN repo secret) so art can be approved in chat before
 * it ships. Brief: the silhouette of a viral premium sports hydration bottle
 * (tall slim body, wide flat cap, bold VERTICAL wordmark) — but EASYMODE, in
 * GStyle greens and golds. nano-banana for text accuracy.
 *
 * Output: art-previews/bottles/<variant>.jpg (committed by the workflow). */
import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.REPLICATE_API_TOKEN;
if (!TOKEN) { console.error("REPLICATE_API_TOKEN not set"); process.exit(1); }

const BASE =
  "Professional studio product photograph of a sleek premium sports hydration drink bottle: " +
  "tall slim cylindrical body with smooth rounded shoulders and a wide flat matte screw cap — " +
  "the silhouette of a modern viral sports drink bottle. The brand wordmark \"EASYMODE\" printed " +
  "in bold clean uppercase sans-serif letters running VERTICALLY down the full height of the bottle, " +
  "spelled exactly E-A-S-Y-M-O-D-E, perfectly legible. Centered on a pure white seamless studio " +
  "background, bright soft even studio lighting, crisp sharp focus, high-end commercial beverage " +
  "photography. No other objects, no hands, no people, no extra text.";

const VARIANTS = {
  emerald: "The bottle is glossy deep EMERALD GREEN with the wordmark in metallic GOLD letters and a matte black cap.",
  kelly: "The bottle is vibrant glossy KELLY GREEN with the wordmark in crisp WHITE letters and a clean white cap.",
  cream: "The bottle is elegant matte CREAM / off-white with the wordmark in bold EMERALD GREEN letters and a metallic gold cap.",
  duotone: "The bottle transitions from deep EMERALD GREEN at the top into warm brushed GOLD at the base, with the wordmark in CREAM letters and an emerald cap.",
};

const outDir = path.join("art-previews", "bottles");
fs.mkdirSync(outDir, { recursive: true });

async function render(key) {
  const prompt = `${BASE} ${VARIANTS[key]}`;
  const create = await fetch("https://api.replicate.com/v1/models/google/nano-banana/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: { prompt, output_format: "jpg" } }),
  });
  if (!create.ok) throw new Error(`${key}: create ${create.status} ${(await create.text()).slice(0, 200)}`);
  const { id } = await create.json();
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const j = await poll.json();
    if (j.status === "succeeded" && j.output) {
      const url = Array.isArray(j.output) ? j.output[0] : j.output;
      const img = await fetch(url);
      fs.writeFileSync(path.join(outDir, `${key}.jpg`), Buffer.from(await img.arrayBuffer()));
      console.log(`✓ ${key}`);
      return;
    }
    if (j.status === "failed" || j.status === "canceled") throw new Error(`${key}: ${j.error || j.status}`);
  }
  throw new Error(`${key}: timed out`);
}

let failed = 0;
for (const key of Object.keys(VARIANTS)) {
  try { await render(key); } catch (e) { failed++; console.error(String(e)); }
}
process.exit(failed === Object.keys(VARIANTS).length ? 1 : 0);
