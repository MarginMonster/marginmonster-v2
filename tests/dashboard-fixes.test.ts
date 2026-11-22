/* Fourteen things a walk through the signed-in app found on 2026-11-22 — the Dashboard and its plans, the
 * Auto-post pages (Campaigns, Channels, Product Channels, Link your socials), the Brand Kit and the Helpurr
 * chat. None of them was a crash. Each was a place where the page said one thing and did another:
 *
 *   - a paying subscriber with no way to cancel, a trialist told to tap a button that was not there;
 *   - a paid action that left its form open and its button live, so one more tap bought it twice;
 *   - a free trial promised to accounts that had already had theirs;
 *   - a dead button with no reason beside it, a link whose words named a different page, a "Saved" that
 *     stayed up over unsaved changes, a Save button sitting under the phone dock.
 *
 * These read the route sources as text and pin each fix where it was made, with what was seen beside it.
 * They do not look at the translation dictionary. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// a Windows checkout has CRLF in some of these files and a Linux one never does — the snippets below are LF
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");
const route = (name: string) => read("app", "routes", name);
/** how many times `piece` appears in `src` */
const count = (src: string, piece: string) => src.split(piece).length - 1;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...sources(rel));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

test("1 · a subscriber on the standalone Creator plan can cancel — and take the cancellation back", () => {
  // "Cancel plan" and "Keep my plan" were drawn only inside the marketing-tier card that is the current
  // plan. Creator is sold from its own card further down and is never one of those, so someone paying for
  // Creator alone saw "Creator section — included with your plan ✓" and had no way to cancel anywhere in
  // the app, under a checkout that says "Cancel anytime".
  const dash = route("web._index.tsx");
  const card = dash.slice(dash.indexOf('{t("Creator section — included with your plan")}'), dash.indexOf(") : !d.tier ? ("));
  assert.ok(card.length > 0, "the Creator card is where it was");
  assert.ok(card.includes('{d.tier === "CREATOR" && d.billingOn && ('), "only for the Creator plan itself, and only with billing on");
  assert.ok(card.includes("{d.cancelPending ? ("), "cancelled already → the way back, not a second cancel");
  assert.ok(card.includes('<input type="hidden" name="intent" value="cancelPlan" />'));
  assert.ok(card.includes('<input type="hidden" name="intent" value="resumePlan" />'));
  // the same controls as the plan cards, word for word — the button is not renamed or restyled here
  const cancelBtn = '<button className="wb-btn ghost" disabled={busy}>{t("Cancel plan")}</button>';
  const keepBtn = '<button className="wb-btn" disabled={busy}>{t("Keep my plan")}</button>';
  const ask = "confirm(t(\"Cancel your plan? It stays active — with all your tokens — until the end of the period you've already paid for, then stops renewing.\"))";
  for (const piece of [cancelBtn, keepBtn, ask]) {
    assert.ok(card.includes(piece), piece);
    assert.equal(count(dash, piece), 2, `on the plan card and on the Creator card, and nowhere else: ${piece}`);
  }
  // a marketing subscriber still gets it on their own plan card, and never twice (Creator is not in d.tiers)
  assert.ok(dash.includes("{isCurrent && d.billingOn && ("));
  // …and both intents are still the one branch of the action, whichever card sent them
  assert.ok(dash.includes('if (intent === "cancelPlan" || intent === "resumePlan") {'));
});

test("2 · starting a channel closes the form, so the new card is what shows", () => {
  // The action redirects the page to itself. Nothing said the channel had started; the form stayed open
  // and filled with its button live, and a second tap made a second channel on the same schedule.
  for (const [file, self] of [["web.channels.tsx", 'return redirect("/web/channels");'], ["web.product-channels.tsx", 'return redirect("/web/product-channels");']] as const) {
    const src = route(file);
    assert.ok(src.includes(self), `${file}: still lands back on its own page`);
    assert.ok(src.includes("const [showForm, setShowForm] = useState(series.length === 0);"), file);
    assert.ok(src.includes("const seriesCount = useRef(series.length);"), `${file}: the count before`);
    assert.ok(src.includes("if (series.length > seriesCount.current) setShowForm(false);"), `${file}: one more than before → close`);
    assert.ok(src.includes("seriesCount.current = series.length;"), `${file}: and remember the new count`);
    assert.match(src, /seriesCount\.current = series\.length;\n {2}\}, \[series\.length\]\);/, `${file}: runs when the list changes size`);
  }
  // what the closed form leaves on show
  assert.ok(route("web.channels.tsx").includes('{t("First video rendering…")}'));
  assert.ok(route("web.product-channels.tsx").includes('{t("Making your first video…")}'));
});

