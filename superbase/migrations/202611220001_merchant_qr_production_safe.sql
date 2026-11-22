-- Merchant QR v2: additive implementation aligned with the verified Production ledger schema.
-- Does not alter legacy QR tables, existing balances, transfers, or ledger rows.
-- Apply only after reviewing the migration and its read-only verification query.

begin;

do $preflight$
declare
  v_item text[];
  v_required_columns text[][] := array[
    array['profiles','id'],
    array['profiles','account_status'],
    array['merchants','id'],
    array['merchants','owner_user_id'],
    array['merchants','business_name'],
    array['merchants','business_type'],
    array['merchants','category'],
    array['merchants','contact_phone'],
    array['merchants','status'],
    array['wallets','id'],
    array['wallets','owner_user_id'],
    array['wallets','merchant_id'],
    array['wallets','currency'],
    array['wallets','status'],
    array['wallet_balances','wallet_id'],
    array['wallet_balances','owner_user_id'],
    array['wallet_balances','merchant_id'],
    array['wallet_balances','currency'],
    array['wallet_balances','balance'],
    array['ledger_accounts','id'],
    array['ledger_accounts','wallet_id'],
    array['ledger_accounts','currency'],
    array['ledger_accounts','account_type'],
    array['ledger_accounts','is_system'],
    array['ledger_transactions','id'],
    array['ledger_transactions','transaction_type'],
    array['ledger_transactions','status'],
    array['ledger_transactions','currency'],
    array['ledger_transactions','idempotency_key'],
    array['ledger_transactions','actor_user_id'],
    array['ledger_transactions','description'],
    array['ledger_transactions','metadata'],
    array['ledger_entries','id'],
    array['ledger_entries','transaction_id'],
    array['ledger_entries','account_id'],
    array['ledger_entries','direction'],
    array['ledger_entries','amount'],
    array['ledger_entries','currency'],
    array['audit_logs','actor_user_id'],
    array['audit_logs','action'],
    array['audit_logs','resource_type'],
    array['audit_logs','resource_id'],
    array['audit_logs','outcome'],
    array['audit_logs','metadata']
  ];
  v_owner text;
  v_security_definer boolean;
begin
  if current_user <> 'postgres' then
    raise exception 'MIGRATION_MUST_RUN_AS_POSTGRES';
  end if;

  foreach v_item slice 1 in array v_required_columns loop
    if not exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name = v_item[1]
         and c.column_name = v_item[2]
    ) then
      raise exception 'MERCHANT_QR_REQUIRED_COLUMN_MISSING: %.%', v_item[1], v_item[2];
    end if;
  end loop;

  if pg_catalog.to_regprocedure('public.post_ledger_transaction(uuid)') is null then
    raise exception 'POST_LEDGER_TRANSACTION_FUNCTION_MISSING';
  end if;

  select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef
    into v_owner, v_security_definer
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.post_ledger_transaction(uuid)');

  if v_owner <> 'postgres' or v_security_definer is distinct from true then
    raise exception 'POST_LEDGER_TRANSACTION_OWNER_OR_SECURITY_MISMATCH';
  end if;
end;
$preflight$;

-- Dedicated request storage avoids dependencies on legacy payment_requests views,
-- legacy merchant_payment_records columns, and the absent idempotency_keys table.
create table if not exists public.merchant_qr_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  public_token uuid not null unique default pg_catalog.gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id),
  created_by_user_id uuid not null references auth.users(id),
  amount numeric(20,2) check (amount is null or amount > 0),
  currency text not null check (currency in ('HTG','USD','EUR')),
  description text check (description is null or pg_catalog.char_length(description) <= 140),
  status text not null default 'pending'
    check (status in ('pending','paid','expired','cancelled')),
  expires_at timestamptz not null,
  paid_amount numeric(20,2),
  paid_ledger_transaction_id uuid unique references public.ledger_transactions(id),
  paid_by_user_id uuid references auth.users(id),
  paid_idempotency_key text,
  request_idempotency_key text not null,
  request_fingerprint text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  check (expires_at > created_at),
  check (
    (status = 'paid' and paid_amount is not null and paid_amount > 0
      and paid_ledger_transaction_id is not null
      and paid_by_user_id is not null and paid_idempotency_key is not null)
    or
    (status <> 'paid' and paid_amount is null
      and paid_ledger_transaction_id is null
      and paid_by_user_id is null and paid_idempotency_key is null)
  ),
  unique (created_by_user_id, request_idempotency_key)
);

