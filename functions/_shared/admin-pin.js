
import { config, json, readJson, callRpc } from "./superbase.js";
import { requireAdmin } from "./admin-auth.js";

const PIN_PATTERN = /^\d{6}$/;
const ITERATIONS = 600000;
const SETUP_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const VERIFY_CHALLENGE_TTL_MS = 90 * 1000;
const WEAK_PINS = new Set([
  "000000","111111","222222","333333","444444","555555","666666","777777","888888","999999",
  "123456","234567","345678","456789","654321","543210","432109","987654","121212","112233","123123"
]);

function error(code, status, extra = {}) {
  return json({ error: code, ...extra }, status);
}
function setupFailureDiagnostic(stage, err) {
  const message = String(err?.message || "");
  const status = Number(err?.httpStatus) || 0;
  if (message === "BACKEND_NOT_CONFIGURED") {
    return stage === "LOAD_INSERT_CONFIG" ? "INSERT_BACKEND_NOT_CONFIGURED" : "BACKEND_NOT_CONFIGURED";
  }
  if (message === "ADMIN_PIN_DATABASE_UNAVAILABLE" && status) return "CHECK_EXISTING_PIN_HTTP_" + status;
  if (message === "BODY_TOO_LARGE") return "REQUEST_BODY_TOO_LARGE";
  if (stage === "READ_REQUEST") return "REQUEST_READ_FAILED";
  if (stage === "CHECK_EXISTING_PIN") {
    if (err?.name === "SyntaxError") return "CHECK_EXISTING_PIN_INVALID_RESPONSE";
    if (err?.name === "TypeError") return "CHECK_EXISTING_PIN_NETWORK_ERROR";
    return "CHECK_EXISTING_PIN_INTERNAL_ERROR";
  }
  if (stage === "LOAD_INSERT_CONFIG") return "INSERT_CONFIG_LOAD_FAILED";
  if (stage === "INSERT_PIN" && err?.name === "TypeError") return "INSERT_PIN_NETWORK_ERROR";
  if (stage === "INSERT_PIN") return "INSERT_PIN_INTERNAL_ERROR";
  return "SETUP_UNEXPECTED_STAGE_ERROR";
}
function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function fromHex(value) {
  return Uint8Array.from(value.match(/.{2}/g) || [], (part) => parseInt(part, 16));
}
function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecode(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(normalized);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}
async function challengeSigningKey(env) {
  const { secretKey } = config(env);
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}
async function signChallenge(payload, env) {
  const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await challengeSigningKey(env);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart));
  return payloadPart + "." + base64UrlEncode(new Uint8Array(signature));
}
async function verifyChallenge(token, env) {
  if (typeof token !== "string" || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const signature = base64UrlDecode(parts[1]);
  const payloadBytes = base64UrlDecode(parts[0]);
  if (!signature || signature.length !== 32 || !payloadBytes) return null;
  const key = await challengeSigningKey(env);
  const valid = await crypto.subtle.verify(
    "HMAC", key, signature, new TextEncoder().encode(parts[0])
  );
  if (!valid) return null;
  try {
    return JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
}
function validChallengeTimes(payload, ttl, now = Date.now()) {
  return Number.isSafeInteger(payload?.issued_at) &&
    Number.isSafeInteger(payload?.expires_at) &&
    payload.issued_at <= now + 30000 &&
    payload.expires_at > now &&
    payload.expires_at - payload.issued_at <= ttl;
}
async function readAdminPin(env, userId) {
  const { url, secretKey } = config(env);
  const response = await fetch(
    url + "/rest/v1/admin_security?user_id=eq." + encodeURIComponent(userId) +
      "&select=user_id,pin_hash,pin_salt,pin_iterations,failed_attempts,locked_until,last_verified_at,last_verified_session_id&limit=1",
    { headers: { apikey: secretKey, authorization: "Bearer " + secretKey, accept: "application/json" } }
  );
  if (!response.ok) {
    const err = new Error("ADMIN_PIN_DATABASE_UNAVAILABLE");
    err.httpStatus = response.status;
    throw err;
  }
  const rows = await response.json();
  return rows?.[0] || null;
}
export async function adminPinStatus(request, env) {
  const access = await requireAdmin(request, env);
  if (access.error) return access.error;
  try {
    const record = await readAdminPin(env, access.user.id);
    return json({
      ok: true,
      pin_configured: Boolean(record?.pin_hash),
      locked_until: record?.locked_until || null
    });
  } catch {
    return error("ADMIN_PIN_DATABASE_UNAVAILABLE", 503);
  }
}
export async function adminPinSetupChallenge(request, env) {
  const access = await requireAdmin(request, env);
  if (access.error) return access.error;
  try {
    const existing = await readAdminPin(env, access.user.id);
    if (existing) return error("ADMIN_PIN_ALREADY_SET", 409);

    const saltHex = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const now = Date.now();
    const challenge = await signChallenge({
      version: 1,
      purpose: "setup",
      sub: access.user.id,
      salt: saltHex,
      iterations: ITERATIONS,
      issued_at: now,
      expires_at: now + SETUP_CHALLENGE_TTL_MS,
      nonce: toHex(crypto.getRandomValues(new Uint8Array(16)))
    }, env);
    return json({ ok: true, challenge, salt: saltHex, iterations: ITERATIONS });
  } catch (err) {
    const diagnostic = err?.message === "ADMIN_PIN_DATABASE_UNAVAILABLE"
      ? "CHECK_EXISTING_PIN_FAILED"
      : "SETUP_CHALLENGE_FAILED";
    console.error("ADMIN_PIN_SETUP_CHALLENGE_FAILED", JSON.stringify({
      diagnostic,
      error_name: String(err?.name || "Error").slice(0, 40),
      http_status: Number(err?.httpStatus) || null
    }));
    return error("ADMIN_PIN_SETUP_FAILED", 503, { diagnostic });
  }
}

export async function adminPinChallenge(request, env) {
  const access = await requireAdmin(request, env);
  if (access.error) return access.error;
  try {
    const claims = decodeJwtPayload(access.accessToken);
    const sessionId = claims?.session_id;
    if (
      claims?.sub !== access.user.id ||
      typeof sessionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
    ) return error("ADMIN_PIN_SESSION_INVALID", 401);

    const record = await readAdminPin(env, access.user.id);
    if (!record?.pin_hash || !record?.pin_salt) return error("ADMIN_PIN_NOT_SET", 409);
    const iterations = Number(record.pin_iterations);
    if (
      !Number.isInteger(iterations) || iterations !== ITERATIONS ||
      !/^[a-f0-9]{32}$/.test(record.pin_salt) ||
      !/^[a-f0-9]{64}$/.test(record.pin_hash)
    ) return error("ADMIN_PIN_CONFIGURATION_INVALID", 503);
    if (record.locked_until && Date.parse(record.locked_until) > Date.now()) {
      return json({ error: "ADMIN_PIN_TEMPORARILY_LOCKED", locked_until: record.locked_until }, 423);
    }

    const now = Date.now();
    const challenge = await signChallenge({
      version: 1,
      purpose: "verify",
      sub: access.user.id,
      session_id: sessionId,
      salt: record.pin_salt,
      iterations,
      failed_attempts: Number(record.failed_attempts || 0),
      last_verified_at: record.last_verified_at || null,
      issued_at: now,
      expires_at: now + VERIFY_CHALLENGE_TTL_MS,
      nonce: toHex(crypto.getRandomValues(new Uint8Array(16)))
    }, env);
    return json({ ok: true, challenge, salt: record.pin_salt, iterations });
  } catch (err) {
    console.error("ADMIN_PIN_CHALLENGE_ISSUE_FAILED", JSON.stringify({
      error_name: String(err?.name || "Error").slice(0, 40),
      http_status: Number(err?.httpStatus) || null
    }));
    return error("ADMIN_PIN_SECURITY_UNAVAILABLE", 503);
  }
}

export async function setupAdminPin(request, env) {
  const access = await requireAdmin(request, env);
  if (access.error) return access.error;
  let stage = "READ_REQUEST";
  try {
    const body = await readJson(request, 5000);
    const pin = typeof body?.pin === "string" ? body.pin : "";
    const pinHash = typeof body?.pin_hash === "string" ? body.pin_hash : "";
    const challengeToken = typeof body?.challenge === "string" ? body.challenge : "";
    if (!PIN_PATTERN.test(pin)) return error("ADMIN_PIN_MUST_BE_6_DIGITS", 400);
    if (WEAK_PINS.has(pin) || /^([0-9])\1{5}$/.test(pin)) return error("ADMIN_PIN_TOO_WEAK", 400);
    if (!/^[a-f0-9]{64}$/.test(pinHash)) return error("ADMIN_PIN_HASH_INVALID", 400);

    const challenge = await verifyChallenge(challengeToken, env);
    if (
      !challenge ||
      challenge.version !== 1 ||
      challenge.purpose !== "setup" ||
      challenge.sub !== access.user.id ||
      !validChallengeTimes(challenge, SETUP_CHALLENGE_TTL_MS) ||
      challenge.iterations !== ITERATIONS ||
      !/^[a-f0-9]{32}$/.test(challenge.salt) ||
      !/^[a-f0-9]{32}$/.test(challenge.nonce)
    ) return error("ADMIN_PIN_CHALLENGE_INVALID", 401);

    stage = "CHECK_EXISTING_PIN";
    const existing = await readAdminPin(env, access.user.id);
    if (existing) return error("ADMIN_PIN_ALREADY_SET", 409);

    stage = "LOAD_INSERT_CONFIG";
    const { url, secretKey } = config(env);
    stage = "INSERT_PIN";
    const response = await fetch(url + "/rest/v1/admin_security", {
      method: "POST",
      headers: {
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
        "content-type": "application/json",
        accept: "application/json",
        prefer: "return=minimal"
      },
      body: JSON.stringify({
        user_id: access.user.id,
        pin_hash: pinHash,
        pin_salt: challenge.salt,
        pin_iterations: ITERATIONS
      })
    });
    if (!response.ok) {
      const rawError = await response.text();
      if (response.status === 409) return error("ADMIN_PIN_ALREADY_SET", 409);
      let dbError = {};
      try { dbError = rawError ? JSON.parse(rawError) : {}; } catch {}
      const rawCode = typeof dbError.code === "string" ? dbError.code : "";
      const safeCode = ({
        "23505": "UNIQUE_CONSTRAINT",
        "23503": "FOREIGN_KEY_CONSTRAINT",
        "23514": "CHECK_CONSTRAINT",
        "23502": "NOT_NULL_CONSTRAINT",
        "42501": "PERMISSION_DENIED",
        "42P01": "TABLE_MISSING",
        "42703": "COLUMN_MISSING",
        "PGRST116": "POSTGREST_RESPONSE",
        "PGRST204": "COLUMN_NOT_IN_SCHEMA_CACHE",
        "PGRST205": "TABLE_NOT_IN_SCHEMA_CACHE"
      })[rawCode] || (response.status === 401
        ? "INVALID_SERVICE_ROLE_KEY"
        : response.status === 403
          ? "DATABASE_PERMISSION_DENIED"
          : "DATABASE_REJECTED_INSERT");
      const diagnostic = "INSERT_HTTP_" + response.status + "_" + safeCode;
      console.error("ADMIN_PIN_SETUP_INSERT_FAILED", JSON.stringify({
        status: response.status,
        code: safeCode
      }));
      return error("ADMIN_PIN_SETUP_FAILED", 503, { diagnostic });
    }
    return json({ ok: true, pin_configured: true });
  } catch (err) {
    if (err?.message === "INVALID_JSON") return error("INVALID_JSON", 400);
    const diagnostic = setupFailureDiagnostic(stage, err);
    console.error("ADMIN_PIN_SETUP_EXCEPTION", JSON.stringify({
      stage,
      diagnostic,
      error_name: String(err?.name || "Error").slice(0, 40),
      http_status: Number(err?.httpStatus) || null
    }));
    return error("ADMIN_PIN_SETUP_FAILED", 503, { diagnostic });
  }
}
export async function requireAdminPinSession(request, env) {
  const access = await requireAdmin(request, env);
  if (access.error) return access;
  try {
    const claims = decodeJwtPayload(access.accessToken);
    const sessionId = claims?.session_id;
    if (
      claims?.sub !== access.user.id ||
      typeof sessionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
    ) return { error: error("ADMIN_PIN_REQUIRED", 403) };

    const record = await readAdminPin(env, access.user.id);
    const verifiedAt = Date.parse(record?.last_verified_at || "");
    const sameSession = record?.last_verified_session_id === sessionId;
    // The PIN is confirmed for this authenticated Admin session, not every few minutes.
    // A 12-hour ceiling keeps the dashboard usable while still forcing a new PIN
    // after a new sign-in or a long-lived session.
    const fresh = Number.isFinite(verifiedAt) && Date.now() - verifiedAt <= 12 * 60 * 60 * 1000;
    const currentlyLocked = record?.locked_until && Date.parse(record.locked_until) > Date.now();
    if (!record?.pin_hash || !sameSession || !fresh || currentlyLocked) {
      return { error: error("ADMIN_PIN_REQUIRED", 403) };
    }
    return access;
  } catch {
    return { error: error("ADMIN_PIN_SECURITY_UNAVAILABLE", 503) };
  }
}

export async function verifyAdminPin(request, env) {
  const access = await requireAdmin(request, env);
  if (access.error) return access.error;
  try {
    const claims = decodeJwtPayload(access.accessToken);
    const sessionId = claims?.session_id;
    if (
      claims?.sub !== access.user.id ||
      typeof sessionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
    ) return error("ADMIN_PIN_SESSION_INVALID", 401);

    const body = await readJson(request, 5000);
    const challengeToken = typeof body?.challenge === "string" ? body.challenge : "";
    const responseHex = typeof body?.response === "string" ? body.response : "";
    if (!/^[a-f0-9]{64}$/.test(responseHex)) return error("ADMIN_PIN_RESPONSE_INVALID", 400);

    const challenge = await verifyChallenge(challengeToken, env);
    if (
      !challenge ||
      challenge.version !== 1 ||
      challenge.purpose !== "verify" ||
      challenge.sub !== access.user.id ||
      challenge.session_id !== sessionId ||
      !validChallengeTimes(challenge, VERIFY_CHALLENGE_TTL_MS) ||
      !/^[a-f0-9]{32}$/.test(challenge.nonce)
    ) return error("ADMIN_PIN_CHALLENGE_INVALID", 401);

    const record = await readAdminPin(env, access.user.id);
    if (!record?.pin_hash || !record?.pin_salt) return error("ADMIN_PIN_NOT_SET", 409);
    if (record.locked_until && Date.parse(record.locked_until) > Date.now()) {
      return json({ error: "ADMIN_PIN_TEMPORARILY_LOCKED", locked_until: record.locked_until }, 423);
    }
    const iterations = Number(record.pin_iterations);
    if (
      !Number.isInteger(iterations) || iterations !== ITERATIONS ||
      !/^[a-f0-9]{32}$/.test(record.pin_salt) ||
      !/^[a-f0-9]{64}$/.test(record.pin_hash)
    ) return error("ADMIN_PIN_CONFIGURATION_INVALID", 503);

    // A successful or failed RPC changes one of these values. Requiring the
    // snapshot to match makes a challenge unusable after its first attempt.
    if (
      challenge.salt !== record.pin_salt ||
      challenge.iterations !== iterations ||
      challenge.failed_attempts !== Number(record.failed_attempts || 0) ||
      challenge.last_verified_at !== (record.last_verified_at || null)
    ) return error("ADMIN_PIN_CHALLENGE_EXPIRED", 409);

    const pinKey = await crypto.subtle.importKey(
      "raw",
      fromHex(record.pin_hash),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      pinKey,
      fromHex(responseHex),
      new TextEncoder().encode(challengeToken)
    );

    const attempt = await callRpc(env, "record_admin_pin_attempt", {
      p_user_id: access.user.id,
      p_success: valid,
      p_session_id: sessionId
    });
    if (
      !Array.isArray(attempt) || attempt.length !== 1 ||
      typeof attempt[0]?.is_locked !== "boolean"
    ) return error("ADMIN_PIN_SECURITY_UNAVAILABLE", 503);
    if (attempt[0].is_locked) {
      return json({
        error: "ADMIN_PIN_TEMPORARILY_LOCKED",
        locked_until: attempt[0].locked_until || null
      }, 423);
    }
    if (!valid) {
      return json({
        error: "ADMIN_PIN_INVALID",
        attempts_remaining: Math.max(0, 5 - Number(attempt[0].failed_attempts || 0))
      }, 401);
    }
    return json({ ok: true, pin_verified: true });
  } catch (err) {
    if (err?.message === "INVALID_JSON") return error("INVALID_JSON", 400);
    return error("ADMIN_PIN_SECURITY_UNAVAILABLE", 503);
  }
}


const RESET_CHALLENGE_TTL_MS = 5 * 60 * 1000;

async function requireAal2AdminForPinRecovery(request, env) {
  const access = await requireAdmin(request, env);
  if (access.error) return access;
  const claims = decodeJwtPayload(access.accessToken);
  const sessionId = claims?.session_id;
  if (
    claims?.sub !== access.user.id ||
    claims?.aal !== "aal2" ||
    typeof sessionId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
  ) return { error: error("MFA_REQUIRED", 403, { required_level: "aal2" }) };
  return { access, sessionId };
}

export async function adminPinResetChallenge(request, env) {
  const verified = await requireAal2AdminForPinRecovery(request, env);
  if (verified.error) return verified.error;
  try {
    const existing = await readAdminPin(env, verified.access.user.id);
    if (!existing?.pin_hash) return error("ADMIN_PIN_NOT_SET", 409);

    const { url, secretKey } = config(env);
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const now = Date.now();
    const expiresAt = now + RESET_CHALLENGE_TTL_MS;
    const challenge = await signChallenge({
      version: 1,
      purpose: "pin_reset",
      sub: verified.access.user.id,
      session_id: verified.sessionId,
      salt,
      iterations: ITERATIONS,
      issued_at: now,
      expires_at: expiresAt,
      nonce
    }, env);

    const response = await fetch(url + "/rest/v1/admin_pin_reset_challenges", {
      method: "POST",
      headers: {
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
        "content-type": "application/json",
        accept: "application/json",
        prefer: "return=minimal"
      },
      body: JSON.stringify({
        nonce,
        user_id: verified.access.user.id,
        session_id: verified.sessionId,
        expires_at: new Date(expiresAt).toISOString()
      })
    });
    if (!response.ok) {
      console.error("ADMIN_PIN_RESET_CHALLENGE_STORE_FAILED", JSON.stringify({
        status: response.status
      }));
      return error("ADMIN_PIN_RESET_UNAVAILABLE", 503);
    }

    return json({ ok: true, challenge, salt, iterations: ITERATIONS, expires_at: new Date(expiresAt).toISOString() });
  } catch (err) {
    console.error("ADMIN_PIN_RESET_CHALLENGE_FAILED", JSON.stringify({
      error_name: String(err?.name || "Error").slice(0, 40),
      http_status: Number(err?.httpStatus) || null
    }));
    return error("ADMIN_PIN_RESET_UNAVAILABLE", 503);
  }
}

export async function resetAdminPin(request, env) {
  const verified = await requireAal2AdminForPinRecovery(request, env);
  if (verified.error) return verified.error;
  try {
    const body = await readJson(request, 5000);
    // The raw PIN never leaves the browser during recovery. Only the
    // PBKDF2-derived value and its one-use challenge proof are transmitted.
    const pinHash = typeof body?.pin_hash === "string" ? body.pin_hash : "";
    const challengeToken = typeof body?.challenge === "string" ? body.challenge : "";
    const responseHex = typeof body?.response === "string" ? body.response : "";
    if (!/^[a-f0-9]{64}$/.test(pinHash) || !/^[a-f0-9]{64}$/.test(responseHex)) {
      return error("ADMIN_PIN_RESPONSE_INVALID", 400);
    }

    const challenge = await verifyChallenge(challengeToken, env);
    if (
      !challenge ||
      challenge.version !== 1 ||
      challenge.purpose !== "pin_reset" ||
      challenge.sub !== verified.access.user.id ||
      challenge.session_id !== verified.sessionId ||
      !validChallengeTimes(challenge, RESET_CHALLENGE_TTL_MS) ||
      !/^[a-f0-9]{32}$/.test(challenge.salt) ||
      !/^[a-f0-9]{32}$/.test(challenge.nonce) ||
      challenge.iterations !== ITERATIONS
    ) return error("ADMIN_PIN_RESET_CHALLENGE_INVALID", 401);

    const pinKey = await crypto.subtle.importKey(
      "raw",
      fromHex(pinHash),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      pinKey,
      fromHex(responseHex),
      new TextEncoder().encode(challengeToken)
    );
    if (!valid) return error("ADMIN_PIN_RESPONSE_INVALID", 401);

    await callRpc(env, "reset_admin_pin", {
      p_user_id: verified.access.user.id,
      p_session_id: verified.sessionId,
      p_nonce: challenge.nonce,
      p_pin_hash: pinHash,
      p_pin_salt: challenge.salt,
      p_pin_iterations: ITERATIONS
    });
    return json({ ok: true, pin_reset: true, session_verified: true });
  } catch (err) {
    if (err?.message === "INVALID_JSON") return error("INVALID_JSON", 400);
    const message = String(err?.message || "");
    const known = message.includes("ADMIN_PIN_RESET_CHALLENGE_INVALID")
      ? "ADMIN_PIN_RESET_CHALLENGE_INVALID"
      : message.includes("ADMIN_PIN_NOT_SET")
        ? "ADMIN_PIN_NOT_SET"
        : "ADMIN_PIN_RESET_UNAVAILABLE";
    console.error("ADMIN_PIN_RESET_FAILED", JSON.stringify({
      diagnostic: known,
      error_name: String(err?.name || "Error").slice(0, 40)
    }));
    return error(known, known === "ADMIN_PIN_RESET_CHALLENGE_INVALID" ? 409 : 503);
  }
}
