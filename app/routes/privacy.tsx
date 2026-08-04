/* Minimal, honest legal page — linked from the public footer. */
export default function Privacy() {
  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "56px 22px", font: "16px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: "#22271f" }}>
      <h1 style={{ fontSize: 30 }}>Privacy Policy</h1>
      <p>EasyMode stores the account details you give us, your store's product catalogue, and the content we generate for you — used only to run the service. Social accounts you link are used solely to publish posts you approve. We never sell your data. Generated media may be processed by our AI providers (Anthropic, Google, fal.ai, Replicate, MiniMax) to fulfil your requests.</p>
      <p>Attribution links in your posts count clicks so your dashboard can show what worked. Delete your account any time — your data goes with it. Questions: <a href="mailto:hello@easymodeapp.com">hello@easymodeapp.com</a>.</p>
      <p><a href="/">← Back to EasyMode</a></p>
    </main>
  );
}
