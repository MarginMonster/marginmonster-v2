/* WHAT THE MEMBER WROTE IS THE STORY (premise-rules.ts) — a tester's day of making one of everything, 2026-11-24:
 * "Horror story still need betterment they not pick what we ask to create exactly"; "Horror Film need more work bro
 * they not exact follow command what we tell". His two children came back as two adults, his boy as a grown man
 * with a werewolf beside him in a lit bedroom, and his Short Story's idea reached the writer cut off mid-word. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CHILDREN_STAY, HORROR_SAFETY, IDEA_CHECK, IDEA_MAX, PREMISE_WINS, STORY_SAFETY, chosenThreat } from "../app/lib/premise-rules.ts";
import { STORY_SHOTS } from "../app/lib/story-shots.ts";

const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), "utf8");

test("children stay children — and a child in a frightening story is never hurt", () => {
  // the rule that turned them into grown-ups is gone from every safety line
  for (const line of [HORROR_SAFETY, STORY_SAFETY]) {
    assert.ok(line.includes(CHILDREN_STAY), "both say it the same way");
    assert.ok(!/recast|CAST ONLY ADULTS|is an ADULT/i.test(line), line.slice(0, 80));
  }
  assert.ok(CHILDREN_STAY.includes("never a teenager, never a grown-up"));
  // …what may happen to a child is limited instead
  assert.ok(CHILDREN_STAY.includes("NEVER HURT") && CHILDREN_STAY.includes("Nothing grabs, touches, wounds, takes or kills a child"));
  assert.ok(CHILDREN_STAY.includes("the threat is never close to one: it is outside a window or a door, at the far end of a hall, deep in the dark, or only heard"));
  assert.ok(CHILDREN_STAY.includes("no blood, no violence and nothing graphic"));
  // a story with no child in it still has grown-ups, and a grown-up horror may still be bloody
  assert.ok(CHILDREN_STAY.endsWith("When the idea has no child in it, its people are grown-ups."));
  assert.ok(HORROR_SAFETY.includes("When everybody in it is a grown-up, violence, death, blood and disturbing imagery are fine"));
  assert.ok(HORROR_SAFETY.includes("no gratuitous, lingering torture or graphic mutilation"));
});

test("the idea is the story: its people, its place, its events in order, and its threat as it says", () => {
  for (const said of ["two children stay two children, a boy stays a boy", "a house stays a house, a bedroom stays a bedroom", "The SAME EVENTS, in the SAME ORDER", "\"a dark shadow\" stays a shadow, \"a ghost lady\" stays a ghost woman", "never turned into a werewolf, a demon, a monster or anything it did not name", "THE IDEA WINS (the safety limits at the very end still hold)"]) {
    assert.ok(PREMISE_WINS.includes(said), said);
  }
  // THE FIRST LIVE PREVIEWS with these rules (2026-11-24): the two children stayed children — but "they locked
  // the door" came back "locked the door in her mind", the mother "away from home" was turned into the woman on
  // the porch by a twist, and the film's boy never ran to his parents' room
  assert.ok(PREMISE_WINS.includes("when the idea MOVES them (\"he ran to his parents' room\"), the story moves there too"));
  assert.ok(PREMISE_WINS.includes("for real, never as a figure of speech (\"they locked the door\" is a door being locked)"));
  assert.ok(PREMISE_WINS.includes("a twist may come only AFTER its last event, and never undoes or contradicts anything it said (\"their mom is away from home\" stays away)"));
  // an idea is a paragraph, not a line (a tester's came to the writer ending "…the roots of a big tr")
  assert.equal(IDEA_MAX, 1200);
});

test("a creature the maker chose plays the idea's threat — in an acted film it is the THING, not one of the two", () => {
  assert.equal(chosenThreat([], true), "");
  const acted = chosenThreat(["Howl"], true);
  assert.ok(acted.includes("Howl IS that threat, and NOT one of the two who talk"));
  assert.ok(acted.includes("Howl has no \"cast\" entry") && acted.includes("SEEN only in the last shot"));
  assert.ok(acted.includes("Only when the idea itself has Howl talking with somebody face to face it is one of the two."));
  const told = chosenThreat(["Howl"], false);
  assert.ok(told.includes("Howl IS that threat and it is seen only the way the idea sees it"));
  assert.ok(!told.includes("cast\" entry"), "a told story keeps every chosen character in its cast");
  assert.ok(chosenThreat(["Howl", "Mara"], true).includes("THE CHOSEN CREATURES (Howl and Mara)"));
});

test("the writer is given all of it — the idea's rules right after the idea, and the idea whole", () => {
  const eng = read("app", "lib", "film-engine.server.ts");
  assert.ok(eng.includes("import { HORROR_SAFETY, IDEA_CHECK, IDEA_MAX, PREMISE_WINS, REAL_WORLD, STORY_SAFETY, chosenThreat } from \"./premise-rules\";"));
  assert.ok(eng.includes("\"${topic.slice(0, IDEA_MAX)}\". Tell EXACTLY this") && eng.includes("${storyFormat ? `${PREMISE_WINS}\\n` : \"\"}"), "said right after the idea, in every story format");
  assert.ok(eng.includes("    ? HORROR_SAFETY\n    : STORY_SAFETY;") || eng.includes("    ? HORROR_SAFETY\r\n    : STORY_SAFETY;"));
  assert.ok(!eng.includes("CAST ONLY ADULTS") && !eng.includes("recast any such role as an adult"));
  // a chosen creature in a horror idea: by its look; an acted film's two are then the idea's own people
  assert.ok(eng.includes("const threatNames = tmpl.key === \"horror\" ? picked.filter((c) => c.kind === \"monster\" || (!c.kind && keepGuess(c.desc).kind === \"monster\")).map((c) => c.name) : [];"));
  // WHAT IT IS RIDES ALONG from the page (the third live preview: the werewolf's film look, "a huge, lean werewolf
  // that…", was guessed a person — cut at its comma — and kept in the cast)
  assert.ok(eng.includes("kind: c?.kind === \"monster\" || c?.kind === \"cartoon\" ? c.kind : undefined"));
  const film = read("app", "routes", "web.film.tsx");
  assert.equal(film.split("cast: storyCast.map((c) => ({ name: c.name, desc: c.look, kind: c.kind }))").length - 1, 2, "the free write and the one-press story");
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("cast: (opts.cast || []).map((c) => ({ name: c.name, desc: c.look, kind: c.kind }))"));
  // A TOLD story keeps the creature in its cast (seen only the way the idea sees it)…
  assert.ok(eng.includes("${noSlop}${actedThreat ? \"\" : chosenThreat(threatNames, acted)}`"));
  // …an ACTED film is given only the chosen PEOPLE as its cast (none: it invents the two, as any acted film does),
  // and the creature after it as THE THREAT — told both at once, the second live preview kept the werewolf in "cast"
  assert.ok(eng.includes("const castChosen = actedThreat ? picked.filter((c) => !threatNames.includes(c.name)) : picked;"));
  assert.ok(eng.includes("const pickedLine = castChosen.length") && eng.includes("    castLine +\n    threatBrief +\n") || eng.includes("    castLine +\r\n    threatBrief +\r\n"));
  assert.ok(eng.includes("? `\\nTHE THREAT — chosen by the maker: ${picked.filter((c) => threatNames.includes(c.name))"));
  // …and whatever "cast" comes back is held to it: the threat is taken out, so it never stands in every shot
  assert.ok(eng.includes("const kept = cast.filter((e) => !threatNames.some((n) => named(e) === n.trim().toLowerCase()));") && eng.includes("cast.splice(0, cast.length, ...kept);"));
  // THE IDEA IS CHECKED LAST OF ALL (the second live preview still ended on the away-mother "never left")
  assert.ok(IDEA_CHECK.startsWith("LAST, BEFORE YOU ANSWER: read your story against the idea once more") && IDEA_CHECK.includes("nothing it said made untrue by your ending"));
  assert.ok(eng.includes("(storyFormat && topic ? `\\n${IDEA_CHECK}` : \"\");"));
  assert.ok(eng.includes("a twist that leaves every fact of the idea TRUE"));
  // an acted film goes where the idea goes
  assert.ok(eng.includes("but when the IDEA moves them (\"he ran to his parents' room\"), that IS such a move: the shots that come after it are in the new place"));
  // the Movie Maker sends the whole idea
  const page = read("app", "routes", "web.film.tsx");
  assert.ok(page.includes("const topic = ((form.get(\"filmTopic\") as string) || \"\").trim().slice(0, IDEA_MAX);"));
  assert.equal(page.split("maxLength={IDEA_MAX}").length - 1, 2, "both idea boxes");
});

test("a told story's detail shot shows ONE person's hands — two people's hands on one thing melt together", () => {
  const detail = STORY_SHOTS.detail;
  assert.ok(detail.write.includes("ONE person's hand (or their two hands)") && detail.write.includes("Never two people's hands together on one thing"));
  assert.ok(detail.camera.includes("at most one person's hands"));
});

/* ROUND FIVE — the first finished Horror Story made from the tester's idea on the new rules (2026-11-24): the idea
 * kept, the pictures sharp — but its opening shot ("the house sits alone at dusk") had a man walking up to the house,
 * the little brother was drawn OUTSIDE on the porch while his sister locked the door, and in the last picture he sat
 * on the sofa AND stood on the porch. And the acted film's last shot never showed the werewolf the maker chose. */
