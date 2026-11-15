# LakayGoPay — backend completion patch

This is an **additive overlay** for the existing repository `milleclatcorpgroup5-web/lakaygopay-web`. It adds new files and one additive SQL migration. It does not replace the existing dashboard files.

## Architecture choice

The existing repository already contains a Supabase/PostgreSQL financial schema, Cloudflare Pages Functions, Supabase JWT validation and a server-only Supabase secret. To avoid a risky mid-project migration, this patch completes that design:

- GitHub: source of truth for code.
- Cloudflare Pages: serves `public/` and executes `functions/`.
- Supabase Auth: email/password, email OTP, password recovery and TOTP MFA.
- Supabase PostgreSQL: RLS, wallets, append-only double-entry ledger and financial RPCs.

Do not mix a second Firebase database into this same release. Firebase Blaze is not required for this existing Cloudflare + Supabase architecture. Supabase email/phone provider availability and database quotas still follow the selected Supabase plan. Phone SMS may require a separately configured paid SMS provider.

## Files added by this patch

- `functions/_middleware.js` — adds security headers and injects the backend test panel into the existing HTML.
- `functions/_shared/security.js` — validates an elevated AAL2 session before privileged admin operations.
- `functions/api/config.js` — publishes only the Supabase URL and publishable key.
- `functions/api/transfers.js` — correctly named `/api/transfers` route (the repository currently has a misspelled `transfets.js`).
- `functions/api/payment-requests/lookup.js` and `pay.js` — QR lookup and internal QR settlement.
- `functions/api/payments.js` — payment history.
- `functions/api/withdrawals.js` — withdrawal request creation and history; destination references are encrypted at the edge when a key is configured.
- `functions/api/merchant/mine.js` — merchant list for the signed-in user.
- `functions/api/admin/*` — admin status, merchant review, two-person withdrawal approval, ledger integrity report and a test-only wallet-credit route.
- `public/lakaygopay-bridge.js` — sign-up/login, email OTP, password recovery, TOTP MFA and backend test controls.
- `superbase/migrations/202611150001_backend_completion.sql` — additive SQL for withdrawal reservation, QR settlement, idempotency payload binding and integrity checks.
- `superbase/tests/verify_backend.sql` and `scripts/verify-api.mjs` — read-only verification tools.

## Critical: apply to a TEST Supabase project first

The migration depends on the existing base migration and is **not standalone**.

1. Open the correct Supabase project. Use a separate test/staging project, not a production project.
2. In SQL Editor, execute the existing base migration first: `superbase/migrations/202611140001_financial_core.sql`.
3. Then execute the new migration: `superbase/migrations/202611150001_backend_completion.sql`.
4. Run `superbase/tests/verify_backend.sql`. Review every result. The unbalanced journal query and negative-balance queries should return zero rows in a clean test environment.
5. In Supabase Authentication settings, enable email/password and email OTP. Set the site's URL and redirect allow-list to the Cloudflare Pages preview domain. To receive a numeric email code (instead of only a magic link), edit the Magic Link email template to include `{{ .Token }}`; the app's code-entry control uses `verifyOtp` with type `email`. For phone OTP, configure an approved SMS provider; SMS delivery is not assumed free.

If the base migration has already been applied to the same project, do not run it again. Apply only the new migration. If any migration error appears, stop and share the exact error before continuing.

**Email delivery on Supabase's default SMTP is restricted:** it sends only to email addresses belonging to members of the Supabase organization team, and the current default quota is 2 emails per hour for the whole project. For the first test, use an authorized team-member email or configure a custom SMTP provider; do not assume OTP/recovery mail will reach any arbitrary address. The Magic Link template must include `{{ .Token }}` for the numeric OTP control. See the official SMTP limits: https://supabase.com/docs/guides/auth/auth-smtp.

## Apply the patch to GitHub safely

1. Download and unzip the patch.
2. Open the existing repository in GitHub and create a new branch named `feature/backend-security-test-ready` from `main`.
3. Upload the patch contents to the repository root. Keep the folder paths exactly as they appear in the ZIP.
4. Do not replace or delete `public/index.html`, `public/app.js`, `public/styles.css`, or the original migration.
5. Review the new files on the branch. Merge only after the test project and preview deployment pass.

Cloudflare Pages must be connected to this repository/branch. Build settings for this vanilla HTML project:

- Framework preset: None
- Root directory: repository root
- Build command: empty
- Build output directory: `public`
- Keep `functions/` at repository root (not inside `public/`).

If Cloudflare is currently deploying a manually uploaded asset bundle rather than the Git-connected repository, the Pages Functions folder will not be picked up from Git automatically. Cloudflare's dashboard Direct Upload does not support uploading the `functions/` directory. The safest approach is to create a separate Git-connected Pages **preview project** for this test branch and leave the existing deployment untouched. Cloudflare's Git integration deploys when commits are pushed; a Git-integrated Pages project cannot later be switched to Direct Upload. GitHub Pages itself cannot execute Cloudflare Functions.

## Cloudflare secrets

Under Cloudflare Pages → Settings → Variables and Secrets, configure these for the preview/test environment:

| Name | Type | Purpose |
|---|---|---|
| `SUPABASE_URL` | Variable | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Variable | Public client key; browser-visible by design |
| `SUPABASE_SECRET_KEY` | Encrypted secret | Server-only key used by the API |
| `WITHDRAWAL_DATA_KEY` | Encrypted secret | Optional AES-256-GCM key for withdrawal destination references |

Never paste `SUPABASE_SECRET_KEY` or `WITHDRAWAL_DATA_KEY` into browser code, a public GitHub file, screenshots, or chat. The frontend only receives the project URL and publishable key from `/api/config`.

