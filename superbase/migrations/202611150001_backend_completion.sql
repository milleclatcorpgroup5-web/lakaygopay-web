-- LakayGoPay backend completion: internal QR settlement, withdrawal reservation,
-- admin step-up checks and ledger audit. Additive migration; run AFTER
-- superbase/migrations/202611140001_financial_core.sql on a fresh TEST project.
-- This does NOT enable external cash-in, cash-out or real-money settlement.

begin;

-- Bind idempotency keys to the operation payload so a key cannot be reused for
-- a different amount, wallet pair, QR token or withdrawal destination.
alter table public.idempotency_keys
  add column if not exists request_fingerprint text;

-- Add a typed system wallet so controlled test credits can remain double-entry
-- balanced without creating a negative customer wallet. System wallets are not
-- customer/merchant wallets and cannot be used as a sender or QR payer.
alter table public.wallets add column if not exists is_system boolean not null default false;
do $$
declare
  existing_check record;
begin
  for existing_check in
    select conname
    from pg_constraint
    where conrelid = 'public.wallets'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%owner_user_id%'
      and pg_get_constraintdef(oid) like '%merchant_id%'
  loop
    execute format('alter table public.wallets drop constraint %I', existing_check.conname);
  end loop;
end;
$$;
alter table public.wallets add constraint wallets_owner_kind_check check (
  (is_system = true and owner_user_id is null and merchant_id is null)
  or (is_system = false and owner_user_id is not null and merchant_id is null)
  or (is_system = false and owner_user_id is null and merchant_id is not null)
);
create unique index if not exists wallets_system_currency_uq
  on public.wallets(currency) where is_system = true;

-- Preserve the original view columns and append is_system at the end. Customer
-- wallet balances are credit-minus-debit; system clearing balances are debit-minus-credit.
create or replace view public.wallet_balances with (security_invoker = true) as
select w.id as wallet_id,
       w.owner_user_id,
       w.merchant_id,
       w.currency,
       w.status,
       coalesce(sum(case
         when w.is_system then case when e.direction = 'debit' then e.amount else -e.amount end
         else case when e.direction = 'credit' then e.amount else -e.amount end
       end), 0)::numeric(20,2) as balance,
       w.created_at,
       w.is_system
from public.wallets w
left join public.ledger_entries e on e.wallet_id = w.id
group by w.id;

insert into public.platform_settings(setting_key, setting_value)
values ('test_mode_enabled', '{"enabled":false}'::jsonb)
on conflict (setting_key) do nothing;

-- Successful internal merchant payments are separately queryable by both payer
-- and merchant. Ledger entries remain the financial source of truth.
create table if not exists public.merchant_payment_records (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null unique references public.payment_requests(id),
  ledger_transaction_id uuid not null unique references public.ledger_transactions(id),
  payer_user_id uuid not null references auth.users(id),
  payer_wallet_id uuid not null references public.wallets(id),
  merchant_id uuid not null references public.merchants(id),
  merchant_wallet_id uuid not null references public.wallets(id),
  amount numeric(20,2) not null check (amount > 0),
  currency char(3) not null default 'HTG' check (currency = 'HTG'),
  created_at timestamptz not null default now(),
  check (payer_wallet_id <> merchant_wallet_id)
);
create index if not exists merchant_payments_payer_created_idx
  on public.merchant_payment_records(payer_user_id, created_at desc);
create index if not exists merchant_payments_merchant_created_idx
  on public.merchant_payment_records(merchant_id, created_at desc);

alter table public.merchant_payment_records enable row level security;
revoke all on table public.merchant_payment_records from anon, authenticated;
grant select on public.merchant_payment_records to authenticated;
create policy merchant_payment_records_select_related_party
  on public.merchant_payment_records for select to authenticated
  using (
    payer_user_id = auth.uid()
    or public.is_current_user_merchant_member(merchant_id, null)
    or public.has_any_admin_role()
  );

-- Audit, approval decisions and completed payment records are append-only.
drop trigger if exists merchant_payment_records_no_update_delete on public.merchant_payment_records;
create trigger merchant_payment_records_no_update_delete
before update or delete on public.merchant_payment_records
for each row execute function public.reject_ledger_mutation();
drop trigger if exists withdrawal_approvals_no_update_delete on public.withdrawal_approvals;
create trigger withdrawal_approvals_no_update_delete
before update or delete on public.withdrawal_approvals
for each row execute function public.reject_ledger_mutation();
drop trigger if exists audit_logs_no_update_delete on public.audit_logs;
create trigger audit_logs_no_update_delete
before update or delete on public.audit_logs
for each row execute function public.reject_ledger_mutation();

