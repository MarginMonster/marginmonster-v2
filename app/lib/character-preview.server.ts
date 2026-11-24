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
 * Previews are free, so they are counted — an uncounted free button is an open tap — and they are
 * drawn on the EVERYDAY image model (4¢ a picture), not the premium one (15¢). That is what keeps the
 * price honest: a character is registered for about 87¢ of tokens and its 3D view costs about 53¢, so
 * at 15¢ a look the third preview already sold the character at a loss; at 4¢ a whole day's eight fit
 * (plan-config.ts has the sum). It is also the model that drew the stock characters the owner approved,
 * and on his own creature drawing it kept the beast's bulk better than the premium one did.
 *
 * WHAT IS WRITTEN DOWN, per shop, in one small file beside the uploads (so a restart forgets nothing):
 *   at     when each of the day's previews was TAKEN — reserved before the picture is drawn, in the same
 *          tick as the check, so a burst of parallel requests cannot all slip under the cap.
 *   made   for every preview not yet registered: what kind of character it was drawn as, the
 *          description it was drawn from, and the picture its maker added. Registering reads the kind
 *          and the description from HERE, not from the browser — the price follows the kind, and a
 *          person's portrait must not be registered as a 20-token "cartoon". It is also the list of what
 *          to clean up: pictures nobody registered do not stay on the public uploads path for ever. */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { brandStill } from "./commercial-ad-pipeline.server";
import { repRun } from "./image-generation.server";
import { isServableUploadName, shopSlug, uploadFileName, type UploadExt } from "./upload-names";
import { characterPreviewPrompt, type CharKind } from "./character-prompts";

/** Free previews a shop may make in any 24 hours. */
export const PREVIEWS_PER_DAY = 8;
/** An unregistered preview (and the picture it was drawn from) is kept this long, then removed. */
const KEEP_UNREGISTERED_MS = 7 * 24 * 60 * 60 * 1000;

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

/** What a file really is, read off its first bytes — the browser's own word for it is not evidence. */
export function sniffImage(buf: Buffer): UploadExt | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/** Keep the picture a maker added, as one of their uploads. Returns its name. */
export function saveReference(shopId: string, buf: Buffer, ext: UploadExt): string {
  const name = uploadFileName(shopId, crypto.randomBytes(8).toString("hex"), ext, "mascot");
  fs.writeFileSync(uploadPath(name), buf);
  return name;
}

const removeUpload = (name: string | null | undefined) => {
  if (!name || !isServableUploadName(name)) return;
  try { fs.unlinkSync(uploadPath(name)); } catch { /* already gone */ }
};
/** Remove one of the shop's own uploads (a picture that was added and then led to nothing). */
export function dropUpload(shopId: string, name: string): void {
  if (ownsUpload(shopId, name)) removeUpload(name);
}

/** `src`: the story picture it was ADOPTED from (adoptPicture) — absent for a preview that was drawn. */
export type PreviewRecord = { kind: CharKind; desc: string; refFile: string; at: number; src?: string };
type Ledger = { at: number[]; made: Record<string, PreviewRecord> };

const ledgerFile = (shopId: string) => path.join(uploadsDir(), `previews-${shopSlug(shopId)}.json`);
function readLedger(shopId: string): Ledger {
  let raw: unknown = null;
  try { raw = JSON.parse(fs.readFileSync(ledgerFile(shopId), "utf8")); } catch { /* none yet */ }
  // the first version of this file was just the list of times
  const src = (Array.isArray(raw) ? { at: raw } : raw && typeof raw === "object" ? raw : {}) as { at?: unknown; made?: unknown };
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const at = Array.isArray(src.at) ? src.at.filter((x): x is number => typeof x === "number" && x > since) : [];
  const made: Record<string, PreviewRecord> = {};
  if (src.made && typeof src.made === "object") {
    for (const [file, r] of Object.entries(src.made as Record<string, Partial<PreviewRecord>>)) {
      if (!isServableUploadName(file) || !r || typeof r !== "object") continue;
      const kind: CharKind = r.kind === "cartoon" || r.kind === "monster" ? r.kind : "person";
      made[file] = { kind, desc: typeof r.desc === "string" ? r.desc : "", refFile: typeof r.refFile === "string" ? r.refFile : "", at: typeof r.at === "number" ? r.at : 0, ...(typeof r.src === "string" && r.src ? { src: r.src } : {}) };
    }
  }
  return { at, made };
}
function writeLedger(shopId: string, l: Ledger): void {
  try { fs.writeFileSync(ledgerFile(shopId), JSON.stringify(l)); } catch { /* the count is a guard, not a debt */ }
}

