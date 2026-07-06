import { json, type LoaderFunctionArgs } from "@remix-run/node";

// TEMP diagnostic: confirms which Shopify credentials the live server has.
// Exposes only the public client id + a short secret prefix (not the secret).
// Remove after debugging.
export const loader = async (_args: LoaderFunctionArgs) => {
  const key = process.env.SHOPIFY_API_KEY || "";
  const secret = process.env.SHOPIFY_API_SECRET || "";
  return json({
    apiKey: key,
    apiKeyMatchesNewApp: key === "7569bd125783be1a0582dab6760dd34f",
    hasSecret: !!secret,
    secretPrefix: secret.slice(0, 9),
    secretLength: secret.length,
    appUrl: process.env.SHOPIFY_APP_URL || "",
  });
};