test("a story picture has nobody the words do not put there, and everybody in it ONCE", async () => {
  const sp = await import("../app/lib/story-picture.ts");
  assert.ok(sp.NO_EXTRAS.includes("no passer-by, no figure in the distance, no one at a window or a door") && sp.NO_EXTRAS.includes("appears exactly ONCE"));
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("${ONE_PICTURE} ${NO_EXTRAS}${here.length ? ` ${NO_LENS}` : \"\"}${insideNote(visual) ? ` ${INSIDE_STAYS} ${DOORS_SHUT} ${TRUE_SIZE}` : \"\"}${tmpl.childSafe ? ` ${DRESSED}` : ` ${TODAY_LOOK}`}${!tmpl.childSafe && shadowNote(visual) ? ` ${SHADOW_SHAPE}` : \"\"} ${STORY_SOUND} ${NOTHING_WRITTEN}`;"));
  // (…and nobody in a story picture looks into the camera: the parents "turning toward him in alarm" faced the lens)
  const spx = await import("../app/lib/story-picture.ts");
  assert.ok(spx.NO_LENS.startsWith("Nobody looks into the camera: each one looks at whoever or whatever this moment has them looking at"));
  // the look asks who is drawn twice — and an answer that does not say means nobody
  assert.ok(sp.storyCastPrompt(2).includes("look across the WHOLE first image for a second copy of them"));
  assert.deepEqual(sp.parseStoryTwice('{"seen":[true,true],"twice":[false,true]}', 2), [false, true]);
  assert.equal(sp.parseStoryTwice('{"seen":[true,true]}', 2), null);
  assert.equal(sp.parseStoryTwice('{"twice":[true]}', 2), null, "one answer for two is no answer");
  // a character drawn twice is a fault like a missing one — and is told so on the next go
  assert.equal(sp.storyFaults({ seen: [true, true], panels: false, twice: [false, true] }), 3);
  assert.equal(sp.storyFaults({ seen: [true, false], panels: false, twice: [false, true] }), 3, "missing is not ALSO twice");
  assert.equal(sp.storyFaults({ seen: [true, true], panels: false }), 0, "an older reading: nothing more");
  assert.ok(sp.storyFix({ seen: [true, true], panels: false, twice: [false, true] }, ["Nessa", "Dovey"]).includes("Dovey was drawn TWICE in the last try — they appear exactly ONCE in this picture, nowhere else in it"));
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("const twice = castPics.length ? parseStoryTwice(String(castRaw || \"\"), castPics.length) : null;") && nar.includes("panels: panels === true, ...(twice ? { twice } : {}), ...(extra ? { extra: true } : {}), ...(outside ? { outside: true } : {}), ...(lens?.length ? { lens } : {}), ...(grimy ? { grimy: true } : {}), ...(inset ? { inset: true } : {}) };"));
});

