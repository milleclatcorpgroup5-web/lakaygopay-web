import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { onRequestPost as createMerchantQr } from "../functions/api/payment-requests.js";
import { onRequestGet as lookupMerchantQr } from "../functions/api/payment-requests/lookup.js";
import { onRequestPost as payMerchantQr } from "../functions/api/payment-requests/pay.js";
import { onRequestGet as getPaymentHistory } from "../functions/api/payments.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const ENV = {
  SUPABASE_URL: "https://unit-test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit_test",
  SUPABASE_SECRET_KEY: "sb_secret_unit_test",
};
const USER_ID = "11111111-1111-4111-8111-111111111111";
const MERCHANT_ID = "22222222-2222-4222-8222-222222222222";
const WALLET_ID = "33333333-3333-4333-8333-333333333333";
const QR_TOKEN = "44444444-4444-4444-8444-444444444444";
const USER_JWT = "verified-user-access-token";
const PIN = "1234";
const PIN_SALT = "0123456789abcdef0123456789abcdef";
const ITERATIONS = 600000;

let pinHash;

async function hashPin(pin) {
  const salt = Uint8Array.from(PIN_SALT.match(/.{2}/g), (part) => parseInt(part, 16));
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    material, 256
  );
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function request(path, { body = {}, key = "merchant-qr-test-key", method = "POST" } = {}) {
  const init = {
    method,
    headers: { authorization: "Bearer " + USER_JWT },
  };
  if (method !== "GET") {
    init.headers["content-type"] = "application/json";
    init.headers["idempotency-key"] = key;
    init.body = JSON.stringify(body);
  }
  return new Request("https://lakaygopay.test" + path, init);
}

function installFetch({ validPinHash = pinHash } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    const headers = new Headers(init.headers || {});
    calls.push({ url: target, method: init.method || "GET", headers, body: init.body });

    if (target.endsWith("/auth/v1/user")) {
      assert.equal(headers.get("authorization"), "Bearer " + USER_JWT);
      assert.equal(headers.get("apikey"), ENV.SUPABASE_PUBLISHABLE_KEY);
      return response({ id: USER_ID });
    }
    if (target.includes("/rest/v1/profiles?")) {
      assert.equal(headers.get("authorization"), "Bearer " + ENV.SUPABASE_SECRET_KEY);
      return response([{ account_status: "active" }]);
    }
    if (target.includes("/rest/v1/user_security?")) {
      assert.equal(headers.get("authorization"), "Bearer " + ENV.SUPABASE_SECRET_KEY);
      return response([{
        pin_hash: validPinHash,
        pin_salt: PIN_SALT,
        pin_iterations: ITERATIONS,
        locked_until: null,
      }]);
    }
    if (target.endsWith("/rest/v1/rpc/record_customer_pin_attempt")) {
      assert.equal(headers.get("authorization"), "Bearer " + ENV.SUPABASE_SECRET_KEY);
      const payload = JSON.parse(init.body);
      calls.at(-1).payload = payload;
      return response([{ is_locked: false, locked_until: null, failed_attempts: payload.p_success ? 0 : 1 }]);
    }
    if (target.endsWith("/rest/v1/rpc/create_merchant_qr_request")) {
      assert.equal(headers.get("authorization"), "Bearer " + ENV.SUPABASE_SECRET_KEY);
      assert.equal(headers.get("apikey"), ENV.SUPABASE_SECRET_KEY);
      calls.at(-1).payload = JSON.parse(init.body);
      return response({
        payment_request_id: "55555555-5555-4555-8555-555555555555",
        qr_token: QR_TOKEN,
        status: "pending",
        amount: "25.00",
        currency: "HTG",
        expires_in_minutes: 1440,
      });
    }
    if (target.endsWith("/rest/v1/rpc/get_merchant_qr_request_details")) {
      assert.equal(headers.get("authorization"), "Bearer " + ENV.SUPABASE_SECRET_KEY);
      calls.at(-1).payload = JSON.parse(init.body);
      return response({
        merchant_name: "Boutik Tès",
        merchant_phone: "+509 3000 0000",
        merchant_category: "Komès",
        merchant_status: "active",
        amount: "25.00",
        currency: "HTG",
        status: "pending",
      });
    }
    if (target.endsWith("/rest/v1/rpc/pay_merchant_qr_request_server_authorized")) {
      assert.equal(headers.get("authorization"), "Bearer " + ENV.SUPABASE_SECRET_KEY);
      assert.equal(headers.get("apikey"), ENV.SUPABASE_SECRET_KEY);
      calls.at(-1).payload = JSON.parse(init.body);
      return response({
        payment_id: "66666666-6666-4666-8666-666666666666",
        ledger_transaction_id: "66666666-6666-4666-8666-666666666666",
        reference: "LGP-MQR-6666666666666666",
        amount: "25.00",
        currency: "HTG",
        status: "paid",
        idempotent_replay: false,
      });
    }
    if (target.includes("/rpc/pay_merchant_payment_request") ||
        target.includes("/rpc/create_merchant_payment_request") ||
        target.includes("/rpc/get_payment_request_details")) {
      assert.fail("Legacy incompatible merchant QR RPC must not be called");
    }
    throw new Error("Unexpected test fetch: " + target);
  };
  return calls;
}

