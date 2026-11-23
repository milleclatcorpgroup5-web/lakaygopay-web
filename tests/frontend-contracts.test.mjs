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
  const missing = selectors.filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], name + " JavaScript selectors must exist in HTML");

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
