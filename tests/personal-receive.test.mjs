import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { onRequestPost as createReceiveRequest } from "../functions/api/receive-requests.js";
import { onRequestGet as lookupReceiveRequest } from "../functions/api/receive-requests/lookup.js";
import { onRequestPost as payReceiveRequest } from "../functions/api/receive-requests/pay.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const ENV = {
  SUPABASE_URL: "https://unit-test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit_test",
  SUPABASE_SECRET_KEY: "sb_secret_unit_test",
};
const USER_ID = "11111111-1111-4111-8111-111111111111";
const WALLET_ID = "22222222-2222-4222-8222-222222222222";
const QR_TOKEN = "33333333-3333-4333-8333-333333333333";
const USER_JWT = "verified-user-access-token";
const PIN = "1234";
const PIN_SALT = "0123456789abcdef0123456789abcdef";
const ITERATIONS = 600000;
let pinHash;

async function hashPin(pin) {
  const salt = Uint8Array.from(PIN_SALT.match(/.{2}/g), (part) => parseInt(part, 16));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, material, 256
  );
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function request(path, { body = {}, key = "personal-receive-test-key", method = "POST", token = USER_JWT } = {}) {
  const headers = { authorization: "Bearer " + token };
  if (method !== "GET") {
    headers["content-type"] = "application/json";
    headers["idempotency-key"] = key;
  }
  return new Request("https://lakaygopay.test" + path, {
    method, headers, body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

function installFetch({ validPinHash = pinHash, receiveResult = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    const headers = new Headers(init.headers || {});
    calls.push({ target, headers, payload: init.body ? JSON.parse(init.body) : null });

    if (target.endsWith("/auth/v1/user")) {
      assert.equal(headers.get("authorization"), "Bearer " + USER_JWT);
      assert.equal(headers.get("apikey"), ENV.SUPABASE_PUBLISHABLE_KEY);
      return response({ id: USER_ID });
    }
    if (target.includes("/rest/v1/profiles?")) {
      assert.equal(headers.get("authorization"), "Bearer " + ENV.SUPABASE_SECRET_KEY);
      return response([{ account_status: "active" }]);
    }
    if (target.endsWith("/rest/v1/rpc/create_personal_receive_request")) {
      assert.equal(headers.get("authorization"), "Bearer " + USER_JWT);
      assert.equal(headers.get("apikey"), ENV.SUPABASE_PUBLISHABLE_KEY);
      return response(receiveResult || {
        request_id: "44444444-4444-4444-8444-444444444444",
        qr_token: QR_TOKEN,
        amount: "25.00",
        currency: "HTG",
        status: "pending",
        expires_at: "2026-11-23T12:20:00Z",
      });
    }
    if (target.endsWith("/rest/v1/rpc/get_personal_receive_request_details")) {
      assert.equal(headers.get("authorization"), "Bearer " + USER_JWT);
      assert.equal(headers.get("apikey"), ENV.SUPABASE_PUBLISHABLE_KEY);
      return response({
        request_id: "44444444-4444-4444-8444-444444444444",
        recipient_name: "Itilizatè Tès",
        recipient_phone_masked: "••••1234",
        amount: "25.00",
        currency: "HTG",
        status: "pending",
        expires_at: "2026-11-23T12:20:00Z",
      });
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
      return response([{ is_locked: false, locked_until: null, failed_attempts: 0 }]);
    }
    if (target.endsWith("/rest/v1/rpc/pay_personal_receive_request_server_authorized")) {
      assert.equal(headers.get("authorization"), "Bearer " + ENV.SUPABASE_SECRET_KEY);
      assert.equal(headers.get("apikey"), ENV.SUPABASE_SECRET_KEY);
      return response({
        transfer_id: "55555555-5555-4555-8555-555555555555",
        ledger_transaction_id: "66666666-6666-4666-8666-666666666666",
        reference: "55555555-5555-4555-8555-555555555555",
        amount: "25.00",
        currency: "HTG",
        status: "posted",
        idempotent_replay: false,
      });
    }
    if (target.endsWith("/rest/v1/rpc/transfer_funds")) {
      assert.fail("Personal receive must reuse the protected server wrapper, not call transfer_funds directly");
    }
    throw new Error("Unexpected test fetch: " + target);
  };
  return calls;
}

test("personal receive creation validates request and creates a QR without moving money", async () => {
  const calls = installFetch();
  const result = await createReceiveRequest({
    request: request("/api/receive-requests", {
      body: { wallet_id: WALLET_ID, amount: "25.00", expires_in_minutes: 20 },
    }),
    env: ENV,
  });
  assert.equal(result.status, 201);
  const body = await result.json();
  assert.equal(body.receive_request.qr_token, QR_TOKEN);
  assert.match(body.qr_payload, new RegExp(QR_TOKEN));
  const rpc = calls.find((call) => call.target.endsWith("/create_personal_receive_request"));
  assert.deepEqual(rpc.payload, {
    p_recipient_wallet_id: WALLET_ID,
    p_amount: "25.00",
    p_expires_in_minutes: 20,
    p_idempotency_key: "personal-receive-test-key",
  });
  assert.equal(calls.some((call) => call.target.includes("/transfer_funds")), false);
});

test("personal receive creation rejects invalid expiry before database mutation", async () => {
  const calls = installFetch();
  const result = await createReceiveRequest({
    request: request("/api/receive-requests", {
      body: { wallet_id: WALLET_ID, amount: "25.00", expires_in_minutes: 60 },
    }),
    env: ENV,
  });
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { error: "INVALID_EXPIRY" });
  assert.equal(calls.some((call) => call.target.endsWith("/create_personal_receive_request")), false);
});

test("personal receive lookup rejects malformed tokens before RPC", async () => {
  const calls = installFetch();
  const req = new Request("https://lakaygopay.test/api/receive-requests/lookup?token=not-a-uuid", {
    headers: { authorization: "Bearer " + USER_JWT },
  });
  const result = await lookupReceiveRequest({ request: req, env: ENV });
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { error: "INVALID_RECEIVE_TOKEN" });
  assert.equal(calls.some((call) => call.target.endsWith("/get_personal_receive_request_details")), false);
});

test("personal receive lookup uses the authenticated user's JWT", async () => {
  const calls = installFetch();
  const req = new Request("https://lakaygopay.test/api/receive-requests/lookup?token=" + QR_TOKEN, {
    headers: { authorization: "Bearer " + USER_JWT },
  });
  const result = await lookupReceiveRequest({ request: req, env: ENV });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.receive_request.recipient_name, "Itilizatè Tès");
  assert.ok(calls.some((call) => call.target.endsWith("/get_personal_receive_request_details")));
});

