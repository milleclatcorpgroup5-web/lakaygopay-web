import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../public/app.js");
const page = read("../public/index.html");
const signupRoute = read("../functions/api/auth/register.js");
const migration = read("../superbase/migrations/202611210001_production_schema_repair.sql");

test("signup collects a four-digit PIN and no longer renders an email OTP step", () => {
  assert.match(page, /id="personalPin"/);
  assert.match(page, /id="personalPinConfirm"/);
  assert.match(page, /id="merchantPin"/);
  assert.match(page, /id="merchantPinConfirm"/);
  assert.doesNotMatch(page, /personalEmailPending|merchantOtpForm|Kòd konfimasyon 6 chif/);
  assert.doesNotMatch(app, /verifyOtp|personalEmailPending|merchantOtpForm|pendingPersonalEmail|pendingMerchantEmail/);
});

test("signup requires an immediate Supabase session before saving the transaction PIN", () => {
  assert.match(app, /supabase\.auth\.setSession/);
  assert.match(app, /api\("\/api\/pin\/setup",\s*\{\s*method:\s*"POST"/);
  assert.match(app, /SIGNUP_CONFIRMATION_REQUIRED/);
  assert.match(signupRoute, /auth\/v1\/signup/);
  assert.match(signupRoute, /session:\s*data\.session\s*\|\|\s*null/);
});

test("Production repair creates all ten missing Admin/Card resources", () => {
  for (const table of [
    "card_program_tiers",
    "card_tier_stars",
    "card_customer_limits",
    "card_limit_history",
    "card_applications",
    "card_instruments",
    "admin_secretariat_access",
    "admin_secretariat_items",
    "platform_fee_proposals",
    "admin_pin_reset_challenges"
  ]) assert.match(migration, new RegExp("create table if not exists public\\." + table + "\\b", "i"));
});

test("Production repair keeps browser roles out of private tables and leaves money rails unchanged", () => {
  assert.match(migration, /enable row level security/gi);
  assert.match(migration, /from public,anon,authenticated/gi);
  assert.match(migration, /issuance_enabled=false/);
  assert.match(migration, /fee_engine_activated',false/);
  assert.doesNotMatch(migration, /(?:insert into|update|delete from)\s+public\.(?:wallets|wallet_balances|ledger_accounts|ledger_entries|ledger_transactions|transfers|withdrawal_requests)\b/i);
  assert.doesNotMatch(migration, /alter table public\.(?:wallets|wallet_balances|ledger_accounts|ledger_entries|ledger_transactions|transfers|withdrawal_requests)\b/i);
});
