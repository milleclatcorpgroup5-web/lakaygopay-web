
import { config, json, requireUser, readJson, callRpc } from "./superbase.js";
import { requireAdmin } from "./admin-auth.js";

const PIN_PATTERN = /^\d{6}$/;
const ITERATIONS = 600000;
const WEAK_PINS = new Set([
  "000000","111111","222222","333333","444444","555555","666666","777777","888888","999999",
  "123456","234567","345678","456789","654321","543210","432109","987654","121212","112233","123123"
]);

function error(code, status) {
  return json({ error: code }, status);
}
function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function fromHex(value) {
  return Uint8Array.from(value.match(/.{2}/g) || [], (part) => parseInt(part, 16));
}
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function deriveHash(pin, saltHex, iterations) {
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations }, material, 256
  );
  return toHex(new Uint8Array(bits));
}
async function readAdminPin(env, userId) {
  const { url, secretKey } = config(env);
  const response = await fetch(
    url + "/rest/v1/admin_security?user_id=eq." + encodeURIComponent(userId) +
      "&select=user_id,pin_hash,pin_salt,pin_iterations,failed_attempts,locked_until&limit=1",
    { headers: { apikey: secretKey, authorization: "Bearer " + secretKey, accept: "application/json" } }
  );
  if (!response.ok) throw new Error("ADMIN_PIN_DATABASE_UNAVAILABLE");
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
  try {
    const body = await readJson(request, 2000);
    const pin = typeof body?.pin === "string" ? body.pin : "";
    const confirmation = typeof body?.pin_confirmation === "string" ? body.pin_confirmation : "";
    if (!PIN_PATTERN.test(pin)) return error("ADMIN_PIN_MUST_BE_6_DIGITS", 400);
    if (pin !== confirmation) return error("ADMIN_PIN_CONFIRMATION_MISMATCH", 400);
    if (WEAK_PINS.has(pin) || /^([0-9])\1{5}$/.test(pin)) return error("ADMIN_PIN_TOO_WEAK", 400);

    const existing = await readAdminPin(env, access.user.id);
    if (existing) return error("ADMIN_PIN_ALREADY_SET", 409);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = toHex(salt);
    const hash = await deriveHash(pin, saltHex, ITERATIONS);
    const { url, secretKey } = config(env);
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
    if (response.status === 409) return error("ADMIN_PIN_ALREADY_SET", 409);
    if (!response.ok) return error("ADMIN_PIN_SETUP_FAILED", 503);
    return json({ ok: true, pin_configured: true });
  } catch (err) {
    if (err?.message === "INVALID_JSON") return error("INVALID_JSON", 400);
    return error("ADMIN_PIN_SETUP_FAILED", 503);
  }
}
export async function verifyAdminPin(request, env) {
  const access = await requireAdmin(request, env);
  if (access.error) return access.error;
  try {
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
      !/^[a-f0-9]{32}$/.test(record.pin_salt) || !/^[a-f0-9]{64}$/.test(record.pin_hash)
    ) return error("ADMIN_PIN_CONFIGURATION_INVALID", 503);

    const candidate = await deriveHash(pin, record.pin_salt, iterations);
    const valid = constantTimeEqual(candidate, record.pin_hash);
    const attempt = await callRpc(env, "record_admin_pin_attempt", {
      p_user_id: access.user.id,
      p_success: valid
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
