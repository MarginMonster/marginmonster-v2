/* Character kits for a merchant's OWN presenters — the server half of presenter-kit-core.ts.
 *
 * The stock cast's kits are static files (public/kits/, built by scripts/build-presenter-kits.ts). A
 * custom presenter's are made here and kept on the renders disk next to its portraits:
 *
 *   kit<id>-o0…3.webp          the four portraits with the background removed — a tenth of a cent each,
 *                              made automatically for every custom presenter.
 *   kit<id>-[<look>-]s00…59    one full-body rotation PER OUTFIT (a PresenterSpin row each) — the "3D
 *                              view". About $0.47 of generation apiece.
 *
 * WHO PAYS FOR A 3D VIEW (plan-config.ts has the arithmetic — creation is priced to break even):
 *   - A presenter created now has all four paid for in the creation price (CustomAvatar.spinPaid is the
 *     tokens-per-outfit that price covered), so they are built as soon as the portraits exist.
 *   - A presenter made before 3D views existed has none; its owner adds one outfit at a time for
 *     TOKEN_COST.avatarSpin (admin accounts: free, like every feature still being built).
 *   - A view that cannot be made — two turns in a row that weren't a real rotation, a provider that
 *     refuses the picture — is refunded, once, to the bucket it was paid from.
 *
 * Everything runs in the background of this process and records its progress in the database, so a page
 * that is polling — or a different page tomorrow — sees the same truth. */

import { AsyncLocalStorage } from "node:async_hooks";
import { charKindOf, characterContinuity } from "./character-prompts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "../db.server";
import { mirrorRender } from "./object-storage.server";
import { isAdminEmail } from "./admin.server";
import { ffmpegBin, ffprobeBin } from "./ugc-ad-pipeline.server";
import { ffmpegTurnAlways } from "./ffmpeg-turn";
import { refundTokens, spendTokens } from "./tokens.server";
import { TOKEN_COST } from "./plan-config";
import { portraitFilesOf } from "./custom-avatars.server";
import { lookPrefix } from "./presenter-kits";
import { cutOutPortrait, measureTurn, spinFrames, spinSources, type KitTools } from "./presenter-kit-core";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
/** The builds THIS process is working on or has queued ("<presenter>:<outfit>"). A row that says
 *  "building" but isn't in here was being built by a process that has since been replaced by a deploy
 *  — after a few minutes' grace (the old instance overlaps the new one briefly) it is started again.
 *  Judged by this, not by the clock alone: with many outfits queued behind the two that generate at
 *  once, a perfectly healthy build can sit in "building" for an hour, and restarting it would pay for
 *  the same view twice. */
const alive = new Set<string>();
const aliveKey = (avatarId: string, look: number) => `${avatarId}:${look}`;
const ORPHAN_GRACE_MS = 4 * 60_000;

export const kitPrefix = (rowId: string) => `kit${rowId}-`;

/** Admin accounts build 3D views free (everything still being built is free for them). */
export function spinsAreFree(account: { email?: string | null }): boolean {
  return isAdminEmail(account.email);
}

export function spinIsStale(r: { avatarId: string; look: number; state: string; startedAt: Date }): boolean {
  return r.state === "building" && !alive.has(aliveKey(r.avatarId, r.look)) && Date.now() - r.startedAt.getTime() > ORPHAN_GRACE_MS;
}

function tools(tag: string): KitTools {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("[kit] REPLICATE_API_TOKEN not set");
  return { token, ffmpeg: ffmpegBin(), ffprobe: ffprobeBin(), log: (m) => console.log(`[kit] ${tag}: ${m}`), lane: oneAtATime, turn: (run) => ffmpegTurnAlways(run) };
}

/** Anything that runs ffmpeg goes through here, one at a time: this process shares the box with the
 *  render worker, and two ffmpeg runs side by side is how this instance has run out of memory before.
 *  Every single ffmpeg run of a build also comes through here (KitTools.lane) — the matting passes run
 *  while two builds may be generating at once. Re-entrant: a job already holding the lane (spinFrames
 *  inside a lane job) runs its own ffmpeg steps directly instead of queueing behind itself. */
