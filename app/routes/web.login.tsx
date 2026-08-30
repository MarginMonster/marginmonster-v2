import { json, type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
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
  const account = await loginWebAccount(email, password);
  if (!account) return json({ error: "Email or password didn't match." });
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
        New here? <Link to="/web/signup">Create an account</Link>
      </p>
    </div>
  );
}