-- A single helper for server-side role lookups. Only the trusted service key may call it.
create or replace function public.is_admin_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = p_user_id
      and ur.role in ('super_admin','admin','finance_admin','risk_admin')
  );
$$;
revoke all on function public.is_admin_user(uuid) from public, anon, authenticated;
grant execute on function public.is_admin_user(uuid) to service_role;

-- Replace the original transfer RPC to subtract pending/approved withdrawals
-- from spendable funds. All operations lock wallets, so transfers, QR payments
-- and new withdrawal requests serialize on the same wallet row.
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
  v_existing_fingerprint text;
  v_fingerprint text;
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
  v_fingerprint := md5(jsonb_build_array(p_sender_wallet_id, p_recipient_wallet_id, p_amount, coalesce(p_note,''))::text);

  insert into public.idempotency_keys(user_id, operation, idempotency_key, request_fingerprint)
  values (p_actor_user_id, 'wallet_transfer', p_idempotency_key, v_fingerprint)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select response, request_fingerprint into v_existing, v_existing_fingerprint
      from public.idempotency_keys
     where user_id = p_actor_user_id and operation = 'wallet_transfer' and idempotency_key = p_idempotency_key;
    if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    if v_existing is null then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
    return v_existing;
  end if;

  perform id from public.wallets
   where id in (p_sender_wallet_id, p_recipient_wallet_id)
   order by id for update;
  select * into v_sender from public.wallets where id = p_sender_wallet_id;
  select * into v_recipient from public.wallets where id = p_recipient_wallet_id;
  if v_sender.id is null or v_recipient.id is null then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_sender.status <> 'active' or v_recipient.status <> 'active' then raise exception 'WALLET_NOT_ACTIVE'; end if;
  if v_sender.is_system or v_recipient.is_system then raise exception 'SYSTEM_WALLET_NOT_ALLOWED'; end if;
  if v_sender.currency <> v_recipient.currency then raise exception 'CURRENCY_MISMATCH'; end if;
  if not (
    v_sender.owner_user_id = p_actor_user_id
    or (v_sender.merchant_id is not null and public.is_merchant_member(v_sender.merchant_id, p_actor_user_id, array['owner','admin','finance','cashier']))
  ) then raise exception 'SENDER_WALLET_FORBIDDEN'; end if;

  select
    coalesce((select sum(case when direction = 'credit' then amount else -amount end)
                from public.ledger_entries where wallet_id = p_sender_wallet_id), 0)
    -
    coalesce((select sum(amount) from public.withdrawal_requests
               where wallet_id = p_sender_wallet_id
                 and status in ('submitted','awaiting_second_approval','approved','processing')), 0)
    into v_balance;
  if v_balance < p_amount then raise exception 'INSUFFICIENT_AVAILABLE_FUNDS'; end if;

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
revoke all on function public.post_wallet_transfer(uuid,uuid,uuid,numeric,text,text) from public, anon, authenticated;
grant execute on function public.post_wallet_transfer(uuid,uuid,uuid,numeric,text,text) to service_role;

