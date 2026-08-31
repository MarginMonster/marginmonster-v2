/* The Custom Avatar Maker — "Turn your brand mascot into a marketing tool."
 *
 * The exact chain that turned the founder's Magic Monster into a castable
 * presenter, productised: a merchant uploads ONE reference image of their
 * mascot or spokesperson, and the forge renders the four cast wardrobe
 * variants (same half-body framing, same warm studio backdrop as the public
 * 100), stores them on the renders disk, and the presenter appears in THAT
 * shop's Studio only. Custom presenters ride every existing pipeline —
 * UGC, review, unboxing, jingle, cartoon — through resolvePresenter().
 *
 * Public ids are "cav<cuid>" so pickers and pipelines can tell them apart
 * from the static cast without a DB hit on the hot path.
 */

import fs from "node:fs";
import path from "node:path";
import { db } from "../db.server";
import type { Avatar } from "./avatars";
import { OUTFITS } from "./avatars";
import { brandStill } from "./commercial-ad-pipeline.server";
import { mirrorRender } from "./object-storage.server";

export const CUSTOM_PREFIX = "cav";
export const isCustomAvatarId = (id: string): boolean => id.startsWith(CUSTOM_PREFIX);

const rendersDir = () => {
  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

type Row = {
  id: string; name: string; desc: string; gender: string; energy: string;
  status: string; error: string | null; files: string;
};

const toAvatar = (r: Row): Avatar => ({
  id: `${CUSTOM_PREFIX}${r.id}`,
  name: r.name,
  vibe: "Your brand presenter",
  desc: r.desc,
  gender: (r.gender === "f" ? "f" : "m"),
  ageBand: "mid",
  energy: (["hype", "warm", "calm"].includes(r.energy) ? r.energy : "warm") as Avatar["energy"],
});

const fileList = (r: { files: string }): string[] => {
  try { const a = JSON.parse(r.files); return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; }
  catch { return []; }
};

/** This shop's ready custom presenters, Avatar-shaped for the pickers, plus
 *  the /renders portrait URL the tile shows. Forging rows come back too so
 *  the Studio can show progress. */
export async function customCastFor(shopId: string): Promise<Array<Avatar & { img: string; status: string; createdAt: Date }>> {
  const rows = await db.customAvatar.findMany({ where: { shopId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => {
    const files = fileList(r);
    // createdAt rides along so the forging placeholder can count from the REAL
    // start — a reload mid-forge should say "1m 40s", not restart at zero.
    return { ...toAvatar(r), img: files[0] ? `/renders/${files[0]}` : "", status: r.status, createdAt: r.createdAt };
  });
}

/** Resolve a presenter id (public cast or this shop's custom) to persona +
 *  portrait file. The single seam every pipeline goes through for custom
 *  presenters; static ids keep their existing fast path. */
export async function resolvePresenter(
  shopId: string,
  avatarId: string,
  variant = 0
): Promise<{ avatar: Avatar; portraitFile: string; portraitPublicPath: string }> {
  if (!isCustomAvatarId(avatarId)) {
    const { AVATAR_BY_ID } = await import("./avatars");
    const { resolvePortraitFile } = await import("./ugc-ad-pipeline.server");
    const avatar = AVATAR_BY_ID[avatarId];
    if (!avatar) throw new Error(`unknown presenter "${avatarId}"`);
    const portraitFile = resolvePortraitFile(avatarId, variant);
    return { avatar, portraitFile, portraitPublicPath: `/avatars/${path.basename(portraitFile)}` };
  }
  const row = await db.customAvatar.findFirst({ where: { id: avatarId.slice(CUSTOM_PREFIX.length), shopId } });
  if (!row || row.status !== "ready") throw new Error(`custom presenter "${avatarId}" is not ready`);
  const files = fileList(row);
  const name = files[Math.max(0, Math.min(files.length - 1, variant))] || files[0];
  if (!name) throw new Error(`custom presenter "${avatarId}" has no portraits`);
  const portraitFile = path.join(rendersDir(), name);
  if (!fs.existsSync(portraitFile)) throw new Error(`custom presenter portrait missing on disk: ${name}`);
  return { avatar: toAvatar(row), portraitFile, portraitPublicPath: `/renders/${name}` };
}

/** The forge. Renders the four wardrobe variants from the uploaded
 *  reference — SAME character, cast framing — and marks the row ready.
 *  Runs inside a Job; the row exists (status "forging") before this starts
 *  so the Studio shows the card immediately. */
export async function forgeCustomAvatar(customAvatarId: string): Promise<void> {
  const row = await db.customAvatar.findUnique({ where: { id: customAvatarId } });
  if (!row) throw new Error(`custom avatar ${customAvatarId} not found`);
  // The pre-flight check below used to sit OUTSIDE the try, so the two ways it
  // can fail never reached the handler that marks the row failed. The card then
  // said "Forging…" forever — no error, no explanation, and one of the
  // merchant's twelve presenter slots eaten by a row nothing will ever finish.
  try {
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    if (!row.refFile || !base) throw new Error("forge needs a reference image and SHOPIFY_APP_URL");
    await forgePortraits(row, base);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.customAvatar
      .update({ where: { id: row.id }, data: { status: "failed", error: msg.slice(0, 500) } })
      .catch(() => { /* the job's terminal path is the backstop */ });
    throw e;
  }
}

async function forgePortraits(row: { id: string; refFile: string | null }, base: string): Promise<void> {
  // references are merchant uploads: data/renders/uploads, served at /uploads
  const refUrl = `${base}/uploads/${row.refFile}`;
  const KEEP = `The reference image shows a brand character or spokesperson. Recreate the EXACT same character — identical face, colours, features and style — as a clean professional presenter photo.`;
  const HALF = `Half-body presenter framing (waist up, facing camera, arms relaxed and visible), soft even studio light on a plain warm neutral backdrop, sharp focus. No text anywhere.`;
  const files = await Promise.all(OUTFITS.map(async (o, i) => {
    const url = await brandStill(`${KEEP} The character wears ${o.desc}. ${HALF}`, refUrl, true);
    const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
    if (!res.ok) throw new Error(`portrait ${i} fetch ${res.status}`);
    const name = `cav-${row.id}_${i}.jpg`;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(rendersDir(), name), buf);
    // MIRROR, like every other render this app writes.
    //
    // render.yaml states the contract: the renders disk is "a FAST CACHE, not
    // the source of truth", and every ad pipeline mirrors what it writes so a
    // disk resize or instance recreation does not destroy it. Forged presenter
    // portraits were the one paid asset class that never did — and losing them
    // is worse than losing an ad, because resolvePresenter THROWS on a missing
    // portrait, so every future job naming that presenter fails outright.
    // renders.$file.tsx already re-fetches from storage on a cache miss; there
    // was simply never anything there to find.
    try { await mirrorRender(name, buf); } catch { /* non-fatal, as everywhere else */ }
    return name;
  }));
  await db.customAvatar.update({ where: { id: row.id }, data: { status: "ready", files: JSON.stringify(files), error: null } });
}
