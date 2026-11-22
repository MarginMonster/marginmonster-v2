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
 *      comes back with somebody doing the impossible is drawn again (mv-cast.ts — the check's "odd").
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
  return "";
}

/** The rule the VIDEO model is given for the people in a shot. */
export function senseMotion(visual: string | null | undefined): string {
  return rideScene(visual)
    ? " They are riding in a moving car: everyone STAYS SEATED the whole shot — heads nod to the music, hair moves in the breeze, lights sweep across their faces, the city slides past outside. Nobody stands up, climbs, walks or dances, and whoever drives keeps their hands on the wheel."
    : " Everyone moves the way real people would in this exact place — natural, physically possible motion. Nobody walks or steps on the spot, nobody floats or slides, and nobody stands in or on a vehicle.";
}

/** Did a picture come back LETTERBOXED — a wide picture with black bars above and below it (or an upright
 *  one with bars either side)? `gray` is the picture as w×h brightness values (0–255), small (48×48 is
 *  plenty). Bars are pure black, edge to edge, on BOTH sides, with a real picture between them: a night
 *  sky is dark but never one flat black from corner to corner. */
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
  return (flat(0, w, 0, bh) && flat(0, w, h - bh, h)) || (flat(0, bw, 0, h) && flat(w - bw, w, 0, h));
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

/** The same rules as the song WRITER is given them — before a scene is written. */
export const SENSE_RULES =
  `REAL-WORLD SENSE — every VISUAL must be something a real crew could film with real people. The AI video model animates exactly what you write, so anything that makes no physical sense comes out absurd:\n` +
  `  • A CAR (or truck, bike…): people in it SIT in its seats — nobody stands, dances or walks in or on a vehicle. Film it PARKED (leaning on it, sitting on the hood, stepping out of it) or from INSIDE, close on the faces with the lights passing — never a wide shot of people riding along in an open car. Say what KIND of car it is (e.g. "a black 1969 Mustang convertible") and use those SAME words every time it appears; the same person drives it throughout.\n` +
  `  • DANCING happens on foot, where there is room to dance — a rooftop, an empty street, a parking garage, a club floor. Never in a vehicle, never sitting down.\n` +
  `  • Each person does ONE simple, natural thing: walking, leaning, sitting, looking out over the view, dancing. No stunts, no acrobatics, nothing fiddly done with the hands.\n`;
