/* Web socials — link TikTok / Instagram / Facebook through the upload-post
 * hosted connect page, exactly like the embedded app. Once linked, the
 * Archive's "Post" button auto-publishes with AI captions + #EasyModeAi. */

import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { connectUrl, refreshLinkedPlatforms, socialProviderEnabled } from "../lib/social-provider.server";
import { externalOrigin } from "../lib/origin.server";
import { Ico } from "../lib/icons";
import { useT, useUiLang } from "../lib/ui-lang";
import { readUiLang, tr } from "../lib/ui-i18n";

const PLAT_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" };
const PLATFORMS = ["tiktok", "instagram", "facebook"] as const;

// "TikTok, Instagram and Facebook" with the active language's grammar, falling
// back to a manual " and " join where Intl.ListFormat is unavailable.
function fmtList(items: string[], lang: string): string {
  if (items.length < 2) return items.join("");
  try {
    return new Intl.ListFormat(lang, { style: "long", type: "conjunction" }).format(items);
  } catch {
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  }
}

// Merchants keep several of these open at once; an untitled tab is just a URL.
export const meta = ({ matches }: { matches: Array<{ id: string; data: unknown }> }) => {
  const uiLang = (matches.find((m) => m.id === "root")?.data as { uiLang?: string } | null)?.uiLang;
  return [{ title: tr((uiLang || "en") as Parameters<typeof tr>[0], "Auto-posting") + " · EasyMode" }];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const enabled = socialProviderEnabled();
  const linked = enabled ? (await refreshLinkedPlatforms(shop.id)).filter((p) => p in PLAT_LABEL) : [];
  return json({ enabled, linked });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const lang = readUiLang(request);
  const { shop } = await requireWebIdentity(request);
  if (!socialProviderEnabled()) return json({ error: tr(lang, "Social posting is coming online — check back shortly.") });
  // externalOrigin, because request.url is http:// behind Render’s edge and
  // this address is where the provider sends the merchant back.
  const url = await connectUrl(shop.id, `${externalOrigin(request)}/web/connect`);
  if (!url) return json({ error: tr(lang, "Couldn't open the connect page — try again in a moment.") });
  return redirect(url);
};

export default function WebConnect() {
  const { enabled, linked } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const actionError = actionData && "error" in actionData ? actionData.error : null;
  const nav = useNavigation();
  const t = useT();
  const lang = useUiLang();
  const linkedNames = PLATFORMS.filter((p) => linked.includes(p)).map((p) => PLAT_LABEL[p]);
  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: CONNECT_CSS }} />
      <h1 className="wb-h1">{t("Auto-posting")}</h1>
      <p className="wb-sub">{t("Link your socials once — then every piece can post itself with an AI caption (and the #EasyModeAi disclosure) in one tap from the Archive.")}</p>
      <p style={{ fontSize: "12.5px", color: "#6A756E", margin: "10px 0 0", lineHeight: 1.6 }}>
        <b style={{ color: "#0C7A46" }}>{t("Social Marketing")}</b>{t(" posts three ways — ")}
        <Link to="/web/campaigns" style={{ color: "#0C7A46", fontWeight: 700 }}>{t("Campaigns")}</Link>{t(" (a one-month push)")}{" · "}
        <Link to="/web/product-channels" style={{ color: "#0C7A46", fontWeight: 700 }}>{t("Channels")}</Link>{t(" (always-on)")}{" · "}
        <b style={{ color: "#14201A" }}>{t("Auto-posting")}</b>{t(" (connect accounts)")}
      </p>
      {!enabled && <div className="wb-info">{t("Social posting is coming online — check back shortly.")}</div>}
      {actionError && <div className="wb-err">{actionError}</div>}
      <div className="wb-card wc-card">
        <div className="wc-title">{t("Connected accounts")}</div>
        <div className="wc-chips">
          {PLATFORMS.map((p) => {
            const on = linked.includes(p);
            return (
              <span className={`wc-chip${on ? " on" : ""}`} key={p}>
                <i className={`wc-dot wc-dot-${p}`} aria-hidden="true">{on ? "✓" : ""}</i>
                {PLAT_LABEL[p]}
                {!on && <em>{t("not linked")}</em>}
              </span>
            );
          })}
        </div>
        {linkedNames.length > 0 ? (
          <p className="wc-armed"><Ico n="bolt" /> {t("Armed on {names} — pieces can post themselves from the Archive.", { names: fmtList(linkedNames, lang) })}</p>
        ) : (
          <div className="wc-empty">
            <Ico n="link" size={26} />
            <div>
              <div className="wc-empty-h">{t("Nothing linked yet")}</div>
              <p className="wb-note">{t("Link one account and your pieces can post themselves hands-free — an AI caption and the #EasyModeAi disclosure, one tap from the Archive.")}</p>
            </div>
          </div>
        )}
        <Form method="post">
          <button className="wb-btn" disabled={!enabled || nav.state !== "idle"}>
            {!enabled
              ? t("Coming soon")
              : nav.state !== "idle"
                ? t("Opening the connect page…")
                : linked.length
                  ? <>{t("Manage accounts")} →</>
                  : <>{t("Link TikTok, Instagram & Facebook")} →</>}
          </button>
        </Form>
        {linked.length > 0 && (
          <p className="wb-note" style={{ margin: "10px 0 0" }}>{t("Manage opens the connect page, where you can unlink an account at any time.")}</p>
        )}
      </div>
      <p className="wb-note" style={{ marginTop: 18 }}>
        {t("Linked already? Post anything from the")} <Link to="/web/archive">{t("Archive")}</Link>.
      </p>
    </div>
  );
}

