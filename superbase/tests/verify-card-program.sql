-- Read-only verification for the LakayGo Card program foundation.
do $$
declare
  tier_count integer;
  enabled_count integer;
begin
  if to_regclass('public.card_program_tiers') is null then
    raise exception 'CARD_PROGRAM_TIERS_MISSING';
  end if;
  if to_regclass('public.card_applications') is null then
    raise exception 'CARD_APPLICATIONS_MISSING';
  end if;
  if to_regclass('public.card_instruments') is null then
    raise exception 'CARD_INSTRUMENTS_MISSING';
  end if;

  select count(*) into tier_count from public.card_program_tiers
  where tier_code in ('BASIC', 'STANDARD', 'GOLD');
  if tier_count <> 3 then
    raise exception 'CARD_TIER_CATALOG_INCOMPLETE';
  end if;

  select count(*) into enabled_count from public.card_program_tiers
  where issuance_enabled is true;
  if enabled_count <> 0 then
    raise exception 'CARD_ISSUANCE_MUST_REMAIN_DISABLED';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.card_applications'::regclass) then
    raise exception 'CARD_APPLICATIONS_RLS_DISABLED';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.card_instruments'::regclass) then
    raise exception 'CARD_INSTRUMENTS_RLS_DISABLED';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'card_instruments'
      and lower(column_name) in ('pan', 'card_number', 'cvv', 'cvc', 'security_code', 'card_pin', 'otp')
  ) then
    raise exception 'UNSAFE_CARD_DATA_COLUMN_FOUND';
  end if;
end;
$$;

select tier_code, display_name, application_open, issuance_enabled, virtual_supported, physical_supported
from public.card_program_tiers
order by sort_order;