-- Create a withdrawal request and reserve its amount against the wallet's available
-- funds. No external provider call or payout occurs in this function.
create or replace function public.create_withdrawal_request(
  p_actor_user_id uuid,
  p_wallet_id uuid,
  p_amount numeric,
  p_destination_type text,
  p_destination_reference_encrypted text,
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
  v_wallet public.wallets%rowtype;
  v_available numeric(20,2);
  v_withdrawal_id uuid;
  v_response jsonb;
begin
  if p_actor_user_id is null then raise exception 'ACTOR_REQUIRED'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount,2) then raise exception 'INVALID_AMOUNT'; end if;
  if p_destination_type not in ('moncash','natcash','bank','cash_agent','other') then raise exception 'INVALID_DESTINATION_TYPE'; end if;
  if p_destination_reference_encrypted is not null and (length(p_destination_reference_encrypted) > 2048 or p_destination_reference_encrypted not like 'enc:v1:%') then
    raise exception 'INVALID_ENCRYPTED_DESTINATION';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  v_fingerprint := md5(jsonb_build_array(p_wallet_id, p_amount, p_destination_type)::text);

  insert into public.idempotency_keys(user_id, operation, idempotency_key, request_fingerprint)
  values (p_actor_user_id, 'withdrawal_request', p_idempotency_key, v_fingerprint)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select response, request_fingerprint into v_existing, v_existing_fingerprint
      from public.idempotency_keys
     where user_id = p_actor_user_id and operation = 'withdrawal_request' and idempotency_key = p_idempotency_key;
    if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    if v_existing is null then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
    return v_existing;
  end if;

  select * into v_wallet from public.wallets where id = p_wallet_id for update;
  if v_wallet.id is null then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_wallet.status <> 'active' then raise exception 'WALLET_NOT_ACTIVE'; end if;
  if v_wallet.is_system then raise exception 'SYSTEM_WALLET_NOT_ALLOWED'; end if;
  if not (
    v_wallet.owner_user_id = p_actor_user_id
    or (v_wallet.merchant_id is not null and public.is_merchant_member(v_wallet.merchant_id, p_actor_user_id, array['owner','admin','finance']))
  ) then raise exception 'SENDER_WALLET_FORBIDDEN'; end if;

  select
    coalesce((select sum(case when direction = 'credit' then amount else -amount end)
                from public.ledger_entries where wallet_id = p_wallet_id), 0)
    -
    coalesce((select sum(amount) from public.withdrawal_requests
               where wallet_id = p_wallet_id
                 and status in ('submitted','awaiting_second_approval','approved','processing')), 0)
    into v_available;
  if v_available < p_amount then raise exception 'INSUFFICIENT_AVAILABLE_FUNDS'; end if;

  insert into public.withdrawal_requests(wallet_id, requested_by, amount, currency,
    destination_type, destination_reference_encrypted, status, idempotency_key)
  values (p_wallet_id, p_actor_user_id, p_amount, v_wallet.currency,
    p_destination_type, p_destination_reference_encrypted, 'submitted', p_idempotency_key)
  returning id into v_withdrawal_id;

  v_response := jsonb_build_object('withdrawal_id', v_withdrawal_id, 'amount', p_amount,
    'currency', v_wallet.currency, 'status', 'submitted', 'payout_executed', false);
  update public.idempotency_keys set resource_id = v_withdrawal_id, response = v_response
   where user_id = p_actor_user_id and operation = 'withdrawal_request' and idempotency_key = p_idempotency_key;
  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  values (p_actor_user_id, 'withdrawal.request.created', 'withdrawal', v_withdrawal_id,
    jsonb_build_object('amount',p_amount,'currency',v_wallet.currency,'destination_type',p_destination_type));
  return v_response;
end;
$$;
revoke all on function public.create_withdrawal_request(uuid,uuid,numeric,text,text,text) from public, anon, authenticated;
grant execute on function public.create_withdrawal_request(uuid,uuid,numeric,text,text,text) to service_role;

