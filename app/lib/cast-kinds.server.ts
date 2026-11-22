/* WHICH CAST PICTURES ARE CHARACTERS, NOT PEOPLE.
 *
 * A render is handed its cast as pictures. Whether a picture is a person or a character (a cartoon, a
 * monster) decides things only the server should decide — whether the lip-sync model is run on that singer,
 * for one (mv-cast.ts MOUTH_CHECK_PROMPT). It is read here from what the app itself knows: the stock
 * characters, and the characters this shop made. Never from what the page says.
 */
import { STOCK_CHARACTERS } from "./stock-characters";
import { avatarImg } from "./avatars";
import { pictureFile } from "./mv-cast";

/** The picture FILES (see pictureFile) of every character — stock, and this shop's own. Never throws. */
export async function characterPictureFiles(shopId: string): Promise<Set<string>> {
  const files = new Set<string>();
  for (const a of STOCK_CHARACTERS) if (a.kind && a.kind !== "person") files.add(pictureFile(avatarImg(a.id, 0)));
  try {
    const { customCastFor } = await import("./custom-avatars.server");
    for (const c of await customCastFor(shopId)) {
      if (!c.kind || c.kind === "person") continue;
      for (const img of [c.img, ...(c.imgs || [])]) { const f = pictureFile(img); if (f) files.add(f); }
    }
  } catch (e) {
    console.error(`[cast-kinds] this shop's own characters could not be read: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
  }
  files.delete("");
  return files;
}
