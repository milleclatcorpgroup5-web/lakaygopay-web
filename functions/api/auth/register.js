import { json, config, readJson } from "../../_shared/superbase.js";

function validEmail(value) {
  return typeof value === "string"
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function validPhone(value) {
  return typeof value === "string"
    && value.trim().length >= 8
    && value.trim().length <= 24
    && /^[+0-9 ()-]+$/.test(value.trim());
}

function isAtLeast18(dateText) {
  if (typeof dateText !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return false;
  const birth = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime()) || birth.toISOString().slice(0,10) !== dateText) return false;
  const today = new Date();
  const cutoff = new Date(Date.UTC(
    today.getUTCFullYear() - 18,
    today.getUTCMonth(),
    today.getUTCDate()
  ));
  return birth <= cutoff;
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request, 6000);
    const accountType = body?.account_type;
    const email = String(body?.email || "").trim().toLowerCase();
    const password = typeof body?.password === "string" ? body.password : "";

    if (!validEmail(email)) return json({ error: "VALID_EMAIL_REQUIRED" }, 400);
    if (password.length < 8 || password.length > 128) {
      return json({ error: "PASSWORD_MUST_BE_8_TO_128_CHARACTERS" }, 400);
    }

    let metadata;
    if (accountType === "personal") {
      const firstName = String(body?.first_name || "").trim();
      const lastName = String(body?.last_name || "").trim();
      const phone = String(body?.phone || "").trim();
      const dob = String(body?.date_of_birth || "");

      if (firstName.length < 1 || firstName.length > 60) return json({ error: "FIRST_NAME_REQUIRED" }, 400);
      if (lastName.length < 1 || lastName.length > 60) return json({ error: "LAST_NAME_REQUIRED" }, 400);
      if (!validPhone(phone)) return json({ error: "VALID_PHONE_REQUIRED" }, 400);
      if (!isAtLeast18(dob)) return json({ error: "MINIMUM_AGE_18" }, 400);

      metadata = {
        account_type: "personal",
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`,
        phone,
        date_of_birth: dob,
      };
    } else if (accountType === "merchant") {
      const businessName = String(body?.business_name || "").trim();
      const businessPhone = String(body?.business_phone || "").trim();
      if (businessName.length < 2 || businessName.length > 120) {
        return json({ error: "VALID_BUSINESS_NAME_REQUIRED" }, 400);
      }
      if (!validPhone(businessPhone)) return json({ error: "VALID_BUSINESS_PHONE_REQUIRED" }, 400);

      metadata = {
        account_type: "merchant",
        business_name: businessName,
        full_name: businessName,
        business_phone: businessPhone,
        phone: businessPhone,
      };
    } else {
      return json({ error: "INVALID_ACCOUNT_TYPE" }, 400);
    }

    const { url, publishableKey } = config(env);
    const response = await fetch(`${url}/auth/v1/signup`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ email, password, data: metadata }),
    });

    const data = await response.json().catch(() => ({}));
    if (response.ok && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return json({ error: "EMAIL_ALREADY_REGISTERED" }, 409);
    }
    if (!response.ok) {
      const upstream = String(data?.msg || data?.message || data?.error_description || data?.code || "");
      const normalized = /already registered|already been registered|user already/i.test(upstream)
        ? "EMAIL_ALREADY_REGISTERED"
        : /password/i.test(upstream)
          ? "PASSWORD_POLICY_REJECTED"
          : "SIGNUP_FAILED";
      return json({ error: normalized }, response.status >= 500 ? 503 : 400);
    }

    return json({
      ok: true,
      account_type: accountType,
      user: data.user ? { id: data.user.id, email: data.user.email } : null,
      session: data.session || null,
      needs_email_confirmation: !data.session,
      verification_method: accountType === "merchant" ? "email_otp" : "email_link",
    }, 201);
  } catch (error) {
    const status = Number(error?.status) || 503;
    if (error?.message === "INVALID_JSON") return json({ error: "INVALID_JSON" }, 400);
    return json({ error: "SIGNUP_UNAVAILABLE" }, status);
  }
}
