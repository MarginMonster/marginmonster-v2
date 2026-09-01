import { test } from "node:test";
import assert from "node:assert/strict";
import { scriptTooShort, capScript, endStop } from "../app/lib/script-length.ts";

/* A real Simplified Chinese voice-over script, 35 characters, perfectly valid.
 * Under the old guard this counted as ONE word and was thrown away. */
const ZH = "这款保温杯能让你的咖啡整整六小时保持滚烫，出门再也不用将就冷掉的味道。";
const EN = "This tumbler keeps your coffee hot for a full six hours, so you never have to settle for a lukewarm cup on the way to work again.";

test("a valid Chinese script is not a fragment", () => {
  // the whole bug: split(/\s+/) returns 1 for this, and 1 < 12
  assert.equal(ZH.split(/\s+/).length, 1, "precondition: Chinese has no inter-word spaces");
  assert.equal(scriptTooShort(ZH), false);
});

test("a valid English script is not a fragment", () => {
  assert.equal(scriptTooShort(EN), false);
});

test("a genuinely mangled fragment is still caught, in both writing systems", () => {
  assert.equal(scriptTooShort("Every t."), true);
  assert.equal(scriptTooShort("很好。"), true);
  assert.equal(scriptTooShort(""), true);
  assert.equal(scriptTooShort("   "), true);
});

test("a Chinese script carrying a Latin brand name is still judged as Chinese", () => {
  // hasCJK is true, so characters decide — otherwise the two Latin tokens
  // ("EasyMode" and a trailing word) would score 2 and be discarded
  const mixed = "用 EasyMode 为你的产品自动生成广告，每天都有新内容发布到社交平台上。";
  assert.equal(scriptTooShort(mixed), false);
});

test("Japanese and Korean are measured the same way", () => {
  assert.equal(scriptTooShort("このボトルは六時間ずっと熱いままなので、朝の一杯を我慢する必要はもうありません。"), false);
});

test("the lip-sync cap fires for Chinese, which it never used to", () => {
  const long = "这".repeat(120);
  assert.equal(long.split(" ").length, 1, "precondition: the old word cap could never fire");
  const capped = capScript(long, 34);
  assert.ok([...capped].length <= 58, `capped to ${[...capped].length} chars`);
});

test("the cap prefers a clause boundary over a mid-sentence cut", () => {
  const s = "这款保温杯真的非常好用而且外观漂亮，出门再也不用将就冷掉的咖啡味道了，强烈推荐给每一个人。";
  const capped = capScript(s, 34);
  assert.ok([...capped].length <= 58);
  assert.ok(/[，、。；]$|[　-鿿]$/.test(capped), `ends cleanly: ${capped}`);
});

test("English capping is unchanged", () => {
  const words = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ");
  assert.equal(capScript(words, 34).split(" ").length, 34);
  assert.equal(capScript("short one here", 34), "short one here");
});

test("a script already inside budget is returned untouched", () => {
  assert.equal(capScript(ZH, 34), ZH);
  assert.equal(capScript(EN, 40), EN);
});

test("endStop uses the terminator of the script's own writing system", () => {
  assert.equal(endStop("这款保温杯很好用"), "这款保温杯很好用。");
  assert.equal(endStop("This is good"), "This is good.");
  // already terminated — leave it alone, in either system
  assert.equal(endStop("这款保温杯很好用。"), "这款保温杯很好用。");
  assert.equal(endStop("This is good!"), "This is good!");
  assert.equal(endStop("真的吗？"), "真的吗？");
});

test("endStop and capScript are safe on empty input", () => {
  assert.equal(endStop(""), "");
  assert.equal(capScript("", 34), "");
});
