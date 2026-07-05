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
import { json } from "@remix-run/node";
import { addDocumentResponseHeaders } from "./shopify.server";

export const links: LinksFunction = () => [];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const headers = new Headers();
  await addDocumentResponseHeaders(request, headers);
  return json(null, { headers });
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
