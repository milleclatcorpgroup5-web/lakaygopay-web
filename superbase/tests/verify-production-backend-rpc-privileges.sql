-- LakayGoPay Production: READ-ONLY backend/RPC and privilege diagnostic.
-- Lists schema metadata and effective grants only.
-- Does NOT read wallet balances, PIN values, personal rows, ledger entries, or secrets.
-- Does NOT change schema, data, grants, or financial state.

begin read only;

-- A) RPCs referenced by the current Cloudflare Pages backend.
-- A missing row means the deployed backend may call a function absent from Production.
with expected(function_name) as (
  values
    ('post_wallet_transfer'),
    ('create_withdrawal_request'),
    ('record_withdrawal_approval'),
    ('run_ledger_integrity_check'),
    ('create_merchant_payment_request'),
    ('get_payment_request_details'),
    ('pay_merchant_payment_request'),
    ('store_user_pin_hash'),
    ('record_customer_pin_attempt'),
    ('record_admin_pin_attempt'),
    ('reset_admin_pin'),
    ('admin_set_user_role'),
    ('propose_platform_fee'),
    ('review_platform_fee_proposal'),
    ('get_admin_daily_financial_summary'),
    ('register_merchant_account'),
    ('set_merchant_status')
)
select
  e.function_name,
  p.oid::regprocedure as function_signature,
  case when p.oid is null then null else p.prosecdef end as security_definer,
  case when p.oid is null then null else pg_get_userbyid(p.proowner) end as owner_name,
  case when p.oid is null then null else p.proconfig::text end as function_settings,
  case when p.oid is null then false else has_function_privilege('anon', p.oid, 'EXECUTE') end as anon_can_execute,
  case when p.oid is null then false else has_function_privilege('authenticated', p.oid, 'EXECUTE') end as authenticated_can_execute,
  case when p.oid is null then false else has_function_privilege('service_role', p.oid, 'EXECUTE') end as service_role_can_execute
from expected e
left join pg_proc p
  on p.pronamespace = 'public'::regnamespace
 and p.proname = e.function_name
order by e.function_name, p.oid;

-- B) Presence and RLS status of tables/views used by backend financial routes.
with expected(table_name) as (
  values
    ('profiles'),
    ('user_roles'),
    ('wallets'),
    ('ledger_accounts'),
    ('ledger_transactions'),
    ('ledger_entries'),
    ('wallet_balances'),
    ('user_security'),
    ('admin_security'),
    ('withdrawal_requests'),
    ('withdrawal_approvals'),
    ('audit_logs'),
    ('payment_requests'),
    ('merchant_payment_records')
)
select
  e.table_name,
  c.relkind as relation_kind,
  case when c.oid is null then null else c.relrowsecurity end as rls_enabled,
  case when c.oid is null then null else c.relforcerowsecurity end as force_rls_enabled
from expected e
left join pg_class c
  on c.oid = to_regclass('public.' || e.table_name)
order by e.table_name;

-- C) Effective table privileges. This checks capabilities, not row contents.
with expected(table_name) as (
  values
    ('profiles'),
    ('user_roles'),
    ('wallets'),
    ('ledger_accounts'),
    ('ledger_transactions'),
    ('ledger_entries'),
    ('wallet_balances'),
    ('user_security'),
    ('admin_security'),
    ('withdrawal_requests'),
    ('withdrawal_approvals'),
    ('audit_logs'),
    ('payment_requests'),
    ('merchant_payment_records')
)
select
  e.table_name,
  case when c.oid is null then null else has_table_privilege('anon', c.oid, 'SELECT') end as anon_select,
  case when c.oid is null then null else has_table_privilege('anon', c.oid, 'INSERT') end as anon_insert,
  case when c.oid is null then null else has_table_privilege('authenticated', c.oid, 'SELECT') end as authenticated_select,
  case when c.oid is null then null else has_table_privilege('authenticated', c.oid, 'INSERT') end as authenticated_insert,
  case when c.oid is null then null else has_table_privilege('authenticated', c.oid, 'UPDATE') end as authenticated_update,
  case when c.oid is null then null else has_table_privilege('authenticated', c.oid, 'DELETE') end as authenticated_delete,
  case when c.oid is null then null else has_table_privilege('service_role', c.oid, 'SELECT') end as service_select,
  case when c.oid is null then null else has_table_privilege('service_role', c.oid, 'INSERT') end as service_insert,
  case when c.oid is null then null else has_table_privilege('service_role', c.oid, 'UPDATE') end as service_update,
  case when c.oid is null then null else has_table_privilege('service_role', c.oid, 'DELETE') end as service_delete
from expected e
left join pg_class c
  on c.oid = to_regclass('public.' || e.table_name)
order by e.table_name;

-- D) RLS policies on financial/security tables.
select
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles','user_roles','wallets','ledger_accounts',
    'ledger_transactions','ledger_entries','wallet_balances',
    'user_security','admin_security','withdrawal_requests',
    'withdrawal_approvals','audit_logs','payment_requests',
    'merchant_payment_records'
  )
order by tablename, policyname;

-- E) User-defined triggers on financial tables and audit trail.
select
  c.relname as table_name,
  t.tgname as trigger_name,
  pg_get_triggerdef(t.oid) as trigger_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
  and c.relname in (
    'wallets','ledger_accounts','ledger_transactions',
    'ledger_entries','withdrawal_requests','withdrawal_approvals','audit_logs'
  )
order by c.relname, t.tgname;

commit;
