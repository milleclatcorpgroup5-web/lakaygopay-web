import { json, requireUser, config, readJson } from "../../_shared/superbase.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const body = await readJson(request, 2000);
    const agentId = String(body?.agent_id || "").trim();
    if (!/^\d{8}$/.test(agentId)) return json({ error: "INVALID_AGENT_ID" }, 400);
    const { url, secretKey } = config(env);
    const headers = { apikey: secretKey, authorization: "Bearer " + secretKey, accept: "application/json" };
    const response = await fetch(url + "/rest/v1/agent_accounts?public_agent_id=eq." +
      encodeURIComponent(agentId) + "&status=eq.active&select=id,user_id,public_agent_id&limit=1", { headers });
    if (!response.ok) return json({ error: "AGENT_LOOKUP_UNAVAILABLE" }, 503);
    const rows = await response.json();
    if (!rows[0] || rows[0].user_id === auth.user.id) return json({ error: "AGENT_NOT_FOUND_OR_INACTIVE" }, 404);
    const profileResponse = await fetch(url + "/rest/v1/profiles?id=eq." +
      encodeURIComponent(rows[0].user_id) + "&select=full_name&limit=1", { headers });
    if (!profileResponse.ok) return json({ error: "AGENT_LOOKUP_UNAVAILABLE" }, 503);
    const profile = (await profileResponse.json())[0];
    return json({ ok: true, agent: { public_agent_id: rows[0].public_agent_id, name: profile?.full_name || "Ajan LakayGo" } });
  } catch {
    return json({ error: "AGENT_LOOKUP_UNAVAILABLE" }, 503);
  }
}