`WITHDRAWAL_DATA_KEY` must be a base64-encoded random 32-byte key. If you do not have this configured yet, submit test withdrawal requests without a destination reference; do not store a raw phone number or bank account in the database.

## First administrator

Create and confirm the founder's account through the app. Then, in the TEST project's Supabase SQL Editor, assign the role once by verified email:

```sql
insert into public.user_roles (user_id, role)
select id, 'super_admin'
from auth.users
where lower(email) = lower('FOUNDER_EMAIL_VERIFIED')
on conflict (user_id, role) do nothing;
```

Replace `FOUNDER_EMAIL_VERIFIED` with the exact email address of the verified test account. Do not grant a role from browser JavaScript. After assigning the role, sign out and sign in again, enroll TOTP MFA, verify the six-digit code, and then use the admin test controls. Administrative decisions require a Supabase session with `aal2`.

To test two-person withdrawal approval, create and confirm a **second, separate admin account** (its email must be eligible to receive Supabase test emails), then assign it the `admin` role from SQL Editor. Replace both email placeholders below:

```sql
insert into public.user_roles (user_id, role, assigned_by)
select second_admin.id, 'admin', first_admin.id
from auth.users first_admin
cross join auth.users second_admin
where lower(first_admin.email) = lower('FOUNDER_EMAIL_VERIFIED')
  and lower(second_admin.email) = lower('SECOND_ADMIN_EMAIL_VERIFIED')
on conflict (user_id, role) do nothing;
```

Create the withdrawal request from a normal customer account. The requester cannot approve their own request; two distinct admin accounts must sign in, enroll/verify TOTP, and each approve with `aal2`. One admin account is not enough to complete the two-person test.

## Test sequence

1. Deploy the test branch to a Cloudflare Pages preview URL.
2. Open the site and select **LakayGoPay · Backend**.
3. Create an account using email/password. Confirm the email when requested.
4. Test password login, email OTP, password recovery and TOTP MFA.
5. Run **Verifye pwofil ak bous**. A newly registered account must have a personal HTG wallet with a zero balance.
6. Register a merchant. Its state should be `pending` until an admin with AAL2 activates it.
7. Create a QR payment request. It should create a pending request and produce a QR image. It is not paid yet.
8. To fund a test wallet safely, first confirm you are in the isolated TEST Supabase project. Run this SQL to enable the guarded test-credit function only in that project:

```sql
update public.platform_settings
set setting_value = '{"enabled":true}'::jsonb, updated_at = now()
where setting_key = 'test_mode_enabled';
```

Then sign in as the verified `super_admin`, enroll/verify TOTP, enter the target test wallet UUID and use **Kredi tès**. The function creates a balanced journal entry against a dedicated system clearing wallet. It is restricted to `super_admin` + AAL2 and stays disabled by default. After testing, disable it again:

```sql
update public.platform_settings
set setting_value = '{"enabled":false}'::jsonb, updated_at = now()
where setting_key = 'test_mode_enabled';
```

Never enable `test_mode_enabled` in a production project. The test-credit function is restricted to the verified `super_admin`, requires an AAL2 session, and has a 500,000 HTG per-request ceiling. Do not create balances from browser JavaScript.
9. Submit a withdrawal request. The amount is reserved, so it cannot also be spent by a later transfer or QR payment. Admin 1 approval should leave it `awaiting_second_approval` when two-person approval is required. Admin 2 must be a different user with AAL2. Approval does not execute a payout.
10. Run **Verifye entegrite ledger** as an admin with AAL2.
11. Run the SQL verification file and the API smoke tests.

For the API smoke tests, use a local Node.js environment:

```bash
LGP_BASE_URL="https://YOUR-CLOUDFLARE-PREVIEW.pages.dev" \
LGP_TEST_ACCESS_TOKEN="TEST_USER_ACCESS_TOKEN" \
node scripts/verify-api.mjs
```

The API smoke test does not move money. It tests service health, public config, access control, read endpoints and malformed-input rejection.

## What is actually enabled by this patch

- Real Supabase Auth sessions, email OTP and account recovery (once Auth settings/templates are configured).
- TOTP MFA enrollment and AAL2 enforcement for admin actions.
- Backend profile, wallet, merchant, payment history and withdrawal reads.
- Atomic internal wallet transfers with idempotency and withdrawal reservations.
- QR payment request lookup and internal merchant settlement, with two ledger entries.
- Two-person withdrawal approval and auditable merchant status review.
- A read-only ledger integrity report.
- A guarded test-only credit tool (super-admin + AAL2 + explicit database test flag; maximum 500,000 HTG per request).

## Frontend integration boundary

This overlay leaves the existing `public/index.html`, `public/app.js` and `public/styles.css` untouched. It injects a separate floating **LakayGoPay · Backend** test panel so the new authentication and API workflows can be verified without replacing the current demo UI. The main dashboard's existing demo buttons and localStorage data are not converted into live financial actions by this patch. After the backend tests pass, the next frontend phase is to connect each normal client/merchant/admin screen to these verified APIs and remove demo-only affordances.

## Explicit limits — not ready for real funds

- No MonCash, NatCash, bank or card deposits/withdrawals are integrated.
- `approved` means an administrative decision only; no provider payout occurs.
- Merchant QR settlement is an **internal LakayGoPay ledger transfer** and requires an active merchant, authenticated payer and sufficient test balance.
- Phone OTP requires a configured SMS provider and may incur costs. Email OTP is the starting test path.
- Independent security review, production secrets, rate limiting, monitoring, reconciliation, backups, dispute procedures and local legal/regulatory validation remain mandatory before any real-money pilot.
