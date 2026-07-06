import { redirect, type LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Embedded / install traffic always carries a shop param → send to the
  // embedded app area (/app), which performs the App Bridge token exchange.
  // (Redirecting to /auth here breaks fresh installs — it returns null.)
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // No shop param → this is a health check or a bare visit.
  // Return a plain 200 so Render's health check passes.
  return null;
};

export default function Index() {
  return (
    <div
      style={{
        fontFamily: "Inter, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#F7F1E1",
        color: "#2B2118",
        textAlign: "center",
        padding: 24,
      }}
    >
      <h1 style={{ fontFamily: "Poppins, sans-serif", fontSize: 32, margin: 0 }}>
        MarginMonster
      </h1>
      <p style={{ opacity: 0.7, marginTop: 8 }}>
        AI Marketing Autopilot for Shopify. Install from your Shopify admin to
        get started.
      </p>
    </div>
  );
}
