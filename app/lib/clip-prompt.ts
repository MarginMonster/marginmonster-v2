// Budgeting the prompt of a Kling dialogue clip — pure, so it is unit-tested (tests/clip-prompt.test.ts).
//
// Kling reads at most 2,500 characters of prompt; both providers publish the cap. fal REJECTS a longer
// one (a 422 when the result is read); Replicate quietly cuts the tail off (its log: "Prompt too long,
// truncating to 2500 chars"). From Nov 9 to Nov 17 2026 the Short Film clip prompt ran 2,700–3,100
// characters: fal refused every shot, Replicate rendered them all, and the last ~550 characters — the
// camera-lock, no-sound-effects and no-on-screen-text rules — never reached the model. So the prompt is
// now BUILT to fit, and what gets left out when a line is unusually long is chosen, not accidental.

export const KLING_PROMPT_MAX = 2500;

/** Never hand Kling more than it reads: cut at `max`, back to the end of a whole sentence. The last
 *  line of defence at the provider boundary (a prompt stored before prompts were built to fit). */
export function clampKlingPrompt(prompt: string, max = KLING_PROMPT_MAX): string {
  const p = prompt.replace(/\s+/g, " ").trim();
  if (p.length <= max) return p;
  const cut = p.slice(0, max);
  return cut.replace(/[^.!?]*$/, "").trim() || cut;
}

export type ClipRules = { look: string; lookTight: string; lookShort: string; style: string; steady: string; noText: string };

/** The standing rules that follow the talking directions in every clip prompt — written SHORT on
 *  purpose, because the talking directions take ~1,600 of the 2,500 characters. Three sizes of the
 *  look-note carry the same rules (same faces / hair / clothes / room, the facial-hair lock, no
 *  morphing, hold still, no new props and a held prop stays put) in fewer and fewer words.
 *
 *  THE BACKGROUND IS ALIVE in an acted, spoken, live-action shot (2026-11-23). The note used to say
 *  "identical … background throughout" and "Nobody moves except natural talking" — and the model did as
 *  it was told: the people walking behind the speakers stood frozen mid-step for the whole shot. A
 *  tester on Short Film and Horror Film: "scenes looks more real, backend moves, live real day life, not
 *  stuck." It is the SPEAKERS who hold their places; what is already behind them keeps moving, and
 *  nothing new comes in. A cartoon and a sung shot keep the note they were approved with. */
