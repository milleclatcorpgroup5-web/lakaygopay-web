import { json, config } from "../../_shared/superbase.js";
import { requireAdminAal2 } from "../../_shared/security.js";

const RESOURCE_BY_TYPE = {
  users: "profiles?select=id,full_name,account_status,preferred_language,created_at&order=created_at.desc&limit=75",
  merchants: "merchants?select=id,owner_user_id,business_name,business_type,category,status,created_at&order=created_at.desc&limit=75",
  wallets: "wallet_balances?select=wallet_id,owner_user_id,merchant_id,currency,balance,created_at&order=created_at.desc&limit=100",
  ledger: "ledger_transactions?select=id,transaction_type,reference_code,status,created_at,ledger_entries(direction,amount,currency)&order=created_at.desc&limit=75",
  withdrawals: "withdrawal_requests?select=id,requested_by,amount,currency,destination_type,status,created_at,updated_at&order=created_at.desc&limit=75",
  audit: "audit_logs?select=id,actor_user_id,action,resource_type,resource_id,outcome,created_at&order=created_at.desc&limit=100",
  agents: "agent_applications?select=id,applicant_user_id,department,commune,status,created_at,reviewed_at&order=created_at.desc&limit=75"
};

export async function onRequestGet({ request, env }) {
  const access = await requireAdminAal2(request, env);
  if (access.error) return access.error;

  const type = new URL(request.url).searchParams.get("type") || "";
  const resource = RESOURCE_BY_TYPE[type];
  if (!resource) return json({ error: "ADMIN_RECORD_TYPE_INVALID" }, 400);

  try {
    const { url, secretKey } = config(env);
    const response = await fetch(url + "/rest/v1/" + resource, {
      headers: {
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
        accept: "application/json"
      }
    });
    const raw = await response.text();
    let records = [];
    try { records = raw ? JSON.parse(raw) : []; } catch { records = []; }
    if (!response.ok || !Array.isArray(records)) {
      return json({ error: "ADMIN_RECORDS_UNAVAILABLE", type }, 503);
    }
    return json({
      ok: true,
      type,
      count: records.length,
      records,
      generated_at: new Date().toISOString()
    });
  } catch {
    return json({ error: "ADMIN_RECORDS_UNAVAILABLE", type }, 503);
  }
}
