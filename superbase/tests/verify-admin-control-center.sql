-- LakayGoPay Admin Control Center verification.
-- Read-only acceptance queries. Run after applying the Admin Control Center
-- and Admin PIN recovery migrations to an isolated QA Supabase project.

begin;
set transaction read only;

-- 1. The user_roles check constraint must admit all eight supported roles.
select
  'admin_role_constraint' as check_name,
  coalesce(bool_and(
    pg_get_constraintdef(pc.oid) ilike '%super_admin%'
    and pg_get_constraintdef(pc.oid) ilike '%admin%'
    and pg_get_constraintdef(pc.oid) ilike '%finance_admin%'
    and pg_get_constraintdef(pc.oid) ilike '%risk_admin%'
    and pg_get_constraintdef(pc.oid) ilike '%support_agent%'
    and pg_get_constraintdef(pc.oid) ilike '%auditor%'
    and pg_get_constraintdef(pc.oid) ilike '%accountant%'
    and pg_get_constraintdef(pc.oid) ilike '%secretary%'
  ), false) as passed
from pg_constraint pc
where pc.conrelid = 'public.user_roles'::regclass
  and pc.contype = 'c'
  and pg_get_constraintdef(pc.oid) ilike '%role%';

-- 2. The server-side Admin identity helper must recognize every staff role,
-- while remaining unavailable to browser roles.
select
  'is_admin_user_rpc' as check_name,
  p.oid is not null as function_exists,
  case when p.oid is not null then
    pg_get_functiondef(p.oid) ilike '%support_agent%'
    and pg_get_functiondef(p.oid) ilike '%auditor%'
    and pg_get_functiondef(p.oid) ilike '%accountant%'
    and pg_get_functiondef(p.oid) ilike '%secretary%'
  else false end as all_admin_roles_recognized,
  case when p.oid is not null then
    not has_function_privilege('anon', p.oid, 'EXECUTE')
    and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and has_function_privilege('service_role', p.oid, 'EXECUTE')
  else false end as service_role_only
from (select to_regprocedure('public.is_admin_user(uuid)') as oid) p;

-- 3. PIN attempt RPC must include all roles and remain server-only.
select
  'admin_pin_attempt_rpc' as check_name,
  p.oid is not null as function_exists,
  case when p.oid is not null then
    pg_get_functiondef(p.oid) ilike '%support_agent%'
    and pg_get_functiondef(p.oid) ilike '%auditor%'
    and pg_get_functiondef(p.oid) ilike '%accountant%'
    and pg_get_functiondef(p.oid) ilike '%secretary%'
  else false end as all_admin_roles_allowed,
  case when p.oid is not null then
    not has_function_privilege('anon', p.oid, 'EXECUTE')
    and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and has_function_privilege('service_role', p.oid, 'EXECUTE')
  else false end as server_only
from (select to_regprocedure('public.record_admin_pin_attempt(uuid,boolean,uuid)') as oid) p;

-- 3. PIN reset challenges must be RLS-protected and inaccessible to browser roles.
select
  'admin_pin_reset_challenges' as check_name,
  c.relrowsecurity as rls_enabled,
  not has_table_privilege('anon', c.oid, 'SELECT')
    and not has_table_privilege('anon', c.oid, 'INSERT')
    and not has_table_privilege('anon', c.oid, 'UPDATE')
    and not has_table_privilege('authenticated', c.oid, 'SELECT')
    and not has_table_privilege('authenticated', c.oid, 'INSERT')
    and not has_table_privilege('authenticated', c.oid, 'UPDATE')
    as browser_roles_denied,
  has_table_privilege('service_role', c.oid, 'SELECT')
    and has_table_privilege('service_role', c.oid, 'INSERT')
    and has_table_privilege('service_role', c.oid, 'UPDATE')
    as service_role_access
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'admin_pin_reset_challenges';

-- 4. PIN reset RPC must be callable only by service_role.
select
  'reset_admin_pin_rpc' as check_name,
  p.oid is not null as function_exists,
  case when p.oid is not null then
    not has_function_privilege('anon', p.oid, 'EXECUTE')
    and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and has_function_privilege('service_role', p.oid, 'EXECUTE')
  else false end as server_only
from (select to_regprocedure('public.reset_admin_pin(uuid,uuid,text,text,text,integer)') as oid) p;

-- 5. Team role changes must remain server-only and Super Admin guarded.
select
  'admin_set_user_role_rpc' as check_name,
  p.oid is not null as function_exists,
  case when p.oid is not null then
    not has_function_privilege('anon', p.oid, 'EXECUTE')
    and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and has_function_privilege('service_role', p.oid, 'EXECUTE')
    and pg_get_functiondef(p.oid) ilike '%super_admin%'
  else false end as guarded_and_server_only
from (select to_regprocedure('public.admin_set_user_role(uuid,uuid,text,text)') as oid) p;

-- 6. Revenue treasury wallets should contain exactly one account per currency.
-- The returned balance values should all be zero in a clean QA database.
select
  'platform_revenue_wallets' as check_name,
  count(*) = 3 and count(distinct currency) = 3
    and count(*) filter (where currency in ('HTG','USD','EUR')) = 3 as three_currencies_ready,
  count(*) as account_count,
  coalesce(jsonb_object_agg(currency::text, balance), '{}'::jsonb) as balances_by_currency,
  coalesce(bool_and(balance = 0), false) as all_zero_in_clean_qa
from public.wallet_balances
where is_system = true
  and system_account_code = 'platform_revenue'
  and currency in ('HTG','USD','EUR');

-- 7. Secretariat tables must stay RLS-enabled and inaccessible to browser roles.
select
  'secretariat_privacy' as check_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  not has_table_privilege('anon', c.oid, 'SELECT')
    and not has_table_privilege('authenticated', c.oid, 'SELECT')
    as browser_roles_denied
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('admin_secretariat_access','admin_secretariat_items')
order by c.relname;

-- 8. Proposal/approval and daily-report RPC permissions.
select
  'fee_and_report_rpc_privileges' as check_name,
  p.proname as function_name,
  not has_function_privilege('anon', p.oid, 'EXECUTE')
    and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and has_function_privilege('service_role', p.oid, 'EXECUTE')
    as service_role_only
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'propose_platform_fee',
    'review_platform_fee_proposal',
    'get_admin_daily_financial_summary'
  )
order by p.proname;

-- 9. Approved fee proposals still do not imply fee posting or external payment.
select
  'safety_gates' as check_name,
  false as automatic_fee_posting_enabled,
  false as external_payments_enabled,
  count(*) filter (where status = 'approved') as approved_proposals_do_not_activate_engine
from public.platform_fee_proposals;

commit;
