-- Production-compatible personal receive QR / ID requests.
-- All funds movement is delegated to the existing public.transfer_funds() RPC.
begin;

create table if not exists public.personal_receive_requests (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null unique default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id),
  recipient_wallet_id uuid not null references public.wallets(id),
  amount numeric(20,2) check (amount is null or amount > 0),
  currency text not null,
  status text not null default 'pending'
    check (status in ('pending','paid','expired','cancelled')),
  expires_at timestamptz not null,
  paid_transfer_id uuid unique references public.transfers(id),
  paid_by_user_id uuid references auth.users(id),
  paid_idempotency_key text,
  request_idempotency_key text not null,
  request_fingerprint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (
    (status = 'paid' and paid_transfer_id is not null
      and paid_by_user_id is not null and paid_idempotency_key is not null)
    or
    (status <> 'paid' and paid_transfer_id is null
      and paid_by_user_id is null and paid_idempotency_key is null)
  ),
  unique (recipient_user_id, request_idempotency_key)
);

create index if not exists personal_receive_requests_pending_expiry_idx
  on public.personal_receive_requests(expires_at) where status = 'pending';
create index if not exists personal_receive_requests_recipient_created_idx
  on public.personal_receive_requests(recipient_user_id, created_at desc);
create unique index if not exists personal_receive_requests_paid_idempotency_uidx
  on public.personal_receive_requests(paid_by_user_id, paid_idempotency_key)
  where paid_by_user_id is not null and paid_idempotency_key is not null;

alter table public.personal_receive_requests enable row level security;
revoke all on table public.personal_receive_requests from public, anon, authenticated;

create or replace function public.create_personal_receive_request(
  p_recipient_wallet_id uuid, p_amount numeric, p_expires_in_minutes integer, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_wallet public.wallets%rowtype;
  v_existing public.personal_receive_requests%rowtype;
  v_fingerprint text;
  v_request_id uuid;
  v_token uuid;
  v_expires_at timestamptz;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_recipient_wallet_id is null then raise exception 'RECEIVE_REQUEST_ARGUMENT_INVALID'; end if;
  if p_amount is not null and (
    p_amount::text in ('NaN','Infinity','-Infinity') or p_amount <= 0
    or p_amount >= 1000000000000000000 or p_amount <> pg_catalog.round(p_amount,2)
  ) then raise exception 'INVALID_AMOUNT'; end if;
  if p_expires_in_minutes is null or p_expires_in_minutes not between 15 and 30 then
    raise exception 'INVALID_EXPIRY';
  end if;
  if p_idempotency_key is null
    or pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) not between 8 and 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if not exists (select 1 from public.profiles
    where id = v_actor and account_status = 'active') then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'receive-create:' || v_actor::text || ':' || pg_catalog.btrim(p_idempotency_key), 0
  ));
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_recipient_wallet_id, p_amount, p_expires_in_minutes
  )::text);

  select * into v_existing from public.personal_receive_requests
  where recipient_user_id = v_actor
    and request_idempotency_key = pg_catalog.btrim(p_idempotency_key)
  for update;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return pg_catalog.jsonb_build_object(
      'request_id', v_existing.id, 'qr_token', v_existing.public_token,
      'amount', v_existing.amount, 'currency', v_existing.currency,
      'status', v_existing.status, 'expires_at', v_existing.expires_at
    );
  end if;

  select * into v_wallet from public.wallets
  where id = p_recipient_wallet_id and owner_user_id = v_actor
    and merchant_id is null and status = 'active'
  for update;
  if not found then raise exception 'RECIPIENT_WALLET_FORBIDDEN'; end if;
  if not exists (select 1 from public.wallet_balances where wallet_id = v_wallet.id) then
    raise exception 'WALLET_BALANCE_NOT_FOUND';
  end if;
  if not exists (select 1 from public.ledger_accounts
    where wallet_id = v_wallet.id and currency = v_wallet.currency
      and account_type = 'liability' and is_system = false) then
    raise exception 'RECIPIENT_LEDGER_ACCOUNT_NOT_FOUND';
  end if;

  v_expires_at := pg_catalog.now() + pg_catalog.make_interval(mins => p_expires_in_minutes);
  insert into public.personal_receive_requests (
    recipient_user_id, recipient_wallet_id, amount, currency, expires_at,
    request_idempotency_key, request_fingerprint
  ) values (
    v_actor, v_wallet.id, p_amount, v_wallet.currency, v_expires_at,
    pg_catalog.btrim(p_idempotency_key), v_fingerprint
  ) returning id, public_token into v_request_id, v_token;

  insert into public.audit_logs (
    actor_user_id, action, resource_type, resource_id, outcome, metadata
  ) values (
    v_actor, 'personal.receive_request.created', 'personal_receive_request',
    v_request_id, 'success',
    pg_catalog.jsonb_build_object('currency', v_wallet.currency, 'amount', p_amount)
  );

  return pg_catalog.jsonb_build_object(
    'request_id', v_request_id, 'qr_token', v_token, 'amount', p_amount,
    'currency', v_wallet.currency, 'status', 'pending',
    'expires_in_minutes', p_expires_in_minutes, 'expires_at', v_expires_at
  );
