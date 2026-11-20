import { json, requireUser } from "./superbase.js";
import { requireAdminPinSession } from "./admin-pin.js";
import { findTrustedAdminDevice } from "./admin-trusted-device.js";

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

// Normal Admin browsing may use a device trust token issued only after a real
// AAL2 challenge. High-impact mutations continue to call requireAdminAal2().
export async function requireAdminTrustedAal2(request, env) {
  const pinned = await requireAdminPinSession(request, env);
  if (pinned.error) return pinned;
  const claims = decodeJwtPayload(pinned.accessToken);
  if (!claims || claims.sub !== pinned.user?.id) {
    return { error: json({ error: "MFA_REQUIRED", required_level: "aal2" }, 403) };
  }
  if (claims.aal === "aal2") return { ...pinned, claims, mfaMethod: "aal2" };

  try {
    const trusted = await findTrustedAdminDevice(request, env, pinned.user.id);
    if (!trusted.trusted) {
      return { error: json({ error: "MFA_REQUIRED", required_level: "aal2" }, 403) };
    }
    return {
      ...pinned,
      claims,
      mfaMethod: "trusted_device",
      trustedUntil: trusted.expiresAt
    };
  } catch (error) {
    const code = error?.message === "ADMIN_TRUST_SCHEMA_NOT_READY"
      ? "ADMIN_TRUST_SCHEMA_NOT_READY"
      : "ADMIN_TRUST_UNAVAILABLE";
    return { error: json({ error: code }, 503) };
  }
}

// Role checks belong on the server for every data/API module. Super Admin is
// the only role that bypasses module scopes.
export async function requireAdminRoles(request, env, allowedRoles = [], options = {}) {
  const auth = options?.requireFreshMfa === true
    ? await requireAdminAal2(request, env)
    : await requireAdminTrustedAal2(request, env);
  if (auth.error) return auth;
  const roles = Array.isArray(auth.roles) ? auth.roles : [];
  if (!roles.includes("super_admin") && !roles.some((role) => allowedRoles.includes(role))) {
    return { error: json({ error: "ADMIN_PERMISSION_DENIED" }, 403) };
  }
  return auth;
}
