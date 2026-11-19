import { json, config } from "../../../_shared/superbase.js";
import { requireAdminRoles } from "../../../_shared/security.js";

export async function onRequestGet({ request, env }) {
  const access = await requireAdminRoles(request, env, ["finance_admin","accountant","auditor"]);
  if (access.error) return access.error;

  try {
    const { url, secretKey } = config(env);
    const response = await fetch(
      url + "/rest/v1/wallet_balances?select=wallet_id,currency,balance,status,system_account_code,created_at" +
      "&is_system=eq.true&system_account_code=eq.platform_revenue&order=currency.asc",
      {
        headers: {
          apikey: secretKey,
          authorization: "Bearer " + secretKey,
          accept: "application/json"
        }
      }
    );
    const raw = await response.text();
    let accounts = [];
    try { accounts = raw ? JSON.parse(raw) : []; } catch { accounts = []; }
    if (!response.ok || !Array.isArray(accounts)) {
      return json({ error: "FINANCE_MODULE_SCHEMA_NOT_READY" }, 503);
    }

    const currencies = ["HTG","USD","EUR"];
    const byCurrency = Object.fromEntries(currencies.map((currency) => {
      const account = accounts.find((item) => String(item.currency).trim() === currency);
      return [currency, account ? {
        wallet_id: account.wallet_id,
        balance: Number(account.balance || 0),
        status: account.status
      } : null];
    }));

    return json({
      ok: true,
      treasury: {
        accounts: byCurrency,
        ready: currencies.every((currency) => Boolean(byCurrency[currency])),
        account_count: accounts.length,
        fee_engine_active: false,
        external_payments_enabled: false
      },
      accounting: {
        source: "immutable_internal_ledger",
        read_only: true,
        automatic_fee_posting_active: false,
        note: "Rapò yo baze sou ledger entèn. HTG, USD ak EUR se ledger separe; tout ekriti dwe matche ak deviz bous la epi transfè yo rete nan menm deviz la. Pa gen konvèsyon FX, transfè ant deviz oswa règleman ekstèn. Balans USD/EUR pa pwouve gen lajan ekstèn ki disponib. Motè frè a pa poste revni otomatik."
      },
      roles: access.roles,
      generated_at: new Date().toISOString()
    });
  } catch {
    return json({ error: "FINANCE_OVERVIEW_UNAVAILABLE" }, 503);
  }
}
