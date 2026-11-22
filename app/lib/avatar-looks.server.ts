/* A presenter's saved looks, kept per shop (see avatar-looks.ts for what they are and why). */
import { db } from "../db.server";
import { LOOKS_PER_AVATAR, lookAvatarKey, lookDesc, lookImgPath, type SavedLook } from "./avatar-looks";

/** Keep one look for one presenter of this shop. The same outfit made again replaces its picture.
 *  False when what was handed over is not a presenter, an outfit and a picture of ours — and on any
 *  database trouble: a look that could not be kept never costs the picture that was just made. */
export async function saveAvatarLook(shopId: string, avatarId: unknown, desc: unknown, img: unknown): Promise<boolean> {
  const avatarKey = lookAvatarKey(avatarId), d = lookDesc(desc), path = lookImgPath(img);
  if (!shopId || !avatarKey || !d || !path) return false;
  try {
    await db.avatarLook.upsert({
      where: { shopId_avatarKey_desc: { shopId, avatarKey, desc: d } },
      create: { shopId, avatarKey, desc: d, img: path },
      update: { img: path },
    });
    return true;
  } catch (e) {
    console.error(`[looks] could not keep a look for ${avatarKey}: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
    return false;
  }
}

/** Every saved look of this shop, by presenter id, newest first (at most LOOKS_PER_AVATAR each). Empty
 *  on any database trouble: the pages that show looks must still open. */
export async function avatarLooksFor(shopId: string): Promise<Record<string, SavedLook[]>> {
  const out: Record<string, SavedLook[]> = {};
  if (!shopId) return out;
  try {
    const rows = await db.avatarLook.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 600, select: { avatarKey: true, desc: true, img: true } });
    for (const r of rows) {
      const list = (out[r.avatarKey] ||= []);
      if (list.length < LOOKS_PER_AVATAR) list.push({ desc: r.desc, img: r.img });
    }
  } catch (e) {
    console.error(`[looks] could not read the saved looks: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
  }
  return out;
}
