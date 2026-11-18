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

-- Treasury wallet shells may be denominated in HTG, USD, or EUR. This does not
-- enable foreign-currency customer wallets or ledger postings: ledger_entries,
-- transfers and payout records remain HTG-only until FX controls are delivered.
alter table public.wallets
  drop constraint if exists wallets_currency_check;
alter table public.wallets
  add constraint wallets_currency_supported_check
  check (currency in ('HTG','USD','EUR'));

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

-- Seed the dedicated HTG clearing wallet used only by the test-credit RPC.
insert into public.wallets(owner_user_id, merchant_id, currency, status, is_system, system_account_code)
values (null, null, 'HTG', 'active', true, 'clearing')
on conflict do nothing;

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
as $audit_admin_secretariat$
declare
  v_owner uuid;
  v_actor uuid;
  v_resource uuid;
  v_action text;
begin
  if tg_op = 'DELETE' then
    v_owner := old.owner_user_id;
    v_resource := old.id;
    if tg_table_name = 'admin_secretariat_access' then
      v_actor := old.assigned_by;
      v_action := 'secretariat.access.revoked';
    else
      v_actor := coalesce(old.updated_by,old.created_by);
      v_action := 'secretariat.item.deleted';
    end if;
  else
    v_owner := new.owner_user_id;
    v_resource := new.id;
    if tg_table_name = 'admin_secretariat_access' then
      v_actor := new.assigned_by;
      v_action := case when new.active then 'secretariat.access.granted'
        else 'secretariat.access.revoked' end;
    else
      v_actor := coalesce(new.updated_by,new.created_by);
      v_action := case when tg_op = 'INSERT' then 'secretariat.item.created'
        else 'secretariat.item.updated' end;
    end if;
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

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$audit_admin_secretariat$;

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


-- Preserve the original test-credit clearing wallet lookup now that each
-- currency can have more than one system account (clearing vs platform_revenue).
do $test_credit_system_wallet$
declare
  v_definition text;
  v_old text := $old$where is_system = true and currency = 'HTG'$old$;
  v_new text := $new$where is_system = true and currency = 'HTG' and system_account_code = 'clearing'$new$;
begin
  v_definition := pg_get_functiondef('public.create_test_credit(uuid,uuid,numeric,text)'::regprocedure);
  if position(v_old in v_definition) = 0 then
    raise exception 'TEST_CREDIT_SYSTEM_WALLET_LOOKUP_NOT_FOUND';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$test_credit_system_wallet$;


-- 6) Versioned service-fee proposals. Finance can propose; only a Super Admin
-- can approve/reject. Approval records policy intent only; it does not collect
-- fees or activate fee posting in the ledger.
create table if not exists public.platform_fee_proposals (
  id uuid primary key default gen_random_uuid(),
  service_code text not null check (service_code in (
    'internal_transfer','merchant_qr','fx_conversion','cash_in','cash_out','bill_payment'
  )),
  currency char(3) not null check (currency in ('HTG','USD','EUR')),
  fee_kind text not null check (fee_kind in ('fixed','percentage')),
  fee_value numeric(14,6) not null check (fee_value > 0),
  minimum_fee numeric(20,6) not null default 0 check (minimum_fee >= 0),
  maximum_fee numeric(20,6) check (maximum_fee is null or maximum_fee >= minimum_fee),
  version integer not null check (version > 0),
  effective_at timestamptz not null,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected')),
  proposed_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  proposal_note text not null default '' check (length(proposal_note) <= 500),
  decision_note text not null default '' check (length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  unique(service_code, currency, version),
  check (fee_kind <> 'percentage' or fee_value <= 100),
  check (
    (status = 'proposed' and reviewed_by is null and reviewed_at is null)
    or (status in ('approved','rejected') and reviewed_by is not null and reviewed_at is not null)
  )
);
create index if not exists platform_fee_proposals_service_version_idx
  on public.platform_fee_proposals(service_code, currency, version desc);
create index if not exists platform_fee_proposals_status_effective_idx
  on public.platform_fee_proposals(status, effective_at);

alter table public.platform_fee_proposals enable row level security;
revoke all on table public.platform_fee_proposals from public, anon, authenticated, service_role;
grant select on table public.platform_fee_proposals to service_role;

create or replace function public.propose_platform_fee(
  p_actor_user_id uuid,
  p_service_code text,
  p_currency text,
  p_fee_kind text,
  p_fee_value numeric,
  p_effective_at timestamptz,
  p_minimum_fee numeric default 0,
  p_maximum_fee numeric default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $propose_platform_fee$
declare
  v_version integer;
  v_id uuid;
begin
  if not exists (
    select 1 from public.user_roles
     where user_id = p_actor_user_id and role = 'finance_admin'
  ) then
    raise exception 'FINANCE_ROLE_REQUIRED';
  end if;
  if p_service_code is null or p_service_code not in ('internal_transfer','merchant_qr','fx_conversion','cash_in','cash_out','bill_payment') then
    raise exception 'FEE_SERVICE_INVALID';
  end if;
  if p_currency is null or p_currency not in ('HTG','USD','EUR') then
    raise exception 'FEE_CURRENCY_INVALID';
  end if;
  if p_fee_kind is null or p_fee_kind not in ('fixed','percentage') then
    raise exception 'FEE_KIND_INVALID';
  end if;
  if p_fee_value is null or p_fee_value <= 0 or p_fee_value <> round(p_fee_value,6) then
    raise exception 'FEE_VALUE_INVALID';
  end if;
  if p_fee_kind = 'percentage' and p_fee_value > 100 then
    raise exception 'FEE_PERCENTAGE_TOO_HIGH';
  end if;
  if p_minimum_fee is null or p_minimum_fee < 0 or
     (p_maximum_fee is not null and p_maximum_fee < p_minimum_fee) then
    raise exception 'FEE_RANGE_INVALID';
  end if;
  if p_effective_at is null or p_effective_at < clock_timestamp() - interval '5 minutes' then
    raise exception 'FEE_EFFECTIVE_DATE_INVALID';
  end if;
  if length(coalesce(p_note,'')) > 500 then raise exception 'FEE_NOTE_TOO_LONG'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_service_code || ':' || p_currency, 0));
  select coalesce(max(version),0) + 1
    into v_version
    from public.platform_fee_proposals
   where service_code = p_service_code and currency = p_currency;

  insert into public.platform_fee_proposals(
    service_code,currency,fee_kind,fee_value,minimum_fee,maximum_fee,
    version,effective_at,status,proposed_by,proposal_note
  )
  values (
    p_service_code,p_currency,p_fee_kind,p_fee_value,p_minimum_fee,p_maximum_fee,
    v_version,p_effective_at,'proposed',p_actor_user_id,left(coalesce(p_note,''),500)
  )
  returning id into v_id;

  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  values (
    p_actor_user_id,'platform_fee.proposed','platform_fee_proposal',v_id,
    jsonb_build_object(
      'service_code',p_service_code,'currency',p_currency,'fee_kind',p_fee_kind,
      'fee_value',p_fee_value,'version',v_version,'effective_at',p_effective_at
    )
  );
  return jsonb_build_object('id',v_id,'version',v_version,'status','proposed');
