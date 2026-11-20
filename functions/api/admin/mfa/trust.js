import { json } from "../../../../_shared/superbase.js";
import { requireAdminPinSession } from "../../../../_shared/admin-pin.js";
import { requireAdminAal2 } from "../../../../_shared/security.js";
import { findTrustedAdminDevice, issueTrustedAdminDevice } from "../../../../_shared/admin-trusted-device.js";

export async function onRequestGet({ request, env }) {
  const access = await requireAdminPinSession(request, env);
  if (access.error) return access.error;
  try {
    const device = await findTrustedAdminDevice(request, env, access.user.id);
    return json({ ok: true, trusted: device.trusted, expires_at: device.expiresAt });
  } catch (error) {
    const code = error?.message === "ADMIN_TRUST_SCHEMA_NOT_READY"
      ? "ADMIN_TRUST_SCHEMA_NOT_READY"
      : "ADMIN_TRUST_UNAVAILABLE";
    return json({ ok: false, error: code }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  // A device can only be remembered immediately after a real Supabase AAL2
  // challenge and a valid Admin PIN for this exact auth session.
  const access = await requireAdminAal2(request, env);
  if (access.error) return access.error;
  try {
    const device = await issueTrustedAdminDevice(request, env, access.user.id);
    const response = json({ ok: true, trusted: true, expires_at: device.expiresAt });
    response.headers.append("set-cookie", device.setCookie);
    return response;
  } catch (error) {
    const code = error?.message === "ADMIN_TRUST_SCHEMA_NOT_READY"
      ? "ADMIN_TRUST_SCHEMA_NOT_READY"
      : "ADMIN_TRUST_UNAVAILABLE";
    return json({ ok: false, error: code }, 503);
  }
}
