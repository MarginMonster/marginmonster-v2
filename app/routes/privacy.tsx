import type { MetaFunction } from "@remix-run/node";

/* Privacy policy for the standalone product.
 *
 * The previous version described a Shopify app: it opened "helps Shopify
 * merchants", scoped retention to "while the app is installed" / "when you
 * uninstall" (there is no install or uninstall here), never mentioned the
 * name, email and password collected at signup or the card handled by
 * Stripe, and pointed data requests at magicmonstermarket@gmail.com — a
 * different company's personal address. All four are corrected below; the
 * data categories now match what the code actually stores. */

export const meta: MetaFunction = () => [
  { title: "Privacy Policy — EasyMode" },
  { name: "description", content: "What EasyMode collects, why, and how to have it deleted." },
  { name: "robots", content: "index,follow" },
];

const CSS = `
.lg{--ink:#14201A;--ink2:#4B5450;--cream:#F7F6EB;--line:#E0E4D4;--green:#0C7A46;
  background:var(--cream);color:var(--ink);min-height:100vh;
  font:16px/1.68 Poppins,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
.lg-in{max-width:720px;margin:0 auto;padding:56px 24px 88px;}
.lg a{color:var(--green);}
.lg h1{font-size:clamp(26px,5vw,34px);line-height:1.15;letter-spacing:-.02em;margin:0 0 6px;}
.lg .upd{color:var(--ink2);font-size:14px;margin:0 0 30px;}
.lg h2{font-size:18px;letter-spacing:-.01em;margin:34px 0 8px;padding-top:16px;border-top:1px solid var(--line);}
.lg p,.lg li{color:var(--ink2);}
.lg li{margin:5px 0;}
.lg strong{color:var(--ink);}
.lg .back{display:inline-block;margin-top:38px;font-weight:600;text-decoration:none;}
`;

export default function Privacy() {
  return (
    <div className="lg">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="lg-in">
        <h1>Privacy Policy</h1>
        <p className="upd">Last updated: 1 September 2026</p>

        <p>
          EasyMode generates marketing content from the products on your store and can
          publish it to social accounts you connect. It works with any store — there is no
          platform app to install. This policy explains what we collect, why, and how to have
          it removed.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li><strong>Account details</strong> — the name or brand you enter, your email address, and a password we store only as a salted hash. We never store your password itself.</li>
          <li><strong>Your store address and catalog</strong> — the storefront URL you give us, and the product names, prices, descriptions and images we read from it, so generated content describes real products at real prices.</li>
          <li><strong>Connected social accounts</strong> — access tokens for the TikTok, Instagram or Facebook accounts you link, used only to publish content you approved.</li>
          <li><strong>Content you generate</strong> — the videos, images, articles and captions produced for you, and which of them you approved or published.</li>
          <li><strong>Usage and billing records</strong> — plan, token balance and spend history, and basic technical logs (IP address, browser, timestamps) used to keep the service running and to stop abuse.</li>
        </ul>
        <p>
          We do <strong>not</strong> collect your customers' personal information. We do not
          need your order data and do not ask for it.
        </p>

        <h2>Payment information</h2>
        <p>
          Payments are processed by <strong>Stripe</strong>. Your card details go to Stripe
          directly and are never sent to or stored on our servers — we keep only your
          subscription status and the plan you are on.
        </p>

        <h2>How we use it</h2>
        <p>
          Only to run the features you asked for: reading your catalog, generating content,
          publishing what you approve, metering tokens, billing your plan, and supporting you
          when you write in. <strong>We do not sell your data</strong>, and we do not use your
          catalog or your content to train our own models.
        </p>

        <h2>Who we share it with</h2>
        <p>
          Your product information and prompts are sent to the AI providers that generate the
          content — Anthropic (Claude), Google, ByteDance, Kuaishou and MiniMax — and to the
          social platform you chose to publish on. Stripe handles payment. Each receives only
          what that specific action requires. We do not share your data with anyone else.
        </p>

        <h2>How we protect it</h2>
        <ul>
          <li>Everything travels over encrypted connections (HTTPS).</li>
          <li>Passwords are stored as salted hashes, never in readable form.</li>
          <li>Platform access tokens are stored encrypted and scoped to your account alone.</li>
        </ul>

        <h2>How long we keep it</h2>
        <p>
          We keep your account data for as long as your account exists, so that cancelling a
          plan never destroys the work you generated. We do not delete it on a timer. When you
          ask us to delete your account we remove it and the content in it, except billing
          records we are required to keep for tax and accounting.
        </p>

        <h2>Your rights</h2>
        <p>
          You can ask us for a copy of your data, ask us to correct it, or ask us to delete
          your account and everything in it — including disconnecting any linked social
          accounts. Write to the address below and we will action it. You can also disconnect
          a social account yourself at any time from your account settings.
        </p>

        <h2>Cookies</h2>
        <p>
          We use a session cookie to keep you signed in. Your chosen language is remembered in
          your own browser and is never sent to us. We do not run third-party advertising or
          tracking cookies on this site.
        </p>

        <h2>Contact</h2>
        <p>
          Privacy questions, data copies and deletion requests:{" "}
          <a href="mailto:hello@easymodeapp.com">hello@easymodeapp.com</a>.
        </p>

        <a className="back" href="/">← Back to EasyMode</a>
      </div>
    </div>
  );
}
