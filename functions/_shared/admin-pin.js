
import { config, json, requireUser, readJson, callRpc } from "./superbase.js";
import { requireAdmin } from "./admin-auth.js";

const PIN_PATTERN = /^\d{6}$/;
const ITERATIONS = 600000;
// Cloudflare Workers rejects a single Web Crypto PBKDF2 call above 100,000 rounds.
// Keep the full 600,000-round work factor by chaining six independently salted
// PBKDF2-SHA-256 stages. Each stage stays within the Workers runtime ceiling.
const WORKERS_PBKDF2_MAX_ITERATIONS = 100000;
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
    return stage === "LOAD_INSERT_CONFIG"
      ? "INSERT_BACKEND_NOT_CONFIGURED"
      : "BACKEND_NOT_CONFIGURED";
  }
  if (message === "ADMIN_PIN_DATABASE_UNAVAILABLE" && status) {
    return "CHECK_EXISTING_PIN_HTTP_" + status;
  }
  if (message === "BODY_TOO_LARGE") return "REQUEST_BODY_TOO_LARGE";

  if (stage === "READ_REQUEST") return "REQUEST_READ_FAILED";
  if (stage === "CHECK_EXISTING_PIN") {
    if (err?.name === "SyntaxError") return "CHECK_EXISTING_PIN_INVALID_RESPONSE";
    if (err?.name === "TypeError") return "CHECK_EXISTING_PIN_NETWORK_ERROR";
    return "CHECK_EXISTING_PIN_INTERNAL_ERROR";
  }
  if (stage === "GENERATE_SALT") return "SALT_GENERATION_FAILED";
  if (stage === "DERIVE_PIN_HASH") {
    if (message === "PIN_KDF_PARAMETERS_INVALID") return "PIN_KDF_PARAMETERS_INVALID";
    if (err?.name === "NotSupportedError") return "PBKDF2_RUNTIME_LIMIT";
    if (err?.name === "OperationError") return "PBKDF2_OPERATION_FAILED";
    if (err?.name === "TypeError") return "PBKDF2_ARGUMENT_INVALID";
    return "PIN_HASH_DERIVATION_FAILED";
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
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function deriveHash(pin, saltHex, iterations) {
  if (
    !Number.isInteger(iterations) ||
    iterations < 600000 ||
    iterations > 1000000 ||
    iterations % WORKERS_PBKDF2_MAX_ITERATIONS !== 0
  ) {
    throw new Error("PIN_KDF_PARAMETERS_INVALID");
  }

  const baseSalt = fromHex(saltHex);
  if (baseSalt.length !== 16) throw new Error("PIN_KDF_PARAMETERS_INVALID");

  const encoder = new TextEncoder();
  let materialBytes = encoder.encode(pin);
  const stageCount = iterations / WORKERS_PBKDF2_MAX_ITERATIONS;

  // This is a staged PBKDF2 construction for Workers, not one oversized
  // PBKDF2 call. Each stage costs 100,000 PBKDF2-SHA-256 rounds and feeds
  // its 256-bit output into the next domain-separated stage.
  for (let stage = 0; stage < stageCount; stage++) {
    const context = encoder.encode("LakayGoPay-AdminPIN-PBKDF2-SHA256-v1:" + stage);
    const stageSalt = new Uint8Array(baseSalt.length + context.length);
    stageSalt.set(baseSalt, 0);
    stageSalt.set(context, baseSalt.length);

    const material = await crypto.subtle.importKey(
      "raw", materialBytes, "PBKDF2", false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: stageSalt,
        iterations: WORKERS_PBKDF2_MAX_ITERATIONS
      },
      material,
      256
    );
    materialBytes = new Uint8Array(bits);
  }

  return toHex(materialBytes);
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
export async function setupAdminPin(request, env) {
  const access = await requireAdmin(request, env);
  if (access.error) return access.error;
  let stage = "READ_REQUEST";
  try {
    const body = await readJson(request, 2000);
    const pin = typeof body?.pin === "string" ? body.pin : "";
    const confirmation = typeof body?.pin_confirmation === "string" ? body.pin_confirmation : "";
    if (!PIN_PATTERN.test(pin)) return error("ADMIN_PIN_MUST_BE_6_DIGITS", 400);
    if (pin !== confirmation) return error("ADMIN_PIN_CONFIRMATION_MISMATCH", 400);
    if (WEAK_PINS.has(pin) || /^([0-9])\1{5}$/.test(pin)) return error("ADMIN_PIN_TOO_WEAK", 400);

    stage = "CHECK_EXISTING_PIN";
    const existing = await readAdminPin(env, access.user.id);
    if (existing) return error("ADMIN_PIN_ALREADY_SET", 409);

    stage = "GENERATE_SALT";
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = toHex(salt);

    stage = "DERIVE_PIN_HASH";
    const hash = await deriveHash(pin, saltHex, ITERATIONS);

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
        pin_hash: hash,
        pin_salt: saltHex,
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
    const fresh = Number.isFinite(verifiedAt) && Date.now() - verifiedAt <= 10 * 60 * 1000;
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
    const body = await readJson(request, 1000);
    const pin = typeof body?.pin === "string" ? body.pin : "";
    if (!PIN_PATTERN.test(pin)) return error("ADMIN_PIN_MUST_BE_6_DIGITS", 400);

    const record = await readAdminPin(env, access.user.id);
    if (!record?.pin_hash || !record?.pin_salt) return error("ADMIN_PIN_NOT_SET", 409);
    if (record.locked_until && Date.parse(record.locked_until) > Date.now()) {
      return json({ error: "ADMIN_PIN_TEMPORARILY_LOCKED", locked_until: record.locked_until }, 423);
    }
    const iterations = Number(record.pin_iterations);
    if (
      !Number.isInteger(iterations) || iterations < 600000 || iterations > 1000000 ||
      iterations % WORKERS_PBKDF2_MAX_ITERATIONS !== 0 ||
      !/^[a-f0-9]{32}$/.test(record.pin_salt) || !/^[a-f0-9]{64}$/.test(record.pin_hash)
    ) return error("ADMIN_PIN_CONFIGURATION_INVALID", 503);

    const candidate = await deriveHash(pin, record.pin_salt, iterations);
    const valid = constantTimeEqual(candidate, record.pin_hash);
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