test("3 · a campaign that launched closes its launcher, clears the picks and shows the confirmation", () => {
  // A launch charges the whole month up front and nothing stops a second one. A launch that worked said so
  // in a line at the top of the page while the scroll stayed at the button — back to "Start {name}", with
  // the same products ticked.
  const src = route("web.campaigns.tsx");
  assert.ok(src.includes('const launched = !!(actionData && "launched" in actionData && actionData.launched);'));
  assert.ok(src.includes("setShowLaunch(false); setPicked([]); setPickedAssets([]);"));
  assert.ok(src.includes('okRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });'), "brought into view the way the error is");
  assert.ok(src.includes('errRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });'), "…which is still how the error does it");
  assert.ok(src.includes('<p className="wc-ok" role="status" tabIndex={-1} ref={okRef}>'));
  assert.ok(!src.includes('<p className="wc-ok">'), "the confirmation nothing could scroll to");
  // every new answer from the action is looked at — a second launch in a row is a second launch
  assert.match(src, /okRef\.current\?\.focus\(\);\n {2}\}, \[actionData\]\);/);
  // the launcher can be opened again: a launch always leaves a campaign, and that draws the button
  assert.ok(src.includes('{showLaunch ? t("Close") : t("New campaign")}'));
});

test("4 · a free trial is offered only to an account that still has one, and a trial's end date is promised only when it is kept", () => {
  const dash = route("web._index.tsx");
  const camp = route("web.campaigns.tsx");

  // THE OFFER. Three places promised "your free 7-day trial" to anyone without an active plan — including
  // accounts whose one trial is spent, for whom the plan cards on the same page say "billed today".
  assert.match(dash, /: d\.trialAvailable\n\s+\? <>\{t\("Heads up — making anything runs on a plan\. Start your "\)\}<Link to="\/web#plans">\{t\("free 7-day trial"\)\}<\/Link>/);
  assert.ok(dash.includes('<>{t("Heads up — making anything runs on a plan — ")}<Link to="/web#plans">{t("see plans")}</Link>{t(" to make your first piece.")}</>'));
  assert.equal(count(dash, 't("free 7-day trial")'), 1, "said once, and only on the trial branch");
  assert.ok(dash.includes('hint: d.trialAvailable ? t("Start your 7-day free trial") : t("See plans")'), "the launch tracker's plan step");
  assert.ok(camp.includes('<Link to="/web#plans">{d.trialAvailable ? t("start your 7-day free trial") : t("see plans")}</Link>'));
  assert.ok(!camp.includes('<Link to="/web#plans">{t("start your 7-day free trial")}</Link>'));
  // Campaigns works it out the way the Dashboard does
  assert.ok(camp.includes('import { trialAlreadyTaken } from "../lib/stripe.server";'));
  assert.ok(camp.includes("trialAvailable: !trialAlreadyTaken(account),"));
  assert.ok(dash.includes("trialAvailable: !trialAlreadyTaken(account),"));

  // THE END DATE. A trialist changing tier read "Keeps your current trial end date" up to the last minute.
  // With under 49 h left the checkout sends Stripe no trial at all and charges the card today.
  assert.match(dash, /: d\.trialCarries\n\s+\? <>\{t\("Keeps your current trial end date · then \{price\}"/);
  assert.doesNotMatch(dash, /: d\.trialing\n\s+\? <>\{t\("Keeps your current trial end date/);
  assert.match(dash, /trialCarries: !!shop\.activePlan\?\.trialEndsAt\n\s+&& new Date\(shop\.activePlan\.trialEndsAt\)\.getTime\(\) - Date\.now\(\) > TRIAL_CARRY_MIN_MS,/);
  // the page and the checkout make the SAME cut — change one and this is where you find the other
  assert.ok(dash.includes("const TRIAL_CARRY_MIN_MS = 49 * 3_600_000;"));
  assert.ok(read("app", "lib", "stripe.server.ts").includes("endsMs - Date.now() > 49 * 3_600_000"));
  // …read off the field the subscribe action hands the checkout
  assert.ok(dash.includes("trialEndsAt: shop.activePlan?.trialEndsAt ?? null,"));
  // what that decides
  const carries = (endsAt: string | null, now: number) => !!endsAt && new Date(endsAt).getTime() - now > 49 * 3_600_000;
  const now = Date.UTC(2026, 10, 22, 12);
  const inHours = (h: number) => new Date(now + h * 3_600_000).toISOString();
  assert.equal(carries(inHours(120), now), true, "five days left: the date is kept");
  assert.equal(carries(inHours(50), now), true);
  assert.equal(carries(inHours(49), now), false, "exactly 49 h is not MORE than 49 h");
  assert.equal(carries(inHours(30), now), false, "the last two days: billed today");
  assert.equal(carries(inHours(-1), now), false, "a trial that is over");
  assert.equal(carries(null, now), false, "no trial");
  assert.equal(carries("not a date", now), false);
});

test("5 · a trialist who wants to pay has a button for it on the Dashboard", () => {
  // The note under the plans said "start your plan from the Studio whenever you're ready". No tab is called
  // Studio, and the one button that starts the plan is drawn in the maker only after a spend has already
  // failed on the trial cap — so there was nothing to tap.
  const dash = route("web._index.tsx");
  const act = dash.slice(dash.indexOf('if (intent === "endTrial") {'), dash.indexOf('if (intent === "pack") {'));
  assert.ok(act.length > 0, "the Dashboard's action answers endTrial");
  assert.ok(act.includes('const { endTrialNow } = await import("../lib/stripe.server");'));
  assert.ok(act.includes("const r = await endTrialNow(account.id);"), "the signed-in account, never an id from the form");
  assert.ok(act.includes("json({ ok: tr(lang, \"You're on the full plan — your whole allowance just unlocked.\") })"), "answered where this page's toast reads it");
  assert.ok(act.includes("json({ error: r.error || tr(lang, \"Couldn't update your plan just now.\") })"), "a refusal is never silent");
  // the helper itself refuses anyone who is not on a trial
  assert.ok(read("app", "lib", "stripe.server.ts").includes("export async function endTrialNow(accountId: string): Promise<{ ok: boolean; error?: string }> {"));

  const note = dash.slice(dash.indexOf("{d.tier && d.trialing && ("), dash.indexOf("{d.tier && !d.trialing && ("));
  assert.ok(note.includes('<input type="hidden" name="intent" value="endTrial" />'));
  assert.ok(note.includes('<button className="wb-btn" disabled={busy || !d.billingOn}>{t("Start my plan now")}</button>'));
  // it charges the card today, so it asks first — in the sentence the maker's own button sits under
  assert.ok(note.includes('if (!confirm(t("Start your plan now and your full monthly allowance unlocks immediately — your card is charged today instead of on day 7."))) e.preventDefault();'));
  // neither sentence sends anyone to "the Studio" any more
  assert.ok(note.includes("{t(\"Extra tokens can't be spent during the trial, so we don't sell them yet — start your plan whenever you're ready and your full balance opens up.\")}"));
  assert.ok(dash.includes('"Start your plan now and your balance opens up straight away.",'));
  assert.ok(!dash.includes("start your plan from the Studio whenever"));
  assert.ok(!dash.includes("Start your plan now from the Studio and"));
});

test("6 · a link opens what its words say", () => {
  const dash = route("web._index.tsx");
  const camp = route("web.campaigns.tsx");
  const pc = route("web.product-channels.tsx");
  const shell = route("web.tsx");
  const studio = route("web.studio.tsx");

  // HOW A LINK PICKS A MAKER. Creator and the Ad Maker are both /web/studio; the shell's mode says which one
  // opens, and it is set by whoever sends you there (the nav tabs do it on click). A link that did not set
  // it opened whichever maker was used last.
  assert.ok(shell.includes("<Outlet context={{ mode, setMode: chooseMode }} />"));
  assert.ok(shell.includes("const chooseMode = (m: ShellMode) => { setMode(m); writeModeCookie(m);"));
  assert.ok(shell.includes('to="/web/studio" onClick={() => chooseMode("casual")}>{t("Creator")}</Link>'), "the nav's own Creator tab, for comparison");
  for (const src of [camp, pc]) assert.ok(src.includes('useOutletContext<{ setMode: (m: "marketing" | "casual") => void } | null>();'));

  // "Import store" / "import store" opened the maker on its default Video tab. Import is a tab of the Ad
  // Maker only: arriving in Creator, ?tab=import falls back to Image.
  assert.match(studio, /\(\[[^\]]*"import"[^\]]*\] as const\)\.find\(\(t\) => t === searchParams\.get\("tab"\)\)/, "the maker reads ?tab=import");
  assert.ok(studio.includes('["import", "Import your store"]'), "…and it is the Ad Maker's tab row that has it");
  assert.ok(pc.includes('<Link to="/web/studio?tab=import" className="pc-go sm" onClick={() => shell?.setMode("marketing")}>{t("Import store")}</Link>'));
  assert.ok(pc.includes('<Link to="/web/studio?tab=import" className="pc-link" onClick={() => shell?.setMode("marketing")}>{t("import store")}</Link>'));
  assert.ok(!pc.includes('to="/web/studio"'), "no bare link to the maker is left on Product Channels");
  assert.ok(camp.includes('<Link to="/web/studio?tab=import" onClick={() => shell?.setMode("marketing")}>{t("pull your store in")}</Link>'), "Campaigns' own import link had the tab and not the maker");

  // "Open Creator →" and "Create" opened the Ad Maker unless Creator was the last one used
  assert.ok(dash.includes('<Link to="/web/studio" className="wb-btn ghost wd-solo-cta" onClick={() => setMode("casual")}>{t("Open Creator")} →</Link>'));
  assert.ok(camp.includes('<Link to="/web/studio" onClick={() => shell?.setMode("casual")}>{t("Create")}</Link>'));

  // "A video, image ad or article" led to a tab row with no Article tab
  assert.ok(dash.includes('hint: t("A video or image ad")'));
  assert.ok(!dash.includes("A video, image ad or article"));
});

test("7 · a button that is switched off says why, right beside it", () => {
  const camp = route("web.campaigns.tsx");
  const ch = route("web.channels.tsx");
  const pc = route("web.product-channels.tsx");

  // CAMPAIGNS. Nothing is ticked to begin with (on purpose), so every first visit ended at a dead
  // "Start {name}" — and the reasons shown covered only a locked video plan and a short wallet.
  const hint = '{!picked.length && <p className="wc-hint">{t("Pick at least one product for the campaign to feature.")}</p>}';
  const start = '<button type="button" className="wb-btn wc-go" disabled={busy || !picked.length || !plan || plan.videoLocked || !plan.affordable} onClick={launch}>';
  assert.ok(camp.includes(hint));
  assert.ok(camp.includes(start));
  assert.ok(camp.indexOf(hint) < camp.indexOf(start) && camp.indexOf(start) - camp.indexOf(hint) < 400, "directly above the button it explains");

  // CHANNELS. "Start my channel" is off with an empty topic, or set to post by itself with nowhere ticked.
  assert.ok(ch.includes("const disabled = creating || !niche.trim() || (autoPost && plats.length === 0) || !canAfford;"));
  assert.ok(ch.includes("{!niche.trim() && <div className=\"ch-hint\">{t(\"Give your channel a vibe — what's it about?\")}</div>}"));
  assert.ok(ch.includes('{autoPost && plats.length === 0 && <div className="ch-hint">{t("Connect a social account first (or switch to “Let me approve each one”).")}</div>}'));
  // (the wallet reason was already there)
  assert.ok(ch.includes('{!canAfford && <div className="ch-err">{t("You need at least {n} tokens to run a channel —", { n: facelessCost })}'));
  // the product channel's form has the same nowhere-to-post state
  assert.ok(pc.includes("const disabled = creating || (autoPost && plats.length === 0) || !canAfford;"));
  assert.ok(pc.includes('{autoPost && plats.length === 0 && <div className="pc-hint">{t("Connect a social account first (or switch to “Let me approve each one”).")}</div>}'));
  assert.ok(pc.includes(".pc-hint{margin-top:8px;font-size:12px;color:#8A7A3A;font-weight:600;}"), "and a style for it");

  // RESUME is off on a wallet that cannot pay for one video. The reason was shown only when the engine had
  // paused the channel for that; paused by hand on a low wallet, the button was simply dead.
  for (const [src, k] of [[ch, "ch"], [pc, "pc"]] as const) {
    assert.ok(src.includes(`<button className="${k}-act primary" disabled={tokens < facelessCost}>{t("Resume")}</button>`), k);
    const note = `{paused && tokens < facelessCost && s.pauseReason !== "out-of-tokens" && (\n        <div className="${k}-paused-note">{t("Out of tokens")} — <Link to="/web#plans" className="${k}-link">{t("top up")}</Link></div>\n      )}`;
    assert.ok(src.includes(note), `${k}: said whenever the wallet is short, and only once`);
    assert.ok(src.includes(`{s.pauseReason === "out-of-tokens" && <> — <Link to="/web#plans" className="${k}-link">{t("top up")}</Link></>}`), `${k}: the engine's own pause still says it its own way`);
  }
});

test("8 · \"Make another\" under a Helpurr result shows what one tap will spend", () => {
  // The chip runs the same make again on a single tap — its full cost, 150 tokens for a video — and was the
  // only spending button in the chat with no price on it.
  const shell = route("web.tsx");
  assert.ok(shell.includes('{m.makeSpec && <button type="button" onClick={() => runMakes([{ ...m.makeSpec! }])}>{t("↻ Make another")} · {m.makeSpec.cost > 0 ? t("{n} tokens →", { n: m.makeSpec.cost }) : t("Free →")}</button>}'));
  assert.doesNotMatch(shell, /\{t\("↻ Make another"\)\}<\/button>/, "the chip with no price");
  // written the way the "Make it" button writes its own price
  assert.ok(shell.includes('<b>{m.makes[0].cost > 0 ? t("{n} tokens →", { n: m.makes[0].cost }) : t("Free →")}</b>'));
});

test("9 · the Brand Kit says \"Saved\" only while what is on the page is what was saved", () => {
  // `saver.data` never clears. After one save the bar went on saying "Saved — new content uses it." through
  // later colour, font and voice edits and through a fresh "Read my store again" — and the "check it over…
  // then save" notice and the Save pulse never came back.
  const src = route("web.brand.tsx");
  assert.ok(src.includes("const shown = JSON.stringify({ kit, colors, fonts, voice });"), "everything the save sends");
  assert.ok(src.includes('const saved = saver.data?.ok === "save" && saver.state === "idle" && savedAs === shown;'));
  // kept when Save is pressed — the fields stay live while the save is on its way
  assert.match(src, /const save = \(\) => \{\n {4}setSavedAs\(shown\);\n {4}saver\.submit\(\{/);
  assert.ok(src.includes('{saved && <span className="bk-ok" role="status"><Ico n="check" size={13} /> {t("Saved — new content uses it.")}</span>}'));
  assert.ok(src.includes('const unsaved = reader.data?.ok === "read" && !saved;'), "the same test decides the notice and the pulse");
  assert.ok(!src.includes('{saver.data?.ok === "save" && !saving && <span'), "\"a save happened once\" is not \"this is saved\"");
  assert.ok(!src.includes('!(saver.data?.ok === "save" && saver.state === "idle")'));
  // what that decides, on the values a save sends
  const snap = (colors: string[], tone: string) => JSON.stringify({ kit: { name: "Test Store" }, colors, fonts: ["Poppins"], voice: { tone, tagline: "", about: "" } });
  const savedAs = snap(["#0c7a46"], "warm");
  assert.equal(savedAs === snap(["#0c7a46"], "warm"), true, "untouched since the save");
  assert.equal(savedAs === snap(["#0c7a46", "#b08526"], "warm"), false, "a colour added");
  assert.equal(savedAs === snap(["#0c7a46"], "warm, playful"), false, "the tone changed");
});

test("10 · on a phone the Brand Kit's save bar sits above the bottom dock and clear of Helpurr", () => {
  // The bar stuck 12px from the bottom of the screen, inside a page at z-index 1 — exactly under the fixed
  // bottom dock at z-index 50. "Save Brand Kit" was covered until the page was scrolled to its very end.
  const brand = route("web.brand.tsx");
  const shell = route("web.tsx");
  const base = ".bk-savebar{position:sticky;bottom:max(12px,env(safe-area-inset-bottom,0px));z-index:5;";
  const bar = /@media\(max-width:760px\)\{\.bk-savebar\{bottom:calc\((\d+)px \+ env\(safe-area-inset-bottom,0px\)\);padding-right:(\d+)px;\}\}/.exec(brand);
  assert.ok(brand.includes(base), "wide screens keep the bar where it was");
  assert.ok(bar, "phones get their own position");
  assert.ok(brand.indexOf(bar[0]) > brand.indexOf(base), "…written after the base rule, so it is the one that applies");
  // the numbers are the shell's own
  assert.match(shell, /\.wb-bottom\{display:flex;[^}]*position:fixed;[^}]*bottom:calc\(12px \+ env\(safe-area-inset-bottom,0px\)\);z-index:50;/, "the dock");
  const main = /@media\(max-width:760px\)\{[\s\S]*?\.wb-main\{padding:10px (\d+)px calc\((\d+)px \+ env\(safe-area-inset-bottom,0px\)\);\}/.exec(shell);
  const fab = /@media\(max-width:620px\)\{\.mm-fab\{bottom:calc\((\d+)px \+ env\(safe-area-inset-bottom,0px\)\);right:(\d+)px;width:(\d+)px;height:(\d+)px\}/.exec(shell);
  assert.ok(main && fab);
  const [side, clearance] = [Number(main[1]), Number(main[2])];
  const [fabBottom, fabRight, fabWidth, fabHeight] = [Number(fab[1]), Number(fab[2]), Number(fab[3]), Number(fab[4])];
  const [barBottom, barPadRight] = [Number(bar[1]), Number(bar[2])];
  assert.equal(barBottom, clearance, "the bar stands on the room the shell leaves for its dock");
  assert.equal(clearance, 98);
  // Helpurr floats in the bottom-right corner at the height the bar now sticks at…
  assert.ok(fabBottom <= barBottom && barBottom < fabBottom + fabHeight, "they share a band of the screen");
  // …so the bar keeps its button out from under it (the page is itself `side` px in from the screen edge)
  assert.ok(barPadRight >= fabRight + fabWidth - side + 12, `${barPadRight}px of padding against a ${fabWidth}px button`);
});

test("11 · \"posted\" in the This-week block counts this week", () => {
  // It was every piece the shop had ever published, beside a count of what was made in the last seven days:
  // "This week you made 2 pieces and posted 14".
  const dash = route("web._index.tsx");
  assert.ok(dash.includes("const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);"));
  assert.ok(dash.includes("db.asset.count({ where: { shopId: shop.id, createdAt: { gte: weekAgo } } }),"), "made: the last seven days");
  assert.ok(dash.includes('db.asset.count({ where: { shopId: shop.id, status: "PUBLISHED", updatedAt: { gte: weekAgo } } }),'), "posted: the same seven days");
  assert.ok(!dash.includes('db.asset.count({ where: { shopId: shop.id, status: "PUBLISHED" } }),'), "the all-time count");
  assert.ok(dash.includes("week: { made: madeThisWeek, posted: postedThisWeek, toReview: pendingCount },"));
  assert.ok(dash.includes('{t("and posted")} <b>{d.week.posted}</b>'));
});

test("12 · the pages use the names the app uses now", () => {
  const dash = route("web._index.tsx");
  const camp = route("web.campaigns.tsx");
  const ch = route("web.channels.tsx");
  const pc = route("web.product-channels.tsx");
  const conn = route("web.connect.tsx");
  const shell = route("web.tsx");

  // "ANTHEM" is the top tier's internal key. The plans page sells Starter, Studio and LEGEND — a merchant
  // told to "upgrade to Studio or Anthem" finds no plan called Anthem to upgrade to.
  assert.match(read("app", "lib", "plan-config.ts"), /key: "ANTHEM",\n\s+name: "Legend",/);
  assert.ok(ch.includes("{t(\"That's on the Studio & Legend plans. Upgrade and your channel can start posting today.\")}"));
  assert.ok(pc.includes("{t(\"That's on the Studio & Legend plans. Upgrade and your store can start posting today.\")}"));
  assert.ok(ch.includes('tr(lang, "Channels need a plan with video — upgrade to Studio or Legend.")'));
  assert.ok(pc.includes('tr(lang, "Product Channels need a plan with video — upgrade to Studio or Legend.")'));
  for (const src of [ch, pc]) {
    assert.ok(!src.includes("Studio & Anthem"));
    assert.ok(!src.includes("Studio or Anthem"));
  }

  // Nothing is called "Gallery" any more: a finished piece lands in the Archive. (Helpurr said "Check your
  // Gallery in a moment" when a make outlasted its wait.)
  assert.ok(!shell.includes("Check your Gallery in a moment"));
  assert.doesNotMatch(shell, /\bt\("[^"]*Gallery[^"]*"/, "no sentence the shell shows names a Gallery");
  assert.ok(shell.includes("content: t(\"This is taking longer than usual — it'll show up in your Archive when it's done. Mind checking back there in a bit? 🐾\")"));

  // The section is "Creator" (the nav tab, the plan cards) — "Create" was its old name.
  assert.ok(shell.includes('onClick={() => chooseMode("casual")}>{t("Creator")}</Link>'));
  assert.ok(dash.includes('cue={t("Open Creator")}'));
  assert.ok(!dash.includes('t("Open Create")'));
  assert.ok(dash.includes('tr(lang, "Creator added to your plan — your Creator section is unlocked.")'));
  assert.ok(!dash.includes("your Create section"));

  // The hub calls the page "Link your socials"; its own heading said "Auto-posting".
  assert.ok(read("app", "routes", "web.autopost.tsx").includes('to: "/web/connect", icon: "link", on: d.linked.length > 0,\n      title: t("Link your socials"),'));
  assert.ok(conn.includes('<h1 className="wb-h1">{t("Link your socials")}</h1>'));
  assert.ok(!conn.includes('<h1 className="wb-h1">{t("Auto-posting")}</h1>'));

  // THE "…three ways" PARAGRAPH on Campaigns, Product Channels and Link your socials. Kept — with the
  // section named as the nav names it, and each entry named after the page it is.
  assert.ok(shell.includes('to="/web/autopost">{t("Auto-post")}</Link>'), "what the nav calls the section");
  for (const [name, src] of [["campaigns", camp], ["product channels", pc], ["link your socials", conn]] as const) {
    assert.ok(src.includes('<b style={{ color: "#0C7A46" }}>{t("Auto-post")}</b>{t(" works three ways — ")}'), name);
    assert.ok(!src.includes('t("Social Marketing")'), `${name}: a section name the app no longer has`);
    for (const piece of ['{t(" (a one-month push)")}', '{t(" (always-on)")}', '{t(" (connect accounts)")}']) assert.equal(count(src, piece), 1, `${name}: ${piece}`);
    // "Channels" was a link to PRODUCT Channels, and "Auto-posting" a link to Link your socials
    assert.doesNotMatch(src, /to="\/web\/product-channels"[^>]*>\{t\("Channels"\)\}/, name);
    assert.doesNotMatch(src, /to="\/web\/connect"[^>]*>\{t\("Auto-posting"\)\}/, name);
    assert.equal(count(src, '{t("Campaigns")}</Link>{t(" (a one-month push)")}') + count(src, '<b style={{ color: "#14201A" }}>{t("Campaigns")}</b>{t(" (a one-month push)")}'), 1, name);
    assert.equal(count(src, '{t("Product Channels")}</Link>{t(" (always-on)")}') + count(src, '<b style={{ color: "#14201A" }}>{t("Product Channels")}</b>{t(" (always-on)")}'), 1, name);
    assert.equal(count(src, '{t("Link your socials")}</Link>{t(" (connect accounts)")}') + count(src, '<b style={{ color: "#14201A" }}>{t("Link your socials")}</b>{t(" (connect accounts)")}'), 1, name);
  }
  // each page is the bold entry of its own paragraph, and links to the other two
  assert.ok(camp.includes('<b style={{ color: "#14201A" }}>{t("Campaigns")}</b>'));
  assert.ok(pc.includes('<b style={{ color: "#14201A" }}>{t("Product Channels")}</b>'));
  assert.ok(conn.includes('<b style={{ color: "#14201A" }}>{t("Link your socials")}</b>'));
  assert.ok(camp.includes('<Link to="/web/product-channels" style={{ color: "#0C7A46", fontWeight: 700 }}>{t("Product Channels")}</Link>'));
  assert.ok(camp.includes('<Link to="/web/connect" style={{ color: "#0C7A46", fontWeight: 700 }}>{t("Link your socials")}</Link>'));
});

test("13 · the small controls are big enough to tap on a phone", () => {
  const shell = route("web.tsx");
  // The full-screen chat: ☰ (the only door to your chats) was about 22px tall, 🏠 about 20px, and the
  // per-message actions were 17px lines of text. The 44px floor block missed all three.
  const floor = shell.slice(shell.lastIndexOf("@media(max-width:620px){"));
  assert.ok(floor.includes(".mm-x{min-width:44px;min-height:44px}"), "the block the chat's other controls are in");
  assert.ok(floor.includes(".mm-side-toggle,.mm-homebtn{min-width:44px;min-height:44px}"));
  assert.ok(floor.includes(".mm-msgact{min-height:40px}"));
  // (they are still the controls these rules name)
  assert.ok(shell.includes('className="mm-side-toggle" onClick={() => setSideOpen((o) => !o)} aria-label={t("Your chats")}'));
  assert.ok(shell.includes('className="mm-homebtn" onClick={() => setShowHome(true)}'));
  assert.ok(shell.includes('className="mm-msgact" onClick={regenerate}>{t("↻ Try again")}</button>'));

  // The ✕ on the Dashboard's toast — the only way to close an error, which stays until dismissed — was 32px.
  const dash = route("web._index.tsx");
  const x = /\n\.wd-toast-x\{[^}]*\}/.exec(dash);
  assert.ok(x);
  assert.ok(x[0].includes("min-width:44px;min-height:44px;"));
  assert.ok(!x[0].includes("32px"));
  assert.ok(dash.includes('<button type="button" className="wd-toast-x" onClick={() => setToast(null)} aria-label={t("Dismiss")}>✕</button>'));

  // "All drops →" on a channel card had no height at all. Product Channels' own card link already did.
  const rule = "{min-height:44px;display:inline-flex;align-items:center}";
  assert.ok(route("web.channels.tsx").includes(`.ch-card-gal${rule}`));
  assert.ok(route("web.product-channels.tsx").includes(`.pc-card-gal${rule}`));
});

test("14 · /web/home is retired: it sends you to the real home, and nothing leads to it", () => {
  // Reachable only by typing the address. It showed a made-up "1,284 clicks 7d" as the shop's own number,
  // section names the app no longer uses, and no shell header or dock to leave by.
  const home = route("web.home.tsx");
  assert.ok(home.includes("const RETIRED = true as boolean;"));
  assert.match(home, /export const loader = async \(\{ request \}: LoaderFunctionArgs\) => \{\n {2}if \(RETIRED\) return redirect\("\/web"\);\n/, "before anything else the loader does");
  assert.ok(home.includes('import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";'));
  // the page is kept, switched off — not deleted
  assert.ok(home.includes("export default function WebHome() {"));
  assert.ok(home.includes("return json({ tokens: tokensRemainingLive(shop.activePlan), videos, images });"));
  // nothing in the app links, sends or redirects anyone there — a <Link>, a Helpurr action ({ to: … }), a
  // redirect or a script (the shell only asks whether it is ON that page, to hide its header and dock)
  const leadsThere = /(?:\bto|href)\s*[=:]\s*\{?["'`]\/web\/home|(?:redirect|navigate|nav|go|assign|replace)\(["'`]\/web\/home|location(?:\.href)?\s*=\s*["'`]\/web\/home/;
  const leading = sources("app").filter((f) => leadsThere.test(fs.readFileSync(path.join(root, f), "utf8")));
  assert.deepEqual(leading, []);
  for (const way of ['<Link to="/web/home">', "{ label, to: '/web/home' }", 'redirect("/web/home")', 'navigate("/web/home")', 'window.location.href = "/web/home"', "<a href=\"/web/home\">"]) assert.match(way, leadsThere, way);
  assert.ok(route("web.tsx").includes('loc.pathname !== "/web/home"'), "the shell's own check is left alone");
  assert.doesNotMatch('loc.pathname !== "/web/home"', leadsThere);
});
