import { db } from "../db.server";
import { ANALYTICS_PLATFORMS, CONNECT_PLATFORMS, networkName, planPublish, type PublishPlan } from "./social-networks";

// The ONE list of networks (keys, names, what each takes, limits) lives in the pure social-networks.ts
// so client code and tests can import it; it is re-exported here as the provider's surface.
export {
  NETWORKS, POSTABLE_PLATFORMS, VIDEO_PLATFORMS, PHOTO_PLATFORMS, CONNECT_PLATFORMS, ANALYTICS_PLATFORMS,
  network, networkName, isPostable, takes, captionFor, type Network, type NetworkKey,
} from "./social-networks";

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

/** Branded hosted page where the merchant links their accounts — every network the page documents
 *  (generate-jwt `platforms`: tiktok, instagram, facebook, youtube, x, threads, linkedin; Bluesky is not
 *  one of its values). `returnUrl` sends them straight back into our app when they're done. */
export async function connectUrl(shopId: string, returnUrl?: string): Promise<string | null> {
  const username = await ensureProfile(shopId);
  if (!username) return null;
  try {
    const r = await fetch(`${API}/uploadposts/users/generate-jwt`, {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        // brand the white-label hosted page as hard as its params allow
        logo_image: `${process.env.SHOPIFY_APP_URL || "https://marginmonster-fiew.onrender.com"}/helpurr-icon.png?v=3`,
        connect_title: "Connect your socials to EasyMode 🏝️",
        connect_description: `One tap links ${CONNECT_PLATFORMS.slice(0, -1).map(networkName).join(", ")} & ${networkName(CONNECT_PLATFORMS[CONNECT_PLATFORMS.length - 1])}. From here on, EasyMode auto-posts every drop for you — hands off, all month long.`,
        platforms: [...CONNECT_PLATFORMS],
        show_calendar: false,
        ...(returnUrl ? { redirect_url: returnUrl, redirect_button_text: "← Back to EasyMode" } : {}),
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
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { socialProfileKey: true, socialsJson: true } });
  if (!shop?.socialProfileKey) return [];
  // A provider hiccup must NOT make linked accounts vanish from the UI — a
  // transient failure falls back to the last-known cache instead of []. Only a
  // SUCCESSFUL response (which may legitimately be empty, e.g. the merchant
  // unlinked) is trusted to overwrite that cache.
  const cached = linkedFromCache(shop.socialsJson);
  try {
    const r = await fetch(`${API}/uploadposts/users/${encodeURIComponent(shop.socialProfileKey)}`, { headers: authHeader() });
    if (!r.ok) return cached;
    const j = (await r.json()) as { profile?: { social_accounts?: Record<string, unknown> }; social_accounts?: Record<string, unknown> };
    const accounts = j.profile?.social_accounts || j.social_accounts || {};
    const platforms = Object.entries(accounts)
      .filter(([, v]) => v && (typeof v !== "object" || Object.values(v as object).some(Boolean)))
      .map(([k]) => k.toLowerCase());
    await db.shop.update({ where: { id: shopId }, data: { socialsJson: JSON.stringify(platforms) } });
    return platforms;
  } catch (e) {
    console.error("[social] user fetch failed:", e);
    return cached;
  }
}

export function linkedFromCache(socialsJson: string | null | undefined): string[] {
  try {
    const v = JSON.parse(socialsJson || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

/** Per-platform profile analytics (followers + engagement). Provider endpoint:
 *  GET /api/analytics/{username}?platforms=tiktok,instagram,facebook,…  (Apikey auth). The provider
 *  answers for every network we post to (docs: get-analytics); only those are asked for, because an
 *  unknown value in `platforms` is a 400 for the whole request. A network it cannot answer for comes
 *  back as a per-network message object and is skipped below, so it never hides the others.
 *  Response is keyed by platform: { instagram: { followers, reach, views,
 *  impressions, likes, comments, shares, saves, ... }, ... }.
 *
 *  HONESTY RULE (same as the publisher): returns null on any failure or missing
 *  key, so the UI shows "no numbers yet" instead of fabricated engagement. */
export type PlatformStats = {
  followers: number; reach: number; views: number; impressions: number;
  likes: number; comments: number; shares: number; saves: number;
};

const toInt = (v: unknown): number => {
  const n = typeof v === "string" ? parseInt(v.replace(/[^0-9.-]/g, ""), 10) : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};

export async function fetchAnalytics(
  username: string,
  platforms: string[]
): Promise<Record<string, PlatformStats> | null> {
  platforms = platforms.filter((p) => (ANALYTICS_PLATFORMS as readonly string[]).includes(p));
  if (!socialProviderEnabled() || !username || platforms.length === 0) return null;
  try {
    const qs = encodeURIComponent(platforms.join(","));
    const r = await fetch(`${API}/analytics/${encodeURIComponent(username)}?platforms=${qs}`, { headers: authHeader() });
    if (!r.ok) {
      console.error("[social] analytics failed:", r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const j = (await r.json().catch(() => null)) as Record<string, Record<string, unknown>> | null;
    if (!j || typeof j !== "object") return null;
    const out: Record<string, PlatformStats> = {};
    for (const p of platforms) {
      const d = j[p];
      // provider returns a per-platform message object for unsupported/unlinked
      // accounts — skip anything without a usable followers/engagement shape
      if (!d || typeof d !== "object" || "error" in d || "message" in d) continue;
      out[p] = {
        followers: toInt(d.followers), reach: toInt(d.reach), views: toInt(d.views),
        impressions: toInt(d.impressions), likes: toInt(d.likes), comments: toInt(d.comments),
        shares: toInt(d.shares), saves: toInt(d.saves),
      };
    }
    return Object.keys(out).length ? out : null;
  } catch (e) {
    console.error("[social] analytics error:", e);
    return null;
  }
}

/** Publish one piece of media. Returns ok ONLY on confirmed provider success.
 *  Video: pass the media URL directly (upload-post's /api/upload `video` field
 *  accepts a URL) — no re-upload through our server. Photos: /api/upload_photos
 *  is file-only, so we fetch the bytes and attach them.
 *
 *  `title` is the whole assembled post (buildPostTitle). TikTok/Instagram/Facebook get it as the one shared
 *  `title`, trimmed to 150 exactly as before; each newer network also gets its own field, fitted to its own
 *  limit with #EasyModeAi kept (social-networks.ts → planPublish). A network that cannot take this kind of
 *  piece (a photo to YouTube) is left out of the request and named in `skipped`, never failing the rest. */
export async function publishPost(
  username: string,
  params: { title: string; mediaUrl: string; isVideo: boolean; platforms: string[] }
): Promise<{ ok: boolean; error?: string; urls?: Record<string, string>; skipped?: PublishPlan["skipped"] }> {
  if (!socialProviderEnabled()) return { ok: false, error: "no-api-key" };
  try {
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    const mediaAbs = params.mediaUrl.startsWith("http") ? params.mediaUrl : `${base}${params.mediaUrl}`;

    // THE PLATFORMS' OWN "AI-GENERATED" LABEL. Everything EasyMode posts is made with AI, and the caption
    // already says so (#EasyModeAi); the plan sets each platform's native disclosure as well — TikTok's
    // "Creator labeled as AI-generated" (is_aigc), Instagram's AI info, YouTube's synthetic-media flag,
    // X's made_with_ai, Threads' is_made_with_ai — through upload-post's one alias `is_ai_generated`
    // (docs.upload-post.com/guides/ai-content-labeling). Facebook Reels take their own field
    // (`facebook_is_ai_generated`); a Facebook photo or Page post, LinkedIn and Bluesky have no API label.
    const plan = planPublish(username, params);
    const skipped = plan.skipped.length ? plan.skipped : undefined;
    if (plan.sent.length === 0) return { ok: false, error: "no-network-takes-this", skipped };

    const form = new FormData();
    for (const [k, v] of plan.fields) form.append(k, v);

    if (params.isVideo) {
      // video accepts a URL string — provider fetches it directly
      form.append("video", mediaAbs);
    } else {
      const mediaRes = await fetch(mediaAbs);
      if (!mediaRes.ok) return { ok: false, error: `media-${mediaRes.status}` };
      form.append("photos[]", await mediaRes.blob(), "easymode.jpg");
    }

    const r = await fetch(`${API}/${params.isVideo ? "upload" : "upload_photos"}`, {
      method: "POST",
      headers: authHeader(),
      body: form,
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; results?: Record<string, { success?: boolean; url?: string }> };
    const anySuccess =
      j.success === true ||
      (j.results ? Object.values(j.results).some((v) => v && v.success) : false);
    if (r.ok && anySuccess) {
      // live post URLs per platform — the map's "view the post" links
      const urls: Record<string, string> = {};
      for (const [p, res] of Object.entries(j.results || {})) {
        if (res?.url) urls[p] = res.url;
      }
      return { ok: true, urls, skipped };
    }
    console.error("[social] post failed:", r.status, JSON.stringify(j).slice(0, 300));
    return { ok: false, error: `post-${r.status}`, skipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}