/** How many free previews this shop has left today. */
export const previewsLeft = (shopId: string): number => Math.max(0, PREVIEWS_PER_DAY - readLedger(shopId).at.length);

/** TAKE one of today's previews — check and count in the same tick, before anything is awaited, so a
 *  burst of requests cannot all pass the check and then all draw. Returns a function that gives it back
 *  (nothing was drawn after all), or null when the day's allowance is used up. Also the moment old,
 *  never-registered previews are cleared away. */
export function reservePreview(shopId: string): (() => void) | null {
  const l = readLedger(shopId);
  const old = Date.now() - KEEP_UNREGISTERED_MS;
  for (const [file, r] of Object.entries(l.made)) {
    if (r.at >= old) continue;
    removeUpload(file);
    if (r.refFile && !Object.entries(l.made).some(([f, x]) => f !== file && x.refFile === r.refFile && x.at >= old)) removeUpload(r.refFile);
    delete l.made[file];
  }
  if (l.at.length >= PREVIEWS_PER_DAY) { writeLedger(shopId, l); return null; }
  const stamp = Date.now() + Math.random(); // unique, so giving it back removes exactly this one
  l.at.push(stamp);
  writeLedger(shopId, l);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const cur = readLedger(shopId);
    writeLedger(shopId, { ...cur, at: cur.at.filter((x) => x !== stamp) });
  };
}

/** Should the premium model be asked when the everyday one fails? Not when we were simply told to slow
 *  down — the next try on the everyday model will work, and the premium one costs four times as much. */
const worthThePremium = (e: unknown): boolean => !/\b429\b|rate.?limit|throttl/i.test(e instanceof Error ? e.message : String(e));

/** Draw one preview. `refFile` is a picture already in the shop's upload space (see ownsUpload).
 *  Returns the preview's file name in that same space. The caller has already TAKEN a preview with
 *  reservePreview() and gives it back if this throws. */
