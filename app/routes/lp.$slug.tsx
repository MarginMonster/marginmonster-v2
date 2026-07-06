import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { db } from "../db.server";
import type { LandingContent } from "../lib/landing.server";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const slug = params.slug!;
  const page = await db.landingPage.findUnique({ where: { slug } });
  if (!page || !page.published) {
    throw new Response("Not found", { status: 404 });
  }
  await db.landingPage.update({ where: { id: page.id }, data: { views: { increment: 1 } } });
  return json({
    content: JSON.parse(page.contentJson) as LandingContent,
    productName: page.productName,
  });
};

export default function LandingPagePublic() {
  const { content, productName } = useLoaderData<typeof loader>();

  const page: React.CSSProperties = {
    fontFamily: "Inter, -apple-system, sans-serif",
    background: "#F7F1E1",
    color: "#2B2118",
    minHeight: "100vh",
    margin: 0,
  };
  const wrap: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "0 24px" };
  const heroWrap: React.CSSProperties = {
    background: "linear-gradient(135deg,#2B2118 0%,#3d2f21 100%)",
    color: "#F7F1E1",
    padding: "72px 24px 64px",
    textAlign: "center",
  };
  const cta: React.CSSProperties = {
    display: "inline-block",
    background: "linear-gradient(180deg,#C9972B 0%,#A87D1E 100%)",
    color: "#fff",
    fontFamily: "Poppins, sans-serif",
    fontWeight: 600,
    fontSize: 17,
    textDecoration: "none",
    padding: "15px 34px",
    borderRadius: 12,
    boxShadow: "0 4px 14px rgba(201,151,43,.4)",
  };

  return (
    <div style={page}>
      <div style={heroWrap}>
        <div style={wrap}>
          <div style={{ fontFamily: "Poppins,sans-serif", fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "#C9972B", marginBottom: 14 }}>
            {productName}
          </div>
          <h1 style={{ fontFamily: "Poppins,sans-serif", fontSize: 40, fontWeight: 800, margin: "0 0 14px", lineHeight: 1.1 }}>
            {content.hero}
          </h1>
          <p style={{ fontSize: 18, opacity: 0.9, maxWidth: 540, margin: "0 auto 30px" }}>{content.subhead}</p>
          <a href="#buy" style={cta}>{content.ctaText}</a>
        </div>
      </div>

      <div style={wrap}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 20, padding: "48px 0" }}>
          {content.benefits.map((b, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid #E6DCC3", borderRadius: 14, padding: 22 }}>
              <div style={{ fontFamily: "Poppins,sans-serif", fontWeight: 600, fontSize: 17, marginBottom: 6 }}>{b.title}</div>
              <div style={{ fontSize: 15, color: "#6B5F4F", lineHeight: 1.55 }}>{b.body}</div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", fontFamily: "Poppins,sans-serif", fontStyle: "italic", fontSize: 20, color: "#2B2118", background: "linear-gradient(135deg,#FBF7EC,#F3E9CC)", border: "1px solid #E6DCC3", borderRadius: 14, padding: "28px 24px", margin: "0 0 48px" }}>
          “{content.socialProof}”
        </div>

        <div id="buy" style={{ textAlign: "center", paddingBottom: 72 }}>
          <a href="#" style={cta}>{content.ctaText}</a>
          <p style={{ fontSize: 13, color: "#6B5F4F", marginTop: 16 }}>Built with MarginMonster</p>
        </div>
      </div>
    </div>
  );
}
