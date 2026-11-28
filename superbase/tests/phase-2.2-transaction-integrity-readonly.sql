-- Phase 2.2 — Production transaction-integrity diagnostic.
-- READ ONLY: catalog queries and SELECTs only. No payment, transfer, balance,
-- ledger, schema, permission, or configuration changes are performed.
BEGIN TRANSACTION READ ONLY;

-- 1. Financial transaction/request tables and their idempotency columns.
SELECT
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN (
    'ledger_transactions',
    'ledger_entries',
    'transfers',
    'deposit_requests',
    'withdrawal_requests',
    'merchant_payment_requests',
    'merchant_qr_requests',
    'merchant_qr_payment_idempotency',
    'personal_receive_requests'
  )
  AND (
    c.column_name IN (
      'id', 'status', 'transaction_type', 'currency', 'amount',
      'idempotency_key', 'request_idempotency_key', 'paid_idempotency_key',
      'request_fingerprint', 'ledger_transaction_id',
      'paid_ledger_transaction_id', 'paid_transfer_id',
      'created_by_user_id', 'recipient_user_id', 'requested_by_user_id',
      'actor_user_id', 'transaction_id', 'account_id', 'direction'
    )
  )
ORDER BY c.table_name, c.ordinal_position;

-- 2. Unique constraints and unique indexes relevant to idempotency/payment linkage.
SELECT
  t.relname AS table_name,
  i.relname AS index_name,
  ix.indisunique AS is_unique,
  ix.indisvalid AS is_valid,
  pg_get_indexdef(i.oid) AS index_definition
FROM pg_index ix
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN (
    'ledger_transactions',
    'transfers',
    'deposit_requests',
    'withdrawal_requests',
    'merchant_payment_requests',
    'merchant_qr_requests',
    'merchant_qr_payment_idempotency',
    'personal_receive_requests'
  )
  AND (
    pg_get_indexdef(i.oid) ILIKE '%idempotency%'
    OR pg_get_indexdef(i.oid) ILIKE '%ledger_transaction_id%'
    OR pg_get_indexdef(i.oid) ILIKE '%paid_transfer_id%'
  )
ORDER BY t.relname, i.relname;

-- 3. Duplicate non-empty idempotency keys (expected: zero rows).
SELECT 'ledger_transactions' AS table_name, idempotency_key AS key_value, COUNT(*) AS occurrences
FROM public.ledger_transactions
WHERE NULLIF(BTRIM(idempotency_key), '') IS NOT NULL
GROUP BY idempotency_key HAVING COUNT(*) > 1
UNION ALL
SELECT 'transfers', idempotency_key, COUNT(*)
FROM public.transfers
WHERE NULLIF(BTRIM(idempotency_key), '') IS NOT NULL
GROUP BY idempotency_key HAVING COUNT(*) > 1
UNION ALL
SELECT 'deposit_requests', idempotency_key, COUNT(*)
FROM public.deposit_requests
WHERE NULLIF(BTRIM(idempotency_key), '') IS NOT NULL
GROUP BY idempotency_key HAVING COUNT(*) > 1
UNION ALL
SELECT 'withdrawal_requests', requested_by_user_id::text || ':' || idempotency_key, COUNT(*)
FROM public.withdrawal_requests
WHERE NULLIF(BTRIM(idempotency_key), '') IS NOT NULL
GROUP BY requested_by_user_id, idempotency_key HAVING COUNT(*) > 1
UNION ALL
SELECT 'merchant_payment_requests', created_by_user_id::text || ':' || idempotency_key, COUNT(*)
FROM public.merchant_payment_requests
WHERE NULLIF(BTRIM(idempotency_key), '') IS NOT NULL
GROUP BY created_by_user_id, idempotency_key HAVING COUNT(*) > 1
UNION ALL
SELECT 'merchant_qr_requests', created_by_user_id::text || ':' || request_idempotency_key, COUNT(*)
FROM public.merchant_qr_requests
WHERE NULLIF(BTRIM(request_idempotency_key), '') IS NOT NULL
GROUP BY created_by_user_id, request_idempotency_key HAVING COUNT(*) > 1
UNION ALL
SELECT 'personal_receive_requests', recipient_user_id::text || ':' || request_idempotency_key, COUNT(*)
FROM public.personal_receive_requests
WHERE NULLIF(BTRIM(request_idempotency_key), '') IS NOT NULL
GROUP BY recipient_user_id, request_idempotency_key HAVING COUNT(*) > 1
ORDER BY table_name, key_value;

-- 4. Ledger transaction integrity: entries count, debit/credit totals and status.
SELECT
  lt.status,
  COUNT(*) AS transaction_count,
  COUNT(*) FILTER (WHERE COALESCE(e.entry_count, 0) < 2) AS fewer_than_two_entries,
  COUNT(*) FILTER (
    WHERE COALESCE(e.entry_count, 0) >= 2
      AND ABS(COALESCE(e.debit_total, 0) - COALESCE(e.credit_total, 0)) > 0.000001
  ) AS unbalanced_transactions
FROM public.ledger_transactions lt
LEFT JOIN (
  SELECT
    transaction_id,
    COUNT(*) AS entry_count,
    SUM(amount) FILTER (WHERE direction = 'debit') AS debit_total,
    SUM(amount) FILTER (WHERE direction = 'credit') AS credit_total
  FROM public.ledger_entries
  GROUP BY transaction_id
) e ON e.transaction_id = lt.id
GROUP BY lt.status
ORDER BY lt.status;

-- 5. Server-side transaction RPC inventory and security indicators.
-- This reports source-code indicators, not a substitute for manual code review.
SELECT
  p.oid::regprocedure AS function_signature,
  pg_get_userbyid(p.proowner) AS function_owner,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  position('idempotency' IN lower(p.prosrc)) > 0 AS mentions_idempotency,
  position('advisory_xact_lock' IN lower(p.prosrc)) > 0 AS uses_advisory_lock,
  position('for update' IN lower(p.prosrc)) > 0 AS uses_row_lock,
  position('auth.uid' IN lower(p.prosrc)) > 0 AS checks_auth_uid,
  position('service_role' IN lower(p.prosrc)) > 0 AS checks_service_role,
  position('raise exception' IN lower(p.prosrc)) > 0 AS has_exception_checks
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.proname ILIKE '%transfer%'
    OR p.proname ILIKE '%deposit%'
    OR p.proname ILIKE '%withdraw%'
    OR p.proname ILIKE '%merchant%pay%'
    OR p.proname = 'post_ledger_transaction'
  )
ORDER BY p.proname, p.oid::regprocedure::text;

ROLLBACK;
