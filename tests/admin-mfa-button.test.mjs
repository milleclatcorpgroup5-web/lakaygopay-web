import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const adminJs = await readFile(new URL("../public/admin/admin.js", import.meta.url), "utf8");
const adminHtml = await readFile(new URL("../public/admin/index.html", import.meta.url), "utf8");

test("an already AAL2 session can still challenge a verified TOTP factor again", () => {
  assert.match(adminJs, /mfaCanVerify = totpFactors\\.some\\(\\(factor\\) =>\\s*factor\\.status === "verified" \\|\\| factor\\.status === "unverified"\\s*\\)/);
  assert.match(adminJs, /textContent = aal2 \\? "Verifye ankò" : "Verifye MFA"/);
  assert.doesNotMatch(adminJs, /mfaCanVerify = totpFactors\\.length > 0 && !\\(aal2 && !hasPendingFactor\\)/);
});

test("initial MFA state errors are visible to the Admin user", () => {
  assert.match(adminJs, /catch \\(mfaError\\) \\{\\s*setNotice\\("#adminMfaStatus", explainMfaError\\(mfaError\\), "error"\\)/);
});

test("Admin page loads the new MFA control logic without stale cache", () => {
  assert.match(adminHtml, /admin\\/admin\\.js\\?v=20261120-mfa-form-fallback-04/);
});

test("the MFA verify control remains usable when factor discovery temporarily fails", () => {
  const syncStart = adminJs.indexOf("function syncMfaVerifyButton()");
  const syncEnd = adminJs.indexOf("\\nasync function updateMfaStatus()", syncStart);
  const syncBlock = adminJs.slice(syncStart, syncEnd);
  assert.ok(syncBlock.includes('button.disabled = !/^\\\\d{6}$/.test(code) || button.dataset.verifying === "true";'));
  assert.ok(!syncBlock.includes("!mfaCanVerify"));
});

test("MFA verification uses a submit form and strips non-numeric input", () => {
  assert.match(adminHtml, /<form id="adminMfaVerifyForm"/);
  assert.match(adminHtml, /id="adminMfaVerifyButton"[^>]*type="submit"/);
  assert.match(adminJs, /\\$\\("#adminMfaVerifyForm"\\)\\.addEventListener\\("submit"/);
  assert.ok(adminJs.includes('event.currentTarget.value = event.currentTarget.value.replace(/\\\\D/g, "").slice(0, 6);'));
});
