// TEMPORARY owner-scoped diagnostic: returns the logged-in shop's recent
// VIDEO_AD assets with their stored script/copy (bodyJson) + section, so the
// generated output can be audited for accuracy/fabrication. Own shop only.
// Remove after the audit.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { getWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const id = await getWebIdentity(request);
  if (!id) return new Response(JSON.stringify({ error: "not logged in" }), { status: 401, headers: { "Content-Type": "application/json" } });
  const rows = await db.asset.findMany({
    where: { shopId: id.shop.id, type: "VIDEO_AD" },
    orderBy: { createdAt: "desc" },
    take: 14,
    select: { id: true, title: true, status: true, bodyJson: true, metaJson: true, createdAt: true },
  });
  const out = rows.map((a) => {
    let body: Record<string, unknown> = {};
    let meta: Record<string, unknown> = {};
    try { body = JSON.parse(a.bodyJson || "{}"); } catch { /* */ }
    try { meta = JSON.parse(a.metaJson || "{}"); } catch { /* */ }
    return {
      id: a.id,
      title: a.title,
      status: a.status,
      section: meta.section,
      kind: meta.kind || body.style,
      productTitle: (meta.topic as string) || (body.prompt as string) || undefined,
      // the generated spoken/copy content, whatever the pipeline stored
      script: (body.script as string) || (body.vo as string) || (body.copy as string) || undefined,
      caption: (body.caption as string) || undefined,
      bodyKeys: Object.keys(body),
      when: a.createdAt,
    };
  });
  // Pair each product video with its real catalogue description, for grounding checks.
  const titles = [...new Set(out.map((o) => o.productTitle).filter(Boolean))] as string[];
  const cat = titles.length
    ? await db.catalogProduct.findMany({ where: { shopId: id.shop.id, title: { in: titles } }, select: { title: true, description: true } })
    : [];
  const descByTitle: Record<string, string | null> = {};
  for (const c of cat) descByTitle[c.title] = c.description;
  return new Response(JSON.stringify({ videos: out, productDescriptions: descByTitle }, null, 2), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
