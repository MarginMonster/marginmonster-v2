/* Web socials — link TikTok / Instagram / Facebook through the upload-post
 * hosted connect page, exactly like the embedded app. Once linked, the
 * Archive's "Post" button auto-publishes with AI captions + #EasyModeAi. */

import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { connectUrl, refreshLinkedPlatforms, socialProviderEnabled } from "../lib/social-provider.server";

const PLAT_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const enabled = socialProviderEnabled();
  const linked = enabled ? (await refreshLinkedPlatforms(shop.id)).filter((p) => p in PLAT_LABEL) : [];
  return json({ enabled, linked });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  if (!socialProviderEnabled()) return json({ error: "Social posting is coming online — check back shortly." });
  const url = await connectUrl(shop.id, `${new URL(request.url).origin}/web/connect`);
  if (!url) return json({ error: "Couldn't open the connect page — try again in a moment." });
  return redirect(url);
};

export default function WebConnect() {
  const { enabled, linked } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  return (
    <div>
      <h1 className="wb-h1">Auto-posting</h1>
      <p className="wb-sub">Link your socials once — then every piece can post itself with an AI caption (and the #EasyModeAi disclosure) in one tap from the Archive.</p>
      {!enabled && <div className="wb-err">Social posting is coming online — check back shortly.</div>}
      <div className="wb-card" style={{ maxWidth: 480 }}>
        <div className="wb-price-name">Connected accounts</div>
        {linked.length === 0 ? (
          <p className="wb-note" style={{ margin: "8px 0 14px" }}>Nothing linked yet.</p>
        ) : (
          <ul className="wb-feats" style={{ margin: "10px 0 14px" }}>
            {linked.map((p) => <li key={p}>{PLAT_LABEL[p]} linked</li>)}
          </ul>
        )}
        <Form method="post">
          <button className="wb-btn" disabled={!enabled || nav.state !== "idle"}>
            {linked.length ? "Manage / link more →" : "Link TikTok, Instagram & Facebook →"}
          </button>
        </Form>
      </div>
      <p className="wb-note" style={{ marginTop: 18 }}>
        Linked already? Post anything from the <Link to="/web/archive">Archive</Link>.
      </p>
    </div>
  );
}