const CONNECT_CSS = `
.wc-card{max-width:480px;}
.wc-title{font-family:Poppins,sans-serif;font-weight:800;font-size:16px;color:var(--ink);}
.wb-info{margin:14px 0;padding:12px 16px;border-radius:12px;background:#EEF3F0;border:1px solid var(--line2);color:var(--ink2);font-size:13.5px;}
/* Empty state: a quiet icon + a two-line prompt, so "nothing linked" reads as
   an invitation rather than a lonely sentence. */
.wc-empty{display:flex;gap:11px;align-items:flex-start;margin:12px 0 15px;color:var(--ink2);}
.wc-empty svg{flex:0 0 auto;margin-top:1px;opacity:.6;}
.wc-empty-h{font-family:Poppins,sans-serif;font-weight:700;font-size:13.5px;color:var(--ink);margin-bottom:2px;}
.wc-empty .wb-note{margin:0;max-width:40ch;}
.wc-chips{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px;}
.wc-chip{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:999px;border:1px solid var(--line);
  background:#fff;font-size:12.5px;font-weight:700;color:var(--ink2);}
.wc-chip em{font-style:normal;font-size:10.5px;font-weight:600;color:var(--ink2);opacity:.7;}
.wc-chip.on{color:#0A3D26;background:#EAF6EF;border-color:#BFE2CD;}
/* Unlinked = a hollow ring (brand-tinted border) so it reads as "available",
   not a glitchy solid grey dot. Linked = the brand color fills in. */
.wc-dot{width:16px;height:16px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:900;color:#fff;
  background:transparent;border:2px solid currentColor;box-sizing:border-box;flex:0 0 auto;}
.wc-dot-tiktok{color:#010101;}
.wc-dot-instagram{color:#C13584;}
.wc-dot-facebook{color:#1877F2;}
.wc-chip.on .wc-dot{border-color:transparent;color:#fff;}
.wc-chip.on .wc-dot-tiktok{background:#010101;}
.wc-chip.on .wc-dot-instagram{background:radial-gradient(circle at 30% 107%,#FDF497 0%,#FD5949 45%,#D6249F 70%,#285AEB 100%);}
.wc-chip.on .wc-dot-facebook{background:#1877F2;}
.wc-armed{margin:10px 0 14px;font-size:13px;font-weight:600;color:#0A3D26;background:#EAF6EF;border:1px solid #BFE2CD;
  border-radius:12px;padding:9px 13px;}
`;
