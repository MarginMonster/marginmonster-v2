/* "YOUR FILM IS READY" — SAID ON WHATEVER PAGE THE MEMBER IS ON.
 *
 * A film renders for fifteen to twenty minutes. The page that starts it says "it'll land in your Archive
 * when it's done. You can keep working" — and nothing, anywhere, ever said that it was done. Found by doing
 * exactly that as a customer, three films in a row (2026-11-23): each time the only way to know was to go
 * and look.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { READY_FRESH_MS, READY_POLL_MS, READY_SEEN_KEY, READY_SHOW_MS, pieceToAnnounce, readyName, seenAfter, type ReadyState } from "../app/lib/ready-notice.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

const T0 = Date.parse("2026-11-23T08:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const film = (minAgo: number, id = "f1"): ReadyState => ({ cooking: 0, newest: { id, title: "Short Film — One Umbrella — Episode 2: The Café on Maple Street", at: iso(T0 - minAgo * 60_000) } });

test("a film that finished after the last look is announced", () => {
  const cur = film(1);
  const seen = iso(T0 - 30 * 60_000); // the newest video this browser knew of, half an hour ago
  assert.deepEqual(pieceToAnnounce(cur, seen, T0, false), cur.newest);
  // …and once remembered, the same look says nothing a second time
  const after = seenAfter(cur, seen);
  assert.equal(after, cur.newest!.at);
  assert.equal(pieceToAnnounce(cur, after, T0, false), null);
});

test("nothing is announced that nobody was waiting for", () => {
  // the first look this browser ever takes: remember, do not announce
  assert.equal(pieceToAnnounce(film(1), null, T0, false), null);
  assert.equal(seenAfter(film(1), null), film(1).newest!.at);
  // a film finished long ago (the app opened the next day)
  assert.equal(pieceToAnnounce(film(READY_FRESH_MS / 60_000 + 5), iso(T0 - 3 * 24 * 3600_000), T0, false), null);
  // on the Archive it lands in plain view — and is still remembered as seen
  assert.equal(pieceToAnnounce(film(1), iso(T0 - 30 * 60_000), T0, true), null);
  // no video at all, or one with a broken time
  assert.equal(pieceToAnnounce({ cooking: 2, newest: null }, iso(T0), T0, false), null);
  assert.equal(pieceToAnnounce({ cooking: 0, newest: { id: "x", title: "t", at: "not a time" } }, iso(0), T0, false), null);
  assert.equal(pieceToAnnounce({ cooking: 0, newest: { id: "", title: "t", at: iso(T0) } }, iso(0), T0, false), null);
});

test("a member's very first film is announced: with no videos yet, the beginning of time is remembered", () => {
  const empty: ReadyState = { cooking: 1, newest: null };
  const seen = seenAfter(empty, null);
  assert.equal(seen, "1970-01-01T00:00:00.000Z");
  assert.deepEqual(pieceToAnnounce(film(0), seen, T0, false), film(0).newest);
});

test("what is remembered never moves backwards", () => {
  const newer = iso(T0);
  assert.equal(seenAfter(film(10), newer), newer, "an older newest (the latest one was deleted) does not un-see anything");
  assert.equal(seenAfter(film(0), iso(T0 - 60_000)), iso(T0));
  assert.equal(seenAfter(film(0), "garbage"), iso(T0), "a damaged value heals");
});

test("the name is the piece's title, cut at a word when it is long", () => {
  assert.equal(readyName("Short Film — One Umbrella"), "Short Film — One Umbrella");
  const long = readyName("Short Film — One Umbrella — Episode 2: The Café on Maple Street where it all began again");
  assert.ok(long.length <= 65 && long.endsWith("…"), long);
  assert.ok(!/\s…$/.test(long) && !/[—:,]…$/.test(long), long);
  assert.equal(readyName(null), "");
  assert.equal(readyName("  spaced   out  "), "spaced out");
});

test("the looking: once on load, then every twenty seconds only while something renders", () => {
  assert.equal(READY_POLL_MS, 20_000);
  assert.ok(READY_SHOW_MS >= 15_000, "long enough to read and reach for");
  const shell = read("app", "routes", "web.tsx");
  // the shell's loader says whether anything is rendering, and when it counted
  assert.ok(shell.includes("cooking: await cookingCount(shop.id),"));
  assert.ok(shell.includes("cookingAt: Date.now(),"));
  assert.ok(shell.includes("{authed && <ReadyNotice cooking={cooking} stamp={cookingAt} />}"), "signed-in pages only");
  // one round per shell load while rendering (a second film sent off restarts it); otherwise a single look
  assert.ok(shell.includes("const round = cooking > 0 ? stamp : 0;"));
  assert.ok(shell.includes("}, [round]);"));
  assert.ok(shell.includes("if (!stopped && left > 0) timer = window.setTimeout(loop, READY_POLL_MS);"), "it stops by itself when nothing is left");
  assert.ok(shell.includes("return () => { stopped = true; if (timer) window.clearTimeout(timer); };"));
  // with no storage nothing is announced; what was seen is written back either way it can be
  assert.ok(shell.includes("try { seen = window.localStorage.getItem(READY_SEEN_KEY); } catch { canRemember = false; }"));
  assert.ok(shell.includes("const found = canRemember ? pieceToAnnounce(cur, seen, Date.now(), path.current === \"/web/archive\") : null;"));
  assert.ok(shell.includes("try { window.localStorage.setItem(READY_SEEN_KEY, seenAfter(cur, seen)); } catch { /* nothing is remembered */ }"));
  assert.equal(READY_SEEN_KEY, "emReadySeen");
});