export async function makeCharacterPreview(o: { shopId: string; kind: CharKind; desc: string; refFile?: string }): Promise<string> {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if (o.refFile && !base) throw new Error("previews from a picture need SHOPIFY_APP_URL");
  const prompt = characterPreviewPrompt(o.kind, o.desc, !!o.refFile);
  const refUrl = o.refFile ? `${base}/uploads/${o.refFile}` : undefined;
  let url: string;
  try {
    url = await repRun("google/nano-banana", { prompt, ...(refUrl ? { image_input: [refUrl] } : {}), aspect_ratio: "3:4", output_format: "jpg" }, 150_000);
  } catch (e) {
    if (!worthThePremium(e)) throw e;
    // It balks at some creatures, and it has outages of its own. The maker still gets their picture —
    // from the premium model, at our cost — rather than a dead end; logged, because it is the dear path.
    console.warn(`[character] everyday image model failed for a ${o.kind} preview (${e instanceof Error ? e.message.slice(0, 140) : e}) — drawing it on the premium model`);
    url = await brandStill(prompt, refUrl, true);
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(3 * 60_000) });
  if (!res.ok) throw new Error(`preview fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error("the preview came back empty");
  const name = uploadFileName(o.shopId, crypto.randomBytes(8).toString("hex"), "jpg", "mascot");
  fs.writeFileSync(uploadPath(name), buf);
  const l = readLedger(o.shopId);
  l.made[name] = { kind: o.kind, desc: o.desc, refFile: o.refFile || "", at: Date.now() };
  writeLedger(o.shopId, l);
  return name;
}

/* ---- KEEP A STORY'S CHARACTER ----
 * A story draws a portrait of every character it invents (story-picture.ts). Keeping one in the cast makes
 * that portrait a PREVIEW without drawing anything: the maker has already seen it — it is the face in every
 * scene of their story. So it costs nothing, and it is not one of the day's free looks. From there it is
 * registered exactly like a preview that was drawn (claimed once, charged once, by its kind). */

/** No more adopted portraits than this wait unregistered for one shop; the oldest makes room. */
export const ADOPTED_MAX = 12;

/** The unregistered preview this shop already has for a story picture, if any. */
export function adoptedRecord(shopId: string, src: string): { file: string; rec: PreviewRecord } | null {
  if (!src) return null;
  const hit = Object.entries(readLedger(shopId).made).find(([file, r]) => r.src === src && ownsUpload(shopId, file));
  return hit ? { file: hit[0], rec: hit[1] } : null;
}

/** Make a story's portrait this shop's preview. The same picture adopted again (the dialog reopened, "a
 *  cartoon, not a person") is the SAME preview, with the kind and the words it was given last — the price
 *  follows the kind, so it is what the maker last chose that is registered. Returns the preview's name. */
export function adoptPicture(o: { shopId: string; kind: CharKind; desc: string; src: string; buf: Buffer; ext: UploadExt }): string {
  const known = adoptedRecord(o.shopId, o.src);
  const l = readLedger(o.shopId);
  if (known && l.made[known.file]) {
    l.made[known.file] = { ...l.made[known.file], kind: o.kind, desc: o.desc, at: Date.now() };
    writeLedger(o.shopId, l);
    return known.file;
  }
  const waiting = Object.entries(l.made).filter(([, r]) => !!r.src).sort((a, b) => a[1].at - b[1].at);
  while (waiting.length >= ADOPTED_MAX) { const [file] = waiting.shift()!; removeUpload(file); delete l.made[file]; }
  const name = saveReference(o.shopId, o.buf, o.ext);
  l.made[name] = { kind: o.kind, desc: o.desc, refFile: "", at: Date.now(), src: o.src };
  writeLedger(o.shopId, l);
  return name;
}

/** What a preview was drawn as — null when this shop has no such unregistered preview. */
export function previewRecord(shopId: string, file: string): PreviewRecord | null {
  if (!ownsUpload(shopId, file)) return null;
  return readLedger(shopId).made[file] || null;
}

/** CLAIM a preview for registration: its record is taken out in the same tick it is read, so the same
 *  picture cannot be registered — and charged — twice (a double click, two tabs, a dialog reopened on
 *  the picture it has just registered). Returns the record, or null if it is not there to claim. */
export function claimPreview(shopId: string, file: string): PreviewRecord | null {
  if (!ownsUpload(shopId, file)) return null;
  const l = readLedger(shopId);
  const rec = l.made[file];
  if (!rec) return null;
  delete l.made[file];
  writeLedger(shopId, l);
  return rec;
}

/** Registration did not go through after all: the preview is available again. */
export function unclaimPreview(shopId: string, file: string, rec: PreviewRecord): void {
  const l = readLedger(shopId);
  l.made[file] = rec;
  writeLedger(shopId, l);
}

/** A character has been registered from `rec` (already claimed). The pictures that led to it and were
 *  not chosen are removed: every other unregistered preview, and the pictures the maker added. A photo
 *  of a real person is not left behind on a public path once the character exists. */
export function settlePreviews(shopId: string, rec: PreviewRecord): void {
  const l = readLedger(shopId);
  for (const [file, r] of Object.entries(l.made)) { removeUpload(file); removeUpload(r.refFile); }
  removeUpload(rec.refFile);
  writeLedger(shopId, { at: l.at, made: {} });
}
