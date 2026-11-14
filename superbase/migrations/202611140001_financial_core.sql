-- LakayGoPay financial core (Supabase / PostgreSQL)
-- Apply once to a NEW Supabase project after reviewing this migration.
-- Real deposits, withdrawals and merchant acquiring are deliberately NOT enabled here.

-- -----------------------------------------------------------------------------
-- Core identity, role and merchant model
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  preferred_language text not null default 'ht' check (preferred_language in ('fr','ht','en')),
  account_status text not null default 'active' check (account_status in ('active','restricted','suspended','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin','admin','finance_admin','risk_admin','support_agent','auditor')),
  assigned_by uuid references auth.users(id),
  assigned_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id),
  business_name text not null check (length(trim(business_name)) between 2 and 120),
  business_type text not null check (business_type in ('sole_proprietor','company','cooperative','nonprofit','other')),
  category text,
  contact_phone text,
  address text,
  status text not null default 'pending' check (status in ('pending','under_review','active','rejected','suspended','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.merchant_members (
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null check (member_role in ('owner','admin','finance','cashier','viewer')),
  member_status text not null default 'active' check (member_status in ('invited','active','suspended','removed')),
  added_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (merchant_id, user_id)
);

-- A wallet belongs either to a personal user OR to a merchant, never both.
create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id),
  merchant_id uuid references public.merchants(id),
  currency char(3) not null default 'HTG' check (currency = 'HTG'),
  status text not null default 'active' check (status in ('pending','active','frozen','closed')),
  created_at timestamptz not null default now(),
  check ((owner_user_id is not null and merchant_id is null) or
         (owner_user_id is null and merchant_id is not null))
);
create unique index wallets_personal_owner_uq on public.wallets(owner_user_id) where owner_user_id is not null;
create unique index wallets_merchant_uq on public.wallets(merchant_id) where merchant_id is not null;
create index wallets_merchant_idx on public.wallets(merchant_id);

-- User signup creates a profile and an empty personal wallet. No money is credited.
create or replace function public.handle_new_lakaygopay_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    new.phone
  ) on conflict (id) do nothing;

  insert into public.wallets (owner_user_id, currency, status)
  values (new.id, 'HTG', 'active')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_lakaygopay on auth.users;
create trigger on_auth_user_created_lakaygopay
after insert on auth.users
for each row execute procedure public.handle_new_lakaygopay_user();

-- -----------------------------------------------------------------------------
-- Ledger and money-movement records
-- -----------------------------------------------------------------------------
create table public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_type text not null check (transaction_type in ('wallet_transfer','deposit','withdrawal','merchant_payment','reversal','adjustment')),
  reference_code text not null unique,
  initiated_by uuid references auth.users(id),
  status text not null default 'posted' check (status = 'posted'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  ledger_transaction_id uuid not null references public.ledger_transactions(id),
  wallet_id uuid not null references public.wallets(id),
  direction text not null check (direction in ('debit','credit')),
  amount numeric(20,2) not null check (amount > 0),
  currency char(3) not null default 'HTG' check (currency = 'HTG'),
  created_at timestamptz not null default now()
);
create index ledger_entries_wallet_created_idx on public.ledger_entries(wallet_id, created_at desc);
create index ledger_entries_txn_idx on public.ledger_entries(ledger_transaction_id);

-- A journal cannot commit unless it contains at least two entries and debits equal credits.
create or replace function public.enforce_balanced_ledger_transaction()
returns trigger
language plpgsql
as $$
declare
  v_txn_id uuid;
  v_debits numeric(20,2);
  v_credits numeric(20,2);
  v_count integer;
begin
  v_txn_id := case when tg_table_name = 'ledger_transactions' then new.id else new.ledger_transaction_id end;
  select count(*),
         coalesce(sum(amount) filter (where direction = 'debit'),0),
         coalesce(sum(amount) filter (where direction = 'credit'),0)
    into v_count, v_debits, v_credits
  from public.ledger_entries
  where ledger_transaction_id = v_txn_id;
  if v_count < 2 or v_debits <> v_credits then
    raise exception 'LEDGER_TRANSACTION_NOT_BALANCED';
  end if;
  return null;
