import { json, requireUser, config } from "./superbase.js";
import { requireAdminPinSession } from "./admin-pin.js";

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

// requireUser validates the bearer token against Supabase Auth before we inspect
// its signed AAL claim. Never trust an unverified JWT payload on its own.
export async function requireAal2(request, env) {
  const auth = await requireUser(request, env);
  if (auth.error) return auth;
  const claims = decodeJwtPayload(auth.accessToken);
  if (!claims || claims.sub !== auth.user.id || claims.aal !== "aal2") {
    return { error: json({ error: "MFA_REQUIRED", required_level: "aal2" }, 403) };
  }
  return { ...auth, claims };
}

export async function requireAdminAal2(request, env) {
  const auth = await requireAal2(request, env);
  if (auth.error) return auth;
  const pinned = await requireAdminPinSession(request, env);
  if (pinned.error) return pinned;
  if (pinned.user?.id !== auth.user.id) {
    return { error: json({ error: "ADMIN_SESSION_MISMATCH" }, 403) };
  }
  return { ...pinned, claims: auth.claims };
}

const MUTATING_ADMIN_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function actionKeyForRequest(request) {
  const method = String(request.method || "GET").toUpperCase();
  const pathname = new URL(request.url).pathname;
  const bodyBytes = new Uint8Array(await request.clone().arrayBuffer());
  if (bodyBytes.length > 65536) throw new Error("ADMIN_ACTION_BODY_TOO_LARGE");
  const digest = await crypto.subtle.digest("SHA-256", bodyBytes);
  return method + ":" + pathname + ":" + bytesToHex(new Uint8Array(digest));
}

async function consumeAdminActionMfaGrant(request, env, auth) {
  const grantId = String(request.headers.get("x-admin-action-mfa-grant") || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(grantId)) {
    return { error: json({ error: "ADMIN_ACTION_MFA_REQUIRED" }, 403) };
  }

  const claims = auth.claims;
  const sessionId = claims?.session_id;
  if (
    claims?.sub !== auth.user.id ||
    typeof sessionId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
  ) return { error: json({ error: "ADMIN_ACTION_MFA_REQUIRED" }, 403) };

  let actionKey;
  try {
    actionKey = await actionKeyForRequest(request);
  } catch {
    return { error: json({ error: "ADMIN_ACTION_MFA_INVALID" }, 400) };
  }

  try {
    const { url, secretKey } = config(env);
    const now = new Date().toISOString();
    const query = [
      "grant_id=eq." + encodeURIComponent(grantId),
      "user_id=eq." + encodeURIComponent(auth.user.id),
      "session_id=eq." + encodeURIComponent(sessionId),
      "action_key=eq." + encodeURIComponent(actionKey),
      "consumed_at=is.null",
      "expires_at=gt." + encodeURIComponent(now)
    ].join("&");
    const response = await fetch(url + "/rest/v1/admin_action_mfa_grants?" + query, {
      method: "PATCH",
      headers: {
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
        "content-type": "application/json",
        accept: "application/json",
        prefer: "return=representation"
      },
      body: JSON.stringify({ consumed_at: now })
    });
    if (!response.ok) {
      return { error: json({ error: "ADMIN_ACTION_MFA_NOT_READY" }, 503) };
    }
    const rows = await response.json().catch(() => null);
    if (!Array.isArray(rows) || rows.length !== 1) {
      return { error: json({ error: "ADMIN_ACTION_MFA_REQUIRED" }, 403) };
    }
    return { consumed: true };
  } catch {
    return { error: json({ error: "ADMIN_ACTION_MFA_NOT_READY" }, 503) };
  }
}

// Role checks belong on the server for every data/API module. Super Admin is
// the only role that bypasses module scopes.
export async function requireAdminRoles(request, env, allowedRoles = []) {
  const auth = await requireAdminAal2(request, env);
  if (auth.error) return auth;
  const roles = Array.isArray(auth.roles) ? auth.roles : [];
  if (!roles.includes("super_admin") && !roles.some((role) => allowedRoles.includes(role))) {
    return { error: json({ error: "ADMIN_PERMISSION_DENIED" }, 403) };
  }

  // Every mutating Admin API call must present a fresh, action-bound TOTP
  // grant. The grant is consumed atomically, so a browser replay cannot reuse it.
  if (MUTATING_ADMIN_METHODS.has(String(request.method || "").toUpperCase())) {
    const grant = await consumeAdminActionMfaGrant(request, env, auth);
    if (grant.error) return grant.error;
  }
  return auth;
}
