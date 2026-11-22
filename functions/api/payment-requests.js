import { json, requireUser, callRpc, readJson, validUuid, validAmount, idempotencyKey } from "../_shared/supabase.js";
import { financialFail } from "../_shared/financial-errors.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const key = idempotencyKey(request)?.trim() || null;
    if (!key) return json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400);
    if (!validUuid(body?.merchant_id)) return json({ error: "INVALID_MERCHANT_ID" }, 400);

    const amount = validAmount(body?.amount, { optional: true });
    if (body?.amount != null && body.amount !== "" && !amount) {
      return json({ error: "INVALID_AMOUNT" }, 400);
    }
    const currency = String(body?.currency || "HTG").trim().toUpperCase();
    if (!["HTG", "USD", "EUR"].includes(currency)) {
      return json({ error: "INVALID_CURRENCY" }, 400);
    }
    const expires = Number(body?.expires_in_minutes ?? 1440);
    if (expires !== 1440) return json({ error: "INVALID_EXPIRY" }, 400);
    if (body?.description != null &&
        (typeof body.description !== "string" || body.description.length > 140)) {
      return json({ error: "DESCRIPTION_TOO_LONG" }, 400);
    }

    const result = await callRpc(env, "create_merchant_qr_request", {
      p_actor_user_id: auth.user.id,
      p_merchant_id: body.merchant_id,
      p_amount: amount,
      p_currency: currency,
      p_description: body.description || null,
      p_expires_in_minutes: 1440,
      p_idempotency_key: key,
    });
    return json({
      ok: true,
      payment_request: result,
      qr_payload: `lakaygopay://pay/${result.qr_token}`,
      note: "QR machann lan dire 24 èdtan. Li pa konfime peman an; kliyan an dwe verifye detay yo epi konfime ak PIN.",
    }, 201);
  } catch (error) {
    return financialFail(error);
  }
}
