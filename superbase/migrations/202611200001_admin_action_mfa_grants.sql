-- One-time, action-bound TOTP grants for sensitive Admin mutations.
-- Supabase Auth remains the source of truth for TOTP verification. This table
-- stores only short-lived one-use grants; it never stores TOTP secrets or codes.

create table if not exists public.admin_action_mfa_grants (
  grant_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  action_key text not null
    check (octet_length(action_key) between 16 and 220),
  proof_fingerprint text not null unique
    check (proof_fingerprint ~ '^[a-f0-9]{64}$'),
  totp_verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint admin_action_mfa_grants_expiry_check
    check (expires_at > created_at)
);

create index if not exists admin_action_mfa_grants_expiry_idx
  on public.admin_action_mfa_grants (expires_at);

create index if not exists admin_action_mfa_grants_user_session_idx
  on public.admin_action_mfa_grants (user_id, session_id, created_at desc);

alter table public.admin_action_mfa_grants enable row level security;

revoke all on table public.admin_action_mfa_grants from public, anon, authenticated;
grant all on table public.admin_action_mfa_grants to service_role;
