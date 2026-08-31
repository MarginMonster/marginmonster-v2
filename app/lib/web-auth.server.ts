/* Web front-door auth — email + password accounts for easymodeapp.com.
 * A signup creates an Account AND a companion WEB Shop row (synthetic domain,
 * no access token), so the whole shop-keyed engine — wallet, jobs, pipelines,
 * archive — serves web users unchanged. Blueprint: docs/account-model.md. */

import { createCookieSessionStorage, redirect } from "@remix-run/node";
import crypto from "node:crypto";
import { db } from "../db.server";
import type { Account, Shop, Plan, BrandProfile } from "@prisma/client";

/** The key every session cookie is signed with.
 *
 *  There used to be a third fallback here: the literal string "em-dev-secret".
 *  A deploy missing both real secrets would have signed sessions with a value
 *  written in the source — anyone could mint a cookie for any accountId and be
 *  logged in as that merchant. Production has SHOPIFY_API_SECRET set, so this
 *  was latent rather than live, but a silent fallback to a published constant
 *  is not something to leave lying in an auth path. Refuse to boot instead. */
function sessionSecret(): string {
  const real = process.env.SESSION_SECRET || process.env.SHOPIFY_API_SECRET;
  if (real) return real;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to start: neither SESSION_SECRET nor SHOPIFY_API_SECRET is set, so web session cookies " +
        "would be signed with a key that is published in the source. Set SESSION_SECRET in the environment."
    );
  }
  return "em-dev-secret"; // local development only — never reached in production
}

const storage = createCookieSessionStorage({
  cookie: {
    name: "em_web",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    secrets: [sessionSecret()],
    maxAge: 60 * 60 * 24 * 30,
  },
});

// scrypt (node built-in) — no native deps to break the Docker build.
//
// ASYNC, not scryptSync: this process also runs the job worker in-process, and
// the sync variant parks the entire event loop for ~68ms on every login and
// signup — every other merchant's request and every in-flight render stalls
// behind someone typing a password.
const scrypt = (pw: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    crypto.scrypt(pw, salt, 64, (err, key) => (err ? reject(err) : resolve(key)))
  );

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${(await scrypt(pw, salt)).toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = await scrypt(pw, salt);
  const real = Buffer.from(hash, "hex");
  return test.length === real.length && crypto.timingSafeEqual(test, real);
}

/** A throwaway hash to burn on a login for an email that doesn't exist.
 *  Without it, "no such account" returned in ~0ms while a real account took
 *  ~68ms — a timing oracle that let anyone enumerate which emails are
 *  registered. Same work, same shape, result discarded. */
const DUMMY_HASH = `${"0".repeat(32)}:${"0".repeat(128)}`;

export type WebIdentity = {
  account: Account;
  shop: Shop & { activePlan: Plan | null; brandProfile: BrandProfile | null };
};

/** Create the account + its companion WEB shop. Throws on duplicate email.
 *  contentLang seeds the AI generation language from the landing toggle. */
/** An error whose message is safe to show a visitor. Anything else that
 *  escapes createWebAccount is an internal failure, and the signup route
 *  says so generically rather than echoing it into the browser. */
export class SignupError extends Error {}

const EMAIL_TAKEN = "An account with that email already exists — log in instead.";

export async function createWebAccount(email: string, password: string, name?: string, contentLang?: string, timezone?: string): Promise<Account> {
  const existing = await db.account.findUnique({ where: { email } });
  if (existing) throw new SignupError(EMAIL_TAKEN);

  // Do the slow, failable work BEFORE opening the transaction.
  const passwordHash = await hashPassword(password);
  const { normalizeContentLang } = await import("./content-lang");
  const lang = normalizeContentLang(contentLang);

  // ALL THREE OR NONE. These were three bare awaits: if the shop or the
  // connection failed, the Account survived on its own — and an account with no
  // WEB connection is unusable. getWebIdentity returns null for it, so every
  // page bounces to /web/login, logging in bounces straight back, and signing
  // up again is refused because the email is taken. A permanently locked-out
  // user, created by one transient database error, with no way back.
  try {
    return await db.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: { email, passwordHash, name: name || null },
      });
      const shop = await tx.shop.create({
        data: { domain: `web-${account.id}.easymode.app`, accessToken: "", contentLang: lang, timezone: timezone || null },
      });
      await tx.connection.create({ data: { accountId: account.id, kind: "web", externalId: shop.id } });
      return account;
    });
  } catch (e) {
    // The findUnique above is a check, not a lock. Two signups for the same
    // address in the same instant both pass it and both reach the create,
    // where the unique index stops the second — and Prisma’s P2002 message
    // (constraint name, model, sometimes the query) was being returned
    // verbatim to an unauthenticated browser. Same outcome, our words.
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      throw new SignupError(EMAIL_TAKEN);
    }
    throw e;
  }
}

