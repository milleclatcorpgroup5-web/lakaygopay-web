# LakayGoPay Connect — Sandbox API v1

Base URL: https://lakaygopay-web.pages.dev

This release is sandbox-only. It can move existing internal wallet ledger balances after a customer authorizes checkout or accepts a payout. It does not accept external deposits, pay out to MonCash/NatCash/banks, or settle real-world funds.

## Credentials and request signing
Create an app in /developers/. Risk/Finance must approve it before credentials can be issued. The client secret is displayed once. Keep credentials on your backend only.

Every partner API request includes:
- X-LGP-Client-Id
- X-LGP-Timestamp (Unix seconds)
- X-LGP-Signature (lowercase hex HMAC-SHA256)
- Idempotency-Key on POST requests

The HMAC key is the raw 32-byte SHA-256 digest of the client secret. The signed UTF-8 message is:
timestamp + "." + HTTP_METHOD + "." + path_and_query + "." + raw_request_body

For GET, raw_request_body is empty. The timestamp must be within five minutes. Sign the exact raw body bytes.

Node.js example:
    const key = crypto.createHash("sha256").update(clientSecret, "utf8").digest();
    const canonical = timestamp + "." + method.toUpperCase() + "." + pathAndQuery + "." + rawBody;
    const signature = crypto.createHmac("sha256", key).update(canonical, "utf8").digest("hex");

## Create checkout
POST /api/connect/v1/checkout-sessions

JSON body:
    {
      "external_reference": "MC-ORDER-10045",
      "amount": "1250.00",
      "currency": "HTG",
      "description": "Wallet top-up / order payment",
      "success_url": "https://your-app.example/payment/complete",
      "expires_in_minutes": 15
    }

The response includes a hosted checkout_url. Redirect the customer to it. The customer signs in and authorizes payment with their own LakayGoPay transaction PIN. Creating the session does not debit a wallet.

Check status:
GET /api/connect/v1/checkout-status?external_reference=MC-ORDER-10045

Credit the partner application's customer account only after the server-to-server status response is paid. Pending, expired, or cancelled must not unlock goods, game coins, subscriptions, or wallet credit.

## Request payout to a LakayGoPay customer
POST /api/connect/v1/payouts

JSON body:
    {
      "external_reference": "MC-WITHDRAW-808",
      "recipient_user_id": "UUID-OF-LAKAYGOPAY-USER",
      "amount": "450.00",
      "currency": "HTG",
      "description": "Marketplace withdrawal"
    }

The recipient receives a pending request inside LakayGoPay. No debit occurs until they sign in and accept with their transaction PIN.

Check status:
GET /api/connect/v1/payouts?external_reference=MC-WITHDRAW-808

## Test checklist
1. Use only a test app approved by the LakayGoPay team.
2. Use a test customer whose internal wallet has test funds.
3. Confirm the merchant, amount and currency before entering PIN.
4. Verify final paid status from your backend before crediting the partner wallet/account.
5. Verify payout remains pending until the user accepts it.
6. A changed request body with a reused Idempotency-Key is rejected.
7. Test expiry and insufficient balance.

Live mode, external rails, webhook delivery, refunds and FX conversion are not enabled in this release.
