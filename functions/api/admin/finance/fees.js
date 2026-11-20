import { json, config, callRpc, readJson, validUuid } from "../../../_shared/superbase.js";
import { requireAdminRoles } from "../../../_shared/security.js";
import { financialFail } from "../../../_shared/financial-errors.js";

const SERVICE_CODES = new Set([
  "internal_transfer","merchant_qr","fx_conversion","cash_in","cash_out","bill_payment"
]);
const CURRENCIES = new Set(["HTG","USD","EUR"]);
const FEE_KINDS = new Set(["fixed","percentage"]);

async function listProposals(url, secretKey) {
  const response = await fetch(
    url + "/rest/v1/platform_fee_proposals?select=id,service_code,currency,fee_kind,fee_value,minimum_fee,maximum_fee,version,effective_at,status,proposed_by,reviewed_by,reviewed_at,proposal_note,decision_note,created_at&order=created_at.desc&limit=100",
    {
      headers: {
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
        accept: "application/json"
      }
    }
  );
  const raw = await response.text();
  let rows = [];
  try { rows = raw ? JSON.parse(raw) : []; } catch {}
  if (!response.ok || !Array.isArray(rows)) throw new Error("FEE_PROPOSALS_UNAVAILABLE");
  return rows;
}

export async function onRequestGet({ request, env }) {
  const access = await requireAdminRoles(request, env, ["finance_admin","accountant","auditor"]);
  if (access.error) return access.error;
  try {
    const { url, secretKey } = config(env);
    const proposals = await listProposals(url, secretKey);
    return json({
      ok: true,
      proposals,
      can_propose: access.roles.includes("finance_admin") && !access.roles.includes("super_admin"),
      can_approve: access.roles.includes("super_admin"),
      fee_engine_active: false,
      generated_at: new Date().toISOString()
    });
  } catch {
    return json({ error: "FEE_PROPOSALS_UNAVAILABLE" }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  const access = await requireAdminRoles(request, env, ["finance_admin"], { requireFreshMfa: true });
  if (access.error) return access.error;
  if (!access.roles.includes("finance_admin") || access.roles.includes("super_admin")) return json({ error: "FINANCE_ROLE_REQUIRED" }, 403);
  try {
    const body = await readJson(request, 5000);
    const serviceCode = String(body?.service_code || "");
    const currency = String(body?.currency || "");
    const feeKind = String(body?.fee_kind || "");
    const feeValue = Number(body?.fee_value);
    const minimumFee = body?.minimum_fee == null || body.minimum_fee === "" ? 0 : Number(body.minimum_fee);
    const maximumFee = body?.maximum_fee == null || body.maximum_fee === "" ? null : Number(body.maximum_fee);
    const effectiveAt = typeof body?.effective_at === "string" ? new Date(body.effective_at) : null;
    const note = typeof body?.note === "string" ? body.note.trim() : "";

    if (!SERVICE_CODES.has(serviceCode)) return json({ error: "FEE_SERVICE_INVALID" }, 400);
    if (!CURRENCIES.has(currency)) return json({ error: "FEE_CURRENCY_INVALID" }, 400);
    if (!FEE_KINDS.has(feeKind)) return json({ error: "FEE_KIND_INVALID" }, 400);
    if (!Number.isFinite(feeValue) || feeValue <= 0 || feeValue > 1000000000) return json({ error: "FEE_VALUE_INVALID" }, 400);
    if (!Number.isFinite(minimumFee) || minimumFee < 0 ||
        (maximumFee !== null && (!Number.isFinite(maximumFee) || maximumFee < minimumFee))) {
      return json({ error: "FEE_RANGE_INVALID" }, 400);
    }
    if (!effectiveAt || Number.isNaN(effectiveAt.getTime())) return json({ error: "FEE_EFFECTIVE_DATE_INVALID" }, 400);
    if (note.length > 500) return json({ error: "FEE_NOTE_TOO_LONG" }, 400);

    const result = await callRpc(env, "propose_platform_fee", {
      p_actor_user_id: access.user.id,
      p_service_code: serviceCode,
      p_currency: currency,
      p_fee_kind: feeKind,
      p_fee_value: feeValue,
      p_effective_at: effectiveAt.toISOString(),
      p_minimum_fee: minimumFee,
      p_maximum_fee: maximumFee,
      p_note: note
    });
    return json({ ok: true, proposal: result }, 201);
  } catch (error) {
    return financialFail(error);
  }
}

export async function onRequestPatch({ request, env }) {
  const access = await requireAdminRoles(request, env, [], { requireFreshMfa: true });
  if (access.error) return access.error;
  try {
    const body = await readJson(request, 3000);
    if (!validUuid(body?.proposal_id)) return json({ error: "FEE_PROPOSAL_ID_INVALID" }, 400);
    if (!["approve","reject"].includes(body?.decision)) return json({ error: "FEE_DECISION_INVALID" }, 400);
    const decisionNote = typeof body?.decision_note === "string" ? body.decision_note.trim() : "";
    if (decisionNote.length > 500) return json({ error: "FEE_NOTE_TOO_LONG" }, 400);

    const result = await callRpc(env, "review_platform_fee_proposal", {
      p_super_admin_user_id: access.user.id,
      p_proposal_id: body.proposal_id,
      p_decision: body.decision,
      p_decision_note: decisionNote
    });
    return json({ ok: true, result });
  } catch (error) {
    return financialFail(error);
  }
}
