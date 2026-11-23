# LakayGoPay — Production transfer and personal receive rollout

## Current implementation

This document describes the current code in `main`, not the older direct-RPC design.

- `POST /api/transfers` validates the session and active account, checks the four-digit transaction PIN on the server, then calls `transfer_funds_server_authorized` with the server-only Supabase secret.
- `POST /api/transfets` is a backwards-compatible alias to the same secured handler.
- `transfer_funds_server_authorized` accepts calls only from `service_role`, checks the actor is active, sets the actor claim for the underlying `auth.uid()` check, and invokes the existing `transfer_funds` financial engine.
- Direct execution of `transfer_funds` by `authenticated` is not permitted after the security migration. The browser never receives the service key.
- Personal receive creation and lookup use the signed-in user's JWT. Personal receive payment checks the sender's PIN in Cloudflare before calling `pay_personal_receive_request_server_authorized`.
- Personal receive QR requests expire after 15–30 minutes, are single-use, and do not move funds at creation time. Payment reuses the existing atomic transfer and double-entry ledger engine.

## Required Production migration

The current Production database inspection found that `transfer_funds` exists as a SECURITY DEFINER function, but authenticated users can execute it directly, while the server-authorized wrappers and personal receive objects are absent.

The repository migration that closes this gap and creates the personal receive system is:

`superbase/migrations/202611210003_personal_receive_qr.sql`

It creates `personal_receive_requests`, the create/lookup/pay RPCs, the server-authorized transfer and receive-payment wrappers, and removes direct client execution from the underlying financial functions.

### Before execution

1. Confirm the Supabase project reference is the intended LakayGoPay Production project.
2. Confirm `personal_receive_requests` and the four receive/wrapper functions are not already installed.
3. Confirm `public.transfer_funds(uuid,uuid,numeric,text,text)` exists, is owned by `postgres`, and is SECURITY DEFINER. This is a precondition checked by the migration.
4. Do not run an older foundation migration or reset/recreate wallets, ledger entries, or balances.

### Execute

Run the full contents of `superbase/migrations/202611210003_personal_receive_qr.sql` once in Supabase SQL Editor. It is transactional. If it reports any error, stop and inspect the exact error; do not continue with a partial or improvised SQL fragment.

Do not separately run `202611210004_server_authorized_financial_rpcs.sql` after `202611210003`. The server-authorized wrappers and revokes from `210004` are already included in `210003`; the later file is overlapping, not an additional prerequisite.

## Read-only verification after migration

Run:

```sql
select
  to_regclass('public.personal_receive_requests') as receive_table,
  has_function_privilege(
    'authenticated',
    'public.transfer_funds(uuid,uuid,numeric,text,text)',
    'EXECUTE'
  ) as authenticated_can_call_transfer_directly,
  has_function_privilege(
    'service_role',
    'public.transfer_funds_server_authorized(uuid,uuid,uuid,numeric,text,text)',
    'EXECUTE'
  ) as service_role_can_call_transfer_wrapper,
  has_function_privilege(
    'authenticated',
    'public.pay_personal_receive_request(uuid,uuid,numeric,text)',
    'EXECUTE'
  ) as authenticated_can_call_receive_payment_directly,
  has_function_privilege(
    'service_role',
    'public.pay_personal_receive_request_server_authorized(uuid,uuid,uuid,numeric,text)',
    'EXECUTE'
  ) as service_role_can_call_receive_payment_wrapper;
```

Expected:
- `receive_table` is `personal_receive_requests`.
- `authenticated_can_call_transfer_directly = false`.
- `service_role_can_call_transfer_wrapper = true`.
- `authenticated_can_call_receive_payment_directly = false`.
- `service_role_can_call_receive_payment_wrapper = true`.

The direct financial functions remain internal implementation details. Do not grant their EXECUTE privilege back to `authenticated`, `anon`, or `PUBLIC`.

## Application and QA sequence

1. Deploy the reviewed Git branch to a Cloudflare Pages Preview environment, not Production.
2. Confirm the Preview has `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` configured as server-side bindings. Never expose the secret in browser code.
3. Create two controlled customer test accounts with transaction PINs.
4. Confirm each has an active personal wallet in the same currency. Do not add test credits to a Production wallet.
5. Create a personal receive QR with a fixed amount and with an open amount. Creating a QR must not change any balance or ledger entry.
6. Look up the QR from the second account. Confirm the recipient name, masked phone, amount, currency, and expiry are correct.
7. Attempt payment with a missing or incorrect PIN. No transfer or ledger entry may be created.
8. In an isolated test environment with approved test balances, pay with the correct PIN. Verify one posted transfer, balanced debit/credit entries, one paid receive request, and matching receipts/history.
9. Retry the same request with the same idempotency key and payload. It must not debit or credit a second time. A different payload with the same key must fail.
10. Confirm expired and already-paid receive IDs cannot be reused.
11. Test the regular `/api/transfers` and legacy `/api/transfets` paths with missing, incorrect, locked, and correct PINs.
12. Only after Preview, SQL verification, and controlled QA pass should the change be approved for Production merge/deployment.

## Existing safeguards that remain disabled

- External deposits and withdrawals.
- MonCash, NatCash, bank settlement, and agent cash-in/cash-out.
- Card issuance and card payments.
- Real FX settlement.

This migration does not activate external rails, credit any wallet, reset balances, rewrite historical ledger entries, or move funds by creating a QR request.
