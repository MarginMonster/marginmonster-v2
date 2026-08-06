/* Video QA — the parts of the video pipelines that can be checked cheaply.
 *
 * A cartoon ad costs 150 tokens and several minutes, so sweeping video the way
 * we sweep images isn't affordable. But the bug that prompted this — a
 * presenter announcing "claymation" mid-ad — lives entirely in the SCRIPT
 * step, which is one text call and costs a fraction of a cent. So test that
 * exhaustively and be honest that the rest needs a real render.
 *
 * Calls writeCartoonScript, the same writer the pipeline uses.
 */

import { writeCartoonScript, scriptLeaks, stylizeKeyframeForTest, CARTOON_RECIPES, type CartoonStyleKey } from "../app/lib/cartoon-ad-pipeline.server";
import { anthropicVision } from "../app/lib/anthropic.server";
import { runPresenterHold } from "../app/lib/image-generation.server";

/* Products chosen to bait the failure: styles whose NAME is a word a writer
 * might reach for anyway ("clay", "brick", "paper"), and products that invite
 * it ("Blind Box", figures, toys). */
const PRODUCTS = [
  { title: "POP MART SkullPanda Blind Box Case (12 pcs)", desc: "Sealed case of collectible vinyl blind-box figures." },
  { title: "2024 Sonny Angel Christmas Series Sealed Set", desc: "Sealed set of miniature collectible figures." },
  // Deliberately NOT a ceramic/clay product: "clay" is legitimate language for
  // one, so it would trip the detector for an honest reason and make a real
  // leak indistinguishable from correct copy.
  { title: "Stainless Steel Insulated Water Bottle, 32oz", desc: "Double-walled vacuum flask, keeps drinks cold 24 hours." },
];

const REPEATS = Number(process.env.REPEATS || 1);

async function main() {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error("\n[vqa] ANTHROPIC_API_KEY is not set — nothing tested.\n");
    process.exit(78);
  }

  const styles = Object.keys(CARTOON_RECIPES) as CartoonStyleKey[];
  // A commercial/brand-lab dispatch is a RENDER run — the script sweep is
  // six minutes of noise in front of it. Sweep only when nothing else asked.
  const renderOnly = !!(process.env.QA_COMMERCIAL || process.env.QA_BRAND_LAB || process.env.QA_HERO || process.env.QA_EXTRACT || process.env.QA_PORTFOLIO || process.env.QA_FLANKS || process.env.QA_MASCOT);
  if (renderOnly) console.log(`[vqa] render dispatch — skipping the script sweep\n`);
  else console.log(`[vqa] ${styles.length} styles × ${PRODUCTS.length} products × ${REPEATS} = ${styles.length * PRODUCTS.length * REPEATS} scripts\n`);

  let leaked = 0, total = 0, tooLong = 0, tooShort = 0, errored = 0;
  const bad: string[] = [];
  const errs: string[] = [];

  for (const style of renderOnly ? [] : styles) {
    for (const p of PRODUCTS) {
      for (let r = 0; r < REPEATS; r++) {
        total++;
        try {
          // The style is deliberately NOT passed — that is the fix under test.
          // The writer must never learn the style name in the first place.
          const script = await writeCartoonScript({ productTitle: p.title, productDescription: p.desc });
          const leaks = scriptLeaks(script);
          const words = script.split(/\s+/).length;
          if (words > 32) tooLong++;
          // The writer treats <12 words as a refusal and retries, so one
          // surviving here means that guard failed — a "You never know."
          // shipping as a whole voice-over is a real defect, count it loudly.
          if (words < 12) tooShort++;
          if (leaks.length) {
            leaked++;
            bad.push(`${CARTOON_RECIPES[style].name} / ${p.title.slice(0, 32)} → LEAKED [${leaks.join(", ")}]\n      ${script}`);
            console.log(`[vqa] LEAK ${CARTOON_RECIPES[style].name.padEnd(14)} [${leaks.join(", ")}]`);
          } else {
            console.log(`[vqa] ok   ${CARTOON_RECIPES[style].name.padEnd(14)} ${words}w  ${script.slice(0, 74)}`);
          }
        } catch (e) {
          errored++;
          const msg = e instanceof Error ? e.message.slice(0, 160) : String(e);
          errs.push(`${CARTOON_RECIPES[style].name} / ${p.title.slice(0, 32)} → ${msg}`);
          console.log(`[vqa] ERR  ${CARTOON_RECIPES[style].name.padEnd(14)} ${msg}`);
        }
      }
    }
  }

  // A script that errored was never written, so counting it as written and
  // then reporting "0 leaked" says the run was clean when part of it did not
  // happen. Errors get their own row and their own section, always.
  const written = total - errored;
  const md = [
    `## Video QA — cartoon voice-over scripts`,
    ``,
    `| | |`, `|---|---|`,
    `| attempted | ${total} |`,
    `| scripts written | ${written} |`,
    `| failed to generate | ${errored ? `**${errored}**` : "0"} |`,
    `| leaked a style/medium word | **${leaked}**${written ? ` of ${written}` : ""} |`,
    `| over the 32-word cap | ${tooLong} |`,
    `| under 12 words (truncated fragment shipped) | ${tooShort ? `**${tooShort}**` : "0"} |`,
    ``,
    leaked
      ? `### Leaks\n\n\`\`\`\n${bad.join("\n\n")}\n\`\`\``
      : written
        ? `None of the ${written} scripts written named the animation style, the medium, or the fact that it is an ad.`
        : `Nothing was written, so nothing was tested.`,
    ``,
    errored ? `### Failed to generate\n\n\`\`\`\n${errs.join("\n")}\n\`\`\`\n` : ``,
    `Only the SCRIPT step is covered here. Product fidelity in the stylised`,
    `keyframe and the absence of lip-sync both need a real render to verify.`,
  ].join("\n");

  const kf = await keyframeCheck();
  const ph = await presenterHoldCheck();
  const bl = await brandLab();
  const ml = await mascotLab();
  const rx = await referenceExtract();
  const pf = await portfolioAssets();
  const fl = await flankClips();
  const hc = await heroCut();
  const cm = await commercialCheck();
  const ca = await cutawayAssembleCheck();

  const all = [md, kf, ph, bl, ml, rx, pf, fl, hc, cm, ca].filter(Boolean).join("\n\n");
  if (process.env.GITHUB_STEP_SUMMARY) require("node:fs").appendFileSync(process.env.GITHUB_STEP_SUMMARY, all + "\n");
  console.log(`\n${all}\n`);
  if (leaked > 0) process.exit(1);
}




/** Resolve the product once, for whichever checks need it. Lives outside the
 *  individual checks because having the lookup inside one of them meant the
 *  other silently skipped when you ran it on its own. */
/* Explicit product list: "url | title ;; url | title ;; ...". Cuts the sweep
 * loose from storefront JSON entirely — a password-protected shop (or one the
 * runner can't reach) stops being able to blank a whole QA run. */
function explicitProducts(): { url: string; title: string }[] {
  return (process.env.QA_PRODUCT_URLS || "")
    .split(";;").map((s) => s.trim()).filter(Boolean)
    .map((pair) => {
      const [url, title] = pair.split("|").map((x) => x.trim());
      return { url: url || "", title: title || "the product" };
    })
    .filter((p) => p.url.startsWith("http"));
}

let resolvedProduct: { url: string; title: string } | null = null;
async function resolveProduct(): Promise<{ url: string; title: string } | null> {
  if (resolvedProduct) return resolvedProduct;
  const listed = explicitProducts();
  let url = process.env.QA_PRODUCT_URL || listed[0]?.url || "";
  let title = process.env.QA_PRODUCT_TITLE || (url === listed[0]?.url ? listed[0]?.title : "") || "";
  if (!url && process.env.QA_STORE_URL) {
    const { discoverCatalog } = await import("../app/lib/catalog-import.server");
    const { products } = await discoverCatalog(process.env.QA_STORE_URL, 250);
    const want = title.toLowerCase();
    const hit = (want ? products.find((x) => x.title.toLowerCase().includes(want) && x.imageUrl) : null)
      || products.find((x) => !!x.imageUrl);
    if (hit?.imageUrl) { url = hit.imageUrl; title = hit.title; }
    console.log(`[vqa] catalogue lookup → ${title || "(nothing)"}`);
  }
  if (!url) return null;
  resolvedProduct = { url, title: title || "the product" };
  await saveFrame(url, "00-source-product.jpg");
  return resolvedProduct;
}


/** Download a frame next to the report.
 *
 *  The replicate.delivery links in the report expire within the hour and are
 *  unreachable from the dev sandbox, so the run publishes the actual bytes
 *  back through git — otherwise "here are the frames" is a list of links that
 *  are dead by the time anyone clicks them. */
async function saveFrame(url: string, name: string): Promise<string> {
  try {
    const dir = require("node:path").join(process.env.QA_OUT || "qa-out", "frames");
    require("node:fs").mkdirSync(dir, { recursive: true });
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return "";
    const file = require("node:path").join(dir, name);
    require("node:fs").writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return file;
  } catch { return ""; }
}

/* ---------- image ads: the presenter holding the real product ----------
 *
 * The merchant's screenshot that started this: four SkullPanda cases, four
 * different box artworks, all from one source photo. That is the IMAGE ad
 * path — a different pipeline from the cartoon keyframe above, and the one
 * part of image generation the harness could not previously reach.
 *
 * Calls runPresenterHold, the same rung production calls, so what is measured
 * is what merchants get: compose, gate, one shouted retry.
 */
/* Engine A/B. QA_ENGINES is a comma-separated list of fal model ids; the whole
 * presenter check runs once per engine and each row says which one made it.
 * Unset runs whatever the default is, exactly as before. */
