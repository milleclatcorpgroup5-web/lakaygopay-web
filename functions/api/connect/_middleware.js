// Production safety gate for LakayGoPay Connect.
//
// The current Connect implementation is not yet isolated from the Production
// Supabase financial ledger. Keep every /api/connect/* endpoint closed until a
// separately deployed Sandbox application has its own Supabase project,
// auth users, wallets, ledger, and secrets. This gate intentionally has no
// environment-variable bypass: enabling it requires a reviewed code change
// after isolation and end-to-end security tests are complete.

export async function onRequest({ request }) {
  return new Response(JSON.stringify({
    ok: false,
    error: "CONNECT_NOT_AVAILABLE",
    message: "LakayGoPay Connect is temporarily unavailable while the isolated Sandbox environment is being completed."
  }), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "pragma": "no-cache",
      "x-content-type-options": "nosniff"
    }
  });
}
