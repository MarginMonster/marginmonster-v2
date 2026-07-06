import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async (_args: LoaderFunctionArgs) => null;

export default function Privacy() {
  const wrap: React.CSSProperties = {
    fontFamily: "Inter, -apple-system, sans-serif",
    maxWidth: 760,
    margin: "0 auto",
    padding: "48px 24px 80px",
    color: "#2B2118",
    background: "#F7F1E1",
    minHeight: "100vh",
    lineHeight: 1.6,
  };
  const h1: React.CSSProperties = { fontFamily: "Poppins, sans-serif", fontSize: 30, margin: "0 0 6px" };
  const h2: React.CSSProperties = { fontFamily: "Poppins, sans-serif", fontSize: 19, margin: "28px 0 8px" };

  return (
    <div style={wrap}>
      <h1 style={h1}>MarginMonster — Privacy Policy</h1>
      <p style={{ color: "#6B5F4F", marginTop: 0 }}>Last updated: July 2026</p>

      <p>
        MarginMonster ("we", "the app") helps Shopify merchants generate marketing
        content and run advertising campaigns. This policy explains what data we
        access, why, and how we protect it.
      </p>

      <h2 style={h2}>What we access</h2>
      <ul>
        <li><strong>Store & product data</strong> — your store name, description, and product catalog, used to generate on-brand content.</li>
        <li><strong>Marketing performance data</strong> — campaign metrics from connected Meta and TikTok ad accounts, used to report ROI and optimize campaigns.</li>
        <li><strong>Account connection tokens</strong> — securely stored credentials for your store and connected ad platforms.</li>
      </ul>
      <p>
        We do <strong>not</strong> request or access your customers' personal
        information (names, emails, orders) to run the app's core features.
      </p>

      <h2 style={h2}>How we use it</h2>
      <p>
        Solely to provide the app's features: generating blog posts, images,
        videos, and ad copy; launching and optimizing campaigns you approve; and
        reporting performance. We never sell your data.
      </p>

      <h2 style={h2}>How we protect it</h2>
      <ul>
        <li>Data is transmitted over encrypted connections (HTTPS).</li>
        <li>Access tokens are stored securely and used only for your store.</li>
        <li>Access is limited to what's required to operate the app.</li>
      </ul>

      <h2 style={h2}>Third-party services</h2>
      <p>
        We use AI providers (for content generation) and advertising platforms
        (Meta, TikTok) strictly to deliver the features you enable. Your data is
        shared with these only as needed to perform the requested action.
      </p>

      <h2 style={h2}>Data retention & deletion</h2>
      <p>
        We retain your data only while the app is installed. When you uninstall,
        your store's data is deleted. You may request deletion anytime by
        contacting us.
      </p>

      <h2 style={h2}>Contact</h2>
      <p>
        Questions or data requests: <a href="mailto:magicmonstermarket@gmail.com" style={{ color: "#A87D1E" }}>magicmonstermarket@gmail.com</a>
      </p>
    </div>
  );
}