test("a told story's picture says which side of a door or a window everybody is on", () => {
  assert.ok(read("app", "lib", "film-engine.server.ts").includes("When a door or a window is in the picture, say which SIDE of it each person is on"));
});

test("an acted film's chosen threat is SEEN at the end, whatever the writer's last shot said", () => {
  const eng = read("app", "lib", "film-engine.server.ts");
  assert.ok(eng.includes("if (!threatNames.some((n) => said.toLowerCase().includes(n.trim().toLowerCase()))) {"));
  assert.ok(eng.includes("visual: `${said.replace(/[\\s.;,]+$/, \"\")}; in the dark behind them, ${threatNames[0]} is there — a tall shape, only its face in the light`"));
  // …after the cast is held to the two, and before the film draws it from its own picture (film-dialogue → thing)
  assert.ok(eng.indexOf("cast.splice(0, cast.length, ...kept);") < eng.indexOf("in the dark behind them, ${threatNames[0]} is there"));
});

/* ROUND SIX — the owner, of the two horror pieces made from the tester's ideas (2026-11-24): "there isn't much
 * realism. First one looks like the kids live in a cobblestone house from a fairytale, the monster is outside trying
 * to get in, but in one of the scenes the kid is outside with the monster" and "there is an orb glowing that pulses
 * with the knocks in the window, both the parent and child are talking about something outside yet looking towards
 * the camera - then it cuts to a scene with a monster half way hanging out of the wall. Like what the fuck is that plot?" */
test("today's real world: a house is an ordinary modern home, never a fairytale cottage — said to every grown-up story", async () => {
  const pr = await import("../app/lib/premise-rules.ts");
  assert.ok(pr.REAL_WORLD.includes("a house is an ordinary modern home of the kind real families in the story's own country live in today"));
  assert.ok(pr.REAL_WORLD.includes("no lone stone cottage, no round porthole window, no hobbit door"));
  const eng = read("app", "lib", "film-engine.server.ts");
  // (2026-11-25, the genres became movie categories: a FANTASY keeps its own world too — said to one, "no castle,
  //  no lone stone cottage, no cabin" forbids the genre. film-genres.ts → ownWorld; every other grown-up story is
  //  told it exactly as before.)
  assert.ok(eng.includes("(storyFormat && !tmpl.childSafe && !tmpl.ownWorld ? `${REAL_WORLD}\\n` : \"\") +"), "a children's cartoon keeps its own world, and so does a fantasy");
  const genres = await import("../app/lib/film-genres.ts");
  assert.deepEqual(genres.GENRE_FILMS.filter((g) => g.ownWorld).map((g) => g.key), ["fantasy"], "and no other genre");
  // …and in an acted film, the idea's move happens BEFORE the last shot (its reveal is drawn into that place)
  assert.ok(eng.includes("the move happens BEFORE the last shot, never in it: the last shot is in the same place as the shot before it"));
});

test("a told story's picture keeps inside INSIDE, and never draws a sound", async () => {
  const sp = await import("../app/lib/story-picture.ts");
  assert.ok(sp.INSIDE_STAYS.includes("Whoever these words put INSIDE — and whoever looks OUT or peers out through a window or a door — stays inside") && sp.INSIDE_STAYS.includes("never standing beside them"));
  assert.equal(sp.insideNote("from behind Mira's shoulder, inside at the round window, looking out at the ghost lady on the porch"), sp.INSIDE_STAYS);
  assert.equal(sp.insideNote("Mira and Tomi sit pressed together on the sofa"), "");
  assert.ok(sp.STORY_SOUND.includes("nothing glows, rings or lights up where a knock, a bell or a voice comes from"));
});

test("an acted film: a sound is never drawn, and what they talk about, they look at", async () => {
  const st = await import("../app/lib/acted-staging.ts");
  assert.ok(st.SOUND_NOT_DRAWN.includes("nothing glows, rings, ripples, flashes, cracks or lights up where it comes from"));
  assert.equal(st.lookTarget("Three slow knocks thud against the glass of the bedroom window"), "the window");
  assert.equal(st.lookTarget("He pulls the curtains back"), "the curtain");
  assert.equal(st.lookTarget("She grips the doorway"), "the doorway");
  assert.equal(st.lookTarget("They sit on the sofa"), "");
  assert.ok(st.lookAtPicture("the window").includes("the window this moment is about is at one SIDE of the frame, near the camera — beside them, never behind them"));
  assert.equal(st.lookAtPicture(""), "");
  // the master picture says both — the knocked window came back with a glowing ring, and the two faced the lens
  const pic = st.stagedTwoShot({ staging: "apart", setting: "a boy's bedroom at night", personA: "Omar, a 9-year-old boy", personB: "Ana, his mother", act: "Three slow knocks thud against the window glass as Omar grips his blanket", consistency: "", comp: "wide composition" });
  assert.ok(pic.includes(st.SOUND_NOT_DRAWN) && pic.includes(st.lookAtPicture("the window")), pic);
  // …and the clip
  const rules = st.stagedRules({ look: "Keep EVERYONE and the setting EXACTLY as in the starting image.", lookTight: "Keep EVERYONE.", lookShort: "Keep.", style: "", steady: "", noText: "" }, { staging: "apart", event: "Omar points at the window as Ana turns." });
  assert.ok(rules.look.includes("They look at the window when they speak of it, not at the camera."));
});

