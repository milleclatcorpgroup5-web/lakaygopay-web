import { json, callRpc } from "../../../_shared/superbase.js";
import { financialFail } from "../../../_shared/financial-errors.js";
import { requireAdminRoles } from "../../../_shared/security.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdminRoles(request, env, ["admin","finance_admin","risk_admin","accountant","auditor"]);
    if (auth.error) return auth.error;
    const report = await callRpc(env, "run_ledger_integrity_check", { p_admin_user_id: auth.user.id });
    return json({ ok: true, report });
  } catch (error) {
    return financialFail(error);
  }
}
