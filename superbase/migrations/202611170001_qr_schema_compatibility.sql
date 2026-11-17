-- LakayGoPay QR compatibility for the currently deployed schema.
-- Supports either the original payment_requests table or the deployed
-- merchant_payment_requests table. QR remains an internal-ledger feature only.

begin;

do $$
begin
  if to_regclass('public.payment_requests') is null then
    if to_regclass('public.merchant_payment_requests') is null then
      raise exception 'QR_REQUEST_TABLE_NOT_FOUND';
    end if;

    alter table public.merchant_payment_requests
      add column if not exists paid_ledger_transaction_id uuid
      references public.ledger_transactions(id);

    -- A simple, automatically-updatable compatibility view lets the same
    -- lookup/settlement RPCs work with the existing merchant_payment_requests
    -- table without copying or deleting payment-request data.
    execute $view$
      create view public.payment_requests as
      select
        id,
        qr_token as public_token,
        merchant_id,
        created_by_user_id as created_by,
        amount,
        currency,
        description,
        status,
        expires_at,
        paid_ledger_transaction_id,
        created_at
      from public.merchant_payment_requests
    $view$;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.merchant_payment_records') is null then
    raise exception 'MERCHANT_PAYMENT_RECORDS_TABLE_NOT_FOUND';
  end if;

  alter table public.merchant_payment_records
    add column if not exists ledger_transaction_id uuid
      references public.ledger_transactions(id),
    add column if not exists merchant_wallet_id uuid
      references public.wallets(id);

  create unique index if not exists merchant_payment_records_ledger_txn_uq
    on public.merchant_payment_records(ledger_transaction_id)
    where ledger_transaction_id is not null;
end;
$$;

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
  v_existing_fingerprint text;
  v_fingerprint text;
  v_status text;
  v_request_id uuid;
  v_token uuid;
  v_response jsonb;
begin
  if p_actor_user_id is null or p_merchant_id is null then
    raise exception 'MERCHANT_ARGUMENT_INVALID';
  end if;
  if p_amount is not null and (p_amount <= 0 or p_amount <> round(p_amount,2)) then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_description is not null and length(p_description) > 140 then
    raise exception 'DESCRIPTION_TOO_LONG';
  end if;
  if p_expires_in_minutes is null or p_expires_in_minutes not between 1 and 1440 then
    raise exception 'INVALID_EXPIRY';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  select m.status into v_status
    from public.merchants m
   where m.id = p_merchant_id
     and m.owner_user_id = p_actor_user_id
   for update;
  if not found then raise exception 'MERCHANT_FORBIDDEN'; end if;
  if v_status <> 'active' then raise exception 'MERCHANT_NOT_ACTIVE'; end if;

  v_fingerprint := md5(jsonb_build_array(
    p_merchant_id, p_amount, coalesce(p_description,''), p_expires_in_minutes
  )::text);

  insert into public.idempotency_keys(user_id, operation, idempotency_key, request_fingerprint)
  values (p_actor_user_id, 'payment_request', p_idempotency_key, v_fingerprint)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select response, request_fingerprint
      into v_existing, v_existing_fingerprint
      from public.idempotency_keys
     where user_id = p_actor_user_id
       and operation = 'payment_request'
       and idempotency_key = p_idempotency_key;
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_existing is null then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
    return v_existing;
  end if;

  if to_regclass('public.merchant_payment_requests') is not null
     and to_regclass('public.merchant_payment_requests')::text = 'merchant_payment_requests' then
    insert into public.merchant_payment_requests(
      merchant_id, created_by_user_id, amount, currency, description,
      status, expires_at, idempotency_key
    )
    values (
      p_merchant_id, p_actor_user_id, p_amount, 'HTG',
      nullif(trim(coalesce(p_description,'')),''),
      'pending', now() + make_interval(mins => p_expires_in_minutes),
      p_idempotency_key
    )
    returning id, qr_token into v_request_id, v_token;
  else
    insert into public.payment_requests(
      merchant_id, created_by, amount, currency, description, expires_at
    )
    values (
      p_merchant_id, p_actor_user_id, p_amount, 'HTG',
      nullif(trim(coalesce(p_description,'')),''),
      now() + make_interval(mins => p_expires_in_minutes)
    )
    returning id, public_token into v_request_id, v_token;
  end if;

  v_response := jsonb_build_object(
    'payment_request_id', v_request_id,
    'qr_token', v_token,
    'status', 'pending',
    'amount', p_amount,
    'currency', 'HTG'
  );
  update public.idempotency_keys
     set resource_id = v_request_id, response = v_response
   where user_id = p_actor_user_id
     and operation = 'payment_request'
     and idempotency_key = p_idempotency_key;

  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  values (
    p_actor_user_id, 'merchant.payment_request.created', 'payment_request',
    v_request_id, jsonb_build_object('merchant_id',p_merchant_id,'amount',p_amount,'currency','HTG')
  );
  return v_response;
