-- LakayGoPay Admin Control Center v1.
-- Additive only: role scopes, isolated treasury revenue accounts, private secretariat.
-- Does NOT activate fee collection, external payments, withdrawals, or real-money rails.

begin;

-- 1) Extend the existing staff-role constraint without granting new roles broad
-- customer-table RLS access. Accountant and secretary access is server-mediated.
do $roles$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
      from pg_constraint
     where conrelid = 'public.user_roles'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.user_roles drop constraint %I', v_constraint.conname);
  end loop;
end;
$roles$;

alter table public.user_roles
  add constraint user_roles_role_check
  check (role in (
    'super_admin','admin','finance_admin','risk_admin',
    'support_agent','auditor','accountant','secretary'
  ));

-- IMPORTANT: public.has_any_admin_role() intentionally remains unchanged.
-- Accountant/secretary do not inherit broad RLS visibility to customer profiles,
-- wallets, ledger entries, or private records.

-- 2) Give system wallets a purpose. Existing system wallets remain "clearing";
-- create a separate zero-balance revenue wallet for each supported currency.
alter table public.wallets
  add column if not exists system_account_code text;

update public.wallets
   set system_account_code = 'clearing'
 where is_system = true
   and system_account_code is null;

create or replace function public.set_system_wallet_account_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_system then
    new.system_account_code := coalesce(nullif(btrim(new.system_account_code), ''), 'clearing');
  else
    new.system_account_code := null;
  end if;
  return new;
end;
$$;

drop trigger if exists wallets_set_system_account_code on public.wallets;
create trigger wallets_set_system_account_code
before insert or update of is_system, system_account_code on public.wallets
for each row execute function public.set_system_wallet_account_code();

drop index if exists public.wallets_system_currency_uq;
create unique index if not exists wallets_system_currency_account_uq
  on public.wallets(currency, system_account_code)
  where is_system = true;

-- Keep the existing clearing-balance convention. The dedicated revenue account
-- uses the normal credit-minus-debit convention so fee income increases its balance.
create or replace view public.wallet_balances with (security_invoker = true) as
select w.id as wallet_id,
       w.owner_user_id,
       w.merchant_id,
       w.currency,
       w.status,
       coalesce(sum(case
         when w.is_system and w.system_account_code = 'platform_revenue'
           then case when e.direction = 'credit' then e.amount else -e.amount end
         when w.is_system
           then case when e.direction = 'debit' then e.amount else -e.amount end
         else case when e.direction = 'credit' then e.amount else -e.amount end
       end), 0)::numeric(20,2) as balance,
       w.created_at,
       w.is_system,
       w.system_account_code
from public.wallets w
left join public.ledger_entries e on e.wallet_id = w.id
group by w.id;

insert into public.wallets(owner_user_id, merchant_id, currency, status, is_system, system_account_code)
select null, null, c.currency, 'active', true, 'platform_revenue'
  from (values ('HTG'::char(3)), ('USD'::char(3)), ('EUR'::char(3))) as c(currency)
on conflict do nothing;

comment on column public.wallets.system_account_code is
  'Internal system-account purpose, e.g. clearing or platform_revenue. Not editable by clients.';
comment on view public.wallet_balances is
  'Derived balances from immutable ledger entries. System clearing and platform revenue accounts use separate sign conventions.';

-- 3) Team-role administration: only the Super Administrateur may grant/revoke
-- staff roles. Super Admin itself is deliberately not assignable through this RPC.
create or replace function public.admin_set_user_role(
  p_admin_user_id uuid,
  p_target_user_id uuid,
  p_role text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer := 0;
begin
  if p_admin_user_id is null or p_target_user_id is null then
    raise exception 'ADMIN_ROLE_ARGUMENT_INVALID';
  end if;
  if not exists (
    select 1 from public.user_roles
     where user_id = p_admin_user_id and role = 'super_admin'
  ) then
    raise exception 'SUPER_ADMIN_REQUIRED';
  end if;
  if p_role is null or p_role not in (
    'admin','finance_admin','risk_admin','support_agent','auditor','accountant','secretary'
  ) then
    raise exception 'ADMIN_ROLE_INVALID';
  end if;
  if p_action not in ('grant','revoke') then
    raise exception 'ADMIN_ROLE_ACTION_INVALID';
  end if;
  if not exists (select 1 from auth.users where id = p_target_user_id) then
    raise exception 'USER_NOT_FOUND';
  end if;

  if p_action = 'grant' then
    insert into public.user_roles(user_id, role, assigned_by)
    values (p_target_user_id, p_role, p_admin_user_id)
    on conflict (user_id, role) do nothing;
    get diagnostics v_changed = row_count;
  else
    delete from public.user_roles
     where user_id = p_target_user_id and role = p_role;
    get diagnostics v_changed = row_count;
  end if;

  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id, outcome, metadata)
  values (
    p_admin_user_id,
    case when p_action = 'grant' then 'admin.role.granted' else 'admin.role.revoked' end,
    'user_role',
    p_target_user_id,
    'success',
    jsonb_build_object('role', p_role, 'action', p_action, 'changed', v_changed)
  );

  return jsonb_build_object(
    'ok', true,
    'target_user_id', p_target_user_id,
    'role', p_role,
    'action', p_action,
    'changed', v_changed
  );
