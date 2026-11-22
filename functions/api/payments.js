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
    error.databaseCode = typeof rows?.code === "string" ? rows.code : "UNKNOWN";
    throw error;
  }
  return rows;
}

// Optional legacy tables may not exist in every Production deployment.
// Only missing-relation/schema-cache errors are skipped; permission/network errors fail closed.
async function readOptionalRows(url, secretKey, resource) {
  try {
    return await readRows(url, secretKey, resource);
  } catch (error) {
    if (["42P01", "PGRST205", "PGRST204"].includes(error?.databaseCode)) return [];
    throw error;
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;

    const { url, secretKey } = config(env);
    const userId = encodeURIComponent(auth.user.id);
    const merchants = await readRows(
      url, secretKey,
      "merchants?owner_user_id=eq." + userId + "&select=id&limit=50"
    );
    const legacySelect = "select=id,payment_request_id,merchant_id,payer_user_id,payer_wallet_id,amount,currency,created_at" +
      "&order=created_at.desc&limit=100";
    const qrSelect = "select=id,merchant_id,paid_by_user_id,paid_payer_wallet_id,paid_amount,currency,paid_ledger_transaction_id,paid_at" +
      "&status=eq.paid&order=paid_at.desc&limit=100";

    const reads = [
      readOptionalRows(url, secretKey, "merchant_payment_records?" + legacySelect +
        "&payer_user_id=eq." + userId),
      readOptionalRows(url, secretKey, "merchant_qr_requests?" + qrSelect +
        "&paid_by_user_id=eq." + userId)
    ];

    // Include payments received by businesses owned by this signed-in user.
    // The service key is used only after the server establishes these merchant IDs.
    for (const merchant of merchants) {
      const merchantId = encodeURIComponent(merchant.id);
      reads.push(readOptionalRows(url, secretKey, "merchant_payment_records?" + legacySelect +
        "&merchant_id=eq." + merchantId));
      reads.push(readOptionalRows(url, secretKey, "merchant_qr_requests?" + qrSelect +
        "&merchant_id=eq." + merchantId));
    }

    const groups = await Promise.all(reads);
    const unique = new Map();
    for (let index = 0; index < groups.length; index++) {
      const rows = groups[index] || [];
      for (const row of rows) {
        const isMerchantQr = Object.prototype.hasOwnProperty.call(row, "paid_ledger_transaction_id");
        const payment = isMerchantQr ? {
          id: row.paid_ledger_transaction_id,
          payment_request_id: row.id,
          merchant_id: row.merchant_id,
          payer_user_id: row.paid_by_user_id,
          payer_wallet_id: row.paid_payer_wallet_id,
          amount: row.paid_amount,
          currency: row.currency,
          created_at: row.paid_at,
          reference: row.paid_ledger_transaction_id
        } : row;
        if (payment.id) unique.set(payment.id, payment);
      }
    }

    const payments = [...unique.values()]
      .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))
      .slice(0, 100);
    return json({ ok: true, payments });
  } catch (error) {
    return fail(error);
  }
}
