/* Tiny static server for UI previews, in the repo (survives Temp cleanup).
 * Serves public/; root -> public/_preview.html (write a component mock there).
 * Paired with the "preview" config in .claude/launch.json so the reliable
 * Preview tools (preview_start / preview_screenshot / preview_resize) can render
 * + screenshot a mock without depending on the flaky browser extension. */
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..", "public");
const T = { ".html": "text/html", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/_preview.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "Content-Type": T[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(f).pipe(res);
}).listen(5099, () => console.log("preview on http://localhost:5099"));
