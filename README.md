# LakayGoPay Mobile

Premye baz aplikasyon mobil LakayGoPay ak Expo / React Native.

## Sa ki ladan l
- Estrikti Expo Router.
- Premye ekran mobil demonstrasyon.
- Konfigirasyon EAS Build.
- GitHub Actions workflow ki lanse yon build preview Android + iOS lè gen push sou `main`.

## Enpòtan anvan premye build la
1. Konekte pwojè a ak kont Expo ki posede pwojè `lakaygopay` la.
2. Mete vrè Expo Project ID a nan `app.json` (ranplase `${EXPO_PROJECT_ID}` ak ID a).
3. Nan GitHub repository la, ale nan **Settings → Secrets and variables → Actions** epi kreye:
   - `EXPO_TOKEN`: token Expo kont pwopriyetè pwojè a.
   - `EXPO_PROJECT_ID`: Project ID Expo a.
4. Verifye `bundleIdentifier` iOS ak `package` Android yo disponib pou aplikasyon an.

## Kòman automatisation an mache
Chak push sou branch `main`, oswa yon demaraj manyèl nan tab Actions, lanse `eas build --platform all --profile preview`.

## Sekirite / limit
Sa a se yon baz aplikasyon pou devlopman, li pa yon sèvis peman ki pare pou pwodiksyon.
Pa gen depo, retrè, transfè, entegrasyon MonCash/NatCash, oswa lajan reyèl ladan l.
Tout fonksyon peman reyèl dwe rete dezaktive jiskaske kondisyon regilasyon, patnè finansye, sekirite ak konfòmite yo verifye.

## Kòmand lokal
- `npm install`
- `npx expo start`
- `npx expo-doctor`
