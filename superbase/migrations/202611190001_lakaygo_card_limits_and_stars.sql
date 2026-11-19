begin;
alter table public.card_program_tiers add column if not exists min_limit_htg numeric(20,2), add column if not exists max_limit_htg numeric(20,2);
do $$
declare item record;
begin
  for item in select conname from pg_constraint where conrelid='public.card_program_tiers'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%tier_code%'
  loop execute format('alter table public.card_program_tiers drop constraint %I',item.conname); end loop;
end; $$;
alter table public.card_program_tiers add constraint card_program_tiers_tier_code_check check(tier_code in ('BASIC','STANDARD','GOLD','ELITE_GOLD'));
insert into public.card_program_tiers
(tier_code,display_name,sort_order,description,benefits,application_open,issuance_enabled,virtual_supported,physical_supported,min_limit_htg,max_limit_htg)
values
('BASIC','LakayGo Basic',1,'Klas baz pou plafon HTG valide ant 0 ak 999,999.99.','["Kat klas baz","Bous HTG, USD ak EUR","Kontwòl sekirite"]'::jsonb,true,false,true,true,0,999999.99),
('STANDARD','LakayGo Mwayèn',2,'Klas entèmedyè pou plafon HTG valide ant 1,000,000 ak 29,999,999.99.','["Tout avantaj Basic","Avantaj sèvis entèmedyè","Nivo etwal selon plafon"]'::jsonb,true,false,true,true,1000000,29999999.99),
('GOLD','LakayGo Gold',3,'Klas Gold pou plafon HTG valide ant 30,000,000 ak 100,000,000.','["Tout avantaj Mwayèn","Avantaj sèvis Gold","Sipò priyoritè selon disponiblite"]'::jsonb,true,false,true,true,30000000,100000000),
('ELITE_GOLD','LakayGo Elite Gold',4,'Klas Elite Gold pou plafon HTG valide ki depase 100,000,000.','["Tout avantaj Gold","Avantaj patnè Elite","Relasyon kliyan priyoritè"]'::jsonb,true,false,true,true,100000000.01,null)
on conflict(tier_code) do update set display_name=excluded.display_name,sort_order=excluded.sort_order,description=excluded.description,benefits=excluded.benefits,min_limit_htg=excluded.min_limit_htg,max_limit_htg=excluded.max_limit_htg,issuance_enabled=false,updated_at=now();

