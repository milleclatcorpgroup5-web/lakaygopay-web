import { json, config } from "../../_shared/superbase.js";
import { requireAdminPinSession } from "../../_shared/admin-pin.js";
import { requireAdminAal2 } from "../../_shared/security.js";

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

  // The PIN opens the basic Admin shell, but platform-wide KPI counts are
  // withheld until this same session has completed TOTP/AAL2 verification.
  const elevated = await requireAdminAal2(request, env);
  const metricsAvailable = !elevated.error;

  try {
    const { url, secretKey } = config(env);
    // Return only counts associated with the caller's assigned module scopes.
    // A secretary-only account receives no platform-wide operational metrics.
    const roleSet = new Set(access.roles || []);
    const allTables = [
      ["users", "profiles", "id"],
      ["merchants", "merchants", "id"],
      ["wallets", "wallet_balances", "wallet_id"],
      ["transactions", "ledger_transactions", "id"],
      ["withdrawals", "withdrawal_requests", "id"],
      ["audit_events", "audit_logs", "id"],
    ];
    const allowedMetricKeys = new Set();
    if (roleSet.has("super_admin") || roleSet.has("admin")) {
      allTables.forEach(([key]) => allowedMetricKeys.add(key));
    } else {
      const metricScopes = {
        risk_admin: ["users","merchants","withdrawals","audit_events"],
        support_agent: ["users","merchants"],
        finance_admin: ["wallets","transactions","withdrawals","audit_events"],
        accountant: ["wallets","transactions","audit_events"],
        auditor: ["wallets","transactions","audit_events"]
      };
      roleSet.forEach((role) => (metricScopes[role] || []).forEach((key) => allowedMetricKeys.add(key)));
    }
    const tables = allTables.filter(([key]) => allowedMetricKeys.has(key));

    const values = metricsAvailable
      ? await Promise.all(
          tables.map(async ([key, table, column]) => [key, await countRows(url, secretKey, table, column)])
        )
      : [];
    const counts = Object.fromEntries(values);

    return json({
      ok: true,
      admin: {
        user_id: access.user.id,
        email: access.user.email || null,
        roles: access.roles,
      },
      counts,
      metrics_available: metricsAvailable,
      aal2_verified: metricsAvailable,
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
