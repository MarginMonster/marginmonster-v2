/* Two things the Archive did not have, added 2026-11-22 and pinned here. Customers of rival tools ask for
 * exactly these: a way to find last week's piece, and a way to take several pieces out at once.
 *
 *   1. WHEN — "All time · Today · This week · This month". It lives in the URL (?when=) and is applied by
 *      the LOADER, where the paging is, so "This month" is counted over the whole library and paged inside
 *      the window — never sifted out of the 60 pieces that happened to be loaded.
 *   2. DOWNLOAD in the select bar — the media file of every picked piece that has one, one browser
 *      download after another (no zip, no server route), 20 a go at most, the selection left as it was.
 *
 * What decides both is one block of pure functions in the route. A route file cannot be imported here (it
 * is JSX, and it imports the database), so the block is lifted out of the source between its two rules and
 * RUN — the real code, not a copy of it. The wiring around it is pinned by reading the source.
 *
 * (Looked at in headless Chrome, 390 and 1100 wide, on a TEST page of fake pieces served by the route's
 *  real loader over a fake database; the numbers quoted below are from those runs.) */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isValidTimeZone, zonedDateString, zonedInstant } from "../app/lib/timezone.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const src = read("app", "routes", "web.archive.tsx");

// ── the pure part, lifted out and run ────────────────────────────────────────────────────────────────
type Tab = "video" | "image" | "music" | "blog" | "stills";
type When = "all" | "today" | "week" | "month";
type Piece = { id: string; type: string; title: string; media: string | null; isVideo: boolean; isAudio: boolean };
type Pure = {
  WHEN_KEYS: readonly When[];
  WHEN_LABEL: Record<When, string>;
  WHEN_EMPTY: Record<Exclude<When, "all">, string>;
  parseWhen: (v: unknown) => When;
  whenSince: (when: When, nowMs: number, dayStartMs?: number | null) => Date | null;
  tallyWhen: (pieces: Array<{ tab: Tab; at: number }>, nowMs: number, dayStartMs?: number | null) => Record<Exclude<When, "all">, Record<Tab, number>>;
  DL_CAP: number;
  DL_GAP_MS: number;
  dlFileName: (title: string, url: string, isVideo: boolean, isAudio: boolean) => string;
  dlSameOrigin: (url: string, pageOrigin: string) => boolean;
  downloadPlan: (pieces: Piece[], cap?: number) => { files: Array<{ id: string; url: string; name: string }>; skipped: number; over: number };
  dlSummary: (started: number, skipped: number, failed: number) => Array<{ s: string; n: number }>;
};
const START = "/* ── ARCHIVE FEATURES · THE PURE PART";
const END = "/* ── end of the pure part";
const blockAt = src.indexOf(START);
const blockEnd = src.indexOf(END);
const block = src.slice(blockAt, blockEnd);
const NAMES = ["WHEN_KEYS", "WHEN_LABEL", "WHEN_EMPTY", "parseWhen", "whenSince", "tallyWhen", "DL_CAP", "DL_GAP_MS", "dlFileName", "dlSameOrigin", "downloadPlan", "dlSummary"];
const pure: Pure = (() => {
  const js = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return new Function(`${js}\nreturn { ${NAMES.join(", ")} };`)() as Pure;
})();

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Midnight where the shop is, exactly as the loader works it out (the line is pinned below). */
const dayStartIn = (nowMs: number, tz: string) => zonedInstant(zonedDateString(new Date(nowMs), tz), "00:00", tz).getTime();

test("the pure part really is pure — so that what runs here is what the page runs", () => {
  assert.ok(blockAt > 0 && blockEnd > blockAt, "the block is there, between its two rules");
  assert.equal(count(src, START), 1);
  assert.equal(count(src, END), 1);
  // nothing imported, no React, no database, no browser: plain values in, plain values out
  for (const banned of ["import ", "export ", "useState", "useEffect", "db.", "await ", "document.", "window.", "fetch(", "Date.now("]) {
    assert.ok(!block.includes(banned), `the pure part must not contain "${banned}"`);
  }
  for (const n of NAMES) assert.ok(n in pure, n);
  // …and the page uses these very functions: each is defined once in the file, inside the block
  for (const fn of ["parseWhen", "whenSince", "tallyWhen", "dlFileName", "dlSameOrigin", "downloadPlan", "dlSummary"]) {
    assert.equal(count(src, `function ${fn}(`), 1, fn);
    assert.ok(block.includes(`function ${fn}(`), `${fn} lives in the pure part`);
    assert.ok(count(src, `${fn}(`) >= 2, `${fn} is called`);
  }
});

