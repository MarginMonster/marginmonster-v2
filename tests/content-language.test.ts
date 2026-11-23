/* EVERYTHING A SHOP'S CONTENT LANGUAGE COVERS: what is written, what is read aloud, what is listened to.
 *
 * 2026-11-23, after the first Chinese story came out as boxes, every pipeline was read for the language:
 *   - FACELESS videos (and every drop a channel posts by itself) never asked for it: a Spanish shop got
 *     an English script, an English voice-over and English captions. Its captions were also whatever the
 *     LISTENER heard — its spelling of a product's name, burned into the video.
 *   - a channel's next topic (the video's title in the library) was always English.
 *   - the film writer was told "Write all captions in this language code: es" — captions only, so the
 *     title stayed English — and three fallbacks passed no language at all, which meant English.
 *   - every BACKUP voice call (the cheaper model, used when the first one fails) sent no language.
 * These pin each of them. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boldCards, sceneWindows, scriptWordTimes, type WordT } from "../app/lib/narrated-core.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => fs.readFileSync(path.join(root, "app", "lib", f), "utf8").replace(/\r\n/g, "\n");

test("a faceless video is written, read and listened to in the shop's language", () => {
  const src = read("faceless-video.server.ts");
  assert.ok(src.includes("const lang = normalizeContentLang((await db.shop.findUnique({ where: { id: opts.shopId }, select: { contentLang: true } }))?.contentLang);"));
  // WRITTEN: both scripts (a product drop and a topic) end on the language line
  assert.ok(src.includes("const inLang = lang === \"en\" ? \"\" : `\\n${langDirective(lang).trim()} That means every spoken LINE. Each VISUAL and the musicMood stay in English: they are instructions for the picture and the music, never shown or said.`;"));
  assert.equal(src.split("` + inLang").length - 1, 2, "the product script and the topic script");
  // READ: the voice is told the language, on the first try and on the backup
  assert.ok(src.includes("repCreate(\"minimax/speech-02-hd\", { text: fullScript, voice_id: voiceId, ...voiceLangOpts(lang) })"));
  assert.ok(src.includes("repCreate(\"minimax/speech-02-turbo\", { text: fullScript, voice_id: voiceId, ...voiceLangOpts(lang) })"));
  assert.ok(!src.includes("language_boost: \"English\""), "no voice call says English whatever the script is in");
  // LISTENED TO: in that language (told a Spanish voice is English, the listener translates it)
  assert.ok(src.includes("createWhisperx(voUrl, lang)"));
  assert.ok(!src.includes("createWhisperx(voUrl)"));
});

test("faceless captions are the SCRIPT's words timed by the voice — never the listener's spelling", () => {
  const src = read("faceless-video.server.ts");
  assert.ok(src.includes("beatWindows = sceneWindows(lines, words, ffprobeDuration(voPath) || 35);"));
  assert.ok(src.includes("caps = boldCards(scriptWordTimes(lines, words, beatWindows));"));
  assert.ok(!src.includes("caps = groupCaptions(wordsFromWhisperx(raw));"), "the heard words are no longer the captions");
  assert.ok(src.includes("await ckpt({ ckTimings: JSON.stringify({ caps, windows: beatWindows }) });"));
  assert.ok(src.includes("if (Array.isArray(saved)) caps = saved;"), "a checkpoint from before the change (the cards alone) still resumes");
  // what that does, with the real functions: the listener mishears the product, the caption does not
  const lines = ["Meet Labubu, the monster everyone wants.", "Sixteen figures in every blind box set."];
  const heardText = ["Meet", "La", "Boo", "Boo", "the", "monster", "everyone", "wants", "16", "figures", "in", "every", "blind", "box", "set"];
  const heard: WordT[] = heardText.map((word, i) => ({ word, start: 0.3 + i * 0.4, end: 0.3 + i * 0.4 + 0.3 }));
  const win = sceneWindows(lines, heard, 7);
  const cards = boldCards(scriptWordTimes(lines, heard, win));
  const all = cards.map((c) => c.text).join(" ");
  assert.ok(all.includes("LABUBU"), all);
  assert.ok(!all.includes("BOO"), "the listener's spelling never reaches the screen");
  assert.ok(all.includes("SIXTEEN") && !all.includes("16"), "a number is shown as it was written");
  for (const c of cards) assert.ok(c.text.split(" ").length <= 3 && !/[.,]$/.test(c.text), c.text);
});

test("each faceless picture is up while its own line is said, not for an even share", () => {
  const src = read("faceless-video.server.ts");
  assert.ok(src.includes("await assembleFaceless({ stills, voPath, musicPath, caps, windows: beatWindows, fontFile, outPath, jobId });"));
  assert.ok(src.includes("? opts.windows.map((w) => w.t1 - w.t0)\n    : norm.map(() => voDur / N);"), "an even share only when the lines' times are not known");
  assert.ok(src.includes("const frames = Math.max(18, Math.round(durs[i] * 30));"));
  assert.ok(src.includes("else a.push(\"-loop\", \"1\", \"-t\", durs[i].toFixed(3), \"-i\", s);"));
  // the windows themselves: a long line gets longer than a short one, and they tile the voice-over
  const lines = ["Short one.", "This second line has a great many more words in it than the first one did.", "Bye."];
  let t = 0.2;
  const heard: WordT[] = lines.flatMap((l) => l.split(" ").map((word) => { const w = { word, start: t, end: t + 0.25 }; t += 0.3; return w; }));
  const win = sceneWindows(lines, heard, t);
  assert.equal(win[0].t0, 0);
  assert.equal(win[2].t1, t);
  assert.ok(win[1].t1 - win[1].t0 > 2 * (win[0].t1 - win[0].t0), "the long line's picture is up much longer");
});

test("a channel's next topic is in the shop's language", () => {
  const src = read("creator-series.server.ts");
  assert.ok(src.includes("export async function nextTopic(niche: string, format: string, recent: string[], lang?: string | null): Promise<string> {"));
  assert.ok(src.includes("`Return ONLY the topic line.${langDirective(lang)}`;"));
  assert.ok(src.includes("select: { id: true, socialsJson: true, activePlan: true, contentLang: true },"));
  assert.ok(src.includes("topic = await nextTopic(s.niche, s.format, recent, shop.contentLang);"));
});

test("the film writer puts the title and every caption in the language — its own when it is told one, else the shop's", () => {
  const src = read("film-engine.server.ts");
  assert.ok(src.includes("let shopLang: string | null | undefined = opts.contentLang;"));
  assert.ok(src.includes("try { shopLang = (await db.shop.findUnique({ where: { id: opts.shopId }, select: { contentLang: true } }))?.contentLang; } catch { shopLang = null; }"), "a caller that passes no language no longer means English");
  assert.ok(src.includes("const langLine = langCode === \"en\" ? \"\" : `\\nLANGUAGE: write every caption — the words that are spoken, narrated or sung — and the title in ${langName}. Keep every name exactly as given. Each \"visual\" and the musicMood stay in English: they are instructions for the picture and the music, never shown or said.`;"));
  assert.ok(!src.includes("Write all captions in this language code: ${opts.contentLang}."), "the old line named a code and covered the captions only");
  assert.ok(src.includes("${ORIGINAL_LYRICS_RULE}${langWordsLine}\\n"), "a re-fit of the lyrics keeps their language");
});

test("every voice call names the language it reads — the backup calls too", () => {
  const dir = path.join(root, "app", "lib");
  let calls = 0;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
    if (f === "voice-clone.server.ts") continue; // its one call reads a fixed English sample line
    const src = fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");
    let at = src.indexOf("repCreate(\"minimax/speech-02-");
    while (at >= 0) {
      calls++;
      const call = src.slice(at, src.indexOf("})", at) + 2);
      assert.ok(call.includes("voiceLangOpts(") || call.includes("...voLang"), `${f}: ${call.slice(0, 110).replace(/\s+/g, " ")}…`);
      assert.ok(!call.includes("language_boost: \"English\""), `${f}: English whatever the script is in`);
      at = src.indexOf("repCreate(\"minimax/speech-02-", at + 10);
    }
  }
  assert.ok(calls >= 12, `${calls} voice calls checked`);
  assert.ok(read("film-engine.server.ts").includes("const voLang = voiceLangOpts((await db.shop.findUnique({ where: { id: opts.shopId }, select: { contentLang: true } }))?.contentLang);"));
});

test("product copy, landing pages and marketing plans are written in the shop's language", () => {
  const routes = (f: string) => fs.readFileSync(path.join(root, "app", "routes", f), "utf8").replace(/\r\n/g, "\n");
  for (const f of ["product-copy.server.ts", "landing.server.ts", "strategy.server.ts"]) {
    const src = read(f);
    assert.ok(src.includes("lang?: string | null,"), `${f} takes the language`);
    assert.ok(src.includes("const inLang = langDirective(lang) ? `${langDirective(lang)} (The JSON keys stay exactly as shown.)` : \"\";"), `${f}: the words in the language, the answer's shape untouched`);
    assert.equal(src.split("${inLang}`;").length - 1, 1, `${f}: the prompt ends on it`);
  }
  assert.ok(routes("app.products.tsx").includes("generateProductCopy(shop.brandProfile!, it.title.trim(), (it.notes || \"\").trim(), shop.contentLang)"));
  assert.ok(routes("app.funnels.tsx").includes("generateLandingContent(shop.brandProfile, productName, goal, shop.contentLang)"));
  assert.ok(routes("app.strategy.tsx").includes("generateMarketingPlan(shop.brandProfile, shop.activePlan, shop.contentLang)"));
});