end;
$$;
create constraint trigger ledger_transaction_must_balance
 after insert on public.ledger_transactions
 deferrable initially deferred
 for each row execute function public.enforce_balanced_ledger_transaction();
create constraint trigger ledger_entries_must_balance
 after insert on public.ledger_entries
 deferrable initially deferred
 for each row execute function public.enforce_balanced_ledger_transaction();

-- There is no editable balance column. This view derives balances from immutable entries.
create view public.wallet_balances with (security_invoker = true) as
select w.id as wallet_id,
       w.owner_user_id,
       w.merchant_id,
       w.currency,
       w.status,
       coalesce(sum(case when e.direction = 'credit' then e.amount else -e.amount end), 0)::numeric(20,2) as balance,
       w.created_at
from public.wallets w
left join public.ledger_entries e on e.wallet_id = w.id
group by w.id;

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  ledger_transaction_id uuid not null unique references public.ledger_transactions(id),
  sender_wallet_id uuid not null references public.wallets(id),
  recipient_wallet_id uuid not null references public.wallets(id),
  initiated_by uuid not null references auth.users(id),
  amount numeric(20,2) not null check (amount > 0),
  currency char(3) not null default 'HTG' check (currency = 'HTG'),
  note text check (note is null or length(note) <= 140),
  status text not null default 'posted' check (status = 'posted'),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  check (sender_wallet_id <> recipient_wallet_id),
  unique (initiated_by, idempotency_key)
);
create index transfers_sender_created_idx on public.transfers(sender_wallet_id, created_at desc);
create index transfers_recipient_created_idx on public.transfers(recipient_wallet_id, created_at desc);

create table public.idempotency_keys (
  user_id uuid not null references auth.users(id),
  operation text not null,
  idempotency_key text not null,
  resource_id uuid,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, operation, idempotency_key),
  check (length(idempotency_key) between 8 and 128)
);

-- -----------------------------------------------------------------------------
-- Deposits, withdrawals and dual-control approvals
-- -----------------------------------------------------------------------------
create table public.deposit_requests (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id),
  requested_by uuid not null references auth.users(id),
  amount numeric(20,2) not null check (amount > 0),
  currency char(3) not null default 'HTG' check (currency = 'HTG'),
  provider text,
  provider_reference text,
  status text not null default 'pending' check (status in ('pending','under_review','confirmed','rejected','cancelled','failed')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requested_by, idempotency_key),
  unique (provider, provider_reference)
);

create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id),
  requested_by uuid not null references auth.users(id),
  amount numeric(20,2) not null check (amount > 0),
  currency char(3) not null default 'HTG' check (currency = 'HTG'),
  destination_type text not null check (destination_type in ('moncash','natcash','bank','cash_agent','other')),
  destination_reference_encrypted text,
  status text not null default 'submitted' check (status in ('submitted','awaiting_second_approval','approved','rejected','processing','paid','failed','cancelled')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requested_by, idempotency_key)
);

create table public.withdrawal_approvals (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null references public.withdrawal_requests(id),
  admin_user_id uuid not null references auth.users(id),
  decision text not null check (decision in ('approved','rejected')),
  comment text check (comment is null or length(comment) <= 500),
  created_at timestamptz not null default now(),
  unique (withdrawal_id, admin_user_id)
);

