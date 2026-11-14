import { json, requireUser, callUserRest, fail } from "../_shared/supabase.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const [transfers, deposits, withdrawals] = await Promise.all([
      callUserRest(env, auth.accessToken, "transfers?select=id,sender_wallet_id,recipient_wallet_id,amount,currency,note,status,created_at&order=created_at.desc&limit=50"),
      callUserRest(env, auth.accessToken, "deposit_requests?select=id,wallet_id,amount,currency,status,provider,created_at&order=created_at.desc&limit=50"),
      callUserRest(env, auth.accessToken, "withdrawal_requests?select=id,wallet_id,amount,currency,status,destination_type,created_at&order=created_at.desc&limit=50"),
    ]);
    const activity = [
      ...(transfers || []).map(item => ({ ...item, kind: "transfer" })),
      ...(deposits || []).map(item => ({ ...item, kind: "deposit" })),
      ...(withdrawals || []).map(item => ({ ...item, kind: "withdrawal" })),
    ].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0,100);
    return json({ ok: true, activity });
  } catch (error) {
    return fail(error);
  }
}
