-- LakayGoPay: focused READ-ONLY diagnostic for the findings in Quick Audit.
-- No balances, personal data, secret values, or financial rows are read.
-- No schema or data changes are made.

begin read only;

-- A) Actual foreign-key relationships for the existing ledger tables.
select tc.table_name, kcu.column_name,
       ccu.table_name as references_table,
       ccu.column_name as references_column,
       tc.constraint_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_schema=tc.constraint_schema
 and kcu.constraint_name=tc.constraint_name
join information_schema.constraint_column_usage ccu
  on ccu.constraint_schema=tc.constraint_schema
 and ccu.constraint_name=tc.constraint_name
where tc.constraint_schema='public'
  and tc.constraint_type='FOREIGN KEY'
  and tc.table_name in ('ledger_entries','ledger_transactions')
order by tc.table_name,kcu.ordinal_position;

-- B) Security-table columns and RLS flags (no row contents).
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as force_rls_enabled,
       a.attname as column_name, format_type(a.atttypid,a.atttypmod) as data_type
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
left join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
where n.nspname='public'
  and c.relname in ('user_security','admin_security')
order by c.relname,a.attnum
limit 30;

-- C) Policies for those security tables.
select tablename,policyname,roles,cmd,qual,with_check
from pg_policies
where schemaname='public'
  and tablename in ('user_security','admin_security')
order by tablename,policyname;

-- D) Existing user-defined triggers on ledger and security/audit tables.
select c.relname as table_name,t.tgname as trigger_name,
       pg_get_triggerdef(t.oid) as trigger_definition
from pg_trigger t
join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal
  and c.relname in ('ledger_entries','ledger_transactions','audit_logs',
                    'user_security','admin_security')
order by c.relname,t.tgname;

-- E) Candidate withdrawal / integrity RPCs actually present in public schema.
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       p.proconfig as function_settings
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and (p.proname ilike '%withdraw%'
       or p.proname ilike '%ledger%integrity%'
       or p.proname ilike '%approval%')
order by p.proname
limit 20;

commit;
