import { json, requireUser, config, callRpc, readJson } from "../../_shared/superbase.js";

const PIN_PATTERN = /^\d{4}$/;
const ITERATIONS = 600000;

function toHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function derivePinHash(pin, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g), part => parseInt(part, 16));
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    material,
    256
  );
  return toHex(new Uint8Array(bits));
}

async function getSecurityRecord(env, userId) {
  const { url, secretKey } = config(env);
  const response = await fetch(
    `${url}/rest/v1/user_security?user_id=eq.${encodeURIComponent(userId)}&select=pin_hash&limit=1`,
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

    const existing = await getSecurityRecord(env, auth.user.id);
    if (existing?.pin_hash) return json({ error: "PIN_ALREADY_SET" }, 409);

    const saltHex = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const pinHash = await derivePinHash(body.pin, saltHex);
    const saved = await callRpc(env, "store_user_pin_hash", {
      p_user_id: auth.user.id,
      p_pin_hash: pinHash,
      p_pin_salt: saltHex,
      p_pin_iterations: ITERATIONS,
      p_expected_current_hash: null,
    });

    if (saved !== true) return json({ error: "PIN_SETUP_FAILED" }, 409);
    return json({ ok: true, pin_configured: true });
  } catch {
    return json({ error: "PIN_SETUP_UNAVAILABLE" }, 503);
  }
}
