# LakayGoPay — kit de fondation financière

Ce kit ajoute une première fondation backend à l'application web existante, sans remplacer `public/index.html`, `public/app.js` ou `public/styles.css`.

## Ce que contient ce kit

- `supabase/migrations/202611140001_financial_core.sql` : modèle de données, RLS, wallets, ledger double entrée append-only, transferts atomiques avec idempotence, comptes marchands, demandes QR, dépôts/retraits en attente, approbations à deux personnes, sécurité, notifications et rapport journalier.
- `functions/` : Cloudflare Pages Functions pour vérifier une session Supabase côté serveur et appeler les fonctions financières avec la clé `service_role` conservée côté serveur.
- `docs/ARCHITECTURE.md` : architecture et limites de la première phase.
- `docs/TEST_PLAN.md` : contrôles à exécuter avant tout pilote.

## Déploiement prudent — dans cet ordre

### 1. Créer le projet Supabase

Dans Supabase, crée un projet neuf nommé `LakayGoPay`. Garde le mot de passe de base de données dans un gestionnaire de mots de passe. Cette migration suppose un projet Supabase neuf ou un schéma `public` dans lequel ces noms de tables et de fonctions ne sont pas déjà utilisés.

### 2. Appliquer la migration

Dans Supabase : **SQL Editor → New query**. Ouvre le fichier `supabase/migrations/202611140001_financial_core.sql`, copie tout son contenu dans l'éditeur puis exécute-le.

Vérifie qu'il n'y a aucune erreur. Ne colle jamais une clé secrète dans le code du navigateur ou dans un dépôt public.

### 3. Configurer les secrets Cloudflare Pages

Dans le projet Cloudflare Pages qui sert LakayGoPay, ouvre **Settings → Variables and Secrets** et ajoute :

| Nom | Type | Valeur |
|---|---|---|
| `SUPABASE_URL` | Variable | URL du projet Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | Variable | clé publique `sb_publishable_...` du projet |
| `SUPABASE_SECRET_KEY` | Secret chiffré | clé privée `sb_secret_...` du projet |

La clé `sb_secret_...` doit rester exclusivement dans les secrets Cloudflare. Ne la mets jamais dans `public/`, Expo, HTML, JavaScript client, GitHub ou une capture d'écran. Le code accepte aussi les anciennes variables `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` pour faciliter une migration, mais privilégie les nouvelles clés. Supabase recommande désormais les clés publishable/secret et prévoit la dépréciation des anciennes clés anon/service_role d’ici la fin 2026.

### 4. Déployer les Pages Functions

Place le dossier `functions/` à la racine du dépôt, au même niveau que `public/`, et le dossier `supabase/` à la racine. Dans Cloudflare Pages, le répertoire de sortie reste `public` et la commande de build reste vide pour ce site statique.

Après le déploiement, teste `GET /api/health`. Le résultat attendu est un JSON indiquant `status: ok` et `mode: internal-ledger-only`. Cette route effectue une vérification de connexion au Data API Supabase.

### 5. Routes de lecture

Les routes suivantes vérifient d'abord le JWT de session et appliquent ensuite les politiques RLS de l'utilisateur :

| Route | Utilité |
|---|---|
| `GET /api/profile` | Profil personnel |
| `GET /api/wallets` | Portefeuilles et soldes calculés depuis le ledger |
| `GET /api/activity` | Derniers transferts, dépôts et retraits visibles |
| `GET /api/notifications` | Notifications du compte |
| `GET /api/health` | Connectivité API / Supabase |

### 6. Tester les parcours API

Tous les endpoints qui modifient des données exigent un jeton `Bearer` fourni par Supabase Auth. Les requêtes de création/transfert exigent aussi un en-tête `Idempotency-Key` unique (8 à 128 caractères).

**Transfert interne** — `POST /api/transfers`

```json
{
  "sender_wallet_id": "UUID_DU_PORTEFEUILLE_EMETTEUR",
  "recipient_wallet_id": "UUID_DU_PORTEFEUILLE_DESTINATAIRE",
  "amount": "125.00",
  "note": "Test interne"
}
```

**Inscription marchande** — `POST /api/merchant/register`

```json
{
  "business_name": "Boutique Démo",
  "business_type": "sole_proprietor",
  "category": "commerce",
  "contact_phone": "+50900000000"
}
```

Valeurs admises pour `business_type` : `sole_proprietor`, `company`, `cooperative`, `nonprofit`, `other`.

**Créer une demande de paiement QR** — `POST /api/payment-requests`

```json
{
  "merchant_id": "UUID_DU_MARCHAND",
  "amount": "250.00",
  "description": "Commande démo",
  "expires_in_minutes": 30
}
```

Pour chaque requête, fournir les en-têtes `Authorization: Bearer <access_token>` et `Idempotency-Key: <clé-unique>`, ainsi que `Content-Type: application/json`.

## Important : état réel des fonctionnalités

Cette livraison est une **fondation technique**, pas une application de paiement prête à manipuler de l'argent réel.

- L'inscription Supabase crée un profil et un portefeuille vide ; aucun fonds n'est crédité.
- Le transfert est un mouvement interne entre deux portefeuilles LakayGoPay déjà provisionnés et suffisamment approvisionnés dans le ledger.
- Il n'existe pas encore de route publique de dépôt ou de retrait. Les tables sont préparées, mais un prestataire agréé, une vérification du règlement, des contrôles de conformité et des validations opérationnelles sont indispensables.
- Le QR généré désigne une demande de paiement. Il n'est ni un reçu ni une confirmation de règlement.
- Le frontend existant reste en mode démonstration et n'est pas encore relié à ces endpoints.
- OTP/SMS/WhatsApp, MFA natif Supabase, limites/rate limiting, alertes anti-fraude, support opérationnel et notifications push doivent être connectés et testés avant un pilote.

Ne traite jamais un statut `paid` comme fiable s'il provient du navigateur. Seul un backend de règlement de confiance, vérifiant la confirmation du prestataire, pourra poster les écritures correspondantes.
