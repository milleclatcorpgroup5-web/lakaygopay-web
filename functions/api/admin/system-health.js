import { json, config } from "../../_shared/superbase.js";
import { requireAdminPinSession } from "../../_shared/admin-pin.js";

const TABLE_CHECKS = [
  { id: "profiles", label: "Supabase DB / pwofil itilizatè", resource: "profiles?select=id,account_status&limit=0" },
  { id: "admin_roles", label: "Wòl administratè", resource: "user_roles?select=user_id,role&limit=0" },
  {
    id: "admin_pin_storage",
    label: "Depo PIN Admin",
    resource: "admin_security?select=user_id,pin_hash,pin_salt,pin_iterations,failed_attempts,locked_until,last_verified_at,last_verified_session_id&limit=0"
  },
  { id: "merchants", label: "Pwofil machann", resource: "merchants?select=id&limit=0" },
  { id: "wallets", label: "Bous", resource: "wallet_balances?select=wallet_id,owner_user_id,merchant_id,currency,balance,created_at&limit=0" },
  { id: "ledger", label: "Ledger tranzaksyon", resource: "ledger_transactions?select=id&limit=0" },
  { id: "withdrawals", label: "Demann retrè", resource: "withdrawal_requests?select=id&limit=0" },
  { id: "audit_logs", label: "Jounal audit", resource: "audit_logs?select=id&limit=0" },
  { id: "security_events", label: "Jounal evènman sekirite (si konfigire)", optional: true, resource: "security_events?select=id&limit=0" }
];

function safeDatabaseDiagnostic(status, code) {
  const mapped = {
    "42P01": "TABLE_MISSING",
    "42703": "COLUMN_MISSING",
    "42501": "DATABASE_PERMISSION_DENIED",
    "23505": "UNIQUE_CONSTRAINT",
    "PGRST200": "RELATION_NOT_IN_SCHEMA_CACHE",
    "PGRST204": "COLUMN_NOT_IN_SCHEMA_CACHE",
    "PGRST205": "TABLE_NOT_IN_SCHEMA_CACHE"
  };
  if (mapped[code]) return mapped[code];
  if (status === 401) return "SUPABASE_SECRET_KEY_REJECTED";
  if (status === 403) return "DATABASE_PERMISSION_DENIED";
  if (status === 404) return "RESOURCE_NOT_FOUND";
  if (status === 429) return "SUPABASE_RATE_LIMITED";
  if (status >= 500) return "SUPABASE_SERVICE_ERROR";
  return "DATABASE_SCHEMA_OR_QUERY_ERROR";
}

async function checkTable(url, secretKey, item) {
  try {
    const response = await fetch(url + "/rest/v1/" + item.resource, {
      headers: {
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
        accept: "application/json"
      }
    });
    if (response.ok) {
      return { id: item.id, label: item.label, status: "ok", stage: "SUPABASE_REST", http_status: response.status };
    }
    let code = "";
    try {
      const body = await response.json();
      code = String(body?.code || "");
    } catch {}
    if (item.optional && ["PGRST205", "42P01"].includes(code)) {
      return {
        id: item.id,
        label: item.label,
        status: "disabled",
        stage: "SUPABASE_REST",
        http_status: response.status,
        diagnostic: "OPTIONAL_TABLE_NOT_CONFIGURED"
      };
    }
    return {
      id: item.id,
      label: item.label,
      status: "error",
      stage: "SUPABASE_REST",
      http_status: response.status,
      diagnostic: safeDatabaseDiagnostic(response.status, code)
    };
  } catch (err) {
    return {
      id: item.id,
      label: item.label,
      status: "error",
      stage: "NETWORK",
      http_status: 0,
      diagnostic: err?.name === "TypeError" ? "SUPABASE_NETWORK_OR_CORS_ERROR" : "SUPABASE_REQUEST_FAILED"
    };
  }
}

