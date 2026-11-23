/* POSTING TO MORE NETWORKS — YouTube (Shorts), X, Threads, LinkedIn and Bluesky beside TikTok, Instagram
 * and Facebook (2026-11-22). Nobody could post to the new networks to try it, so what is pinned here is
 * what the provider's own documentation says each one needs (docs.upload-post.com: upload-video,
 * upload-photo, resources/character-limits, guides/ai-content-labeling, api/user-profiles):
 *
 *   1. every network's text fits its own limit once the link, the hashtags, #EasyModeAi and the trial
 *      credit are on — counted the way that network counts (Threads and YouTube in UTF-8 bytes) — and the
 *      disclosure is never the thing that is cut;
 *   2. a request for TikTok / Instagram / Facebook alone is field for field what it always was;
 *   3. a photo is never sent to a network that takes only video (YouTube), and the post still goes out to
 *      the rest, with the skipped network named.
 *
 * Pinterest is left out on purpose: every pin needs a board (`pinterest_board_id` is required). */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NETWORKS, POSTABLE_PLATFORMS, VIDEO_PLATFORMS, PHOTO_PLATFORMS, CONNECT_PLATFORMS, TRIAL_CREDIT_TEXT,
  captionFor, fitCaption, headlineOf, networkFields, planPublish, utf8Bytes,
} from "../app/lib/social-networks.ts";
import { trimKeepingDisclosure } from "../app/lib/post-title.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

const LINK = "https://easymodeapp.com/go/a/cmabc123def456ghi789jkl0m";
// buildPostTitle's exact shape: caption, 🛒 link, the tag block, the credit
const post = (caption: string, tags = "#cozy #homedecor #giftideas #EasyModeAi", credit = TRIAL_CREDIT_TEXT) =>
  [caption, `🛒 ${LINK}`, tags, credit].filter(Boolean).join("\n\n");
const LONG = "This little lamp turns a cold desk into the coziest corner of the house — warm light, soft glow, and it folds flat for travel. ".repeat(40).trim();
const EMOJI = "Cozy nights ☕✨🕯️ start with this lamp 🌙💛 — warm light 🔆 that folds flat 🧳 ".repeat(60).trim();
const has = (s: string) => /#EasyModeAi\b/i.test(s);
const size = (key: string, s: string) => (NETWORKS.find((n) => n.key === key)!.captionUnit === "bytes" ? utf8Bytes(s) : s.length);

test("one list: the networks, what each takes, and Pinterest left out", () => {
  assert.deepEqual([...POSTABLE_PLATFORMS], ["tiktok", "instagram", "facebook", "youtube", "x", "threads", "linkedin", "bluesky"]);
  assert.ok(!POSTABLE_PLATFORMS.includes("pinterest" as never), "a pin needs a board — the member would have to choose one");
  assert.deepEqual([...VIDEO_PLATFORMS], [...POSTABLE_PLATFORMS], "every one of them takes a video");
  assert.ok(!PHOTO_PLATFORMS.includes("youtube"), "YouTube is not a platform[] value for upload_photos");
  // the hosted connect page's documented values only — an undocumented one could break the page for everyone
  assert.deepEqual([...CONNECT_PLATFORMS], ["tiktok", "instagram", "facebook", "youtube", "x", "threads", "linkedin"]);
  const lim = Object.fromEntries(NETWORKS.map((n) => [n.key, [n.captionMax, n.captionUnit]]));
  assert.deepEqual(lim.x, [280, "chars"]);
  assert.deepEqual(lim.bluesky, [300, "chars"]);
  assert.deepEqual(lim.threads, [500, "bytes"]);
  assert.deepEqual(lim.linkedin, [3000, "chars"]);
  assert.deepEqual(lim.youtube, [5000, "bytes"]);
  // the credit literal is the caption writer's, kept in step
  assert.ok(read("app", "lib", "social-caption.server.ts").includes(`export const TRIAL_CREDIT = "${TRIAL_CREDIT_TEXT}";`));
});

