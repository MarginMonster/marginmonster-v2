import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "@remix-run/react";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  HeadersFunction,
  MetaFunction,
} from "@remix-run/node";
import { addDocumentResponseHeaders } from "./shopify.server";

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
  { rel: "icon", type: "image/png", href: "/easymode-head.png" },
  { rel: "apple-touch-icon", href: "/easymode-head.png" },
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
  return new Response(null, { status: 200, headers });
};

export const headers: HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
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
      : "Something went wrong on our end";
  // A deploy swaps the server out from under an in-flight request, which is
  // by far the most common way a merchant lands here. Reloading genuinely
  // fixes it, so say so rather than making them guess.
  const body = notFound
    ? "The link may be old, or the page may have moved."
    : "This one’s on us. Reloading usually clears it — if we were mid-update, the page you wanted is already back.";
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
        <Links />
      </head>
      <body style={{ margin: 0, background: "#F4F1E6", color: "#14201A", fontFamily: "Inter, -apple-system, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 460, textAlign: "center", background: "#FDFCF7", border: "1px solid #E1DECD", borderRadius: 18, padding: "36px 28px" }}>
            <img src="/easymode-head.png" alt="" width={56} height={56} style={{ borderRadius: 14 }} />
            <h1 style={{ fontFamily: "Poppins, sans-serif", fontWeight: 800, fontSize: 22, margin: "14px 0 8px" }}>{title}</h1>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: "#4A554E", margin: "0 0 22px" }}>{body}</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              {!notFound && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  style={{ padding: "11px 20px", borderRadius: 12, border: "none", background: "#0C7A46", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
                >
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
