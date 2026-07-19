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
        background: "radial-gradient(120% 90% at 50% 0%, #16142B 0%, #0B0A17 60%)",
        color: "#ECEAFB",
        textAlign: "center",
        padding: 24,
      }}
    >
      {/* EasyMode — the monkey above the name */}
      <img
        src="/easymode-head.png"
        width="132"
        height="104"
        alt="EasyMode monkey"
        style={{ marginBottom: 14, imageRendering: "pixelated", objectFit: "contain" }}
      />
      <h1 style={{ fontFamily: "Poppins, sans-serif", fontSize: 40, fontWeight: 800, margin: 0 }}>
        Easy<span style={{ color: "#F0B429" }}>Mode</span>
        <span style={{ color: "#F5C451", fontSize: 24 }}>.io</span>
      </h1>
      <p style={{ fontFamily: "monospace", letterSpacing: "0.18em", fontSize: 12, color: "#8A84B6", marginTop: 6 }}>
        ◉ MARKETING ON EASY MODE
      </p>
      <p style={{ opacity: 0.75, marginTop: 18, maxWidth: 440 }}>
        AI marketing autopilot for Shopify — content, videos, and ads on
        autopilot. Install from your Shopify admin to get started.
      </p>
    </div>
  );
}
