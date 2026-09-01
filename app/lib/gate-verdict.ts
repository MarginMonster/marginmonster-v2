/* Reading a vision judge's verdict.
 *
 * Three separate gates each rolled their own version of this, and each got it
 * wrong in the same way: `j.pass !== false`. That expression is true for a
 * verdict with no `pass` key at all, and true for the STRING "false" — so a
 * reply the judge never really gave, or gave badly, shipped the ad.
 *
 * Two of the three also answered `pass: true` when the judge was unreachable
 * or its reply was unreadable. From this repo's own commit d66be14: "a gate
 * that answers 'pass' when it could not look is not a gate."
 *
 * So: FAIL CLOSED, and distinguish the two failures. `degraded` means "could
 * not judge" — the caller uses it to skip an expensive remediation (a repair
 * render, a re-rolled clip) that would be guessing at a fault nobody observed.
 * A plain `ok:false` means the judge looked and said no; that one is worth
 * spending on.
 */

export type GateVerdict = {
  /** True only when the judge explicitly returned boolean true. */
  ok: boolean;
  /** True when we could not obtain a verdict at all (outage, unreadable, wrong shape). */
  degraded: boolean;
  /** Short human-readable reason, safe to log and to store on the asset. */
  reason: string;
};

const UNPARSEABLE = "qa-unparseable";

/**
 * Read a judge's reply.
 *
 * @param raw       the model's raw text; it is allowed to wrap the JSON in prose
 * @param verdictKey which boolean carries the verdict ("pass" or "ok")
 * @param reasonKey  which string carries the explanation ("reason" or "why")
 */
export function parseGateVerdict(
  raw: string | null | undefined,
  verdictKey = "pass",
  reasonKey = "reason",
  maxReason = 200
): GateVerdict {
  if (typeof raw !== "string" || !raw) return { ok: false, degraded: true, reason: UNPARSEABLE };

  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, degraded: true, reason: UNPARSEABLE };

  let j: Record<string, unknown>;
  try {
    j = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return { ok: false, degraded: true, reason: UNPARSEABLE };
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) {
    return { ok: false, degraded: true, reason: UNPARSEABLE };
  }

  const v = j[verdictKey];
  // Deliberately strict. A missing key, null, 0/1, or the strings "true"/"false"
  // all mean the judge did not answer in the shape we asked for, and guessing
  // which way it meant is exactly how the ad shipped unchecked.
  if (typeof v !== "boolean") return { ok: false, degraded: true, reason: UNPARSEABLE };

  const r = j[reasonKey];
  return { ok: v, degraded: false, reason: (typeof r === "string" ? r : "").slice(0, maxReason) };
}

/** The reason string used when a gate threw before it could judge. */
export function outageReason(e: unknown, max = 100): string {
  return `qa-outage: ${(e instanceof Error ? e.message : String(e)).slice(0, max)}`;
}
