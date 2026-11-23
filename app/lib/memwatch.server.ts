/* HOW MUCH MEMORY THE SERVER IS REALLY USING — read, not guessed.
 *
 * "One job at a time" was decided on 2026-11-03 from a crash, not from a number: nobody could see how
 * much a render took. Jobs now run side by side in lanes (job-lanes.ts), and the only honest way to know
 * that is safe is to look. This reads what the platform itself holds against the limit: the container's
 * memory — this process AND its children (ffmpeg) — from the kernel's own files.
 *
 *   usedMb   what cannot be given back (process memory). The number that matters.
 *   cacheMb  file cache; the kernel drops it when it needs the room, so it is not a danger.
 *   limitMb  where the platform kills the instance.
 *   oomKills how many times the kernel has already killed something in here since the container started.
 *
 * Off Linux (a developer's machine) the files are not there and every container figure is null; the
 * process's own figure is always given. Numbers only — nothing about anybody's content. */
import fs from "node:fs";

const MB = 1024 * 1024;
const V2 = "/sys/fs/cgroup";
const V1 = "/sys/fs/cgroup/memory";

function readText(file: string): string | null {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}

/** A file that holds one number (bytes). "max" — no limit — and anything unreadable are null. */
export function oneNumber(text: string | null): number | null {
  if (text == null) return null;
  const n = Number(text.trim());
  // an unlimited v1 group reports a number near 2^63
  return Number.isFinite(n) && n >= 0 && n < 1e15 ? n : null;
}

/** One `key value` line out of a kernel stat file. */
export function statLine(text: string | null, key: string): number | null {
  if (text == null) return null;
  for (const line of text.split("\n")) {
    const [k, v] = line.trim().split(/\s+/);
    if (k === key) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  }
  return null;
}

const mb = (bytes: number | null): number | null => (bytes == null ? null : Math.round(bytes / MB));

export type MemoryNow = { usedMb: number | null; cacheMb: number | null; limitMb: number | null; oomKills: number | null; nodeMb: number };

export function memoryNow(): MemoryNow {
  const stat2 = readText(`${V2}/memory.stat`);
  const stat1 = stat2 == null ? readText(`${V1}/memory.stat`) : null;
  const used = statLine(stat2, "anon") ?? statLine(stat1, "total_rss") ?? statLine(stat1, "rss");
  const cache = statLine(stat2, "file") ?? statLine(stat1, "total_cache") ?? statLine(stat1, "cache");
  const limit = oneNumber(readText(`${V2}/memory.max`)) ?? oneNumber(readText(`${V1}/memory.limit_in_bytes`));
  const kills = statLine(readText(`${V2}/memory.events`), "oom_kill") ?? statLine(readText(`${V1}/memory.oom_control`), "oom_kill");
  return { usedMb: mb(used), cacheMb: mb(cache), limitMb: mb(limit), oomKills: kills, nodeMb: Math.round(process.memoryUsage().rss / MB) };
}

/* THE HIGH-WATER MARKS. A reading "now" says nothing about the moment that matters — the middle of an
 * encode nobody was watching. So the figure is sampled every few seconds and the highest of each minute
 * is kept for the last half hour, with the highest since the process started. */
export const SAMPLE_MS = 5000;
export const KEEP_MINUTES = 30;

export type Minute = { at: string; peakMb: number };

/** Fold one sample into the per-minute list (newest last). Pure, so it can be tested. */
export function foldSample(minutes: Minute[], when: Date, mbNow: number, keep = KEEP_MINUTES): Minute[] {
  const at = when.toISOString().slice(0, 16) + "Z";
  const last = minutes[minutes.length - 1];
  const next = last && last.at === at
    ? [...minutes.slice(0, -1), { at, peakMb: Math.max(last.peakMb, mbNow) }]
    : [...minutes, { at, peakMb: mbNow }];
  return next.slice(-keep);
}

let minutes: Minute[] = [];
let peak: { mb: number; at: string } | null = null;
let started = false;

function sample(): void {
  try {
    const now = memoryNow();
    const figure = now.usedMb ?? now.nodeMb;
    const when = new Date();
    minutes = foldSample(minutes, when, figure);
    if (!peak || figure > peak.mb) peak = { mb: figure, at: when.toISOString() };
  } catch { /* a reading that fails is skipped; it must never take the worker down */ }
}

/** Start sampling (once). The timer does not keep the process alive. */
export function startMemoryWatch(): void {
  if (started) return;
  started = true;
  sample();
  const t = setInterval(sample, SAMPLE_MS);
  if (typeof t.unref === "function") t.unref();
}

/** For the status page. */
export function memoryReport(): MemoryNow & { peakMb: number | null; peakAt: string | null; lastMinutes: Minute[] } {
  return { ...memoryNow(), peakMb: peak?.mb ?? null, peakAt: peak?.at ?? null, lastMinutes: minutes };
}
