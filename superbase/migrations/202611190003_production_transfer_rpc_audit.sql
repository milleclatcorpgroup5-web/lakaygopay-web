-- LakayGoPay Production transfer hardening.
-- This migration is designed for the already-existing Production schema.
-- It deliberately does NOT recreate transfer_funds(): that Production function
-- was reviewed separately and already performs atomic/idempotent ledger posting.
--
-- Apply only after reviewing the Production function signature and schema.
-- The Cloudflare endpoint calls this RPC with the authenticated user's JWT.

begin;

do $check_transfer_function$
begin
  if to_regprocedure('public.transfer_funds(uuid,uuid,numeric,text,text)') is null then
    raise exception 'PRODUCTION_TRANSFER_FUNDS_FUNCTION_NOT_FOUND';
  end if;
end;
$check_transfer_function$;

-- The RPC derives the caller from auth.uid(); only authenticated customers
-- should be able to invoke it through PostgREST. The service-role endpoint
-- must not impersonate the customer for this money movement.
revoke all on function public.transfer_funds(uuid,uuid,numeric,text,text)
  from public, anon, service_role;
grant execute on function public.transfer_funds(uuid,uuid,numeric,text,text)
  to authenticated;

-- Audit both creation and final status transitions. The function obtains the
-- actor from the matching ledger transaction, not from a client-supplied id.
-- Any audit insert failure aborts the same transaction as the money movement.
create or replace function public.audit_transfer_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $audit_transfer_event$
declare
  v_actor_user_id uuid;
  v_action text;
  v_outcome text;
  v_metadata jsonb;
begin
  select lt.actor_user_id
    into v_actor_user_id
    from public.ledger_transactions lt
   where lt.id = new.ledger_transaction_id;

  v_actor_user_id := coalesce(v_actor_user_id, auth.uid());
  if v_actor_user_id is null then
    raise exception 'TRANSFER_AUDIT_ACTOR_REQUIRED';
  end if;

  if tg_op = 'INSERT' then
    v_action := 'transfer.created';
    v_outcome := 'success';
    v_metadata := jsonb_build_object(
      'ledger_transaction_id', new.ledger_transaction_id,
      'sender_wallet_id', new.sender_wallet_id,
      'recipient_wallet_id', new.recipient_wallet_id,
      'amount', new.amount,
      'currency', new.currency,
      'status', new.status
    );
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    v_action := case
      when new.status = 'posted' then 'transfer.posted'
      else 'transfer.status_changed'
    end;
    v_outcome := case when new.status = 'posted' then 'success' else 'failure' end;
    v_metadata := jsonb_build_object(
      'ledger_transaction_id', new.ledger_transaction_id,
      'sender_wallet_id', new.sender_wallet_id,
      'recipient_wallet_id', new.recipient_wallet_id,
      'amount', new.amount,
      'currency', new.currency,
      'previous_status', old.status,
      'new_status', new.status
    );
  else
    return new;
  end if;

  insert into public.audit_logs(
    actor_user_id, action, resource_type, resource_id, outcome, metadata
  )
  values (
    v_actor_user_id, v_action, 'transfer', new.id, v_outcome, v_metadata
  );

  return new;
end;
$audit_transfer_event$;

drop trigger if exists transfers_audit_event on public.transfers;
create trigger transfers_audit_event
after insert or update of status on public.transfers
for each row
execute function public.audit_transfer_event();

-- Trigger functions are not callable as public RPCs.
revoke all on function public.audit_transfer_event()
  from public, anon, authenticated, service_role;

-- Fail the migration rather than silently leave incorrect RPC permissions
-- or a missing audit trigger.
do $verify_transfer_hardening$
begin
  if not has_function_privilege(
    'authenticated',
    'public.transfer_funds(uuid,uuid,numeric,text,text)',
    'EXECUTE'
  ) then
    raise exception 'TRANSFER_RPC_AUTHENTICATED_GRANT_MISSING';
  end if;

  if has_function_privilege(
    'anon',
    'public.transfer_funds(uuid,uuid,numeric,text,text)',
    'EXECUTE'
  ) then
    raise exception 'TRANSFER_RPC_ANON_MUST_NOT_EXECUTE';
  end if;

  if has_function_privilege(
    'service_role',
    'public.transfer_funds(uuid,uuid,numeric,text,text)',
    'EXECUTE'
  ) then
    raise exception 'TRANSFER_RPC_SERVICE_ROLE_MUST_NOT_EXECUTE';
  end if;

  if not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.transfers'::regclass
       and t.tgname = 'transfers_audit_event'
       and not t.tgisinternal
  ) then
    raise exception 'TRANSFER_AUDIT_TRIGGER_MISSING';
  end if;
end;
$verify_transfer_hardening$;

commit;
