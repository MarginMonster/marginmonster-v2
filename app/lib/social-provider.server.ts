import { db } from "../db.server";

/* Social auto-posting provider: upload-post.com (v1 backend, chosen on recon —
 * multi-tenant user profiles on one API key, branded hosted connect page,
 * official platform APIs, ~$16/mo entry vs Ayrshare's $599 multi-user tier).
 *
 * Everything is env-gated on UPLOADPOST_API_KEY — without it the app behaves
 * exactly as before (slots wait as READY). The exported surface is provider-
 * neutral so swapping to our own Meta/TikTok dev apps (in review) or another
 * aggregator only touches this file.
 *
 * upload-post API:
 *  POST /api/uploadposts/users                {username}      create profile
 *  POST /api/uploadposts/users/generate-jwt   {username,...}  hosted connect URL
 *  GET  /api/uploadposts/users/{username}                     linked accounts
 *  POST /api/upload                            video post (multipart)
 *  POST /api/upload_photos                     photo post (multipart)
 */

const API = "https://api.upload-post.com/api";

export function socialProviderEnabled(): boolean {
  return !!process.env.UPLOADPOST_API_KEY;
}

function authHeader(): Record<string, string> {
  return { Authorization: `Apikey ${process.env.UPLOADPOST_API_KEY}` };
}

/** Ensure the shop has a provider profile (username = shop cuid). */
export async function ensureProfile(shopId: string): Promise<string | null> {
  if (!socialProviderEnabled()) return null;
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { socialProfileKey: true } });
  if (!shop) return null;
  if (shop.socialProfileKey) return shop.socialProfileKey;
  try {
    const r = await fetch(`${API}/uploadposts/users`, {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ username: shopId }),
    });
    const body = (await r.text()).slice(0, 300);
    // treat "already exists" as success — the username is deterministic
    if (!r.ok && !/exist/i.test(body)) {
      console.error("[social] profile create failed:", r.status, body);
      return null;
    }
  } catch (e) {
    console.error("[social] profile create error:", e);
    return null;
  }
  await db.shop.update({ where: { id: shopId }, data: { socialProfileKey: shopId } });
  return shopId;
}

/** Branded hosted page where the merchant links TikTok/Instagram/Facebook.
 *  `returnUrl` sends them straight back into our app when they're done. */
export async function connectUrl(shopId: string, returnUrl?: string): Promise<string | null> {
  const username = await ensureProfile(shopId);
  if (!username) return null;
  try {
    const r = await fetch(`${API}/uploadposts/users/generate-jwt`, {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        connect_title: "Connect your socials to AdArcade",
        connect_description: "Link TikTok, Instagram, and Facebook — your campaigns auto-post from here. Hands off, all month.",
        platforms: ["tiktok", "instagram", "facebook"],
        show_calendar: false,
        ...(returnUrl ? { redirect_url: returnUrl, redirect_button_text: "← Back to AdArcade" } : {}),
      }),
    });
    if (!r.ok) {
      console.error("[social] jwt failed:", r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const j = (await r.json()) as { access_url?: string };
    return j.access_url || null;
  } catch (e) {
    console.error("[social] jwt error:", e);
    return null;
  }
}

/** Refresh + cache the platforms the merchant actually linked. */
export async function refreshLinkedPlatforms(shopId: string): Promise<string[]> {
  if (!socialProviderEnabled()) return [];
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { socialProfileKey: true } });
  if (!shop?.socialProfileKey) return [];
  try {
    const r = await fetch(`${API}/uploadposts/users/${encodeURIComponent(shop.socialProfileKey)}`, { headers: authHeader() });
    if (!r.ok) return [];
    const j = (await r.json()) as { profile?: { social_accounts?: Record<string, unknown> }; social_accounts?: Record<string, unknown> };
    const accounts = j.profile?.social_accounts || j.social_accounts || {};
    const platforms = Object.entries(accounts)
      .filter(([, v]) => v && (typeof v !== "object" || Object.values(v as object).some(Boolean)))
      .map(([k]) => k.toLowerCase());
    await db.shop.update({ where: { id: shopId }, data: { socialsJson: JSON.stringify(platforms) } });
    return platforms;
  } catch (e) {
    console.error("[social] user fetch failed:", e);
    return [];
  }
}

export function linkedFromCache(socialsJson: string | null | undefined): string[] {
  try {
    const v = JSON.parse(socialsJson || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

/** Publish one piece of media. Returns ok ONLY on confirmed provider success. */
export async function publishPost(
  username: string,
  params: { title: string; mediaUrl: string; isVideo: boolean; platforms: string[] }
): Promise<{ ok: boolean; error?: string }> {
  if (!socialProviderEnabled()) return { ok: false, error: "no-api-key" };
  try {
    // pull the media from our own served URL (worker and web share a host)
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    const mediaAbs = params.mediaUrl.startsWith("http") ? params.mediaUrl : `${base}${params.mediaUrl}`;
    const mediaRes = await fetch(mediaAbs);
    if (!mediaRes.ok) return { ok: false, error: `media-${mediaRes.status}` };
    const blob = await mediaRes.blob();

    const form = new FormData();
    form.append("user", username);
    form.append("title", params.title.slice(0, 150));
    for (const p of params.platforms) form.append("platform[]", p);
    if (params.isVideo) form.append("video", blob, "adarcade.mp4");
    else form.append("photos[]", blob, "adarcade.jpg");

    const r = await fetch(`${API}/${params.isVideo ? "upload" : "upload_photos"}`, {
      method: "POST",
      headers: authHeader(),
      body: form,
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; results?: Record<string, { success?: boolean }> };
    const anySuccess =
      j.success === true ||
      (j.results && Object.values(j.results).some((v) => v && v.success));
    if (r.ok && anySuccess) return { ok: true };
    console.error("[social] post failed:", r.status, JSON.stringify(j).slice(0, 300));
    return { ok: false, error: `post-${r.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}
