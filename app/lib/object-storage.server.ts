import crypto from "node:crypto";

/* ============================================================================
 * Durable object storage for rendered videos/photos — S3-compatible (Cloudflare
 * R2, AWS S3, Backblaze B2, MinIO, …) using a tiny built-in SigV4 signer so we
 * carry NO SDK dependency.
 *
 * Design: WRITE-THROUGH + READ-FALLBACK. The app's URL contract never changes —
 * every render is still referenced as `/renders/<file>`. On generate we write
 * the file to the local disk AND (if storage is configured) upload it to the
 * bucket. On serve, renders.$file.tsx reads the local disk first and, if the
 * file isn't there (fresh instance, wiped/resized disk), pulls it from the
 * bucket and rehydrates local. Result: "Kept means kept" survives any deploy,
 * disk resize, or instance recreation.
 *
 * Enable by setting these env vars (all required):
 *   S3_ENDPOINT           e.g. https://<acct>.r2.cloudflarestorage.com
 *   S3_BUCKET             e.g. easymode-renders
 *   S3_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY
 *   S3_REGION             optional, defaults "auto" (correct for R2)
 * Leave them unset and the app behaves exactly as before (local disk only).
 * ==========================================================================*/

type Cfg = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string };

function cfg(): Cfg | null {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint: endpoint.replace(/\/+$/, ""), bucket, accessKeyId, secretAccessKey, region: process.env.S3_REGION || "auto" };
}

export function storageEnabled(): boolean {
  return cfg() !== null;
}

const sha256hex = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const hmac = (key: Buffer | string, data: string) => crypto.createHmac("sha256", key).update(data).digest();

// Encode a path segment per RFC 3986 (S3 canonical URI rules) — keep unreserved,
// percent-encode the rest. Slashes between segments are preserved by the caller.
function uriEncodeSegment(seg: string): string {
  return encodeURIComponent(seg).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function ts(): { amzDate: string; dateStamp: string } {
  // yyyymmddThhmmssZ / yyyymmdd — derived from a single ISO string.
  const iso = new Date().toISOString(); // safe: real timestamp at call time
  const amzDate = iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

async function signedRequest(method: "PUT" | "GET" | "HEAD" | "DELETE", key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const c = cfg();
  if (!c) throw new Error("object storage not configured");
  const url = new URL(c.endpoint);
  const host = url.host;
  // path-style: /<bucket>/<key...>; encode each key segment, keep the slashes.
  const encodedKey = key.split("/").map(uriEncodeSegment).join("/");
  const canonicalUri = `/${uriEncodeSegment(c.bucket)}/${encodedKey}`;
  const payloadHash = body ? sha256hex(body) : sha256hex("");
  const { amzDate, dateStamp } = ts();
  const scope = `${dateStamp}/${c.region}/s3/aws4_request`;

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType && method === "PUT") headers["content-type"] = contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h].trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");

  const kDate = hmac("AWS4" + c.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, c.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(`${c.endpoint}${canonicalUri}`, {
    method,
    headers: { ...headers, Authorization: authorization },
    // Buffer is a valid BodyInit at runtime (undici); the DOM lib types don't
    // model it, so cast through Uint8Array to keep tsc happy.
    body: method === "PUT" && body ? new Uint8Array(body) : undefined,
  });
}

/** Upload bytes under `key` (e.g. "renders/vid-123.mp4"). Returns true on success. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<boolean> {
  if (!storageEnabled()) return false;
  try {
    const r = await signedRequest("PUT", key, body, contentType);
    if (!r.ok) { console.error(`[storage] PUT ${key} -> ${r.status} ${await r.text().catch(() => "")}`.slice(0, 300)); return false; }
    return true;
  } catch (e) {
    console.error("[storage] PUT failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Fetch bytes for `key`. Returns null if not configured, missing, or on error. */
export async function getObject(key: string): Promise<{ buf: Buffer; contentType: string } | null> {
  if (!storageEnabled()) return null;
  try {
    const r = await signedRequest("GET", key);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return { buf, contentType: r.headers.get("content-type") || "application/octet-stream" };
  } catch (e) {
    console.error("[storage] GET failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Best-effort delete (used by the stale-cache cleaner). */
export async function deleteObject(key: string): Promise<void> {
  if (!storageEnabled()) return;
  try { await signedRequest("DELETE", key); } catch { /* ignore */ }
}

const mimeFor = (name: string): string => {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext === "mp4" ? "video/mp4" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
};

/** Object key for a render file name. Kept flat under a renders/ prefix. */
export const renderKey = (fileName: string) => `renders/${fileName}`;

/**
 * Write-through helper: the render was already written to local disk by the
 * caller; mirror it to object storage so it's durable. Non-fatal on failure —
 * local disk still serves it until the next deploy.
 */
export async function mirrorRender(fileName: string, buf: Buffer): Promise<void> {
  if (!storageEnabled()) return;
  await putObject(renderKey(fileName), buf, mimeFor(fileName));
}
