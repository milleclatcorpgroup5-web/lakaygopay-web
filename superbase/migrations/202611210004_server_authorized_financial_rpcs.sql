-- Server-only authorization boundary for customer financial RPCs.
-- Cloudflare must validate the user's JWT, active profile and transaction PIN
-- before calling these wrappers with the verified auth user ID.
-- Direct authenticated execution is removed to prevent PIN bypass via PostgREST.
begin;

do $preflight$
begin
  if to_regprocedure('public.transfer_funds(uuid,uuid,numeric,text,text)') is null then
    raise exception 'TRANSFER_FUNDS_FUNCTION_MISSING';
  end if;
  if to_regprocedure('public.pay_personal_receive_request(uuid,uuid,numeric,text)') is null then
    raise exception 'PERSONAL_RECEIVE_PAYMENT_FUNCTION_MISSING';
  end if;
end;
$preflight$;

-- Only the trusted backend wrappers may enter the underlying money movement
-- functions. SECURITY DEFINER owners can still invoke them internally.
revoke all on function public.transfer_funds(uuid,uuid,numeric,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.pay_personal_receive_request(uuid,uuid,numeric,text)
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
  if p_actor_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.profiles
     where id = p_actor_user_id and account_status = 'active'
  ) then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub', p_actor_user_id::text, true
  );

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
  if p_actor_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.profiles
     where id = p_actor_user_id and account_status = 'active'
  ) then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub', p_actor_user_id::text, true
  );

  return public.pay_personal_receive_request(
    p_public_token, p_sender_wallet_id, p_amount, p_idempotency_key
  );
end;
$function$;

revoke all on function public.transfer_funds_server_authorized(
  uuid,uuid,uuid,numeric,text,text
) from public, anon, authenticated;
grant execute on function public.transfer_funds_server_authorized(
  uuid,uuid,uuid,numeric,text,text
) to service_role;

revoke all on function public.pay_personal_receive_request_server_authorized(
  uuid,uuid,uuid,numeric,text
) from public, anon, authenticated;
grant execute on function public.pay_personal_receive_request_server_authorized(
  uuid,uuid,uuid,numeric,text
) to service_role;

do $verify$
begin
  if has_function_privilege(
    'authenticated',
    'public.transfer_funds(uuid,uuid,numeric,text,text)',
    'EXECUTE'
  ) then
    raise exception 'TRANSFER_FUNDS_MUST_NOT_BE_DIRECTLY_EXECUTABLE';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.pay_personal_receive_request(uuid,uuid,numeric,text)',
    'EXECUTE'
  ) then
    raise exception 'PERSONAL_RECEIVE_PAYMENT_MUST_NOT_BE_DIRECTLY_EXECUTABLE';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.transfer_funds_server_authorized(uuid,uuid,uuid,numeric,text,text)',
    'EXECUTE'
  ) then
    raise exception 'TRANSFER_SERVER_WRAPPER_GRANT_MISSING';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.pay_personal_receive_request_server_authorized(uuid,uuid,uuid,numeric,text)',
    'EXECUTE'
  ) then
    raise exception 'PERSONAL_RECEIVE_SERVER_WRAPPER_GRANT_MISSING';
  end if;
end;
$verify$;

commit;
