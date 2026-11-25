import { json, requireUser, config, callRpc, readJson, validUuid, validAmount, idempotencyKey } from "../../_shared/superbase.js";
import { assertTransactionPin } from "../../_shared/pin.js";
import { financialFail } from "../../_shared/financial-errors.js";

async function rows(env, query) {
  const { url, secretKey } = config(env);
  const response = await fetch(url + "/rest/v1/" + query, {
    headers: { apikey: secretKey, authorization: "Bearer " + secretKey, accept: "application/json" }
  });
  if (!response.ok) throw new Error("AGENT_REQUESTS_UNAVAILABLE");
  return response.json();
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const uid = encodeURIComponent(auth.user.id);
    const [sent, agentRows] = await Promise.all([
      rows(env, "agent_cash_withdrawal_tests?customer_user_id=eq." + uid +
        "&select=id,amount,currency,status,created_at,updated_at&order=created_at.desc&limit=30"),
      rows(env, "agent_accounts?user_id=eq." + uid + "&status=eq.active&select=id,public_agent_id&limit=1")
    ]);
    let incoming = [];
    if (agentRows[0]) {
      incoming = await rows(env, "agent_cash_withdrawal_tests?agent_account_id=eq." +
        encodeURIComponent(agentRows[0].id) +
        "&select=id,customer_user_id,amount,currency,status,created_at,updated_at&order=created_at.desc&limit=50");
      for (const item of incoming) {
        const profiles = await rows(env, "profiles?id=eq." + encodeURIComponent(item.customer_user_id) + "&select=full_name&limit=1");
        item.customer_name = profiles[0]?.full_name || "Kliyan LakayGo";
      }
    }
    return json({ ok: true, sent, incoming, agent: agentRows[0] ? { public_agent_id: agentRows[0].public_agent_id } : null });
  } catch (error) {
    return financialFail(error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const body = await readJson(request, 4000);
    if (body?.action === "decision") {
      if (!validUuid(body.request_id) || !["confirmed", "rejected"].includes(body.decision)) {
        return json({ error: "INVALID_AGENT_DECISION" }, 400);
      }
      await assertTransactionPin(env, auth.user.id, body.pin);
      const result = await callRpc(env, "decide_agent_cash_withdrawal_test", {
        p_agent_user_id: auth.user.id,
        p_request_id: body.request_id,
        p_decision: body.decision
      });
      return json({ ok: true, result });
    }

    await assertTransactionPin(env, auth.user.id, body?.pin);
    if (!/^\d{8}$/.test(String(body?.agent_id || ""))) return json({ error: "INVALID_AGENT_ID" }, 400);
    if (!validUuid(body?.wallet_id)) return json({ error: "INVALID_WALLET_ID" }, 400);
    const amount = validAmount(body?.amount);
    if (!amount) return json({ error: "INVALID_AMOUNT" }, 400);
    const key = idempotencyKey(request);
    if (!key) return json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400);
    const result = await callRpc(env, "create_agent_cash_withdrawal_test", {
      p_customer_user_id: auth.user.id,
      p_public_agent_id: String(body.agent_id),
      p_wallet_id: body.wallet_id,
      p_amount: amount,
      p_idempotency_key: key
    });
    return json({ ok: true, request: result, test_only: true }, 201);
  } catch (error) {
    return financialFail(error);
  }
}
