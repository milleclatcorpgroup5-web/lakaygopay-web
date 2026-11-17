# LakayGoPay — Supabase signup confirmation setup

## Confirmation email template

In Supabase Dashboard, open **Authentication → Email Templates → Confirm signup**. Keep the subject simple, for example:

`Konfime imèl ou — LakayGoPay`

Replace the template body with the Go template in `supabase/confirm-signup-template.html`.

The template branches on the existing `user_metadata.account_type` field:
- `personal`: sends a confirmation link using `{{ .ConfirmationURL }}`. The frontend uses Supabase's existing URL-session detection and returns the user to the app without asking for email/password again.
- `merchant`: sends the six-digit OTP using `{{ .Token }}`. The frontend keeps the email in memory for the current verification screen and calls `supabase.auth.verifyOtp({ email, token, type: "email" })`; the user enters only the code.

Supabase documents `{{ .Data }}`, `{{ .Token }}`, `{{ .ConfirmationURL }}`, conditional Go templates, and the `verifyOtp` email flow in its Email Templates guide.

## Email delivery requirement

Enabling email signups does **not** prove that Supabase can deliver mail to every tester. Supabase's default SMTP is restricted to pre-authorized team email addresses and currently has a low sending limit; public testing requires configuring a custom SMTP provider in **Authentication → SMTP Settings**. Do not disable email confirmations to work around delivery failures.

## Expected test

1. Register a new personal/client email. The signup screen should confirm that a link was sent and should not route the person to the login form. Clicking the link should return them to the app with a signed-in session.
2. Register a new merchant email. The app should show an OTP-only screen; the person enters the six-digit code, without re-entering their email or password.
3. Reusing an already registered email should show an existing-account message rather than pretending a new account was created.
