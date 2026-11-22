-- READ-ONLY verification for merchant QR v2.
-- Metadata and effective privileges only: no balances, ledger rows, tokens, or personal records.
begin read only;

-- A0) Required Production columns for QR settlement.
-- Each required column is reported independently; missing items do not stop this diagnostic.
with required_columns(table_name, column_name) as (
  values
    ('profiles','id'), ('profiles','account_status'),
    ('merchants','id'), ('merchants','owner_user_id'), ('merchants','business_name'),
    ('merchants','business_type'), ('merchants','category'), ('merchants','contact_phone'),
    ('merchants','status'),
    ('wallets','id'), ('wallets','owner_user_id'), ('wallets','merchant_id'),
    ('wallets','currency'), ('wallets','status'),
    ('wallet_balances','wallet_id'), ('wallet_balances','owner_user_id'),
    ('wallet_balances','merchant_id'), ('wallet_balances','currency'), ('wallet_balances','balance'),
    ('ledger_accounts','id'), ('ledger_accounts','wallet_id'), ('ledger_accounts','currency'),
    ('ledger_accounts','account_type'), ('ledger_accounts','is_system'),
    ('ledger_transactions','id'), ('ledger_transactions','transaction_type'),
    ('ledger_transactions','status'), ('ledger_transactions','currency'),
    ('ledger_transactions','idempotency_key'), ('ledger_transactions','actor_user_id'),
    ('ledger_transactions','description'), ('ledger_transactions','metadata'),
    ('ledger_entries','id'), ('ledger_entries','transaction_id'), ('ledger_entries','account_id'),
    ('ledger_entries','direction'), ('ledger_entries','amount'), ('ledger_entries','currency'),
    ('audit_logs','actor_user_id'), ('audit_logs','action'), ('audit_logs','resource_type'),
    ('audit_logs','resource_id'), ('audit_logs','outcome'), ('audit_logs','metadata')
)
select
  r.table_name,
  r.column_name,
  (c.column_name is not null) as column_exists
from required_columns r
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = r.table_name
 and c.column_name = r.column_name
order by r.table_name, r.column_name;

-- A1) Check constraints on the actual Production ledger tables.
-- This is metadata only and helps confirm accepted transaction types/statuses.
select
  t.relname as table_name,
  c.conname as constraint_name,
  pg_catalog.pg_get_constraintdef(c.oid) as definition
from pg_catalog.pg_constraint c
join pg_catalog.pg_class t on t.oid = c.conrelid
join pg_catalog.pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname in ('ledger_transactions','ledger_entries','wallet_balances','wallets','ledger_accounts')
  and c.contype in ('c','f','u','p')
order by t.relname, c.conname;

-- A) New table presence and RLS.
select
  c.relname as table_name,
  c.relkind as relation_kind,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls_enabled
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('merchant_qr_requests', 'merchant_qr_payment_idempotency')
order by c.relname;

-- B) Exact columns of the two QR-owned tables.
select table_name, ordinal_position, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('merchant_qr_requests', 'merchant_qr_payment_idempotency')
order by table_name, ordinal_position;

-- C) Function owners, SECURITY DEFINER, search_path and execute privileges.
with expected(function_name, function_signature) as (
  values
    ('create_merchant_qr_request', 'public.create_merchant_qr_request(uuid,uuid,numeric,text,text,integer,text)'),
    ('get_merchant_qr_request_details', 'public.get_merchant_qr_request_details(uuid)'),
    ('pay_merchant_qr_request', 'public.pay_merchant_qr_request(uuid,uuid,numeric,text)'),
    ('pay_merchant_qr_request_server_authorized', 'public.pay_merchant_qr_request_server_authorized(uuid,uuid,uuid,numeric,text)')
)
select
  e.function_name,
  p.oid::regprocedure as function_signature,
  case when p.oid is null then null else pg_catalog.pg_get_userbyid(p.proowner) end as owner_name,
  case when p.oid is null then null else p.prosecdef end as security_definer,
  case when p.oid is null then null else p.proconfig::text end as function_settings,
  case when p.oid is null then false else has_function_privilege('anon', p.oid, 'EXECUTE') end as anon_can_execute,
  case when p.oid is null then false else has_function_privilege('authenticated', p.oid, 'EXECUTE') end as authenticated_can_execute,
  case when p.oid is null then false else has_function_privilege('service_role', p.oid, 'EXECUTE') end as service_role_can_execute
from expected e
left join pg_catalog.pg_proc p
  on p.oid = pg_catalog.to_regprocedure(e.function_signature)
order by e.function_name;

-- D) Service-role SELECT is required by the authenticated payment-history API;
-- browser roles must remain unable to read QR request or idempotency rows directly.
select
  case when pg_catalog.to_regclass('public.merchant_qr_requests') is null then null
    else has_table_privilege('service_role', pg_catalog.to_regclass('public.merchant_qr_requests'), 'SELECT') end
      as service_role_can_read_qr_receipts,
  case when pg_catalog.to_regclass('public.merchant_qr_requests') is null then null
    else has_table_privilege('authenticated', pg_catalog.to_regclass('public.merchant_qr_requests'), 'SELECT') end
      as authenticated_can_read_qr_requests,
  case when pg_catalog.to_regclass('public.merchant_qr_requests') is null then null
    else has_table_privilege('anon', pg_catalog.to_regclass('public.merchant_qr_requests'), 'SELECT') end
      as anon_can_read_qr_requests;

-- E) Confirm posting engine is present and owned by postgres as SECURITY DEFINER.
select
  p.oid::regprocedure as function_signature,
  pg_catalog.pg_get_userbyid(p.proowner) as owner_name,
  p.prosecdef as security_definer,
  p.proconfig::text as function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_catalog.pg_proc p
where p.oid = pg_catalog.to_regprocedure('public.post_ledger_transaction(uuid)');

commit;
