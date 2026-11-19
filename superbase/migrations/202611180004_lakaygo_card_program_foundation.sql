begin;

create table if not exists public.card_program_tiers (
  tier_code text primary key check (tier_code in ('BASIC', 'STANDARD', 'GOLD')),
  display_name text not null,
  sort_order smallint not null unique,
  description text not null,
  benefits jsonb not null default '[]'::jsonb check (jsonb_typeof(benefits) = 'array'),
  application_open boolean not null default true,
  issuance_enabled boolean not null default false,
  virtual_supported boolean not null default true,
  physical_supported boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.card_program_tiers
  (tier_code, display_name, sort_order, description, benefits, application_open, issuance_enabled, virtual_supported, physical_supported)
values
  ('BASIC', 'LakayGo Basic', 1,
   'Klas baz LakayGo pou antre nan ekosistèm kat la.',
   '["Bous HTG, USD ak EUR","Peman QR ak transfè entèn","Kontwòl sekirite ak notifikasyon"]'::jsonb,
   true, false, true, true),
  ('STANDARD', 'LakayGo Standard', 2,
   'Klas mwayèn pou itilizasyon regilye ak plis sèvis.',
   '["Tout avantaj Basic","Opsyon kat vityèl oswa fizik","Limit depans konfigirab apre patnè a valide","Sipò priyoritè"]'::jsonb,
   true, false, true, true),
  ('GOLD', 'LakayGo Gold', 3,
   'Klas Premium pou kliyan ki bezwen plis avantaj.',
   '["Tout avantaj Standard","Kat Gold vityèl oswa fizik","Avantaj patnè ak òf eksklizif","Sipò kliyan Gold"]'::jsonb,
   true, false, true, true)
on conflict (tier_code) do update set
  display_name = excluded.display_name,
  sort_order = excluded.sort_order,
  description = excluded.description,
  benefits = excluded.benefits,
  virtual_supported = excluded.virtual_supported,
  physical_supported = excluded.physical_supported,
  updated_at = now();

create table if not exists public.card_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  tier_code text not null references public.card_program_tiers(tier_code) on update restrict on delete restrict,
  requested_form text not null check (requested_form in ('virtual', 'physical', 'both')),
  status text not null default 'waitlist'
    check (status in ('waitlist', 'under_review', 'eligible', 'declined', 'withdrawn')),
  application_source text not null default 'customer_app'
    check (application_source in ('customer_app', 'admin_import', 'partner_referral')),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists card_applications_one_open_per_user
  on public.card_applications(user_id)
  where status in ('waitlist', 'under_review', 'eligible');

create index if not exists card_applications_status_created_idx
  on public.card_applications(status, created_at desc);

create index if not exists card_applications_user_created_idx
  on public.card_applications(user_id, created_at desc);

-- Provider token and masked metadata only; never store PAN, CVV, card PIN or OTP.
create table if not exists public.card_instruments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  application_id uuid references public.card_applications(id) on delete restrict,
  tier_code text not null references public.card_program_tiers(tier_code) on update restrict on delete restrict,
  card_form text not null check (card_form in ('virtual', 'physical')),
  provider_code text not null,
  provider_card_reference text not null,
  card_last4 char(4) check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  card_network text,
  expiry_month smallint check (expiry_month is null or expiry_month between 1 and 12),
  expiry_year smallint check (expiry_year is null or expiry_year between 2026 and 2200),
  card_status text not null default 'provisioning'
    check (card_status in ('provisioning', 'active', 'locked', 'blocked', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_code, provider_card_reference)
);

alter table public.card_program_tiers enable row level security;
alter table public.card_applications enable row level security;
alter table public.card_instruments enable row level security;

revoke all on table public.card_program_tiers from anon, authenticated;
revoke all on table public.card_applications from anon, authenticated;
revoke all on table public.card_instruments from anon, authenticated;

grant select, insert, update, delete on table public.card_program_tiers to service_role;
grant select, insert, update, delete on table public.card_applications to service_role;
grant select, insert, update, delete on table public.card_instruments to service_role;

comment on table public.card_program_tiers is
  'LakayGo card tier catalogue. Issuance remains disabled until an authorised issuer and regulatory approval are in place.';
comment on table public.card_applications is
  'Card interest and pre-qualification requests only. A row does not represent an issued or usable payment card.';
comment on table public.card_instruments is
  'Issuer-token references and masked card metadata only. Never add full PAN, CVV, card PIN or OTP columns.';

commit;
