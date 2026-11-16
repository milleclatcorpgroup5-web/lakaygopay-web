-- Controlled account suspension/reactivation by a privileged Admin.
-- Suspended profiles are rejected centrally by the authenticated API middleware.

begin;

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

commit;
