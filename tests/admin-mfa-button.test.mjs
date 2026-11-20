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
  assert.ok(adminHtml.includes("admin/admin.js?v=20261120-mfa-auth-diagnostic-06"));
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


test("MFA diagnostic is read-only and shows the Production project, session identity, and factor counts", () => {
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
  assert.ok(!block.includes("access_token"));
  assert.ok(!block.includes("totp.secret"));
});

test("MFA enrollment never silently deletes an unverified factor", () => {
  const primaryStart = adminJs.indexOf("async function enrollAdminMfa()");
  const backupStart = adminJs.indexOf("async function enrollAdminMfaBackup()");
  const verifyStart = adminJs.indexOf("async function completeTotpVerification()");
  const primary = adminJs.slice(primaryStart, backupStart);
  const backup = adminJs.slice(backupStart, verifyStart);
  assert.ok(primary.includes('throw new Error("MFA_PENDING_FACTOR_EXISTS")'));
  assert.ok(backup.includes('throw new Error("MFA_PENDING_FACTOR_EXISTS")'));
  assert.ok(!primary.includes("mfa.unenroll"));
  assert.ok(!backup.includes("mfa.unenroll"));
});
