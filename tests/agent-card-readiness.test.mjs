import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const app = read("../public/app.js");
const page = read("../public/index.html");
const adminPage = read("../public/admin/index.html");
const adminApp = read("../public/admin/admin.js");
const agentStatus = read("../functions/api/agents/status.js");
const agentApply = read("../functions/api/agents/apply.js");
const adminAgentReview = read("../functions/api/admin/agents/review.js");
const cardApi = read("../functions/api/cards.js");
const systemHealth = read("../functions/api/admin/system-health.js");

test("customer app exposes a fail-closed agent application and status flow", () => {
  for (const id of [
    "agentApplicationForm",
    "agentStatusBanner",
    "agentApplicationHistory",
    "agentApplicationNotice"
  ]) assert.match(page, new RegExp('id="' + id + '"'));

  assert.match(app, /api\("\/api\/agents\/status"\)/);
  assert.match(app, /api\("\/api\/agents\/apply"/);
  assert.match(app, /function renderAgentStatus\(data\)/);
  assert.match(app, /form\.hidden = true/);
  assert.match(agentApply, /requireUser\(request, env\)/);
});

test("agent status endpoint scopes private rows to the signed-in user", () => {
  assert.match(agentStatus, /requireUser\(request, env\)/);
  assert.match(agentStatus, /applicant_user_id=eq\.\$\{userId\}/);
  assert.match(agentStatus, /user_id=eq\.\$\{userId\}/);
});

test("admin can review agent applications only through the protected review route", () => {
  assert.match(adminPage, /data-record-type="agents"/);
  assert.match(adminPage, /id="adminAgentReviewForm"/);
  assert.match(adminApp, /\/api\/admin\/agents\/review/);
  assert.match(adminAgentReview, /requireAdminRoles\(request, env, \["admin","risk_admin"\]\)/);
  assert.match(adminAgentReview, /review_agent_application/);
});

test("card tiers remain server-assigned and card issuance stays disabled", () => {
  assert.match(cardApi, /CARD_TIER_SERVER_ASSIGNED/);
  assert.match(cardApi, /card_issuance_enabled:false/);
  assert.match(cardApi, /issuance_enabled:false/);
  assert.match(systemHealth, /card_program_tiers/);
  assert.match(systemHealth, /card_customer_limits/);
  assert.match(systemHealth, /card_instruments\?select=id,user_id,card_status/);
  assert.match(app, /pa gen okenn kat fizik oswa vityèl k ap emèt/);
});

test("Admin read views avoid columns absent from the Production schema", () => {
  const records = read("../functions/api/admin/records.js");
  const analytics = read("../functions/api/admin/analytics.js");
  assert.doesNotMatch(records, /reference_code|is_system|system_account_code/);
  assert.match(records, /ledger_transactions\?select=id,transaction_type,status,created_at/);
  assert.doesNotMatch(analytics, /initiated_by/);
  assert.match(analytics, /users_with_service: null/);
  assert.match(analytics, /user_activity_metric_available: false/);
});
