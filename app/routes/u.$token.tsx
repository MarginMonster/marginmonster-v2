/* The unsubscribe landing page. One click from an email footer, no login.
 *
 * Handles both halves of a real opt-out:
 *   GET  — a person clicking the footer link, and
 *   POST — Gmail/Outlook's own one-click button, driven by the
 *          List-Unsubscribe-Post header the provider sets. RFC 8058 requires
 *          that POST to work without any further interaction.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { db } from "../db.server";
import { verifyUnsubscribe } from "../lib/unsubscribe.server";

async function optOut(token: string | undefined): Promise<{ ok: boolean; email?: string }> {
  const claim = verifyUnsubscribe(token);
  if (!claim) return { ok: false };
  // upsert, not update: post-purchase and win-back mail goes to customers who
  // never came through the signup popup and so have no Subscriber row. Without
  // the create branch their opt-out would match nothing and the next flow would
  // mail them again.
  await db.subscriber.upsert({
    where: { shopId_email: { shopId: claim.shopId, email: claim.email } },
    update: { status: "unsubscribed" },
    create: { shopId: claim.shopId, email: claim.email, source: "unsubscribe", status: "unsubscribed" },
  });
  return { ok: true, email: claim.email };
}

/* THE GET MUST NOT WRITE.
 *
 * This ran optOut() straight from the loader, so merely FETCHING the
 * unsubscribe URL opted the recipient out. That URL is a visible <a href> in
 * the body of every marketing email, and corporate mail gateways, link
 * scanners and preview fetchers follow every link in a message before it
 * reaches the inbox. Every recipient behind one was silently unsubscribed
 * without ever seeing the mail — the merchant's list quietly emptying itself,
 * with consent records that look deliberate.
 *
 * The loader only VERIFIES now. The action still writes, and RFC 8058's
 * one-click POST — the List-Unsubscribe-Post header the provider sets — is
 * unaffected, because that was always the POST. A human clicking the link
 * gets a button.
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const claim = verifyUnsubscribe(params.token);
  return json({ valid: !!claim, email: claim?.email ?? null, done: false });
};

export const action = async ({ params }: ActionFunctionArgs) => {
  const r = await optOut(params.token);
  // Same shape as the loader so the page can render either state, and the
  // bare 200/400 an RFC 8058 client wants is still what it sees.
  return json({ valid: r.ok, email: r.email ?? null, done: r.ok }, { status: r.ok ? 200 : 400 });
};

export default function Unsubscribed() {
  const data = useLoaderData<typeof loader>();
  const posted = useActionData<typeof action>();
  const nav = useNavigation();
  // The action's answer wins once it exists; before that we are showing the
  // confirmation, not the outcome.
  const state = posted ?? data;
  const card: React.CSSProperties = {
    background: "#fff",
    borderRadius: 16,
    padding: "32px 36px",
    maxWidth: 460,
    boxShadow: "0 8px 30px rgba(20,18,31,.08)",
  };
  return (
    <div
      style={{
        fontFamily: "-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        background: "#F4F0E6",
        color: "#14121F",
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div style={card}>
        {!state.valid ? (
          <>
            <h1 style={{ font: "800 22px/1.3 inherit", margin: "0 0 10px" }}>That link didn&rsquo;t work</h1>
            <p style={{ font: "400 15px/1.6 inherit", color: "#4A4664", margin: 0 }}>
              It may have been altered on its way here. Reply to the email and the shop can remove you directly.
            </p>
          </>
        ) : state.done ? (
          <>
            <h1 style={{ font: "800 22px/1.3 inherit", margin: "0 0 10px" }}>You&rsquo;re unsubscribed</h1>
            <p style={{ font: "400 15px/1.6 inherit", color: "#4A4664", margin: 0 }}>
              We won&rsquo;t email <b>{state.email}</b> from this store again. Nothing else to do.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ font: "800 22px/1.3 inherit", margin: "0 0 10px" }}>Unsubscribe?</h1>
            <p style={{ font: "400 15px/1.6 inherit", color: "#4A4664", margin: "0 0 20px" }}>
              One tap and this store stops emailing <b>{state.email}</b>.
            </p>
            <Form method="post">
              <button
                type="submit"
                disabled={nav.state !== "idle"}
                style={{
                  font: "800 15px/1 inherit", padding: "13px 24px", borderRadius: 12, border: "none",
                  background: "#14121F", color: "#fff", cursor: "pointer",
                }}
              >
                {nav.state !== "idle" ? "Unsubscribing…" : "Yes, unsubscribe me"}
              </button>
            </Form>
          </>
        )}
      </div>
    </div>
  );
}
