import { json, requireUser, callUserRest, fail } from "../_shared/superbase.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const payments = await callUserRest(env, auth.accessToken,
      "merchant_payment_records?select=id,payment_request_id,merchant_id,payer_user_id,payer_wallet_id,merchant_wallet_id,amount,currency,created_at&order=created_at.desc&limit=50");
    return json({ ok: true, payments: payments || [] });
  } catch (error) {
    return fail(error);
  }
}
