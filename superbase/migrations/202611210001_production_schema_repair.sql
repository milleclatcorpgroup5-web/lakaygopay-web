-- LakayGoPay Production repair: install only missing Admin/Card support tables.
-- This migration is additive. It deliberately does NOT alter wallets, wallet_balances,
-- ledger_accounts, ledger_entries, ledger_transactions, transfers, or withdrawal rows.
-- Card issuance and fee collection remain disabled.

begin;

do $preflight$
declare
  item text[];
  required_columns text[][] := array[
    array['profiles','id'],
    array['profiles','account_status'],
    array['user_roles','user_id'],
    array['user_roles','role'],
    array['admin_security','user_id'],
    array['admin_security','pin_hash'],
    array['admin_security','pin_salt'],
    array['admin_security','pin_iterations'],
    array['admin_security','failed_attempts'],
    array['admin_security','locked_until'],
    array['admin_security','last_verified_at'],
    array['admin_security','last_verified_session_id'],
    array['admin_security','updated_at'],
    array['audit_logs','actor_user_id'],
    array['audit_logs','action'],
    array['audit_logs','resource_type'],
    array['audit_logs','resource_id'],
    array['audit_logs','outcome'],
    array['audit_logs','metadata']
  ];
begin
  if to_regclass('auth.users') is null then
    raise exception 'PRODUCTION_REPAIR_AUTH_USERS_MISSING';
  end if;
  foreach item slice 1 in array required_columns loop
    if not exists (
      select 1 from information_schema.columns c
       where c.table_schema='public'
         and c.table_name=item[1]
         and c.column_name=item[2]
    ) then
      raise exception 'PRODUCTION_REPAIR_REQUIRED_COLUMN_MISSING: %.%',item[1],item[2];
    end if;
  end loop;
end;
$preflight$;

-- 1. LakayGo card catalogue. All tiers are informational/prequalification only.
create table if not exists public.card_program_tiers (
  tier_code text primary key check (tier_code in ('BASIC','STANDARD','GOLD','ELITE_GOLD')),
  display_name text not null,
  sort_order smallint not null unique,
  description text not null,
  benefits jsonb not null default '[]'::jsonb check (jsonb_typeof(benefits)='array'),
  application_open boolean not null default true,
  issuance_enabled boolean not null default false,
  virtual_supported boolean not null default true,
  physical_supported boolean not null default true,
  min_limit_htg numeric(20,2),
  max_limit_htg numeric(20,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_limit_htg is null or min_limit_htg>=0),
  check (max_limit_htg is null or min_limit_htg is null or max_limit_htg>=min_limit_htg)
);

insert into public.card_program_tiers
(tier_code,display_name,sort_order,description,benefits,application_open,issuance_enabled,virtual_supported,physical_supported,min_limit_htg,max_limit_htg)
values
('BASIC','LakayGo Basic',1,'Klas baz pou plafon HTG valide ant 0 ak 999,999.99.','["Kat klas baz","Bous HTG, USD ak EUR","Kontwòl sekirite"]'::jsonb,true,false,true,true,0,999999.99),
('STANDARD','LakayGo Mwayèn',2,'Klas entèmedyè pou plafon HTG valide ant 1,000,000 ak 29,999,999.99.','["Tout avantaj Basic","Avantaj sèvis entèmedyè","Nivo etwal selon plafon"]'::jsonb,true,false,true,true,1000000,29999999.99),
('GOLD','LakayGo Gold',3,'Klas Gold pou plafon HTG valide ant 30,000,000 ak 100,000,000.','["Tout avantaj Mwayèn","Avantaj sèvis Gold","Sipò priyoritè selon disponiblite"]'::jsonb,true,false,true,true,30000000,100000000),
('ELITE_GOLD','LakayGo Elite Gold',4,'Klas Elite Gold pou plafon HTG valide ki depase 100,000,000.','["Tout avantaj Gold","Avantaj patnè Elite","Relasyon kliyan priyoritè"]'::jsonb,true,false,true,true,100000000.01,null)
on conflict (tier_code) do update set
  display_name=excluded.display_name,
  sort_order=excluded.sort_order,
  description=excluded.description,
  benefits=excluded.benefits,
  application_open=excluded.application_open,
  issuance_enabled=false,
  virtual_supported=excluded.virtual_supported,
  physical_supported=excluded.physical_supported,
  min_limit_htg=excluded.min_limit_htg,
  max_limit_htg=excluded.max_limit_htg,
  updated_at=now();

