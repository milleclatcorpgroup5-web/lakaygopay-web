import { json, requireUser, callRpc, readJson, fail } from "../../_shared/superbase.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const body = await readJson(request, 5000);

    const phone = String(body?.contact_phone || "").trim();
    const department = String(body?.department || "").trim();
    const commune = String(body?.commune || "").trim();
    const address = body?.business_address == null ? null : String(body.business_address).trim();
    const motivation = body?.motivation == null ? null : String(body.motivation).trim();

    if (phone.length < 8 || phone.length > 24 || !/^[+0-9 ()-]+$/.test(phone)) {
      return json({ error: "VALID_PHONE_REQUIRED" }, 400);
    }
    if (department.length < 2 || department.length > 80) return json({ error: "DEPARTMENT_REQUIRED" }, 400);
    if (commune.length < 2 || commune.length > 100) return json({ error: "COMMUNE_REQUIRED" }, 400);
    if (address && address.length > 200) return json({ error: "AGENT_ADDRESS_TOO_LONG" }, 400);
    if (motivation && motivation.length > 1000) return json({ error: "AGENT_MOTIVATION_TOO_LONG" }, 400);

    const application = await callRpc(env, "submit_agent_application", {
      p_user_id: auth.user.id,
      p_contact_phone: phone,
      p_department: department,
      p_commune: commune,
      p_business_address: address,
      p_motivation: motivation,
    });
    return json({ ok: true, application }, 201);
  } catch (error) {
    return fail(error);
  }
}
