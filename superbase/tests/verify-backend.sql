-- Read-only checks. Run in Supabase SQL Editor on the TEST project after both
-- migrations have been applied. This script does not create users or move funds.

-- 1. Required objects exist.
select 'required_table' as check_type, name as object_name,
       to_regclass('public.' || name) is not null as passed
from (values
  ('profiles'), ('wallets'), ('wallet_balances'), ('ledger_transactions'),
  ('ledger_entries'), ('transfers'), ('merchants'), ('payment_requests'),
  ('merchant_payment_records'), ('withdrawal_requests'), ('withdrawal_approvals'),
  ('idempotency_keys'), ('notifications'), ('audit_logs')
) objects(name);

-- 2. RLS is enabled on every sensitive table.
select 'rls_enabled' as check_type, c.relname as object_name, c.relrowsecurity as passed
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles','user_roles','merchants','merchant_members','wallets',
    'ledger_transactions','ledger_entries','transfers','idempotency_keys','deposit_requests',
    'withdrawal_requests','withdrawal_approvals','payment_requests','merchant_payment_records',
    'otp_challenges','security_events','notifications','audit_logs')
order by c.relname;

-- 3. Immutable-ledger triggers are present.
select 'append_only_trigger' as check_type, tgname as object_name, not t.tgisinternal as passed
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('ledger_entries','ledger_transactions')
  and tgname in ('ledger_entries_no_update_delete','ledger_transactions_no_update_delete')
order by tgname;

-- 4. Existing journal entries must balance; this query should return ZERO rows.
select lt.id as unbalanced_transaction_id,
       count(le.id) as entry_count,
       coalesce(sum(le.amount) filter (where le.direction = 'debit'),0) as debits,
       coalesce(sum(le.amount) filter (where le.direction = 'credit'),0) as credits
from public.ledger_transactions lt
left join public.ledger_entries le on le.ledger_transaction_id = lt.id
group by lt.id
having count(le.id) < 2
   or coalesce(sum(le.amount) filter (where le.direction = 'debit'),0)
      <> coalesce(sum(le.amount) filter (where le.direction = 'credit'),0);

-- 5. No wallet should have negative balance or an over-reserved withdrawal amount.
select wallet_id, balance
from public.wallet_balances
where balance < 0;

select w.id as wallet_id,
       coalesce(bal.balance,0) as ledger_balance,
       coalesce(res.reserved,0) as reserved_withdrawals
from public.wallets w
left join lateral (
  select coalesce(sum(case when le.direction='credit' then le.amount else -le.amount end),0) balance
  from public.ledger_entries le where le.wallet_id = w.id
) bal on true
left join lateral (
  select coalesce(sum(wr.amount),0) reserved
  from public.withdrawal_requests wr where wr.wallet_id=w.id
    and wr.status in ('submitted','awaiting_second_approval','approved','processing')
) res on true
where w.is_system = false
  and coalesce(bal.balance,0) - coalesce(res.reserved,0) < 0;

-- 6. Financial RPC functions must not be executable by anon/authenticated.
select p.proname as function_name,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('post_wallet_transfer','create_withdrawal_request',
    'pay_merchant_payment_request','record_withdrawal_approval','set_merchant_status',
    'run_ledger_integrity_check','get_payment_request_details','is_admin_user','create_test_credit')
order by p.proname;

-- 7. Test funding must be OFF unless an operator explicitly enables it in a TEST project.
select setting_key, setting_value
from public.platform_settings
where setting_key = 'test_mode_enabled';
