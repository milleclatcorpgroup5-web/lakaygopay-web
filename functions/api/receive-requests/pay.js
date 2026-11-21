import { json, requireUser, callRpc, readJson, validUuid, validAmount, idempotencyKey } from "../../_shared/supabase.js";
import { financialFail } from "../../_shared/financial-errors.js";
import { assertTransactionPin } from "../../_shared/pin.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const key = idempotencyKey(request);
    if (!key) return json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400);
    if (!validUuid(body?.qr_token) || !validUuid(body?.sender_wallet_id)) {
      return json({ error: "INVALID_QR_OR_WALLET" }, 400);
    }
    const amount = validAmount(body?.amount, { optional: true });
    if (body?.amount != null && body.amount !== "" && !amount) return json({ error: "INVALID_AMOUNT" }, 400);
    await assertTransactionPin(env, auth.user.id, body?.pin);
    const result = await callRpc(env, "pay_personal_receive_request_server_authorized", {
      p_actor_user_id: auth.user.id,
      p_public_token: body.qr_token,
      p_sender_wallet_id: body.sender_wallet_id,
      p_amount: amount,
      p_idempotency_key: key
    });
    if (result?.status === "posted") return json({ ok: true, transfer: result });
    return json({ ok: false, transfer: result }, 409);
  } catch (error) {
    return financialFail(error);
  }
}
