-- LakayGoPay Admin Control Center v3.
-- Align ledger-integrity audit authorization with the Admin RBAC API.
-- Read-only ledger checks may be run by Super Admin, Admin, Finance, Risk,
-- Accountant and Auditor. The function writes only an audit-log entry.
-- It does not modify ledger entries, wallet balances, withdrawals or payments.

begin;

create or replace function public.run_ledger_integrity_check(p_admin_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $ledger_integrity_check$
declare
  v_unbalanced bigint;
  v_negative_wallets bigint;
  v_reserved_over_balance bigint;
  v_transactions bigint;
  v_entries bigint;
begin
  if p_admin_user_id is null or not (
    public.has_role_for_user(p_admin_user_id,'super_admin')
    or public.has_role_for_user(p_admin_user_id,'admin')
    or public.has_role_for_user(p_admin_user_id,'finance_admin')
    or public.has_role_for_user(p_admin_user_id,'risk_admin')
    or public.has_role_for_user(p_admin_user_id,'accountant')
    or public.has_role_for_user(p_admin_user_id,'auditor')
  ) then
    raise exception 'ADMIN_ROLE_REQUIRED';
  end if;

  select count(*) into v_unbalanced
  from (
    select lt.id
      from public.ledger_transactions lt
      left join public.ledger_entries le on le.ledger_transaction_id = lt.id
     group by lt.id
    having count(le.id) < 2
        or coalesce(sum(le.amount) filter (where le.direction = 'debit'),0)
           <> coalesce(sum(le.amount) filter (where le.direction = 'credit'),0)
  ) bad;

  select count(*) into v_negative_wallets
    from public.wallet_balances wb
   where wb.balance < 0;

  select count(*) into v_reserved_over_balance
  from (
    select w.id
      from public.wallets w
      left join lateral (
        select coalesce(
          sum(case when le.direction = 'credit' then le.amount else -le.amount end),0
        ) as ledger_balance
          from public.ledger_entries le
         where le.wallet_id = w.id
      ) bal on true
      left join lateral (
        select coalesce(sum(wr.amount),0) as reserved
          from public.withdrawal_requests wr
         where wr.wallet_id = w.id
           and wr.status in ('submitted','awaiting_second_approval','approved','processing')
      ) res on true
     where w.is_system = false
       and bal.ledger_balance - res.reserved < 0
  ) overdrawn;

  select count(*) into v_transactions from public.ledger_transactions;
  select count(*) into v_entries from public.ledger_entries;

  insert into public.audit_logs(actor_user_id, action, resource_type, metadata)
  values (
    p_admin_user_id,
    'ledger.integrity.checked',
    'ledger',
    jsonb_build_object(
      'unbalanced_transactions',v_unbalanced,
      'negative_wallets',v_negative_wallets,
      'reserved_over_balance',v_reserved_over_balance
    )
  );

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
$ledger_integrity_check$;

revoke all on function public.run_ledger_integrity_check(uuid)
  from public, anon, authenticated;
grant execute on function public.run_ledger_integrity_check(uuid)
  to service_role;

commit;
