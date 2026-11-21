-- LakayGoPay: read-only daily financial summary for the existing Production ledger.
-- Additive only: does not alter wallets, balances, transactions, or ledger entries.
-- The API calls this RPC with the service role after its own admin session/PIN/MFA checks.
-- This function independently verifies the supplied admin user against public.is_admin_user().

begin;

do $preflight$
declare
  required_columns text[][] := array[
    array['ledger_transactions','id'],
    array['ledger_transactions','status'],
    array['ledger_transactions','currency'],
    array['ledger_transactions','metadata'],
    array['ledger_transactions','posted_at'],
    array['ledger_entries','transaction_id'],
    array['ledger_entries','account_id'],
    array['ledger_entries','direction'],
    array['ledger_entries','amount'],
    array['ledger_entries','currency'],
    array['ledger_accounts','id'],
    array['ledger_accounts','account_type'],
    array['ledger_accounts','is_system']
  ];
  item text[];
begin
  if to_regclass('public.ledger_transactions') is null
     or to_regclass('public.ledger_entries') is null
     or to_regclass('public.ledger_accounts') is null then
    raise exception 'FINANCE_REPORT_REQUIRED_TABLE_MISSING';
  end if;

  if to_regprocedure('public.is_admin_user(uuid)') is null then
    raise exception 'FINANCE_REPORT_ADMIN_CHECK_MISSING';
  end if;

  foreach item slice 1 in array required_columns loop
    if not exists (
      select 1
        from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name = item[1]
         and c.column_name = item[2]
    ) then
      raise exception 'FINANCE_REPORT_REQUIRED_COLUMN_MISSING: %.%', item[1], item[2];
    end if;
  end loop;
end;
$preflight$;

create or replace function public.get_admin_daily_financial_summary(
  p_admin_user_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_report jsonb;
begin
  if p_admin_user_id is null
     or not public.is_admin_user(p_admin_user_id) then
    raise exception 'ADMIN_ROLE_REQUIRED' using errcode = '42501';
  end if;

  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'FINANCE_REPORT_RANGE_INVALID' using errcode = '22023';
  end if;

  select pg_catalog.jsonb_build_object(
    'rows',
    coalesce(
      pg_catalog.jsonb_agg(pg_catalog.to_jsonb(d) order by d.ledger_date, d.currency),
      '[]'::jsonb
    )
  )
    into v_report
    from (
      select
        (lt.posted_at at time zone 'UTC')::date as ledger_date,
        lt.currency,
        count(distinct lt.id)::bigint as transaction_count,
        coalesce(
          sum(le.amount) filter (where le.direction = 'debit'),
          0
        )::numeric(20,2) as total_debits,
        coalesce(
          sum(le.amount) filter (where le.direction = 'credit'),
          0
        )::numeric(20,2) as total_credits,
        coalesce(
          sum(le.amount) filter (
            where le.direction = 'credit'
              and la.is_system = true
              and la.account_type::text = 'revenue'
          ),
          0
        )::numeric(20,2) as platform_revenue_credits,
        count(distinct lt.id) filter (
          where lt.metadata ->> 'test_only' = 'true'
        )::bigint as test_transaction_count,
        count(distinct lt.id) filter (
          where coalesce(lt.metadata ->> 'test_only', 'false') <> 'true'
        )::bigint as real_transaction_count
      from public.ledger_transactions lt
      join public.ledger_entries le
        on le.transaction_id = lt.id
       and le.currency = lt.currency
      join public.ledger_accounts la
        on la.id = le.account_id
       and la.currency = le.currency
      where lt.status = 'posted'
        and lt.posted_at is not null
        and lt.posted_at >= (pg_catalog.now() - pg_catalog.make_interval(days => p_days))
        and lt.posted_at <= pg_catalog.now()
      group by (lt.posted_at at time zone 'UTC')::date, lt.currency
    ) d;

  return coalesce(v_report, '{"rows":[]}'::jsonb);
end;
$function$;

alter function public.get_admin_daily_financial_summary(uuid, integer) owner to postgres;

-- This is a server-only RPC. The Cloudflare API calls it with service_role
-- only after requireAdminRoles() and the admin PIN/MFA checks have succeeded.
revoke all on function public.get_admin_daily_financial_summary(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_admin_daily_financial_summary(uuid, integer)
  to service_role;

do $verify_permissions$
begin
  if has_function_privilege(
    'anon', 'public.get_admin_daily_financial_summary(uuid,integer)', 'EXECUTE'
  ) then
    raise exception 'FINANCE_REPORT_ANON_EXECUTE_MUST_BE_REVOKED';
  end if;

  if has_function_privilege(
    'authenticated', 'public.get_admin_daily_financial_summary(uuid,integer)', 'EXECUTE'
  ) then
    raise exception 'FINANCE_REPORT_AUTHENTICATED_EXECUTE_MUST_BE_REVOKED';
  end if;

  if not has_function_privilege(
    'service_role', 'public.get_admin_daily_financial_summary(uuid,integer)', 'EXECUTE'
  ) then
    raise exception 'FINANCE_REPORT_SERVICE_ROLE_EXECUTE_REQUIRED';
  end if;
end;
$verify_permissions$;

commit;
