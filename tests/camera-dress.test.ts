/* THE CAMERA A FOUND-FOOTAGE TAKE WAS "SHOT ON" — app/lib/camera-dress.ts.
 *
 * The owner, 2026-11-24: "For the found footage style there needs to be a crystal clear iPhone recording
 * overlay ( phone layout 9:16) and for the wider that could be cam corder style, or maybe it's selectable,
 * with no actual overlay + found footage would need some slight shake to make it appear real, or graininess".
 * Then, with a screenshot of his phone's real camera screen beside the first version: "for reference here is
 * the real iPhone video overlay and what ours currently looks like".
 *
 * The looks themselves were LOOKED at on a real take, frame by frame; what is held here is what the graphs
 * must keep saying: three cameras, a hand that sways and never shows the frame's edge, and a phone screen laid
 * out the way a real one is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BODYCAM_MARK, CAMERA_LOOKS, CAM_DAYS, camDate, cameraLookOf, clockAt, clockExpr, clockText, dressFilter, filterPath, handheld, timeLapseOf } from "../app/lib/camera-dress.ts";

const FONT = "C:/fonts/Poppins-Bold.ttf";
const MONO = "C:/fonts/JetBrainsMono-Regular.ttf";
const count = (s: string, sub: string) => s.split(sub).length - 1;

test("five cameras, and which one is the maker's pick", () => {
  assert.deepEqual(CAMERA_LOOKS.map((l) => l.key), ["phone", "camcorder", "bare", "house", "bodycam"]);
  for (const l of CAMERA_LOOKS) assert.ok(l.name && l.line.length <= 60, l.key);
  assert.equal(cameraLookOf("phone"), "phone");
  assert.equal(cameraLookOf(" Camcorder "), "camcorder");
  assert.equal(cameraLookOf("bare"), "bare");
  assert.equal(cameraLookOf("HOUSE"), "house");
  assert.equal(cameraLookOf("bodycam"), "bodycam");
  for (const v of [undefined, null, "", "iphone", "vhs", "cctv", "body cam", 1]) assert.equal(cameraLookOf(v), null, String(v));
});

test("THE BODY CAM (\"What about body cam footage\"): worn on a chest — it bobs with each step; its date, time and number top-right; no maker's mark", () => {
  const d = dressFilter({ look: "bodycam", w: 1904, h: 1088, font: FONT, fontMono: MONO, clock: { date: "2026-11-24", start: 3 * 3600 + 12 * 60 + 44 } });
  // the chest: the picture enlarged and moved inside its margin, dropping and rising twice a stride
  assert.ok(d.filter.startsWith("[0:v]scale=2038:1164:flags=bicubic,rotate=a='0.006*sin(2*PI*0.925*t+0.4)':fillcolor=black,crop=1904:1088:"));
  assert.ok(d.filter.includes("abs(sin(PI*1.85*t))"), "a step's drop and rise");
  // its sensor: over-sharpened, a little washed, noisy; thirty frames a second
  assert.ok(d.filter.includes("unsharp=5:5:0.9:5:5:0") && d.filter.includes("noise=alls=10:allf=t") && d.filter.includes("fps=30"));
  // top-right: the date, a T, the time counting, the zone — and under it the camera's own number
  assert.ok(d.filter.includes(`:x=w-tw-42:y=42:text='2026-11-24 T%{eif\\:mod(floor((11564+t)/3600),24)\\:d\\:2}\\:`) && d.filter.includes(" -0500'"));
  assert.ok(d.filter.includes(":expansion=none:text='BODYCAM 412'"));
  assert.ok(dressFilter({ look: "bodycam", w: 1280, h: 720, font: FONT, camName: "UNIT 12: x" }).filter.includes("text='UNIT 12 x'"));
  // a generic camera: no real maker's name is ever drawn
  assert.ok(!/axon|motorola|watchguard|getac/i.test(d.filter));
  // …and EVERY body-cam piece says what it is, small, bottom-left (realistic police footage that is not real
  // must never pass for real — the owner asked for traffic stops and arrests too)
  assert.equal(BODYCAM_MARK, "AI DRAMATIZATION");
  assert.ok(d.filter.includes(":fontcolor=white@0.72:x=42:y=h-th-42:expansion=none:text='AI DRAMATIZATION'"));
  assert.ok(dressFilter({ look: "bodycam", w: 1280, h: 720, font: FONT, camName: "UNIT 7" }).filter.includes("text='AI DRAMATIZATION'"), "with any camera name");
  // its microphone: close, thin, a little crunchy
  assert.equal(d.audio, "highpass=f=220,lowpass=f=6000,acompressor=threshold=-22dB:ratio=4:attack=5:release=120");
  assert.ok(!d.audioInGraph && !d.chrome && d.filter.endsWith("format=yuv420p[v]"));
});

test("THE HOUSE CAMERA (\"Found footage from house camera POVs also\" — \"Like this overlay\"): fixed, its clock burned into the top-left corner, counting", () => {
  const d = dressFilter({ look: "house", w: 1280, h: 720, font: FONT, fontMono: MONO, clock: { date: camDate(2026, 11, 16), start: 3 * 3600 + 12 * 60 } });
  // nobody holds it: no sway, no turn, nothing enlarged and slid about
  assert.ok(!/rotate=|scale=\d+:\d+:flags=bicubic|crop=/.test(d.filter), "no hand");
  // the camera's own picture: a little soft and noisy, its own stepped frame rate
  assert.ok(d.filter.startsWith("[0:v]gblur=sigma=") && d.filter.includes("noise=alls=7:allf=t") && d.filter.includes("fps=15"));
  assert.ok(d.filter.endsWith("format=yuv420p[v]") && d.audio === null && !d.audioInGraph && !d.chrome);
  // THE CLOCK, as the owner's reference shows it: the date, the weekday and the time — white, with a dark edge —
  // in the top-left corner, sized from the frame (3.1% of its width) and drawn in the fixed-width face
  assert.ok(d.filter.includes(`drawtext=fontfile='${filterPath(MONO)}':fontcolor=white:borderw=3:bordercolor=0x101010:fontsize=40:x=24:y=28:text='2026-11-16 MON %{eif\\:mod(floor((11520+t)/3600),24)\\:d\\:2}\\:%{eif\\:mod(floor((11520+t)/60),60)\\:d\\:2}\\:%{eif\\:mod(floor((11520+t)),60)\\:d\\:2}'`), d.filter);
  // its own night: infrared grey when asked
  assert.ok(dressFilter({ look: "house", w: 1280, h: 720, font: FONT, ir: true }).filter.includes("hue=s=0"));
  assert.ok(!d.filter.includes("hue=s=0"));
  // a camera's name in the other corner, when there is more than one camera — read as plain text
  const named = dressFilter({ look: "house", w: 1280, h: 720, font: FONT, camName: "CAM 2: it's" }).filter;
  assert.ok(named.includes(":x=24:y=h-th-28:expansion=none:text='CAM 2 its'"));
  // without a monospaced face it falls back to the one it has
  assert.ok(dressFilter({ look: "house", w: 1280, h: 720, font: FONT }).filter.includes(`fontfile='${filterPath(FONT)}'`));
  // (looked at on a real picture: "2026-11-16 MON 03:12:02" two seconds in — scratchpad t45/cam/clk-plain.png)
  assert.equal(clockText(clockAt({ date: "", start: 3 * 3600 + 12 * 60 }, null, 2.4)), "03:12:02");
});

test("A TIME-LAPSE is a scene setting (\"hours go by on the counter in seconds\"): the first part played fast while the clock races, then real time — picture, clock and sound together", () => {
  const clock = { date: camDate(2026, 11, 16), start: 1 * 3600 + 4 * 60 + 10 };
  const lapse = { fast: 6, speed: 8, hours: 2.5 };
  const d = dressFilter({ look: "house", w: 1280, h: 720, font: FONT, clock, timelapse: lapse, seconds: 10 });
  // the picture: the first six seconds at eight times their speed, the rest as it was, joined
  assert.ok(d.filter.startsWith("[0:v]split=2[tl0][tl1];[tl0]trim=end=6,setpts=(PTS-STARTPTS)/8[tlf];[tl1]trim=start=6,setpts=PTS-STARTPTS[tlr];[tlf][tlr]concat=n=2:v=1:a=0,gblur="));
  // the sound: the fast part is silent (a camera's time-lapse has none), the rest is the take's own, in step
  assert.ok(d.audioInGraph && d.filter.endsWith(";[0:a]atrim=start=6,asetpts=PTS-STARTPTS,adelay=750|750,apad=pad_dur=0.1[a]"));
  // the clock: 2½ hours pass in the ¾ second the fast part lasts once it is fast, then it runs at real time
  assert.equal(clockExpr(clock, lapse), "(3850+if(lt(t,0.7500),t*12000.000,9000.000+t-0.7500))");
  // (read off the real frames of a dressed test clip — scratchpad t45/cam/clk-stack.png:
  //  01:04:10 · 02:10:50 · 03:04:10 · 03:34:10 · 03:34:10 · 03:34:10 · 03:34:12)
  const at = (t: number) => clockText(clockAt(clock, lapse, t));
  //  (the camera's frames are 1/15 s apart: the second one read was at 1/3 s)
  assert.deepEqual([0, 1 / 3, 0.6, 0.75, 0.8, 1.5, 3].map(at), ["01:04:10", "02:10:50", "03:04:10", "03:34:10", "03:34:10", "03:34:10", "03:34:12"]);
  // a time-lapse is only played when there is take enough for both parts, and within sane bounds
  assert.equal(timeLapseOf({ fast: 9, speed: 4, hours: 2 }, 10), null, "less than two seconds of real time left");
  assert.equal(timeLapseOf({ fast: 0.5, speed: 4, hours: 2 }, 10), null, "less than a second played fast");
  assert.equal(timeLapseOf(null, 10), null);
  assert.deepEqual(timeLapseOf({ fast: 9, speed: 99, hours: 40 }, 15), { fast: 9, speed: 24, hours: 12 });
  assert.deepEqual(timeLapseOf({ fast: 9 }, 15), { fast: 9, speed: 8, hours: 2 });
  // a setting that cannot be played leaves the take at real time (the clock simply counts)
  assert.ok(!dressFilter({ look: "house", w: 1280, h: 720, font: FONT, timelapse: { fast: 9, speed: 4, hours: 2 }, seconds: 10 }).audioInGraph);
  // THE HOURS CAN GO BY IN THE MIDDLE (the owner: "he needs to walk into the room no time lapse, then time
  // lapse, it appeared that he just spawned in"): real time, then the fast part, then real time again
  const mid = { from: 3, fast: 4, speed: 4, hours: 2 };
  const m = dressFilter({ look: "house", w: 1280, h: 720, font: FONT, clock: { date: "2026-11-16 MON", start: 3600 }, timelapse: mid, seconds: 10 });
  assert.ok(m.audioInGraph && m.filter.startsWith("[0:v]split=3[tl0][tl1][tl2];[tl0]trim=end=3,setpts=PTS-STARTPTS[tla];[tl1]trim=start=3:end=7,setpts=(PTS-STARTPTS)/4[tlf];[tl2]trim=start=7,setpts=PTS-STARTPTS[tlr];[tla][tlf][tlr]concat=n=3:v=1:a=0,"));
  // its sound: real, then the silence the fast part lasts, then real — one stream, in step with the picture
  assert.ok(m.filter.includes(";[sa]atrim=end=3,asetpts=PTS-STARTPTS[a1];anullsrc=r=48000:cl=stereo,atrim=duration=1.0000,") && m.filter.endsWith(";[sb]atrim=start=7,asetpts=PTS-STARTPTS[a3];[a1][a2][a3]concat=n=3:v=0:a=1[a]"));
  // (read off a rendered test clip — 7.0 s long, as 3 + 4/4 + 3 — scratchpad t45/cam/mclk-stack.png:
  //  01:00:01 · 01:00:02 · racing · 03:00:03 · 03:00:03 · 03:00:05)
  const atMid = (t: number) => clockText(clockAt({ date: "", start: 3600 }, mid, t));
  assert.deepEqual([1, 2.9, 3.5, 3.9999, 4.2, 6.8].map(atMid), ["01:00:01", "01:00:02", "02:00:03", "03:00:02", "03:00:03", "03:00:05"]);
  assert.equal(clockExpr({ date: "", start: 3600 }, mid), "(3600+if(lt(t,3.0000),t,if(lt(t,4.0000),3.0000+(t-3.0000)*7200.000,7203.000+t-4.0000)))");
  // a window that does not fit the take is not played
  assert.equal(timeLapseOf({ from: 8, fast: 4, speed: 4, hours: 2 }, 10), null);
  assert.deepEqual(timeLapseOf({ from: 6, fast: 5, speed: 4, hours: 3 }, 15), { fast: 5, speed: 4, hours: 3, from: 6 });
  // a clock that runs past midnight starts the day again
  assert.equal(clockText(86400 + 61), "00:01:01");
  assert.equal(clockText(-1), "23:59:59");
  // the weekday is the date's own
  assert.equal(camDate(2026, 11, 16), "2026-11-16 MON");
  assert.equal(camDate(2026, 11, 24), "2026-11-24 TUE");
  assert.equal(CAM_DAYS.length, 7);
});

test("a path goes into a filter with its colon escaped", () => {
  assert.equal(filterPath("C:\\fonts\\A.ttf"), "C\\:/fonts/A.ttf");
  assert.equal(filterPath("/app/public/fonts/A.ttf"), "/app/public/fonts/A.ttf");
});

test("the hand: the picture is enlarged, turned and slid inside the margin — the frame's edge never shows", () => {
  const g = handheld(1088, 1904, 1);
  const m = /^scale=(\d+):(\d+):flags=bicubic,rotate=a='([\d.]+)\*\(/.exec(g);
  assert.ok(m, g.slice(0, 80));
  const [W, H, turn] = [Number(m![1]), Number(m![2]), Number(m![3])];
  assert.ok(W % 2 === 0 && H % 2 === 0);
  const margin = (W - 1088) / 2;                         // pixels spare on each side
  assert.ok(margin >= 30 && margin <= 40, `margin ${margin}`);
  // the slide uses part of the margin; the turn (at the corner, half a diagonal away) fits in what is left
  const slide = Number(/x='\(iw-ow\)\/2\+([\d.]+)\*/.exec(g)![1]);
  const corner = turn * 1.6 * Math.hypot(1088, 1904) / 2;
  assert.ok(slide + corner < margin, `slide ${slide} + turn ${corner.toFixed(1)} < margin ${margin}`);
  const slideY = Number(/:y='\(ih-oh\)\/2\+([\d.]+)\*\(sin\(2\*PI\*0\.27\*t\+0\.7\)\+0\.5\*sin\(2\*PI\*0\.97\*t\+2\.1\)\+0\.35\*sin\(2\*PI\*2\.61\*t\+1\.1\)\)\/1\.85'$/.exec(g)?.[1]);
  assert.ok(slideY > 0 && slideY + corner < (H - 1904) / 2, `the same holds top to bottom (${slideY})`);
  assert.ok(g.includes("crop=1088:1904:x="), "back to the frame's own size");
  // three sines an axis, none a multiple of another: the path does not repeat inside a take
  assert.ok(g.includes("sin(2*PI*0.31*t)+0.55*sin(2*PI*0.83*t+1.3)+0.3*sin(2*PI*2.17*t+0.4)"));
  // a steadier or a shakier hand, within bounds
  assert.ok(handheld(1088, 1904, 0).includes("rotate=a='0.0000*"));
  assert.equal(handheld(1088, 1904, 9), handheld(1088, 1904, 3));
});

