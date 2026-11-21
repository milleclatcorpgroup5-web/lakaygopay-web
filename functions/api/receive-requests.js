import { json, requireUser, callUserRpc, readJson, validUuid, validAmount, idempotencyKey } from "../_shared/supabase.js";
import { financialFail } from "../_shared/financial-errors.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const key = idempotencyKey(request);
    if (!key) return json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400);
    if (!validUuid(body?.wallet_id)) return json({ error: "INVALID_WALLET_ID" }, 400);
    const amount = validAmount(body?.amount, { optional: true });
    if (body?.amount != null && body.amount !== "" && !amount) return json({ error: "INVALID_AMOUNT" }, 400);
    const expires = Number(body?.expires_in_minutes ?? 20);
    if (!Number.isInteger(expires) || expires < 15 || expires > 30) return json({ error: "INVALID_EXPIRY" }, 400);
    const result = await callUserRpc(env, auth.accessToken, "create_personal_receive_request", {
      p_recipient_wallet_id: body.wallet_id,
      p_amount: amount,
      p_expires_in_minutes: expires,
      p_idempotency_key: key
    });
    return json({ ok: true, receive_request: result,
      qr_payload: `lakaygopay://receive/${result.qr_token}`,
      note: "Kòd resepsyon sa a pa deplase lajan. Moun k ap voye a dwe verifye epi konfime ak PIN." }, 201);
  } catch (error) {
    return financialFail(error);
  }
}
