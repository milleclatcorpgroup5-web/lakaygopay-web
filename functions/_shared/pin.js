import { config, callRpc } from "./superbase.js";

const PIN_PATTERN = /^\d{4}$/;

function fail(code, status) {
  const error = new Error(code);
  error.status = status;
  throw error;
}

function toHex(bytes) {
  return Array.from(bytes, function (byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function assertTransactionPin(env, userId, pin) {
  if (!PIN_PATTERN.test(typeof pin === "string" ? pin : "")) {
    fail("PIN_MUST_BE_4_DIGITS", 400);
  }

  const settings = config(env);
  const response = await fetch(
    settings.url + "/rest/v1/user_security?user_id=eq." +
      encodeURIComponent(userId) +
      "&select=pin_hash,pin_salt,pin_iterations,locked_until&limit=1",
    {
      headers: {
        apikey: settings.secretKey,
        authorization: "Bearer " + settings.secretKey,
        accept: "application/json",
      },
    }
  );

  if (!response.ok) fail("PIN_SECURITY_UNAVAILABLE", 503);
  const rows = await response.json();
  const record = rows && rows[0];
  if (!record || !record.pin_hash || !record.pin_salt) fail("PIN_NOT_SET", 409);

  if (record.locked_until && Date.parse(record.locked_until) > Date.now()) {
    fail("PIN_TEMPORARILY_LOCKED", 423);
  }

  const iterations = Number(record.pin_iterations);
  if (
    !Number.isInteger(iterations) ||
    iterations < 600000 ||
    iterations > 1000000 ||
    !/^[a-f0-9]{32}$/.test(record.pin_salt) ||
    !/^[a-f0-9]{64}$/.test(record.pin_hash)
  ) {
    fail("PIN_CONFIGURATION_INVALID", 503);
  }

  const salt = Uint8Array.from(record.pin_salt.match(/.{2}/g), function (part) {
    return parseInt(part, 16);
  });
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: iterations },
    material,
    256
  );
  const candidate = toHex(new Uint8Array(bits));
  const valid = constantTimeEqual(candidate, record.pin_hash);

  // The database serializes attempts and returns the authoritative lock state.
  // Fail closed if the RPC response is missing or malformed.
  const attemptResult = await callRpc(env, "record_pin_attempt", {
    p_user_id: userId,
    p_success: valid,
  });
  if (
    !Array.isArray(attemptResult) ||
    attemptResult.length !== 1 ||
    typeof attemptResult[0]?.is_locked !== "boolean"
  ) {
    fail("PIN_SECURITY_UNAVAILABLE", 503);
  }

  // A concurrent request may have activated the lock after the initial read.
  // Always honor the database's post-update lock state, even for a correct PIN.
  if (attemptResult[0].is_locked) {
    fail("PIN_TEMPORARILY_LOCKED", 423);
  }

  if (!valid) fail("PIN_INVALID", 401);
  // Return the verified hash only to trusted server-side callers (never to the browser)
  // so optimistic PIN rotation cannot overwrite a newer concurrent change.
  return record.pin_hash;
}
