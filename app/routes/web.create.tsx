/* Creator Home was MERGED INTO the Studio (owner decision 2026-10-08: one
 * create surface, DeepAI-style — prompt box + a drag/drop-or-upload Stage —
 * instead of a separate launcher that just prefilled the Studio).
 *
 * This route now only forwards /web/create traffic (bookmarks, old deep-links,
 * the ?do=…&prompt=… the home used to build) straight to /web/studio, so
 * nothing 404s. The previous prompt-first hub lives in git history if needed.
 */
import { redirect, type LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  throw redirect(`/web/studio${url.search}`);
};

// A redirect-only route still needs a default export for Remix.
export default function CreateRedirect() {
  return null;
}
