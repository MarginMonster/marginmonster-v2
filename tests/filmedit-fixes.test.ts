/* The shot editor (/web/filmedit/:id) — two things a tap could do that it never should (found 2026-11-22).
 *
 *   1. ONE TAP DELETED A SHOT FOR GOOD. "Delete shot" took the shot out and re-cut the film at once, and
 *      nothing is kept to put it back. Worse, when the delete landed the selection sat on the NEXT shot
 *      with Delete live again — a second tap cut another shot out. It is now the app's two-tap
 *      arm-to-confirm (the Archive's rule): the first tap arms the button, a second within 4 s deletes;
 *      it disarms by itself after 4 s, when another shot is picked and when any other edit starts; and a
 *      delete that lands leaves nothing selected.
 *
 *   2. A REGENERATE THAT OUTLIVED ITS TIMER VANISHED — AND THE TIMER WAS NEVER SET BACK. After ~9 min of
 *      polling the "Re-rendering this shot with AI" line was dropped with no outcome and every button came
 *      back to life. The poll count was never reset, so each later Regenerate in the same visit "timed
 *      out" immediately: the line gone at once, the button live, one more job queued per tap. Now a slow
 *      one says it is slow, stays locked until the new cut lands (or the page is reloaded) while the page
 *      keeps looking, and a new regenerate starts its own count. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");

test("Delete shot is two taps — and a delete that lands leaves nothing selected", (t) => {
  const ui = read("app", "routes", "web.filmedit.$id.tsx");
  // the one-tap button is gone: no click sends a delete straight off
  assert.ok(!ui.includes("onClick={() => submit(\"delete\")}"));
  // the button asks first, LOOKS armed (filled red — inline, so it holds under the hover rule), and says
  // what the second tap does
  const btn = ui.slice(ui.indexOf("<button type=\"button\" className=\"se-op se-op-del\""), ui.indexOf("{regenBusy && !regenSlow &&"));
  assert.ok(btn.includes("onClick={askDelete}>{delArmed ? \"Tap again to delete\" : \"🗑 Delete shot\"}</button>"));
  assert.ok(btn.includes("style={delArmed ? { background: \"#8C2E1B\", borderColor: \"#8C2E1B\", color: \"#fff\" } : undefined}"));
  assert.ok(btn.includes("disabled={busy || regenBusy || d.shots.length <= 1}"), "the only shot still cannot be deleted");
  // THE RULE: the first tap arms it for THIS clip, the second deletes — and a delete is sent from nowhere else
  assert.ok(ui.includes("const askDelete = () => { if (!cur) return; if (armedDel !== cur.url) { setArmedDel(cur.url); return; } submit(\"delete\"); };"));
  assert.equal(ui.split("submit(\"delete\")").length - 1, 1);
  assert.ok(ui.includes("const delArmed = !!cur && armedDel === cur.url;"));
  // it disarms by itself after 4 s…
  assert.ok(ui.includes("const timer = setTimeout(() => setArmedDel(null), 4000);"));
  // …when another shot is picked…
  assert.ok(ui.includes("useEffect(() => { setArmedDel(null); }, [sel]);"));
  // …and when any other edit starts: every quick edit goes out through submit(), Regenerate through regen()
  assert.ok(ui.includes("{ if (sel < 0) return; setArmedDel(null); fx.submit({ op, shotIndex: String(sel), ...extra }, { method: \"post\" }); };"));
  assert.ok(ui.includes("const regen = () => { if (sel < 0) return; setArmedDel(null); "));
  assert.equal(ui.split("fx.submit(").length - 1, 2, "submit() and regen() are the only two ways an edit is sent");
  // a delete that lands leaves NOTHING selected: the selection is a position, and the same position is now
  // the next shot (it used to stay selected, with Delete live on it)
  assert.ok(ui.includes("useEffect(() => { if (d.shots.length < shotCount.current) setSel(-1); shotCount.current = d.shots.length; }, [d.shots.length]);"));

  // The rule, run — a tiny copy of the page's: `armedDel`, the 4 s timer that follows every change of it,
  // askDelete, submit, and picking a shot.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = () => {
    let armedDel: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sent: string[] = [];
    const setArmedDel = (v: string | null) => { armedDel = v; clearTimeout(timer); if (v !== null) timer = setTimeout(() => setArmedDel(null), 4000); };
    const submit = (op: string, cur: string) => { setArmedDel(null); sent.push(`${op} ${cur}`); };
    const askDelete = (cur: string) => { if (armedDel !== cur) { setArmedDel(cur); return; } submit("delete", cur); };
    return { askDelete, submit, pick: () => setArmedDel(null), sent, armed: () => armedDel };
  };
  const A = "/renders/shot-a.mp4", B = "/renders/shot-b.mp4";

  // one tap deletes nothing — it arms
  let p = page();
  p.askDelete(A);
  assert.deepEqual(p.sent, []);
  assert.equal(p.armed(), A);
  // a second tap inside 4 s deletes that shot, once, and the button is disarmed again
  t.mock.timers.tick(3999);
  p.askDelete(A);
  assert.deepEqual(p.sent, [`delete ${A}`]);
  assert.equal(p.armed(), null);
  p.askDelete(A);
  assert.deepEqual(p.sent, [`delete ${A}`], "a third tap only arms again");

  // left alone for 4 s it disarms by itself: the next tap arms, it does not delete
  p = page();
  p.askDelete(A);
  t.mock.timers.tick(4000);
  assert.equal(p.armed(), null);
  p.askDelete(A);
  assert.deepEqual(p.sent, []);
  // …and the 4 s run from the LAST arming, not the first
  t.mock.timers.tick(3999);
  assert.equal(p.armed(), A);
  t.mock.timers.tick(1);
  assert.equal(p.armed(), null);

  // picking another shot disarms: neither the new shot nor the old one is a tap from deletion
  p = page();
  p.askDelete(A);
  p.pick();
  p.askDelete(B);
  assert.deepEqual(p.sent, []);
  p.pick();
  p.askDelete(A);
  assert.deepEqual(p.sent, []);

  // any other edit disarms: Louder, then a tap on Delete, deletes nothing
  p = page();
  p.askDelete(A);
  p.submit("volume", A);
  p.askDelete(A);
  assert.deepEqual(p.sent, [`volume ${A}`]);

  // armed for one clip is never armed for another, even with no pick in between (the list moved under it)
  p = page();
  p.askDelete(A);
  p.askDelete(B);
  assert.deepEqual(p.sent, []);
  assert.equal(p.armed(), B);
});

test("a regenerate that outlives its timer says so and stays locked; the next one starts its own count", () => {
  const ui = read("app", "routes", "web.filmedit.$id.tsx");
  // the silent give-up is gone: at the cap the lock is KEPT — only the new cut landing takes it off
  assert.ok(!ui.includes("if (regenPolls.current > 45) { setRegenBase(null); return; }"));
  assert.equal(ui.split("setRegenBase(null)").length - 1, 1);
  assert.ok(ui.includes("if (d.filmUrl !== regenBase) { setRegenBase(null); setRegenSlow(false); regenPolls.current = 0; return; }"));
  // past the cap the page says it is slow, and keeps looking — once a minute, so "it will appear here" is true
  assert.ok(ui.includes("const slow = regenPolls.current > 45; // ~9 min"));
  assert.ok(ui.includes("if (slow) setRegenSlow(true);"));
  assert.ok(ui.includes("const t = setTimeout(() => { regenPolls.current++; rev.revalidate(); }, slow ? 60000 : 12000);"));
  assert.ok(ui.includes("{regenBusy && regenSlow && <div className=\"se-busy\">Still working — this one is taking longer than usual. It will appear here when it is done; you can leave this page.</div>}"));
  assert.ok(ui.includes("{regenBusy && !regenSlow && <div className=\"se-busy\">Re-rendering this shot with AI"), "one line or the other, never both");
  // while it is out, Regenerate cannot be pressed (nor any other edit — each would re-cut the film under it)
  assert.ok(ui.includes("const regenBusy = !!regenBase;"));
  assert.ok(ui.includes("className=\"se-op se-op-regen\" disabled={busy || regenBusy || !cur.hasSeed}"));
  const editButtons = ui.split("<button type=\"button\" className=\"se-op").length - 1;
  assert.ok(editButtons >= 6);
  assert.equal(ui.split("disabled={busy || regenBusy").length - 1, editButtons, "every edit button is off while one is out");
  // a new regenerate starts its own count — it used to inherit the last one's, already past the cap
  assert.ok(ui.includes("regenPolls.current = 0; setRegenSlow(false); setRegenBase(d.filmUrl); fx.submit({ op: \"regen\", shotIndex: String(sel) }, { method: \"post\" }); };"));

  // The polling effect, run — a tiny copy of what one pass of it decides: what it leaves behind, and how
  // long until it looks again (null = it has stopped looking).
  type S = { base: string | null; polls: number; slow: boolean };
  const pass = (s: S, filmUrl: string): number | null => {
    if (!s.base) return null;
    if (filmUrl !== s.base) { s.base = null; s.slow = false; s.polls = 0; return null; }
    const slow = s.polls > 45;
    if (slow) s.slow = true;
    return slow ? 60000 : 12000;
  };
  const regen = (s: S, filmUrl: string) => { s.polls = 0; s.slow = false; s.base = filmUrl; };
  const OLD = "/renders/cut-1.mp4", NEW = "/renders/cut-2.mp4";

  const s: S = { base: null, polls: 0, slow: false };
  assert.equal(pass(s, OLD), null, "nothing queued, nothing polled");
  regen(s, OLD);
  // the first ~9 min: every 12 s, the usual line
  let waited = 0;
  for (let i = 0; i < 46; i++) {
    assert.equal(pass(s, OLD), 12000);
    assert.equal(s.slow, false);
    waited += 12000;
    s.polls++;
  }
  assert.ok(waited > 9 * 60_000 && waited < 10 * 60_000);
  // THE CAP: it used to unlock here and say nothing. Now it says it is slow, is STILL locked, still looks
  assert.equal(pass(s, OLD), 60000);
  assert.deepEqual({ locked: !!s.base, slow: s.slow }, { locked: true, slow: true });
  // …for as long as it takes
  for (let i = 0; i < 90; i++) {
    s.polls++;
    assert.equal(pass(s, OLD), 60000);
    assert.deepEqual({ locked: !!s.base, slow: s.slow }, { locked: true, slow: true });
  }
  // the new cut lands: unlocked, the slow line gone, nothing left over
  assert.equal(pass(s, NEW), null);
  assert.deepEqual(s, { base: null, polls: 0, slow: false });

  // a later regenerate in the same visit gets its own ~9 min, whatever the count was left at
  s.polls = 46;
  regen(s, NEW);
  assert.equal(pass(s, NEW), 12000);
  assert.deepEqual(s, { base: NEW, polls: 0, slow: false });
});
