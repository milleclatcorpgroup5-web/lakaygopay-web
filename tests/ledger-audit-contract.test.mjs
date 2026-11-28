import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../superbase/tests/phase-2.1-ledger-integrity-readonly.sql", import.meta.url),
  "utf8"
);

test("Phase 2.1 ledger diagnostic is explicitly read-only", () => {
  assert.match(sql, /^begin transaction read only;/im);
  assert.match(sql, /^rollback;\s*$/im);
  assert.match(sql, /public\.ledger_entries le on le\.transaction_id = lt\.id/i);
  assert.match(sql, /public\.ledger_entries le on le\.account_id = la\.id/i);
  assert.match(sql, /debit_total/i);
  assert.match(sql, /derived_ledger_balance/i);
  assert.match(sql, /idempotency_key/i);

  const executableLines = sql
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
  assert.doesNotMatch(
    executableLines,
    /^\s*(insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/im
  );
});