test("every network's text fits its limit with the link, tags and credit on — and keeps #EasyModeAi", () => {
  for (const n of NETWORKS) {
    for (const caption of ["A warm little lamp for cold desks 💡", LONG, EMOJI, ""]) {
      for (const tags of ["#cozy #homedecor #giftideas #EasyModeAi", "#EasyModeAi"]) {
        const raw = post(caption || "New from our shop", tags);
        const out = captionFor(n.key, raw);
        assert.ok(size(n.key, out) <= n.captionMax, `${n.key}: ${size(n.key, out)} > ${n.captionMax}`);
        assert.ok(has(out), `${n.key} lost the disclosure`);
        if (n.stripsLinks) assert.ok(!out.includes(LINK), "X removes links itself — the budget is not spent on one");
        else if (n.captionMax >= 280) assert.ok(out.includes(LINK), `${n.key} kept the link`);
        assert.ok(!/https?:\/\/\S*$/.test(out.split("\n\n")[0]) || out.split("\n\n")[0].includes(LINK), "no half a link");
      }
    }
  }
});

test("fitting: short text is untouched; the credit goes first, then extra hashtags, then caption words", () => {
  const short = post("A warm little lamp for cold desks 💡");
  assert.equal(fitCaption(short, 3000), short, "fits → unchanged");
  // just over 280 with the credit on → only the credit goes
  let words = 1;
  while (post("lamp ".repeat(words + 1).trim(), undefined, "").length <= 280) words++;
  const cap = "lamp ".repeat(words).trim();
  assert.ok(post(cap).length > 280 && post(cap, undefined, "").length <= 280, "the credit alone tips it over");
  assert.equal(fitCaption(post(cap), 280), post(cap, undefined, ""), "only the credit went");
  // a little longer: the member's extra hashtags go next, the caption whole
  const cap2 = `${cap} lamp lamp lamp lamp lamp`;
  assert.equal(fitCaption(post(cap2), 280), post(cap2, "#EasyModeAi", ""));
  // a long caption: the disclosure stays, the caption is cut on a word, never mid-link
  const out = fitCaption(post(LONG), 300);
  assert.ok(out.length <= 300 && has(out) && out.includes(LINK));
  assert.ok(!out.includes(TRIAL_CREDIT_TEXT));
  // the member's own words with the tag INSIDE them: still disclosed, not doubled
  const inline = fitCaption(`${LONG} #EasyModeAi`, 280);
  assert.ok(inline.length <= 280 && has(inline));
  assert.equal(fitCaption("Love this lamp #EasyModeAi", 280), "Love this lamp #EasyModeAi");
  // no tag at all → one is added
  assert.ok(has(fitCaption("Love this lamp", 280)));
  // bytes: Threads counts an emoji as 4
  const th = fitCaption(post(EMOJI), 500, { unit: "bytes" });
  assert.ok(utf8Bytes(th) <= 500 && has(th));
});

test("YouTube gets a real title of at most 100 characters, and a description", () => {
  const f = Object.fromEntries(networkFields("youtube", post(LONG), true));
  assert.ok(f.youtube_title.length <= 100 && f.youtube_title.length > 10, f.youtube_title);
  assert.ok(!f.youtube_title.includes("http") && !f.youtube_title.includes("#EasyModeAi"), "a title, not the post");
  assert.ok(utf8Bytes(f.youtube_description) <= 5000 && has(f.youtube_description));
  assert.equal(f.privacyStatus, "public");
  assert.equal(f.selfDeclaredMadeForKids, "false");
  assert.equal(f.containsSyntheticMedia, "true");
  assert.ok(!/[<>]/.test(networkFields("youtube", post("Cats <3 this lamp > all"), true).map(([, v]) => v).join("")), "YouTube rejects < and >");
  assert.equal(headlineOf(post(""), 100), "New video", "an empty caption still gets a title");
  const li = Object.fromEntries(networkFields("linkedin", post(LONG), true));
  assert.ok(li.linkedin_title.length <= 100 && li.linkedin_description.length <= 3000 && has(li.linkedin_description));
  for (const [k, field] of [["x", "x_title"], ["threads", "threads_title"], ["bluesky", "bluesky_title"]] as const) {
    assert.deepEqual(networkFields(k, post(LONG), true).map(([name]) => name), [field]);
  }
});

