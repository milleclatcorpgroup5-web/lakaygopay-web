# Changement proposé — LakayGoPay

## Fichiers ajoutés uniquement

- `supabase/migrations/202611140001_financial_core.sql`
- `functions/_shared/supabase.js`
- `functions/api/health.js`
- `functions/api/profile.js`
- `functions/api/wallets.js`
- `functions/api/activity.js`
- `functions/api/notifications.js`
- `functions/api/transfers.js`
- `functions/api/merchant/register.js`
- `functions/api/payment-requests.js`
- `docs/ARCHITECTURE.md`
- `docs/TEST_PLAN.md`
- `INSTALLATION.md`
- `.env.example`

Aucun fichier existant dans `public/` n'est remplacé par ce kit. Le frontend actuel reste donc inchangé et continue d'afficher sa démonstration tant qu'il n'est pas explicitement raccordé à l'API.

## Contrôles effectués ici

- Vérification de syntaxe JavaScript des Pages Functions avec Node.js.
- Smoke tests simulés : endpoint santé, refus sans session, transfert API avec utilisateur simulé, lecture de portefeuille via session et usage de la nouvelle clé secrète dans `apikey`.
- Vérification manuelle des protections essentielles du SQL : RLS, privilèges RPC limités, append-only, idempotence, écritures équilibrées et verrouillage des portefeuilles.

La migration SQL n'a pas encore été exécutée dans un vrai projet Supabase : elle doit être appliquée puis testée sur ton environnement avant tout déploiement réel.
