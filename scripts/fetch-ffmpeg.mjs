/* Build-time ffmpeg fallback for Linux hosts without a system ffmpeg.
 * The npm ffmpeg-static Linux binary is missing drawtext (caption filter), so
 * on Linux we fetch johnvansickle's full static build (GPL, includes
 * libfreetype/fontconfig) into ./bin. No-ops when a real ffmpeg exists
 * (Docker image) or on non-Linux dev machines. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

const isLinux = process.platform === "linux";
const binDir = path.join(process.cwd(), "bin");
const target = path.join(binDir, "ffmpeg");

if (!isLinux) {
  console.log("[fetch-ffmpeg] non-linux — skipping (dev uses ffmpeg-static)");
  process.exit(0);
}
if (fs.existsSync("/usr/bin/ffmpeg") || fs.existsSync("/usr/local/bin/ffmpeg")) {
  console.log("[fetch-ffmpeg] system ffmpeg present — skipping");
  process.exit(0);
}
if (fs.existsSync(target)) {
  console.log("[fetch-ffmpeg] ./bin/ffmpeg already present — skipping");
  process.exit(0);
}

const URL = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";
console.log("[fetch-ffmpeg] downloading full static ffmpeg (drawtext-capable)…");
try {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ffdl-"));
  const tarball = path.join(tmp, "ffmpeg.tar.xz");
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  fs.writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
  execSync(`tar -xJf "${tarball}" -C "${tmp}"`);
  const extracted = fs.readdirSync(tmp).find((d) => d.startsWith("ffmpeg-") && fs.statSync(path.join(tmp, d)).isDirectory());
  if (!extracted) throw new Error("archive layout unexpected");
  fs.mkdirSync(binDir, { recursive: true });
  for (const bin of ["ffmpeg", "ffprobe"]) {
    fs.copyFileSync(path.join(tmp, extracted, bin), path.join(binDir, bin));
    fs.chmodSync(path.join(binDir, bin), 0o755);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("[fetch-ffmpeg] installed ./bin/ffmpeg + ./bin/ffprobe");
} catch (e) {
  // never fail the build — the pipeline reports clearly if no usable ffmpeg
  console.error("[fetch-ffmpeg] fallback fetch failed (non-fatal):", e.message);
}
