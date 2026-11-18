import { json, requireUser, config } from "./superbase.js";

const ADMIN_ROLES = new Set([
  "super_admin","admin","finance_admin","risk_admin",
  "support_agent","auditor","accountant","secretary"
]);

export async function requireAdmin(request, env) {
  const auth = await requireUser(request, env);
  if (auth.error) return { error: auth.error };

  try {
    const { url, secretKey } = config(env);
    const endpoint = url + "/rest/v1/user_roles?select=role&user_id=eq." +
      encodeURIComponent(auth.user.id);
    const response = await fetch(endpoint, {
      headers: {
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
        accept: "application/json",
      },
    });

    if (!response.ok) {
      // Fail closed if the live database has not yet been given the RBAC table.
      return { error: json({ error: "ADMIN_ROLE_SYSTEM_NOT_READY" }, 503) };
    }

    const rows = await response.json();
    const roles = Array.isArray(rows)
      ? rows.map((row) => String(row.role || "")).filter((role) => ADMIN_ROLES.has(role))
      : [];

    if (!roles.length) {
      return { error: json({ error: "ADMIN_ACCESS_DENIED" }, 403) };
    }

    return { user: auth.user, accessToken: auth.accessToken, roles };
  } catch {
    return { error: json({ error: "ADMIN_ACCESS_CHECK_FAILED" }, 503) };
  }
}
