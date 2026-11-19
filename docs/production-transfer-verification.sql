-- LakayGoPay Production transfer verification (READ-ONLY).
-- Run after applying 202611190003_production_transfer_rpc_audit.sql.
-- These queries do not update balances, ledger entries, transfers or audit logs.

-- 1) RPC execution rights: expected authenticated=true, anon=false,
-- service_role=false.
select
  has_function_privilege(
    'authenticated',
    'public.transfer_funds(uuid,uuid,numeric,text,text)',
    'EXECUTE'
  ) as authenticated_can_execute,
  has_function_privilege(
    'anon',
    'public.transfer_funds(uuid,uuid,numeric,text,text)',
    'EXECUTE'
  ) as anon_can_execute,
  has_function_privilege(
    'service_role',
    'public.transfer_funds(uuid,uuid,numeric,text,text)',
    'EXECUTE'
  ) as service_role_can_execute;

-- 2) The transfer audit trigger must exist and listen to INSERT/status updates.
select
  t.tgname,
  pg_get_triggerdef(t.oid, true) as trigger_definition
from pg_trigger t
where t.tgrelid = 'public.transfers'::regclass
  and t.tgname = 'transfers_audit_event'
  and not t.tgisinternal;

-- 3) Posted ledger transactions must have at least two entries and equal
-- total debits/credits. Expected result: zero rows.
select
  lt.id as ledger_transaction_id,
  lt.status,
  lt.currency,
  count(le.id) as entry_count,
  coalesce(sum(le.amount) filter (where le.direction = 'debit'), 0) as total_debits,
  coalesce(sum(le.amount) filter (where le.direction = 'credit'), 0) as total_credits
from public.ledger_transactions lt
left join public.ledger_entries le on le.transaction_id = lt.id
where lt.status = 'posted'
group by lt.id, lt.status, lt.currency
having count(le.id) < 2
    or coalesce(sum(le.amount) filter (where le.direction = 'debit'), 0)
       <> coalesce(sum(le.amount) filter (where le.direction = 'credit'), 0);

-- 4) Wallet balance cache must equal the balance derived from liability
-- ledger accounts. Expected result: zero rows.
select
  w.id as wallet_id,
  w.currency,
  wb.balance as wallet_balance,
  coalesce(
    sum(case when le.direction = 'credit' then le.amount else -le.amount end),
    0
  )::numeric(20,2) as ledger_balance
from public.wallets w
join public.wallet_balances wb on wb.wallet_id = w.id
left join public.ledger_accounts la
  on la.wallet_id = w.id
 and la.currency = w.currency
 and la.account_type = 'liability'
left join public.ledger_entries le on le.account_id = la.id
group by w.id, w.currency, wb.balance
having wb.balance is distinct from coalesce(
  sum(case when le.direction = 'credit' then le.amount else -le.amount end),
  0
)::numeric(20,2);

-- 5) Latest transfers must be posted and have both creation and posting audit
-- events. Run after a controlled test transfer. This is forward-looking:
-- historical transfers created before the audit trigger are not backfilled.
select
  tr.id as transfer_id,
  tr.status,
  tr.created_at,
  count(*) filter (where al.action = 'transfer.created') as created_audit_events,
  count(*) filter (where al.action = 'transfer.posted') as posted_audit_events
from public.transfers tr
left join public.audit_logs al
  on al.resource_type = 'transfer'
 and al.resource_id = tr.id
where tr.created_at >= now() - interval '24 hours'
group by tr.id, tr.status, tr.created_at
having count(*) filter (where al.action = 'transfer.created') = 0
    or (tr.status = 'posted'
        and count(*) filter (where al.action = 'transfer.posted') = 0);

-- 6) Duplicate idempotency keys should not exist. Expected result: zero rows.
select idempotency_key, count(*) as occurrences
from public.transfers
group by idempotency_key
having count(*) > 1;

-- 7) Recent transfer-to-ledger mapping: inspect successful status and journal
-- linkage for the latest 20 Production transfers.
select
  tr.id as transfer_id,
  tr.status as transfer_status,
  tr.amount,
  tr.currency,
  tr.ledger_transaction_id,
  lt.status as ledger_status,
  lt.actor_user_id,
  tr.created_at
from public.transfers tr
join public.ledger_transactions lt on lt.id = tr.ledger_transaction_id
order by tr.created_at desc
limit 20;
