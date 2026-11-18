# LakayGoPay Admin — Security, recovery and acceptance matrix

## Scope

This change is additive and is developed on `feat/admin-hardening-premium-control-center`. It does not activate payment rails, customer deposits, external withdrawals, FX settlement, fee collection or automatic fee posting. It does not reset or alter any live administrator's PIN, MFA factors, roles or wallet balances.

The SQL migration `202611180002_admin_pin_recovery_and_role_coverage.sql` must be reviewed and tested against an isolated Supabase project before anyone considers applying it to Production. It corrects the PIN-attempt RPC role allow-list so every role already admitted by Admin RBAC can complete its PIN gate.

## Authentication sequence

1. Admin enters email and password through Supabase Auth.
2. The server confirms the user has an assigned Admin role.
3. Admin enters the six-digit Admin PIN. Only a salted PBKDF2 hash is stored. Five failed PIN attempts trigger a 15-minute lock.
4. Admin verifies a TOTP factor to raise the Supabase session to AAL2.
5. Protected API endpoints re-check the signed bearer token, AAL2, the fresh PIN verification bound to the current Supabase session, and the assigned role. UI visibility is never the security boundary.

A page refresh intentionally requires the Admin PIN again. PIN verification is time-limited and bound to the Auth session.

## Recovery controls

### Forgotten account password

- Email delivery is dependent on the Supabase Auth SMTP configuration and sender-domain deliverability. The code path can be checked statically, but a real email delivery test has not been run. Do not mark this recovery path accepted until the inbox and spam delivery test succeeds on a QA account.


- The login page requests a Supabase password-recovery email.
- Configure the exact Admin URL in Supabase Auth redirect allow-list: `https://lakaygopay-web.pages.dev/admin/` (and the trusted non-production callback URL used for QA).
- The callback supports Supabase's implicit recovery tokens and the PKCE `?code=` callback. For PKCE, the code verifier must still exist in the same browser storage context that requested the email. The Admin enters a new password with at least 12 characters.
- The user must sign in again, then pass the Admin PIN and MFA gates. Password recovery does not grant access to protected Admin modules.

### Forgotten Admin PIN

- The PIN recovery form is available only after the user signs in to the account that already has an Admin role.
- The user selects a previously verified TOTP factor and proves possession using a current six-digit code.
- The server validates AAL2 and the signed token's session ID, issues a one-use five-minute reset challenge, and accepts only the PBKDF2-derived PIN value plus the challenge proof. The raw replacement PIN is not sent to the Worker during recovery.
- A database RPC consumes the nonce, rotates the PIN hash and salt, clears lockout counters, binds the new PIN verification to the same Auth session, and writes an audit event.
- Replayed, expired, cross-user or cross-session challenges must fail.

### TOTP device resilience

- Enroll a primary TOTP authenticator, verify it, then use the explicit backup-enrollment action while the current session is AAL2.
- Verify the backup authenticator before relying on it. Keep the second device and its secret separate from the primary device.
- The interface can select among enrolled TOTP factors. It must never remove a verified factor as part of routine backup enrollment.
- Supabase does not provide an app-side bypass for a user who has lost every verified authenticator. Total loss of all TOTP devices requires a documented, independently verified, dual-control identity recovery process outside this interface. Do not disable MFA merely because a user still controls their email inbox.

## Role-based acceptance matrix

Use a separate test account for each role. Never temporarily change the real Super Admin account to simulate a lesser role.

| Role | Expected Admin scope | Must be denied |
| --- | --- | --- |
| `super_admin` | Full dashboard, system health, operations, finance, fee decisions, team roles and own secretariat | Cannot grant the `super_admin` role through the staff-role form |
| `admin` | Operational records/actions and system health | Finance fee approval and staff-role management |
| `finance_admin` | Treasury, ledger, daily financial reports, fee proposals and authorized withdrawal review | Fee approval, team role management and customer-support-only controls |
| `accountant` | Read-only treasury, ledger, audit and daily finance reports | Balance edits, customer support changes, fee proposals/approvals and team management |
| `risk_admin` | User/merchant/agent/withdrawal risk review and audit | Treasury changes, fee decisions and team management |
| `support_agent` | Limited user, merchant and agent support records | Finance, ledger mutation, withdrawal decisions and team management |
| `auditor` | Read-only treasury, ledger and audit | Mutations, fee approval, user support actions and team management |
| `secretary` | Assigned personal secretariat only, after Super Admin grants access | Customer records, wallet, ledger, finance, operations and other owners' secretariat data |

For every role, confirm the same sequence works: login → Admin PIN → TOTP AAL2 → only permitted modules load. Call protected API endpoints directly with the test account as well as using the UI; hidden UI panels do not count as a permission test. Only Super Admin/Admin should pass broad authenticated RLS checks; Finance, Risk, Support, Auditor, Accountant and Secretary should receive data only from their individual server-checked API scopes.

## Database and finance acceptance

After reviewing and applying migrations to an isolated QA database in order:

1. Run `superbase/tests/verify-backend.sql`.
2. Run `superbase/tests/verify-admin-control-center.sql`.
3. Confirm `record_admin_pin_attempt(uuid,boolean,uuid)` accepts all eight roles and rejects non-Admin roles.
4. Confirm `admin_pin_reset_challenges` has RLS enabled and no direct access for `anon` or `authenticated`.
5. Confirm `reset_admin_pin` is executable only by `service_role`; test expired, reused, wrong-user and wrong-session nonces.
6. Confirm all three platform-revenue accounts exist for HTG, USD and EUR. They must start at zero in a clean QA database. These are treasury account shells, not customer FX wallets.
7. Test Finance Admin fee proposal and Super Admin review with different user accounts. Confirm the same person cannot propose and approve the same proposal.
8. Confirm the finance summary is read-only and sourced from the immutable ledger. No manual balance editing.
9. Confirm all external payment and automatic fee engine flags remain false. Do not use production deposits, withdrawals or real external payment providers for these tests.

The existing accounting foundation is not a full general ledger product yet: chart of accounts, journals, formal period close, accounting exports and tax reporting remain separate product work. The daily workflow illustration is a procedure, not a scheduled automated close.

## Visual QA acceptance

Test the Production UI only after an approved rollout. Before that, validate in a Cloudflare Preview deployment. Use both portrait and landscape tablet layouts plus a narrow mobile viewport.

- Executive header, KPI tiles and analytics appear in a clear priority order.
- Charts retain readable axes/legends and do not overflow the screen.
- Finance, team and secretariat tables remain scrollable and legible.
- MFA factor selector, backup enrollment, password recovery and PIN recovery forms are usable by keyboard and touch.
- Focus states, reduced-motion preference and contrast remain intact.
- No secrets, OTP codes or PIN values appear in logs, URLs or error messages.

## Rollout boundary

This branch is not Production. Do not run the migration against the live Supabase project, merge the branch, or deploy to the Production Pages domain until the SQL review, role tests, recovery tests, static checks and UI review have passed and the Production rollout is explicitly authorized.