create table if not exists public.card_tier_stars (
  tier_code text not null references public.card_program_tiers(tier_code) on update restrict on delete restrict,
  star_level smallint not null check(star_level between 1 and 3),
  star_label text not null,
  min_limit_htg numeric(20,2) not null check(min_limit_htg>=0),
  max_limit_htg numeric(20,2),
  created_at timestamptz not null default now(),
  primary key(tier_code,star_level),
  check(max_limit_htg is null or max_limit_htg>=min_limit_htg)
);
insert into public.card_tier_stars(tier_code,star_level,star_label,min_limit_htg,max_limit_htg) values
('BASIC',1,'Basic 1 etwal',0,333333.33),('BASIC',2,'Basic 2 etwal',333333.34,666666.66),('BASIC',3,'Basic 3 etwal',666666.67,999999.99),
('STANDARD',1,'Mwayèn 1 etwal',1000000,10000000),('STANDARD',2,'Mwayèn 2 etwal',10000000.01,20000000),('STANDARD',3,'Mwayèn 3 etwal',20000000.01,29999999.99),
('GOLD',1,'Gold 1 etwal',30000000,53333333.33),('GOLD',2,'Gold 2 etwal',53333333.34,76666666.66),('GOLD',3,'Gold 3 etwal',76666666.67,100000000),
('ELITE_GOLD',1,'Elite Gold 1 etwal',100000000.01,250000000),('ELITE_GOLD',2,'Elite Gold 2 etwal',250000000.01,500000000),('ELITE_GOLD',3,'Elite Gold 3 etwal',500000000.01,null)
on conflict(tier_code,star_level) do update set
  star_label=excluded.star_label,min_limit_htg=excluded.min_limit_htg,max_limit_htg=excluded.max_limit_htg;

create table if not exists public.card_customer_limits (
  user_id uuid primary key references auth.users(id) on delete restrict,
  approved_limit_htg numeric(20,2) not null check(approved_limit_htg>=0),
  limit_currency char(3) not null default 'HTG' check(limit_currency='HTG'),
  tier_code text not null references public.card_program_tiers(tier_code) on update restrict on delete restrict,
  star_level smallint not null check(star_level between 1 and 3),
  assessment_status text not null default 'approved' check(assessment_status in('approved','under_review','suspended')),
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.card_limit_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  changed_by uuid not null references auth.users(id) on delete restrict,
  previous_limit_htg numeric(20,2),
  new_limit_htg numeric(20,2) not null check(new_limit_htg>=0),
  previous_tier_code text,
  new_tier_code text not null references public.card_program_tiers(tier_code),
  previous_star_level smallint,
  new_star_level smallint not null check(new_star_level between 1 and 3),
  reason text not null check(char_length(trim(reason)) between 10 and 300),
  created_at timestamptz not null default now()
);
create index if not exists card_customer_limits_tier_updated_idx on public.card_customer_limits(tier_code,updated_at desc);
create index if not exists card_limit_history_user_created_idx on public.card_limit_history(user_id,created_at desc);

create table if not exists public.card_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  tier_code text not null references public.card_program_tiers(tier_code) on update restrict on delete restrict,
  requested_form text not null check(requested_form in('virtual','physical','both')),
  status text not null default 'waitlist' check(status in('waitlist','under_review','eligible','declined','withdrawn')),
  application_source text not null default 'customer_app' check(application_source in('customer_app','admin_import','partner_referral')),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note_code text,
  star_level smallint,
  approved_limit_htg numeric(20,2),
  limit_currency char(3) not null default 'HTG',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.card_applications add column if not exists star_level smallint;
alter table public.card_applications add column if not exists approved_limit_htg numeric(20,2);
alter table public.card_applications add column if not exists limit_currency char(3) not null default 'HTG';
create unique index if not exists card_applications_one_open_per_user
  on public.card_applications(user_id) where status in('waitlist','under_review','eligible');
create index if not exists card_applications_status_created_idx on public.card_applications(status,created_at desc);
create index if not exists card_applications_user_created_idx on public.card_applications(user_id,created_at desc);

