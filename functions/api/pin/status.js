import { json, requireUser, config } from "../../_shared/superbase.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;

    const { url, secretKey } = config(env);
    const response = await fetch(
      `${url}/rest/v1/user_security?user_id=eq.${encodeURIComponent(auth.user.id)}&select=pin_hash,pin_created_at,locked_until&limit=1`,
      {
        headers: {
          apikey: secretKey,
          authorization: `Bearer ${secretKey}`,
          accept: "application/json",
        },
      }
    );

    if (!response.ok) return json({ error: "PIN_STATUS_UNAVAILABLE" }, 503);
    const rows = await response.json();
    const record = rows?.[0] || null;
    return json({
      ok: true,
      pin_configured: Boolean(record?.pin_hash),
      locked_until: record?.locked_until || null,
      pin_created_at: record?.pin_created_at || null,
    });
  } catch {
    return json({ error: "PIN_STATUS_UNAVAILABLE" }, 503);
  }
}