/* THE STRANGER AT THE SCREEN (2026-11-24): the realism pass's own Horror Story ended on "the ghost woman's face
 * pressed near the window glass from outside … while inside the dark room only the television flickers" — and the
 * picture model sat a grown man at a screen in that room. NO_EXTRAS had asked; nothing LOOKED. */
test("every story picture is looked at for anybody its words do not put there — and drawn again without them", async () => {
  const sp = await import("../app/lib/story-picture.ts");
  const q = sp.storyExtrasPrompt('only the "television" flickers in the dark room');
  assert.ok(q.includes("It was asked to show exactly this: \"only the 'television' flickers in the dark room\"") && q.includes("\"uninvited\": true or false"));
  assert.equal(sp.parseStoryExtras('{"people":["a man at a desk"],"uninvited":true}'), true);
  assert.equal(sp.parseStoryExtras('{"people":[],"uninvited":false}'), false);
  assert.equal(sp.parseStoryExtras("no idea"), null, "an answer that cannot be read keeps the picture");
  assert.equal(sp.storyFaults({ seen: [true], panels: false, extra: true }), 3);
  assert.ok(sp.storyFix({ seen: [true], panels: false, extra: true }, ["Priya"]).includes("draw NOBODY but who they name"));
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("const extra = parseStoryExtras(String(extrasRaw || \"\"));") && nar.includes("if (seen == null && panels == null && extra == null && outside == null && lens == null && grimy == null && inset == null) return null;"));
});

/* WHOEVER LOOKS OUT, DRAWN OUT THERE (2026-11-24): the kids' horror story made again with INSIDE_STAYS in every
 * picture's prompt still stood Leni out on the porch with the ghost lady — its words were "At the front door: Leni,
 * near the camera at the window's edge, peers out while far down the dark porch the ghost lady stands". The same
 * story built the house of rough grey stone again, and gave the girl bloodied "scraped knees". */
test("whoever looks out is looked for OUTSIDE — and drawn again inside; today's houses; no hurt child even in a look", async () => {
  const sp = await import("../app/lib/story-picture.ts");
  // the question: who is who by their looks, about THE LOOKER only, "outdoors" = standing out there
  const q = sp.storyExtrasPrompt("At the front door: Leni peers out while far down the dark porch the ghost lady stands.", ["Leni: a 9-year-old girl with twin braids", "the ghost lady: a tall pale woman in a grey dress"]);
  assert.ok(q.includes("It was asked to show exactly this: \"At the front door: Leni peers out while far down the dark porch the ghost lady stands\". Who is who: Leni: a 9-year-old girl with twin braids; the ghost lady: a tall pale woman in a grey dress."), q);
  assert.ok(q.includes("say where THEY are — the looker, not what they look at — judged only by what you SEE, not by what the words wanted"));
  assert.ok(q.includes("\"outdoors\": you can see the looker STANDING out on the porch boards") && q.includes("seen in a window's frame behind its sill (glass or no glass)"));
  assert.ok(q.includes("\"looker\": \"the looker's name, or an empty string\"") && q.includes("\"lookerStands\": \"indoors\" or \"outdoors\" or \"\""));
  assert.ok(!sp.storyExtrasPrompt("an empty street").includes("Who is who"), "nobody named: no who-is-who");
  // the answer
  assert.equal(sp.parseStoryOutside('{"people":[],"uninvited":false,"looker":"Leni","lookerIs":"porch boards","lookerStands":"outdoors"}'), true);
  assert.equal(sp.parseStoryOutside('```json {"looker":"Leni","lookerStands":"Outdoors "} ```'), true);
  assert.equal(sp.parseStoryOutside('{"looker":"Priya","lookerStands":"indoors"}'), false);
  assert.equal(sp.parseStoryOutside('{"looker":"","lookerStands":"outdoors"}'), false, "nobody looks out: the ghost being outside is no fault");
  assert.equal(sp.parseStoryOutside('{"looker":"","lookerStands":""}'), false);
  assert.equal(sp.parseStoryOutside('{"people":[],"uninvited":false}'), null, "an older answer says nothing about it");
  assert.equal(sp.parseStoryOutside("no idea"), null);
  // the fault, and what the next go is told
  assert.equal(sp.storyFaults({ seen: [true, true], panels: false, outside: true }), 3);
  assert.equal(sp.storyFaults({ seen: [true, true], panels: false, outside: false }), 0);
  assert.ok(sp.storyFix({ seen: [true], panels: false, outside: true }, ["Leni"]).includes("they are INSIDE the house: behind the glass of the window or inside the doorway"));
  // the picture's own prompt: a looker is inside too, and "peers" alone says so
  assert.ok(sp.INSIDE_STAYS.includes("and whoever looks OUT or peers out through a window or a door — stays inside"));
  assert.equal(sp.insideNote("Leni peers into the dark"), sp.INSIDE_STAYS);
  assert.equal(sp.insideNote("Leni sits on the sofa"), "");
  // the pipeline asks it with who is who, reads it, and says what was wrong
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("const whoIsWho = here.map((c) => (c.look ? `${c.name}: ${c.look.slice(0, 120)}` : c.name));"));
  assert.ok(nar.includes("const outside = parseStoryOutside(String(extrasRaw || \"\"));"));
  assert.ok(nar.includes("seenAs!.outside ? \"whoever looks out stood outside\" : \"\""));
  // TODAY'S WORLD: every picture and every place's sheet of a story that is not a children's cartoon
  assert.ok(sp.TODAY_LOOK.includes("Where these words do not say how old a place is, it looks the way such a place looks TODAY") && sp.TODAY_LOOK.includes("no rough stone walls, no cottage and no castle unless they name one"));
  const place = { name: "the front door", look: "a narrow wooden door set in a dark porch wall" };
  assert.ok(sp.placeSheetPrompt(place, "dark horror", "", true).includes(sp.TODAY_LOOK));
  assert.ok(!sp.placeSheetPrompt(place, "bright cartoon").includes(sp.TODAY_LOOK), "a children's cartoon is left as it was");
  // the writer: whoever looks out is written INSIDE; no storybook cottage handed to it as an example; today's materials said
  const w = read("app", "lib", "film-engine.server.ts");
  assert.ok(w.includes("Whoever looks OUT through a window or a door is INSIDE, and the VISUAL says the word"));
  assert.ok(!w.includes("round green door") && w.includes("(\"the blue house on the corner\"), never by their name (\"NAME's house\")"));
  const pr = await import("../app/lib/premise-rules.ts");
  assert.ok(pr.REAL_WORLD.includes("so SAY it in the words the pictures are drawn from"));
  assert.ok(pr.CHILDREN_STAY.includes("not even in how a child looks: no scraped or bloody knees, no bruise, no bandage, no torn clothes"));
  // the storyboard's flag says what is wrong, in every language
  const film = read("app", "routes", "web.film.tsx");
  assert.ok(film.includes("if (c.outside === true) return t(\"Standing outside\");") && film.includes("if (c.extra === true) return t(\"A stranger in it\");"));
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const s of ["Standing outside", "A stranger in it"]) assert.equal(dict.split(`"${s}":`).length - 1, 5, `${s}: es, fr, de, zh and ur`);
});

