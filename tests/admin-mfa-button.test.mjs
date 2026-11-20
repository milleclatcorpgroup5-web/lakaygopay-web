import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const adminJs = await readFile(new URL("../public/admin/admin.js", import.meta.url), "utf8");
const adminHtml = await readFile(new URL("../public/admin/index.html", import.meta.url), "utf8");

test("an already AAL2 session can still challenge a verified TOTP factor again", () => {
  assert.ok(adminJs.includes('textContent = aal2 ? "Verifye ankò" : "Verifye MFA";'));
  assert.ok(!adminJs.includes("mfaCanVerify = totpFactors.length > 0 && !(aal2 && !hasPendingFactor)"));
});

test("initial MFA state errors are visible to the Admin user", () => {
  assert.ok(adminJs.includes('catch (mfaError) {'));
  assert.ok(adminJs.includes('setNotice("#adminMfaStatus", explainMfaError(mfaError), "error")'));
});

test("Admin page loads the new MFA control logic without stale cache", () => {
  assert.ok(adminHtml.includes("admin/admin.js?v=20261120-admin-mfa-monthly-01"));
});

test("the MFA verify control remains usable when factor discovery temporarily fails", () => {
  const syncStart = adminJs.indexOf("function syncMfaVerifyButton()");
  const syncEnd = adminJs.indexOf("\nasync function updateMfaStatus()", syncStart);
  const syncBlock = adminJs.slice(syncStart, syncEnd);
  assert.ok(syncBlock.includes('button.disabled = !/^\\d{6}$/.test(code) || button.dataset.verifying === "true";'));
  assert.ok(!syncBlock.includes("!mfaCanVerify"));
});

test("MFA verification uses a submit form and strips non-numeric input", () => {
  assert.ok(adminHtml.includes('<form id="adminMfaVerifyForm"'));
  assert.ok(adminHtml.includes('id="adminMfaVerifyButton" class="button button-primary" type="submit" disabled'));
  assert.ok(adminJs.includes('$("#adminMfaVerifyForm").addEventListener("submit"'));
  assert.ok(adminJs.includes('event.currentTarget.value = event.currentTarget.value.replace(/\\D/g, "").slice(0, 6);'));
});

test("MFA failure messages identify the failing stage without exposing OTP secrets", () => {
  assert.ok(adminJs.includes('async function runMfaStep(stage, operation)'));
  assert.ok(adminJs.includes('runMfaStep("TOTP_CHALLENGE"'));
  assert.ok(adminJs.includes('runMfaStep("TOTP_VERIFY"'));
  assert.ok(adminJs.includes('runMfaStep("SERVER_AAL2_CHECK"'));
  assert.ok(adminJs.includes('return "Verifikasyon MFA a echwe nan etap " + (stage || "MFA_UNKNOWN")'));
  assert.ok(adminJs.includes('messageKey === "MFA_REQUIRED"'));
});


test("MFA diagnostic is read-only and reports only safe identity and factor metadata", () => {
  assert.ok(adminHtml.includes('id="adminMfaDiagnosticsButton"'));
  assert.ok(adminHtml.includes('id="adminMfaDiagnostics"'));
  const start = adminJs.indexOf("async function runAdminMfaDiagnostics()");
  const end = adminJs.indexOf("\nfunction uniqueMfaFriendlyName", start);
  assert.ok(start >= 0 && end > start);
  const block = adminJs.slice(start, end);
  assert.ok(block.includes("supabase.auth.getSession()"));
  assert.ok(block.includes("supabase.auth.getUser()"));
  assert.ok(block.includes("supabase.auth.mfa.listFactors()"));
  assert.ok(block.includes("supabaseProjectRef"));
  assert.ok(!block.includes("totp.secret"));
  assert.ok(block.includes('readAdminMfaFactorBinding(session.user.id, "primary")'));
});

