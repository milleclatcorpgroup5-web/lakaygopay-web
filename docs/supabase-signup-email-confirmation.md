# LakayGoPay — Supabase signup confirmation setup

## Confirmation email template

In Supabase Dashboard, open **Authentication → Email Templates → Confirm signup**. Keep the subject simple, for example:

`Konfime imèl ou — LakayGoPay`

Replace the template body with the Go template in `supabase/confirm-signup-template.html`.

The template branches on the existing `user_metadata.account_type` field to personalize the message, but **both personal/client and merchant accounts receive a six-digit OTP** via `{{ .Token }}`. Neither role receives a confirmation link. The frontend presents the matching code-entry screen and verifies the code using:

```js
supabase.auth.verifyOtp({ email, token, type: "email" })
```

The frontend resends signup confirmation with:

```js
supabase.auth.resend({ type: "signup", email })
```

Supabase's hosted email OTP uses a project-level length setting with a supported range of 6–10 digits; the standard template token is six digits. A four-digit client code and six-digit merchant code cannot be configured separately using the built-in Supabase signup OTP. A four-digit variant would require a separate custom OTP implementation and additional storage, expiry, rate-limit, replay-protection, and delivery logic. This project intentionally uses six digits for both roles to keep the verification flow within Supabase Auth.

## Email delivery requirement

Changing a confirmation link to a code changes the verification experience; it does **not** repair SMTP delivery. Enabling email signups does **not** prove that Supabase can deliver mail to every tester. Supabase's default SMTP is restricted to pre-authorized team email addresses and is not intended for public production delivery. Public testing requires a working custom SMTP provider in **Authentication → SMTP Settings**. Confirm the Production Site URL and redirect allow-list are configured for LakayGoPay. Do not disable email confirmations to work around delivery failures.

The Supabase Dashboard template must also be updated manually: copy the content of `supabase/confirm-signup-template.html` into **Authentication → Email Templates → Confirm signup**, then save it. Updating the file in GitHub does not automatically update the template stored in Supabase.

## What the current System Health result proves

The public Auth settings endpoint can confirm that email signups are enabled and whether email confirmation is required. It cannot verify SMTP delivery. A successful `AUTH_REACHABLE` check is therefore not proof that a confirmation email can reach an arbitrary tester.

## Expected test

1. Register a new personal/client email. The signup screen should show the six-digit code form. Entering the correct code should verify the email and establish the session without entering the email or password again.
2. Register a new merchant email. The signup screen should show the six-digit OTP form. Entering the correct code should verify the email and establish the session without entering the email or password again.
3. For each role, test a wrong code, expired code, and resend. A wrong or expired code must not create a session.
4. Reusing an already registered email should show an existing-account message rather than pretending a new account was created.
