-- LakayGoPay Production financial controls: COMPACT, READ-ONLY audit.
-- Output is intentionally limited to a short list of BLOCK / REVIEW findings.
-- It does not read wallet balances, customer identities, or secret setting values.
-- Run in Supabase SQL Editor. This script makes no schema or data changes.

begin read only;

with
core_tables(name) as (
  values ('wallets'), ('ledger_transactions'), ('ledger_entries'),
         ('withdrawal_requests'), ('withdrawal_approvals')
),
sensitive_tables(name) as (
  values ('profiles'), ('user_roles'), ('wallets'),
         ('ledger_transactions'), ('ledger_entries'),
         ('withdrawal_requests'), ('withdrawal_approvals'),
         ('audit_logs'), ('platform_settings'),
         ('user_security'), ('admin_security')
),
checks as (
  -- Core financial tables must exist.
  select 'CORE_TABLE'::text as area,
         case when to_regclass('public.' || name) is null then 'BLOCK' else 'OK' end as status,
         name || case when to_regclass('public.' || name) is null
                      then ': missing' else ': present' end as detail
  from core_tables

  union all

  -- RLS must be enabled on any existing sensitive table.
  select 'RLS',
         case when c.oid is null then 'OK'
              when c.relrowsecurity then 'OK' else 'BLOCK' end,
         s.name || case when c.oid is null then ': table absent'
                        when c.relrowsecurity then ': enabled'
                        else ': DISABLED' end
  from sensitive_tables s
  left join pg_class c
    on c.oid = to_regclass('public.' || s.name)

  union all

  -- Enabled RLS with no policy may be intentional, but needs explicit review.
  select 'RLS_POLICY',
         case when c.oid is null or not c.relrowsecurity then 'OK'
              when count(p.policyname) = 0 then 'REVIEW' else 'OK' end,
         s.name || ': ' || count(p.policyname)::text || ' policies'
  from sensitive_tables s
  left join pg_class c on c.oid = to_regclass('public.' || s.name)
  left join pg_policies p
    on p.schemaname = 'public' and p.tablename = s.name
  group by s.name, c.oid, c.relrowsecurity

  union all

  -- Show actual ledger column names without assuming a foreign-key name.
  select 'LEDGER_SCHEMA', 'REVIEW',
         t.name || ': ' ||
         coalesce((
           select string_agg(col.column_name, ', ' order by col.ordinal_position)
           from information_schema.columns col
           where col.table_schema = 'public' and col.table_name = t.name
         ), 'no columns found')
  from (values ('ledger_transactions'), ('ledger_entries')) t(name)
  where to_regclass('public.' || t.name) is not null

  union all

  -- Any direct client DML grant on the journal needs review; actual RLS
  -- policies and server-side RPC checks must also be inspected.
  select 'LEDGER_GRANTS',
         case when
           has_table_privilege('anon', c.oid, 'INSERT')
           or has_table_privilege('anon', c.oid, 'UPDATE')
           or has_table_privilege('anon', c.oid, 'DELETE')
           or has_table_privilege('authenticated', c.oid, 'INSERT')
           or has_table_privilege('authenticated', c.oid, 'UPDATE')
           or has_table_privilege('authenticated', c.oid, 'DELETE')
         then 'REVIEW' else 'OK' end,
         c.relname || ': anon DML=' ||
         (has_table_privilege('anon', c.oid, 'INSERT')
          or has_table_privilege('anon', c.oid, 'UPDATE')
          or has_table_privilege('anon', c.oid, 'DELETE'))::text ||
         ', authenticated DML=' ||
         (has_table_privilege('authenticated', c.oid, 'INSERT')
          or has_table_privilege('authenticated', c.oid, 'UPDATE')
          or has_table_privilege('authenticated', c.oid, 'DELETE'))::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('ledger_transactions', 'ledger_entries')

  union all

  -- Compact trigger inventory. Names are evidence for manual review,
  -- not proof that the trigger enforces append-only behavior.
  select 'LEDGER_TRIGGERS', 'REVIEW',
         c.relname || ': ' ||
         coalesce(string_agg(t.tgname || ' [' ||
           case t.tgenabled when 'O' then 'enabled'
                            when 'D' then 'disabled'
                            when 'R' then 'replica'
                            when 'A' then 'always' else 'unknown' end || ']',
           ', ' order by t.tgname) filter (where t.oid is not null),
           'no user triggers')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_trigger t on t.tgrelid = c.oid and not t.tgisinternal
  where n.nspname = 'public'
    and c.relname in ('ledger_transactions', 'ledger_entries', 'audit_logs')
  group by c.relname

  union all

  -- Expected high-value financial RPCs; existence/ACLs need code review too.
  select 'FINANCIAL_RPC',
         case when p.oid is null then 'REVIEW' else 'OK' end,
         f.name || case when p.oid is null then ': not found'
                        else ': exists; security_definer=' ||
                             p.prosecdef::text || '; settings=' ||
                             coalesce(array_to_string(p.proconfig, ','), 'none')
                   end
  from (values ('post_wallet_transfer'),
               ('create_withdrawal_request'),
               ('record_withdrawal_approval'),
               ('run_ledger_integrity_check')) f(name)
  left join pg_proc p
    on p.proname = f.name
   and p.pronamespace = 'public'::regnamespace

  union all

  -- Report settings table shape only; never reveal values.
  select 'FINANCIAL_SETTINGS', 'REVIEW',
         'platform_settings columns: ' ||
         coalesce((
           select string_agg(column_name, ', ' order by ordinal_position)
           from information_schema.columns
           where table_schema = 'public' and table_name = 'platform_settings'
         ), 'table absent or has no columns')
)
select area, status, left(detail, 260) as detail
from checks
where status <> 'OK'
order by case status when 'BLOCK' then 1 else 2 end, area, detail
limit 24;

commit;
