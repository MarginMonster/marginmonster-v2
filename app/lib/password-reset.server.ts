/* The half of password reset that needs a database row. The signing, URL and
 * email helpers are pure and live in password-reset.ts, which this re-exports
 * so callers only ever import from one place. */

import crypto from "node:crypto";
import type { Account } from "@prisma/client";
import { db } from "../db.server";
import { RESET_TTL_MS, resetMac } from "./password-reset.ts";

export { signPasswordReset, resetUrl, resetEmailHtml } from "./password-reset.ts";

/** The account this token unlocks, or null if it is forged, expired, or was
 *  signed against a password that has since changed. Returns the account so the
 *  caller has the bound hash for its compare-and-swap. */
export async function verifyPasswordReset(token: string | null | undefined): Promise<Account | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  let payload: string;
  try {
    payload = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return null;
  }

  // accountId|issuedAt, split at the LAST separator so a cuid containing one
  // could not shift the boundary.
  const sep = payload.lastIndexOf("|");
  if (sep <= 0) return null;
  const accountId = payload.slice(0, sep);
  const issuedAt = parseInt(payload.slice(sep + 1), 36);
  if (!accountId || !Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > RESET_TTL_MS) return null;

  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) return null;

  let expected: string;
  try {
    expected = resetMac(payload, account.passwordHash);
  } catch {
    return null; // no secret configured — trust nothing
  }
  const got = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(expected);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  return account;
}
