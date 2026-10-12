/* Owner gate for the /admin/* tools (members list, beta provisioning). True
 * only for the owner: a logged-in session whose email is allow-listed in
 * ADMIN_EMAILS, OR the shared PURGE_KEY secret in the URL. Both env values are
 * unset by default, so these tools are unreachable until one is configured. */
import { getWebIdentity } from "./web-auth.server";

/** True if this email is on the ADMIN_EMAILS allowlist. Used to show the owner
 *  a discreet admin link in the shell (invisible to everyone else). */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

export async function isOwner(request: Request): Promise<boolean> {
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (admins.length) {
    const id = await getWebIdentity(request);
    if (id && admins.includes(id.account.email.toLowerCase())) return true;
  }
  const key = process.env.PURGE_KEY;
  if (key && new URL(request.url).searchParams.get("key") === key) return true;
  return false;
}
