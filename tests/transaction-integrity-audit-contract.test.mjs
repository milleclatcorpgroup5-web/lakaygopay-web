import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../superbase/tests/phase-2.2-transaction-integrity-readonly.sql", import.meta.url),
  "utf8"
);

test("Phase 2.2 Production transaction diagnostic is read-only", () => {
  assert.match(sql, /^begin transaction read only;/im);
  assert.match(sql, /^rollback;\s*$/im);
  assert.match(sql, /duplicate non-empty idempotency/i);
  assert.match(sql, /advisory_xact_lock/i);
  assert.match(sql, /unbalanced_transactions/i);
  const executableLines = sql
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
  assert.doesNotMatch(
    executableLines,
    /^\s*(insert|update|delete|truncate|alter|create|drop|grant|revoke|call|do)\b/im
  );
});