-- Provider references and masked metadata only. Never store PAN, CVV, card PIN or OTP.
create table if not exists public.card_instruments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  application_id uuid references public.card_applications(id) on delete restrict,
  tier_code text not null references public.card_program_tiers(tier_code) on update restrict on delete restrict,
  card_form text not null check(card_form in('virtual','physical')),
  provider_code text not null,
  provider_card_reference text not null,
  card_last4 char(4) check(card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  card_network text,
  expiry_month smallint check(expiry_month is null or expiry_month between 1 and 12),
  expiry_year smallint check(expiry_year is null or expiry_year between 2026 and 2200),
  card_status text not null default 'provisioning' check(card_status in('provisioning','active','locked','blocked','expired','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_code,provider_card_reference)
);

create or replace function public.lakaygo_classify_card_limit(p_limit_htg numeric)
returns table(tier_code text,star_level smallint,star_label text)
language sql stable security definer set search_path=''
as $classify$
  select s.tier_code,s.star_level,s.star_label
    from public.card_tier_stars s
   where p_limit_htg>=s.min_limit_htg
     and (s.max_limit_htg is null or p_limit_htg<=s.max_limit_htg)
   order by s.star_level
   limit 1;
$classify$;
revoke all on function public.lakaygo_classify_card_limit(numeric) from public,anon,authenticated;
grant execute on function public.lakaygo_classify_card_limit(numeric) to service_role;

create or replace function public.card_customer_limit_assign_tier()
returns trigger language plpgsql set search_path=''
as $assign_tier$
declare v_class record;
begin
  if new.limit_currency <> 'HTG' then raise exception 'CARD_LIMIT_CURRENCY_INVALID'; end if;
  select * into v_class from public.lakaygo_classify_card_limit(new.approved_limit_htg);
  if not found then raise exception 'CARD_LIMIT_CLASSIFICATION_FAILED'; end if;
  new.tier_code:=v_class.tier_code;
  new.star_level:=v_class.star_level;
  new.updated_at:=now();
  return new;
end;
$assign_tier$;
drop trigger if exists card_customer_limits_classify on public.card_customer_limits;
create trigger card_customer_limits_classify
before insert or update of approved_limit_htg,limit_currency on public.card_customer_limits
for each row execute function public.card_customer_limit_assign_tier();

create or replace function public.card_application_snapshot_limit()
returns trigger language plpgsql security definer set search_path=''
as $snapshot_limit$
declare v_limit public.card_customer_limits%rowtype;
begin
  select * into v_limit from public.card_customer_limits
   where user_id=new.user_id and assessment_status='approved';
  if not found then raise exception 'CARD_LIMIT_NOT_APPROVED'; end if;
  new.tier_code:=v_limit.tier_code;
  new.star_level:=v_limit.star_level;
  new.approved_limit_htg:=v_limit.approved_limit_htg;
  new.limit_currency:='HTG';
  return new;
end;
$snapshot_limit$;
drop trigger if exists card_application_snapshot_limit_before_insert on public.card_applications;
create trigger card_application_snapshot_limit_before_insert
before insert on public.card_applications
for each row execute function public.card_application_snapshot_limit();

create or replace function public.prevent_card_limit_history_mutation()
returns trigger language plpgsql set search_path=''
as $immutable_history$
begin
  raise exception 'CARD_LIMIT_HISTORY_IMMUTABLE';
end;
$immutable_history$;
drop trigger if exists card_limit_history_no_mutation on public.card_limit_history;
create trigger card_limit_history_no_mutation
before update or delete on public.card_limit_history
for each row execute function public.prevent_card_limit_history_mutation();

create or replace function public.admin_set_card_limit(
  p_admin_user_id uuid,p_target_user_id uuid,p_approved_limit_htg numeric,p_reason text
)
returns jsonb language plpgsql security definer set search_path=''
as $set_card_limit$
declare
  v_class record;
  v_old public.card_customer_limits%rowtype;
  v_has_old boolean:=false;
  v_reason text:=trim(coalesce(p_reason,''));
begin
  if p_admin_user_id is null or p_target_user_id is null then raise exception 'CARD_LIMIT_USER_REQUIRED'; end if;
  if p_approved_limit_htg is null or p_approved_limit_htg<0 or p_approved_limit_htg>999999999999999999.99 then raise exception 'CARD_LIMIT_INVALID'; end if;
  if char_length(v_reason)<10 or char_length(v_reason)>300 then raise exception 'CARD_LIMIT_REASON_INVALID'; end if;
  if not exists(select 1 from public.user_roles where user_id=p_admin_user_id and role in('super_admin','risk_admin')) then
    raise exception 'ADMIN_PERMISSION_DENIED';
  end if;
  if not exists(select 1 from public.profiles where id=p_target_user_id and coalesce(account_status,'active')='active') then
    raise exception 'CARD_CUSTOMER_NOT_ACTIVE';
  end if;
  select * into v_class from public.lakaygo_classify_card_limit(p_approved_limit_htg);
  if not found then raise exception 'CARD_LIMIT_CLASSIFICATION_FAILED'; end if;
  select * into v_old from public.card_customer_limits where user_id=p_target_user_id for update;
  v_has_old:=found;
  insert into public.card_customer_limits(user_id,approved_limit_htg,limit_currency,tier_code,star_level,assessment_status,reviewed_by,reviewed_at,updated_at)
  values(p_target_user_id,p_approved_limit_htg,'HTG',v_class.tier_code,v_class.star_level,'approved',p_admin_user_id,now(),now())
  on conflict(user_id) do update set
    approved_limit_htg=excluded.approved_limit_htg,
    limit_currency='HTG',
    tier_code=excluded.tier_code,
    star_level=excluded.star_level,
    assessment_status='approved',
    reviewed_by=excluded.reviewed_by,
    reviewed_at=now(),
    updated_at=now();
  insert into public.card_limit_history(user_id,changed_by,previous_limit_htg,new_limit_htg,previous_tier_code,new_tier_code,previous_star_level,new_star_level,reason)
  values(
    p_target_user_id,p_admin_user_id,
    case when v_has_old then v_old.approved_limit_htg else null end,
    p_approved_limit_htg,
    case when v_has_old then v_old.tier_code else null end,
    v_class.tier_code,
    case when v_has_old then v_old.star_level else null end,
    v_class.star_level,v_reason
  );
  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,outcome,metadata)
  values(p_admin_user_id,'card.limit.updated','card_customer_limits',p_target_user_id,'success',
    jsonb_build_object('approved_limit_htg',p_approved_limit_htg,'tier_code',v_class.tier_code,'star_level',v_class.star_level));
  return jsonb_build_object('user_id',p_target_user_id,'approved_limit_htg',p_approved_limit_htg,'limit_currency','HTG',
    'tier_code',v_class.tier_code,'star_level',v_class.star_level,'assessment_status','approved','updated_at',now());
end;
$set_card_limit$;
revoke all on function public.admin_set_card_limit(uuid,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.admin_set_card_limit(uuid,uuid,numeric,text) to service_role;

alter table public.card_program_tiers enable row level security;
alter table public.card_tier_stars enable row level security;
alter table public.card_customer_limits enable row level security;
alter table public.card_limit_history enable row level security;
alter table public.card_applications enable row level security;
alter table public.card_instruments enable row level security;
revoke all on table public.card_program_tiers,public.card_tier_stars,public.card_customer_limits,
  public.card_limit_history,public.card_applications,public.card_instruments from public,anon,authenticated;
grant select,insert,update,delete on table public.card_program_tiers,public.card_tier_stars,
  public.card_customer_limits,public.card_limit_history,public.card_applications,public.card_instruments to service_role;

comment on table public.card_program_tiers is 'Card tiers are informational; issuance_enabled remains false pending authorised issuer approval.';
comment on table public.card_applications is 'Card interest/prequalification only; no payment card is issued by this record.';
comment on table public.card_instruments is 'Issuer references and masked card metadata only. Never store PAN, CVV, PIN or OTP.';
comment on table public.card_customer_limits is 'Risk-reviewed HTG card ceiling. Customer cannot choose the tier or star level.';

-- 2. Private secretary storage, accessible only through server-side APIs.
create table if not exists public.admin_secretariat_access (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  assistant_user_id uuid not null unique references auth.users(id) on delete cascade,
  assigned_by uuid not null references auth.users(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(owner_user_id<>assistant_user_id)
);
create index if not exists admin_secretariat_access_owner_idx on public.admin_secretariat_access(owner_user_id,active);

create table if not exists public.admin_secretariat_items (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null check(item_type in('task','meeting','note','contact','document','reminder')),
  title text not null check(length(trim(title)) between 1 and 160),
  details text not null default '' check(length(details)<=5000),
  due_at timestamptz,
  status text not null default 'open' check(status in('open','in_progress','done','cancelled')),
  priority text not null default 'normal' check(priority in('low','normal','high','urgent')),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admin_secretariat_items_owner_due_idx
  on public.admin_secretariat_items(owner_user_id,due_at,created_at desc);

create or replace function public.audit_admin_secretariat_change()
returns trigger language plpgsql security definer set search_path=''
as $audit_secretariat$
declare
  v_owner uuid;
  v_actor uuid;
  v_resource uuid;
  v_action text;
begin
  if tg_op='DELETE' then
    v_owner:=old.owner_user_id;
    v_resource:=old.id;
    if tg_table_name='admin_secretariat_access' then
      v_actor:=old.assigned_by;
      v_action:='secretariat.access.revoked';
    else
      v_actor:=coalesce(old.updated_by,old.created_by);
      v_action:='secretariat.item.deleted';
    end if;
  else
    v_owner:=new.owner_user_id;
    v_resource:=new.id;
    if tg_table_name='admin_secretariat_access' then
      v_actor:=new.assigned_by;
      v_action:=case when new.active then 'secretariat.access.granted' else 'secretariat.access.revoked' end;
    else
      v_actor:=coalesce(new.updated_by,new.created_by);
      v_action:=case when tg_op='INSERT' then 'secretariat.item.created' else 'secretariat.item.updated' end;
    end if;
  end if;
  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,outcome,metadata)
  values(v_actor,v_action,tg_table_name,v_resource,'success',jsonb_build_object('owner_user_id',v_owner,'operation',tg_op));
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$audit_secretariat$;

drop trigger if exists admin_secretariat_access_audit on public.admin_secretariat_access;
create trigger admin_secretariat_access_audit after insert or update or delete on public.admin_secretariat_access
for each row execute function public.audit_admin_secretariat_change();
drop trigger if exists admin_secretariat_items_audit on public.admin_secretariat_items;
create trigger admin_secretariat_items_audit after insert or update or delete on public.admin_secretariat_items
for each row execute function public.audit_admin_secretariat_change();

alter table public.admin_secretariat_access enable row level security;
alter table public.admin_secretariat_items enable row level security;
revoke all on table public.admin_secretariat_access,public.admin_secretariat_items from public,anon,authenticated;
grant select,insert,update,delete on table public.admin_secretariat_access,public.admin_secretariat_items to service_role;

-- 3. Fee proposals are policy records only. This does not post or collect fees.
create table if not exists public.platform_fee_proposals (
  id uuid primary key default gen_random_uuid(),
  service_code text not null check(service_code in('internal_transfer','merchant_qr','fx_conversion','cash_in','cash_out','bill_payment')),
  currency char(3) not null check(currency in('HTG','USD','EUR')),
  fee_kind text not null check(fee_kind in('fixed','percentage')),
  fee_value numeric(14,6) not null check(fee_value>0),
  minimum_fee numeric(20,6) not null default 0 check(minimum_fee>=0),
  maximum_fee numeric(20,6) check(maximum_fee is null or maximum_fee>=minimum_fee),
  version integer not null check(version>0),
  effective_at timestamptz not null,
  status text not null default 'proposed' check(status in('proposed','approved','rejected')),
  proposed_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  proposal_note text not null default '' check(length(proposal_note)<=500),
  decision_note text not null default '' check(length(decision_note)<=500),
  created_at timestamptz not null default now(),
  unique(service_code,currency,version),
  check(fee_kind<>'percentage' or fee_value<=100),
  check((status='proposed' and reviewed_by is null and reviewed_at is null)
    or (status in('approved','rejected') and reviewed_by is not null and reviewed_at is not null))
);
create index if not exists platform_fee_proposals_service_version_idx
  on public.platform_fee_proposals(service_code,currency,version desc);
create index if not exists platform_fee_proposals_status_effective_idx
  on public.platform_fee_proposals(status,effective_at);
alter table public.platform_fee_proposals enable row level security;
revoke all on table public.platform_fee_proposals from public,anon,authenticated,service_role;
grant select on table public.platform_fee_proposals to service_role;

create or replace function public.propose_platform_fee(
  p_actor_user_id uuid,p_service_code text,p_currency text,p_fee_kind text,p_fee_value numeric,
  p_effective_at timestamptz,p_minimum_fee numeric default 0,p_maximum_fee numeric default null,p_note text default null
)
returns jsonb language plpgsql security definer set search_path=''
as $propose_fee$
declare v_version integer; v_id uuid;
begin
  if not exists(select 1 from public.user_roles where user_id=p_actor_user_id and role='finance_admin')
     or exists(select 1 from public.user_roles where user_id=p_actor_user_id and role='super_admin') then
    raise exception 'FINANCE_ROLE_REQUIRED';
  end if;
  if p_service_code is null or p_service_code not in('internal_transfer','merchant_qr','fx_conversion','cash_in','cash_out','bill_payment') then raise exception 'FEE_SERVICE_INVALID'; end if;
  if p_currency is null or p_currency not in('HTG','USD','EUR') then raise exception 'FEE_CURRENCY_INVALID'; end if;
  if p_fee_kind is null or p_fee_kind not in('fixed','percentage') then raise exception 'FEE_KIND_INVALID'; end if;
  if p_fee_value is null or p_fee_value<=0 or p_fee_value<>round(p_fee_value,6) then raise exception 'FEE_VALUE_INVALID'; end if;
  if p_fee_kind='percentage' and p_fee_value>100 then raise exception 'FEE_PERCENTAGE_TOO_HIGH'; end if;
  if p_minimum_fee is null or p_minimum_fee<0 or (p_maximum_fee is not null and p_maximum_fee<p_minimum_fee) then raise exception 'FEE_RANGE_INVALID'; end if;
  if p_effective_at is null or p_effective_at<clock_timestamp()-interval '5 minutes' then raise exception 'FEE_EFFECTIVE_DATE_INVALID'; end if;
  if length(coalesce(p_note,''))>500 then raise exception 'FEE_NOTE_TOO_LONG'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_service_code||':'||p_currency,0));
  select coalesce(max(version),0)+1 into v_version from public.platform_fee_proposals
   where service_code=p_service_code and currency=p_currency;
  insert into public.platform_fee_proposals(service_code,currency,fee_kind,fee_value,minimum_fee,maximum_fee,version,effective_at,status,proposed_by,proposal_note)
  values(p_service_code,p_currency,p_fee_kind,p_fee_value,p_minimum_fee,p_maximum_fee,v_version,p_effective_at,'proposed',p_actor_user_id,left(coalesce(p_note,''),500))
  returning id into v_id;
  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  values(p_actor_user_id,'platform_fee.proposed','platform_fee_proposal',v_id,
    jsonb_build_object('service_code',p_service_code,'currency',p_currency,'fee_kind',p_fee_kind,'fee_value',p_fee_value,'version',v_version,'effective_at',p_effective_at));
  return jsonb_build_object('id',v_id,'version',v_version,'status','proposed');
end;
$propose_fee$;
revoke all on function public.propose_platform_fee(uuid,text,text,text,numeric,timestamptz,numeric,numeric,text) from public,anon,authenticated;
grant execute on function public.propose_platform_fee(uuid,text,text,text,numeric,timestamptz,numeric,numeric,text) to service_role;

create or replace function public.review_platform_fee_proposal(
  p_super_admin_user_id uuid,p_proposal_id uuid,p_decision text,p_decision_note text default null
)
returns jsonb language plpgsql security definer set search_path=''
as $review_fee$
declare v_proposal public.platform_fee_proposals%rowtype;
begin
  if not exists(select 1 from public.user_roles where user_id=p_super_admin_user_id and role='super_admin') then raise exception 'SUPER_ADMIN_REQUIRED'; end if;
  if p_decision is null or p_decision not in('approve','reject') then raise exception 'FEE_DECISION_INVALID'; end if;
  if length(coalesce(p_decision_note,''))>500 then raise exception 'FEE_NOTE_TOO_LONG'; end if;
  select * into v_proposal from public.platform_fee_proposals where id=p_proposal_id for update;
  if v_proposal.id is null then raise exception 'FEE_PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.status<>'proposed' then raise exception 'FEE_PROPOSAL_ALREADY_REVIEWED'; end if;
  if v_proposal.proposed_by=p_super_admin_user_id then raise exception 'MAKER_CANNOT_APPROVE_OWN_FEE_PROPOSAL'; end if;
  update public.platform_fee_proposals set status=case when p_decision='approve' then 'approved' else 'rejected' end,
    reviewed_by=p_super_admin_user_id,reviewed_at=clock_timestamp(),decision_note=left(coalesce(p_decision_note,''),500)
   where id=p_proposal_id;
  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  values(p_super_admin_user_id,case when p_decision='approve' then 'platform_fee.approved' else 'platform_fee.rejected' end,
    'platform_fee_proposal',p_proposal_id,jsonb_build_object('service_code',v_proposal.service_code,'currency',v_proposal.currency,
    'version',v_proposal.version,'decision_note',left(coalesce(p_decision_note,''),500)));
  return jsonb_build_object('id',p_proposal_id,'version',v_proposal.version,
    'status',case when p_decision='approve' then 'approved' else 'rejected' end,'fee_engine_activated',false);
end;
$review_fee$;
revoke all on function public.review_platform_fee_proposal(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_platform_fee_proposal(uuid,uuid,text,text) to service_role;

-- 4. One-use, short-lived Admin PIN recovery challenges (AAL2 is checked in Worker).
create table if not exists public.admin_pin_reset_challenges (
  nonce text primary key check(nonce ~ '^[a-f0-9]{32}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists admin_pin_reset_challenges_expiry_idx on public.admin_pin_reset_challenges(expires_at);
alter table public.admin_pin_reset_challenges enable row level security;
revoke all on table public.admin_pin_reset_challenges from public,anon,authenticated;
grant select,insert,update,delete on table public.admin_pin_reset_challenges to service_role;

create or replace function public.reset_admin_pin(
  p_user_id uuid,p_session_id uuid,p_nonce text,p_pin_hash text,p_pin_salt text,p_pin_iterations integer
)
returns jsonb language plpgsql security definer set search_path=''
as $reset_pin$
declare v_challenge public.admin_pin_reset_challenges%rowtype;
begin
  if p_user_id is null or p_session_id is null or p_nonce is null or p_nonce !~ '^[a-f0-9]{32}$'
     or p_pin_hash is null or p_pin_hash !~ '^[a-f0-9]{64}$'
     or p_pin_salt is null or p_pin_salt !~ '^[a-f0-9]{32}$'
     or p_pin_iterations is null or p_pin_iterations<>600000 then
    raise exception 'ADMIN_PIN_RESET_ARGUMENT_INVALID';
  end if;
  if not exists(select 1 from public.user_roles where user_id=p_user_id and role in
    ('super_admin','admin','finance_admin','risk_admin','support_agent','auditor','accountant','secretary')) then
    raise exception 'ADMIN_ROLE_REQUIRED';
  end if;
  select * into v_challenge from public.admin_pin_reset_challenges
   where nonce=p_nonce and user_id=p_user_id and session_id=p_session_id
     and consumed_at is null and expires_at>clock_timestamp() for update;
  if not found then raise exception 'ADMIN_PIN_RESET_CHALLENGE_INVALID'; end if;
  update public.admin_pin_reset_challenges set consumed_at=clock_timestamp() where nonce=p_nonce;
  update public.admin_security set pin_hash=p_pin_hash,pin_salt=p_pin_salt,pin_iterations=p_pin_iterations,
    failed_attempts=0,locked_until=null,last_verified_at=clock_timestamp(),
    last_verified_session_id=p_session_id,updated_at=clock_timestamp()
   where user_id=p_user_id;
  if not found then raise exception 'ADMIN_PIN_NOT_SET'; end if;
  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,outcome,metadata)
  values(p_user_id,'admin.pin.reset','admin_security',p_user_id,'success',
    jsonb_build_object('method','aal2_verified','session_bound',true));
  return jsonb_build_object('ok',true,'pin_reset',true,'session_verified',true);
end;
$reset_pin$;
revoke all on function public.reset_admin_pin(uuid,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.reset_admin_pin(uuid,uuid,text,text,text,integer) to service_role;

-- All 10 failing System Health resources now have compatible storage definitions.
-- No real card issuance or fee collection is enabled by this migration.
do $verify$
begin
  if to_regclass('public.card_program_tiers') is null
     or to_regclass('public.card_tier_stars') is null
     or to_regclass('public.card_customer_limits') is null
     or to_regclass('public.card_limit_history') is null
     or to_regclass('public.card_applications') is null
     or to_regclass('public.card_instruments') is null
     or to_regclass('public.admin_secretariat_access') is null
     or to_regclass('public.admin_secretariat_items') is null
     or to_regclass('public.platform_fee_proposals') is null
     or to_regclass('public.admin_pin_reset_challenges') is null then
    raise exception 'PRODUCTION_REPAIR_TABLE_VERIFICATION_FAILED';
  end if;
  if exists(select 1 from public.card_program_tiers where issuance_enabled=true) then
    raise exception 'CARD_ISSUANCE_MUST_REMAIN_DISABLED';
  end if;
end;
$verify$;

commit;
