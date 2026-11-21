/* A FEATURED VERSE — another cast member sings part of the song, in their own voice.
 *
 * The owner, 2026-11-21: "need a feature thing also (another cast member sings that part of the song in
 * their voice like real music)".
 *
 * The song is one track. A second take of it is re-voiced as the co-star, and the two are cross-faded so
 * the co-star's take is heard for their verse; in their performance scenes it is the co-star on camera.
 * These pin the rules that make that watchable:
 *   - nobody is ever SEEN singing in somebody else's voice (the voice changes only between the two
 *     singers' performances, and in a breath between words);
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
  ARTIST, FEATURE_MIN_SECONDS,
  bestLag, defaultFeaturePlan, envelopeExpr, featureMixFilter, featureRoles, featuredIn, pitchChangeFor, planIsSound, vocalGaps, voiceWindows,
  type Gap,
} from "../app/lib/mv-feature.ts";
import { sceneCast, singerOf } from "../app/lib/mv-cast.ts";
import { SHOT_ROLES, defaultRole, sceneCountFor, shotSlot, type ShotRole } from "../app/lib/mv-pace.ts";

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
  // a CUT SCENE in her verse has no singer on camera: the artist's shot as always, her voice over it
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

test("the voice changes between the two singers' performances, in a breath — never over a singer's shot", () => {
  // 30 seconds fast: cut, PERFORM (artist), cut, PERFORM (co-star), cut (co-star), cut
  const roles: ShotRole[] = [B, P, B, P, B, B];
  const singers = [ARTIST, ARTIST, ARTIST, 0, 0, ARTIST];
  const gaps = breaths(0.7, 30, 2.3); // 0.7, 3.0, 5.3, 7.6, 9.9, 12.2, 14.5, 16.8, 19.1, 21.4, 23.7, 26.0, 28.3
  const w = voiceWindows({ singers, roles, D: 5, gaps });
  assert.equal(w.length, 1);
  assert.equal(w[0].who, 0);
  // IN: after the artist's performance ends (10s), before the co-star's begins (15s), at the breath
  // nearest to where the scenes change — 14.5
  assert.ok(Math.abs(w[0].start - 14.5) < 1e-9, `in at ${w[0].start}`);
  assert.ok(w[0].start >= 10 && w[0].start <= 15);
  // OUT: after the co-star's performance ends (20s), at the breath nearest the end of their verse (25s)
  assert.ok(Math.abs(w[0].end - 26.0) < 1e-9 || Math.abs(w[0].end - 23.7) < 1e-9, `out at ${w[0].end}`);
  assert.ok(w[0].end >= 20);
  // their whole performance is inside their voice
  assert.ok(w[0].start <= 15 && w[0].end >= 20);

  // every length and pace, the verse dealt by rule: nobody is ever SEEN singing in another's voice
  for (const s of [20, 30, 60, 90, 120]) for (const sec of [5, 10]) {
    const n = sceneCountFor(s, sec);
    const r = featureRoles(cadence(n, sec));
    for (const feat of [[0], [0, 1]]) {
      const plan = defaultFeaturePlan(r, sec, feat);
      for (const every of [0, 1.7, 2.3, 4.1]) {
        const g = every ? breaths(0.4, s, every) : [];
        const wins = voiceWindows({ singers: plan, roles: r, D: sec, gaps: g });
        const voiceAt = (t: number): number => { const hit = wins.find((x) => t >= x.start && t < x.end); return hit ? hit.who : ARTIST; };
        r.forEach((role, i) => {
          if (role !== P) return;
          // sample the scene: the voice heard is the voice of whoever is on camera. (Two singers'
          // performances BACK TO BACK — only the 20-second video of two ten-second scenes — have no cut
          // scene to change in: there the voice may change at a breath up to 0.75s either side of the cut.)
          const tight = (j: number) => j >= 0 && j < r.length && r[j] === P && plan[j] !== plan[i];
          const from = i * sec + (tight(i - 1) ? 0.76 : 0.02), to = (i + 1) * sec - (tight(i + 1) ? 0.76 : 0.02);
          for (let k = 0; k <= 10; k++) { const t = from + (k / 10) * (to - from); assert.equal(voiceAt(t), plan[i], `${s}s/${sec}s feat=${feat} every=${every}: scene ${i} at ${t.toFixed(2)}s`); }
        });
        // the stretches are in order, never overlap, and stay inside the song
        wins.forEach((x, k) => { assert.ok(x.start >= 0 && x.end <= s + 1e-9 && x.end - x.start > 0.25); if (k) assert.ok(x.start >= wins[k - 1].end - 1e-9); });
        // every featured co-star who has a scene is heard
        for (const who of featuredIn(plan)) assert.ok(wins.some((x) => x.who === who), `${s}s/${sec}s: co-star ${who} has a verse and no voice`);
      }
    }
  }
});

test("with no breath to be found the voice changes exactly where the scenes do", () => {
  const roles: ShotRole[] = [P, B, P, B];
  const w = voiceWindows({ singers: [ARTIST, ARTIST, 0, 0], roles, D: 5 });
  assert.deepEqual(w, [{ who: 0, start: 10, end: 20 }]);
  // two performances back to back (a 20-second video of ten-second scenes): a breath just either side
  const tight = voiceWindows({ singers: [ARTIST, 0], roles: [P, P], D: 10, gaps: [{ t: 9.6, gap: 0.5 }, { t: 13, gap: 0.5 }] });
  assert.deepEqual(tight, [{ who: 0, start: 9.6, end: 20 }]);
  assert.deepEqual(voiceWindows({ singers: [ARTIST, 0], roles: [P, P], D: 10, gaps: [{ t: 6, gap: 0.5 }, { t: 14, gap: 0.5 }] }), [{ who: 0, start: 10, end: 20 }], "no breath near enough: on the scene");
  // nobody featured → nothing to mix; everybody's the co-star's → the whole song
  assert.deepEqual(voiceWindows({ singers: [ARTIST, ARTIST], roles: [P, B], D: 10 }), []);
  assert.deepEqual(voiceWindows({ singers: [1, 1], roles: [P, B], D: 10 }), [{ who: 1, start: 0, end: 20 }]);
  assert.deepEqual(voiceWindows({ singers: [], roles: [], D: 10 }), []);
  // two co-stars, one after the other
  const two = voiceWindows({ singers: [ARTIST, ARTIST, 0, 0, 1, 1, ARTIST, ARTIST], roles: [B, P, B, P, B, B, P, B].map((x, i) => (i === 4 ? P : x)) as ShotRole[], D: 5 });
  assert.deepEqual(two.map((x) => x.who), [0, 1]);
  assert.ok(two[0].end <= two[1].start + 1e-9);
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
  assert.deepEqual(defaultFeaturePlan([P, B, P, B], 5, [0]), [ARTIST, ARTIST, 0, 0]);
  // 30 seconds fast: the co-star takes the second performance and the cut scene after it
  assert.deepEqual(defaultFeaturePlan(cadence(6, 5), 5, [0]), [ARTIST, ARTIST, ARTIST, 0, 0, ARTIST]);
  // two co-stars each get a performance of their own when there are enough
  const p8 = defaultFeaturePlan(cadence(8, 5), 5, [0, 1]);
  assert.deepEqual(p8, [ARTIST, ARTIST, ARTIST, 0, 0, ARTIST, 1, 1]);
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

test("a singer of the other sex is moved an octave — the vocal alone, so the song stays in key", () => {
  assert.equal(pitchChangeFor("m", "f"), "male-to-female");
  assert.equal(pitchChangeFor("f", "m"), "female-to-male");
  assert.equal(pitchChangeFor("m", "m"), "no-change");
  assert.equal(pitchChangeFor("f", "f"), "no-change");
  assert.equal(pitchChangeFor(undefined, "f"), "no-change", "not knowing is no reason to move anything");
  assert.equal(pitchChangeFor("m", undefined), "no-change");
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

test("the song writer gives the co-star a verse, and a verse nobody could be seen singing is dealt again", () => {
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
  assert.match(fn, /in EVERY scene of that verse set "singer" to their exact name/);
  assert.match(fn, /In their PERFORMANCE scene the VISUAL shows THEM singing to camera, on their own/);
  assert.match(fn, /the artist sings the FIRST performance/);
  assert.match(fn, /End the title with "\(feat\. \$\{featNames\}\)"/);
  // …and "only the artist ever sings" is still what every other video is told
  assert.match(fn, /WHO DOES WHAT — only the ARTIST ever sings\./);
  // the marks are kept only when they make a verse that can be filmed; else it is dealt by rule
  assert.match(fn, /if \(featured\.length && !\(planIsSound\(singers, outRoles\) && featIdx\.every\(\(k\) => singers\.includes\(k\)\)\)\) singers = defaultFeaturePlan\(outRoles, sceneSec, featIdx\);/);
  assert.match(fn, /\.\.\.\(featured\.length && singers\[i\] >= 0 \? \{ singer: castList\[singers\[i\]\] \} : \{\}\),/);
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
  assert.match(mix, /vocalGaps\(wordsFromWhisperx\(/);
  assert.match(mix, /const windows = voiceWindows\(\{ singers: o\.singers, roles: o\.roles, D: o\.D, gaps \}\);/);
  assert.match(mix, /const model = await ensureVoiceModel\(f\.voiceId, o\.base\);/);
  assert.match(mix, /coverSongInVoice\(songUrl, model\.url, \{ pitchChange: f\.pitch \}\)/);
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
  assert.match(ui, /const singable = castExtra\.filter\(\(m\) => !!voiceOfImg\(m\.img\) && !!\(m\.name \|\| ""\)\.trim\(\)\);/);
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
  // THE ACTION: a voice is a stock voice or one of this shop's own — never an id the page made up —
  // and the singer must be one of this video's co-stars
  const act = ui.slice(ui.indexOf("let filmFeatureVoices"), ui.indexOf("let filmFeatureVoices") + 900);
  assert.match(act, /filmCastExtra\.some\(\(m\) => nameTok\(m\.name\) === nameTok\(f\.name\)\)/);
  assert.match(act, /asked\.filter\(\(f\) => AVATAR_VOICE_IDS\.has\(f\.voiceId\) \|\| isCharacterVoice\(f\.voiceId\) \|\| mine\.has\(f\.voiceId\)\)/);
  assert.match(ui, /\.\.\.\(filmFeatureVoices\.length \? \{ filmFeatureVoices \} : \{\}\),/);
  // a scene that is still off after the check is flagged on the still itself
  assert.match(ui, /const flagged = isMv && !!seeds && \(\(seeds\.faults \|\| \[\]\)\[i\] \|\| 0\) > 0 && rerollingScene !== i;/);
  // a writer error no longer leaves the button stuck on "Building the scenes"
  assert.match(ui, /else if \(treatmentFetcher\.data\?\.error\) setChainToScenes\(false\);/);
  // the slots the page frames a scene with are the pipeline's
  for (let i = 0; i < 12; i++) assert.equal(SHOT_ROLES[shotSlot(P, i)], P);
});
