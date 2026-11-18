import { json, callRpc, readJson, validUuid } from "../../../_shared/superbase.js";
import { requireAdminRoles } from "../../../_shared/security.js";
import { financialFail } from "../../../_shared/financial-errors.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAdminRoles(request, env, ["admin","risk_admin"]);
    if (auth.error) return auth.error;
    const body = await readJson(request, 5000);
    if (!validUuid(body?.application_id)) return json({ error: "INVALID_APPLICATION_ID" }, 400);
    if (!["approved","rejected"].includes(body?.decision)) return json({ error: "INVALID_DECISION" }, 400);
    if (body?.admin_note != null && (typeof body.admin_note !== "string" || body.admin_note.length > 1000)) {
      return json({ error: "ADMIN_NOTE_TOO_LONG" }, 400);
    }
    const result = await callRpc(env, "review_agent_application", {
      p_admin_user_id: auth.user.id,
      p_application_id: body.application_id,
      p_decision: body.decision,
      p_admin_note: body.admin_note || null,
    });
    return json({ ok: true, result });
  } catch (error) {
    return financialFail(error);
  }
}
