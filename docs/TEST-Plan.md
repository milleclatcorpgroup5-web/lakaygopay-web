# Plan de vérification — avant tout pilote

## Installation / sécurité

- [ ] Migration appliquée sans erreur sur un projet Supabase de test.
- [ ] Les tables sensibles ont RLS activé.
- [ ] Un utilisateur A ne peut lire ni modifier le profil, le portefeuille, les demandes ou les notifications de l'utilisateur B.
- [ ] Un client `anon` ne peut lire aucune donnée privée.
- [ ] Un utilisateur connecté ne peut pas insérer, modifier ou supprimer directement des écritures comptables.
- [ ] La clé `service_role` n'apparaît ni dans les fichiers `public/`, ni dans l'application mobile, ni dans le dépôt Git.
- [ ] Les endpoints refusent les jetons absents, expirés ou invalides.

## Ledger et transferts

- [ ] Un portefeuille personnel est créé automatiquement à l'inscription et commence à zéro.
- [ ] Un transfert sans solde suffisant est refusé sans créer de transaction ni d'écriture.
- [ ] Un transfert valide crée exactement deux écritures équilibrées : un débit et un crédit du même montant.
- [ ] Le solde est calculé depuis les écritures et non depuis un champ modifiable.
- [ ] Deux requêtes simultanées avec la même clé d'idempotence ne créent qu'un seul transfert.
- [ ] Un UPDATE ou DELETE direct sur `ledger_entries` ou `ledger_transactions` échoue.
- [ ] Le destinataire ne peut pas être le même portefeuille que l'émetteur.

## Marchand et QR

- [ ] Une inscription marchande crée un marchand en statut `pending`, un membre `owner` et un portefeuille marchand vide.
- [ ] Un utilisateur qui n'est pas membre ne peut pas créer de demande QR pour ce marchand.
- [ ] La clé d'idempotence évite les demandes QR dupliquées.
- [ ] Le QR est traité comme une demande, jamais comme une preuve de règlement.
- [ ] Une demande expirée ou annulée ne peut pas être réglée.

## Retraits et administration

- [ ] Le demandeur ne peut pas approuver son propre retrait.
- [ ] Deux approbations provenant du même administrateur ne comptent pas comme deux personnes.
- [ ] Avec le seuil initial à zéro, un seul accord laisse le retrait `awaiting_second_approval`.
- [ ] Deux administrateurs distincts autorisés peuvent porter le retrait à `approved`.
- [ ] Un rejet rend le retrait `rejected`.
- [ ] Aucun statut `approved` ne déclenche à lui seul un paiement fournisseur.

## Avant le vrai argent

- [ ] Revue indépendante du code et des politiques RLS.
- [ ] Tests de charge et de concurrence.
- [ ] Rate limiting et protection anti-automatisation.
- [ ] Confirmation du prestataire et rapprochement de bout en bout.
- [ ] Contrôles KYC/AML, protection des données et obligations réglementaires validés avec des professionnels compétents.
- [ ] Sauvegarde/restauration, surveillance, alertes et procédure de réponse aux incidents testées.
