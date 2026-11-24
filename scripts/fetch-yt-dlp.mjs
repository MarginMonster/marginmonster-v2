/* yt-dlp, for the Lyric Video's "paste a YouTube link" (the owner's decision, 2026-11-24: "use YouTube link but
 * include regulatory things like 'you must have permissions from song owner'" — the asking is in the app:
 * api.lyric-video.tsx, lyric-video.server.ts → songFromLink).
 *
 * Run by the Dockerfile, as the image is built (`node scripts/fetch-yt-dlp.mjs || true`):
 *   yt-dlp   the NEWEST release (YouTube changes its pages often and an old yt-dlp stops working; every deploy
 *            builds a fresh image), the standalone Linux build — no Python in the image
 *   Deno     YouTube's pages now need a JavaScript runtime to be read (yt-dlp's "EJS"): Node must be 22 or newer
 *            and the image's is 20, so Deno (2.3 or newer; yt-dlp uses it by default when it is on the PATH)
 * Each file is checked against the SHA-256 its own release publishes before it is installed. Nothing here can
 * fail the build: without them, a pasted link is answered "upload the song file instead".
 *
 * usage: node scripts/fetch-yt-dlp.mjs [install dir, default /usr/local/bin] */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";

const DIR = process.argv[2] || "/usr/local/bin";
const arm = process.arch === "arm64";
const YT = { base: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/", file: arm ? "yt-dlp_linux_aarch64" : "yt-dlp_linux", sums: "SHA2-256SUMS" };
const DENO = { base: "https://github.com/denoland/deno/releases/latest/download/", file: `deno-${arm ? "aarch64" : "x86_64"}-unknown-linux-gnu.zip` };

const say = (s) => console.log(`[fetch-yt-dlp] ${s}`);
async function get(url) {
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
/** The hash a checksum list gives a file ("<hex>  <name>" lines; a one-file list may be the hex alone). */
function hashFor(list, name) {
  for (const line of list.toString("utf8").split(/\r?\n/)) {
    const [hex, file] = line.trim().split(/\s+\*?/);
    if (/^[a-f0-9]{64}$/i.test(hex || "") && (!file || file === name)) return hex.toLowerCase();
  }
  return null;
}
function checked(buf, list, name) {
  const want = hashFor(list, name);
  const got = sha256(buf);
  if (!want) throw new Error(`no checksum for ${name}`);
  if (want !== got) throw new Error(`${name}: checksum ${got.slice(0, 12)}… is not the published ${want.slice(0, 12)}…`);
  return got;
}
/** The one file a zip holds (Deno's release is a single binary) — read with zlib, no unzip in the image. */
function unzipOne(zip) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip");
  const cd = zip.readUInt32LE(eocd + 16);
  if (zip.readUInt32LE(cd) !== 0x02014b50) throw new Error("zip directory not found");
  const method = zip.readUInt16LE(cd + 10), size = zip.readUInt32LE(cd + 20), full = zip.readUInt32LE(cd + 24);
  const local = zip.readUInt32LE(cd + 42);
  if (size === 0xffffffff || full === 0xffffffff || local === 0xffffffff) throw new Error("zip64 is not read here");
  if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error("zip entry not found");
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const data = zip.subarray(start, start + size);
  const out = method === 8 ? zlib.inflateRawSync(data) : method === 0 ? Buffer.from(data) : null;
  if (!out) throw new Error(`zip method ${method} is not read here`);
  if (out.length !== full) throw new Error(`unzipped ${out.length} bytes, not ${full}`);
  return out;
}
function install(name, buf) {
  const to = path.join(DIR, name);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${to}.new`, buf, { mode: 0o755 });
  fs.renameSync(`${to}.new`, to);
  return to;
}
const version = (bin, arg) => { try { return (spawnSync(bin, [arg], { encoding: "utf8", timeout: 60_000 }).stdout || "").split(/\r?\n/)[0].trim(); } catch { return ""; } };

if (process.platform !== "linux") {
  say("not Linux — nothing installed (a link is answered \"upload the song file instead\" here)");
  process.exit(0);
}

try {
  const [bin, sums] = await Promise.all([get(YT.base + YT.file), get(YT.base + YT.sums)]);
  const h = checked(bin, sums, YT.file);
  const to = install("yt-dlp", bin);
  say(`yt-dlp ${version(to, "--version") || "(version not read)"} → ${to} (${(bin.length / 1e6).toFixed(1)} MB, sha256 ${h.slice(0, 12)}…)`);
} catch (e) {
  say(`yt-dlp NOT installed — links will ask for the file: ${e?.message || e}`);
}

try {
  const [zip, sum] = await Promise.all([get(DENO.base + DENO.file), get(`${DENO.base}${DENO.file}.sha256sum`)]);
  const h = checked(zip, sum, DENO.file);
  const to = install("deno", unzipOne(zip));
  say(`${version(to, "--version") || "deno (version not read)"} → ${to} (zip sha256 ${h.slice(0, 12)}…)`);
} catch (e) {
  say(`Deno NOT installed — YouTube may refuse yt-dlp without a JavaScript runtime: ${e?.message || e}`);
}