end;
$function$;

create or replace function public.get_personal_receive_request_details(p_public_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_request public.personal_receive_requests%rowtype;
  v_profile public.profiles%rowtype;
  v_phone text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_public_token is null then raise exception 'INVALID_RECEIVE_TOKEN'; end if;
  select * into v_request from public.personal_receive_requests
  where public_token = p_public_token for update;
  if not found then raise exception 'RECEIVE_REQUEST_NOT_FOUND'; end if;

  if v_request.status = 'pending' and v_request.expires_at <= pg_catalog.now() then
    update public.personal_receive_requests set status = 'expired', updated_at = pg_catalog.now()
    where id = v_request.id;
    v_request.status := 'expired';
  end if;

  select * into v_profile from public.profiles where id = v_request.recipient_user_id;
  v_phone := coalesce(v_profile.phone, '');
  return pg_catalog.jsonb_build_object(
    'request_id', v_request.id,
    'recipient_name', coalesce(nullif(pg_catalog.btrim(v_profile.full_name), ''),
      'Itilizatè LakayGoPay'),
    'recipient_phone_masked', case
      when pg_catalog.char_length(pg_catalog.regexp_replace(v_phone, '\D', '', 'g')) >= 4
      then '••••' || pg_catalog.right(pg_catalog.regexp_replace(v_phone, '\D', '', 'g'), 4)
      else 'Nimewo pa disponib'
    end,
    'amount', v_request.amount, 'currency', v_request.currency,
    'status', v_request.status, 'expires_at', v_request.expires_at
  );
end;
$function$;

create or replace function public.pay_personal_receive_request(
  p_public_token uuid, p_sender_wallet_id uuid, p_amount numeric, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_request public.personal_receive_requests%rowtype;
  v_amount numeric(20,2);
  v_transfer_key text;
  v_transfer record;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_public_token is null or p_sender_wallet_id is null then
    raise exception 'RECEIVE_PAYMENT_ARGUMENT_INVALID';
  end if;
  if p_idempotency_key is null
    or pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) not between 8 and 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_amount is not null and (
    p_amount::text in ('NaN','Infinity','-Infinity') or p_amount <= 0
    or p_amount >= 1000000000000000000 or p_amount <> pg_catalog.round(p_amount,2)
  ) then raise exception 'INVALID_AMOUNT'; end if;

  select * into v_request from public.personal_receive_requests
  where public_token = p_public_token for update;
  if not found then raise exception 'RECEIVE_REQUEST_NOT_FOUND'; end if;

  v_amount := coalesce(v_request.amount, p_amount);
  if v_amount is null or v_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if v_request.amount is not null and p_amount is not null
    and p_amount is distinct from v_request.amount then
    raise exception 'RECEIVE_AMOUNT_MISMATCH';
  end if;

  v_transfer_key := 'lgpr:' || pg_catalog.md5(
    v_actor::text || ':' || v_request.id::text || ':' || pg_catalog.btrim(p_idempotency_key)
  );

  if v_request.status = 'paid' then
    if v_request.paid_by_user_id is distinct from v_actor
      or v_request.paid_idempotency_key is distinct from pg_catalog.btrim(p_idempotency_key) then
      raise exception 'RECEIVE_REQUEST_ALREADY_PAID';
    end if;
    select * into v_transfer from public.transfer_funds(
      p_sender_wallet_id, v_request.recipient_wallet_id, v_amount,
      'Resepsyon P2P LakayGoPay', v_transfer_key
    );
    if v_transfer.transfer_status is distinct from 'posted' then
      raise exception 'RECEIVE_TRANSFER_NOT_POSTED';
    end if;
    return pg_catalog.jsonb_build_object(
      'transfer_id', v_transfer.transfer_id,
      'ledger_transaction_id', v_transfer.ledger_transaction_id,
      'reference', v_transfer.transfer_id::text, 'amount', v_transfer.transfer_amount,
      'currency', v_transfer.transfer_currency, 'status', v_transfer.transfer_status,
      'created_at', v_transfer.created_at, 'idempotent_replay', true
    );
  end if;

  if v_request.status <> 'pending' then
    return pg_catalog.jsonb_build_object('status', v_request.status);
  end if;
  if v_request.expires_at <= pg_catalog.now() then
    update public.personal_receive_requests set status = 'expired', updated_at = pg_catalog.now()
    where id = v_request.id;
    return pg_catalog.jsonb_build_object('status', 'expired');
  end if;
  if not exists (select 1 from public.profiles
    where id = v_request.recipient_user_id and account_status = 'active') then
    raise exception 'RECIPIENT_ACCOUNT_NOT_ACTIVE';
  end if;
  if exists (select 1 from public.ledger_accounts
    where wallet_id = p_sender_wallet_id and is_system = true) then
    raise exception 'SYSTEM_WALLET_NOT_ALLOWED';
  end if;

  -- Reuse the production transfer engine: auth.uid(), wallet ownership,
  -- row locks, wallet_balances, ledger_accounts, balanced entries, posting and idempotency.
  select * into v_transfer from public.transfer_funds(
    p_sender_wallet_id, v_request.recipient_wallet_id, v_amount,
    'Resepsyon P2P LakayGoPay', v_transfer_key
  );
  if v_transfer.transfer_status is distinct from 'posted' then
    raise exception 'RECEIVE_TRANSFER_NOT_POSTED';
  end if;

  update public.personal_receive_requests
  set status = 'paid', paid_transfer_id = v_transfer.transfer_id,
      paid_by_user_id = v_actor,
      paid_idempotency_key = pg_catalog.btrim(p_idempotency_key),
      updated_at = pg_catalog.now()
  where id = v_request.id and status = 'pending';
  if not found then raise exception 'RECEIVE_REQUEST_STATE_CONFLICT'; end if;

  insert into public.audit_logs (
    actor_user_id, action, resource_type, resource_id, outcome, metadata
  ) values (
    v_actor, 'personal.receive_request.paid', 'transfer',
    v_transfer.transfer_id, 'success',
    pg_catalog.jsonb_build_object('receive_request_id', v_request.id,
      'amount', v_transfer.transfer_amount, 'currency', v_transfer.transfer_currency)
  );

  return pg_catalog.jsonb_build_object(
    'transfer_id', v_transfer.transfer_id,
    'ledger_transaction_id', v_transfer.ledger_transaction_id,
    'reference', v_transfer.transfer_id::text, 'amount', v_transfer.transfer_amount,
    'currency', v_transfer.transfer_currency, 'status', v_transfer.transfer_status,
    'created_at', v_transfer.created_at, 'idempotent_replay', v_transfer.idempotent_replay
  );
end;
$function$;


-- User-facing request creation and lookup use the caller's JWT.
revoke all on function public.create_personal_receive_request(uuid,numeric,integer,text)
  from public, anon, service_role;
revoke all on function public.get_personal_receive_request_details(uuid)
  from public, anon, service_role;
grant execute on function public.create_personal_receive_request(uuid,numeric,integer,text)
  to authenticated;
grant execute on function public.get_personal_receive_request_details(uuid)
  to authenticated;

-- The payment function is callable only from the trusted server wrapper.
revoke all on function public.pay_personal_receive_request(uuid,uuid,numeric,text)
  from public, anon, authenticated, service_role;

-- Remove the direct authenticated RPC path that bypasses the API PIN check.
revoke all on function public.transfer_funds(uuid,uuid,numeric,text,text)
  from public, anon, authenticated, service_role;

create or replace function public.transfer_funds_server_authorized(
  p_actor_user_id uuid,
  p_sender_wallet_id uuid,
  p_recipient_wallet_id uuid,
  p_amount numeric,
  p_note text,
  p_idempotency_key text
)
returns table (
  transfer_id uuid,
  ledger_transaction_id uuid,
  transfer_status text,
  transfer_amount numeric,
  transfer_currency text,
  created_at timestamptz,
  idempotent_replay boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'SERVER_AUTHORIZATION_REQUIRED';
  end if;
  if p_actor_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.profiles
    where id = p_actor_user_id and account_status = 'active'
  ) then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor_user_id::text, true);

  return query
    select * from public.transfer_funds(
      p_sender_wallet_id, p_recipient_wallet_id, p_amount, p_note, p_idempotency_key
    );