create index if not exists merchant_qr_requests_pending_expiry_idx
  on public.merchant_qr_requests(expires_at) where status = 'pending';
create index if not exists merchant_qr_requests_merchant_created_idx
  on public.merchant_qr_requests(merchant_id, created_at desc);

create table if not exists public.merchant_qr_payment_idempotency (
  payer_user_id uuid not null references auth.users(id),
  idempotency_key text not null,
  request_id uuid not null references public.merchant_qr_requests(id),
  request_fingerprint text not null,
  ledger_transaction_id uuid not null unique references public.ledger_transactions(id),
  response jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (payer_user_id, idempotency_key),
  check (pg_catalog.char_length(idempotency_key) between 8 and 128)
);

alter table public.merchant_qr_requests enable row level security;
alter table public.merchant_qr_payment_idempotency enable row level security;
revoke all on table public.merchant_qr_requests from public, anon, authenticated;
revoke all on table public.merchant_qr_payment_idempotency from public, anon, authenticated;

create or replace function public.create_merchant_qr_request(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_amount numeric,
  p_currency text,
  p_description text,
  p_expires_in_minutes integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $create_merchant_qr_request$
declare
  v_merchant public.merchants%rowtype;
  v_existing public.merchant_qr_requests%rowtype;
  v_wallet_id uuid;
  v_fingerprint text;
  v_request_id uuid;
  v_token uuid;
  v_expires_at timestamptz;
  v_description text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'SERVER_AUTHORIZATION_REQUIRED';
  end if;
  if p_actor_user_id is null or p_merchant_id is null then
    raise exception 'MERCHANT_ARGUMENT_INVALID';
  end if;
  if not exists (
    select 1 from public.profiles
     where id = p_actor_user_id and account_status = 'active'
  ) then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;
  if p_currency is null or p_currency not in ('HTG','USD','EUR') then
    raise exception 'INVALID_CURRENCY';
  end if;
  if p_amount is not null and (
    p_amount::text in ('NaN','Infinity','-Infinity')
    or p_amount <= 0 or p_amount >= 1000000000000000000
    or p_amount <> pg_catalog.round(p_amount, 2)
  ) then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_description is not null and pg_catalog.char_length(p_description) > 140 then
    raise exception 'DESCRIPTION_TOO_LONG';
  end if;
  -- The product rule is a fixed 24-hour merchant QR validity window.
  if p_expires_in_minutes is distinct from 1440 then
    raise exception 'INVALID_EXPIRY';
  end if;
  if p_idempotency_key is null
     or pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) not between 8 and 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'merchant-qr-create:' || p_actor_user_id::text || ':' ||
      pg_catalog.btrim(p_idempotency_key), 0
  ));

  select * into v_merchant
    from public.merchants
   where id = p_merchant_id and owner_user_id = p_actor_user_id
   for update;
  if not found then raise exception 'MERCHANT_FORBIDDEN'; end if;
  if v_merchant.status is distinct from 'active' then
    raise exception 'MERCHANT_NOT_ACTIVE';
  end if;

  v_description := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_merchant_id, p_amount, p_currency, v_description, p_expires_in_minutes
  )::text);

  select * into v_existing
    from public.merchant_qr_requests
   where created_by_user_id = p_actor_user_id
     and request_idempotency_key = pg_catalog.btrim(p_idempotency_key)
   for update;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return pg_catalog.jsonb_build_object(
      'payment_request_id', v_existing.id,
      'qr_token', v_existing.public_token,
      'status', v_existing.status,
      'amount', v_existing.amount,
      'currency', v_existing.currency,
      'expires_at', v_existing.expires_at
    );
  end if;

  select w.id into v_wallet_id
    from public.wallets w
   where w.merchant_id = p_merchant_id
     and w.owner_user_id is null
     and w.currency = p_currency
     and w.status = 'active'
   order by w.id
   limit 1;
  if v_wallet_id is null then raise exception 'MERCHANT_QR_CURRENCY_UNAVAILABLE'; end if;

  if not exists (
    select 1 from public.wallet_balances wb
     where wb.wallet_id = v_wallet_id and wb.merchant_id = p_merchant_id
       and wb.owner_user_id is null and wb.currency = p_currency
  ) then
    raise exception 'WALLET_BALANCE_NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.ledger_accounts la
     where la.wallet_id = v_wallet_id and la.currency = p_currency
       and la.account_type = 'liability' and la.is_system = false
  ) then
    raise exception 'MERCHANT_LEDGER_ACCOUNT_NOT_FOUND';
  end if;

  v_expires_at := pg_catalog.now() + interval '24 hours';
  insert into public.merchant_qr_requests (
    merchant_id, created_by_user_id, amount, currency, description,
    expires_at, request_idempotency_key, request_fingerprint
  ) values (
    p_merchant_id, p_actor_user_id, p_amount, p_currency, v_description,
    v_expires_at, pg_catalog.btrim(p_idempotency_key), v_fingerprint
  )
  returning id, public_token into v_request_id, v_token;

  insert into public.audit_logs (
    actor_user_id, action, resource_type, resource_id, outcome, metadata
  ) values (
    p_actor_user_id, 'merchant.qr_request.created', 'merchant_qr_request',
    v_request_id, 'success',
    pg_catalog.jsonb_build_object(
      'merchant_id', p_merchant_id, 'currency', p_currency,
      'amount', p_amount, 'expires_at', v_expires_at
    )
  );

  return pg_catalog.jsonb_build_object(
    'payment_request_id', v_request_id,
    'qr_token', v_token,
    'status', 'pending',
    'amount', p_amount,
    'currency', p_currency,
    'expires_in_minutes', 1440,
    'expires_at', v_expires_at
  );
