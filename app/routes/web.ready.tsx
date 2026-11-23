/* GET /web/ready — one look for the shell's "your film is ready" notice (lib/ready-notice.ts).
 *
 * { cooking, newest } for the signed-in shop: how many pieces are rendering now, and its newest finished
 * video. Read-only, never cached, and a signed-out caller gets an empty answer rather than a redirect —
 * this is asked in the background and must never navigate anybody anywhere.
 */
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { getWebIdentity } from "../lib/web-auth.server";
import { readyState } from "../lib/ready-notice.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const headers = { "Cache-Control": "no-store" };
  const id = await getWebIdentity(request);
  if (!id) return json({ cooking: 0, newest: null }, { headers });
  return json(await readyState(id.shop.id), { headers });
};
