import { json, callRpc, readJson, validUuid } from "../../../_shared/superbase.js";
import { financialFail } from "../../../_shared/financial-errors.js";
import { requireAdminRoles } from "../../../_shared/security.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAdminRoles(request, env, ["admin","finance_admin","risk_admin"], { requireFreshMfa: true });
    if (auth.error) return auth.error;
    const body = await readJson(request);
    if (!validUuid(body?.withdrawal_id)) return json({ error: "INVALID_WITHDRAWAL_ID" }, 400);
    if (!["approved", "rejected"].includes(body?.decision)) return json({ error: "INVALID_DECISION" }, 400);
    if (body?.comment != null && (typeof body.comment !== "string" || body.comment.length > 500)) {
      return json({ error: "COMMENT_TOO_LONG" }, 400);
    }
    const result = await callRpc(env, "record_withdrawal_approval", {
      p_admin_user_id: auth.user.id,
      p_withdrawal_id: body.withdrawal_id,
      p_decision: body.decision,
      p_comment: body.comment || null,
    });
    return json({ ok: true, result });
  } catch (error) {
    return financialFail(error);
  }
}
