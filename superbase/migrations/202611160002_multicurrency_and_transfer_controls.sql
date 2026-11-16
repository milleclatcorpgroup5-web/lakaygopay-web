-- LakayGoPay: HTG/USD/EUR wallets and stronger internal transfer invariants.
-- Apply AFTER 202611160001_account_onboarding.sql.
-- This enables separate currency ledgers only. It does not add FX or real-money rails.

begin;

-- The original schema allowed only one HTG wallet per owner and rejected other currencies.
do $$
declare
  item record;
begin
  for item in
    select c.conrelid::regclass as relation_name, c.conname
      from pg_constraint c
     where c.contype = 'c'
       and c.conrelid in (
         'public.wallets'::regclass,
         'public.ledger_entries'::regclass,
         'public.transfers'::regclass,
         'public.deposit_requests'::regclass,
         'public.withdrawal_requests'::regclass,
         'public.payment_requests'::regclass,
         'public.merchant_payment_records'::regclass
       )
       and pg_get_constraintdef(c.oid) ilike '%currency%'
       and pg_get_constraintdef(c.oid) ilike '%HTG%'
  loop
    execute format('alter table %s drop constraint %I', item.relation_name, item.conname);
  end loop;
end;
$$;

alter table public.wallets
  add constraint wallets_supported_currency_check check (currency in ('HTG','USD','EUR'));
alter table public.ledger_entries
  add constraint ledger_entries_supported_currency_check check (currency in ('HTG','USD','EUR'));
alter table public.transfers
  add constraint transfers_supported_currency_check check (currency in ('HTG','USD','EUR'));
alter table public.deposit_requests
  add constraint deposit_requests_supported_currency_check check (currency in ('HTG','USD','EUR'));
alter table public.withdrawal_requests
  add constraint withdrawal_requests_supported_currency_check check (currency in ('HTG','USD','EUR'));
alter table public.payment_requests
  add constraint payment_requests_supported_currency_check check (currency in ('HTG','USD','EUR'));
alter table public.merchant_payment_records
  add constraint merchant_payment_records_supported_currency_check check (currency in ('HTG','USD','EUR'));

-- Replace per-owner unique indexes with per-currency uniqueness.
drop index if exists public.wallets_personal_owner_uq;
drop index if exists public.wallets_merchant_uq;
create unique index if not exists wallets_personal_owner_currency_uq
  on public.wallets(owner_user_id, currency) where owner_user_id is not null;
create unique index if not exists wallets_merchant_currency_uq
  on public.wallets(merchant_id, currency) where merchant_id is not null;

-- New users receive three empty personal wallets. No balance is credited.
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
  select new.id, currencies.currency, 'active'
    from (values ('HTG'::char(3)), ('USD'::char(3)), ('EUR'::char(3))) as currencies(currency)
  on conflict do nothing;
  return new;
end;
$$;

-- Merchant registration already creates the HTG wallet. This trigger adds USD and EUR.
create or replace function public.create_merchant_multi_currency_wallets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.wallets (merchant_id, currency, status)
  values (new.id, 'USD', 'active'), (new.id, 'EUR', 'active')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists merchants_create_additional_currency_wallets on public.merchants;
create trigger merchants_create_additional_currency_wallets
after insert on public.merchants
for each row execute function public.create_merchant_multi_currency_wallets();

-- Backfill the three empty wallets for users and merchants who already existed
-- before this migration. Existing balances and ledger entries are untouched.
insert into public.wallets (owner_user_id, currency, status)
select owners.owner_user_id, currencies.currency, 'active'
from (
  select id as owner_user_id
  from auth.users
) as owners
cross join (values ('HTG'::char(3)), ('USD'::char(3)), ('EUR'::char(3))) as currencies(currency)
on conflict do nothing;

insert into public.wallets (merchant_id, currency, status)
select merchants.id, currencies.currency, 'active'
from public.merchants as merchants
cross join (values ('HTG'::char(3)), ('USD'::char(3)), ('EUR'::char(3))) as currencies(currency)
on conflict do nothing;

-- Enforce a balanced debit/credit pair independently for each currency, and
-- ensure an entry can never be posted against a wallet denominated differently.
create or replace function public.enforce_balanced_ledger_transaction()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_txn_id uuid;
  v_count integer;
begin
  v_txn_id := case when tg_table_name = 'ledger_transactions' then new.id else new.ledger_transaction_id end;

  select count(*) into v_count
    from public.ledger_entries
   where ledger_transaction_id = v_txn_id;

  if v_count < 2 then
    raise exception 'LEDGER_TRANSACTION_NOT_BALANCED';
  end if;

  if exists (
    select 1
      from public.ledger_entries e
     where e.ledger_transaction_id = v_txn_id
     group by e.currency
    having coalesce(sum(e.amount) filter (where e.direction = 'debit'), 0)
        <> coalesce(sum(e.amount) filter (where e.direction = 'credit'), 0)
  ) then
    raise exception 'LEDGER_TRANSACTION_NOT_BALANCED_BY_CURRENCY';
  end if;

  if exists (
    select 1
      from public.ledger_entries e
      join public.wallets w on w.id = e.wallet_id
     where e.ledger_transaction_id = v_txn_id
       and e.currency <> w.currency
  ) then
    raise exception 'LEDGER_ENTRY_CURRENCY_MISMATCH';
  end if;

  return null;
end;
$$;

-- Pending or rejected merchants cannot send or receive internal transfers.
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

  if v_sender.merchant_id is not null and not exists (
    select 1 from public.merchants m where m.id = v_sender.merchant_id and m.status = 'active'
  ) then raise exception 'MERCHANT_NOT_ACTIVE'; end if;

  if v_recipient.merchant_id is not null and not exists (
    select 1 from public.merchants m where m.id = v_recipient.merchant_id and m.status = 'active'
  ) then raise exception 'MERCHANT_NOT_ACTIVE'; end if;

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

commit;
