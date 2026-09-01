import type { MetaFunction } from "@remix-run/node";

/* Terms for a standalone subscription product.
 *
 * The previous version was two paragraphs. It named no billing date, no
 * refund position, no cancellation mechanics and no account terms — on a
 * product that takes a card, starts a trial, and renews monthly. Everything
 * below states what the code actually does (7-day trial, Stripe,
 * cancel_at_period_end, tokens that do not roll over) rather than boilerplate.
 *
 * NOT LEGAL ADVICE and deliberately incomplete: there is no governing-law,
 * liability-cap or dispute clause here, because inventing a jurisdiction and
 * an entity name for someone else's company would be worse than omitting
 * them. Those need a lawyer and the registered entity details. */

export const meta: MetaFunction = () => [
  { title: "Terms of Service — EasyMode" },
  { name: "description", content: "The terms that apply to your EasyMode subscription." },
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
.lg .back{display:inline-block;margin-top:38px;font-weight:600;text-decoration:none;}
.lg .note{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-size:14.5px;}
`;

export default function Terms() {
  return (
    <div className="lg">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="lg-in">
        <h1>Terms of Service</h1>
        <p className="upd">Last updated: 1 September 2026</p>

        <p>
          EasyMode turns the products on your store into marketing content — videos, image
          ads, articles and landing pages — and can publish that content to social accounts
          you connect. These terms apply to your use of easymodeapp.com and the EasyMode
          application. By creating an account you accept them.
        </p>

        <h2>Your account</h2>
        <p>
          You need an account to use EasyMode. Keep your password to yourself; you are
          responsible for what happens under your account. Give us an email address you can
          actually receive mail at — it is how we reach you about billing and how you
          recover access.
        </p>

        <h2>Free trial</h2>
        <p>
          Every plan starts with a <strong>7-day free trial</strong>. During the trial you can
          use every generator your plan unlocks, limited to your plan's token allowance (up
          to 400 tokens). If you cancel before the trial ends you are charged nothing. If you
          do not cancel, the plan you selected begins and your card is charged on day 7.
        </p>

        <h2>Subscriptions and billing</h2>
        <ul>
          <li>Plans are billed monthly or annually in advance, in US dollars, through Stripe. We never see or store your full card number.</li>
          <li>Your subscription renews automatically at the end of each period until you cancel.</li>
          <li>Each plan includes a monthly token allowance. <strong>Tokens do not roll over</strong> — the allowance resets each billing period. Tokens you purchase separately as top-ups are not part of that reset and remain until spent.</li>
          <li>Prices can change. If a price changes we will tell you before it applies to your renewal, and you can cancel first.</li>
        </ul>

        <h2>Cancelling</h2>
        <p>
          You can cancel at any time from your account. Cancelling stops the next renewal —
          your plan stays active for the rest of the period you have already paid for, and we
          do not cut it short. Everything you generated stays yours after cancellation.
        </p>

        <h2>Refunds</h2>
        <p>
          Because generation spends real compute the moment you request it, paid periods are
          non-refundable once the period has begun, and spent tokens are not refundable. Two
          exceptions: if a generation fails on our side, the tokens for it are returned to
          your wallet automatically; and if you were billed in error, write to us and we will
          put it right.
        </p>

        <h2>Your content and ours</h2>
        <p>
          You keep ownership of your products, your brand and everything EasyMode generates
          for you, and you may use it commercially. You give us permission to process your
          product information for the purpose of generating that content. You are responsible
          for reviewing anything before it is published — AI gets things wrong, which is why
          nothing publishes without your approval.
        </p>

        <h2>AI disclosure</h2>
        <p>
          Content produced by EasyMode is AI-generated and is labelled as such when posted,
          including the disclosure tags the platforms require. Do not remove those labels.
        </p>

        <h2>Acceptable use</h2>
        <ul>
          <li>No unlawful, deceptive or infringing products, and no using someone else's brand, likeness or copyrighted work without the right to do so.</li>
          <li>No reselling EasyMode output as a generation service of your own.</li>
          <li>No attempting to break, overload or reverse-engineer the service.</li>
        </ul>
        <p>We may suspend an account that breaks these rules.</p>

        <h2>Availability</h2>
        <p>
          EasyMode depends on third-party AI providers and social platforms. We do not
          promise uninterrupted service, and features can change as those providers change.
          The service is provided as-is.
        </p>

        <h2>Changes to these terms</h2>
        <p>
          If we change these terms materially we will say so on this page and update the date
          above. Continuing to use EasyMode after that means you accept the change.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms or your bill: <a href="mailto:hello@easymodeapp.com">hello@easymodeapp.com</a>.
        </p>

        <a className="back" href="/">← Back to EasyMode</a>
      </div>
    </div>
  );
}
