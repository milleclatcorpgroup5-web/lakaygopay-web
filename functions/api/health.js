import { json, config } from "../_shared/supabase.js";

export async function onRequestGet({ env }) {
  try {
    const { url, secretKey } = config(env);
    const response = await fetch(`${url}/rest/v1/profiles?select=id&limit=0`, {
      headers: { apikey: secretKey, accept: "application/json" },
    });
    if (!response.ok) return json({ service: "lakaygopay-api", status: "supabase_unavailable" }, 503);
    return json({ service: "lakaygopay-api", status: "ok", mode: "internal-ledger-only" });
  } catch {
    return json({ service: "lakaygopay-api", status: "not_configured" }, 503);
  }
}
