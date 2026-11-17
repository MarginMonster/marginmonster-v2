/* Step one of creating a character: SEE them — before anything is charged.
 *
 * The owner, 2026-11-17, after paying 60 tokens for a monster that came back as a man in a shirt: "It
 * should show a reference image first (before the 60 token commit) then it forges character based on
 * the new image either acquired by description or by image reference. Either way they need to see what
 * it will be before commit to the 60 tokens."
 *
 * A preview is one picture, drawn from the maker's description and/or a picture they added (the words
 * live in character-prompts.ts). It is saved beside the merchant's own uploads, under the same kind of
 * name, because the approved preview then BECOMES the reference the character is forged from — what
 * they said yes to is what they get.
 *
 * Previews are free, so they are counted: a picture costs us real money (the premium image model), and
 * an uncounted free button is an open tap. */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { brandStill } from "./commercial-ad-pipeline.server";
import { isServableUploadName, shopSlug, uploadFileName } from "./upload-names";
import { characterPreviewPrompt, type CharKind } from "./character-prompts";

/** Free previews a shop may make in any 24 hours. */
export const PREVIEWS_PER_DAY = 8;

const uploadsDir = () => {
  const dir = path.join(process.cwd(), "data", "renders", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/** Is this the name of a picture in THIS shop's own upload space that is still on the disk? The name
 *  comes back from the browser, so it is checked rather than trusted. */
export function ownsUpload(shopId: string, name: string): boolean {
  if (!name || !isServableUploadName(name) || !name.startsWith(`${shopSlug(shopId)}-mascot-`)) return false;
  try { return fs.statSync(path.join(uploadsDir(), name)).size > 1000; } catch { return false; }
}

export const uploadPath = (name: string): string => path.join(uploadsDir(), name);

// When each shop made its previews — on the disk, so a restart does not hand everyone a fresh allowance.
const ledgerFile = (shopId: string) => path.join(uploadsDir(), `previews-${shopSlug(shopId)}.json`);
function recentPreviews(shopId: string): number[] {
  try {
    const all = JSON.parse(fs.readFileSync(ledgerFile(shopId), "utf8")) as unknown;
    const since = Date.now() - 24 * 60 * 60 * 1000;
    return Array.isArray(all) ? all.filter((x): x is number => typeof x === "number" && x > since) : [];
  } catch { return []; }
}

/** How many free previews this shop has left today. */
export const previewsLeft = (shopId: string): number => Math.max(0, PREVIEWS_PER_DAY - recentPreviews(shopId).length);

/** Draw one preview. `refFile` is a picture already in the shop's upload space (see ownsUpload).
 *  Returns the preview's file name in that same space. Counted against the day's allowance only once
 *  a picture has actually been made. */
export async function makeCharacterPreview(o: { shopId: string; kind: CharKind; desc: string; refFile?: string }): Promise<string> {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if (o.refFile && !base) throw new Error("previews from a picture need SHOPIFY_APP_URL");
  const url = await brandStill(characterPreviewPrompt(o.kind, o.desc, !!o.refFile), o.refFile ? `${base}/uploads/${o.refFile}` : undefined, true);
  const res = await fetch(url, { signal: AbortSignal.timeout(3 * 60_000) });
  if (!res.ok) throw new Error(`preview fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error("the preview came back empty");
  const name = uploadFileName(o.shopId, crypto.randomBytes(8).toString("hex"), "jpg", "mascot");
  fs.writeFileSync(uploadPath(name), buf);
  try { fs.writeFileSync(ledgerFile(o.shopId), JSON.stringify([...recentPreviews(o.shopId), Date.now()])); } catch { /* the count is a guard, not a debt */ }
  return name;
}
