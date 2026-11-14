# LakayGoPay — interface web V2

Cette livraison améliore l'interface du dépôt `lakaygopay-web` en une expérience mobile-first, trilingue et installable (PWA).

## Déploiement Cloudflare Pages
- Framework preset : `None`
- Build command : laisser vide
- Build output directory : `public`
- Root directory : racine du dépôt

## Ce qui est inclus
- Tableau de bord modernisé, portefeuille, transfert de démonstration, paiement QR en aperçu et demandes de paiement.
- Historique filtrable avec export CSV.
- Gestion locale des bénéficiaires.
- Espace marchand, notifications, sécurité, paramètres et aide.
- Français, kreyòl ayisyen et anglais.
- Affichage mobile/tablette/ordinateur, mode installable PWA et cache hors ligne de l'interface.
- Données de démonstration conservées localement sur l'appareil.

## Limites à ne pas confondre
Cette V2 reste une **interface de démonstration**. Elle n'est pas une banque, un portefeuille réel ou une application financière prête pour la production.
- Aucun compte utilisateur réel ni authentification Supabase n'est connecté.
- Les transactions, demandes et contacts sont conservés dans `localStorage` sur l'appareil uniquement.
- Le code QR présenté est décoratif; le seul code manuel `LGP-DEMO-0001` est un code de test.
- Le scanner utilise `BarcodeDetector` lorsque le navigateur le prend en charge, mais il ne déclenche aucun paiement.
- Aucun dépôt, retrait, paiement ou transfert d'argent réel n'est effectué.
- Aucun secret, clé privée, clé de service ou mot de passe ne doit être placé dans le navigateur.

## Avant toute activation réelle
1. Connecter Supabase Auth avec politiques RLS testées et rôles serveur.
2. Construire un ledger comptable append-only; les soldes doivent être calculés côté serveur à partir des écritures.
3. Ajouter l'idempotence sur toutes les opérations monétaires et des clés uniques côté base de données.
4. Imposer l'approbation de deux administrateurs distincts pour les retraits à risque/au-dessus du seuil défini.
5. Ajouter OTP/MFA, journal d'audit inviolable, alertes, sauvegardes et tests de sécurité.
6. Obtenir les accords des partenaires de paiement et réaliser les vérifications légales/réglementaires applicables en Haïti.
7. Effectuer des tests indépendants avant toute utilisation avec de vrais fonds.

MonCash et NatCash ne sont pas présentés comme inexistants; une éventuelle intégration dépendra de leurs conditions d'accès, d'un accord et des validations nécessaires.

## Installation
Remplacer le contenu du dossier `public/` dans le dépôt Cloudflare Pages par le contenu `public/` de cette archive, après avoir sauvegardé l'ancienne version. Aucun fichier du dépôt d'origine n'a été modifié par cette livraison.
