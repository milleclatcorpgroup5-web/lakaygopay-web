import { json, requireUser, callRpc, readJson, validUuid, validAmount, idempotencyKey } from "../_shared/superbase.js";
import { financialFail } from "../_shared/financial-errors.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const key = idempotencyKey(request);
    const amount = validAmount(body?.amount);
    if (!key) return json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400);
    if (!validUuid(body?.sender_wallet_id) || !validUuid(body?.recipient_wallet_id)) {
      return json({ error: "INVALID_WALLET_ID" }, 400);
    }
    if (!amount) return json({ error: "INVALID_AMOUNT" }, 400);
    if (body?.note != null && (typeof body.note !== "string" || body.note.length > 140)) {
      return json({ error: "NOTE_TOO_LONG" }, 400);
    }
    const transfer = await callRpc(env, "post_wallet_transfer", {
      p_actor_user_id: auth.user.id,
      p_sender_wallet_id: body.sender_wallet_id,
      p_recipient_wallet_id: body.recipient_wallet_id,
      p_amount: amount,
      p_idempotency_key: key,
      p_note: body.note || null,
    });
    return json({ ok: true, transfer });
  } catch (error) {
    return financialFail(error);
  }
}
