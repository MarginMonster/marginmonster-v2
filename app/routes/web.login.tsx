import { json, type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { clientIp, rateLimit, rateLimitReset } from "../lib/rate-limit.server";
import { getWebIdentity, loginWebAccount, webSessionRedirect } from "../lib/web-auth.server";

// Merchants keep several of these open at once; an untitled tab is just a URL.
export const meta = () => [{ title: "Log in · EasyMode" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (await getWebIdentity(request)) throw redirect("/web");
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const email = ((form.get("email") as string) || "").trim().toLowerCase();
  const password = (form.get("password") as string) || "";

  // Two limits, because they stop different things.
  //
  // Per address: credential stuffing works by trying many passwords against
  // one account, and nothing here slowed that down.
  //
  // Per source: verifying a password runs scrypt, which is expensive on
  // purpose and runs on libuv's four-thread pool — the same pool the render
  // pipeline's file work uses. A burst of login attempts was therefore enough
  // to stall every other tenant's jobs without any code looking slow.
  const ip = clientIp(request);
  const byIp = rateLimit(`login:ip:${ip}`, 20, 10 * 60_000);
  const byEmail = email ? rateLimit(`login:acct:${email}`, 8, 10 * 60_000) : { ok: true, retryAfterSec: 0 };
  if (!byIp.ok || !byEmail.ok) {
    const wait = Math.max(byIp.retryAfterSec, byEmail.retryAfterSec);
    return json(
      { error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? "s" : ""}.` },
      { status: 429, headers: { "Retry-After": String(wait) } }
    );
  }

  const account = await loginWebAccount(email, password);
  if (!account) return json({ error: "Email or password didn't match." });
  // Someone who got in was never the threat — don't leave them throttled by
  // their own mistyped attempts.
  rateLimitReset(`login:acct:${email}`);
  return webSessionRedirect(account.id);
};

export default function WebLogin() {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  return (
    <div className="wb-auth wb-card">
      <h1 className="wb-h1" style={{ marginTop: 0 }}>Log in</h1>
      {actionData && "error" in actionData && <div className="wb-err">{actionData.error}</div>}
      <Form method="post">
        <label className="wb-lbl">Email</label>
        <input className="wb-in" name="email" type="email" required />
        <label className="wb-lbl">Password</label>
        <input className="wb-in" name="password" type="password" required />
        <div style={{ marginTop: 18 }}>
          <button className="wb-btn" type="submit" disabled={nav.state !== "idle"}>
            {nav.state !== "idle" ? "Logging in…" : "Log in →"}
          </button>
        </div>
      </Form>
      <p className="wb-note" style={{ marginTop: 16 }}>
        <Link to="/web/forgot">Forgot your password?</Link>
      </p>
      <p className="wb-note" style={{ marginTop: 8 }}>
        New here? <Link to="/web/signup">Create an account</Link>
      </p>
    </div>
  );
}
