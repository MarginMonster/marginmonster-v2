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

/* Shared legal chrome — identical on /privacy and /terms so the two pages
 * never drift. Kept in both files verbatim (these routes take no loader and
 * share no helper lib). The two pages had copy-pasted CSS that had already
 * started to diverge — terms carried a .strong rule privacy lacked and an
 * unused .note rule — so this single block is the source of truth for both. */
export const LEGAL_CSS = `
.lg{--ink:#14201A;--ink2:#4B5450;--cream:#F7F6EB;--line:#E0E4D4;--green:#0C7A46;--gold:#B08526;
  background:var(--cream);color:var(--ink);min-height:100vh;
  font:16px/1.68 Poppins,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
.lg-in{max-width:720px;margin:0 auto;padding:28px 24px 72px;}
.lg a{color:var(--green);}
/* Masthead wordmark — mirrors the landing header (crest + Easy/Mode). */
.lg-mast{display:flex;align-items:center;gap:9px;margin:0 0 30px;text-decoration:none;
  font-family:Poppins,sans-serif;font-weight:800;font-size:19px;letter-spacing:-.01em;color:var(--ink);}
.lg-mast b{color:var(--gold);font-weight:800;}
.lg-mast .lg-crest{display:inline-flex;width:30px;height:30px;border-radius:8px;overflow:hidden;flex:0 0 auto;}
.lg-mast .lg-crest img{width:100%;height:100%;object-fit:cover;display:block;}
.lg h1{font-size:clamp(26px,5vw,34px);line-height:1.15;letter-spacing:-.02em;margin:0 0 6px;}
.lg .upd{color:var(--ink2);font-size:14px;margin:0 0 20px;}
/* Reciprocal + pricing links under the date so each page points at the others. */
.lg .xref{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:14px;font-weight:600;margin:0 0 28px;}
.lg .gov{color:var(--ink2);font-size:13px;margin:4px 0 24px;}
.lg h2{font-size:18px;letter-spacing:-.01em;margin:34px 0 8px;padding-top:16px;border-top:1px solid var(--line);scroll-margin-top:20px;}
.lg h2 a.anchor{color:inherit;text-decoration:none;}
.lg p,.lg li{color:var(--ink2);}
.lg li{margin:5px 0;}
.lg strong{color:var(--ink);}
.lg .note{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-size:14.5px;}
/* The arrow is a CSS glyph so screen readers never announce "leftwards arrow". */
.lg .back{display:inline-block;margin-top:38px;font-weight:600;text-decoration:none;}
.lg .back::before{content:"\\2190";margin-right:7px;}
/* Minimal footer — © + the same Privacy/Terms/Contact set the site uses. */
.lg-foot{max-width:720px;margin:0 auto;padding:22px 24px 48px;border-top:1px solid var(--line);
  display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;color:var(--ink2);font-size:13.5px;}
.lg-foot nav{display:flex;flex-wrap:wrap;gap:8px 16px;}
.lg-foot a{font-weight:600;text-decoration:none;}
`;

/* Single source of truth for the "Last updated" stamp, shared by both legal
 * pages. Bump this one line when either policy changes. */
export const LEGAL_UPDATED = "24 October 2026";

/* Masthead + footer so the legal pages read as part of the product rather
 * than a bare document. Kept verbatim on both routes (see LEGAL_CSS note). */
export function LegalMast() {
  return (
    <a className="lg-mast" href="/" aria-label="EasyMode home">
      <span className="lg-crest" aria-hidden="true"><img src="/easymode-head.png?v=2" alt="" /></span>
      <span>Easy<b>Mode</b></span>
    </a>
  );
}

export function LegalFoot() {
  return (
    <footer className="lg-foot">
      <span>© {new Date().getFullYear()} EasyMode</span>
      <nav aria-label="Legal">
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="mailto:hello@easymodeapp.com">Contact</a>
      </nav>
    </footer>
  );
}

