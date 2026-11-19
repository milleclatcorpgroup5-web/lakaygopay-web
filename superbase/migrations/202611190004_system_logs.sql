-- LakayGoPay technical observability.
-- Stores sanitized server and authenticated-browser diagnostics only.
-- Never store passwords, PINs, access tokens, request bodies, wallet balances,
-- card numbers, bank references, email addresses, or raw exception payloads.

begin;

create table if not exists public.system_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  severity text not null check (severity in ('error', 'warning', 'info')),
  source text not null check (source in ('server', 'browser')),
  area text not null check (area in ('admin', 'agent', 'cards', 'merchant', 'payments', 'wallet', 'customer', 'connect', 'api', 'website')),
  event_code text not null check (char_length(event_code) between 3 and 80),
  message text not null check (char_length(message) <= 240),
  path text not null check (char_length(path) <= 180),
  method text,
  http_status smallint,
  request_id text,
  actor_user_id uuid,
  environment text not null default 'unknown',
  release text not null default 'unknown',
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);

create index if not exists system_logs_created_at_idx
  on public.system_logs (created_at desc);
create index if not exists system_logs_severity_created_at_idx
  on public.system_logs (severity, created_at desc);
create index if not exists system_logs_area_created_at_idx
  on public.system_logs (area, created_at desc);
create index if not exists system_logs_event_code_created_at_idx
  on public.system_logs (event_code, created_at desc);

alter table public.system_logs enable row level security;

revoke all on table public.system_logs from public, anon, authenticated;
grant select, insert on table public.system_logs to service_role;

comment on table public.system_logs is
  'Sanitized operational and browser diagnostics for the restricted LakayGoPay Admin live logs panel.';

do $verify_system_logs$
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'system_logs'
      and c.relrowsecurity
  ) then
    raise exception 'SYSTEM_LOGS_RLS_NOT_ENABLED';
  end if;

  if has_table_privilege('anon', 'public.system_logs', 'SELECT')
     or has_table_privilege('authenticated', 'public.system_logs', 'SELECT') then
    raise exception 'SYSTEM_LOGS_MUST_NOT_BE_PUBLICLY_READABLE';
  end if;

  if not has_table_privilege('service_role', 'public.system_logs', 'INSERT')
     or not has_table_privilege('service_role', 'public.system_logs', 'SELECT') then
    raise exception 'SYSTEM_LOGS_SERVICE_ROLE_GRANT_MISSING';
  end if;
end;
$verify_system_logs$;

commit;
