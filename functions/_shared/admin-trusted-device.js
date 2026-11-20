import { config } from "./superbase.js";

export const ADMIN_TRUST_COOKIE = "lgp_admin_trusted_device_v1";
export const ADMIN_TRUST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function readCookie(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== ADMIN_TRUST_COOKIE) continue;
    return part.slice(separator + 1).trim();
  }
  return "";
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function trustCookie(token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  return ADMIN_TRUST_COOKIE + "=" + token +
    "; Path=/api/admin; Max-Age=" + maxAge +
    "; Expires=" + new Date(expiresAt).toUTCString() +
    "; HttpOnly; Secure; SameSite=Strict";
}

function responseError(status) {
  const error = new Error(status === 404 ? "ADMIN_TRUST_SCHEMA_NOT_READY" : "ADMIN_TRUST_UNAVAILABLE");
  error.status = 503;
  return error;
}

// The raw device token exists only in a Secure, HttpOnly, same-site cookie.
// Supabase stores only its SHA-256 digest, tied to one Auth user and expiry.
export async function findTrustedAdminDevice(request, env, userId) {
  const token = readCookie(request);
  if (!/^[a-f0-9]{64}$/.test(token) || typeof userId !== "string" || !userId) {
    return { trusted: false, expiresAt: null, recordId: null };
  }

  const { url, secretKey } = config(env);
  const params = new URLSearchParams({
    select: "id,expires_at",
    user_id: "eq." + userId,
    token_hash: "eq." + await sha256Hex(token),
    revoked_at: "is.null",
    expires_at: "gt." + new Date().toISOString(),
    limit: "1"
  });
  const response = await fetch(url + "/rest/v1/admin_trusted_devices?" + params.toString(), {
    headers: {
      apikey: secretKey,
      authorization: "Bearer " + secretKey,
      accept: "application/json"
    }
  });
  if (!response.ok) throw responseError(response.status);
  const rows = await response.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.id || !row?.expires_at || Date.parse(row.expires_at) <= Date.now()) {
    return { trusted: false, expiresAt: null, recordId: null };
  }
  return { trusted: true, expiresAt: row.expires_at, recordId: row.id };
}

export async function issueTrustedAdminDevice(request, env, userId) {
  const { url, secretKey } = config(env);
  const current = await findTrustedAdminDevice(request, env, userId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ADMIN_TRUST_TTL_MS).toISOString();
  let token = readCookie(request);

  if (current.trusted) {
    const params = new URLSearchParams({
      id: "eq." + current.recordId,
      user_id: "eq." + userId,
      token_hash: "eq." + await sha256Hex(token),
      revoked_at: "is.null"
    });
    const response = await fetch(url + "/rest/v1/admin_trusted_devices?" + params.toString(), {
      method: "PATCH",
      headers: {
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
        "content-type": "application/json",
        accept: "application/json",
        prefer: "return=minimal"
      },
      body: JSON.stringify({ expires_at: expiresAt, last_used_at: now.toISOString() })
    });
    if (!response.ok) throw responseError(response.status);
  } else {
    token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    const response = await fetch(url + "/rest/v1/admin_trusted_devices", {
      method: "POST",
      headers: {
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
        "content-type": "application/json",
        accept: "application/json",
        prefer: "return=minimal"
      },
      body: JSON.stringify({
        user_id: userId,
        token_hash: await sha256Hex(token),
        expires_at: expiresAt,
        last_used_at: now.toISOString()
      })
    });
    if (!response.ok) throw responseError(response.status);
  }

  return { expiresAt, setCookie: trustCookie(token, expiresAt) };
}
