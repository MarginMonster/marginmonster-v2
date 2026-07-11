import { db } from "../db.server";
import { COMPANION_BY_ID, companionSrcs } from "./companions";
import { PARTNER_BY_PLAN, type PlanKey } from "../components/Partner";

/* Companion resolution + the free custom forge. The companion is decoupled
 * from the plan (plans are Expedition Packages now); merchants pick from the
 * 48-strong gallery or forge their own. Custom art is stored as base64 in the
 * DB (Render disk is ephemeral) and served via /companion-art/:shopId/:frame. */

export type ResolvedCompanion = {
  name: string;
  accent: string;
  img: string; // stagger key for the flipbook offsets
  srcs?: { a: string; b?: string; c?: string };
};

export function getCompanion(shop: {
  id: string;
  companionId: string | null;
  companionName: string | null;
  companionArt?: string | null;
  planType?: string | null;
}): ResolvedCompanion {
  if (shop.companionId === "custom" && shop.companionArt) {
    return {
      name: (shop.companionName || "PARTNER").toUpperCase(),
      accent: "#34E7E4",
      img: "custom",
      srcs: {
        a: `/companion-art/${shop.id}/a`,
        b: `/companion-art/${shop.id}/b`,
        c: `/companion-art/${shop.id}/c`,
      },
    };
  }
  const def = shop.companionId ? COMPANION_BY_ID[shop.companionId] : null;
  if (def) {
    return {
      name: (shop.companionName || def.name).toUpperCase(),
      accent: def.accent,
      img: def.id,
      srcs: companionSrcs(def.id),
    };
  }
  // No pick yet — fall back to the OG plan partner (migration-safe default).
  const pd = PARTNER_BY_PLAN[(shop.planType || "STARTER") as PlanKey] || PARTNER_BY_PLAN.STARTER;
  return { name: pd.name, accent: pd.accent, img: pd.img };
}

/* ---- the forge: text -> chibi companion with all three flipbook frames ---- */

const STYLE =
  "adorable chibi pixel art companion sprite, 16-bit retro video game character, 90s creature-collector vibe, " +
  "full body standing facing the viewer, big expressive eyes, thick dark outline, vibrant saturated colors, " +
  "centered composition, plain very dark navy blue background, solid dark background, NO text, NO watermark";

const REP = "https://api.replicate.com/v1";
function token(): string {
  const t = process.env.REPLICATE_API_TOKEN;
  if (!t) throw new Error("REPLICATE_API_TOKEN missing");
  return t;
}
async function repWait(body: Record<string, unknown>, endpoint: string): Promise<Record<string, any>> {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", Prefer: "wait=60" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`replicate ${r.status}: ${(await r.text()).slice(0, 160)}`);
  let p = (await r.json()) as Record<string, any>;
  for (let i = 0; i < 60 && !["succeeded", "failed", "canceled"].includes(p.status); i++) {
    await new Promise((res) => setTimeout(res, 3000));
    p = await (await fetch(`${REP}/predictions/${p.id}`, { headers: { Authorization: `Bearer ${token()}` } })).json();
  }
  if (p.status !== "succeeded") throw new Error(`replicate ${p.status}: ${p.error || "no detail"}`);
  return p;
}
async function outputBuffer(p: Record<string, any>): Promise<Buffer> {
  const url = Array.isArray(p.output) ? p.output[0] : p.output;
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}
let REMBG_VER: string | null = null;
async function removeBg(jpg: Buffer): Promise<Buffer> {
  if (!REMBG_VER) {
    const m = await (await fetch(`${REP}/models/lucataco/remove-bg`, { headers: { Authorization: `Bearer ${token()}` } })).json();
    REMBG_VER = m.latest_version.id as string;
  }
  const p = await repWait(
    { version: REMBG_VER, input: { image: "data:image/jpeg;base64," + jpg.toString("base64") } },
    `${REP}/predictions`
  );
  return outputBuffer(p);
}

/** Forge a custom companion (base + blink + cheer, backgrounds removed) and
 *  install it as the shop's active partner. Runs as a FORGE_COMPANION job. */
export async function forgeCompanion(shopId: string, prompt: string, name: string): Promise<void> {
  const desc = prompt.trim().slice(0, 220);
  const seed = Math.abs([...`${shopId}:${desc}`].reduce((h, c) => ((h << 5) + h + c.charCodeAt(0)) | 0, 5381)) % 1000000;

  const base = await outputBuffer(await repWait(
    { input: { prompt: `${STYLE}, ${desc}`, aspect_ratio: "1:1", guidance: 3.5, num_inference_steps: 34, seed, output_format: "jpg", output_quality: 95, disable_safety_checker: true } },
    `${REP}/models/black-forest-labs/flux-dev/predictions`
  ));
  const baseUri = "data:image/jpeg;base64," + base.toString("base64");

  const frame = async (framePrompt: string, strength: number, fseed: number) =>
    outputBuffer(await repWait(
      { input: { prompt: `${STYLE}, ${framePrompt}`, image: baseUri, prompt_strength: strength, guidance: 3.5, num_inference_steps: 30, seed: fseed, output_format: "jpg", output_quality: 95, disable_safety_checker: true } },
      `${REP}/models/black-forest-labs/flux-dev/predictions`
    ));
  const blink = await frame(`${desc}, exact same character in the exact same pose but with its eyes closed, blinking`, 0.5, seed + 1);
  const cheer = await frame(`${desc}, exact same character cheering excitedly with arms raised in celebration`, 0.6, seed + 2);

  const [aPng, bPng, cPng] = [await removeBg(base), await removeBg(blink), await removeBg(cheer)];

  await db.shop.update({
    where: { id: shopId },
    data: {
      companionId: "custom",
      companionName: name.trim().slice(0, 24) || "PARTNER",
      companionArt: aPng.toString("base64"),
      companionArtB: bPng.toString("base64"),
      companionArtC: cPng.toString("base64"),
    },
  });
}
