begin;

-- Test-only cash-agent requests. This table is deliberately separate from the
-- financial ledger and never reserves, debits, credits, or pays out wallet funds.
alter table public.agent_accounts
  add column if not exists public_agent_id text;

update public.agent_accounts
   set public_agent_id = lpad((floor(random() * 100000000))::bigint::text, 8, '0')
 where public_agent_id is null;

create unique index if not exists agent_accounts_public_agent_id_uq
  on public.agent_accounts(public_agent_id);

alter table public.agent_accounts
  alter column public_agent_id set default lpad((floor(random() * 100000000))::bigint::text, 8, '0');

alter table public.agent_accounts
  add constraint agent_accounts_public_agent_id_format
  check (public_agent_id ~ '^[0-9]{8}$');

create table if not exists public.agent_cash_withdrawal_tests (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete restrict,
  agent_account_id uuid not null references public.agent_accounts(id) on delete restrict,
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  amount numeric(20,2) not null check (amount > 0 and amount = round(amount,2)),
  currency char(3) not null check (currency in ('HTG','USD','EUR')),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected','cancelled')),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  agent_confirmed_at timestamptz,
  agent_decision_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_user_id,idempotency_key),
  check ((status = 'confirmed' and agent_confirmed_at is not null and agent_decision_by is not null)
      or status <> 'confirmed')
);

create index if not exists agent_cash_withdrawal_tests_customer_idx
  on public.agent_cash_withdrawal_tests(customer_user_id,created_at desc);
create index if not exists agent_cash_withdrawal_tests_agent_idx
  on public.agent_cash_withdrawal_tests(agent_account_id,status,created_at desc);

alter table public.agent_cash_withdrawal_tests enable row level security;
alter table public.agent_cash_withdrawal_tests force row level security;
revoke all on public.agent_cash_withdrawal_tests from public, anon, authenticated;
grant select,insert,update on public.agent_cash_withdrawal_tests to service_role;

create or replace function public.create_agent_cash_withdrawal_test(
  p_customer_user_id uuid,
  p_public_agent_id text,
  p_wallet_id uuid,
  p_amount numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=''
as $fn$
declare
  v_agent public.agent_accounts%rowtype;
  v_wallet public.wallets%rowtype;
  v_existing public.agent_cash_withdrawal_tests%rowtype;
  v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVER_AUTHORIZATION_REQUIRED'; end if;
  if p_customer_user_id is null or p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'INVALID_REQUEST'; end if;
  if p_public_agent_id !~ '^[0-9]{8}$' then raise exception 'INVALID_AGENT_ID'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;

  select * into v_agent from public.agent_accounts
   where public_agent_id=p_public_agent_id and status='active' for share;
  if v_agent.id is null then raise exception 'AGENT_NOT_FOUND_OR_INACTIVE'; end if;
  if v_agent.user_id=p_customer_user_id then raise exception 'SELF_WITHDRAWAL_NOT_ALLOWED'; end if;

  select * into v_wallet from public.wallets
   where id=p_wallet_id and owner_user_id=p_customer_user_id and status='active' and is_system=false;
  if v_wallet.id is null then raise exception 'CUSTOMER_WALLET_NOT_AVAILABLE'; end if;

  select * into v_existing from public.agent_cash_withdrawal_tests
   where customer_user_id=p_customer_user_id and idempotency_key=p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.agent_account_id<>v_agent.id or v_existing.wallet_id<>p_wallet_id or v_existing.amount<>p_amount then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object('request_id',v_existing.id,'status',v_existing.status,'currency',v_existing.currency);
  end if;

  insert into public.agent_cash_withdrawal_tests(customer_user_id,agent_account_id,wallet_id,amount,currency,idempotency_key)
  values(p_customer_user_id,v_agent.id,p_wallet_id,p_amount,v_wallet.currency,p_idempotency_key)
  returning id into v_id;

  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  values(p_customer_user_id,'agent_cash_withdrawal_test.created','agent_cash_withdrawal_test',v_id,
    jsonb_build_object('agent_account_id',v_agent.id,'amount',p_amount,'currency',v_wallet.currency,'no_ledger_movement',true));

  return jsonb_build_object('request_id',v_id,'status','pending','currency',v_wallet.currency,'agent_name',
    (select full_name from public.profiles where id=v_agent.user_id));
end;
$fn$;

create or replace function public.decide_agent_cash_withdrawal_test(
  p_agent_user_id uuid,
  p_request_id uuid,
  p_decision text
) returns jsonb
language plpgsql security definer set search_path=''
as $fn$
declare
  v_agent public.agent_accounts%rowtype;
  v_request public.agent_cash_withdrawal_tests%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVER_AUTHORIZATION_REQUIRED'; end if;
  if p_decision not in ('confirmed','rejected') then raise exception 'INVALID_AGENT_DECISION'; end if;
  select * into v_agent from public.agent_accounts where user_id=p_agent_user_id and status='active' for share;
  if v_agent.id is null then raise exception 'ACTIVE_AGENT_REQUIRED'; end if;
  select * into v_request from public.agent_cash_withdrawal_tests
   where id=p_request_id and agent_account_id=v_agent.id for update;
  if v_request.id is null then raise exception 'AGENT_REQUEST_NOT_FOUND'; end if;
  if v_request.status<>'pending' then raise exception 'AGENT_REQUEST_ALREADY_DECIDED'; end if;

  update public.agent_cash_withdrawal_tests
     set status=p_decision,
         agent_confirmed_at=case when p_decision='confirmed' then now() else null end,
         agent_decision_by=p_agent_user_id,
         updated_at=now()
   where id=p_request_id;

  insert into public.audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  values(p_agent_user_id,'agent_cash_withdrawal_test.'||p_decision,'agent_cash_withdrawal_test',p_request_id,
    jsonb_build_object('no_ledger_movement',true));

  return jsonb_build_object('request_id',p_request_id,'status',p_decision,'no_ledger_movement',true);
end;
$fn$;

revoke all on function public.create_agent_cash_withdrawal_test(uuid,text,uuid,numeric,text) from public,anon,authenticated;
revoke all on function public.decide_agent_cash_withdrawal_test(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.create_agent_cash_withdrawal_test(uuid,text,uuid,numeric,text) to service_role;
grant execute on function public.decide_agent_cash_withdrawal_test(uuid,uuid,text) to service_role;

commit;