end;
$$;

create or replace function public.get_payment_request_details(p_public_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.payment_requests%rowtype;
  v_merchant public.merchants%rowtype;
begin
  if p_public_token is null then raise exception 'INVALID_QR_TOKEN'; end if;

  select * into v_request
    from public.payment_requests
   where public_token = p_public_token;
  if v_request.id is null then raise exception 'PAYMENT_REQUEST_NOT_FOUND'; end if;

  select * into v_merchant
    from public.merchants
   where id = v_request.merchant_id;

  if v_request.status = 'pending' and v_request.expires_at <= now() then
    update public.payment_requests
       set status = 'expired'
     where id = v_request.id;
    return jsonb_build_object(
      'payment_request_id',v_request.id,
      'merchant_id',v_request.merchant_id,
      'merchant_name',v_merchant.business_name,
      'merchant_status',v_merchant.status,
      'amount',v_request.amount,
      'currency',v_request.currency,
      'description',v_request.description,
      'status','expired',
      'expires_at',v_request.expires_at
    );
  end if;

  return jsonb_build_object(
    'payment_request_id',v_request.id,
    'merchant_id',v_request.merchant_id,
    'merchant_name',v_merchant.business_name,
    'merchant_status',v_merchant.status,
    'amount',v_request.amount,
    'currency',v_request.currency,
    'description',v_request.description,
    'status',v_request.status,
    'expires_at',v_request.expires_at
  );
end;
$$;

create or replace function public.pay_merchant_payment_request(
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
as $$
declare
  v_rows integer;
  v_existing jsonb;
  v_existing_fingerprint text;
  v_fingerprint text;
  v_request public.payment_requests%rowtype;
  v_merchant public.merchants%rowtype;
  v_payer public.wallets%rowtype;
  v_merchant_wallet public.wallets%rowtype;
  v_merchant_wallet_id uuid;
  v_amount numeric(20,2);
  v_available numeric(20,2);
  v_ledger_id uuid;
  v_payment_id uuid;
  v_reference text;
  v_response jsonb;
begin
  if p_actor_user_id is null or p_public_token is null or p_payer_wallet_id is null then
    raise exception 'INVALID_QR_OR_WALLET';
  end if;
  if p_amount is not null and (p_amount <= 0 or p_amount <> round(p_amount,2)) then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  v_fingerprint := md5(jsonb_build_array(p_public_token,p_payer_wallet_id,p_amount)::text);
  insert into public.idempotency_keys(user_id, operation, idempotency_key, request_fingerprint)
  values (p_actor_user_id, 'qr_payment', p_idempotency_key, v_fingerprint)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select response, request_fingerprint
      into v_existing, v_existing_fingerprint
      from public.idempotency_keys
     where user_id = p_actor_user_id
       and operation = 'qr_payment'
       and idempotency_key = p_idempotency_key;
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_existing is null then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
    return v_existing;
  end if;

  select * into v_request
    from public.payment_requests
   where public_token = p_public_token
   for update;
  if v_request.id is null then raise exception 'PAYMENT_REQUEST_NOT_FOUND'; end if;
  if v_request.status <> 'pending' then raise exception 'PAYMENT_REQUEST_NOT_PAYABLE'; end if;
  if v_request.expires_at <= now() then
    update public.payment_requests set status = 'expired' where id = v_request.id;
    raise exception 'PAYMENT_REQUEST_EXPIRED';
  end if;

  select * into v_merchant
    from public.merchants
   where id = v_request.merchant_id;
  if v_merchant.id is null or v_merchant.status <> 'active' then
    raise exception 'MERCHANT_NOT_ACTIVE';
  end if;

  v_amount := coalesce(v_request.amount, p_amount);
  if v_amount is null or v_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if v_request.amount is not null and p_amount is not null and p_amount <> v_request.amount then
    raise exception 'QR_AMOUNT_MISMATCH';
  end if;

  select w.id into v_merchant_wallet_id
    from public.wallets w
   where w.merchant_id = v_request.merchant_id
     and w.currency = v_request.currency
     and w.status = 'active'
     and coalesce(w.is_system,false) = false
   order by w.id
   limit 1;
  if v_merchant_wallet_id is null then raise exception 'MERCHANT_WALLET_NOT_FOUND'; end if;

  perform w.id
    from public.wallets w
   where w.id in (p_payer_wallet_id,v_merchant_wallet_id)
   order by w.id
   for update;

  select * into v_payer from public.wallets where id = p_payer_wallet_id;
  select * into v_merchant_wallet from public.wallets where id = v_merchant_wallet_id;

  if v_payer.id is null or v_payer.status <> 'active' then raise exception 'WALLET_NOT_ACTIVE'; end if;
  if coalesce(v_payer.is_system,false) or coalesce(v_merchant_wallet.is_system,false) then
    raise exception 'SYSTEM_WALLET_NOT_ALLOWED';
  end if;
  if v_payer.currency <> v_merchant_wallet.currency or v_payer.currency <> v_request.currency then
    raise exception 'CURRENCY_MISMATCH';
  end if;
  if v_payer.id = v_merchant_wallet.id then raise exception 'SELF_PAYMENT_NOT_ALLOWED'; end if;
  if v_payer.owner_user_id is distinct from p_actor_user_id or v_payer.merchant_id is not null then
    raise exception 'SENDER_WALLET_FORBIDDEN';
  end if;

  select
    coalesce((select sum(case when direction = 'credit' then amount else -amount end)
                from public.ledger_entries where wallet_id = p_payer_wallet_id), 0)
    -
    coalesce((select sum(amount) from public.withdrawal_requests
               where wallet_id = p_payer_wallet_id
                 and status in ('submitted','awaiting_second_approval','approved','processing')), 0)
    into v_available;
  if v_available < v_amount then raise exception 'INSUFFICIENT_AVAILABLE_FUNDS'; end if;

  v_ledger_id := gen_random_uuid();
  v_payment_id := gen_random_uuid();
  v_reference := 'LGP-QR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));

  insert into public.ledger_transactions(id, transaction_type, reference_code, initiated_by, metadata)
  values (
    v_ledger_id, 'merchant_payment', v_reference, p_actor_user_id,
    jsonb_build_object('channel','internal_qr','payment_request_id',v_request.id)
  );
  insert into public.ledger_entries(ledger_transaction_id, wallet_id, direction, amount, currency)
  values
    (v_ledger_id, v_payer.id, 'debit', v_amount, v_payer.currency),
    (v_ledger_id, v_merchant_wallet.id, 'credit', v_amount, v_payer.currency);

  insert into public.merchant_payment_records(
    id, payment_request_id, ledger_transaction_id, payer_user_id, payer_wallet_id,
    merchant_id, merchant_wallet_id, amount, currency
  )
  values (
    v_payment_id, v_request.id, v_ledger_id, p_actor_user_id, v_payer.id,
    v_request.merchant_id, v_merchant_wallet.id, v_amount, v_payer.currency
  );

  update public.payment_requests
     set status = 'paid', paid_ledger_transaction_id = v_ledger_id
   where id = v_request.id;

  if to_regclass('public.merchant_payment_requests') is not null
     and to_regclass('public.merchant_payment_requests')::text = 'merchant_payment_requests' then
    update public.merchant_payment_requests
       set paid_at = now(), updated_at = now()
     where id = v_request.id;
  end if;

  v_response := jsonb_build_object(
    'payment_id',v_payment_id,
    'payment_request_id',v_request.id,
    'ledger_transaction_id',v_ledger_id,
    'reference',v_reference,
    'amount',v_amount,
    'currency',v_payer.currency,
    'status','paid'
  );

  update public.idempotency_keys
     set resource_id = v_payment_id, response = v_response
   where user_id = p_actor_user_id
     and operation = 'qr_payment'
     and idempotency_key = p_idempotency_key;

  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  values (
    p_actor_user_id, 'merchant.qr_payment.posted', 'merchant_payment', v_payment_id,
    jsonb_build_object('amount',v_amount,'currency',v_payer.currency,'merchant_id',v_request.merchant_id)
  );

  return v_response;
end;
$$;

revoke all on function public.create_merchant_payment_request(uuid,uuid,numeric,text,integer,text)
  from public, anon, authenticated;
revoke all on function public.get_payment_request_details(uuid)
  from public, anon, authenticated;
revoke all on function public.pay_merchant_payment_request(uuid,uuid,uuid,numeric,text)
  from public, anon, authenticated;
grant execute on function public.create_merchant_payment_request(uuid,uuid,numeric,text,integer,text)
  to service_role;
grant execute on function public.get_payment_request_details(uuid)
  to service_role;
grant execute on function public.pay_merchant_payment_request(uuid,uuid,uuid,numeric,text)
  to service_role;

commit;
