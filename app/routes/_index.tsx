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
      {/* AdArcade — Screen-Play mark */}
      <svg width="104" height="104" viewBox="0 0 512 512" role="img" aria-label="AdArcade" style={{ marginBottom: 20 }}>
        <defs>
          <linearGradient id="cy" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7bf3f1" /><stop offset="100%" stopColor="#1fb6b3" />
          </linearGradient>
        </defs>
        <rect x="16" y="16" width="480" height="480" rx="112" fill="#12101E" stroke="#34E7E4" strokeWidth="8" />
        <rect x="120" y="120" width="272" height="272" rx="36" fill="#05131B" stroke="#34E7E4" strokeWidth="5" />
        <g stroke="#34E7E4" strokeWidth="3" opacity="0.10">
          <line x1="132" y1="164" x2="380" y2="164" /><line x1="132" y1="200" x2="380" y2="200" /><line x1="132" y1="236" x2="380" y2="236" /><line x1="132" y1="272" x2="380" y2="272" /><line x1="132" y1="308" x2="380" y2="308" /><line x1="132" y1="344" x2="380" y2="344" />
        </g>
        <path d="M214 186 L344 256 L214 326 Z" fill="url(#cy)" />
      </svg>
      <h1 style={{ fontFamily: "Poppins, sans-serif", fontSize: 40, fontWeight: 800, margin: 0 }}>
        Ad<span style={{ color: "#34E7E4" }}>Arcade</span>
        <span style={{ color: "#F5C451", fontSize: 24 }}>.io</span>
      </h1>
      <p style={{ fontFamily: "monospace", letterSpacing: "0.18em", fontSize: 12, color: "#8A84B6", marginTop: 6 }}>
        ▶ THE MARKETING ARCADE
      </p>
      <p style={{ opacity: 0.75, marginTop: 18, maxWidth: 440 }}>
        AI marketing autopilot for Shopify — content, videos, and ads on
        autopilot. Install from your Shopify admin to get started.
      </p>
    </div>
  );
}
