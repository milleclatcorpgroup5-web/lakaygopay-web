-- LakayGoPay Connect: partner payment-provider foundation.
-- Additive migration. Requires the existing financial core, merchant payment,
-- multi-currency, and admin-security migrations to have been applied first.
-- Sandbox-only release; no external cash-in/cash-out rails.
begin;

create table if not exists public.connect_apps (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id),
  merchant_id uuid not null references public.merchants(id),
  app_name text not null check (length(trim(app_name)) between 2 and 100),
  website_url text not null check (website_url ~ '^https://'),
  status text not null default 'pending' check (status in ('pending','active','rejected','suspended')),
  mode text not null default 'sandbox' check (mode = 'sandbox'),
  capabilities text[] not null default array['checkout','payout']::text[],
  client_id text not null unique default ('lgp_test_' || replace(gen_random_uuid()::text,'-','')),
  client_secret_hash text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (capabilities <@ array['checkout','payout']::text[]),
  unique (owner_user_id, merchant_id, app_name)
);
create index if not exists connect_apps_owner_created_idx on public.connect_apps(owner_user_id, created_at desc);
create index if not exists connect_apps_status_created_idx on public.connect_apps(status, created_at desc);

create table if not exists public.connect_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.connect_apps(id),
  payment_request_id uuid not null unique references public.payment_requests(id),
  external_reference text not null check (length(external_reference) between 1 and 120),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  request_fingerprint text not null,
  amount numeric(20,2) not null check (amount > 0),
  currency char(3) not null check (currency in ('HTG','USD','EUR')),
  description text check (description is null or length(description) <= 140),
  success_url text check (success_url is null or success_url ~ '^https://'),
  status text not null default 'pending' check (status in ('pending','paid','expired','cancelled')),
  ledger_transaction_id uuid references public.ledger_transactions(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  unique (app_id, external_reference),
  unique (app_id, idempotency_key)
);
create index if not exists connect_checkout_app_created_idx on public.connect_checkout_sessions(app_id, created_at desc);
create index if not exists connect_checkout_status_expiry_idx on public.connect_checkout_sessions(status, expires_at);

create table if not exists public.connect_payout_requests (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.connect_apps(id),
  partner_app_name text not null,
  external_reference text not null check (length(external_reference) between 1 and 120),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  request_fingerprint text not null,
  recipient_user_id uuid not null references auth.users(id),
  merchant_wallet_id uuid not null references public.wallets(id),
  recipient_wallet_id uuid references public.wallets(id),
  amount numeric(20,2) not null check (amount > 0),
  currency char(3) not null check (currency in ('HTG','USD','EUR')),
  description text check (description is null or length(description) <= 140),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','expired','cancelled')),
  ledger_transaction_id uuid references public.ledger_transactions(id),
  result jsonb,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (app_id, external_reference),
  unique (app_id, idempotency_key)
);
create index if not exists connect_payout_recipient_status_idx on public.connect_payout_requests(recipient_user_id, status, created_at desc);
create index if not exists connect_payout_app_created_idx on public.connect_payout_requests(app_id, created_at desc);

alter table public.connect_apps enable row level security;
alter table public.connect_checkout_sessions enable row level security;
alter table public.connect_payout_requests enable row level security;

drop policy if exists connect_apps_select_owner on public.connect_apps;
create policy connect_apps_select_owner on public.connect_apps for select to authenticated using (owner_user_id = auth.uid());
drop policy if exists connect_payouts_select_recipient on public.connect_payout_requests;
create policy connect_payouts_select_recipient on public.connect_payout_requests for select to authenticated using (recipient_user_id = auth.uid());

revoke all on public.connect_apps, public.connect_checkout_sessions, public.connect_payout_requests from anon, authenticated;
grant select (id, owner_user_id, merchant_id, app_name, website_url, status, mode,
  capabilities, client_id, reviewed_at, review_note, created_at, updated_at) on public.connect_apps to authenticated;
grant select (id, app_id, partner_app_name, external_reference, recipient_user_id,
  amount, currency, description, status, expires_at, accepted_at, created_at) on public.connect_payout_requests to authenticated;
grant select on public.connect_apps, public.connect_checkout_sessions, public.connect_payout_requests to service_role;
grant insert, update on public.connect_apps, public.connect_checkout_sessions, public.connect_payout_requests to service_role;

