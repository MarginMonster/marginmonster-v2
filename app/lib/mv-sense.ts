/* DOES THE SHOT MAKE PHYSICAL SENSE — what the people in a music-video scene are really doing, and how a
 * camera could really film it.
 *
 * The owner, on the first featured-verse video (2026-11-22): "hyper unrealistic (walking in place in car,
 * car looking ai slop) … not getting a MUSIC VIDEO-esque vibe but we are close".
 *
 * What had happened, shot by shot:
 *   - the song was about a night drive, so the writer set its cut scenes in a convertible;
 *   - the shot list gives every cut scene a framing by its PLACE in the video, and those framings carried
 *     an ACTION — "all of them dancing", "them walking through the scene together" — whatever the scene
 *     was. Laid over a car scene, the picture model stood two people up in the back of a moving
 *     convertible, and in another put the artist on foot behind the car;
 *   - the video model was then told that same action and NOTHING about the scene ("…them walking through
 *     the scene together…" over a still of people in a car), so it walked them on the spot.
 *
 * So, here and in the callers:
 *   1. the ACTION comes from the scene's own words — the framing only says how it is framed, and the
 *      video model is told what is happening in the scene it is animating (momentLine);
 *   2. a scene of people RIDING IN A CAR is filmed the way a crew films one — from inside, close on the
 *      people in their seats (rideFrame), the artist and one other unless the maker asks for more
 *      (RIDE_MAX_COSTARS) — which also keeps the outside of a moving car, the thing the picture and
 *      video models draw worst, out of the shot; and a picture that comes back with black bars round it
 *      is made again (hasBars);
 *   3. both models are told the plain rule (SENSE_STILL / senseMotion): everybody does something a real
 *      person could be filmed doing there, and people in a vehicle sit in its seats;
 *   4. the writer is told the same before a scene is ever written (SENSE_RULES), and a cast picture that
 *      comes back with somebody doing the impossible is drawn again (mv-cast.ts — the check's "odd");
 *   5. UP HIGH (highScene): a later video opened on the artist strolling along the unrailed edge of a
 *      skyscraper roof and closed on the cast walking a glass floor hung over the city — pictures no crew
 *      would film. A rooftop has a wall or a railing and people stand back from it.
 *
 * Pure and import-free: the writer, the pipeline and the tests share it. */

const CAR = "(?:car|convertible|cabriolet|coupe|sedan|truck|pickup|suv|jeep|van|limo|limousine|taxi|cab|lowrider|roadster|hatchback|muscle car|sports car|mustang|cadillac|impala|camaro|corvette|bronco|bentley|g-?wagon)";
/** Words that put the people INSIDE a car. ("in the glow of the car's headlights" is not inside it: the
 *  words between "in the" and the car may not include "of" — except "in the back of a taxi".) */
const INSIDE = new RegExp(`\\b(?:behind the wheel|at the wheel|hands? on the wheel|steering wheel|driver'?s seat|passenger seat|back ?seat|front seat|riding shotgun|dashboard|windshield|rear-?view mirror|top (?:is )?down|windows? (?:rolled )?down|sunroof|(?:in|inside) (?:a|an|the|his|her|their|\\w+'s)(?: (?!of\\b)[\\w'-]+){0,3} ${CAR}|in the back of (?:a|an|the|his|her|their)(?: (?!of\\b)[\\w'-]+){0,3} ${CAR})\\b`, "i");
/** Words that have them going somewhere in it. ("drives by", "driving past" and "driving below" are
 *  somebody else's car.) */
const DRIVING = /\b(?:(?:driv(?:e|es|ing)|drove|cruis(?:e|es|ing)) (?!by\b|past\b|below\b|beneath\b|behind\b|in the (?:distance|background)\b)|(?:driv(?:e|es|ing)|drove|cruis(?:e|es|ing))[.,;]|(?:driv(?:e|es|ing)|drove|cruis(?:e|es|ing))$|rid(?:e|es|ing) (?:in|through|along|down|around|shotgun)|rolling (?:down|through)|speed(?:s|ing)? (?:down|through|along)|joyrid(?:e|ing)|road ?trip)/i;
/** Traffic: other people's cars going by — never the cast's ride. Taken out before the scene is read. */
const TRAFFIC = /\b(?:cars|traffic|taxis|cabs|trucks|buses|vehicles|motorbikes|bikes|headlights|tail ?lights)\b(?: \w+){0,2}? (?:driv\w+|cruis\w+|speed\w+|roll\w+|pass\w*|stream\w*|rush\w*|crawl\w*|flow\w*|fl(?:y|ies|ying)|slid\w+|blur\w*|streak\w*)\b[^.;]*/gi;
/** Words that say the car is standing still with the people OUTSIDE it — a scene on foot, however much
 *  car is in it. */
