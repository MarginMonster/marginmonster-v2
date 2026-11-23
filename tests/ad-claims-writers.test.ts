/* EVERY WRITER WHOSE WORDS GO OUT IN AN AD IS READ: THE TALKING SCRIPT, THE JINGLE, THE CARTOON.
 *
 * The Commercial was the first (tests/ad-claims-check.test.ts) — its writer was told never to invent
 * "lowest price" and wrote it anyway, because the member's direction outweighed the rule. The same rule
 * and the same direction box sit in front of the other three writers; an instruction alone can lose there
 * too. So their drafts go through one backstop: read → ask once more → cut.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claimFaults, dropFaultLines, writeClaimFree } from "../app/lib/ad-claims.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

const quiet = async <T>(fn: () => Promise<T>): Promise<{ out: T; logged: string[] }> => {
  const logged: string[] = [];
  const was = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  try { return { out: await fn(), logged }; } finally { console.error = was; }
};

const CLEAN = "Sixteen tiny friends in one box. Open one, then another. Meet the whole set today.";
const CLAIMS = "Sixteen tiny friends in one box. It is the lowest price around. Meet the whole set today.";

test("a draft that claims nothing costs one call and comes back as it was", async () => {
  let calls = 0;
  const { out, logged } = await quiet(() => writeClaimFree(async () => { calls++; return CLEAN; }, "Palmsize Wonders", { label: "t" }));
  assert.equal(out, CLEAN);
  assert.equal(calls, 1);
  assert.deepEqual(logged, []);
});

test("a draft that claims is asked for again, told which words — and the clean rewrite is used", async () => {
  const repairs: Array<string | undefined> = [];
  const { out, logged } = await quiet(() => writeClaimFree(async (repair) => { repairs.push(repair); return repair ? CLEAN : CLAIMS; }, "Palmsize Wonders", { label: "ugc:script" }));
  assert.equal(out, CLEAN);
  assert.equal(repairs.length, 2);
  assert.equal(repairs[0], undefined);
  assert.ok(repairs[1]?.includes("\"lowest price\", \"price around\""));
  assert.equal(logged.length, 1);
  assert.ok(logged[0].startsWith("[ugc:script] the draft claimed \"lowest price\", \"price around\""));
});

test("a rewrite that still claims: the sentence is cut and the rest kept", async () => {
  const { out, logged } = await quiet(() => writeClaimFree(async () => CLAIMS, "Palmsize Wonders", { label: "cartoon:script" }));
  assert.equal(out, "Sixteen tiny friends in one box. Meet the whole set today.");
  assert.equal(logged.length, 2);
  assert.ok(logged[1].includes("those sentences are cut"));
  assert.deepEqual(claimFaults(out, "Palmsize Wonders"), []);
});

test("a rewrite is kept only when it claims less; a rewrite that throws or comes back empty costs nothing", async () => {
  // worse second draft → the first is the one that is cut
  const worse = await quiet(() => writeClaimFree(async (r) => (r ? "Guaranteed fun. The lowest price around. Today only." : CLAIMS), "x", { label: "t" }));
  assert.equal(worse.out, "Sixteen tiny friends in one box. Meet the whole set today.");
  // the second ask throws → still the first draft, cut
  const thrown = await quiet(() => writeClaimFree(async (r) => { if (r) throw new Error("529 overloaded"); return CLAIMS; }, "x", { label: "t" }));
  assert.equal(thrown.out, "Sixteen tiny friends in one box. Meet the whole set today.");
  assert.ok(thrown.logged.some((l) => l.includes("the rewrite could not be used")));
  // the second ask returns nothing → same
  const empty = await quiet(() => writeClaimFree(async (r) => (r ? "" : CLAIMS), "x", { label: "t" }));
  assert.equal(empty.out, "Sixteen tiny friends in one box. Meet the whole set today.");
  // nothing from the writer at all → "" (each caller treats that as a refusal and tries again)
  assert.equal((await quiet(() => writeClaimFree(async () => "", "x", { label: "t" }))).out, "");
  // every sentence claims → ""
  assert.equal((await quiet(() => writeClaimFree(async () => "Lowest price around. Today only.", "x", { label: "t" }))).out, "");
});

test("what the merchant said is theirs: their own offer is never asked out", async () => {
  let calls = 0;
  const said = "Blind box set \n Free shipping over $50, officially licensed \n mention our 20% off sale";
  const draft = "Sixteen surprises, officially licensed. Take 20% off and get free shipping.";
  const { out, logged } = await quiet(() => writeClaimFree(async () => { calls++; return draft; }, said, { label: "t" }));
  assert.equal(out, draft);
  assert.equal(calls, 1);
  assert.deepEqual(logged, []);
});

test("a lyric is cut by lines, and keeps its line breaks", async () => {
  const lyric = "Palmsize Wonders, sixteen in a row\nLowest price around, don't you know\nOpen up a box and say hello\nPalmsize Wonders, here we go";
  assert.equal(dropFaultLines(lyric, "Palmsize Wonders"), "Palmsize Wonders, sixteen in a row\nOpen up a box and say hello\nPalmsize Wonders, here we go");
  assert.equal(dropFaultLines("  \nOne line\n\n", ""), "One line");
  assert.equal(dropFaultLines("", ""), "");
  assert.equal(dropFaultLines("Today only\nGuaranteed", ""), "");
  const { out, logged } = await quiet(() => writeClaimFree(async () => lyric, "Palmsize Wonders", { label: "jingle:lyrics", lines: true }));
  assert.equal(out.split("\n").length, 3);
  assert.ok(!out.includes("Lowest price"));
  assert.ok(logged[1].includes("those lines are cut"));
});

test("the three writers draft through it — the preview and the paid render alike", () => {
  const ugc = read("app", "lib", "ugc-ad-pipeline.server.ts");
  assert.ok(ugc.includes("async function draftUgcScript(prompt: string, merchantSaid: string): Promise<string> {"));
  assert.ok(ugc.includes("async (repair) => ((await anthropicText(repair ? `${prompt}\\n${repair}` : prompt, { model: \"claude-sonnet-5\", maxTokens: 200 })) || \"\")"));
  assert.ok(ugc.includes("{ label: \"ugc:script\" },"));
  assert.ok(ugc.includes("return scriptTooShort(raw) ? \"\" : raw;"), "a fragment — written or left by a cut — is still a refusal");
  assert.equal(ugc.split("draftUgcScript(").length - 1, 3, "defined once, used by the free preview and by the render");
  assert.ok(ugc.includes("[p.productTitle, p.productDescription, p.direction].filter(Boolean).join(\" \\n \");"));

  const jingle = read("app", "lib", "jingle-ad-pipeline.server.ts");
  assert.ok(jingle.includes("async function draftJingleLyrics(prompt: string, merchantSaid: string): Promise<string> {"));
  assert.ok(jingle.includes("{ label: \"jingle:lyrics\", lines: true },"));
  assert.equal(jingle.split("draftJingleLyrics(").length - 1, 3);

  const cartoon = read("app", "lib", "cartoon-ad-pipeline.server.ts");
  assert.ok(cartoon.includes("const merchantSaid = [o.productTitle, o.productDescription, o.direction].filter(Boolean).join(\" \\n \");"));
  assert.ok(cartoon.includes("const script = await writeClaimFree("));
  assert.ok(cartoon.includes("{ label: \"cartoon:script\" },"));
  // the member's own approved words are never rewritten: only a draft WE write goes through the check
  assert.ok(ugc.includes("let script = resume.script || \"\";\n  if (!script) {"));
  assert.ok(jingle.includes("let lyrics = resume.lyrics || \"\";"));
});
