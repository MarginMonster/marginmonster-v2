#!/usr/bin/env node
/* Renders the cartoon style previews on GitHub Actions (open network + the
 * REPLICATE_API_TOKEN repo secret): one cast portrait redrawn through each
 * style via flux-kontext-pro — the exact model + prompts production uses.
 * Output: style-previews/<character>/<style>.jpg (committed by the workflow
 * so results are reviewable straight from the repo).
 *
 * Usage: node scripts/generate-style-tiles.mjs [character] [styles|all]
 */
import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.REPLICATE_API_TOKEN;
if (!TOKEN) { console.error("REPLICATE_API_TOKEN not set"); process.exit(1); }

const character = process.argv[2] || "ingrid";
const stylesArg = process.argv[3] || "all";
const RECIPES = JSON.parse(fs.readFileSync("app/lib/cartoon-styles.json", "utf8"));
const PICKER = ["dreamanime", "toyfigure", "brick", "pixar", "retroanime", "vintagetoon", "puppet", "clay"];
const keys = stylesArg === "all" ? PICKER : stylesArg.split(",").map((s) => s.trim()).filter((k) => RECIPES[k]);

const portraitFile = path.join("public", "avatars", `${character}_0.jpg`);
if (!fs.existsSync(portraitFile)) { console.error(`no portrait: ${portraitFile}`); process.exit(1); }
const portrait = "data:image/jpeg;base64," + fs.readFileSync(portraitFile).toString("base64");

const outDir = path.join("style-previews", character);
fs.mkdirSync(outDir, { recursive: true });

async function render(key) {
  const recipe = RECIPES[key];
  const prompt =
    `Redraw this exact person as a ${recipe.look}. Same person — same hairstyle, ` +
    `same friendly likeness, stylized for the art style. They are smiling and holding up ` +
    `a small simple orange bottle with a blue cap (a generic product, no readable text). ` +
    `The hand gripping the bottle is anatomically correct — five fingers, natural relaxed grip, ` +
    `no extra or missing fingers. Wide landscape composition, the character centered from ` +
    `the waist up, beautiful style-true background scene, rich detail, no text, no watermark.`;
  const create = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: { prompt, input_image: portrait, aspect_ratio: "16:9", output_format: "jpg" } }),
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
for (const key of keys) {
  try { await render(key); } catch (e) { failed++; console.error(`✗ ${String(e.message || e)}`); }
}
console.log(`done — ${keys.length - failed}/${keys.length} rendered`);
if (failed === keys.length) process.exit(1);
