-- Controlled account suspension/reactivation by a privileged Admin.
-- Suspended profiles are rejected centrally by the authenticated API middleware.

begin;

alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();

-- Ensure the six-digit second factor exists even when earlier optional
-- Admin-PIN migrations were not run. The application stores only PBKDF2 hashes.
create table if not exists public.admin_security (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null check (pin_hash ~ '^[a-f0-9]{64}
-- Keep the migration self-contained when the role table was created manually
-- before the canonical financial migrations were applied.
create or replace function public.has_role_for_user(p_user_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $role_check$
  select
    exists (
      select 1 from public.user_roles ur
       where ur.user_id = p_user_id and ur.role = p_role
    )
    or exists (
      select 1 from public.user_roles ur
       where ur.user_id = p_user_id and ur.role = 'super_admin'
    );
$role_check$;
revoke all on function public.has_role_for_user(uuid,text) from public, anon, authenticated;
grant execute on function public.has_role_for_user(uuid,text) to service_role;
 
-- Serialize PIN attempts in the database. Five failures lock the Admin PIN
-- for 15 minutes and clear the active session verification.
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
as $admin_attempt$
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
  if not found then raise exception 'ADMIN_PIN_NOT_SET'; end if;

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
$admin_attempt$;

revoke all on function public.record_admin_pin_attempt(uuid,boolean,uuid)
  from public, anon, authenticated;
grant execute on function public.record_admin_pin_attempt(uuid,boolean,uuid)
  to service_role;



create or replace function public.admin_set_user_account_status(
  p_admin_user_id uuid,
  p_target_user_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text;
  v_super_admin_count integer;
begin
  if p_admin_user_id is null or p_target_user_id is null then
    raise exception 'USER_STATUS_ARGUMENT_INVALID';
  end if;
  if p_admin_user_id = p_target_user_id then
    raise exception 'ADMIN_CANNOT_SUSPEND_SELF';
  end if;
  if not (
    public.has_role_for_user(p_admin_user_id,'super_admin')
    or public.has_role_for_user(p_admin_user_id,'admin')
    or public.has_role_for_user(p_admin_user_id,'risk_admin')
  ) then
    raise exception 'ADMIN_ROLE_REQUIRED';
  end if;
  if p_status not in ('active','suspended') then
    raise exception 'USER_STATUS_INVALID';
  end if;

  select p.account_status
    into v_previous
    from public.profiles p
   where p.id = p_target_user_id
   for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  if p_status = 'suspended' and exists (
    select 1 from public.user_roles r
     where r.user_id = p_target_user_id and r.role = 'super_admin'
  ) then
    if not public.has_role_for_user(p_admin_user_id,'super_admin') then
      raise exception 'SUPER_ADMIN_ACCOUNT_PROTECTED';
    end if;
    select count(*) into v_super_admin_count
      from public.user_roles r
      join public.profiles p on p.id = r.user_id
     where r.role = 'super_admin' and p.account_status = 'active';
    if v_super_admin_count <= 1 then raise exception 'LAST_SUPER_ADMIN_PROTECTED'; end if;
  end if;

  update public.profiles
     set account_status = p_status,
         updated_at = clock_timestamp()
   where id = p_target_user_id;

  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id, outcome, metadata)
  values (
    p_admin_user_id,
    'user.account_status.changed',
    'profile',
    p_target_user_id,
    'success',
    jsonb_build_object(
      'previous_status', v_previous,
      'new_status', p_status,
      'reason', left(coalesce(p_reason,''),500)
    )
  );

  return jsonb_build_object(
    'user_id', p_target_user_id,
    'previous_status', v_previous,
    'account_status', p_status
  );
end;
$$;

revoke all on function public.admin_set_user_account_status(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.admin_set_user_account_status(uuid,uuid,text,text)
  to service_role;

-- The Worker checks the verified admin role through this existing helper.
-- It is not exposed to anon/authenticated clients.
grant execute on function public.has_role_for_user(uuid,text) to service_role;

commit;
),
  pin_salt text not null check (pin_salt ~ '^[a-f0-9]{32}
-- Keep the migration self-contained when the role table was created manually
-- before the canonical financial migrations were applied.
create or replace function public.has_role_for_user(p_user_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $role_check$
  select
    exists (
      select 1 from public.user_roles ur
       where ur.user_id = p_user_id and ur.role = p_role
    )
    or exists (
      select 1 from public.user_roles ur
       where ur.user_id = p_user_id and ur.role = 'super_admin'
    );
$role_check$;
revoke all on function public.has_role_for_user(uuid,text) from public, anon, authenticated;
grant execute on function public.has_role_for_user(uuid,text) to service_role;


create or replace function public.admin_set_user_account_status(
  p_admin_user_id uuid,
  p_target_user_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text;
  v_super_admin_count integer;
begin
  if p_admin_user_id is null or p_target_user_id is null then
    raise exception 'USER_STATUS_ARGUMENT_INVALID';
  end if;
  if p_admin_user_id = p_target_user_id then
    raise exception 'ADMIN_CANNOT_SUSPEND_SELF';
  end if;
  if not (
    public.has_role_for_user(p_admin_user_id,'super_admin')
    or public.has_role_for_user(p_admin_user_id,'admin')
    or public.has_role_for_user(p_admin_user_id,'risk_admin')
  ) then
    raise exception 'ADMIN_ROLE_REQUIRED';
  end if;
  if p_status not in ('active','suspended') then
    raise exception 'USER_STATUS_INVALID';
  end if;

  select p.account_status
    into v_previous
    from public.profiles p
   where p.id = p_target_user_id
   for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  if p_status = 'suspended' and exists (
    select 1 from public.user_roles r
     where r.user_id = p_target_user_id and r.role = 'super_admin'
  ) then
    if not public.has_role_for_user(p_admin_user_id,'super_admin') then
      raise exception 'SUPER_ADMIN_ACCOUNT_PROTECTED';
    end if;
    select count(*) into v_super_admin_count
      from public.user_roles r
      join public.profiles p on p.id = r.user_id
     where r.role = 'super_admin' and p.account_status = 'active';
    if v_super_admin_count <= 1 then raise exception 'LAST_SUPER_ADMIN_PROTECTED'; end if;
  end if;

  update public.profiles
     set account_status = p_status,
         updated_at = clock_timestamp()
   where id = p_target_user_id;

  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id, outcome, metadata)
  values (
    p_admin_user_id,
    'user.account_status.changed',
    'profile',
    p_target_user_id,
    'success',
    jsonb_build_object(
      'previous_status', v_previous,
      'new_status', p_status,
      'reason', left(coalesce(p_reason,''),500)
    )
  );

  return jsonb_build_object(
    'user_id', p_target_user_id,
    'previous_status', v_previous,
    'account_status', p_status
  );
end;
$$;

revoke all on function public.admin_set_user_account_status(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.admin_set_user_account_status(uuid,uuid,text,text)
  to service_role;

-- The Worker checks the verified admin role through this existing helper.
-- It is not exposed to anon/authenticated clients.
grant execute on function public.has_role_for_user(uuid,text) to service_role;

commit;
),
  pin_iterations integer not null default 600000 check (pin_iterations between 600000 and 1000000),
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 1000),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_verified_at timestamptz,
  last_verified_session_id uuid
);

alter table public.admin_security
  add column if not exists pin_iterations integer not null default 600000,
  add column if not exists failed_attempts integer not null default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_verified_at timestamptz,
  add column if not exists last_verified_session_id uuid;

alter table public.admin_security enable row level security;
revoke all on public.admin_security from public, anon, authenticated;
grant select, insert, update on public.admin_security to service_role;


-- Keep the migration self-contained when the role table was created manually
-- before the canonical financial migrations were applied.
create or replace function public.has_role_for_user(p_user_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $role_check$
  select
    exists (
      select 1 from public.user_roles ur
       where ur.user_id = p_user_id and ur.role = p_role
    )
    or exists (
      select 1 from public.user_roles ur
       where ur.user_id = p_user_id and ur.role = 'super_admin'
    );
$role_check$;
revoke all on function public.has_role_for_user(uuid,text) from public, anon, authenticated;
grant execute on function public.has_role_for_user(uuid,text) to service_role;


create or replace function public.admin_set_user_account_status(
  p_admin_user_id uuid,
  p_target_user_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text;
  v_super_admin_count integer;
begin
  if p_admin_user_id is null or p_target_user_id is null then
    raise exception 'USER_STATUS_ARGUMENT_INVALID';
  end if;
  if p_admin_user_id = p_target_user_id then
    raise exception 'ADMIN_CANNOT_SUSPEND_SELF';
  end if;
  if not (
    public.has_role_for_user(p_admin_user_id,'super_admin')
    or public.has_role_for_user(p_admin_user_id,'admin')
    or public.has_role_for_user(p_admin_user_id,'risk_admin')
  ) then
    raise exception 'ADMIN_ROLE_REQUIRED';
  end if;
  if p_status not in ('active','suspended') then
    raise exception 'USER_STATUS_INVALID';
  end if;

  select p.account_status
    into v_previous
    from public.profiles p
   where p.id = p_target_user_id
   for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  if p_status = 'suspended' and exists (
    select 1 from public.user_roles r
     where r.user_id = p_target_user_id and r.role = 'super_admin'
  ) then
    if not public.has_role_for_user(p_admin_user_id,'super_admin') then
      raise exception 'SUPER_ADMIN_ACCOUNT_PROTECTED';
    end if;
    select count(*) into v_super_admin_count
      from public.user_roles r
      join public.profiles p on p.id = r.user_id
     where r.role = 'super_admin' and p.account_status = 'active';
    if v_super_admin_count <= 1 then raise exception 'LAST_SUPER_ADMIN_PROTECTED'; end if;
  end if;

  update public.profiles
     set account_status = p_status,
         updated_at = clock_timestamp()
   where id = p_target_user_id;

  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id, outcome, metadata)
  values (
    p_admin_user_id,
    'user.account_status.changed',
    'profile',
    p_target_user_id,
    'success',
    jsonb_build_object(
      'previous_status', v_previous,
      'new_status', p_status,
      'reason', left(coalesce(p_reason,''),500)
    )
  );

  return jsonb_build_object(
    'user_id', p_target_user_id,
    'previous_status', v_previous,
    'account_status', p_status
  );
end;
$$;

revoke all on function public.admin_set_user_account_status(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.admin_set_user_account_status(uuid,uuid,text,text)
  to service_role;

-- The Worker checks the verified admin role through this existing helper.
-- It is not exposed to anon/authenticated clients.
grant execute on function public.has_role_for_user(uuid,text) to service_role;

commit;
