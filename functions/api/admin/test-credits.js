import { json } from "../../_shared/superbase.js";

// Test balances must never be minted inside the Production financial ledger.
// Reintroduce this capability only in the isolated LakayGoPay Sandbox project,
// backed by a separate Supabase project and a separate test-only ledger.
export async function onRequestPost() {
  return json({
    error: "TEST_CREDITS_DISABLED_IN_PRODUCTION",
    message: "Test credits are available only in the isolated LakayGoPay Sandbox environment."
  }, 403);
}
