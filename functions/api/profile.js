import { json, requireUser, callUserRest, config, readJson, fail } from "../_shared/superbase.js";

function validName(value) {
  return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 120;
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const rows = await callUserRest(env, auth.accessToken,
      "profiles?select=id,full_name,first_name,last_name,date_of_birth,account_type,phone,preferred_language,account_status,created_at&limit=1");
    return json({ ok: true, profile: rows?.[0] || null });
  } catch (error) {
    return fail(error);
  }
}

export async function onRequestPatch({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const body = await readJson(request, 3000);
    const update = {};

    if (Object.prototype.hasOwnProperty.call(body || {}, "full_name")) {
      if (!validName(body.full_name)) return json({ error: "INVALID_PROFILE_NAME" }, 400);
      update.full_name = body.full_name.trim();
    }
    if (Object.prototype.hasOwnProperty.call(body || {}, "preferred_language")) {
      if (!["ht", "fr", "en"].includes(body.preferred_language)) {
        return json({ error: "INVALID_LANGUAGE" }, 400);
      }
      update.preferred_language = body.preferred_language;
    }
    if (!Object.keys(update).length) return json({ error: "NO_PROFILE_CHANGES" }, 400);

    const { url, publishableKey } = config(env);
    const response = await fetch(
      url + "/rest/v1/profiles?id=eq." + encodeURIComponent(auth.user.id) +
        "&select=id,full_name,first_name,last_name,date_of_birth,account_type,phone,preferred_language,account_status,created_at",
      {
        method: "PATCH",
        headers: {
          apikey: publishableKey,
          authorization: "Bearer " + auth.accessToken,
          "content-type": "application/json",
          accept: "application/json",
          prefer: "return=representation",
        },
        body: JSON.stringify(update),
      }
    );
    if (!response.ok) return json({ error: "PROFILE_UPDATE_FAILED" }, response.status === 401 ? 401 : 400);
    const rows = await response.json();
    return json({ ok: true, profile: rows?.[0] || null });
  } catch (error) {
    return fail(error);
  }
}
