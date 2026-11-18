import { json, callRpc } from "../../../_shared/superbase.js";
import { requireAdminRoles } from "../../../_shared/security.js";
import { financialFail } from "../../../_shared/financial-errors.js";

export async function onRequestGet({ request, env }) {
  const access = await requireAdminRoles(
    request, env, ["finance_admin","accountant","auditor"]
  );
  if (access.error) return access.error;

  try {
    const url = new URL(request.url);
    const rawDays = url.searchParams.get("days");
    const days = rawDays == null ? 30 : Number(rawDays);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      return json({ error: "FINANCE_REPORT_RANGE_INVALID" }, 400);
    }
    const report = await callRpc(env, "get_admin_daily_financial_summary", {
      p_admin_user_id: access.user.id,
      p_days: days
    });
    return json({
      ok: true,
      report,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    return financialFail(error);
  }
}
