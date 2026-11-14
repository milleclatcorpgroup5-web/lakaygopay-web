import { json, requireUser, callRpc, readJson, idempotencyKey, fail } from "../../_shared/supabase.js";

const businessTypes = new Set(["sole_proprietor", "company", "cooperative", "nonprofit", "other"]);

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const key = idempotencyKey(request);
    if (!key) return json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400);
    if (typeof body?.business_name !== "string" || body.business_name.trim().length < 2 || body.business_name.trim().length > 120) {
      return json({ error: "INVALID_BUSINESS_NAME" }, 400);
    }
    if (!businessTypes.has(body?.business_type)) return json({ error: "INVALID_BUSINESS_TYPE" }, 400);

    const result = await callRpc(env, "register_merchant_account", {
      p_actor_user_id: auth.user.id,
      p_business_name: body.business_name.trim(),
      p_business_type: body.business_type,
      p_category: typeof body.category === "string" ? body.category.slice(0, 80) : null,
      p_contact_phone: typeof body.contact_phone === "string" ? body.contact_phone.slice(0, 30) : null,
      p_idempotency_key: key,
    });
    return json({ ok: true, merchant: result }, 201);
  } catch (error) {
    return fail(error);
  }
}
