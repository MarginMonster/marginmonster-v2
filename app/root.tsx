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
} from "@remix-run/node";
import { addDocumentResponseHeaders } from "./shopify.server";

// Branded favicon — without it browsers show the cheap generic globe.
export const links: LinksFunction = () => [
  { rel: "icon", type: "image/png", href: "/easymode-head.png" },
  { rel: "apple-touch-icon", href: "/easymode-head.png" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const headers = new Headers();
  await addDocumentResponseHeaders(request, headers);
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
