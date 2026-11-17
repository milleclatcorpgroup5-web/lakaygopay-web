import { json, requireUser } from "./superbase.js";
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
