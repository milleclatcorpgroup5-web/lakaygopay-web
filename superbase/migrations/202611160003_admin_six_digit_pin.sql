-- LakayGoPay: second-factor 6-digit Admin PIN.
-- Store only a salted PBKDF2 hash. Five failed attempts trigger a 15-minute lock.
-- Apply this migration in Supabase SQL Editor before using the new Admin login.

begin;

create table if not exists public.admin_security (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null check (pin_hash ~ '^[a-f0-9]{64}$'),
  pin_salt text not null check (pin_salt ~ '^[a-f0-9]{32}$'),
  pin_iterations integer not null default 600000
    check (pin_iterations between 600000 and 1000000),
  failed_attempts integer not null default 0
    check (failed_attempts between 0 and 1000),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_verified_at timestamptz
);

alter table public.admin_security enable row level security;
revoke all on public.admin_security from public, anon, authenticated;
grant select, insert, update on public.admin_security to service_role;

create or replace function public.record_admin_pin_attempt(
  p_user_id uuid,
  p_success boolean
)
returns table (
  is_locked boolean,
  locked_until timestamptz,
  failed_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failed integer;
  v_locked_until timestamptz;
begin
  if p_user_id is null or p_success is null then
    raise exception 'ADMIN_PIN_ARGUMENT_INVALID';
  end if;

  if not exists (
    select 1 from public.user_roles r
     where r.user_id = p_user_id
       and r.role in ('super_admin','admin','finance_admin','risk_admin')
  ) then
    raise exception 'ADMIN_ROLE_REQUIRED';
  end if;

  select s.failed_attempts, s.locked_until
    into v_failed, v_locked_until
    from public.admin_security s
   where s.user_id = p_user_id
   for update;

  if not found then
    raise exception 'ADMIN_PIN_NOT_SET';
  end if;

  -- Even a correct PIN cannot bypass a lock triggered by a concurrent request.
  if v_locked_until is not null and v_locked_until > clock_timestamp() then
    return query select true, v_locked_until, v_failed;
    return;
  end if;

  if p_success then
    v_failed := 0;
    v_locked_until := null;
    update public.admin_security
       set failed_attempts = 0,
           locked_until = null,
           last_verified_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where user_id = p_user_id;
  else
    v_failed := least(v_failed + 1, 1000);
    v_locked_until := case
      when v_failed >= 5 then clock_timestamp() + interval '15 minutes'
      else null
    end;
    update public.admin_security
       set failed_attempts = v_failed,
           locked_until = v_locked_until,
           updated_at = clock_timestamp()
     where user_id = p_user_id;
  end if;

  return query
  select (v_locked_until is not null and v_locked_until > clock_timestamp()),
         v_locked_until, v_failed;
end;
$$;

revoke all on function public.record_admin_pin_attempt(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.record_admin_pin_attempt(uuid, boolean)
  to service_role;

commit;
