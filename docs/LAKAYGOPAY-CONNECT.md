# LakayGoPay Connect — delivery note

The first provider release creates a sandbox-only partner integration layer:
- Hosted checkout: an app requests payment and the customer approves from their LakayGoPay wallet.
- Payout request: a partner app requests a transfer to a LakayGoPay user; the user must accept with their transaction PIN.
- Signed backend API requests, idempotency, partner application onboarding, admin review and one-time secret rotation.
- Double-entry ledger settlement reuses the current LakayGoPay merchant-payment model.

Partner apps must be tied to an active merchant owned by the developer. Apps start pending and Risk/Finance approval is required. App credentials are stored as SHA-256 hashes, and the raw client secret is shown once. All API requests are sandbox-only.

This is not a real-money gateway. The balances are internal ledger balances. No bank, MonCash, NatCash, card, external cash-in or external cash-out network is activated. The partner must query the Connect status API and only credit its own application after a final paid status. Webhook delivery, live approvals, refunds, and verified account linking are future phases.

Production rollout:
1. Deploy source to Cloudflare Pages.
2. Apply superbase/migrations/202611190002_lakaygopay_connect_foundation.sql only after prior financial, multi-currency and admin migrations have been confirmed.
3. Run superbase/tests/verify-connect.sql.
4. Approve one test app and issue sandbox credentials.
5. Test checkout and payout using test accounts/internal test funds.
6. Integrate MC-MARKETPLACE as the first partner only after these tests pass.
