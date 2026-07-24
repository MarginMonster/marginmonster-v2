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
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600&display=swap');
        a.lp-cta{position:relative;overflow:hidden;isolation:isolate}
        a.lp-cta:hover{transform:translateY(-2px);transition:transform .15s;filter:brightness(1.05)}
        a.lp-cta::after{content:"";position:absolute;z-index:-1;top:50%;right:-16px;width:96px;height:96px;margin-top:-48px;border-radius:50%;
          background:repeating-conic-gradient(from 0deg,rgba(255,228,158,.15) 0deg 1.4deg,transparent 1.4deg 4deg),repeating-conic-gradient(from 0deg,rgba(255,228,158,.10) 0deg .7deg,transparent .7deg 7deg),repeating-radial-gradient(circle,rgba(255,228,158,.12) 0 1px,transparent 1px 6px);
          -webkit-mask:radial-gradient(circle,#000 60%,transparent 63%);mask:radial-gradient(circle,#000 60%,transparent 63%);opacity:.8;animation:lpmed 26s linear infinite;pointer-events:none}
        @keyframes lpmed{to{transform:rotate(360deg)}}
        @media (prefers-reduced-motion:reduce){a.lp-cta::after{animation:none}}`}</style>

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
        <a href="#" className="lp-cta" style={cta}>{content.ctaText}</a>
        <div style={{ marginTop: 40, fontSize: 12, color: "rgba(220,240,225,0.5)", fontFamily: "Poppins, sans-serif", letterSpacing: "0.06em" }}>MADE WITH EASYMODE</div>
      </section>
    </div>
  );
}