end;
$function$;

create or replace function public.pay_personal_receive_request_server_authorized(
  p_actor_user_id uuid,
  p_public_token uuid,
  p_sender_wallet_id uuid,
  p_amount numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'SERVER_AUTHORIZATION_REQUIRED';
  end if;
  if p_actor_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.profiles
    where id = p_actor_user_id and account_status = 'active'
  ) then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor_user_id::text, true);

  return public.pay_personal_receive_request(
    p_public_token, p_sender_wallet_id, p_amount, p_idempotency_key
  );
end;
$function$;

revoke all on function public.transfer_funds_server_authorized(uuid,uuid,uuid,numeric,text,text)
  from public, anon, authenticated;
grant execute on function public.transfer_funds_server_authorized(uuid,uuid,uuid,numeric,text,text)
  to service_role;

revoke all on function public.pay_personal_receive_request_server_authorized(uuid,uuid,uuid,numeric,text)
  from public, anon, authenticated;
grant execute on function public.pay_personal_receive_request_server_authorized(uuid,uuid,uuid,numeric,text)
  to service_role;

do $verify$
begin
  if has_function_privilege('authenticated',
    'public.transfer_funds(uuid,uuid,numeric,text,text)', 'EXECUTE') then
    raise exception 'TRANSFER_FUNDS_MUST_NOT_BE_DIRECTLY_EXECUTABLE';
  end if;
  if has_function_privilege('authenticated',
    'public.pay_personal_receive_request(uuid,uuid,numeric,text)', 'EXECUTE') then
    raise exception 'PERSONAL_RECEIVE_PAYMENT_MUST_NOT_BE_DIRECTLY_EXECUTABLE';
  end if;
  if not has_function_privilege('service_role',
    'public.transfer_funds_server_authorized(uuid,uuid,uuid,numeric,text,text)', 'EXECUTE') then
    raise exception 'TRANSFER_SERVER_WRAPPER_GRANT_MISSING';
  end if;
  if not has_function_privilege('service_role',
    'public.pay_personal_receive_request_server_authorized(uuid,uuid,uuid,numeric,text)', 'EXECUTE') then
    raise exception 'PERSONAL_RECEIVE_SERVER_WRAPPER_GRANT_MISSING';
  end if;
end;
$verify$;

commit;
