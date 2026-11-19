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


## Partner payout reserve and recipient choice
When a partner requests a payout, LakayGoPay verifies that the linked merchant wallet has enough available balance and reserves the requested amount while the request is pending. This prevents the same merchant funds from being promised to multiple customers or spent twice. The customer sees the partner name, amount, currency and external reference in their LakayGoPay account. They can accept with their transaction PIN or reject the request. Rejection releases the reserve and does not create a ledger transfer. Acceptance posts one balanced debit/credit pair in the selected currency.

## Integration boundary
A partner must only fulfill its own game credits, Marketplace order, subscription or customer balance after its backend polls the Connect checkout status and receives a final \`paid\` result. Do not trust a browser redirect or client-side success flag. Payout requests are not final until the recipient accepts them. This iteration uses a partner's internal LakayGoPay merchant wallet and a recipient's internal LakayGoPay wallet; it is not a bank transfer or external cash-out.

## Production readiness status
Source code may be deployed on the Production domain while the Connect operating mode remains \`sandbox\`. The Connect database migration must be applied after prerequisite financial, multi-currency, merchant-payment and Admin migrations are verified. Until then, partner onboarding, checkout settlement and payout workflows are unavailable. No real-money production capability is enabled by this release.