create or replace function public.connect_create_application(p_owner_user_id uuid,p_merchant_id uuid,p_app_name text,p_website_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_app public.connect_apps%rowtype;
begin
  if p_owner_user_id is null or p_merchant_id is null then raise exception 'CONNECT_OWNER_REQUIRED'; end if;
  if p_app_name is null or length(trim(p_app_name)) not between 2 and 100 then raise exception 'CONNECT_APP_NAME_INVALID'; end if;
  if p_website_url is null or p_website_url !~ '^https://' then raise exception 'CONNECT_HTTPS_URL_REQUIRED'; end if;
  if not exists (select 1 from public.merchants m where m.id=p_merchant_id and m.owner_user_id=p_owner_user_id and m.status='active') then
    raise exception 'CONNECT_ACTIVE_MERCHANT_OWNER_REQUIRED';
  end if;
  insert into public.connect_apps(owner_user_id,merchant_id,app_name,website_url)
  values (p_owner_user_id,p_merchant_id,trim(p_app_name),trim(p_website_url)) returning * into v_app;
  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  values (p_owner_user_id,'connect.application.submitted','connect_app',v_app.id,
    jsonb_build_object('app_name',v_app.app_name,'merchant_id',v_app.merchant_id,'mode','sandbox'));
  return jsonb_build_object('id',v_app.id,'app_name',v_app.app_name,'merchant_id',v_app.merchant_id,
    'status',v_app.status,'mode',v_app.mode,'client_id',v_app.client_id,'capabilities',v_app.capabilities,'created_at',v_app.created_at);
end; $$;

create or replace function public.connect_issue_credentials(p_owner_user_id uuid,p_app_id uuid,p_secret_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_app public.connect_apps%rowtype;
begin
  if p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then raise exception 'CONNECT_SECRET_HASH_INVALID'; end if;
  select * into v_app from public.connect_apps where id=p_app_id and owner_user_id=p_owner_user_id for update;
  if v_app.id is null then raise exception 'CONNECT_APP_NOT_FOUND'; end if;
  if v_app.status <> 'active' then raise exception 'CONNECT_APP_NOT_APPROVED'; end if;
  update public.connect_apps set client_secret_hash=p_secret_hash,updated_at=now() where id=p_app_id;
  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  values (p_owner_user_id,'connect.credentials.rotated','connect_app',p_app_id,jsonb_build_object('mode','sandbox'));
  return jsonb_build_object('client_id',v_app.client_id,'mode','sandbox','rotated_at',now());
end; $$;

create or replace function public.connect_review_application(p_admin_user_id uuid,p_app_id uuid,p_decision text,p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_app public.connect_apps%rowtype; v_status text;
begin
  if not exists (select 1 from public.user_roles ur where ur.user_id=p_admin_user_id and ur.role in ('super_admin','admin','finance_admin','risk_admin')) then
    raise exception 'ADMIN_ROLE_REQUIRED';
  end if;
  if p_decision not in ('approve','reject','suspend','reactivate') then raise exception 'CONNECT_REVIEW_DECISION_INVALID'; end if;
  select * into v_app from public.connect_apps where id=p_app_id for update;
  if v_app.id is null then raise exception 'CONNECT_APP_NOT_FOUND'; end if;
  v_status := case p_decision when 'approve' then 'active' when 'reject' then 'rejected' when 'suspend' then 'suspended' when 'reactivate' then 'active' end;
  if p_decision in ('approve','reject') and v_app.status <> 'pending' then raise exception 'CONNECT_APP_NOT_PENDING'; end if;
  if p_decision='reactivate' and v_app.status <> 'suspended' then raise exception 'CONNECT_APP_NOT_SUSPENDED'; end if;
  if p_decision='suspend' and v_app.status <> 'active' then raise exception 'CONNECT_APP_NOT_ACTIVE'; end if;
  update public.connect_apps set status=v_status,reviewed_by=p_admin_user_id,reviewed_at=now(),
    review_note=nullif(trim(p_note),''),updated_at=now() where id=p_app_id;
  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  values (p_admin_user_id,'connect.application.'||p_decision,'connect_app',p_app_id,
    jsonb_build_object('previous_status',v_app.status,'new_status',v_status,'note',p_note));
  return jsonb_build_object('id',p_app_id,'status',v_status,'reviewed_at',now());
end; $$;

create or replace function public.connect_create_checkout_session(
  p_app_id uuid,p_external_reference text,p_idempotency_key text,p_amount numeric,p_currency text,
  p_description text,p_success_url text,p_expires_in_minutes integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_app public.connect_apps%rowtype; v_existing public.connect_checkout_sessions%rowtype;
  v_request_id uuid; v_public_token uuid; v_id uuid; v_fingerprint text; v_expires timestamptz;
begin
  select * into v_app from public.connect_apps where id=p_app_id and status='active';
  if v_app.id is null or v_app.mode <> 'sandbox' then raise exception 'CONNECT_APP_NOT_ACTIVE'; end if;
  if not ('checkout'=any(v_app.capabilities)) then raise exception 'CONNECT_CAPABILITY_DENIED'; end if;
  if p_external_reference is null or length(p_external_reference) not between 1 and 120 then raise exception 'CONNECT_EXTERNAL_REFERENCE_INVALID'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'INVALID_AMOUNT'; end if;
  if p_currency not in ('HTG','USD','EUR') then raise exception 'CONNECT_CURRENCY_NOT_SUPPORTED'; end if;
  if p_description is not null and length(p_description)>140 then raise exception 'DESCRIPTION_TOO_LONG'; end if;
  if p_success_url is not null and p_success_url !~ '^https://' then raise exception 'CONNECT_HTTPS_URL_REQUIRED'; end if;
  if p_expires_in_minutes is null or p_expires_in_minutes not between 1 and 60 then raise exception 'INVALID_EXPIRY';
  end if;
  v_fingerprint := md5(jsonb_build_array(p_external_reference,p_amount,p_currency,coalesce(p_description,''),coalesce(p_success_url,''))::text);
  select * into v_existing from public.connect_checkout_sessions where app_id=p_app_id and idempotency_key=p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('checkout_id',v_existing.id,'external_reference',v_existing.external_reference,
      'amount',v_existing.amount,'currency',v_existing.currency,'status',v_existing.status,
      'expires_at',v_existing.expires_at,'payment_request_id',v_existing.payment_request_id);
  end if;
  if not exists (select 1 from public.merchants where id=v_app.merchant_id and status='active') then raise exception 'MERCHANT_NOT_ACTIVE'; end if;
  v_expires := now()+make_interval(mins=>p_expires_in_minutes);
  insert into public.payment_requests(merchant_id,created_by,amount,currency,description,expires_at)
  values (v_app.merchant_id,v_app.owner_user_id,p_amount,p_currency,nullif(trim(p_description),''),v_expires)
  returning id,public_token into v_request_id,v_public_token;
  insert into public.connect_checkout_sessions(app_id,payment_request_id,external_reference,idempotency_key,
    request_fingerprint,amount,currency,description,success_url,expires_at)
  values (p_app_id,v_request_id,trim(p_external_reference),p_idempotency_key,v_fingerprint,
    p_amount,p_currency,nullif(trim(p_description),''),p_success_url,v_expires) returning id into v_id;
  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  values (v_app.owner_user_id,'connect.checkout.created','connect_checkout',v_id,
    jsonb_build_object('app_id',p_app_id,'external_reference',p_external_reference,'amount',p_amount,'currency',p_currency,'mode','sandbox'));
  return jsonb_build_object('checkout_id',v_id,'external_reference',trim(p_external_reference),
    'payment_request_id',v_request_id,'amount',p_amount,'currency',p_currency,'status','pending','expires_at',v_expires);
end; $$;

create or replace function public.connect_get_checkout_for_customer(p_actor_user_id uuid,p_checkout_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.connect_checkout_sessions%rowtype; v_merchant public.merchants%rowtype;
begin
  select * into v_session from public.connect_checkout_sessions where id=p_checkout_id;
  if v_session.id is null then raise exception 'CONNECT_CHECKOUT_NOT_FOUND'; end if;
  select * into v_merchant from public.merchants where id=(select merchant_id from public.connect_apps where id=v_session.app_id);
  if v_session.status='pending' and v_session.expires_at<=now() then
    update public.connect_checkout_sessions set status='expired' where id=v_session.id;
    update public.payment_requests set status='expired' where id=v_session.payment_request_id and status='pending';
    v_session.status := 'expired';
  end if;
  return jsonb_build_object('checkout_id',v_session.id,'app_name',(select app_name from public.connect_apps where id=v_session.app_id),
    'merchant_name',v_merchant.business_name,'amount',v_session.amount,'currency',v_session.currency,
    'description',v_session.description,'status',v_session.status,'expires_at',v_session.expires_at,'success_url',v_session.success_url);
end; $$;

create or replace function public.connect_pay_checkout_session(p_actor_user_id uuid,p_checkout_id uuid,p_payer_wallet_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.connect_checkout_sessions%rowtype; v_request public.payment_requests%rowtype; v_result jsonb;
begin
  select * into v_session from public.connect_checkout_sessions where id=p_checkout_id for update;
  if v_session.id is null then raise exception 'CONNECT_CHECKOUT_NOT_FOUND'; end if;
  if v_session.status='paid' then return jsonb_build_object('status','paid','ledger_transaction_id',v_session.ledger_transaction_id); end if;
  if v_session.status<>'pending' or v_session.expires_at<=now() then raise exception 'CONNECT_CHECKOUT_NOT_PAYABLE'; end if;
  if not exists (
    select 1 from public.connect_apps a
    join public.merchants m on m.id=a.merchant_id
    where a.id=v_session.app_id and a.status='active' and a.mode='sandbox' and m.status='active'
  ) then raise exception 'CONNECT_APP_NOT_ACTIVE'; end if;
  select * into v_request from public.payment_requests where id=v_session.payment_request_id;
  if v_request.id is null or v_request.status<>'pending' then raise exception 'CONNECT_CHECKOUT_NOT_PAYABLE'; end if;
  v_result := public.pay_merchant_payment_request(p_actor_user_id,v_request.public_token,p_payer_wallet_id,v_session.amount,p_idempotency_key);
  if v_result->>'status'<>'paid' then raise exception 'CONNECT_SETTLEMENT_FAILED'; end if;
  return v_result;
end; $$;

create or replace function public.connect_sync_checkout_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='paid' and old.status is distinct from 'paid' then
    update public.connect_checkout_sessions set status='paid',ledger_transaction_id=new.paid_ledger_transaction_id,completed_at=now()
     where payment_request_id=new.id and status='pending';
  end if;
  return new;
end; $$;
drop trigger if exists payment_requests_sync_connect_checkout on public.payment_requests;
create trigger payment_requests_sync_connect_checkout after update of status on public.payment_requests
for each row execute function public.connect_sync_checkout_payment();

create or replace function public.connect_create_payout_request(
  p_app_id uuid,p_external_reference text,p_idempotency_key text,p_recipient_user_id uuid,
  p_amount numeric,p_currency text,p_description text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_app public.connect_apps%rowtype; v_merchant_wallet public.wallets%rowtype;
  v_existing public.connect_payout_requests%rowtype; v_id uuid; v_fingerprint text; v_available numeric(20,2);
begin
  select * into v_app from public.connect_apps where id=p_app_id and status='active';
  if v_app.id is null or v_app.mode<>'sandbox' then raise exception 'CONNECT_APP_NOT_ACTIVE'; end if;
  if not exists (select 1 from public.merchants where id=v_app.merchant_id and status='active') then raise exception 'MERCHANT_NOT_ACTIVE'; end if;
  if not ('payout'=any(v_app.capabilities)) then raise exception 'CONNECT_CAPABILITY_DENIED'; end if;
  if p_external_reference is null or length(p_external_reference) not between 1 and 120 then raise exception 'CONNECT_EXTERNAL_REFERENCE_INVALID'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  if p_recipient_user_id is null then raise exception 'CONNECT_RECIPIENT_REQUIRED'; end if;
  if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'INVALID_AMOUNT'; end if;
  if p_currency not in ('HTG','USD','EUR') then raise exception 'CONNECT_CURRENCY_NOT_SUPPORTED'; end if;
  if p_description is not null and length(p_description)>140 then raise exception 'DESCRIPTION_TOO_LONG'; end if;
  if not exists (select 1 from public.profiles where id=p_recipient_user_id and account_status='active') then raise exception 'CONNECT_RECIPIENT_NOT_ACTIVE'; end if;
  select * into v_merchant_wallet from public.wallets where merchant_id=v_app.merchant_id and currency=p_currency and status='active' and is_system=false for update;
  if v_merchant_wallet.id is null then raise exception 'MERCHANT_WALLET_NOT_FOUND'; end if;
  if not exists (select 1 from public.wallets where owner_user_id=p_recipient_user_id and currency=p_currency and status='active') then
    raise exception 'CONNECT_RECIPIENT_WALLET_NOT_FOUND';
  end if;
  v_fingerprint := md5(jsonb_build_array(p_external_reference,p_recipient_user_id,p_amount,p_currency,coalesce(p_description,''))::text);
  select * into v_existing from public.connect_payout_requests where app_id=p_app_id and idempotency_key=p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('payout_id',v_existing.id,'external_reference',v_existing.external_reference,
      'amount',v_existing.amount,'currency',v_existing.currency,'status',v_existing.status,'expires_at',v_existing.expires_at);
  end if;

  -- Reserve pending payouts against the merchant wallet so requests cannot
  -- oversubscribe the same internal balance.
  select
    coalesce((select sum(case when direction='credit' then amount else -amount end)
              from public.ledger_entries where wallet_id=v_merchant_wallet.id),0)
    - coalesce((select sum(amount) from public.withdrawal_requests
                where wallet_id=v_merchant_wallet.id
                  and status in ('submitted','awaiting_second_approval','approved','processing')),0)
    - coalesce((select sum(amount) from public.connect_payout_requests
                where merchant_wallet_id=v_merchant_wallet.id and status='pending' and expires_at>now()),0)
    into v_available;
  if v_available < p_amount then raise exception 'INSUFFICIENT_AVAILABLE_FUNDS'; end if;

  insert into public.connect_payout_requests(app_id,partner_app_name,external_reference,idempotency_key,request_fingerprint,
    recipient_user_id,merchant_wallet_id,amount,currency,description)
  values (p_app_id,v_app.app_name,trim(p_external_reference),p_idempotency_key,v_fingerprint,
    p_recipient_user_id,v_merchant_wallet.id,p_amount,p_currency,nullif(trim(p_description),'')) returning id into v_id;
  insert into public.notifications(user_id,category,title,body,payload)
  values (p_recipient_user_id,'transaction','Nouvo peman LakayGoPay Connect',
    v_app.app_name||' voye yon demann peman '||p_amount::text||' '||p_currency||'. Ou dwe verifye epi aksepte li.',
    jsonb_build_object('kind','connect_payout','payout_id',v_id,'app_id',p_app_id,'amount',p_amount,'currency',p_currency));
  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  values (v_app.owner_user_id,'connect.payout.requested','connect_payout',v_id,
    jsonb_build_object('app_id',p_app_id,'recipient_user_id',p_recipient_user_id,'amount',p_amount,'currency',p_currency,'mode','sandbox'));
  return jsonb_build_object('payout_id',v_id,'external_reference',trim(p_external_reference),'amount',p_amount,
    'currency',p_currency,'status','pending','expires_at',now()+interval '30 minutes');
end; $$;


create or replace function public.connect_reject_payout(p_actor_user_id uuid,p_payout_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_payout public.connect_payout_requests%rowtype;
begin
  select * into v_payout from public.connect_payout_requests where id=p_payout_id for update;
  if v_payout.id is null then raise exception 'CONNECT_PAYOUT_NOT_FOUND'; end if;
  if v_payout.recipient_user_id<>p_actor_user_id then raise exception 'CONNECT_PAYOUT_FORBIDDEN'; end if;
  if v_payout.status='rejected' then
    return jsonb_build_object('payout_id',v_payout.id,'status','rejected');
  end if;
  if v_payout.status<>'pending' then raise exception 'CONNECT_PAYOUT_NOT_PENDING'; end if;
  update public.connect_payout_requests set status='rejected' where id=v_payout.id;
  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  values (p_actor_user_id,'connect.payout.rejected','connect_payout',v_payout.id,
    jsonb_build_object('app_id',v_payout.app_id,'amount',v_payout.amount,'currency',v_payout.currency));
  return jsonb_build_object('payout_id',v_payout.id,'status','rejected');
end; $$;

create or replace function public.connect_accept_payout(p_actor_user_id uuid,p_payout_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_payout public.connect_payout_requests%rowtype; v_source public.wallets%rowtype;
  v_target public.wallets%rowtype; v_available numeric(20,2); v_ledger_id uuid; v_reference text; v_result jsonb;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  select * into v_payout from public.connect_payout_requests where id=p_payout_id for update;
  if v_payout.id is null then raise exception 'CONNECT_PAYOUT_NOT_FOUND'; end if;
  if v_payout.recipient_user_id<>p_actor_user_id then raise exception 'CONNECT_PAYOUT_FORBIDDEN'; end if;
  if v_payout.status='accepted' and v_payout.accepted_by=p_actor_user_id then
    return coalesce(v_payout.result,jsonb_build_object('status','accepted','ledger_transaction_id',v_payout.ledger_transaction_id));
  end if;
  if v_payout.status<>'pending' then raise exception 'CONNECT_PAYOUT_NOT_PENDING'; end if;
  if not exists (
    select 1 from public.connect_apps a
    join public.merchants m on m.id=a.merchant_id
    where a.id=v_payout.app_id and a.status='active' and a.mode='sandbox' and m.status='active'
  ) then raise exception 'CONNECT_APP_NOT_ACTIVE'; end if;
  if v_payout.expires_at<=now() then update public.connect_payout_requests set status='expired' where id=p_payout_id; raise exception 'CONNECT_PAYOUT_EXPIRED'; end if;
  select * into v_source from public.wallets where id=v_payout.merchant_wallet_id;
  select * into v_target from public.wallets where owner_user_id=p_actor_user_id and currency=v_payout.currency and status='active';
  if v_source.id is null or v_target.id is null then raise exception 'CONNECT_PAYOUT_WALLET_UNAVAILABLE'; end if;
  if v_source.status<>'active' or v_source.is_system or v_target.is_system then raise exception 'WALLET_NOT_ACTIVE'; end if;
  if v_source.currency<>v_target.currency then raise exception 'CURRENCY_MISMATCH'; end if;
  perform id from public.wallets where id in (v_source.id,v_target.id) order by id for update;
  select
    coalesce((select sum(case when direction='credit' then amount else -amount end)
              from public.ledger_entries where wallet_id=v_source.id),0)
    - coalesce((select sum(amount) from public.withdrawal_requests where wallet_id=v_source.id
                and status in ('submitted','awaiting_second_approval','approved','processing')),0)
    - coalesce((select sum(amount) from public.connect_payout_requests
                where merchant_wallet_id=v_source.id and status='pending'
                  and expires_at>now() and id<>v_payout.id),0)
    into v_available;
  if v_available<v_payout.amount then raise exception 'INSUFFICIENT_AVAILABLE_FUNDS'; end if;
  v_ledger_id:=gen_random_uuid();
  v_reference:='LGP-CONNECT-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
  insert into public.ledger_transactions(id,transaction_type,reference_code,initiated_by,metadata)
  values (v_ledger_id,'wallet_transfer',v_reference,p_actor_user_id,
    jsonb_build_object('channel','connect_payout','connect_app_id',v_payout.app_id,'connect_payout_id',v_payout.id));
  insert into public.ledger_entries(ledger_transaction_id,wallet_id,direction,amount,currency)
  values (v_ledger_id,v_source.id,'debit',v_payout.amount,v_source.currency),
         (v_ledger_id,v_target.id,'credit',v_payout.amount,v_source.currency);
  v_result:=jsonb_build_object('payout_id',v_payout.id,'ledger_transaction_id',v_ledger_id,'reference',v_reference,
    'amount',v_payout.amount,'currency',v_payout.currency,'status','accepted');
  update public.connect_payout_requests set status='accepted',recipient_wallet_id=v_target.id,ledger_transaction_id=v_ledger_id,
    accepted_by=p_actor_user_id,accepted_at=now(),result=v_result where id=v_payout.id;
  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  values (p_actor_user_id,'connect.payout.accepted','connect_payout',v_payout.id,
    jsonb_build_object('app_id',v_payout.app_id,'amount',v_payout.amount,'currency',v_payout.currency,'ledger_transaction_id',v_ledger_id));
  return v_result;
end; $$;

create or replace function public.connect_list_my_payouts(p_actor_user_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('payouts',coalesce(jsonb_agg(jsonb_build_object(
    'payout_id',p.id,'app_name',p.partner_app_name,'external_reference',p.external_reference,
    'amount',p.amount,'currency',p.currency,'description',p.description,'status',p.status,
    'expires_at',p.expires_at,'created_at',p.created_at
  ) order by p.created_at desc),'[]'::jsonb))
  from public.connect_payout_requests p where p.recipient_user_id=p_actor_user_id
    and (p.status='pending' or p.created_at>=now()-interval '30 days');
$$;

create or replace function public.connect_partner_checkout_status(p_app_id uuid,p_external_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.connect_checkout_sessions%rowtype;
begin
  select * into v_session from public.connect_checkout_sessions where app_id=p_app_id and external_reference=p_external_reference;
  if v_session.id is null then raise exception 'CONNECT_CHECKOUT_NOT_FOUND'; end if;
  if v_session.status='pending' and v_session.expires_at<=now() then
    update public.connect_checkout_sessions set status='expired' where id=v_session.id;
    update public.payment_requests set status='expired' where id=v_session.payment_request_id and status='pending';
    v_session.status:='expired';
  end if;
  return jsonb_build_object('checkout_id',v_session.id,'external_reference',v_session.external_reference,
    'amount',v_session.amount,'currency',v_session.currency,'status',v_session.status,
    'ledger_transaction_id',v_session.ledger_transaction_id,'created_at',v_session.created_at,'completed_at',v_session.completed_at);
end; $$;

create or replace function public.connect_partner_payout_status(p_app_id uuid,p_external_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_payout public.connect_payout_requests%rowtype;
begin
  select * into v_payout from public.connect_payout_requests where app_id=p_app_id and external_reference=p_external_reference;
  if v_payout.id is null then raise exception 'CONNECT_PAYOUT_NOT_FOUND'; end if;
  if v_payout.status='pending' and v_payout.expires_at<=now() then
    update public.connect_payout_requests set status='expired' where id=v_payout.id;
    v_payout.status:='expired';
  end if;
  return jsonb_build_object('payout_id',v_payout.id,'external_reference',v_payout.external_reference,
    'amount',v_payout.amount,'currency',v_payout.currency,'status',v_payout.status,
    'ledger_transaction_id',v_payout.ledger_transaction_id,'created_at',v_payout.created_at,'accepted_at',v_payout.accepted_at);
end; $$;

revoke all on function public.connect_create_application(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.connect_issue_credentials(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.connect_review_application(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.connect_create_checkout_session(uuid,text,text,numeric,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.connect_get_checkout_for_customer(uuid,uuid) from public,anon,authenticated;
revoke all on function public.connect_pay_checkout_session(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.connect_create_payout_request(uuid,text,text,uuid,numeric,text,text) from public,anon,authenticated;
revoke all on function public.connect_reject_payout(uuid,uuid) from public,anon,authenticated;
revoke all on function public.connect_accept_payout(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.connect_list_my_payouts(uuid) from public,anon,authenticated;
revoke all on function public.connect_partner_checkout_status(uuid,text) from public,anon,authenticated;
revoke all on function public.connect_partner_payout_status(uuid,text) from public,anon,authenticated;

grant execute on function public.connect_create_application(uuid,uuid,text,text) to service_role;
grant execute on function public.connect_issue_credentials(uuid,uuid,text) to service_role;
grant execute on function public.connect_review_application(uuid,uuid,text,text) to service_role;
grant execute on function public.connect_create_checkout_session(uuid,text,text,numeric,text,text,text,integer) to service_role;
grant execute on function public.connect_get_checkout_for_customer(uuid,uuid) to service_role;
grant execute on function public.connect_pay_checkout_session(uuid,uuid,uuid,text) to service_role;
grant execute on function public.connect_create_payout_request(uuid,text,text,uuid,numeric,text,text) to service_role;
grant execute on function public.connect_reject_payout(uuid,uuid) to service_role;
grant execute on function public.connect_accept_payout(uuid,uuid,text) to service_role;
grant execute on function public.connect_list_my_payouts(uuid) to service_role;
grant execute on function public.connect_partner_checkout_status(uuid,text) to service_role;
grant execute on function public.connect_partner_payout_status(uuid,text) to service_role;
commit;
