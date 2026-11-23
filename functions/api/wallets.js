import { json, requireUser, callUserRest, fail } from "../_shared/supabase.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const wallets = await callUserRest(env, auth.accessToken,
      "wallet_balances?select=wallet_id,owner_user_id,merchant_id,currency,status,balance,created_at&order=created_at.asc");
    return json({ ok: true, wallets });
  } catch (error) {
    return fail(error);
  }
}
