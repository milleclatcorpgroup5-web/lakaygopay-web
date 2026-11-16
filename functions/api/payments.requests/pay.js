import { json, requireUser, callRpc, readJson, validUuid, validAmount, idempotencyKey } from "../../_shared/superbase.js";
import { financialFail } from "../../_shared/financial-errors.js";
import { assertTransactionPin } from "../../_shared/pin.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const key = idempotencyKey(request);
    if (!key) return json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400);
    if (!validUuid(body?.qr_token) || !validUuid(body?.payer_wallet_id)) {
      return json({ error: "INVALID_QR_OR_WALLET" }, 400);
    }
    const amount = validAmount(body?.amount, { optional: true });
    if (body?.amount != null && body.amount !== "" && !amount) return json({ error: "INVALID_AMOUNT" }, 400);

    // Every internal QR settlement requires a server-verified transaction PIN.
    await assertTransactionPin(env, auth.user.id, body?.pin);
    const result = await callRpc(env, "pay_merchant_payment_request", {
      p_actor_user_id: auth.user.id,
      p_public_token: body.qr_token,
      p_payer_wallet_id: body.payer_wallet_id,
      p_amount: amount,
      p_idempotency_key: key,
    });
    if (result?.status === "paid") return json({ ok: true, payment: result });
    return json({ ok: false, payment: result }, 409);
  } catch (error) {
    return financialFail(error);
  }
}
