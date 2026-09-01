import { json, type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { clientIp, rateLimit } from "../lib/rate-limit.server";
import { createWebAccount, getWebIdentity, webSessionRedirect, SignupError } from "../lib/web-auth.server";
import { isValidTimeZone } from "../lib/timezone";

// Merchants keep several of these open at once; an untitled tab is just a URL.
export const meta = () => [{ title: "Start free · EasyMode" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (await getWebIdentity(request)) throw redirect("/web");
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const email = ((form.get("email") as string) || "").trim().toLowerCase();
  const password = (form.get("password") as string) || "";
  const name = ((form.get("name") as string) || "").trim();
  const lang = ((form.get("lang") as string) || "").trim() || undefined;
  // The merchant's own zone, so a drop scheduled for 7pm posts at 7pm where
  // they are rather than 7pm UTC. Validated server-side — this arrives from
  // the browser and is used to build instants.
  const rawTz = ((form.get("tz") as string) || "").trim();
  const timezone = isValidTimeZone(rawTz) ? rawTz : undefined;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." });
  if (password.length < 8) return json({ error: "Password needs at least 8 characters." });

  // Signing up is free and unverified, and each one creates an Account, a
  // Shop and a Connection, hashes a password on the shared thread pool, and
  // yields a session that can queue a sitemap crawl on the single serial
  // worker. Ten a day from one address is far beyond anything a real person
  // does and far below what an abuser needs.
  const gate = rateLimit(`signup:ip:${clientIp(request)}`, 10, 60 * 60_000);
  if (!gate.ok) {
    return json(
      { error: "Too many accounts created from here recently. Try again a little later." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } }
    );
  }
  try {
    const account = await createWebAccount(email, password, name || undefined, lang, timezone);
    return webSessionRedirect(account);
  } catch (e) {
    // Only messages we wrote go to the browser. Anything else — a Prisma
    // fault, a connection drop — is logged and answered generically, because
    // this endpoint is open to the internet.
    if (e instanceof SignupError) return json({ error: e.message });
    console.error("[signup] failed:", e);
    return json({ error: "Couldn't create the account just now — try again in a moment." });
  }
};

export default function WebSignup() {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  // Seed the account's AI content language from the landing-page toggle.
  const [lang, setLang] = useState("en");
  const [tz, setTz] = useState("");
  useEffect(() => { try { setLang(localStorage.getItem("emLang") || (navigator.language || "en").slice(0, 2)); } catch { /* private mode */ } }, []);
  // Same idea as the language above: ask the browser once, at signup.
  useEffect(() => { try { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || ""); } catch { /* older browser */ } }, []);
  return (
    <div className="wb-auth wb-card">
      <h1 className="wb-h1" style={{ marginTop: 0 }}>Create your account</h1>
      <p className="wb-sub" style={{ marginBottom: 6 }}>7-day free trial on every plan. No Shopify store required.</p>
      {actionData && "error" in actionData && <div className="wb-err">{actionData.error}</div>}
      <Form method="post">
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="tz" value={tz} />
        <label className="wb-lbl" htmlFor="su-name">Your name (or brand)</label>
        <input className="wb-in" id="su-name" name="name" autoComplete="organization" placeholder="Sunny Supply Co." />
        <label className="wb-lbl" htmlFor="su-email">Email</label>
        <input className="wb-in" id="su-email" name="email" type="email" required autoComplete="email" placeholder="you@brand.com" />
        <label className="wb-lbl" htmlFor="su-pw">Password</label>
        <input className="wb-in" id="su-pw" name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="8+ characters" />
        <div style={{ marginTop: 18 }}>
          <button className="wb-btn" type="submit" disabled={nav.state !== "idle"}>
            {nav.state !== "idle" ? "Creating…" : "Create account →"}
          </button>
        </div>
      </Form>
      <p className="wb-note" style={{ marginTop: 14 }}>
        By creating an account you agree to our{" "}
        <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and{" "}
        <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
      </p>
      <p className="wb-note" style={{ marginTop: 10 }}>
        Already have one? <Link to="/web/login">Log in</Link>
      </p>
    </div>
  );
}