test("a request for TikTok / Instagram / Facebook alone is exactly what it always was", () => {
  // the fields publishPost sent before this change, in order (media attached after them)
  const legacy = (user: string, title: string, isVideo: boolean, platforms: string[]) => {
    const f: Array<[string, string]> = [["user", user], ["title", trimKeepingDisclosure(title)]];
    for (const p of platforms) f.push(["platform[]", p]);
    f.push(["is_ai_generated", "true"]);
    if (isVideo && platforms.includes("facebook")) f.push(["facebook_is_ai_generated", "true"]);
    return f;
  };
  const subsets = [["tiktok"], ["instagram"], ["facebook"], ["tiktok", "instagram"], ["instagram", "facebook"], ["tiktok", "instagram", "facebook"], ["facebook", "tiktok"]];
  for (const title of [post("A warm little lamp for cold desks 💡"), post(LONG), "short", ""]) {
    for (const isVideo of [true, false]) {
      for (const platforms of subsets) {
        const plan = planPublish("shop_1", { title, isVideo, platforms });
        assert.deepEqual(plan.fields, legacy("shop_1", title, isVideo, platforms));
        assert.deepEqual(plan.sent, platforms);
        assert.deepEqual(plan.skipped, []);
      }
    }
  }
  // and the provider file sends the plan, the media after it, nothing else
  const src = read("app", "lib", "social-provider.server.ts");
  const fn = src.slice(src.indexOf("export async function publishPost"));
  assert.ok(fn.includes("const form = new FormData();\n    for (const [k, v] of plan.fields) form.append(k, v);\n\n    if (params.isVideo) {"));
  assert.equal((fn.match(/form\.append\(/g) || []).length, 3, "the plan's fields, then video or photos[]");
});

test("a photo never goes to YouTube; the rest still post and the skip is named", () => {
  const plan = planPublish("shop_1", { title: post("Lamp"), isVideo: false, platforms: ["youtube", "instagram", "x"] });
  assert.deepEqual(plan.sent, ["instagram", "x"]);
  assert.deepEqual(plan.skipped, [{ platform: "youtube", reason: "no-photos" }]);
  assert.ok(!plan.fields.some(([k, v]) => (k === "platform[]" && v === "youtube") || k.startsWith("youtube_") || k === "privacyStatus"));
  const only = planPublish("shop_1", { title: "x", isVideo: false, platforms: ["youtube"] });
  assert.deepEqual(only.sent, []);
  const src = read("app", "lib", "social-provider.server.ts");
  assert.ok(src.includes('if (plan.sent.length === 0) return { ok: false, error: "no-network-takes-this", skipped };'), "nothing is sent when no network can take it");
  // a video to YouTube carries its fields
  const v = planPublish("shop_1", { title: post("Lamp"), isVideo: true, platforms: ["youtube"] });
  assert.ok(v.fields.some(([k]) => k === "youtube_title"));
  // an unknown key is left out rather than sent
  assert.deepEqual(planPublish("shop_1", { title: "x", isVideo: true, platforms: ["pinterest"] }).skipped, [{ platform: "pinterest", reason: "unknown-network" }]);
});

test("the pages and the provider use the one list", () => {
  const prov = read("app", "lib", "social-provider.server.ts");
  assert.ok(prov.includes("platforms: [...CONNECT_PLATFORMS],"), "the connect page is asked for every documented network");
  assert.ok(!prov.includes('["tiktok", "instagram", "facebook"]'));
  assert.ok(prov.includes("platforms = platforms.filter((p) => (ANALYTICS_PLATFORMS as readonly string[]).includes(p));"));
  for (const f of ["web.connect.tsx", "web.channels.tsx", "web.product-channels.tsx"]) {
    const s = read("app", "routes", f);
    assert.ok(!s.includes('["tiktok", "instagram", "facebook"]'), f);
    assert.ok(!s.includes('tiktok: "TikTok"'), f);
    assert.ok(s.includes('from "../lib/social-networks"'), `${f} reads the pure list (it renders the names client-side)`);
  }
  const cap = read("app", "lib", "social-caption.server.ts");
  assert.ok(cap.includes("const SUPPORTED = POSTABLE_PLATFORMS;"));
  // the original three networks' writer brief is word for word what it was
  assert.ok(cap.includes("instagram: `warm hook + 1 short line. ${TAG_CAP.instagram} hashtags: mix 2 broad-reach, 2-3 niche/product-specific, 1 branded.`,"));
  assert.ok(cap.includes("facebook: `friendly, a touch more descriptive, clear value. only ${TAG_CAP.facebook} hashtags.`,"));
});
