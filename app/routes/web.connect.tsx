/* Web socials — link TikTok / Instagram / Facebook through the upload-post
 * hosted connect page, exactly like the embedded app. Once linked, the
 * Archive's "Post" button auto-publishes with AI captions + #EasyModeAi. */

import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { connectUrl, refreshLinkedPlatforms, socialProviderEnabled } from "../lib/social-provider.server";

const PLAT_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" };
const PLATFORMS = ["tiktok", "instagram", "facebook"] as const;

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
  const actionData = useActionData<typeof action>();
  const actionError = actionData && "error" in actionData ? actionData.error : null;
  const nav = useNavigation();
  const linkedNames = PLATFORMS.filter((p) => linked.includes(p)).map((p) => PLAT_LABEL[p]);
  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: CONNECT_CSS }} />
      <h1 className="wb-h1">Auto-posting</h1>
      <p className="wb-sub">Link your socials once — then every piece can post itself with an AI caption (and the #EasyModeAi disclosure) in one tap from the Archive.</p>
      {!enabled && <div className="wb-err">Social posting is coming online — check back shortly.</div>}
      {actionError && <div className="wb-err">{actionError}</div>}
      <div className="wb-card" style={{ maxWidth: 480 }}>
        <div className="wb-price-name">Connected accounts</div>
        <div className="wc-chips">
          {PLATFORMS.map((p) => {
            const on = linked.includes(p);
            return (
              <span className={`wc-chip${on ? " on" : ""}`} key={p}>
                <i className="wc-dot" aria-hidden="true">{on ? "✓" : ""}</i>
                {PLAT_LABEL[p]}
                {!on && <em>not linked</em>}
              </span>
            );
          })}
        </div>
        {linkedNames.length > 0 ? (
          <p className="wc-armed">⚡ Armed on {linkedNames.join(linkedNames.length === 2 ? " and " : ", ")} — pieces can post themselves from the Archive.</p>
        ) : (
          <p className="wb-note" style={{ margin: "10px 0 14px" }}>Nothing linked yet.</p>
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

const CONNECT_CSS = `
.wc-chips{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px;}
.wc-chip{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:999px;border:1px solid var(--line);
  background:#fff;font-size:12.5px;font-weight:700;color:var(--ink2);}
.wc-chip em{font-style:normal;font-size:10.5px;font-weight:600;color:var(--ink2);opacity:.7;}
.wc-chip.on{color:#0A3D26;background:#EAF6EF;border-color:#BFE2CD;}
.wc-dot{width:16px;height:16px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:900;color:#fff;
  background:#D8D3C2;flex:0 0 auto;}
.wc-chip.on .wc-dot{background:#12A85E;}
.wc-armed{margin:10px 0 14px;font-size:13px;font-weight:600;color:#0A3D26;background:#EAF6EF;border:1px solid #BFE2CD;
  border-radius:12px;padding:9px 13px;}
`;
