import { json, requireUser, callRpc, readJson, validUuid, validAmount, idempotencyKey, fail } from "../_shared/supabase.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const key = idempotencyKey(request);
    if (!key) return json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400);
    if (!validUuid(body?.merchant_id)) return json({ error: "INVALID_MERCHANT_ID" }, 400);
    const amount = validAmount(body?.amount, { optional: true });
    if (body?.amount != null && body.amount !== "" && !amount) return json({ error: "INVALID_AMOUNT" }, 400);
    const expires = Number(body?.expires_in_minutes ?? 30);
    if (!Number.isInteger(expires) || expires < 1 || expires > 1440) return json({ error: "INVALID_EXPIRY" }, 400);
    if (body?.description != null && (typeof body.description !== "string" || body.description.length > 140)) {
      return json({ error: "DESCRIPTION_TOO_LONG" }, 400);
    }

    const result = await callRpc(env, "create_merchant_payment_request", {
      p_actor_user_id: auth.user.id,
      p_merchant_id: body.merchant_id,
      p_amount: amount,
      p_description: body.description || null,
      p_expires_in_minutes: expires,
      p_idempotency_key: key,
    });
    return json({
      ok: true,
      payment_request: result,
      qr_payload: `lakaygopay://pay/${result.qr_token}`,
      note: "This QR identifies a payment request; it is not payment confirmation.",
    }, 201);
  } catch (error) {
    return fail(error);
  }
}
