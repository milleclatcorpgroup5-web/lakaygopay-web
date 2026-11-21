-- Personal receive QR / ID requests for P2P internal transfers.
-- This adds a request layer only; no funds move until the payer confirms with PIN.
begin;

-- Some Production snapshots predate this idempotency metadata column.
alter table public.idempotency_keys add column if not exists request_fingerprint text;

create table if not exists public.personal_receive_requests (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null unique default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id),
  recipient_wallet_id uuid not null references public.wallets(id),
  amount numeric(20,2) check (amount is null or amount > 0),
  currency char(3) not null,
  status text not null default 'pending'
    check (status in ('pending','paid','expired','cancelled')),
  expires_at timestamptz not null,
  paid_transfer_id uuid references public.transfers(id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  unique (recipient_user_id, idempotency_key)
);

create index if not exists personal_receive_requests_recipient_created_idx
  on public.personal_receive_requests(recipient_user_id, created_at desc);
create index if not exists personal_receive_requests_pending_expiry_idx
  on public.personal_receive_requests(expires_at)
  where status = 'pending';

alter table public.personal_receive_requests enable row level security;
revoke all on table public.personal_receive_requests from public, anon, authenticated;

create or replace function public.create_personal_receive_request(
  p_actor_user_id uuid,
  p_recipient_wallet_id uuid,
  p_amount numeric,
  p_expires_in_minutes integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_wallet public.wallets%rowtype;
  v_existing jsonb;
  v_fingerprint text;
  v_existing_fingerprint text;
  v_rows integer;
  v_request_id uuid;
  v_token uuid;
  v_response jsonb;
begin
  if p_actor_user_id is null or p_recipient_wallet_id is null then
    raise exception 'RECEIVE_REQUEST_ARGUMENT_INVALID';
  end if;
  if p_amount is not null and (p_amount <= 0 or p_amount <> round(p_amount,2)) then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_expires_in_minutes is null or p_expires_in_minutes not between 15 and 30 then
    raise exception 'INVALID_EXPIRY';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  select * into v_wallet
    from public.wallets
   where id = p_recipient_wallet_id
     and owner_user_id = p_actor_user_id
     and merchant_id is null
     and is_system = false
     and status = 'active'
   for update;
  if not found then raise exception 'RECIPIENT_WALLET_FORBIDDEN'; end if;

  v_fingerprint := md5(jsonb_build_array(p_recipient_wallet_id,p_amount,p_expires_in_minutes)::text);
  insert into public.idempotency_keys(user_id,operation,idempotency_key,request_fingerprint)
  values (p_actor_user_id,'personal_receive_request',p_idempotency_key,v_fingerprint)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select response,request_fingerprint into v_existing,v_existing_fingerprint
      from public.idempotency_keys
     where user_id=p_actor_user_id and operation='personal_receive_request'
       and idempotency_key=p_idempotency_key;
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_existing is null then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
    return v_existing;
  end if;

  insert into public.personal_receive_requests(
    recipient_user_id,recipient_wallet_id,amount,currency,expires_at,idempotency_key
  ) values (
    p_actor_user_id,p_recipient_wallet_id,p_amount,v_wallet.currency,
    now()+make_interval(mins=>p_expires_in_minutes),p_idempotency_key
  ) returning id,public_token into v_request_id,v_token;

  v_response := jsonb_build_object(
    'request_id',v_request_id,'qr_token',v_token,'amount',p_amount,
    'currency',v_wallet.currency,'status','pending',
    'expires_in_minutes',p_expires_in_minutes,
    'expires_at',now()+make_interval(mins=>p_expires_in_minutes)
  );
  update public.idempotency_keys
     set resource_id=v_request_id,response=v_response
   where user_id=p_actor_user_id and operation='personal_receive_request'
     and idempotency_key=p_idempotency_key;
  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  values(p_actor_user_id,'personal.receive_request.created','personal_receive_request',
    v_request_id,jsonb_build_object('currency',v_wallet.currency,'amount',p_amount));
  return v_response;
end;
$function$;

create or replace function public.get_personal_receive_request_details(p_public_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.personal_receive_requests%rowtype;
  v_profile public.profiles%rowtype;
  v_phone text;
begin
  if p_public_token is null then raise exception 'INVALID_RECEIVE_TOKEN'; end if;
  select * into v_request
    from public.personal_receive_requests
   where public_token=p_public_token;
  if not found then raise exception 'RECEIVE_REQUEST_NOT_FOUND'; end if;

  if v_request.status='pending' and v_request.expires_at<=now() then
    update public.personal_receive_requests
       set status='expired',updated_at=now()
     where id=v_request.id;
    v_request.status := 'expired';
  end if;

  select * into v_profile from public.profiles where id=v_request.recipient_user_id;
  v_phone := coalesce(v_profile.phone,'');
  return jsonb_build_object(
    'request_id',v_request.id,
    'recipient_name',coalesce(nullif(trim(v_profile.full_name),''),'Itilizatè LakayGoPay'),
    'recipient_phone_masked',case
      when length(regexp_replace(v_phone,'\\D','','g')) >= 4
      then '••••' || right(regexp_replace(v_phone,'\\D','','g'),4)
      else 'Nimewo pa disponib'
    end,
    'amount',v_request.amount,
    'currency',v_request.currency,
    'status',v_request.status,
    'expires_at',v_request.expires_at
  );
end;
$function$;

create or replace function public.pay_personal_receive_request(
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
declare
  v_rows integer;
  v_existing jsonb;
  v_existing_fingerprint text;
  v_fingerprint text;
  v_request public.personal_receive_requests%rowtype;
  v_sender public.wallets%rowtype;
  v_recipient public.wallets%rowtype;
  v_amount numeric(20,2);
  v_available numeric(20,2);
  v_ledger_id uuid;
  v_transfer_id uuid;
  v_reference text;
  v_response jsonb;
begin
  if p_actor_user_id is null or p_public_token is null or p_sender_wallet_id is null then
    raise exception 'RECEIVE_PAYMENT_ARGUMENT_INVALID';
  end if;
  if p_amount is not null and (p_amount<=0 or p_amount<>round(p_amount,2)) then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  v_fingerprint := md5(jsonb_build_array(p_public_token,p_sender_wallet_id,p_amount)::text);
  insert into public.idempotency_keys(user_id,operation,idempotency_key,request_fingerprint)
  values(p_actor_user_id,'personal_receive_payment',p_idempotency_key,v_fingerprint)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows=0 then
    select response,request_fingerprint into v_existing,v_existing_fingerprint
      from public.idempotency_keys
     where user_id=p_actor_user_id and operation='personal_receive_payment'
       and idempotency_key=p_idempotency_key;
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_existing is null then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
    return v_existing;
  end if;

  select * into v_request
    from public.personal_receive_requests
   where public_token=p_public_token
   for update;
  if not found then raise exception 'RECEIVE_REQUEST_NOT_FOUND'; end if;
  if v_request.status<>'pending' then raise exception 'RECEIVE_REQUEST_NOT_PAYABLE'; end if;
  if v_request.expires_at<=now() then
    update public.personal_receive_requests set status='expired',updated_at=now()
     where id=v_request.id;
    raise exception 'RECEIVE_REQUEST_EXPIRED';
  end if;

  perform id from public.wallets
   where id in (p_sender_wallet_id,v_request.recipient_wallet_id)
   order by id for update;
  select * into v_sender from public.wallets where id=p_sender_wallet_id;
  select * into v_recipient from public.wallets where id=v_request.recipient_wallet_id;
  if v_sender.id is null or v_recipient.id is null then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_sender.status<>'active' or v_recipient.status<>'active' then raise exception 'WALLET_NOT_ACTIVE'; end if;
  if coalesce(v_sender.is_system,false) or coalesce(v_recipient.is_system,false) then
    raise exception 'SYSTEM_WALLET_NOT_ALLOWED';
  end if;
  if v_sender.owner_user_id is distinct from p_actor_user_id or v_sender.merchant_id is not null then
    raise exception 'SENDER_WALLET_FORBIDDEN';
  end if;
  if v_recipient.owner_user_id is distinct from v_request.recipient_user_id
     or v_recipient.merchant_id is not null then
    raise exception 'RECIPIENT_WALLET_INVALID';
  end if;
  if v_sender.owner_user_id=v_recipient.owner_user_id then raise exception 'SELF_TRANSFER_NOT_ALLOWED'; end if;
  if v_sender.currency<>v_recipient.currency or v_sender.currency<>v_request.currency then
    raise exception 'CURRENCY_MISMATCH';
  end if;

  v_amount:=coalesce(v_request.amount,p_amount);
  if v_amount is null or v_amount<=0 then raise exception 'INVALID_AMOUNT'; end if;
  if v_request.amount is not null and p_amount is not null and p_amount<>v_request.amount then
    raise exception 'RECEIVE_AMOUNT_MISMATCH';
  end if;

  select
    coalesce((select sum(case when direction='credit' then amount else -amount end)
      from public.ledger_entries where wallet_id=p_sender_wallet_id),0)
    -
    coalesce((select sum(amount) from public.withdrawal_requests
      where wallet_id=p_sender_wallet_id
        and status in ('submitted','awaiting_second_approval','approved','processing')),0)
    into v_available;
  if v_available<v_amount then raise exception 'INSUFFICIENT_AVAILABLE_FUNDS'; end if;

  v_ledger_id:=gen_random_uuid();
  v_transfer_id:=gen_random_uuid();
  v_reference:='LGP-P2P-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
  insert into public.ledger_transactions(id,transaction_type,reference_code,initiated_by,metadata)
  values(v_ledger_id,'wallet_transfer',v_reference,p_actor_user_id,
    jsonb_build_object('channel','personal_receive_qr','receive_request_id',v_request.id));
  insert into public.ledger_entries(ledger_transaction_id,wallet_id,direction,amount,currency)
  values
    (v_ledger_id,v_sender.id,'debit',v_amount,v_sender.currency),
    (v_ledger_id,v_recipient.id,'credit',v_amount,v_sender.currency);
  insert into public.transfers(id,ledger_transaction_id,sender_wallet_id,recipient_wallet_id,
    initiated_by,amount,currency,note,status,idempotency_key)
  values(v_transfer_id,v_ledger_id,v_sender.id,v_recipient.id,p_actor_user_id,
    v_amount,v_sender.currency,'Resepsyon P2P LakayGoPay','posted',p_idempotency_key);

  update public.personal_receive_requests
     set status='paid',paid_transfer_id=v_transfer_id,updated_at=now()
   where id=v_request.id;

  v_response:=jsonb_build_object(
    'transfer_id',v_transfer_id,'ledger_transaction_id',v_ledger_id,
    'reference',v_reference,'amount',v_amount,'currency',v_sender.currency,'status','posted'
  );
  update public.idempotency_keys
     set resource_id=v_transfer_id,response=v_response
   where user_id=p_actor_user_id and operation='personal_receive_payment'
     and idempotency_key=p_idempotency_key;
  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  values(p_actor_user_id,'personal.receive_request.paid','transfer',v_transfer_id,
    jsonb_build_object('receive_request_id',v_request.id,'amount',v_amount,'currency',v_sender.currency));
  return v_response;
end;
$function$;

revoke all on function public.create_personal_receive_request(uuid,uuid,numeric,integer,text)
  from public,anon,authenticated;
revoke all on function public.get_personal_receive_request_details(uuid)
  from public,anon,authenticated;
revoke all on function public.pay_personal_receive_request(uuid,uuid,uuid,numeric,text)
  from public,anon,authenticated;
grant execute on function public.create_personal_receive_request(uuid,uuid,numeric,integer,text)
  to service_role;
grant execute on function public.get_personal_receive_request_details(uuid)
  to service_role;
grant execute on function public.pay_personal_receive_request(uuid,uuid,uuid,numeric,text)
  to service_role;

commit;
