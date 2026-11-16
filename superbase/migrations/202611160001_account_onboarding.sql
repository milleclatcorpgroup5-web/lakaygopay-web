-- LakayGoPay onboarding v1: personal accounts, merchant accounts and agent approval.
-- Apply AFTER the existing financial migrations in Supabase SQL Editor.
-- No real-money rails or agent permissions are opened by this migration.

begin;

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists date_of_birth date,
  add column if not exists account_type text not null default 'personal';

alter table public.profiles
  drop constraint if exists profiles_account_type_check;
alter table public.profiles
  add constraint profiles_account_type_check
  check (account_type in ('personal','merchant'));

alter table public.merchants
  add column if not exists contact_email text;

-- Validate account age and required metadata before Auth creates the user.
create or replace function public.validate_lgp_auth_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_dob date;
  v_phone text;
begin
  v_type := coalesce(nullif(new.raw_user_meta_data->>'account_type',''),'personal');

  if v_type not in ('personal','merchant') then
    raise exception 'INVALID_ACCOUNT_TYPE';
  end if;

  if v_type = 'personal' then
    if length(trim(coalesce(new.raw_user_meta_data->>'first_name',''))) < 1
       or length(trim(coalesce(new.raw_user_meta_data->>'last_name',''))) < 1 then
      raise exception 'FIRST_AND_LAST_NAME_REQUIRED';
    end if;

    v_phone := trim(coalesce(new.raw_user_meta_data->>'phone',''));
    if length(v_phone) < 8 or length(v_phone) > 24 then
      raise exception 'VALID_PHONE_REQUIRED';
    end if;

    begin
      v_dob := (new.raw_user_meta_data->>'date_of_birth')::date;
    exception when others then
      raise exception 'VALID_DATE_OF_BIRTH_REQUIRED';
    end;

    if v_dob is null or v_dob > current_date - interval '18 years' then
      raise exception 'MINIMUM_AGE_18';
    end if;

  elsif v_type = 'merchant' then
    if length(trim(coalesce(new.raw_user_meta_data->>'business_name',''))) not between 2 and 120 then
      raise exception 'VALID_BUSINESS_NAME_REQUIRED';
    end if;
    v_phone := trim(coalesce(new.raw_user_meta_data->>'business_phone',''));
    if length(v_phone) < 8 or length(v_phone) > 24 then
      raise exception 'VALID_BUSINESS_PHONE_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists a_lgp_validate_auth_signup on auth.users;
create trigger a_lgp_validate_auth_signup
before insert on auth.users
for each row execute function public.validate_lgp_auth_signup();

-- Enrich the existing profile created by the project's original auth trigger.
create or replace function public.sync_lgp_onboarding_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_dob date;
  v_phone text;
begin
  v_type := coalesce(nullif(new.raw_user_meta_data->>'account_type',''),'personal');
  v_phone := coalesce(nullif(new.raw_user_meta_data->>'phone',''), new.phone);
  if nullif(new.raw_user_meta_data->>'date_of_birth','') is not null then
    v_dob := (new.raw_user_meta_data->>'date_of_birth')::date;
  end if;

  update public.profiles
     set full_name = coalesce(
           nullif(trim(new.raw_user_meta_data->>'full_name'),''),
           nullif(trim(concat_ws(' ',
             new.raw_user_meta_data->>'first_name',
             new.raw_user_meta_data->>'last_name'
           )),''),
           nullif(trim(new.raw_user_meta_data->>'business_name'),''),
           full_name
         ),
         first_name = nullif(trim(new.raw_user_meta_data->>'first_name'),''),
         last_name = nullif(trim(new.raw_user_meta_data->>'last_name'),''),
         date_of_birth = coalesce(v_dob, date_of_birth),
         account_type = v_type,
         phone = coalesce(v_phone, phone)
   where id = new.id;

  return new;
end;
$$;

drop trigger if exists z_lgp_sync_onboarding_profile on auth.users;
create trigger z_lgp_sync_onboarding_profile
after insert on auth.users
for each row execute function public.sync_lgp_onboarding_profile();