async function presenterHoldCheck(): Promise<string> {
  if (!process.env.PRESENTER) return "";
  const engines = (process.env.QA_ENGINES || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (engines.length) {
    const out: string[] = [];
    for (const e of engines) {
      process.env.COMPOSE_MODEL = e;
      // Distinct published frame names per engine — without this the second
      // engine's frames silently overwrite the first's on the qa-frames
      // branch and the comparison is only half inspectable.
      process.env.QA_TAG_PREFIX = `${(e.split("/").filter(Boolean).slice(-2).join("-") || "engine").replace(/[^a-z0-9-]/gi, "")}-`;
      // composeModel() reads COMPOSE_MODEL at call time now — no re-import
      // needed. (The old require-cache purge crashed the bundled CI build:
      // require.resolve has nothing to resolve inside a .cjs bundle.)
      out.push(`#### engine: \`${e}\`\n\n${await presenterHoldOnce()}`);
    }
    return [`### Presenter image ads — engine comparison`, ``, ...out].join("\n\n");
  }
  // Planner A/B: same products, same avatars, same engine — the only variable
  // is whether planShot writes the grip/size/text clauses or the generic
  // box-shaped prompt runs. Same mechanism as the engine loop.
  if (process.env.QA_PLANNER_AB) {
    const out: string[] = [];
    for (const on of [false, true]) {
      process.env.PRESENTER_PLANNER = on ? "1" : "0";
      process.env.QA_TAG_PREFIX = on ? "planner-on-" : "planner-off-";
      out.push(`#### planner: ${on ? "ON (intelligent prompting)" : "OFF (generic prompt)"}\n\n${await presenterHoldOnce()}`);
    }
    return [`### Presenter image ads — shot-planner A/B`, ``, ...out].join("\n\n");
  }
  return presenterHoldOnce();
}

/* ---------- Reference extract: watch a user-supplied recording ----------
 *
 * The sandbox can't decode h264, CI can. QA_EXTRACT=1 probes
 * qa-in/reference.mp4 and publishes one frame per second (plus a dense
 * first-two-seconds strip for pacing) so the recording can be studied
 * frame by frame. No AI spend. */
async function referenceExtract(): Promise<string> {
  if (!process.env.QA_EXTRACT) return "";
  const head = "### Reference recording — extracted frames";
  const fs2 = require("node:fs") as typeof import("node:fs");
  const path2 = require("node:path") as typeof import("node:path");
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const ff = (require("ffmpeg-static") as string) || "ffmpeg";
  let src = path2.join(process.cwd(), "qa-in", "reference.mp4");
  if (process.env.QA_EXTRACT !== "1" && process.env.QA_EXTRACT) {
    // QA_EXTRACT=<name> pulls that file from qa-frames instead — frame-level
    // review of a published take from the sandbox that cannot decode video.
    src = path2.join(process.cwd(), "qa-in", "fetched.mp4");
    execFileSync("curl", ["-sf", "--max-time", "60", "-o", src,
      `https://raw.githubusercontent.com/MarginMonster/marginmonster-v2/qa-frames/frames/${process.env.QA_EXTRACT}`], { stdio: "ignore" });
  }
  if (!fs2.existsSync(src)) return `${head}\n\nSKIPPED — no source recording found.`;
  try {
    const outDir = path2.join(process.cwd(), "qa-out", "frames");
    fs2.mkdirSync(outDir, { recursive: true });
    execFileSync(ff, ["-y", "-i", src, "-vf", "fps=1,scale=540:-2", "-q:v", "4", path2.join(outDir, "ref-%03d.jpg")], { stdio: "ignore" });
    execFileSync(ff, ["-y", "-t", "2", "-i", src, "-vf", "fps=4,scale=400:-2", "-q:v", "5", path2.join(outDir, "ref-open-%02d.jpg")], { stdio: "ignore" });
    const n = fs2.readdirSync(outDir).filter((f: string) => f.startsWith("ref-")).length;
    return [head, ``, `${n} frames published (1fps + 4fps opening strip).`].join("\n");
  } catch (e) {
    // ffmpeg writes duration info to stderr even on the null run — a throw
    // here still usually leaves extracted frames behind; report honestly.
    return `${head}\n\nPartial — ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
  }
}

/* ---------- Portfolio: unbranded merchant products for the hero grid ----
 *
 * No fake EasyMode products — the grid shows what real merchants make:
 * different products, different formats, all genuinely generated. 6
 * hyper-real Veo clips + 2 toon clips + 2 pack shots (~$8), published to
 * qa-out/frames as port-* for the hero assembler (same run or later).
 * QA_PORTFOLIO=1 enables. */
async function portfolioAssets(): Promise<string> {
  if (!process.env.QA_PORTFOLIO) return "";
  const head = "### Portfolio — unbranded merchant assets";
  const fs2 = require("node:fs") as typeof import("node:fs");
  const path2 = require("node:path") as typeof import("node:path");
  try {
    const { sceneKeyframe, renderMotionClip, motionGate } = await import("../app/lib/commercial-ad-pipeline.server");
    const { download } = await import("../app/lib/ugc-ad-pipeline.server");
    const t0 = Date.now();
    const outDir = path2.join(process.cwd(), "qa-out", "frames");
    fs2.mkdirSync(outDir, { recursive: true });
    const CLIPS: [string, string, string][] = [
      ["port-c1", "Slow pour of steaming coffee from a gooseneck kettle into a ceramic mug on a rustic wooden counter, morning window light, an unbranded kraft coffee bag beside it.", "steam rising, slow cinematic push-in"],
      ["port-c2", "A woman dabs serum from a frosted glass dropper bottle onto her cheek in a bright minimal bathroom, soft daylight, dewy skin close-up.", "gentle close-up, slow push"],
      ["port-c3", "A lit artisan candle in an amber glass jar on a windowsill at dusk, flame flickering, cozy warm bokeh behind.", "flame flickers, slow drift sideways"],
      ["port-c4", "White sneakers mid-stride splashing through a shallow puddle on a city street at golden hour, kinetic energy.", "tracking the stride, dynamic motion"],
      ["port-c5", "A commuter wearing matte black over-ear headphones on a night train, city lights streaking past the window, warm interior light.", "lights streak past, subtle sway"],
      ["port-c6", "A vibrant green smoothie being poured into a glass jar on a bright kitchen counter, fresh fruit scattered around.", "pour completes, slight rotation"],
    ];
    const TOONS: [string, string, string][] = [
      ["port-t1", "Cheerful 3D-animated-film style barista character holding up a steaming coffee cup, big expressive eyes, warm cozy cafe background, glossy big-studio animation look.", "she smiles wider and raises the cup"],
      ["port-t2", "Anime style young woman holding an unbranded water bottle on a sunrise hilltop, wind in her hair, painterly sky, soft cel shading.", "hair and grass move in the wind"],
    ];
    const STILLS: [string, string][] = [
      // s0 is the INPUT — a merchant's own phone snap, deliberately casual.
      // The kraft coffee bag kept rendering ugly, so: two candidate products
      // (candle / serum), each as phone-snap + studio pair. The winner gets
      // promoted to port-s0/port-s1.
      ["port-s0-candle", `Casual smartphone photo a small business owner took of their product: a hand-poured soy candle in an amber glass jar with a small minimal cream label reading "AMBER", sitting on a wooden kitchen counter near a window, soft natural morning light, slightly imperfect casual angle, realistic phone-camera look. NOT a studio shot. The ONLY text anywhere is exactly "AMBER".`],
      ["port-s1-candle", `Premium studio packshot of a lit hand-poured soy candle in an amber glass jar with a small minimal cream label reading "AMBER", warm glow, on a soft neutral backdrop, e-commerce hero shot. The ONLY text anywhere is exactly "AMBER".`],
      ["port-s0-serum", `Casual smartphone photo a small business owner took of their product: a frosted glass serum dropper bottle with a blank minimal label, standing on a white bathroom shelf near a window, soft natural light, slightly imperfect casual angle, realistic phone-camera look. NOT a studio shot. No text anywhere.`],
      ["port-s1-serum", "Luxury studio packshot of a frosted glass serum dropper bottle with a blank label on a dark stone surface, dramatic side light, e-commerce hero shot. No text anywhere."],
    ];
    const engine = process.env.QA_COMMERCIAL_ENGINE?.trim() || "veo";
    // QA_PORTFOLIO=stills regenerates only the still assets — the clips are
    // already published and expensive.
    const stillsOnly = process.env.QA_PORTFOLIO === "stills";
    const made: string[] = [];
    await Promise.all([
      ...(stillsOnly ? [] : CLIPS).map(([name, scene, motion]) => (async () => {
        const kf = await sceneKeyframe(undefined, scene);
        let clip = await renderMotionClip(engine, { startImage: kf, prompt: `${motion}. Cinematic live-action, natural physics. No morphing, no text.`, negativePrompt: "warping, morphing text, extra limbs, cartoon, distortion" }, name);
        const gate = await motionGate(clip, true);
        if (!gate.ok) clip = await renderMotionClip(engine, { startImage: kf, prompt: `${motion}. Cinematic live-action, natural physics. No morphing, no text.` }, `${name}-reroll`);
        await download(clip, path2.join(outDir, `${name}.mp4`));
        made.push(name);
      })()),
      ...TOONS.map(([name, scene, motion]) => (async () => {
        const kf = await sceneKeyframe(undefined, scene);
        const clip = await renderMotionClip(undefined, { startImage: kf, prompt: `${motion}. Smooth animated-film motion, character stays on model. No text.`, negativePrompt: "live action, photorealism, warping, text" }, name);
        await download(clip, path2.join(outDir, `${name}.mp4`));
        made.push(name);
      })()),
      ...STILLS.map(([name, prompt]) => (async () => {
        const { brandImage } = await import("../app/lib/commercial-ad-pipeline.server");
        const url = await brandImage(prompt);
        await saveFrame(url, `${name}.jpg`);
        made.push(name);
      })()),
    ]);
    return [head, ``, `${made.length}/10 assets made (${made.sort().join(", ")}) · ${Math.round((Date.now() - t0) / 60_000)} min`].join("\n");
  } catch (e) {
    return `${head}\n\nFAILED — ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`;
  }
}

/* ---------- Flanks: desktop hero side videos + new studio tile covers ----
 *
 * The desktop landing hero is one lonely phone on a wide empty stage — the
 * flanks are two SIMPLE EasyMode clips (a presenter holding the brand bottle,
 * and a cinematic bottle highlight) that sit either side of it. Both compose
 * from the canonical statue bottle so the branding matches every picker tile.
 * Also forges preview stills for the three NEW studio content-type covers
 * (UGC Review / Unboxing / Satisfying Close-Up) with the same prompts prod
 * self-forges from, so the art gets approved before merchants see it.
 * QA_FLANKS=1 enables (~$3: 2 Veo clips + 5 composes). */
async function flankClips(): Promise<string> {
  if (!process.env.QA_FLANKS) return "";
  const head = "### Flanks — desktop hero side clips + studio covers";
  const fs2 = require("node:fs") as typeof import("node:fs");
  const path2 = require("node:path") as typeof import("node:path");
  try {
    const { sceneKeyframe, renderMotionClip, motionGate } = await import("../app/lib/commercial-ad-pipeline.server");
    const { download } = await import("../app/lib/ugc-ad-pipeline.server");
    const t0 = Date.now();
    const outDir = path2.join(process.cwd(), "qa-out", "frames");
    fs2.mkdirSync(outDir, { recursive: true });
    // The ONE canonical brand bottle — same reference every picker tile uses.
    const statue = "https://easymodeapp.com/ad-templates/statue.png";
    const engine = process.env.QA_COMMERCIAL_ENGINE?.trim() || "veo";
    const CLIPS: [string, string, string][] = [
      ["flank-left",
        "Vertical 9:16 social video frame: a friendly photoreal young woman creator in a bright modern kitchen, holding the green EASYMODE sports drink bottle from the reference image up beside her face with the label toward the camera, mid-sentence talking to camera with a warm genuine smile, soft natural daylight, shallow depth of field.",
        "She talks to the camera naturally with subtle hand gestures, keeping the bottle steady and its label visible."],
      ["flank-right",
        "Cinematic hero product shot, tall vertical composition: the green EASYMODE sports drink bottle from the reference image standing on a wet glossy black stone pedestal, dramatic golden rim light carving its silhouette, soft mist swirling at the base, deep emerald-black studio background with a faint warm glow, ultra sharp, luxurious big-budget advertising photography.",
        "Slow orbital drift around the bottle, mist curling, light glinting off the label."],
    ];
    // KEEP IN SYNC with CT_COVER_PROMPTS in image-generation.server.ts — prod
    // self-forges its own covers from these exact prompts.
    const COVERS: [string, string][] = [
      ["ctcover-review", "Selfie-style UGC frame: a young woman creator filming herself on her phone in a cozy bedroom lit by a warm ring-light glow, holding the bottle from the reference image up to the lens, mid-review expression, authentic social-feed energy, slightly casual framing."],
      ["ctcover-unboxing", "First-impressions unboxing moment: hands lifting the bottle from the reference image out of an open kraft shipping box with crinkled tissue paper, on a warm wooden desk in soft daylight, close and personal framing, genuine excitement in the scene."],
      ["ctcover-asmr", "Extreme macro close-up of the bottle from the reference image, condensation droplets rolling down the plastic, dark glossy background, one dramatic beam of light carving the silhouette — oddly satisfying, mesmerizing product photography."],
    ];
    const made: string[] = [];
    await Promise.all([
      ...CLIPS.map(([name, scene, motion]) => (async () => {
        const kf = await sceneKeyframe(statue, scene);
        await saveFrame(kf, `${name}.jpg`); // the <video> poster
        let clip = await renderMotionClip(engine, { startImage: kf, prompt: `${motion} Cinematic live-action, natural physics. No morphing, no extra text.`, negativePrompt: "warping, morphing text, extra limbs, cartoon, distortion" }, name);
        const gate = await motionGate(clip, true);
        if (!gate.ok) clip = await renderMotionClip(engine, { startImage: kf, prompt: `${motion} Cinematic live-action, natural physics. No morphing, no extra text.` }, `${name}-reroll`);
        await download(clip, path2.join(outDir, `${name}.mp4`));
        made.push(name);
      })()),
      ...COVERS.map(([name, prompt]) => (async () => {
        const url = await sceneKeyframe(statue, prompt);
        await saveFrame(url, `${name}.jpg`);
        made.push(name);
      })()),
    ]);
    return [head, ``, `${made.length}/5 assets made (${made.sort().join(", ")}) · ${Math.round((Date.now() - t0) / 60_000)} min`].join("\n");
  } catch (e) {
    return `${head}\n\nFAILED — ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`;
  }
}

/* ---------- Hero Cut: the product-truth super ad ----------
 *
 * No AI-generated footage at all. The ad IS the product working: kinetic
 * brand hook → a sentence typed into the REAL studio prompt (our design
 * system, frame-rendered by Chrome) → a cascade of genuine EasyMode outputs
 * labelled per format → the gstyle close-out with live-spun rosettes.
 * Deterministic Chromium + ffmpeg; the only AI spend is three TTS lines.
 * QA_HERO=1 enables. */
async function heroCut(): Promise<string> {
  if (!process.env.QA_HERO) return "";
  const head = "### Hero Cut — the product-truth super ad";
  const fs2 = require("node:fs") as typeof import("node:fs");
  const path2 = require("node:path") as typeof import("node:path");
  const os2 = require("node:os") as typeof import("node:os");
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const ff = (require("ffmpeg-static") as string) || "ffmpeg";
  const chrome = [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"]
    .find((c) => c && fs2.existsSync(c));
  if (!chrome) return `${head}\n\nSKIPPED — no Chrome on this runner.`;
  const tmp = fs2.mkdtempSync(path2.join(os2.tmpdir(), "hero-"));
  const font = path2.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
  const rosette = path2.join(process.cwd(), "public", "gstyle-rosette.svg");
  const crest = path2.join(process.cwd(), "public", "easymode-head.png");
  const shoot = (html: string, out: string) => {
    const page = `<!doctype html><html><head><style>
      @font-face{font-family:P;src:url(file://${font});font-weight:800}
      *{margin:0;padding:0;box-sizing:border-box}
      body{width:720px;height:1280px;overflow:hidden;font-family:P,sans-serif}
    </style></head><body>${html}</body></html>`;
    const f = out.replace(/\.png$/, ".html");
    fs2.writeFileSync(f, page);
    // Transparent default background — without it every "transparent" label
    // bakes a white slab that ships straight into the overlay.
    execFileSync(chrome!, ["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
      "--default-background-color=00000000", "--window-size=720,1280", `--screenshot=${out}`, `file://${f}`], { stdio: "ignore" });
  };
  const still = (img: string, sec: number, out: string, zoomIn = true, label?: string) => {
    const fr = Math.max(2, Math.round(sec * 30));
    const z = zoomIn ? `1+${(0.12 / fr).toFixed(5)}*on` : `1.12-${(0.12 / fr).toFixed(5)}*on`;
    const args = ["-y", "-loop", "1", "-framerate", "30", "-t", String(sec + 0.1), "-i", img];
    const zchain = `scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560,zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=30`;
    if (label && fs2.existsSync(label)) {
      args.push("-loop", "1", "-framerate", "30", "-t", String(sec + 0.1), "-i", label,
        "-filter_complex", `[0:v]${zchain}[b];[b][1:v]overlay=x=28:y=H-h-64,format=yuv420p[v]`, "-map", "[v]");
    } else {
      args.push("-vf", `${zchain},format=yuv420p`);
    }
    args.push("-t", String(sec), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", out);
    execFileSync(ff, args, { stdio: "ignore" });
  };
  try {
    const t0 = Date.now();
    const segs: string[] = [];
    const green = `background:radial-gradient(120% 90% at 50% 40%, #0C6A3F 0%, #0A3D26 55%, #072A1A 100%)`;
    const roseDiv = `<div style="position:absolute;left:50%;top:46%;width:900px;height:900px;transform:translate(-50%,-50%);opacity:.1;background:url(file://${rosette}) center/contain no-repeat;filter:brightness(3)"></div>`;

    const segLens: number[] = [];
    const pushSeg = (p: string, len: number) => { segs.push(p); segLens.push(len); };
    // DARK CINEMA STAGE — everything floats spotlit on black-green.
    const stage = `background:radial-gradient(130% 100% at 50% 32%, #0E1F16 0%, #07110C 58%, #040A07 100%)`;
    const disp0 = `font-family:Arial,Helvetica,sans-serif;font-weight:700;letter-spacing:-.035em`;
    const headline = `<div style="position:absolute;left:0;right:0;top:62px;text-align:center;${disp0};font-size:31px;color:#F4F1E6;text-shadow:0 0 34px rgba(18,168,94,.35)">Studio-quality ads. <span style="color:#7FE0AC">In minutes.</span></div>`;
    // The opener + extracted-card thumb is the merchant's own PHONE SNAP
    // (port-s0): a casual photo goes in, the grid of real content comes out.
    // qa-in/portfolio holds the approved art in-repo, immune to qa-frames
    // force-pushes; a same-run render in qa-out still wins.
    let packShot = path2.join(process.cwd(), "qa-out", "frames", "port-s0.jpg");
    if (!fs2.existsSync(packShot)) packShot = path2.join(process.cwd(), "qa-in", "portfolio", "port-s0.jpg");
    const flashPng = path2.join(tmp, "flash.png");
    shoot(`<div style="width:720px;height:1280px;background:#EFFFF4"></div>`, flashPng);
    // 2-frame impact flash between acts — the hype-edit stitch.
    const flashSeg = (n: number) => {
      const s = path2.join(tmp, `flash${n}.mp4`);
      execFileSync(ff, ["-y", "-loop", "1", "-framerate", "30", "-t", "0.08", "-i", flashPng,
        "-vf", "scale=720:1280,format=yuv420p", "-t", "0.07", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", s], { stdio: "ignore" });
      pushSeg(s, 0.07);
    };
    // Smash title card: two frames (overshoot → settle) + hold.
    const smash = (html: string, holdSec: number, name: string) => {
      const f1 = path2.join(tmp, `${name}a.png`); const f2 = path2.join(tmp, `${name}b.png`);
      shoot(`<div style="position:relative;width:720px;height:1280px;${stage};display:flex;align-items:center;justify-content:center"><div style="transform:scale(1.14)">${html}</div></div>`, f1);
      shoot(`<div style="position:relative;width:720px;height:1280px;${stage};display:flex;align-items:center;justify-content:center">${html}</div>`, f2);
      const list = path2.join(tmp, `${name}.txt`);
      fs2.writeFileSync(list, `file '${f1}'\nduration 0.12\nfile '${f2}'\nduration ${holdSec}\nfile '${f2}'`);
      const s = path2.join(tmp, `${name}.mp4`);
      execFileSync(ff, ["-y", "-f", "concat", "-safe", "0", "-i", list,
        "-vf", "fps=30,format=yuv420p", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", s], { stdio: "ignore" });
      pushSeg(s, 0.12 + holdSec);
    };

    // Display type: tight neutral grotesk — Poppins' roundness reads cheap
    // at billboard sizes; it stays on the wordmark only.
    const disp = disp0;

    // M) HOST — QA_HERO=monster opens with the Magic Monster on camera:
    // the mascot IS EasyMode output, and the narrator is him. One Veo clip
    // from his tux portrait; every act index below shifts by `off`.
    const monsterHost = process.env.QA_HERO === "monster";
    const off = monsterHost ? 2 : 0;
    let hostAudioPath: string | undefined;
    let hostSec = 4.6;
    let outroRawPath: string | undefined;
    let outroAudioPath: string | undefined;
    let outroSegPath: string | undefined;
    let outroSec = 4.2;
    if (monsterHost) {
      // ZEELY-GRADE HOST — the bust-shot avatar looked robotic next to the
      // reference. Now: (1) forge a flex-mode keyframe (shirtless, runes
      // blazing, in a real shop), (2) Veo performs it full-body with real
      // energy, (3) fal sync-lipsync retargets the mouth on that MOVING
      // footage to his cloned voice. Motion AND sync, not either-or.
      const { repCreate, repPoll, downloadBuffer } = await import("../app/lib/ugc-ad-pipeline.server");
      const { brandStill, renderMotionClip } = await import("../app/lib/commercial-ad-pipeline.server");
      const hostLine = "This ad? Made by EasyMode. Me? I was ALSO made by EasyMode.";
      const raw = path2.join(tmp, "host-raw.mp4");
      hostAudioPath = path2.join(tmp, "host-vo.mp3");
      const outDirM = path2.join(process.cwd(), "qa-out", "frames");
      fs2.mkdirSync(outDirM, { recursive: true });
      const keptClip = path2.join(outDirM, "host5-raw.mp4");
      const keptVo = path2.join(outDirM, "host5-vo.mp3");
      const curlHost = (url: string, out: string, min: number) => {
        try { execFileSync("curl", ["-sf", "--max-time", "30", "-o", out, url], { stdio: "ignore" }); return fs2.existsSync(out) && fs2.statSync(out).size > min; } catch { return false; }
      };
      const RAWQ = "https://raw.githubusercontent.com/MarginMonster/marginmonster-v2/qa-frames/frames";
      const falQueueVideo = async (model: string, body: Record<string, unknown>, tag: string): Promise<string> => {
        const sub = await fetch(`https://queue.fal.run/${model}`, {
          method: "POST", headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!sub.ok) throw new Error(`${tag} submit ${sub.status}: ${(await sub.text()).slice(0, 200)}`);
        const j = (await sub.json()) as { status_url?: string; response_url?: string };
        for (let i = 0; i < 160; i++) {
          await new Promise((r) => setTimeout(r, 5000));
          const s = await fetch(j.status_url!, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
          if (!s.ok) continue;
          const sj = (await s.json()) as { status?: string };
          if (sj.status === "COMPLETED") break;
          if (sj.status === "FAILED" || sj.status === "ERROR") throw new Error(`${tag} failed in queue`);
        }
        const r = await fetch(j.response_url!, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
        const rj = (await r.json()) as { video?: { url?: string }; video_url?: string; url?: string };
        const url = rj.video?.url || rj.video_url || rj.url;
        if (!url) throw new Error(`${tag}: no video url in response`);
        return url;
      };
      void falQueueVideo; void renderMotionClip;
      const { submitAvatar, pollAvatar } = await import("../app/lib/fal-video.server");
      const outroLine = "EasyMode. Marketing on easy mode. Take it from the monster it made.";
      outroRawPath = path2.join(tmp, "outro-raw.mp4");
      outroAudioPath = path2.join(tmp, "outro-vo.mp3");
      const keptOutro = path2.join(outDirM, "host5-outro.mp4");
      const keptOutroVo = path2.join(outDirM, "host5-outro-vo.mp3");
      const keptTee = path2.join(outDirM, "monster-real.jpg");
      const haveCache =
        (fs2.existsSync(keptClip) ? (fs2.copyFileSync(keptClip, raw), true) : curlHost(`${RAWQ}/host5-raw.mp4`, raw, 100_000)) &&
        (fs2.existsSync(keptVo) ? (fs2.copyFileSync(keptVo, hostAudioPath), true) : curlHost(`${RAWQ}/host5-vo.mp3`, hostAudioPath, 5_000)) &&
        (fs2.existsSync(keptOutro) ? (fs2.copyFileSync(keptOutro, outroRawPath), true) : curlHost(`${RAWQ}/host5-outro.mp4`, outroRawPath, 100_000)) &&
        (fs2.existsSync(keptOutroVo) ? (fs2.copyFileSync(keptOutroVo, outroAudioPath), true) : curlHost(`${RAWQ}/host5-outro-vo.mp3`, outroAudioPath, 5_000));
      if (!haveCache) {
        // 0) His EasyMode-tee presenter portrait (forged once, then cached).
        let teeUrl = "";
        if (fs2.existsSync(keptTee) || curlHost(`${RAWQ}/monster-real.jpg`, keptTee, 20_000)) {
          teeUrl = `${RAWQ}/monster-real.jpg`;
        } else {
          // A REAL photograph of him is the base — a synthesized portrait
          // rendered plastic and the engine animated the plastic. Only the
          // wardrobe, the third-party packaging and the (branded) background
          // change; his face, skin and light — what carries realism — are
          // held fixed.
          teeUrl = await brandStill(
            `Edit this photograph. Change ONLY three things. 1) Dress him in a fitted dark-green t-shirt with the word "EASYMODE" printed in bold white capitals across the chest. 2) Replace the branded card box in his hands with a plain unbranded matte white product box of the same size, held exactly the same way. 3) Throw the background completely out of focus — a soft creamy shallow-depth-of-field blur of a warm modern retail interior, so no packaging or lettering behind him is legible. Keep EVERYTHING else pixel-identical: his exact face, skin texture and pores, glasses, ears, glowing golden rune tattoos, his pose and both hands, and the original photographic lighting and camera grain. It must still look like the SAME real photograph — no illustration, no CGI look, no smoothing or beauty retouching of his face. The ONLY text anywhere is exactly "EASYMODE" on the shirt.`,
            ["https://raw.githubusercontent.com/MarginMonster/marginmonster-v2/94e938443d3527550b9872fb2c3105a5217cbd3e/qa-in/mascot/zeely-base.jpg"],
            true);
          try { execFileSync("curl", ["-sf", "-o", keptTee, teeUrl], { stdio: "ignore" }); } catch { /* cache is best-effort */ }
        }
        // 1) Both lines in his cloned Zeely voice.
        const tts = async (text: string) => {
          const id0 = await repCreate("minimax/speech-02-turbo", { text, voice_id: "R8_95CETMBJ", english_normalization: true });
          return repPoll(id0, 3 * 60_000, "hero-host-vo");
        };
        const [voUrl, outroVoUrl] = await Promise.all([tts(hostLine), tts(outroLine)]);
        fs2.writeFileSync(hostAudioPath, await downloadBuffer(voUrl));
        fs2.writeFileSync(outroAudioPath, await downloadBuffer(outroVoUrl));
        // 2) The NORMAL pipeline's engine — the one merchant videos use.
        const [introUrl, outroUrl] = await Promise.all([
          submitAvatar(teeUrl, voUrl).then(pollAvatar),
          submitAvatar(teeUrl, outroVoUrl).then(pollAvatar),
        ]);
        fs2.writeFileSync(raw, await downloadBuffer(introUrl));
        fs2.writeFileSync(outroRawPath, await downloadBuffer(outroUrl));
        fs2.copyFileSync(raw, keptClip);
        fs2.copyFileSync(hostAudioPath, keptVo);
        fs2.copyFileSync(outroRawPath, keptOutro);
        fs2.copyFileSync(outroAudioPath, keptOutroVo);
      }
      // The clip runs as long as the speech — keep it all plus a beat.
      try {
        const probe = execFileSync(ff, ["-i", raw], { stdio: ["ignore", "ignore", "pipe"] }).toString();
        void probe;
      } catch (e) {
        const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String((e as { stderr?: Buffer }).stderr || ""));
        if (m) hostSec = Math.min(8, Math.max(3, +m[1] * 3600 + +m[2] * 60 + +m[3] + 0.15));
      }
      const segM = path2.join(tmp, "segM.mp4");
      // Zeely-style spoken-word caption pills over the host's beats.
      const pillPng = (txt: string, out: string) => shoot(
        `<div style="display:flex;justify-content:center;align-items:center;width:720px;height:130px">
           <div style="background:rgba(0,0,0,.58);color:#fff;font-family:Arial,Helvetica,sans-serif;font-weight:800;letter-spacing:-.02em;font-size:30px;padding:13px 24px;border-radius:15px">${txt}</div>
         </div>`, out);
      const pA = path2.join(tmp, "pillA.png"); const pB = path2.join(tmp, "pillB.png");
      pillPng(`THIS AD? <span style="color:#7FE0AC">MADE BY EASYMODE</span>`, pA);
      pillPng(`ME? <span style="color:#E7C879">ALSO MADE BY EASYMODE</span> 💪`, pB);
      const mid = (hostSec / 2).toFixed(2);
      execFileSync(ff, ["-y", "-i", raw, "-i", pA, "-i", pB,
        "-filter_complex",
        "[0:v]scale=760:1352:force_original_aspect_ratio=increase,crop=720:1280:(in_w-720)/2:(in_h-1280)/2+sin(t/1.7)*5,fps=30[v0];" +
        `[v0][1:v]overlay=(W-w)/2:H-250:enable='between(t,0.25,${mid})'[v1];` +
        `[v1][2:v]overlay=(W-w)/2:H-250:enable='between(t,${mid},${hostSec.toFixed(2)})'[v2];` +
        "[v2]format=yuv420p[v]",
        "-map", "[v]", "-t", String(hostSec), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", segM], { stdio: "ignore" });
      pushSeg(segM, hostSec);
      flashSeg(0);
      // OUTRO — his sign-off take, spliced back in before the close.
      try { execFileSync(ff, ["-i", outroRawPath!], { stdio: ["ignore", "ignore", "pipe"] }); } catch (e) {
        const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String((e as { stderr?: Buffer }).stderr || ""));
        if (m) outroSec = Math.min(9, Math.max(3, +m[1] * 3600 + +m[2] * 60 + +m[3] + 0.1));
      }
      outroSegPath = path2.join(tmp, "segMo.mp4");
      execFileSync(ff, ["-y", "-i", outroRawPath!,
        "-vf", "scale=760:1352:force_original_aspect_ratio=increase,crop=720:1280:(in_w-720)/2:(in_h-1280)/2+sin(t/1.7)*5,fps=30,format=yuv420p",
        "-t", String(outroSec), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", outroSegPath], { stdio: "ignore" });
    }

    // A) SLAM OPEN — the product alone, no words. Let the object talk.
    smash(`<div style="display:flex;flex-direction:column;align-items:center">
      <img src="file://${packShot}" style="width:430px;border-radius:24px;box-shadow:0 30px 90px rgba(0,0,0,.7),0 0 60px rgba(18,168,94,.25)">
    </div>`, 0.8, "slam");
    flashSeg(1);

    // B) PASTE + EXTRACT — the store-link extractor, the studio's most
    // magical real feature: paste a product URL, the photo and title pull
    // themselves out of the store. Then the press detonates.
    const sentence = "Golden Hour — Small Batch Candle";
    const pasteUrl = "mystore.com/products/golden-hour-candle";
    // states: 0 empty field · 1 URL pasted (highlight) · 2 reading spinner ·
    // 3 extracted card (thumb + title materialize) · 4 press
    const studioFrame = (state: number, k: number) =>
      `<div style="position:relative;width:720px;height:1280px;${stage};display:flex;align-items:center;justify-content:center;overflow:hidden">${headline}
        <div style="width:640px;transform:perspective(1300px) rotateX(7deg) rotateY(${(-6 + k * 1.1).toFixed(2)}deg) scale(${(1 + k * 0.014).toFixed(3)})">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:22px">
            <img src="file://${crest}" style="width:42px;height:42px;border-radius:10px;box-shadow:0 0 24px rgba(18,168,94,.5)">
            <div style="font-size:25px;color:#F4F1E6">Easy<span style="color:#E7C879">Mode</span><span style="font-size:15px;color:#7FE0AC;margin-left:10px;font-weight:800">Studio</span></div>
          </div>
          <div style="background:linear-gradient(168deg,#10231A,#0B1A12);border:1px solid rgba(127,224,172,.28);border-radius:20px;box-shadow:0 40px 90px rgba(0,0,0,.65),0 0 70px rgba(18,168,94,.16);padding:28px 26px;position:relative;overflow:hidden">
            <div style="font-size:15px;color:#7FE0AC;margin-bottom:12px;font-weight:800;letter-spacing:.06em;${disp}">PASTE YOUR PRODUCT LINK</div>
            <div style="background:rgba(4,10,7,.75);border:1.5px solid ${state >= 1 ? "#12A85E" : "rgba(127,224,172,.25)"};border-radius:13px;padding:17px 16px;font-family:Arial,sans-serif;font-weight:600;font-size:19px;color:${state >= 1 ? "#F4F1E6" : "#5d6a61"};${state === 1 ? "box-shadow:0 0 26px rgba(18,168,94,.35);background:rgba(18,168,94,.14);" : ""}">${state >= 1 ? pasteUrl : "https://…"}</div>
            ${state === 2 ? `<div style="margin-top:16px;display:flex;align-items:center;gap:11px;font-size:17px;font-weight:700;color:#E7C879;${disp}">
                <span style="display:inline-block;width:14px;height:14px;border-radius:50%;border:3px solid rgba(231,200,121,.3);border-top-color:#E7C879"></span>Reading your store…</div>` : ""}
            ${state >= 3 ? `<div style="margin-top:16px;display:flex;align-items:center;gap:14px;background:rgba(18,168,94,.1);border:1px solid rgba(127,224,172,.4);border-radius:13px;padding:12px 14px">
                <img src="file://${packShot}" style="width:58px;height:58px;object-fit:cover;border-radius:9px">
                <div><div style="font-size:18px;font-weight:700;color:#F4F1E6;${disp}">${sentence}</div>
                <div style="font-size:13px;color:#7FE0AC;font-weight:700;margin-top:3px">&#10003; photo &amp; title pulled from your store</div></div></div>` : ""}
            <div style="margin-top:20px;display:flex;justify-content:flex-end">
              <div style="font-size:18px;font-weight:800;color:#fff;background:linear-gradient(160deg,#12A85E,#0C7A46);padding:16px 32px;border-radius:13px;box-shadow:0 5px 0 #06301D,0 0 34px rgba(18,168,94,.4)${state === 4 ? ";transform:translateY(4px) scale(.97);box-shadow:0 1px 0 #06301D,0 0 60px rgba(127,224,172,.8);filter:brightness(1.3)" : ""}">Generate &rarr;</div>
            </div>
          </div>
        </div>
      </div>`;
    const typedFrames: { png: string; dur: number }[] = [];
    ([[0, 0.4], [1, 0.55], [2, 0.75], [3, 0.9]] as const).forEach(([st, dur], k) => {
      const p = path2.join(tmp, `paste${st}.png`);
      shoot(studioFrame(st, k), p);
      typedFrames.push({ png: p, dur });
    });
    const pressPng = path2.join(tmp, "press.png");
    shoot(studioFrame(4, 4), pressPng);
    typedFrames.push({ png: pressPng, dur: 0.32 });
    const typeList = path2.join(tmp, "type.txt");
    fs2.writeFileSync(typeList, typedFrames.map((f) => `file '${f.png}'\nduration ${f.dur}`).join("\n") + `\nfile '${pressPng}'`);
    const segB = path2.join(tmp, "segB.mp4");
    execFileSync(ff, ["-y", "-f", "concat", "-safe", "0", "-i", typeList,
      "-vf", "fps=30,format=yuv420p", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", segB], { stdio: "ignore" });
    pushSeg(segB, typedFrames.reduce((a, f) => a + f.dur, 0));
    flashSeg(2);

    // T) THINKING — the agentic states, honestly named. "Checking every
    // frame" is the fidelity gate, stated as product.
    const chipLabels = ["Writing the ad…", "Placing your product…", "Checking every frame…"];
    const thinkFrame = (n: number) =>
      `<div style="position:relative;width:720px;height:1280px;${stage};display:flex;align-items:center;justify-content:center;overflow:hidden">${headline}
        <div style="width:640px;transform:perspective(1300px) rotateX(6deg) rotateY(${(-2 + n * 1.4).toFixed(1)}deg) scale(${(1.02 + n * 0.015).toFixed(3)})">
          <div style="background:linear-gradient(168deg,#10231A,#0B1A12);border:1px solid rgba(127,224,172,.28);border-radius:20px;box-shadow:0 40px 90px rgba(0,0,0,.65),0 0 70px rgba(18,168,94,.16);padding:26px 24px;position:relative;overflow:hidden">
            <div style="background:rgba(4,10,7,.75);border:1.5px solid rgba(127,224,172,.25);border-radius:13px;padding:15px;font-family:Inter,Arial,sans-serif;font-weight:600;font-size:19px;color:#8FA89A">${sentence}</div>
            <div style="margin-top:20px;display:flex;flex-direction:column;gap:12px">
              ${chipLabels.slice(0, n).map((c, i) =>
                `<div style="display:flex;align-items:center;gap:12px;background:rgba(4,10,7,.6);border:1px solid ${i < n - 1 ? "rgba(127,224,172,.45)" : "rgba(231,200,121,.55)"};border-radius:13px;padding:15px 16px;font-size:19px;font-weight:800;color:#F4F1E6;${i === n - 1 ? "box-shadow:0 0 30px rgba(231,200,121,.18);" : ""}">
                   ${i < n - 1
                     ? `<span style="color:#7FE0AC;font-size:21px">&#10003;</span>`
                     : `<span style="display:inline-block;width:15px;height:15px;border-radius:50%;border:3px solid rgba(231,200,121,.3);border-top-color:#E7C879"></span>`}
                   ${c}</div>`).join("")}
            </div>
          </div>
        </div>
      </div>`;
    const thinkFrames: { png: string; dur: number }[] = [];
    for (let n = 1; n <= 3; n++) {
      const p = path2.join(tmp, `think${n}.png`);
      shoot(thinkFrame(n), p);
      thinkFrames.push({ png: p, dur: n === 3 ? 0.85 : 0.5 });
    }
    const thinkList = path2.join(tmp, "think.txt");
    fs2.writeFileSync(thinkList, thinkFrames.map((f) => `file '${f.png}'\nduration ${f.dur}`).join("\n") + `\nfile '${thinkFrames[2].png}'`);
    const segT = path2.join(tmp, "segT.mp4");
    execFileSync(ff, ["-y", "-f", "concat", "-safe", "0", "-i", thinkList,
      "-vf", "fps=30,format=yuv420p", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", segT], { stdio: "ignore" });
    pushSeg(segT, thinkFrames.reduce((a, f) => a + f.dur, 0));
    flashSeg(3);

    // G) GRID FILL — LIVE video tiles composited in real time. Every tile
    // moves: portfolio clips play, pack shots and cards get Ken Burns.
    const curl = (url: string, out: string) => {
      try { execFileSync("curl", ["-sf", "--max-time", "20", "-o", out, url], { stdio: "ignore" }); return fs2.existsSync(out) && fs2.statSync(out).size > 5000; } catch { return false; }
    };
    const framesDir = path2.join(process.cwd(), "qa-out", "frames");
    const RAW = "https://raw.githubusercontent.com/MarginMonster/marginmonster-v2/qa-frames/frames";
    const avail = new Map<string, { src: string; video: boolean }>();
    const grab = (name: string, ext: string, video: boolean) => {
      const local = path2.join(framesDir, `${name}.${ext}`);
      if (fs2.existsSync(local)) { avail.set(name, { src: local, video }); return; }
      // approved stills live in-repo, immune to qa-frames force-pushes
      const kept = path2.join(process.cwd(), "qa-in", "portfolio", `${name}.${ext}`);
      if (fs2.existsSync(kept)) { avail.set(name, { src: kept, video }); return; }
      const t = path2.join(tmp, `${name}.${ext}`);
      if (curl(`${RAW}/${name}.${ext}`, t)) avail.set(name, { src: t, video });
    };
    for (let i = 1; i <= 6; i++) grab(`port-c${i}`, "mp4", true);
    for (const t of ["port-t1", "port-t2"]) grab(t, "mp4", true);
    for (const s of ["port-s1", "port-s2"]) grab(s, "jpg", false);
    for (const [u, name] of [["ad-templates/format-review.jpg", "fmt-review"], ["ad-templates/format-tweet.jpg", "fmt-tweet"]] as const) {
      const p = path2.join(tmp, `${name}.jpg`);
      if (curl(`https://easymodeapp.com/${u}`, p)) avail.set(name, { src: p, video: false });
    }
    // the candle (the typed product) leads, then the wall widens to everything
    const wish = ["port-c3", "port-s1", "fmt-review", "port-c1", "port-t1", "port-c4", "port-c2", "fmt-tweet", "port-c5", "port-t2", "port-s2", "port-c6"];
    const tilesV = wish.map((w) => avail.get(w)).filter(Boolean) as { src: string; video: boolean }[];
    if (!tilesV.length) throw new Error("hero grid: no tiles available — run portfolio first");
    const rows = Math.ceil(tilesV.length / 3);
    const tw = rows >= 4 ? 184 : 214;
    const th = rows >= 4 ? 246 : 286;
    const x0 = Math.round((720 - 3 * tw - 2 * 12) / 2);
    const y0 = 165;
    const pops = tilesV.map((_, i) => 0.05 + i * 0.14);
    const capT = pops[pops.length - 1] + 0.35;
    const gridLen = capT + 1.7;
    // per-tile normalized mp4s at exact cell size
    const tileMp4s: string[] = [];
    tilesV.forEach((t, i) => {
      const out = path2.join(tmp, `tile${i}.mp4`);
      if (t.video) {
        execFileSync(ff, ["-y", "-stream_loop", "-1", "-t", String(gridLen + 0.3), "-i", t.src,
          "-vf", `scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th},fps=30,format=yuv420p`,
          "-t", String(gridLen), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", out], { stdio: "ignore" });
      } else {
        const fr = Math.round(gridLen * 30);
        execFileSync(ff, ["-y", "-loop", "1", "-framerate", "30", "-t", String(gridLen + 0.3), "-i", t.src,
          "-vf", `scale=${tw * 3}:${th * 3}:force_original_aspect_ratio=increase,crop=${tw * 3}:${th * 3},zoompan=z='1+${(0.12 / fr).toFixed(6)}*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${tw}x${th}:fps=30,format=yuv420p`,
          "-t", String(gridLen), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", out], { stdio: "ignore" });
      }
      tileMp4s.push(out);
    });
    const gridBase = path2.join(tmp, "gridbase.png");
    shoot(`<div style="position:relative;width:720px;height:1280px;${stage}">${headline}</div>`, gridBase);
    const capPng = renderOverlayPng(
      `<div style="color:#F4F1E6;font-family:Arial,Helvetica,sans-serif;font-weight:700;letter-spacing:-.03em;font-size:27px;text-align:center;text-shadow:0 2px 8px rgba(0,0,0,.8)">Whatever you sell. <span style="color:#7FE0AC">One tap each.</span></div>`,
      700, 60, path2.join(tmp, "cap.png"));
    const gArgs = ["-y", "-loop", "1", "-framerate", "30", "-t", String(gridLen), "-i", gridBase];
    tileMp4s.forEach((p) => gArgs.push("-i", p));
    if (capPng) gArgs.push("-loop", "1", "-framerate", "30", "-t", String(gridLen), "-i", capPng);
    const gParts: string[] = [];
    let gcur = "0:v";
    tileMp4s.forEach((_, i) => {
      const x = x0 + (i % 3) * (tw + 12);
      const y = y0 + Math.floor(i / 3) * (th + 12);
      gParts.push(`[${i + 1}:v]setpts=PTS-STARTPTS[gt${i}]`);
      gParts.push(`[${gcur}][gt${i}]overlay=x=${x}:y=${y}:enable='gte(t,${pops[i].toFixed(2)})'[gv${i}]`);
      gcur = `gv${i}`;
    });
    if (capPng) {
      gParts.push(`[${tileMp4s.length + 1}:v]format=rgba[gcap]`);
      gParts.push(`[${gcur}][gcap]overlay=x=(W-w)/2:y=${y0 + rows * (th + 12) + 14}:enable='gte(t,${capT.toFixed(2)})'[gvc]`);
      gcur = "gvc";
    }
    gParts.push(`[${gcur}]format=yuv420p[gout]`);
    const segG = path2.join(tmp, "segG.mp4");
    execFileSync(ff, [...gArgs, "-filter_complex", gParts.join(";"), "-map", "[gout]",
      "-t", String(gridLen), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", segG], { stdio: "ignore" });
    pushSeg(segG, gridLen);

    // P) AUTOPOST — smash card, the flex the reference can't make.
    flashSeg(4);
    {
      const logos = ["tiktok", "instagram", "facebook"].map((n) => path2.join(process.cwd(), "public", "ai-logos", `${n}.svg`)).filter((p) => fs2.existsSync(p));
      smash(`<div style="display:flex;flex-direction:column;align-items:center;gap:42px">${roseDiv}
        <div style="position:relative;color:#F4F1E6;${disp};font-size:56px;line-height:1.1;text-align:center;text-shadow:0 0 40px rgba(18,168,94,.4)">Posts them <span style="color:#E7C879">for you.</span></div>
        <div style="position:relative;display:flex;gap:36px;align-items:center">${logos.map((l) => `<img src="file://${l}" style="width:68px;height:68px;filter:drop-shadow(0 6px 16px rgba(0,0,0,.6))">`).join("")}</div>
      </div>`, 1.5, "post");
    }

    // D) CLOSE — in monster mode his sign-off take lands first, then the
    // gstyle card.
    if (outroSegPath) pushSeg(outroSegPath, outroSec);
    const base = path2.join(process.cwd(), "public", "showcase", "endcard-base.png");
    const rose = path2.join(process.cwd(), "public", "showcase", "endcard-rosette.png");
    const segD = path2.join(tmp, "segD.mp4");
    execFileSync(ff, ["-y", "-loop", "1", "-framerate", "30", "-t", "4.2", "-i", base, "-loop", "1", "-framerate", "30", "-t", "4.2", "-i", rose,
      "-filter_complex",
      "[0:v]scale=720:1280[bg];[1:v]format=rgba,scale=460:460,split[ra][rb];" +
      "[ra]rotate=t*0.35:c=none:ow=hypot(iw\\,ih):oh=ow[r1];[rb]rotate=-t*0.28:c=none:ow=hypot(iw\\,ih):oh=ow[r2];" +
      "[bg][r1]overlay=x=W-w*0.72:y=-h*0.28[b1];[b1][r2]overlay=x=-w*0.28:y=H-h*0.72[b2];" +
      "[b2]fade=t=in:st=0:d=0.4,fade=t=out:st=3.6:d=0.5,format=yuv420p[v]",
      "-map", "[v]", "-t", "4", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", segD], { stdio: "ignore" });
    pushSeg(segD, 4);

    // Segment order (+off when the host act leads): 0 slam, 1 flash,
    // 2 typing, 3 flash, 4 think, 5 flash, 6 grid, 7 flash, 8 post, 9 close.
    const startOf = (i: number) => segLens.slice(0, i).reduce((a, b) => a + b, 0);
    const totalSec = segLens.reduce((a, b) => a + b, 0);

    // VOICE — tight lines + tagline, and a MUSIC bed driving under
    // everything (the silence was the basement). In monster mode the
    // narrator IS the host: his flex opens, his tag closes.
    const { repCreate, repPoll, downloadBuffer } = await import("../app/lib/ugc-ad-pipeline.server");
    // In monster mode the host line is BAKED lip-synced audio (mixed below),
    // and the narrator becomes his deep voice throughout.
    const lines: [string, number][] = [
      ["Paste your product.", startOf(2 + off) + 0.4],
      ["It writes. It films. It checks.", startOf(4 + off) + 0.1],
      ["Whatever you sell.", startOf(6 + off) + 1.9],
      ...(monsterHost ? [] : [["EasyMode. Marketing on easy mode.", startOf(9) + 0.5] as [string, number]]),
    ];
    let musicPath: string | undefined;
    try {
      const mid = await repCreate("minimax/music-1.5", {
        lyrics: "##\n(instrumental)\n##",
        prompt: "dark confident modern trap instrumental, heavy 808 bass, crisp hi-hat rolls, sparse and expensive, premium sneaker-ad energy, no vocals",
      });
      const murl = await repPoll(mid, 4 * 60_000, "hero-music");
      musicPath = path2.join(tmp, "music.mp3");
      fs2.writeFileSync(musicPath, await downloadBuffer(murl));
    } catch (e) {
      console.log(`[hero] music bed failed (${(e instanceof Error ? e.message : String(e)).slice(0, 120)}) — shipping without`);
      musicPath = undefined;
    }
    const voFiles: string[] = [];
    await Promise.all(lines.map(async ([text], i) => {
      // magnetic_voiced_man: the deep trailer read — Trustworth was the
      // infomercial "presenter" tone that kept feeling off. Monster mode:
      // the HOST narrates his own ad, same deep-pitched voice as his clip.
      const id = await repCreate(monsterHost ? "minimax/speech-02-turbo" : "minimax/speech-02-hd", monsterHost
        ? { text, voice_id: "R8_95CETMBJ", english_normalization: true }
        : { text, voice_id: "English_magnetic_voiced_man", emotion: "neutral", english_normalization: true, language_boost: "English" });
      const url = await repPoll(id, 3 * 60_000, `hero-vo-${i + 1}`);
      const p = path2.join(tmp, `vo${i}.mp3`);
      fs2.writeFileSync(p, await downloadBuffer(url));
      voFiles[i] = p;
    }));
    // The talking takes' own audio: intro at the head, outro at its splice.
    if (hostAudioPath) { voFiles.push(hostAudioPath); lines.push(["", 0.05]); }
    if (outroAudioPath && outroSegPath) { voFiles.push(outroAudioPath); lines.push(["", startOf(9 + off) + 0.1]); }

    // FINAL — concat, watermark from the cascade onward, VO mix.
    const wm = renderOverlayPng(
      `<div style="color:#fff;font-weight:800;font-size:23px;opacity:.92;text-shadow:0 1px 2px rgba(0,0,0,.95),0 0 10px rgba(0,0,0,.6)">Easy<span style="color:#E7C879">Mode</span></div>`,
      170, 42, path2.join(tmp, "wm.png"));
    const list = path2.join(tmp, "list.txt");
    fs2.writeFileSync(list, segs.map((s) => `file '${s}'`).join("\n"));
    const outDir = path2.join(process.cwd(), "qa-out", "frames");
    fs2.mkdirSync(outDir, { recursive: true });
    const outPath = path2.join(outDir, "hero-cut.mp4");
    const args = ["-y", "-f", "concat", "-safe", "0", "-i", list];
    voFiles.forEach((p) => args.push("-i", p));
    if (musicPath) args.push("-i", musicPath);
    if (wm) args.push("-loop", "1", "-framerate", "30", "-t", String(totalSec), "-i", wm);
    const fparts: string[] = [];
    let vcur = "0:v";
    if (wm) {
      const wmIdx = 1 + voFiles.length + (musicPath ? 1 : 0);
      fparts.push(`[${wmIdx}:v]format=rgba[wmk]`);
      fparts.push(`[0:v][wmk]overlay=x=W-w-24:y=104:enable='between(t,${startOf(6 + off).toFixed(2)},${startOf(8 + off).toFixed(2)})'[vw]`);
      vcur = "vw";
    }
    fparts.push(`[${vcur}]eq=contrast=1.05:saturation=1.08,format=yuv420p[vout]`);
    const aIns: string[] = voFiles.map((_, i) => {
      fparts.push(`[${i + 1}:a]adelay=${Math.round(lines[i][1] * 1000)}:all=1[va${i}]`);
      return `[va${i}]`;
    });
    if (musicPath) {
      fparts.push(`[${1 + voFiles.length}:a]volume=0.22,atrim=0:${totalSec},afade=t=out:st=${(totalSec - 1.5).toFixed(2)}:d=1.5[mus]`);
      aIns.push("[mus]");
    }
    fparts.push(`${aIns.join("")}amix=inputs=${aIns.length}:normalize=0,apad=whole_dur=${totalSec}[aout]`);
    args.push("-filter_complex", fparts.join(";"), "-map", "[vout]", "-map", "[aout]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-t", String(totalSec), outPath);
    execFileSync(ff, args, { stdio: "ignore" });
    // Report frames: one per act (order: 0 slam,1 fl,2 type,3 fl,4 think,5 fl,6 grid,7 fl,8 post,9 close).
    const grabs: [string, number][] = [
      ...(monsterHost ? [["hero-host.jpg", 0.6] as [string, number]] : []),
      ["hero-drop.jpg", startOf(0 + off) + 0.5],
      ["hero-typing.jpg", startOf(2 + off) + 1.2],
      ["hero-think.jpg", startOf(4 + off) + 1.4],
      ["hero-gridfill.jpg", startOf(6 + off) + 0.8],
      ["hero-gridfull.jpg", startOf(7 + off) - 0.6],
      ["hero-post.jpg", startOf(8 + off) + 0.7],
      ...(monsterHost ? [["hero-outro.jpg", startOf(9 + off) + 0.5] as [string, number]] : []),
      ["hero-close.jpg", startOf(9 + off + (monsterHost ? 1 : 0)) + 2],
    ];
    for (const [name, t] of grabs) {
      try { execFileSync(ff, ["-y", "-ss", String(t), "-i", outPath, "-frames:v", "1", "-q:v", "3", path2.join(outDir, name)], { stdio: "ignore" }); } catch { /* best-effort */ }
    }
    return [head, ``, `| | |`, `|---|---|`,
      `| length | ${totalSec.toFixed(1)}s |`,
      `| grid tiles | ${tilesV.length} LIVE (${tilesV.filter((t) => t.video).length} video, ${tilesV.filter((t) => !t.video).length} Ken Burns) |`,
      `| AI footage | none — Chromium + ffmpeg + real outputs |`,
      `| wall time | ${Math.round((Date.now() - t0) / 60_000)} min |`].join("\n");
  } catch (e) {
    return `${head}\n\nFAILED — ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`;
  } finally {
    try { fs2.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/* ---------- Brand Lab: EasyMode hero products + commercial cut scenes ----
 *
 * The approval gate before a commercial spends real money. Images only
 * (~$1.50): forge branded pack-shot candidates, then plan the spot and
 * render its five cut scenes as chained keyframes — everything lands on
 * qa-frames for a human verdict BEFORE any kling/VO dollars move.
 * QA_BRAND_LAB=1 enables. */
async function brandLab(): Promise<string> {
  if (!process.env.QA_BRAND_LAB) return "";
  const head = "### Brand Lab — EasyMode hero products + cut scenes";
  try {
    const { brandImage, planCommercial, sceneKeyframe } = await import("../app/lib/commercial-ad-pipeline.server");
    const t0 = Date.now();
    const packs: Array<[string, string]> = [
      ["brand-sport-green.jpg",
        `Professional studio product photograph of a premium sports drink: a sleek 500ml sports bottle with a grip waist and black flip-top cap, vivid green-to-black label. The wordmark "EASYMODE" in bold athletic capitals with a small white lightning bolt, and beneath it the flavor line "CITRUS SURGE" in smaller clean type. Fine condensation droplets, white seamless studio background, soft key light, crisp e-commerce hero shot. The ONLY text anywhere is exactly "EASYMODE" and "CITRUS SURGE", spelled letter-for-letter — no other words, no watermarks.`],
      ["brand-sport-white.jpg",
        `Professional studio product photograph of a premium electrolyte sports drink: a frosted clear bottle with a white sport cap, clean matte-white label with electric green accents. The wordmark "EASYMODE" in bold modern capitals and beneath it the flavor line "BERRY VOLT" in smaller type. Light condensation, white seamless studio background, bright airy light, crisp e-commerce hero shot. The ONLY text anywhere is exactly "EASYMODE" and "BERRY VOLT", spelled letter-for-letter — no other words, no watermarks.`],
      ["brand-coffee-can.jpg",
        `Professional studio product photograph of a premium canned cold brew coffee: a matte black 330ml slim can with a warm sunrise-gradient band across the middle. The wordmark "EASYMODE ROAST" in clean bold capitals and beneath it "DAYBREAK BLEND" in smaller elegant type. Soft dramatic side light, dark seamless studio background, crisp e-commerce hero shot. The ONLY text anywhere is exactly "EASYMODE ROAST" and "DAYBREAK BLEND", spelled letter-for-letter — no other words, no watermarks.`],
    ];
    const packUrls: Record<string, string> = {};
    for (const [name, prompt] of packs) {
      const url = await brandImage(prompt);
      packUrls[name] = url;
      await saveFrame(url, name);
      console.log(`[brand] ${name} ready`);
    }
    // Cut scenes: the sports drink is the hero. Same planner + keyframe chain
    // production uses, so what gets approved is what the pipeline will do.
    const heroUrl = packUrls["brand-sport-green.jpg"];
    const direction = process.env.QA_BRAND_DIRECTION ||
      "An athlete's pre-dawn city workout: the grind, hitting the wall, cracking open the EasyMode bottle, the second wind, a sunrise finish-line celebration. Electric, sweaty, real.";
    const plan = await planCommercial(
      "EasyMode Citrus Surge - electrolyte sports drink",
      "Electrolyte sports drink by EasyMode. Bold green bottle, citrus flavor.",
      direction
    );
    const frames: string[] = [];
    for (let i = 0; i < plan.beats.length; i++) {
      const u = await sceneKeyframe(heroUrl, plan.beats[i].scene, frames[i - 1]);
      frames.push(u);
      await saveFrame(u, `sport-scene${i + 1}.jpg`);
      console.log(`[brand] scene ${i + 1} ready`);
    }
    return [head, ``,
      `| beat | scene | narration |`, `|---|---|---|`,
      ...plan.beats.map((b, i) => `| ${i + 1} | ${b.scene.replace(/\|/g, "/")} | ${b.narration.replace(/\|/g, "/")} |`),
      ``,
      `tagline: **${plan.tagline}** — 3 pack shots + 5 cut scenes on the qa-frames branch · ${Math.round((Date.now() - t0) / 60_000)} min`,
      `No video was rendered — this is the approval gate.`].join("\n");
  } catch (e) {
    return `${head}\n\nFAILED — ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`;
  }
}

/* ---------- Mascot Lab: the Magic Monster, made EasyMode's ----------
 *
 * The mascot is the Magic Monster from the founder's other business
 * (qa-in/mascot/magic-monster.jpeg): a jacked golden-green ogre with
 * chunky glasses, small tusks and glowing rune tattoos. The lab strips
 * the badge (clipboard, wordmarks, ring) and re-poses him clean.
 * Three poses, stills only (~$0.60) — the approval gate.
 * QA_MASCOT=1 enables. */
async function mascotLab(): Promise<string> {
  if (!process.env.QA_MASCOT) return "";
  const head = "### Mascot Lab — the Magic Monster, cleaned for EasyMode";
  // QA_MASCOT=voice — clone the founder's Zeely voice for the monster:
  // extract the audio track from the committed recording, clone it on
  // MiniMax (same Replicate account the TTS runs on), publish the mp3 and
  // the returned voice id for the harness to hardcode.
  // QA_MASCOT=frame — pull ONE full-resolution frame out of the founder's
  // recording and crop the phone UI off it. This real photograph becomes the
  // presenter portrait's base: a synthesized portrait rendered plastic, and
  // no video-side tuning fixes a plastic source frame.
  if (process.env.QA_MASCOT === "frame") {
    try {
      const fs2 = require("node:fs") as typeof import("node:fs");
      const path2 = require("node:path") as typeof import("node:path");
      const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
      const ff = (require("ffmpeg-static") as string) || "ffmpeg";
      const src = path2.join(process.cwd(), "qa-in", "mascot", "zeely-voice.mov");
      const outDir = path2.join(process.cwd(), "qa-out", "frames");
      fs2.mkdirSync(outDir, { recursive: true });
      // Publish FULL uncropped candidates — the phone-UI crop is measured
      // off these, not guessed (a guessed crop decapitated him once).
      const shots: string[] = [];
      for (const t of ["3.0", "4.0", "5.0", "6.0"]) {
        const name = `zeely-full-${t.replace(".", "_")}.jpg`;
        execFileSync(ff, ["-y", "-ss", t, "-i", src, "-frames:v", "1", "-q:v", "2",
          path2.join(outDir, name)], { stdio: "ignore" });
        shots.push(name);
      }
      const probe = (() => {
        try { execFileSync(ff, ["-i", src], { stdio: ["ignore", "ignore", "pipe"] }); return ""; }
        catch (e) { return /, (\d{2,5}x\d{2,5})/.exec(String((e as { stderr?: Buffer }).stderr || ""))?.[1] || "?"; }
      })();
      return `${head}\n\nSource is ${probe}. Full frames published: ${shots.join(", ")}.`;
    } catch (e) {
      return `${head}\n\nFRAME EXTRACT FAILED — ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`;
    }
  }
  // QA_MASCOT=portrait — the presenter-portrait bake-off, stills only
  // (~$0.45, no video spend). The avatar engine animates whatever still it
  // is handed, so the portrait IS the quality ceiling: a plastic portrait
  // produced a plastic performance, twice. Three strategies, one verdict.
  if (process.env.QA_MASCOT === "portrait") {
    try {
      const { brandStill } = await import("../app/lib/commercial-ad-pipeline.server");
      const BASE = "https://raw.githubusercontent.com/MarginMonster/marginmonster-v2/3d9cc10aa1ea829e7ef0db285050f941485f8e98/qa-in/mascot/zeely-base2.jpg";
      const PHOTO = `It must read as an unretouched real photograph shot on an 85mm lens: visible skin pores and texture, natural specular highlights, subtle sensor grain, no beauty smoothing, no CGI or 3D-render look.`;
      const KEEPFACE = `Do NOT alter his face in any way — same wrinkles, same skin texture, same glasses, ears and expression, pixel for pixel.`;
      const cands: Array<[string, string, string | undefined]> = [
        // 1. Lightest possible edit: wardrobe only, everything else frozen.
        ["port-a-shirt-only.jpg",
          `Edit this photograph: dress him in a fitted dark-green crew-neck t-shirt with "EASYMODE" printed in bold white capitals centred across his chest, fully visible. ${KEEPFACE} Leave his pose, both hands, the box he holds, the background and the lighting exactly as they are. ${PHOTO} The ONLY text anywhere is exactly "EASYMODE".`,
          BASE],
        // 2. Full brand-safe edit — the blank box the last attempt botched.
        ["port-b-full.jpg",
          `Edit this photograph three ways. 1) Dress him in a fitted dark-green crew-neck t-shirt with "EASYMODE" in bold white capitals centred across his chest, fully visible. 2) Replace the box in his hands with a COMPLETELY BLANK solid matte-white closed box — no window, no transparent panel, no printing, no visible contents whatsoever — held exactly the same way. 3) Blur the background into a soft creamy out-of-focus warm retail interior with no legible packaging or lettering. ${KEEPFACE} ${PHOTO} The ONLY text anywhere is exactly "EASYMODE".`,
          BASE],
        // 3. Clean-room synthesis with hard photographic direction.
        ["port-c-synth.jpg",
          `Photorealistic half-body presenter photograph of a friendly muscular ogre shopkeeper: bald golden-green head, large pointed ears, chunky black rectangular glasses, warm confident grin, glowing golden rune tattoos on his forearms. He wears a fitted dark-green crew-neck t-shirt with "EASYMODE" in bold white capitals centred across the chest. Both hands are raised in a natural mid-gesture as if talking. Softly blurred warm shop interior behind him. ${PHOTO} The ONLY text anywhere is exactly "EASYMODE".`,
          undefined],
      ];
      const done = await Promise.all(cands.map(async ([name, prompt, ref]) => {
        const url = await brandStill(prompt, ref, true);
        await saveFrame(url, name);
        console.log(`[mascot] ${name} ready`);
        return name;
      }));
      return `${head}\n\nPortrait bake-off: ${done.join(", ")} on qa-frames. No video spend.`;
    } catch (e) {
      return `${head}\n\nPORTRAIT BAKE-OFF FAILED — ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`;
    }
  }
  if (process.env.QA_MASCOT === "voice") {
    try {
      const fs2 = require("node:fs") as typeof import("node:fs");
      const path2 = require("node:path") as typeof import("node:path");
      const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
      const ff = (require("ffmpeg-static") as string) || "ffmpeg";
      const { repCreate, repPoll } = await import("../app/lib/ugc-ad-pipeline.server");
      const src = path2.join(process.cwd(), "qa-in", "mascot", "zeely-voice.mov");
      const outDir = path2.join(process.cwd(), "qa-out", "frames");
      fs2.mkdirSync(outDir, { recursive: true });
      const mp3 = path2.join(outDir, "zeely-voice.mp3");
      execFileSync(ff, ["-y", "-i", src, "-vn", "-acodec", "libmp3lame", "-q:a", "2", "-t", "120", mp3], { stdio: "ignore" });
      // Energy study: pull frames so the reference performance can be READ
      // (expressions, gesture intensity, pacing) — the mascot's direction.
      try {
        execFileSync(ff, ["-y", "-i", src, "-vf", "fps=1/2,scale=540:-2", "-frames:v", "10", "-q:v", "4",
          path2.join(outDir, "zeely-e%d.jpg")], { stdio: "ignore" });
      } catch { /* frames are best-effort */ }
      // The recording is only ~8s and MiniMax needs 10+ ("voice duration
      // too short") — loop the audio 4x before cloning. At ~100KB the
      // looped file fits a data URI comfortably.
      const looped = path2.join(outDir, "zeely-looped.mp3");
      execFileSync(ff, ["-y", "-stream_loop", "3", "-i", mp3, "-acodec", "copy", looped], { stdio: "ignore" });
      // MiniMax validates the FILE EXTENSION — a data URI has none
      // ("invalid file ext for voice clone"), so the clone reads the looped
      // mp3 the previous run published at a real .mp3 URL.
      const id = await repCreate("minimax/voice-cloning", {
        voice_file: "https://raw.githubusercontent.com/MarginMonster/marginmonster-v2/qa-frames/frames/zeely-looped.mp3",
      });
      const out = await repPoll(id, 5 * 60_000, "voice-clone");
      const rendered = typeof out === "string" ? out : JSON.stringify(out);
      fs2.writeFileSync(path2.join(outDir, "zeely-voice-id.txt"), rendered);
      return `${head}\n\nVoice cloned → \`${rendered}\` (also on qa-frames as zeely-voice-id.txt)`;
    } catch (e) {
      return `${head}\n\nVOICE CLONE FAILED — ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`;
    }
  }
  try {
    const { brandStill } = await import("../app/lib/commercial-ad-pipeline.server");
    const t0 = Date.now();
    // SHA-pinned so the URL never breaks or drifts from the approved art.
    const MM = "https://raw.githubusercontent.com/MarginMonster/marginmonster-v2/072b31816ed84806e1c9e4608b983e635662c97d/qa-in/mascot/magic-monster.jpeg";
    const KEEP = `Keep the EXACT same character and painterly cartoon style: bald golden-green ogre, chunky black rectangular glasses, friendly smile with two small tusks, muscular torso covered in softly glowing golden rune tattoos.`;
    const STRIP = `Remove the clipboard, the badge circle and ALL text and lettering completely.`;
    // The hyper-real Zeely presenter (a TikTok screenshot — the prompts
    // strip the app chrome). SHA-pinned like the badge art.
    // UI-free crops — the raw Zeely shots are TikTok screenshots, and the
    // engine faithfully reproduced the app chrome no matter what the prompt
    // said. Cropping the references deterministically fixed it.
    const MMR = [
      "https://raw.githubusercontent.com/MarginMonster/marginmonster-v2/7f370a482573208be369a80cac7e40f9a268bd08/qa-in/mascot/mm-cut-casual.jpg",
      "https://raw.githubusercontent.com/MarginMonster/marginmonster-v2/7f370a482573208be369a80cac7e40f9a268bd08/qa-in/mascot/mm-cut-tux.jpg",
    ];
    const KEEPR = `Both reference images show the SAME photorealistic ogre character. Recreate him EXACTLY — same bald golden-green head, pointed ears, chunky black rectangular glasses, same friendly expressive face — as a clean professional UGC presenter photo, nothing else from the reference photos.`;
    const HALF = `Half-body presenter framing (waist up, facing camera, arms relaxed and visible), soft even studio light on a plain warm neutral backdrop, photorealistic, sharp focus. No text anywhere.`;
    // QA_MASCOT=ads renders the advocate set: Holo-style cartoon AD SCENES
    // (full body, floating UI, NO text — hooks are composited
    // deterministically afterwards) + hyper-real UGC avatar candidates in
    // the four cast outfits (public/avatars format). Anything else renders
    // the clean cartoon pose candidates.
    const adMode = process.env.QA_MASCOT === "ads";
    // QA_MASCOT=runes re-rolls ONLY the short-sleeve outfits with his
    // signature glowing golden rune tattoos on the bare arms (the cartoon
    // badge art rides along as the rune-pattern reference). The approved
    // tux + street renders live in qa-in/mascot/keep/ and are not touched.
    const runesMode = process.env.QA_MASCOT === "runes";
    const RUNES = `His bare muscular arms and forearms are covered in softly GLOWING golden rune tattoos — thin luminous magical symbols emitting a warm gold light, exactly like the markings on the cartoon character in the last reference image.`;
    const FULL = `Show his FULL BODY head to toe — complete legs and bare ogre feet drawn naturally in the same style, wearing simple dark shorts matching the reference's waist wrap.`;
    // QA_MASCOT=tint — the brand-green skin experiment, two strengths.
    const tintMode = process.env.QA_MASCOT === "tint";
    const cands: Array<[string, string, string | string[], boolean]> = tintMode
      ? [
        ["mascot-tint-emerald.jpg", `${KEEPR} His skin is now a rich emerald green (like #12A85E) all over. He wears a soft dark short-sleeved cotton tee. ${RUNES} ${HALF}`, [...MMR, MM], true],
        ["mascot-tint-olive.jpg", `${KEEPR} His skin has a subtly greener olive tone than the reference — a gentle shift toward emerald, still warm and golden. He wears a soft dark short-sleeved cotton tee. ${RUNES} ${HALF}`, [...MMR, MM], true],
      ]
      : runesMode
      ? [
        ["mascot-ugc-0.jpg", `${KEEPR} He wears a relaxed casual outfit: a soft dark short-sleeved cotton tee. ${RUNES} ${HALF}`, [...MMR, MM], true],
        ["mascot-ugc-2.jpg", `${KEEPR} He wears sporty athletic wear: a fitted dark-green short-sleeved training top. ${RUNES} ${HALF}`, [...MMR, MM], true],
      ]
      : adMode
      ? [
        ["mascot-ad-desk.jpg",
          `${STRIP} ${KEEP} ${FULL} Cinematic vertical brand-advocate scene: the ogre sits cross-legged like a friendly guide on top of a sleek desk with a glowing soft-green surface, his whole body visible, in a cozy dim home studio at night, warm bokeh background. Around him float translucent holographic UI cards: small product-ad thumbnails, a video tile with a play button, a colour palette strip — all abstract, all glowing softly green and gold. He gestures proudly at one floating card. Premium tech-ad look, soft rim light. NO text, NO letters, NO words anywhere in the image.`,
          MM, true],
        ["mascot-ad-phone.jpg",
          `${STRIP} ${KEEP} ${FULL} Cinematic vertical brand-advocate scene: the ogre stands full height leaning one elbow on a giant smartphone (as tall as he is) standing upright on a clean studio floor, deep green background with soft gold light streaks. The phone screen glows with an abstract grid of small colourful ad thumbnails — abstract shapes only. He gives a confident thumbs-up. Premium tech-ad look. NO text, NO letters, NO words anywhere in the image.`,
          MM, true],
        ["mascot-ugc-0.jpg", `${KEEPR} He wears a relaxed casual outfit: a soft dark cotton tee. ${HALF}`, MMR, true],
        ["mascot-ugc-1.jpg", `${KEEPR} He wears his smart tailored black tuxedo with a white shirt and black bow tie, exactly as in the reference. ${HALF}`, MMR, true],
        ["mascot-ugc-2.jpg", `${KEEPR} He wears sporty athletic wear: a fitted dark-green training top. ${HALF}`, MMR, true],
        ["mascot-ugc-3.jpg", `${KEEPR} He wears trendy streetwear: a dark hoodie under an open denim jacket. ${HALF}`, MMR, true],
      ]
      : [
        ["mascot-mm-clean.jpg",
          `${STRIP} ${KEEP} He stands waist-up in a confident double-bicep flex, both arms fully visible and naturally drawn. Isolated on a pure white background. No text anywhere.`,
          MM, false],
        ["mascot-mm-coin.jpg",
          `${STRIP} ${KEEP} He proudly holds up a large round gold coin embossed with the letter "E" in one hand, the other hand giving a thumbs-up. Isolated on a pure white background. The ONLY text anywhere is the letter "E" on the coin.`,
          MM, false],
        ["mascot-mm-point.jpg",
          `${STRIP} ${KEEP} He grins and points directly at the viewer with one hand, the other fist resting on his hip. Isolated on a pure white background. No text anywhere.`,
          MM, false],
      ];
    const done = await Promise.all(cands.map(async ([name, prompt, ref, portrait]) => {
      const url = await brandStill(prompt, ref, portrait);
      await saveFrame(url, name);
      console.log(`[mascot] ${name} ready`);
      return name;
    }));
    return [head, ``,
      `${done.length} poses on the qa-frames branch · ${Math.round((Date.now() - t0) / 60_000)} min`,
      `Stills only — the approval gate before the mascot touches anything.`].join("\n");
  } catch (e) {
    return `${head}\n\nFAILED — ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`;
  }
}

/* ---------- Commercial: the full in-house cinematic pipeline ----------
 *
 * Spends real money (~$1.50-2.50: 3 keyframes + 3 kling clips + TTS), so it
 * runs only when QA_COMMERCIAL is set. Exercises the same exported stages
 * production runs, minus the DB write, and publishes the beat keyframes AND
 * the finished mp4 so the result can actually be watched. */
/** Render a transparent overlay PNG (caption pill / watermark) with the
 *  system Chrome — brand type as graphics, since our ffmpeg lacks drawtext.
 *  Returns undefined when no Chrome exists (overlays just skip). */
function renderOverlayPng(html: string, w: number, h: number, out: string): string | undefined {
  const fs2 = require("node:fs") as typeof import("node:fs");
  const path2 = require("node:path") as typeof import("node:path");
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const chrome = [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"]
    .find((c) => c && fs2.existsSync(c));
  if (!chrome) return undefined;
  const font = path2.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
  const page = `<!doctype html><html><head><style>
    @font-face{font-family:P;src:url(file://${font});font-weight:800}
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:${w}px;height:${h}px;background:transparent;display:flex;align-items:center;justify-content:center;font-family:P,sans-serif}
  </style></head><body>${html}</body></html>`;
  const tmpHtml = out.replace(/\.png$/, ".html");
  fs2.writeFileSync(tmpHtml, page);
  execFileSync(chrome, ["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--default-background-color=00000000", `--window-size=${w},${h}`, `--screenshot=${out}`, `file://${tmpHtml}`],
  { stdio: "ignore" });
  return fs2.existsSync(out) ? out : undefined;
}

// Bare bold type, hard layered shadow, no box — the pill-slab look read as
// template. Feed-native caption style: white Poppins, tight, high contrast.
const captionPill = (text: string) =>
  `<div style="color:#fff;font-weight:800;font-size:33px;line-height:1.22;max-width:620px;text-align:center;letter-spacing:.005em;` +
  `text-shadow:0 2px 3px rgba(0,0,0,.9),0 0 18px rgba(0,0,0,.55),0 6px 22px rgba(0,0,0,.5)">${text}</div>`;

async function commercialCheck(): Promise<string> {
  if (!process.env.QA_COMMERCIAL) return "";
  // QA_COMMERCIAL="service" exercises the service-mode path: no product
  // photo, transformation-story beats, branded end-card finale.
  const svc = process.env.QA_COMMERCIAL === "service";
  const head = svc
    ? "### Commercial (in-house cinematic) — SERVICE MODE full render"
    : "### Commercial (in-house cinematic) — full render";
  const prod = svc ? null : await resolveProduct();
  if (!svc && !prod) return `${head}\n\nSKIPPED — need a product.`;
  const title = svc
    ? (process.env.QA_COMMERCIAL_TITLE || "EasyMode — studio-quality product ads in one tap")
    : prod!.title;
  const fs2 = require("node:fs") as typeof import("node:fs");
  const path2 = require("node:path") as typeof import("node:path");
  const os2 = require("node:os") as typeof import("node:os");
  try {
    const { planCommercial, sceneKeyframe, assembleCommercial, commercialEndCard, motionGate, renderMotionClip } = await import("../app/lib/commercial-ad-pipeline.server");
    const { repPoll, repCreate, download, downloadBuffer } = await import("../app/lib/ugc-ad-pipeline.server");
    const engine = process.env.QA_COMMERCIAL_ENGINE?.trim() || undefined;
    const t0 = Date.now();
    const plan = await planCommercial(title, undefined, process.env.QA_COMMERCIAL_DIRECTION || undefined, svc);
    console.log(`[commercial] plan: ${plan.beats.map((b) => b.scene.slice(0, 60)).join(" | ")} · tagline "${plan.tagline}"`);
    const keyframes: string[] = [];
    for (let i = 0; i < plan.beats.length; i++) {
      const url = await sceneKeyframe(svc ? undefined : prod!.url, plan.beats[i].scene, keyframes[i - 1]);
      keyframes.push(url);
      await saveFrame(url, `commercial-beat${i + 1}-keyframe.jpg`);
      console.log(`[commercial] beat ${i + 1} keyframe ready`);
    }
    // Storyboard gate: stills + script only, zero video spend — the human
    // kills weak beats BEFORE the motion dollars move.
    if (process.env.QA_COMMERCIAL_STORYBOARD) {
      return [head, ``, `**Storyboard stills only — no video rendered (approval gate).**`, ``,
        `| beat | scene | narration |`, `|---|---|---|`,
        ...plan.beats.map((b, i) => `| ${i + 1} | ${b.scene.replace(/\|/g, "/")} | ${b.narration.replace(/\|/g, "/")} |`),
        ``, `tagline: **${plan.tagline}** · ${Math.round((Date.now() - t0) / 60_000)} min`].join("\n");
    }
    // Beats are independent — render them all at once (wall time = slowest
    // clip, not the sum of five).
    const clips: string[] = await Promise.all(plan.beats.map((b, i) => (async () => {
      const opts = {
        startImage: keyframes[i],
        prompt: `${b.motion}. Cinematic live-action, natural physics${svc ? "" : ", the product keeps its exact printed artwork and lettering"}. No morphing, no text.`,
        negativePrompt: "warping, morphing text, extra limbs, cartoon, distortion",
      };
      let clip = await renderMotionClip(engine, opts, `qa-commercial-beat-${i + 1}`);
      const gate = await motionGate(clip, svc);
      if (!gate.ok) {
        console.log(`[commercial] beat ${i + 1} FAILED motion gate (${gate.why}) — re-rolling once`);
        clip = await renderMotionClip(engine, opts, `qa-commercial-beat-${i + 1}-reroll`);
      }
      console.log(`[commercial] beat ${i + 1} animated${gate.ok ? "" : " (re-rolled)"}`);
      return clip;
    })()));
    // Per-line VO, same as production: each line lands on its own beat.
    const voLines = [...plan.beats.map((b) => b.narration || plan.tagline), `${plan.tagline}.`];
    const voUrls: string[] = await Promise.all(voLines.map((text, i) => (async () => {
      const voId = await repCreate("minimax/speech-02-hd", {
        text,
        voice_id: "English_Trustworth_Man",
        emotion: "neutral",
        english_normalization: true,
        language_boost: "English",
      });
      return repPoll(voId, 3 * 60_000, `qa-commercial-vo-${i + 1}`);
    })()));
    const tmp = fs2.mkdtempSync(path2.join(os2.tmpdir(), "qa-comm-"));
    const clipPaths: string[] = [];
    for (let i = 0; i < clips.length; i++) { const p = path2.join(tmp, `c${i}.mp4`); await download(clips[i], p); clipPaths.push(p); }
    const voPaths: string[] = [];
    for (let i = 0; i < voUrls.length; i++) { const p = path2.join(tmp, `vo${i}.mp3`); fs2.writeFileSync(p, await downloadBuffer(voUrls[i])); voPaths.push(p); }
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const ff = (require("ffmpeg-static") as string) || "ffmpeg";
    // Our own service-mode spots close on the DESIGNED brand card (real
    // wordmark, real guilloché rosettes, spun by ffmpeg) when the assets
    // are in the repo; the generated card is the fallback.
    const brandBase = path2.join(process.cwd(), "public", "showcase", "endcard-base.png");
    const brandRose = path2.join(process.cwd(), "public", "showcase", "endcard-rosette.png");
    const useBrandCard = svc && fs2.existsSync(brandBase);
    let jpg: string | undefined;
    if (!useBrandCard) {
      const rawImg = path2.join(tmp, "prod.raw"); jpg = path2.join(tmp, "prod.jpg");
      const packshotUrl = svc ? await commercialEndCard(title, plan.tagline) : prod!.url;
      if (svc) await saveFrame(packshotUrl, "commercial-endcard.jpg");
      await download(packshotUrl, rawImg);
      execFileSync(ff, ["-y", "-i", rawImg, "-vf", "scale='min(2000,iw)':-2", "-q:v", "3", jpg], { stdio: "ignore" });
    }
    const outDir = path2.join(process.cwd(), "qa-out", "frames");
    fs2.mkdirSync(outDir, { recursive: true });
    // Publish the RAW paid clips too — re-edits become free re-assemblies.
    for (let i = 0; i < clipPaths.length; i++) {
      try { fs2.copyFileSync(clipPaths[i], path2.join(outDir, `clip${i + 1}.mp4`)); } catch { /* best-effort */ }
    }
    const outPath = path2.join(outDir, "commercial-final.mp4");
    // Sound-off layer: caption pill per narration line, a montage caption,
    // and a small wordmark — all Chrome-rendered brand type.
    const captionPaths = plan.beats.map((b, i) =>
      renderOverlayPng(captionPill(b.narration), 700, 150, path2.join(tmp, `cap${i}.png`)));
    const montageCaptionPath = renderOverlayPng(captionPill("Every one of these: made by EasyMode. One tap each."), 700, 150, path2.join(tmp, "capm.png"));
    const watermarkPath = renderOverlayPng(
      `<div style="color:#fff;font-weight:800;font-size:23px;opacity:.92;text-shadow:0 1px 2px rgba(0,0,0,.95),0 0 10px rgba(0,0,0,.6)">Easy<span style="color:#E7C879">Mode</span></div>`,
      170, 42, path2.join(tmp, "wm.png"));
    // Flex montage from committed real renders, spliced after beat 3 (the
    // typing moment) — chaos beats cut fast, payoff beats hold.
    const flexDir = path2.join(process.cwd(), "public", "showcase", "flex");
    const flex = fs2.existsSync(flexDir)
      ? fs2.readdirSync(flexDir).filter((f: string) => f.endsWith(".jpg")).sort().map((f: string) => path2.join(flexDir, f))
      : [];
    await assembleCommercial({
      clipPaths,
      clipSecs: [4, 4, 5, 5, 5].slice(0, clipPaths.length),
      narrationPaths: voPaths.slice(0, clipPaths.length),
      taglinePath: voPaths[clipPaths.length],
      productJpegPath: jpg,
      endCard: useBrandCard ? { basePath: brandBase, rosettePath: fs2.existsSync(brandRose) ? brandRose : undefined } : undefined,
      montage: flex.length ? { imagePaths: flex, afterClip: 2 } : undefined,
      captionPaths,
      montageCaptionPath,
      watermarkPath,
      watermarkFrom: 4,
      outPath,
    });
    // Pull one graded frame per beat from the finished cut for the report.
    // Timeline: beats 4+4+5, montage 4s, beats 5+5, finale 4s (≈31s total).
    for (const [name, t] of [["commercial-final-beat1.jpg", "2"], ["commercial-final-beat2.jpg", "6"], ["commercial-final-beat3.jpg", "10.5"], ["commercial-final-montage.jpg", "15"], ["commercial-final-beat4.jpg", "19.5"], ["commercial-final-beat5.jpg", "24.5"], ["commercial-final-packshot.jpg", "29"]] as const) {
      try { execFileSync(ff, ["-y", "-ss", t, "-i", outPath, "-frames:v", "1", "-q:v", "3", path2.join(outDir, name)], { stdio: "ignore" }); } catch { /* best-effort */ }
    }
    const mb = (fs2.statSync(outPath).size / 1e6).toFixed(1);
    return [head, ``, `| | |`, `|---|---|`, `| rendered | yes — commercial-final.mp4 (${mb}MB) on the qa-frames branch |`,
      `| beats | ${plan.beats.length} + ${svc ? "branded end-card" : "real-photo packshot"} |`, `| tagline | ${plan.tagline} |`,
      `| wall time | ${Math.round((Date.now() - t0) / 60_000)} min |`,
      `| narration | ${plan.beats.map((b) => b.narration).join(" / ")} |`].join("\n");
  } catch (e) {
    return `${head}\n\nFAILED — ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`;
  }
}

/* ---------- cutaway assembly: the deterministic b-roll graph ----------
 *
 * Free — no AI spend at all. The cutaway format's whole promise is that the
 * b-roll is deterministic ffmpeg, so it can be tested exactly, every run.
 * Inputs are synthesized by hand (a WAV written byte-by-byte, a talking clip
 * looped from the product photo) because the static build's lavfi sources are
 * precisely what failed us in the mask saga — real file inputs only. */
async function cutawayAssembleCheck(): Promise<string> {
  const head = "### Cutaway video assembly (deterministic Ken Burns b-roll)";
  const prod = await resolveProduct();
  if (!prod) return `${head}\n\nSKIPPED — need a product image (QA_PRODUCT_URL or QA_STORE_URL). Nothing was tested.`;
  const fs2 = require("node:fs") as typeof import("node:fs");
  const path2 = require("node:path") as typeof import("node:path");
  const os2 = require("node:os") as typeof import("node:os");
  const tmp = fs2.mkdtempSync(path2.join(os2.tmpdir(), "vqa-cut-"));
  try {
    const { assemble, runFfmpeg, ffprobeDuration } = await import("../app/lib/ugc-ad-pipeline.server");

    const rawImg = path2.join(tmp, "product.img");
    const res = await fetch(prod.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return `${head}\n\nSKIPPED — product image fetch failed (${res.status}). Nothing was tested.`;
    fs2.writeFileSync(rawImg, Buffer.from(await res.arrayBuffer()));
    // Re-encode whatever the CDN sent into a plain JPEG before anything else
    // touches it: Shopify serves WebP bytes from .jpg URLs, and image2's
    // -loop option refuses webp_pipe input ("Option loop not found") — this
    // exact check died on it last run.
    const imgPath = path2.join(tmp, "product.jpg");
    const norm = await runFfmpeg(["-y", "-i", rawImg, "-frames:v", "1", imgPath]);
    if (norm.status !== 0) return `${head}\n\nFAILED re-encoding the product image:\n\n\`\`\`\n${norm.stderr.slice(-600)}\n\`\`\``;

    // 12 seconds of narration-shaped audio, hand-built PCM. 12s → the two-beat
    // plan: push-in mid-ad, pull-back on the close.
    const secs = 12, rate = 16000, n = secs * rate;
    const wav = Buffer.alloc(44 + n * 2);
    wav.write("RIFF", 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write("data", 36); wav.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 220 * i) / rate)), 44 + i * 2);
    const audioPath = path2.join(tmp, "voice.wav");
    fs2.writeFileSync(audioPath, wav);

    // "Talking" clip: the product photo looped. Silent on purpose — that is
    // the kling-fallback shape, and the b-roll graph under test is identical
    // in both lipSynced modes.
    const talkingPath = path2.join(tmp, "talking.mp4");
    // Scale to the canvas BEFORE x264: catalogue originals routinely have odd
    // dimensions, and yuv420p rejects those with a bare "-22 Invalid argument"
    // (which is exactly how this check failed on its first CI run).
    const mk = await runFfmpeg(["-y", "-loop", "1", "-framerate", "30", "-t", String(secs), "-i", imgPath,
      "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280",
      "-threads", "2", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", talkingPath]);
    if (mk.status !== 0) return `${head}\n\nFAILED building the synthetic talking clip:\n\n\`\`\`\n${mk.stderr.slice(-900)}\n\`\`\``;

    // zoompan probed ALONE, so assemble's static-fallback rung can't quietly
    // pass this check on a build where the motion never rendered.
    const zpProbe = await runFfmpeg(["-y", "-i", imgPath, "-vf",
      "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,zoompan=z='1+0.12*on/53':d=54:s=720x1280:fps=30",
      "-frames:v", "54", "-threads", "2", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", path2.join(tmp, "zp.mp4")]);

    const outPath = path2.join(tmp, "out.mp4");
    await assemble({
      talkingPath, audioPath, productImagePath: imgPath, outPath,
      script: "Watch the product get its own moving shots while the voice keeps going.",
      lipSynced: false, cutaway: true,
    });
    const dur = ffprobeDuration(outPath);

    // Publish frames: base clip, early + late inside beat 1 (same product at
    // visibly different zoom = the motion is real), and beat 2. 12s beats land
    // at 4.56–6.36 and 10.10–11.90.
    const framesDir = path2.join(process.env.QA_OUT || "qa-out", "frames");
    fs2.mkdirSync(framesDir, { recursive: true });
    const grabs: [number, string][] = [[1.0, "aroll"], [4.8, "cut1-early"], [6.1, "cut1-late"], [10.9, "cut2"]];
    const names: string[] = [];
    for (const [t, tag] of grabs) {
      const name = `cutaway-${tag}.jpg`;
      const g = await runFfmpeg(["-y", "-ss", t.toFixed(1), "-i", outPath, "-frames:v", "1", path2.join(framesDir, name)]);
      if (g.status === 0) names.push(name);
    }

    return [head, "",
      "Free and deterministic — synthetic 12s narration + a looped product clip, assembled with `cutaway: true`.",
      "", "| | |", "|---|---|",
      `| assembled | ${fs2.existsSync(outPath) ? "yes" : "**NO**"} |`,
      `| duration | ${dur.toFixed(1)}s (want ~12) |`,
      `| zoompan standalone | ${zpProbe.status === 0 ? "works" : "**FAILED** — assemble shipped the STATIC fallback, not the motion"} |`,
      `| frames | ${names.map((x) => `\`${x}\``).join(" · ") || "**none extracted**"} |`,
      "",
      "`cutaway-cut1-early` vs `cutaway-cut1-late` should show the SAME product at visibly different zoom — that is the Ken Burns push-in. `cutaway-aroll` is the base clip between beats.",
      zpProbe.status !== 0 ? `\n\`\`\`\n${zpProbe.stderr.slice(-900)}\n\`\`\`` : "",
    ].filter(Boolean).join("\n");
  } catch (e) {
    return `${head}\n\nFAILED: ${e instanceof Error ? e.message.slice(0, 400) : e}`;
  } finally {
    try { fs2.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

function productSlug(title: string): string {
  return (title || "product").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "product";
}

/* Many products, one run. The single-product sweep kept answering "does this
 * work" for one SKU; a merchant's catalogue is not one SKU. Pull N distinct
 * products and pair each with a different presenter, so a sweep shows the
 * pipeline across the range — and exercises both layouts, since sizes differ. */
async function resolveProducts(count: number): Promise<{ url: string; title: string }[]> {
  const listed = explicitProducts();
  if (listed.length) {
    console.log(`[vqa] explicit product list → ${listed.length} products`);
    return listed.slice(0, count > 1 ? count : listed.length);
  }
  if (count <= 1 || !process.env.QA_STORE_URL) {
    const one = await resolveProduct();
    return one ? [one] : [];
  }
  const { discoverCatalog } = await import("../app/lib/catalog-import.server");
  const { products } = await discoverCatalog(process.env.QA_STORE_URL, 250);
  const seen = new Set<string>();
  const out: { url: string; title: string }[] = [];
  for (const p of products) {
    if (!p.imageUrl) continue;
    const key = p.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: p.imageUrl, title: p.title });
    if (out.length >= count) break;
  }
  console.log(`[vqa] catalogue → ${out.length} distinct products with images`);
  return out;
}

async function presenterHoldOnce(): Promise<string> {
  const missing = ["FAL_KEY", "REPLICATE_API_TOKEN", "ANTHROPIC_API_KEY"].filter((k) => !process.env[k]?.trim());
  if (missing.length) return `### Presenter image ads\n\nSKIPPED — ${missing.join(", ")} not set. Nothing was tested.`;

  const portraits = (process.env.QA_PORTRAITS || process.env.QA_PORTRAIT_URL || "").split(",").map((x) => x.trim()).filter(Boolean);
  const count = Number(process.env.QA_PRODUCT_COUNT || 1);
  const prods = await resolveProducts(count);
  if (!prods.length || !portraits.length) return `### Presenter image ads\n\nSKIPPED — need a product (QA_PRODUCT_URL or QA_STORE_URL) and QA_PORTRAITS. Nothing was tested.`;

  // Multi-product: one presenter per product, cycling. Single-product: one
  // row per presenter, as before.
  const pairs = count > 1
    ? prods.map((p, i) => ({ prod: p, portrait: portraits[i % portraits.length], tag: `${process.env.QA_TAG_PREFIX || ""}p${String(i + 1).padStart(2, "0")}-${productSlug(p.title)}` }))
    : portraits.map((portrait) => ({ prod: prods[0], portrait, tag: (portrait.split("/").pop() || "presenter").replace(/\.jpe?g$/i, "") }));

  const rows: string[] = [];
  let shipped = 0;
  let delivered = 0;
  // Counted and reported separately. A frame nobody graded is not a frame
  // that failed, and it is certainly not a frame that passed.
  let ungraded = 0;
  for (const pair of pairs) {
    const res = await gradeOne(pair.portrait, pair.prod, pair.tag, count > 1);
    rows.push(res.row);
    shipped += res.shipped;
    ungraded += res.ungraded;
    delivered += res.delivered;
  }
  return [
    `### Presenter image ads — does the merchant's artwork survive?`, ``,
    `${delivered}/${pairs.length} delivered as presenter ads · ${shipped}/${pairs.length - ungraded} graded frames passed an independent judge${ungraded ? ` · **${ungraded} could not be graded at all**` : ""}. The gate column is what production decided; the judge column is a second opinion on the same frame.`, ``,
    `| ${count > 1 ? "product (presenter)" : "presenter"} | product | stand-in attempt | merchant gets | production gate | independent judge | frame |`, `|---|---|---|---|---|---|---|`, ...rows,
  ].join("\n");
}

async function gradeOne(
  portrait: string,
  prod: { url: string; title: string },
  tag: string,
  multi: boolean
): Promise<{ row: string; shipped: number; ungraded: number; delivered: number }> {
  const label = multi ? `${prod.title.slice(0, 40)} (${(portrait.split("/").pop() || "").replace(/\.jpe?g$/i, "")})` : (portrait.split("/").pop() || "presenter");
  const productUrl = prod.url;
  const productTitle = prod.title;
  let shipped = 0;
  let ungraded = 0;
  let delivered = 0;
  try {
    if (multi) await saveFrame(productUrl, `source-${tag}.jpg`);
    // Same size inference production uses, so the harness exercises the
    // same layout choice a merchant would get rather than always the hold.
    const { inferProductScale } = await import("../app/lib/product-scale.server");
    const scale = await inferProductScale(productTitle);
    const r = await runPresenterHold({
      portraitUrl: portrait, productImageUrl: productUrl, productTitle,
      scalePhrase: scale?.phrase, sizeClass: scale?.sizeClass, cm: scale?.cm,
    });
    // Grade INDEPENDENTLY of the gate. The production gate saying "clean" is
    // exactly the claim under test — a second opinion is the only way to
    // catch a gate that is too lenient, which is how this defect shipped.
    // Judge the BYTES when we have them: a composited frame lives on the
    // render disk with no public address in CI.
    let judgeRef = r.url;
    if (r.localPath && require("node:fs").existsSync(r.localPath)) {
      judgeRef = `data:image/jpeg;base64,${require("node:fs").readFileSync(r.localPath).toString("base64")}`;
    }
    // The product reference goes up as BYTES too: passed as a URL, the API's
    // own fetcher receives AVIF from Shopify for some products (the gate's
    // ?width=1568 rendition dodges it; the raw original doesn't) and the
    // verdict dies on a format 400. Inlined bytes go through the client's
    // sniff-and-reencode instead.
    let productRef = productUrl;
    try {
      // The vision-sized rendition, not the raw original — originals can
      // exceed the API's 8000px limit as well as its format support.
      const { visionSafeUrl } = await import("../app/lib/anthropic.server");
      const pres = await fetch(visionSafeUrl(productUrl), { signal: AbortSignal.timeout(60_000) });
      if (pres.ok) productRef = `data:image/jpeg;base64,${Buffer.from(await pres.arrayBuffer()).toString("base64")}`;
    } catch { /* URL fallback — no worse than before */ }
    let verdict = "not graded";
    if (judgeRef) {
      try {
      const raw = await anthropicVision(
        [
          `Image 1 is the merchant's real product photo. Image 2 is an ad of a presenter with it.`,
          `artworkMatches: compare the PRINTED ARTWORK panel by panel — characters, their colours, their positions, logo placement, box background colour. Same shape with different art is a FAILURE. Be strict.`,
          `textFaithful: READ every word printed on the packaging and compare it letter by letter with image 1. A brand name rendered as "POP MILLMART" instead of "POP MART", a doubled letter, a dropped letter, or any invented word is a FAILURE. Spell out what you actually read if it differs.`,
          `sameObject: is it the SAME PHYSICAL THING, built the same way — same 3D form, same depth, same faces and panels? A deep display case or tray rendered as a flat printed card or poster is a FAILURE even when the artwork on it looks right.`,
          `notSimplified: does image 2 show the same NUMBER of units, boxes or panels as image 1? A twelve-box display case rendered as a single box is a FAILURE.`,
          `singleProduct: does image 2 contain exactly ONE of the product? Two overlapping or stacked copies of the same item in one frame is a FAILURE even if one of them looks correct.`,
          `correctScale: believable real-world size against the person?`,
          `handsOk: if no hand is visible, answer true. Otherwise: four fingers and one thumb per hand, at most two hands, no extra limb.`,
          `handsHuman: if no hand is visible, answer true. Otherwise, ignoring the count: are the fingers LIVING HUMAN fingers — skin matching the wrists, natural taper, real nails? Wooden, plastic, doll-like or mannequin fingers are a FAILURE.`,
          `faceVisible: are the presenter's eyes, nose AND mouth all unobstructed? A product held up over the mouth or chin is a FAILURE.`,
          `notes: one short sentence on the worst problem, or "clean".`,
          `Reply ONLY JSON: {"artworkMatches":bool,"sameObject":bool,"textFaithful":bool,"notSimplified":bool,"singleProduct":bool,"correctScale":bool,"handsOk":bool,"handsHuman":bool,"faceVisible":bool,"notes":"..."}`,
        ].join("\n"),
        [productRef, judgeRef],
        { maxTokens: 1200, model: "claude-sonnet-5" }
      );
      const m = raw && raw.match(/\{[\s\S]*\}/);
      const j = m ? JSON.parse(m[0]) as Record<string, unknown> : null;
      if (!j) {
        // Say so, publish the frame anyway, and count it apart from the
        // pass/fail tally — the frame still needs looking at by a human.
        console.log(`[vqa] ${tag}: judge returned no readable verdict — ${String(raw).slice(0, 140)}`);
        ungraded = 1;
      }
      const yes = (k: string) => !!j && j[k] !== false && j[k] !== undefined;
      const ok = !!j && ["artworkMatches", "sameObject", "textFaithful", "notSimplified", "singleProduct", "correctScale", "handsOk", "handsHuman", "faceVisible"].every(yes);
      if (ok) shipped = 1;
      verdict = !j ? "**NO VERDICT — judge unreadable**" : [
        yes("artworkMatches") ? "art ok" : "**ART WRONG**",
        yes("sameObject") ? "same object" : "**DIFFERENT OBJECT**",
        yes("textFaithful") ? "text ok" : "**TEXT WRONG**",
        yes("notSimplified") ? "count ok" : "**simplified**",
        yes("singleProduct") ? "one product" : "**DOUBLED**",
        yes("correctScale") ? "scale ok" : "**scale off**",
        yes("handsOk") ? "digits ok" : "**digit count bad**",
        yes("handsHuman") ? "hands human" : "**HANDS INHUMAN**",
        yes("faceVisible") ? "face clear" : "**FACE BLOCKED**",
      ].join(" · ");
      if (j) console.log(`[vqa] ${tag}: gate=${r.pass ? "pass" : "FELL"} judge=${ok ? "ok" : "BAD"} ${String(j.notes || "")}`);
      } catch (je) {
        // A judge failure is not a row failure: the frame, gate verdict and
        // candidate trace are all still real results. Log the FULL error —
        // two sweeps of truncated "Anthropic API 400: ...mess" told us
        // nothing about which images the API refuses or why.
        ungraded = 1;
        const msg = je instanceof Error ? je.message : String(je);
        console.log(`[vqa] ${tag}: judge errored — ${msg}`);
        verdict = `**judge errored** — ${msg.slice(0, 160)}`;
      }
    }
    // Publish what was actually JUDGED. Saving r.url after a paste would
    // ship the pre-composite frame and quietly disagree with the verdict.
    const fs2 = require("node:fs");
    const path2 = require("node:path");
    const dir = path2.join(process.env.QA_OUT || "qa-out", "frames");
    fs2.mkdirSync(dir, { recursive: true });
    if (r.localPath && fs2.existsSync(r.localPath)) {
      fs2.copyFileSync(r.localPath, path2.join(dir, `presenter-${tag}.jpg`));
    } else if (r.url) {
      await saveFrame(r.url, `presenter-${tag}.jpg`);
    }
    if (r.standInUrl) await saveFrame(r.standInUrl, `standin-${tag}.jpg`);
    if (r.prePastePath && r.prePastePath !== r.attemptPath && fs2.existsSync(r.prePastePath)) {
      fs2.copyFileSync(r.prePastePath, path2.join(dir, `preblend-${tag}.jpg`));
    }
    if (r.maskPath && fs2.existsSync(r.maskPath)) {
      fs2.copyFileSync(r.maskPath, path2.join(dir, `mask-${tag}.png`));
    }
    if (r.attemptPath && r.attemptPath !== r.localPath && fs2.existsSync(r.attemptPath)) {
      fs2.copyFileSync(r.attemptPath, path2.join(dir, `composite-${tag}.jpg`));
    }
    // What production would actually DO with this frame: a wrong-product hold
    // is dropped for a product still rather than shipped with a lookalike.
    // Delivered means a frame actually shipped: gate pass AND a URL. The old
    // check only asked "not the wrong product", so a compose that returned
    // NOTHING was counted (and labeled) as a delivered presenter ad — twice.
    if (r.pass && r.url) delivered = 1;
    const deliveredCell = r.pass && r.url ? "presenter ad" : "**dropped → product still**";
    const attempts = (r.standIn || "").split(" · ").filter((x) => /^(showcase|stand-in|hold\+paste)/.test(x));
    const won = attempts.filter((x) => /passed/.test(x)).length;
    const row = `| ${label} | ${{ "blank-standin": "**real photo pasted**", "paste-repair": "**real photo pasted (repair)**", drawn: "drawn" }[r.via]} | ${r.standIn || "—"} | ${deliveredCell} | ${r.pass ? "pass" : "**rejected**"}${r.retried ? " (retried)" : ""}${attempts.length ? ` · ${won}/${attempts.length} candidates ok` : ""} | ${verdict} | ${r.url ? `[frame](${r.url})` : "—"} |`;
    return { row, shipped, ungraded, delivered };
  } catch (e) {
    return { row: `| ${label} | ERROR | — | — | ${(e instanceof Error ? e.message : String(e)).slice(0, 80)} | | |`, shipped: 0, ungraded: 1, delivered: 0 };
  }
}

/* ---------- keyframe: does the merchant's product survive the restyle? ----------
 *
 * The bug: a presenter held a box that only RESEMBLED the merchant's product,
 * because the stylize step redrew the whole photo, packaging included. This
 * composes a presenter holding the real product (fal), stylizes it with the
 * production prompt (stylizeKeyframeForTest), and asks a vision model whether
 * the product survived.
 *
 * Needs FAL_KEY and REPLICATE_API_TOKEN. Skipped, loudly, without them —
 * a check that silently does nothing is worse than no check.
 */
async function keyframeCheck(): Promise<string> {
  if (!process.env.KEYFRAME) return "";
  const missing = ["FAL_KEY", "REPLICATE_API_TOKEN"].filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    return `### Keyframe check\n\nSKIPPED — ${missing.join(" and ")} not set, so product fidelity in the stylised frame was NOT tested.`;
  }
  const { composeHoldingFrames } = await import("../app/lib/fal-image.server");
  const portrait = process.env.QA_PORTRAIT_URL || (process.env.QA_PORTRAITS || "").split(",")[0]?.trim();
  const prod = await resolveProduct();
  if (!portrait || !prod) {
    return `### Keyframe check\n\nSKIPPED — need a presenter photo and a product (QA_PRODUCT_URL or QA_STORE_URL). Nothing was tested.`;
  }
  const productUrl = prod.url;
  const productTitle = prod.title;
  const styles = (process.env.KEYFRAME_STYLES || "clay").split(",").map((x) => x.trim()) as CartoonStyleKey[];
  const rows: string[] = [];
  for (const style of styles) {
    try {
      const frames = await composeHoldingFrames(portrait, productUrl, productTitle, 1, "hold");
      const composed = frames[0];
      if (!composed) { rows.push(`| ${style} | compose returned nothing |`); continue; }
      const styled = await stylizeKeyframeForTest({ sourcePhotoUrl: composed, productTitle, styleKey: style });
      const raw = await anthropicVision(
        [
          `Image 1 is the merchant's real product photo. Image 2 is a stylized cartoon ad frame built from it.`,
          `The PERSON and BACKGROUND are supposed to be stylized. The PRODUCT is not.`,
          `productSurvived: compare the PRINTED ARTWORK panel by panel — the characters or images on the packaging, their colours, their positions, the logo placement, the box's background colour. Same SHAPE with different character art, different colours or a different layout is a FAILURE: it is not the merchant's product. Be strict; "close enough" is a fail.`,
          `anatomyOk: four fingers and one thumb per visible hand, no extra or disembodied limb.`,
          `notes: one short sentence on the worst problem, or "clean".`,
          `Reply ONLY JSON: {"productSurvived":bool,"anatomyOk":bool,"notes":"..."}`,
        ].join("\n"),
        [productUrl, styled]
      );
      const m = raw && raw.match(/\{[\s\S]*\}/);
      const j = m ? JSON.parse(m[0]) as { productSurvived?: boolean; anatomyOk?: boolean; notes?: string } : null;
      await saveFrame(styled, `keyframe-${style}.jpg`);
      rows.push(`| ${CARTOON_RECIPES[style].name} | ${j?.productSurvived ? "yes" : "**NO**"} | ${j?.anatomyOk ? "ok" : "**bad**"} | ${(j?.notes || "").slice(0, 80)} | [frame](${styled}) |`);
      console.log(`[vqa] keyframe ${style}: product=${j?.productSurvived} anatomy=${j?.anatomyOk} ${j?.notes || ""}`);
    } catch (e) {
      rows.push(`| ${style} | ERROR | | ${(e instanceof Error ? e.message : String(e)).slice(0, 80)} | |`);
    }
  }
  return [`### Keyframe check — does the product survive the restyle?`, ``,
    `| style | product survived | hands | notes | frame |`, `|---|---|---|---|---|`, ...rows].join("\n");
}

main().catch((e) => { console.error("[vqa] fatal:", e); process.exit(1); });
