import { json, config, readJson } from "../../../_shared/superbase.js";
import { requireAdminAal2 } from "../../../_shared/security.js";

const GRANT_TTL_MS = 60 * 1000;
const MAX_TOTP_AGE_SECONDS = 90;
const ACTION_KEY_PATTERN = /^(POST|PUT|PATCH|DELETE):(\/api\/admin\/(?!action-mfa\/grant$)(?!pin\/)[A-Za-z0-9/_-]{1,130}):([a-f0-9]{64})$/;

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fingerprintToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAdminAal2(request, env);
  if (auth.error) return auth.error;

  try {
    const body = await readJson(request, 3000);
    const actionKey = typeof body?.action_key === "string" ? body.action_key : "";
    if (!ACTION_KEY_PATTERN.test(actionKey)) {
      return json({ error: "ADMIN_ACTION_MFA_ACTION_INVALID" }, 400);
    }

    const totpProof = (Array.isArray(auth.claims?.amr) ? auth.claims.amr : [])
      .filter((item) => item?.method === "totp")
      .sort((left, right) => Number(right.timestamp) - Number(left.timestamp))[0];
    const verifiedAt = Number(totpProof?.timestamp);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(verifiedAt) ||
      verifiedAt > nowSeconds + 15 ||
      nowSeconds - verifiedAt > MAX_TOTP_AGE_SECONDS
    ) {
      return json({ error: "ADMIN_ACTION_MFA_FRESH_CODE_REQUIRED" }, 403);
    }

    const grantId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + GRANT_TTL_MS);
    const proofFingerprint = await fingerprintToken(auth.accessToken);
    const { url, secretKey } = config(env);

    const response = await fetch(url + "/rest/v1/admin_action_mfa_grants", {
      method: "POST",
      headers: {
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
        "content-type": "application/json",
        accept: "application/json",
        prefer: "return=minimal"
      },
      body: JSON.stringify({
        grant_id: grantId,
        user_id: auth.user.id,
        session_id: auth.claims.session_id,
        action_key: actionKey,
        proof_fingerprint: proofFingerprint,
        totp_verified_at: new Date(verifiedAt * 1000).toISOString(),
        expires_at: expiresAt.toISOString()
      })
    });

    if (response.status === 409) {
      return json({ error: "ADMIN_ACTION_MFA_CODE_REUSED" }, 409);
    }
    if (!response.ok) {
      return json({ error: "ADMIN_ACTION_MFA_NOT_READY" }, 503);
    }

    return json({
      ok: true,
      grant_id: grantId,
      expires_at: expiresAt.toISOString()
    });
  } catch (error) {
    if (error?.message === "INVALID_JSON") return json({ error: "INVALID_JSON" }, 400);
    return json({ error: "ADMIN_ACTION_MFA_NOT_READY" }, 503);
  }
}
