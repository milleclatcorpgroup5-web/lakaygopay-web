import { json, config, callRpc, readJson, validUuid } from "../../../_shared/superbase.js";
import { requireAdminRoles } from "../../../_shared/security.js";
import { financialFail } from "../../../_shared/financial-errors.js";

async function readRows(url, secretKey, resource) {
  const response = await fetch(url + "/rest/v1/" + resource, {
    headers: {
      apikey: secretKey,
      authorization: "Bearer " + secretKey,
      accept: "application/json"
    }
  });
  const raw = await response.text();
  let rows = [];
  try { rows = raw ? JSON.parse(raw) : []; } catch {}
  if (!response.ok || !Array.isArray(rows)) throw new Error("TEAM_DIRECTORY_UNAVAILABLE");
  return rows;
}

export async function onRequestGet({ request, env }) {
  const access = await requireAdminRoles(request, env, []);
  if (access.error) return access.error;
  try {
    const { url, secretKey } = config(env);
    const [profiles, assigned] = await Promise.all([
      readRows(url, secretKey, "profiles?select=id,full_name,account_status,created_at&order=created_at.desc&limit=500"),
      readRows(url, secretKey, "user_roles?select=user_id,role,assigned_at&order=assigned_at.desc&limit=500")
    ]);
    const roleMap = new Map();
    for (const row of assigned) {
      const list = roleMap.get(row.user_id) || [];
      list.push(row.role);
      roleMap.set(row.user_id, list);
    }
    return json({
      ok: true,
      users: profiles.map((profile) => ({
        ...profile,
        roles: [...new Set(roleMap.get(profile.id) || [])]
      })),
      assignable_roles: ["admin","finance_admin","accountant","risk_admin","support_agent","auditor","secretary"],
      generated_at: new Date().toISOString()
    });
  } catch {
    return json({ error: "TEAM_DIRECTORY_UNAVAILABLE" }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  const access = await requireAdminRoles(request, env, [], { requireFreshMfa: true });
  if (access.error) return access.error;
  try {
    const body = await readJson(request, 4000);
    if (!validUuid(body?.target_user_id)) return json({ error: "INVALID_USER_ID" }, 400);
    const role = String(body?.role || "");
    const action = String(body?.action || "");
    if (!["admin","finance_admin","accountant","risk_admin","support_agent","auditor","secretary"].includes(role)) {
      return json({ error: "ADMIN_ROLE_INVALID" }, 400);
    }
    if (!["grant","revoke"].includes(action)) return json({ error: "ADMIN_ROLE_ACTION_INVALID" }, 400);
    const result = await callRpc(env, "admin_set_user_role", {
      p_admin_user_id: access.user.id,
      p_target_user_id: body.target_user_id,
      p_role: role,
      p_action: action
    });
    return json({ ok: true, result });
  } catch (error) {
    return financialFail(error);
  }
}