-- TEST-ONLY funding endpoint. It is disabled by default and can be enabled only
-- manually in an isolated TEST project. It creates a balanced journal between a
-- system clearing wallet and a user wallet. It is not a deposit/provider API.
create or replace function public.create_test_credit(
  p_admin_user_id uuid,
  p_wallet_id uuid,
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
  v_enabled boolean;
  v_wallet public.wallets%rowtype;
  v_system_wallet public.wallets%rowtype;
  v_ledger_id uuid;
  v_reference text;
  v_response jsonb;
begin
  if not public.has_role_for_user(p_admin_user_id,'super_admin') then raise exception 'SUPER_ADMIN_REQUIRED'; end if;
  select coalesce((setting_value->>'enabled')::boolean,false) into v_enabled
    from public.platform_settings where setting_key = 'test_mode_enabled';
  if coalesce(v_enabled,false) is not true then raise exception 'TEST_MODE_DISABLED'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount,2) then raise exception 'INVALID_AMOUNT'; end if;
  if p_amount > 500000 then raise exception 'TEST_CREDIT_LIMIT_EXCEEDED'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  v_fingerprint := md5(jsonb_build_array(p_wallet_id,p_amount)::text);

  insert into public.idempotency_keys(user_id, operation, idempotency_key, request_fingerprint)
  values (p_admin_user_id, 'test_credit', p_idempotency_key, v_fingerprint)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select response, request_fingerprint into v_existing, v_existing_fingerprint
      from public.idempotency_keys
     where user_id = p_admin_user_id and operation = 'test_credit' and idempotency_key = p_idempotency_key;
    if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    if v_existing is null then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
    return v_existing;
  end if;

  insert into public.wallets(owner_user_id, merchant_id, currency, status, is_system)
  values (null, null, 'HTG', 'active', true)
  on conflict do nothing;
  select * into v_system_wallet from public.wallets where is_system = true and currency = 'HTG';
  select * into v_wallet from public.wallets where id = p_wallet_id;
  if v_wallet.id is null then raise exception 'WALLET_NOT_FOUND'; end if;
  if v_wallet.is_system or v_wallet.status <> 'active' then raise exception 'WALLET_NOT_ACTIVE'; end if;
  if v_wallet.currency <> 'HTG' then raise exception 'CURRENCY_MISMATCH'; end if;

  perform id from public.wallets where id in (v_system_wallet.id, v_wallet.id) order by id for update;
  select * into v_system_wallet from public.wallets where id = v_system_wallet.id;
  select * into v_wallet from public.wallets where id = p_wallet_id;
  if v_wallet.status <> 'active' or v_wallet.is_system then raise exception 'WALLET_NOT_ACTIVE'; end if;

  v_ledger_id := gen_random_uuid();
  v_reference := 'LGP-TEST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  insert into public.ledger_transactions(id, transaction_type, reference_code, initiated_by, metadata)
  values (v_ledger_id, 'adjustment', v_reference, p_admin_user_id,
    jsonb_build_object('channel','test_only','test_credit',true));
  insert into public.ledger_entries(ledger_transaction_id, wallet_id, direction, amount, currency)
  values
    (v_ledger_id, v_system_wallet.id, 'debit', p_amount, 'HTG'),
    (v_ledger_id, v_wallet.id, 'credit', p_amount, 'HTG');

  v_response := jsonb_build_object('ledger_transaction_id',v_ledger_id,'reference',v_reference,
    'wallet_id',v_wallet.id,'amount',p_amount,'currency','HTG','status','test_credit_posted');
  update public.idempotency_keys set resource_id = v_ledger_id, response = v_response
   where user_id = p_admin_user_id and operation = 'test_credit' and idempotency_key = p_idempotency_key;
  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  values (p_admin_user_id, 'test.credit.posted', 'wallet', v_wallet.id,
    jsonb_build_object('amount',p_amount,'currency','HTG','test_only',true));
  return v_response;
end;
$$;
revoke all on function public.create_test_credit(uuid,uuid,numeric,text) from public, anon, authenticated;
grant execute on function public.create_test_credit(uuid,uuid,numeric,text) to service_role;

-- Safe QR lookup: only a valid opaque token is accepted. Expiry is reported, not
-- treated as a payment event. The payer must still authenticate and confirm.
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
  select * into v_request from public.payment_requests
   where public_token = p_public_token;
  if v_request.id is null then raise exception 'PAYMENT_REQUEST_NOT_FOUND'; end if;
  select * into v_merchant from public.merchants where id = v_request.merchant_id;
  if v_request.status = 'pending' and v_request.expires_at <= now() then
    update public.payment_requests set status = 'expired' where id = v_request.id;
    return jsonb_build_object('payment_request_id',v_request.id,'status','expired','expires_at',v_request.expires_at);
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
revoke all on function public.get_payment_request_details(uuid) from public, anon, authenticated;
grant execute on function public.get_payment_request_details(uuid) to service_role;

-- Atomically settle a LakayGoPay-to-LakayGoPay QR payment. This posts two balanced
-- ledger lines. It is not MonCash/NatCash cash-out or an external card payment.
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
  v_amount numeric(20,2);
  v_available numeric(20,2);
  v_ledger_id uuid;
  v_payment_id uuid;
  v_reference text;
  v_response jsonb;
