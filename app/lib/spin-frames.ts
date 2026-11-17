/* Which frame of a presenter's rotation to fetch next, and which to draw — the two small decisions
 * behind the turnable figure (app/components/SpinStage.tsx). Kept apart from the component so they can
 * be tested without a browser. */

/** The order frames are fetched in: 0, then the multiples of 16, 8, 4, 2, 1 not yet asked for. */
export function spinLoadOrder(n: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const step of [n, 16, 8, 4, 2, 1]) {
    for (let i = 0; i < n; i += step) if (!seen.has(i)) { seen.add(i); out.push(i); }
  }
  return out;
}

/** The loaded frame closest to `want` (wrapping round the turn), or -1 when nothing is loaded yet. */
export function nearestLoaded(want: number, loaded: ArrayLike<unknown>, n: number): number {
  const at = ((Math.round(want) % n) + n) % n;
  for (let d = 0; d <= n / 2; d++) {
    const a = (at + d) % n;
    if (loaded[a]) return a;
    const b = (at - d + n) % n;
    if (loaded[b]) return b;
  }
  return -1;
}
