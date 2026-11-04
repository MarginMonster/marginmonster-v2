/* The launcher was merged into the Dashboard (/web) — owner 11-04: "/web/home
 * reads as an unnecessary extra nav page." This path now redirects there so the
 * hub lives in one place. The old standalone launcher lives in git history; to
 * bring it back, restore this file and the /web gating in web.tsx. */
import { redirect, type LoaderFunctionArgs } from "@remix-run/node";

export const loader = async (_args: LoaderFunctionArgs) => redirect("/web");

export default function WebHomeRedirect() {
  return null;
}
