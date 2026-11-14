import { json, requireUser, callUserRest, fail } from "../_shared/supabase.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const notifications = await callUserRest(env, auth.accessToken,
      "notifications?select=id,category,title,body,payload,read_at,created_at&order=created_at.desc&limit=50");
    return json({ ok: true, notifications });
  } catch (error) {
    return fail(error);
  }
}