create table if not exists public.card_tier_stars(
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
on conflict(tier_code,star_level) do update set star_label=excluded.star_label,min_limit_htg=excluded.min_limit_htg,max_limit_htg=excluded.max_limit_htg;

create or replace function public.lakaygo_classify_card_limit(p_limit_htg numeric)
returns table(tier_code text,star_level smallint,star_label text)
language sql stable security definer set search_path=public,pg_temp
as $$
 select s.tier_code,s.star_level,s.star_label from public.card_tier_stars s
 where p_limit_htg>=s.min_limit_htg and (s.max_limit_htg is null or p_limit_htg<=s.max_limit_htg)
 order by s.star_level limit 1;
$$;
revoke all on function public.lakaygo_classify_card_limit(numeric) from public,anon,authenticated;
grant execute on function public.lakaygo_classify_card_limit(numeric) to service_role;

create table if not exists public.card_customer_limits(
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
create table if not exists public.card_limit_history(
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
alter table public.card_applications add column if not exists star_level smallint, add column if not exists approved_limit_htg numeric(20,2), add column if not exists limit_currency char(3) not null default 'HTG';

alter table public.card_customer_limits enable row level security;
alter table public.card_limit_history enable row level security;
alter table public.card_tier_stars enable row level security;
revoke all on table public.card_customer_limits from anon,authenticated;
revoke all on table public.card_limit_history from anon,authenticated;
revoke all on table public.card_tier_stars from anon,authenticated;
grant select,insert,update,delete on table public.card_customer_limits to service_role;
grant select,insert,update,delete on table public.card_limit_history to service_role;
grant select,insert,update,delete on table public.card_tier_stars to service_role;

create or replace function public.card_customer_limit_assign_tier()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_class record;
begin
 if new.limit_currency <> 'HTG' then raise exception 'CARD_LIMIT_CURRENCY_INVALID'; end if;
 select * into v_class from public.lakaygo_classify_card_limit(new.approved_limit_htg);
 if not found then raise exception 'CARD_LIMIT_CLASSIFICATION_FAILED'; end if;
 new.tier_code:=v_class.tier_code; new.star_level:=v_class.star_level; new.updated_at:=now();
 return new;
end; $$;
drop trigger if exists card_customer_limits_classify on public.card_customer_limits;
create trigger card_customer_limits_classify before insert or update of approved_limit_htg,limit_currency on public.card_customer_limits
for each row execute function public.card_customer_limit_assign_tier();

create or replace function public.card_application_snapshot_limit()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_limit public.card_customer_limits%rowtype;
begin
 select * into v_limit from public.card_customer_limits where user_id=new.user_id and assessment_status='approved';
 if not found then raise exception 'CARD_LIMIT_NOT_APPROVED'; end if;
 new.tier_code:=v_limit.tier_code; new.star_level:=v_limit.star_level;
 new.approved_limit_htg:=v_limit.approved_limit_htg; new.limit_currency:='HTG';
 return new;
end; $$;
drop trigger if exists card_application_snapshot_limit_before_insert on public.card_applications;
create trigger card_application_snapshot_limit_before_insert before insert on public.card_applications
for each row execute function public.card_application_snapshot_limit();

create or replace function public.prevent_card_limit_history_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'CARD_LIMIT_HISTORY_IMMUTABLE'; end; $$;
drop trigger if exists card_limit_history_no_mutation on public.card_limit_history;
create trigger card_limit_history_no_mutation before update or delete on public.card_limit_history
for each row execute function public.prevent_card_limit_history_mutation();

create or replace function public.admin_set_card_limit(p_admin_user_id uuid,p_target_user_id uuid,p_approved_limit_htg numeric,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_class record; v_old public.card_customer_limits%rowtype; v_has_old boolean:=false; v_reason text:=trim(coalesce(p_reason,''));
begin
 if p_admin_user_id is null or p_target_user_id is null then raise exception 'CARD_LIMIT_USER_REQUIRED'; end if;
 if p_approved_limit_htg is null or p_approved_limit_htg<0 or p_approved_limit_htg>999999999999999999.99 then raise exception 'CARD_LIMIT_INVALID'; end if;
 if char_length(v_reason)<10 or char_length(v_reason)>300 then raise exception 'CARD_LIMIT_REASON_INVALID'; end if;
 if not exists(select 1 from public.user_roles where user_id=p_admin_user_id and role in('super_admin','risk_admin')) then raise exception 'ADMIN_PERMISSION_DENIED'; end if;
 if not exists(select 1 from public.profiles where id=p_target_user_id and coalesce(account_status,'active')='active') then raise exception 'CARD_CUSTOMER_NOT_ACTIVE'; end if;
 select * into v_class from public.lakaygo_classify_card_limit(p_approved_limit_htg);
 if not found then raise exception 'CARD_LIMIT_CLASSIFICATION_FAILED'; end if;
 select * into v_old from public.card_customer_limits where user_id=p_target_user_id for update;
 v_has_old:=found;
 insert into public.card_customer_limits(user_id,approved_limit_htg,limit_currency,tier_code,star_level,assessment_status,reviewed_by,reviewed_at,updated_at)
 values(p_target_user_id,p_approved_limit_htg,'HTG',v_class.tier_code,v_class.star_level,'approved',p_admin_user_id,now(),now())
 on conflict(user_id) do update set approved_limit_htg=excluded.approved_limit_htg,limit_currency='HTG',tier_code=excluded.tier_code,star_level=excluded.star_level,assessment_status='approved',reviewed_by=excluded.reviewed_by,reviewed_at=now(),updated_at=now();
 insert into public.card_limit_history(user_id,changed_by,previous_limit_htg,new_limit_htg,previous_tier_code,new_tier_code,previous_star_level,new_star_level,reason)
 values(p_target_user_id,p_admin_user_id,case when v_has_old then v_old.approved_limit_htg else null end,p_approved_limit_htg,case when v_has_old then v_old.tier_code else null end,v_class.tier_code,case when v_has_old then v_old.star_level else null end,v_class.star_level,v_reason);
 return jsonb_build_object('user_id',p_target_user_id,'approved_limit_htg',p_approved_limit_htg,'limit_currency','HTG','tier_code',v_class.tier_code,'star_level',v_class.star_level,'assessment_status','approved','updated_at',now());
end; $$;
revoke all on function public.admin_set_card_limit(uuid,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.admin_set_card_limit(uuid,uuid,numeric,text) to service_role;
comment on table public.card_customer_limits is 'Risk-reviewed HTG card ceiling. Tier and star are assigned by the database, not selected by customers.';
comment on table public.card_limit_history is 'Append-only audit history for card ceiling changes and automatic tier/star classification.';
comment on table public.card_tier_stars is 'HTG amount bands for 1, 2 and 3 star sub-levels within each LakayGo card tier.';
comment on column public.card_applications.approved_limit_htg is 'Snapshot of the approved HTG card ceiling at application time, not current wallet balance.';
commit;
