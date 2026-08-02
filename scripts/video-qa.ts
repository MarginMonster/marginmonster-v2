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
  console.log(`[vqa] ${styles.length} styles × ${PRODUCTS.length} products × ${REPEATS} = ${styles.length * PRODUCTS.length * REPEATS} scripts\n`);

  let leaked = 0, total = 0, tooLong = 0, errored = 0;
  const bad: string[] = [];
  const errs: string[] = [];

  for (const style of styles) {
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

  const all = [md, kf, ph].filter(Boolean).join("\n\n");
  if (process.env.GITHUB_STEP_SUMMARY) require("node:fs").appendFileSync(process.env.GITHUB_STEP_SUMMARY, all + "\n");
  console.log(`\n${all}\n`);
  if (leaked > 0) process.exit(1);
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
async function presenterHoldCheck(): Promise<string> {
  if (!process.env.PRESENTER) return "";
  const missing = ["FAL_KEY", "REPLICATE_API_TOKEN", "ANTHROPIC_API_KEY"].filter((k) => !process.env[k]?.trim());
  if (missing.length) return `### Presenter image ads\n\nSKIPPED — ${missing.join(", ")} not set. Nothing was tested.`;

  const productUrl = process.env.QA_PRODUCT_URL || "";
  const productTitle = process.env.QA_PRODUCT_TITLE || "";
  const portraits = (process.env.QA_PORTRAITS || process.env.QA_PORTRAIT_URL || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!productUrl || !portraits.length) return `### Presenter image ads\n\nSKIPPED — need QA_PRODUCT_URL and QA_PORTRAITS. Nothing was tested.`;

  const rows: string[] = [];
  let shipped = 0;
  for (const portrait of portraits) {
    try {
      const r = await runPresenterHold({ portraitUrl: portrait, productImageUrl: productUrl, productTitle });
      // Grade INDEPENDENTLY of the gate. The production gate saying "clean" is
      // exactly the claim under test — a second opinion is the only way to
      // catch a gate that is too lenient, which is how this defect shipped.
      let verdict = "not graded";
      if (r.url) {
        const raw = await anthropicVision(
          [
            `Image 1 is the merchant's real product photo. Image 2 is an ad of a presenter holding it.`,
            `artworkMatches: compare the PRINTED ARTWORK panel by panel — characters, their colours, their positions, logo placement, box background colour. Same shape with different art is a FAILURE. Be strict.`,
            `correctScale: believable real-world size against the person?`,
            `handsOk: four fingers and one thumb per hand, exactly two hands, no extra limb.`,
            `notes: one short sentence on the worst problem, or "clean".`,
            `Reply ONLY JSON: {"artworkMatches":bool,"correctScale":bool,"handsOk":bool,"notes":"..."}`,
          ].join("\n"),
          [productUrl, r.url]
        );
        const m = raw && raw.match(/\{[\s\S]*\}/);
        const j = m ? JSON.parse(m[0]) as { artworkMatches?: boolean; correctScale?: boolean; handsOk?: boolean; notes?: string } : null;
        const ok = !!j?.artworkMatches && !!j?.correctScale && !!j?.handsOk;
        if (ok) shipped++;
        verdict = `${j?.artworkMatches ? "art ok" : "**ART WRONG**"} · ${j?.correctScale ? "scale ok" : "**scale off**"} · ${j?.handsOk ? "hands ok" : "**hands bad**"}`;
        console.log(`[vqa] presenter ${portrait.split("/").pop()}: gate=${r.pass ? "pass" : "FELL"} judge=${ok ? "ok" : "BAD"} ${j?.notes || ""}`);
      }
      rows.push(`| ${portrait.split("/").pop()} | ${r.pass ? "pass" : "**rejected**"}${r.retried ? " (retried)" : ""} | ${verdict} | ${r.url ? `[frame](${r.url})` : "—"} |`);
    } catch (e) {
      rows.push(`| ${portrait.split("/").pop()} | ERROR | ${(e instanceof Error ? e.message : String(e)).slice(0, 80)} | |`);
    }
  }
  return [
    `### Presenter image ads — does the merchant's artwork survive?`, ``,
    `${shipped}/${portraits.length} passed an independent judge. The gate column is what production decided; the judge column is a second opinion on the same frame.`, ``,
    `| presenter | production gate | independent judge | frame |`, `|---|---|---|---|`, ...rows,
  ].join("\n");
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
  const portrait = process.env.QA_PORTRAIT_URL;
  let productUrl = process.env.QA_PRODUCT_URL || "";
  let productTitle = process.env.QA_PRODUCT_TITLE || "";
  // Rather than hand-copying a CDN URL that will rot, find the product in the
  // merchant's own catalogue — the same discovery the Studio uses.
  if (!productUrl && process.env.QA_STORE_URL) {
    const { discoverCatalog } = await import("../app/lib/catalog-import.server");
    const { products } = await discoverCatalog(process.env.QA_STORE_URL, 250);
    const want = productTitle.toLowerCase();
    const hit = (want ? products.find((x) => x.title.toLowerCase().includes(want)) : null)
      || products.find((x) => !!x.imageUrl);
    if (hit?.imageUrl) { productUrl = hit.imageUrl; productTitle = hit.title; }
    console.log(`[vqa] catalogue lookup → ${productTitle || "(nothing)"}`);
  }
  if (!portrait || !productUrl) {
    return `### Keyframe check\n\nSKIPPED — need QA_PORTRAIT_URL plus either QA_PRODUCT_URL or QA_STORE_URL. Nothing was tested.`;
  }
  if (!productTitle) productTitle = "the product";
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
