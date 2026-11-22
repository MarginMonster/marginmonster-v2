/* A PRESENTER'S SAVED LOOKS — outfits made for them outside the four they were forged with.
 *
 * The owner, 2026-11-22: "the outfit changes will need to be saved to each avatars cast card also in the
 * presenters section and appear there".
 *
 * An outfit made in the Movie Maker's wardrobe (for a whole video, or for one scene) used to live only in
 * that browser. It now belongs to the PRESENTER: saved with who it is for, shown on their card in the
 * Presenters section, and offered again wherever they are dressed, on any device.
 *
 * Pure: what counts as a presenter's id and as a look's picture, shared by the server and the tests. */

/** How many saved looks one presenter keeps (the oldest beyond this are not shown). */
export const LOOKS_PER_AVATAR = 24;
/** How many looks one request may hand over to be kept (a browser's old looks, adopted once). */
export const LOOKS_PER_REQUEST = 40;

/** WHO a look belongs to: a presenter's id as the pickers carry it — a stock presenter's ("omar"), a
 *  stock character's, or one of the shop's own ("cav…"). "" when it is not an id. */
export function lookAvatarKey(id: unknown): string {
  const s = typeof id === "string" ? id.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(s) ? s : "";
}

/** A look's PICTURE as a path on our own render disk — whatever host an address names, only the path is
 *  kept, and only a picture under /renders/ counts. "" when it is not one. */
export function lookImgPath(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) return "";
  let p = "";
  try { p = new URL(v.trim(), "https://site.invalid").pathname; } catch { return ""; }
  return /^\/renders\/[\w.-]+\.(?:jpe?g|png|webp)$/i.test(p) ? p : "";
}

/** The outfit, in the words it was made from — tidied to one line of at most 160 characters. */
export function lookDesc(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 160) : "";
}

/** The short name a look goes by on a card ("A red sequin evening dress"). */
export function lookLabel(desc: string): string {
  const d = lookDesc(desc).replace(/^(?:an?|the)\s+/i, "");
  if (!d) return "";
  const cut = d.length > 34 ? `${d.slice(0, 33).replace(/\s+\S*$/, "")}…` : d;
  return cut[0].toUpperCase() + cut.slice(1);
}

export type SavedLook = { desc: string; img: string };
