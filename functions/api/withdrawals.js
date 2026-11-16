import { json, requireUser, callRpc, callUserRest, readJson, validUuid, validAmount, idempotencyKey } from "../_shared/superbase.js";
import { financialFail } from "../_shared/financial-errors.js";
import { assertTransactionPin } from "../_shared/pin.js";

const destinations = new Set(["moncash", "natcash", "bank", "cash_agent", "other"]);

function decodeBase64(value) {
  const clean = value.replace(/\s+/g, "");
  const binary = atob(clean);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function encodeBase64(value) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
async function encryptDestination(value, secret) {
  const rawKey = decodeBase64(secret);
  if (rawKey.byteLength !== 32) throw new Error("WITHDRAWAL_ENCRYPTION_KEY_INVALID");
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `enc:v1:${encodeBase64(iv)}:${encodeBase64(new Uint8Array(encrypted))}`;
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const withdrawals = await callUserRest(env, auth.accessToken,
      "withdrawal_requests?select=id,wallet_id,amount,currency,destination_type,status,created_at,updated_at&order=created_at.desc&limit=50");
    return json({ ok: true, withdrawals: withdrawals || [] });
  } catch (error) {
    return financialFail(error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const body = await readJson(request);
    await assertTransactionPin(env, auth.user.id, body?.pin);
    const key = idempotencyKey(request);
    if (!key) return json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400);
    if (!validUuid(body?.wallet_id)) return json({ error: "INVALID_WALLET_ID" }, 400);
    const amount = validAmount(body?.amount);
    if (!amount) return json({ error: "INVALID_AMOUNT" }, 400);
    if (!destinations.has(body?.destination_type)) return json({ error: "INVALID_DESTINATION_TYPE" }, 400);

    let encryptedReference = null;
    if (body?.destination_reference) {
      if (typeof body.destination_reference !== "string" || body.destination_reference.trim().length < 5 || body.destination_reference.length > 120) {
        return json({ error: "INVALID_DESTINATION_REFERENCE" }, 400);
      }
      if (!env.WITHDRAWAL_DATA_KEY) return json({ error: "WITHDRAWAL_ENCRYPTION_NOT_CONFIGURED" }, 503);
      encryptedReference = await encryptDestination(body.destination_reference.trim(), env.WITHDRAWAL_DATA_KEY);
    }

    const withdrawal = await callRpc(env, "create_withdrawal_request", {
      p_actor_user_id: auth.user.id,
      p_wallet_id: body.wallet_id,
      p_amount: amount,
      p_destination_type: body.destination_type,
      p_destination_reference_encrypted: encryptedReference,
      p_idempotency_key: key,
    });
    return json({ ok: true, withdrawal }, 201);
  } catch (error) {
    return financialFail(error);
  }
}
