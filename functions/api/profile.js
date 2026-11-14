import { json, requireUser, callUserRest, fail } from "../_shared/supabase.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const rows = await callUserRest(env, auth.accessToken,
      "profiles?select=id,full_name,phone,preferred_language,account_status,created_at&limit=1");
    return json({ ok: true, profile: rows?.[0] || null });
  } catch (error) {
    return fail(error);
  }
}