const BESIDE = /\b(?:parked|lean(?:s|ed|ing)? (?:on|against|back on|back against)|(?:sit(?:s|ting)?|perched|seated) on the (?:hood|bonnet|trunk|roof|tailgate)|on the (?:hood|bonnet)|(?:beside|next to|in front of|around|behind) (?:a|an|the|his|her|their)(?: [\w'-]+){0,4} (?:car|convertible|truck|pickup|suv|jeep|van|limo|lowrider|mustang|cadillac|impala|camaro|corvette)|(?:step|climb|get)(?:s|ping|bing|ting)? out)\b/i;

/** Is this a scene of people RIDING IN A CAR — in its seats, going somewhere? (Not a scene beside a
 *  parked one, and not traffic going by in the distance.) */
export function rideScene(visual: string | null | undefined): boolean {
  const v = (visual || "").replace(TRAFFIC, " ");
  if (!v.trim()) return false;
  if (BESIDE.test(v)) return false;
  if (INSIDE.test(v)) return true;
  // "driving" alone is somebody in a car only when a car, a road or a wheel is in the scene too
  return DRIVING.test(v) && new RegExp(`\\b(?:${CAR}|road|street|avenue|boulevard|highway|freeway|strip|city|town|downtown|coast|tunnel|bridge|night|lights?)\\b`, "i").test(v);
}

/** Does a car (or truck…) appear in the scene at all — riding in it or standing by it? */
export function carInScene(visual: string | null | undefined): boolean {
  return new RegExp(`\\b${CAR}s?\\b`, "i").test(visual || "") || rideScene(visual);
}

/** Is the scene set UP HIGH, where there is an edge to fall off — a rooftop, a terrace, a balcony, a
 *  skywalk? (A skyline or a skyscraper in the distance is only a backdrop.) */
export function highScene(visual: string | null | undefined): boolean {
  return /\b(?:roof(?:top|line)?s?|ledge|parapet|penthouse|terrace|balcony|helipad|sky[ -]?(?:walk|bridge|deck)|observation deck|glass (?:floor|bridge|walkway)|cliff(?:top|side)?|high above|above the (?:city|street|skyline))\b/i.test(visual || "");
}

/** How many co-stars ride beside the artist unless the maker picks more. Drawn on the real picture model
 *  (2026-11-22): the artist and ONE other in the front seats came out right every time; three people in a
 *  car came back with somebody twice, or a fourth person, in four tries of six. */
export const RIDE_MAX_COSTARS = 1;

/** The picture must fill its frame. A car interior is a WIDE picture, and asked for it upright the
 *  picture model handed back a wide one with black bars above and below three times in twelve. */
export const FILL_FRAME = "The picture fills the whole frame edge to edge — no black bars";

/** HOW A RIDE IS FRAMED, in place of the shot list's framing for that scene: from inside the car, close
 *  on the people in their seats. `costars` = how many are in the shot beside the artist; `performing` =
 *  the lead sings to camera in it.
 *  (Said as WHERE THE CAMERA IS: told only "shot from inside the car", the picture model stood the
 *  camera out over the bonnet — half an upright frame of bonnet — and gave two people a steering wheel.) */
export function rideFrame(o: { costars: number; performing: boolean }): string {
  if (o.costars > 0) {
    const seats = `the artist driving${o.performing ? ", facing the camera and singing" : ""}, ${o.costars > 1 ? "one person in the passenger seat, the third in the back seat between them" : "the other person in the passenger seat"}`;
    return `INTERIOR car shot, the camera on the dashboard facing back at the people in their seats: ${seats}; heads and shoulders fill the frame${o.performing ? "" : ", nobody looking at the camera"}. ONE steering wheel, the artist's. No windshield or bonnet in the shot. ${FILL_FRAME}`;
  }
  return o.performing
    ? `an INTERIOR car shot with the camera on the dashboard, facing back at the artist in the driver's seat — head and shoulders, facing the camera, lights streaking past the windows behind; the windshield and bonnet are behind the camera, not in the shot. ${FILL_FRAME}`
    : `a close shot from the PASSENGER SEAT of the car — the artist in the driver's seat in three-quarter profile, head and shoulders, hands on the one steering wheel, eyes on the road, lights streaking past the window behind; no bonnet in the shot. ${FILL_FRAME}`;
}
/** …and how the camera moves in one. */
export const RIDE_CAM = "a gentle handheld drift, as if filmed from the next seat";

/** The rule a STILL is given (short — the picture calls read a limited length). */
export function senseStill(visual: string | null | undefined): string {
  if (rideScene(visual)) return "Everyone SITS — nobody stands in or on the car.";
  if (carInScene(visual)) return "The car is a real production model with true proportions, wheels on the ground; nobody stands or walks on it.";
  if (highScene(visual)) return "Everyone is on solid floor, well back from the edge, with a wall or railing at the edge — nobody on a ledge or on glass over a drop.";
  return "";
}

/** The rule the VIDEO model is given for the people in a shot. */
export function senseMotion(visual: string | null | undefined): string {
  return rideScene(visual)
    ? " They are riding in a moving car: everyone STAYS SEATED the whole shot — heads nod to the music, hair moves in the breeze, lights sweep across their faces, the city slides past outside. Nobody stands up, climbs, walks or dances, and whoever drives keeps their hands on the wheel."
    : ` Everyone moves the way real people would in this exact place — natural, physically possible motion. Nobody walks or steps on the spot, nobody floats or slides, and nobody stands in or on a vehicle.${highScene(visual) ? " Nobody goes to the edge or climbs anything." : ""}`;
}

/** Did a picture come back LETTERBOXED — a wide picture with bars above and below it (or an upright one
 *  with bars either side)? `gray` is the picture as w×h brightness values (0–255), small (48×48 is
 *  plenty). Two kinds of bar are known, and both are a PAIR, edge to edge, with a real picture between:
 *   · pure black (a night sky is dark but never one flat black from corner to corner);
 *   · one flat shade that is NOT black — a storyboard still came back with grey-brown bands top and
 *     bottom (75 and 86 of 255, each within 3 along its whole length, 10 % of the height each) and went
 *     through as a good picture, 2026-11-22. */
export function hasBars(gray: ArrayLike<number>, w: number, h: number): boolean {
  if (!(w >= 16 && h >= 16) || gray.length < w * h) return false;
  // (the bars on the real pictures measured 0–7 of 255, flat; the darkest real edge — a night sky — 5–15)
  const BLACK = 12, band = (n: number) => Math.max(2, Math.round(n * 0.06));
  const flat = (x0: number, x1: number, y0: number, y1: number): boolean => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (gray[y * w + x] > BLACK) return false;
    return true;
  };
  const mean = (x0: number, x1: number, y0: number, y1: number): number => {
    let s = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += gray[y * w + x]; n++; }
    return n ? s / n : 0;
  };
  const lit = mean(Math.round(w * 0.25), Math.round(w * 0.75), Math.round(h * 0.4), Math.round(h * 0.6)) > 18;
  if (!lit) return false;
  const bh = band(h), bw = band(w);
  if ((flat(0, w, 0, bh) && flat(0, w, h - bh, h)) || (flat(0, bw, 0, h) && flat(w - bw, w, 0, h))) return true;

  // FLAT BANDS OF ANY SHADE. One line of the picture (a row, or a column when `upright`): its mean, and
  // how far it varies along its length. A bar is a run of lines in from an edge that are each one shade
  // along their whole length and all the same shade as the first — and where it ends, the picture starts:
  // within two lines something varies or is plainly another shade. A clear sky drifts from line to line;
  // a road or a floor has texture; neither is flat BOTH ways, on BOTH sides, to the same depth.
  const FLAT = 4, DRIFT = 4, EDGE = 12;
  const line = (i: number, upright: boolean): { mean: number; range: number } => {
    let mn = 255, mx = 0, s = 0;
    const n = upright ? h : w;
    for (let k = 0; k < n; k++) { const v = upright ? gray[k * w + i] : gray[i * w + k]; if (v < mn) mn = v; if (v > mx) mx = v; s += v; }
    return { mean: s / n, range: mx - mn };
  };
  const run = (count: number, at: (k: number) => { mean: number; range: number }): { lines: number; edge: boolean } => {
    const first = at(0);
    if (first.range > FLAT) return { lines: 0, edge: false };
    let k = 1;
    while (k < count && at(k).range <= FLAT && Math.abs(at(k).mean - first.mean) <= DRIFT) k++;
    let edge = false;
    for (let j = k; j < Math.min(count, k + 2); j++) { const l = at(j); if (l.range >= EDGE || Math.abs(l.mean - first.mean) >= EDGE) edge = true; }
    return { lines: k, edge };
  };
  const pair = (count: number, upright: boolean): boolean => {
    const a = run(count, (k) => line(k, upright)), b = run(count, (k) => line(count - 1 - k, upright));
    const least = band(count);
    if (a.lines < least || b.lines < least || !a.edge || !b.edge) return false;
    if (a.lines + b.lines > count * 0.4) return false; // most of the picture one shade is not a picture with bars
    return Math.abs(a.lines - b.lines) <= Math.max(2, 0.4 * Math.max(a.lines, b.lines)); // a matching pair
  };
  return pair(h, false) || pair(w, true);
}

/** WHAT IS HAPPENING in the scene, for the video model: the scene's own words, cut at a word. (It used
 *  to be told only the shot list's framing — an action that belonged to the slot, not to the scene.) */
export function momentLine(visual: string | null | undefined, max = 240): string {
  const t = (visual || "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  if (!t) return "";
  let cut = t;
  if (t.length > max) {
    const head = t.slice(0, max + 1);
    const at = head.lastIndexOf(" ");
    cut = (at > max * 0.6 ? head.slice(0, at) : t.slice(0, max)).replace(/[\s,;:.—–-]+$/, "");
  }
  return ` What is happening: ${cut}.`;
}

/** ONE TIME OF DAY, said in every scene.
 *
 *  The writer is told to keep one world — the same time of day in every scene, "said in each VISUAL" — and
 *  mostly does, then leaves it out of one: "OMAR leans back against the Mustang under warm city lights …
 *  all taking in the glowing skyline" was drawn at SUNSET in a video that is night everywhere else (a
 *  re-roll on a live storyboard, 2026-11-22). Each picture is made on its own, from its own words; so the
 *  time the video is set at is written into any scene that does not say one. A scene that names ANOTHER
 *  time is left alone — that is the writer's choice, or the maker's. */
export type DayTime = "night" | "dusk" | "dawn" | "day";
const TIME_WORDS: Array<[DayTime, RegExp]> = [
  ["night", /\b(?:night|nights|nighttime|night-time|midnight|moonlit|moonlight|after dark)\b/i],
  ["dusk", /\b(?:dusk|sunset|sundown|twilight|golden hour|blue hour)\b/i],
  ["dawn", /\b(?:dawn|sunrise|daybreak|first light)\b/i],
  ["day", /\b(?:daylight|daytime|midday|noon|afternoon|morning|sunlit|sunny|sunshine)\b/i],
];
const TIME_PHRASE: Record<DayTime, string> = { night: "at night", dusk: "at dusk", dawn: "at dawn", day: "in daylight" };

/** The time of day a scene's words say — the first one they name — or null when they name none.
 *  ("tonight" in a lyric and a "nightclub" are not a time of day; "night-lit" and "midnight" are.) */
export function timeOf(visual: string | null | undefined): DayTime | null {
  let best: { time: DayTime; at: number } | null = null;
  for (const [time, re] of TIME_WORDS) { const m = re.exec(visual || ""); if (m && (!best || m.index < best.at)) best = { time, at: m.index }; }
  return best ? best.time : null;
}

/** Every scene's words, each saying the video's time of day: the one most scenes name (a tie goes to the
 *  one named first). `max` = the most a scene's words may run to — one that has no room is left as it is. */
export function sameTime(visuals: string[], max = 400): string[] {
  const said = visuals.map(timeOf);
  const count = new Map<DayTime, number>();
  for (const t of said) if (t) count.set(t, (count.get(t) || 0) + 1);
  let video: DayTime | null = null;
  for (const t of said) if (t && (!video || (count.get(t) || 0) > (count.get(video) || 0))) video = t;
  if (!video) return visuals.slice();
  const phrase = TIME_PHRASE[video];
  return visuals.map((v, i) => {
    const text = (v || "").replace(/\s+/g, " ").trim();
    if (!text || said[i]) return v;
    const end = /[.!?]$/.test(text) ? text.slice(-1) : ".";
    const out = `${text.replace(/[.!?,;:\s]+$/, "")}, ${phrase}${end}`;
    return out.length <= max ? out : v;
  });
}

/** ONE CAR, described the same way in every scene it is in.
 *
 *  The writer is told to (SENSE_RULES) and mostly does — then shortens it: "a parked black 1969 Mustang
 *  convertible" in scenes 1 and 5, "the Mustang convertible" in scene 6, which was drawn RED (the first
 *  storyboard written under the rules, 2026-11-22). Each scene's picture is made on its own, from its own
 *  words, so the words have to carry the car: the fullest description found in the scenes is put wherever
 *  the same car is named in fewer words ("the Mustang", "the car"). A different vehicle — a taxi, when
 *  the car is a Mustang — is left alone, and so are scenes with no car in them. */
export function sameCar(visuals: string[]): string[] {
  const NOUN = "(?:car|convertible|cabriolet|coupe|sedan|truck|pickup|suv|jeep|van|limo|limousine|taxi|cab|lowrider|roadster|hatchback|mustang|cadillac|impala|camaro|corvette|bronco|bentley)";
  // (a describing word is never a joining one: "the glow of his black car" is not a car called "glow of his black")
  const WORD = "(?!(?:of|in|on|at|and|or|with|near|by|to|from|into|onto|beside|behind|against|toward|towards|a|an|the|his|her|their|its)\\b)[\\w'-]+";
  const find = () => new RegExp(`\\b(a|an|the|his|her|their)\\s+((?:${WORD}\\s+){0,4}?)(${NOUN}(?:\\s+${NOUN})?)\\b(?!s\\b)`, "gi");
  const STATE = /^(?:parked|waiting|idling|gleaming|shining|glowing|open|open-top|polished)$/i;
  type Hit = { desc: string[]; nouns: string[] };
  const read = (m: RegExpExecArray): Hit => ({ desc: m[2].trim().split(/\s+/).filter(Boolean).filter((w) => !STATE.test(w)), nouns: m[3].trim().split(/\s+/) });
  let best: Hit | null = null;
  for (const v of visuals) {
    const re = find();
    for (let m = re.exec(v || ""); m; m = re.exec(v || "")) {
      const h = read(m);
      if (h.desc.length && (!best || h.desc.length + h.nouns.length > best.desc.length + best.nouns.length)) best = h;
    }
  }
  if (!best) return visuals.slice();
  const car = best;
  const full = [...car.desc, ...car.nouns].join(" ");
  const mine = new Set([...car.nouns.map((n) => n.toLowerCase()), "car"]);
  return visuals.map((v) => (v || "").replace(find(), (whole: string, art: string, desc: string, nouns: string) => {
    const words = nouns.trim().split(/\s+/);
    if (!words.every((w) => mine.has(w.toLowerCase()))) return whole;               // another vehicle
    const d = desc.trim().split(/\s+/).filter(Boolean);
    const said = [...d.filter((w) => !STATE.test(w)), ...words].join(" ");
    if (said.toLowerCase() === full.toLowerCase()) return whole;                      // already said in full
    const state = d.filter((w) => STATE.test(w)).join(" ");
    const article = /^an?$/i.test(art) ? (/^[aeiou]/i.test(state || full) ? (art[0] === "A" ? "An" : "an") : (art[0] === "A" ? "A" : "a")) : art;
    return `${article} ${state ? `${state} ` : ""}${full}`;
  }));
}

/** The same rules as the song WRITER is given them — before a scene is written. */
export const SENSE_RULES =
  `REAL-WORLD SENSE — every VISUAL must be something a real crew could film with real people. The AI video model animates exactly what you write, so anything that makes no physical sense comes out absurd:\n` +
  `  • A CAR (or truck, bike…): people in it SIT in its seats — nobody stands, dances or walks in or on a vehicle. Film it PARKED (leaning on it, sitting on the hood, stepping out of it) or from INSIDE, close on the faces with the lights passing — never a wide shot of people riding along in an open car. Say what KIND of car it is (e.g. "a black 1969 Mustang convertible") and use those SAME words every time it appears in a VISUAL — never shortened to "the Mustang" or "the car"; the same person drives it throughout. (That is for the pictures: the LYRICS never need to name the car at all.)\n` +
  `  • UP HIGH (a rooftop, a terrace, a balcony): it has a wall or a railing, and people stay well back from the edge. Nobody stands or walks on a ledge, a beam, or a glass floor over a drop.\n` +
  `  • DANCING happens on foot, where there is room to dance — a rooftop, an empty street, a parking garage, a club floor. Never in a vehicle, never sitting down.\n` +
  `  • Each person does ONE simple, natural thing: walking, leaning, sitting, looking out over the view, dancing. No stunts, no acrobatics, nothing fiddly done with the hands.\n` +
  // (the wardrobe is locked — mv-cast.ts castStylePrompt — and a scene is drawn from its own words: a
  //  VISUAL that said "silver jacket catching the glow" put a co-star in a silver jacket for that one
  //  scene, over the look that had been picked for her; seen in the storyboard, 2026-11-22)
  `  • CLOTHES: never write what anyone is WEARING — no jackets, dresses, fabrics, jewellery or colours of clothing. Everyone's outfit is already chosen and is drawn from their own picture; a VISUAL that dresses them changes it.\n`;
