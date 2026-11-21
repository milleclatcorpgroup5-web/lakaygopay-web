-- Restore the merchant onboarding RPC expected by /api/merchant/register.
-- Safe for the current Production schema: creates only the merchant record and
-- missing zero-balance merchant wallets. Wallet INSERT triggers create the
-- matching wallet_balances rows and ledger_accounts; no ledger entries or
-- balances are credited or updated.
begin;

create or replace function public.register_merchant_account(
  p_actor_user_id uuid,
  p_business_name text,
  p_business_type text,
  p_category text,
  p_contact_phone text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_status text;
  v_merchant public.merchants%rowtype;
  v_created boolean := false;
begin
  if p_actor_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_idempotency_key is null
     or length(trim(p_idempotency_key)) not between 8 and 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  if length(trim(coalesce(p_business_name, ''))) not between 2 and 120 then
    raise exception 'INVALID_BUSINESS_NAME';
  end if;

  if p_business_type not in ('sole_proprietor', 'company', 'cooperative', 'nonprofit', 'other') then
    raise exception 'INVALID_BUSINESS_TYPE';
  end if;

  if length(trim(coalesce(p_contact_phone, ''))) not between 8 and 24
     or trim(p_contact_phone) !~ '^[+0-9 ()-]+$' then
    raise exception 'VALID_BUSINESS_PHONE_REQUIRED';
  end if;

  -- Serialize onboarding attempts for the same account. Repeated submissions
  -- return the existing merchant rather than creating duplicate businesses.
  perform pg_advisory_xact_lock(
    hashtextextended('merchant-registration:' || p_actor_user_id::text, 0)
  );

  select p.account_status
    into v_account_status
    from public.profiles p
   where p.id = p_actor_user_id;

  if v_account_status is distinct from 'active' then
    raise exception 'ACTIVE_ACCOUNT_REQUIRED';
  end if;

  select m.*
    into v_merchant
    from public.merchants m
   where m.owner_user_id = p_actor_user_id
   order by m.created_at desc nulls last
   limit 1
   for update;

  if v_merchant.id is null then
    insert into public.merchants (
      owner_user_id,
      business_name,
      business_type,
      category,
      contact_phone,
      status
    ) values (
      p_actor_user_id,
      trim(p_business_name),
      p_business_type,
      nullif(trim(coalesce(p_category, '')), ''),
      trim(p_contact_phone),
      'pending'
    )
    returning * into v_merchant;

    v_created := true;
  end if;

  -- Merchant wallets are owned through merchant_id (owner_user_id stays NULL).
  -- The existing merchant trigger creates USD/EUR; this also guarantees HTG
  -- and safely fills any missing currency wallet on a retry.
  insert into public.wallets (merchant_id, currency, status)
  select v_merchant.id, c.currency, 'active'
    from (values ('HTG'::text), ('USD'::text), ('EUR'::text)) as c(currency)
  on conflict do nothing;

  return jsonb_build_object(
    'merchant_id', v_merchant.id,
    'business_name', v_merchant.business_name,
    'business_type', v_merchant.business_type,
    'status', v_merchant.status,
    'already_registered', not v_created
  );
end;
$function$;

revoke all on function public.register_merchant_account(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.register_merchant_account(uuid, text, text, text, text, text)
  to service_role;

commit;