end;
$propose_platform_fee$;
revoke all on function public.propose_platform_fee(uuid,text,text,text,numeric,timestamptz,numeric,numeric,text)
  from public,anon,authenticated;
grant execute on function public.propose_platform_fee(uuid,text,text,text,numeric,timestamptz,numeric,numeric,text)
  to service_role;

create or replace function public.review_platform_fee_proposal(
  p_super_admin_user_id uuid,
  p_proposal_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $review_platform_fee$
declare
  v_proposal public.platform_fee_proposals%rowtype;
begin
  if not exists (
    select 1 from public.user_roles
     where user_id = p_super_admin_user_id and role = 'super_admin'
  ) then
    raise exception 'SUPER_ADMIN_REQUIRED';
  end if;
  if p_decision is null or p_decision not in ('approve','reject') then raise exception 'FEE_DECISION_INVALID'; end if;
  if length(coalesce(p_decision_note,'')) > 500 then raise exception 'FEE_NOTE_TOO_LONG'; end if;

  select * into v_proposal
    from public.platform_fee_proposals
   where id = p_proposal_id
   for update;
  if v_proposal.id is null then raise exception 'FEE_PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.status <> 'proposed' then raise exception 'FEE_PROPOSAL_ALREADY_REVIEWED'; end if;
  if v_proposal.proposed_by = p_super_admin_user_id then
    raise exception 'MAKER_CANNOT_APPROVE_OWN_FEE_PROPOSAL';
  end if;

  update public.platform_fee_proposals
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         reviewed_by = p_super_admin_user_id,
         reviewed_at = clock_timestamp(),
         decision_note = left(coalesce(p_decision_note,''),500)
   where id = p_proposal_id;

  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  values (
    p_super_admin_user_id,
    case when p_decision = 'approve' then 'platform_fee.approved' else 'platform_fee.rejected' end,
    'platform_fee_proposal',
    p_proposal_id,
    jsonb_build_object(
      'service_code',v_proposal.service_code,'currency',v_proposal.currency,
      'version',v_proposal.version,'decision_note',left(coalesce(p_decision_note,''),500)
    )
  );
  return jsonb_build_object(
    'id',p_proposal_id,
    'version',v_proposal.version,
    'status',case when p_decision = 'approve' then 'approved' else 'rejected' end,
    'fee_engine_activated',false
  );
end;
$review_platform_fee$;
revoke all on function public.review_platform_fee_proposal(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.review_platform_fee_proposal(uuid,uuid,text,text)
  to service_role;

-- 7) Large withdrawals need a Super Admin in the approval chain. Any withdrawal
-- outside HTG also needs Super Admin approval because there is no FX conversion
-- or comparable threshold in this beta ledger. The existing two-person rule
-- remains in force when the threshold is met.
do $withdrawal_super_admin$
declare
  v_definition text;
  v_old_decl text := $old$v_approved integer;$old$;
  v_new_decl text := $new$v_approved integer;
  v_super_admin_approved integer;
$new$;
  v_old_role text := $old$if not (public.has_role_for_user(p_admin_user_id,'admin') or public.has_role_for_user(p_admin_user_id,'finance_admin') or public.has_role_for_user(p_admin_user_id,'risk_admin')) then raise exception 'ADMIN_ROLE_REQUIRED'; end if;$old$;
  v_new_role text := $new$if not (public.has_role_for_user(p_admin_user_id,'super_admin') or public.has_role_for_user(p_admin_user_id,'admin') or public.has_role_for_user(p_admin_user_id,'finance_admin') or public.has_role_for_user(p_admin_user_id,'risk_admin')) then raise exception 'ADMIN_ROLE_REQUIRED'; end if;$new$;
  v_old_required text := $old$v_required := case when v_request.amount >= v_threshold then 2 else 1 end;$old$;
  v_new_required text := $new$v_required := case when v_request.currency <> 'HTG' or v_request.amount >= v_threshold then 2 else 1 end;$new$;
  v_old_status text := $old$v_status := case when v_approved >= v_required then 'approved' else 'awaiting_second_approval' end;$old$;
  v_new_status text := $new$select count(*) into v_super_admin_approved
        from public.withdrawal_approvals wa
        join public.user_roles ur on ur.user_id = wa.admin_user_id
       where wa.withdrawal_id = p_withdrawal_id
         and wa.decision = 'approved'
         and ur.role = 'super_admin';

      v_status := case
        when v_approved >= v_required
         and (v_request.currency = 'HTG' and v_request.amount < v_threshold or v_super_admin_approved >= 1)
        then 'approved'
        else 'awaiting_second_approval'
      end;$new$;
begin
  v_definition := pg_get_functiondef('public.record_withdrawal_approval(uuid,uuid,text,text)'::regprocedure);
  if position(v_old_decl in v_definition) = 0 or
     position(v_old_role in v_definition) = 0 or
     position(v_old_required in v_definition) = 0 or
     position(v_old_status in v_definition) = 0 then
    raise exception 'WITHDRAWAL_SUPER_ADMIN_GUARD_NOT_FOUND';
  end if;
  v_definition := replace(v_definition,v_old_decl,v_new_decl);
  v_definition := replace(v_definition,v_old_role,v_new_role);
  v_definition := replace(v_definition,v_old_required,v_new_required);
  v_definition := replace(v_definition,v_old_status,v_new_status);
  execute v_definition;
end;
$withdrawal_super_admin$;


-- 8) Daily ledger summary for accounting. This is a read-only report over the
-- immutable ledger; it does not calculate or activate a service fee.
create or replace function public.get_admin_daily_financial_summary(
  p_admin_user_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $daily_financial_summary$
declare
  v_rows jsonb;
begin
  if not exists (
    select 1
      from public.user_roles
     where user_id = p_admin_user_id
       and role in ('super_admin','admin','finance_admin','risk_admin','accountant','auditor')
  ) then
    raise exception 'FINANCE_ROLE_REQUIRED';
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'FINANCE_REPORT_RANGE_INVALID';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ledger_date', report.ledger_date,
        'currency', report.currency,
        'transaction_count', report.transaction_count,
        'total_debits', report.total_debits,
        'total_credits', report.total_credits,
        'platform_revenue_credits', report.platform_revenue_credits,
        'platform_revenue_debits', report.platform_revenue_debits
      )
      order by report.ledger_date desc, report.currency
    ),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      date_trunc('day', le.created_at at time zone 'America/Port-au-Prince')::date as ledger_date,
      le.currency::text as currency,
      count(distinct le.ledger_transaction_id)::bigint as transaction_count,
      coalesce(sum(le.amount) filter (where le.direction = 'debit'),0)::numeric(20,2) as total_debits,
      coalesce(sum(le.amount) filter (where le.direction = 'credit'),0)::numeric(20,2) as total_credits,
      coalesce(sum(le.amount) filter (
        where w.is_system = true and w.system_account_code = 'platform_revenue' and le.direction = 'credit'
      ),0)::numeric(20,2) as platform_revenue_credits,
      coalesce(sum(le.amount) filter (
        where w.is_system = true and w.system_account_code = 'platform_revenue' and le.direction = 'debit'
      ),0)::numeric(20,2) as platform_revenue_debits
    from public.ledger_entries le
    join public.wallets w on w.id = le.wallet_id
    where le.created_at >= (date_trunc('day', now() at time zone 'America/Port-au-Prince') at time zone 'America/Port-au-Prince')
      - make_interval(days => p_days - 1)
    group by date_trunc('day', le.created_at at time zone 'America/Port-au-Prince')::date, le.currency
  ) report;

  return jsonb_build_object(
    'days',p_days,
    'rows',v_rows,
    'source','immutable_double_entry_ledger',
    'fee_engine_active',false
  );
end;
$daily_financial_summary$;

revoke all on function public.get_admin_daily_financial_summary(uuid,integer)
  from public,anon,authenticated;
grant execute on function public.get_admin_daily_financial_summary(uuid,integer)
  to service_role;

commit;
