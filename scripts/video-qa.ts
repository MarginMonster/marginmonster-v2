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
  const renderOnly = !!(process.env.QA_COMMERCIAL || process.env.QA_BRAND_LAB);
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
  const cm = await commercialCheck();
  const ca = await cutawayAssembleCheck();

  const all = [md, kf, ph, bl, cm, ca].filter(Boolean).join("\n\n");
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

/* ---------- Commercial: the full in-house cinematic pipeline ----------
 *
 * Spends real money (~$1.50-2.50: 3 keyframes + 3 kling clips + TTS), so it
 * runs only when QA_COMMERCIAL is set. Exercises the same exported stages
 * production runs, minus the DB write, and publishes the beat keyframes AND
 * the finished mp4 so the result can actually be watched. */
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
    const rawImg = path2.join(tmp, "prod.raw"); const jpg = path2.join(tmp, "prod.jpg");
    const packshotUrl = svc ? await commercialEndCard(title, plan.tagline) : prod!.url;
    if (svc) await saveFrame(packshotUrl, "commercial-endcard.jpg");
    await download(packshotUrl, rawImg);
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const ff = (require("ffmpeg-static") as string) || "ffmpeg";
    execFileSync(ff, ["-y", "-i", rawImg, "-vf", "scale='min(2000,iw)':-2", "-q:v", "3", jpg], { stdio: "ignore" });
    const outDir = path2.join(process.cwd(), "qa-out", "frames");
    fs2.mkdirSync(outDir, { recursive: true });
    const outPath = path2.join(outDir, "commercial-final.mp4");
    await assembleCommercial({
      clipPaths,
      narrationPaths: voPaths.slice(0, clipPaths.length),
      taglinePath: voPaths[clipPaths.length],
      productJpegPath: jpg,
      outPath,
    });
    // Pull one graded frame per beat from the finished cut for the report.
    // 5 beats × 5s + 4s packshot: mid-beat samples land at 2.5+5i, packshot ~27.
    for (const [name, t] of [["commercial-final-beat1.jpg", "2.5"], ["commercial-final-beat2.jpg", "7.5"], ["commercial-final-beat3.jpg", "12.5"], ["commercial-final-beat4.jpg", "17.5"], ["commercial-final-beat5.jpg", "22.5"], ["commercial-final-packshot.jpg", "27"]] as const) {
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
