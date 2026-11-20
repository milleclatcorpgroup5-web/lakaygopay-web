import { json, callRpc, readJson, validUuid } from "../../../_shared/superbase.js";
import { requireAdminRoles } from "../../../_shared/security.js";
import { financialFail } from "../../../_shared/financial-errors.js";

const allowedStatuses = new Set(["active", "suspended"]);

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAdminRoles(request, env, ["admin","risk_admin"], { requireFreshMfa: true });
    if (auth.error) return auth.error;

    const body = await readJson(request, 4000);
    if (!validUuid(body?.user_id)) return json({ error: "INVALID_USER_ID" }, 400);
    if (!allowedStatuses.has(body?.status)) return json({ error: "USER_STATUS_INVALID" }, 400);
    if (body?.reason != null && (typeof body.reason !== "string" || body.reason.length > 500)) {
      return json({ error: "USER_STATUS_REASON_TOO_LONG" }, 400);
    }

    const result = await callRpc(env, "admin_set_user_account_status", {
      p_admin_user_id: auth.user.id,
      p_target_user_id: body.user_id,
      p_status: body.status,
      p_reason: body.reason || null
    });
    return json({ ok: true, result });
  } catch (error) {
    return financialFail(error);
  }
}
