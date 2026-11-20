import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("Admin mutations require a server-consumed one-use MFA grant", async () => {
  const security = await read("functions/_shared/security.js");
  assert.match(security, /MUTATING_ADMIN_METHODS/);
  assert.match(security, /consumeAdminActionMfaGrant\(request, env, auth\)/);
  assert.match(security, /x-admin-action-mfa-grant/);
  assert.match(security, /consumed_at=is\.null/);
  assert.match(security, /expires_at=gt\./);
});

test("MFA action grants require a recent TOTP authentication method", async () => {
  const route = await read("functions/api/admin/action-mfa/grant.js");
  assert.match(route, /item\?\.method === "totp"/);
  assert.match(route, /MAX_TOTP_AGE_SECONDS/);
  assert.match(route, /proof_fingerprint/);
  assert.match(route, /grant_id/);
  assert.match(route, /GRANT_TTL_MS/);
});

test("MFA grants are private, short-lived, and bound to one access-token proof", async () => {
  const migration = await read("superbase/migrations/202611200001_admin_action_mfa_grants.sql");
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all .*anon, authenticated/i);
  assert.match(migration, /grant all .*service_role/i);
  assert.match(migration, /proof_fingerprint text not null unique/i);
  assert.match(migration, /consumed_at timestamptz/i);
  assert.match(migration, /expires_at timestamptz/i);
});

test("Admin UI asks for a new TOTP code before each mutation and binds the exact request body", async () => {
  const client = await read("public/admin/admin.js");
  assert.match(client, /requestAdminActionMfaGrant\(session, actionKey\)/);
  assert.match(client, /window\.prompt\(/);
  assert.match(client, /x-admin-action-mfa-grant/);
  assert.match(client, /createAdminActionKey\(path, requestMethod, bodyText\)/);
  assert.match(client, /!pathname\.startsWith\("\/api\/admin\/pin\/"\)/);
});
