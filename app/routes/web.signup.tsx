import { json, type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { createWebAccount, getWebIdentity, webSessionRedirect } from "../lib/web-auth.server";

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
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." });
  if (password.length < 8) return json({ error: "Password needs at least 8 characters." });
  try {
    const account = await createWebAccount(email, password, name || undefined, lang);
    return webSessionRedirect(account.id);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Couldn't create the account — try again." });
  }
};

export default function WebSignup() {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  // Seed the account's AI content language from the landing-page toggle.
  const [lang, setLang] = useState("en");
  useEffect(() => { try { setLang(localStorage.getItem("emLang") || (navigator.language || "en").slice(0, 2)); } catch { /* private mode */ } }, []);
  return (
    <div className="wb-auth wb-card">
      <h1 className="wb-h1" style={{ marginTop: 0 }}>Create your account</h1>
      <p className="wb-sub" style={{ marginBottom: 6 }}>7-day free trial on every plan. No Shopify store required.</p>
      {actionData && "error" in actionData && <div className="wb-err">{actionData.error}</div>}
      <Form method="post">
        <input type="hidden" name="lang" value={lang} />
        <label className="wb-lbl">Your name (or brand)</label>
        <input className="wb-in" name="name" placeholder="Sunny Supply Co." />
        <label className="wb-lbl">Email</label>
        <input className="wb-in" name="email" type="email" required placeholder="you@brand.com" />
        <label className="wb-lbl">Password</label>
        <input className="wb-in" name="password" type="password" required minLength={8} placeholder="8+ characters" />
        <div style={{ marginTop: 18 }}>
          <button className="wb-btn" type="submit" disabled={nav.state !== "idle"}>
            {nav.state !== "idle" ? "Creating…" : "Create account →"}
          </button>
        </div>
      </Form>
      <p className="wb-note" style={{ marginTop: 16 }}>
        Already have one? <Link to="/web/login">Log in</Link>
      </p>
    </div>
  );
}