test("personal receive payment verifies PIN before calling the service-only settlement RPC", async () => {
  pinHash = pinHash || await hashPin(PIN);
  const calls = installFetch();
  const result = await payReceiveRequest({
    request: request("/api/receive-requests/pay", {
      body: { qr_token: QR_TOKEN, sender_wallet_id: WALLET_ID, amount: "25.00", pin: PIN },
    }),
    env: ENV,
  });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.transfer.status, "posted");
  const attempt = calls.find((call) => call.target.endsWith("/record_customer_pin_attempt"));
  assert.equal(attempt.payload.p_success, true);
  const payment = calls.find((call) => call.target.endsWith("/pay_personal_receive_request_server_authorized"));
  assert.deepEqual(payment.payload, {
    p_actor_user_id: USER_ID,
    p_public_token: QR_TOKEN,
    p_sender_wallet_id: WALLET_ID,
    p_amount: "25.00",
    p_idempotency_key: "personal-receive-test-key",
  });
});

test("personal receive payment with missing PIN cannot call settlement RPC", async () => {
  const calls = installFetch();
  const result = await payReceiveRequest({
    request: request("/api/receive-requests/pay", {
      body: { qr_token: QR_TOKEN, sender_wallet_id: WALLET_ID, amount: "25.00" },
    }),
    env: ENV,
  });
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { error: "PIN_MUST_BE_4_DIGITS" });
  assert.equal(calls.some((call) => call.target.endsWith("/pay_personal_receive_request_server_authorized")), false);
});

test("personal receive migration defines the table and server-only settlement wrappers", () => {
  const sql = readFileSync(new URL("../superbase/migrations/202611210003_personal_receive_qr.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.personal_receive_requests/i);
  assert.match(sql, /create or replace function public\.create_personal_receive_request/i);
  assert.match(sql, /create or replace function public\.get_personal_receive_request_details/i);
  assert.match(sql, /create or replace function public\.pay_personal_receive_request_server_authorized/i);
  assert.match(sql, /revoke all on function public\.transfer_funds\(uuid,uuid,numeric,text,text\)\s+from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant execute on function public\.pay_personal_receive_request_server_authorized/i);
  assert.match(sql, /TRANSFER_FUNDS_MUST_NOT_BE_DIRECTLY_EXECUTABLE/i);
});