end;
$create_merchant_qr_request$;

create or replace function public.get_merchant_qr_request_details(
  p_public_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $get_merchant_qr_request_details$
declare
  v_request public.merchant_qr_requests%rowtype;
  v_merchant public.merchants%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'SERVER_AUTHORIZATION_REQUIRED';
  end if;
  if p_public_token is null then raise exception 'INVALID_QR_TOKEN'; end if;

  select * into v_request
    from public.merchant_qr_requests
   where public_token = p_public_token
   for update;
  if not found then raise exception 'PAYMENT_REQUEST_NOT_FOUND'; end if;

  if v_request.status = 'pending' and v_request.expires_at <= pg_catalog.now() then
    update public.merchant_qr_requests
       set status = 'expired', updated_at = pg_catalog.now()
     where id = v_request.id;
    v_request.status := 'expired';
  end if;

  select * into v_merchant
    from public.merchants
   where id = v_request.merchant_id;
  if not found then raise exception 'MERCHANT_NOT_FOUND'; end if;

  return pg_catalog.jsonb_build_object(
    'payment_request_id', v_request.id,
    'merchant_id', v_request.merchant_id,
    'merchant_name', v_merchant.business_name,
    'merchant_status', v_merchant.status,
    'merchant_phone', coalesce(v_merchant.contact_phone, ''),
    'merchant_category', coalesce(v_merchant.category, ''),
    'amount', v_request.amount,
    'currency', v_request.currency,
    'description', v_request.description,
    'status', v_request.status,
    'expires_at', v_request.expires_at
  );
end;
$get_merchant_qr_request_details$;

create or replace function public.pay_merchant_qr_request(
  p_public_token uuid,
  p_payer_wallet_id uuid,
  p_amount numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $pay_merchant_qr_request$
declare
  v_actor uuid := auth.uid();
  v_request public.merchant_qr_requests%rowtype;
  v_merchant public.merchants%rowtype;
  v_payer_wallet public.wallets%rowtype;
  v_merchant_wallet public.wallets%rowtype;
  v_payer_balance public.wallet_balances%rowtype;
  v_merchant_balance public.wallet_balances%rowtype;
  v_payer_account_id uuid;
  v_merchant_account_id uuid;
  v_merchant_wallet_id uuid;
  v_amount numeric(20,2);
  v_fingerprint text;
  v_existing_fingerprint text;
  v_existing_response jsonb;
  v_transaction_id uuid;
  v_reference text;
  v_created_at timestamptz;
  v_response jsonb;
  v_rows integer;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_public_token is null or p_payer_wallet_id is null then
    raise exception 'INVALID_QR_OR_WALLET';
  end if;
  if p_idempotency_key is null
     or pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) not between 8 and 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_amount is not null and (
    p_amount::text in ('NaN','Infinity','-Infinity')
    or p_amount <= 0 or p_amount >= 1000000000000000000
    or p_amount <> pg_catalog.round(p_amount, 2)
  ) then
    raise exception 'INVALID_AMOUNT';
  end if;
  if not exists (
    select 1 from public.profiles
     where id = v_actor and account_status = 'active'
  ) then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'merchant-qr-pay:' || v_actor::text || ':' ||
      pg_catalog.btrim(p_idempotency_key), 0
  ));

  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_public_token, p_payer_wallet_id, p_amount
  )::text);
  select request_fingerprint, response
    into v_existing_fingerprint, v_existing_response
    from public.merchant_qr_payment_idempotency
   where payer_user_id = v_actor
     and idempotency_key = pg_catalog.btrim(p_idempotency_key)
   for update;
  if found then
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_existing_response;
  end if;

  select * into v_request
    from public.merchant_qr_requests
   where public_token = p_public_token
   for update;
  if not found then raise exception 'PAYMENT_REQUEST_NOT_FOUND'; end if;

  if v_request.status = 'paid' then
    raise exception 'PAYMENT_REQUEST_NOT_PAYABLE';
  end if;
  if v_request.status <> 'pending' then
    return pg_catalog.jsonb_build_object('status', v_request.status);
  end if;
  if v_request.expires_at <= pg_catalog.now() then
    update public.merchant_qr_requests
       set status = 'expired', updated_at = pg_catalog.now()
     where id = v_request.id and status = 'pending';
    return pg_catalog.jsonb_build_object('status', 'expired');
  end if;

  select * into v_merchant
    from public.merchants
   where id = v_request.merchant_id
   for update;
  if not found or v_merchant.status is distinct from 'active' then
    raise exception 'MERCHANT_NOT_ACTIVE';
  end if;
  if v_merchant.owner_user_id = v_actor then
    raise exception 'SELF_PAYMENT_NOT_ALLOWED';
  end if;
  if not exists (
    select 1 from public.profiles
     where id = v_merchant.owner_user_id and account_status = 'active'
  ) then
    raise exception 'MERCHANT_NOT_ACTIVE';
  end if;

  v_amount := coalesce(v_request.amount, p_amount);
  if v_amount is null or v_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if v_request.amount is not null and p_amount is not null
     and p_amount is distinct from v_request.amount then
    raise exception 'QR_AMOUNT_MISMATCH';
  end if;

  select w.id into v_merchant_wallet_id
    from public.wallets w
   where w.merchant_id = v_request.merchant_id
     and w.owner_user_id is null
     and w.currency = v_request.currency
     and w.status = 'active'
   order by w.id
   limit 1;
  if v_merchant_wallet_id is null then raise exception 'MERCHANT_WALLET_NOT_FOUND'; end if;

  perform w.id
    from public.wallets w
   where w.id in (p_payer_wallet_id, v_merchant_wallet_id)
   order by w.id
   for update;

  select * into v_payer_wallet
    from public.wallets where id = p_payer_wallet_id;
  select * into v_merchant_wallet
    from public.wallets where id = v_merchant_wallet_id;

  if v_payer_wallet.id is null or v_payer_wallet.status <> 'active' then
    raise exception 'WALLET_NOT_ACTIVE';
  end if;
  if v_payer_wallet.owner_user_id is distinct from v_actor
     or v_payer_wallet.merchant_id is not null then
    raise exception 'SENDER_WALLET_FORBIDDEN';
  end if;
  if v_merchant_wallet.id is null or v_merchant_wallet.status <> 'active'
     or v_merchant_wallet.merchant_id is distinct from v_request.merchant_id
     or v_merchant_wallet.owner_user_id is not null then
    raise exception 'MERCHANT_WALLET_NOT_FOUND';
  end if;
  if v_payer_wallet.id = v_merchant_wallet.id then
    raise exception 'SELF_PAYMENT_NOT_ALLOWED';
  end if;
  if v_payer_wallet.currency is distinct from v_request.currency
     or v_merchant_wallet.currency is distinct from v_request.currency then
    raise exception 'CURRENCY_MISMATCH';
  end if;

  perform wb.wallet_id
    from public.wallet_balances wb
   where wb.wallet_id in (v_payer_wallet.id, v_merchant_wallet.id)
   order by wb.wallet_id
   for update;

  select * into v_payer_balance
    from public.wallet_balances
   where wallet_id = v_payer_wallet.id;
  select * into v_merchant_balance
    from public.wallet_balances
   where wallet_id = v_merchant_wallet.id;
  if v_payer_balance.wallet_id is null or v_merchant_balance.wallet_id is null then
    raise exception 'WALLET_BALANCE_NOT_FOUND';
  end if;
  if v_payer_balance.owner_user_id is distinct from v_actor
     or v_payer_balance.merchant_id is not null
     or v_payer_balance.currency is distinct from v_request.currency
     or v_merchant_balance.owner_user_id is not null
     or v_merchant_balance.merchant_id is distinct from v_request.merchant_id
     or v_merchant_balance.currency is distinct from v_request.currency then
    raise exception 'WALLET_BALANCE_METADATA_MISMATCH';
  end if;
  if v_payer_balance.balance < v_amount then
    raise exception 'INSUFFICIENT_FUNDS';
  end if;

  perform la.id
    from public.ledger_accounts la
   where la.wallet_id in (v_payer_wallet.id, v_merchant_wallet.id)
     and la.currency = v_request.currency
     and la.account_type = 'liability'
     and la.is_system = false
   order by la.id
   for update;

  select la.id into v_payer_account_id
    from public.ledger_accounts la
   where la.wallet_id = v_payer_wallet.id
     and la.currency = v_request.currency
     and la.account_type = 'liability'
     and la.is_system = false;
  select la.id into v_merchant_account_id
    from public.ledger_accounts la
   where la.wallet_id = v_merchant_wallet.id
     and la.currency = v_request.currency
     and la.account_type = 'liability'
     and la.is_system = false;
  if v_payer_account_id is null or v_merchant_account_id is null then
    raise exception 'LEDGER_ACCOUNT_NOT_FOUND';
  end if;

  v_transaction_id := pg_catalog.gen_random_uuid();
  v_reference := 'LGP-MQR-' || pg_catalog.upper(pg_catalog.substr(
    pg_catalog.replace(v_transaction_id::text, '-', ''), 1, 16
  ));
  insert into public.ledger_transactions (
    id, transaction_type, status, currency, idempotency_key,
    actor_user_id, description, metadata
  ) values (
    v_transaction_id, 'merchant_payment', 'pending', v_request.currency,
    'merchant-qr:' || v_actor::text || ':' ||
      pg_catalog.md5(pg_catalog.btrim(p_idempotency_key)),
    v_actor,
    'Peman QR: ' || pg_catalog.left(v_merchant.business_name, 120),
    pg_catalog.jsonb_build_object(
      'channel', 'merchant_qr',
      'merchant_qr_request_id', v_request.id,
      'merchant_id', v_request.merchant_id,
      'payer_wallet_id', v_payer_wallet.id,
      'merchant_wallet_id', v_merchant_wallet.id
    )
  );

  insert into public.ledger_entries (
    transaction_id, account_id, direction, amount, currency
  ) values
    (v_transaction_id, v_payer_account_id, 'debit', v_amount, v_request.currency),
    (v_transaction_id, v_merchant_account_id, 'credit', v_amount, v_request.currency);

  update public.wallet_balances
     set balance = balance - v_amount
   where wallet_id = v_payer_wallet.id
     and balance >= v_amount;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'INSUFFICIENT_FUNDS'; end if;

  update public.wallet_balances
     set balance = balance + v_amount
   where wallet_id = v_merchant_wallet.id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'WALLET_BALANCE_NOT_FOUND'; end if;

  perform public.post_ledger_transaction(v_transaction_id);

  update public.merchant_qr_requests
     set status = 'paid',
         paid_amount = v_amount,
         paid_ledger_transaction_id = v_transaction_id,
         paid_by_user_id = v_actor,
         paid_idempotency_key = pg_catalog.btrim(p_idempotency_key),
         updated_at = pg_catalog.now()
   where id = v_request.id and status = 'pending'
     and expires_at > pg_catalog.now();
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'PAYMENT_REQUEST_STATE_CONFLICT'; end if;

  v_created_at := pg_catalog.now();
  v_response := pg_catalog.jsonb_build_object(
    'payment_id', v_transaction_id,
    'payment_request_id', v_request.id,
    'ledger_transaction_id', v_transaction_id,
    'reference', v_reference,
    'amount', v_amount,
    'currency', v_request.currency,
    'status', 'paid',
    'created_at', v_created_at,
    'idempotent_replay', false
  );

  insert into public.merchant_qr_payment_idempotency (
    payer_user_id, idempotency_key, request_id,
    request_fingerprint, ledger_transaction_id, response
  ) values (
    v_actor, pg_catalog.btrim(p_idempotency_key), v_request.id,
    v_fingerprint, v_transaction_id, v_response
  );

  insert into public.audit_logs (
    actor_user_id, action, resource_type, resource_id, outcome, metadata
  ) values (
    v_actor, 'merchant.qr_payment.posted', 'merchant_qr_payment',
    v_transaction_id, 'success',
    pg_catalog.jsonb_build_object(
      'request_id', v_request.id,
      'merchant_id', v_request.merchant_id,
      'amount', v_amount,
      'currency', v_request.currency
    )
  );

  return v_response;