/* THE SAME STORY, MADE AGAIN ON THAT BUILD ("Her Voice at the Door", 2026-11-24): a modern house at last, both
 * children inside at the window — but its hallway had the house's outside SIDING on its walls (drawn from the
 * sheet of the house's outside), the ghost's face at the window was drawn from outside BEHIND the glass (in the
 * room with them), her face turned into an ordinary woman's as the clip moved, and the last line asked "who
 * exactly they thought had just called the house phone first" — a call the story never made. */
test("inside a house its outside walls are not drawn; outside stays outside; the ending turns on what was told; a face stays its face", async () => {
  const sp = await import("../app/lib/story-picture.ts");
  const note = sp.placeNote(3, { name: "the house", look: "a small single-story modern home with pale painted siding" });
  assert.ok(note.includes(sp.PLACE_INSIDE) && sp.PLACE_INSIDE.includes("its outside walls (siding, brick, stone, planks) are never drawn indoors"));
  assert.ok(sp.TODAY_LOOK.includes("(outside, painted siding or plaster; inside, plain painted walls)"));
  assert.ok(sp.INSIDE_STAYS.includes("And whoever these words put OUTSIDE — on the porch, at the glass from outside, at the door — stays OUTSIDE, on the far side of the glass from the room: never drawn behind the window among the room's curtains, never in the room."));
  const w = read("app", "lib", "film-engine.server.ts");
  assert.ok(w.includes("Something OUTSIDE at a window or a door — a face at the glass, a hand on the door — is seen from INSIDE the room, through the glass"));
  assert.ok(w.includes("a viewer who has heard only this story understands it at once: it turns on something the story already showed or said, never on an event it never told"));
  const pr = await import("../app/lib/premise-rules.ts");
  assert.ok(pr.IDEA_CHECK.includes("Then read it as somebody who has only heard it: the ending makes sense from what the story told, and turns on nothing it never told.") && pr.IDEA_CHECK.endsWith("Change whatever is not."));
  const mo = await import("../app/lib/story-motion.ts");
  assert.ok(mo.motionPrompt("x").includes("Every face stays exactly the face it is — its features, its skin, its smile — never turning into another face or a more ordinary one."));
});

/* "STILL SHOTTY" (the owner, 2026-11-25, of "Whoever Waits on the Porch"): its ghost was "the ghost lady, a tall
 * woman who stands unnaturally still…" — a creature only by her NAME — so she was drawn as a PERSON: whole, evenly
 * lit, grinning and waving at the window like a decoration. And its last picture stood the locked front door
 * wide open onto the porch. */
