/* yt-dlp, for the Lyric Video's "paste a YouTube link" (the owner's decision, 2026-11-24: "use YouTube link but
 * include regulatory things like 'you must have permissions from song owner'" — the asking is in the app:
 * api.lyric-video.tsx, lyric-video.server.ts → songFromLink).
 *
 * Run by the Dockerfile, as the image is built (`node scripts/fetch-yt-dlp.mjs || true`):
 *   yt-dlp      the NEWEST release (YouTube changes its pages often and an old yt-dlp stops working; every deploy
 *               builds a fresh image), the standalone Linux build — no Python in the image
 *   Deno        YouTube's pages now need a JavaScript runtime to be read (yt-dlp's "EJS"): Node must be 22 or newer
 *               and the image's is 20, so Deno (2.3 or newer; yt-dlp uses it by default when it is on the PATH)
 *   bgutil-pot  YouTube refuses cloud servers ("Sign in to confirm you're not a bot" — seen from our server on the
 *               first live try, 2026-11-24). A PO token from BotGuard is the free answer the PO Token Guide gives
 *               (github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide); its makers say it does not ALWAYS get past the check.
 *               The Rust build is one program (the original needs git, a canvas build and Node 22): the program
 *               and its yt-dlp plugin, PINNED to v0.8.1, each checked against the SHA-256 GitHub lists for it.
 * Each file is checked against a published SHA-256 before it is installed. Nothing here can fail the build: without
 * them, a pasted link is answered "upload the song file instead".
 *
 * usage: node scripts/fetch-yt-dlp.mjs [install dir, default /usr/local/bin] [plugin dir, default /etc/yt-dlp/plugins] */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";

const DIR = process.argv[2] || "/usr/local/bin";
const PLUGINS = process.argv[3] || "/etc/yt-dlp/plugins";
const arm = process.arch === "arm64";
const YT = { base: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/", file: arm ? "yt-dlp_linux_aarch64" : "yt-dlp_linux", sums: "SHA2-256SUMS" };
const DENO = { base: "https://github.com/denoland/deno/releases/latest/download/", file: `deno-${arm ? "aarch64" : "x86_64"}-unknown-linux-gnu.zip` };
/** The PO-token program and its plugin — pinned: a release and the SHA-256 GitHub lists for each of its files. */
const POT = {
  base: "https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/download/v0.8.1/",
  bin: arm
    ? { name: "bgutil-pot-linux-aarch64", sha256: "4f4a1f681dba45e695e1c14d314517da180a1fd374afd09d634fd80ef6d0284b" }
    : { name: "bgutil-pot-linux-x86_64", sha256: "e7c264a574fa2705b6e5dc62283a8a4e80130f27b9d7e9df44e6b09aa6151a87" },
  plugin: { name: "bgutil-ytdlp-pot-provider-rs.zip", sha256: "99fd83b98fa93b193d6a3b69dc74410d76e7a2b889868c54d16121cac9060344" },
  pkg: "bgutil-ytdlp-pot-provider-rs",
};

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
/** Every file a zip holds, read with zlib (no unzip in the image). */
function unzipAll(zip) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip");
  const count = zip.readUInt16LE(eocd + 10);
  let cd = zip.readUInt32LE(eocd + 16);
  const files = [];
  for (let k = 0; k < count; k++) {
    if (zip.readUInt32LE(cd) !== 0x02014b50) throw new Error("zip directory not found");
    const method = zip.readUInt16LE(cd + 10), size = zip.readUInt32LE(cd + 20), full = zip.readUInt32LE(cd + 24);
    const n = zip.readUInt16LE(cd + 28), m = zip.readUInt16LE(cd + 30), c = zip.readUInt16LE(cd + 32);
    const local = zip.readUInt32LE(cd + 42);
    const name = zip.subarray(cd + 46, cd + 46 + n).toString("utf8");
    cd += 46 + n + m + c;
    if (size === 0xffffffff || full === 0xffffffff || local === 0xffffffff) throw new Error("zip64 is not read here");
    if (name.endsWith("/")) continue;
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error("zip entry not found");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    const out = method === 8 ? zlib.inflateRawSync(data) : method === 0 ? Buffer.from(data) : null;
    if (!out) throw new Error(`zip method ${method} is not read here`);
    if (out.length !== full) throw new Error(`${name}: unzipped ${out.length} bytes, not ${full}`);
    files.push({ name, data: out });
  }
  return files;
}
/** The one file a zip holds (Deno's release is a single program). */
function unzipOne(zip) {
  const files = unzipAll(zip);
  if (files.length !== 1) throw new Error(`the zip holds ${files.length} files, not one`);
  return files[0].data;
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

try {
  const [bin, zip] = await Promise.all([get(POT.base + POT.bin.name), get(POT.base + POT.plugin.name)]);
  checked(bin, `${POT.bin.sha256}  ${POT.bin.name}`, POT.bin.name);
  checked(zip, `${POT.plugin.sha256}  ${POT.plugin.name}`, POT.plugin.name);
  // the plugin: yt-dlp reads <plugin dir>/<package>/yt_dlp_plugins/… — only those files, never outside it
  const home = path.resolve(PLUGINS, POT.pkg);
  let n = 0;
  for (const f of unzipAll(zip)) {
    const at = f.name.indexOf("yt_dlp_plugins/");
    if (at < 0) continue;
    const dest = path.resolve(home, f.name.slice(at));
    if (!dest.startsWith(home + path.sep)) throw new Error(`a plugin file points outside its folder: ${f.name}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.data);
    n++;
  }
  if (!n) throw new Error("the plugin zip held no yt_dlp_plugins files");
  const to = install("bgutil-pot", bin);
  say(`bgutil-pot ${version(to, "--version") || "v0.8.1"} → ${to}; its yt-dlp plugin (${n} files) → ${home}`);
} catch (e) {
  say(`PO-token helper NOT installed — YouTube may refuse our server without it: ${e?.message || e}`);
}
