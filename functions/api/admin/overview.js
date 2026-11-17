import { json, config } from "../../_shared/superbase.js";
import { requireAdminPinSession } from "../../_shared/admin-pin.js";

async function countRows(url, secretKey, table, column = "id") {
  try {
    const response = await fetch(url + "/rest/v1/" + table + "?select=" + encodeURIComponent(column), {
      headers: {
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
        accept: "application/json",
        prefer: "count=exact",
        range: "0-0",
      },
    });
    if (!response.ok) return { available: false, count: null };
    const range = response.headers.get("content-range") || "";
    const match = range.match(/\/(\d+)$/);
    return { available: true, count: match ? Number(match[1]) : null };
  } catch {
    return { available: false, count: null };
  }
}

export async function onRequestGet({ request, env }) {
  const access = await requireAdminPinSession(request, env);
  if (access.error) return access.error;

  try {
    const { url, secretKey } = config(env);
    const tables = [
      ["users", "profiles", "id"],
      ["merchants", "merchants", "id"],
      ["wallets", "wallet_balances", "wallet_id"],
      ["transactions", "ledger_transactions", "id"],
      ["withdrawals", "withdrawal_requests", "id"],
      ["audit_events", "audit_logs", "id"],
    ];

    const values = await Promise.all(
      tables.map(async ([key, table, column]) => [key, await countRows(url, secretKey, table, column)])
    );
    const counts = Object.fromEntries(values);

    return json({
      ok: true,
      admin: {
        user_id: access.user.id,
        email: access.user.email || null,
        roles: access.roles,
      },
      counts,
      platform: {
        mode: "internal_ledger_only",
        external_payments_enabled: false,
        real_withdrawals_enabled: false,
        qr_end_to_end_verified: false,
      },
      generated_at: new Date().toISOString(),
    });
  } catch {
    return json({ error: "ADMIN_OVERVIEW_UNAVAILABLE" }, 503);
  }
}