export function clipRules(o: { cartoon: boolean; sing: boolean }): ClipRules {
  const { cartoon, sing } = o;
  if (!cartoon && !sing) {
    return {
      look: "Keep EVERYONE and the setting EXACTLY as in the starting image — identical faces, hair, skin tone, clothing, lighting and place throughout; every beard, mustache and bit of stubble stays exactly as it is, never fading, growing, appearing or vanishing. Do NOT morph, age or redraw anyone. The speakers hold their places — only natural talking and small head and expression shifts. The background stays alive with gentle natural motion; nothing new enters. Add NO new object; anything already held keeps its exact size and shape in the same hand.",
      lookTight: "Keep EVERYONE and the setting EXACTLY as in the starting image — same faces, hair, facial hair, skin tone, clothing, lighting and place, never morphing, aging or changing. The speakers hold their places — only talking and small head and expression shifts; the background stays gently alive, nothing new enters. Add NO new object; anything already held stays the same size and shape in the same hand.",
      lookShort: "Keep everyone and the setting EXACTLY as in the starting image — same faces, hair, facial hair, clothing and background; no morphing, no new objects; nobody moves except to talk.",
      style: "Photorealistic live-action, clean natural spoken-dialogue audio.",
      steady: "The camera stays LOCKED and level — no rotation, tilt, flip or zoom. The ONLY audio is the spoken voice and faint room tone — no music or sound effects.",
      noText: "NO on-screen text — no subtitles, captions, titles or readable writing; never show the spoken words as text; keep the bottom edge clean.",
    };
  }
  return {
    look: cartoon
      ? "Keep EVERYONE and the setting EXACTLY as in the starting image — identical character designs, colors, outfits, lighting and background throughout; do NOT morph or redraw anyone into a different character. Nobody moves except natural talking and small, subtle head and expression shifts. Add NO object that is not in the starting image."
      : "Keep EVERYONE and the setting EXACTLY as in the starting image — identical faces, hair, skin tone, clothing, lighting and background throughout; every beard, mustache and bit of stubble stays exactly as it is, never fading, growing, appearing or disappearing. Do NOT morph, age or redraw anyone. Nobody moves except natural talking and small, subtle head and expression shifts. Add NO object that is not in the starting image; anything already held keeps its exact size and shape, steady in the same hand.",
    lookTight: cartoon
      ? "Keep EVERYONE and the setting EXACTLY as in the starting image — same character designs, colors, outfits, lighting and background, never morphing or redrawn. Nobody moves except natural talking and small head and expression shifts. Add NO new object."
      : "Keep EVERYONE and the setting EXACTLY as in the starting image — same faces, hair, facial hair, skin tone, clothing, lighting and background, never morphing, aging or changing. Nobody moves except natural talking and small head and expression shifts. Add NO new object; anything already held stays the same size and shape in the same hand.",
    lookShort: cartoon
      ? "Keep everyone and the setting EXACTLY as in the starting image — same character designs, colors, outfits and background; no morphing, no new objects; nobody moves except to talk."
      : "Keep everyone and the setting EXACTLY as in the starting image — same faces, hair, facial hair, clothing and background; no morphing, no new objects; nobody moves except to talk.",
    style: sing
      ? (cartoon ? "Bright 3D-animated cartoon style (not live-action); clean, clear SUNG vocal audio with a catchy melody, lip-synced to the words." : "Photorealistic live-action; clean, clear SUNG vocal audio with a catchy melody, lip-synced to the words.")
      : (cartoon ? "Bright, glossy 3D-animated cartoon style (not live-action), clean clear spoken-dialogue audio." : "Photorealistic live-action, clean natural spoken-dialogue audio."),
    // Lock the frame + kill stray audio — the owner saw a mid-shot "orientation change" with a random
    // sound effect. The camera must not move, and Kling must not invent foley / sfx.
    steady: `The camera stays LOCKED and level — no rotation, tilt, flip or zoom.${sing ? " Keep ONLY the sung vocal and its melody — no stray sound effects." : " The ONLY audio is the spoken voice and faint room tone — no music or sound effects."}`,
    noText: "NO on-screen text — no subtitles, captions, titles or readable writing; never show the spoken words as text; keep the bottom edge clean.",
  };
}

/** Put the clip prompt together so it FITS what Kling reads. The talking directions lead, word for word
 *  (they drive the shot and are the part every approved film was rendered from); the standing rules
 *  follow. When a long line, tone or name still overflows, give up the least important text ON PURPOSE
 *  — the look-note steps down full → tight → short, then the style tag, then the voice-timbre sentence —
 *  instead of losing whatever happens to be last. `gaveUp` names what was dropped ("" = nothing). */
export function fitClipPrompt(p: { voice: string; voiceDesc: string } & ClipRules, max = KLING_PROMPT_MAX): { prompt: string; gaveUp: string } {
  const join = (...xs: string[]) => xs.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const tries: Array<[string, string]> = [
    ["", join(p.voice + p.voiceDesc, p.look, p.style, p.steady, p.noText)],
    ["the look-note's extra wording", join(p.voice + p.voiceDesc, p.lookTight, p.style, p.steady, p.noText)],
    ["most of the look-note", join(p.voice + p.voiceDesc, p.lookShort, p.style, p.steady, p.noText)],
    ["most of the look-note, the style tag", join(p.voice + p.voiceDesc, p.lookShort, p.steady, p.noText)],
    ["most of the look-note, the style tag, the voice timbre", join(p.voice, p.lookShort, p.steady, p.noText)],
  ];
  for (const [gaveUp, s] of tries) if (s.length <= max) return { prompt: s, gaveUp };
  // A line too long for even that: the camera / audio / no-text rules still go in whole, and the cut
  // falls on the END of the talking directions (their closing sentences repeat earlier ones for emphasis).
  const rules = join(p.steady, p.noText);
  return { prompt: join(clampKlingPrompt(p.voice, Math.max(0, max - rules.length - 1)), rules), gaveUp: "the look-note and the end of the talking directions (line too long)" };
}
