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
 * drawn on an EVERYDAY-priced image model (about 4¢ a picture), not the premium one (15¢). That is what
 * keeps the price honest: a character is registered for about 87¢ of tokens and its 3D view costs about
 * 53¢, so at 15¢ a look the third preview already sold the character at a loss; at 4¢ a whole day's eight
 * fit (plan-config.ts has the sum).
 *
 * WHICH model (2026-11-24, character-look.ts → previewLadder): a first look from words is drawn on Seedream 4.5,
 * then nano-banana (both about 4¢); one from a picture on nano-banana first (it keeps the picture). The owner's
 * Creature description ("Demonic woman human body with a mouth too large to be human…") was REFUSED by
 * nano-banana's safety filter, as a creature and as a person; Seedream drew her right once the writer had spelled
 * her out (below). Only three things go to the strongest model, nano-banana-pro (about 15¢): the ONE more go after
 * a look that missed, an EDIT ("Edit description"), and a human with a mood when the writer could not be had.
 *
 * …AND EACH LOOK IS CHECKED (character-look.ts): a writer reads the words into a brief before it is drawn, a
 * reader looks at what came back — everything the words state, nothing they did not ask for — and a picture
 * that misses is drawn ONCE more, told what. Still one of the day's free looks; both steps fail open. About
 * 1.5¢ a look on the Anthropic side, plus about 16¢ for the one more go when it is needed.
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
import { characterEditPrompt, characterPreviewPrompt, type CharBrief, type CharKind } from "./character-prompts";
import { CHARACTER_BRIEF_SCHEMA, STRONG_LADDER, characterBriefAsk, characterCheckAsk, characterEditCheckAsk, characterEditFix, characterFaults, characterFix, editFaults, keepSecond, keepSecondEdit, previewLadder, readCharacterBrief, readCharacterCheck, readCharacterEditCheck, type CharCheck, type EditCheck } from "./character-look";
import { storyPictureInput } from "./story-picture";

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

/** Should the premium model be asked when the everyday ones fail? Not when we were simply told to slow
 *  down — the next try on an everyday model will work, and the premium one costs four times as much. */
const worthThePremium = (e: unknown): boolean => !/\b429\b|rate.?limit|throttl/i.test(e instanceof Error ? e.message : String(e));

/** One picture, on `ladder` (character-look.ts → previewLadder for a first look; STRONG_LADDER for the one more
 *  go and for an edit), then — only when every rung FAILED rather than asked us to slow down — the premium
 *  model. Returns the picture's bytes. */
async function drawPreview(prompt: string, refUrl: string | undefined, kind: CharKind, ladder: ReadonlyArray<string>): Promise<Buffer> {
  let url = "";
  let last: unknown = null;
  for (const m of ladder) {
    try {
      url = await repRun(m, storyPictureInput(m, { prompt, refs: refUrl ? [refUrl] : [], aspect: "3:4" }), 150_000);
      break;
    } catch (e) {
      last = e;
      console.warn(`[character] a ${kind} preview failed on ${m.split("/")[1]}: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
    }
  }
  if (!url) {
    if (!worthThePremium(last)) throw last;
    // Both balk at some creatures, and they have outages of their own. The maker still gets their picture —
    // from the premium model, at our cost — rather than a dead end; logged, because it is the dear path.
    console.warn(`[character] everyday image models failed for a ${kind} preview — drawing it on the premium model`);
    url = await brandStill(prompt, refUrl, true);
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(3 * 60_000) });
  if (!res.ok) throw new Error(`preview fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error("the preview came back empty");
  return buf;
}

/* ---- THE TWO LOOKS (character-look.ts) — each FAILS OPEN, and neither may hold a maker up for long ---- */

/** `CHARACTER_LOOK=off` draws from the words alone, unread and unchecked (they still lead the prompt). */
const looksOn = (): boolean => (process.env.CHARACTER_LOOK || "").trim().toLowerCase() !== "off";
const BRIEF_MS = 15_000;
const CHECK_MS = 25_000;
/** `p`, or null once `ms` have passed (what it does after that is let go). */
const within = <T>(p: Promise<T>, ms: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); })]).finally(() => clearTimeout(timer));
};

