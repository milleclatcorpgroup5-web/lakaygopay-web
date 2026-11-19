import { json, requireUser, callUserRest, fail } from "../../_shared/superbase.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const merchants = await callUserRest(env, auth.accessToken,
      "merchants?select=id,owner_user_id,business_name,business_type,category,status,created_at&order=created_at.desc");
    return json({ ok: true, merchants: merchants || [] });
  } catch (error) {
    return fail(error);
  }
}
