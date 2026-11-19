import { json, config } from "../../_shared/superbase.js";
import { requireAdminRoles } from "../../_shared/security.js";

const TABLE_CHECKS = [
  { id: "profiles", label: "Supabase DB / pwofil itilizatè", resource: "profiles?select=id,account_status&limit=0" },
  { id: "admin_roles", label: "Wòl administratè", resource: "user_roles?select=user_id,role&limit=0" },
  {
    id: "admin_pin_storage",
    label: "Depo PIN Admin",
    resource: "admin_security?select=user_id,pin_hash,pin_salt,pin_iterations,failed_attempts,locked_until,last_verified_at,last_verified_session_id&limit=0"
  },
  { id: "merchants", label: "Pwofil machann", resource: "merchants?select=id&limit=0" },
  { id: "agent_applications", label: "Aplikasyon ajan", resource: "agent_applications?select=id,applicant_user_id,status&limit=0" },
  { id: "agent_accounts", label: "Kont ajan ak estati", resource: "agent_accounts?select=id,user_id,agent_code,status&limit=0" },
  { id: "card_tiers", label: "Katalòg kat LakayGo", resource: "card_program_tiers?select=tier_code,issuance_enabled,min_limit_htg,max_limit_htg&limit=0" },
  { id: "card_stars", label: "Nivo etwal kat", resource: "card_tier_stars?select=tier_code,star_level,min_limit_htg,max_limit_htg&limit=0" },
  { id: "card_customer_limits", label: "Plafon kat kliyan apwouve", resource: "card_customer_limits?select=user_id,approved_limit_htg,tier_code,star_level,assessment_status&limit=0" },
  { id: "card_limit_history", label: "Istwa chanjman plafon kat", resource: "card_limit_history?select=id,user_id,changed_by,new_limit_htg,reason&limit=0" },
  { id: "card_applications", label: "Demann kat kliyan", resource: "card_applications?select=id,user_id,tier_code,star_level,status&limit=0" },
  { id: "card_instruments", label: "Dosye enstriman kat (emisyon fèmen)", resource: "card_instruments?select=id,user_id,status&limit=0" },
  { id: "wallets", label: "Bous", resource: "wallet_balances?select=wallet_id,owner_user_id,merchant_id,currency,balance,created_at&limit=0" },
  { id: "ledger", label: "Ledger tranzaksyon", resource: "ledger_transactions?select=id&limit=0" },
  { id: "withdrawals", label: "Demann retrè", resource: "withdrawal_requests?select=id&limit=0" },
  { id: "audit_logs", label: "Jounal audit", resource: "audit_logs?select=id&limit=0" },
  { id: "treasury_revenue_wallets", label: "Bous revni antrepriz HTG/USD/EUR", expectCurrencies: ["HTG","USD","EUR"], optional: true, resource: "wallet_balances?select=wallet_id,currency,balance,system_account_code&is_system=eq.true&system_account_code=eq.platform_revenue&limit=3" },
  { id: "secretariat_access", label: "Otorizasyon sekretarya prive", resource: "admin_secretariat_access?select=id,owner_user_id,assistant_user_id,active&limit=0" },
  { id: "secretariat_items", label: "Depo ajanda ak travay pèsonèl", resource: "admin_secretariat_items?select=id,owner_user_id,item_type,status&limit=0" },
  { id: "fee_proposals", label: "Istwa pwopozisyon tarif", resource: "platform_fee_proposals?select=id,service_code,currency,version,status&limit=0" },
  { id: "admin_pin_reset_challenges", label: "Defi rekiperasyon PIN Admin (AAL2)", resource: "admin_pin_reset_challenges?select=nonce,user_id,session_id,expires_at,consumed_at&limit=0" },
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
      if (Array.isArray(item.expectCurrencies)) {
        const rows = await response.json().catch(() => []);
        const actual = new Set(Array.isArray(rows) ? rows.map((row) => String(row.currency || "").trim()) : []);
        const missing = item.expectCurrencies.filter((currency) => !actual.has(currency));
        return {
          id: item.id,
          label: item.label,
          status: missing.length ? "warning" : "ok",
          stage: "SUPABASE_REST",
          http_status: response.status,
          diagnostic: missing.length ? "REVENUE_WALLET_CURRENCY_MISSING_" + missing.join("_") : "THREE_REVENUE_WALLETS_READY"
        };
      }
      return { id: item.id, label: item.label, status: "ok", stage: "SUPABASE_REST", http_status: response.status };
    }
    let code = "";
    try {
      const body = await response.json();
      code = String(body?.code || "");
    } catch {}
    if (item.optional && ["PGRST205", "42P01", "PGRST204", "42703"].includes(code)) {
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
  const access = await requireAdminRoles(request, env, ["admin"]);
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
