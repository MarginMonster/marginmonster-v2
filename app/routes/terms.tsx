import type { MetaFunction } from "@remix-run/node";
import { LEGAL_CSS, LEGAL_UPDATED, LegalMast, LegalFoot } from "./privacy";

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
 * them. Those need a lawyer and the registered entity details.
 *
 * The page chrome (LEGAL_CSS / LEGAL_UPDATED / masthead / footer) is shared
 * with /privacy via ./privacy so the two pages can never drift apart — they
 * used to carry copy-pasted CSS that had already started to diverge. */

export const meta: MetaFunction = () => [
  { title: "Terms of Service — EasyMode" },
  { name: "description", content: "The terms that apply to your EasyMode subscription." },
  { name: "robots", content: "index,follow" },
];

export default function Terms() {
  return (
    <div className="lg">
      <style dangerouslySetInnerHTML={{ __html: LEGAL_CSS }} />
      <main className="lg-in">
        <LegalMast />
        <h1>Terms of Service</h1>
        <p className="upd">Last updated: {LEGAL_UPDATED}</p>
        <nav className="xref" aria-label="Related pages">
          <a href="/privacy">Privacy Policy</a>
          <a href="/#pricing">Pricing</a>
          <a href="mailto:hello@easymodeapp.com">Contact</a>
        </nav>

        <p>
          EasyMode turns the products on your store into marketing content — videos, image
          ads, articles and landing pages — and can publish that content to social accounts
          you connect. Everything it produces is <a href="#ai">AI-generated</a>, and you review
          what goes out. These terms apply to your use of easymodeapp.com and the EasyMode
          application. By creating an account you accept them.
        </p>

        <h2 id="account"><a className="anchor" href="#account">Your account</a></h2>
        <p>
          You need an account to use EasyMode. Keep your password to yourself; you are
          responsible for what happens under your account. Give us an email address you can
          actually receive mail at — it is how we reach you about billing and how you
          recover access.
        </p>

        <h2 id="trial"><a className="anchor" href="#trial">Free trial</a></h2>
        <p>
          Every plan starts with a <strong>7-day free trial</strong>. During the trial you can
          use every generator your plan unlocks, limited to your plan&rsquo;s token allowance. If
          you cancel before the trial ends you are charged nothing. If you do not cancel, the
          plan you selected begins and your card is charged on day 7.
        </p>

        <h2 id="billing"><a className="anchor" href="#billing">Subscriptions and billing</a></h2>
        <ul>
          <li>Plans are billed monthly or annually in advance, in US dollars, through Stripe. We never see or store your full card number. See <a href="/#pricing">pricing</a> for current plans.</li>
          <li>Your subscription renews automatically at the end of each period until you cancel.</li>
          <li>Each plan includes a monthly token allowance. <strong>Tokens do not roll over</strong> — the allowance resets each billing period. Tokens you purchase separately as top-ups are not part of that reset and remain until spent.</li>
          <li>Prices can change. If a price changes we will tell you before it applies to your renewal, and you can cancel first.</li>
        </ul>

        <h2 id="cancel"><a className="anchor" href="#cancel">Cancelling</a></h2>
        <p>
          You can cancel at any time from your account. Cancelling stops the next renewal —
          your plan stays active for the rest of the period you have already paid for, and we
          do not cut it short. Everything you have kept or posted stays yours after cancellation
          (un-kept drafts are cleared after 30 days — Keep the ones you want).
        </p>

        <h2 id="refunds"><a className="anchor" href="#refunds">Refunds</a></h2>
        <p>
          Because generation spends real compute the moment you request it, paid periods are
          non-refundable once the period has begun, and spent tokens are not refundable. Two
          exceptions: if a generation fails on our side, the tokens for it are returned to
          your wallet automatically; and if you were billed in error, write to us and we will
          put it right.
        </p>

        <h2 id="content"><a className="anchor" href="#content">Your content and ours</a></h2>
        <p>
          You keep ownership of your products, your brand and everything EasyMode generates
          for you, and you may use it commercially. You give us permission to process your
          product information for the purpose of generating that content. You are responsible
          for reviewing anything before it is published — AI gets things wrong, so by default
          nothing publishes without your approval. If you switch on automatic posting for a
          campaign, pieces in it publish on their schedule without a per-piece review; that is
          your choice, you stay responsible for what goes out, and you can turn it off at any time.
        </p>

        <h2 id="ai"><a className="anchor" href="#ai">AI disclosure</a></h2>
        <p className="note">
          Content produced by EasyMode is AI-generated and is labelled as such when posted,
          including the disclosure tags the platforms require. Do not remove those labels.
        </p>

        <h2 id="acceptable"><a className="anchor" href="#acceptable">Acceptable use</a></h2>
        <ul>
          <li>No unlawful, deceptive or infringing products, and no using someone else's brand, likeness or copyrighted work without the right to do so.</li>
          <li>No reselling EasyMode output as a generation service of your own.</li>
          <li>No attempting to break, overload or reverse-engineer the service.</li>
        </ul>
        <p>We may suspend an account that breaks these rules.</p>

        <h2 id="availability"><a className="anchor" href="#availability">Availability</a></h2>
        <p>
          EasyMode depends on third-party AI providers and social platforms. We do not
          promise uninterrupted service, and features can change as those providers change.
          The service is provided as-is.
        </p>

        <h2 id="changes"><a className="anchor" href="#changes">Changes to these terms</a></h2>
        <p>
          If we change these terms materially we will say so on this page and update the date
          above. Continuing to use EasyMode after that means you accept the change.
        </p>

        <h2 id="contact"><a className="anchor" href="#contact">Contact</a></h2>
        <p>
          Questions about these terms or your bill: <a href="mailto:hello@easymodeapp.com">hello@easymodeapp.com</a>.
          See also our <a href="/privacy">Privacy Policy</a>.
        </p>

        <p className="gov">
          This English version is the governing text of these terms; any translation is
          provided for convenience only, and full localization is handled separately.
        </p>

        <a className="back" href="/">Back to EasyMode</a>
      </main>
      <LegalFoot />
    </div>
  );
}