test("a story's own creature is known by its name as well as its look; a door the words do not open is shut", async () => {
  const sp = await import("../app/lib/story-picture.ts");
  const ghost = "a tall woman who stands unnaturally still, her pale gown hanging damp and heavy, her smile stretched too wide";
  // (her look alone read as a woman when this was written; "unnaturally still" now reads as a creature too — the lake
  //  woman's look had no creature word at all: see the test below. Her NAME still decides it on its own:)
  assert.equal(sp.keepGuess(ghost).kind, "monster", "her look reads as a creature now…");
  assert.equal(sp.keepGuess("a tall woman, her pale gown hanging damp and heavy").kind, "person", "…a look with no wrongness in it is a woman…");
  assert.equal(sp.characterKind("the ghost lady", "a tall woman, her pale gown hanging damp and heavy"), "monster", "…and her name says what she is");
  assert.equal(sp.characterKind("the ghost lady", ghost), "monster");
  assert.equal(sp.characterKind("the shadow", "a dark shape with no face, standing under the old tree"), "monster");
  assert.equal(sp.characterKind("the thing in the well", "a pale shape, long thin arms"), "monster");
  assert.equal(sp.characterKind("Leni", "a 9-year-old girl with twin braids"), "person");
  assert.equal(sp.characterKind("Ghost", "a quiet boy in a grey hoodie"), "person", "a proper name never decides it");
  assert.equal(sp.characterKind("Howl", "a drowned ghost in a rotted oilskin"), "monster", "…the look still does");
  assert.equal(sp.characterKind("the old fisherman", "a weathered man in his seventies"), "person");
  // the creature word must be what the name IS
  assert.equal(sp.characterKind("the shadow figure", "a tall dark shape"), "monster");
  assert.equal(sp.characterKind("the headless rider", "a man in a black cloak on a horse"), "monster");
  assert.equal(sp.characterKind("the drowned girl", "a girl of ten in a wet white dress"), "monster");
  assert.equal(sp.characterKind("the monster under the bed", "something with long grey fingers"), "monster");
  assert.equal(sp.characterKind("the ghost hunter", "a wiry man in his forties with a camera"), "person");
  assert.equal(sp.characterKind("the shadow puppeteer", "a cheerful old man with a lamp"), "person");
  // "THE FIGURE IN ROOM 14" ("The Dent in the Pillow", 2026-11-25) was read as a person, and drawn whole, in plain light,
  // a step from the nurse: a figure the idea names is its threat — and "skin like PALE candle wax" is still candle wax
  const room14 = "a gaunt patient-shaped presence with skin like pale candle wax, sunken dark eye sockets with one wet glint of light, and a way of standing perfectly still";
  assert.equal(sp.characterKind("the figure in Room 14", room14), "monster");
  assert.equal(sp.characterKind("the figure", "a tall man in a long coat"), "monster");
  assert.equal(sp.characterKind("Mara", "her skin like old yellow candle wax"), "monster");
  assert.equal(sp.characterKind("Kay", "a gaunt patient-shaped presence"), "monster");
  assert.equal(sp.characterKind("the figure skater", "a young woman in a sequinned dress"), "person");
  assert.equal(sp.characterKind("Dad", "tired, with sunken dark eye sockets after a week of night shifts"), "person", "a tired man is a man");
  assert.equal(sp.characterKind("Ottilie", "a 34-year-old night-shift nurse with a sharp bob haircut"), "person");
  assert.equal(sp.characterKind("the vampire slayer", "a young woman with a crossbow"), "person");
  // its portrait is the photographed creature's, not a person's
  assert.ok(sp.portraitPrompt(`the ghost lady, ${ghost}`, "dark horror").includes("wardrobe-test photograph"));
  assert.ok(!sp.portraitPrompt("Leni, a 9-year-old girl with twin braids", "dark horror").includes("wardrobe-test photograph"));
  // a door the words do not open is shut — said whenever a picture has a door, a window or an outside
  assert.equal(sp.DOORS_SHUT, "Every door in the picture is SHUT unless these words open it.");
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("${insideNote(visual) ? ` ${INSIDE_STAYS} ${DOORS_SHUT} ${TRUE_SIZE}` : \"\"}"));
});

/* "LOOK DEEPER" (the owner, 2026-11-25, of the "three knocks" remake): "why are the walls dingy and not just a regular
 * household? why the train station guy appearing outside of the window, and the kid not even looking out the
 * window". The film look pulled every room toward an abandoned house; the idea's "dark shadow", given no look, was
 * drawn as a man in a hooded raincoat; a boy "at the window looking out", tagged CLOSE by a shuffled shot plan,
 * came back as a portrait staring into the lens. */
