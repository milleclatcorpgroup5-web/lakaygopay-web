import { json, config } from "../../_shared/superbase.js";
import { requireAdminRoles } from "../../_shared/security.js";

const SEVERITIES = new Set(["error", "warning", "info"]);
const AREAS = new Set(["admin", "agent", "cards", "merchant", "payments", "wallet", "customer", "connect", "api", "website"]);

export async function onRequestGet({ request, env }) {
  const access = await requireAdminRoles(request, env, ["admin", "risk_admin", "auditor"]);
  if (access.error) return access.error;

  try {
    const { url, secretKey } = config(env);
    const query = new URL(request.url).searchParams;
    const rawLimit = Number(query.get("limit") || 50);
    const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 50;
    const severity = query.get("severity") || "";
    const area = query.get("area") || "";
    const params = new URLSearchParams({
      select: "id,created_at,severity,source,area,event_code,message,path,method,http_status,request_id,actor_user_id,details",
      order: "created_at.desc",
      limit: String(limit)
    });
    if (SEVERITIES.has(severity)) params.set("severity", "eq." + severity);
    if (AREAS.has(area)) params.set("area", "eq." + area);

    const response = await fetch(url + "/rest/v1/system_logs?" + params.toString(), {
      headers: {
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
        accept: "application/json"
      }
    });
    if (!response.ok) {
      let code = "";
      try { code = String((await response.json())?.code || ""); } catch {}
      const missing = response.status === 404 || ["42P01", "PGRST205"].includes(code);
      return json({
        ok: false,
        error: missing ? "SYSTEM_LOGS_NOT_CONFIGURED" : "SYSTEM_LOGS_UNAVAILABLE",
        diagnostic: missing ? "SYSTEM_LOGS_TABLE_MISSING" : "SYSTEM_LOGS_QUERY_FAILED"
      }, 503);
    }
    const logs = await response.json();
    return json({
      ok: true,
      logs: Array.isArray(logs) ? logs : [],
      count: Array.isArray(logs) ? logs.length : 0,
      checked_at: new Date().toISOString(),
      refresh_interval_seconds: 15
    });
  } catch {
    return json({ ok: false, error: "SYSTEM_LOGS_UNAVAILABLE" }, 503);
  }
}
