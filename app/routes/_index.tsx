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
      {/* EasyMode — the switch, flipped ON */}
      <svg width="104" height="104" viewBox="0 0 512 512" role="img" aria-label="EasyMode" style={{ marginBottom: 20 }}>
        <defs>
          <linearGradient id="au" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#F5CE62" /><stop offset="55%" stopColor="#F0B429" /><stop offset="100%" stopColor="#C98F12" />
          </linearGradient>
        </defs>
        <rect x="16" y="16" width="480" height="480" rx="112" fill="#14121F" />
        <rect x="16" y="16" width="480" height="480" rx="112" fill="none" stroke="url(#au)" strokeWidth="8" opacity="0.9" />
        <rect x="96" y="186" width="320" height="140" rx="70" fill="none" stroke="url(#au)" strokeWidth="16" />
        <circle cx="346" cy="256" r="46" fill="url(#au)" />
        <circle cx="332" cy="242" r="12" fill="#FFF6DC" opacity="0.85" />
      </svg>
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
