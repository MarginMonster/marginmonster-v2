/* Render one short preview MP3 per curated custom-presenter voice, so the forge
 * picker's ▶ plays the real voice for free (no tokens, instant). Uses the SAME
 * TTS model + emotion/speed castFor() gives a custom presenter, so the preview
 * matches the finished video. Output: public/voice-samples/<id>.mp3
 *
 * Run: node scripts/voices/gen-samples.cjs   (needs REPLICATE_API_TOKEN in .env)
 * Idempotent: skips any sample already on disk. Pass --force to re-render all. */
const fs = require("fs"), path = require("path"), https = require("https");
const REPO = path.resolve(__dirname, "..", "..");
const TOKEN = (fs.readFileSync(path.join(REPO, ".env"), "utf8").match(/REPLICATE_API_TOKEN=(.+)/) || [])[1].trim();
const OUT = path.join(REPO, "public", "voice-samples");
fs.mkdirSync(OUT, { recursive: true });
const FORCE = process.argv.includes("--force");

// Mirror of AVATAR_VOICES ids in app/lib/avatar-voice-catalog.ts (kept in sync by hand).
const VOICES = [
  "English_FriendlyPerson", "English_ConfidentWoman", "English_PlayfulGirl",
  "English_CalmWoman", "English_Wiselady", "English_Trustworth_Man",
  "English_magnetic_voiced_man", "English_Comedian", "English_PatientMan",
  "English_ManWithDeepVoice",
];
const TEXT = "Hey! Let me show you something I think you're really going to love.";

function post(voice_id) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ input: { text: TEXT, voice_id, emotion: "happy", speed: 1.06 } });
    const req = https.request(
      "https://api.replicate.com/v1/models/minimax/speech-02-hd/predictions",
      { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Prefer: "wait" } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(JSON.parse(d))); }
    );
    req.on("error", reject); req.write(body); req.end();
  });
}
function dl(url, to) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error("dl " + res.statusCode));
      const f = fs.createWriteStream(to); res.pipe(f); f.on("finish", () => f.close(resolve));
    }).on("error", reject);
  });
}
(async () => {
  for (const v of VOICES) {
    const dest = path.join(OUT, v + ".mp3");
    if (!FORCE && fs.existsSync(dest)) { console.log("skip  " + v); continue; }
    try {
      const r = await post(v);
      let out = r.output; if (Array.isArray(out)) out = out[0];
      if (!out) { console.log("FAIL  " + v + " -> " + JSON.stringify(r).slice(0, 200)); continue; }
      await dl(out, dest);
      console.log("OK    " + v + "  (" + Math.round(fs.statSync(dest).size / 1024) + " KB)");
    } catch (e) { console.log("ERR   " + v + " -> " + (e.message || e)); }
  }
  console.log("done");
})();
