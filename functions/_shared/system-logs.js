import { config } from "./superbase.js";

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

export function systemLogPath(value) {
  let path = String(value || "/").split("?")[0].split("#")[0];
  if (!path.startsWith("/")) path = "/";
  return path
    .replace(UUID_PATTERN, ":id")
    .replace(/\/(?:\d{3,})(?=\/|$)/g, "/:id")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ":redacted")
    .slice(0, 180);
}

export function systemLogArea(path) {
  const value = systemLogPath(path).toLowerCase();
  if (value.startsWith("/api/admin")) return "admin";
  if (value.startsWith("/api/agents")) return "agent";
  if (value.startsWith("/api/cards")) return "cards";
  if (value.startsWith("/api/merchant")) return "merchant";
  if (value.startsWith("/api/payments") || value.startsWith("/api/payment-requests")) return "payments";
  if (value.startsWith("/api/wallets") || value.startsWith("/api/transfers")) return "wallet";
  if (value.startsWith("/api/auth") || value.startsWith("/api/profile") || value.startsWith("/api/pin")) return "customer";
  if (value.startsWith("/api/connect")) return "connect";
  if (value.startsWith("/api/")) return "api";
  return "website";
}

function safeCode(value) {
  const code = String(value || "SYSTEM_EVENT").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return /^[A-Z][A-Z0-9_]{2,79}$/.test(code) ? code : "SYSTEM_EVENT";
}

function safeDetails(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const details = {};
  if (typeof source.diagnostic === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(source.diagnostic)) {
    details.diagnostic = source.diagnostic;
  }
  if (typeof source.error_name === "string") {
    details.error_name = source.error_name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 60);
  }
  if (typeof source.cf_ray === "string") {
    details.cf_ray = source.cf_ray.replace(/[^A-Za-z0-9-]/g, "").slice(0, 80);
  }
  if (Number.isInteger(source.line) && source.line >= 0) details.line = Math.min(source.line, 10000000);
  if (Number.isInteger(source.column) && source.column >= 0) details.column = Math.min(source.column, 10000000);
  if (typeof source.filename === "string") details.filename = systemLogPath(source.filename);
  return details;
}

export async function writeSystemLog(env, event) {
  try {
    const { url, secretKey } = config(env);
    const path = systemLogPath(event?.path);
    const status = Number(event?.http_status);
    const actor = typeof event?.actor_user_id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.actor_user_id)
      ? event.actor_user_id
      : null;
    const method = String(event?.method || "").toUpperCase();
    const payload = {
      severity: ["error", "warning", "info"].includes(event?.severity) ? event.severity : "error",
      source: event?.source === "browser" ? "browser" : "server",
      area: systemLogArea(path),
      event_code: safeCode(event?.event_code),
      message: event?.source === "browser"
        ? "Browser la rapòte yon pwoblèm teknik."
        : "Sèvè a rankontre yon pwoblèm teknik.",
      path,
      method: /^[A-Z]{3,10}$/.test(method) ? method : null,
      http_status: Number.isInteger(status) && status >= 0 && status <= 599 ? status : null,
      request_id: /^[A-Za-z0-9._-]{8,80}$/.test(String(event?.request_id || ""))
        ? String(event.request_id).slice(0, 80)
        : null,
      actor_user_id: actor,
      environment: String(env.CF_PAGES_BRANCH || "unknown") === "main" ? "production" : "preview",
      release: String(env.CF_PAGES_COMMIT_SHA || "unknown").slice(0, 80),
      details: safeDetails(event?.details)
    };

    const response = await fetch(url + "/rest/v1/system_logs", {
      method: "POST",
      headers: {
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
        "content-type": "application/json",
        accept: "application/json",
        prefer: "return=minimal"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      console.error("SYSTEM_LOG_PERSIST_FAILED", JSON.stringify({ http_status: response.status }));
      return false;
    }
    return true;
  } catch (error) {
    console.error("SYSTEM_LOG_PERSIST_FAILED", JSON.stringify({
      error_name: String(error?.name || "Error").replace(/[^A-Za-z]/g, "").slice(0, 40)
    }));
    return false;
  }
}
