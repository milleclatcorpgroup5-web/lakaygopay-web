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

-- 8) Ledger integrity summary. Expected healthy result: unbalanced_transactions = 0.
select count(*) as unbalanced_transactions
from (
  select lt.id
  from public.ledger_transactions lt
  left join public.ledger_entries le on le.ledger_transaction_id=lt.id
  group by lt.id
  having count(le.id)<2
      or coalesce(sum(le.amount) filter(where le.direction='debit'),0)
         <> coalesce(sum(le.amount) filter(where le.direction='credit'),0)
) bad;

-- 9) Derived balances and withdrawal reservations. Expected healthy results:
-- negative_wallet_balances = 0 and over_reserved_withdrawal_wallets = 0.
select count(*) as negative_wallet_balances
from public.wallet_balances
where balance<0;

select count(*) as over_reserved_withdrawal_wallets
from public.wallet_balances wb
left join lateral (
  select coalesce(sum(wr.amount),0) as reserved
  from public.withdrawal_requests wr
  where wr.wallet_id=wb.wallet_id
    and wr.status in ('submitted','awaiting_second_approval','approved','processing')
) r on true
where coalesce(wb.balance,0)-coalesce(r.reserved,0)<0;

-- 10) Withdrawal maker-checker: each administrator may approve a request
-- only once. The default threshold should require two distinct approvers.
select conname,pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid='public.withdrawal_approvals'::regclass
  and contype in ('u','p')
order by conname;

-- 10) Confirm the independent currency-ledger constraint and critical flags.
select conname,pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid='public.wallets'::regclass
  and contype='c'
  and conname='wallets_currency_supported_check';

select setting_key,setting_value
from public.platform_settings
where setting_key in (
  'test_mode_enabled','external_payments_enabled',
  'payments_enabled','automatic_fee_posting_enabled','withdrawal_two_person_threshold_htg'
)
order by setting_key;

commit;
