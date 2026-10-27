import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "@remix-run/react";
import { json } from "@remix-run/node";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  HeadersFunction,
  MetaFunction,
} from "@remix-run/node";
import { addDocumentResponseHeaders } from "./shopify.server";
import { readUiLang, uiLangDir } from "./lib/ui-i18n";
import { UiLangProvider } from "./lib/ui-lang";

/* Default document head. <Meta /> was already wired up below, but not one
 * route in the app exported a meta function, so every page — the marketing
 * site included — shipped with no <title> and no description at all. Browser
 * tabs showed a bare URL, and a shared link previewed as naked text.
 *
 * Routes that have something more specific to say override this. */
export const meta: MetaFunction = () => [
  { title: "EasyMode — marketing on easy mode" },
];

// Branded favicon — without it browsers show the cheap generic globe.
export const links: LinksFunction = () => [
  // A real /favicon.ico as well as the PNG: browsers, link unfurlers and
  // uptime checkers request the bare path regardless of any <link>, and
  // without the file Remix logged a full router stack trace for every page
  // view ("No route matches URL /favicon.ico") while the tab stayed blank in
  // anything that ignores the PNG hint. 32px, made from helpurr-icon.png.
  // ?v= busts the 1-year `immutable` static cache: favicon.ico was overwritten
  // at the same URL, so without a new query browsers hold the old icon for a year.
  // Browser tab = the TRANSPARENT cut-out cat (no white box in the tab). The iOS
  // home-screen tile must be opaque, so apple-touch is the cat on a WHITE tile.
  { rel: "icon", href: "/favicon.ico?v=5", sizes: "32x32" },
  { rel: "icon", type: "image/png", href: "/helpurr-icon.png?v=3" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=2" },
  // Open the font connections before the CSS that needs them is parsed.
  // These were @import-ed from inside an injected <style>, which cost
  // three sequential round trips before any text rendered in Poppins.
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" },
];

/* Baseline security headers.
 *
 * The live app sent NONE — no HSTS, no nosniff, no referrer policy, and
 * nothing stopping any site on the internet from putting easymodeapp.com in
 * an invisible iframe. That last one matters most: the web app is where a
 * merchant logs in, changes their plan and spends tokens, and every one of
 * those is a click a framed page can steal.
 *
 * Framing is denied by PATH, not globally, because the Shopify app is
 * *supposed* to be framed — it lives inside the Shopify admin, and its own
 * route exports boundary.headers to say so. Sending DENY there would break
 * the embedded app entirely. /auth is left alone for the same reason: it is
 * part of the Shopify install handshake.
 *
 * Deliberately NOT a full Content-Security-Policy. script-src on a Remix +
 * Polaris app with inline hydration and Google Fonts needs to be built and
 * tested route by route, and a wrong one is a white screen. frame-ancestors
 * is the part that carries the risk here, and it stands alone safely. */
function applySecurityHeaders(request: Request, headers: Headers): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // No includeSubDomains: this asserts a policy for hosts we have not audited.
  headers.set("Strict-Transport-Security", "max-age=31536000");

  const path = new URL(request.url).pathname;
  const mustBeFramable = path === "/app" || path.startsWith("/app/") || path.startsWith("/auth");
  if (mustBeFramable) return;
  // Only if nothing upstream already decided — never clobber a real CSP.
  if (!headers.has("Content-Security-Policy")) {
    headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    headers.set("X-Frame-Options", "DENY");
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const headers = new Headers();
  await addDocumentResponseHeaders(request, headers);
  applySecurityHeaders(request, headers);
  // The chosen UI display language, resolved once here so SSR renders the whole
  // document in it (no English-then-swap flash) and <html lang> is correct for
  // screen readers and the browser's own UI.
  const uiLang = readUiLang(request);
  return json({ uiLang }, { headers });
};

export const headers: HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export default function App() {
  const { uiLang } = useLoaderData<typeof loader>();
  return (
    <html lang={uiLang} dir={uiLangDir(uiLang)}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <UiLangProvider lang={uiLang}>
          <Outlet />
        </UiLangProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/* THE MERCHANT MUST NEVER SEE A STACK TRACE.
 *
 * Nothing outside app/routes/app.tsx exported an ErrorBoundary, so every
 * throw on the web surface — a loader that failed, a 404, and in particular
 * a form submitted while a deploy was swapping the server — rendered Remix's
 * default page: the literal text "Application Error" over a JavaScript stack
 * naming our bundle files and line numbers. It tells the merchant nothing,
 * offers them no way forward, and hands anyone who can provoke an error a
 * look inside the build.
 *
 * app/routes/app.tsx has its own boundary and keeps it; this one catches
 * everything else, /web/* included.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const routeError = isRouteErrorResponse(error) ? error : null;
  const notFound = routeError?.status === 404;
  const title = notFound
    ? "That page isn’t here"
    : routeError?.status === 403
      ? "You don’t have access to that"
      : "EasyMode just updated";
  // A deploy swaps the server out from under an in-flight request, which is by
  // far the most common way a merchant lands here — so frame it as the update it
  // almost always is, not a crash. Reloading genuinely fixes it.
  const body = notFound
    ? "The link may be old, or the page may have moved."
    : routeError?.status === 403
      ? "You don’t have permission to view this page."
      : "We pushed a quick update while you were here — give it a reload and you’ll pick right back up where you left off. Nothing’s lost on your end.";
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* No <Meta />: the root meta export emits its own <title>, and two
            titles in one document is a coin toss over which the browser shows. */}
        {/* One expression, not text + expression: React SSR splits mixed
            children with a <!-- --> marker, and inside <title> that marker is
            literal text — the tab read “That page isn’t here<!-- --> ·
            EasyMode”. */}
        <title>{`${title} · EasyMode`}</title>
        {/* This page renders outside the shell, so it has none of the shell CSS —
            give the reload button the EasyMode treatment (gold GStyle rosette
            peeking from the right) here. */}
        <style dangerouslySetInnerHTML={{ __html:
          ".em-reload{position:relative;overflow:hidden;isolation:isolate;padding:11px 22px;border-radius:12px;border:none;background:#0C7A46;color:#fff;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit}" +
          ".em-reload::after{content:'';position:absolute;z-index:-1;top:50%;right:-10px;width:48px;height:48px;transform:translateY(-50%);background:#FFD24A;-webkit-mask:url(/gstyle-rosette.svg) center/contain no-repeat;mask:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.32;pointer-events:none}" +
          ".em-reload:hover{filter:brightness(1.07)}"
        }} />
        <Links />
      </head>
      <body style={{ margin: 0, background: "#F4F1E6", color: "#14201A", fontFamily: "Inter, -apple-system, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 460, textAlign: "center", background: "#FDFCF7", border: "1px solid #E1DECD", borderRadius: 18, padding: "36px 28px" }}>
            <img src="/helpurr-icon.png?v=3" alt="" width={56} height={56} style={{ borderRadius: 14 }} />
            <h1 style={{ fontFamily: "Poppins, sans-serif", fontWeight: 800, fontSize: 22, margin: "14px 0 8px" }}>{title}</h1>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: "#4A554E", margin: "0 0 22px" }}>{body}</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              {!notFound && (
                <button type="button" className="em-reload" onClick={() => window.location.reload()}>
                  Reload the page
                </button>
              )}
              <a
                href="/web"
                style={{ padding: "11px 20px", borderRadius: 12, border: "1px solid #E1DECD", background: "#FDFCF7", color: "#14201A", fontWeight: 700, fontSize: 14, textDecoration: "none" }}
              >
                Back to my dashboard
              </a>
            </div>
          </div>
        </main>
        <Scripts />
      </body>
    </html>
  );
}
