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

import { charKindOf, characterContinuity } from "./character-prompts";
import fs from "node:fs";
import path from "node:path";
import { db } from "../db.server";
import type { Avatar } from "./avatars";
import { OUTFITS } from "./avatars";
import { brandStill } from "./commercial-ad-pipeline.server";
import { mirrorRender } from "./object-storage.server";
import { AVATAR_VOICE_IDS } from "./avatar-voice-catalog";
import { characterVoice, isCharacterVoice } from "./character-voices";

export const CUSTOM_PREFIX = "cav";
export const isCustomAvatarId = (id: string): boolean => id.startsWith(CUSTOM_PREFIX);

const rendersDir = () => {
  const dir = path.join(process.cwd(), "data", "renders");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

type Row = {
  id: string; name: string; desc: string; gender: string; energy: string;
  voiceId: string | null; status: string; error: string | null; files: string;
  kind?: string | null;
};

const toAvatar = (r: Row): Avatar => ({
  id: `${CUSTOM_PREFIX}${r.id}`,
  name: r.name,
  vibe: "Your character",
  desc: r.desc,
  // a cartoon or a creature: what it is, and what a picture model must not "fix" about it
  ...(charKindOf(r.kind) !== "person" ? { kind: charKindOf(r.kind), continuity: characterContinuity(charKindOf(r.kind), r.desc) } : {}),
  gender: (r.gender === "f" ? "f" : "m"),
  ageBand: "mid",
  energy: (["hype", "warm", "calm"].includes(r.energy) ? r.energy : "warm") as Avatar["energy"],
  // The owner's picked voice, used verbatim by castFor — this is the fix for a
  // forged presenter falling through to the scorer and getting a random accent.
  voiceId: r.voiceId || undefined,
  // a performed character voice also comes with itself in words, for the film models that act a voice
  ...(characterVoice(r.voiceId) ? { voiceStyle: characterVoice(r.voiceId)!.style } : {}),
});

const fileList = (r: { files: string }): string[] => {
  try { const a = JSON.parse(r.files); return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; }
  catch { return []; }
};

/** The portrait files of a custom presenter row, wardrobe order. */
export const portraitFilesOf = (r: { files: string }): string[] => fileList(r);

/** One outfit's 3D view as the database has it (see presenter-kit.server.ts). */
export type SpinRow = { avatarId: string; look: number; state: string; frames: number; frameW: number; frameH: number; dir: number; startedAt: Date; updatedAt: Date };

/** This shop's custom presenters, Avatar-shaped for the pickers, plus the
 *  /renders portrait URL the tile shows. Forging rows come back too so the
 *  Studio can show progress. `rowId`, `imgs` (all four outfits) and the kit
 *  fields are what the Presenters section's character view reads. */
export async function customCastFor(shopId: string): Promise<Array<Avatar & {
  img: string; status: string; createdAt: Date;
  rowId: string; imgs: string[]; error: string | null; cuts: number; spins: SpinRow[];
}>> {
  const rows = await db.customAvatar.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, include: { spins: true } });
  return rows.map((r) => {
    const files = fileList(r);
    // createdAt rides along so the forging placeholder can count from the REAL
    // start — a reload mid-forge should say "1m 40s", not restart at zero.
    return {
      ...toAvatar(r), img: files[0] ? `/renders/${files[0]}` : "", status: r.status, createdAt: r.createdAt,
      rowId: r.id, imgs: files.map((x) => `/renders/${x}`), error: r.error,
      cuts: r.cuts, spins: r.spins,
    };
  });
}

/* ---- A shop's own voice choice for a STOCK presenter ----
 * The stock cast each have a hand-designed signature voice. A merchant can put a different voice on
 * one of them — a catalog voice, or their own recorded voice — and it is stored per shop (PresenterVoice).
 * Custom presenters keep their voice on their own row; this is only for ids from the public cast. */