test("merchant QR creation calls only the new 24-hour server RPC", async () => {
  const calls = installFetch();
  const result = await createMerchantQr({
    request: request("/api/payment-requests", {
      body: {
        merchant_id: MERCHANT_ID,
        amount: "25.00",
        currency: "HTG",
        description: "Achat",
        expires_in_minutes: 1440,
      },
    }),
    env: ENV,
  });
  assert.equal(result.status, 201);
  const body = await result.json();
  assert.equal(body.payment_request.qr_token, QR_TOKEN);
  const rpc = calls.find((item) => item.url.endsWith("/create_merchant_qr_request"));
  assert.ok(rpc);
  assert.equal(rpc.payload.p_actor_user_id, USER_ID);
  assert.equal(rpc.payload.p_merchant_id, MERCHANT_ID);
  assert.equal(rpc.payload.p_currency, "HTG");
  assert.equal(rpc.payload.p_expires_in_minutes, 1440);
});

test("merchant QR creation rejects non-24-hour expiry before calling financial RPC", async () => {
  const calls = installFetch();
  const result = await createMerchantQr({
    request: request("/api/payment-requests", {
      body: { merchant_id: MERCHANT_ID, amount: "25.00", expires_in_minutes: 60 },
    }),
    env: ENV,
  });
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { error: "INVALID_EXPIRY" });
  assert.equal(calls.some((item) => item.url.endsWith("/create_merchant_qr_request")), false);
});

test("merchant QR lookup calls the new private lookup RPC", async () => {
  const calls = installFetch();
  const req = new Request(
    "https://lakaygopay.test/api/payment-requests/lookup?token=" + QR_TOKEN,
    { headers: { authorization: "Bearer " + USER_JWT } }
  );
  const result = await lookupMerchantQr({ request: req, env: ENV });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.payment_request.merchant_name, "Boutik Tès");
  const rpc = calls.find((item) => item.url.endsWith("/get_merchant_qr_request_details"));
  assert.ok(rpc);
  assert.deepEqual(rpc.payload, { p_public_token: QR_TOKEN });
});

test("merchant QR payment verifies PIN before calling server-authorized RPC", async () => {
  pinHash = pinHash || await hashPin(PIN);
  const calls = installFetch();
  const result = await payMerchantQr({
    request: request("/api/payment-requests/pay", {
      body: { qr_token: QR_TOKEN, payer_wallet_id: WALLET_ID, amount: "25.00", pin: PIN },
    }),
    env: ENV,
  });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.payment.status, "paid");
  const attempt = calls.find((item) => item.url.endsWith("/record_customer_pin_attempt"));
  assert.equal(attempt.payload.p_success, true);
  const payment = calls.find((item) => item.url.endsWith("/pay_merchant_qr_request_server_authorized"));
  assert.ok(payment);
  assert.deepEqual(payment.payload, {
    p_actor_user_id: USER_ID,
    p_public_token: QR_TOKEN,
    p_payer_wallet_id: WALLET_ID,
    p_amount: "25.00",
    p_idempotency_key: "merchant-qr-test-key",
  });
  assert.equal(calls.some((item) => item.url.endsWith("/pay_merchant_payment_request")), false);
});

