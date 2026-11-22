/* A FEATURED VERSE — another cast member sings part of the song, in their own voice.
 *
 * The owner, 2026-11-21: "need a feature thing also (another cast member sings that part of the song in
 * their voice like real music)".
 *
 * The song is one track. A second take of it is re-voiced as the co-star, and the two are cross-faded so
 * the co-star's take is heard for their verse; in their performance scenes it is the co-star on camera.
 * These pin the rules that make that watchable:
 *   - a singer is HEARD only while they are SEEN singing: a co-star's voice is their own performance
 *     shot, nudged to a breath when one is close to the cut — and every cut scene is the artist's;
 *   - the music under the voices never dips, doubles or flutters at a hand-over;
 *   - a co-star's verse is one they are seen singing, and the artist still sings their own song;
 *   - the finished track is exactly the length that was picked. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ARTIST, FEATURE_MIN_SECONDS, HANDOVER_REACH, OCTAVE_MARGIN, SING_CENTRE, TYPICAL_LEAD_HZ,
  bestLag, defaultFeaturePlan, envelopeExpr, featureMixFilter, featureRoles, featuredIn, octaveShiftFor, pitchChangeOf, planIsSound, vocalGaps, voiceWindows,
  type Gap,
} from "../app/lib/mv-feature.ts";
import { sceneCast, singerOf } from "../app/lib/mv-cast.ts";
import { sceneLineTimes } from "../app/lib/lyric-sync.ts";
import { SHOT_ROLES, defaultRole, editPlan, sceneCountFor, shotSlot, shotTimes, type ShotRole } from "../app/lib/mv-pace.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const P: ShotRole = "perform", B: ShotRole = "broll";
const cadence = (n: number, sec: number): ShotRole[] => Array.from({ length: n }, (_, i) => defaultRole(i, n, sec));
/** a breath every `every` seconds from `from` */
const breaths = (from: number, to: number, every: number): Gap[] => { const out: Gap[] = []; for (let t = from; t < to; t += every) out.push({ t, gap: 0.4 }); return out; };

test("who sings a scene is a name — and a name nobody in the cast has is the artist", () => {
  const names = ["VALENTINA", "KEIKO"];
  assert.equal(singerOf({ singer: "KEIKO" }, names), 1);
  assert.equal(singerOf({ singer: "  keiko " }, names), 1, "however it is written");
  assert.equal(singerOf({ singer: "Valentina" }, names), 0);
  assert.equal(singerOf({}, names), -1);
  assert.equal(singerOf(undefined, names), -1);
  assert.equal(singerOf({ singer: "OMAR" }, names), -1, "the artist's own name, or anyone else's");
  assert.equal(singerOf({ singer: "KEIKO" }, []), -1);
  // only the co-stars a shot can hold can sing
  assert.equal(singerOf({ singer: "C3" }, ["A1", "B2", "C3"]), -1);
});

