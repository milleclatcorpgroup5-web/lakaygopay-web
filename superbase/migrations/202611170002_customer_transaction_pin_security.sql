-- Customer/merchant 4-digit transaction PIN.
-- Server-side PBKDF2 hash storage; 3 failed attempts trigger a 15-minute lock.
-- No PIN or salt is exposed to authenticated clients.

begin;

create table if not exists public.user_security (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text,
  pin_salt text,
  pin_iterations integer not null default 600000,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  pin_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_security
  add column if not exists pin_hash text,
  add column if not exists pin_salt text,
  add column if not exists pin_iterations integer not null default 600000,
  add column if not exists failed_attempts integer not null default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists pin_created_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.user_security enable row level security;
revoke all on public.user_security from public, anon, authenticated;
grant select, insert, update on public.user_security to service_role;

-- Insert the first PIN, or rotate an existing PIN only when the server provides
-- the exact previously verified hash. This makes a concurrent PIN change fail
-- rather than silently overwrite another change.
create or replace function public.store_user_pin_hash(
  p_user_id uuid,
  p_pin_hash text,
  p_pin_salt text,
  p_pin_iterations integer,
  p_expected_current_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $store_user_pin$
declare
  v_rows integer;
begin
  if p_user_id is null
     or p_pin_hash is null or p_pin_hash !~ '^[a-f0-9]{64}$'
     or p_pin_salt is null or p_pin_salt !~ '^[a-f0-9]{32}$'
     or p_pin_iterations is null
     or p_pin_iterations not between 600000 and 1000000 then
    raise exception 'PIN_CONFIGURATION_INVALID';
  end if;

  if p_expected_current_hash is null then
    insert into public.user_security(
      user_id, pin_hash, pin_salt, pin_iterations,
      failed_attempts, locked_until, pin_created_at, updated_at
    )
    values (
      p_user_id, p_pin_hash, p_pin_salt, p_pin_iterations,
      0, null, clock_timestamp(), clock_timestamp()
    )
    on conflict (user_id) do update
      set pin_hash = excluded.pin_hash,
          pin_salt = excluded.pin_salt,
          pin_iterations = excluded.pin_iterations,
          failed_attempts = 0,
          locked_until = null,
          pin_created_at = clock_timestamp(),
          updated_at = clock_timestamp()
      where public.user_security.pin_hash is null;
  else
    if p_expected_current_hash !~ '^[a-f0-9]{64}$' then
      raise exception 'PIN_CONFIGURATION_INVALID';
    end if;
    update public.user_security
       set pin_hash = p_pin_hash,
           pin_salt = p_pin_salt,
           pin_iterations = p_pin_iterations,
           failed_attempts = 0,
           locked_until = null,
           pin_created_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where user_id = p_user_id
       and pin_hash = p_expected_current_hash;
  end if;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$store_user_pin$;

revoke all on function public.store_user_pin_hash(uuid,text,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.store_user_pin_hash(uuid,text,text,integer,text)
  to service_role;

-- The row lock serializes PIN attempts. Once the third consecutive failure
-- occurs, even a correct PIN is rejected until the 15-minute lock expires.
create or replace function public.record_pin_attempt(
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
as $record_pin_attempt$
declare
  v_failed integer;
  v_locked_until timestamptz;
begin
  if p_user_id is null or p_success is null then
    raise exception 'PIN_ATTEMPT_ARGUMENT_INVALID';
  end if;

  select s.failed_attempts, s.locked_until
    into v_failed, v_locked_until
    from public.user_security s
   where s.user_id = p_user_id
   for update;

  if not found then
    raise exception 'PIN_NOT_SET';
  end if;

  if v_locked_until is not null and v_locked_until > clock_timestamp() then
    return query select true, v_locked_until, v_failed;
    return;
  end if;

  if p_success then
    v_failed := 0;
    v_locked_until := null;
    update public.user_security
       set failed_attempts = 0,
           locked_until = null,
           updated_at = clock_timestamp()
     where user_id = p_user_id;
  else
    v_failed := least(v_failed + 1, 1000);
    v_locked_until := case
      when v_failed >= 3 then clock_timestamp() + interval '15 minutes'
      else null
    end;
    update public.user_security
       set failed_attempts = v_failed,
           locked_until = v_locked_until,
           updated_at = clock_timestamp()
     where user_id = p_user_id;
  end if;

  return query
  select (v_locked_until is not null and v_locked_until > clock_timestamp()),
         v_locked_until, v_failed;
end;
$record_pin_attempt$;

revoke all on function public.record_pin_attempt(uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.record_pin_attempt(uuid,boolean)
  to service_role;

commit;
