/* Web front-door auth — email + password accounts for easymodeapp.com.
 * A signup creates an Account AND a companion WEB Shop row (synthetic domain,
 * no access token), so the whole shop-keyed engine — wallet, jobs, pipelines,
 * archive — serves web users unchanged. Blueprint: docs/account-model.md. */

import { createCookieSessionStorage, redirect } from "@remix-run/node";
import crypto from "node:crypto";
import { db } from "../db.server";
import type { Account, Shop, Plan, BrandProfile } from "@prisma/client";

const storage = createCookieSessionStorage({
  cookie: {
    name: "em_web",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    secrets: [process.env.SESSION_SECRET || process.env.SHOPIFY_API_SECRET || "em-dev-secret"],
    maxAge: 60 * 60 * 24 * 30,
  },
});

// scrypt (node built-in) — no native deps to break the Docker build.
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const real = Buffer.from(hash, "hex");
  return test.length === real.length && crypto.timingSafeEqual(test, real);
}

export type WebIdentity = {
  account: Account;
  shop: Shop & { activePlan: Plan | null; brandProfile: BrandProfile | null };
};

/** Create the account + its companion WEB shop. Throws on duplicate email. */
export async function createWebAccount(email: string, password: string, name?: string): Promise<Account> {
  const existing = await db.account.findUnique({ where: { email } });
  if (existing) throw new Error("An account with that email already exists — log in instead.");
  const account = await db.account.create({
    data: { email, passwordHash: hashPassword(password), name: name || null },
  });
  const shop = await db.shop.create({
    data: { domain: `web-${account.id}.easymode.app`, accessToken: "" },
  });
  await db.connection.create({ data: { accountId: account.id, kind: "web", externalId: shop.id } });
  return account;
}

export async function loginWebAccount(email: string, password: string): Promise<Account | null> {
  const account = await db.account.findUnique({ where: { email } });
  if (!account?.passwordHash || !verifyPassword(password, account.passwordHash)) return null;
  return account;
}

/** Redirect that sets the session cookie. */
export async function webSessionRedirect(accountId: string, to = "/web"): Promise<Response> {
  const session = await storage.getSession();
  session.set("accountId", accountId);
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
