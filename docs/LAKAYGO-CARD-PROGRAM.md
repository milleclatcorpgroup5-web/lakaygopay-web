# LakayGo Card — programme fondation

## Product classes

- **LakayGo Basic** — tier de base.
- **LakayGo Standard** — tier intermédiaire.
- **LakayGo Gold** — tier premium.

L'application client affiche les trois niveaux et permet à un utilisateur actif connecté de déclarer son intérêt pour une carte virtuelle, une carte physique ou les deux. Il s'agit uniquement d'une préinscription sur liste d'attente.

## Limites de sécurité actuelles

- L'émission est désactivée pour les trois niveaux (issuance_enabled = false).
- L'API client lit le catalogue et crée au plus une demande active par utilisateur.
- Elle ne peut ni émettre, activer, facturer, approvisionner, bloquer ni autoriser une transaction par carte.
- LakayGoPay ne stocke aucun PAN complet, CVV/CVC, PIN de carte ou OTP.
- La future table card_instruments est limitée à une référence/token du prestataire, aux quatre derniers chiffres, au réseau, à l'expiration et au statut.
- Aucun contrat Visa, Mastercard, MonCash, NatCash, banque ou processeur n'est intégré par cette modification.
- Les frais, limites, critères d'éligibilité, partenaire émetteur et devise de carte ne sont pas inventés; ils devront être validés après les démarches juridiques et le choix du partenaire.

## Modèle de données

- card_program_tiers : catalogue produit, disponibilité et futur interrupteur d'émission.
- card_applications : demandes d'intérêt et workflow de revue; une seule demande ouverte par utilisateur.
- card_instruments : référence tokenisée du prestataire et métadonnées masquées uniquement.

Les trois tables ont RLS activé et aucun droit direct pour anon ou authenticated. L'accès passe par le serveur. L'API vérifie requireUser et limite chaque lecture d'application à l'identifiant utilisateur authentifié.

## Mise en service et vérification

1. Examiner superbase/migrations/202611180004_lakaygo_card_program_foundation.sql.
2. Appliquer manuellement cette migration au projet Supabase choisi, après vérification de son schéma.
3. Exécuter superbase/tests/verify-card-program.sql.
4. Vérifier GET /api/cards avec un compte actif connecté.
5. Soumettre une demande de test et confirmer qu'elle n'est visible que pour cet utilisateur.
6. Confirmer que les soumissions répétées renvoient la demande ouverte au lieu d'en créer plusieurs.
7. Confirmer que issuance_enabled reste false pour les trois niveaux et qu'aucune donnée sensible de carte n'est exposée.

Le fichier SQL est ajouté au dépôt; il n'est pas exécuté automatiquement contre Supabase Production.