test("merchant QR payment with missing PIN never calls the settlement RPC", async () => {
  const calls = installFetch();
  const result = await payMerchantQr({
    request: request("/api/payment-requests/pay", {
      body: { qr_token: QR_TOKEN, payer_wallet_id: WALLET_ID, amount: "25.00" },
    }),
    env: ENV,
  });
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { error: "PIN_MUST_BE_4_DIGITS" });
  assert.equal(calls.some((item) => item.url.endsWith("/pay_merchant_qr_request_server_authorized")), false);
});

test("merchant QR SQL migration uses Production ledger columns and protected RPCs", () => {
  const sql = readFileSync(new URL(
    "../superbase/migrations/202611220001_merchant_qr_production_safe.sql",
    import.meta.url
  ), "utf8");
  assert.match(sql, /ledger_entries\s*\(\s*transaction_id\s*,\s*account_id\s*,\s*direction\s*,\s*amount\s*,\s*currency/s);
  assert.match(sql, /public\.post_ledger_transaction\(v_transaction_id\)/);
  assert.match(sql, /pay_merchant_qr_request_server_authorized/);
  assert.match(sql, /interval '24 hours'/);
  assert.match(sql, /paid_payer_wallet_id uuid/);
  assert.match(sql, /paid_at timestamptz/);
  assert.match(sql, /grant select on table public\.merchant_qr_requests to service_role/i);
  assert.doesNotMatch(sql, /public\.idempotency_keys|ledger_entries\s*\(\s*ledger_transaction_id\s*,\s*wallet_id/s);
});


test("payment history includes payer and merchant-side QR receipts from the new table", async () => {
  const ownedMerchantId = "77777777-7777-4777-8777-777777777777";
  const payerTransactionId = "88888888-8888-4888-8888-888888888888";
  const receivedTransactionId = "99999999-9999-4999-8999-999999999999";
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(String(url));
    const headers = new Headers(init.headers || {});
    if (target.pathname.endsWith("/auth/v1/user")) {
      assert.equal(headers.get("authorization"), "Bearer " + USER_JWT);
      return response({ id: USER_ID });
    }
    if (target.pathname.endsWith("/rest/v1/profiles")) {
      return response([{ account_status: "active" }]);
    }
    if (target.pathname.endsWith("/rest/v1/merchants")) {
      return response([{ id: ownedMerchantId }]);
    }
    if (target.pathname.endsWith("/rest/v1/merchant_payment_records")) {
      return response({ code: "PGRST205", message: "table not found" }, 404);
    }
    if (target.pathname.endsWith("/rest/v1/merchant_qr_requests")) {
      if (target.searchParams.get("paid_by_user_id") === "eq." + USER_ID) {
        return response([{
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          merchant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          paid_by_user_id: USER_ID,
          paid_payer_wallet_id: WALLET_ID,
          paid_amount: "12.00",
          currency: "HTG",
          paid_ledger_transaction_id: payerTransactionId,
          paid_at: "2026-11-22T12:00:00Z",
        }]);
      }
      if (target.searchParams.get("merchant_id") === "eq." + ownedMerchantId) {
        return response([{
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          merchant_id: ownedMerchantId,
          paid_by_user_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          paid_payer_wallet_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          paid_amount: "35.50",
          currency: "USD",
          paid_ledger_transaction_id: receivedTransactionId,
          paid_at: "2026-11-22T12:05:00Z",
        }]);
      }
      return response([]);
    }
    throw new Error("Unexpected payment-history fetch: " + target);
  };

  const req = new Request("https://lakaygopay.test/api/payments", {
    headers: { authorization: "Bearer " + USER_JWT },
  });
  const result = await getPaymentHistory({ request: req, env: ENV });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.payments.length, 2);
  const payerReceipt = body.payments.find((item) => item.id === payerTransactionId);
  assert.equal(payerReceipt.amount, "12.00");
  assert.equal(payerReceipt.payer_wallet_id, WALLET_ID);
  const merchantReceipt = body.payments.find((item) => item.id === receivedTransactionId);
  assert.equal(merchantReceipt.amount, "35.50");
  assert.equal(merchantReceipt.merchant_id, ownedMerchantId);
});