begin
  if p_actor_user_id is null then raise exception 'ACTOR_REQUIRED'; end if;
  if p_public_token is null or p_payer_wallet_id is null then raise exception 'INVALID_QR_OR_WALLET'; end if;
  if p_amount is not null and (p_amount <= 0 or p_amount <> round(p_amount,2)) then raise exception 'INVALID_AMOUNT'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  v_fingerprint := md5(jsonb_build_array(p_public_token, p_payer_wallet_id, p_amount)::text);

  insert into public.idempotency_keys(user_id, operation, idempotency_key, request_fingerprint)
  values (p_actor_user_id, 'qr_payment', p_idempotency_key, v_fingerprint)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select response, request_fingerprint into v_existing, v_existing_fingerprint
      from public.idempotency_keys
     where user_id = p_actor_user_id and operation = 'qr_payment' and idempotency_key = p_idempotency_key;
    if v_existing_fingerprint is distinct from v_fingerprint then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    if v_existing is null then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
    return v_existing;
  end if;

  select * into v_request from public.payment_requests
   where public_token = p_public_token for update;
  if v_request.id is null then raise exception 'PAYMENT_REQUEST_NOT_FOUND'; end if;
  if v_request.status <> 'pending' then raise exception 'PAYMENT_REQUEST_NOT_PAYABLE'; end if;
  if v_request.expires_at <= now() then
    update public.payment_requests set status = 'expired' where id = v_request.id;
    raise exception 'PAYMENT_REQUEST_EXPIRED';
  end if;

  select * into v_merchant from public.merchants where id = v_request.merchant_id;
  if v_merchant.id is null or v_merchant.status <> 'active' then raise exception 'MERCHANT_NOT_ACTIVE'; end if;
  v_amount := coalesce(v_request.amount, p_amount);
  if v_amount is null or v_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if v_request.amount is not null and p_amount is not null and p_amount <> v_request.amount then raise exception 'QR_AMOUNT_MISMATCH'; end if;

  select * into v_merchant_wallet from public.wallets
   where merchant_id = v_request.merchant_id and status = 'active';
  if v_merchant_wallet.id is null then raise exception 'MERCHANT_WALLET_NOT_FOUND'; end if;

  perform id from public.wallets
   where id in (p_payer_wallet_id, v_merchant_wallet.id)
   order by id for update;
  select * into v_payer from public.wallets where id = p_payer_wallet_id;
  select * into v_merchant_wallet from public.wallets where id = v_merchant_wallet.id;
  if v_payer.id is null or v_payer.status <> 'active' then raise exception 'WALLET_NOT_ACTIVE'; end if;
  if v_payer.is_system or v_merchant_wallet.is_system or v_merchant_wallet.status <> 'active' then raise exception 'SYSTEM_WALLET_NOT_ALLOWED'; end if;
  if v_payer.currency <> v_merchant_wallet.currency or v_payer.currency <> v_request.currency then raise exception 'CURRENCY_MISMATCH'; end if;
  if v_payer.id = v_merchant_wallet.id then raise exception 'SELF_PAYMENT_NOT_ALLOWED'; end if;
  if not (
    v_payer.owner_user_id = p_actor_user_id
    or (v_payer.merchant_id is not null and public.is_merchant_member(v_payer.merchant_id, p_actor_user_id, array['owner','admin','finance','cashier']))
  ) then raise exception 'SENDER_WALLET_FORBIDDEN'; end if;
  if v_payer.merchant_id = v_request.merchant_id then raise exception 'SELF_PAYMENT_NOT_ALLOWED'; end if;

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
  values (v_ledger_id, 'merchant_payment', v_reference, p_actor_user_id,
    jsonb_build_object('channel','internal_qr','payment_request_id',v_request.id));
  insert into public.ledger_entries(ledger_transaction_id, wallet_id, direction, amount, currency)
  values
    (v_ledger_id, v_payer.id, 'debit', v_amount, v_payer.currency),
    (v_ledger_id, v_merchant_wallet.id, 'credit', v_amount, v_payer.currency);
  insert into public.merchant_payment_records(id, payment_request_id, ledger_transaction_id,
    payer_user_id, payer_wallet_id, merchant_id, merchant_wallet_id, amount, currency)
  values (v_payment_id, v_request.id, v_ledger_id, p_actor_user_id, v_payer.id,
    v_request.merchant_id, v_merchant_wallet.id, v_amount, v_payer.currency);
  update public.payment_requests set status = 'paid', paid_ledger_transaction_id = v_ledger_id
   where id = v_request.id;

  v_response := jsonb_build_object('payment_id',v_payment_id,'payment_request_id',v_request.id,
    'ledger_transaction_id',v_ledger_id,'reference',v_reference,'amount',v_amount,
    'currency',v_payer.currency,'status','paid');
  update public.idempotency_keys set resource_id = v_payment_id, response = v_response
   where user_id = p_actor_user_id and operation = 'qr_payment' and idempotency_key = p_idempotency_key;
  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  values (p_actor_user_id, 'merchant.qr_payment.posted', 'merchant_payment', v_payment_id,
    jsonb_build_object('amount',v_amount,'currency',v_payer.currency,'merchant_id',v_request.merchant_id));
  return v_response;
