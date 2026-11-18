# LakayGoPay — Admin Control Center v1

This branch builds the first role-scoped control-center foundation. It is additive; it does not enable real deposits, payouts, MonCash, NatCash, card processing, or automatic service-fee collection.

## Authority and roles

| Role | Scope |
| --- | --- |
| super_admin | Full platform authority; only role allowed to grant/revoke team roles, approve/reject fee proposals, and assign/revoke the personal secretary. |
| admin | General operations and user/merchant/agent review. |
| finance_admin | Read treasury and ledger, propose service-fee versions, review withdrawals. |
| accountant | Read-only treasury, ledger and audit; no customer support actions or direct balance changes. |
| risk_admin | User/merchant/agent risk review, withdrawal review and audit. |
| support_agent | Limited customer, merchant and agent records. |
| auditor | Read-only ledger, treasury and audit. |
| secretary | Personal secretariat only, after an explicit assignment by the Super Admin. |

Every role uses its own account. Server-side endpoints validate the role, the Admin PIN session and AAL2/MFA before loading protected modules. Only the top-level Super Admin and Admin retain broad authenticated RLS visibility. Finance, Risk, Support, Auditor, Accountant and Secretary use the server-mediated APIs for their assigned scopes; the database migration tightens the broad RLS helper accordingly.

## Six control rules

1. Important administrative and finance actions leave an audit record.
2. Wallet balances are derived from immutable double-entry ledger entries; nobody edits a balance column.
3. Fee proposals are versioned, time-stamped and retained. Only Finance Admin proposes; only Super Admin approves or rejects. The database rejects self-approval even where one person holds both roles.
4. Sensitive operations require Admin PIN plus TOTP MFA (AAL2).
5. Major financial decisions require Super Admin approval. Large HTG withdrawals retain the existing two-person approval count and need one Super Admin in that approval chain; foreign-currency withdrawal approvals also need a Super Admin and two approvals. The base migration seeds the HTG threshold at zero, so until an authorized operator configures a positive threshold, every positive HTG withdrawal conservatively requires two approvals and a Super Admin.
6. Every server endpoint enforces least-privilege role permissions; hiding a UI panel is not an access-control boundary.

## Daily operating flow

