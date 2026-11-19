#!/usr/bin/env node
import { randomUUID } from "node:crypto";
// Read-only / non-money smoke tests for a deployed LakayGoPay test environment.
// Required: LGP_BASE_URL. Optional: LGP_TEST_ACCESS_TOKEN (a test user's JWT).

const base = (process.env.LGP_BASE_URL || "").replace(/\/$/, "");
const token = process.env.LGP_TEST_ACCESS_TOKEN || "";
if (!base) {
  console.error("Set LGP_BASE_URL to the deployed LakayGoPay test URL.");
  process.exit(2);
}

let failures = 0;
async function check(name, path, expectedStatuses, options = {}) {
  try {
    const headers = { accept: "application/json", ...(options.headers || {}) };
    if (token && options.auth !== false) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${base}${path}`, { method: options.method || "GET", headers, body: options.body });
    const data = await response.json().catch(() => ({}));
    const passed = expectedStatuses.includes(response.status);
    console.log(`${passed ? "PASS" : "FAIL"} ${name}: HTTP ${response.status}`);
    if (!passed) {
      console.log(`  Expected: ${expectedStatuses.join(" or ")}; response: ${JSON.stringify(data)}`);
      failures += 1;
    }
    return { response, data };
  } catch (error) {
    console.log(`FAIL ${name}: ${error.message}`);
    failures += 1;
    return null;
  }
}

await check("health endpoint", "/api/health", [200]);
await check("public client config", "/api/config", [200]);
await check("private profile refuses anonymous access", "/api/profile", [401], { auth: false });
await check("card program refuses anonymous access", "/api/cards", [401], { auth: false });

if (token) {
  await check("profile endpoint", "/api/profile", [200]);
  await check("wallet endpoint", "/api/wallets", [200]);
  await check("merchant endpoint", "/api/merchant/mine", [200]);
  await check("payments endpoint", "/api/payments", [200]);
  await check("card program catalogue endpoint", "/api/cards", [200]);
  await check("withdrawals endpoint", "/api/withdrawals", [200]);
  await check("admin role endpoint", "/api/admin/me", [200]);
  await check("transfer validation rejects malformed wallet IDs", "/api/transfers", [400], {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
    body: JSON.stringify({}),
  });
  await check("QR lookup rejects malformed token", "/api/payment-requests/lookup?token=not-a-uuid", [400]);
} else {
  console.log("SKIP authenticated checks: set LGP_TEST_ACCESS_TOKEN to a test user's access token.");
}

console.log(failures === 0 ? "\nAll executed checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
