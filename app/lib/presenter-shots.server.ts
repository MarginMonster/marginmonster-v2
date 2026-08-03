/* The Presenter Shot Library.
 *
 * Everyone at the top of this market ships the same architecture: the one
 * genuinely risky generative step — putting the presenter and the product in
 * a frame together — runs ONCE, gets gated, and the winner is frozen as a
 * reusable asset. Every ad after that is deterministic assembly. HeyGen calls
 * it Product Placement (4 stills, pick one, save), Topview a Product Avatar
 * (3 previews, save to library), Creatify reviews variations before use.
 *
 * We were re-rolling the generative dice on EVERY render: ~$0.45 of composes
 * and QA per presenter still against $0.31 of token revenue, with a fresh
 * chance of drift each time. Frozen shots make the second and every later ad
 * for a presenter x product pair instant and free, and the creation cost
 * amortises to noise.
 *
 * The library stores the CLEAN composite (pre text-overlay) on the renders
 * disk, so each reuse can carry fresh ad copy. PRESENTER_SHOT_LIBRARY=0
 * bypasses the cache entirely — the original always-generate pipeline stays
 * one variable away, same as every other backburnered path.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "../db.server";

export function shotLibraryEnabled(): boolean {
  return process.env.PRESENTER_SHOT_LIBRARY !== "0";
}

/** Stable identity for "this presenter with this product in this layout".
 *  CDN query params vary between fetches of the same image, so they are not
 *  part of the identity. The layout is: a hold and a showcase of the same
 *  pair are different shots. */
export function presenterShotKey(
  avatarId: string,
  variant: number,
  productImageUrl: string,
  layout: string
): string {
  const normalized = (productImageUrl || "").split("?")[0];
  return crypto.createHash("sha1").update(`${avatarId}|${variant}|${normalized}|${layout}`).digest("hex");
}

export async function findPresenterShot(
  shopId: string,
  cacheKey: string
): Promise<{ fileName: string; buf: Buffer } | null> {
  const row = await db.presenterShot
    .findUnique({ where: { shopId_cacheKey: { shopId, cacheKey } } })
    .catch(() => null);
  if (!row) return null;
  const abs = path.join(process.cwd(), "data", "renders", row.fileName);
  if (!fs.existsSync(abs)) {
    // The disk lost the bytes (fresh container without the volume, pruned
    // file). A library row pointing at nothing would silently disable the
    // pair forever, so drop it and let the next render recreate the shot.
    await db.presenterShot.delete({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }
  return { fileName: row.fileName, buf: fs.readFileSync(abs) };
}

export async function savePresenterShot(opts: {
  shopId: string;
  cacheKey: string;
  avatarId: string;
  layout: string;
  fileName: string;
  gateReason?: string;
}): Promise<void> {
  await db.presenterShot
    .upsert({
      where: { shopId_cacheKey: { shopId: opts.shopId, cacheKey: opts.cacheKey } },
      create: {
        shopId: opts.shopId,
        cacheKey: opts.cacheKey,
        avatarId: opts.avatarId,
        layout: opts.layout,
        fileName: opts.fileName,
        gateReason: opts.gateReason || null,
      },
      // A newer gate-passed frame replaces the old one — the gate only ever
      // saves passes, so newest is at least as good and reflects current code.
      update: { fileName: opts.fileName, gateReason: opts.gateReason || null },
    })
    .catch((e: unknown) => console.error("[presenter-shots] save failed:", e instanceof Error ? e.message : e));
}
