-- READ-ONLY verification for merchant QR v2.
-- Metadata and effective privileges only: no balances, ledger rows, tokens, or personal records.
begin read only;

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

-- D) Confirm posting engine is present and owned by postgres as SECURITY DEFINER.
select
  p.oid::regprocedure as function_signature,
  pg_catalog.pg_get_userbyid(p.proowner) as owner_name,
  p.prosecdef as security_definer,
  p.proconfig::text as function_settings
from pg_catalog.pg_proc p
where p.oid = pg_catalog.to_regprocedure('public.post_ledger_transaction(uuid)');

commit;
