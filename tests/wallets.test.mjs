import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/wallets.js";

const ENV = {
  SUPABASE_URL: "https://unit-test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit_test",
  SUPABASE_SECRET_KEY: "sb_secret_unit_test",
};
const USER_ID = "11111111-1111-4111-8111-111111111111";
const USER_JWT = "verified-user-access-token";
const WALLET_ID = "22222222-2222-4222-8222-222222222222";

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("wallet API returns the database status field using the user's JWT", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    const headers = new Headers(init.headers || {});
    calls.push({ target, headers });

    if (target.endsWith("/auth/v1/user")) {
      assert.equal(headers.get("authorization"), "Bearer " + USER_JWT);
      assert.equal(headers.get("apikey"), ENV.SUPABASE_PUBLISHABLE_KEY);
      return response({ id: USER_ID });
    }
    if (target.includes("/rest/v1/profiles?")) {
      assert.equal(headers.get("authorization"), "Bearer " + ENV.SUPABASE_SECRET_KEY);
      return response([{ account_status: "active" }]);
    }
    if (target.includes("/rest/v1/wallet_balances?")) {
      assert.equal(headers.get("authorization"), "Bearer " + USER_JWT);
      assert.equal(headers.get("apikey"), ENV.SUPABASE_PUBLISHABLE_KEY);
      assert.match(target, /select=[^&]*status/);
      return response([{
        wallet_id: WALLET_ID,
        owner_user_id: USER_ID,
        merchant_id: null,
        currency: "HTG",
        status: "active",
        balance: "1000.00",
        created_at: "2026-11-23T00:00:00Z",
      }]);
    }
    throw new Error("Unexpected request: " + target);
  };

  try {
    const request = new Request("https://lakaygopay.test/api/wallets", {
      headers: { authorization: "Bearer " + USER_JWT },
    });
    const result = await onRequestGet({ request, env: ENV });
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.equal(body.ok, true);
    assert.equal(body.wallets.length, 1);
    assert.equal(body.wallets[0].status, "active");
    assert.equal(body.wallets[0].balance, "1000.00");
    assert.equal(calls.some((call) => call.target.includes("/rest/v1/wallet_balances?")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
