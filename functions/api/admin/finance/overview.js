import { json, config } from "../../../_shared/superbase.js";
import { requireAdminRoles } from "../../../_shared/security.js";

export async function onRequestGet({ request, env }) {
  const access = await requireAdminRoles(request, env, ["finance_admin","accountant","auditor"]);
  if (access.error) return access.error;

  try {
    const { url, secretKey } = config(env);

    // Production currently exposes only the six-column wallet_balances view.
    // Validate that known schema without querying fields that are not deployed.
    const response = await fetch(
      url + "/rest/v1/wallet_balances?select=wallet_id,currency,balance,created_at&limit=1",
      {
        headers: {
          apikey: secretKey,
          authorization: "Bearer " + secretKey,
          accept: "application/json"
        }
      }
    );

    const raw = await response.text();
    let rows = [];
    try { rows = raw ? JSON.parse(raw) : []; } catch {}
    if (!response.ok || !Array.isArray(rows)) {
      return json({ error: "FINANCE_OVERVIEW_UNAVAILABLE" }, 503);
    }

    // Do not infer treasury/revenue from customer wallet balances.
    // Dedicated platform_revenue system wallets are not present in the
    // confirmed Production schema, so the treasury must remain unconfigured.
    const currencies = ["HTG", "USD", "EUR"];
    const accounts = Object.fromEntries(currencies.map((currency) => [currency, null]));

    return json({
      ok: true,
      treasury: {
        accounts,
        ready: false,
        account_count: 0,
        configuration_status: "revenue_accounts_not_configured",
        note: "Kont revni platfòm yo poko konfigire nan Production. Balans bous kliyan yo pa trete kòm lajan Trezò ni kòm revni.",
        fee_engine_active: false,
        external_payments_enabled: false
      },
      accounting: {
        source: "immutable_internal_ledger",
        read_only: true,
        automatic_fee_posting_active: false,
        note: "HTG, USD ak EUR se ledger separe. Pa gen konvèsyon FX, transfè ant deviz oswa règleman ekstèn. Balans USD/EUR pa pwouve gen lajan ekstèn ki disponib. Motè frè a pa poste revni otomatik."
      },
      roles: access.roles,
      generated_at: new Date().toISOString()
    });
  } catch {
    return json({ error: "FINANCE_OVERVIEW_UNAVAILABLE" }, 503);
  }
}
