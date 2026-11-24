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
  episodeIdeaPrompt, episodeOwnName, episodeTopic, episodesByShow, parseStar, showMeta, showMetaNeedle, showOf, showTeller, signoffOf, tellerVisual, tidyIdea,
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
  assert.ok(p.includes("It must NOT repeat or closely resemble any of these earlier episodes — not their situation, not their setting, not who the star meets:\n- Howl finds a lantern nobody lit\n- Howl hears his name from the well\n"));
  // an angle, when one was dealt, is said before the list — and none is said when none was
  assert.ok(!p.includes("This episode's angle"));
  const angled = episodeIdeaPrompt({ seriesName: "S", about: "", show: showOf("nights")!, star: HOWL, recent: [], episode: 2, angle: "the kind of horror: a reflection that is a moment behind — or a moment ahead" });
  assert.ok(angled.includes("This episode's angle, dealt for it alone — follow it unless what the show is about rules it out: the kind of horror: a reflection that is a moment behind — or a moment ahead.\n"));
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

test("what the story's writer is told: the premise, and NOT the show's name — inside the 300 characters it reads", () => {
  // (the first live episode, 2026-11-24: told 'An episode of "TEST Howl: Night tales"', the writer TITLED the
  //  story with the show's name — the shelf then prefixed it again and the poster ran the two together)
  const t = episodeTopic({ idea: "Howl follows wet footprints to a door that was never there", seriesName: "Howl: Night tales", star: HOWL });
  assert.equal(t, "Howl follows wet footprints to a door that was never there");
  assert.ok(!t.includes("Night tales"));
  const long = episodeTopic({ idea: "i".repeat(400), seriesName: "S".repeat(90), star: HOWL });
  assert.equal(long.length, 298);
  // (the writer cuts the topic at 300: film-engine)
  assert.ok(read("app", "lib", "film-engine.server.ts").includes("\"${topic.slice(0, 300)}\""));
  // the sign-off: one clean line; and what a finished episode keeps about its show
  assert.equal(signoffOf('  "Stay quiet.\n Stay sharp."  '), "Stay quiet. Stay sharp.");
  assert.equal(signoffOf(null), "");
  assert.ok(signoffOf("x".repeat(400)).length <= 120);
  assert.deepEqual(showMeta({ id: "s1", name: "Howl: Night tales", episode: 4.7, star: "Howl" }), { id: "s1", name: "Howl: Night tales", episode: 4, star: "Howl" });
  // …and, once it is written, the episode's own name in full (read back from JSON too)
  assert.deepEqual(showMeta(JSON.stringify({ id: "s1", name: "N", episode: 2, star: "Howl", title: "  The Door That Was\n Never There " })), { id: "s1", name: "N", episode: 2, star: "Howl", title: "The Door That Was Never There" });
  assert.equal(showMeta("{")?.id, undefined);
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
  // (…dealt an angle of its own, so episode 7 is not episode 3 in another coat: tests/story-variety.test.ts)
  assert.ok(eng.includes("const angle = freshAngle(show.template, { ...dealFresh(show.template), ending: undefined });"));
  assert.ok(eng.includes("topic = await nextEpisodeIdea({ seriesName: s.name, about: s.niche, show, star, recent, episode: s.dropsMade + 1, angle }, shop.contentLang);"));
  // THE CLAIM is the one every drop makes (a slot is claimed before anything is queued, so two ticks never make two)
  assert.ok(eng.indexOf("if (claim.count !== 1) continue;") < eng.indexOf("filmTemplate: show.template, filmMode: \"narrated\""));
  // the episode: a told story, the star cast from their own picture, their own voice telling it, the sign-off, which episode
  assert.ok(eng.includes("contentType: \"film\", filmTemplate: show.template, filmMode: \"narrated\", section,"));
  assert.ok(eng.includes("filmTopic: episodeTopic({ idea: topic, seriesName: s.name, star }), filmScenes: SHOW_SCENES, filmCaptions: \"bold\", filmAspect: \"9:16\","));
  assert.ok(eng.includes("cast: [{ name: star.name, faceUrl: star.faceUrl, voiceId: null, kind: star.kind, look: star.look }],"));
  assert.ok(eng.includes("...(star.voiceId ? { filmNarrator: star.voiceId, filmTeller: showTeller(star) } : {}),"), "told in the star's voice → told BY the star");
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
  assert.ok(nar.includes("...(opts.signoff ? { signoff: opts.signoff } : {}), ...(opts.teller ? { teller: opts.teller } : {}), series: opts.series });"));
  assert.ok(nar.includes("...(opts.show ? { show: { ...opts.show, ...(showEpisodeName ? { title: showEpisodeName } : {}) } } : {}),"), "meta.show: whose show, which episode, and the episode's own name");
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

/* ---- THE SECOND PASS (2026-11-24, after the first episode was made and looked at on the live site) ---- */

test("the star tells it: a show told in its star's own voice is told BY them — as \"I\" — and still drawn from their name", () => {
  // who tells: the star when they have a voice; nobody in particular when they have none
  assert.equal(showTeller(HOWL), "Howl");
  assert.equal(showTeller({ ...HOWL, voiceId: null }), "");
  assert.equal(showTeller(null), "");
  // a picture is drawn from its words, and "I" is nobody: first-person words in a VISUAL become the name
  assert.equal(tellerVisual("I stand at the tree line, my claws on the bark, watching the cabin", "Howl"), "Howl stand at the tree line, Howl's claws on the bark, watching the cabin");
  assert.equal(tellerVisual("Marion looks back at me from the doorway. I'm in the rain.", "Howl"), "Marion looks back at Howl from the doorway. Howl is in the rain.");
  assert.equal(tellerVisual("I’ve stopped; My shadow falls over the well, and I'd know it anywhere — I'll wait", "Howl"), "Howl has stopped; Howl's shadow falls over the well, and Howl would know it anywhere — Howl will wait");
  assert.equal(tellerVisual("Howl crouches by myself at the old mine", "Howl"), "Howl crouches by Howl at the old mine", "a mine is a place");
  // …and a VISUAL that already names them is not touched; nor anything when there is no teller
  const plain = "Howl stands in the doorway of the ranger cabin, Marion behind him";
  assert.equal(tellerVisual(plain, "Howl"), plain);
  assert.equal(tellerVisual("I stand alone", ""), "I stand alone");
  assert.equal(tellerVisual("", "Howl"), "");
  // names that only CONTAIN the letters are left alone ("Imogen", "merchant", "Amy")
  assert.equal(tellerVisual("Imogen and Amy meet the merchant at home", "Howl"), "Imogen and Amy meet the merchant at home");

  // the writer is told — a told story only, and only for somebody who is in the cast
  const engine = read("app", "lib", "film-engine.server.ts");
  assert.ok(engine.includes("const tellerWanted = narrated ? String(opts.teller || \"\").replace(/\\s+/g, \" \").trim().toLowerCase() : \"\";"));
  assert.ok(engine.includes("const teller = tellerWanted ? picked.find((c) => c.name.toLowerCase() === tellerWanted)?.name || \"\" : \"\";"), "never a name the cast does not have");
  assert.ok(engine.includes("(teller ? `THE TELLER: ${teller} tells this story THEMSELVES"));
  assert.ok(engine.includes("Every CAPTION is ${teller} speaking in the first person (\"I\", \"me\", \"my\")"));
  assert.ok(engine.includes("The captions never say \"${teller}\" and never call ${teller} \"he\", \"she\", \"it\" or \"they\"."));
  assert.ok(engine.includes("every VISUAL still calls ${teller} by NAME and never says \"I\", \"me\" or \"my\""));
  // …the TELLER line comes before the sign-off (the sign-off is the teller's own last words)
  assert.ok(engine.indexOf("THE TELLER: ${teller}") < engine.indexOf("THE SIGN-OFF: the last scene's CAPTION"));
  // …and whatever it wrote, a VISUAL gets the name back
  assert.ok(engine.includes("if (teller) list = list.map((s) => ({ ...s, visual: tellerVisual(s.visual, teller) }));"));
  assert.ok(engine.indexOf("visual: tellerVisual(s.visual, teller)") < engine.indexOf("visual: placeNamed(s.visual, saidPlaces[i], places)"), "before a place is put in front of the words");
  // carried from the show to the writer
  assert.ok(read("app", "lib", "job-queue.server.ts").includes("teller: typeof payload.filmTeller === \"string\" ? payload.filmTeller : undefined,"));
});

test("an episode is titled by its show: \"<Show> — Episode <N>: <its own name>\", the same way every time", () => {
  const nar = read("app", "lib", "narrated-story.server.ts");
  // the episode's own name is kept IN FULL before the show's name goes on (the shelf's title is cut to fit)
  assert.ok(nar.includes("const showEpisodeName = opts.show ? episodeOwnName(treatment.title, opts.show.name) : \"\";"));
  assert.ok(nar.indexOf("const showEpisodeName = ") < nar.indexOf("else if (opts.show) treatment.title = episodeTitle(opts.show.name, opts.show.episode, treatment.title);"));
  assert.ok(nar.includes("if (opts.series) treatment.title = episodeTitle(opts.series.title, opts.series.episode, treatment.title);"), "a film series is exactly what it was");
  // …and its poster bills it in full
  assert.ok(nar.includes("const billedAs = opts.show ? `${opts.show.name} — Episode ${opts.show.episode}${showEpisodeName ? `: ${showEpisodeName}` : \"\"}` : treatment.title || opts.topic || \"\";"));
  // an episode's own name, from whatever its writer called it
  assert.equal(episodeOwnName("What Follows the Trail", "Howl: Night tales"), "What Follows the Trail");
  assert.equal(episodeOwnName("Howl: Night Tales — What Follows the Trail", "Howl: Night tales"), "What Follows the Trail", "the show's name is taken off its front");
  assert.equal(episodeOwnName("Howl: Night tales — Episode 3: The Door That Was Never There", "Howl: Night tales"), "The Door That Was Never There", "idempotent: an episode title given back");
  assert.equal(episodeOwnName("Howl: Night tales — Episode 3", "Howl: Night tales"), "", "an episode with no name of its own");
  assert.equal(episodeOwnName("Horror Story — Howl: Night Tales — What Follows the Trail", "TEST Howl: Night tales"), "What Follows the Trail", "a shelf title: what follows its last long dash");
  assert.equal(episodeOwnName('"The Lantern"', "S"), "The Lantern");
  assert.equal(episodeOwnName(null, "S"), "");
});

test("a show's episodes are found by its own key in a piece's meta, and listed newest first", () => {
  assert.equal(showMetaNeedle("cmw123"), '"show":{"id":"cmw123"');
  // (it is exactly how narrated-story.server.ts writes it: `show` first holds `id`)
  assert.ok(JSON.stringify({ kind: "narrated", show: { ...showMeta({ id: "cmw123", name: "N", episode: 1, star: "Howl" })!, title: "T" } }).includes(showMetaNeedle("cmw123")));
  const meta = (id: string, episode: number, extra: Record<string, unknown> = {}) => JSON.stringify({ kind: "narrated", show: { id, name: "Howl: Night tales", episode, star: "Howl", ...extra }, poster: `/renders/nar-${episode}-poster.jpg` });
  const rows = [
    { id: "a1", title: "Horror Story — Howl: Night tales — Episode 1: The Trail", metaJson: meta("s1", 1) },
    { id: "a3", title: "Horror Story — Howl: Night tales — Episode 3", metaJson: meta("s1", 3, { title: "The Door That Was Never There" }) },
    { id: "a2", title: "Horror Story — Howl: Night tales — Episode 2: The Well", metaJson: meta("s1", 2) },
    { id: "b1", title: "Moral Story — Pip: Lessons — Episode 1: The Loan", metaJson: meta("s2", 1) },
    { id: "x", title: "somebody else's", metaJson: meta("other", 9) },
    { id: "y", title: "not an episode", metaJson: JSON.stringify({ kind: "narrated" }) },
    { id: "z", title: "broken", metaJson: "{" },
    { id: "p", title: "Horror Story — Howl: Night tales — Episode 4: Bad Poster", metaJson: JSON.stringify({ show: { id: "s1", name: "N", episode: 4, star: "Howl" }, poster: "https://evil.example/p.jpg" }) },
  ];
  const by = episodesByShow(rows, ["s1", "s2"], 3);
  assert.deepEqual(by.s1.map((e) => [e.assetId, e.episode, e.title, e.poster]), [
    ["p", 4, "Bad Poster", null],
    ["a3", 3, "The Door That Was Never There", "/renders/nar-3-poster.jpg"],
    ["a2", 2, "The Well", "/renders/nar-2-poster.jpg"],
  ], "newest first, three at most, the name in full when the piece kept it, only OUR poster pictures");
  assert.deepEqual(by.s2.map((e) => e.assetId), ["b1"]);
  assert.equal(by.other, undefined);
  assert.deepEqual(episodesByShow([], ["s1"]), {});

  const page = read("app", "routes", "web.channels.tsx");
  assert.ok(page.includes("OR: showIds.map((id) => ({ metaJson: { contains: showMetaNeedle(id) } }))"), "one read, this shop's pieces only");
  assert.ok(page.includes("where: { shopId: shop.id, type: \"VIDEO_AD\", OR: showIds.map("));
  assert.ok(page.includes("episodes = episodesByShow(pieces, showIds, 4);"));
  assert.ok(page.includes("episodes: (episodes[s.id] || []).map((e) => ({ id: e.assetId, n: e.episode, title: e.title, poster: e.poster })),"));
});

test("the show's card: an ON AIR sign that is lit while it runs, and its episodes as their posters", () => {
  const page = read("app", "routes", "web.channels.tsx");
  assert.ok(page.includes("{s.star ? <span className={`ch-onair${s.status === \"ACTIVE\" ? \" live\" : \"\"}`} role=\"status\">{s.status === \"ACTIVE\" ? t(\"On air\") : t(\"Off air\")}</span> :"));
  // (a channel that is not a show keeps the badge it had)
  assert.ok(page.includes("<span className={`ch-badge ${s.status === \"ACTIVE\" ? \"live\" : \"off\"}`}>"));
  assert.ok(page.includes("{s.star && s.episodes.length > 0 && ("));
  assert.ok(page.includes("to={`/web/archive?section=creator&tab=video&open=${encodeURIComponent(e.id)}`} className=\"ch-ep\""), "an episode opens in the Archive");
  assert.ok(page.includes("<b>{t(\"Ep {n}\", { n: e.n })}</b>"));
  // a show speaks of episodes, not drops
  assert.ok(page.includes("{s.star ? t(\"episodes/week\") : t(\"videos/week\")}") && page.includes("{s.star ? t(\"Next episode\") : t(\"Next drop\")}") && page.includes("{s.star ? t(\"All episodes\") : t(\"All drops\")} →"));
  // the sign is lit and breathes only while running — and holds still for anyone who asked for less motion
  const css = page.slice(page.indexOf("const CH_CSS = `"));
  assert.ok(css.includes(".ch-onair.live{color:#FF7466;") && css.includes("animation:chOnAir 2.6s ease-in-out infinite;"));
  assert.ok(css.includes("@media(prefers-reduced-motion:reduce){.ch-onair.live{animation:none;}}"));
  assert.ok(css.includes("@media(prefers-reduced-motion:reduce){.ch-ep{transition:none;}.ch-ep:hover{transform:none;}}"));
  // arriving from a character's own page, the form is open with them picked — and brought into view in the row
  assert.ok(page.includes("const [showForm, setShowForm] = useState(series.length === 0 || (isShow && !!starId && roster.some((r) => r.id === starId)));"));
  assert.ok(page.includes("if (row && el) row.scrollLeft = Math.max(0, el.offsetLeft - row.offsetLeft - (row.clientWidth - el.offsetWidth) / 2);"), "the row is scrolled, never the page");
});

test("a character's own page lists their shows and offers another — for whoever shows are open to", () => {
  const page = read("app", "routes", "web.presenters.tsx");
  assert.ok(page.includes("const showsOpen = isAdminEmail(account.email);"), "the same gate as the Channels tab");
  assert.ok(page.includes("where: { shopId: shop.id, sourceType: \"character\", status: { not: \"ENDED\" } },"), "this shop's own, and none that ended");
  assert.ok(page.includes("if (showsOpen) {\n    try {\n      const rows = await db.creatorSeries.findMany({"), "nothing is read for anyone else");
  assert.ok(page.includes("(showsBy[star.id] ||= []).push({ id: r.id, name: r.name, kind: showOf(r.format)?.name || \"\", running: r.status === \"ACTIVE\", made: r.dropsMade });"));
  assert.ok(page.includes("shows={(d.showsBy as Record<string, ShowRow[]>)[open.id] || []}"));
  const view = page.slice(page.indexOf("function CharacterView("), page.indexOf("const PH_STYLE = `"));
  assert.ok(view.includes("{showsOpen && (\n            <section className=\"pc-sec\">\n              <h3 className=\"pc-h\"><Ico n=\"filmreel\" size={13} /> {t(\"Shows\")}</h3>"));
  assert.ok(view.includes("<Link to={`/web/channels?kind=show&star=${encodeURIComponent(c.id)}`} className=\"pc-show-new\">"), "the way in carries WHO");
  assert.ok(view.includes("{shows.length ? t(\"Give {name} another show\", { name: c.name }) : t(\"Give {name} a show\", { name: c.name })}"), "a character can have several");
  // after the voice, before the delete
  assert.ok(view.indexOf("{t(\"Voice\")}</h3>") < view.indexOf("{t(\"Shows\")}</h3>") && view.indexOf("{t(\"Shows\")}</h3>") < view.indexOf("{danger(\"in\")}"));
  // the Archive says which show an episode belongs to, and leads back
  const arch = read("app", "routes", "web.archive.tsx");
  assert.ok(arch.includes("const s = showMeta(JSON.parse(a.metaJson || \"{}\").show); return s ? { name: s.name, episode: s.episode } : null;"), "its name and number — never the show's id");
  assert.ok(arch.includes("{t(\"Episode {n} of {show}\", { n: viewer.show.episode, show: viewer.show.name })}"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["On air", "Off air", "Ep {n}", "All episodes", "Shows", "Give {name} a show", "Give {name} another show", "Episode {n} of {show}", "End this show"]) {
    assert.ok(dict.split(`${JSON.stringify(k)}:`).length - 1 >= 5, k);
  }
});