const holdingLane = new AsyncLocalStorage<true>();
let chain: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  if (holdingLane.getStore()) return job();
  const go = () => holdingLane.run(true, job);
  const run = chain.then(go, go);
  chain = run.catch(() => undefined);
  return run;
}

/** The generated part of a rotation is minutes of WAITING on a provider, so two may wait at once. */
const GENERATING_AT_ONCE = 2;
let generating = 0;
const waiters: Array<() => void> = [];
async function generationSlot<T>(job: () => Promise<T>): Promise<T> {
  if (generating >= GENERATING_AT_ONCE) await new Promise<void>((go) => waiters.push(go));
  generating++;
  try { return await job(); }
  finally { generating--; waiters.shift()?.(); }
}

async function mirror(file: string): Promise<void> {
  try { await mirrorRender(path.basename(file), fs.readFileSync(file)); } catch { /* the disk copy is what is served; the mirror is the backup */ }
}

/* ---------- portrait cut-outs ---------- */

const cutting = new Set<string>();
/** When a presenter's cut-outs last failed — so a problem that won't fix itself (a portrait that is no
 *  longer on the disk, the provider down) is retried every ten minutes, not on every page refresh. */
const cutFailedAt = new Map<string, number>();
const CUT_RETRY_MS = 10 * 60_000;

/** Bring this shop's presenters' kits up to date, in the background: any missing portrait cut-out, any
 *  3D view the creation price paid for that hasn't been started, any build that died with a restart.
 *  Returns at once with the ids of the presenters whose cut-outs are being made, so the page knows
 *  whether there is anything to wait for. Safe to call on every page load. */
export async function ensureKits(shopId: string): Promise<Set<string>> {
  const working = new Set<string>();
  if (!process.env.REPLICATE_API_TOKEN) return working;
  const rows = await db.customAvatar.findMany({ where: { shopId, status: "ready" }, include: { spins: true } });
  for (const row of rows) {
    const files = portraitFilesOf(row);

    // the 3D views
    for (let look = 0; look < files.length; look++) {
      const have = row.spins.find((s) => s.look === look);
      if (!have && row.spinPaid > 0) {
        await startSpin(row, look, { paid: row.spinPaid, paidExtra: row.spinPaidExtra });
      } else if (have && spinIsStale(have)) {
        // it was paid for (or free) when it started; the restart that killed it is not the merchant's bill
        await startSpin(row, look, { paid: have.paid, paidExtra: have.paidExtra });
      }
    }

    // the cut-outs
    if (row.cuts >= files.length) continue;
    if (cutting.has(row.id)) { working.add(row.id); continue; }
    if (Date.now() - (cutFailedAt.get(row.id) || 0) < CUT_RETRY_MS) continue;
    cutting.add(row.id);
    working.add(row.id);
    void oneAtATime(async () => {
      try {
        const t = tools(`${row.name} cut-outs`);
        for (let i = row.cuts; i < files.length; i++) {
          const src = path.join(RENDERS(), files[i]);
          if (!fs.existsSync(src)) throw new Error(`portrait ${files[i]} is not on the disk`);
          const out = path.join(RENDERS(), `${kitPrefix(row.id)}o${i}.webp`);
          await cutOutPortrait(t, src, out, path.join(os.tmpdir(), "kit-cuts"));
          await mirror(out);
          await db.customAvatar.update({ where: { id: row.id }, data: { cuts: i + 1 } });
        }
        cutFailedAt.delete(row.id);
      } catch (e) {
        cutFailedAt.set(row.id, Date.now());
        console.error(`[kit] ${row.name}: cut-outs failed (next try in 10 min) — ${e instanceof Error ? e.message : e}`);
      } finally {
        cutting.delete(row.id);
      }
    });
  }
  return working;
}

