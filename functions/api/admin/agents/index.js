import { json, requireAdminAal2 } from "../../../_shared/superbase.js";
import { config } from "../../../_shared/superbase.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdminAal2(request, env);
    if (auth.error) return auth.error;
    const { url, secretKey } = config(env);
    const response = await fetch(
      `${url}/rest/v1/agent_applications?status=in.(submitted,under_review)&select=id,applicant_user_id,contact_phone,department,commune,business_address,motivation,status,created_at&order=created_at.asc&limit=100`,
      { headers: { apikey: secretKey, authorization: `Bearer ${secretKey}`, accept: "application/json" } }
    );
    if (!response.ok) return json({ error: "AGENT_APPLICATIONS_UNAVAILABLE" }, 503);
    return json({ ok: true, applications: await response.json() });
  } catch {
    return json({ error: "AGENT_APPLICATIONS_UNAVAILABLE" }, 503);
  }
}
