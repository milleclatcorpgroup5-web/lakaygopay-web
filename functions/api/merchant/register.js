import { json, config, requireUser, callRpc, readJson, idempotencyKey, fail } from "../../_shared/supabase.js";

const businessTypes = new Set(["sole_proprietor", "company", "cooperative", "nonprofit", "other"]);

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const key = idempotencyKey(request);
    if (!key) return json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400);

    const businessName = String(body?.business_name || "").trim();
    const contactPhone = String(body?.contact_phone || "").trim();
    if (businessName.length < 2 || businessName.length > 120) {
      return json({ error: "INVALID_BUSINESS_NAME" }, 400);
    }
    if (!businessTypes.has(body?.business_type || "other")) {
      return json({ error: "INVALID_BUSINESS_TYPE" }, 400);
    }
    if (contactPhone.length < 8 || contactPhone.length > 24 || !/^[+0-9 ()-]+$/.test(contactPhone)) {
      return json({ error: "VALID_BUSINESS_PHONE_REQUIRED" }, 400);
    }
    if (!auth.user.email) return json({ error: "BUSINESS_EMAIL_REQUIRED" }, 400);

    const merchant = await callRpc(env, "register_merchant_account", {
      p_actor_user_id: auth.user.id,
      p_business_name: businessName,
      p_business_type: body.business_type || "other",
      p_category: null,
      p_contact_phone: contactPhone,
      p_idempotency_key: key,
    });

    const merchantId = merchant?.merchant_id || merchant?.[0]?.merchant_id;
    if (!merchantId) return json({ error: "MERCHANT_REGISTRATION_INCOMPLETE" }, 503);

    const { url, secretKey } = config(env);
    const patch = await fetch(
      `${url}/rest/v1/merchants?id=eq.${encodeURIComponent(merchantId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: secretKey,
          authorization: `Bearer ${secretKey}`,
          "content-type": "application/json",
          prefer: "return=minimal",
        },
        body: JSON.stringify({ contact_email: auth.user.email }),
      }
    );
    if (!patch.ok) return json({ error: "BUSINESS_EMAIL_SAVE_FAILED" }, 503);

    return json({ ok: true, merchant }, 201);
  } catch (error) {
    return fail(error);
  }
}
