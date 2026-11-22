import { json, requireUser, callRpc, validUuid } from "../../_shared/superbase.js";
import { financialFail } from "../../_shared/financial-errors.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const token = new URL(request.url).searchParams.get("token");
    if (!validUuid(token)) return json({ error: "INVALID_QR_TOKEN" }, 400);
    const paymentRequest = await callRpc(env, "get_merchant_qr_request_details", {
      p_public_token: token
    });
    return json({ ok: true, payment_request: paymentRequest });
  } catch (error) {
    return financialFail(error);
  }
}
