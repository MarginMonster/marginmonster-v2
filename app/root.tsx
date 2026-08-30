import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
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
