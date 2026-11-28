# Phase 2.2 — Transaction Integrity & Security audit gate

## Scope

Phase 2.2 starts with a read-only Production diagnostic. It does not execute payment/transfer RPCs, create test money, alter rows, change balances, modify schema, or change permissions.

The diagnostic covers:
- financial request and ledger schema fingerprints;
- unique indexes for idempotency and payment-to-ledger linkage;
- duplicate non-empty idempotency keys;
- ledger entry count and debit/credit integrity grouped by transaction status;
- server-side RPC inventory and source indicators for idempotency, locking, identity/service-role checks, and exception handling.

## Run against Production

The owner has explicitly selected the main `lakaygopay-web` Supabase project as the audit target.

1. Open Supabase SQL Editor in the main `lakaygopay-web` project.
2. Open `superbase/tests/phase-2.2-transaction-integrity-readonly.sql` from this branch.
3. Run the complete script once.
4. Share the result sets. If a result set is long, send the rows for sections 2, 3, 4, and 5 first.

The script begins with `BEGIN TRANSACTION READ ONLY` and ends with `ROLLBACK`. It uses catalog reads and SELECT statements only.

## Interpretation

- Section 2: expected unique indexes should be valid and cover the intended idempotency or linkage columns.
- Section 3: expected result is zero rows. A duplicate row needs investigation; do not delete or rewrite it automatically.
- Section 4: posted transactions should have at least two entries and equal debit/credit totals. Pending/failed lifecycle states require separate interpretation.
- Section 5: source indicators are clues only. `mentions_idempotency=false` or `checks_auth_uid=false` is not by itself a vulnerability; the control may live in a server-authorized wrapper or caller. Review the complete relevant function definitions before proposing changes.

## Next gate

After reviewing these results, inspect the exact transfer/payment RPC implementations and their grants, then design deterministic non-money-moving regression tests for:
- same idempotency key + same payload (replay);
- same key + different payload (must reject);
- concurrent duplicate requests (exactly one posting);
- insufficient balance / currency mismatch (no partial posting);
- unauthorized actor or direct internal-RPC invocation (reject);
- rollback on any intermediate failure.

No Production mutation or real payment rail activation is authorized by this audit phase. Keep `paymentsEnabled()` false.
