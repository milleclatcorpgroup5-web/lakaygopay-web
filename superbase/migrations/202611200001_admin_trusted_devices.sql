BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_trusted_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS admin_trusted_devices_user_expiry_idx
  ON public.admin_trusted_devices (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE public.admin_trusted_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_trusted_devices FROM anon, authenticated;
GRANT ALL ON TABLE public.admin_trusted_devices TO service_role;

COMMIT;
