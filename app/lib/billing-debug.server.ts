/* Billing forensics — the last failed billing.request, held in memory and
 * readable via /api/diag?mode=billing. Render logs aren't reachable from the
 * outside; this is our eyes. Remove with the other debug endpoints pre-launch. */

type BillingFailure = {
  at: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  session: { isOnline?: boolean; scope?: string | null; expires?: string | null; hasToken: boolean };
};

let last: BillingFailure | null = null;

export async function recordBillingFailure(
  res: Response,
  session: { isOnline?: boolean; scope?: string | null; expires?: Date | null; accessToken?: string }
): Promise<void> {
  try {
    last = {
      at: new Date().toISOString(),
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      body: (await res.clone().text().catch(() => "")).slice(0, 500),
      session: {
        isOnline: session.isOnline,
        scope: session.scope,
        expires: session.expires ? new Date(session.expires).toISOString() : null,
        hasToken: !!session.accessToken,
      },
    };
  } catch (e) {
    console.error("[billing-debug] capture failed:", e);
  }
}

export function lastBillingFailure(): BillingFailure | null {
  return last;
}