create table public.platform_settings (
  setting_key text primary key,
  setting_value jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
-- Safe default: two distinct approvals are required for every withdrawal until an authorized
-- finance administrator deliberately sets a higher HTG threshold.
insert into public.platform_settings(setting_key, setting_value)
values ('withdrawal_two_person_threshold_htg', '{"htg":0}'::jsonb)
on conflict (setting_key) do nothing;

-- -----------------------------------------------------------------------------
-- Merchant QR payment requests (QR code represents a request, not proof of payment)
-- -----------------------------------------------------------------------------
create table public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null unique default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id),
  created_by uuid not null references auth.users(id),
  amount numeric(20,2) check (amount is null or amount > 0),
  currency char(3) not null default 'HTG' check (currency = 'HTG'),
  description text check (description is null or length(description) <= 140),
  status text not null default 'pending' check (status in ('pending','paid','expired','cancelled')),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  paid_ledger_transaction_id uuid references public.ledger_transactions(id),
  created_at timestamptz not null default now()
);
create index payment_requests_merchant_created_idx on public.payment_requests(merchant_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Authentication security, notifications, audit and reporting
-- -----------------------------------------------------------------------------
create table public.otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  destination text not null,
  channel text not null check (channel in ('sms','email','whatsapp')),
  purpose text not null check (purpose in ('signup','login','transfer','withdrawal','change_phone','change_security')),
  otp_hash text not null,
  expires_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  event_type text not null,
  severity text not null default 'info' check (severity in ('info','warning','high','critical')),
  ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('transaction','security','merchant','system','promotion')),
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_created_idx on public.notifications(user_id, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  action text not null,
  resource_type text not null,
  resource_id uuid,
  outcome text not null default 'success' check (outcome in ('success','denied','failure')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs(created_at desc);

-- -----------------------------------------------------------------------------
-- Authorization helpers and immutable ledger protections
-- -----------------------------------------------------------------------------
create or replace function public.has_any_admin_role()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role in ('super_admin','admin','finance_admin','risk_admin','support_agent','auditor')
  );
$$;

create or replace function public.has_role_for_user(p_user_id uuid, p_role text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.user_roles ur where ur.user_id = p_user_id and ur.role = p_role)
      or exists (select 1 from public.user_roles ur where ur.user_id = p_user_id and ur.role = 'super_admin');
$$;

create or replace function public.is_merchant_member(p_merchant_id uuid, p_user_id uuid, p_roles text[] default null)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.merchant_members mm
    where mm.merchant_id = p_merchant_id and mm.user_id = p_user_id
      and mm.member_status = 'active'
      and (p_roles is null or mm.member_role = any(p_roles))
  );
$$;

create or replace function public.is_current_user_merchant_member(p_merchant_id uuid, p_roles text[] default null)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_merchant_member(p_merchant_id, auth.uid(), p_roles);
$$;

create or replace function public.reject_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'LEDGER_IS_APPEND_ONLY';
end;
$$;
create trigger ledger_entries_no_update_delete
before update or delete on public.ledger_entries
for each row execute function public.reject_ledger_mutation();
create trigger ledger_transactions_no_update_delete
before update or delete on public.ledger_transactions
for each row execute function public.reject_ledger_mutation();