end;
$$;
revoke all on function public.admin_set_user_role(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.admin_set_user_role(uuid,uuid,text,text) to service_role;

-- 4) Secretarial access is explicitly assigned to one Super Admin. A secretary
-- cannot see other owners' secretariat data, finance records, or customer wallets.
create table if not exists public.admin_secretariat_access (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  assistant_user_id uuid not null unique references auth.users(id) on delete cascade,
  assigned_by uuid not null references auth.users(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (owner_user_id <> assistant_user_id)
);
create index if not exists admin_secretariat_access_owner_idx
  on public.admin_secretariat_access(owner_user_id, active);

create table if not exists public.admin_secretariat_items (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null check (item_type in ('task','meeting','note','contact','document','reminder')),
  title text not null check (length(trim(title)) between 1 and 160),
  details text not null default '' check (length(details) <= 5000),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admin_secretariat_items_owner_due_idx
  on public.admin_secretariat_items(owner_user_id, due_at, created_at desc);

alter table public.admin_secretariat_access enable row level security;
alter table public.admin_secretariat_items enable row level security;
revoke all on table public.admin_secretariat_access, public.admin_secretariat_items
  from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_secretariat_access to service_role;
grant select, insert, update, delete on table public.admin_secretariat_items to service_role;

create or replace function public.audit_admin_secretariat_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_actor uuid;
  v_resource uuid;
  v_action text;
begin
  if tg_table_name = 'admin_secretariat_access' then
    v_owner := coalesce(new.owner_user_id, old.owner_user_id);
    v_actor := coalesce(new.assigned_by, old.assigned_by);
    v_resource := coalesce(new.id, old.id);
    v_action := case when tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.active and not new.active)
      then 'secretariat.access.revoked' else 'secretariat.access.granted' end;
  else
    v_owner := coalesce(new.owner_user_id, old.owner_user_id);
    v_actor := coalesce(new.updated_by, new.created_by, old.updated_by, old.created_by);
    v_resource := coalesce(new.id, old.id);
    v_action := case when tg_op = 'INSERT' then 'secretariat.item.created'
      when tg_op = 'DELETE' then 'secretariat.item.deleted'
      else 'secretariat.item.updated' end;
  end if;

  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id, outcome, metadata)
  values (
    v_actor,
    v_action,
    tg_table_name,
    v_resource,
    'success',
    jsonb_build_object('owner_user_id', v_owner, 'operation', tg_op)
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists admin_secretariat_access_audit on public.admin_secretariat_access;
create trigger admin_secretariat_access_audit
after insert or update or delete on public.admin_secretariat_access
for each row execute function public.audit_admin_secretariat_change();

drop trigger if exists admin_secretariat_items_audit on public.admin_secretariat_items;
create trigger admin_secretariat_items_audit
after insert or update or delete on public.admin_secretariat_items
for each row execute function public.audit_admin_secretariat_change();

-- 5) Let newly-added staff roles complete their own Admin PIN step. This does
-- not grant those roles the broader RLS policies reserved for existing roles.
do $pin_roles$
declare
  v_definition text;
  v_old text := $old$and r.role in ('super_admin','admin','finance_admin','risk_admin')$old$;
  v_new text := $new$and r.role in ('super_admin','admin','finance_admin','risk_admin','accountant','secretary','auditor','support_agent')$new$;
begin
  v_definition := pg_get_functiondef('public.record_admin_pin_attempt(uuid,boolean,uuid)'::regprocedure);
  if position(v_old in v_definition) = 0 then
    raise exception 'ADMIN_PIN_ROLE_GUARD_NOT_FOUND';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$pin_roles$;

-- Accountants and auditors may run read-only ledger integrity checks. No role
-- receives permission to edit ledger rows or change wallet balances directly.
do $audit_roles$
declare
  v_definition text;
  v_old text := $old$or public.has_role_for_user(p_admin_user_id,'risk_admin')$old$;
  v_new text := $new$or public.has_role_for_user(p_admin_user_id,'risk_admin')
    or public.has_role_for_user(p_admin_user_id,'accountant')
    or public.has_role_for_user(p_admin_user_id,'auditor')$new$;
begin
  v_definition := pg_get_functiondef('public.run_ledger_integrity_check(uuid)'::regprocedure);
  if position(v_old in v_definition) = 0 then
    raise exception 'LEDGER_AUDIT_ROLE_GUARD_NOT_FOUND';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$audit_roles$;

commit;
