import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { onRequestPost as postTransfer } from "../functions/api/transfers.js";
import { onRequestPost as postLegacyTransfets } from "../functions/api/transfets.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const ENV = {
  SUPABASE_URL: "https://unit-test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit_test",
  SUPABASE_SECRET_KEY: "sb_secret_unit_test",
};
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SENDER_WALLET = "22222222-2222-4222-8222-222222222222";
const RECIPIENT_WALLET = "33333333-3333-4333-8333-333333333333";
const USER_JWT = "verified-user-access-token";
const PIN = "1234";
const PIN_SALT = "0123456789abcdef0123456789abcdef";
const ITERATIONS = 600000;
const TRANSFER_ROW = {
  transfer_id: "44444444-4444-4444-8444-444444444444",
  ledger_transaction_id: "55555555-5555-4555-8555-555555555555",
  transfer_status: "posted",
  transfer_amount: "12.50",
  transfer_currency: "HTG",
  idempotent_replay: false,
};

let pinHash;

async function hashPin(pin) {
  const salt = Uint8Array.from(PIN_SALT.match(/.{2}/g), (part) => parseInt(part, 16));
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    material,
    256
  );
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function request(path, options = {}) {
  const key = options.key || "transfer-test-key-01";
  const body = {
    sender_wallet_id: SENDER_WALLET,
    recipient_wallet_id: RECIPIENT_WALLET,
    amount: "12.50",
    note: "  tès  ",
  };
  if (Object.prototype.hasOwnProperty.call(options, "pin")) {
    if (options.pin !== undefined) body.pin = options.pin;
  } else {
    body.pin = PIN;
  }
  return new Request("https://lakaygopay.test" + path, {
    method: "POST",
    headers: {
      authorization: "Bearer " + USER_JWT,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
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
      assert.equal(payload.p_user_id, USER_ID);
      calls.at(-1).payload = payload;
      return response([{ is_locked: false, locked_until: null, failed_attempts: payload.p_success ? 0 : 1 }]);
    }
    if (target.endsWith("/rest/v1/rpc/transfer_funds_server_authorized")) {
      // Critical regression check: money movement is invoked only through the
      // server-authorized wrapper after JWT, active-account and PIN validation.
      assert.equal(headers.get("authorization"), "Bearer " + ENV.SUPABASE_SECRET_KEY);
      assert.equal(headers.get("apikey"), ENV.SUPABASE_SECRET_KEY);
      const payload = JSON.parse(init.body);
      calls.at(-1).payload = payload;
      return response([TRANSFER_ROW]);
    }
    if (target.endsWith("/rest/v1/rpc/post_wallet_transfer")) {
      assert.fail("Legacy incompatible post_wallet_transfer RPC must never be called");
    }
    throw new Error("Unexpected test fetch: " + target);
  };
  return calls;
}

test("POST /api/transfers uses the server-authorized transfer RPC after PIN validation", async () => {
  pinHash = pinHash || await hashPin(PIN);
  const calls = installFetch();
  const result = await postTransfer({ request: request("/api/transfers"), env: ENV });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.ok, true);
  assert.equal(body.transfer.transfer_status, "posted");

  const attempt = calls.find((item) => item.url.endsWith("/record_customer_pin_attempt"));
  assert.equal(attempt.payload.p_success, true);
  const transfer = calls.find((item) => item.url.endsWith("/transfer_funds_server_authorized"));
  assert.ok(transfer);
  assert.deepEqual(transfer.payload, {
    p_actor_user_id: USER_ID,
    p_sender_wallet_id: SENDER_WALLET,
    p_recipient_wallet_id: RECIPIENT_WALLET,
    p_amount: "12.50",
    p_note: "tès",
    p_idempotency_key: "transfer-test-key-01",
  });
});

test("missing 4-digit PIN is rejected before any transfer RPC", async () => {
  pinHash = pinHash || await hashPin(PIN);
  const calls = installFetch();
  const result = await postTransfer({
    request: request("/api/transfers", { pin: undefined }),
    env: ENV,
  });
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { error: "PIN_MUST_BE_4_DIGITS" });
  assert.equal(calls.some((item) => item.url.endsWith("/transfer_funds_server_authorized")), false);
});

test("incorrect PIN is recorded and cannot initiate a transfer", async () => {
  pinHash = pinHash || await hashPin(PIN);
  const calls = installFetch();
  const result = await postTransfer({
    request: request("/api/transfers", { pin: "0000" }),
    env: ENV,
  });
  assert.equal(result.status, 401);
  assert.deepEqual(await result.json(), { error: "PIN_INVALID" });
  const attempt = calls.find((item) => item.url.endsWith("/record_customer_pin_attempt"));
  assert.equal(attempt.payload.p_success, false);
  assert.equal(calls.some((item) => item.url.endsWith("/transfer_funds_server_authorized")), false);
});

test("legacy /api/transfets path cannot bypass the mandatory PIN", async () => {
  pinHash = pinHash || await hashPin(PIN);
  const calls = installFetch();
  const result = await postLegacyTransfets({
    request: request("/api/transfets", { pin: undefined }),
    env: ENV,
  });
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { error: "PIN_MUST_BE_4_DIGITS" });
  assert.equal(calls.some((item) => item.url.endsWith("/transfer_funds_server_authorized")), false);
});
