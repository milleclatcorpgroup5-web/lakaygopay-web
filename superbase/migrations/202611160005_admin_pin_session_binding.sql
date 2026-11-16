-- Bind the six-digit Admin PIN to the active Supabase Auth session.
-- Admin overview and all MFA-protected administrative actions must reject
-- sessions that did not complete the PIN challenge in the last 10 minutes.

begin;

alter table public.admin_security
  add column if not exists last_verified_session_id uuid;

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
as $$
declare
  v_failed integer;
  v_locked_until timestamptz;
begin
  if p_user_id is null or p_success is null or p_session_id is null then
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
$$;

revoke all on function public.record_admin_pin_attempt(uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.record_admin_pin_attempt(uuid, boolean, uuid)
  to service_role;

commit;
