/* EDIT A FINISHED NARRATED STORY — the reading part (story-edit.ts decides).
 *
 * Only ever reads: this shop's own story, its pictures as they are on our disk, its music bed. The new
 * piece is made by the Movie Maker's ordinary Generate; the original is never touched. */
import fs from "node:fs";
import path from "node:path";
import { db } from "../db.server";
import { editCarry, storyToEditFrom, type StoryToEdit } from "./story-edit";
import { storyPicturesOnDisk } from "./story-translate.server";

/** The story to open in the storyboard, for `?edit=<assetId>` — null when it is not this shop's, not a
 *  narrated story, or cannot be opened (story-edit.ts → storyToEditFrom). */
export async function storyToEdit(shopId: string, assetId: string, shopLang?: string | null): Promise<StoryToEdit | null> {
  if (!assetId) return null;
  const asset = await db.asset.findFirst({
    where: { id: assetId, shopId, type: "VIDEO_AD", status: { not: "FAILED" } },
    select: { id: true, title: true, metaJson: true, bodyJson: true, createdAt: true },
  });
  if (!asset) return null;
  let scenes = 0;
  try { const tr = JSON.parse(asset.bodyJson || "{}").treatment; scenes = Array.isArray(tr?.scenes) ? tr.scenes.length : 0; } catch { scenes = 0; }
  let pictures: string[] | null = null;
  if (scenes > 0) {
    try { pictures = (await storyPicturesOnDisk(shopId, asset, scenes))?.pictures || null; } catch { pictures = null; }
  }
  return storyToEditFrom(asset, pictures, shopLang);
}

/** What Generate carries over from the story an edit was opened from: its language, the first story it
 *  is a telling of, and its music bed's file when that is still on our disk. Null when `assetId` is not
 *  this shop's narrated story — the edit is then an ordinary new story. */
export async function editCarryFor(shopId: string, assetId: string, shopLang?: string | null): Promise<{ lang: string; translatedFrom: string; musicFile: string } | null> {
  if (!assetId) return null;
  const asset = await db.asset.findFirst({
    where: { id: assetId, shopId, type: "VIDEO_AD", status: { not: "FAILED" } },
    select: { metaJson: true },
  });
  if (!asset) return null;
  const carry = editCarry(asset.metaJson, shopLang);
  if (!carry) return null;
  const file = carry.music ? path.join(process.cwd(), "data", "renders", carry.music) : "";
  return { lang: carry.lang, translatedFrom: carry.translatedFrom, musicFile: file && fs.existsSync(file) ? file : "" };
}