test("a lived-in home; a shadow drawn as a shadow; nobody stares into the lens; every VISUAL names its shot", async () => {
  const sp = await import("../app/lib/story-picture.ts");
  // the home
  // (…and a place in use is kept: room 14 of a working hospital was drawn peeling and cracked, like a ruined asylum)
  assert.ok(sp.LIVED_IN.endsWith("A place people work in or use every day — a hospital, a school, an office, a hotel, a shop — is clean and kept the same way, even a room in it nobody has used for a while: never peeling, cracked, stained or abandoned unless these words say so."));
  assert.ok(sp.TODAY_LOOK.endsWith(`${sp.LIVED_IN} ${sp.DRESSED}`) &&sp.LIVED_IN.includes("never stained, peeling, damp, dusty, bare or abandoned unless these words say so: it is dark because it is night, not because the house is falling apart."));
  // the shadow: the writer gives the idea's threat a cast entry and a shadow its look; the picture is told what a shadow is
  assert.ok(sp.WHAT_FRIGHTENS.includes("a threat the IDEA names (\"a dark shadow\", \"a ghost lady\", \"a figure\") always has a \"cast\" entry of its own") && sp.WHAT_FRIGHTENS.includes("never a person in a coat or a hood"));
  assert.equal(sp.shadowNote("Beyond the glass, under the old tree, a tall dark shadow stands motionless in the night"), sp.SHADOW_SHAPE);
  assert.equal(sp.shadowNote("a shadowy figure under the streetlight"), sp.SHADOW_SHAPE);
  for (const not of ["deep shadows fill the hallway", "in the shadow of the barn, Finn waits", "a shadow falls across her face", "the shadows of the branches play on the wall", "Leni sits in the shadowy corner of the room"]) assert.equal(sp.shadowNote(not), "", not);
  assert.ok(sp.SHADOW_SHAPE.includes("a tall human shape of flat, featureless black — no face, no clothes, no hood, no coat, no hat"));
  assert.equal(sp.characterKind("the shadow", "a tall human shape of flat, featureless black"), "monster", "…and as a cast member it is a creature: photographed, mostly hidden");
  // the stare: asked in the same look, a fault, and the next go is told where the eyes are
  const q = sp.storyExtrasPrompt("Inside the dark bedroom, Edvin stands at the window looking out", ["Edvin: a thin 9-year-old boy"]);
  assert.ok(q.includes("Last: does any PERSON in it — not a creature, a ghost or a shadow — look straight into the camera, eyes on the lens as if posing for a photograph?") && q.includes("\"intoLens\": [\"the name of each person looking straight into the camera — an empty list when nobody does\"]"));
  assert.deepEqual(sp.parseStoryLens('{"people":[],"uninvited":false,"looker":"Edvin","lookerStands":"indoors","intoLens":["Edvin"]}'), ["Edvin"]);
  assert.deepEqual(sp.parseStoryLens('{"intoLens":[]}'), []);
  assert.equal(sp.parseStoryLens('{"uninvited":false}'), null, "an older answer says nothing about it");
  assert.equal(sp.storyFaults({ seen: [true], panels: false, lens: ["Edvin"] }), 2);
  assert.equal(sp.storyFaults({ seen: [true], panels: false, lens: [] }), 0);
  assert.ok(sp.storyFix({ seen: [true], panels: false, lens: ["Edvin"] }, ["Edvin"]).includes("Edvin stared straight into the camera in the last try — nobody looks at the camera"));
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("const lens = parseStoryLens(String(extrasRaw || \"\"));"));
  const film = read("app", "routes", "web.film.tsx");
  assert.ok(film.includes("if (Array.isArray(c.lens) && c.lens.length) return t(\"Staring at camera\");"));
  assert.equal(read("app", "lib", "ui-i18n-dict.ts").split("\"Staring at camera\":").length - 1, 5, "es, fr, de, zh and ur");
  // a close-up looks at what the moment is about; every VISUAL opens with the name of its shot
  const sh = await import("../app/lib/story-shots.ts");
  assert.ok(sh.cameraLine("close").includes("the eyes are on whatever this moment has them looking at, off to one side of the lens — never into it."));
  const brief = sh.shotListBrief(["wide", "close"]);
  assert.ok(brief.includes("EVERY VISUAL OPENS WITH THE NAME OF THE LINE IT IS SEEN AS, in capitals, and a colon — \"WIDE:\", \"WALKING:\", \"NEAR AND FAR:\", \"OVER THE SHOULDER:\", \"CLOSE:\", \"FROM BELOW:\", \"TOGETHER:\", \"A DETAIL:\""));
  for (const k of Object.keys(sh.SHOT_NAME) as Array<keyof typeof sh.SHOT_NAME>) assert.equal(sh.shotInWords(`${sh.SHOT_NAME[k]}: Edvin at the window`), k, "each name is read back");
});

/* THE SAME TWO STORIES, MADE ON THAT (2026-11-25, "The Lady at the Glass" and "Three Knocks, Then Three More"): better
 * everywhere the owner named — and still a hallway with peeling, stained wallpaper in each, a grown man's hand
 * turning the children's lock ("a hand turning the small brass lock"), and the ghost's face as big as the window. */
test("a run-down place is looked for and drawn again; a face is a face's size; a hand in a detail is somebody's", async () => {
  const sp = await import("../app/lib/story-picture.ts");
  const q = sp.storyGrimePrompt("NEAR AND FAR: from inside the dark hallway, Nadia stands close to the camera.");
  assert.ok(q.includes("It was asked to show exactly this: \"NEAR AND FAR: from inside the dark hallway, Nadia stands close to the camera\"") && q.includes("an ordinary clean home that is simply dark at night is NOT grimy") && q.includes("{\"place\": \"…\", \"grimy\": true or false, \"corners\": \"what is in each corner, in a few words\", \"inset\": true or false}"));
  // (…and, in the same answer, a smaller picture pasted into it — "What the Lake Learned": a hand on a flashlight in
  //  a framed box in the corner of the shore. Any story's picture, a cartoon's too.)
  assert.ok(q.includes("\"inset\" is true only if a SMALLER separate picture sits inside this one") && q.includes("A window, a mirror, a screen or a doorway that belongs to the scene is NOT an inset."));
  assert.equal(sp.parseStoryInset('{"place":"a lake shore","grimy":false,"corners":"top-left: a framed close-up of a hand","inset":true}'), true);
  assert.equal(sp.parseStoryInset('{"grimy":false}'), null);
  assert.equal(sp.storyFaults({ seen: [true], panels: false, inset: true }), 4, "as bad as panels: it cannot be used");
  assert.ok(sp.storyFix({ seen: [true], panels: false, inset: true }, []).includes("draw ONE picture that fills the whole frame, with no box, inset, close-up or second view inside it"));
  // (…and the inside/outside rule reaches a tent: "inside the tent, Oksana's hand grips the zipper pull" was drawn outside it)
  assert.equal(sp.insideNote("inside the tent, Oksana's hand grips the zipper pull"), sp.INSIDE_STAYS);
  assert.ok(sp.INSIDE_STAYS.includes("the gap of the door or the thin wall of the tent"));
  assert.equal(sp.parseStoryGrime('{"place":"peeling stained wallpaper","grimy":true}'), true);
  assert.equal(sp.parseStoryGrime('{"place":"plain painted walls","grimy":false}'), false);
  assert.equal(sp.parseStoryGrime("no idea"), null);
  assert.equal(sp.storyFaults({ seen: [true], panels: false, grimy: true }), 2);
  assert.ok(sp.storyFix({ seen: [true], panels: false, grimy: true }, ["Nadia"]).includes("it is an ordinary, clean, cared-for place: freshly painted walls"));
  assert.ok(sp.TRUE_SIZE.includes("a face at a window or a door is the size of a face"));
  const nar = read("app", "lib", "narrated-story.server.ts");
  // (asked of every picture — the inset is anybody's fault; a run-down place counts only in a grown-up story)
  assert.ok(nar.includes("anthropicVision(storyGrimePrompt(visual), [pic], { maxTokens: 360, model: \"claude-sonnet-4-6\" }).catch(() => \"\"),"));
  assert.ok(nar.includes("const grimy = tmpl.childSafe ? null : parseStoryGrime(String(grimeRaw || \"\"));") && nar.includes("const inset = parseStoryInset(String(grimeRaw || \"\"));"));
  const film = read("app", "routes", "web.film.tsx");
  assert.ok(film.includes("if (c.grimy === true) return t(\"Looks run-down\");"));
  assert.equal(read("app", "lib", "ui-i18n-dict.ts").split("\"Looks run-down\":").length - 1, 5, "es, fr, de, zh and ur");
  const sh = await import("../app/lib/story-shots.ts");
  assert.ok(sh.STORY_SHOTS.detail.write.includes("A hand in it is always somebody's, and the VISUAL says whose"));
  assert.ok(sh.cameraLine("detail").includes("they are the hands of whoever these words name (a child's hand is a child's: small)."));
});

