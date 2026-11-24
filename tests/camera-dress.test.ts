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
import { CAMERA_LOOKS, cameraLookOf, dressFilter, filterPath, handheld } from "../app/lib/camera-dress.ts";

const FONT = "C:/fonts/Poppins-Bold.ttf";
const count = (s: string, sub: string) => s.split(sub).length - 1;

test("three cameras, and which one is the maker's pick", () => {
  assert.deepEqual(CAMERA_LOOKS.map((l) => l.key), ["phone", "camcorder", "bare"]);
  for (const l of CAMERA_LOOKS) assert.ok(l.name && l.line.length <= 60, l.key);
  assert.equal(cameraLookOf("phone"), "phone");
  assert.equal(cameraLookOf(" Camcorder "), "camcorder");
  assert.equal(cameraLookOf("bare"), "bare");
  for (const v of [undefined, null, "", "iphone", "vhs", 1]) assert.equal(cameraLookOf(v), null, String(v));
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
