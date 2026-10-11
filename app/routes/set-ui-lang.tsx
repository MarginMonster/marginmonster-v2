/* Resource route that records the UI display language the header pill picked.
 * The pill POSTs { lang } here; we write the uiLang cookie and redirect back
 * to the page it was used on. A full redirect (not a fetcher that stays put)
 * is deliberate: it re-runs every loader, so the root loader re-reads the
 * cookie and the whole app re-renders in the new language, server-side, with
 * no flash of the old one. */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { normalizeUiLang, uiLangCookie } from "../lib/ui-i18n";

// A direct GET normally has nothing to do — except as a SHAREABLE ENTRY LINK:
// /set-ui-lang?lang=zh&to=/web/login sets the UI language cookie and lands the
// visitor on `to` already in that language (handy for beta testers). Without a
// lang param, send stray visitors home.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const langParam = url.searchParams.get("lang");
  if (!langParam) throw redirect("/");
  const lang = normalizeUiLang(langParam);
  // Same-origin, absolute-path destinations only (open-redirect guard).
  const toParam = url.searchParams.get("to") || "";
  const to = toParam.startsWith("/") && !toParam.startsWith("//") ? toParam : "/web/login";
  return redirect(to, { headers: { "Set-Cookie": uiLangCookie(lang) } });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const lang = normalizeUiLang((form.get("lang") as string) || "");
  // Return to wherever the toggle was used, so the choice applies in place.
  // Same-origin only — an off-site Referer is ignored (open-redirect guard).
  let back = "/web";
  try {
    const ref = request.headers.get("Referer");
    if (ref) {
      const u = new URL(ref);
      if (u.origin === new URL(request.url).origin) back = u.pathname + u.search;
    }
  } catch {
    /* malformed Referer — fall back to /web */
  }
  return redirect(back, { headers: { "Set-Cookie": uiLangCookie(lang) } });
};
