-- LakayGoPay Production security and financial-control audit.
-- READ ONLY: this script creates/updates/deletes no persistent objects or data.
-- Run as the Supabase SQL editor owner. Review output; do not treat missing
-- objects as passing checks. No personal identifiers or wallet IDs are emitted.

begin read only;

-- 1) Schema/migration inventory. The migration-history relation may be absent
-- on some projects; this check reports its presence without assuming it exists.
select 'migration_history_relation' as check_name,
       to_regclass('supabase_migrations.schema_migrations') is not null as exists;

select expected.name as relation_name,
       to_regclass('public.' || expected.name) is not null as exists
from (values
  ('profiles'),('user_roles'),('merchants'),('wallets'),('wallet_balances'),
  ('ledger_transactions'),('ledger_entries'),('transfers'),('idempotency_keys'),
  ('withdrawal_requests'),('withdrawal_approvals'),('payment_requests'),
  ('merchant_payment_records'),('notifications'),('audit_logs'),
  ('user_security'),('admin_security'),('admin_pin_reset_challenges'),
  ('platform_fee_proposals')
) as expected(name)
order by expected.name;

-- 2) RLS must be enabled on sensitive base tables. Force-RLS is reported
-- separately because service-role/server access must be reviewed intentionally.
select c.relname as relation_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as force_rls_enabled
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relkind in ('r','p')
  and c.relname in (
    'profiles','user_roles','merchants','merchant_members','wallets',
    'ledger_transactions','ledger_entries','transfers','idempotency_keys',
    'deposit_requests','withdrawal_requests','withdrawal_approvals',
    'payment_requests','merchant_payment_requests','merchant_payment_records',
    'otp_challenges','security_events','notifications','audit_logs',
    'user_security','admin_security','admin_pin_reset_challenges',
    'platform_fee_proposals'
  )
order by c.relname;

-- 3) Direct table privileges on the most sensitive financial/security tables.
-- This is a privilege check, not a substitute for testing RLS policies.
select c.relname as relation_name,
       has_table_privilege('anon',c.oid,'SELECT') as anon_select,
       has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select,
       has_table_privilege('authenticated',c.oid,'INSERT') as authenticated_insert,
       has_table_privilege('authenticated',c.oid,'UPDATE') as authenticated_update,
       has_table_privilege('authenticated',c.oid,'DELETE') as authenticated_delete
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in (
    'user_roles','wallets','ledger_transactions','ledger_entries','idempotency_keys',
    'withdrawal_requests','withdrawal_approvals','platform_settings','user_security',
    'admin_security','admin_pin_reset_challenges','audit_logs'
  )
order by c.relname;

-- 4) Direct authenticated ability to update protected profile/role fields.
select c.relname as relation_name,
       a.attname as column_name,
       has_column_privilege('authenticated',a.attrelid,a.attnum,'UPDATE')
         as authenticated_can_update
from pg_attribute a
join pg_class c on c.oid=a.attrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in ('profiles','user_roles','wallets')
  and a.attnum>0 and not a.attisdropped
  and a.attname in ('account_status','role','balance','system_account_code')
order by c.relname,a.attname;

-- 5) Actual RLS policy inventory for sensitive tables.
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies
where schemaname='public'
  and tablename in (
    'profiles','user_roles','merchants','merchant_members','wallets',
    'ledger_transactions','ledger_entries','transfers','withdrawal_requests',
    'withdrawal_approvals','payment_requests','merchant_payment_records',
    'user_security','admin_security','admin_pin_reset_challenges','audit_logs'
  )
order by tablename,policyname;

-- 6) Append-only protections must exist for the financial journal and audit log.
select expected.table_name,expected.trigger_name,
       (t.oid is not null and not t.tgisinternal) as trigger_exists
from (values
  ('ledger_transactions','ledger_transactions_no_update_delete'),
  ('ledger_entries','ledger_entries_no_update_delete'),
  ('merchant_payment_records','merchant_payment_records_no_update_delete'),
  ('audit_logs','audit_logs_no_update_delete')
) as expected(table_name,trigger_name)
left join pg_class c on c.relname=expected.table_name
left join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
left join pg_trigger t on t.tgrelid=c.oid and t.tgname=expected.trigger_name
where c.oid is null or n.oid is not null
order by expected.table_name;

