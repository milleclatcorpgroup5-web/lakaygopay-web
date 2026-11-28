-- LakayGoPay Phase 2.1 — READ-ONLY Core Financial Ledger diagnostic.
-- Target: the Production ledger shape verified by 202611220001_merchant_qr_production_safe.sql.
-- This script performs SELECT/catalog reads only. It does not mutate data or schema.
-- Run in Supabase SQL Editor. Review every non-zero exception before any hardening migration.

begin transaction read only;

-- 1) Schema fingerprint: confirms the expected wallet/account/ledger model is present.
select
  to_regclass('public.wallets') as wallets_table,
  to_regclass('public.wallet_balances') as wallet_balances_relation,
  to_regclass('public.ledger_accounts') as ledger_accounts_table,
  to_regclass('public.ledger_transactions') as ledger_transactions_table,
  to_regclass('public.ledger_entries') as ledger_entries_table,
  to_regprocedure('public.post_ledger_transaction(uuid)') as post_ledger_transaction_rpc;

-- 2) Transaction-level double-entry integrity.
-- Every transaction must have at least two entries and debit = credit per currency.
select
  lt.id as transaction_id,
  lt.status,
  lt.currency as transaction_currency,
  count(le.id) as entry_count,
  coalesce(sum(le.amount) filter (where le.direction = 'debit'), 0) as debit_total,
  coalesce(sum(le.amount) filter (where le.direction = 'credit'), 0) as credit_total
from public.ledger_transactions lt
left join public.ledger_entries le on le.transaction_id = lt.id
group by lt.id, lt.status, lt.currency
having count(le.id) < 2
    or coalesce(sum(le.amount) filter (where le.direction = 'debit'), 0)
       <> coalesce(sum(le.amount) filter (where le.direction = 'credit'), 0)
order by lt.id;

-- 3) Entries whose currency differs from either their ledger account or transaction.
select
  le.id as ledger_entry_id,
  le.transaction_id,
  le.account_id,
  le.currency as entry_currency,
  la.currency as account_currency,
  lt.currency as transaction_currency
from public.ledger_entries le
join public.ledger_accounts la on la.id = le.account_id
join public.ledger_transactions lt on lt.id = le.transaction_id
where le.currency is distinct from la.currency
   or le.currency is distinct from lt.currency
order by le.transaction_id, le.id;

-- 4) Customer/merchant wallet accounts: exactly one non-system liability account
-- should exist for each wallet and currency.
select
  w.id as wallet_id,
  w.currency,
  count(la.id) as liability_account_count,
  array_agg(la.id) filter (where la.id is not null) as account_ids
from public.wallets w
left join public.ledger_accounts la
  on la.wallet_id = w.id
 and la.currency = w.currency
 and la.account_type = 'liability'
 and la.is_system = false
group by w.id, w.currency
having count(la.id) <> 1
order by w.id;

-- 5) Wallet balance reconciliation.
-- For customer/merchant liability accounts, credits increase the wallet and debits decrease it.
with ledger_wallet_totals as (
  select
    la.wallet_id,
    la.currency,
    count(distinct la.id) as account_count,
    coalesce(sum(case
      when le.direction = 'credit' then le.amount
      when le.direction = 'debit' then -le.amount
      else 0
    end), 0)::numeric(20,2) as ledger_balance
  from public.ledger_accounts la
  left join public.ledger_entries le on le.account_id = la.id
  where la.account_type = 'liability'
    and la.is_system = false
  group by la.wallet_id, la.currency
)
select
  wb.wallet_id,
  wb.currency,
  wb.balance as stored_wallet_balance,
  coalesce(lwt.ledger_balance, 0)::numeric(20,2) as derived_ledger_balance,
  coalesce(lwt.account_count, 0) as liability_account_count,
  (wb.balance - coalesce(lwt.ledger_balance, 0))::numeric(20,2) as difference
from public.wallet_balances wb
left join ledger_wallet_totals lwt
  on lwt.wallet_id = wb.wallet_id
 and lwt.currency = wb.currency
where wb.balance is distinct from coalesce(lwt.ledger_balance, 0)::numeric(20,2)
order by wb.wallet_id;

-- 6) Negative customer/merchant wallet balances.
select wallet_id, owner_user_id, merchant_id, currency, balance
from public.wallet_balances
where balance < 0
order by currency, balance;

-- 7) Transaction states and counts. Pending rows are reported, not automatically classified
-- as errors; their lifecycle must be checked against the posting function.
select status, currency, count(*) as transaction_count
from public.ledger_transactions
group by status, currency
order by status, currency;

-- 8) Duplicate non-empty idempotency keys, if historical schema permits them.
select idempotency_key, count(*) as transaction_count,
       array_agg(id order by id) as transaction_ids
from public.ledger_transactions
where nullif(btrim(idempotency_key), '') is not null
group by idempotency_key
having count(*) > 1
order by count(*) desc, idempotency_key;

-- 9) Ledger account / wallet metadata mismatches.
select
  la.id as ledger_account_id,
  la.wallet_id,
  la.currency as account_currency,
  w.currency as wallet_currency,
  la.account_type,
  la.is_system
from public.ledger_accounts la
left join public.wallets w on w.id = la.wallet_id
where w.id is null
   or la.currency is distinct from w.currency
order by la.id;

-- 10) Posting function ownership and SECURITY DEFINER status.
select
  p.oid::regprocedure as function_signature,
  pg_get_userbyid(p.proowner) as function_owner,
  p.prosecdef as is_security_definer,
  p.proconfig as function_settings
from pg_proc p
where p.oid = to_regprocedure('public.post_ledger_transaction(uuid)');

rollback;
