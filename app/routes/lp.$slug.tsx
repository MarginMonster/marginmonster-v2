import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, type MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { db } from "../db.server";
import { clientIp, rateLimit } from "../lib/rate-limit.server";
import type { LandingContent } from "../lib/landing.server";
import { externalOrigin } from "../lib/origin.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const slug = params.slug!;
  const page = await db.landingPage.findUnique({
    where: { slug },
    // Only what the page needs. Never the whole shop row — it carries the
    // wallet, the plan and the access token, and this loader's data is
    // serialised straight into a public HTML document.
    include: { shop: { select: { id: true, domain: true, storeUrl: true } } },
  });
  if (!page || !page.published) throw new Response("Not found", { status: 404 });
  // COUNTING IS THROTTLED; SERVING IS NOT.
  //
  // This is a public, unauthenticated GET that did an unconditional DB write
  // on every hit — on the single event loop the render worker shares. Anyone
  // with the link could hold it open in a loop and turn a marketing page into
  // a write flood, while inflating a number the merchant reads as real
  // traffic. The /go turnstiles were given the same treatment for the same
  // reason; this one was missed.
  //
  // And the write is wrapped: a database hiccup must never stop a visitor
  // seeing the merchant’s page. A lost view is nothing; a 500 on a link they
  // paid to promote is not.
  if (rateLimit(`lpview:${clientIp(request)}:${slug}`, 3, 10 * 60_000).ok) {
    try {
      await db.landingPage.update({ where: { id: page.id }, data: { views: { increment: 1 } } });
    } catch (e) {
      console.error("[lp] view count failed (non-fatal):", e);
    }
  }
  // Self-marketing: every published landing page carries a tracked "Made with
  // EasyMode" badge → the App Store. The people browsing a store's landing
  // pages are disproportionately other store owners (competitor research), i.e.
  // exactly EasyMode's buyer. UTM so we can see which pages convert installs.
  const listing = process.env.SHOPIFY_APP_LISTING_URL || "https://apps.shopify.com";
  const badgeUrl = `${listing}${listing.includes("?") ? "&" : "?"}utm_source=merchant_landing&utm_medium=made_with_badge&utm_campaign=self_marketing`;
  // THE BUY BUTTON HAD NOWHERE TO GO.
  //
  // The closing CTA — the one the whole page funnels to — was <a href="#">,
  // which scrolls to the top and does nothing else. The merchant pays for
  // "a high-converting landing page", publishes it, drives traffic to it, and
  // watches the view counter climb with no sales and no way to tell that the
  // page itself is the reason. There is no ctaUrl anywhere: the schema
  // comment mentions one, the generator never asks for one and the row never
  // stored one.
  //
  // Resolve it the way /go/a already does — the exact product page when the
  // catalogue has it, the storefront otherwise. A web shop's `domain` is the
  // synthetic web-<id>.easymode.app minted at signup and does not resolve, so
  // it is never used as a destination.
  let buyHref = "";
  try {
    const { productLinkFor } = await import("../lib/catalog-import.server");
    buyHref = await productLinkFor(page.shop.id, page.productName);
  } catch { /* fall through to the storefront */ }
  if (!buyHref && page.shop.storeUrl) buyHref = page.shop.storeUrl;
  if (!buyHref && !/\.easymode\.app$/i.test(page.shop.domain)) buyHref = `https://${page.shop.domain}`;
  if (!/^https?:\/\//i.test(buyHref)) buyHref = "";

  return json({
    content: JSON.parse(page.contentJson) as LandingContent,
    productName: page.productName,
    badgeUrl,
    buyHref,
    slug,
    origin: externalOrigin(request),
  });
};

/* A landing page exists to be shared, so it needs a head of its own. It
 * inherited the app-wide default before this, which meant every merchant's
 * page announced itself as "EasyMode" with no description and no preview.
 * The hero and subhead the page already displays are exactly the right
 * words for the title and description — no second set of claims. */
