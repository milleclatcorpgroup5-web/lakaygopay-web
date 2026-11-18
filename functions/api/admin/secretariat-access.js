import { json, config, readJson, validUuid } from "../../_shared/superbase.js";
import { requireAdminRoles } from "../../_shared/security.js";

export async function onRequestPost({ request, env }) {
  const access = await requireAdminRoles(request, env, []);
  if (access.error) return access.error;
  try {
    const body = await readJson(request, 3000);
    if (!validUuid(body?.assistant_user_id)) return json({ error: "INVALID_USER_ID" }, 400);
    const action = String(body?.action || "grant");
    if (!["grant","revoke"].includes(action)) return json({ error: "SECRETARIAT_ACCESS_ACTION_INVALID" }, 400);
    const { url, secretKey } = config(env);

    if (action === "grant") {
      const roleResponse = await fetch(
        url + "/rest/v1/user_roles?select=user_id&user_id=eq." +
          encodeURIComponent(body.assistant_user_id) + "&role=eq.secretary&limit=1",
        { headers: { apikey: secretKey, authorization: "Bearer " + secretKey, accept: "application/json" } }
      );
      const roles = await roleResponse.json().catch(() => []);
      if (!roleResponse.ok || !Array.isArray(roles)) return json({ error: "SECRETARIAT_ROLE_LOOKUP_FAILED" }, 503);
      if (!roles.length) return json({ error: "SECRETARIAT_ROLE_REQUIRED" }, 409);
    }

    const response = await fetch(
      url + "/rest/v1/admin_secretariat_access?on_conflict=assistant_user_id",
      {
        method: "POST",
        headers: {
          apikey: secretKey,
          authorization: "Bearer " + secretKey,
          "content-type": "application/json",
          accept: "application/json",
          prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify({
          owner_user_id: access.user.id,
          assistant_user_id: body.assistant_user_id,
          assigned_by: access.user.id,
          active: action === "grant",
          updated_at: new Date().toISOString()
        })
      }
    );
    const raw = await response.text();
    let data = [];
    try { data = raw ? JSON.parse(raw) : []; } catch {}
    if (!response.ok) return json({ error: "SECRETARIAT_ACCESS_SAVE_FAILED" }, 503);
    return json({ ok: true, action, access: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    if (error?.message === "INVALID_JSON") return json({ error: "INVALID_JSON" }, 400);
    return json({ error: "SECRETARIAT_ACCESS_SAVE_FAILED" }, 503);
  }
}
