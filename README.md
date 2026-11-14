# LakayGoPay Web — prototype déployable

Ce dépôt contient une interface web responsive en HTML, CSS et JavaScript, prête pour un premier déploiement Cloudflare Pages.

## Déploiement Cloudflare Pages
- Framework preset : **None**
- Build command : **laisser vide**
- Build output directory : **public**
- Root directory : **laisser vide** (racine du dépôt)

Le site sert `public/index.html`.

## Contenu actuel
- Tableau de bord responsive
- Navigation : vue d'ensemble, envoyer, recevoir/QR, activité, espace marchand, paramètres
- Interface en français, créole haïtien et anglais
- Parcours de transfert simulé avec montant plafonné à 500 000 HTG dans l'interface
- Historique de démonstration en mémoire de navigateur

## Limites importantes
Ceci est un **prototype d'interface**, pas une application financière prête pour la production.
- Aucun compte réel, aucune authentification sécurisée, aucune base de données.
- Les transactions sont fictives et disparaissent au rechargement.
- Le QR est décoratif et ne permet pas d'encaisser.
- Aucun dépôt, retrait, paiement ou transfert réel n'est exécuté.
- Ne jamais ajouter de clés secrètes dans le navigateur.
- Avant tout pilote avec de vrais utilisateurs ou fonds : backend sécurisé, authentification, autorisations côté serveur, journal comptable append-only, idempotence, audit, conformité/KYC/AML et partenaire de paiement agréé.

## Structure
- `public/index.html` : interface
- `public/styles.css` : styles responsive
- `public/app.js` : interactions de démonstration