-- 7) Server-only financial/Admin RPC privilege inventory.
with expected(function_name) as (
  values
    ('post_wallet_transfer'),('create_withdrawal_request'),
    ('create_merchant_payment_request'),('pay_merchant_payment_request'),
    ('get_payment_request_details'),('record_withdrawal_approval'),
    ('set_merchant_status'),('run_ledger_integrity_check'),
    ('create_test_credit'),('store_user_pin_hash'),
    ('record_customer_pin_attempt'),('record_admin_pin_attempt'),
    ('admin_set_user_account_status'),('admin_set_user_role'),
    ('propose_platform_fee'),('review_platform_fee_proposal'),
    ('get_admin_daily_financial_summary')
)
select e.function_name,
       p.oid is not null as function_exists,
       coalesce(p.prosecdef,false) as security_definer,
       p.proconfig as function_settings,
       case when p.oid is null then null
         else has_function_privilege('anon',p.oid,'EXECUTE') end as anon_can_execute,
       case when p.oid is null then null
         else has_function_privilege('authenticated',p.oid,'EXECUTE') end as authenticated_can_execute,
       case when p.oid is null then null
         else has_function_privilege('service_role',p.oid,'EXECUTE') end as service_role_can_execute
from expected e
left join pg_proc p on p.proname=e.function_name
left join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
where p.oid is null or n.oid is not null
order by e.function_name,p.oid;

-- 8) Actual financial schema inspection.
-- The Production database may not yet match the repository migration. Do not
-- assume ledger foreign-key column names or that all views/tables exist.
select table_name, column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema='public'
  and table_name in (
    'ledger_transactions','ledger_entries','wallets','wallet_balances',
    'transfers','withdrawal_requests','withdrawal_approvals','platform_settings'
  )
order by table_name, ordinal_position;

-- 9) Report whether key financial objects exist and whether each is a table or view.
select expected.object_name,
       c.relkind,
       case c.relkind
         when 'r' then 'table'
         when 'p' then 'partitioned table'
         when 'v' then 'view'
         when 'm' then 'materialized view'
         when 'f' then 'foreign table'
         else 'missing'
       end as object_type,
       c.oid is not null as exists
from (values
  ('ledger_transactions'),('ledger_entries'),('wallets'),('wallet_balances'),
  ('transfers'),('withdrawal_requests'),('withdrawal_approvals'),('platform_settings')
) as expected(object_name)
left join pg_class c
  on c.relname=expected.object_name
 and c.relnamespace='public'::regnamespace
order by expected.object_name;

-- 10) Withdrawal maker-checker constraints, without assuming the table exists.
select c.relname as table_name, con.conname,
       pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid=con.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname='withdrawal_approvals'
  and con.contype in ('u','p')
order by con.conname;

-- 11) Critical setting keys only (values are intentionally not exposed).
select s.setting_key
from public.platform_settings s
where to_regclass('public.platform_settings') is not null
  and s.setting_key in (
    'test_mode_enabled','external_payments_enabled',
    'payments_enabled','automatic_fee_posting_enabled',
    'withdrawal_two_person_threshold_htg'
  )
order by s.setting_key;

-- 12) Return current server-side financial function definitions for manual
-- review. In particular, verify wallet-transfer/payment RPCs reject all
-- system/treasury wallets as senders and recipients, and validate actor IDs
-- against the authenticated caller context enforced by their Worker routes.
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       pg_get_functiondef(p.oid) as current_definition
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
    'post_wallet_transfer','pay_merchant_payment_request',
    'create_withdrawal_request','record_withdrawal_approval',
    'create_test_credit','store_user_pin_hash',
    'record_customer_pin_attempt','record_admin_pin_attempt',
    'run_ledger_integrity_check'
  )
order by p.proname,pg_get_function_identity_arguments(p.oid);

commit;
