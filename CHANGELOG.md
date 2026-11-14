# Changelog — LakayGoPay Web V2

## Interface and navigation
- Reorganized the application into a responsive dashboard with dedicated areas for wallet, transfers, QR payment preview, incoming payment requests, activity, beneficiaries, merchant tools, notifications, security, settings and help.
- Added mobile navigation, responsive layouts, accessible form labels, focus states and reduced-motion support.
- Replaced the old decorative demo dashboard with a consistent design system.

## Demo interactions
- Local transfer simulation with a review modal and validation of 1–500,000 HTG.
- Local payment-request creation and manual test-code verification.
- Optional camera QR reading when supported by the browser; scanning never initiates payment.
- Beneficiary management stored locally on the current device.
- Search/filter activity history and export to CSV.
- Read/unread notification state and editable local profile/language preferences.

## Platform
- Added French, Haitian Creole and English labels.
- Added PWA manifest, SVG app icon and a service worker for static offline access.
- Added safer HTML output encoding for user-provided text.

## Not included
- Supabase auth/database integration, real wallets, production QR encoding, MonCash/NatCash integrations, OTP delivery, payment processing, KYC, admin authorization or live financial operations.
