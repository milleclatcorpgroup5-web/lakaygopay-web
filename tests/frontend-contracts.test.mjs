import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function assertFrontendContracts(name, htmlPath, scriptPath) {
  const html = read(htmlPath);
  const script = read(scriptPath);
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const selectors = [...new Set([...script.matchAll(/\$\(["']#([^"']+)["']\)/g)]
    .map((match) => match[1]))];
  const dynamicIds = new Set([...script.matchAll(/\\.id\\s*=\\s*["']([^"']+)["']/g)]
    .map((match) => match[1]));
  const missing = selectors.filter((id) => !ids.has(id) && !dynamicIds.has(id));
  assert.deepEqual(missing, [], name + " JavaScript selectors must exist in HTML or be created by the script");

  const forms = [...html.matchAll(/<form\b[^>]*id="([^"]+)"/g)].map((match) => match[1]);
  const submitHandlers = new Set([...script.matchAll(
    /\$\(["']#([^"']+)["']\)\.addEventListener\(["']submit["']/g
  )].map((match) => match[1]));
  const unhandled = forms.filter((id) => !submitHandlers.has(id));
  assert.deepEqual(unhandled, [], name + " forms must have submit handlers");
}

test("customer application selectors and forms match the HTML", () => {
  assertFrontendContracts("Customer app", "../public/index.html", "../public/app.js");
});

test("admin application selectors and forms match the HTML", () => {
  assertFrontendContracts("Admin app", "../public/admin/index.html", "../public/admin/admin.js");
});


test("QR rendering has primary and fallback encoders and validates the generated image", () => {
  const script = read("../public/app.js");
  assert.match(script, /https:\/\/esm\.sh\/qrcode@1\.5\.4/);
  assert.match(script, /https:\/\/cdn\.jsdelivr\.net\/npm\/qrcode@1\.5\.4\/\+esm/);
  assert.match(script, /errorCorrectionLevel:\s*"M"/);
  assert.match(script, /target\.decode\(\)/);
  assert.match(script, /link\.searchParams\.set\("lgp_qr",\s*token\)/);
  assert.match(script, /link\.searchParams\.set\("lgp_receive",\s*request\.qr_token\)/);
});


test("customer and merchant areas are separate role workspaces with customer actions prioritized", () => {
  const script = read("../public/app.js");
  const html = read("../public/index.html");
  assert.ok(script.includes("function buildRoleWorkspaces()"));
  assert.ok(script.indexOf("buildRoleWorkspaces();") < script.indexOf("wireForms();"));
  assert.ok(script.includes('const merchantWorkspace = document.createElement("section")'));
  assert.ok(script.includes('backButton.id = "clientQuickLink"'));
  assert.ok(script.includes('if (workspace) workspace.hidden = !isMerchant;'));
  for (const id of ["walletSection", "transferSection", "personalReceiveSection", "personalReceiveLookupSection", "qrPaymentSection", "exchangeQuoteSection", "activitySection"]) {
    assert.ok(script.includes('["' + id + '"'), "Customer priority should include " + id);
  }
  assert.ok(html.includes('id="merchantQuickLink"'));
});

test("admin navigation groups existing modules without removing their permission-gated panels", () => {
  const script = read("../public/admin/admin.js");
  const html = read("../public/admin/index.html");
  for (const id of ["adminGroupOverview", "adminGroupOperations", "adminGroupFinance", "adminGroupSecurity", "adminGroupTeam"]) {
    assert.ok(script.includes(id), "Admin category missing: " + id);
    assert.ok(html.includes('href="#' + id + '"'), "Admin category link missing: " + id);
  }
  for (const id of ["adminMfaPanel", "adminFinancePanel", "adminTeamPanel", "adminSecretariatPanel", "systemHealthPanel", "liveLogsPanel"]) {
    assert.ok(html.includes('id="' + id + '"'), "Existing protected module missing: " + id);
  }
  assert.ok(script.includes('nav.addEventListener("click"'));
});
