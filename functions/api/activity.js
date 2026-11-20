import { json, requireUser, callUserRest, fail } from "../_shared/supabase.js";
import { writeSystemLog } from "../_shared/system-logs.js";

const ACTIVITY_READS = [
  {
    key: "transfers",
    query: "transfers?select=id,sender_wallet_id,recipient_wallet_id,amount,currency,note,status,created_at&order=created_at.desc&limit=50"
  },
  {
    key: "deposits",
    query: "deposit_requests?select=id,wallet_id,amount,currency,status,provider,created_at&order=created_at.desc&limit=50"
  },
  {
    key: "withdrawals",
    query: "withdrawal_requests?select=id,wallet_id,amount,currency,status,destination_type,created_at&order=created_at.desc&limit=50"
  }
];

async function readActivityRows({ request, env, context, accessToken, userId }, item) {
  try {
    return await callUserRest(env, accessToken, item.query);
  } catch (error) {
    const pgCode = /^[A-Z0-9]{4,10}$/i.test(String(error?.databaseCode || ""))
      ? error.databaseCode.toUpperCase()
      : error?.name === "TypeError" ? "NETWORK" : "UNKNOWN";
    const diagnostic = "ACTIVITY_" + item.key.toUpperCase() + "_PG_" + pgCode;
    const logTask = writeSystemLog(env, {
      source: "server",
      severity: "warning",
      event_code: "USER_DATA_READ_FAILED",
      path: "/api/activity",
      method: request.method,
      http_status: Number(error?.databaseStatus || error?.status) || 400,
      request_id: request.headers.get("x-request-id") || "",
      actor_user_id: userId,
      details: {
        diagnostic,
        error_name: pgCode === "NETWORK" ? "TypeError" : "PostgREST_" + pgCode
      }
    });
    if (typeof context?.waitUntil === "function") context.waitUntil(logTask);
    else await logTask;
    const safeError = new Error("USER_DATA_READ_FAILED");
    safeError.status = Number(error?.status) || 400;
    throw safeError;
  }
}

export async function onRequestGet({ request, env, context }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const scope = {
      request,
      env,
      context,
      accessToken: auth.accessToken,
      userId: auth.user.id
    };
    const [transfers, deposits, withdrawals] = await Promise.all(
      ACTIVITY_READS.map((item) => readActivityRows(scope, item))
    );
    const activity = [
      ...(transfers || []).map(item => ({ ...item, kind: "transfer" })),
      ...(deposits || []).map(item => ({ ...item, kind: "deposit" })),
      ...(withdrawals || []).map(item => ({ ...item, kind: "withdrawal" }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 100);
    return json({ ok: true, activity });
  } catch (error) {
    return fail(error);
  }
}