test("no overlay: only the hand and the grain", () => {
  const d = dressFilter({ look: "bare", w: 1088, h: 1904, font: FONT });
  assert.ok(d.filter.startsWith("[0:v]scale=") && d.filter.endsWith("format=yuv420p[v]"));
  assert.ok(d.filter.includes("noise=alls=9:allf=t"));
  assert.ok(!d.filter.includes("drawtext") && !d.filter.includes("drawbox") && !d.chrome && d.audio === null);
});

test("a camcorder: REC and its blinking dot, the battery, the counter, the date; soft, grainy, slipping colour", () => {
  const d = dressFilter({ look: "camcorder", w: 1920, h: 1080, font: FONT, stamp: { date: "OCT 31 1999", time: "11:58 PM" } });
  for (const mark of ["text='REC'", "text='OCT 31 1999'", "text='11\\:58 PM'", "text='SP  %{pts\\:gmtime\\:0\\:%H\\\\\\:%M\\\\\\:%S}'"]) assert.ok(d.filter.includes(mark), mark);
  assert.ok(d.filter.includes("enable='lt(mod(t,1.2),0.7)'"), "the dot is on for 0.7 s of every 1.2");
  for (const tape of ["gblur=sigma=", "chromashift=cbh=", "noise=alls=15:allf=t", "drawgrid=w=iw:h=", "vignette=PI/5", "eq=saturation=0.82"]) assert.ok(d.filter.includes(tape), tape);
  assert.ok(d.filter.includes(`fontfile='${filterPath(FONT)}'`));
  // a small built-in microphone
  assert.ok(d.audio && d.audio.startsWith("highpass=f=170,lowpass=f=6800"));
  assert.ok(!d.chrome);
  // with no stamp given it still burns one in
  assert.ok(dressFilter({ look: "camcorder", w: 1920, h: 1080, font: FONT }).filter.includes("text='NOV 24 2026'"));
});