end;
$$;
revoke all on function public.pay_merchant_payment_request(uuid,uuid,uuid,numeric,text) from public, anon, authenticated;
grant execute on function public.pay_merchant_payment_request(uuid,uuid,uuid,numeric,text) to service_role;

-- Merchant approval is an auditable admin action. A pending merchant cannot receive QR payments.
create or replace function public.set_merchant_status(
  p_admin_user_id uuid,
  p_merchant_id uuid,
  p_status text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text;
begin
  if not (public.has_role_for_user(p_admin_user_id,'admin') or public.has_role_for_user(p_admin_user_id,'risk_admin')) then
    raise exception 'ADMIN_ROLE_REQUIRED';
  end if;
  if p_status not in ('under_review','active','rejected','suspended') then raise exception 'INVALID_MERCHANT_STATUS'; end if;
  select status into v_previous from public.merchants where id = p_merchant_id for update;
  if v_previous is null then raise exception 'MERCHANT_NOT_FOUND'; end if;
  update public.merchants set status = p_status, updated_at = now() where id = p_merchant_id;
  insert into public.audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  values (p_admin_user_id, 'merchant.status.changed', 'merchant', p_merchant_id,
    jsonb_build_object('previous_status',v_previous,'new_status',p_status,'comment',left(coalesce(p_comment,''),500)));
  return jsonb_build_object('merchant_id',p_merchant_id,'previous_status',v_previous,'status',p_status);
end;
$$;
revoke all on function public.set_merchant_status(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.set_merchant_status(uuid,uuid,text,text) to service_role;

-- Read-only integrity report; it never repairs or mutates ledger data.
create or replace function public.run_ledger_integrity_check(p_admin_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unbalanced bigint;
  v_negative_wallets bigint;
  v_reserved_over_balance bigint;
  v_transactions bigint;
  v_entries bigint;
begin
  if not (
    public.has_role_for_user(p_admin_user_id,'admin')
    or public.has_role_for_user(p_admin_user_id,'finance_admin')
    or public.has_role_for_user(p_admin_user_id,'risk_admin')
  ) then raise exception 'ADMIN_ROLE_REQUIRED'; end if;

  select count(*) into v_unbalanced from (
    select lt.id
    from public.ledger_transactions lt
    left join public.ledger_entries le on le.ledger_transaction_id = lt.id
    group by lt.id
    having count(le.id) < 2
       or coalesce(sum(le.amount) filter (where le.direction = 'debit'),0)
          <> coalesce(sum(le.amount) filter (where le.direction = 'credit'),0)
  ) bad;

  select count(*) into v_negative_wallets
  from public.wallet_balances wb where wb.balance < 0;

  select count(*) into v_reserved_over_balance from (
    select w.id
    from public.wallets w
    left join lateral (
      select coalesce(sum(case when le.direction = 'credit' then le.amount else -le.amount end),0) as ledger_balance
      from public.ledger_entries le where le.wallet_id = w.id
    ) bal on true
    left join lateral (
      select coalesce(sum(wr.amount),0) as reserved
      from public.withdrawal_requests wr
      where wr.wallet_id = w.id and wr.status in ('submitted','awaiting_second_approval','approved','processing')
    ) res on true
    where w.is_system = false
      and bal.ledger_balance - res.reserved < 0
  ) overdrawn;

  select count(*) into v_transactions from public.ledger_transactions;
  select count(*) into v_entries from public.ledger_entries;
  insert into public.audit_logs(actor_user_id, action, resource_type, metadata)
  values (p_admin_user_id, 'ledger.integrity.checked', 'ledger',
    jsonb_build_object('unbalanced_transactions',v_unbalanced,'negative_wallets',v_negative_wallets,
      'reserved_over_balance',v_reserved_over_balance));

  return jsonb_build_object(
    'ok', (v_unbalanced = 0 and v_negative_wallets = 0 and v_reserved_over_balance = 0),
    'transactions_checked',v_transactions,
    'ledger_entries_checked',v_entries,
    'unbalanced_transactions',v_unbalanced,
    'negative_wallets',v_negative_wallets,
    'withdrawal_reservations_exceeding_balance',v_reserved_over_balance,
    'checked_at',now()
  );
end;
$$;
revoke all on function public.run_ledger_integrity_check(uuid) from public, anon, authenticated;
grant execute on function public.run_ledger_integrity_check(uuid) to service_role;

commit;
