import { json, config, requireUser, fail } from "../_shared/superbase.js";

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
    const error = new Error("USER_DATA_READ_FAILED");
    error.status = response.status >= 500 ? 503 : 400;
    throw error;
  }
  return rows;
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;

    const { url, secretKey } = config(env);
    const ownerFilter = "owner_user_id=eq." + encodeURIComponent(auth.user.id) +
      "&select=id&limit=50";
    const merchants = await readRows(url, secretKey, "merchants?" + ownerFilter);
    const commonSelect = "select=id,payment_request_id,merchant_id,payer_user_id,payer_wallet_id,amount,currency,created_at" +
      "&order=created_at.desc&limit=100";

    const requests = [
      readRows(url, secretKey, "merchant_payment_records?" + commonSelect +
        "&payer_user_id=eq." + encodeURIComponent(auth.user.id))
    ];

    // Include payments received by businesses owned by this signed-in user.
    // The service key is used only after the server has established the owner ID;
    // every query is constrained to that user's own merchant IDs.
    for (const merchant of merchants) {
      requests.push(readRows(url, secretKey, "merchant_payment_records?" + commonSelect +
        "&merchant_id=eq." + encodeURIComponent(merchant.id)));
    }

    const groups = await Promise.all(requests);
    const unique = new Map();
    for (const rows of groups) {
      for (const row of rows) unique.set(row.id, row);
    }
    const payments = [...unique.values()]
      .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))
      .slice(0, 100);

    return json({ ok: true, payments });
  } catch (error) {
    return fail(error);
  }
}