test("MFA enrollment never silently deletes an unverified factor", () => {
  const primaryStart = adminJs.indexOf("async function enrollAdminMfa()");
  const backupStart = adminJs.indexOf("async function enrollAdminMfaBackup()");
  const verifyStart = adminJs.indexOf("async function completeTotpVerification()");
  const primary = adminJs.slice(primaryStart, backupStart);
  const backup = adminJs.slice(backupStart, verifyStart);
  assert.ok(primary.includes('supabase.auth.mfa.enroll('));
  assert.ok(backup.includes('supabase.auth.mfa.enroll('));
  assert.ok(!primary.includes("mfa.unenroll"));
  assert.ok(!backup.includes("mfa.unenroll"));
});


test("MFA flow v2 saves the Supabase-issued factor ID instead of relying on listFactors rediscovery", () => {
  assert.ok(adminJs.includes('const ADMIN_MFA_FACTOR_STORAGE_KEY = "lakaygopay_admin_mfa_factor_v1";'));
  assert.ok(adminJs.includes('saveAdminMfaFactorBinding(userId, factorId, "unverified", friendlyName, purpose)'));
  const start = adminJs.indexOf("async function completeTotpVerification(factorId, code)");
  const end = adminJs.indexOf("\nasync function verifyAdminMfa()", start);
  const block = adminJs.slice(start, end);
  assert.ok(block.includes('supabase.auth.mfa.challenge({ factorId: selectedFactorId })'));
  assert.ok(!block.includes("supabase.auth.mfa.listFactors()"));
  assert.ok(block.includes('runMfaStep("SERVER_AAL2_CHECK"'));
});

test("MFA v2 renders the actual Supabase QR code and protects the manual key", () => {
  assert.ok(adminHtml.includes('id="adminMfaQrImage"'));
  assert.ok(adminHtml.includes('id="adminMfaSecret"'));
  assert.ok(adminHtml.includes("<summary>Montre kle konfigirasyon manyèl</summary>"));
  assert.ok(adminJs.includes("data?.totp?.qr_code"));
  assert.ok(adminJs.includes('secretNode.dataset.secret = secret'));
});

test("MFA success clears the setup secret and binds the factor ID to the admin identity and project", () => {
  assert.ok(adminJs.includes("clearAdminMfaSetupMaterial();"));
  assert.ok(adminJs.includes('saveAdminMfaFactorBinding(userId, selectedFactorId, "verified"'));
  assert.ok(adminJs.includes("binding.userId !== userId || binding.projectRef !== supabaseProjectRef"));
});


test("primary and backup MFA factors use separate user/project-bound storage slots", () => {
  assert.ok(adminJs.includes('const ADMIN_MFA_BACKUP_FACTOR_STORAGE_KEY = "lakaygopay_admin_mfa_backup_factor_v1";'));
  assert.ok(adminJs.includes("mfaFactorStorageKey(purpose)"));
  assert.ok(adminJs.includes('saveAdminMfaFactorBinding(userId, factorId, "unverified", friendlyName, purpose)'));
  assert.ok(adminJs.includes('readAdminMfaFactorBinding(session.user.id, "primary")'));
  assert.ok(adminJs.includes('readAdminMfaFactorBinding(session.user.id, "backup")'));
  assert.ok(adminJs.includes('const purpose = backup?.factorId === selectedFactorId ? "backup" : "primary"'));
});

test("backup enrollment does not overwrite the primary factor binding", () => {
  const start = adminJs.indexOf("async function enrollAdminMfaBackup()");
  const end = adminJs.indexOf("\nasync function completeTotpVerification", start);
  const block = adminJs.slice(start, end);
  assert.ok(block.includes('readAdminMfaFactorBinding(session.user.id, "primary")'));
  assert.ok(block.includes('readAdminMfaFactorBinding(session.user.id, "backup")'));
  assert.ok(block.includes('renderAdminMfaSetup(data, session.user.id, "backup")'));
});


test("a successfully verified browser is remembered for 30 days by the server", () => {
  assert.ok(adminJs.includes('fetch("/api/admin/mfa/trust"'));
  assert.ok(adminJs.includes('method: "POST"'));
  assert.ok(adminJs.includes('MFA verifye. Aparèy sa a rete rekonèt pandan 30 jou.'));
  assert.ok(adminJs.includes('MFA konfime · Aparèy rekonèt'));
});

