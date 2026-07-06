import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { db } from "../db.server";
import type { LandingContent } from "../lib/landing.server";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const slug = params.slug!;
  const page = await db.landingPage.findUnique({ where: { slug } });
  if (!page || !page.published) throw new Response("Not found", { status: 404 });
  await db.landingPage.update({ where: { id: page.id }, data: { views: { increment: 1 } } });
  return json({
    content: JSON.parse(page.contentJson) as LandingContent,
    productName: page.productName,
  });
};

export default function LandingPagePublic() {
  const { content, productName } = useLoaderData<typeof loader>();

  const cta: React.CSSProperties = {
    display: "inline-block",
    background: "#34E7E4",
    color: "#06231F",
    fontFamily: "Poppins, sans-serif",
    fontWeight: 700,
    fontSize: 16,
    textDecoration: "none",
    padding: "15px 34px",
    borderRadius: 12,
    boxShadow: "0 10px 30px rgba(52,231,228,0.35)",
  };

  return (
    <div style={{ fontFamily: "Inter, -apple-system, sans-serif", background: "#F6F5FB", color: "#1A1730", margin: 0 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600&display=swap');
        @keyframes lpglow{0%,100%{opacity:.5}50%{opacity:.9}}
        a.lp-cta:hover{transform:translateY(-2px);transition:transform .15s}`}</style>

      <header style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(11,10,20,0.85)", backdropFilter: "blur(10px)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "Poppins, sans-serif", fontWeight: 800, color: "#EDEBFB", fontSize: 17 }}>{productName}</span>
          <a href="#buy" style={{ ...cta, padding: "10px 20px", fontSize: 14 }}>{content.ctaText}</a>
        </div>
      </header>

      <section style={{ position: "relative", overflow: "hidden", background: "radial-gradient(130% 90% at 50% -20%, #221D3E 0%, #0B0A14 60%)", color: "#EDEBFB", padding: "90px 24px 80px", textAlign: "center" }}>
        <div style={{ position: "absolute", top: -100, left: "50%", transform: "translateX(-50%)", width: 480, height: 480, background: "radial-gradient(circle, rgba(52,231,228,0.18) 0%, transparent 70%)", animation: "lpglow 5s ease-in-out infinite", pointerEvents: "none" }} />
        <div style={{ maxWidth: 720, margin: "0 auto", position: "relative" }}>
          <div style={{ fontFamily: "Poppins, sans-serif", fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#34E7E4", marginBottom: 20 }}>{productName}</div>
          <h1 style={{ fontFamily: "Poppins, sans-serif", fontSize: 46, fontWeight: 800, margin: "0 0 18px", lineHeight: 1.08, letterSpacing: "-0.03em" }}>{content.hero}</h1>
          <p style={{ fontSize: 19, color: "#9A95C4", maxWidth: 560, margin: "0 auto 34px", lineHeight: 1.6 }}>{content.subhead}</p>
          <a href="#buy" className="lp-cta" style={cta}>{content.ctaText}</a>
          <div style={{ marginTop: 22, fontSize: 13, color: "#6F6A9C" }}>{content.socialProof}</div>
        </div>
      </section>

      <section style={{ maxWidth: 1000, margin: "0 auto", padding: "72px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 20 }}>
          {content.benefits.map((b, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid #E7E5F2", borderRadius: 18, padding: 28, boxShadow: "0 2px 12px rgba(20,18,42,0.05)" }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, background: "#EAF9F9", color: "#0E8F8B", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Poppins, sans-serif", fontWeight: 800, marginBottom: 16 }}>{i + 1}</div>
              <div style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 8 }}>{b.title}</div>
              <div style={{ fontSize: 15, color: "#6B6790", lineHeight: 1.6 }}>{b.body}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 820, margin: "0 auto", padding: "0 24px 72px" }}>
        <div style={{ textAlign: "center", fontFamily: "Poppins, sans-serif", fontSize: 26, fontWeight: 700, fontStyle: "italic", lineHeight: 1.4, color: "#1A1730" }}>
          “{content.socialProof}”
        </div>
      </section>

      <section id="buy" style={{ background: "radial-gradient(120% 100% at 50% 0%, #221D3E 0%, #0B0A14 60%)", color: "#EDEBFB", padding: "72px 24px", textAlign: "center" }}>
        <h2 style={{ fontFamily: "Poppins, sans-serif", fontSize: 32, fontWeight: 800, margin: "0 0 14px", letterSpacing: "-0.02em" }}>{content.hero}</h2>
        <p style={{ color: "#9A95C4", maxWidth: 480, margin: "0 auto 30px", fontSize: 16 }}>{content.subhead}</p>
        <a href="#" className="lp-cta" style={cta}>{content.ctaText}</a>
        <div style={{ marginTop: 40, fontSize: 12, color: "#6F6A9C", fontFamily: "Poppins, sans-serif", letterSpacing: "0.06em" }}>BUILT WITH MARGINMONSTER</div>
      </section>
    </div>
  );
}
