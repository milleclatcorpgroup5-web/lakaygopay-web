(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORAGE_KEY = 'lakaygopay_demo_v2';
  const DEMO_QR_CODE = 'LGP-DEMO-0001';
  const viewKeys = {overview:'overview',wallet:'myWallet',transfer:'transfer',pay:'pay',receive:'receive',activity:'activity',beneficiaries:'beneficiaries',merchant:'merchant',notifications:'notifications',security:'security',settings:'settings',help:'help'};
  const titleFallback = {overview:'Vue d’ensemble',wallet:'Mon portefeuille',transfer:'Transfert',pay:'Payer par QR',receive:'Recevoir',activity:'Historique',beneficiaries:'Bénéficiaires',merchant:'Espace marchand',notifications:'Notifications',security:'Sécurité',settings:'Paramètres',help:'Aide & assistance'};
  const translations = {
    fr: {
      workspace:'ESPACE PERSONNEL',demoAccount:'Compte de démonstration',mainMenu:'MENU PRINCIPAL',overview:'Vue d’ensemble',myWallet:'Mon portefeuille',transfer:'Transfert',pay:'Payer par QR',receive:'Recevoir',activity:'Historique',manage:'GESTION',beneficiaries:'Bénéficiaires',merchant:'Espace marchand',notifications:'Notifications',account:'COMPTE',security:'Sécurité',settings:'Paramètres',help:'Aide & assistance',securityFirst:'La sécurité d’abord',securityCaption:'Prototype sans argent réel',welcomeBack:'BON RETOUR',demoMode:'Mode démo',language:'Langue',personalAccount:'Compte personnel',prototypeTitle:'Version prototype — aucune opération réelle',prototypeText:'Les comptes, soldes, QR codes et transactions ci-dessous sont des exemples locaux. Aucun dépôt, retrait ou transfert d’argent n’est exécuté.',yourMoneySpace:'VOTRE ESPACE FINANCIER',hello:'Bonjour',welcomeSubtitle:'Gérez vos opérations de démonstration depuis un seul endroit.',totalBalance:'Solde total du portefeuille',demoBalance:'Solde de démonstration',sendMoney:'Envoyer',receiveMoney:'Recevoir',details:'Détails',shortcuts:'RACCOURCIS',quickActions:'Actions rapides',send:'Envoyer',sendDesc:'Faire un transfert',scanQr:'Scanner QR',scanDesc:'Payer un marchand',collect:'Encaisser',receiveDesc:'Créer une demande',contacts:'Contacts',contactsDesc:'Gérer les favoris',incoming:'Entrées simulées',outgoing:'Sorties simulées',periodToday:'Aujourd’hui',transactions:'Transactions',sinceStart:'Depuis le début',savedContacts:'Contacts enregistrés',overviewActivity:'VOTRE ACTIVITÉ',recentTransactions:'Transactions récentes',viewAll:'Tout voir →',emptyTransactions:'Aucune transaction pour le moment.',accountStatus:'ÉTAT DU COMPTE',readiness:'Préparation du compte',setupProgress:'Configuration initiale',backendPending:'Backend et vérification à connecter',interfaceReady:'Interface prête',interfaceReadyText:'Navigation et écrans de démonstration',secureAuth:'Authentification sécurisée',notConnected:'Pas encore connectée',financialCore:'Moteur financier',trustHeadline:'La confiance commence par la transparence.',trustText:'LakayGoPay est en phase de préparation. Les fonctionnalités financières resteront désactivées tant que la sécurité, le backend et les partenaires réglementés ne seront pas validés.',learnSecurity:'Voir la sécurité →',walletOverview:'PORTEFEUILLE',walletSubtitle:'Consultez vos soldes de démonstration et les options prévues.',mainWallet:'Portefeuille principal',currencyDemo:'Solde illustratif uniquement.',comingSoon:'À venir',currencyLater:'Conversion et multi-devises non activées.',walletActions:'OPTIONS',plannedOperations:'Opérations prévues',deposit:'Dépôt',providerRequired:'Partenaire requis',notAvailable:'Non disponible',withdraw:'Retrait',demoOnly:'Simulation seulement',tryDemo:'Essayer la démo',sendFunds:'ENVOI DE FONDS',sendMoneyTitle:'Envoyer de l’argent',transferSubtitle:'Testez le parcours de transfert avec des données fictives.',recipientDetails:'Informations du bénéficiaire',recipientHint:'Choisissez un contact ou entrez son identifiant.',recipientPhone:'Téléphone ou identifiant',transferDetails:'Détails du transfert',amountHint:'Montant en gourdes haïtiennes.',amountHtg:'Montant (HTG)',transferNote:'Motif (facultatif)',transferDemoNotice:'La validation créera uniquement une ligne de démonstration sur cet appareil. Le solde et l’argent réel ne bougeront pas.',reviewTransfer:'Vérifier la simulation',summary:'RÉCAPITULATIF',transferSummary:'Votre transfert',readyToSend:'Prêt à commencer ?',summaryHint:'Les détails du transfert apparaîtront ici avant la simulation.',transferFee:'Frais de transfert',total:'Total',feeFuture:'Les frais seront définis avec le partenaire de paiement.',qrPayments:'PAIEMENT QR',scanPay:'Scanner et payer',scanSubtitle:'La lecture QR est en mode aperçu. Aucun paiement ne sera envoyé.',scanMerchantQr:'Scanner le QR du marchand',cameraPermission:'Autorisez l’appareil photo pour tester la lecture si votre navigateur le permet.',cameraOff:'Caméra désactivée',cameraOffHint:'Démarrez la caméra ou saisissez un code de test.',startCamera:'Activer la caméra',stopCamera:'Arrêter',manualEntry:'SAISIE MANUELLE',enterPaymentCode:'Entrer un code de paiement',manualHint:'Pour la démonstration, utilisez le code ci-dessous.',paymentCode:'Code marchand',checkCode:'Vérifier le code',sampleCode:'CODE EXEMPLE',copy:'Copier',receivePayments:'RECEVOIR UN PAIEMENT',receiveTitle:'Créer une demande de paiement',receiveSubtitle:'Préparez une demande fictive à partager avec un client.',requestDetails:'Détails de la demande',description:'Description',expiration:'Expiration',createRequest:'Créer la demande démo',shareRequest:'PARTAGER LA DEMANDE',paymentQr:'Code QR de paiement',qrWillAppear:'Les détails de votre demande apparaîtront ici.',copyRequest:'Copier la demande',qrWarning:'Ce motif n’est pas un QR bancaire fonctionnel.',transactionHistory:'JOURNAL D’ACTIVITÉ',allTransactions:'Toutes les transactions',activitySubtitle:'Recherchez et exportez l’historique de démonstration local.',exportCsv:'Exporter CSV',searchPlaceholder:'Rechercher par nom, ID…',allTypes:'Tous les types',outgoingType:'Envois',requestsType:'Demandes',paymentsType:'Paiements QR',allStatuses:'Tous les statuts',demoStatus:'Démo créée',transactionColumn:'TRANSACTION',typeColumn:'TYPE',dateColumn:'DATE',amountColumn:'MONTANT',statusColumn:'STATUT',clearHistory:'Effacer l’historique local',beneficiariesSubtitle:'Gardez vos contacts favoris sur cet appareil de démonstration.',addBeneficiary:'Ajouter un bénéficiaire',fullName:'Nom complet',phoneOrId:'Téléphone ou identifiant',saveContact:'Enregistrer le contact',myContacts:'Mes contacts',noContacts:'Aucun bénéficiaire enregistré.',businessSpace:'LAKAYGOPAY BUSINESS',merchantHeadline:'Votre commerce avance avec vous.',merchantSubhead:'Un espace prévu pour suivre vos demandes et vos ventes.',createPaymentRequest:'Créer une demande',salesToday:'Ventes aujourd’hui',demoData:'Données de démo',paymentsReceived:'Paiements reçus',paymentRequests:'Demandes créées',localDevice:'Sur cet appareil',merchantTools:'OUTILS MARCHAND',manageBusiness:'Gérer mon activité',paymentLink:'Demande de paiement',paymentLinkDesc:'Préparer un lien ou QR de démonstration',salesHistory:'Historique des ventes',salesHistoryDesc:'Consulter les opérations de test',businessProfile:'Profil de l’entreprise',businessProfileDesc:'Informations à configurer plus tard',merchantChecklist:'AVANT LE LANCEMENT',merchantSetup:'Configuration marchand',demoSpaceReady:'Espace de présentation',demoSpaceReadyText:'Interface disponible',identityCheck:'Vérification d’identité',needsBackend:'Nécessite le backend',paymentPartner:'Partenaire de paiement',partnerRequired:'À sélectionner et intégrer',updates:'MISES À JOUR',notificationSubtitle:'Informations liées à votre expérience de démonstration.',markAllRead:'Tout marquer comme lu',securityCenter:'CENTRE DE SÉCURITÉ',protectAccount:'Protéger votre compte',securitySubtitle:'Voici les protections à mettre en place avant toute utilisation réelle.',setupRequired:'À CONFIGURER',securityAlertTitle:'La sécurité financière n’est pas encore activée.',securityAlertText:'Cette interface ne possède pas encore d’authentification réelle ni de contrôle serveur. N’y saisissez aucun mot de passe bancaire ou donnée sensible.',secureLogin:'Connexion sécurisée',secureLoginDesc:'Authentification Supabase à connecter avec vérification côté serveur.',twoFactor:'Authentification à deux facteurs',twoFactorDesc:'OTP/MFA à activer pour protéger les accès sensibles.',transactionProtection:'Protection des transactions',transactionProtectionDesc:'Ledger append-only, idempotence et validation serveur obligatoires.',adminApproval:'Validation à deux personnes',adminApprovalDesc:'Les retraits importants doivent être approuvés par deux administrateurs distincts.',auditTrail:'Journal d’audit',auditTrailDesc:'Chaque action sensible doit être horodatée et conservée.',privacy:'Confidentialité des données',privacyDesc:'Règles d’accès, chiffrement, sauvegardes et politique de conservation.',preferences:'PRÉFÉRENCES',settingsSubtitle:'Personnalisez cette interface sur votre appareil.',personalInformation:'Informations personnelles',displayName:'Nom affiché',emailOptional:'Adresse e-mail (facultatif)',saveChanges:'Enregistrer',appPreferences:'Préférences de l’application',defaultCurrency:'Devise par défaut',showDemoNotices:'Afficher les avertissements démo',showDemoNoticesDesc:'Conserver les rappels visibles',resetDemo:'Réinitialiser les données de démonstration',supportCenter:'CENTRE D’ASSISTANCE',helpSubtitle:'Quelques réponses sur cette version de LakayGoPay.',faqTitle:'Questions fréquentes',faq1:'Est-ce que je peux envoyer de l’argent réel ?',faq1a:'Non. Cette version est un prototype. Aucun mouvement d’argent réel n’est possible.',faq2:'Mon solde est-il réel ?',faq2a:'Non. Le solde est uniquement illustratif et n’est relié à aucun compte bancaire ou portefeuille.',faq3:'MonCash et NatCash seront-ils pris en charge ?',faq3a:'Ils pourront être étudiés comme partenaires ou moyens de paiement après accord, intégration technique et vérifications réglementaires.',faq4:'Quand les paiements seront-ils activés ?',faq4a:'Après la mise en place du backend, des contrôles financiers, des tests de sécurité et des accords avec des partenaires agréés.',needHelp:'Besoin d’aide ?',helpContactText:'Pour le moment, cette page présente le parcours d’assistance prévu. Les coordonnées officielles seront ajoutées lorsque le support sera opérationnel.',supportNotConnected:'Support en ligne : non configuré',footerTagline:'Service paiement simple avec une vie simple.',simulationReview:'VÉRIFICATION DE DÉMO',confirmTransfer:'Confirmer la simulation ?',modalWarning:'Aucun argent réel ne sera envoyé. Cette action ajoute uniquement un exemple à l’historique local.',cancel:'Annuler',confirmDemo:'Confirmer la démo',sendType:'Envoi simulé',requestType:'Demande créée',scanType:'Test QR',demoCreated:'Démo créée',copySuccess:'Copié dans le presse-papiers.',copyFallback:'Copie non disponible sur ce navigateur.',invalidAmount:'Entrez un montant entre 1 et 500 000 HTG.',invalidRecipient:'Entrez un téléphone ou un identifiant valide.',duplicateContact:'Ce numéro ou identifiant existe déjà.',contactSaved:'Bénéficiaire enregistré sur cet appareil.',contactRemoved:'Bénéficiaire supprimé.',noHistory:'Il n’y a aucune transaction à exporter.',historyCleared:'Historique local effacé.',confirmClear:'Effacer toutes les transactions de démonstration enregistrées sur cet appareil ?',confirmReset:'Réinitialiser les transactions, contacts et préférences de démonstration sur cet appareil ?',requestCreated:'Demande de démonstration créée.',requestCreatedDetails:'Demande démo',codeValid:'Code de test reconnu. Aucun paiement n’a été effectué.',codeInvalid:'Code non reconnu. Essayez LGP-DEMO-0001.',cameraUnsupported:'La lecture QR automatique n’est pas prise en charge par ce navigateur. Utilisez la saisie manuelle.',cameraDenied:'Accès caméra refusé ou indisponible. Vous pouvez saisir le code manuellement.',cameraStarted:'Caméra activée. Présentez un code QR compatible.',cameraStopped:'Caméra arrêtée.',scanFound:'Code détecté : ',scanNotPayment:'Code détecté. Aucun paiement n’a été effectué.',profileSaved:'Profil de démonstration mis à jour.',resetDone:'Données de démonstration réinitialisées.',noticeHidden:'Avertissement masqué. Il reste accessible dans le panneau Sécurité.',read:'Lu',markRead:'Marquer comme lu',notificationOneTitle:'Bienvenue sur LakayGoPay',notificationOneText:'Votre interface de démonstration est prête à être explorée.',notificationTwoTitle:'Paiements réels désactivés',notificationTwoText:'Le backend, la sécurité et les partenaires doivent être validés avant tout lancement.',notificationThreeTitle:'Conseil de sécurité',notificationThreeText:'Ne saisissez jamais vos identifiants bancaires dans cette version prototype.',transactionLabel:'Transaction',noResults:'Aucun résultat pour ces filtres.',today:'Aujourd’hui',demoWarning:'Rappel : prototype uniquement. Aucun argent réel.'
    },
    ht: {
      workspace:'ESPAS PÈSONÈL',demoAccount:'Kont demonstrasyon',mainMenu:'MENI PRENSIPAL',overview:'Rezime',myWallet:'Bous mwen',transfer:'Transfè',pay:'Peye ak QR',receive:'Resevwa',activity:'Istwa',manage:'JESTYON',beneficiaries:'Moun mwen anrejistre',merchant:'Espas machann',notifications:'Notifikasyon',account:'KONT',security:'Sekirite',settings:'Paramèt',help:'Èd & asistans',securityFirst:'Sekirite an premye',securityCaption:'Pwototip san lajan reyèl',welcomeBack:'BYENVINI ANKÒ',demoMode:'Mòd tès',language:'Lang',personalAccount:'Kont pèsonèl',prototypeTitle:'Vèsyon pwototip — pa gen operasyon reyèl',prototypeText:'Kont, balans, kòd QR ak tranzaksyon ki anba yo se egzanp lokal. Pa gen depo, retrè oswa transfè lajan k ap fèt.',yourMoneySpace:'ESPAS FINANSYE OU',hello:'Bonjou',welcomeSubtitle:'Jere operasyon tès ou yo nan yon sèl kote.',totalBalance:'Balans total bous la',demoBalance:'Balans demonstrasyon',sendMoney:'Voye',receiveMoney:'Resevwa',details:'Detay',shortcuts:'RACCOURCI',quickActions:'Aksyon rapid',send:'Voye',sendDesc:'Fè yon transfè',scanQr:'Eskane QR',scanDesc:'Peye yon machann',collect:'Resevwa peman',receiveDesc:'Kreye yon demann',contacts:'Kontak',contactsDesc:'Jere favori yo',incoming:'Antre lajan teste',outgoing:'Lajan ki soti teste',periodToday:'Jodi a',transactions:'Tranzaksyon',sinceStart:'Depi kòmansman',savedContacts:'Kontak anrejistre',overviewActivity:'AKTIVITE OU',recentTransactions:'Dènye tranzaksyon yo',viewAll:'Gade tout →',emptyTransactions:'Pa gen tranzaksyon pou kounye a.',accountStatus:'ETA KONT LAN',readiness:'Preparasyon kont lan',setupProgress:'Konfigirasyon inisyal',backendPending:'Backend ak verifikasyon poko konekte',interfaceReady:'Entèfas la pare',interfaceReadyText:'Navigasyon ak ekran demonstrasyon',secureAuth:'Koneksyon sekirize',notConnected:'Poko konekte',financialCore:'Motè finansye',trustHeadline:'Konfyans kòmanse ak transparans.',trustText:'LakayGoPay nan faz preparasyon. Fonksyon finansye yo ap rete dezaktive jiskaske sekirite, backend ak patnè reglemante yo valide.',learnSecurity:'Gade sekirite →',walletOverview:'BOUS',walletSubtitle:'Gade balans demonstrasyon ou ak opsyon ki prevwa yo.',mainWallet:'Bous prensipal',currencyDemo:'Se yon balans ilistratif sèlman.',comingSoon:'Pita',currencyLater:'Konvèsyon ak plizyè lajan poko aktive.',walletActions:'OPSYON',plannedOperations:'Operasyon ki prevwa',deposit:'Depo',providerRequired:'Patnè nesesè',notAvailable:'Pa disponib',withdraw:'Retrè',demoOnly:'Tès sèlman',tryDemo:'Eseye tès la',sendFunds:'VOYE LAJAN',sendMoneyTitle:'Voye lajan',transferSubtitle:'Teste etap transfè a ak fo enfòmasyon.',recipientDetails:'Enfòmasyon moun k ap resevwa a',recipientHint:'Chwazi yon kontak oswa antre idantifyan li.',recipientPhone:'Telefòn oswa idantifyan',transferDetails:'Detay transfè a',amountHint:'Montan an goud ayisyen.',amountHtg:'Montan (HTG)',transferNote:'Rezon (si ou vle)',transferDemoNotice:'Validasyon an ap kreye yon liy tès sèlman sou aparèy sa a. Balans lan ak lajan reyèl pap deplase.',reviewTransfer:'Verifye tès la',summary:'REZIME',transferSummary:'Transfè ou a',readyToSend:'Ou pare pou kòmanse?',summaryHint:'Detay transfè a ap parèt la anvan tès la.',transferFee:'Frè transfè',total:'Total',feeFuture:'N ap fikse frè yo ak patnè peman an.',qrPayments:'PEMAN QR',scanPay:'Eskane epi peye',scanSubtitle:'Lekti QR la se yon aperçu. Pa gen peman k ap fèt.',scanMerchantQr:'Eskane QR machann lan',cameraPermission:'Pèmèt kamera a pou teste lekti a si navigatè a pèmèt sa.',cameraOff:'Kamera etenn',cameraOffHint:'Limen kamera a oswa antre yon kòd tès.',startCamera:'Limen kamera',stopCamera:'Etenn',manualEntry:'ANTRE MANYÈL',enterPaymentCode:'Antre kòd peman',manualHint:'Pou tès la, sèvi ak kòd ki anba a.',paymentCode:'Kòd machann',checkCode:'Verifye kòd la',sampleCode:'KÒD EGZANP',copy:'Kopye',receivePayments:'RESEVWA PEMAN',receiveTitle:'Kreye yon demann peman',receiveSubtitle:'Prepare yon demann tès pou pataje ak yon kliyan.',requestDetails:'Detay demann lan',description:'Deskripsyon',expiration:'Ekspirasyon',createRequest:'Kreye demann tès',shareRequest:'PATAJE DEMANN LAN',paymentQr:'Kòd QR peman',qrWillAppear:'Detay demann ou an ap parèt la.',copyRequest:'Kopye demann lan',qrWarning:'Modèl sa a pa yon QR bankè ki fonksyone.',transactionHistory:'JOUNAL AKTIVITE',allTransactions:'Tout tranzaksyon yo',activitySubtitle:'Chèche epi ekspòte istwa tès lokal la.',exportCsv:'Ekspòte CSV',searchPlaceholder:'Chèche non, ID…',allTypes:'Tout kalite',outgoingType:'Voye',requestsType:'Demann',paymentsType:'Peman QR',allStatuses:'Tout eta yo',demoStatus:'Tès kreye',transactionColumn:'TRANZAKSYON',typeColumn:'KALITE',dateColumn:'DAT',amountColumn:'MONTAN',statusColumn:'ETA',clearHistory:'Efase istwa lokal la',beneficiariesSubtitle:'Kenbe kontak favori ou yo sou aparèy tès sa a.',addBeneficiary:'Ajoute yon benefisyè',fullName:'Non konplè',phoneOrId:'Telefòn oswa idantifyan',saveContact:'Anrejistre kontak la',myContacts:'Kontak mwen yo',noContacts:'Pa gen benefisyè anrejistre.',businessSpace:'LAKAYGOPAY BUSINESS',merchantHeadline:'Biznis ou avanse ansanm avè w.',merchantSubhead:'Yon espas pou swiv demann peman ak lavant ou yo.',createPaymentRequest:'Kreye yon demann',salesToday:'Lavant jodi a',demoData:'Done tès',paymentsReceived:'Peman resevwa',paymentRequests:'Demann kreye',localDevice:'Sou aparèy sa a',merchantTools:'ZOUTI MACHANN',manageBusiness:'Jere aktivite mwen',paymentLink:'Demann peman',paymentLinkDesc:'Prepare yon lyen oswa QR demonstrasyon',salesHistory:'Istwa lavant',salesHistoryDesc:'Gade operasyon tès yo',businessProfile:'Pwofil biznis la',businessProfileDesc:'Enfòmasyon pou konfigire pi devan',merchantChecklist:'ANVAN LANSMAN',merchantSetup:'Konfigirasyon machann',demoSpaceReady:'Espas prezantasyon',demoSpaceReadyText:'Entèfas disponib',identityCheck:'Verifikasyon idantite',needsBackend:'Backend nesesè',paymentPartner:'Patnè peman',partnerRequired:'Pou chwazi epi entegre',updates:'ENFÒMASYON',notificationSubtitle:'Enfòmasyon sou eksperyans demonstrasyon ou.',markAllRead:'Make tout kòm li',securityCenter:'SANT SEKIRITE',protectAccount:'Pwoteje kont ou',securitySubtitle:'Men pwoteksyon ki dwe fèt anvan nenpòt itilizasyon reyèl.',setupRequired:'POU KONFIGIRE',securityAlertTitle:'Sekirite finansye poko aktive.',securityAlertText:'Entèfas sa a poko gen vrè koneksyon ni kontwòl sèvè. Pa antre modpas bank oswa enfòmasyon sansib isit la.',secureLogin:'Koneksyon sekirize',secureLoginDesc:'Konekte otantifikasyon Supabase ak verifikasyon sou sèvè.',twoFactor:'Otantifikasyon de faktè',twoFactorDesc:'Aktive OTP/MFA pou pwoteje aksè enpòtan yo.',transactionProtection:'Pwoteksyon tranzaksyon',transactionProtectionDesc:'Ledger append-only, idempotence ak validasyon sèvè obligatwa.',adminApproval:'Apwobasyon de moun',adminApprovalDesc:'De administratè diferan dwe apwouve gwo retrè.',auditTrail:'Jounal odit',auditTrailDesc:'Chak aksyon enpòtan dwe gen lè ak dat epi konsève.',privacy:'Konfidansyalite done',privacyDesc:'Règ aksè, chifreman, sovgad ak règleman konsèvasyon.',preferences:'PREFERANS',settingsSubtitle:'Personnalize entèfas sa a sou aparèy ou.',personalInformation:'Enfòmasyon pèsonèl',displayName:'Non pou montre',emailOptional:'Imèl (si ou vle)',saveChanges:'Anrejistre',appPreferences:'Preferans aplikasyon',defaultCurrency:'Lajan pa defo',showDemoNotices:'Montre avètisman tès yo',showDemoNoticesDesc:'Kenbe rapèl yo vizib',resetDemo:'Reyinisyalize done demonstrasyon',supportCenter:'SANT ÈD',helpSubtitle:'Kèk repons sou vèsyon LakayGoPay sa a.',faqTitle:'Kesyon yo poze souvan',faq1:'Èske mwen ka voye vrè lajan?',faq1a:'Non. Vèsyon sa a se yon pwototip. Pa gen mouvman lajan reyèl ki posib.',faq2:'Èske balans mwen an reyèl?',faq2a:'Non. Balans lan se yon egzanp sèlman, li pa konekte ak okenn kont labank oswa bous.',faq3:'Èske MonCash ak NatCash ap disponib?',faq3a:'N ap kapab etidye yo kòm patnè oswa mwayen peman apre akò, entegrasyon teknik ak verifikasyon regilasyon.',faq4:'Kilè peman yo ap aktive?',faq4a:'Apre backend, kontwòl finansye, tès sekirite ak akò ak patnè ki gen otorizasyon.',needHelp:'Ou bezwen èd?',helpContactText:'Pou kounye a paj sa a montre fason asistans lan prevwa. N ap ajoute kontak ofisyèl yo lè sèvis sipò a pare.',supportNotConnected:'Sipò sou entènèt: poko konfigire',footerTagline:'Sèvis peman senp ak yon lavi senp.',simulationReview:'VERIFIKASYON TÈS',confirmTransfer:'Konfime tès la?',modalWarning:'Pa gen lajan reyèl k ap voye. Aksyon sa a ajoute yon egzanp sèlman nan istwa lokal la.',cancel:'Anile',confirmDemo:'Konfime tès la',sendType:'Voye teste',requestType:'Demann kreye',scanType:'Tès QR',demoCreated:'Tès kreye',copySuccess:'Kopye nan clipboard.',copyFallback:'Navigatè sa a pa pèmèt kopye otomatik.',invalidAmount:'Antre yon montan ant 1 ak 500 000 HTG.',invalidRecipient:'Antre yon telefòn oswa idantifyan ki valab.',duplicateContact:'Nimewo oswa idantifyan sa a deja egziste.',contactSaved:'Benefisyè a anrejistre sou aparèy sa a.',contactRemoved:'Benefisyè efase.',noHistory:'Pa gen tranzaksyon pou ekspòte.',historyCleared:'Istwa lokal la efase.',confirmClear:'Efase tout tranzaksyon demonstrasyon ki anrejistre sou aparèy sa a?',confirmReset:'Reyinisyalize tranzaksyon, kontak ak preferans demonstrasyon sou aparèy sa a?',requestCreated:'Demann demonstrasyon kreye.',requestCreatedDetails:'Demann tès',codeValid:'Kòd tès la rekonèt. Pa gen peman ki fèt.',codeInvalid:'Kòd la pa rekonèt. Eseye LGP-DEMO-0001.',cameraUnsupported:'Navigatè sa a pa sipòte lekti QR otomatik. Antre kòd la manyèlman.',cameraDenied:'Aksè kamera refize oswa pa disponib. Ou ka antre kòd la manyèlman.',cameraStarted:'Kamera limen. Mete yon QR ki konpatib devan li.',cameraStopped:'Kamera etenn.',scanFound:'Kòd jwenn: ',scanNotPayment:'Kòd detekte. Pa gen peman ki fèt.',profileSaved:'Pwofil demonstrasyon mete ajou.',resetDone:'Done demonstrasyon reyinisyalize.',noticeHidden:'Avètisman kache. Ou ka jwenn li nan seksyon Sekirite a.',read:'Li',markRead:'Make kòm li',notificationOneTitle:'Byenvini sou LakayGoPay',notificationOneText:'Entèfas demonstrasyon ou pare pou eksplore.',notificationTwoTitle:'Vrè peman dezaktive',notificationTwoText:'Backend, sekirite ak patnè yo dwe valide anvan lansman.',notificationThreeTitle:'Konsèy sekirite',notificationThreeText:'Pa janm antre enfòmasyon labank ou nan pwototip sa a.',transactionLabel:'Tranzaksyon',noResults:'Pa gen rezilta pou filtè sa yo.',today:'Jodi a',demoWarning:'Rapèl: se yon pwototip sèlman. Pa gen lajan reyèl.'
    },
    en: {
      workspace:'PERSONAL SPACE',demoAccount:'Demo account',mainMenu:'MAIN MENU',overview:'Overview',myWallet:'My wallet',transfer:'Transfer',pay:'Pay by QR',receive:'Receive',activity:'Activity',manage:'MANAGEMENT',beneficiaries:'Beneficiaries',merchant:'Merchant space',notifications:'Notifications',account:'ACCOUNT',security:'Security',settings:'Settings',help:'Help & support',securityFirst:'Security first',securityCaption:'Prototype with no real money',welcomeBack:'WELCOME BACK',demoMode:'Demo mode',language:'Language',personalAccount:'Personal account',prototypeTitle:'Prototype version — no real operations',prototypeText:'Accounts, balances, QR codes and transactions below are local examples. No real deposit, withdrawal or money transfer is performed.',yourMoneySpace:'YOUR FINANCIAL SPACE',hello:'Hello',welcomeSubtitle:'Manage your demo activity from one place.',totalBalance:'Total wallet balance',demoBalance:'Demo balance',sendMoney:'Send',receiveMoney:'Receive',details:'Details',shortcuts:'SHORTCUTS',quickActions:'Quick actions',send:'Send',sendDesc:'Make a transfer',scanQr:'Scan QR',scanDesc:'Pay a merchant',collect:'Collect',receiveDesc:'Create a request',contacts:'Contacts',contactsDesc:'Manage favorites',incoming:'Simulated incoming',outgoing:'Simulated outgoing',periodToday:'Today',transactions:'Transactions',sinceStart:'Since the beginning',savedContacts:'Saved contacts',overviewActivity:'YOUR ACTIVITY',recentTransactions:'Recent transactions',viewAll:'View all →',emptyTransactions:'No transactions yet.',accountStatus:'ACCOUNT STATUS',readiness:'Account readiness',setupProgress:'Initial setup',backendPending:'Backend and verification pending',interfaceReady:'Interface ready',interfaceReadyText:'Navigation and demo screens',secureAuth:'Secure authentication',notConnected:'Not connected yet',financialCore:'Financial engine',trustHeadline:'Trust starts with transparency.',trustText:'LakayGoPay is in preparation. Financial features will remain disabled until security, backend and regulated partners are validated.',learnSecurity:'View security →',walletOverview:'WALLET',walletSubtitle:'Review your demo balances and planned options.',mainWallet:'Main wallet',currencyDemo:'Illustrative balance only.',comingSoon:'Coming soon',currencyLater:'Conversion and multi-currency are not enabled.',walletActions:'OPTIONS',plannedOperations:'Planned operations',deposit:'Deposit',providerRequired:'Provider required',notAvailable:'Unavailable',withdraw:'Withdraw',demoOnly:'Simulation only',tryDemo:'Try the demo',sendFunds:'SEND FUNDS',sendMoneyTitle:'Send money',transferSubtitle:'Test the transfer flow with sample data.',recipientDetails:'Recipient information',recipientHint:'Choose a contact or enter their identifier.',recipientPhone:'Phone or identifier',transferDetails:'Transfer details',amountHint:'Amount in Haitian gourdes.',amountHtg:'Amount (HTG)',transferNote:'Note (optional)',transferDemoNotice:'Submitting creates only a demo entry on this device. Your balance and real money will not move.',reviewTransfer:'Review simulation',summary:'SUMMARY',transferSummary:'Your transfer',readyToSend:'Ready to begin?',summaryHint:'Transfer details will appear here before the simulation.',transferFee:'Transfer fee',total:'Total',feeFuture:'Fees will be defined with the payment provider.',qrPayments:'QR PAYMENT',scanPay:'Scan and pay',scanSubtitle:'QR reading is preview-only. No payment will be sent.',scanMerchantQr:'Scan merchant QR',cameraPermission:'Allow camera access to test scanning if your browser supports it.',cameraOff:'Camera is off',cameraOffHint:'Start the camera or enter a test code.',startCamera:'Start camera',stopCamera:'Stop',manualEntry:'MANUAL ENTRY',enterPaymentCode:'Enter a payment code',manualHint:'For the demo, use the sample code below.',paymentCode:'Merchant code',checkCode:'Check code',sampleCode:'SAMPLE CODE',copy:'Copy',receivePayments:'RECEIVE A PAYMENT',receiveTitle:'Create a payment request',receiveSubtitle:'Prepare a sample request to share with a customer.',requestDetails:'Request details',description:'Description',expiration:'Expiration',createRequest:'Create demo request',shareRequest:'SHARE REQUEST',paymentQr:'Payment QR code',qrWillAppear:'Your request details will appear here.',copyRequest:'Copy request',qrWarning:'This pattern is not a functioning bank QR code.',transactionHistory:'ACTIVITY LOG',allTransactions:'All transactions',activitySubtitle:'Search and export local demo history.',exportCsv:'Export CSV',searchPlaceholder:'Search name, ID…',allTypes:'All types',outgoingType:'Outgoing',requestsType:'Requests',paymentsType:'QR payments',allStatuses:'All statuses',demoStatus:'Demo created',transactionColumn:'TRANSACTION',typeColumn:'TYPE',dateColumn:'DATE',amountColumn:'AMOUNT',statusColumn:'STATUS',clearHistory:'Clear local history',beneficiariesSubtitle:'Keep favorite contacts on this demo device.',addBeneficiary:'Add a beneficiary',fullName:'Full name',phoneOrId:'Phone or identifier',saveContact:'Save contact',myContacts:'My contacts',noContacts:'No beneficiaries saved.',businessSpace:'LAKAYGOPAY BUSINESS',merchantHeadline:'Your business moves forward with you.',merchantSubhead:'A space designed to track requests and sales.',createPaymentRequest:'Create a request',salesToday:'Sales today',demoData:'Demo data',paymentsReceived:'Payments received',paymentRequests:'Requests created',localDevice:'On this device',merchantTools:'MERCHANT TOOLS',manageBusiness:'Manage my business',paymentLink:'Payment request',paymentLinkDesc:'Prepare a sample link or QR',salesHistory:'Sales history',salesHistoryDesc:'Review test operations',businessProfile:'Business profile',businessProfileDesc:'Information to configure later',merchantChecklist:'BEFORE LAUNCH',merchantSetup:'Merchant setup',demoSpaceReady:'Presentation space',demoSpaceReadyText:'Interface available',identityCheck:'Identity verification',needsBackend:'Backend required',paymentPartner:'Payment provider',partnerRequired:'To be selected and integrated',updates:'UPDATES',notificationSubtitle:'Information about your demo experience.',markAllRead:'Mark all as read',securityCenter:'SECURITY CENTER',protectAccount:'Protect your account',securitySubtitle:'These protections must be implemented before real use.',setupRequired:'SETUP REQUIRED',securityAlertTitle:'Financial security is not enabled yet.',securityAlertText:'This interface does not yet have real authentication or server-side controls. Do not enter banking passwords or sensitive data here.',secureLogin:'Secure sign-in',secureLoginDesc:'Connect Supabase authentication with server-side verification.',twoFactor:'Two-factor authentication',twoFactorDesc:'Enable OTP/MFA to protect sensitive access.',transactionProtection:'Transaction protection',transactionProtectionDesc:'Append-only ledger, idempotency and server validation are mandatory.',adminApproval:'Four-eyes approval',adminApprovalDesc:'High-value withdrawals must be approved by two different administrators.',auditTrail:'Audit trail',auditTrailDesc:'Every sensitive action must be timestamped and retained.',privacy:'Data privacy',privacyDesc:'Access rules, encryption, backups and retention policy.',preferences:'PREFERENCES',settingsSubtitle:'Personalize this interface on your device.',personalInformation:'Personal information',displayName:'Display name',emailOptional:'Email address (optional)',saveChanges:'Save changes',appPreferences:'App preferences',defaultCurrency:'Default currency',showDemoNotices:'Show demo warnings',showDemoNoticesDesc:'Keep reminders visible',resetDemo:'Reset demo data',supportCenter:'HELP CENTER',helpSubtitle:'A few answers about this LakayGoPay version.',faqTitle:'Frequently asked questions',faq1:'Can I send real money?',faq1a:'No. This version is a prototype. No real money movement is possible.',faq2:'Is my balance real?',faq2a:'No. The balance is illustrative and is not connected to a bank account or wallet.',faq3:'Will MonCash and NatCash be supported?',faq3a:'They may be evaluated as partners or payment methods after agreements, technical integration and regulatory checks.',faq4:'When will payments be enabled?',faq4a:'After backend implementation, financial controls, security tests and agreements with authorized partners.',needHelp:'Need help?',helpContactText:'For now, this page shows the planned support journey. Official contact details will be added when support is operational.',supportNotConnected:'Online support: not configured',footerTagline:'Simple payment service with a simple life.',simulationReview:'DEMO REVIEW',confirmTransfer:'Confirm simulation?',modalWarning:'No real money will be sent. This action only adds a sample to local history.',cancel:'Cancel',confirmDemo:'Confirm demo',sendType:'Simulated send',requestType:'Request created',scanType:'QR test',demoCreated:'Demo created',copySuccess:'Copied to clipboard.',copyFallback:'Copy is not available in this browser.',invalidAmount:'Enter an amount between 1 and 500,000 HTG.',invalidRecipient:'Enter a valid phone number or identifier.',duplicateContact:'This phone number or identifier already exists.',contactSaved:'Beneficiary saved on this device.',contactRemoved:'Beneficiary removed.',noHistory:'There are no transactions to export.',historyCleared:'Local history cleared.',confirmClear:'Clear all demo transactions saved on this device?',confirmReset:'Reset demo transactions, contacts and preferences on this device?',requestCreated:'Demo request created.',requestCreatedDetails:'Demo request',codeValid:'Test code recognized. No payment was made.',codeInvalid:'Code not recognized. Try LGP-DEMO-0001.',cameraUnsupported:'Automatic QR scanning is not supported by this browser. Enter the code manually.',cameraDenied:'Camera access denied or unavailable. You can enter the code manually.',cameraStarted:'Camera started. Present a compatible QR code.',cameraStopped:'Camera stopped.',scanFound:'Code found: ',scanNotPayment:'Code detected. No payment was made.',profileSaved:'Demo profile updated.',resetDone:'Demo data reset.',noticeHidden:'Warning hidden. It remains available in Security.',read:'Read',markRead:'Mark as read',notificationOneTitle:'Welcome to LakayGoPay',notificationOneText:'Your demo interface is ready to explore.',notificationTwoTitle:'Real payments are disabled',notificationTwoText:'Backend, security and partners must be validated before launch.',notificationThreeTitle:'Security tip',notificationThreeText:'Never enter banking credentials in this prototype.',transactionLabel:'Transaction',noResults:'No results for these filters.',today:'Today',demoWarning:'Reminder: prototype only. No real money.'
    }
  };

  const state = loadState();
  let currentLang = ['fr','ht','en'].includes(state.language) ? state.language : 'fr';
  let pendingTransfer = null;
  let cameraStream = null;
  let scanTimer = null;
  let balanceHidden = false;
  let noticeDismissed = Boolean(state.noticeDismissed);
  let requestCode = null;
  let transferLock = false;
  const notificationItems = [
    {id:'welcome',title:'notificationOneTitle',body:'notificationOneText',date:'',icon:'✦'},
    {id:'payments',title:'notificationTwoTitle',body:'notificationTwoText',date:'',icon:'◇'},
    {id:'security',title:'notificationThreeTitle',body:'notificationThreeText',date:'',icon:'!'}
  ];

  function loadState(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {language:'fr',name:'Bastien Demo',email:'',transactions:[],beneficiaries:[],readNotifications:[],noticeDismissed:false,showNotices:true};
      const parsed = JSON.parse(raw);
      return {
        language:parsed.language || 'fr',name:parsed.name || 'Bastien Demo',email:parsed.email || '',
        transactions:Array.isArray(parsed.transactions)?parsed.transactions:[],
        beneficiaries:Array.isArray(parsed.beneficiaries)?parsed.beneficiaries:[],
        readNotifications:Array.isArray(parsed.readNotifications)?parsed.readNotifications:[],
        noticeDismissed:Boolean(parsed.noticeDismissed),showNotices:parsed.showNotices !== false
      };
    } catch { return {language:'fr',name:'Bastien Demo',email:'',transactions:[],beneficiaries:[],readNotifications:[],noticeDismissed:false,showNotices:true}; }
  }
  function saveState(){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { toast('Le stockage local est indisponible dans ce navigateur.'); }
  }
  function t(key){ return (translations[currentLang] && translations[currentLang][key]) || translations.fr[key] || key; }
  function escapeHtml(value){ return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function money(value){ return Number(value || 0).toLocaleString(currentLang === 'en' ? 'en-US' : 'fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function dateText(value){ const d = new Date(value); if (Number.isNaN(d.getTime())) return ''; return d.toLocaleString(currentLang === 'en' ? 'en-US' : currentLang === 'ht' ? 'fr-FR' : 'fr-FR',{dateStyle:'medium',timeStyle:'short'}); }
  function toast(message){ const node = $('#toast'); if(!node) return; node.textContent = message; node.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(()=>node.classList.remove('show'),2800); }
  function applyLanguage(lang){
    currentLang = ['fr','ht','en'].includes(lang) ? lang : 'fr'; state.language=currentLang; saveState();
    document.documentElement.lang = currentLang;
    $$('[data-i18n]').forEach(el=>{ const key=el.dataset.i18n; if(translations[currentLang][key]) el.textContent=translations[currentLang][key]; });
    $$('[data-i18n-placeholder]').forEach(el=>{ const key=el.dataset.i18nPlaceholder; if(translations[currentLang][key]) el.placeholder=translations[currentLang][key]; });
    $('#language').value=currentLang; $('#settingsLanguage').value=currentLang;
    refreshTitle(); renderAll();
  }
  function refreshTitle(){ const active = $('.view.active'); const name=active ? active.id.replace('view-','') : 'overview'; $('#pageTitle').textContent=t(viewKeys[name] || name) || titleFallback[name]; }
  function showView(name){
    if (!$('#view-'+name)) name='overview';
    $$('.view').forEach(view=>view.classList.toggle('active',view.id===`view-${name}`));
    $$('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.view===name));
    refreshTitle(); closeMobileMenu(); window.scrollTo({top:0,behavior:'smooth'});
    if(name==='notifications') renderNotifications();
    if(name==='pay' && cameraStream) stopCamera(false);
  }
  function closeMobileMenu(){ $('#sidebar').classList.remove('open'); $('#mobileScrim').classList.remove('show'); }
  function openMobileMenu(){ $('#sidebar').classList.add('open'); $('#mobileScrim').classList.add('show'); }
  function renderTransactions(){
    const recent = [...state.transactions].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5);
    const html = recent.length ? recent.map(renderTransactionCard).join('') : `<div class="empty-state">${escapeHtml(t('emptyTransactions'))}</div>`;
    $('#recentTransactions').innerHTML=html;
  }
  function renderTransactionCard(item){
    const icon = item.type==='send'?'↗':item.type==='request'?'⌗':'▦';
    const title = item.type==='send' ? `${t('sendType')} · ${escapeHtml(item.recipient)}` : item.type==='request' ? `${t('requestType')} · ${escapeHtml(item.description || '')}` : `${t('scanType')} · ${escapeHtml(item.code || '')}`;
    const amount = item.amount ? `${money(item.amount)} HTG` : '—';
    return `<div class="transaction-row"><div class="transaction-avatar">${icon}</div><div class="transaction-main"><strong>${title}</strong><small>${escapeHtml(dateText(item.createdAt))} · ${escapeHtml(item.id)}</small></div><div class="transaction-amount">${amount}<small>${escapeHtml(t('demoCreated'))}</small></div></div>`;
  }
  function renderActivity(){
    const search=($('#activitySearch').value||'').trim().toLowerCase();
    const type=$('#activityType').value; const status=$('#activityStatus').value;
    const rows=[...state.transactions].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).filter(item=>{
      const haystack=[item.id,item.recipient,item.description,item.code].join(' ').toLowerCase();
      return (!search||haystack.includes(search))&&(type==='all'||item.type===type)&&(status==='all'||status==='demo');
    });
    $('#activityRows').innerHTML=rows.length?rows.map(item=>{
      const name=item.type==='send'?`${t('sendType')} · ${item.recipient||''}`:item.type==='request'?`${t('requestType')} · ${item.description||''}`:`${t('scanType')} · ${item.code||''}`;
      const typeLabel=item.type==='send'?t('outgoingType'):item.type==='request'?t('requestsType'):t('paymentsType');
      const amount=item.amount?`${money(item.amount)} HTG`:'—';
      return `<div class="activity-row"><div class="activity-row-title"><span class="transaction-avatar">${item.type==='send'?'↗':item.type==='request'?'⌗':'▦'}</span><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(item.id)}</small></span></div><span><i class="type-chip">${escapeHtml(typeLabel)}</i></span><span>${escapeHtml(dateText(item.createdAt))}</span><strong>${amount}</strong><span><i class="demo-chip">${escapeHtml(t('demoCreated'))}</i></span></div>`;
    }).join(''):`<div class="empty-state">${escapeHtml(search||type!=='all'||status!=='all'?t('noResults'):t('emptyTransactions'))}</div>`;
    $('#activityCount').textContent=`${rows.length} ${t('transactionLabel').toLowerCase()}${rows.length===1?'':'s'}`;
  }
  function renderBeneficiaries(){
    $('#contactCount').textContent=String(state.beneficiaries.length);
    $('#beneficiaryMetric').textContent=String(state.beneficiaries.length);
    $('#beneficiaryList').innerHTML=state.beneficiaries.length?state.beneficiaries.map((person,index)=>{
      const initials=person.name.split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase();
      return `<div class="beneficiary-row"><div class="beneficiary-initials">${escapeHtml(initials)}</div><div><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.phone)}</small></div><div class="beneficiary-actions"><button type="button" data-use-contact="${index}" aria-label="Utiliser ce contact">↗</button><button type="button" data-remove-contact="${index}" aria-label="Supprimer ce contact">×</button></div></div>`;
    }).join(''):`<div class="empty-state">${escapeHtml(t('noContacts'))}</div>`;
    $('#beneficiarySuggestions').innerHTML=state.beneficiaries.slice(0,4).map(person=>`<button class="suggestion-chip" type="button" data-suggest-phone="${escapeHtml(person.phone)}">${escapeHtml(person.name)}</button>`).join('');
  }
  function renderNotifications(){
    const read=state.readNotifications||[];
    const unread=notificationItems.filter(item=>!read.includes(item.id)).length;
    $('#navUnread').textContent=String(unread); $('#navUnread').hidden=unread===0;
    $('#notificationShortcut').querySelector('i').style.display=unread?'block':'none';
    $('#notificationsList').innerHTML=notificationItems.map(item=>{
      const isRead=read.includes(item.id);
      return `<div class="notification-row ${isRead?'':'unread'}"><div class="notification-icon">${item.icon}</div><div class="notification-body"><strong>${escapeHtml(t(item.title))}</strong><p>${escapeHtml(t(item.body))}</p><small>${escapeHtml(t('today'))}</small></div><button type="button" data-read-notification="${item.id}">${isRead?escapeHtml(t('read')):escapeHtml(t('markRead'))}</button></div>`;
    }).join('');
  }
  function updateMetrics(){
    const outgoing=state.transactions.filter(item=>item.type==='send').reduce((sum,item)=>sum+Number(item.amount||0),0);
    const incoming=0;
    $('#incomingMetric').textContent=`${money(incoming)} HTG`;
    $('#outgoingMetric').textContent=`${money(outgoing)} HTG`;
    $('#transactionMetric').textContent=String(state.transactions.length);
    $('#requestMetric').textContent=String(state.transactions.filter(item=>item.type==='request').length);
    $('#overviewBalance').textContent=balanceHidden?'••••••':'0,00';
    $('#walletBalance').textContent=balanceHidden?'••••••':'0,00';
    $('#toggleBalance').textContent=balanceHidden?'◎':'◉';
    $('#toggleBalance').setAttribute('aria-label',balanceHidden?'Afficher le solde':'Masquer le solde');
  }
  function updateProfile(){
    const full=state.name||'Bastien Demo';
    $('#sidebarName').textContent=full; $('#topName').textContent=full; $('#profileName').value=full; $('#profileEmail').value=state.email||'';
    $('#welcomeName').textContent=full.trim().split(/\s+/)[0]||'Bastien';
  }
  function renderAll(){ updateProfile(); renderTransactions(); renderActivity(); renderBeneficiaries(); renderNotifications(); updateMetrics(); }
  function addTransaction(data){
    const id=`LGP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
    const item={id,createdAt:new Date().toISOString(),...data};
    state.transactions.unshift(item); saveState(); renderAll(); return item;
  }
  function validateAmount(value){ const amount=Number(value); return Number.isFinite(amount)&&amount>=1&&amount<=500000; }
  function openTransferModal(){
    const recipient=$('#transferRecipient').value.trim(); const amount=Number($('#transferAmount').value); const note=$('#transferNote').value.trim();
    $('#transferError').textContent='';
    if(recipient.length<4){$('#transferError').textContent=t('invalidRecipient');return;}
    if(!validateAmount(amount)){$('#transferError').textContent=t('invalidAmount');return;}
    pendingTransfer={recipient,amount,note};
    $('#modalDetails').innerHTML=`<div class="modal-detail-line"><span>${escapeHtml(t('recipientPhone'))}</span><strong>${escapeHtml(recipient)}</strong></div><div class="modal-detail-line"><span>${escapeHtml(t('amountHtg'))}</span><strong>${money(amount)} HTG</strong></div><div class="modal-detail-line"><span>${escapeHtml(t('transferNote'))}</span><strong>${escapeHtml(note||'—')}</strong></div>`;
    $('#confirmModal').classList.add('open'); $('#confirmModal').setAttribute('aria-hidden','false');
  }
  function closeTransferModal(){ $('#confirmModal').classList.remove('open'); $('#confirmModal').setAttribute('aria-hidden','true'); pendingTransfer=null; transferLock=false; $('#confirmTransferBtn').disabled=false; }
  function confirmTransfer(){
    if(!pendingTransfer||transferLock)return;
    transferLock=true; $('#confirmTransferBtn').disabled=true;
    addTransaction({type:'send',recipient:pendingTransfer.recipient,amount:pendingTransfer.amount,note:pendingTransfer.note});
    closeTransferModal(); $('#transferForm').reset(); showView('activity'); toast(t('demoWarning'));
  }
  function renderQRNoise(){
    const node=$('#qrNoise'); if(!node)return;
    // Purely decorative pattern; deliberately not encoded as a payment QR.
    for(let i=0;i<85;i++){const dot=document.createElement('i');dot.style.position='absolute';dot.style.width='6px';dot.style.height='6px';dot.style.background='#0a314a';dot.style.left=`${(i*37%151)}px`;dot.style.top=`${(i*53%151)}px`;dot.style.opacity=(i%4===0?'.25':'.9');node.appendChild(dot);}
  }
  async function copyText(text){
    try{ if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);toast(t('copySuccess'));return true;} }
    catch{}
    const input=document.createElement('textarea');input.value=text;input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);input.select();
    let ok=false;try{ok=document.execCommand('copy');}catch{}input.remove();toast(ok?t('copySuccess'):t('copyFallback'));return ok;
  }
  function createPaymentRequest(event){
    event.preventDefault();const amount=Number($('#requestAmount').value);const description=$('#requestDescription').value.trim();
    $('#requestError').textContent='';
    if(!validateAmount(amount)){$('#requestError').textContent=t('invalidAmount');return;}
    const expiry=Number($('#requestExpiry').value); const created=addTransaction({type:'request',amount,description,code:DEMO_QR_CODE,expiresAt:new Date(Date.now()+expiry*60000).toISOString()});
    requestCode=created.id; $('#requestPreviewText').textContent=`${money(amount)} HTG · ${description||t('requestCreatedDetails')} · ${t('demoCreated')}`;
    $('#copyRequest').disabled=false; $('#copyRequest').dataset.requestId=requestCode; $('#requestError').textContent=t('requestCreated');
    $('#requestForm').reset(); toast(t('requestCreated'));
  }
  function checkPaymentCode(event){
    event.preventDefault();const code=$('#paymentCode').value.trim().toUpperCase();
    if(code===DEMO_QR_CODE){addTransaction({type:'scan',code,amount:0});$('#scannerMessage').textContent=t('codeValid');toast(t('codeValid'));}
    else {$('#scannerMessage').textContent=t('codeInvalid');}
  }
  async function startCamera(){
    const message=$('#scannerMessage');
    if(!navigator.mediaDevices?.getUserMedia){message.textContent=t('cameraDenied');return;}
    if(!('BarcodeDetector' in window)){message.textContent=t('cameraUnsupported');return;}
    try{
      const detector=new BarcodeDetector({formats:['qr_code']});
      cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      const video=$('#cameraVideo');video.hidden=false;$('.scanner-placeholder').hidden=true;video.srcObject=cameraStream;await video.play();
      $('#startScanner').disabled=true;$('#stopScanner').disabled=false;message.textContent=t('cameraStarted');
      const scan=async()=>{
        if(!cameraStream)return;
        try{const codes=await detector.detect(video);if(codes.length){const raw=codes[0].rawValue||'';$('#paymentCode').value=raw;message.textContent=t('scanFound')+raw;stopCamera(false);if(raw.toUpperCase()===DEMO_QR_CODE){message.textContent=t('scanNotPayment');addTransaction({type:'scan',code:raw,amount:0});}}}
        catch{}
        if(cameraStream)scanTimer=setTimeout(scan,450);
      };scan();
    }catch{message.textContent=t('cameraDenied');stopCamera(false);}
  }
  function stopCamera(showMessage=true){
    clearTimeout(scanTimer); if(cameraStream){cameraStream.getTracks().forEach(track=>track.stop());cameraStream=null;}
    const video=$('#cameraVideo');if(video){video.pause();video.srcObject=null;video.hidden=true;}
    const placeholder=$('.scanner-placeholder');if(placeholder)placeholder.hidden=false;
    if($('#startScanner'))$('#startScanner').disabled=false;if($('#stopScanner'))$('#stopScanner').disabled=true;
    if(showMessage)$('#scannerMessage').textContent=t('cameraStopped');
  }
  function addBeneficiary(event){
    event.preventDefault();const name=$('#beneficiaryName').value.trim();const phone=$('#beneficiaryPhone').value.trim();
    $('#beneficiaryError').textContent='';
    if(name.length<2||phone.length<4){$('#beneficiaryError').textContent=t('invalidRecipient');return;}
    if(state.beneficiaries.some(item=>item.phone.toLowerCase()===phone.toLowerCase())){$('#beneficiaryError').textContent=t('duplicateContact');return;}
    state.beneficiaries.push({name,phone,createdAt:new Date().toISOString()});saveState();$('#beneficiaryForm').reset();renderAll();$('#beneficiaryError').textContent=t('contactSaved');
  }
  function removeBeneficiary(index){if(!Number.isInteger(index)||!state.beneficiaries[index])return;state.beneficiaries.splice(index,1);saveState();renderAll();toast(t('contactRemoved'));}
  function exportCsv(){
    if(!state.transactions.length){toast(t('noHistory'));return;}
    const rows=[['id','type','recipient_or_description','amount_htg','created_at','status']];
    state.transactions.forEach(item=>rows.push([item.id,item.type,item.recipient||item.description||item.code||'',item.amount||0,item.createdAt,'demo']));
    const csv='\uFEFF'+rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(';')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='lakaygopay-demo-transactions.csv';document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
  }
  function markNotification(id){if(!state.readNotifications.includes(id))state.readNotifications.push(id);saveState();renderNotifications();}
  function resetLocalData(){
    if(!window.confirm(t('confirmReset')))return;
    const language=state.language;const name=state.name;const email=state.email;
    state.transactions=[];state.beneficiaries=[];state.readNotifications=[];state.noticeDismissed=false;state.showNotices=true;state.language=language;state.name=name;state.email=email;noticeDismissed=false;
    saveState();$('#noticeToggle').checked=true;$('.prototype-banner').hidden=false;$('#transferForm').reset();$('#requestForm').reset();$('#beneficiaryForm').reset();$('#requestPreviewText').textContent=t('qrWillAppear');$('#copyRequest').disabled=true;renderAll();toast(t('resetDone'));
  }

  // Navigation and global controls.
  $$('.nav-item').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));
  $$('[data-go]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.go)));
  $('#menuBtn').addEventListener('click',openMobileMenu); $('#mobileScrim').addEventListener('click',closeMobileMenu);
  $('#notificationShortcut').addEventListener('click',()=>showView('notifications'));
  $('#profileShortcut').addEventListener('click',()=>showView('settings'));
  $('#language').addEventListener('change',event=>applyLanguage(event.target.value));
  $('#settingsLanguage').addEventListener('change',event=>applyLanguage(event.target.value));
  $('#toggleBalance').addEventListener('click',()=>{balanceHidden=!balanceHidden;updateMetrics();});
  $('#dismissBanner').addEventListener('click',()=>{noticeDismissed=true;state.noticeDismissed=true;saveState();$('.prototype-banner').hidden=true;});
  $('#noticeToggle').addEventListener('change',event=>{state.showNotices=event.target.checked;saveState();$('.prototype-banner').hidden=!event.target.checked||noticeDismissed;});
  $('#todayDate').textContent=new Date().toLocaleDateString(currentLang==='en'?'en-US':'fr-FR',{weekday:'short',day:'numeric',month:'short',year:'numeric'});

  // Transfer simulation.
  $('#transferForm').addEventListener('submit',event=>{event.preventDefault();openTransferModal();});
  $('#confirmTransferBtn').addEventListener('click',confirmTransfer);
  $('#closeModal').addEventListener('click',closeTransferModal); $('#cancelTransfer').addEventListener('click',closeTransferModal);
  $('#confirmModal').addEventListener('click',event=>{if(event.target===$('#confirmModal'))closeTransferModal();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeTransferModal();closeMobileMenu();stopCamera(false);}});

  // Payment QR preview and payment request.
  $('#paymentCodeForm').addEventListener('submit',checkPaymentCode);
  $('#startScanner').addEventListener('click',startCamera); $('#stopScanner').addEventListener('click',()=>stopCamera(true));
  $('#copyPaymentCode').addEventListener('click',()=>copyText(DEMO_QR_CODE));
  $('#requestForm').addEventListener('submit',createPaymentRequest);
  $('#copyRequest').addEventListener('click',()=>{const tx=state.transactions.find(item=>item.id===requestCode);if(tx)copyText(`LakayGoPay DEMO | ${tx.id} | ${money(tx.amount)} HTG | ${tx.description||''} | Code: ${DEMO_QR_CODE} | DEMO ONLY`);});

  // Beneficiaries.
  $('#beneficiaryForm').addEventListener('submit',addBeneficiary);
  $('#beneficiaryList').addEventListener('click',event=>{
    const remove=event.target.closest('[data-remove-contact]');const use=event.target.closest('[data-use-contact]');
    if(remove)removeBeneficiary(Number(remove.dataset.removeContact));
    if(use){const person=state.beneficiaries[Number(use.dataset.useContact)];if(person){$('#transferRecipient').value=person.phone;showView('transfer');}}
  });
  $('#beneficiarySuggestions').addEventListener('click',event=>{const button=event.target.closest('[data-suggest-phone]');if(button)$('#transferRecipient').value=button.dataset.suggestPhone;});

  // Activity, exports and local data.
  ['input','change'].forEach(type=>{$('#activitySearch').addEventListener(type,renderActivity);$('#activityType').addEventListener(type,renderActivity);$('#activityStatus').addEventListener(type,renderActivity);});
  $('#exportCsv').addEventListener('click',exportCsv);
  $('#clearDemoHistory').addEventListener('click',()=>{if(!window.confirm(t('confirmClear')))return;state.transactions=[];saveState();renderAll();toast(t('historyCleared'));});
  $('#notificationsList').addEventListener('click',event=>{const button=event.target.closest('[data-read-notification]');if(button)markNotification(button.dataset.readNotification);});
  $('#markAllRead').addEventListener('click',()=>{state.readNotifications=notificationItems.map(item=>item.id);saveState();renderNotifications();});

  // Profile and preferences.
  $('#profileForm').addEventListener('submit',event=>{event.preventDefault();const name=$('#profileName').value.trim();if(name.length<2){$('#profileMessage').textContent=t('invalidRecipient');return;}state.name=name;state.email=$('#profileEmail').value.trim();saveState();updateProfile();$('#profileMessage').textContent=t('profileSaved');});
  $('#resetLocalData').addEventListener('click',resetLocalData);

  // Initial render.
  if(noticeDismissed||!state.showNotices)$('.prototype-banner').hidden=true;
  $('#noticeToggle').checked=state.showNotices;
  renderQRNoise();applyLanguage(currentLang);renderAll();
  if('serviceWorker' in navigator && location.protocol.startsWith('http')){
    window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));
  }
})();