/** Is this still a voice the shop may use — a catalog voice, or one of its own that is still there? */
async function usableVoice(shopId: string, voiceId: string): Promise<boolean> {
  if (AVATAR_VOICE_IDS.has(voiceId) || isCharacterVoice(voiceId)) return true;
  const mine = await db.voiceClone.findFirst({ where: { shopId, voiceId, status: "ready" }, select: { id: true } });
  return !!mine;
}

/** Every stock presenter this shop has re-voiced: presenter id → voice id. */
/** The presenters this shop starred, oldest star first (see favourites.ts for how they're used). */
export async function favouritesFor(shopId: string): Promise<string[]> {
  const rows = await db.presenterFavourite.findMany({ where: { shopId }, select: { avatarId: true }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => r.avatarId);
}

/** Star (or un-star) a presenter for this shop. The caller checks the id is one the shop can cast. */
export async function setFavourite(shopId: string, avatarId: string, on: boolean): Promise<void> {
  if (on) await db.presenterFavourite.upsert({ where: { shopId_avatarId: { shopId, avatarId } }, create: { shopId, avatarId }, update: {} });
  else await db.presenterFavourite.deleteMany({ where: { shopId, avatarId } });
}

export async function stockVoicesFor(shopId: string): Promise<Record<string, string>> {
  const rows = await db.presenterVoice.findMany({ where: { shopId }, select: { avatarId: true, voiceId: true } });
  return Object.fromEntries(rows.map((r) => [r.avatarId, r.voiceId]));
}

/** Put a voice on a stock presenter for this shop — or, with an empty id, give them their signature
 *  voice back. Returns the voice now in force ("" = signature). An id the shop may not use is refused. */
export async function setStockVoice(shopId: string, avatarId: string, voiceId: string): Promise<string> {
  const { AVATAR_BY_ID } = await import("./avatars");
  if (isCustomAvatarId(avatarId) || !AVATAR_BY_ID[avatarId]) throw new Error(`unknown presenter "${avatarId}"`);
  const want = (voiceId || "").trim();
  if (!want) {
    await db.presenterVoice.deleteMany({ where: { shopId, avatarId } });
    return "";
  }
  if (!(await usableVoice(shopId, want))) throw new Error("That voice isn't available anymore — pick another.");
  await db.presenterVoice.upsert({
    where: { shopId_avatarId: { shopId, avatarId } },
    create: { shopId, avatarId, voiceId: want },
    update: { voiceId: want },
  });
  return want;
}

/** Delete one of the shop's own presenters: its portraits, its reference photo, its character kit and
 *  the row. Returns the presenter's name, or null when it was already gone. */
export async function deleteCustomAvatar(shopId: string, publicOrRowId: string): Promise<string | null> {
  const id = publicOrRowId.startsWith(CUSTOM_PREFIX) ? publicOrRowId.slice(CUSTOM_PREFIX.length) : publicOrRowId;
  const row = await db.customAvatar.findFirst({ where: { id, shopId } });
  if (!row) return null;
  const dir = rendersDir();
  const gone = (name: string) => { try { fs.unlinkSync(path.join(dir, name)); } catch { /* cache file — non-fatal */ } };
  for (const x of fileList(row)) gone(x);
  if (row.refFile) gone(path.join("uploads", row.refFile));
  // the kit: kit<id>-o0..3.webp + kit<id>-s00..NN.webp
  try { for (const x of fs.readdirSync(dir)) if (x.startsWith(`kit${row.id}-`)) gone(x); } catch { /* nothing to clean */ }
  await db.customAvatar.delete({ where: { id: row.id } });
  // its star goes with it (the public id is what was starred)
  await db.presenterFavourite.deleteMany({ where: { shopId, avatarId: `${CUSTOM_PREFIX}${row.id}` } }).catch(() => { /* a stale star is skipped anyway */ });
  return row.name;
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
    const stock = AVATAR_BY_ID[avatarId];
    if (!stock) throw new Error(`unknown presenter "${avatarId}"`);
    const portraitFile = resolvePortraitFile(avatarId, variant);
    // The shop's own voice choice for this stock presenter, if it made one. castFor() speaks a
    // presenter's `voiceId` verbatim, so this is the whole override — every pipeline that goes through
    // here (video ads, songs, cartoons) hears it. Checked at use: a voice the shop has since deleted is
    // not sent to the speech model, the presenter just goes back to their signature voice.
    let avatar = stock;
    try {
      const pick = await db.presenterVoice.findUnique({ where: { shopId_avatarId: { shopId, avatarId } }, select: { voiceId: true } });
      if (pick && (await usableVoice(shopId, pick.voiceId))) avatar = { ...stock, voiceId: pick.voiceId };
    } catch (e) {
      console.error(`[presenter] could not read the voice choice for ${avatarId}: ${e instanceof Error ? e.message : e}`);
    }
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
    if (!row.refFile) throw new Error("forge needs a reference image");
    if (charKindOf(row.kind) !== "person") await registerCharacter(row);
    else {
      if (!base) throw new Error("forge needs SHOPIFY_APP_URL");
      await forgePortraits(row, base);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.customAvatar
      .update({ where: { id: row.id }, data: { status: "failed", error: msg.slice(0, 500) } })
      .catch(() => { /* the job's terminal path is the backstop */ });
    throw e;
  }
}

/** Register a character that is not a person, right now — it is one file copy, so it does not wait in
 *  the render queue (the dialog said "joins your cast in a moment", and a film ahead of it in the queue
 *  made that ten minutes). Throws if the approved picture is gone. */
export async function registerCharacterNow(customAvatarId: string): Promise<void> {
  const row = await db.customAvatar.findUnique({ where: { id: customAvatarId } });
  if (!row) throw new Error(`custom avatar ${customAvatarId} not found`);
  await registerCharacter(row);
}

/** A character that is not a person keeps the ONE look its maker approved: the preview they said yes
 *  to becomes the portrait, byte for byte — nothing is drawn again, so nothing can drift from it (no
 *  outfits; a creature is not re-dressed in "smart" and "street"). */
async function registerCharacter(row: { id: string; refFile: string | null }): Promise<void> {
  const src = path.join(rendersDir(), "uploads", row.refFile || "");
  if (!row.refFile || !fs.existsSync(src)) throw new Error("the approved picture is no longer on the disk");
  const buf = fs.readFileSync(src);
  const name = `cav-${row.id}_0.jpg`;
  fs.writeFileSync(path.join(rendersDir(), name), buf);
  try { await mirrorRender(name, buf); } catch { /* non-fatal, as everywhere else */ }
  await db.customAvatar.update({ where: { id: row.id }, data: { status: "ready", files: JSON.stringify([name]), error: null } });
}

async function forgePortraits(row: { id: string; refFile: string | null; desc?: string | null }, base: string): Promise<void> {
  // references are merchant uploads: data/renders/uploads, served at /uploads
  const refUrl = `${base}/uploads/${row.refFile}`;
  const KEEP = `The reference image shows a brand character or spokesperson. Recreate the EXACT same character — identical face, colours, features and style — as a clean professional presenter photo.`;
  const HALF = `Half-body presenter framing (waist up, facing camera, arms relaxed and visible), soft even studio light on a plain warm neutral backdrop, sharp focus. No text anywhere.`;
  // The merchant's own "describe them" RIDES every outfit render (it was stored and
  // never used). Layered ON TOP of the reference photo — "warm smile, early 30s,
  // short dark curls" shapes the presenter rather than replacing the uploaded face.
  const look = row.desc && row.desc.trim() ? ` Keep these traits: ${row.desc.trim().slice(0, 200)}.` : "";
  const files = await Promise.all(OUTFITS.map(async (o, i) => {
    const url = await brandStill(`${KEEP}${look} The character wears ${o.desc}. ${HALF}`, refUrl, true);
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