export async function loginWebAccount(email: string, password: string): Promise<Account | null> {
  const account = await db.account.findUnique({ where: { email } });
  // Always do the hashing work, even when there is no such account. Returning
  // early made a miss answer in ~0ms and a hit in ~68ms, which is enough to
  // enumerate exactly which emails have accounts here.
  const stored = account?.passwordHash || DUMMY_HASH;
  const ok = await verifyPassword(password, stored);
  if (!account?.passwordHash || !ok) return null;
  return account;
}

/** Redirect that sets the session cookie. */
/* A session cookie says WHO, and now also says WHICH PASSWORD it was issued
 * under.
 *
 * The cookie carried only accountId and lives 30 days, so changing a password
 * did nothing to sessions already open elsewhere. That is backwards: the
 * commonest reason to change a password is that somebody else has it, and
 * until now doing so left them logged in for up to a month on their own
 * device while the owner believed they had shut the door.
 *
 * A short HMAC of the stored hash is enough — it identifies the password
 * without being derived from it in any usable direction, and it is keyed with
 * the session secret so a cookie cannot be hand-made. Truncated because this
 * rides in every request's cookie and only needs to distinguish, not to
 * withstand a preimage search of a value the holder would have to already
 * know. */
function pwFingerprint(passwordHash: string | null): string {
  return crypto.createHmac("sha256", sessionSecret()).update(`pwv|${passwordHash ?? ""}`).digest("base64url").slice(0, 16);
}

/** Redirect that sets the session cookie. Takes the account rather than an id
 *  so the cookie can record which password it was minted under. */
export async function webSessionRedirect(
  account: { id: string; passwordHash: string | null },
  to = "/web"
): Promise<Response> {
  const session = await storage.getSession();
  session.set("accountId", account.id);
  session.set("pwv", pwFingerprint(account.passwordHash));
  return redirect(to, { headers: { "Set-Cookie": await storage.commitSession(session) } });
}

export async function webLogout(request: Request): Promise<Response> {
  const session = await storage.getSession(request.headers.get("Cookie"));
  return redirect("/web/login", { headers: { "Set-Cookie": await storage.destroySession(session) } });
}

export async function getWebIdentity(request: Request): Promise<WebIdentity | null> {
  const session = await storage.getSession(request.headers.get("Cookie"));
  const accountId = session.get("accountId") as string | undefined;
  if (!accountId) return null;
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) return null;

  // A cookie minted under a password that has since changed is dead. The
  // `pwv &&` guard grandfathers cookies issued before this shipped — none of
  // them carry the key, and expiring every live merchant's session on a deploy
  // reads as an outage on a paid product. Those cookies age out within 30 days
  // (maxAge above), after which this is unconditional. The cost of the window
  // is real and worth naming: a password changed in the next month does not
  // yet evict a session that predates this deploy.
  const pwv = session.get("pwv") as string | undefined;
  if (pwv && pwv !== pwFingerprint(account.passwordHash)) return null;

  const conn = await db.connection.findFirst({ where: { accountId, kind: "web" } });
  if (!conn) return null;
  const shop = await db.shop.findUnique({
    where: { id: conn.externalId },
    include: { activePlan: true, brandProfile: true },
  });
  if (!shop) return null;
  return { account, shop };
}

/** Loader/action guard — bounce to login when there's no session. */
export async function requireWebIdentity(request: Request): Promise<WebIdentity> {
  const id = await getWebIdentity(request);
  if (!id) throw redirect("/web/login");
  return id;
}