/** BEFORE: the writer's brief from the maker's words — null when it cannot be had or is not fit to use. */
async function briefFor(kind: CharKind, desc: string, hasRef: boolean): Promise<CharBrief | null> {
  try {
    const { anthropicText } = await import("./anthropic.server");
    const ask = anthropicText(characterBriefAsk(kind, desc, hasRef), { model: "claude-sonnet-5", maxTokens: 800, jsonSchema: { name: "character_brief", schema: CHARACTER_BRIEF_SCHEMA } });
    ask.catch(() => { /* answered after we stopped waiting — nothing to do */ });
    const raw = await within(ask, BRIEF_MS);
    if (raw == null) { console.warn(`[character] the brief took longer than ${BRIEF_MS / 1000}s — drawing from the words alone`); return null; }
    const brief = readCharacterBrief(raw, kind, desc);
    if (!brief) console.warn("[character] the brief could not be used — drawing from the words alone");
    return brief;
  } catch (e) {
    console.warn(`[character] no brief (${e instanceof Error ? e.message.slice(0, 120) : e}) — drawing from the words alone`);
    return null;
  }
}

/** AFTER: what the reader sees in the picture against the words — null when it cannot say. */
async function checkPreview(buf: Buffer, kind: CharKind, desc: string, attributes: ReadonlyArray<string>): Promise<CharCheck | null> {
  try {
    const { anthropicVision } = await import("./anthropic.server");
    const ask = anthropicVision(characterCheckAsk(kind, desc, attributes), [`data:image/jpeg;base64,${buf.toString("base64")}`], { maxTokens: 700, model: "claude-sonnet-4-6" });
    ask.catch(() => { /* answered after we stopped waiting */ });
    const raw = await within(ask, CHECK_MS);
    return raw == null ? null : readCharacterCheck(raw);
  } catch (e) {
    console.warn(`[character] the preview could not be looked at, keeping it: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
    return null;
  }
}

const said = (c: CharCheck): string => [c.missing.length ? `missed ${c.missing.join(", ")}` : "", c.added.length ? `added ${c.added.join(", ")}` : ""].filter(Boolean).join("; ");

/** AN EDIT, looked at: the edit beside the look it was made from — still the same individual, the change there,
 *  nothing else changed. Null when it cannot say. */
async function checkEdit(edited: Buffer, was: Buffer, kind: CharKind, before: string, after: string): Promise<EditCheck | null> {
  try {
    const { anthropicVision } = await import("./anthropic.server");
    const ask = anthropicVision(characterEditCheckAsk(kind, before, after), [`data:image/jpeg;base64,${edited.toString("base64")}`, `data:image/jpeg;base64,${was.toString("base64")}`], { maxTokens: 500, model: "claude-sonnet-4-6" });
    ask.catch(() => { /* answered after we stopped waiting */ });
    const raw = await within(ask, CHECK_MS);
    return raw == null ? null : readCharacterEditCheck(raw);
  } catch (e) {
    console.warn(`[character] the edit could not be looked at, keeping it: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
    return null;
  }
}

/** "EDIT DESCRIPTION" (the owner, 2026-11-24: "I tried to edit her hair to blonde and it changed her face"): the
 *  look the maker saw is the reference, and only what the new words change is changed — drawn on the model that
 *  holds a face best, looked at beside the look it came from, and drawn once more when it is someone else. */
async function editPreview(o: { kind: CharKind; desc: string; edit: { file: string; desc: string } }, base: string, looks: boolean): Promise<Buffer> {
  const refUrl = `${base}/uploads/${o.edit.file}`;
  const prompt = characterEditPrompt(o.kind, o.edit.desc, o.desc);
  let buf = await drawPreview(prompt, refUrl, o.kind, STRONG_LADDER);
  let was: Buffer;
  try { was = fs.readFileSync(uploadPath(o.edit.file)); } catch { return buf; }
  if (!looks) return buf;
  const first = await checkEdit(buf, was, o.kind, o.edit.desc, o.desc);
  if (first && editFaults(first)) {
    try {
      const again = await drawPreview(`${prompt}${characterEditFix(first)}`, refUrl, o.kind, STRONG_LADDER);
      const second = await checkEdit(again, was, o.kind, o.edit.desc, o.desc);
      const keep = keepSecondEdit(first, second);
      if (keep) buf = again;
      console.log(`[character] an edit of a ${o.kind} ${first.same ? "" : "became someone else; "}${first.unasked.length ? `changed ${first.unasked.join(", ")}; ` : ""}${first.missing.length ? `missed ${first.missing.join(", ")}; ` : ""}drawn once more — showing the ${keep ? "second" : "first"}`);
    } catch (e) {
      console.warn(`[character] the edit's second go failed (${e instanceof Error ? e.message.slice(0, 120) : e}) — showing the first`);
    }
  }
  return buf;
}

/** Draw one preview. `refFile` is a picture already in the shop's upload space (see ownsUpload); `edit` is one of
 *  the shop's own previews being edited ("Edit description"), with the words it was drawn from. Returns the
 *  preview's file name in that same space. The caller has already TAKEN a preview with reservePreview() and
 *  gives it back if this throws. */
export async function makeCharacterPreview(o: { shopId: string; kind: CharKind; desc: string; refFile?: string; edit?: { file: string; desc: string } }): Promise<string> {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if ((o.refFile || o.edit) && !base) throw new Error("previews from a picture need SHOPIFY_APP_URL");
  const refUrl = o.refFile ? `${base}/uploads/${o.refFile}` : undefined;
  // the two looks are for words: a picture alone has nothing written to keep to
  const looks = looksOn() && o.desc.trim().length >= 8;
  let buf: Buffer;
  if (o.edit) buf = await editPreview({ kind: o.kind, desc: o.desc, edit: o.edit }, base, looks);
  else buf = await drawFresh(o.kind, o.desc, refUrl, looks);
  const name = uploadFileName(o.shopId, crypto.randomBytes(8).toString("hex"), "jpg", "mascot");
  fs.writeFileSync(uploadPath(name), buf);
  const l = readLedger(o.shopId);
  l.made[name] = { kind: o.kind, desc: o.desc, refFile: o.refFile || "", at: Date.now() };
  writeLedger(o.shopId, l);
  return name;
}

/** A preview drawn from the words (and the picture the maker added): the writer's brief, the draw, the look, and
 *  — when the look finds something missed or added — one more go. */
async function drawFresh(kind: CharKind, desc: string, refUrl: string | undefined, looks: boolean): Promise<Buffer> {
  const brief = looks ? await briefFor(kind, desc, !!refUrl) : null;
  const prompt = characterPreviewPrompt(kind, desc, !!refUrl, brief);
  let buf = await drawPreview(prompt, refUrl, kind, previewLadder({ kind, desc, hasRef: !!refUrl, brief: !!brief }));
  if (!looks) return buf;
  const first = await checkPreview(buf, kind, desc, brief?.attributes || []);
  if (first && characterFaults(first)) {
    // ONE more go, told what the first got wrong, on the model that does what it is told — the same free look;
    // whatever happens, a picture is shown
    try {
      const again = await drawPreview(`${prompt}${characterFix(first)}`, refUrl, kind, STRONG_LADDER);
      const second = await checkPreview(again, kind, desc, brief?.attributes || []);
      const keep = keepSecond(first, second);
      if (keep) buf = again;
      console.log(`[character] a ${kind} preview ${said(first)} — drawn once more${second ? (characterFaults(second) ? ` (${said(second)})` : " (all there)") : ""}; showing the ${keep ? "second" : "first"}`);
    } catch (e) {
      console.warn(`[character] the second go failed (${e instanceof Error ? e.message.slice(0, 120) : e}) — showing the first`);
    }
  }
  return buf;
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