\`\`\`mermaid
flowchart TD
  A["08:00 — Open the day"] --> B["System health: Auth, database, API, admin security"]
  B --> C["Reconcile the ledger and wallet balances"]
  C --> D["Review pending users, merchants, agents and service requests"]
  D --> E["During the day: authorized internal operations"]
  E --> F["Double-entry ledger posts debit and credit"]
  F --> G["Audit trail and exception monitoring"]
  G --> H["17:00 — Reconcile again"]
  H --> I["Accounting: HTG, USD and EUR reports"]
  I --> J["Finance lead signs off"]
  J --> K["Super Admin reviews major decisions and daily report"]
\`\`\`

The flow diagram is an operating procedure, not a scheduled job. Automated scheduling, report signing and notifications are separate follow-up work.

## Fee proposal and approval flow

\`\`\`mermaid
flowchart TD
  A["Finance Admin drafts a fee version"] --> B["Server validates service, currency, fee kind and effective date"]
  B --> C["Version number assigned under database lock"]
  C --> D["Proposal stored as proposed + audit event"]
  D --> E{"Super Admin decision"}
  E -->|Approve| F["Status becomes approved; decision is audit-logged"]
  E -->|Reject| G["Status becomes rejected; decision is audit-logged"]
  F --> H["Fee engine remains OFF until separate legal, operational and test approval"]
  G --> I["Version remains in history"]
\`\`\`

Approval of a proposal is not activation. The current beta does not debit users or post fee revenue automatically. The three platform-revenue system wallets are isolated from customer and clearing wallets and are expected to start at zero.

## Treasury accounts

- One system-revenue wallet per currency: HTG, USD, EUR.
- The pre-existing clearing system wallet remains a different account purpose.
- The ledger view applies the clearing account's debit-minus-credit convention and the revenue account's credit-minus-debit convention. The beta permits HTG, USD and EUR treasury wallet shells, but ledger postings, transfers and payout records remain HTG-only; USD/EUR wallets are preparatory, zero-balance accounts, not evidence of FX settlement or held customer funds.
- No client-facing API may use a system wallet as a sender or QR payer.
- No manual balance editing or direct fund movement is added by this branch.

## Personal secretariat

The Super Admin can give a user the secretary role and separately assign that user's access to one personal secretariat. The secretary may create tasks, meetings, reminders, notes, contact records and document references, and update item status. The secretariat tables are not readable by anonymous or authenticated client roles directly; requests go through role-checked server endpoints. A secretary has no finance, customer-wallet or general customer-record scope.

## Required migration and validation

1. Review and apply superbase/migrations/202611180001_admin_control_center.sql to the intended Supabase project only after the SQL is reviewed.
2. Review and apply superbase/migrations/202611180002_admin_pin_recovery_and_role_coverage.sql after 001. It extends the server-only `is_admin_user` helper and PIN-attempt RPC to all eight RBAC roles, while narrowing the broad RLS helper to Super Admin/Admin only. All other staff roles must use their narrower role-checked APIs.
3. Run `superbase/tests/verify-backend.sql` and `superbase/tests/verify-admin-control-center.sql` and inspect all returned checks.
4. Test role separation with one account per role: Super Admin, admin, finance admin, accountant, risk admin, support agent, auditor and secretary.
5. Confirm that the secretary cannot query customer records, wallets, ledger or fee proposals.
6. Confirm finance can propose a fee but cannot approve it; only Super Admin can decide.
7. Confirm a large HTG withdrawal requires the configured two approvals and includes a Super Admin; non-HTG approval requires two approvals and a Super Admin.
8. Verify that all three revenue wallets exist and start at zero in a clean QA project. Do not create real credits or real payouts for this test.
9. Test the password-recovery and AAL2-only PIN-recovery flows, including expired/replayed challenge rejection and backup TOTP enrollment.
10. Keep the Production deployment and external payment rails unchanged until the branch, migrations and tests are reviewed.

## Consolidated dashboard and daily growth analytics

The Super Admin workspace includes a consolidated navigation bar to reach the overview, growth analytics, operations, system health, finance/treasury, team roles, personal secretariat, daily flow and six control rules.

The analytics endpoint is server-mediated and requires a verified Supabase session, fresh Admin PIN session and AAL2/TOTP. It returns aggregate counts only, not customer names or personal transaction details. The 7/30/90-day chart uses:

- New registrations from `profiles.created_at`.
- Active service users from distinct `ledger_transactions.initiated_by` values where the transaction is already posted.
- Daily service transactions grouped by `transaction_type`.
- “No service activity” as the number of accounts registered by that date that did not initiate a posted ledger transaction on that date. This is a daily activity measure, not a suspended/closed account status.
- Current account-status counts from `profiles.account_status` and merchant counts from `merchants`.

The chart is based on posted ledger activity. Pending requests and services that have not created a ledger transaction are not counted. The read path has a 10,000-row safety ceiling per window and explicitly flags partial results; a scalable SQL aggregate/reporting table is a later step when volume justifies it.

The team-role module is available on the website to the Super Admin only. A person must first register a normal LakayGoPay account. The Super Admin can then search the staff directory, select the account, and grant or revoke an assignable role. The Super Admin role itself cannot be granted through this form; the database RPC and backend role checks remain authoritative.

TOTP remains required for protected operational, analytics, finance and team data. When AAL2 is absent, the interface clearly describes how to enroll or verify an existing authenticator and disables protected controls. Successful verification is checked again by the server through `/api/admin/me`; the UI never treats a decoded client-side JWT claim as the only proof.

## Known V1 limits

- No automatic fee calculation or posting exists.
- Approved fee proposals do not yet become active service tariffs.
- The accounting section is a read-only ledger foundation; chart of accounts, journals, period closing, exports and tax reports are not yet implemented.
- The daily diagram is an operating guide, not an automated close-of-day process.
- Secretariat documents are text references/notes; binary file upload and storage policy are not yet implemented.
- All external payment, cash-in and cash-out execution remains disabled.
