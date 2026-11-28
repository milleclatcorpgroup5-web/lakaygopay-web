# Phase 2.1 — Core Financial Ledger audit gate

## Scope

This is the first implementation deliverable for Phase 2.1. It deliberately does **not** change Production data, balances, ledger rows, permissions, or schema. The current Production ledger model is the one used by the Production-safe QR migration:

- `wallets` and `wallet_balances`
- `ledger_accounts`
- `ledger_transactions`
- `ledger_entries(transaction_id, account_id, direction, amount, currency)`
- `post_ledger_transaction(uuid)`

The older development migrations also contain a different ledger shape (`ledger_entries.ledger_transaction_id/wallet_id`). Do not apply a migration written for that older shape to Production.

## Run the diagnostic

1. Open the Supabase SQL Editor for the **TEST** project first.
2. Open `superbase/tests/phase-2.1-ledger-integrity-readonly.sql`.
3. Run the complete script.
4. Save the result sets and share them for review.
5. Repeat against Production only as a read-only check after TEST output is understood.

The script starts a read-only transaction and ends with `ROLLBACK`. It contains catalog reads and SELECT statements only.

## What must be verified

| Check | Expected result |
|---|---|
| Schema fingerprint | All five core relations and `post_ledger_transaction(uuid)` exist |
| Double-entry balance | No transaction has fewer than two entries or debit total different from credit total |
| Currency consistency | No entry/account/transaction currency mismatch |
| Wallet account mapping | Exactly one non-system liability account per wallet/currency |
| Balance reconciliation | Stored `wallet_balances.balance` equals credit-minus-debit ledger balance |
| Negative balances | No negative customer/merchant wallet |
| Idempotency | No duplicate non-empty transaction idempotency key |
| Posting function | Owner and SECURITY DEFINER configuration match the approved server-side design |

Pending transaction states are reported for lifecycle review; they are not automatically treated as errors by this diagnostic.

## Why no Production migration is included yet

The repository has two materially different ledger schemas: the early development model and the later Production model. The Production QR path also updates `wallet_balances` and calls `post_ledger_transaction` within the same database transaction. Applying a generic trigger or rebuilding balances before confirming the live schema, posting function, and historical data could double-apply balances or block legitimate posting.

After the diagnostic results are reviewed, the next change will be a narrowly scoped, additive hardening migration for the **confirmed Production schema**, with preflight checks and rollback-safe tests. It must preserve the existing balance source of truth and existing payment/transfer safeguards.

## Safety boundary

- Do not seed balances or create test money in Production.
- Do not enable Visa/Mastercard, external deposits, withdrawals, FX, card issuance, or real-money settlement.
- No client-side balance writes.
- No manual balance correction. Corrections must use a separately authorized, audited ledger transaction.
- A posted transaction is immutable; corrections use compensating/reversal entries, never edits to historical entries.

PostgreSQL supports deferred constraint triggers for checks that must see the completed transaction at commit. Their timing and behavior must be designed against the actual Production posting flow, not copied from the older development schema. See the official [PostgreSQL trigger documentation](https://www.postgresql.org/docs/current/trigger-definition.html) and [constraint timing documentation](https://www.postgresql.org/docs/current/sql-set-constraints.html).