create table if not exists public.agent_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_user_id uuid not null references auth.users(id) on delete cascade,
  contact_phone text not null,
  department text not null,
  commune text not null,
  business_address text,
  motivation text,
  status text not null default 'submitted'
    check (status in ('submitted','under_review','approved','rejected','cancelled')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agent_applications_one_open_per_user
  on public.agent_applications(applicant_user_id)
  where status in ('submitted','under_review');
create index if not exists agent_applications_status_created_idx
  on public.agent_applications(status, created_at);

create table if not exists public.agent_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  application_id uuid not null unique references public.agent_applications(id),
  agent_code text not null unique default (
    'LGA-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))
  ),
  status text not null default 'active' check (status in ('active','suspended','closed')),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.agent_applications enable row level security;
alter table public.agent_applications force row level security;
alter table public.agent_accounts enable row level security;
alter table public.agent_accounts force row level security;

revoke all on public.agent_applications from public, anon, authenticated;
revoke all on public.agent_accounts from public, anon, authenticated;
grant select, insert, update on public.agent_applications to service_role;
grant select, insert, update on public.agent_accounts to service_role;

create or replace function public.submit_agent_application(
  p_user_id uuid,
  p_contact_phone text,
  p_department text,
  p_commune text,
  p_business_address text default null,
  p_motivation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.agent_applications%rowtype;
  v_id uuid;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'AUTH_REQUIRED';
  end if;
  if length(trim(coalesce(p_contact_phone,''))) not between 8 and 24 then
    raise exception 'VALID_PHONE_REQUIRED';
  end if;
  if length(trim(coalesce(p_department,''))) not between 2 and 80 then
    raise exception 'DEPARTMENT_REQUIRED';
  end if;
  if length(trim(coalesce(p_commune,''))) not between 2 and 100 then
    raise exception 'COMMUNE_REQUIRED';
  end if;
  if p_business_address is not null and length(p_business_address) > 200 then
    raise exception 'AGENT_ADDRESS_TOO_LONG';
  end if;
  if p_motivation is not null and length(p_motivation) > 1000 then
    raise exception 'AGENT_MOTIVATION_TOO_LONG';
  end if;

  if exists (select 1 from public.agent_accounts where user_id = p_user_id and status = 'active') then
    raise exception 'AGENT_ALREADY_ACTIVE';
  end if;

  select * into v_existing
    from public.agent_applications
   where applicant_user_id = p_user_id
     and status in ('submitted','under_review')
   order by created_at desc
   limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'application_id', v_existing.id,
      'status', v_existing.status,
      'already_submitted', true
    );
  end if;

  insert into public.agent_applications(
    applicant_user_id, contact_phone, department, commune, business_address, motivation
  ) values (
    p_user_id, trim(p_contact_phone), trim(p_department), trim(p_commune),
    nullif(trim(coalesce(p_business_address,'')), ''),
    nullif(trim(coalesce(p_motivation,'')), '')
  ) returning id into v_id;

  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  values (
    p_user_id, 'agent.application.submitted', 'agent_application', v_id,
    jsonb_build_object('department',trim(p_department),'commune',trim(p_commune))
  );

  return jsonb_build_object(
    'application_id', v_id,
    'status', 'submitted',
    'already_submitted', false
  );
end;
$$;

revoke all on function public.submit_agent_application(uuid,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.submit_agent_application(uuid,text,text,text,text,text)
  to service_role;

create or replace function public.review_agent_application(
  p_admin_user_id uuid,
  p_application_id uuid,
  p_decision text,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application public.agent_applications%rowtype;
  v_agent_id uuid;
  v_code text;
begin
  if p_admin_user_id is null or not (
    public.has_role_for_user(p_admin_user_id,'super_admin')
    or public.has_role_for_user(p_admin_user_id,'admin')
    or public.has_role_for_user(p_admin_user_id,'risk_admin')
  ) then
    raise exception 'ADMIN_ROLE_REQUIRED';
  end if;

  if p_decision not in ('approved','rejected') then
    raise exception 'INVALID_DECISION';
  end if;
  if p_admin_note is not null and length(p_admin_note) > 1000 then
    raise exception 'ADMIN_NOTE_TOO_LONG';
  end if;

  select * into v_application
    from public.agent_applications
   where id = p_application_id
   for update;

  if v_application.id is null then raise exception 'AGENT_APPLICATION_NOT_FOUND'; end if;
  if v_application.status not in ('submitted','under_review') then
    raise exception 'AGENT_APPLICATION_NOT_REVIEWABLE';
  end if;

  update public.agent_applications
     set status = p_decision,
         reviewed_by = p_admin_user_id,
         reviewed_at = now(),
         admin_note = nullif(trim(coalesce(p_admin_note,'')),''),
         updated_at = now()
   where id = p_application_id;

  if p_decision = 'approved' then
    insert into public.agent_accounts(user_id, application_id, approved_by)
    values (v_application.applicant_user_id, v_application.id, p_admin_user_id)
    returning id, agent_code into v_agent_id, v_code;
  end if;

  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  values (
    p_admin_user_id,
    case when p_decision = 'approved' then 'agent.application.approved' else 'agent.application.rejected' end,
    'agent_application',
    p_application_id,
    jsonb_build_object('applicant_user_id',v_application.applicant_user_id,'agent_code',v_code,'admin_note',p_admin_note)
  );

  return jsonb_build_object(
    'application_id', p_application_id,
    'status', p_decision,
    'agent_account_id', v_agent_id,
    'agent_code', v_code
  );
end;
$$;

revoke all on function public.review_agent_application(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.review_agent_application(uuid,uuid,text,text)
  to service_role;

commit;
