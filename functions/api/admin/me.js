import { json, requireUser, callRpc, fail } from "../../_shared/superbase.js";
import { requireAal2 } from "../../_shared/security.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const isAdmin = await callRpc(env, "is_admin_user", { p_user_id: auth.user.id });
    if (isAdmin !== true) return json({ ok: true, is_admin: false, aal2: false });
    const elevated = await requireAal2(request, env);
    return json({ ok: true, is_admin: true, aal2: !elevated.error });
  } catch (error) {
    return fail(error);
  }
}