end;
$pay_merchant_qr_request$;

create or replace function public.pay_merchant_qr_request_server_authorized(
  p_actor_user_id uuid,
  p_public_token uuid,
  p_payer_wallet_id uuid,
  p_amount numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $pay_merchant_qr_request_server_authorized$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'SERVER_AUTHORIZATION_REQUIRED';
  end if;
  if p_actor_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.profiles
     where id = p_actor_user_id and account_status = 'active'
  ) then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor_user_id::text, true);

  return public.pay_merchant_qr_request(
    p_public_token, p_payer_wallet_id, p_amount, p_idempotency_key
  );
end;
$pay_merchant_qr_request_server_authorized$;

-- Only the trusted Cloudflare server may create/lookup QR requests.
revoke all on function public.create_merchant_qr_request(uuid,uuid,numeric,text,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.create_merchant_qr_request(uuid,uuid,numeric,text,text,integer,text)
  to service_role;

revoke all on function public.get_merchant_qr_request_details(uuid)
  from public, anon, authenticated;
grant execute on function public.get_merchant_qr_request_details(uuid)
  to service_role;

-- Payment is callable only through the service-authorized wrapper after PIN verification.
revoke all on function public.pay_merchant_qr_request(uuid,uuid,numeric,text)
  from public, anon, authenticated, service_role;
revoke all on function public.pay_merchant_qr_request_server_authorized(uuid,uuid,uuid,numeric,text)
  from public, anon, authenticated;
grant execute on function public.pay_merchant_qr_request_server_authorized(uuid,uuid,uuid,numeric,text)
  to service_role;

do $verify$
begin
  if has_function_privilege(
    'authenticated',
    'public.pay_merchant_qr_request(uuid,uuid,numeric,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'public.pay_merchant_qr_request(uuid,uuid,numeric,text)',
    'EXECUTE'
  ) then
    raise exception 'MERCHANT_QR_PAYMENT_INTERNAL_RPC_MUST_NOT_BE_DIRECTLY_EXECUTABLE';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.pay_merchant_qr_request_server_authorized(uuid,uuid,uuid,numeric,text)',
    'EXECUTE'
  ) then
    raise exception 'MERCHANT_QR_SERVER_WRAPPER_GRANT_MISSING';
  end if;
end;
$verify$;

commit;