export default function Privacy() {
  return (
    <div className="lg">
      <style dangerouslySetInnerHTML={{ __html: LEGAL_CSS }} />
      <main className="lg-in">
        <LegalMast />
        <h1>Privacy Policy</h1>
        <p className="upd">Last updated: {LEGAL_UPDATED}</p>
        <nav className="xref" aria-label="Related pages">
          <a href="/terms">Terms of Service</a>
          <a href="/#pricing">Pricing</a>
          <a href="mailto:hello@easymodeapp.com">Contact</a>
        </nav>

        <p>
          EasyMode generates marketing content from the products on your store and can
          publish it to social accounts you connect. It works with any store — there is no
          platform app to install. This policy explains what we collect, why, and how to have
          it removed.
        </p>

        <h2 id="collect"><a className="anchor" href="#collect">What we collect</a></h2>
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

        <h2 id="payment"><a className="anchor" href="#payment">Payment information</a></h2>
        <p>
          Payments are processed by <strong>Stripe</strong>. Your card details go to Stripe
          directly and are never sent to or stored on our servers — we keep only your
          subscription status and the <a href="/#pricing">plan</a> you are on.
        </p>

        <h2 id="use"><a className="anchor" href="#use">How we use it</a></h2>
        <p>
          Only to run the features you asked for: reading your catalog, generating content,
          publishing what you approve, metering tokens, billing your plan, and supporting you
          when you write in. <strong>We do not sell your data</strong>, and we do not use your
          catalog or your content to train our own models.
        </p>

        <h2 id="share"><a className="anchor" href="#share">Who we share it with</a></h2>
        <p>
          To generate a piece, your product photo and the prompt for it are sent to the AI
          providers that make it: <strong>Anthropic</strong> (Claude) for writing, and{" "}
          <strong>fal.ai</strong> and <strong>Replicate</strong>, which run the image and video
          models (from Google, ByteDance, Kuaishou and MiniMax) we use. Publishing to your social
          accounts is handled by our posting provider, <strong>upload-post.com</strong>: it holds
          the connection to each account you link and receives the finished media and caption to
          post. Payment is processed by <strong>Stripe</strong>, and finished renders are kept
          with our cloud storage provider so you can download and post them. Each receives only
          what its task needs; we do not sell your data, and we do not share it for anyone else's
          purposes.
        </p>

        <h2 id="transfers"><a className="anchor" href="#transfers">International data transfers</a></h2>
        <p>
          EasyMode is operated from the United States, and the providers above (Stripe,
          Anthropic, fal.ai, Replicate, upload-post.com and our cloud storage) process data
          in the United States and other countries. If you use EasyMode from the European
          Economic Area, the United Kingdom or elsewhere, the data described here is
          transferred to and processed in those countries. Where that transfer is from the
          EEA or UK, we rely on the European Commission&rsquo;s Standard Contractual Clauses (and
          their UK equivalent) with the providers that receive it, so your data carries the
          same protection wherever it is handled.
        </p>

        <h2 id="protect"><a className="anchor" href="#protect">How we protect it</a></h2>
        <ul>
          <li>Everything travels over encrypted connections (HTTPS).</li>
          <li>Passwords are stored as salted hashes, never in readable form.</li>
          <li>Your social-account connections are held by our posting provider (upload-post.com) through its secure hosted flow — we keep only a reference to your profile, scoped to your account, and never hold your social passwords or tokens ourselves.</li>
        </ul>

        <h2 id="retention"><a className="anchor" href="#retention">How long we keep it</a></h2>
        <p>
          We keep your account data for as long as your account exists, so cancelling a plan
          never destroys work you have kept. Content you Keep or Post stays in your archive until
          you remove it; a generated video or image you neither keep nor post is a draft, and we
          clear un-kept drafts after 30 days so unused renders don&rsquo;t pile up — so Keep the
          ones you want. When you ask us to delete your account we remove it and the content in
          it, except billing records we are required to keep for tax and accounting.
        </p>

        <h2 id="rights"><a className="anchor" href="#rights">Your rights</a></h2>
        <p>
          You can ask us for a copy of your data, ask us to correct it, or ask us to delete
          your account and everything in it — including disconnecting any linked social
          accounts. Write to the address below and we will action it. You can also disconnect
          a social account yourself at any time from your account settings.
        </p>

        <h2 id="cookies"><a className="anchor" href="#cookies">Cookies</a></h2>
        <p>
          We use a session cookie to keep you signed in. Your chosen language is remembered in
          your own browser and is never sent to us. We do not run third-party advertising or
          tracking cookies on this site.
        </p>

        <h2 id="contact"><a className="anchor" href="#contact">Contact</a></h2>
        <p>
          Privacy questions, data copies and deletion requests:{" "}
          <a href="mailto:hello@easymodeapp.com">hello@easymodeapp.com</a>. See also our{" "}
          <a href="/terms">Terms of Service</a>.
        </p>

        <p className="gov">
          This English version is the governing text of this policy; any translation is
          provided for convenience only, and full localization is handled separately.
        </p>

        <a className="back" href="/">Back to EasyMode</a>
      </main>
      <LegalFoot />
    </div>
  );
}
