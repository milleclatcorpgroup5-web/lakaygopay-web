import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const middleware = read("../functions/_middleware.js");
const clientLogs = read("../functions/api/logs/client.js");
const adminLogs = read("../functions/api/admin/logs.js");
const logger = read("../functions/_shared/system-logs.js");
const telemetry = read("../public/observability.js");
const page = read("../public/index.html");
const adminPage = read("../public/admin/index.html");
const app = read("../public/app.js");
const adminApp = read("../public/admin/admin.js");
const migration = read("../superbase/migrations/202611190004_system_logs.sql");

test("technical logs are written server-side and sensitive payloads are not stored", () => {
  assert.match(middleware, /writeSystemLog/);
  assert.match(middleware, /response\.status >= 500/);
  assert.match(logger, /system_logs/);
  assert.match(logger, /systemLogPath/);
  assert.doesNotMatch(logger, /authorization:.*event|request\.text\(\)|body\.password|body\.pin/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.system_logs from public, anon, authenticated/i);
});

test("browser reports are same-origin and tied to an authenticated user", () => {
  assert.match(clientLogs, /sameOrigin\(request\)/);
  assert.match(clientLogs, /requireUser\(request, env\)/);
  assert.match(clientLogs, /auth\.user\.id/);
  assert.match(telemetry, /JS_RUNTIME_ERROR/);
  assert.match(telemetry, /JS_UNHANDLED_REJECTION/);
  assert.match(telemetry, /API_NETWORK_ERROR/);
  assert.match(page, /observability\.js/);
  assert.match(adminPage, /observability\.js/);
});

test("Admin live logs are protected by Admin role, PIN and MFA checks", () => {
  assert.match(adminLogs, /requireAdminRoles\(request, env, \["admin", "risk_admin", "auditor"\]\)/);
  assert.match(adminLogs, /system_logs/);
});

test("public and Admin APIs present a friendly temporary error, not raw server details", () => {
  assert.match(app, /Nou pa kapab trete demann ou an kounye a/);
  assert.match(adminApp, /Nou pa kapab trete demann ou an kounye a/);
  assert.match(middleware, /TEMPORARY_UNAVAILABLE/);
});
