const fs = require('fs');
const f = 'app/lib/social-post.server.ts';
let s = fs.readFileSync(f, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
const J = (a) => a.join(nl);

const OLD = J([
  '      const record = async (): Promise<boolean> => {',
  '        try {',
  '          await db.questline.update({ where: { id: q.id }, data: { scheduleJson: JSON.stringify(schedule) } });',
  '          return true;',
  '        } catch (e) {',
  '          console.error(`[social-post] could not record a post for questline ${q.id} — halting its scan so nothing double-posts:`, e);',
  '          return false;',
  '        }',
  '      };',
]);

const NEW = J([
  '      // ...and write ONLY the three fields this scan owns, onto the CURRENT row.',
  '      //',
  '      // This used to serialize the whole in-memory `schedule` — a snapshot taken',
  '      // before publishing began. Publishing is not quick: a caption call, then a',
  '      // network round trip per platform, per slot. The worker is imported into',
  '      // shopify.server.ts and shares one event loop with the Remix handlers, so',
  '      // every await in there hands control to whatever the merchant is doing.',
  '      // Anything they committed in that window was erased by this write:',
  '      //',
  '      //   - a drop they had just paid 150 tokens to add vanished off the map,',
  '      //     tokens spent and never refunded, with objectivesJson left counting a',
  '      //     target the schedule no longer contains;',
  '      //   - a slot they had just hit Retry on had its status dragged back to',
  '      //     READY with the OLD assetId restored, so the next scan published to',
  '      //     their live accounts the exact asset they had paid to replace.',
  '      //',
  '      // Re-read, find the slot by idx (never by array position — addDrop assigns',
  '      // idx = max+1, so positions shift), copy across status/postedTo/postedUrls',
  '      // and nothing else, then commit with a compare-and-swap on the exact JSON',
  '      // just read, so a write landing in between is detected instead of lost.',
  '      const record = async (slot: QuestSlot): Promise<boolean> => {',
  '        for (let attempt = 0; attempt < 3; attempt++) {',
  '          try {',
  '            const fresh = await db.questline.findUnique({ where: { id: q.id }, select: { scheduleJson: true } });',
  '            if (!fresh) return false; // abandoned mid-scan — stop touching it',
  '            const current = parseSchedule(fresh.scheduleJson);',
  '            const target = current.slots.find((x) => x.idx === slot.idx);',
  '            if (!target) return true; // no longer in the schedule — do not re-add it',
  '',
  '            // postedTo is a UNION, never a replacement. It is the only thing',
  '            // stopping a re-publish to an account that already took the post,',
  '            // and that cannot be taken back.',
  '            const union = [...new Set([...(target.postedTo || []), ...(slot.postedTo || [])])];',
  '            if (union.length) target.postedTo = union;',
  '            if (slot.postedUrls) target.postedUrls = { ...(target.postedUrls || {}), ...slot.postedUrls };',
  '',
  '            // Forward only. If the merchant hit Retry mid-publish the fresh copy',
  '            // reads FORGING with a new assetId — bank where this post reached,',
  '            // but leave the status for the next scan to decide.',
  '            if (slot.status === "POSTED" && (target.status === "READY" || target.status === "POSTED")) {',
  '              target.status = "POSTED";',
  '            }',
  '',
  '            const done = await db.questline.updateMany({',
  '              where: { id: q.id, scheduleJson: fresh.scheduleJson },',
  '              data: { scheduleJson: JSON.stringify(current) },',
  '            });',
  '            if (done.count === 1) return true;',
  '            // Someone committed between the read and the write — read it again.',
  '          } catch (e) {',
  '            console.error(`[social-post] could not record a post for questline ${q.id} — halting its scan so nothing double-posts:`, e);',
  '            return false;',
  '          }',
  '        }',
  '        console.error(`[social-post] questline ${q.id}: its schedule kept changing under the recorder — halting its scan so nothing double-posts`);',
  '        return false;',
  '      };',
]);

const edits = [
  [OLD, NEW],
  ['            if (!(await record())) break; // it is live; if we cannot write that down, stop.',
   '            if (!(await record(s))) break; // it is live; if we cannot write that down, stop.'],
  ['          if (!(await record())) break;', '          if (!(await record(s))) break;'],
  ['        if (changed && !(await record())) break; // it is live; if we cannot write that down, stop.',
   '        if (changed && !(await record(s))) break; // it is live; if we cannot write that down, stop.'],

  // work from a fresh copy of THIS questline, not a batch snapshot that is
  // already minutes old by the time the loop reaches it
  ['      const schedule = parseSchedule(q.scheduleJson);',
   J([
     '      // Re-read rather than trusting the batch snapshot: by the time the loop',
     '      // reaches a questline near the end, that snapshot is as old as all the',
     '      // publishing done before it. One row, and it decides what we post.',
     '      const row = await db.questline.findUnique({ where: { id: q.id }, select: { scheduleJson: true } });',
     '      if (!row) continue;',
     '      const schedule = parseSchedule(row.scheduleJson);',
   ])],

  ['import { parseSchedule } from "./questlines";',
   'import { parseSchedule, type QuestSlot } from "./questlines";'],
];

for (const [a] of edits) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error('anchor count ' + n + ': ' + a.slice(0, 80).replace(/\r/g, '')); process.exit(1); }
}
for (const [a, b] of edits) s = s.split(a).join(b);
fs.writeFileSync(f, s);
console.log('recorder is now re-read + merge + CAS');
