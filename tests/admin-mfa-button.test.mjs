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
  assert.ok(adminHtml.includes("admin/admin.js?v=20261120-mfa-flow-v2-07"));
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
