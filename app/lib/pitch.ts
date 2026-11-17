// Speaking pitch of a voice — a small YIN tracker over mono PCM. Pure, so it is unit-tested
// (tests/pitch.test.ts) and usable anywhere.
//
// Why the app needs it: a character's line is acted by the video model in a voice of ITS choosing, then
// re-voiced with the voice the merchant picked. The re-voice keeps the pitch it is given — so a man's
// voice asked to speak at a child's pitch comes out stretched and monstrous (measured: a 93 Hz stock
// voice driven at 320 Hz). Knowing both pitches lets the re-voice move the line into the range the
// picked voice actually speaks in, which is also what makes a character sound the same in every shot.

/** Voiced-frame pitch estimates (Hz) for `x` (mono samples in -1..1 at `sr` Hz). */
export function trackF0(x: Float32Array, sr = 16000, fmin = 70, fmax = 700): number[] {
  const tauMin = Math.max(2, Math.floor(sr / fmax));
  const tauMax = Math.ceil(sr / fmin);
  const W = Math.round(sr * 0.04); // 40 ms window
  const hop = Math.round(sr * 0.02); // 20 ms hop
  const out: number[] = [];
  const d = new Float32Array(tauMax + 2);
  const cm = new Float32Array(tauMax + 2);
  for (let s = 0; s + W + tauMax < x.length; s += hop) {
    let e = 0;
    for (let i = 0; i < W; i++) e += x[s + i] * x[s + i];
    if (Math.sqrt(e / W) < 0.012) continue; // below ~-38 dBFS: not speech
    for (let tau = 1; tau <= tauMax; tau++) {
      let acc = 0;
      for (let i = 0; i < W; i++) { const df = x[s + i] - x[s + i + tau]; acc += df * df; }
      d[tau] = acc;
    }
    let run = 0;
    cm[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; cm[tau] = run > 0 ? (d[tau] * tau) / run : 1; }
    let best = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cm[tau] < 0.12) { while (tau + 1 <= tauMax && cm[tau + 1] < cm[tau]) tau++; best = tau; break; }
    }
    if (best < 0) continue; // unvoiced or too noisy to call
    const a = cm[best - 1], b = cm[best], c = cm[best + 1];
    const denom = a + c - 2 * b;
    const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    out.push(sr / (best + (Number.isFinite(shift) ? shift : 0)));
  }
  return out;
}

/** The median of the voiced pitch estimates, or null when there is too little voiced speech to trust. */
export function medianHz(f0s: number[], minFrames = 12): number | null {
  if (f0s.length < minFrames) return null;
  const s = [...f0s].sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)];
}

/** Whole semitones to move a line spoken at `fromHz` so it sits where a voice that speaks at `toHz`
 *  does. Small differences are left alone (every transposition costs a little quality, and a voice a
 *  tone off still sounds like itself); the shift is capped at an octave either way. */
export function semitonesToMatch(fromHz: number | null | undefined, toHz: number | null | undefined): number {
  if (!fromHz || !toHz || !(fromHz > 0) || !(toHz > 0)) return 0;
  const st = 12 * Math.log2(toHz / fromHz);
  if (Math.abs(st) < 1.5) return 0;
  return Math.max(-12, Math.min(12, Math.round(st)));
}