async function checkAuth(url, publishableKey) {
  try {
    const response = await fetch(url + "/auth/v1/settings", {
      headers: { apikey: publishableKey, accept: "application/json" }
    });
    if (!response.ok) {
      return {
        id: "auth",
        label: "Sèvis koneksyon / enskripsyon",
        status: "error",
        stage: "SUPABASE_AUTH_SETTINGS",
        http_status: response.status,
        diagnostic: response.status === 401 ? "SUPABASE_PUBLISHABLE_KEY_REJECTED" : "AUTH_SETTINGS_UNAVAILABLE"
      };
    }
    const settings = await response.json();
    const emailEnabled = settings?.external?.email;
    const signupDisabled = settings?.disable_signup === true;
    const settingsKnown = typeof settings?.disable_signup === "boolean" && typeof emailEnabled === "boolean";
    const signupEnabled = settingsKnown && settings.disable_signup === false && emailEnabled === true;
    let status = "ok";
    let diagnostic = "AUTH_REACHABLE";
    if (signupDisabled) {
      status = "warning";
      diagnostic = "SIGNUP_DISABLED_IN_SUPABASE";
    } else if (emailEnabled === false) {
      status = "warning";
      diagnostic = "EMAIL_SIGNUP_DISABLED_IN_SUPABASE";
    } else if (!settingsKnown) {
      status = "warning";
      diagnostic = "SIGNUP_SETTING_NOT_CONFIRMED";
    }
    return {
      id: "auth",
      label: "Sèvis koneksyon / enskripsyon",
      status,
      stage: "SUPABASE_AUTH_SETTINGS",
      http_status: response.status,
      diagnostic,
      signup_enabled: settingsKnown ? signupEnabled : null,
      email_confirmation_required: typeof settings?.mailer_autoconfirm === "boolean"
        ? !settings.mailer_autoconfirm
        : null
    };
  } catch (err) {
    return {
      id: "auth",
      label: "Sèvis koneksyon / enskripsyon",
      status: "error",
      stage: "NETWORK",
      http_status: 0,
      diagnostic: err?.name === "TypeError" ? "AUTH_NETWORK_ERROR" : "AUTH_REQUEST_FAILED"
    };
  }
}

export async function onRequestGet({ request, env }) {
  const access = await requireAdminPinSession(request, env);
  if (access.error) return access.error;

  try {
    const { url, publishableKey, secretKey } = config(env);
    const tableChecks = await Promise.all(TABLE_CHECKS.map((item) => checkTable(url, secretKey, item)));
    const authCheck = await checkAuth(url, publishableKey);
    const checks = [
      { id: "backend", label: "Konfigirasyon backend", status: "ok", stage: "CLOUDFLARE_ENV", diagnostic: "REQUIRED_BINDINGS_PRESENT" },
      authCheck,
      ...tableChecks,
      { id: "admin_pin_session", label: "PIN Admin / sesyon aktyèl", status: "ok", stage: "ADMIN_PIN_SESSION", diagnostic: "PIN_HASH_VERIFIED_FOR_CURRENT_SESSION" },
      {
        id: "real_payments",
        label: "Peman reyèl / retrè ekstèn",
        status: "disabled",
        stage: "PAYMENT_SAFETY_GATE",
        diagnostic: "INTENTIONALLY_DISABLED"
      }
    ];
    const errors = checks.filter((item) => item.status === "error").length;
    const warnings = checks.filter((item) => item.status === "warning").length;
    return json({
      ok: true,
      overall: errors ? "error" : warnings ? "warning" : "ok",
      mode: "internal-ledger-only",
      external_payments_enabled: false,
      checks,
      counts: { ok: checks.filter((item) => item.status === "ok").length, warning: warnings, error: errors, disabled: checks.filter((item) => item.status === "disabled").length },
      checked_at: new Date().toISOString()
    });
  } catch (err) {
    const diagnostic = err?.message === "BACKEND_NOT_CONFIGURED" ? "BACKEND_BINDINGS_MISSING" : "SYSTEM_HEALTH_CHECK_FAILED";
    console.error("ADMIN_SYSTEM_HEALTH_FAILED", JSON.stringify({ diagnostic, error_name: String(err?.name || "Error").slice(0, 40) }));
    return json({ error: "ADMIN_SYSTEM_HEALTH_UNAVAILABLE", diagnostic }, 503);
  }
}