test("a co-star leads their own performance — alone unless the maker puts someone beside them", () => {
  const names = ["VALENTINA", "KEIKO"];
  // the artist's performance, as ever: the artist leads, every co-star beside them
  assert.deepEqual(sceneCast({ scene: { visual: "A rooftop" }, role: P, slot: 1, names }), { lead: -1, others: [0, 1] });
  // KEIKO's verse, her performance: she leads, and has the shot to herself
  assert.deepEqual(sceneCast({ scene: { visual: "A rooftop", singer: "KEIKO" }, role: P, slot: 3, names }), { lead: 1, others: [] });
  // …unless the maker put the artist (-1) and the other co-star beside her
  assert.deepEqual(sceneCast({ scene: { visual: "A rooftop", singer: "KEIKO" }, role: P, slot: 3, names, listed: [-1, 0] }), { lead: 1, others: [-1, 0] });
  // she is never beside herself
  assert.deepEqual(sceneCast({ scene: { singer: "KEIKO" }, role: P, slot: 3, names, listed: [1, 0, 1] }), { lead: 1, others: [0] });
  // a CUT SCENE has no singer on camera, whatever mark it carries: the artist's shot as always (and the
  // artist's voice — a co-star is heard only in a performance of their own)
  assert.deepEqual(sceneCast({ scene: { visual: "The skyline", singer: "KEIKO" }, role: B, slot: 0, names }), { lead: -1, others: [] });
  assert.deepEqual(sceneCast({ scene: { visual: "KEIKO walks the pier", singer: "KEIKO" }, role: B, slot: 5, names }), { lead: -1, others: [1] });
  // the maker's pick for an artist-led scene never lists the artist beside the artist, never more than two
  assert.deepEqual(sceneCast({ scene: {}, role: P, slot: 1, names, listed: [-1, 1] }), { lead: -1, others: [1] });
  assert.deepEqual(sceneCast({ scene: {}, role: P, slot: 1, names, listed: [] }), { lead: -1, others: [] }, "an empty pick is a pick: the artist alone");
  // the page and the pipeline ask the same question
  const ui = read("app", "routes", "web.film.tsx");
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  assert.match(ui, /sceneCast\(\{ scene: scenesArr\[i\], role, slot: shotSlot\(role, i\), names: castNamesAll \}\)/);
  assert.match(pipe, /const cast = sceneCast\(\{ scene: s, role: shot\.role, slot: shot\.slot, names: castNameList, listed: /);
  assert.match(pipe, /return sceneCast\(\{ scene: scenes\[i\], role: shot\.role, slot: shot\.slot, names: extraNames, listed: /);
});

test("the breaths in a song are the silences between its words", () => {
  const words = [{ start: 0.2, end: 0.6 }, { start: 0.65, end: 1.1 }, { start: 1.8, end: 2.2 }, { start: 2.25, end: 2.9 }, { start: 4.0, end: 4.4 }];
  const gaps = vocalGaps(words);
  assert.deepEqual(gaps.map((g) => Math.round(g.t * 100) / 100), [1.45, 3.45]);
  assert.ok(Math.abs(gaps[0].gap - 0.7) < 1e-9 && Math.abs(gaps[1].gap - 1.1) < 1e-9);
  // out of order, or with junk in it, it still reads
  assert.equal(vocalGaps([...words].reverse()).length, 2);
  assert.deepEqual(vocalGaps([]), []);
  assert.deepEqual(vocalGaps([{ start: NaN, end: 1 }, { start: 2, end: 1 }] as never), []);
  assert.equal(vocalGaps(words, 1.0).length, 1, "a longer breath can be asked for");
});

test("a co-star is heard while they are seen singing — and at no other time", () => {
  // 30 seconds fast: cut, PERFORM (artist), cut, PERFORM (co-star), cut, cut
  const roles: ShotRole[] = [B, P, B, P, B, B];
  const singers = [ARTIST, ARTIST, ARTIST, 0, ARTIST, ARTIST];
  // no breaths known: exactly their shot
  assert.deepEqual(voiceWindows({ singers, roles, D: 5 }), [{ who: 0, start: 15, end: 20 }]);
  // a breath close to the cut, on the cut-scene side, is taken — so nobody hands over mid-word…
  assert.deepEqual(voiceWindows({ singers, roles, D: 5, gaps: [{ t: 14.7, gap: 0.4 }, { t: 20.3, gap: 0.4 }] }), [{ who: 0, start: 14.7, end: 20.3 }]);
  // …a breath further off than HANDOVER_REACH is not: the voice changes on the cut
  assert.equal(HANDOVER_REACH, 0.45);
  assert.deepEqual(voiceWindows({ singers, roles, D: 5, gaps: [{ t: 11.7, gap: 0.5 }, { t: 13.9, gap: 0.5 }, { t: 21.0, gap: 0.5 }, { t: 27.8, gap: 0.5 }] }), [{ who: 0, start: 15, end: 20 }]);
  // …and one INSIDE their shot may only be a hair in: it is their mouth on screen
  assert.deepEqual(voiceWindows({ singers, roles, D: 5, gaps: [{ t: 15.1, gap: 0.4 }, { t: 15.4, gap: 0.4 }, { t: 19.6, gap: 0.4 }, { t: 19.95, gap: 0.4 }] }), [{ who: 0, start: 15.1, end: 19.95 }]);

  // THE VIDEO ("Midnight Mile", 2026-11-22): the plan gave her the cut scene after her performance as
  // well, the change was aimed at where her written lines were sung, and the song — a little behind its
  // scenes — had breaths at 11.7 s and 27.8 s and few between. Her voice ran from 11.7 s to 27.8 s:
  // sixteen seconds, under five of them with her on screen. For the rest the picture was the ARTIST, on
  // a car and walking, his mouth moving — the owner: "the male singing some of the female lines".
  const thatPlan = [ARTIST, ARTIST, ARTIST, 0, 0, ARTIST];
  const thatSong = [{ t: 2.4, gap: 0.5 }, { t: 6.2, gap: 0.5 }, { t: 10.2, gap: 0.5 }, { t: 11.7, gap: 0.5 }, { t: 27.8, gap: 0.5 }];
  assert.deepEqual(voiceWindows({ singers: thatPlan, roles, D: 5, gaps: thatSong }), [{ who: 0, start: 15, end: 20 }], "her shot and only her shot — a cut scene marked as hers is still the artist's voice");

  // every length and pace, the verse dealt by rule: at every moment of every scene the voice heard is
  // the voice of whoever is SEEN singing — and in a cut scene it is always the artist's
  for (const s of [20, 30, 60, 90, 120]) for (const sec of [5, 10]) {
    const n = sceneCountFor(s, sec);
    const r = featureRoles(cadence(n, sec));
    for (const feat of [[0], [0, 1]]) {
      const plan = defaultFeaturePlan(r, sec, feat);
      for (const every of [0, 0.9, 1.7, 2.3, 4.1]) {
        const g = every ? breaths(0.4, s, every) : [];
        const wins = voiceWindows({ singers: plan, roles: r, D: sec, gaps: g });
        const voiceAt = (t: number): number => { const hit = wins.find((x) => t >= x.start && t < x.end); return hit ? hit.who : ARTIST; };
        r.forEach((role, i) => {
          const want = role === P ? plan[i] : ARTIST;
          // (a hand-over may sit up to HANDOVER_REACH into a cut scene, and only a hair into a performance)
          const pad = role === P ? 0.13 : HANDOVER_REACH + 0.01;
          for (let k = 0; k <= 10; k++) { const t = i * sec + pad + (k / 10) * (sec - 2 * pad); assert.equal(voiceAt(t), want, `${s}s/${sec}s feat=${feat} every=${every}: scene ${i} (${role}) at ${t.toFixed(2)}s`); }
        });
        // the stretches are in order, never overlap, and stay inside the song
        wins.forEach((x, k) => { assert.ok(x.start >= 0 && x.end <= s + 1e-9 && x.end - x.start > 0.25); if (k) assert.ok(x.start >= wins[k - 1].end - 1e-9); });
        // every featured co-star who has a performance is heard — for as long as they are seen, no longer
        for (const who of featuredIn(plan)) {
          const mine = wins.filter((x) => x.who === who);
          assert.ok(mine.length > 0, `${s}s/${sec}s: co-star ${who} has a verse and no voice`);
          const seen = plan.filter((w, i) => w === who && r[i] === P).length * sec;
          const heard = mine.reduce((a, x) => a + (x.end - x.start), 0);
          assert.ok(heard <= seen + 2 * HANDOVER_REACH * mine.length + 1e-9, `${s}s/${sec}s: co-star ${who} is heard for ${heard.toFixed(2)}s and seen for ${seen}s`);
        }
      }
    }
  }
});

test("where a scene's own lines are sung is read off the song", () => {
  const scenes = [
    { caption: "City lights are calling tonight" },
    { caption: "We keep driving / can't let go" },
    { caption: "" },
    { caption: "I keep circling back to your name" },
  ];
  // the song as heard: line 1 at 1 s, scene 2's two lines at 4 s and 6.5 s, scene 4's at 11 s
  const w = (word: string, start: number) => ({ word, start, end: start + 0.3 });
  const heard = [
    w("City", 1.0), w("lights", 1.4), w("are", 1.8), w("calling", 2.1), w("tonight", 2.6),
    w("We", 4.0), w("keep", 4.3), w("driving", 4.7),
    w("can't", 6.5), w("let", 6.9), w("go", 7.2),
    w("I", 11.0), w("keep", 11.3), w("circling", 11.6), w("back", 12.0), w("to", 12.3), w("your", 12.6), w("name", 12.9),
  ];
  const t = sceneLineTimes(scenes, heard);
  assert.deepEqual(t.map((x) => x.scene), [0, 1, 1, 3]);
  assert.ok(Math.abs(t[0].start - 1.0) < 1e-9 && Math.abs(t[0].end - 2.9) < 1e-9);
  assert.ok(Math.abs(t[3].start - 11.0) < 1e-9 && Math.abs(t[3].end - 13.2) < 1e-9);
  // a line the song never reached is absent, and the ones after it are still placed on their own scenes
  const cut = sceneLineTimes(scenes, heard.slice(0, 11));
  assert.deepEqual(cut.map((x) => x.scene), [0, 1, 1]);
  assert.deepEqual(sceneLineTimes(scenes, []), []);
  assert.deepEqual(sceneLineTimes([], heard), []);
  // …but where a co-star's WRITTEN lines fell no longer steers whose voice is heard: the voice follows
  // the picture (a song that ran behind its scenes had pulled her voice over eleven seconds of the artist)
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  assert.doesNotMatch(pipe, /sceneLineTimes/);
  assert.match(pipe, /const windows = voiceWindows\(\{ singers: o\.singers, roles: o\.roles, D: o\.D, gaps, shots: o\.shots \}\);/);
});

test("with no breath to be found the voice changes exactly on the cut", () => {
  const roles: ShotRole[] = [P, B, P, B];
  // (the cut scene after their performance is marked theirs here, as plans once were: it is not heard)
  assert.deepEqual(voiceWindows({ singers: [ARTIST, ARTIST, 0, 0], roles, D: 5 }), [{ who: 0, start: 10, end: 15 }]);
  // two performances back to back (a 20-second video of ten-second scenes): each mouth is on screen
  // right up to the cut, so the voice changes ON it — a breath 0.4 s off is too far, one a hair off is not
  assert.deepEqual(voiceWindows({ singers: [ARTIST, 0], roles: [P, P], D: 10, gaps: [{ t: 9.6, gap: 0.5 }, { t: 13, gap: 0.5 }] }), [{ who: 0, start: 10, end: 20 }]);
  assert.deepEqual(voiceWindows({ singers: [ARTIST, 0], roles: [P, P], D: 10, gaps: [{ t: 9.92, gap: 0.3 }] }), [{ who: 0, start: 9.92, end: 20 }]);
  // nobody featured → nothing to mix
  assert.deepEqual(voiceWindows({ singers: [ARTIST, ARTIST], roles: [P, B], D: 10 }), []);
  // a co-star marked on everything is still heard only in the performance
  assert.deepEqual(voiceWindows({ singers: [1, 1], roles: [P, B], D: 10 }), [{ who: 1, start: 0, end: 10 }]);
  assert.deepEqual(voiceWindows({ singers: [1, 1], roles: [B, B], D: 10 }), [], "heard, never seen: not heard");
  assert.deepEqual(voiceWindows({ singers: [], roles: [], D: 10 }), []);
  // two co-stars, one performance after the other
  const two = voiceWindows({ singers: [ARTIST, ARTIST, 0, 0, 1, 1, ARTIST, ARTIST], roles: [B, P, B, P, P, B, P, B], D: 5 });
  assert.deepEqual(two, [{ who: 0, start: 15, end: 20 }, { who: 1, start: 20, end: 25 }]);
  // a co-star with two performances in a row has them both
  assert.deepEqual(voiceWindows({ singers: [ARTIST, ARTIST, 0, 0, ARTIST], roles: [B, P, P, P, B], D: 5 }), [{ who: 0, start: 10, end: 20 }]);
});

test("a video with a featured verse has two performances, and the verse is one the co-star is seen singing", () => {
  assert.equal(FEATURE_MIN_SECONDS, 20);
  // five scenes and up already have them: the director's cadence stands
  for (const n of [5, 6, 8, 12, 24]) assert.deepEqual(featureRoles(cadence(n, 5)), cadence(n, 5));
  // a shorter video is dealt its own
  assert.deepEqual(featureRoles(cadence(2, 10)), [P, P]);
  assert.deepEqual(featureRoles(cadence(3, 10)), [P, B, P], "the slow 30-second cadence has ONE performance");
  assert.deepEqual(featureRoles(cadence(4, 5)), [P, B, P, B]);
  assert.deepEqual(featureRoles([P]), [P]);

  // the verse, dealt by rule
  assert.deepEqual(defaultFeaturePlan([P, P], 10, [0]), [ARTIST, 0]);
  assert.deepEqual(defaultFeaturePlan([P, B, P], 10, [0]), [ARTIST, ARTIST, 0]);
  assert.deepEqual(defaultFeaturePlan([P, B, P, B], 5, [0]), [ARTIST, ARTIST, 0, ARTIST]);
  // 30 seconds fast: the co-star takes the second performance — and ONLY the performance. (The cut
  // scene after it used to be theirs too: their voice then played over whoever that cut scene showed.)
  assert.deepEqual(defaultFeaturePlan(cadence(6, 5), 5, [0]), [ARTIST, ARTIST, ARTIST, 0, ARTIST, ARTIST]);
  // two co-stars each get a performance of their own when there are enough
  const p8 = defaultFeaturePlan(cadence(8, 5), 5, [0, 1]);
  assert.deepEqual(p8, [ARTIST, ARTIST, ARTIST, 0, ARTIST, ARTIST, 1, ARTIST]);
  // nothing the rule deals is ever a cut scene
  for (const n of [4, 5, 6, 8, 12, 24]) { const r = featureRoles(cadence(n, 5)); defaultFeaturePlan(r, 5, [0, 1]).forEach((w, i) => { if (w >= 0) assert.equal(r[i], P, `${n} scenes: scene ${i}`); }); }
  // too short to share, or nobody asked: the artist sings it all
  assert.deepEqual(defaultFeaturePlan([P, B], 5, [0]), [ARTIST, ARTIST]);
  assert.deepEqual(defaultFeaturePlan([P], 10, [0]), [ARTIST]);
  assert.deepEqual(defaultFeaturePlan(cadence(6, 5), 5, []), Array(6).fill(ARTIST));
  // every length and pace on offer from 20 seconds: the artist opens, every co-star is seen singing
  for (const s of [20, 30, 60, 90, 120]) for (const sec of [5, 10]) {
    const r = featureRoles(cadence(sceneCountFor(s, sec), sec));
    const plan = defaultFeaturePlan(r, sec, [0]);
    assert.ok(planIsSound(plan, r), `${s}s/${sec}s`);
    assert.equal(plan[r.indexOf(P)], ARTIST, `${s}s/${sec}s: the artist sings the first performance`);
    assert.ok(plan.filter((w) => w === 0).length <= Math.max(2, Math.ceil(plan.length / 2)), "the verse does not swallow the song");
  }
  // a plan is only sound when the co-star has a performance in it, and the artist still has one
  assert.equal(planIsSound([ARTIST, 0, ARTIST], [P, B, P]), false, "heard, never seen");
  assert.equal(planIsSound([0, 0, 0], [P, B, P]), false, "the artist has no song left");
  assert.equal(planIsSound([ARTIST, ARTIST, ARTIST], [P, B, P]), false, "nobody featured");
  assert.equal(planIsSound([ARTIST, 0, 0], [P, B, P]), true);
  assert.deepEqual(featuredIn([ARTIST, 1, 0, 1, ARTIST]), [0, 1]);
});

test("the two takes are faded so they always add up to one song", () => {
  // a ramp centred on each edge; none at the very start or end
  assert.equal(envelopeExpr([{ start: 10, end: 20 }], 30), "clip((t-9.94)/0.12,0,1)*clip((20.06-t)/0.12,0,1)");
  assert.equal(envelopeExpr([{ start: 0, end: 20 }], 30), "clip((20.06-t)/0.12,0,1)");
  assert.equal(envelopeExpr([{ start: 10, end: 30 }], 30), "clip((t-9.94)/0.12,0,1)");
  assert.equal(envelopeExpr([{ start: 0, end: 30 }], 30), "1");
  assert.equal(envelopeExpr([], 30), "0");
  assert.match(envelopeExpr([{ start: 5, end: 8 }, { start: 15, end: 18 }], 30), /^min\(1,.*\+.*\)$/);
  // worked out by hand: at any moment the co-star's level and the lead's (1 − it) add up to 1
  const env = (t: number, a: number, b: number, f = 0.12) => Math.max(0, Math.min(1, (t - (a - f / 2)) / f)) * Math.max(0, Math.min(1, ((b + f / 2) - t) / f));
  for (const t of [0, 9.9, 9.94, 9.97, 10, 10.03, 10.06, 15, 19.94, 20, 20.06, 25]) {
    const e = env(t, 10, 20);
    assert.ok(e >= 0 && e <= 1);
    assert.ok(Math.abs(e + Math.max(0, 1 - e) - 1) < 1e-12);
  }
  assert.ok(Math.abs(env(10, 10, 20) - 0.5) < 1e-9, "half and half exactly on the hand-over");
  // the graph: every take to one format, small frames so the ramp is a ramp, summed without re-levelling
  const g = featureMixFilter([[{ start: 10, end: 20 }]], 30);
  assert.match(g, /^\[0:a\]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,asetnsamples=n=256:p=0,volume='max\(0,1-\(clip\(/);
  assert.match(g, /\[1:a\]aresample=44100,.*volume='clip\(\(t-9\.94\)\/0\.12,0,1\)\*clip\(\(20\.06-t\)\/0\.12,0,1\)':eval=frame\[m1\]/);
  assert.match(g, /\[m0\]\[m1\]amix=inputs=2:normalize=0:dropout_transition=0\[a\]$/);
  assert.match(featureMixFilter([[{ start: 5, end: 10 }], [{ start: 20, end: 25 }]], 30), /\[m0\]\[m1\]\[m2\]amix=inputs=3:normalize=0/);
});

test("ffmpeg makes that mix: the co-star's take for their verse, the lead's everywhere else, to the length", { skip: spawnSync("ffmpeg", ["-version"]).status !== 0 && "ffmpeg is not on this machine" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mvfeat-"));
  try {
    const total = 12;
    const lead = path.join(dir, "lead.mp3"), take = path.join(dir, "take.mp3"), out = path.join(dir, "out.mp3"), raw = path.join(dir, "out.f32");
    // two "takes" that can be told apart by ear and by arithmetic: a 440 Hz tone and an 880 Hz one
    // (ffmpeg's sine source is an eighth of full scale: ×4 makes each a tone of amplitude 0.5)
    for (const [f, hz] of [[lead, 440], [take, 880]] as const) {
      assert.equal(spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=44100:duration=${total}`, "-af", "volume=4", "-ac", "2", "-c:a", "libmp3lame", "-q:a", "2", f], { encoding: "utf8" }).status, 0);
    }
    const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", lead, "-i", take, "-filter_complex", featureMixFilter([[{ start: 4, end: 8 }]], total), "-map", "[a]", "-t", String(total), "-c:a", "libmp3lame", "-q:a", "2", out], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr.slice(-300));
    const dur = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { encoding: "utf8" }).stdout.trim());
    assert.ok(Math.abs(dur - total) < 0.1, `the mix is ${dur}s, not ${total}s`);
    assert.equal(spawnSync("ffmpeg", ["-y", "-i", out, "-ac", "1", "-ar", "8000", "-f", "f32le", raw], { encoding: "utf8" }).status, 0);
    const buf = fs.readFileSync(raw);
    const pcm = new Float32Array(buf.byteLength >> 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = buf.readFloatLE(i * 4);
    /** how much of a tone is in [from, to) seconds (Goertzel) */
    const tone = (hz: number, from: number, to: number): number => {
      const a = Math.round(from * 8000), b = Math.min(pcm.length, Math.round(to * 8000));
      const w = (2 * Math.PI * hz) / 8000, c = 2 * Math.cos(w);
      let s1 = 0, s2 = 0;
      for (let i = a; i < b; i++) { const s0 = pcm[i] + c * s1 - s2; s2 = s1; s1 = s0; }
      return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / Math.max(1, b - a);
    };
    // before and after the verse: the lead's take, none of the co-star's
    for (const [a, b] of [[1, 3], [9, 11]]) { assert.ok(tone(440, a, b) > 0.1, `lead at ${a}s`); assert.ok(tone(880, a, b) < 0.01, `co-star's take leaks at ${a}s`); }
    // inside it: the co-star's, none of the lead's
    assert.ok(tone(880, 5, 7) > 0.1, "the co-star's take is heard in their verse");
    assert.ok(tone(440, 5, 7) < 0.01, "the lead's take leaks into the verse");
    // and the level never dips or doubles: as loud inside as outside
    assert.ok(Math.abs(tone(880, 5, 7) - tone(440, 1, 3)) < 0.03);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the co-star's verse is sung where the song is — moved an octave only when that is clearly their range", () => {
  // MEASURED 2026-11-22 on six finished videos: the engine's lead vocal sat at 247–281 Hz in five of
  // them (418 in one), men and women alike. The first cut moved a woman's verse on a man's song UP an
  // octave — to over 500 Hz.
  for (const hz of [247, 261, 276, 281]) {
    assert.equal(octaveShiftFor(hz, "f"), 0, `a woman's verse at ${hz} Hz stays where it is`);
    assert.equal(octaveShiftFor(hz, "m"), -12, `a man's verse at ${hz} Hz comes down an octave to his own range`);
  }
  // a genuinely low lead (a deep rap voice) → a woman's verse goes up
  assert.equal(octaveShiftFor(125, "f"), 12);
  assert.equal(octaveShiftFor(125, "m"), 0);
  // a high lead → a man's verse comes down; a woman's stays (a near-tie never moves it)
  assert.equal(octaveShiftFor(418, "m"), -12);
  assert.equal(octaveShiftFor(418, "f"), 0);
  assert.equal(octaveShiftFor(560, "f"), -12, "…until it is clearly out of her range");
  // the pitch could not be read → what the engine usually sings at
  assert.equal(TYPICAL_LEAD_HZ, 265);
  assert.equal(octaveShiftFor(null, "f"), octaveShiftFor(TYPICAL_LEAD_HZ, "f"));
  assert.equal(octaveShiftFor(undefined, "m"), octaveShiftFor(TYPICAL_LEAD_HZ, "m"));
  assert.equal(octaveShiftFor(0, "f"), 0);
  // not knowing who is singing is no reason to move anything
  assert.equal(octaveShiftFor(265, undefined), 0);
  // every move lands nearer the singer's own range than staying would have
  for (const who of ["m", "f"] as const) for (let hz = 90; hz <= 700; hz += 7) {
    const s = octaveShiftFor(hz, who);
    const off = (x: number) => Math.abs(Math.log2((hz * Math.pow(2, x / 12)) / SING_CENTRE[who]));
    if (s !== 0) assert.ok(off(s) < off(0) - OCTAVE_MARGIN + 1e-9, `${who} at ${hz} Hz moved ${s}`);
    else assert.ok(Math.min(off(-12), off(12)) >= off(0) - OCTAVE_MARGIN - 1e-9, `${who} at ${hz} Hz should have moved`);
  }
  // the re-voice model's two settings are simply an octave up and an octave down
  assert.equal(pitchChangeOf(12), "male-to-female");
  assert.equal(pitchChangeOf(-12), "female-to-male");
  assert.equal(pitchChangeOf(0), "no-change");
  const voice = read("app", "lib", "singing-voice.server.ts");
  assert.match(voice, /pitchChange\?: "no-change" \| "male-to-female" \| "female-to-male"/);
  assert.match(voice, /pitch_change: pitchChange, output_format: "mp3",/);
  // the lead's own-voice cover and a spoken line are untouched: they never pass it
  assert.match(voice, /const pitchChange = opts\.pitchChange === "male-to-female" \|\| opts\.pitchChange === "female-to-male" \? opts\.pitchChange : "no-change";/);
});

test("a take that came back a few hundredths of a second off is found, and a take that did not is left alone", () => {
  const sr = 2000, n = sr * 8;
  // a "song": a few tones and a beat — something with a shape to line up
  const song = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    song[i] = 0.4 * Math.sin(2 * Math.PI * 110 * t) + 0.3 * Math.sin(2 * Math.PI * 173 * t * (1 + 0.1 * Math.sin(t))) + ((i % 900) < 40 ? 0.8 : 0) * Math.sin(2 * Math.PI * 60 * t);
  }
  const shifted = (lagSamples: number): Float32Array => { const out = new Float32Array(n); for (let i = 0; i < n; i++) { const j = i - lagSamples; out[i] = j >= 0 && j < n ? song[j] : 0; } return out; };
  // 35 ms late, 20 ms early
  assert.ok(Math.abs(bestLag(song, shifted(70), sr) - 0.035) <= 0.001);
  assert.ok(Math.abs(bestLag(song, shifted(-40), sr) - -0.02) <= 0.001);
  // in step already
  assert.equal(bestLag(song, shifted(0), sr), 0);
  // too little to compare, or silence: nothing moves
  assert.equal(bestLag(new Float32Array(100), new Float32Array(100), sr), 0);
  assert.equal(bestLag(new Float32Array(n), new Float32Array(n), sr), 0);
});

test("the co-star's verse is dealt before the song is written, said scene by scene, and filmed to the same plan", () => {
  const engine = read("app", "lib", "film-engine.server.ts");
  const fn = engine.slice(engine.indexOf("export async function previewFilmTreatment"), engine.indexOf("// ---- Assembly"));
  // a scene can carry who sings it
  assert.match(engine, /singer\?: string;/);
  assert.match(engine, /tone: \{ type: "string" \}, singer: \{ type: "string" \} \},/);
  // only a picked co-star, only in a video long enough to share
  assert.match(fn, /const featured = tmpl\.lipSyncSinger && videoSecs >= FEATURE_MIN_SECONDS/);
  assert.match(fn, /castList\.filter\(\(n\) => \(opts\.featureNames \|\| \[\]\)\.some\(/);
  // the roles are dealt so the co-star has a performance of their own
  assert.match(fn, /return featured\.length \? featureRoles\(cadence\) : cadence;/);
  // what the writer is told
  assert.match(fn, /A FEATURED VERSE — \$\{featNames\} \$\{featured\.length === 1 \? "sings" : "each sing"\} part of this song, like a featured artist on a real record\./);
  // WHICH scenes are the verse is not left to the writer (2026-11-22: asked to "give them two or three
  // scenes in a row", a sheet came back with the co-star's performance written into the last cut scene
  // and the artist singing in the scene the rule then dealt to her — the pictures were written to one
  // plan and filmed to another). The plan is dealt first and said in the shot list, line by line…
  assert.match(fn, /const featPlan: number\[\] = featured\.length \? defaultFeaturePlan\(roles, sceneSec, featured\.map\(\(n\) => castList\.indexOf\(n\)\)\) : \[\];/);
  assert.match(fn, /PERFORMANCE — \$\{who\}'S VERSE: \$\{who\} sings straight to camera, ALONE in the shot \(the artist is not in it\); "singer": "\$\{who\}"/);
  // …and it is a PERFORMANCE of theirs, never a cut scene: they are heard only while they are seen singing
  assert.match(fn, /const who = roles\[i\] === "perform" && featPlan\[i\] >= 0 \? castList\[featPlan\[i\]\] : "";/);
  assert.doesNotMatch(fn, /VERSE goes on over it/);
  assert.match(fn, /The scene marked "…'S VERSE" in the shot list IS that verse: set "singer" to their exact name in it and in no other scene\./);
  assert.match(fn, /Its lyric lines are THEIR words, in their own voice: their side of the story, answering the artist — a complete thought that starts and ends inside that one scene, because they are heard only while they are on screen\./);
  assert.match(fn, /End the title with "\(feat\. \$\{featNames\}\)"/);
  assert.doesNotMatch(fn, /two or three scenes in a row/);
  // …and "only the artist ever sings" is still what every other video is told
  assert.match(fn, /WHO DOES WHAT — only the ARTIST ever sings\./);
  // …and the SAME rule decides who sings each scene afterwards, whatever marks came back
  assert.match(fn, /const singers: number\[\] = featured\.length \? defaultFeaturePlan\(outRoles, sceneSec, featIdx\) : list\.map\(\(\) => -1\);/);
  assert.doesNotMatch(fn, /planIsSound\(singers, outRoles\)/);
  assert.match(fn, /\.\.\.\(featured\.length && singers\[i\] >= 0 \? \{ singer: castList\[singers\[i\]\] \} : \{\}\),/);
  // the plan the writer is given for the usual six scenes: the artist opens and has the first
  // performance; the co-star has the second performance — and nothing else
  const roles = featureRoles(Array.from({ length: 6 }, (_, i) => defaultRole(i, 6, 5)));
  assert.deepEqual(defaultFeaturePlan(roles, 5, [1]), [-1, -1, -1, 1, -1, -1]);
  // one world: a night video never cuts to daylight (the same sheet set its last scene "sunlit")
  assert.match(fn, /but ONE WORLD: the same time of day and the same kind of light in every scene \(a night video never cuts to daylight\), said in each VISUAL/);
});

test("the render: the verse is re-voiced and mixed, the co-star leads their shot, and a failure costs nothing", () => {
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  const gen = pipe.slice(pipe.indexOf("export async function generateMusicVideo"));
  const mix = pipe.slice(pipe.indexOf("async function mixFeaturedVoices"), pipe.indexOf("export async function generateMusicVideo"));
  // who sings each scene comes off the scenes; the mix runs on the FINISHED lead track
  assert.match(gen, /const singers = scenes\.map\(\(s\) => singerOf\(s, extraNames\)\);/);
  assert.ok(gen.indexOf("fitSongToLength(songPath, targetLen)") < gen.indexOf("mixFeaturedVoices({"), "the song is fit to length before the verse is mixed");
  assert.ok(gen.indexOf("ckSongVoice") < gen.indexOf("mixFeaturedVoices({"), "the artist's own voice goes on first");
  assert.ok(gen.indexOf("mixFeaturedVoices({") < gen.indexOf("sliceAudio(songPath, i * D, D)"), "the lip-sync hears the finished track");
  // a co-star with no voice is not made up: the artist sings their scenes
  assert.match(gen, /\.filter\(\(f\) => f\.voiceId\);/);
  // it can fail without costing the render, and is not done twice on a resume
  assert.match(gen, /if \(resume\.ckSongFeat && fs\.existsSync\(resume\.ckSongFeat\)\) \{ songPath = resume\.ckSongFeat;/);
  assert.match(gen, /await ckpt\(\{ ckSongFeat: songPath, ckFeatNames: mixed\.names\.join\("\|"\) \}\);/);
  assert.match(gen, /featured verse could not be made/);
  const queue = read("app", "lib", "job-queue.server.ts");
  assert.match(queue, /ckSongFeat: payload\.ckSongFeat as string \| undefined,/);
  assert.match(queue, /featureVoices: Array\.isArray\(payload\.filmFeatureVoices\)/);
  // the mix: breaths → stretches → each co-star's take (their model, an octave if need be, levelled,
  // lined up) → one track of exactly the song's length
  assert.match(mix, /const heard = wordsFromWhisperx\(await repPoll\(await createWhisperx\(songUrl, null\)/);
  assert.match(mix, /gaps = vocalGaps\(heard\);/);
  assert.match(mix, /const windows = voiceWindows\(\{ singers: o\.singers, roles: o\.roles, D: o\.D, gaps, shots: o\.shots \}\);/);
  // …and it says where it put each voice (there are no logs to read on the host without the owner's sign-in)
  assert.match(mix, /console\.log\(`\[musicvideo\] featured voice: /);
  assert.match(mix, /const model = await ensureVoiceModel\(f\.voiceId, o\.base, \{ pitch: f\.speechPitch \}\);/);
  // …asked for with the vocal a little lower, so the take keeps the balance of the song it is cut into
  assert.match(mix, /coverSongInVoice\(songUrl, model\.url, \{ pitchChange: pitchChangeOf\(shift\), vocalsDb: FEATURE_VOCAL_TRIM_DB \}\)/);
  // …the octave coming from where the song's vocal sits in THEIR stretches, read off the mix
  assert.match(mix, /const leadHz = \(await songVocalPitch\(o\.songPath, mine\)\) \?\? \(await songVocalPitch\(o\.songPath, \[\{ start: 0, end: total \}\]\)\);/);
  assert.match(mix, /const shift = octaveShiftFor\(leadHz, f\.gender\);/);
  assert.match(pipe, /"-af", "highpass=f=180,lowpass=f=1200", "-ac", "1", "-ar", "16000", "-f", "s16le", raw\]/);
  assert.match(mix, /matchLoudness\(covered, o\.songPath\)/);
  assert.match(mix, /alignTake\(o\.songPath, level\)/);
  assert.match(mix, /featureMixFilter\(takes\.map\(\(t\) => windows\.filter\(\(w\) => w\.who === t\.who\)\), total\)/);
  assert.match(mix, /Math\.abs\(ffprobeDuration\(out\) - total\) > 0\.6/);
  // not hearing the words is no failure — the voice then changes on the scene
  assert.match(mix, /catch \(e\) \{ console\.error\(`\[musicvideo\] could not hear the words for the featured verse/);
  // a prop is the artist's: a co-star's own shot has none, in the storyboard and the render alike
  assert.match(pipe, /return !!shot\.propOk && !\(shot\.role === "perform" && singerOf\(scenes\[i\], castNames\) >= 0\);/);
  assert.equal(pipe.split("placeProps(scenes, propList, D,").length - 1, 2, "one rule for the storyboard and the render");
  // what was made is recorded
  assert.match(gen, /\.\.\.\(featuredNames\.length \? \{ featured: featuredNames \} : \{\}\),/);
});

test("the page: a co-star is given a verse with one tap, and their voice must be theirs to use", () => {
  const ui = read("app", "routes", "web.film.tsx");
  // one tap on the co-star; only a co-star with a voice of their own; not in a video too short to share
  assert.match(ui, /const \[featPick, setFeatPick\] = useState<string\[\]>\(\[\]\);/);
  assert.match(ui, /const singable = castExtra\.filter\(\(m\) => canSingImg\(m\.img\) && !!\(m\.name \|\| ""\)\.trim\(\)\);/);
  // the page knows only WHETHER someone can sing, and says only WHO — never a voice id
  assert.match(ui, /sing: builtInCanSing\(a\),/);
  assert.match(ui, /const featureJson = JSON\.stringify\(featured\.map\(\(m\) => \(\{ name: m\.name\.trim\(\) \}\)\)\);/);
  assert.doesNotMatch(ui, /voiceOfImg/);
  assert.match(ui, /const tooShortToFeature = mvSceneCount \* mvSceneSec < FEATURE_MIN_SECONDS;/);
  assert.match(ui, /className=\{`mm-castmem-feat\$\{featPick\.includes\(m\.img\) \? " on" : ""\}`\}/);
  // a different singer is a different song: the words and the pictures start over
  assert.match(ui, /\[artistPick, castExtra\.map\(\(m\) => m\.img\)\.join\(","\), featKey\]/);
  assert.match(ui, /songSource, filmSongUrl, artistPick, mvAspect, featKey\]/);
  // it rides with the song request, the storyboard request and the render
  for (const intent of ["previewFilmTreatment", "previewFilmScenes"]) {
    const at = ui.indexOf(`{ intent: "${intent}"`);
    assert.match(ui.slice(at, at + 500), /filmFeature: featureJson/, intent);
  }
  assert.match(ui, /<input type="hidden" name="filmFeature" value=\{featureAllJson\} \/>/);
  // the storyboard says who sings each scene, and lets the maker change it
  assert.match(ui, /className="mm-sc-chip mm-chip-av mm-chip-lead mm-chip-sings"/);
  assert.match(ui, /const setSceneSinger = \(i: number, name: string\) => \{/);
  assert.match(ui, /\.\.\.\(leadRef \? \{ sceneLeadRef: leadRef \} : \{\}\)/);
  // THE ACTION: whose voice it is, is decided on the server from the co-star's own picture — never from
  // an id the page sends — and the singer must be one of this video's co-stars
  const act = ui.slice(ui.indexOf("let filmFeatureVoices"), ui.indexOf("let filmFeatureVoices") + 900);
  assert.match(act, /for \(const m of filmCastExtra\) \{/);
  assert.match(act, /if \(!asked\.some\(\(f\) => nameTok\(f\.name\) === nameTok\(m\.name\)\)\) continue;/);
  assert.match(act, /const v = await singVoiceForImg\(shop\.id, m\.img\);/);
  assert.match(ui, /\.\.\.\(filmFeatureVoices\.length \? \{ filmFeatureVoices \} : \{\}\),/);
  const parse = ui.slice(ui.indexOf("function parseFeature"), ui.indexOf("function parseFeature") + 600);
  assert.doesNotMatch(parse, /voiceId/, "a voice id sent by the page is not even read");
  // WHOSE voice: a built-in presenter's is the one they were cast with (or the one this shop gave them),
  // one of the shop's own presenters' is the one picked for them, and a character voice is not a singing voice
  const voices = read("app", "lib", "mv-voices.server.ts");
  assert.match(voices, /const own = \(await stockVoicesFor\(shopId\)\)\[a\.id\];/);
  assert.match(voices, /const cast = castFor\(a\);/);
  assert.match(voices, /\{ voiceId: cast\.voice, pitch: cast\.pitch \|\| 0, gender: a\.gender \}/);
  assert.match(voices, /\(await customCastFor\(shopId\)\)\.find\(\(c\) => !!c\.img && bare\(c\.img\) === bare\(img\)\)/);
  assert.equal(voices.split("isCharacterVoice(").length - 1, 4, "every way to a voice refuses a character voice");
  // a built-in presenter's picture is recognised whatever origin or cache-buster it carries
  const builtIn = /^\/avatars\/([a-z0-9-]+)_\d+\.(?:jpe?g|png|webp)$/i;
  const bare = (u: string) => u.split("?")[0].split("#")[0].replace(/^https?:\/\/[^/]+/i, "");
  assert.equal(builtIn.exec(bare("/avatars/keiko_0.jpg?v=3"))?.[1], "keiko");
  assert.equal(builtIn.exec(bare("https://easymodeapp.com/avatars/omar_2.jpg"))?.[1], "omar");
  assert.equal(builtIn.exec(bare("/renders/custom-abc_0.jpg")), null);
  assert.ok(voices.includes(String(builtIn).slice(1, String(builtIn).lastIndexOf("/"))), "the test's pattern is the module's");
  // THE VOICE MODEL: a built-in presenter's designed voice lives on another account and is read there,
  // at the pitch they are cast at — and that pitch is part of which model it is
  const sv = read("app", "lib", "singing-voice.server.ts");
  assert.match(sv, /if \(voiceId\.startsWith\("ttv-"\)\) \{\s+const \{ falTts \} = await import\("\.\/fal-video\.server"\);/);
  assert.match(sv, /const key = voiceKey\(pitch \? `\$\{vid\}@p\$\{pitch\}` : vid\);/);
  assert.match(sv, /export async function ensureVoiceModel\(voiceId: string, base: string, opts: \{ pitch\?: number \} = \{\}\)/);
  // a scene that is still off after the check is flagged on the still itself
  assert.match(ui, /const flagged = isMv && !!seeds && \(\(seeds\.faults \|\| \[\]\)\[i\] \|\| 0\) > 0 && rerollingScene !== i;/);
  // a writer error no longer leaves the button stuck on "Building the scenes"
  assert.match(ui, /else if \(treatmentFetcher\.data\?\.error\) setChainToScenes\(false\);/);
  // the slots the page frames a scene with are the pipeline's
  for (let i = 0; i < 12; i++) assert.equal(SHOT_ROLES[shotSlot(P, i)], P);
});

test("two voices is a switch the maker turns on — co-stars in the video never sing by themselves", () => {
  // The owner, 2026-11-22: "multiple presenter clips should not mean automatic feature (two voices song)
  // needs to be toggle". It never was automatic — every test video he was sent had it turned on — but the
  // control was a small pill on each co-star that read as part of having one. It is a labelled switch now.
  const ui = read("app", "routes", "web.film.tsx");
  // OFF to begin with, and nothing but the maker's tap turns it on
  assert.match(ui, /const \[featPick, setFeatPick\] = useState<string\[\]>\(\[\]\);/);
  assert.equal(ui.split("setFeatPick(").length - 1, 2, "the switch, and the who-sings pill — nothing else sets it");
  assert.match(ui, /<button type="button" role="switch" aria-checked=\{featured\.length > 0\} className=\{`mm-twovoice\$\{featured\.length > 0 \? " on" : ""\}`\}/);
  assert.match(ui, /onClick=\{\(\) => setFeatPick\(featured\.length > 0 \? \[\] : \[singable\[0\]\.img\]\)\}/);
  // it says what each position means, with the names in it
  assert.match(ui, /t\("Off — \{star\} sings the whole song\. Turn on to give a co-star a verse\.", \{ star: artistName \|\| t\("The star"\) \}\)/);
  assert.match(ui, /t\("On — \{name\} sings one verse in their own voice, while they are on screen\. \{star\} sings the rest\."/);
  // only a co-star with a voice of their own can be given one; the pill that picks WHO shows once it is on
  assert.match(ui, /\{singable\.length > 0 && \(\s+<button type="button" role="switch"/);
  assert.match(ui, /\{featured\.length > 0 && singable\.length > 1 && canSingImg\(m\.img\)/);
  // every word of it is in every language the app speaks
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Two voices", "Off — {star} sings the whole song. Turn on to give a co-star a verse.", "On — {name} sings one verse in their own voice, while they are on screen. {star} sings the rest."]) {
    assert.equal(dict.split(`\n  ${JSON.stringify(k)}:`).length - 1, 5, `"${k}" in es, fr, de, zh and ur`);
  }
  // with no co-star singing, the song has one voice: the writer keeps no "singer" mark and the render mixes nothing
  const engine = read("app", "lib", "film-engine.server.ts");
  assert.match(engine, /\.\.\.\(featured\.length && singers\[i\] >= 0 \? \{ singer: castList\[singers\[i\]\] \} : \{\}\),/);
  // a scene turned into a cut scene is nobody's to sing
  assert.match(ui, /const \{ singer: _drop, \.\.\.rest \} = s; return \{ \.\.\.rest, kind \};/);
  assert.doesNotMatch(ui, /mm-chip-voice/, "no cut scene is shown as a co-star's verse");
});

test("a cut scene's faces do not talk", () => {
  // "Midnight Mile", looked at five frames a second: on the parked car and walking the terrace the
  // artist's mouth opened and closed as if speaking — while the co-star's voice was the one singing.
  // The prompt already said every mouth stays closed. The model's negative prompt is where it listens.
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  const gen = pipe.slice(pipe.indexOf("export async function generateMusicVideo"));
  assert.match(gen, /const quietFaces = shot\.role === "perform" \? "" : "talking, speaking, singing, lip sync, lips moving, mouth opening, open mouth, /);
  assert.match(gen, /generateAudio: false, \.\.\.\(quietFaces \? \{ negativePrompt: quietFaces \} : \{\}\) \}\);/);
  // a performance is left alone: its mouth is re-driven to the song afterwards
  const fal = read("app", "lib", "fal-video.server.ts");
  assert.match(fal, /negative_prompt: opts\.negativePrompt/);
});

test("the voice follows the cut the edit really makes, not the grid it was dealt on", () => {
  // "Midnight Mile": her shot was dealt 15–20 s; the paced edit, cutting on the beat, ran it 15.0–19.75
  const roles: ShotRole[] = [B, P, B, P, B, B];
  const singers = [ARTIST, ARTIST, ARTIST, 0, ARTIST, ARTIST];
  const shots = [null, { start: 5, end: 10 }, null, { start: 15.0, end: 19.75 }, null, null];
  assert.deepEqual(voiceWindows({ singers, roles, D: 5, shots }), [{ who: 0, start: 15, end: 19.75 }]);
  // a breath just after the real cut is still taken; one that is only near the GRID line is not
  assert.deepEqual(voiceWindows({ singers, roles, D: 5, shots, gaps: [{ t: 19.9, gap: 0.4 }] }), [{ who: 0, start: 15, end: 19.9 }]);
  assert.deepEqual(voiceWindows({ singers, roles, D: 5, shots, gaps: [{ t: 20.4, gap: 0.4 }] }), [{ who: 0, start: 15, end: 19.75 }]);
  // a shot that starts late (the cut before it moved onto a beat) is not sung over before it starts
  assert.deepEqual(voiceWindows({ singers, roles, D: 5, shots: [null, null, null, { start: 15.4, end: 20 }, null, null] }), [{ who: 0, start: 15.4, end: 20 }]);
  // junk, or no times for that scene: the grid
  assert.deepEqual(voiceWindows({ singers, roles, D: 5, shots: [null, null, null, { start: NaN, end: 3 }, null, null] as never }), [{ who: 0, start: 15, end: 20 }]);
  assert.deepEqual(voiceWindows({ singers, roles, D: 5, shots: [] }), [{ who: 0, start: 15, end: 20 }]);

  // WHEN a clip is on screen, read off a cut list
  assert.deepEqual(shotTimes([{ src: 0, start: 0, dur: 5 }, { src: 1, start: 0, dur: 5 }], 2), [{ start: 0, end: 5 }, { start: 5, end: 10 }]);
  // a performance that a cutaway interrupts is one stretch: the singer is heard through the cutaway
  assert.deepEqual(shotTimes([{ src: 0, start: 0, dur: 7.5 }, { src: 1, start: 3.75, dur: 2.5 }, { src: 0, start: 7.5, dur: 2.5 }, { src: 1, start: 0, dur: 10 }], 2)[0], { start: 0, end: 12.5 });
  assert.deepEqual(shotTimes([{ src: 1, start: 0, dur: 5 }], 3), [null, { start: 0, end: 5 }, null]);
  assert.deepEqual(shotTimes([], 2), [null, null]);
  // every length, pace and beat: a co-star's voice sits inside the stretch their own clip is on screen
  // (give or take the reach to a breath), and the edit that is timed is the edit that is made
  for (const s of [20, 30, 60, 120]) for (const sec of [5, 10]) for (const pace of ["slow", "medium", "fast"] as const) {
    const r = featureRoles(cadence(sceneCountFor(s, sec), sec));
    const plan = defaultFeaturePlan(r, sec, [0]);
    for (const bpm of [0, 88, 120]) {
      const beats: number[] = []; if (bpm) for (let t = 0.31; t < s; t += 60 / bpm) beats.push(t);
      const cuts = editPlan(r, sec, pace, beats);
      const shown = shotTimes(cuts, r.length);
      const wins = voiceWindows({ singers: plan, roles: r, D: sec, shots: shown });
      for (const w of wins) {
        const i = plan.findIndex((who, k) => who === w.who && r[k] === P && shown[k] && shown[k]!.start <= w.start + 1e-9 && shown[k]!.end >= w.end - 1e-9);
        assert.ok(i >= 0, `${s}s/${sec}s ${pace} ${bpm}bpm: the voice ${w.start.toFixed(2)}–${w.end.toFixed(2)} is not inside her shot ${JSON.stringify(shown)}`);
      }
      assert.equal(wins.length, 1, `${s}s/${sec}s ${pace} ${bpm}bpm`);
    }
  }
  // the pipeline works the edit out BEFORE the mix, from the same roles, pace and beats it cuts with after
  const pipe = read("app", "lib", "music-video-pipeline.server.ts");
  const gen = pipe.slice(pipe.indexOf("export async function generateMusicVideo"));
  assert.match(gen, /const beats: number\[\] = pace !== "slow" \? await songBeats\(songPath\) : \[\];/);
  assert.match(gen, /shots: shotTimes\(editPlan\(roles, D, pace, beats\), roles\.length\) \}\);/);
  assert.match(gen, /const onBeat = good\.length === scenes\.length && pace !== "slow" \? beats : \[\];/);
  assert.equal(gen.split("await songBeats(songPath)").length - 1, 1, "the beats are found once");
  assert.ok(gen.indexOf("await songBeats(songPath)") < gen.indexOf("mixFeaturedVoices({"), "before the verse is mixed");
});