test("a phone: the screen of a real one, recording — bands, pills, bare zoom numbers, ring and square, thumbnail, VIDEO | PHOTO", () => {
  const w = 1088, h = 1904;
  const d = dressFilter({ look: "phone", w, h, font: FONT, fontThin: "C:/fonts/Thin.ttf", fontMono: "C:/fonts/Mono.ttf" });
  // THE CHROME: every shape that does not move, drawn once on a clear frame, written to [c]
  assert.ok(d.chrome && d.chrome.startsWith(`color=c=black@0:s=${w}x${h}:r=1:d=1,format=rgba[c0]`) && d.chrome.endsWith("null[c]"));
  assert.equal(count(d.chrome!, "overlay=x="), 13, "two pills, bolt, grid, time pill, zoom dot, ring, square, mode pill, its chosen half, flip button, flip mark, the green light");
  assert.ok(!d.chrome!.includes("drawtext"), "words are drawn in the main pass, on the picture");
  assert.ok(!d.chrome!.includes(":r=30,"), "one still frame, not a stream");
  // THE PICTURE sits between a band above and a taller band below
  const pad = /crop=1088:(\d+):0:(\d+),pad=1088:1904:0:(\d+):black/.exec(d.filter);
  assert.ok(pad, "cropped to the viewfinder and padded back to the frame");
  const [vh, cy, top] = [Number(pad![1]), Number(pad![2]), Number(pad![3])];
  const bottom = h - top - vh;
  assert.ok(top % 2 === 0 && vh % 2 === 0 && top > 100 && bottom > top, `bands ${top} / ${bottom}`);
  assert.ok(cy > 0 && cy < (h - vh) / 2, "the picture gives up more of its foot than of its head");
  // the chrome is the second input; the last shot's thumbnail is this take's own first frame, in a circle
  assert.ok(d.filter.includes("[base][1:v]overlay=0:0:format=auto[a1]"));
  assert.ok(d.filter.includes("[shot]select='eq(n,0)',scale=") && d.filter.includes("loop=loop=-1:size=1:start=0,setpts=N/FRAME_RATE/TB[thumb]"));
  // THE WORDS, as a phone sets them: labels in the light face, numbers in the fixed-width one
  const thin = `fontfile='${filterPath("C:/fonts/Thin.ttf")}'`, mono = `fontfile='${filterPath("C:/fonts/Mono.ttf")}'`;
  for (const label of ["HD", "RES", "30", "FPS", "VIDEO", "PHOTO"]) assert.ok(d.filter.includes(`${thin}:text='${label}'`), label);
  for (const num of ["0.5", "1×", "2.5"]) assert.ok(d.filter.includes(`${mono}:text='${num}'`), num);
  assert.ok(d.filter.includes(`${mono}:text='%{pts\\:gmtime\\:0\\:%H\\\\\\:%M\\\\\\:%S}'`), "the time counts up");
  // the chosen zoom and the chosen mode are the phone's yellow
  assert.equal(count(d.filter, "fontcolor=0xFFD60A"), 2);
  // crystal clear: no grain on a phone
  assert.ok(!d.filter.includes("noise=") && d.filter.includes("unsharp=5:5:0.45"));
  assert.ok(d.filter.endsWith("format=yuv420p[v]") && d.audio === null);
  // with only the app's own face, every word still has a font
  const plain = dressFilter({ look: "phone", w, h, font: FONT });
  assert.equal(count(plain.filter, `fontfile='${filterPath(FONT)}'`), 10);
  // another size: everything is measured from the frame's width
  const small = dressFilter({ look: "phone", w: 720, h: 1280, font: FONT });
  assert.ok(small.chrome!.startsWith("color=c=black@0:s=720x1280") && /pad=720:1280:0:\d+:black/.test(small.filter));
});
