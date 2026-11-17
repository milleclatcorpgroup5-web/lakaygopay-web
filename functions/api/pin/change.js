import { json, requireUser, callRpc, readJson } from "../../_shared/superbase.js";
import { financialFail } from "../../_shared/financial-errors.js";
import { assertTransactionPin } from "../../_shared/pin.js";

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

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;

    const body = await readJson(request, 2000);
    const currentPin = typeof body?.current_pin === "string" ? body.current_pin : "";
    const newPin = typeof body?.new_pin === "string" ? body.new_pin : "";
    if (!PIN_PATTERN.test(currentPin)) return json({ error: "CURRENT_PIN_REQUIRED" }, 400);
    if (!PIN_PATTERN.test(newPin)) return json({ error: "PIN_MUST_BE_4_DIGITS" }, 400);
    if (currentPin === newPin) return json({ error: "PIN_MUST_DIFFER_FROM_CURRENT" }, 400);

    // This verifies the existing PIN server-side and records the failed attempt
    // in the database. The returned hash never leaves this Worker.
    const expectedCurrentHash = await assertTransactionPin(env, auth.user.id, currentPin);
    const saltHex = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const pinHash = await derivePinHash(newPin, saltHex);
    const saved = await callRpc(env, "store_user_pin_hash", {
      p_user_id: auth.user.id,
      p_pin_hash: pinHash,
      p_pin_salt: saltHex,
      p_pin_iterations: ITERATIONS,
      p_expected_current_hash: expectedCurrentHash
    });
    if (saved !== true) return json({ error: "PIN_CHANGE_CONFLICT" }, 409);

    return json({ ok: true, pin_changed: true });
  } catch (error) {
    return financialFail(error);
  }
}
