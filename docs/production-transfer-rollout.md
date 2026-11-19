# LakayGoPay — Production transfer correction

## Scope

This branch targets the existing Production Supabase project and the Cloudflare
Pages backend. It does not reset wallets, alter historical balances, change
existing ledger entries, or activate external payment rails.

The Production `public.transfer_funds(uuid, uuid, numeric, text, text)`
function is retained. Its reviewed responsibilities include user ownership
checks through `auth.uid()`, idempotency locking, deterministic wallet locks,
balanced debit/credit entries, wallet balance updates, and final ledger posting.

## Code changes

- `/api/transfers` now calls `transfer_funds` with the access token that was
  validated by `requireUser`.
- The transfer RPC no longer receives the service-role credential and no longer
  calls the incompatible legacy `post_wallet_transfer` function.
- The server-side four-digit PIN check remains mandatory for every request.
- `/api/transfets` delegates to the same secured handler; it cannot skip PIN
  verification or use the obsolete helper.
- The backend requires an idempotency key and validates the RPC result is
  actually posted before returning success.

## Production database migration

Review and apply
`superbase/migrations/202611190003_production_transfer_rpc_audit.sql`
in the Production Supabase SQL Editor.

It grants `EXECUTE` on `transfer_funds` only to `authenticated`, removes it
from `PUBLIC`, `anon`, and `service_role`, and adds a database trigger that
writes `transfer.created` and `transfer.posted` events to `audit_logs`.
The trigger gets the actor from the ledger transaction. If audit insertion
fails, the money movement transaction fails too.

This migration does not recreate or replace `transfer_funds`; it must not be
replaced with the older repository migrations that define the incompatible
`post_wallet_transfer` implementation.

## Validation sequence

1. Run the migration above in Production.
2. Run the read-only checks in `docs/production-transfer-verification.sql`.
   Expected: authenticated can execute=true; anon and service_role=false;
   no unbalanced posted journals; no wallet/ledger balance drift.
3. Run the application tests:
   `node --experimental-default-type=module --test tests/transfers.test.mjs`.
4. Deploy this branch to a Cloudflare Pages Preview environment configured with
   the Production Supabase URL and the same required bindings. Keep the service
   key in Cloudflare server-side environment variables only.
5. Test with two controlled Production customer accounts and small amounts.
   Confirm the sender debit, recipient credit, matching ledger entries,
   `posted` status, and the two audit events.
6. Retry the exact same idempotency key and identical transfer request. It must
   return the existing transfer with `idempotent_replay=true`, with no second
   debit or credit. Reusing the key with different parameters must fail.
7. Confirm the duplicate `/api/transfets` route also requires the correct PIN.
8. Only after all checks pass, merge/deploy the validated revision to the
   Cloudflare Pages Production branch.

Historical transfers created before the audit trigger are not automatically
backfilled. The trigger guarantees audit records for new transfers and status
changes from the time the migration is applied.

## Cloudflare bindings

The Pages Functions require these server-side bindings:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (or the existing `SUPABASE_ANON_KEY`)
- `SUPABASE_SECRET_KEY` (or the existing `SUPABASE_SERVICE_ROLE_KEY`)

Never place the secret/service-role key in browser code or public build output.
External cash-in/cash-out integrations remain disabled.
