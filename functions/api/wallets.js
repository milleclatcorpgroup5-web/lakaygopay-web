import { json, requireUser, callUserRest, fail } from "../_shared/supabase.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;

    // Production's wallet_balances view exposes the derived balance but does
    // not expose status. Read status from wallets, then join by wallet ID.
    const [balances, walletStates] = await Promise.all([
      callUserRest(env, auth.accessToken,
        "wallet_balances?select=wallet_id,owner_user_id,merchant_id,currency,balance,created_at&order=created_at.asc"),
      callUserRest(env, auth.accessToken,
        "wallets?select=id,status&order=created_at.asc")
    ]);

    const statusByWalletId = new Map(
      (walletStates || []).map((wallet) => [wallet.id, wallet.status])
    );
    const wallets = (balances || []).map((wallet) => ({
      ...wallet,
      status: statusByWalletId.get(wallet.wallet_id) || "unknown"
    }));

    return json({ ok: true, wallets });
  } catch (error) {
    return fail(error);
  }
}
