import { json, requireUser, callRpc, readJson, validUuid } from "../../../_shared/superbase.js";
import { connectError } from "../../../_shared/connect.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const body = await readJson(request);
    if (!validUuid(body?.payout_id)) return json({ error: "CONNECT_PAYOUT_NOT_FOUND" }, 400);
    const result = await callRpc(env, "connect_reject_payout", {
      p_actor_user_id: auth.user.id,
      p_payout_id: body.payout_id
    });
    return json({ ok: true, payout: result });
  } catch (error) {
    return connectError(error);
  }
}
