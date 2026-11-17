import { json, config } from "../_shared/supabase.js";

async function checkRestResource(url, secretKey, resource) {
  try {
    const response = await fetch(url + "/rest/v1/" + resource, {
      headers: {
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
        accept: "application/json"
      }
    });
    return { ok: response.ok, http_status: response.status };
  } catch {
    return { ok: false, http_status: 0 };
  }
}

export async function onRequestGet({ env }) {
  try {
    const { url, secretKey } = config(env);
    const checks = await Promise.all([
      checkRestResource(url, secretKey, "profiles?select=id&limit=0"),
      checkRestResource(url, secretKey, "user_roles?select=user_id,role&limit=0"),
      checkRestResource(
        url,
        secretKey,
        "admin_security?select=user_id,pin_hash,pin_salt,pin_iterations,failed_attempts,locked_until,last_verified_at,last_verified_session_id&limit=0"
      )
    ]);

    const [database, admin_roles, admin_pin_storage] = checks;
    const ready = checks.every((item) => item.ok);
    return json({
      service: "lakaygopay-api",
      status: ready ? "ok" : "schema_incomplete",
      mode: "internal-ledger-only",
      checks: { database, admin_roles, admin_pin_storage }
    }, ready ? 200 : 503);
  } catch {
    return json({ service: "lakaygopay-api", status: "not_configured" }, 503);
  }
}
