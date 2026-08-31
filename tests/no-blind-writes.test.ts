/* The defect class this codebase keeps producing.
 *
 * Read a JSON blob, change one field, write the whole thing back. The worker and
 * every HTTP route share one event loop, so there is an interleaving point at
 * every await between the read and the write, and the loser's change vanishes.
 * It has cost real money and real merchant trust in almost every shape it can
 * take:
 *
 *   - two refunds against one failed render, because prePaid was read and then
 *     written two awaits later
 *   - a checkpoint re-arming a refund that had already paid out
 *   - a shopper's click erasing postedTo, so the app posted again to accounts
 *     that already had the piece
 *   - a merchant's click erasing a drop the poster had just published
 *   - two level-up gifts for one level
 *
 * Every one was a fix applied by hand after the fact. This test is the standing
 * rule instead: a write of a JSON blob must be conditional on the value it was
 * read from, so the loser re-reads rather than overwriting.
 *
 * If this fails on new code, the fix is an updateMany whose `where` pins the
 * blob you parsed — see refundPrepaidOnce, checkpointJob or editSchedule for the
 * shape. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const APP = new URL("../app/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const BLOBS = [
  "scheduleJson",
  "metaJson",
  "bodyJson",
  "objectivesJson",
  "socialsJson",
  "socialStatsJson",
  "payload",
  "voiceJson",
  "visualJson",
];

/** Sites that are not read-modify-writes at all, with why. */
const ALLOWED = new Set([
  // enqueueJob builds a payload for a brand-new row: db.job.create, nothing to race.
  "app/lib/job-queue.server.ts:enqueueJob-create",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

test("no JSON blob is written back from a value that was read earlier", () => {
  const offenders: string[] = [];

  for (const file of walk(APP)) {
    const rel = path.relative(path.join(APP, ".."), file).replace(/\\/g, "/");
    const lines = readFileSync(file, "utf8").split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      if (!/JSON\.parse\(/.test(lines[i])) continue;
      const blob = BLOBS.find((b) => lines[i].includes(b));
      if (!blob) continue;

      // Look ahead for a write of the SAME blob.
      for (let j = i + 1; j < Math.min(i + 45, lines.length); j++) {
        if (!new RegExp(`${blob}:\\s*JSON\\.stringify`).test(lines[j])) continue;

        const around = lines.slice(Math.max(0, j - 10), j + 2).join("\n");
        const conditional = /updateMany/.test(around);
        // A `create` writes a new row — there is nothing to race with.
        const isCreate = /\.create\(/.test(around);
        if (!conditional && !isCreate) {
          offenders.push(`${rel}:${i + 1} reads ${blob} -> :${j + 1} writes it back unconditionally`);
        }
        break;
      }
    }
  }

  const unexpected = offenders.filter((o) => !ALLOWED.has(o));
  assert.deepEqual(
    unexpected,
    [],
    `Unconditional read-modify-write on a shared JSON blob:\n  ${unexpected.join("\n  ")}\n\n` +
      `Pin the value you read in the where clause (updateMany), or explain the site in ALLOWED.`
  );
});

test("the sweep actually looks at the files it claims to", () => {
  // A guard against the walk silently finding nothing — which would make the
  // test above pass forever without checking anything.
  const files = walk(APP);
  assert.ok(files.length > 80, `only found ${files.length} source files under app/`);
  assert.ok(
    files.some((f) => f.endsWith("job-queue.server.ts")),
    "the sweep did not reach the job queue, which is where this class hurts most"
  );
});