/* ---------- the 3D views (one full-body rotation per outfit) ---------- */

type Started = "started" | "building" | "ready" | "missing";

/** Start building the 3D view of ONE outfit. `pay` is what it was paid with (recorded on the row, so a
 *  failure knows what to give back). Says what happened in a word; the build runs in the background
 *  (about three minutes) and the row carries its state. */
async function startSpin(
  row: { id: string; name: string; files: string },
  look: number,
  pay: { paid: number; paidExtra: number },
): Promise<Started> {
  const portrait = portraitFilesOf(row)[look];
  if (!portrait) return "missing";
  const have = await db.presenterSpin.findUnique({ where: { avatarId_look: { avatarId: row.id, look } } });
  if (have?.state === "ready") return "ready";
  if (have?.state === "building" && !spinIsStale(have)) return "building";
  // Claim it. A new row is claimed by the unique (presenter, outfit) pair; a failed or abandoned one by
  // an update pinned on what we just read — either way two tabs asking at once start ONE build.
  if (!have) {
    try { await db.presenterSpin.create({ data: { avatarId: row.id, look, state: "building", paid: pay.paid, paidExtra: pay.paidExtra } }); }
    catch { return "building"; }
  } else {
    const claimed = await db.presenterSpin.updateMany({
      where: { id: have.id, state: have.state, startedAt: have.startedAt },
      data: { state: "building", startedAt: new Date(), error: null, paid: pay.paid, paidExtra: pay.paidExtra, refundedAt: null },
    });
    if (claimed.count !== 1) return "building";
  }
  alive.add(aliveKey(row.id, look));
  void runSpin(row.id, row.name, portrait, look);
  return "started";
}

/** A merchant asks for the 3D view of one outfit of one of their presenters. Charged first (free for
 *  admin accounts), given straight back if there turned out to be nothing to build. Throws the wallet's
 *  own "not enough tokens" message. */
export async function buySpin(shopId: string, rowId: string, look: number, free: boolean): Promise<Started> {
  const row = await db.customAvatar.findFirst({ where: { id: rowId, shopId, status: "ready" } });
  if (!row || !portraitFilesOf(row)[look]) return "missing";
  // don't take tokens for something that is already there or already on its way
  const have = await db.presenterSpin.findUnique({ where: { avatarId_look: { avatarId: row.id, look } } });
  if (have?.state === "ready") return "ready";
  if (have?.state === "building" && !spinIsStale(have)) return "building";
  const cost = free ? 0 : TOKEN_COST.avatarSpin;
  const fromExtra = cost > 0 ? (await spendTokens(shopId, cost)).fromExtra : 0;
  let result: Started;
  try {
    result = await startSpin(row, look, { paid: cost, paidExtra: fromExtra });
  } catch (e) {
    if (cost > 0) await refundTokens(shopId, cost, fromExtra);
    throw e;
  }
  // someone else's click won the race for this outfit — this one bought nothing
  if (result !== "started" && cost > 0) await refundTokens(shopId, cost, fromExtra);
  return result;
}

/** Give back what a failed view was paid with — exactly once, however many paths notice the failure. */
async function refundSpinOnce(rowId: string, look: number): Promise<void> {
  try {
    const spin = await db.presenterSpin.findUnique({ where: { avatarId_look: { avatarId: rowId, look } }, include: { avatar: { select: { shopId: true, name: true } } } });
    if (!spin || spin.state !== "failed" || spin.paid <= 0 || spin.refundedAt) return;
    const claimed = await db.presenterSpin.updateMany({ where: { id: spin.id, state: "failed", refundedAt: null }, data: { refundedAt: new Date() } });
    if (claimed.count !== 1) return; // another path is refunding this one
    try {
      await refundTokens(spin.avatar.shopId, spin.paid, spin.paidExtra);
      console.log(`[kit] ${spin.avatar.name} outfit ${look}: refunded ${spin.paid} tokens for a 3D view that could not be made`);
    } catch (e) {
      // put the claim back so the debt is still on record and a later pass can pay it
      await db.presenterSpin.updateMany({ where: { id: spin.id }, data: { refundedAt: null } }).catch(() => undefined);
      console.error(`[kit] SPIN REFUND FAILED — shop ${spin.avatar.shopId} is owed ${spin.paid} tokens: ${e instanceof Error ? e.message : e}`);
    }
  } catch (e) {
    console.error(`[kit] refund check failed: ${e instanceof Error ? e.message : e}`);
  }
}

