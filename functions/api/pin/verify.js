import { json, requireUser, config, callRpc, readJson } from "../../_shared/superbase.js";

const PIN_PATTERN = /^\d{4}$/;

function toHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function derivePinHash(pin, saltHex, iterations) {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g), part => parseInt(part, 16));
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    256
  );
  return toHex(new Uint8Array(bits));
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function getSecurityRecord(env, userId) {
  const { url, secretKey } = config(env);
  const response = await fetch(
    `${url}/rest/v1/user_security?user_id=eq.${encodeURIComponent(userId)}&select=pin_hash,pin_salt,pin_iterations,locked_until&limit=1`,
    {
      headers: {
        apikey: secretKey,
        authorization: `Bearer ${secretKey}`,
        accept: "application/json",
      },
    }
  );
  if (!response.ok) throw new Error("PIN_SECURITY_READ_FAILED");
  const rows = await response.json();
  return rows?.[0] || null;
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;

    const body = await readJson(request, 2000);
    if (!PIN_PATTERN.test(body?.pin || "")) {
      return json({ error: "PIN_MUST_BE_4_DIGITS" }, 400);
    }

    const record = await getSecurityRecord(env, auth.user.id);
    if (!record?.pin_hash || !record?.pin_salt) {
      return json({ error: "PIN_NOT_SET" }, 409);
    }

    if (record.locked_until && Date.parse(record.locked_until) > Date.now()) {
      return json({ error: "PIN_TEMPORARILY_LOCKED" }, 423);
    }

    const iterations = Number(record.pin_iterations);
    if (!Number.isInteger(iterations) || iterations < 600000 || iterations > 1000000) {
      return json({ error: "PIN_CONFIGURATION_INVALID" }, 503);
    }

    const candidate = await derivePinHash(body.pin, record.pin_salt, iterations);
    const valid = constantTimeEqual(candidate, record.pin_hash);

    const attempt = await callRpc(env, "record_pin_attempt", {
      p_user_id: auth.user.id,
      p_success: valid,
    });
    if (
      !Array.isArray(attempt) ||
      attempt.length !== 1 ||
      typeof attempt[0]?.is_locked !== "boolean"
    ) {
      return json({ error: "PIN_SECURITY_UNAVAILABLE" }, 503);
    }
    if (attempt[0].is_locked) {
      return json({
        error: "PIN_TEMPORARILY_LOCKED",
        locked_until: attempt[0].locked_until || null
      }, 423);
    }
    if (!valid) {
      return json({
        error: "PIN_INVALID",
        attempts_remaining: Math.max(0, 3 - Number(attempt[0].failed_attempts || 0))
      }, 401);
    }
    return json({ ok: true, pin_verified: true });
  } catch {
    return json({ error: "PIN_VERIFICATION_UNAVAILABLE" }, 503);
  }
}