test("the notice: says the name, opens the piece, can be dismissed, and clears the phone's tab bar", () => {
  const shell = read("app", "routes", "web.tsx");
  assert.ok(shell.includes("<div className=\"wb-ready\" role=\"status\" aria-live=\"polite\">"));
  assert.ok(shell.includes("{t(\"“{name}” is ready.\", { name: readyName(piece.title) })}"));
  assert.ok(shell.includes("<Link className=\"wb-ready-go\" to={`/web/archive?open=${encodeURIComponent(piece.id)}`} onClick={() => setPiece(null)}>{t(\"Watch it\")}</Link>"));
  assert.ok(shell.includes("<button type=\"button\" className=\"wb-ready-x\" aria-label={t(\"Dismiss\")} onClick={() => setPiece(null)}>✕</button>"));
  assert.ok(shell.includes("const id = window.setTimeout(() => setPiece(null), READY_SHOW_MS);"));
  assert.ok(shell.includes("useEffect(() => { if (loc.pathname === \"/web/archive\") setPiece(null); }, [loc.pathname]);"));
  assert.ok(shell.includes(".wb-ready{left:16px;right:16px;max-width:none;transform:none;bottom:calc(98px + env(safe-area-inset-bottom,0px));"), "above the floating tab bar");
  assert.ok(shell.includes(".wb-ready-go,.wb-ready-x{min-height:44px;}"), "thumb-sized on a phone");
  assert.ok(shell.includes("@media(prefers-reduced-motion:reduce){.wb-ready{animation:none;}}"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["\"Watch it\":", "\"“{name}” is ready.\":", "\"Dismiss\":"]) assert.ok(dict.split(k).length - 1 >= 5, k);
});

test("what it reads: the signed-in shop's own rows, read-only, never cached, never a redirect", () => {
  const route = read("app", "routes", "web.ready.tsx");
  assert.ok(route.includes("const id = await getWebIdentity(request);"));
  assert.ok(route.includes("if (!id) return json({ cooking: 0, newest: null }, { headers });"), "signed out: an empty answer, not a redirect");
  assert.ok(route.includes("return json(await readyState(id.shop.id), { headers });"));
  assert.ok(route.includes("const headers = { \"Cache-Control\": \"no-store\" };"));
  assert.ok(!/export const action|export default/.test(route), "a resource route: a loader and nothing else");
  const lib = read("app", "lib", "ready-notice.server.ts");
  assert.ok(lib.includes("where: { shopId, status: { in: [\"PENDING\", \"IN_PROGRESS\"] }, type: { in: [...MAKING] } },"));
  assert.ok(lib.includes("return jobs.filter((j) => j.status === \"IN_PROGRESS\" || !j.runAt || j.runAt.getTime() <= now).length;"), "a drop scheduled for later is not rendering");
  assert.ok(lib.includes("where: { shopId, type: \"VIDEO_AD\", status: { not: \"FAILED\" } },"));
  assert.ok(!/\.(create|update|updateMany|delete|deleteMany|upsert)\(/.test(lib), "nothing is written");
  assert.equal(lib.split("} catch {").length - 1, 2, "a failed read is an empty answer, never a broken page");
});

test("the Archive opens a piece by its address, once, and tidies the address through the router", () => {
  const archive = read("app", "routes", "web.archive.tsx");
  assert.ok(archive.includes("const openId = searchParams.get(\"open\");"));
  assert.ok(archive.includes("const it = assets.find((a) => a.id === openId);"), "only a piece this page loaded — this shop's own");
  assert.ok(archive.includes("if (!openId || openedById.current) return;"));
  assert.ok(archive.includes("setViewer(it);"));
  assert.ok(archive.includes("setSearchParams((p) => { const n = new URLSearchParams(p); n.delete(\"open\"); return n; }, { replace: true, preventScrollReset: true });"), "every other filter is kept");
});
