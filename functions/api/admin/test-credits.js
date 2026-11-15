import { json, callRpc, readJson, validUuid, validAmount, idempotencyKey } from "../../_shared/superbase.js";
import { financialFail } from "../../_shared/financial-errors.js";
import { requireAdminAal2 } from "../../_shared/security.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAdminAal2(request, env);
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const key = idempotencyKey(request);
    const amount = validAmount(body?.amount);
    if (!key) return json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400);
    if (!validUuid(body?.wallet_id)) return json({ error: "INVALID_WALLET_ID" }, 400);
    if (!amount) return json({ error: "INVALID_AMOUNT" }, 400);
    const result = await callRpc(env, "create_test_credit", {
      p_admin_user_id: auth.user.id,
      p_wallet_id: body.wallet_id,
      p_amount: amount,
      p_idempotency_key: key,
    });
    return json({ ok: true, test_credit: result }, 201);
  } catch (error) {
    return financialFail(error);
  }
}