async function runSpin(rowId: string, name: string, portrait: string, look: number): Promise<void> {
  const tag = `${name} outfit ${look}`;
  const tmp = path.join(os.tmpdir(), `kit-${rowId}-${look}`);
  const prefix = `${kitPrefix(rowId)}${lookPrefix(look)}`;
  const at = { avatarId_look: { avatarId: rowId, look } };
  const fail = async (msg: string) => {
    console.error(`[kit] ${tag}: 3D view failed — ${msg}`);
    // the frames of a turn that was refused must not be left where a later page could show them
    try { for (const f of fs.readdirSync(RENDERS())) if (f.startsWith(`${prefix}s`)) fs.rmSync(path.join(RENDERS(), f), { force: true }); } catch { /* nothing to clean */ }
    await db.presenterSpin.update({ where: at, data: { state: "failed", error: msg.slice(0, 400) } }).catch(() => { /* the presenter may have been deleted meanwhile */ });
    await refundSpinOnce(rowId, look);
  };
  try {
    const src = path.join(RENDERS(), portrait);
    if (!fs.existsSync(src)) return await fail("the presenter's portrait is not on the disk");
    const t = tools(tag);
    // A cartoon or a creature is drawn and cut out differently from a person (see presenter-kit-core).
    const owner = await db.customAvatar.findUnique({ where: { id: rowId }, select: { kind: true, desc: true } });
    const kind = charKindOf(owner?.kind);
    const lookOf = kind === "person" ? undefined : { kind, continuity: characterContinuity(kind, owner?.desc || "") };
    let lastWhy = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const sources = await generationSlot(() => spinSources(t, { portrait: src, tmpDir: tmp, look: lookOf }));
      const { spin, check } = await oneAtATime(async () => {
        const made = await spinFrames(t, sources.turnFile, sources.matteFile, RENDERS(), prefix);
        // Is it one real rotation — not half-way-and-back, and not a flip that never shows their back?
        // Measured on the frames (see turnShape) and logged either way, so a refusal can be checked by eye.
        return { spin: made, check: await measureTurn(t, RENDERS(), prefix, made) };
      });
      const why = `surface slides ${(check.first * 100).toFixed(2)}% then ${(check.second * 100).toFixed(2)}% of its width a frame, back ${check.back.toFixed(2)}x the front`;
      console.log(`[kit] ${tag}: turn check — ${why} → ${check.full ? `a full turn, dir ${check.dir}` : "NOT a full turn"}`);
      if (check.full) {
        for (let i = 0; i < spin.frames; i++) await mirror(path.join(RENDERS(), `${prefix}s${String(i).padStart(2, "0")}.webp`));
        await db.presenterSpin.update({
          where: at,
          data: { state: "ready", error: null, frames: spin.frames, frameW: spin.w, frameH: spin.h, dir: check.dir },
        });
        return;
      }
      lastWhy = why;
      // keep the still, throw the turn away, and ask for another one
      fs.rmSync(sources.turnFile, { force: true });
      fs.rmSync(sources.matteFile, { force: true });
    }
    await fail(`the turn didn't come out as one full rotation twice (${lastWhy})`);
  } catch (e) {
    await fail(e instanceof Error ? e.message : String(e));
  } finally {
    alive.delete(aliveKey(rowId, look));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
