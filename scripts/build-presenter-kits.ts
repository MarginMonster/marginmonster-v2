/* Build the STOCK cast's character kits (see app/lib/presenter-kit-core.ts) into public/kits/<id>/ and
 * record them in app/lib/presenter-kits.json. Run on a developer machine — the files are committed, so
 * production never spends anything on the stock cast and every merchant sees them instantly.
 *
 *   npx vite-node scripts/build-presenter-kits.ts -- [--spin] [--cuts] [--look N] [--respin] [--reframe] [--tmp <dir>] [--jobs 3] [id …]
 *
 *   --spin    only the full-body rotations       --cuts   only the portrait cut-outs   (default: both)
 *   --look N  only outfit N (0 = Casual … 3 = Street); default: every outfit the presenter has a portrait for
 *   --respin  throw away the turn (keep the still) and roll a new one — for a turn the check below says
 *             is not one full rotation, or one that looks wrong
 *   --reframe cut the frames again from the turn already saved in --tmp (free — no generation), after a
 *             change to how frames are picked or cropped
 *   --tmp     where the intermediate still / turn / mask / contact sheet are kept (default: the OS temp dir)
 *   no ids    = every live presenter plus the private cast
 *
 * A step whose output is already there is skipped.
 *
 * Every rotation is MEASURED as it is built (measureTurn): a true full turn gets its direction written
 * to "dir" (1 / -1) in presenter-kits.json; one that turned half-way and came back gets "dir": 0 and is
 * not shown to anyone until it is re-rolled. Still LOOK at the contact sheet (<tmp>/<id>/sheet.jpg, or
 * <tmp>/<id>/look<N>/sheet.jpg) before committing — the measurement knows it is a full turn, not whether
 * the clothes stayed the same on the way round.
 *
 * REPLICATE_API_TOKEN is read from .env and never printed. About $0.43 a rotation (2026-11). */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LIVE_AVATARS, PRIVATE_AVATARS, AVATAR_BY_ID, OUTFITS } from "../app/lib/avatars";
import { lookPrefix, type SpinMeta } from "../app/lib/presenter-kits";
import { buildSpin, cutOutPortrait, measureTurn, spinFrames, spinSheet, type KitSpin, type KitTools } from "../app/lib/presenter-kit-core";

const root = process.cwd();
const envFile = path.join(root, ".env");
const env: Record<string, string> = {};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const token = process.env.REPLICATE_API_TOKEN || env.REPLICATE_API_TOKEN || "";

const argv = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string) => argv.includes(name);
const value = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const valued = new Set(["--tmp", "--jobs", "--look"]);
const ids = argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1]));
const reframe = flag("--reframe");
const respin = flag("--respin");
const doSpin = flag("--spin") || respin || reframe || !flag("--cuts");
const doCuts = flag("--cuts") || !(flag("--spin") || respin || reframe);
const onlyLook = value("--look") === undefined ? null : Math.max(0, Math.min(OUTFITS.length - 1, parseInt(value("--look") as string, 10) || 0));
const tmpRoot = path.resolve(value("--tmp") || path.join(os.tmpdir(), "easymode-kits"));
const jobs = Math.max(1, Math.min(6, parseInt(value("--jobs") || "3", 10) || 3));
if (!token && !(reframe && !doCuts)) { console.error("REPLICATE_API_TOKEN is not set (.env)"); process.exit(1); }

const cast = ids.length ? ids : [...LIVE_AVATARS.map((a) => a.id), ...PRIVATE_AVATARS.map((a) => a.id)];
const manifestFile = path.join(root, "app", "lib", "presenter-kits.json");
type Entry = { cuts?: number; v?: number; spins?: Array<SpinMeta | null> };
const readManifest = (): Record<string, Entry> => { try { return JSON.parse(fs.readFileSync(manifestFile, "utf8")); } catch { return {}; } };
// Several rotations build at once; each re-reads the file before writing its own part so none is lost.
const record = (id: string, change: (e: Entry) => Entry) => {
  const all = readManifest();
  all[id] = change(all[id] || {});
  const sorted = Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]]));
  fs.writeFileSync(manifestFile, JSON.stringify(sorted, null, 2) + "\n");
};
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;