-- -----------------------------------------------------------------------------
-- Atomic, idempotent internal transfer. This is ledger movement only; it is not a
-- cash-in/cash-out or payment-provider integration.
-- -----------------------------------------------------------------------------
create or replace function public.post_wallet_transfer(
  p_actor_user_id uuid,
  p_sender_wallet_id uuid,
  p_recipient_wallet_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
  v_existing jsonb;
  v_sender public.wallets%rowtype;
  v_recipient public.wallets%rowtype;
  v_balance numeric(20,2);
  v_ledger_id uuid;
  v_transfer_id uuid;
  v_reference text;
  v_response jsonb;
begin
  if p_actor_user_id is null then raise exception 'ACTOR_REQUIRED'; end if;
  if p_sender_wallet_id = p_recipient_wallet_id then raise exception 'SAME_WALLET_NOT_ALLOWED'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'INVALID_AMOUNT'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  if p_note is not null and length(p_note) > 140 then raise exception 'NOTE_TOO_LONG'; end if;

  insert into public.idempotency_keys(user_id, operation, idempotency_key)
  values (p_actor_user_id, 'wallet_transfer', p_idempotency_key)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select response into v_existing from public.idempotency_keys
    where user_id = p_actor_user_id and operation = 'wallet_transfer' and idempotency_key = p_idempotency_key;
    if v_existing is null then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
    return v_existing;
  end if;

  -- Lock both wallets in stable order to reduce deadlocks under concurrent requests.
  perform id from public.wallets
  where id in (p_sender_wallet_id, p_recipient_wallet_id)
  order by id
  for update;

  select * into v_sender from public.wallets where id = p_sender_wallet_id;
  select * into v_recipient from public.wallets where id = p_recipient_wallet_id;
  if v_sender.id is null or v_recipient.id is null then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_sender.status <> 'active' or v_recipient.status <> 'active' then raise exception 'WALLET_NOT_ACTIVE'; end if;
  if v_sender.currency <> v_recipient.currency then raise exception 'CURRENCY_MISMATCH'; end if;

  if not (
    v_sender.owner_user_id = p_actor_user_id
    or (v_sender.merchant_id is not null and public.is_merchant_member(v_sender.merchant_id, p_actor_user_id, array['owner','admin','finance','cashier']))
  ) then raise exception 'SENDER_WALLET_FORBIDDEN'; end if;

  select coalesce(sum(case when direction = 'credit' then amount else -amount end), 0)
    into v_balance
  from public.ledger_entries where wallet_id = p_sender_wallet_id;
  if v_balance < p_amount then raise exception 'INSUFFICIENT_FUNDS'; end if;

  v_ledger_id := gen_random_uuid();
  v_transfer_id := gen_random_uuid();
  v_reference := 'LGP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20));

  insert into public.ledger_transactions(id, transaction_type, reference_code, initiated_by, metadata)
  values (v_ledger_id, 'wallet_transfer', v_reference, p_actor_user_id, jsonb_build_object('channel','internal'));

  insert into public.ledger_entries(ledger_transaction_id, wallet_id, direction, amount, currency)
  values
    (v_ledger_id, p_sender_wallet_id, 'debit', p_amount, v_sender.currency),
    (v_ledger_id, p_recipient_wallet_id, 'credit', p_amount, v_sender.currency);

  insert into public.transfers(id, ledger_transaction_id, sender_wallet_id, recipient_wallet_id,
                               initiated_by, amount, currency, note, idempotency_key)
  values (v_transfer_id, v_ledger_id, p_sender_wallet_id, p_recipient_wallet_id,
          p_actor_user_id, p_amount, v_sender.currency, nullif(trim(p_note),''), p_idempotency_key);

  v_response := jsonb_build_object(
    'transfer_id', v_transfer_id,
    'ledger_transaction_id', v_ledger_id,
    'reference', v_reference,
    'amount', p_amount,
    'currency', v_sender.currency,
    'status', 'posted'
  );
  update public.idempotency_keys
     set resource_id = v_transfer_id, response = v_response
   where user_id = p_actor_user_id and operation = 'wallet_transfer' and idempotency_key = p_idempotency_key;

  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  values (p_actor_user_id, 'wallet.transfer.posted', 'transfer', v_transfer_id,
          jsonb_build_object('amount',p_amount,'currency',v_sender.currency));
  return v_response;
end;
$$;

-- Register a merchant and provision its empty HTG wallet. Approval is still pending.
create or replace function public.register_merchant_account(
  p_actor_user_id uuid,
  p_business_name text,
  p_business_type text,
  p_category text,
  p_contact_phone text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
  v_existing jsonb;
  v_merchant_id uuid;
  v_wallet_id uuid;
  v_response jsonb;
begin
  if p_actor_user_id is null then raise exception 'ACTOR_REQUIRED'; end if;
  if length(trim(coalesce(p_business_name,''))) not between 2 and 120 then raise exception 'INVALID_BUSINESS_NAME'; end if;
  if p_business_type not in ('sole_proprietor','company','cooperative','nonprofit','other') then raise exception 'INVALID_BUSINESS_TYPE'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;

  insert into public.idempotency_keys(user_id, operation, idempotency_key)
  values (p_actor_user_id, 'merchant_registration', p_idempotency_key)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select response into v_existing from public.idempotency_keys
    where user_id = p_actor_user_id and operation = 'merchant_registration' and idempotency_key = p_idempotency_key;
    if v_existing is null then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
    return v_existing;
  end if;

  insert into public.merchants(owner_user_id, business_name, business_type, category, contact_phone)
  values (p_actor_user_id, trim(p_business_name), p_business_type, nullif(trim(p_category),''), nullif(trim(p_contact_phone),''))
  returning id into v_merchant_id;
  insert into public.merchant_members(merchant_id, user_id, member_role, added_by)
  values (v_merchant_id, p_actor_user_id, 'owner', p_actor_user_id);
  insert into public.wallets(merchant_id, currency, status)
  values (v_merchant_id, 'HTG', 'active') returning id into v_wallet_id;

  v_response := jsonb_build_object('merchant_id',v_merchant_id,'wallet_id',v_wallet_id,'status','pending');
  update public.idempotency_keys set resource_id = v_merchant_id, response = v_response
   where user_id = p_actor_user_id and operation = 'merchant_registration' and idempotency_key = p_idempotency_key;
  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id)
  values (p_actor_user_id, 'merchant.registration.created', 'merchant', v_merchant_id);
  return v_response;
end;
$$;

-- Create a QR payment request. The QR token identifies a request; it does not prove payment.
create or replace function public.create_merchant_payment_request(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_amount numeric,
  p_description text,
  p_expires_in_minutes integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
  v_existing jsonb;
  v_request_id uuid;
  v_token uuid;
  v_response jsonb;
begin
  if not public.is_merchant_member(p_merchant_id, p_actor_user_id, array['owner','admin','finance','cashier']) then raise exception 'MERCHANT_FORBIDDEN'; end if;
  if p_amount is not null and (p_amount <= 0 or p_amount <> round(p_amount,2)) then raise exception 'INVALID_AMOUNT'; end if;
  if p_description is not null and length(p_description) > 140 then raise exception 'DESCRIPTION_TOO_LONG'; end if;
  if p_expires_in_minutes is null or p_expires_in_minutes not between 1 and 1440 then raise exception 'INVALID_EXPIRY'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;

  insert into public.idempotency_keys(user_id, operation, idempotency_key)
  values (p_actor_user_id, 'payment_request', p_idempotency_key)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select response into v_existing from public.idempotency_keys
    where user_id = p_actor_user_id and operation = 'payment_request' and idempotency_key = p_idempotency_key;
    if v_existing is null then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
    return v_existing;
  end if;

  insert into public.payment_requests(merchant_id, created_by, amount, description, expires_at)
  values (p_merchant_id, p_actor_user_id, p_amount, nullif(trim(p_description),''), now() + make_interval(mins => p_expires_in_minutes))
  returning id, public_token into v_request_id, v_token;
  v_response := jsonb_build_object('payment_request_id',v_request_id,'qr_token',v_token,'status','pending','amount',p_amount,'currency','HTG');
  update public.idempotency_keys set resource_id = v_request_id, response = v_response
   where user_id = p_actor_user_id and operation = 'payment_request' and idempotency_key = p_idempotency_key;
  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id)
  values (p_actor_user_id, 'merchant.payment_request.created', 'payment_request', v_request_id);
  return v_response;
end;
$$;

-- Record a withdrawal decision. The caller must be the trusted server; role assignment
-- and payout execution remain separate, audited operational controls.
create or replace function public.record_withdrawal_approval(
  p_admin_user_id uuid,
  p_withdrawal_id uuid,
  p_decision text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.withdrawal_requests%rowtype;
  v_threshold numeric;
  v_required integer;
  v_approved integer;
  v_status text;
begin
  if not (public.has_role_for_user(p_admin_user_id,'admin') or public.has_role_for_user(p_admin_user_id,'finance_admin') or public.has_role_for_user(p_admin_user_id,'risk_admin')) then raise exception 'ADMIN_ROLE_REQUIRED'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'INVALID_DECISION'; end if;

  select * into v_request from public.withdrawal_requests where id = p_withdrawal_id for update;
  if v_request.id is null then raise exception 'WITHDRAWAL_NOT_FOUND'; end if;
  if v_request.requested_by = p_admin_user_id then raise exception 'MAKER_CANNOT_APPROVE_OWN_WITHDRAWAL'; end if;
  if v_request.status not in ('submitted','awaiting_second_approval') then raise exception 'WITHDRAWAL_NOT_REVIEWABLE'; end if;

  insert into public.withdrawal_approvals(withdrawal_id, admin_user_id, decision, comment)
  values (p_withdrawal_id, p_admin_user_id, p_decision, nullif(trim(p_comment),''));

  if p_decision = 'rejected' then
    v_status := 'rejected';
  else
    select coalesce((setting_value->>'htg')::numeric,0) into v_threshold
      from public.platform_settings where setting_key = 'withdrawal_two_person_threshold_htg';
    v_threshold := coalesce(v_threshold,0);
    v_required := case when v_request.amount >= v_threshold then 2 else 1 end;
    select count(*) into v_approved from public.withdrawal_approvals
      where withdrawal_id = p_withdrawal_id and decision = 'approved';
    v_status := case when v_approved >= v_required then 'approved' else 'awaiting_second_approval' end;
  end if;

  update public.withdrawal_requests set status = v_status, updated_at = now() where id = p_withdrawal_id;
  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  values (p_admin_user_id, 'withdrawal.approval.' || p_decision, 'withdrawal', p_withdrawal_id,
          jsonb_build_object('resulting_status',v_status));
  return jsonb_build_object('withdrawal_id',p_withdrawal_id,'status',v_status);
end;
$$;

-- -----------------------------------------------------------------------------
-- Row-level security: users see only their own records / merchant memberships;
-- sensitive writes go through trusted server functions, never direct client inserts.
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.merchants enable row level security;
alter table public.merchant_members enable row level security;
alter table public.wallets enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.transfers enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.deposit_requests enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.withdrawal_approvals enable row level security;
alter table public.platform_settings enable row level security;
alter table public.payment_requests enable row level security;
alter table public.otp_challenges enable row level security;
alter table public.security_events enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select_self_or_admin on public.profiles for select to authenticated
using (id = auth.uid() or public.has_any_admin_role());
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy user_roles_select_self_or_admin on public.user_roles for select to authenticated
using (user_id = auth.uid() or public.has_any_admin_role());

create policy merchants_select_member_or_admin on public.merchants for select to authenticated
using (public.is_current_user_merchant_member(id, null) or public.has_any_admin_role());
create policy merchants_update_owner_or_admin on public.merchants for update to authenticated
using (owner_user_id = auth.uid() or public.has_any_admin_role())
with check (owner_user_id = auth.uid() or public.has_any_admin_role());

create policy merchant_members_select_self_or_owner_or_admin on public.merchant_members for select to authenticated
using (user_id = auth.uid() or public.is_current_user_merchant_member(merchant_id, array['owner','admin']) or public.has_any_admin_role());

create policy wallets_select_owner_member_or_admin on public.wallets for select to authenticated
using (
  owner_user_id = auth.uid()
  or (merchant_id is not null and public.is_current_user_merchant_member(merchant_id, null))
  or public.has_any_admin_role()
);

create policy ledger_transactions_select_related_wallet on public.ledger_transactions for select to authenticated
using (
  exists (
    select 1 from public.ledger_entries le join public.wallets w on w.id = le.wallet_id
    where le.ledger_transaction_id = ledger_transactions.id
      and (w.owner_user_id = auth.uid() or (w.merchant_id is not null and public.is_current_user_merchant_member(w.merchant_id,null)) or public.has_any_admin_role())
  )
);
create policy ledger_entries_select_related_wallet on public.ledger_entries for select to authenticated
using (
  exists (select 1 from public.wallets w where w.id = wallet_id and
    (w.owner_user_id = auth.uid() or (w.merchant_id is not null and public.is_current_user_merchant_member(w.merchant_id,null)) or public.has_any_admin_role()))
);

create policy transfers_select_related_party on public.transfers for select to authenticated
using (
  initiated_by = auth.uid()
  or exists (select 1 from public.wallets w where w.id in (sender_wallet_id,recipient_wallet_id) and
    (w.owner_user_id = auth.uid() or (w.merchant_id is not null and public.is_current_user_merchant_member(w.merchant_id,null)) or public.has_any_admin_role()))
);

create policy deposits_select_own_or_admin on public.deposit_requests for select to authenticated
using (requested_by = auth.uid() or public.has_any_admin_role());
create policy withdrawals_select_own_or_admin on public.withdrawal_requests for select to authenticated
using (requested_by = auth.uid() or public.has_any_admin_role());
create policy withdrawal_approvals_select_admin on public.withdrawal_approvals for select to authenticated
using (public.has_any_admin_role());
create policy platform_settings_select_admin on public.platform_settings for select to authenticated
using (public.has_any_admin_role());
create policy payment_requests_select_merchant_or_admin on public.payment_requests for select to authenticated
using (public.is_current_user_merchant_member(merchant_id,null) or public.has_any_admin_role());
create policy notifications_select_own on public.notifications for select to authenticated
using (user_id = auth.uid());
create policy notifications_update_own_read_state on public.notifications for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy security_events_select_own_or_admin on public.security_events for select to authenticated
using (user_id = auth.uid() or public.has_any_admin_role());
create policy audit_logs_select_admin on public.audit_logs for select to authenticated
using (public.has_any_admin_role());

-- Revoke broad default grants; expose only the minimum client reads/updates.
revoke all on table public.profiles, public.user_roles, public.merchants, public.merchant_members, public.wallets,
  public.ledger_transactions, public.ledger_entries, public.transfers, public.idempotency_keys,
  public.deposit_requests, public.withdrawal_requests, public.withdrawal_approvals, public.platform_settings,
  public.payment_requests, public.otp_challenges, public.security_events, public.notifications, public.audit_logs
  from anon, authenticated;
-- Even the privileged API key cannot write ledger rows directly. Writes go through
-- the SECURITY DEFINER RPCs above, whose EXECUTE grants are explicitly restricted.
revoke insert, update, delete, truncate on table
  public.wallets, public.merchants, public.merchant_members, public.ledger_transactions,
  public.ledger_entries, public.transfers, public.idempotency_keys, public.deposit_requests,
  public.withdrawal_requests, public.withdrawal_approvals, public.platform_settings,
  public.payment_requests, public.otp_challenges, public.security_events, public.notifications, public.audit_logs
  from service_role;
grant select on public.profiles, public.user_roles, public.merchants, public.merchant_members,
  public.wallets, public.wallet_balances, public.ledger_transactions, public.ledger_entries,
  public.transfers, public.deposit_requests, public.withdrawal_requests, public.withdrawal_approvals,
  public.platform_settings, public.payment_requests, public.notifications, public.security_events,
  public.audit_logs to authenticated;
grant update (full_name, preferred_language) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Functions used by RLS are callable by authenticated users; they disclose only booleans.
revoke all on function public.has_any_admin_role() from public, anon;
revoke all on function public.has_role_for_user(uuid,text) from public, anon, authenticated;
revoke all on function public.is_merchant_member(uuid,uuid,text[]) from public, anon, authenticated;
revoke all on function public.is_current_user_merchant_member(uuid,text[]) from public, anon;
grant execute on function public.has_any_admin_role() to authenticated;
grant execute on function public.is_current_user_merchant_member(uuid,text[]) to authenticated;

-- Financial / privileged procedures are server-only.
revoke all on function public.post_wallet_transfer(uuid,uuid,uuid,numeric,text,text) from public, anon, authenticated;
revoke all on function public.register_merchant_account(uuid,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.create_merchant_payment_request(uuid,uuid,numeric,text,integer,text) from public, anon, authenticated;
revoke all on function public.record_withdrawal_approval(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.post_wallet_transfer(uuid,uuid,uuid,numeric,text,text) to service_role;
grant execute on function public.register_merchant_account(uuid,text,text,text,text,text) to service_role;
grant execute on function public.create_merchant_payment_request(uuid,uuid,numeric,text,integer,text) to service_role;
grant execute on function public.record_withdrawal_approval(uuid,uuid,text,text) to service_role;

-- Admin daily reporting; underlying RLS limits this view to rows visible to the caller.
create view public.admin_daily_ledger_summary with (security_invoker = true) as
select date_trunc('day', le.created_at)::date as ledger_date,
       le.currency,
       count(distinct le.ledger_transaction_id) as transaction_count,
       sum(case when le.direction = 'credit' then le.amount else 0 end)::numeric(20,2) as total_credits,
       sum(case when le.direction = 'debit' then le.amount else 0 end)::numeric(20,2) as total_debits
from public.ledger_entries le
where public.has_any_admin_role()
group by date_trunc('day', le.created_at)::date, le.currency;
grant select on public.admin_daily_ledger_summary to authenticated;

comment on table public.ledger_entries is 'Append-only double-entry ledger. Never update or delete entries.';
comment on view public.wallet_balances is 'Derived balance; do not store or edit wallet balances directly.';
comment on table public.payment_requests is 'QR-linked payment request only; status paid must be set by trusted settlement backend.';
comment on table public.otp_challenges is 'Store OTP hashes only; plaintext OTP values must never be persisted.';