test("WHEN: what each window means — the last 7 days, the last 30, and a Today that starts at the shop's midnight", () => {
  const { parseWhen, whenSince, WHEN_KEYS, WHEN_LABEL, WHEN_EMPTY } = pure;
  // the four chips, in the order they are shown, under the names the owner asked for
  assert.deepEqual([...WHEN_KEYS], ["all", "today", "week", "month"]);
  assert.deepEqual(WHEN_KEYS.map((k) => WHEN_LABEL[k]), ["All time", "Today", "This week", "This month"]);
  assert.deepEqual(WHEN_EMPTY, { today: "Nothing from today yet.", week: "Nothing from this week yet.", month: "Nothing from this month yet." });

  // ?when= → a window; anything else is all time, never an error (a hand-edited or an old link)
  for (const k of ["today", "week", "month"] as const) assert.equal(parseWhen(k), k);
  for (const junk of [null, undefined, "", "all", "fortnight", "TODAY", " week", "month ", 7, {}, ["week"]]) assert.equal(parseWhen(junk), "all", JSON.stringify(junk));

  const now = Date.UTC(2026, 10, 22, 11, 45); // 2026-11-22 11:45 UTC
  assert.equal(whenSince("all", now), null, "all time has no limit");
  assert.equal(whenSince("week", now)!.getTime(), now - 7 * DAY, "this week = the last 7 days, to the minute");
  assert.equal(whenSince("month", now)!.getTime(), now - 30 * DAY, "this month = the last 30 days");
  // neither moves with the day's start
  assert.equal(whenSince("week", now, now - HOUR)!.getTime(), now - 7 * DAY);
  assert.equal(whenSince("month", now, null)!.getTime(), now - 30 * DAY);

  // TODAY starts at the midnight it is given…
  assert.equal(whenSince("today", now, now - 6 * HOUR)!.getTime(), now - 6 * HOUR);
  assert.equal(whenSince("today", now, now)!.getTime(), now, "on the stroke of midnight, the day is empty — and starts now");
  // …and with no midnight to go by (a shop with no time zone on file), at the last 24 hours: wider than any
  // calendar day, so nothing made today can be left out
  for (const none of [null, undefined, NaN, Infinity]) assert.equal(whenSince("today", now, none as number | null | undefined)!.getTime(), now - DAY, String(none));
  // a midnight that cannot be right is not believed: ahead of now, or more than a 25-hour day behind it
  assert.equal(whenSince("today", now, now + 1)!.getTime(), now - DAY);
  assert.equal(whenSince("today", now, now - 25 * HOUR - 1)!.getTime(), now - DAY);
  assert.equal(whenSince("today", now, now - 25 * HOUR)!.getTime(), now - 25 * HOUR, "a 25-hour day (the clocks went back) is a real day");

  // THE MIDNIGHT IS THE SHOP'S. The loader's line, and what it gives for three shops at that same instant:
  const loader = src.slice(src.indexOf("export const loader"), src.indexOf("export const action"));
  assert.ok(loader.includes([
    "  const dayStartMs = isValidTimeZone(shop.timezone)",
    '    ? zonedInstant(zonedDateString(new Date(whenNowMs), shop.timezone), "00:00", shop.timezone).getTime()',
    "    : null;",
    "  const since = whenSince(when, whenNowMs, dayStartMs);",
  ].join("\n")));
  assert.ok(src.includes('import { isValidTimeZone, zonedDateString, zonedInstant } from "../lib/timezone";'));
  const startsAt = (tz: string) => new Date(whenSince("today", now, dayStartIn(now, tz))!.getTime()).toISOString();
  assert.equal(startsAt("America/New_York"), "2026-11-22T05:00:00.000Z", "06:45 in New York: the day began at 05:00 UTC");
  assert.equal(startsAt("Asia/Karachi"), "2026-11-21T19:00:00.000Z", "16:45 in Karachi: it began at 19:00 UTC the day before");
  assert.equal(startsAt("Pacific/Kiritimati"), "2026-11-22T10:00:00.000Z", "01:45 on the 23rd in Kiritimati: it began at 10:00 UTC");
  // a piece made ten minutes before that midnight is yesterday's; ten minutes after, today's
  const ny = dayStartIn(now, "America/New_York");
  const inToday = (at: number) => at >= whenSince("today", now, ny)!.getTime();
  assert.equal(inToday(ny - 10 * 60_000), false, "23:50 last night — though it is well inside the last 24 hours");
  assert.equal(inToday(ny + 10 * 60_000), true);
  // the night the clocks go back (New York, 2026-11-01 — a 25-hour day): at 23:30 the day is 24.5h old, and
  // Today still starts at its real midnight, not 24 hours ago
  const lateOnTheLongDay = Date.UTC(2026, 10, 2, 4, 30); // 23:30 EST on Nov 1
  const longDayStart = dayStartIn(lateOnTheLongDay, "America/New_York");
  assert.equal(new Date(longDayStart).toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(lateOnTheLongDay - longDayStart, 24.5 * HOUR);
  assert.equal(whenSince("today", lateOnTheLongDay, longDayStart)!.getTime(), longDayStart);
  // a zone the database should never hold: no midnight, so the last 24 hours (the loader asks isValidTimeZone first)
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
  assert.equal(isValidTimeZone(null), false);
});

test("WHEN: the number on each chip — one pass over the last 30 days counts all three windows, tab by tab", () => {
  const { tallyWhen } = pure;
  const now = Date.UTC(2026, 10, 22, 11, 45);
  const midnight = now - 6 * HOUR;
  const p = (tab: Tab, at: number) => ({ tab, at });
  const out = tallyWhen([
    p("video", now - HOUR), // today
    p("video", midnight), // today — the very first second of it
    p("video", midnight - 1), // yesterday by a millisecond: this week, not today
    p("video", now - 7 * DAY), // this week — its oldest second (the query says gte)
    p("video", now - 7 * DAY - 1), // this month only
    p("video", now - 30 * DAY), // this month — its oldest second
    p("image", now - 2 * DAY),
    p("music", now - 20 * DAY),
    p("stills", now - 3 * HOUR),
    p("blog", now - 29 * DAY),
    p("podcast" as Tab, now - HOUR), // a kind this page has no tab for is not counted anywhere
  ], now, midnight);
  assert.deepEqual(out.today, { video: 2, image: 0, music: 0, blog: 0, stills: 1 });
  assert.deepEqual(out.week, { video: 4, image: 1, music: 0, blog: 0, stills: 1 });
  assert.deepEqual(out.month, { video: 6, image: 1, music: 1, blog: 1, stills: 1 });
  // the windows nest, whatever goes in
  for (const tab of ["video", "image", "music", "blog", "stills"] as const) {
    assert.ok(out.today[tab] <= out.week[tab] && out.week[tab] <= out.month[tab], tab);
  }
  // nothing in, zeros out — every tab present, so the page never reads an undefined count
  assert.deepEqual(tallyWhen([], now, null), { today: { video: 0, image: 0, music: 0, blog: 0, stills: 0 }, week: { video: 0, image: 0, music: 0, blog: 0, stills: 0 }, month: { video: 0, image: 0, music: 0, blog: 0, stills: 0 } });
  // with no midnight, "today" is counted over the last 24 hours — the same rule the query uses
  assert.equal(tallyWhen([p("image", now - 23 * HOUR), p("image", now - 25 * HOUR)], now, null).today.image, 1);
});

test("WHEN is applied in the loader — where the paging is — and every count is narrowed with it", () => {
  const loader = src.slice(src.indexOf("export const loader"), src.indexOf("export const action"));
  // read from the address, like the search…
  assert.ok(loader.includes('const when = parseWhen(new URL(request.url).searchParams.get("when"));'));
  assert.ok(loader.includes("const whenWhere = since ? { createdAt: { gte: since } } : {};"));
  // …and put into BOTH shelf queries, before their `take`
  // (the shelf query is one per KIND since the same day: with the newest `show` of all kinds loaded
  //  together, an account that had just made sixty videos opened Images to "Showing 3 of 76 images")
  assert.ok(loader.includes([
    '  const assets = (await Promise.all((["VIDEO_AD", "IMAGE_AD", "AUDIO", "BLOG_POST"] as const).map((type) => db.asset.findMany({',
    "    where: { shopId: shop.id, type, NOT: galleryWhere, ...titleWhere, ...whenWhere },",
    '    orderBy: { createdAt: "desc" },',
    "    take: show,",
    "  })))).flat().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());",
  ].join("\n")), "the newest of EACH kind, back in one newest-first list");
  assert.ok(loader.includes("nextShow: Math.max(inWhen.video, inWhen.image, inWhen.music, inWhen.blog) > show ? Math.min(SHOW_MAX, show + SHOW_STEP) : null,"), "more is offered while any ONE tab holds more than is loaded of its kind");
  assert.ok(!loader.includes("nextShow: totalAll > show"));
  assert.ok(loader.includes([
    "  const stills = await db.asset.findMany({",
    '    where: { shopId: shop.id, type: "IMAGE_AD", ...galleryWhere, ...titleWhere, ...whenWhere },',
    '    orderBy: { createdAt: "desc" },',
    "    take: 180,",
    "  });",
  ].join("\n")));
  assert.equal(count(loader, "...whenWhere"), 2);

  // THE COUNTS. Each window is counted over the whole library (this shop's, the search still applied) — a
  // read with no `take` — and what the page is given as `totals` is the OPEN window's
  assert.ok(loader.includes('const monthSince = whenSince("month", whenNowMs)!;'));
  assert.ok(loader.includes('db.asset.findMany({ where: { shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD", "AUDIO", "BLOG_POST"] }, NOT: galleryWhere, ...titleWhere, createdAt: { gte: monthSince } }, select: { type: true, createdAt: true } }),'));
  assert.ok(loader.includes('db.asset.findMany({ where: { shopId: shop.id, type: "IMAGE_AD", ...galleryWhere, ...titleWhere, createdAt: { gte: monthSince } }, select: { createdAt: true } }),'));
  assert.ok(loader.includes("...recentPieces.map((p) => ({ tab: A_KIND[p.type], at: p.createdAt.getTime() })),"));
  assert.ok(loader.includes('...recentStills.map((p) => ({ tab: "stills" as const, at: p.createdAt.getTime() })),'));
  assert.ok(loader.includes("    all: totals,\n    ...tallyWhen(["));
  assert.ok(loader.includes("const inWhen = whenCounts[when];"));
  assert.ok(loader.includes("const totalAll = inWhen.video + inWhen.image + inWhen.music + inWhen.blog;"));
  assert.ok(!loader.includes("const totalAll = totals.video"), "the page's total is no longer the all-time one while a window is open");
  assert.ok(loader.includes("    totals: inWhen,\n"));
  assert.ok(loader.includes("    when,\n    whenCounts,\n"));
  // "Show older pieces" is offered off the open window's own numbers, so it pages INSIDE the window (and
  // per kind — pinned above with the shelf query)
  assert.ok(loader.includes("nextShow: Math.max(inWhen.video, inWhen.image, inWhen.music, inWhen.blog) > show ?"));
  // the all-time numbers are still the ones the library was always counted with (the search applied, no window)
  assert.ok(loader.includes('where: { shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD", "AUDIO", "BLOG_POST"] }, NOT: galleryWhere, ...titleWhere },\n    _count: { _all: true },'));

  // WHAT THAT DECIDES. A shop with 113 videos, 68 of them from the last 30 days, and a page of 60:
  const now = Date.UTC(2026, 10, 22, 11, 45);
  const library = Array.from({ length: 113 }, (_, i) => ({ id: i, at: now - (i < 68 ? i * 0.43 : 31 + i) * DAY })); // newest first
  const since = pure.whenSince("month", now)!.getTime();
  // sifting the page that was loaded can only ever count what is on it: "60", and nothing says eight more exist
  assert.equal(library.slice(0, 60).filter((x) => x.at >= since).length, 60);
  // the loader's way round: the window in the query, THEN the page
  const inWindow = library.filter((x) => x.at >= since);
  const show = 60;
  assert.equal(inWindow.length, 68, "the true number, for the chip and for \"Showing 60 of 68\"");
  assert.equal(inWindow.slice(0, show).length, 60);
  assert.equal(inWindow.length > show ? Math.min(600, show + 60) : null, 120, "and \"Show older pieces\" is offered");
  assert.equal(inWindow.slice(0, 120).length, 68, "which brings the rest — all of them from this month");
  // (seen on the test page: This month → "Videos · 68", "Showing 49 of 68 videos" beside 10 images and a
  //  track on the same page of 60; Show older pieces → ?show=120&tab=video&when=month and all 68.)
});

test("WHEN: its chips are links that keep the tab, the search and the section — and every other link keeps the window", () => {
  // the window as the page knows it, and the chip to light while the loader is still answering
  assert.ok(src.includes("  const whenOpen = parseWhen(when);"));
  assert.ok(src.includes([
    '  const whenGoing = nav.state === "loading" && nav.location && typeof window !== "undefined" && nav.location.pathname === window.location.pathname',
    '    ? parseWhen(new URLSearchParams(nav.location.search).get("when"))',
    "    : null;",
    "  const whenLit = whenGoing ?? whenOpen;",
  ].join("\n")));
  // where a chip goes: all time carries no ?when= at all, and paging starts again (no ?show=)
  assert.ok(src.includes('const whenHref = (k: AWhen) => `?tab=${tab}${k !== "all" ? `&when=${k}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}${isCreator ? "&section=creator" : ""}`;'));
  const whenHref = (tab: string, k: When, q: string, isCreator: boolean) => `?tab=${tab}${k !== "all" ? `&when=${k}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}${isCreator ? "&section=creator" : ""}`;
  assert.equal(whenHref("video", "week", "", false), "?tab=video&when=week");
  assert.equal(whenHref("image", "all", "", false), "?tab=image");
  assert.equal(whenHref("image", "today", "blue mug & co", true), "?tab=image&when=today&q=blue%20mug%20%26%20co&section=creator");
  for (const k of ["all", "today", "week", "month"] as const) {
    assert.equal(pure.parseWhen(new URLSearchParams(whenHref("video", k, "x", false)).get("when")), k, "what a chip writes, the loader reads back");
  }

  // the row itself: one link per window, its number for the open tab, lit, and — as a change of tab does —
  // it ends a selection (a new window is a new shelf; pieces picked on the old one may not be on it)
  const row = src.slice(src.indexOf('<div className="wa-filters wa-when"'), src.indexOf("{canFilter && ("));
  assert.ok(row.startsWith('<div className="wa-filters wa-when" role="group" aria-label={t("Filter by date")}>'));
  assert.ok(row.includes("{WHEN_KEYS.map((k) => {"));
  assert.ok(row.includes("const n = whenCounts?.[k]?.[tab];"));
  assert.ok(row.includes('<Link key={k} to={whenHref(k)} preventScrollReset className={`wa-filterchip${whenLit === k ? " on" : ""}`} aria-current={whenLit === k ? "true" : undefined} onClick={endSelect}>'));
  assert.ok(row.includes('{t(WHEN_LABEL[k])}{n != null ? ` · ${n}` : ""}'));
  assert.ok(src.includes("const showWhen = whenOpen !== \"all\" || tabEver > 0;"), "shown where there is something to sift, and while a window is on");
  assert.ok(src.includes("        {showWhen && (\n          <div className=\"wa-filters wa-when\""));
  // it sits in the bar the other filters are in, between the search and the chips that sift the loaded page
  const bar = src.slice(src.indexOf('<div className="wa-bar">'), src.indexOf("{/* Select mode: tap pieces, then Keep or Delete them together */}"));
  const order = ['<Form method="get" className="wa-search"', '<span className="wa-qchip">', '<div className="wa-filters wa-when"', '<div className="wa-filters" role="group" aria-label={t("Filter pieces")}>', '<div className="wa-filters wa-pick"'].map((s) => bar.indexOf(s));
  assert.ok(order.every((at) => at > 0), "all five are in the bar");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in that order");

  // THE OTHER LINKS KEEP THE WINDOW. `whenQ` is empty with no window on, so each is then the link it was.
  assert.ok(src.includes('const whenQ = whenOpen !== "all" ? `&when=${whenOpen}` : "";'));
  // a search (a GET form: its fields ARE the new address)…
  assert.ok(src.includes('{whenOpen !== "all" && <input type="hidden" name="when" value={whenOpen} />}'));
  // …clearing the search, from its chip and from "Nothing here matches"…
  assert.equal(count(src, 'to={`?tab=${tab}${whenQ}${isCreator ? "&section=creator" : ""}`}'), 2);
  // …and Show older pieces
  assert.ok(src.includes('<Link to={`?show=${nextShow}&tab=${tab}${whenQ}${q ? `&q=${encodeURIComponent(q)}` : ""}${isCreator ? "&section=creator" : ""}`} preventScrollReset>{t("Show older pieces")} →</Link>'));
  // no link on the page rebuilds the address without it
  assert.ok(!src.includes('to={`?tab=${tab}${isCreator ? "&section=creator" : ""}`}'));
  assert.ok(!src.includes("to={`?show=${nextShow}&tab=${tab}${q ?"));
  // the chips beside it are untouched: still buttons over what was loaded, still combined with it
  assert.ok(src.includes('<button type="button" className={`wa-filterchip${filter === "kept" ? " on" : ""}`} aria-pressed={filter === "kept"} onClick={() => setFilter("kept")}><Ico n="heart" /> {t("Kept")} · {keptCount}</button>'));
  assert.ok(src.includes('const shelf = tab === "stills" ? stills : assets.filter((a) => A_KIND[a.type] === tab);'));
});

test("WHEN: an empty window says so — it is not an empty library, and not an empty search", () => {
  assert.ok(src.includes("  const tabEver = whenCounts?.all?.[tab] ?? tabTotal;"));
  assert.ok(src.includes('  const whenEmpty = whenOpen !== "all" && shelf.length === 0 && tabTotal === 0 && tabEver > 0 && genCards.length === 0;'));
  // the page's own empty state (the card: an icon, one line, one button), with the window's own sentence
  assert.ok(src.includes([
    "      {whenEmpty && (",
    '        <div className="wa-empty">',
    '          <span className="wa-empty-ic"><Ico n={tab === "blog" ? "article" : tab === "music" ? "music" : tab === "image" ? "image" : tab === "stills" ? "film" : "video"} size={26} /></span>',
    '          <p className="wa-empty-ln">{t(WHEN_EMPTY[whenOpen])}</p>',
    '          <Link to={whenHref("all")} preventScrollReset className="wb-btn wa-empty-cta" onClick={endSelect}>{t("Show all")}</Link>',
    "        </div>",
    "      )}",
  ].join("\n")));
  // the two states that were there step aside for it — and only for it
  assert.ok(src.includes("      {!whenEmpty && q && shelf.length === 0 && tabTotal === 0 && ("));
  assert.ok(src.includes("      {!whenEmpty && !q && shelf.length === 0 && tabTotal === 0 && genCards.length === 0 && failCards.length === 0 && ("));

  // what those three lines decide
  type S = { when: When; q: string; shelf: number; tabTotal: number; tabEver: number; cooking?: number; failed?: number };
  const says = ({ when, q, shelf, tabTotal, tabEver, cooking = 0, failed = 0 }: S) => {
    const whenEmpty = when !== "all" && shelf === 0 && tabTotal === 0 && tabEver > 0 && cooking === 0;
    const out: string[] = [];
    if (!whenEmpty && q && shelf === 0 && tabTotal === 0) out.push("nothing matches the search");
    if (whenEmpty) out.push(pure.WHEN_EMPTY[when as Exclude<When, "all">]);
    if (!whenEmpty && !q && shelf === 0 && tabTotal === 0 && cooking === 0 && failed === 0) out.push("no pieces yet — open the Studio");
    return out;
  };
  // Articles, this week, and the only two articles are older (seen: "Nothing from this week yet." + Show all)
  assert.deepEqual(says({ when: "week", q: "", shelf: 0, tabTotal: 0, tabEver: 2 }), ["Nothing from this week yet."]);
  assert.deepEqual(says({ when: "today", q: "", shelf: 0, tabTotal: 0, tabEver: 2 }), ["Nothing from today yet."]);
  assert.deepEqual(says({ when: "month", q: "", shelf: 0, tabTotal: 0, tabEver: 2 }), ["Nothing from this month yet."]);
  // a search that DOES match pieces — of other days: it is the day that leaves the shelf bare, so the day is named
  assert.deepEqual(says({ when: "today", q: "twin", shelf: 0, tabTotal: 0, tabEver: 2 }), ["Nothing from today yet."]);
  // a search that matches nothing at all in this tab keeps the search's own words
  assert.deepEqual(says({ when: "week", q: "twin", shelf: 0, tabTotal: 0, tabEver: 0 }), ["nothing matches the search"]);
  // a tab that has never held anything is "No … yet", window or no window
  assert.deepEqual(says({ when: "week", q: "", shelf: 0, tabTotal: 0, tabEver: 0 }), ["no pieces yet — open the Studio"]);
  assert.deepEqual(says({ when: "all", q: "", shelf: 0, tabTotal: 0, tabEver: 0 }), ["no pieces yet — open the Studio"]);
  // a piece being made right now is about to land in every window: nothing is said over its cooking tile
  assert.deepEqual(says({ when: "today", q: "", shelf: 0, tabTotal: 0, tabEver: 5, cooking: 1 }), []);
  // pieces in the window but further back than the loaded page are the "are further back" note's, as before
  assert.deepEqual(says({ when: "month", q: "", shelf: 0, tabTotal: 12, tabEver: 40 }), []);
  // and with no window on, nothing here has changed
  assert.deepEqual(says({ when: "all", q: "twin", shelf: 0, tabTotal: 0, tabEver: 0 }), ["nothing matches the search"]);
  assert.deepEqual(says({ when: "all", q: "", shelf: 3, tabTotal: 3, tabEver: 3 }), []);

  // an empty window does not take a tab away either: Scenes & Portraits is there while the library has any
  assert.ok(src.includes('...((whenCounts?.all?.stills ?? totals?.stills ?? 0) > 0 ? [["stills", "film", t("Scenes & Portraits")]] : [])'));
});

test("WHEN on a phone: the row scrolls by itself (never the page), edge to edge like the tabs, and its chips are 44px to the thumb", () => {
  // (Measured at 390 wide: the row 0–390, 477px of chips inside it; the page did not move sideways when
  //  pushed, the row did; each chip 44px tall. At 1100: one line, 445px, beside the search; chips 30px.)
  const cssAt = src.indexOf("const WA_CSS = `");
  const css = src.slice(cssAt, src.indexOf("`;", cssAt));
  const floorAt = css.indexOf("44px tap-target floor");
  assert.ok(css.includes(".wa-when{flex-wrap:nowrap;min-width:0;max-width:100%;overflow-x:auto;padding:2px 0;scrollbar-width:none;-webkit-overflow-scrolling:touch;}"));
  assert.ok(css.includes(".wa-when::-webkit-scrollbar{display:none;}"));
  const phone = "@media(max-width:640px){.wa-when{flex:1 1 100%;max-width:none;margin-inline:-16px;padding-inline:16px;}.wa-when .wa-filterchip{min-height:44px;}}";
  assert.ok(css.includes(phone));
  // it is a .wa-filters row that must NOT wrap: its rule comes after the one that wraps the others…
  const wraps = css.indexOf(".wa-filters{display:flex;flex-wrap:wrap;gap:8px;margin:0;}");
  const never = css.indexOf(".wa-when{flex-wrap:nowrap;");
  assert.ok(wraps > 0 && never > wraps, "between equals, the later rule wins");
  // …and before the page's 44px floor, which tests/archive-fixes.test.ts cuts out by position
  assert.ok(css.indexOf(phone) < floorAt);
  // edge to edge by the same 16px the tabs use (the shell's side padding on a phone)
  assert.ok(css.includes(".ws-tabs.wa-typebar{margin-inline:-16px;padding-inline:16px;}"));
  // the chips: links dressed as the chips beside them, never squeezed, never wrapped
  const chip = css.match(/\.wa-when \.wa-filterchip\{flex:0 0 auto;white-space:nowrap;text-decoration:none;font-variant-numeric:tabular-nums;min-height:(\d+)px;box-sizing:border-box;\}/);
  assert.ok(chip, "the chip's own rule");
  assert.equal(Number(chip![1]), 30, "as tall as the chips beside them on a wide screen");
  // on a phone, 44 — said for these chips by name, because the wide-screen 30px above out-ranks the page's
  // general ".wa-filterchip{min-height:44px}"
  assert.ok(css.includes("@media(max-width:640px){.wa-filterchip{min-height:44px;box-sizing:border-box;}}"), "the general rule is still there");
  assert.ok(Number(phone.match(/\.wa-when \.wa-filterchip\{min-height:(\d+)px;\}/)![1]) >= 44);
  assert.ok(css.indexOf(phone) > css.indexOf(chip![0]), "and it comes after the 30");
});

test("DOWNLOAD: what one go saves, what it skips, and where it stops", () => {
  const { downloadPlan, DL_CAP, DL_GAP_MS } = pure;
  assert.equal(DL_CAP, 20);
  assert.equal(DL_GAP_MS, 400);
  const piece = (id: string, over: Partial<Piece> = {}): Piece => ({ id, type: "IMAGE_AD", title: `Test piece ${id}`, media: `/renders/img-${id}.jpg`, isVideo: false, isAudio: false, ...over });

  // a video, an image and a song each have a file; an article has none; nor has a piece whose render is gone
  const mixed = downloadPlan([
    piece("v1", { type: "VIDEO_AD", title: "Short Film — The Last Slice (2)", media: "/renders/vid-9.mp4", isVideo: true }),
    piece("i1", { title: "Red Kettle", media: "/renders/img-1.png" }),
    piece("gone", { title: "Lost one", media: null }),
    piece("a1", { type: "AUDIO", title: "Neon Summer", media: "/renders/aud-3.mp3", isAudio: true }),
    piece("blog", { type: "BLOG_POST", title: "Five ways to use a kettle", media: null }),
    piece("blog2", { type: "BLOG_POST", title: "An article that somehow carries a file", media: "/renders/x.jpg" }),
  ]);
  assert.deepEqual(mixed.files, [
    { id: "v1", url: "/renders/vid-9.mp4", name: "Short-Film-The-Last-Slice-2.mp4" },
    { id: "i1", url: "/renders/img-1.png", name: "Red-Kettle.png" },
    { id: "a1", url: "/renders/aud-3.mp3", name: "Neon-Summer.mp3" },
  ]);
  assert.equal(mixed.skipped, 3, "the lost render and both articles");
  assert.equal(mixed.over, 0);

  // in the order given (the order the page shows them) — and no further than the cap
  const many = Array.from({ length: 35 }, (_, i) => piece(String(i + 1).padStart(2, "0")));
  const capped = downloadPlan(many);
  assert.equal(capped.files.length, 20);
  assert.deepEqual(capped.files.map((f) => f.id), many.slice(0, 20).map((p) => p.id), "the first 20, top of the page down");
  assert.equal(capped.over, 15);
  assert.equal(capped.skipped, 0);
  // a piece with nothing to save does not use up a place: 20 files still go, and it is counted as skipped, not as over
  const holes = downloadPlan([piece("x", { media: null }), ...many.slice(0, 20), piece("y", { type: "BLOG_POST", media: null }), ...many.slice(20, 23)]);
  assert.equal(holes.files.length, 20);
  assert.deepEqual([holes.skipped, holes.over], [2, 3]);
  // exactly the cap is not "more than one go takes"
  assert.equal(downloadPlan(many.slice(0, 20)).over, 0);
  assert.deepEqual(downloadPlan([]), { files: [], skipped: 0, over: 0 });
  assert.deepEqual(downloadPlan([piece("only", { media: null })]), { files: [], skipped: 1, over: 0 });
  assert.equal(downloadPlan(many, 3).files.length, 3);

  // two pieces that would be saved under one name are numbered, so neither overwrites the other
  const twins = downloadPlan([piece("1", { title: "Same!" }), piece("2", { title: "Same?" }), piece("3", { title: "same" }), piece("4", { title: "Same", media: "/renders/b.png" }), piece("5", { title: "Same 2" })]);
  assert.deepEqual(twins.files.map((f) => f.name), ["Same.jpg", "Same-2.jpg", "same-3.jpg", "Same.png", "Same-2-2.jpg"]);
  assert.equal(new Set(twins.files.map((f) => f.name.toLowerCase())).size, 5, "no two alike, even to a disk that ignores case");
});

test("DOWNLOAD: the file's name is the piece's title, cleaned, with the file's own extension", () => {
  const { dlFileName } = pure;
  const img = (title: string, url = "/renders/img-1.jpg") => dlFileName(title, url, false, false);
  assert.equal(img("Red Kettle"), "Red-Kettle.jpg");
  assert.equal(img("  Edit — make it sunset!  "), "Edit-make-it-sunset.jpg");
  assert.equal(img("50% off - today only"), "50-off-today-only.jpg");
  assert.equal(img("a/b\\c:d*e?f\"g<h>i|j"), "abcdefghij.jpg", "nothing a file system objects to");
  assert.equal(img("../../etc/passwd"), "etcpasswd.jpg");
  assert.equal(img("- _ -"), "easymode.jpg", "nothing left of it");
  assert.equal(img(""), "easymode.jpg");
  assert.equal(img("???"), "easymode.jpg");
  // letters of every alphabet are kept (the single Download keeps only unaccented Latin ones)
  assert.equal(img("Café Olé ñandú"), "Café-Olé-ñandú.jpg");
  assert.equal(img("测试 图片"), "测试-图片.jpg");
  assert.equal(img("ٹیسٹ تصویر"), "ٹیسٹ-تصویر.jpg");
  assert.equal(img("हिंदी विज्ञापन"), "हिंदी-विज्ञापन.jpg", "with its vowel signs, which are marks, not letters");
  // 60 characters at most, never ending on a dash, never half of a character — and a name that had to
  // be cut ends at a whole word (seen live: "…two-night-cleaners-at-an-old-theatre-find-a-bri.mp4")
  const long = img("The quick brown fox jumps over the lazy dog and keeps on running far away");
  assert.equal(long, "The-quick-brown-fox-jumps-over-the-lazy-dog-and-keeps-on.jpg");
  assert.ok(long.length <= 60 + 4);
  assert.equal(img("Horror Story — two night cleaners at an old theatre find a bright door"), "Horror-Story-two-night-cleaners-at-an-old-theatre-find-a.jpg");
  assert.equal(img(`${"a".repeat(20)} ${"b".repeat(60)}`), `${"a".repeat(20)}-${"b".repeat(39)}.jpg`, "one very long word is cut where it must be, not thrown away");
  assert.equal(img(`${"a".repeat(60)} tail`), `${"a".repeat(60)}.jpg`, "a cut that lands exactly between two words takes nothing more off");
  assert.equal(img(`${"a".repeat(59)} b`), `${"a".repeat(59)}.jpg`);
  assert.equal(img("𝒜".repeat(70)), `${"𝒜".repeat(60)}.jpg`);
  // the extension is the FILE's when its address shows one…
  assert.equal(img("Pic", "/renders/img-1.png"), "Pic.png");
  assert.equal(img("Pic", "/renders/img-1.webp"), "Pic.webp");
  assert.equal(img("Pic", "/renders/IMG-1.JPEG"), "Pic.jpeg");
  assert.equal(img("Pic", "https://replicate.delivery/xyz/out-0.png?sig=abc.def#frag"), "Pic.png", "a query string is not part of the name");
  assert.equal(dlFileName("Clip", "/renders/vid-1.webm", true, false), "Clip.webm");
  assert.equal(dlFileName("Song", "/renders/aud-1.wav", false, true), "Song.wav");
  // …else the kind's usual one
  assert.equal(img("Pic", "https://v3.fal.media/files/abc/def"), "Pic.jpg");
  assert.equal(img("Pic", "/renders/odd.bin"), "Pic.jpg");
  assert.equal(dlFileName("Clip", "https://cdn.example/stream/123", true, false), "Clip.mp4");
  assert.equal(dlFileName("Song", "https://cdn.example/stream/123", false, true), "Song.mp3");
  assert.equal(img("Pic", "data:image/svg+xml;utf8,<svg>.png"), "Pic.jpg", "a data: address has no file name to read");
  // the single Download's own namer is left as it was
  assert.ok(src.includes('  const base = (title || "").replace(/[^\\w\\- ]+/g, "").trim().replace(/\\s+/g, "-").slice(0, 40) || "easymode";'));
  assert.equal(count(src, "download={dlName("), 2, "the tile's and the opened piece's");
});

test("DOWNLOAD: the page's own files are handed to the browser; another site's would be OPENED, so those are told apart", () => {
  const { dlSameOrigin } = pure;
  const page = "https://easymodeapp.com";
  // every pipeline stores its render as /renders/<file> — the page's own
  assert.equal(dlSameOrigin("/renders/vid-1.mp4", page), true);
  assert.equal(dlSameOrigin("renders/vid-1.mp4", page), true);
  assert.equal(dlSameOrigin("https://easymodeapp.com/renders/vid-1.mp4", page), true);
  assert.equal(dlSameOrigin("blob:https://easymodeapp.com/3f1c", page), true);
  assert.equal(dlSameOrigin("data:image/png;base64,AAAA", page), true);
  // a fresh render still at its provider's address, the same site under another name, another port, plain http
  assert.equal(dlSameOrigin("https://replicate.delivery/xyz/out-0.png", page), false);
  assert.equal(dlSameOrigin("https://v3.fal.media/files/a/b.mp4", page), false);
  assert.equal(dlSameOrigin("https://www.easymodeapp.com/renders/vid-1.mp4", page), false);
  assert.equal(dlSameOrigin("https://easymodeapp.com.evil.example/renders/vid-1.mp4", page), false, "a look-alike is not the page");
  assert.equal(dlSameOrigin("https://easymodeapp.com:8443/renders/vid-1.mp4", page), false);
  assert.equal(dlSameOrigin("http://easymodeapp.com/renders/vid-1.mp4", page), false);
  assert.equal(dlSameOrigin("//cdn.example/renders/vid-1.mp4", page), false, "two slashes is another host");
  // an address nothing can be made of is treated as not ours (it is then fetched, fails, and is said)
  assert.equal(dlSameOrigin("/renders/vid-1.mp4", "null"), false);
  assert.equal(dlSameOrigin("http://[bad", page), false);
});

test("DOWNLOAD: what it says when a go is over — how many started, how many were skipped and why", () => {
  const { dlSummary } = pure;
  const say = (a: number, b: number, c: number) => dlSummary(a, b, c).map((p) => p.s.split("{n}").join(String(p.n))).join(" ");
  assert.equal(say(8, 0, 0), "8 downloads started.");
  assert.equal(say(1, 0, 0), "1 download started.");
  assert.equal(say(6, 2, 0), "6 downloads started. 2 skipped — their renders are gone.");
  assert.equal(say(7, 1, 1), "7 downloads started. 1 skipped — its render is gone. 1 didn't download — open it and use its own Download.");
  assert.equal(say(0, 3, 0), "3 skipped — their renders are gone.", "nothing to save is not \"0 downloads started\"");
  assert.equal(say(18, 0, 2), "18 downloads started. 2 didn't download — open each one and use its own Download.");
  assert.deepEqual(dlSummary(0, 0, 0), []);
  // the count rides along as {n}, for the translations that put it elsewhere in the sentence
  assert.deepEqual(dlSummary(20, 0, 0), [{ s: "{n} downloads started.", n: 20 }]);
  // …and the page runs every part through t()
  assert.ok(src.includes('const dlSay = (parts: Array<{ s: string; n: number }>) => parts.map((p) => t(p.s, { n: p.n })).join(" ");'));
});

test("DOWNLOAD is wired as asked: a click per file, 400ms apart, another site's file fetched first, the selection kept", () => {
  // ONE FILE: the browser's own download — an <a download> made for it and clicked
  assert.ok(src.includes([
    "function clickDownload(href: string, name: string) {",
    '  const a = document.createElement("a");',
    "  a.href = href;",
    "  a.download = name;",
    '  a.rel = "noopener";',
    "  document.body.appendChild(a);",
    "  a.click();",
    "  a.remove();",
    "}",
  ].join("\n")));

  const go = src.slice(src.indexOf("  const downloadPicked = async () => {"), src.indexOf("  const vIdx = viewer ?"));
  assert.ok(go.length > 1500 && go.length < 4000, "the whole go, and only it");
  // it cannot be started twice: a flag set before the first wait, and the button disabled for as long
  assert.ok(go.includes("    if (dlRunning.current || !picked.size) return;"));
  assert.ok(go.includes("    dlRunning.current = true;"));
  assert.ok(go.includes("    } finally {\n      dlRunning.current = false;\n      setDl(null);\n    }"));
  // what to save is the pure plan's call, over the picked pieces in the page's own order
  assert.ok(go.includes("const plan = downloadPlan(shelf.filter((a) => picked.has(a.id)));"));
  // more picked than one go takes is SAID, at once, and stays up while the go runs
  assert.ok(go.includes('if (plan.over > 0) setToast({ msg: t("Downloading the first {n} — select fewer to get the rest.", { n: plan.files.length }), ms: 600_000 });'));
  // each file in turn: progress for the button, then the page's own file straight to the browser…
  assert.ok(go.includes("        setDl({ i: i + 1, n: plan.files.length });"));
  assert.ok(go.includes("if (dlSameOrigin(f.url, window.location.origin)) clickDownload(f.url, f.name);"));
  // …another site's pulled first and saved from memory, as the Studio saves its staged result…
  assert.ok(go.includes('const res = await fetch(f.url, { mode: "cors", signal:'));
  assert.ok(go.includes("if (!res.ok) throw new Error(String(res.status));"));
  assert.ok(go.includes("const blobUrl = URL.createObjectURL(await res.blob());"));
  assert.ok(go.includes("clickDownload(blobUrl, f.name);"));
  assert.ok(go.includes("setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);"));
  const studio = read("app", "routes", "web.studio.tsx");
  assert.ok(studio.includes('const res = await fetch(url, { mode: "cors" });') && studio.includes("const obj = URL.createObjectURL(await res.blob());"), "the Studio's way, which this follows");
  // …and one that will not come is counted, never opened in a tab (the Studio's single save may do that; a
  // run of twenty must not)
  assert.ok(go.includes("        } catch { failed++; }"));
  assert.ok(!go.includes("window.open("));
  assert.ok(!go.includes("location.href") && !go.includes("location.assign"));
  // 400ms between one file and the next
  assert.ok(go.includes("        await new Promise((r) => setTimeout(r, DL_GAP_MS));"));
  // when it is over, the toast says what happened — and stays long enough to be read
  assert.ok(go.includes("    setToast({ msg: dlSay(dlSummary(started, plan.skipped, failed)), ms: 6000 });"));
  assert.ok(go.includes("      if (plan.skipped) setToast({ msg: dlSay(dlSummary(0, plan.skipped, 0)), ms: 6000 });"), "nothing to save at all is said too");
  // THE SELECTION IS NOT TOUCHED (people download, then keep or delete the same pieces)…
  assert.ok(!go.includes("setPicked("));
  assert.ok(!go.includes("setSelecting(") && !go.includes("endSelect("));
  // …and nothing goes to the server: no action, no tokens, no new route
  assert.ok(!go.includes("submit(") && !go.includes("intent"));
  const action = src.slice(src.indexOf("export const action"), src.indexOf("/** Countdown text, or the truth"));
  assert.ok(!/download/i.test(action), "the action knows nothing of it");
  assert.ok(!go.includes("spendTokens") && !go.includes("tokens"));

  // what the loop does, with a clock that can be read: 8 files — 6 the page's own, 1 fetched, 1 refused
  // (seen on the test page: 7 downloads asked of the browser at 0, 409, 405, 408, 402, 406 and 526 ms; the
  //  refused one was never opened; "7 downloads started. … 1 didn't download …"; the 9 pieces still picked)
  const plan = pure.downloadPlan([
    ...["a", "b", "c", "d", "e", "f"].map((id) => ({ id, type: "IMAGE_AD", title: `Own ${id}`, media: `/renders/img-${id}.jpg`, isVideo: false, isAudio: false })),
    { id: "far", type: "IMAGE_AD", title: "Far, fetchable", media: "https://replicate.delivery/x/out.png", isVideo: false, isAudio: false },
    { id: "no", type: "IMAGE_AD", title: "Far, refused", media: "https://cdn.example/no-cors.jpg", isVideo: false, isAudio: false },
    { id: "gone", type: "IMAGE_AD", title: "Gone", media: null, isVideo: false, isAudio: false },
  ]);
  let clock = 0;
  const clicks: Array<{ at: number; how: string; name: string }> = [];
  let started = 0;
  let failed = 0;
  for (const f of plan.files) {
    try {
      if (pure.dlSameOrigin(f.url, "https://easymodeapp.com")) clicks.push({ at: clock, how: "link", name: f.name });
      else {
        if (f.url.includes("no-cors")) throw new Error("refused");
        clicks.push({ at: clock, how: "fetched", name: f.name });
      }
      started++;
    } catch { failed++; }
    clock += pure.DL_GAP_MS;
  }
  assert.equal(clicks.length, 7);
  assert.deepEqual(clicks.map((c) => c.at), [0, 400, 800, 1200, 1600, 2000, 2400]);
  assert.deepEqual(clicks.filter((c) => c.how === "fetched").map((c) => c.name), ["Far-fetchable.png"]);
  assert.deepEqual(pure.dlSummary(started, plan.skipped, failed).map((p) => p.s), ["{n} downloads started.", "1 skipped — its render is gone.", "1 didn't download — open it and use its own Download."]);
});

test("DOWNLOAD in the bar: progress on the button, not tappable while it runs, and nothing in the bar moves when it starts", () => {
  const bar = src.slice(src.indexOf('<div className="wa-bulk" ref={bulkRef}'), src.indexOf('<button type="button" className="wa-bulk-done"'));
  // first of the three actions; Keep and Delete are as they were
  const order = ['className={`wa-bulk-btn dl${dl ? " busy" : ""}`}', 'className="wa-bulk-btn keep"', "className={`wa-bulk-btn del${armBulk ? \" armed\" : \"\"}`}"].map((s) => bar.indexOf(s));
  assert.ok(order.every((at) => at > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(bar.includes('<button type="button" className="wa-bulk-btn keep" disabled={!picked.size || busy} onClick={keepPicked}><Ico n="heart" /> {t("Keep")}</button>'));
  assert.ok(bar.includes('<button type="button" className={`wa-bulk-btn del${armBulk ? " armed" : ""}`} disabled={!picked.size || busy} onClick={deletePicked}>'));
  // disabled with nothing picked, and for as long as a go runs; its name for a screen reader is the sentence
  assert.ok(bar.includes([
    '          <button type="button" className={`wa-bulk-btn dl${dl ? " busy" : ""}`} disabled={!picked.size || !!dl} aria-busy={dl ? true : undefined}',
    '            aria-label={dl ? t("Downloading {i} of {n}…", { i: dl.i, n: dl.n }) : undefined} onClick={downloadPicked}>',
  ].join("\n")));
  // the label's three faces
  assert.ok(bar.includes([
    '            <span className={`wa-bulk-lbl${dl ? " busy" : ""}`}>',
    '              <span className="wa-bulk-idle">{t("Download")}</span>',
    '              {dl && <span className="wa-bulk-long">{t("Downloading {i} of {n}…", { i: dl.i, n: dl.n })}</span>}',
    '              <span className="wa-bulk-short" aria-hidden="true">{dl ? `${dl.i} / ${dl.n}` : `${DL_CAP} / ${DL_CAP}`}</span>',
    "            </span>",
  ].join("\n")));

  const cssAt = src.indexOf("const WA_CSS = `");
  const css = src.slice(cssAt, src.indexOf("`;", cssAt));
  // a wide screen: the word, or — running — the sentence; the short count is not shown
  assert.ok(css.includes(".wa-bulk-lbl.busy .wa-bulk-idle,.wa-bulk-short{display:none;}"));
  // running, it is disabled but READABLE (the page's disabled bar buttons are dimmed to 45%)
  assert.ok(css.includes(".wa-bulk-btn:disabled{opacity:.45;cursor:default;}"));
  assert.ok(css.includes(".wa-bulk-btn.dl.busy:disabled{opacity:1;cursor:progress;"));
  // A PHONE. SEEN at 390 with the first version of this (the short count simply replacing the word): the
  // button went from 203px to 94px when the go started, Keep slid up beside it, and a second tap on the
  // spot where Download had been KEPT the nine picked pieces. So the word and the count share one cell,
  // sized by the wider of the two whichever is showing — measured since: 203px idle, 203px running; the
  // second tap lands on the disabled Download; the bar 116px tall throughout.
  const phoneAt = css.indexOf("@media(max-width:640px){\n  .wa-bulk-lbl{display:inline-grid;justify-items:center;}");
  assert.ok(phoneAt > 0);
  const phone = css.slice(phoneAt, css.indexOf("\n}", phoneAt));
  assert.ok(phone.includes(".wa-bulk-lbl > span{grid-area:1/1;}"), "stacked in one cell");
  assert.ok(phone.includes(".wa-bulk-lbl .wa-bulk-long{display:none;}"), "the sentence is the wide screen's");
  // both the word and the count are ALWAYS laid out here (so both always size the cell)…
  assert.ok(phone.includes(".wa-bulk-lbl .wa-bulk-idle,.wa-bulk-lbl.busy .wa-bulk-idle,.wa-bulk-lbl .wa-bulk-short{display:block;}"));
  // …and only one of them is seen
  assert.ok(phone.includes(".wa-bulk-lbl.busy .wa-bulk-idle,.wa-bulk-lbl:not(.busy) .wa-bulk-short{visibility:hidden;}"));
  // idle, the count that sizes the cell is the widest a go can show ("20 / 20"), so "1 / 8" can never be wider
  assert.ok(bar.includes("`${DL_CAP} / ${DL_CAP}`"));
  // all of it sits before the page's 44px floor (cut out by position in tests/archive-fixes.test.ts), and
  // the bar's buttons — this one included — are 44px on a phone by the rule that was already there
  assert.ok(phoneAt < css.indexOf("44px tap-target floor"));
  assert.ok(css.includes(".wa-bulk-btn,.wa-bulk-done{flex:1 1 auto;justify-content:center;min-height:44px;}"));
});

test("the toast clears the select bar however tall the bar is — and a toast may say how long it stays", () => {
  // SEEN at 390, before any of this: the select bar is two rows there (116px), and "Kept 1 piece." sat at
  // y 680–720 — on the bar's first row (680–734), over "N selected · Select all · Keep". That row is now
  // where Download shows its progress, so the bar's top is measured and the toast sits 16px above it.
  assert.ok(src.includes("    const measure = () => setBulkTop(Math.round(window.innerHeight - el.getBoundingClientRect().top));"));
  assert.ok(src.includes('<div className="wa-bulk" ref={bulkRef} role="toolbar" aria-label={t("Selected pieces")}>'));
  assert.ok(src.includes('<div className="wa-toast" role="status" aria-live="polite" style={selecting ? { bottom: Math.max(96, bulkTop + 16) } : undefined}>'));
  const toastBottom = (barTopFromBottom: number) => Math.max(96, barTopFromBottom + 16);
  assert.equal(toastBottom(16 + 60), 96, "a wide screen (one row, 60px): where it always was — measured 767.6–807.6 before and after");
  assert.equal(toastBottom(16 + 116), 148, "a phone (two rows): 16px above the bar — measured 626–666 over a bar at 680");
  assert.equal(toastBottom(34 + 116), 166, "…and above it still on a phone that keeps the bar off its home indicator");
  assert.equal(toastBottom(0), 96, "before the bar has been measured, the old 96");
  // it is re-measured when the bar changes height (a longer label wraps it), and forgotten when selecting ends
  const fx = src.slice(src.indexOf("  const bulkRef = useRef<HTMLDivElement | null>(null);"), src.indexOf("  const keepPicked = () =>"));
  assert.ok(fx.includes("    if (!selecting || !el) { setBulkTop(0); return; }"));
  assert.ok(fx.includes("    const ro = new ResizeObserver(measure);\n    ro.observe(el);\n    return () => ro.disconnect();\n  }, [selecting]);"));

  // HOW LONG. A toast that says nothing about it stays exactly as long as it did: 3s, or 6.2s with an Undo.
  assert.ok(src.includes("const [toast, setToast] = useState<{ msg: string; undo?: () => void; pending?: ReturnType<typeof setTimeout>; ms?: number } | null>(null);"));
  assert.ok(src.includes("    const timer = setTimeout(() => setToast(null), toast.ms ?? (toast.undo ? 6200 : 3000));"));
  const stays = (toast: { undo?: () => void; ms?: number }) => toast.ms ?? (toast.undo ? 6200 : 3000);
  assert.equal(stays({}), 3000);
  assert.equal(stays({ undo: () => undefined }), 6200);
  assert.equal(stays({ ms: 6000 }), 6000);
  // only the Download's toasts ask for longer
  assert.equal(count(src, "ms: 6000 }"), 2);
  assert.equal(count(src, "ms: 600_000 }"), 1);
  assert.equal(count(src, ", ms: "), 3);
});

test("every new word goes through t() — and these are all of them", () => {
  // The dictionary (app/lib/ui-i18n-dict.ts) is someone else's file: these are reported for translation,
  // not asserted there. "Today", "Download" and "Show all" were in it already and are reused.
  const NEW = [
    "All time", "This week", "This month",
    "Nothing from today yet.", "Nothing from this week yet.", "Nothing from this month yet.",
    "Filter by date",
    "Downloading {i} of {n}…",
    "Downloading the first {n} — select fewer to get the rest.",
    "1 download started.", "{n} downloads started.",
    "1 skipped — its render is gone.", "{n} skipped — their renders are gone.",
    "1 didn't download — open it and use its own Download.", "{n} didn't download — open each one and use its own Download.",
  ];
  for (const s of NEW) assert.ok(src.includes(`"${s}"`), s);
  // the ones held as data are each handed to t() where they are shown…
  assert.ok(src.includes("{t(WHEN_LABEL[k])}"));
  assert.ok(src.includes("{t(WHEN_EMPTY[whenOpen])}"));
  assert.ok(src.includes("parts.map((p) => t(p.s, { n: p.n }))"));
  // …and the data holds nothing else: what the block can say is exactly the reused words plus the list above
  const said = new Set<string>([
    ...Object.values(pure.WHEN_LABEL),
    ...Object.values(pure.WHEN_EMPTY),
    ...pure.dlSummary(1, 1, 1).map((p) => p.s),
    ...pure.dlSummary(2, 2, 2).map((p) => p.s),
  ]);
  const REUSED = ["Today"];
  assert.deepEqual([...said].filter((s) => !NEW.includes(s) && !REUSED.includes(s)), []);
  assert.equal(said.size, 4 + 3 + 6);
  // the three written straight into the page are inside a t( call
  for (const s of ["Filter by date", "Downloading {i} of {n}…", "Downloading the first {n} — select fewer to get the rest."]) {
    assert.ok(src.includes(`t("${s}"`), s);
    assert.equal(count(src, `"${s}"`), count(src, `t("${s}"`), `${s} — never outside t()`);
  }
  for (const s of ["Show all", "Download"]) assert.ok(src.includes(`{t("${s}")}`), s);
});