async function one(id: string, look: number | null): Promise<void> {
  const avatar = AVATAR_BY_ID[id];
  if (!avatar) throw new Error(`unknown presenter "${id}"`);
  const tag = look === null ? id : `${id} ${OUTFITS[look].label.toLowerCase()}`;
  const tools: KitTools = { token, ffmpeg: "ffmpeg", ffprobe: "ffprobe", log: (m) => console.log(`  [${tag}] ${m}`) };
  const outDir = path.join(root, "public", "kits", id);
  const portrait = (v: number) => path.join(root, "public", "avatars", `${id}_${v}.jpg`);
  if (look === null) {
    // the cut-outs: one job per presenter
    let made = 0;
    for (let v = 0; v < OUTFITS.length; v++) {
      const out = path.join(outDir, `o${v}.webp`);
      if (fs.existsSync(out)) { made++; continue; }
      if (!fs.existsSync(portrait(v))) continue;
      await cutOutPortrait(tools, portrait(v), out, path.join(tmpRoot, id));
      made++;
    }
    record(id, (e) => ({ ...e, cuts: made, v: e.v || 1, spins: e.spins || [] }));
    console.log(`[${id}] ${made} portrait cut-outs`);
    return;
  }
  // one rotation: this presenter in this outfit
  const prefix = lookPrefix(look);
  const tmpDir = look === 0 ? path.join(tmpRoot, id) : path.join(tmpRoot, id, `look${look}`);
  const turn = path.join(tmpDir, "turn.mp4");
  const matte = path.join(tmpDir, "matte.mp4");
  const built = fs.existsSync(path.join(outDir, `${prefix}s00.webp`)) && !!readManifest()[id]?.spins?.[look]?.n;
  if (built && !respin && !reframe) { console.log(`[${tag}] rotation already built — skipping`); return; }
  let spin: KitSpin;
  if (reframe) {
    if (!fs.existsSync(turn) || !fs.existsSync(matte)) { console.log(`[${tag}] no saved turn in ${tmpDir} to cut again — skipping`); return; }
    spin = await spinFrames(tools, turn, matte, outDir, prefix);
  } else {
    if (respin) for (const f of [turn, matte, path.join(tmpDir, "sheet.jpg")]) fs.rmSync(f, { force: true });
    spin = await buildSpin(tools, { portrait: portrait(look), outDir, prefix, tmpDir, look: { continuity: avatar.continuity } });
  }
  await spinSheet(tools, outDir, prefix, spin, path.join(tmpDir, "sheet.jpg"), 12);
  const shape = await measureTurn(tools, outDir, prefix, spin);
  record(id, (e) => {
    const spins = [...(e.spins || [])];
    while (spins.length <= look) spins.push(null);
    spins[look] = { n: spin.frames, w: spin.w, h: spin.h, dir: shape.full ? shape.dir : 0 };
    // frames replaced under the same names → a new version, so no browser keeps the old ones
    return { ...e, cuts: e.cuts || 0, v: built ? (e.v || 1) + 1 : e.v || 1, spins };
  });
  console.log(`[${tag}] rotation: ${spin.frames} frames ${spin.w}x${spin.h}, slides ${pct(shape.first)} then ${pct(shape.second)} of its width a frame → ${shape.full ? `a full turn (dir ${shape.dir})` : "NOT a full turn — re-roll it with --respin"}`);
}

// the work list: a presenter's cut-outs, then one entry per outfit that has a portrait
const queue: Array<{ id: string; look: number | null }> = [];
for (const id of cast) {
  if (doCuts) queue.push({ id, look: null });
  if (doSpin) {
    for (let v = 0; v < OUTFITS.length; v++) {
      if (onlyLook !== null && v !== onlyLook) continue;
      if (fs.existsSync(path.join(root, "public", "avatars", `${id}_${v}.jpg`))) queue.push({ id, look: v });
    }
  }
}
const failed: string[] = [];
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  for (;;) {
    const job = queue.shift();
    if (!job) return;
    try { await one(job.id, job.look); }
    catch (e) { failed.push(`${job.id}${job.look === null ? "" : `/${job.look}`}`); console.error(`[${job.id}${job.look === null ? "" : ` look ${job.look}`}] FAILED: ${e instanceof Error ? e.message : e}`); }
  }
}));
const kits = readManifest();
const notFull = cast.flatMap((id) => (kits[id]?.spins || []).map((m, v) => (m && m.n && m.dir !== 1 && m.dir !== -1 ? `${id}/${v}` : "")).filter(Boolean));
if (notFull.length) console.log(`not a full turn yet: ${notFull.join(" ")}`);
console.log(failed.length ? `done — FAILED: ${failed.join(", ")}` : "done");
process.exit(failed.length ? 1 : 0);
