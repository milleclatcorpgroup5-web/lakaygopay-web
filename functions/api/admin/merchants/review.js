import { json, callRpc, readJson, validUuid } from "../../../_shared/superbase.js";
import { financialFail } from "../../../_shared/financial-errors.js";
import { requireAdminRoles } from "../../../_shared/security.js";

const allowed = new Set(["under_review", "active", "rejected", "suspended"]);

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAdminRoles(request, env, ["admin","risk_admin"], { requireFreshMfa: true });
    if (auth.error) return auth.error;
    const body = await readJson(request);
    if (!validUuid(body?.merchant_id)) return json({ error: "INVALID_MERCHANT_ID" }, 400);
    if (!allowed.has(body?.status)) return json({ error: "INVALID_MERCHANT_STATUS" }, 400);
    const result = await callRpc(env, "set_merchant_status", {
      p_admin_user_id: auth.user.id,
      p_merchant_id: body.merchant_id,
      p_status: body.status,
      p_comment: typeof body.comment === "string" ? body.comment.slice(0, 500) : null,
    });
    return json({ ok: true, result });
  } catch (error) {
    return financialFail(error);
  }
}
