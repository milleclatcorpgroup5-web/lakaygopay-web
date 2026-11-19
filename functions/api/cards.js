import { json, config, requireUser, readJson } from "../_shared/superbase.js";

const FALLBACK_TIERS = [
  { tier_code: "BASIC", display_name: "LakayGo Basic", sort_order: 1, description: "Klas baz LakayGo pou antre nan ekosistèm kat la.", benefits: ["Bous HTG, USD ak EUR", "Peman QR ak transfè entèn", "Kontwòl sekirite ak notifikasyon"], application_open: true, issuance_enabled: false, virtual_supported: true, physical_supported: true },
  { tier_code: "STANDARD", display_name: "LakayGo Standard", sort_order: 2, description: "Klas mwayèn pou itilizasyon regilye ak plis sèvis.", benefits: ["Tout avantaj Basic", "Opsyon kat vityèl oswa fizik", "Limit depans konfigirab apre patnè a valide", "Sipò priyoritè"], application_open: true, issuance_enabled: false, virtual_supported: true, physical_supported: true },
  { tier_code: "GOLD", display_name: "LakayGo Gold", sort_order: 3, description: "Klas Premium pou kliyan ki bezwen plis avantaj.", benefits: ["Tout avantaj Standard", "Kat Gold vityèl oswa fizik", "Avantaj patnè ak òf eksklizif", "Sipò kliyan Gold"], application_open: true, issuance_enabled: false, virtual_supported: true, physical_supported: true }
];

const TIER_SELECT = "tier_code,display_name,sort_order,description,benefits,application_open,issuance_enabled,virtual_supported,physical_supported";
const APPLICATION_SELECT = "id,user_id,tier_code,requested_form,status,created_at,updated_at,reviewed_at";

async function readRows(url, secretKey, resource) {
  const response = await fetch(url + "/rest/v1/" + resource, {
    headers: {
      apikey: secretKey,
      authorization: "Bearer " + secretKey,
      accept: "application/json"
    }
  });
  const raw = await response.text();
  let rows;
  try { rows = raw ? JSON.parse(raw) : []; } catch { rows = null; }
  if (!response.ok || !Array.isArray(rows)) {
    const error = new Error("CARD_PROGRAM_DATA_UNAVAILABLE");
    error.status = response.status === 404 ? 503 : 502;
    error.schemaMissing = response.status === 404;
    throw error;
  }
  return rows;
}

async function writeApplication(url, secretKey, payload) {
  const response = await fetch(url + "/rest/v1/card_applications?select=" + encodeURIComponent(APPLICATION_SELECT), {
    method: "POST",
    headers: {
      apikey: secretKey,
      authorization: "Bearer " + secretKey,
      "content-type": "application/json",
      accept: "application/json",
      prefer: "return=representation"
    },
    body: JSON.stringify(payload)
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok || !Array.isArray(data) || !data[0]) {
    const error = new Error(response.status === 409 ? "CARD_APPLICATION_ALREADY_EXISTS" : "CARD_APPLICATION_FAILED");
    error.status = response.status === 409 ? 409 : (response.status === 404 ? 503 : 400);
    error.conflict = response.status === 409;
    error.schemaMissing = response.status === 404;
    throw error;
  }
  return data[0];
}

async function existingApplication(url, secretKey, userId) {
  const rows = await readRows(
    url,
    secretKey,
    "card_applications?select=" + encodeURIComponent(APPLICATION_SELECT) +
      "&user_id=eq." + encodeURIComponent(userId) +
      "&status=in.(waitlist,under_review,eligible)&order=created_at.desc&limit=1"
  );
  return rows[0] || null;
}

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;

  let backend;
  try {
    backend = config(env);
  } catch {
    return json({ error: "BACKEND_NOT_CONFIGURED" }, 503);
  }

  try {
    const tiers = await readRows(
      backend.url,
      backend.secretKey,
      "card_program_tiers?select=" + encodeURIComponent(TIER_SELECT) + "&order=sort_order.asc"
    );
    const application = await existingApplication(backend.url, backend.secretKey, auth.user.id);
    return json({
      ok: true,
      schema_ready: true,
      tiers: tiers.length ? tiers : FALLBACK_TIERS,
      application,
      card_issuance_enabled: false
    });
  } catch (error) {
    if (error.schemaMissing) {
      return json({
        ok: true,
        schema_ready: false,
        tiers: FALLBACK_TIERS,
        application: null,
        card_issuance_enabled: false
      });
    }
    return json({ error: "CARD_PROGRAM_DATA_UNAVAILABLE" }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await readJson(request, 2000);
  } catch {
    return json({ error: "INVALID_CARD_APPLICATION" }, 400);
  }

  const tierCode = String(body?.tier_code || "").trim().toUpperCase();
  const requestedForm = String(body?.requested_form || "").trim().toLowerCase();
  if (!["BASIC", "STANDARD", "GOLD"].includes(tierCode)) {
    return json({ error: "CARD_TIER_INVALID" }, 400);
  }
  if (!["virtual", "physical", "both"].includes(requestedForm)) {
    return json({ error: "CARD_FORMAT_INVALID" }, 400);
  }

  let backend;
  try {
    backend = config(env);
  } catch {
    return json({ error: "BACKEND_NOT_CONFIGURED" }, 503);
  }

  try {
    const tiers = await readRows(
      backend.url,
      backend.secretKey,
      "card_program_tiers?select=" + encodeURIComponent(TIER_SELECT) +
        "&tier_code=eq." + encodeURIComponent(tierCode) + "&limit=1"
    );
    const tier = tiers[0];
    if (!tier) return json({ error: "CARD_TIER_INVALID" }, 400);
    if (!tier.application_open) return json({ error: "CARD_APPLICATION_CLOSED" }, 409);
    if ((requestedForm === "virtual" && !tier.virtual_supported) ||
        (requestedForm === "physical" && !tier.physical_supported) ||
        (requestedForm === "both" && (!tier.virtual_supported || !tier.physical_supported))) {
      return json({ error: "CARD_FORMAT_UNAVAILABLE" }, 400);
    }

    const existing = await existingApplication(backend.url, backend.secretKey, auth.user.id);
    if (existing) {
      return json({ ok: true, already_registered: true, application: existing, card_issuance_enabled: false });
    }

    let application;
    try {
      application = await writeApplication(backend.url, backend.secretKey, {
        user_id: auth.user.id,
        tier_code: tierCode,
        requested_form: requestedForm,
        status: "waitlist",
        application_source: "customer_app"
      });
    } catch (error) {
      if (!error.conflict) throw error;
      application = await existingApplication(backend.url, backend.secretKey, auth.user.id);
      if (!application) throw error;
      return json({ ok: true, already_registered: true, application, card_issuance_enabled: false });
    }

    return json({
      ok: true,
      already_registered: false,
      application,
      card_issuance_enabled: false
    }, 201);
  } catch (error) {
    if (error.schemaMissing) return json({ error: "CARD_PROGRAM_SCHEMA_PENDING" }, 503);
    return json({ error: "CARD_APPLICATION_FAILED" }, 503);
  }
}
