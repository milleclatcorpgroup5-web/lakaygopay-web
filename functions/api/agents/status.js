import { json, requireUser, config } from "../../_shared/superbase.js";

async function readRows(env, resource) {
  const { url, secretKey } = config(env);
  const response = await fetch(`${url}/rest/v1/${resource}`, {
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}`, accept: "application/json" },
  });
  if (!response.ok) throw new Error("AGENT_STATUS_UNAVAILABLE");
  return response.json();
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const userId = encodeURIComponent(auth.user.id);
    const [applications, agents] = await Promise.all([
      readRows(env, `agent_applications?applicant_user_id=eq.${userId}&select=id,department,commune,status,admin_note,created_at,reviewed_at&order=created_at.desc&limit=10`),
      readRows(env, `agent_accounts?user_id=eq.${userId}&select=agent_code,status,approved_at&limit=1`),
    ]);
    return json({ ok: true, applications, agent: agents?.[0] || null });
  } catch {
    return json({ error: "AGENT_STATUS_UNAVAILABLE" }, 503);
  }
}
