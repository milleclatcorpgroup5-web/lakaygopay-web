# LakayGoPay — sécurité et prochain chantier backend

Cette interface doit rester en démonstration tant que les contrôles ci-dessous ne sont pas implémentés et testés côté serveur.

1. **Identité et accès** : Supabase Auth, confirmation des e-mails/téléphones selon le parcours retenu, MFA, sessions, réinitialisation sécurisée et rôles contrôlés côté serveur.
2. **RLS** : politiques PostgreSQL restrictives sur chaque table; un utilisateur ne peut lire/modifier que ses propres ressources; les opérations privilégiées passent par des fonctions serveur.
3. **Comptabilité** : ledger double entrée append-only; interdiction UPDATE/DELETE pour l'application; chaque écriture possède un identifiant, une devise, un type, un statut, une référence métier et un horodatage.
4. **Solde** : calculé à partir du ledger ou de vues/agrégats contrôlés et réconciliés; jamais accepté depuis le navigateur.
5. **Idempotence** : clé unique générée côté client pour chaque intention, contrainte unique en base et réponse stable lors des répétitions.
6. **Retraits à risque** : seuil paramétrable, mise en attente, approbation de deux administrateurs distincts, interdiction qu'un auteur approuve sa propre demande, audit de chaque décision.
7. **QR** : QR signé ou jeton opaque à durée courte, audience et montant liés côté serveur, anti-rejeu, expiration, consommation atomique et aucune confiance accordée au contenu du navigateur.
8. **Partenaires** : intégrer MonCash, NatCash ou tout autre partenaire uniquement via contrat, documentation officielle, clés serveur et environnement de test approuvé.
9. **Audit et résilience** : journal append-only, alertes, sauvegardes chiffrées, tests de restauration, limitation de débit, détection d'abus et procédure d'incident.
10. **Validation** : tests unitaires, tests RLS avec plusieurs rôles, tests de concurrence/idempotence, analyse de sécurité indépendante et avis juridique/conformité local avant tout fonds réel.

## Ordre recommandé
- Phase A : base Supabase + Auth + profils + rôles + RLS.
- Phase B : ledger en environnement de test + idempotence + tests automatisés.
- Phase C : espace utilisateur/marchand relié à des données de test non monétaires.
- Phase D : QR de paiement sécurisé et workflow d'approbation administratif.
- Phase E : intégration fournisseur agréé et pilote limité, uniquement après validations requises.
