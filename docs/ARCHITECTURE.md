# Architecture LakayGoPay — phase fondation

## Couches

1. **Client web / application mobile** : interface et collecte des demandes. Le client ne détient aucune clé privilégiée et ne décide jamais du solde.
2. **Cloudflare Pages Functions** : API serveur. Elle valide le jeton utilisateur auprès de Supabase Auth, valide les données entrantes et appelle les RPC avec `SUPABASE_SECRET_KEY` (`sb_secret_...`) stockée comme secret Cloudflare. La clé secrète est envoyée dans l’en-tête `apikey` au Data API; le jeton Bearer est réservé au JWT de session de l’utilisateur.
3. **Supabase Auth + PostgreSQL** : identités, RLS, profils, portefeuilles, comptes marchands, ledger, demandes et journaux.
4. **Prestataires de paiement** : à intégrer séparément pour les dépôts/retraits MonCash, NatCash, banque ou agents. Aucune intégration réelle n'est activée par ce kit.

## Couverture des dix modules

| Module produit | Tables / composants de fondation |
|---|---|
| Client | `auth.users`, `profiles`, création automatique du portefeuille personnel |
| Marchand | `merchants`, `merchant_members`, `wallets`, RPC d'inscription marchande |
| Bous | `wallets`, vue `wallet_balances` calculée depuis le ledger |
| QR Code | `payment_requests`, RPC de création d'une demande, jeton opaque |
| Ledger | `ledger_transactions`, `ledger_entries`, écritures débit/crédit, blocage UPDATE/DELETE |
| Transactions | `transfers`, `deposit_requests`, `withdrawal_requests` |
| Sécurité | Auth Supabase, vérification de session, OTP hashé, événements de sécurité, idempotence, fonctions serveur |
| Administration | `user_roles`, `withdrawal_approvals`, paramètres plateforme, RLS admin |
| Rapports | vue `admin_daily_ledger_summary` |
| Notifications | `notifications` |

## Règles financières appliquées

- Aucun champ `balance` modifiable n'est stocké dans `wallets`. La vue `wallet_balances` calcule le solde à partir des écritures.
- Un transfert interne poste une seule transaction comptable et deux écritures de même montant : débit du portefeuille source et crédit du portefeuille destinataire.
- La fonction SQL verrouille les deux portefeuilles et vérifie le solde avant d'écrire.
- La clé d'idempotence est réservée dans la même transaction SQL. Une répétition du même appel renvoie la réponse déjà enregistrée au lieu de créer un deuxième transfert.
- Les entrées du ledger et les transactions comptables sont append-only ; les déclencheurs bloquent UPDATE et DELETE.
- Une demande de retrait ne devient pas automatiquement un paiement. La décision de retrait est distincte du règlement effectif.
- Le paramètre initial `withdrawal_two_person_threshold_htg` vaut zéro : deux administrateurs distincts sont donc requis pour toutes les demandes de retrait jusqu'à modification explicite du seuil par un administrateur autorisé.
- Le demandeur d'un retrait ne peut pas approuver son propre retrait.
- Les clés privilégiées `sb_secret_...` sont conservées côté serveur; la clé publishable peut être utilisée par le client.

## Ce qui reste à construire

### Authentification et sécurité de compte

- Écrans d'inscription/connexion connectés à Supabase Auth.
- Confirmation téléphone/e-mail et récupération de compte.
- MFA TOTP avec mécanisme MFA natif Supabase ; ne pas stocker soi-même les secrets TOTP.
- OTP transactionnel via fournisseur SMS/e-mail/WhatsApp, avec expiration, limitation des tentatives et protection anti-abus. Les codes à six chiffres doivent être stockés comme HMAC/hash avec une clé serveur, jamais en clair ni avec un simple hash non salé.
- Limitation des requêtes par utilisateur, IP et appareil, alertes et gestion des sessions/appareils.

### Parcours de paiement

- Endpoint sécurisé pour lire ses portefeuilles et son historique.
- Lecture publique contrôlée d'une demande QR, puis authentification du payeur et confirmation explicite.
- Fonction de règlement serveur qui vérifie la preuve de paiement du prestataire avant de poster un crédit.
- Connecteurs de dépôts/retraits, rapprochement, remboursements et annulations par écritures compensatoires (jamais suppression des écritures initiales).

### Administration et exploitation

- Attribution du premier `super_admin` depuis le SQL Editor après vérification de l'identité du fondateur.
- Interfaces et endpoints RBAC pour les rôles, KYC, revue marchande, fraude, litiges et approbations.
- Journalisation de chaque décision administrative, exports sécurisés, rapprochement quotidien, sauvegardes et procédure d'incident.

## Provision du premier administrateur

Après avoir créé et vérifié le compte du premier administrateur dans Supabase Auth, exécuter une seule fois dans SQL Editor, en remplaçant l'adresse par celle de ce compte :

```sql
insert into public.user_roles (user_id, role)
select id, 'super_admin' from auth.users where email = 'ADRESSE_VERIFIEE_DU_FONDATEUR'
on conflict (user_id, role) do nothing;
```

Ne donne jamais le rôle `super_admin` depuis le navigateur ou une requête utilisateur.