/* "NEEDS WORK BUT QUALITY WAY BETTER" (the owner, 2026-11-25, of the lake story in 1080p): its "woman standing waist-deep,
 * her smile far too wide and crowded with thin teeth" was read as a PERSON — so never kept half-hidden — and her
 * close-up's smile softened into an ordinary face as it moved; its first picture drew her on the tent wall when the
 * words had only her voice; and every moving clip had been squeezed at CRF 24 before the story's own encode. */
test("a nearly-human thing is a creature; its close-up stays still; a voice's maker is not drawn; clips kept finer", async () => {
  const sp = await import("../app/lib/story-picture.ts");
  for (const look of ["a pale woman standing waist-deep in the lake, her smile far too wide and crowded with thin teeth", "a tall woman who stands unnaturally still, her pale gown hanging damp", "a woman with skin like candle wax", "a thin man, eyes sunk in dark sockets"]) assert.equal(sp.keepGuess(look).kind, "monster", look);
  for (const look of ["a tired widow with hollow eyes and a black shawl", "an old fisherman with a wide grin and crooked teeth", "a nervous man with long fingers and a thin neck", "a ghostly pale child in a nightgown"]) assert.equal(sp.keepGuess(look).kind, "person", look);
  assert.ok(sp.STORY_SOUND.endsWith("— and whoever makes it is not in the picture unless these words put them there."));
  const nar = read("app", "lib", "narrated-story.server.ts");
  assert.ok(nar.includes("const creatures = (treatment.cast || []).map((e) => castEntry(e)).filter((c) => !!c.name && characterKind(c.name, c.look) === \"monster\").map((c) => c.name);"));
  assert.ok(nar.includes("const still = treatment.scenes.map((s) => sceneShot(s) === \"close\" && creatures.some((n) => presentIn(n, s.visual || \"\")));") && nar.includes("ckMotion: resume.ckMotion, still,"));
  const mo = read("app", "lib", "story-motion.server.ts");
  assert.ok(mo.includes("if (o.still?.[i]) { console.log(`[story-motion] scene ${i + 1} stays still: a creature's face, seen close`); continue; }"));
  assert.ok(mo.includes("\"-c:v\", \"libx264\", \"-preset\", \"fast\", \"-tune\", \"film\", \"-crf\", \"18\"") && !mo.includes("\"-crf\", \"24\""), "a clip is kept at the story's own quality, not squeezed before its last encode");
});

test("EVERYONE IS DRESSED (\"She Walked From Still Water\", 2026-11-25: told only 'a pale woman waist-deep in the lake', the picture model drew her bare, and the video engine kept it)", async () => {
  const sp = await import("../app/lib/story-picture.ts");
  const st = await import("../app/lib/acted-staging.ts");
  assert.equal(sp.DRESSED, "Everyone in the picture is fully clothed in ordinary clothes — a figure standing in water too, its own clothes soaked and clinging (a nightgown, a dress, a coat).");
  // every grown-up picture (told stories, their place sheets, an acted film's masters) has it through TODAY_LOOK
  assert.ok(sp.TODAY_LOOK.endsWith(sp.DRESSED));
  assert.ok(st.actedRealism(false, "a woman stands waist-deep in the lake", "the lake shore at night").includes(sp.DRESSED));
  // …a children's story picture is told it on its own
  assert.ok(read("app", "lib", "narrated-story.server.ts").includes("${tmpl.childSafe ? ` ${DRESSED}` : ` ${TODAY_LOOK}`}"));
  // …the reveal that draws the thing into a place says it
  assert.ok(st.revealPicture({ moment: "She stands close behind Wren, smiling.", sides: [{ name: "Wren", side: "left" }] }).includes(sp.DRESSED));
  // …and the writer gives a thing it invents clothes
  assert.ok(sp.WHAT_FRIGHTENS.includes("Its \"cast\" entry also says what it WEARS — a soaked nightgown, an old coat, a hospital gown: it is always dressed."));
});
