/* CHINESE WORDS ARE DRAWN WITH A FONT THAT HAS THEM — OR NOT DRAWN.
 *
 * 2026-11-23: a story told again in 中文 came back with every caption a row of empty boxes. The font was
 * fetched from an address that had never existed (404), and four pipelines and eight image-ad templates
 * caught that failure with "keep Poppins" — a font with no Chinese in it. Nothing failed; it just drew
 * boxes, on every Chinese piece the product made.
 *
 * Also here: the listener is always told which language it is listening to. Told that a Spanish voice
 * is English, it translates ("Dicen que el viejo teatro…" came back "They say that the old theater…"). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CJK_FONT_FILE, CJK_FONT_MIN_BYTES, CJK_FONT_SOURCES, fontMagic, looksLikeCjkFont } from "../app/lib/caption-font.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => fs.readFileSync(path.join(root, "app", "lib", f), "utf8").replace(/\r\n/g, "\n");

test("the font has more than one source, the first one pinned, and none is the address that never existed", () => {
  assert.ok(CJK_FONT_SOURCES.length >= 2);
  for (const u of CJK_FONT_SOURCES) {
    assert.ok(u.startsWith("https://"), u);
    assert.ok(u.endsWith(`/Sans/SubsetOTF/SC/${CJK_FONT_FILE}`), `${u}: the file is under SubsetOTF/SC`);
    assert.ok(!u.includes("OTF/SimplifiedChinese"), `${u}: the 404`);
  }
  assert.ok(/noto-cjk[/@]Sans\d/.test(CJK_FONT_SOURCES[0]), "a release tag first: it cannot be moved from under us");
  assert.ok(new Set(CJK_FONT_SOURCES.map((u) => new URL(u).host)).size >= 2, "and not all on one host");
});

test("only a real font is kept: big enough to hold Chinese, and a font by its first bytes", () => {
  const big = (head: number[]) => { const b = new Uint8Array(CJK_FONT_MIN_BYTES); b.set(head); return b; };
  assert.ok(fontMagic([0x4f, 0x54, 0x54, 0x4f]), "OTTO — OpenType");
  assert.ok(fontMagic([0, 1, 0, 0]), "TrueType");
  assert.ok(fontMagic([0x74, 0x74, 0x63, 0x66]), "ttcf — a collection");
  assert.ok(!fontMagic([0x3c, 0x68, 0x74, 0x6d]), "<htm — an error page");
  assert.ok(!fontMagic([0x34, 0x30, 0x34, 0x3a]), "404: — what the old address answered");
  assert.ok(!fontMagic([]), "nothing");
  assert.ok(!fontMagic(null));
  assert.ok(looksLikeCjkFont(big([0x4f, 0x54, 0x54, 0x4f])));
  assert.ok(!looksLikeCjkFont(big([0x3c, 0x68, 0x74, 0x6d])), "a megabyte of web page is not a font");
  assert.ok(!looksLikeCjkFont(new Uint8Array([0x4f, 0x54, 0x54, 0x4f])), "four bytes of font are not the font");
});

test("the resolver fetches from those sources, checks what it got, and never keeps half a file", () => {
  const src = read("ugc-ad-pipeline.server.ts");
  const at = src.indexOf("export async function resolveTextFont(text: string): Promise<string> {");
  const fn = src.slice(at, src.indexOf("\nfunction buildCaptionFilters", at));
  assert.ok(at > 0 && fn.length > 400);
  assert.ok(fn.includes("if (!hasCJK(text)) return poppins;"), "Latin words never wait on a download");
  assert.ok(fn.includes("for (const url of CJK_FONT_SOURCES) {"));
  assert.ok(fn.includes("if (!looksLikeCjkFont(buf)) {"), "the bytes are checked before they are kept");
  assert.ok(fn.includes("fs.renameSync(part, f);"), "written beside, then moved into place");
  assert.ok(fn.includes("return fontMagic(head);"), "a file already on the disk is checked to be a font too");
  assert.ok(fn.includes("throw new Error(`[fonts] no Chinese font could be fetched"), "and it still THROWS when there is none: callers draw nothing");
  assert.ok(!src.includes("OTF/SimplifiedChinese"), "the dead address is gone");
});

test("no pipeline draws Chinese with Poppins when the font cannot be had — it draws no words", () => {
  for (const f of ["narrated-story.server.ts", "film-captions.server.ts", "film-engine.server.ts", "faceless-video.server.ts", "ugc-ad-pipeline.server.ts", "image-generation.server.ts", "video-edit.server.ts"]) {
    const src = read(f);
    assert.ok(!src.includes("catch { /* keep Poppins */ }"), `${f}: "keep Poppins" drew boxes`);
    assert.ok(!src.includes("catch { /* keep default */ }"), `${f}: "keep default" drew boxes`);
  }
  assert.ok(read("narrated-story.server.ts").includes("cards: wordsDrawable ? cards : [],"), "a story is told without words on screen");
  assert.ok(read("film-engine.server.ts").includes("captions: tmpl.captions && wordsDrawable ? treatment.scenes.map((s) => s.caption) : treatment.scenes.map(() => undefined),"));
  assert.ok(read("faceless-video.server.ts").includes("catch (e) { caps = []; console.error(`[faceless] no font for these words"));
  assert.ok(read("film-captions.server.ts").includes("the film ships without captions: ${e instanceof Error ? e.message.slice(0, 140) : e}`); return false; }"));
  assert.ok(read("ugc-ad-pipeline.server.ts").includes("catch (e) { if (hasCJK(script)) { console.error(\"[assemble] no CJK font — skipping captions:\""));
  // the image-ad templates: no font → the template draws nothing (each returns null on a missing font file)
  const img = read("image-generation.server.ts");
  const blanks = img.split("catch { fontFile = \"\"; /* words Poppins cannot draw and no font that can: draw none — never boxes */ }").length - 1;
  assert.equal(blanks, 8);
  let from = 0;
  for (let i = 0; i < blanks; i++) {
    const at = img.indexOf("catch { fontFile = \"\";", from);
    assert.ok(img.slice(at, at + 260).includes("if (!fs.existsSync(fontFile)) return null;"), `template ${i + 1} stops when there is no font`);
    from = at + 10;
  }
});

test("the listener is told the language it is listening to", () => {
  assert.ok(read("narrated-story.server.ts").includes("createWhisperx(voUrl, normalizeContentLang(lang))"), "a story: the language it is told in");
  const cap = read("film-captions.server.ts");
  assert.ok(cap.includes("createWhisperx(`${base}/renders/${path.basename(audio)}`, o.lang || \"en\")"), "a film or an ad: the language it is spoken in");
  assert.ok(!cap.includes("o.english"), "no more English-only listening");
  for (const f of ["film-dialogue.server.ts", "film-edit.server.ts", "commercial-ad-pipeline.server.ts"]) {
    const src = read(f);
    assert.ok(/captionFilm\(\{[\s\S]{0,200}lang: normalizeContentLang\(/.test(src), `${f} says which language`);
    assert.ok(!/english: normalizeContentLang/.test(src), f);
  }
});
