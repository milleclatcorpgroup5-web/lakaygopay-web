-- Read-only verification for LakayGo Card tiers, HTG ceilings and star sub-levels.
do $$
declare n integer; stars integer; enabled integer; c record;
begin
 if to_regclass('public.card_program_tiers') is null or to_regclass('public.card_tier_stars') is null or to_regclass('public.card_customer_limits') is null or to_regclass('public.card_limit_history') is null or to_regclass('public.card_applications') is null or to_regclass('public.card_instruments') is null then raise exception 'CARD_PROGRAM_SCHEMA_INCOMPLETE'; end if;
 select count(*) into n from public.card_program_tiers where tier_code in('BASIC','STANDARD','GOLD','ELITE_GOLD');if n<>4 then raise exception 'CARD_TIER_CATALOG_INCOMPLETE';end if;
 select count(*) into stars from public.card_tier_stars;if stars<>12 then raise exception 'CARD_STAR_LEVEL_CATALOG_INCOMPLETE';end if;
 select count(*) into enabled from public.card_program_tiers where issuance_enabled is true;if enabled<>0 then raise exception 'CARD_ISSUANCE_MUST_REMAIN_DISABLED';end if;
 if not(select relrowsecurity from pg_class where oid='public.card_customer_limits'::regclass) then raise exception 'CARD_CUSTOMER_LIMITS_RLS_DISABLED';end if;
 if not(select relrowsecurity from pg_class where oid='public.card_limit_history'::regclass) then raise exception 'CARD_LIMIT_HISTORY_RLS_DISABLED';end if;
 if not(select relrowsecurity from pg_class where oid='public.card_applications'::regclass) then raise exception 'CARD_APPLICATIONS_RLS_DISABLED';end if;
 if not(select relrowsecurity from pg_class where oid='public.card_instruments'::regclass) then raise exception 'CARD_INSTRUMENTS_RLS_DISABLED';end if;
 select * into c from public.lakaygo_classify_card_limit(0);if c.tier_code<>'BASIC' or c.star_level<>1 then raise exception 'CARD_BOUNDARY_ZERO_INVALID';end if;
 select * into c from public.lakaygo_classify_card_limit(999999.99);if c.tier_code<>'BASIC' or c.star_level<>3 then raise exception 'CARD_BOUNDARY_BASIC_MAX_INVALID';end if;
 select * into c from public.lakaygo_classify_card_limit(1000000);if c.tier_code<>'STANDARD' or c.star_level<>1 then raise exception 'CARD_BOUNDARY_STANDARD_MIN_INVALID';end if;
 select * into c from public.lakaygo_classify_card_limit(30000000);if c.tier_code<>'GOLD' or c.star_level<>1 then raise exception 'CARD_BOUNDARY_GOLD_MIN_INVALID';end if;
 select * into c from public.lakaygo_classify_card_limit(100000000);if c.tier_code<>'GOLD' or c.star_level<>3 then raise exception 'CARD_BOUNDARY_GOLD_MAX_INVALID';end if;
 select * into c from public.lakaygo_classify_card_limit(100000000.01);if c.tier_code<>'ELITE_GOLD' or c.star_level<>1 then raise exception 'CARD_BOUNDARY_ELITE_MIN_INVALID';end if;
 select * into c from public.lakaygo_classify_card_limit(500000000.01);if c.tier_code<>'ELITE_GOLD' or c.star_level<>3 then raise exception 'CARD_BOUNDARY_ELITE_THREE_STAR_INVALID';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='card_instruments' and lower(column_name) in('pan','card_number','cvv','cvc','security_code','card_pin','otp')) then raise exception 'UNSAFE_CARD_DATA_COLUMN_FOUND';end if;
end; $$;
select t.tier_code,t.display_name,t.min_limit_htg,t.max_limit_htg,s.star_level,s.star_label,s.min_limit_htg as star_min_htg,s.max_limit_htg as star_max_htg,t.issuance_enabled
from public.card_program_tiers t join public.card_tier_stars s using(tier_code) order by t.sort_order,s.star_level;