test("monthly device trust is honored only while Supabase still reports a verified TOTP factor", () => {
  const start = adminJs.indexOf("async function updateMfaStatus()");
  const end = adminJs.indexOf("\nasync function runAdminMfaDiagnostics()", start);
  const block = adminJs.slice(start, end);
  assert.ok(block.indexOf('const verifiedFactors = totpFactors.filter') < block.indexOf('fetch("/api/admin/mfa/trust"'));
  assert.ok(block.includes('!factorLookupError && verifiedFactors.length > 0'));
});

test("stale local authenticator IDs are never submitted as a TOTP factor", () => {
  const start = adminJs.indexOf("async function verifyAdminMfa()");
  const end = adminJs.indexOf("\nfunction renderAnalyticsBreakdown", start);
  const block = adminJs.slice(start, end);
  assert.ok(block.includes('supabase.auth.mfa.listFactors()'));
  assert.ok(block.includes('usableFactors.find((item) => item.id === selectedId)'));
  assert.ok(block.includes('if (primaryBinding && !factorIds.has(primaryBinding.factorId)) clearAdminMfaFactorBinding("primary")'));
  assert.ok(!block.includes('selectedId || primaryBinding?.factorId'));
});

test("ordinary Admin reads accept a trusted device while high-impact changes demand fresh AAL2", async () => {
  const security = await readFile(new URL("../functions/_shared/security.js", import.meta.url), "utf8");
  assert.ok(security.includes('await requireAdminTrustedAal2(request, env)'));
  assert.ok(security.includes('options?.requireFreshMfa === true'));
  const writeFiles = [
    "../functions/api/admin/agents/review.js",
    "../functions/api/admin/cards/limits.js",
    "../functions/api/admin/connect/apps.js",
    "../functions/api/admin/finance/fees.js",
    "../functions/api/admin/merchants/review.js",
    "../functions/api/admin/secretariat.js",
    "../functions/api/admin/secretariat-access.js",
    "../functions/api/admin/team/roles.js",
    "../functions/api/admin/users/status.js",
    "../functions/api/admin/withdrawals/decision.js"
  ];
  for (const file of writeFiles) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const writeBlocks = source.split("export async function ").slice(1);
    for (const block of writeBlocks) {
      const method = block.slice(0, block.indexOf("("));
      if (method === "onRequestPost" || method === "onRequestPatch") {
        assert.ok(block.includes("{ requireFreshMfa: true }"), file + " " + method);
      }
    }
  }
});

test("Admin TOTP assurance expires after 30 days even when the same session remains open", async () => {
  const security = await readFile(new URL("../functions/_shared/security.js", import.meta.url), "utf8");
  assert.ok(security.includes("const ADMIN_TOTP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000"));
  assert.ok(security.includes("hasRecentAdminTotp(auth.claims)"));
  assert.ok(security.includes('claims.aal === "aal2" && hasRecentAdminTotp(claims)'));
  assert.ok(adminJs.includes("hasRecentAdminTotpSession(session)"));
  assert.ok(adminJs.includes('currentLevel === "aal2" && hasRecentAdminTotpSession(session)'));
});

test("trusted-device records are server-hashed, HttpOnly, Secure, and expire after 30 days", async () => {
  const helper = await readFile(new URL("../functions/_shared/admin-trusted-device.js", import.meta.url), "utf8");
  const migration = await readFile(new URL("../superbase/migrations/202611200001_admin_trusted_devices.sql", import.meta.url), "utf8");
  assert.ok(helper.includes("30 * 24 * 60 * 60 * 1000"));
  assert.ok(helper.includes("HttpOnly; Secure; SameSite=Strict"));
  assert.ok(helper.includes('crypto.subtle.digest("SHA-256"'));
  assert.ok(migration.includes("ENABLE ROW LEVEL SECURITY"));
  assert.ok(migration.includes("REVOKE ALL ON TABLE public.admin_trusted_devices FROM anon, authenticated"));
});
