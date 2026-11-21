import {
  json, requireUser, callRpc, readJson, validUuid, validAmount, idempotencyKey
} from "../_shared/superbase.js";
import { financialFail } from "../_shared/financial-errors.js";
import { assertTransactionPin } from "../_shared/pin.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;

    const userId = auth.user?.id;
    if (!userId || !auth.accessToken) {
      return json({ error: "INVALID_OR_EXPIRED_SESSION" }, 401);
    }

    const body = await readJson(request);
    const key = idempotencyKey(request)?.trim() || null;
    const amount = validAmount(body?.amount);

    if (!key || key.length < 8 || key.length > 128) {
      return json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400);
    }
    if (!validUuid(body?.sender_wallet_id) || !validUuid(body?.recipient_wallet_id)) {
      return json({ error: "INVALID_WALLET_ID" }, 400);
    }
    if (!amount) return json({ error: "INVALID_AMOUNT" }, 400);
    if (body?.note != null && (typeof body.note !== "string" || body.note.length > 140)) {
      return json({ error: "NOTE_TOO_LONG" }, 400);
    }

    // PIN verification remains server-side. Only after it succeeds do we use
    // the service-role wrapper; the browser never receives the service key.
    await assertTransactionPin(env, userId, body?.pin);

    const rpcResult = await callRpc(env, "transfer_funds_server_authorized", {
      p_actor_user_id: userId,
      p_sender_wallet_id: body.sender_wallet_id,
      p_recipient_wallet_id: body.recipient_wallet_id,
      p_amount: amount,
      p_note: typeof body.note === "string" ? (body.note.trim() || null) : null,
      p_idempotency_key: key,
    });

    const transfer = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    if (
      !transfer ||
      !transfer.transfer_id ||
      !transfer.ledger_transaction_id ||
      transfer.transfer_status !== "posted"
    ) {
      throw Object.assign(new Error("TRANSFER_RESULT_INVALID"), { status: 502 });
    }

    return json({ ok: true, transfer });
  } catch (error) {
    return financialFail(error);
  }
}
