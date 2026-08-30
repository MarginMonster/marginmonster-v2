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
import { useLoaderData } from "@remix-run/react";
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

export const loader = async ({ params }: LoaderFunctionArgs) => json(await optOut(params.token));

export const action = async ({ params }: ActionFunctionArgs) => {
  const r = await optOut(params.token);
  return json({ ok: r.ok }, { status: r.ok ? 200 : 400 });
};

export default function Unsubscribed() {
  const data = useLoaderData<typeof loader>();
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
        {data.ok ? (
          <>
            <h1 style={{ font: "800 22px/1.3 inherit", margin: "0 0 10px" }}>You&rsquo;re unsubscribed</h1>
            <p style={{ font: "400 15px/1.6 inherit", color: "#4A4664", margin: 0 }}>
              We won&rsquo;t email <b>{data.email}</b> from this store again. Nothing else to do.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ font: "800 22px/1.3 inherit", margin: "0 0 10px" }}>That link didn&rsquo;t work</h1>
            <p style={{ font: "400 15px/1.6 inherit", color: "#4A4664", margin: 0 }}>
              It may have been altered on its way here. Reply to the email and the shop can remove you directly.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
