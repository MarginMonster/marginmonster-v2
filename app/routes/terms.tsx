/* Minimal, honest legal page — linked from the public footer. */
export default function Terms() {
  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "56px 22px", font: "16px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: "#22271f" }}>
      <h1 style={{ fontSize: 30 }}>Terms of Service</h1>
      <p>EasyMode generates marketing content from your products on a subscription with monthly tokens. You own the content generated for your store and are responsible for reviewing it before publishing. AI-generated posts carry the #EasyModeAi disclosure tag. Plans renew monthly (or annually) until cancelled; cancel any time and everything you generated stays yours.</p>
      <p>Fair use: no unlawful products, no infringing use of third-party brands, no reselling generated output as a service. We may update these terms with notice. Questions: <a href="mailto:hello@easymodeapp.com">hello@easymodeapp.com</a>.</p>
      <p><a href="/">← Back to EasyMode</a></p>
    </main>
  );
}
