/* Filenames for merchant uploads, in ONE place.
 *
 * /uploads/:file serves merchant-uploaded product and mascot photographs, and
 * its only access control is that the names are unguessable. So the route
 * allowlists them — and the allowlist and the writers had drifted apart:
 *
 *   product photo   <shopid>-<hex>.jpg          one hyphen   — allowed
 *   brand mascot    <shopid>-mascot-<hex>.jpg   two hyphens  — REJECTED
 *
 * The pattern was written for the product-photo shape; the mascot upload was
 * added later with an extra segment and nothing updated it. Every mascot upload
 * 404'd, so forgeCustomAvatar — which builds `${base}/uploads/${refFile}` and
 * hands it to the renderer — could never fetch its own input. The custom
 * presenter feature was dead end to end, and it charges tokens.
 *
 * Both the builders and the allowlist live here now, so a new upload kind
 * cannot be added without the reader agreeing.
 */

/** Hyphen-separated lowercase alphanumeric segments, one extension. No dots and
 *  no slashes, so a name can never walk out of the uploads directory. */
export const UPLOAD_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(jpg|png|webp)$/;

export type UploadExt = "jpg" | "png" | "webp";

export function isServableUploadName(name: string): boolean {
  return UPLOAD_NAME_RE.test(name);
}

/** The shop id, reduced to the character class the allowlist accepts. */
const shopSlug = (shopId: string): string => shopId.toLowerCase().replace(/[^a-z0-9]/g, "");

/** `kind` is omitted for a plain product photo and present for anything else,
 *  which is what keeps the two shapes distinguishable on disk. */
export function uploadFileName(shopId: string, randomHex: string, ext: UploadExt, kind?: "mascot"): string {
  const parts = [shopSlug(shopId), kind, randomHex].filter(Boolean);
  return `${parts.join("-")}.${ext}`;
}
