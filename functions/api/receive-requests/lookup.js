import { json, requireUser, callUserRpc, validUuid } from "../../_shared/supabase.js";
import { financialFail } from "../../_shared/financial-errors.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const token = new URL(request.url).searchParams.get("token");
    if (!validUuid(token)) return json({ error: "INVALID_RECEIVE_TOKEN" }, 400);
    const receiveRequest = await callUserRpc(env, auth.accessToken, "get_personal_receive_request_details", { p_public_token: token });
    return json({ ok: true, receive_request: receiveRequest });
  } catch (error) {
    return financialFail(error);
  }
}
