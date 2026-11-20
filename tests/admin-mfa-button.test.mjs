import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const adminJs = await readFile(new URL("../public/admin/admin.js", import.meta.url), "utf8");
const adminHtml = await readFile(new URL("../public/admin/index.html", import.meta.url), "utf8");

test("an already AAL2 session can still challenge a verified TOTP factor again", () => {
  assert.match(adminJs, /mfaCanVerify = totpFactors\.some\(\(factor\) =>\s*factor\.status === "verified" \|\| factor\.status === "unverified"\s*\)/);
  assert.match(adminJs, /textContent = aal2 \? "Verifye ankò" : "Verifye MFA"/);
  assert.doesNotMatch(adminJs, /mfaCanVerify = totpFactors\.length > 0 && !\(aal2 && !hasPendingFactor\)/);
});

test("initial MFA state errors are visible to the Admin user", () => {
  assert.match(adminJs, /catch \(mfaError\) \{\s*setNotice\("#adminMfaStatus", explainMfaError\(mfaError\), "error"\)/);
});

test("Admin page loads the new MFA control logic without stale cache", () => {
  assert.match(adminHtml, /admin\/admin\.js\?v=20261120-mfa-enabled-03/);
});