export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "EasyMode" }];
  const title = data.content?.hero || data.productName || "EasyMode";
  const description = data.content?.subhead || "";
  const url = data.origin + "/lp/" + (data.slug || "");
  const tags: Array<Record<string, string>> = [
    { title },
    { property: "og:type", content: "product" },
    { property: "og:title", content: title },
    { property: "og:url", content: url },
  ];
  if (description) {
    tags.push({ name: "description", content: description });
    tags.push({ property: "og:description", content: description });
    tags.push({ name: "twitter:description", content: description });
  }
  // No og:image: a landing page has no artwork of its own, and putting the
  // EasyMode mark on a merchant's product page would brand their link with
  // our logo. Title and description alone still unfurl properly.
  tags.push({ name: "twitter:card", content: "summary" });
  tags.push({ name: "twitter:title", content: title });
  return tags;
};

export default function LandingPagePublic() {
  const { content, productName, badgeUrl, buyHref } = useLoaderData<typeof loader>();

  const cta: React.CSSProperties = {
    display: "inline-block",
    background: "linear-gradient(165deg,#12A85E,#0B6B3E)",
    color: "#fff",
    fontFamily: "Poppins, sans-serif",
    fontWeight: 800,
    fontSize: 16,
    textDecoration: "none",
    padding: "15px 34px",
    borderRadius: 13,
    boxShadow: "0 10px 28px rgba(12,122,70,0.32), inset 0 0 0 1px rgba(255,210,74,0.4)",
  };
  const darkPanel = "radial-gradient(120% 100% at 50% 0%, #0E5233 0%, #062417 66%)";

  return (
    <div style={{ fontFamily: "Inter, -apple-system, sans-serif", background: "#F4F1E6", color: "#14201A", margin: 0 }}>
      <style dangerouslySetInnerHTML={{ __html: LP_CSS }} />

      <header style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(244,241,230,0.85)", backdropFilter: "blur(10px)", borderBottom: "1px solid #E4DFCF" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "Poppins, sans-serif", fontWeight: 800, color: "#14201A", fontSize: 17 }}>{productName}</span>
          <a href="#buy" style={{ ...cta, padding: "10px 20px", fontSize: 14 }}>{content.ctaText}</a>
        </div>
      </header>

      <section style={{ position: "relative", overflow: "hidden", color: "#EAF4EE", padding: "90px 24px 80px", textAlign: "center", background: `repeating-linear-gradient(57deg,rgba(255,214,102,.06) 0 1px,transparent 1px 7px),repeating-linear-gradient(123deg,rgba(255,214,102,.05) 0 1px,transparent 1px 7px),${darkPanel}` }}>
        <div style={{ maxWidth: 720, margin: "0 auto", position: "relative" }}>
          <div style={{ fontFamily: "Poppins, sans-serif", fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#E7C879", marginBottom: 20 }}>{productName}</div>
          <h1 style={{ fontFamily: "Poppins, sans-serif", fontSize: 46, fontWeight: 800, margin: "0 0 18px", lineHeight: 1.08, letterSpacing: "-0.03em", color: "#F4EAC8" }}>{content.hero}</h1>
          <p style={{ fontSize: 19, color: "rgba(220,240,225,0.82)", maxWidth: 560, margin: "0 auto 34px", lineHeight: 1.6 }}>{content.subhead}</p>
          <a href="#buy" className="lp-cta" style={cta}>{content.ctaText}</a>
          <div style={{ marginTop: 22, fontSize: 13, color: "rgba(220,240,225,0.6)" }}>{content.socialProof}</div>
        </div>
      </section>

      <section style={{ maxWidth: 1000, margin: "0 auto", padding: "72px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 20 }}>
          {content.benefits.map((b, i) => (
            <div key={i} style={{ background: "#FDFCF7", border: "1px solid #E4DFCF", borderRadius: 18, padding: 28, boxShadow: "0 2px 12px rgba(20,32,26,0.05)" }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, background: "rgba(12,122,70,0.09)", color: "#0C7A46", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Poppins, sans-serif", fontWeight: 800, marginBottom: 16, boxShadow: "inset 0 0 0 1px rgba(12,122,70,0.2)" }}>{i + 1}</div>
              <div style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 8, color: "#14201A" }}>{b.title}</div>
              <div style={{ fontSize: 15, color: "#4A554E", lineHeight: 1.6 }}>{b.body}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 820, margin: "0 auto", padding: "0 24px 72px" }}>
        <div style={{ textAlign: "center", fontFamily: "Poppins, sans-serif", fontSize: 26, fontWeight: 700, fontStyle: "italic", lineHeight: 1.4, color: "#14201A" }}>
          “{content.socialProof}”
        </div>
      </section>

      <section id="buy" style={{ color: "#EAF4EE", padding: "72px 24px", textAlign: "center", background: `repeating-linear-gradient(57deg,rgba(255,214,102,.06) 0 1px,transparent 1px 7px),repeating-linear-gradient(123deg,rgba(255,214,102,.05) 0 1px,transparent 1px 7px),${darkPanel}` }}>
        <h2 style={{ fontFamily: "Poppins, sans-serif", fontSize: 32, fontWeight: 800, margin: "0 0 14px", letterSpacing: "-0.02em", color: "#F4EAC8" }}>{content.hero}</h2>
        <p style={{ color: "rgba(220,240,225,0.82)", maxWidth: 480, margin: "0 auto 30px", fontSize: 16 }}>{content.subhead}</p>
        {/* No destination means no button. A CTA that visibly does nothing
            is worse than a page that plainly ends — the visitor concludes the
            store is broken rather than that there is nothing to click. */}
        {buyHref
          ? <a href={buyHref} className="lp-cta" style={cta}>{content.ctaText}</a>
          : null}
        <a href={badgeUrl} target="_blank" rel="noopener noreferrer" className="em-badge" style={{
          display: "inline-flex", alignItems: "center", gap: 8, marginTop: 42, padding: "8px 15px",
          borderRadius: 999, textDecoration: "none",
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(231,200,121,0.32)",
          color: "rgba(233,247,239,0.72)", fontFamily: "Poppins, sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: "0.02em",
        }}>
          <span style={{ fontSize: 13 }}>✨</span>
          Made with <b style={{ color: "#E7C879", fontWeight: 800 }}>EasyMode</b>
          <span style={{ color: "rgba(233,247,239,0.5)", fontWeight: 500 }}>— build yours free ›</span>
        </a>
      </section>
    </div>
  );
}

/* Injected raw rather than as a JSX child. As a child, React escapes
 * apostrophes and ampersands to entities — and <style> is a raw-text
 * element, so the browser never decodes them back. The server tree and the
 * client tree then disagree and hydration fails for the whole page. This
 * CSS contains both, in the @import url(...) alone. */
const LP_CSS = `@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600&display=swap');
        a.lp-cta{position:relative;overflow:hidden;isolation:isolate}
        a.lp-cta:hover{transform:translateY(-2px);transition:transform .15s;filter:brightness(1.05)}
        a.lp-cta::after{content:"";position:absolute;z-index:-1;top:50%;right:-16px;width:96px;height:96px;margin-top:-48px;border-radius:50%;
          background:repeating-conic-gradient(from 0deg,rgba(255,228,158,.15) 0deg 1.4deg,transparent 1.4deg 4deg),repeating-conic-gradient(from 0deg,rgba(255,228,158,.10) 0deg .7deg,transparent .7deg 7deg),repeating-radial-gradient(circle,rgba(255,228,158,.12) 0 1px,transparent 1px 6px);
          -webkit-mask:radial-gradient(circle,#000 60%,transparent 63%);mask:radial-gradient(circle,#000 60%,transparent 63%);opacity:.8;animation:lpmed 26s linear infinite;pointer-events:none}
        @keyframes lpmed{to{transform:rotate(360deg)}}
        @media (prefers-reduced-motion:reduce){a.lp-cta::after{animation:none}}
        a.em-badge{transition:background .15s,border-color .15s}
        a.em-badge:hover{background:rgba(255,255,255,0.11)!important;border-color:rgba(231,200,121,0.6)!important}`;
