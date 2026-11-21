# LakayGoPay — PIN-first signup without email OTP

## Production Supabase setting required

The current beta signup flow expects a customer or merchant to enter an email, password, and four-digit transaction PIN in one form. Supabase must return an authenticated session immediately so the app can save the PIN and open the dashboard without an email confirmation code.

In Supabase Dashboard, open **Authentication → Sign In / Providers → Email** (the exact menu label may vary) and turn **Confirm email** OFF. Save the setting.

The app still uses the standard Supabase Auth signup endpoint. It does not use the service-role key to create customer accounts or silently confirm existing accounts. If email confirmation remains enabled, Supabase may create an unconfirmed pending account but will not return a session; the app will stop with a configuration message rather than asking for a six-digit code. Turn Confirm email OFF before inviting people to register. Do not repeatedly submit the same email while the setting is still enabled.

## Expected signup behavior

1. Customer or merchant fills in profile details, email, password, and matching four-digit PIN.
2. Supabase creates the account with email auto-confirmation and returns a session immediately.
3. The browser establishes that session and calls the authenticated PIN setup endpoint.
4. The PIN is stored using the existing server-side PBKDF2 process.
5. The user enters the dashboard without a six-digit email confirmation code.

## Important security trade-off

Disabling email confirmation means the app no longer proves that a new user controls the email address they typed. The password and transaction PIN protect account access and transaction authorization, but neither verifies ownership of that email inbox. Keep account recovery and any future payout/real-money capabilities subject to additional identity and security controls. Re-enable email confirmation when the beta is stable and the product is ready for it.

## Legacy pending accounts

Accounts created before this change may still be waiting for email confirmation. This change does not silently confirm or delete existing accounts. Review pending accounts separately; do not delete customer records as part of this deployment.

## Email template

A six-digit OTP template is not used by the new signup path. The file \`supabase/confirm-signup-template.html\` may remain in the repository for a future reactivation, but it is not part of the current signup experience.
