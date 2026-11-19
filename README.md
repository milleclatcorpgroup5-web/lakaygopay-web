# LakayGoPay — application web

LakayGoPay est une application mobile-first hébergée sur Cloudflare Pages, avec Supabase Auth et PostgreSQL. Le dépôt contient l'interface publique, les Pages Functions (API serveur), le centre d'administration et les migrations SQL.

## Déploiement Cloudflare Pages

- Framework preset : `None`
- Root directory : racine du dépôt
- Build command : laisser vide
- Build output directory : `public`
- Conserver le dossier `functions/` à la racine du dépôt, en dehors de `public/`.

Le projet doit être connecté au dépôt GitHub pour que Cloudflare Pages publie aussi les Pages Functions. Les variables et secrets doivent être définis dans les paramètres Cloudflare de l'environnement Production et des environnements Preview concernés.

## Configuration serveur requise

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` ou `SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY` ou `SUPABASE_SERVICE_ROLE_KEY`

Selon les fonctions activées, des secrets supplémentaires peuvent être nécessaires, par exemple `WITHDRAWAL_DATA_KEY`. Les clés secrètes doivent rester dans les variables serveur Cloudflare; elles ne doivent jamais être ajoutées au code du navigateur, au dépôt ou à un fichier public.

## Espaces et parcours

### Client
- Création de compte et connexion Supabase Auth.
- Portefeuilles séparés HTG, USD et EUR.
- Historique des transferts, paiements QR, dépôts et demandes de retrait.
- Transferts internes protégés par PIN transactionnel de 4 chiffres et clé d'idempotence.
- Paiement QR interne après vérification du commerçant, du montant, de la devise et du PIN.
- Paramètres du profil et gestion du PIN.

### Marchand
- Inscription avec création du profil marchand.
- Activation soumise à la revue d'un administrateur autorisé.
- Création de demandes de paiement QR HTG après activation.
- Consultation des paiements reçus.

### Agent
- Un utilisateur connecté peut soumettre une demande pour devenir agent.
- Il peut consulter le statut de sa demande et le code de son compte agent après approbation.
- L'approbation est traitée par l'administration et journalisée.
- **Le rôle agent ne déclenche pas, à lui seul, des opérations de cash-in/cash-out.** Les flux de caisse, le règlement des agents et les intégrations de paiement externe ne sont pas activés.

### Administration
- Centre de contrôle séparé à `/admin/`.
- Vérification du rôle côté serveur, PIN Admin à 6 chiffres et MFA TOTP/AAL2 pour les modules protégés.
- Gestion des rôles, utilisateurs, marchands, agents, retraits et journaux d'audit, selon les permissions du rôle.
- Révision des demandes d'agent et de marchand.
- Contrôle des plafonds de carte, classement et niveau d'étoiles.
- Rapports opérationnels, contrôles d'intégrité et rapports financiers en lecture seule lorsque le rôle l'autorise.

### Programme LakayGo Card
Le classement dépend du plafond HTG évalué et approuvé par l'équipe habilitée, pas du solde courant du portefeuille et pas d'un choix libre du client.

| Classe | Plafond HTG |
|---|---:|
| LakayGo Basic | 0 à 999 999,99 |
| LakayGo Mwayèn | 1 000 000 à 29 999 999,99 |
| LakayGo Gold | 30 000 000 à 100 000 000 |
| LakayGo Elite Gold | Plus de 100 000 000 |

Chaque classe possède trois niveaux d'étoiles. Les demandes d'intérêt sont associées au classement assigné par le système. Les plages sont définies dans la migration `202611190001_lakaygo_card_limits_and_stars.sql`.

**L'émission de cartes virtuelles ou physiques reste désactivée.** Une demande ou un classement ne signifie pas qu'une carte est émise, financée ou utilisable. L'émission nécessite un émetteur/partenaire autorisé, les validations réglementaires et les tests de sécurité correspondants.

## Mode financier et limites actuelles

L'application utilise un ledger interne à double entrée pour les opérations internes prises en charge. Les contrôles serveur, les permissions RPC, les clés d'idempotence et les audits font partie de la conception.

Les éléments suivants restent volontairement désactivés :
- Dépôts et retraits réels.
- Règlement réel via MonCash, NatCash ou banque.
- Cash-in/cash-out par agents.
- Conversion et transfert FX réels entre HTG, USD et EUR.
- Émission et paiement par carte.
- Paiements externes en argent réel.

LakayGoPay Connect est en mode Sandbox. Une approbation d'application partenaire ne permet pas de traiter de vrais fonds.

## Migrations et base Production

Les migrations dans `superbase/migrations/` sont versionnées. Avant d'exécuter une migration sur Production :
1. Vérifier le projet Supabase cible.
2. Comparer le schéma existant et confirmer que la migration n'a pas déjà été appliquée.
3. Lire intégralement le fichier et ses dépendances.
4. Ne jamais rejouer une ancienne migration de fondation ou de backend sur une base Production déjà en service.
5. Exécuter ensuite les requêtes de vérification en lecture seule correspondantes.

La migration `202611190003_production_transfer_rpc_audit.sql` est une migration de correction Production spécifique. Elle ne remplace pas la fonction existante `public.transfer_funds`.

## Validation avant ouverture à plus grande échelle

- Vérifier `/api/health` et `/api/config`.
- Depuis le Centre Admin, exécuter le contrôle de santé et examiner chaque avertissement/erreur.
- Tester séparément un compte client, un compte marchand, un compte agent et les différents rôles administratifs.
- Vérifier les accès refusés lorsqu'un utilisateur ne possède pas le rôle requis.
- Vérifier les classements de carte aux bornes exactes des plages.
- Utiliser un environnement de test ou des comptes de test séparés pour les opérations de ledger. Ne pas utiliser un solde Production existant comme fonds de test.
- Pour les transferts, vérifier le débit/crédit correspondant, l'équilibre du ledger, l'audit et le comportement idempotent.
- Conserver les rails de paiement externes et l'émission de cartes désactivés tant que les partenaires, autorisations, rapprochements et contrôles nécessaires ne sont pas validés.

Tests actuellement présents :
- `node --experimental-default-type=module --test tests/transfers.test.mjs`

L'existence d'un build Cloudflare réussi ne prouve pas à elle seule que tous les parcours utilisateur et les opérations de base de données sont validés.
