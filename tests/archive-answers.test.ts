/* THE ARCHIVE SAYS WHAT HAPPENED AFTER A COLLECTION OR QUEUE TAP.
 *
 * Both new controls answered through a fetcher whose result handler was an effect on `[fetcher.data]` that
 * returns while `fetcher.state !== "idle"`. A Remix fetcher sets `data` when the action answers — while it
 * is still "loading" the page again — and goes idle a moment later WITHOUT changing `data`. So the effect ran
 * once, too early, and never again. Seen on the live site (2026-11-23): a collection was made, but its name
 * box stayed open with the name still in it, no chip appeared and nothing was said; a queued piece would
 * have given no confirmation at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = fs.readFileSync(path.join(root, "app", "routes", "web.archive.tsx"), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

test("a collection answer is acted on once, when its fetcher has gone idle", () => {
  assert.ok(ui.includes("const colAnswered = useRef<unknown>(null);"));
  assert.ok(ui.includes("if (!r || colFetcher.state !== \"idle\" || colAnswered.current === colFetcher.data) return;"));
  assert.ok(ui.includes("colAnswered.current = colFetcher.data;"));
  assert.ok(ui.includes("}, [colFetcher.data, colFetcher.state]); // eslint-disable-line react-hooks/exhaustive-deps"), "the state is watched too — going idle does not change the data");
  assert.equal(count(ui, "}, [colFetcher.data]);"), 0);
  // what it then does is unchanged: close the name box, clear the error, say what happened
  const at = ui.indexOf("colAnswered.current = colFetcher.data;");
  const body = ui.slice(at, at + 900);
  assert.ok(body.includes("setColForm(null);") && body.includes("setColErr(null);") && body.includes("setToast({ msg: t(colSay(r.op, r.n), { n: r.n, name: r.name }) });"));
});

test("a queue answer is acted on once, when its fetcher has gone idle", () => {
  assert.ok(ui.includes("const queueAnswered = useRef<unknown>(null);"));
  assert.ok(ui.includes("if (!a || queueFetcher.state !== \"idle\" || queueAnswered.current === a) return;"));
  assert.ok(ui.includes("queueAnswered.current = a;"));
  assert.ok(ui.includes("}, [queueFetcher.data, queueFetcher.state]); // eslint-disable-line react-hooks/exhaustive-deps"));
  assert.equal(count(ui, "}, [queueFetcher.data]);"), 0);
  assert.ok(ui.includes("link: { to: \"/web/autopost\", label: t(\"See the queue\") }, ms: 8000 });"), "the confirmation carries the way to the queue");
});

test("no other answer on this page waits on data alone while checking for idle", () => {
  // the shape of the bug: an effect that bails out unless idle, yet only re-runs when the data changes
  const effects = ui.split("useEffect(() => {").slice(1);
  for (const e of effects) {
    const end = e.indexOf("\n  }, [");
    if (end < 0) continue;
    const bodyText = e.slice(0, end);
    const deps = e.slice(end, end + 160).split("\n")[1] || "";
    const m = bodyText.match(/(\w+Fetcher)\.state !== "idle"\) return;|(\w+Fetcher)\.state !== "idle" \|\|/);
    const name = m && (m[1] || m[2]);
    if (!name) continue;
    assert.ok(deps.includes(`${name}.state`), `the effect that waits for ${name} to go idle must re-run when it does: ${deps.trim()}`);
  }
});

test("on a phone the Select bar and the toast stand above the app's own tab bar", () => {
  // measured at 390px on the live site: the tab bar (web.tsx .wb-bottom, up to 760px) was the element under
  // "Add to collection" and "Done" — the bar's third row could not be tapped
  assert.ok(ui.includes("@media(max-width:760px){.wa-bulk,.wa-toast{bottom:calc(98px + env(safe-area-inset-bottom,0px));}}"));
  const shell = fs.readFileSync(path.join(root, "app", "routes", "web.tsx"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(shell.includes(".wb-main{padding:10px 16px calc(98px + env(safe-area-inset-bottom,0px));}"), "the same 98px the page itself keeps clear");
  assert.ok(/@media\(max-width:760px\)\{[\s\S]*?\.wb-bottom\{display:flex;/.test(shell), "…at the width where the tab bar appears");
  // the rule comes after the 640px toast rule it has to beat
  assert.ok(ui.indexOf("@media(max-width:760px){.wa-bulk,.wa-toast{") > ui.indexOf("@media(max-width:640px){.wa-toast{left:16px;right:16px;transform:none;bottom:16px;}"));
});

test("a piece named after its description ends on a whole word", () => {
  const studio = fs.readFileSync(path.join(root, "app", "routes", "web.studio.tsx"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(studio.includes("import { trimToWord, trimTitle } from \"../lib/text-trim\";"));
  assert.ok(studio.includes("productTitle: productTitle || (casualMode ? trimTitle(direction, 60) || \"My video\" : productTitle),"));
  for (const v of ["createPrompt", "desc", "musicBase", "topic"]) assert.ok(studio.includes(`productTitle: trimTitle(${v}, 60),`), v);
  assert.ok(studio.includes("<input type=\"hidden\" name=\"productTitle\" value={trimTitle(direction, 60)} />"), "the page sends the same name the server would make");
  for (const v of ["createPrompt", "desc", "musicBase", "topic"]) assert.ok(!studio.includes(`productTitle: ${v}.slice(0, 60),`), v);
});
