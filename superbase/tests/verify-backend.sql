-- Read-only release checks. Run in the Supabase TEST project after applying
-- the database migrations in order. This script creates no users and moves no funds.

-- 1. Required objects exist. payment_requests may be the compatibility view
-- mapped to merchant_payment_requests on the currently deployed schema.
select 'required_relation' as check_type, name as object_name,
       to_regclass('public.' || name) is not null as passed
from (values
  ('profiles'), ('user_roles'), ('wallets'), ('wallet_balances'),
  ('ledger_transactions'), ('ledger_entries'), ('transfers'), ('merchants'),
  ('payment_requests'), ('merchant_payment_records'),
  ('withdrawal_requests'), ('withdrawal_approvals'), ('idempotency_keys'),
  ('notifications'), ('audit_logs'), ('user_security'), ('admin_security')
) objects(name);

-- QR storage can be either the original payment_requests table or the
-- compatibility view backed by merchant_payment_requests.
select 'qr_request_storage' as check_type,
       (to_regclass('public.payment_requests') is not null
        and (to_regclass('public.merchant_payment_requests') is not null
             or exists (
               select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                where n.nspname='public' and c.relname='payment_requests' and c.relkind='r'
             ))) as passed;

-- 2. RLS must be enabled on sensitive BASE TABLES.
-- payment_requests is intentionally omitted here because it can be a simple
-- compatibility view; check its backing table (payment_requests or
-- merchant_payment_requests) instead.
select 'rls_enabled' as check_type, c.relname as object_name, c.relrowsecurity as passed
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'profiles','user_roles','merchants','merchant_members','wallets',
    'ledger_transactions','ledger_entries','transfers','idempotency_keys',
    'deposit_requests','withdrawal_requests','withdrawal_approvals',
    'payment_requests','merchant_payment_requests','merchant_payment_records','otp_challenges',
    'security_events','notifications','audit_logs','user_security','admin_security'
  )
order by c.relname;

-- 3. Ledger, merchant payment records and audit records must have append-only
-- protections where applicable.
select 'append_only_trigger' as check_type, c.relname as table_name,
       t.tgname as trigger_name, not t.tgisinternal as passed
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (
    (c.relname = 'ledger_entries' and t.tgname = 'ledger_entries_no_update_delete')
    or (c.relname = 'ledger_transactions' and t.tgname = 'ledger_transactions_no_update_delete')
    or (c.relname = 'merchant_payment_records' and t.tgname = 'merchant_payment_records_no_update_delete')
    or (c.relname = 'audit_logs' and t.tgname = 'audit_logs_no_update_delete')
  )
order by c.relname, t.tgname;

-- 4. Existing journal entries must balance; this query should return ZERO rows.
select lt.id as unbalanced_transaction_id,
       count(le.id) as entry_count,
       coalesce(sum(le.amount) filter (where le.direction = 'debit'),0) as debits,
       coalesce(sum(le.amount) filter (where le.direction = 'credit'),0) as credits
from public.ledger_transactions lt
left join public.ledger_entries le on le.transaction_id = lt.id
group by lt.id
having count(le.id) < 2
   or coalesce(sum(le.amount) filter (where le.direction = 'debit'),0)
      <> coalesce(sum(le.amount) filter (where le.direction = 'credit'),0);

-- 5. No wallet should have a negative balance or an over-reserved withdrawal.
select wallet_id, balance
from public.wallet_balances
where balance < 0;

select wb.wallet_id,
       wb.balance as ledger_balance,
       coalesce(res.reserved,0) as reserved_withdrawals
from public.wallet_balances wb
left join lateral (
  select coalesce(sum(wr.amount),0) reserved
  from public.withdrawal_requests wr
  where wr.wallet_id = wb.wallet_id
    and wr.status in ('submitted','awaiting_second_approval','approved','processing')
) res on true
where coalesce(wb.balance,0) - coalesce(res.reserved,0) < 0;

-- 6. Server-only financial/Admin RPCs must not be executable by anon/authenticated.
select p.proname as function_name,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'post_wallet_transfer','create_withdrawal_request',
    'create_merchant_payment_request','pay_merchant_payment_request',
    'get_payment_request_details','record_withdrawal_approval',
    'set_merchant_status','run_ledger_integrity_check',
    'create_test_credit','store_user_pin_hash','record_customer_pin_attempt',
    'record_admin_pin_attempt','admin_set_user_account_status'
  )
order by p.proname;

-- 7. Customer PIN and Admin PIN must have separate stores, both server-only.
select 'pin_storage' as check_type, c.relname as object_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_can_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('user_security','admin_security')
order by c.relname;

-- 8. Privilege boundaries: users cannot promote themselves, un-suspend
-- themselves, approve merchants, or read QR tokens directly from storage.
select
  has_column_privilege('authenticated','public.profiles','account_status','UPDATE')
    as authenticated_can_change_own_account_status,
  has_table_privilege('authenticated','public.merchants','UPDATE')
    as authenticated_can_directly_change_merchant_status,
  has_table_privilege('authenticated','public.payment_requests','SELECT')
    as authenticated_can_read_qr_requests,
  has_function_privilege('authenticated','public.is_current_user_active()','EXECUTE')
    as authenticated_can_check_own_active_state;

-- 9. Test funding must remain OFF unless an operator explicitly enables it
-- in a fully isolated TEST project.
select setting_key, setting_value
from public.platform_settings
where setting_key = 'test_mode_enabled';
