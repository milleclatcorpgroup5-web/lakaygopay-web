-- LakayGoPay Admin hardening v2.
-- Fix PIN verification for all staff roles, and add AAL2-protected PIN recovery.
-- No production data is changed by this file until the migration is explicitly run.

begin;

-- The server-side /api/admin/me check uses is_admin_user(). Extend that
-- helper to all explicit staff roles, but keep has_any_admin_role() unchanged
-- so the new least-privilege roles do not gain broad customer-table RLS access.
create or replace function public.is_admin_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $is_admin_user$
  select exists (
    select 1
      from public.user_roles ur
     where ur.user_id = p_user_id
       and ur.role in (
         'super_admin','admin','finance_admin','risk_admin',
         'support_agent','auditor','accountant','secretary'
       )
  );
$is_admin_user$;
revoke all on function public.is_admin_user(uuid) from public, anon, authenticated;
grant execute on function public.is_admin_user(uuid) to service_role;

-- All roles admitted by user_roles must be able to complete the Admin PIN gate.
-- Keep this function server-only and preserve the 5-attempt / 15-minute lock.
create or replace function public.record_admin_pin_attempt(
  p_user_id uuid,
  p_success boolean,
  p_session_id uuid
)
returns table (
  is_locked boolean,
  locked_until timestamptz,
  failed_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $admin_pin_attempt$
declare
  v_failed integer;
  v_locked_until timestamptz;
begin
  if p_user_id is null or p_success is null or p_session_id is null then
    raise exception 'ADMIN_PIN_ARGUMENT_INVALID';
  end if;

  if not exists (
    select 1
      from public.user_roles r
     where r.user_id = p_user_id
       and r.role in (
         'super_admin','admin','finance_admin','risk_admin',
         'support_agent','auditor','accountant','secretary'
       )
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

  if v_locked_until is not null and v_locked_until > clock_timestamp() then
    update public.admin_security
       set last_verified_at = null,
           last_verified_session_id = null,
           updated_at = clock_timestamp()
     where user_id = p_user_id;
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
           last_verified_session_id = p_session_id,
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
           last_verified_at = null,
           last_verified_session_id = null,
           updated_at = clock_timestamp()
     where user_id = p_user_id;
  end if;

  return query
  select (v_locked_until is not null and v_locked_until > clock_timestamp()),
         v_locked_until, v_failed;
end;
$admin_pin_attempt$;

revoke all on function public.record_admin_pin_attempt(uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.record_admin_pin_attempt(uuid, boolean, uuid)
  to service_role;

-- A short-lived one-use challenge backs the forgotten-PIN flow. The user must
-- first prove AAL2/TOTP; this table is never exposed to browser roles.
create table if not exists public.admin_pin_reset_challenges (
  nonce text primary key check (nonce ~ '^[a-f0-9]{32}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_pin_reset_challenges_expiry_idx
  on public.admin_pin_reset_challenges(expires_at);

alter table public.admin_pin_reset_challenges enable row level security;
revoke all on table public.admin_pin_reset_challenges from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_pin_reset_challenges to service_role;

-- Reset is permitted only after the Worker has validated the caller's signed
-- Supabase token at AAL2 and matched the challenge to that exact Auth session.
-- The RPC consumes the challenge and rotates the PIN atomically.
create or replace function public.reset_admin_pin(
  p_user_id uuid,
  p_session_id uuid,
  p_nonce text,
  p_pin_hash text,
  p_pin_salt text,
  p_pin_iterations integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $reset_admin_pin$
declare
  v_challenge public.admin_pin_reset_challenges%rowtype;
begin
  if p_user_id is null or p_session_id is null or
     p_nonce is null or p_nonce !~ '^[a-f0-9]{32}$' or
     p_pin_hash is null or p_pin_hash !~ '^[a-f0-9]{64}$' or
     p_pin_salt is null or p_pin_salt !~ '^[a-f0-9]{32}$' or
     p_pin_iterations is null or p_pin_iterations <> 600000 then
    raise exception 'ADMIN_PIN_RESET_ARGUMENT_INVALID';
  end if;

  if not exists (
    select 1
      from public.user_roles r
     where r.user_id = p_user_id
       and r.role in (
         'super_admin','admin','finance_admin','risk_admin',
         'support_agent','auditor','accountant','secretary'
       )
  ) then
    raise exception 'ADMIN_ROLE_REQUIRED';
  end if;

  select *
    into v_challenge
    from public.admin_pin_reset_challenges c
   where c.nonce = p_nonce
     and c.user_id = p_user_id
     and c.session_id = p_session_id
     and c.consumed_at is null
     and c.expires_at > clock_timestamp()
   for update;

  if not found then
    raise exception 'ADMIN_PIN_RESET_CHALLENGE_INVALID';
  end if;

  update public.admin_pin_reset_challenges
     set consumed_at = clock_timestamp()
   where nonce = p_nonce;

  update public.admin_security
     set pin_hash = p_pin_hash,
         pin_salt = p_pin_salt,
         pin_iterations = p_pin_iterations,
         failed_attempts = 0,
         locked_until = null,
         last_verified_at = clock_timestamp(),
         last_verified_session_id = p_session_id,
         updated_at = clock_timestamp()
   where user_id = p_user_id;

  if not found then
    raise exception 'ADMIN_PIN_NOT_SET';
  end if;

  insert into public.audit_logs(
    actor_user_id, action, resource_type, resource_id, outcome, metadata
  )
  values (
    p_user_id,
    'admin.pin.reset',
    'admin_security',
    p_user_id,
    'success',
    jsonb_build_object('method','aal2_totp_verified','session_bound',true)
  );

  return jsonb_build_object(
    'ok', true,
    'pin_reset', true,
    'session_verified', true
  );
end;
$reset_admin_pin$;

revoke all on function public.reset_admin_pin(uuid,uuid,text,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.reset_admin_pin(uuid,uuid,text,text,text,integer)
  to service_role;

-- Remove expired challenges after a seven-day retention buffer.
delete from public.admin_pin_reset_challenges
 where expires_at < clock_timestamp() - interval '7 days';

commit;
