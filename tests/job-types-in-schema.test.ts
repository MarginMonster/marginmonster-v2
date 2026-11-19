/* A job type the code enqueues but the database enum does not list is rejected by prisma.job.create()
 * — the feature behind it answers every tap with a server error. That is how "Regenerate shot" in the
 * film shot editor was broken from the day it shipped (REGEN_SHOT was never added to JobType). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = new URL("../", import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("every job type the app enqueues is in the JobType enum", () => {
  const schema = read("prisma/schema.prisma");
  const block = schema.slice(schema.indexOf("enum JobType {"), schema.indexOf("}", schema.indexOf("enum JobType {")));
  const allowed = new Set(block.split("\n").map((l) => l.trim()).filter((l) => /^[A-Z_]+$/.test(l)));
  assert.ok(allowed.size > 5, "read the enum");
  const used = new Set<string>();
  for (const file of walk(new URL("app", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/enqueueJob\(\s*[^,]+,\s*"([A-Z_]+)"/g)) used.add(m[1]);
  }
  assert.ok(used.size > 5, "found the enqueue calls");
  const missing = [...used].filter((t) => !allowed.has(t));
  assert.deepEqual(missing, [], `enqueued but not in JobType: ${missing.join(", ")}`);
});
