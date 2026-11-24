/* POST /web/archive-cover — the Archive asks for ONE piece's cover (lib/archive-cover.server.ts).
 *
 * Asked in the background, a few at a time, for the pieces the member is looking at that have no cover
 * yet. Answers { cover } — the cover's /renders address, once it is drawn and recorded on the piece — or
 * { cover: null, why } and nothing has changed. A signed-out caller gets an empty answer, never a redirect:
 * this is never a navigation. Only the signed-in shop's own pieces are ever drawn. */
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { getWebIdentity } from "../lib/web-auth.server";
import { makeArchiveCover } from "../lib/archive-cover.server";

const headers = { "Cache-Control": "no-store" };

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ cover: null, why: "post" }, { status: 405, headers });
  const id = await getWebIdentity(request);
  if (!id) return json({ cover: null, why: "signed-out" }, { status: 401, headers });
  const form = await request.formData().catch(() => null);
  const assetId = String(form?.get("id") || "");
  if (!/^[a-z0-9]{8,64}$/i.test(assetId)) return json({ cover: null, why: "id" }, { status: 400, headers });
  const r = await makeArchiveCover({ shopId: id.shop.id, assetId });
  return json(r.ok ? { cover: r.cover } : { cover: null, why: r.why }, { headers });
};

// (asked for only by POST — an address typed into a browser finds nothing here)
export const loader = () => new Response("Not found", { status: 404, headers });
