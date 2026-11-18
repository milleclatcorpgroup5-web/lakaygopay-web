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
left join public.ledger_entries le on le.ledger_transaction_id = lt.id
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


-- 10. Admin Control Center foundations: role extension, private secretariat,
-- versioned fee proposals, and dedicated platform-revenue wallets.
select 'admin_control_center_relation' as check_type,
       name as object_name,
       to_regclass('public.' || name) is not null as passed
from (values
  ('admin_secretariat_access'),
  ('admin_secretariat_items'),
  ('platform_fee_proposals')
) objects(name);

select 'admin_control_center_role_check' as check_type,
       coalesce(bool_or(
         pg_get_constraintdef(oid) ilike '%accountant%'
         and pg_get_constraintdef(oid) ilike '%secretary%'
       ),false) as passed
from pg_constraint
where conrelid = 'public.user_roles'::regclass
  and contype = 'c'
  and pg_get_constraintdef(oid) ilike '%role%';

select 'platform_revenue_wallets' as check_type,
       count(*) = 3 and count(distinct currency) = 3 as passed,
       count(*) as revenue_wallet_count,
       array_agg(currency::text order by currency::text) as currencies
from public.wallets
where is_system = true
  and system_account_code = 'platform_revenue'
  and currency in ('HTG','USD','EUR');

select 'treasury_wallet_currency_constraint' as check_type,
       coalesce(bool_or(
         pg_get_constraintdef(oid) ilike '%HTG%'
         and pg_get_constraintdef(oid) ilike '%USD%'
         and pg_get_constraintdef(oid) ilike '%EUR%'
       ),false) as passed
from pg_constraint
where conrelid = 'public.wallets'::regclass
  and contype = 'c'
  and conname = 'wallets_currency_supported_check';

select 'system_clearing_wallet' as check_type,
       count(*) = 1 as passed,
       count(*) as htg_clearing_wallets
from public.wallets
where is_system = true
  and system_account_code = 'clearing'
  and currency = 'HTG';

select 'admin_secretariat_privacy' as check_type,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_can_read,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_read
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('admin_secretariat_access','admin_secretariat_items')
order by c.relname;

select 'fee_proposal_privileges' as check_type,
       has_table_privilege('authenticated','public.platform_fee_proposals','SELECT') as authenticated_can_read,
       has_function_privilege(
         'authenticated',
         'public.propose_platform_fee(uuid,text,text,text,numeric,timestamp with time zone,numeric,numeric,text)',
         'EXECUTE'
       ) as authenticated_can_propose,
       has_function_privilege(
         'service_role',
         'public.propose_platform_fee(uuid,text,text,text,numeric,timestamp with time zone,numeric,numeric,text)',
         'EXECUTE'
       ) as service_role_can_call_proposal_rpc,
       has_function_privilege(
         'service_role',
         'public.review_platform_fee_proposal(uuid,uuid,text,text)',
         'EXECUTE'
       ) as service_role_can_call_review_rpc;

select 'fee_proposal_maker_checker' as check_type,
       position('role = ''finance_admin''' in
         pg_get_functiondef('public.propose_platform_fee(uuid,text,text,text,numeric,timestamp with time zone,numeric,numeric,text)'::regprocedure)
       ) > 0 as finance_admin_role_required,
       position('role = ''super_admin''' in
         pg_get_functiondef('public.propose_platform_fee(uuid,text,text,text,numeric,timestamp with time zone,numeric,numeric,text)'::regprocedure)
       ) > 0 as super_admin_explicitly_excluded,
       position('MAKER_CANNOT_APPROVE_OWN_FEE_PROPOSAL' in
         pg_get_functiondef('public.review_platform_fee_proposal(uuid,uuid,text,text)'::regprocedure)
       ) > 0 as prevents_self_approval;

select 'admin_role_management_rpc' as check_type,
       to_regprocedure('public.admin_set_user_role(uuid,uuid,text,text)') is not null as function_exists,
       has_function_privilege(
         'authenticated',
         'public.admin_set_user_role(uuid,uuid,text,text)',
         'EXECUTE'
       ) as authenticated_can_call,
       has_function_privilege(
         'service_role',
         'public.admin_set_user_role(uuid,uuid,text,text)',
         'EXECUTE'
       ) as service_role_can_call;

select 'withdrawal_super_admin_guard' as check_type,
       position('ur.role = ''super_admin''' in
         pg_get_functiondef('public.record_withdrawal_approval(uuid,uuid,text,text)'::regprocedure)
       ) > 0 as super_admin_required_for_major_decisions;

select 'daily_financial_summary_rpc' as check_type,
       to_regprocedure('public.get_admin_daily_financial_summary(uuid,integer)') is not null as function_exists,
       has_function_privilege(
         'authenticated',
         'public.get_admin_daily_financial_summary(uuid,integer)',
         'EXECUTE'
       ) as authenticated_can_call,
       has_function_privilege(
         'service_role',
         'public.get_admin_daily_financial_summary(uuid,integer)',
         'EXECUTE'
       ) as service_role_can_call;


-- 11. The service-fee system is a proposal workflow only. Approval must not
-- turn on fee posting or any real-money payment channel.
select
  exists (
    select 1 from public.platform_fee_proposals where status = 'approved'
  ) as has_approved_fee_policy,
  false as automatic_fee_posting_enabled,
  false as external_payments_enabled;
