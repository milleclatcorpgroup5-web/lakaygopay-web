import { json, config } from "../../_shared/superbase.js";
import { requireAdminRoles } from "../../_shared/security.js";

const TIME_ZONE = "America/Port-au-Prince";
const MAX_WINDOW_ROWS = 10000;
const ROLE_SET = [
  "admin","risk_admin","support_agent","finance_admin","accountant","auditor"
];

function partsInHaiti(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function dayKey(date) {
  const parts = partsInHaiti(date);
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function shiftDay(key, amount) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.getUTCFullYear() + "-" +
    String(date.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(date.getUTCDate()).padStart(2, "0");
}

function localMidnightIso(key) {
  const [year, month, day] = key.split("-").map(Number);
  const desiredUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(guess);
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    const localAsUtc = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
    const offset = localAsUtc - guess.getTime();
    guess = new Date(desiredUtc - offset);
  }
  return guess.toISOString();
}

function parseExactCount(response) {
  const contentRange = response.headers.get("content-range") || "";
  const match = contentRange.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function countRows(url, secretKey, resource, filter = "") {
  const response = await fetch(url + "/rest/v1/" + resource + "?select=id" + filter, {
    headers: {
      apikey: secretKey,
      authorization: "Bearer " + secretKey,
      accept: "application/json",
      prefer: "count=exact",
      range: "0-0"
    }
  });
  if (!response.ok) throw new Error("ANALYTICS_COUNT_QUERY_FAILED");
  const count = parseExactCount(response);
  if (count === null) throw new Error("ANALYTICS_COUNT_UNAVAILABLE");
  return count;
}

async function readWindowRows(url, secretKey, resource, fields, startIso, extraFilter = "") {
  const query = "select=" + encodeURIComponent(fields) +
    "&created_at=gte." + encodeURIComponent(startIso) +
    extraFilter +
    "&order=created_at.asc&limit=" + MAX_WINDOW_ROWS;
  const response = await fetch(url + "/rest/v1/" + resource + "?" + query, {
    headers: {
      apikey: secretKey,
      authorization: "Bearer " + secretKey,
      accept: "application/json",
      prefer: "count=exact",
      range: "0-" + (MAX_WINDOW_ROWS - 1)
    }
  });
  if (!response.ok) throw new Error("ANALYTICS_WINDOW_QUERY_FAILED");
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("ANALYTICS_INVALID_RESPONSE");
  const total = parseExactCount(response);
  return {
    rows,
    truncated: total !== null ? total > MAX_WINDOW_ROWS : rows.length >= MAX_WINDOW_ROWS,
    total: total === null ? rows.length : total
  };
}

function serviceLabel(type) {
  const labels = {
    wallet_transfer: "Transfè entèn",
    merchant_payment: "Peman machann",
    deposit: "Depo anrejistre",
    withdrawal: "Retrè anrejistre",
    reversal: "Ranvèsman",
    adjustment: "Ajisteman"
  };
  return labels[type] || type || "Lòt sèvis";
}

export async function onRequestGet({ request, env }) {
  const access = await requireAdminRoles(request, env, ROLE_SET);
  if (access.error) return access.error;

  const urlObject = new URL(request.url);
  const rawDays = Number(urlObject.searchParams.get("days") || 30);
  if (![7, 30, 90].includes(rawDays)) {
    return json({ error: "ANALYTICS_RANGE_INVALID" }, 400);
  }

  try {
    const { url, secretKey } = config(env);
    const today = dayKey(new Date());
    const startDay = shiftDay(today, -(rawDays - 1));
    const startIso = localMidnightIso(startDay);

    const [
      totalUsers,
      activeAccounts,
      restrictedAccounts,
      suspendedAccounts,
      closedAccounts,
      merchantsTotal,
      activeMerchants,
      registrationWindow,
      transactionWindow
    ] = await Promise.all([
      countRows(url, secretKey, "profiles"),
      countRows(url, secretKey, "profiles", "&account_status=eq.active"),
      countRows(url, secretKey, "profiles", "&account_status=eq.restricted"),
      countRows(url, secretKey, "profiles", "&account_status=eq.suspended"),
      countRows(url, secretKey, "profiles", "&account_status=eq.closed"),
      countRows(url, secretKey, "merchants"),
      countRows(url, secretKey, "merchants", "&status=eq.active"),
      readWindowRows(url, secretKey, "profiles", "id,created_at", startIso),
      readWindowRows(url, secretKey, "ledger_transactions", "id,transaction_type,created_at", startIso, "&status=eq.posted")
    ]);

    const buckets = new Map();
    for (let offset = 0; offset < rawDays; offset += 1) {
      const key = shiftDay(startDay, offset);
      buckets.set(key, { date: key, registrations: 0, service_transactions: 0 });
    }

    for (const row of registrationWindow.rows) {
      const key = dayKey(new Date(row.created_at));
      const bucket = buckets.get(key);
      if (bucket) bucket.registrations += 1;
    }

    const services = new Map();
    for (const row of transactionWindow.rows) {
      if (!row.created_at) continue;
      const key = dayKey(new Date(row.created_at));
      const bucket = buckets.get(key);
      if (bucket) bucket.service_transactions += 1;
      const type = String(row.transaction_type || "other");
      services.set(type, (services.get(type) || 0) + 1);
    }

    // The current Production ledger schema does not store a verified actor
    // column on ledger_transactions. Do not infer unique active users from
    // transaction counts; report that metric as unavailable instead.
    const timeline = [...buckets.values()];

    const serviceBreakdown = [...services.entries()]
      .map(([type, count]) => ({ type, label: serviceLabel(type), count }))
      .sort((a, b) => b.count - a.count);

    const nonActiveAccounts = restrictedAccounts + suspendedAccounts + closedAccounts;
    const truncated = registrationWindow.truncated || transactionWindow.truncated;
    const roles = access.roles || [];

    return json({
      ok: true,
      period_days: rawDays,
      time_zone: TIME_ZONE,
      summary: {
        registered_users: totalUsers,
        new_registrations: registrationWindow.total,
        active_accounts: activeAccounts,
        non_active_accounts: nonActiveAccounts,
        restricted_accounts: restrictedAccounts,
        suspended_accounts: suspendedAccounts,
        closed_accounts: closedAccounts,
        merchants_total: merchantsTotal,
        active_merchants: activeMerchants,
        users_with_service: null,
        service_transactions: transactionWindow.total
      },
      timeline,
      service_breakdown: serviceBreakdown,
      notes: {
        activity_definition: "Kantite tranzaksyon ki deja poste nan ledger la.",
        user_activity_metric_available: false,
        user_activity_note: "Production ledger la pa gen yon kolòn aktè verifye pou chak tranzaksyon; kantite itilizatè inik pa kalkile pou evite done ki ta ka twonpe.",
        service_definition: "Sèvis yo konte apati tranzaksyon ki deja poste nan ledger la. Demann ki poko finalize pa antre nan total sa a.",
        truncated,
        source: "profiles + posted ledger_transactions",
        real_external_payments_enabled: false
      },
      roles,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    const diagnostic = error?.message === "ANALYTICS_COUNT_QUERY_FAILED" ||
      error?.message === "ANALYTICS_WINDOW_QUERY_FAILED" ? "ANALYTICS_DATABASE_QUERY_FAILED" :
      error?.message === "ANALYTICS_COUNT_UNAVAILABLE" ? "ANALYTICS_COUNT_UNAVAILABLE" :
      "ADMIN_ANALYTICS_UNAVAILABLE";
    console.error("ADMIN_ANALYTICS_FAILED", JSON.stringify({
      diagnostic,
      error_name: String(error?.name || "Error").slice(0, 40)
    }));
    return json({ error: diagnostic }, 503);
  }
}
