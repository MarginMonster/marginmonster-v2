/* EVERY OTHER PLACE THAT STARTS FFMPEG ITSELF CAPS ITS THREADS, as runFfmpeg does (app/lib/ffmpeg-threads.ts; the
 * measurement and the rule are in tests/ffmpeg-threads.test.ts). Nine files start ffmpeg without runFfmpeg — the
 * picture ads, the commercials, the sizes of an ad, the Archive covers, the presenter kit, the takes, an upright
 * photo, a song from a link, the writer's look at a picture. Each runs its arguments through the cap (ffmpegArgsFor when the same runner
 * also starts ffprobe or yt-dlp, which are never touched). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("every other place that starts ffmpeg itself caps it the same way", () => {
  const pins: [string, string[]][] = [
    ["ad-sizes.server.ts", ["const p = spawn(bin, ffmpegArgsFor(bin, args), { stdio: [\"ignore\", \"ignore\", \"pipe\"] });"]],
    ["anthropic.server.ts", ["const r = spawnSync(bin, withThreadCap([\"-y\", \"-i\", src, \"-frames:v\", \"1\", \"-q:v\", \"3\", dst]), { timeout: 30_000 });"]],
    ["archive-cover.server.ts", ["try { p = spawn(bin, ffmpegArgsFor(bin, args), { stdio: [\"ignore\", \"pipe\", \"pipe\"] }); }"]],
    ["commercial-ad-pipeline.server.ts", ["const p = spawn(bin, ffmpegArgsFor(bin, args), { stdio: [\"ignore\", \"ignore\", \"pipe\"] });"]],
    ["image-generation.server.ts", ["const p = spawn(bin, ffmpegArgsFor(bin, literal), {", "execFileSync(bin, withThreadCap([\"-y\", \"-i\", inP, \"-vf\", \"scale='min(1568,iw)':-2\", \"-q:v\", \"3\", outP]), { timeout: 30_000, stdio: \"ignore\" });"]],
    ["lyric-video.server.ts", ["try { child = spawn(bin, ffmpegArgsFor(bin, args), { stdio: [\"ignore\", \"pipe\", \"pipe\"] }); }"]],
    ["presenter-kit-core.ts", ["const p = spawn(bin, ffmpegArgsFor(bin, args), { stdio: [\"ignore\", \"pipe\", \"pipe\"] });"]],
    ["take.server.ts", ["const p = spawn(cmd, ffmpegArgsFor(cmd, args), { stdio: [\"ignore\", \"ignore\", \"pipe\"] });", "const p = spawn(\"ffmpeg\", withThreadCap(cutLookArgs(file)), { stdio: [\"ignore\", \"ignore\", \"pipe\"] });"]],
    ["upright-photo.server.ts", ["const p = spawn(bin, ffmpegArgsFor(bin, args), { stdio: [\"ignore\", \"ignore\", \"pipe\"] });"]],
  ];
  for (const [f, lines] of pins) {
    const src = read("app", "lib", f);
    assert.ok(/import \{[^}]*\b(withThreadCap|ffmpegArgsFor)\b[^}]*\} from "\.\/ffmpeg-threads\.ts";/.test(src), `${f} imports the cap`);
    for (const l of lines) assert.ok(src.includes(l), `${f}: ${l}`);
  }
  // presenter-kit-core.ts's raw-bytes runner as well (two spawns in that file, both capped)
  assert.equal(read("app", "lib", "presenter-kit-core.ts").split("spawn(bin, ffmpegArgsFor(bin, args),").length - 1, 2);
});

test("no file in the app starts ffmpeg without the cap", () => {
  const bad: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      const s = fs.readFileSync(p, "utf8");
      for (const m of s.matchAll(/\b(spawn|spawnSync|execFile|execFileSync)\(([^,()]+(?:\(\))?),\s*([^,]+)/g)) {
        const [, , bin, args] = m;
        const ffmpeg = /ffmpeg/i.test(bin) && !/ffprobe/i.test(bin);
        const generic = /^\s*(bin|cmd)\s*$/.test(bin);
        if (!ffmpeg && !generic) continue;
        if (/withThreadCap|ffmpegArgsFor/.test(args)) continue;
        bad.push(`${path.relative(root, p)}: ${m[0].slice(0, 90)}`);
      }
    }
  };
  walk(path.join(root, "app"));
  assert.deepEqual(bad, []);
});
