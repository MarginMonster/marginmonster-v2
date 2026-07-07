import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import brandStyles from "../brand.css?raw";
import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <style dangerouslySetInnerHTML={{ __html: brandStyles }} />
      <NavMenu>
        <Link to="/app" rel="home">Dashboard</Link>
        <Link to="/app/strategy">Marketing Plan</Link>
        <Link to="/app/plans">Choose Plan</Link>
        <Link to="/app/assets">Content Queue</Link>
        <Link to="/app/calendar">Content Calendar</Link>
        <Link to="/app/videos">Video Studio</Link>
        <Link to="/app/products">The Listing Forge</Link>
        <Link to="/app/funnels">Landing Pages</Link>
        <Link to="/app/connect">Ad Accounts</Link>
        <Link to="/app/campaigns">Campaigns</Link>
        <Link to="/app/performance">Performance & ROI</Link>
      </NavMenu>
      <div className="mm-asteroids" aria-hidden="true">
        <svg className="ast a1" viewBox="0 0 100 100"><polygon points="50,4 74,14 92,40 86,68 66,92 38,90 12,70 6,40 22,16" /></svg>
        <svg className="ast a2" viewBox="0 0 100 100"><polygon points="48,6 70,10 90,34 94,58 78,82 52,94 26,86 8,62 10,32 28,14" /></svg>
        <svg className="ast a3" viewBox="0 0 100 100"><polygon points="50,8 78,22 90,50 76,82 44,92 16,72 10,42 26,18" /></svg>
        <svg className="ast a4" viewBox="0 0 100 100"><polygon points="50,6 80,26 88,56 68,86 36,88 12,62 14,30 32,12" /></svg>
      </div>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = boundary.headers;
