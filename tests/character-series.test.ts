/* A CHARACTER'S SHOW — a series that belongs to one of the cast and runs by itself.
 *
 * The owner, 2026-11-24: "i would like to try to give character the chance to have a "series" which would
 * directly connect with autoposting, characters could have multiple series. Series being selectable and
 * would run in background like a campaign simulating posts and stories or entertainent types similar to
 * Quiet wolf on facebook".
 *
 * Built on what already ran: a Channel (CreatorSeries — the autopilot that makes a faceless video on a
 * cadence and posts it). A character's show is a third kind of channel whose every drop is an EPISODE: a
 * told story starring that character, drawn from their own picture, told in their voice when they have
 * one, ending on the show's sign-off — and posted, or held for approval, exactly as any channel's drop is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHARACTER_SERIES_MAX, SHOWS, SHOW_CADENCES, SHOW_SCENES,
  episodeIdeaPrompt, episodeTopic, parseStar, showMeta, showOf, signoffOf, tidyIdea,
} from "../app/lib/character-series.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// (a checkout with CRLF line endings must read the same as one with LF)
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

const HOWL = { id: "howl", name: "Howl", faceUrl: "/avatars/howl_0.jpg?v=3", kind: "monster" as const, look: "a huge upright werewolf with shaggy dark-grey fur and yellow eyes", voiceId: "char:howl" };

test("the shows a character can be given: a short list, each told in a story format that exists", () => {
  assert.deepEqual(SHOWS.map((s) => [s.key, s.name, s.template]), [["lessons", "Lessons", "moral"], ["tales", "Tales", "testmovie"], ["nights", "Night tales", "horror"]]);
  for (const s of SHOWS) assert.ok(s.line.length > 10 && s.brief.includes("each episode is ONE"), s.key);
  assert.equal(showOf("nights")?.template, "horror");
  assert.equal(showOf("nope"), null);
  assert.equal(showOf(undefined), null);
  // every format a show is told in can be NARRATED (film-engine's own list)
  const engine = read("app", "lib", "film-engine.server.ts");
  const narratable = engine.slice(engine.indexOf("const NARRATED_BRIEF"), engine.indexOf("export const NARRATABLE_KEYS"));
  for (const s of SHOWS) assert.ok(narratable.includes(`  ${s.template}: "`), `${s.template} can be told by a narrator`);
  // an episode is a film: a minute long, never twice a day, a few shows at once
  assert.equal(SHOW_SCENES, 6);
  assert.deepEqual([...SHOW_CADENCES], ["3x_week", "daily"]);
  assert.equal(CHARACTER_SERIES_MAX, 3);
});

test("the star is checked whenever it is read: a name, and a picture that is ours or https", () => {
  assert.deepEqual(parseStar(JSON.stringify(HOWL)), HOWL);
  assert.deepEqual(parseStar({ ...HOWL, kind: "robot", voiceId: "" }), { ...HOWL, kind: "person", voiceId: null }, "an unknown kind is a person; no voice is no voice");
  assert.equal(parseStar({ ...HOWL, faceUrl: "https://cdn.example.com/howl.png" })?.faceUrl, "https://cdn.example.com/howl.png");
  for (const bad of [null, "", "{", 4, [], {}, { name: "Howl" }, { ...HOWL, name: " " }, { ...HOWL, faceUrl: "javascript:alert(1)" }, { ...HOWL, faceUrl: "http://plain.example/h.png" }, { ...HOWL, faceUrl: "/renders/../secret.jpg" }, { ...HOWL, faceUrl: "/avatars/x.jpg?next=//evil.example" }]) {
    assert.equal(parseStar(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseStar({ ...HOWL, name: "N".repeat(90), look: "l".repeat(900) })!.name.length, 40);
  assert.equal(parseStar({ ...HOWL, look: "l".repeat(900) })!.look.length, 220);
});

test("the next episode's premise: this star, this show, and never an episode that was already made", () => {
  const p = episodeIdeaPrompt({ seriesName: 'Howl: "Night" tales', about: "things heard in the woods after dark", show: showOf("nights")!, star: HOWL, recent: ["Howl finds a lantern nobody lit", " ", "Howl hears his name from the well"], episode: 3 });
  assert.ok(p.includes("a short-video series called \"Howl: 'Night' tales\""), "a quote in a name cannot end the sentence");
  assert.ok(p.includes("Its star, in every episode: Howl (a creature — it stays one) — a huge upright werewolf"));
  assert.ok(p.includes("What the show is about, in its maker's words: \"things heard in the woods after dark\"."));
  assert.ok(p.includes("The kind of show: each episode is ONE creepy tale told at night"));
  assert.ok(p.includes("Give the premise of EPISODE 3: ONE line, at most 25 words — what happens to Howl, specific and new."));
  assert.ok(p.includes("It must NOT repeat or closely resemble any of these earlier episodes:\n- Howl finds a lantern nobody lit\n- Howl hears his name from the well\n"));
  assert.ok(p.includes("no real named people, brands, prices or statistics. Anyone in danger is an adult."));
  // a first episode has nothing to avoid; a person is not called a creature
  const first = episodeIdeaPrompt({ seriesName: "Rosa: Lessons", about: "", show: showOf("lessons")!, star: { ...HOWL, name: "Rosa", kind: "person", look: "" }, recent: [], episode: 1 });
  assert.ok(!first.includes("must NOT repeat") && !first.includes("in its maker's words") && first.includes("Its star, in every episode: Rosa.\n"));
  // the answer, tidied to one line — or what the show is about when there was none
  assert.equal(tidyIdea("  1. \"Howl follows wet footprints to a door that was never there\"\nsecond line", "x"), "Howl follows wet footprints to a door that was never there");
  assert.equal(tidyIdea("", "things heard in the woods"), "things heard in the woods");
  assert.equal(tidyIdea(null, "fallback"), "fallback");
  assert.ok(tidyIdea("w ".repeat(400), "x").length <= 170);
});

test("what the story's writer is told: the premise and whose show it is — inside the 300 characters it reads", () => {
  const t = episodeTopic({ idea: "Howl follows wet footprints to a door that was never there", seriesName: "Howl: Night tales", star: HOWL });
  assert.equal(t, 'Howl follows wet footprints to a door that was never there (An episode of "Howl: Night tales", starring Howl.)');
  const long = episodeTopic({ idea: "i".repeat(400), seriesName: "S".repeat(90), star: HOWL });
  assert.ok(long.length <= 300 && long.endsWith("starring Howl.)"), `the tail is never the part that is cut (${long.length})`);
  // (the writer cuts the topic at 300: film-engine)
  assert.ok(read("app", "lib", "film-engine.server.ts").includes("\"${topic.slice(0, 300)}\""));
  // the sign-off: one clean line; and what a finished episode keeps about its show
  assert.equal(signoffOf('  "Stay quiet.\n Stay sharp."  '), "Stay quiet. Stay sharp.");
  assert.equal(signoffOf(null), "");
  assert.ok(signoffOf("x".repeat(400)).length <= 120);
  assert.deepEqual(showMeta({ id: "s1", name: "Howl: Night tales", episode: 4.7, star: "Howl" }), { id: "s1", name: "Howl: Night tales", episode: 4, star: "Howl" });
  for (const bad of [null, "x", [], {}, { id: "s1", name: "N" }, { id: "", name: "N", episode: 2 }, { id: "s1", name: "N", episode: 0 }]) assert.equal(showMeta(bad), null, JSON.stringify(bad));
});

test("the channel that runs it: two new columns, a third kind of drop, an episode instead of a clip", () => {
  const schema = read("prisma", "schema.prisma");
  const model = schema.slice(schema.indexOf("model CreatorSeries {"), schema.indexOf("model LandingPage {"));
  assert.ok(model.includes("  characterJson    String?\n") && model.includes("  signoff          String?\n"), "additive: the deploy applies the schema itself");
  const eng = read("app", "lib", "creator-series.server.ts");
  // what an episode costs: what a told story of that length costs — nothing while films are free
  assert.ok(eng.includes("const cost = s.sourceType === \"character\" ? estimateFilmTokens(SHOW_SCENES) : TOKEN_COST.faceless;"));
  assert.ok(eng.includes("if (tokensRemainingLive(shop.activePlan) < cost) { await pause(s.id, \"out-of-tokens\"); continue; }"));
  assert.ok(eng.includes("if (cost > 0) {\n          try {\n            const r = await spendTokens(s.shopId, cost);"), "nothing is spent when it costs nothing");
  assert.ok(eng.includes("if (cost > 0) await refundTokens(s.shopId, cost, fromExtra);"), "…and what was spent comes back if the episode cannot be queued");
  // the star and the show are read from the channel's own row — and a channel without them is paused, not guessed
  assert.ok(eng.includes("star = parseStar(s.characterJson);") && eng.includes("show = showOf(s.format);"));
  assert.ok(eng.includes("if (!star || !show) { await pause(s.id, \"no-character\"); continue; }"));
  assert.ok(eng.includes("topic = await nextEpisodeIdea({ seriesName: s.name, about: s.niche, show, star, recent, episode: s.dropsMade + 1 }, shop.contentLang);"));
  // THE CLAIM is the one every drop makes (a slot is claimed before anything is queued, so two ticks never make two)
  assert.ok(eng.indexOf("if (claim.count !== 1) continue;") < eng.indexOf("filmTemplate: show.template, filmMode: \"narrated\""));
  // the episode: a told story, the star cast from their own picture, their own voice telling it, the sign-off, which episode
  assert.ok(eng.includes("contentType: \"film\", filmTemplate: show.template, filmMode: \"narrated\", section,"));
  assert.ok(eng.includes("filmTopic: episodeTopic({ idea: topic, seriesName: s.name, star }), filmScenes: SHOW_SCENES, filmCaptions: \"bold\", filmAspect: \"9:16\","));
  assert.ok(eng.includes("cast: [{ name: star.name, faceUrl: star.faceUrl, voiceId: null, kind: star.kind, look: star.look }],"));
  assert.ok(eng.includes("...(star.voiceId ? { filmNarrator: star.voiceId } : {}),"));
  assert.ok(eng.includes("...(signoff ? { filmSignoff: signoff } : {}),"));
  assert.ok(eng.includes("filmShow: { id: s.id, name: s.name, episode: s.dropsMade + 1, star: star.name },"));
  assert.ok(eng.includes("seriesId: s.id, seriesName: s.name, seriesAutoPost: s.autoPost, seriesPlatforms: wantPlatforms,\n              initiator: \"character-series\","));
  // a vibe or product channel is exactly what it was
  assert.ok(eng.includes("contentType: \"faceless\", topic, facelessFormat: s.format, voiceKey: s.voiceKey,"));
});

test("the episode on its way out: the writer hears the sign-off, the piece keeps its episode, the post is a channel's post", () => {
  const q = read("app", "lib", "job-queue.server.ts");
  assert.ok(q.includes("signoff: typeof payload.filmSignoff === \"string\" ? payload.filmSignoff : undefined,"));
  assert.ok(q.includes("show: (await import(\"./character-series\")).showMeta(payload.filmShow),"), "checked again where it is used");
  // posted the way any channel's drop is — only when the show is on auto-post, and never fatally
  const hook = q.slice(q.indexOf("// A CHARACTER'S SHOW: an episode a channel made is posted"), q.indexOf("// A CHARACTER'S SHOW: an episode a channel made is posted") + 900);
  assert.ok(hook.includes("if (payload.seriesId && payload.seriesAutoPost) {"));
  assert.ok(hook.includes("await postCreatorDrop({ shopId, assetId: filmAssetId, seriesId: payload.seriesId as string,"));
  assert.ok(hook.includes("console.error(\"[series] an episode's auto-post failed (non-fatal):\", e);"));
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("...(opts.signoff ? { signoff: opts.signoff } : {}), series: opts.series });"));
  assert.ok(nar.includes("...(opts.show ? { show: opts.show } : {}),"), "meta.show: whose show, which episode");
  const engine = read("app", "lib", "film-engine.server.ts");
  assert.ok(engine.includes("THE SIGN-OFF: the last scene's CAPTION ends with exactly these words, after its own last sentence, changed in no way: \"${signoff}\""));
  assert.ok(engine.includes("const signoff = narrated ? String(opts.signoff || \"\").replace(/[\"“”]/g, \"'\")"), "a told story only; a quote in it cannot break the brief");
});

test("the page: a third kind of channel, open to the owner until it has a price", () => {
  const page = read("app", "routes", "web.channels.tsx");
  // who may: the owner's own account for now (an episode is a film, and films have no price yet)
  assert.ok(page.includes("const showsOpen = isAdminEmail(account.email);"));
  assert.ok(page.includes("const kind: \"show\" | \"vibe\" = showsOpen && url.searchParams.get(\"kind\") === \"show\" ? \"show\" : \"vibe\";"));
  assert.ok(page.includes("if (!isAdminEmail(account.email)) return json({ error: tr(lang, \"Character shows are not open yet.\") }, { status: 403 });"), "…and the server says so too");
  assert.ok(page.includes("{showsOpen && <Link to=\"/web/channels?kind=show\""));
  // the star is looked up in THIS shop's own cast: the page sends an id, never a picture
  assert.ok(page.includes("const pick = (await showRoster(shop.id)).find((r) => r.id === ((form.get(\"star\") as string) || \"\").trim());"));
  assert.ok(page.includes("const star = pick ? parseStar({ id: pick.id, name: pick.name, faceUrl: pick.img, kind: pick.kind, look: pick.look, voiceId: pick.voiceId }) : null;"));
  assert.ok(!/form\.get\("(?:faceUrl|characterJson)"\)/.test(page));
  // its limits: a show's own cadences, a few at once, somewhere to post when it posts by itself
  assert.ok(page.includes("if (!SHOW_CADENCES.includes(showCadence)) return json("));
  assert.ok(page.includes("const running = await db.creatorSeries.count({ where: { shopId: shop.id, sourceType: \"character\", status: \"ACTIVE\" } });"));
  assert.ok(page.includes("if (running >= CHARACTER_SERIES_MAX) return json("));
  // what is stored: the show's key as its format, the star, the sign-off — and it starts on the next tick
  assert.ok(page.includes("sourceType: \"character\",\n          format: show.key,\n          characterJson: JSON.stringify(star),\n          signoff: signoffOf(form.get(\"signoff\")) || null,"));
  assert.ok(page.includes("nextRunAt: new Date(Date.now() + 60_000),\n        },\n      });\n      return redirect(\"/web/channels?kind=show\");"));
  // each kind of channel is listed on its own tab
  assert.ok(page.includes("const series = rows.filter((s) => (s.sourceType === \"character\") === (kind === \"show\")).map((s) => {"));
  // the form: who stars → what kind → what about → the line → how often; and it STARTS in approve mode
  const form = page.slice(page.indexOf("function ShowForm("), page.indexOf("/* Voice picker with a ▶"));
  const order = ["{t(\"Who stars?\")}", "{t(\"What kind of show?\")}", "{t(\"What's it about?\")}", "{t(\"The line every episode ends on\")}", "{t(\"How often?\")}", "{t(\"Posting\")}"].map((k) => form.indexOf(k));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), `in the order a person would say it (${order.join(", ")})`);
  assert.ok(form.includes("const [autoPost, setAutoPost] = useState(false);"), "the first episodes are looked at before anything is posted");
  assert.ok(form.includes("<input type=\"hidden\" name=\"kind\" value=\"show\" />") && form.includes("<input type=\"hidden\" name=\"star\" value={star} />"));
  assert.ok(form.includes("{t(\"Free while films are free\")}"));
  // the card: the star's face, the kind of show, its sign-off; resuming a show never waits on tokens it does not cost
  assert.ok(page.includes("{s.star && <img className=\"ch-card-star\" src={s.star.img} alt={s.star.name} loading=\"lazy\" />}"));
  assert.ok(page.includes("<ChannelCard key={s.id} s={s} tokens={tokens} facelessCost={s.star ? 0 : facelessCost} />"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Character shows", "Who stars?", "What kind of show?", "Lessons", "Tales", "Night tales", "The line every episode ends on", "Start the show", "First episode on its way…", "Free while films are free", "Character shows are not open yet.", ...SHOWS.map((s) => s.line)]) {
    assert.ok(dict.split(`${JSON.stringify(k)}:`).length - 1 >= 5, k);
  }
});
