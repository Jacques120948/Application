/** Catalogue de référence. Toute clé doit exister ici. */
export const fr = {
  'common.appName': 'Evoliia',
  'common.tagline':
    "Trouvez une idée. Créez-la. Lancez-la. Monétisez-la. Sans savoir coder.",
  'common.loading': 'Un instant…',
  'common.save': 'Enregistrer',
  'common.cancel': 'Annuler',
  'common.continue': 'Continuer',
  'common.back': 'Retour',
  'common.close': 'Fermer',
  'common.comingSoon': 'Bientôt disponible',
  'common.error': "Une erreur s'est produite.",
  'common.retry': 'Réessayer',

  'nav.dashboard': 'Mon projet',
  'nav.ideas': 'Mes idées',
  'nav.objective': 'Mon objectif',
  'nav.logout': 'Se déconnecter',
  'nav.login': 'Se connecter',
  'nav.register': 'Créer un compte',
  'nav.admin': 'Administration',
  'nav.radar': 'Radar',
  'nav.team': 'Équipe marketing',
  'nav.subscription': 'Abonnement',

  // ── Abonnement ───────────────────────────────────────────────────────────
  'subscription.title': 'Votre abonnement',
  'subscription.subtitle':
    'Changez d’offre quand vous voulez. Le paiement est confié à Stripe : Evoliia ne voit jamais votre carte.',
  'subscription.current': 'Offre actuelle',
  'subscription.statusFREE': 'Offre gratuite',
  'subscription.statusACTIVE': 'Active',
  'subscription.statusTRIALING': 'Période d’essai',
  'subscription.statusPAST_DUE': 'Paiement en attente',
  'subscription.statusCANCELED': 'Résiliée',
  'subscription.renewsOn': 'Renouvellement le {date}',
  'subscription.endsOn': 'Se termine le {date}',
  'subscription.cancelScheduled': 'Résiliation programmée : votre offre reste ouverte jusqu’à la fin de la période payée.',
  'subscription.pastDue':
    'Le dernier paiement n’a pas abouti. Mettez votre moyen de paiement à jour depuis le portail pour garder votre offre.',
  'subscription.manual':
    'Cette offre vous a été attribuée directement. Pour en changer, écrivez-nous.',
  'subscription.choose': 'Choisir cette offre',
  'subscription.change': 'Passer à cette offre',
  'subscription.yours': 'Votre offre',
  'subscription.free': 'Gratuit',
  'subscription.perMonth': 'par mois',
  'subscription.perYear': 'par an',
  'subscription.portal': 'Factures et moyen de paiement',
  'subscription.cancel': 'Résilier à la fin de la période',
  'subscription.resume': 'Reprendre mon abonnement',
  'subscription.working': 'Un instant…',
  'subscription.succeeded': 'Merci ! Votre offre est ouverte et vos crédits sont là.',
  'subscription.pending':
    'Paiement reçu. Votre offre s’ouvre dans quelques secondes ; rechargez la page si rien ne change.',
  'subscription.canceledCheckout': 'Paiement abandonné. Rien n’a été débité.',
  'subscription.unavailable':
    'Le paiement en ligne n’est pas activé sur cette installation. Les offres restent consultables ; la vôtre est attribuée par l’équipe.',
  'subscription.prorata':
    'Un changement d’offre en cours de période est calculé au prorata par Stripe.',
  'subscription.credits': '{count} crédits par mois',
  'subscription.projects': 'Jusqu’à {count} application(s)',
  'subscription.error': 'Cette opération n’a pas abouti.',
  'subscription.projectsOne': 'Une application',
  'subscription.noBuild': 'S’arrête avant la construction : idées, analyses et cahier des charges, sans mise en ligne',
  'subscription.build': 'Construction et mise en ligne',
  'subscription.install': 'Installable sur l’écran d’accueil des téléphones',
  'subscription.images': '{size} d’images à vous',
  'subscription.connections': '{count} connexion(s) à des services externes',
  'subscription.export': 'Export du site complet',
  'subscription.mobile': 'Dossier pour les boutiques mobiles',
  'subscription.radar': 'Radar d’opportunités : {count} recherche(s) par mois',
  'subscription.lia': 'Lia, support client dans vos applications : {count} réponses par mois',
  'subscription.liaConversations': '{count} conversations par mois',
  'subscription.groupCredits': 'Crédits',
  'subscription.groupCreate': 'Créer et mettre en ligne',
  'subscription.groupLaunch': 'Lancement et réseaux sociaux',
  'subscription.groupTeam': 'Équipe marketing',
  'subscription.groupRadar': 'Radar d’opportunités',
  'subscription.groupSupport': 'Lia, support client',
  'subscription.detailsTitle': 'Le détail de chaque offre',
  'subscription.detailsBody':
    'Tout ce que chaque offre contient, ligne par ligne, tel que réglé sur cette installation. Ce qui n’est pas encore construit n’y figure pas.',
  'subscription.showDetails': 'Voir tout ce que contient chaque offre',
  'subscription.hideDetails': 'Masquer le détail',
  'subscription.rowCredits': 'Crédits par mois',
  'subscription.creditsHint':
    'Les crédits paient les appels à l’IA : idées, analyses, construction, questions à l’équipe. Le prix est annoncé avant chaque action.',
  'subscription.rowProjects': 'Applications',
  'subscription.rowImages': 'Espace d’images',
  'subscription.rowConnections': 'Connexions externes',
  'subscription.connectionsHint': 'Stripe, Postelya, OpenAI, Gemini… avec vos propres comptes et vos propres clés.',
  'subscription.rowRadar': 'Recherches Radar par mois',
  'subscription.rowLia': 'Réponses de Lia par mois',
  'subscription.rowLiaConversations': 'Conversations Lia par mois',
  'subscription.included': 'Inclus',
  'subscription.recommended': 'Le plus choisi',
  'subscription.notIncluded': 'Non inclus',

  // ── Radar d'opportunités ─────────────────────────────────────────────────
  'radar.title': 'Radar d’opportunités',
  'radar.subtitle':
    'Découvrez des idées de projets adaptées à votre profil, vos compétences et vos objectifs.',
  'radar.basedOn': 'Basé sur votre profil Evoliia',
  'radar.editProfile': 'Modifier mon profil',
  'radar.improve': 'Améliorer mes recommandations',
  'radar.improveBody':
    'Quelques précisions facultatives. Rien de ce que vous avez déjà indiqué ne vous est redemandé.',
  'radar.search': 'Rechercher des opportunités',
  'radar.searching': 'Recherche en cours…',
  'radar.quota': '{used} sur {limit} recherches ce mois-ci',
  'radar.quotaReset': 'Le compteur repart le {date}.',
  'radar.quotaExceeded':
    'Vous avez utilisé toutes vos recherches du mois. Vos opportunités enregistrées restent consultables.',
  'radar.notIncluded': 'Le Radar n’est pas inclus dans votre offre.',
  'radar.availableWith': 'Disponible avec l’offre {plan}.',
  'radar.closed': 'Le Radar n’est pas ouvert sur cette installation pour le moment.',
  'radar.seeOffers': 'Voir les offres',
  'radar.aiUnavailable':
    'Le copilote n’est pas configuré sur cette installation : la recherche ne peut pas fonctionner.',
  'radar.empty': 'Aucune opportunité pour le moment',
  'radar.emptyBody':
    'Lancez une première recherche. Chaque opportunité vous dira pourquoi elle vous est proposée.',
  'radar.noNew': 'Rien de vraiment nouveau cette fois',
  'radar.noNewBody':
    'Les propositions ressemblaient trop à celles que vous avez déjà vues : elles ont été écartées plutôt que reproposées.',
  'radar.skipped': '{count} proposition(s) écartée(s) car trop proches de ce que vous aviez déjà vu.',
  'radar.score': 'Score Evoliia',
  'radar.scoreDisclaimer':
    'Le score Evoliia est une estimation destinée à aider à comparer des opportunités. Il ne garantit pas leur succès commercial.',
  'radar.sub.profileFit': 'Compatibilité profil',
  'radar.sub.demand': 'Demande',
  'radar.sub.monetization': 'Monétisation',
  'radar.sub.competition': 'Concurrence',
  'radar.sub.complexity': 'Complexité',
  'radar.why': 'Pourquoi Evoliia vous propose cette opportunité',
  'radar.whyNow': 'Pourquoi maintenant ?',
  'radar.whyNowInterpretation':
    'Interprétation d’Evoliia. Aucun signal extérieur n’a encore été observé pour cette opportunité.',
  'radar.keyAdvantage': 'Avantage principal',
  'radar.mainRisk': 'Risque principal',
  'radar.validationQuestions': 'À vérifier avant d’y croire',
  'radar.target': 'Cible',
  'radar.difficulty': 'Difficulté',
  'radar.budget': 'Coût de fonctionnement',
  'radar.model': 'Modèle',
  'radar.model.subscription': 'Abonnement',
  'radar.model.one_time': 'Achat unique',
  'radar.model.freemium': 'Gratuit puis payant',
  'radar.model.credits': 'Crédits',
  'radar.perMonth': ' / mois',
  'radar.perYear': ' / an',
  'radar.aroundProject': 'Chercher autour d’un projet',
  'radar.aroundProjectHint': 'Des opportunités voisines d’un projet existant : extension, déclinaison, service complémentaire.',
  'radar.chooseProject': 'Choisir un projet…',
  'radar.searchAround': 'Chercher autour de ce projet',
  'radar.alerts': 'Recherche automatique une fois par mois, avec un avis si le Radar trouve quelque chose.',
  'radar.alertsHint': 'Elle compte comme une recherche et coûte les mêmes crédits. Rien n’est lancé si votre quota ou votre solde ne le permet pas.',
  'radar.signals': 'Sources externes',
  'radar.signalConfigured': 'connectée',
  'radar.signalMissing': 'connexion externe requise pour activer cette partie',

  // ── Lia, côté visiteur ───────────────────────────────────────────────────
  'lia.needHelp': 'Besoin d’aide ?',
  'lia.open': 'Ouvrir l’assistance',
  'lia.close': 'Fermer',
  'lia.dialogLabel': 'Assistance — {name}',
  'lia.automated': 'Assistante automatique',
  'lia.placeholder': 'Écrivez votre question…',
  'lia.send': 'Envoyer',
  'lia.cancel': 'Annuler',
  'lia.thinking': 'Un instant…',
  'lia.unavailable': 'L’assistante est momentanément indisponible. Vous pouvez transmettre votre demande.',
  'lia.escalate': 'Transmettre ma demande',
  'lia.escalateHint': 'Votre demande sera lue par l’équipe de l’application. Ce n’est pas une réponse en direct.',
  'lia.emailOptional': 'Votre e-mail, pour recevoir la réponse (facultatif)',
  'lia.yourRequest': 'Votre demande',
  'lia.ticketSent': 'Votre demande a été transmise. Merci !',
  'lia.ticketError': 'La demande n’a pas pu être transmise. Réessayez dans un instant.',
  'lia.helpful': 'Cette réponse vous a-t-elle aidé ?',
  'lia.yes': 'Oui',
  'lia.no': 'Non',
  'lia.thanks': 'Merci pour votre retour.',
  'lia.fromTeam': 'Réponse de l’équipe',

  // ── Lia, côté créateur ───────────────────────────────────────────────────
  'support.title': 'Support',
  'support.loading': 'Chargement…',
  'support.closed': 'L’assistante support n’est pas ouverte sur cette installation pour le moment.',
  'support.locked': 'Lia — Support client n’est pas incluse dans votre offre.',
  'support.availableWith': 'Disponible avec l’offre {plan}.',
  'support.view.overview': 'Vue d’ensemble',
  'support.view.conversations': 'Conversations',
  'support.view.tickets': 'Demandes',
  'support.view.knowledge': 'Base de connaissances',
  'support.view.settings': 'Réglages',
  'support.view.insights': 'Ce que vos clients demandent',
  'support.active': 'Lia est active',
  'support.inactive': 'Lia est inactive',
  'support.overviewHint': 'Lia répond aux utilisateurs de votre application à partir de votre base de connaissances, et vous transmet le reste.',
  'support.configure': 'Configurer Lia',
  'support.last30': '30 derniers jours',
  'support.stat.conversations': 'Conversations',
  'support.stat.openTickets': 'Demandes ouvertes',
  'support.stat.answerRate': 'Réponses automatiques',
  'support.stat.answerRateHint': 'Part des réponses appuyées sur la base',
  'support.stat.unanswered': 'Sans réponse',
  'support.stat.satisfaction': 'Satisfaction',
  'support.stat.knowledge': 'Entrées publiées',
  'support.stat.knowledgeHint': '{draft} en brouillon',
  'support.stat.categories': 'Catégories fréquentes',
  'support.quota': '{answersUsed} sur {answersLimit} réponses et {conversationsUsed} sur {conversationsLimit} conversations ce mois-ci. Le compteur repart le {date}.',
  'support.emptyOverview': 'Aucune conversation pour le moment',
  'support.emptyOverviewBody': 'Publiez une base de connaissances, activez Lia, et les échanges apparaîtront ici.',
  'support.emptyConversations': 'Aucune conversation',
  'support.emptyConversationsBody': 'Les questions posées à Lia dans votre application s’afficheront ici.',
  'support.emptyTickets': 'Aucune demande transmise',
  'support.emptyTicketsBody': 'Quand Lia ne sait pas répondre, l’utilisateur peut vous transmettre sa demande. Elle arrivera ici.',
  'support.emptyKnowledge': 'La base est vide',
  'support.emptyKnowledgeBody': 'Ajoutez des questions-réponses à la main, ou laissez Evoliia en proposer à partir de votre application. Vous relisez avant de publier.',
  'support.emptyInsights': 'Aucune analyse pour le moment',
  'support.emptyInsightsBody': 'Lancez une analyse des conversations des trente derniers jours pour voir ce qui revient.',
  'support.allStatuses': 'Tous les statuts',
  'support.status.open': 'Ouverte',
  'support.status.escalated': 'Transmise',
  'support.status.closed': 'Terminée',
  'support.messages': '{count} message(s)',
  'support.noPreview': '(sans message)',
  'support.back': 'Retour',
  'support.close': 'Terminer',
  'support.delete': 'Supprimer',
  'support.confirmDelete': 'Supprimer définitivement cette conversation ?',
  'support.confirmDeleteEntry': 'Supprimer cette entrée ?',
  'support.role.visitor': 'Utilisateur',
  'support.role.lia': 'Lia',
  'support.role.owner': 'Vous',
  'support.notGrounded': 'sans appui dans la base',
  'support.priority.low': 'Faible',
  'support.priority.normal': 'Normale',
  'support.priority.high': 'Haute',
  'support.statusLabel': 'Statut',
  'support.ticket.open': 'Ouverte',
  'support.ticket.in_progress': 'En cours',
  'support.ticket.resolved': 'Résolue',
  'support.ticket.closed': 'Fermée',
  'support.reply': 'Répondre',
  'support.replyPlaceholder': 'Votre réponse à l’utilisateur…',
  'support.replySent': 'Réponse enregistrée et envoyée par e-mail.',
  'support.replySaved': 'Réponse enregistrée dans la conversation. Aucune adresse e-mail : elle n’a pas été envoyée.',
  'support.cancel': 'Annuler',
  'support.save': 'Enregistrer',
  'support.knowledgeHint': 'Lia ne répond qu’à partir des entrées publiées. Un brouillon n’est jamais utilisé.',
  'support.addEntry': 'Ajouter une question-réponse',
  'support.generate': 'Proposer une FAQ avec Evoliia',
  'support.generating': 'Rédaction en cours…',
  'support.generated': 'Propositions ajoutées en brouillon ({count} crédits). Relisez-les avant de publier.',
  'support.generatedTag': 'proposée par Evoliia',
  'support.publish': 'Publier',
  'support.disable': 'Désactiver',
  'support.edit': 'Modifier',
  'support.entry.draft': 'Brouillon',
  'support.entry.published': 'Publiée',
  'support.entry.disabled': 'Désactivée',
  'support.field.question': 'Question',
  'support.field.answer': 'Réponse',
  'support.field.answerHint': 'Ce que Lia dira, mot pour mot ou presque. Pas de promesse que vous ne tiendriez pas.',
  'support.field.keywords': 'Mots-clés',
  'support.field.keywordsHint': 'Les mots qu’un utilisateur emploierait, séparés par des virgules.',
  'support.field.status': 'Statut',
  'support.enable': 'Activer Lia dans mon application',
  'support.enableHint': 'Un bouton « Besoin d’aide ? » apparaît dans votre application publiée. Les réponses coûtent vos crédits.',
  'support.field.displayName': 'Nom affiché',
  'support.field.greeting': 'Message d’accueil',
  'support.field.position': 'Position du bouton',
  'support.position.right': 'En bas à droite',
  'support.position.left': 'En bas à gauche',
  'support.field.accentColor': 'Couleur',
  'support.field.accentColorHint': 'Vide : la couleur principale de votre application.',
  'support.field.escalationEmail': 'E-mail pour les demandes transmises',
  'support.field.escalationEmailHint': 'Vide : l’adresse de votre compte, si vous acceptez ces avis.',
  'support.field.retentionDays': 'Conservation des conversations (jours)',
  'support.field.retentionDaysHint': 'Passé ce délai, les conversations sont effacées, sauf celles liées à une demande encore ouverte.',
  'support.settingsSaved': 'Réglages enregistrés.',
  'support.insightsHint': 'Une analyse par lot des conversations récentes : questions fréquentes, demandes de fonctions, problèmes possibles, lacunes de la base. Rien n’est modifié dans votre application sans vous.',
  'support.analyze': 'Analyser les conversations',
  'support.analyzing': 'Analyse en cours…',
  'support.analyzed': '{count} conversation(s) analysée(s).',
  'support.requests': '{count} demande(s)',
  'support.kind.frequent_question': 'Question fréquente',
  'support.kind.feature_request': 'Demande de fonction',
  'support.kind.potential_bug': 'Problème possible',
  'support.kind.unanswered': 'Sans réponse',
  'support.insightDisclaimer': 'Lecture automatique des conversations : à vérifier avant d’agir. Un problème possible n’est pas un bug confirmé.',
  'support.toRoadmap': 'Ajouter à la feuille de route',
  'support.onRoadmap': 'Sur la feuille de route',
  'support.toBuilder': 'Préparer avec Evoliia',
  'support.dismiss': 'Ignorer',
  'support.category.usage': 'Utilisation',
  'support.category.account': 'Compte et connexion',
  'support.category.billing': 'Abonnement et paiement',
  'support.category.bug': 'Problème',
  'support.category.feature': 'Fonctionnalité',
  'support.category.other': 'Autre',
  'dashboard.radarNew': 'Le Radar a {count} nouvelle(s) opportunité(s) pour vous.',
  'dashboard.radarNone': 'Aucune nouvelle opportunité dans le Radar.',
  'dashboard.radarOpen': 'Ouvrir le Radar',
  'radar.delay': 'Délai',
  'radar.weeks': '{count} semaines',
  'radar.customers': 'environ {count} clients pour votre objectif',
  'radar.viewAnalysis': 'Voir l’analyse',
  'radar.analyze': 'Analyser cette idée',
  'radar.createProject': 'Créer un projet',
  'radar.save': 'Enregistrer',
  'radar.saved': 'Enregistrée',
  'radar.reject': 'Pas pour moi',
  'radar.archive': 'Archiver',
  'radar.restore': 'Remettre en vue',
  'radar.rejectWhy': 'Pourquoi ? (facultatif)',
  'radar.reason.too_complex': 'Trop compliqué',
  'radar.reason.not_my_sector': 'Pas mon secteur',
  'radar.reason.too_competitive': 'Trop concurrentiel',
  'radar.reason.too_expensive': 'Budget trop important',
  'radar.reason.no_b2b': 'Je n’aime pas vendre aux entreprises',
  'radar.reason.other': 'Autre',
  'radar.interested': 'Ça m’intéresse',
  'radar.compare': 'Comparer',
  'radar.compareHint': 'Sélectionnez jusqu’à 3 opportunités.',
  'radar.compareTitle': 'Comparaison',
  'radar.compareSynthesis': 'Synthèse',
  'radar.compareCaution': 'À garder en tête',
  'radar.compareCost': 'La synthèse coûte environ {count} crédits.',
  'radar.section.new': 'Nouvelles',
  'radar.section.saved': 'Opportunités enregistrées',
  'radar.section.converted': 'Devenues des projets',
  'radar.section.rejected': 'Écartées',
  'radar.section.archived': 'Archivées',
  'radar.history': 'Historique des recherches',
  'radar.historyLine': '{count} opportunité(s) · {credits} crédits',
  'radar.trigger.manual': 'À votre demande',
  'radar.trigger.scheduled': 'Veille automatique',
  'radar.trigger.project': 'Autour d’un projet',
  'radar.estimate': 'Estimation',
  'radar.searchCost': 'Une recherche coûte environ {count} crédits.',
  'radar.status.PROPOSED': 'Nouvelle',
  'radar.status.SAVED': 'Enregistrée',
  'radar.status.SELECTED': 'Projet créé',
  'radar.status.DISCARDED': 'Écartée',
  'radar.status.ARCHIVED': 'Archivée',
  'radar.field.experienceYears': 'Années d’expérience',
  'radar.field.knownSectors': 'Secteurs que vous connaissez',
  'radar.field.technicalLevel': 'Niveau technique',
  'radar.field.entrepreneurExperience': 'Expérience entrepreneuriale',
  'radar.field.marketScope': 'Marché visé',
  'radar.field.productPreference': 'Type de produit préféré',
  'radar.field.willingToProspect': 'Prêt à prospecter ?',
  'radar.level.debutant': 'Débutant',
  'radar.level.intermediaire': 'Intermédiaire',
  'radar.level.avance': 'Avancé',
  'radar.exp.aucune': 'Aucune',
  'radar.exp.premiere': 'Première',
  'radar.exp.confirmee': 'Confirmée',
  'radar.scope.local': 'Local',
  'radar.scope.francophone': 'Francophone',
  'radar.scope.international': 'International',
  'radar.product.saas': 'SaaS',
  'radar.product.application': 'Application',
  'radar.product.outil_metier': 'Outil métier',
  'radar.product.marketplace': 'Marketplace',
  'radar.product.indifferent': 'Indifférent',
  'radar.yes': 'Oui',
  'radar.no': 'Non',
  'radar.unknown': 'Je ne sais pas',
  'radar.saveProfile': 'Enregistrer mes précisions',
  'radar.profileSaved': 'Précisions enregistrées.',
  'radar.error': 'La recherche n’a pas abouti.',
  'radar.timeout':
    'La recherche a pris trop de temps et a été interrompue avant de répondre. Aucune recherche ne vous a été comptée : réessayez dans un instant.',

  // ── Navigation et référencement ──────────────────────────────────────────
  'landing.navHow': 'Comment ça marche',
  'landing.navExamples': 'Exemples',
  'landing.navFeatures': 'Fonctionnalités',
  'landing.navPricing': 'Tarifs',
  'landing.navStart': 'Commencer',
  'landing.navOpenMenu': 'Ouvrir le menu',
  'landing.metaTitle': 'Evoliia | Trouvez, créez et lancez votre application avec l’IA',
  'landing.metaDescription':
    "Evoliia vous aide à trouver une idée d’application, analyser son potentiel, la créer sans coder et préparer son lancement. De l’idée au projet, accompagné par l’IA.",

  // ── Premier écran ────────────────────────────────────────────────────────
  'landing.eyebrow': 'L’IA qui vous aide à trouver, créer et lancer votre application',
  'landing.heroTitle': 'Vous voulez lancer une application.',
  'landing.heroTitleAccent': 'Même si vous ne savez pas encore laquelle.',
  'landing.heroBody':
    "Evoliia analyse votre profil, trouve des idées adaptées, vérifie leur potentiel, construit votre application et vous aide à préparer son lancement.",
  'landing.heroSub': 'Aucune ligne de code. Aucune idée nécessaire pour commencer.',
  'landing.ctaFindIdea': 'Trouver mon idée gratuitement',
  'landing.ctaHaveIdea': 'J’ai déjà une idée',
  'landing.heroNote': 'Gratuit pour commencer · Simple · Sans coder',
  'landing.heroBeta':
    "Evoliia est en bêta privée : un code d’accès est nécessaire pour créer un compte.",
  'landing.heroShotsCaption': 'Applications de démonstration réellement créées avec Evoliia.',

  // ── Le parcours, en un coup d'œil ────────────────────────────────────────
  'landing.flowTitle': 'Une envie suffit. Evoliia s’occupe du reste.',
  'landing.flowBody':
    "Vous n’avez pas besoin d’arriver avec un cahier des charges. Vous arrivez avec une envie, et chaque étape prépare la suivante.",
  'landing.flow1Title': 'Votre profil',
  'landing.flow1Body': 'Votre métier, votre temps, votre budget, votre objectif.',
  'landing.flow2Title': 'Des idées adaptées',
  'landing.flow2Body': 'Plusieurs pistes qui correspondent à ce que vous savez faire.',
  'landing.flow3Title': 'Analyse du potentiel',
  'landing.flow3Body': 'Demande, concurrence, obligations, coûts cachés.',
  'landing.flow4Title': 'Création',
  'landing.flow4Body': 'L’application est construite, puis modifiée en conversation.',
  'landing.flow5Title': 'Lancement',
  'landing.flow5Body': 'Mise en ligne, prix, et de quoi parler de votre projet.',

  // ── Vous n'avez pas encore d'idée ────────────────────────────────────────
  'landing.noIdeaTitle': 'Vous n’avez même pas besoin d’avoir une idée.',
  'landing.noIdeaBody':
    "Parlez-nous simplement de vous, de vos compétences, du temps que vous pouvez consacrer à votre projet, de votre budget et de votre objectif. Evoliia peut ensuite proposer des idées adaptées à votre profil.",
  'landing.noIdeaDemoLabel': 'Exemple de démonstration',
  'landing.noIdeaAnalysing': 'Evoliia analyse votre profil…',
  'landing.profileLabel': 'Votre profil',
  'landing.profileJob': 'Métier',
  'landing.profileJobValue': 'Boulanger',
  'landing.profileExperience': 'Expérience',
  'landing.profileExperienceValue': '12 ans',
  'landing.profileTime': 'Temps disponible',
  'landing.profileTimeValue': '4 h par semaine',
  'landing.profileBudget': 'Budget',
  'landing.profileBudgetValue': '100 €',
  'landing.profileGoal': 'Objectif',
  'landing.profileGoalValue': '500 € par mois',
  'landing.suggestionLabel': 'Idée proposée',
  'landing.suggestionName': 'Calculateur de coûts et de marges pour petites boulangeries',
  'landing.suggestionScore': 'Potentiel estimé par Evoliia',
  'landing.suggestionScoreValue': '82 sur 100',
  'landing.suggestionDifficulty': 'Difficulté',
  'landing.suggestionDifficultyValue': 'Facile',
  'landing.suggestionMarket': 'Marché potentiel',
  'landing.suggestionMarketValue': 'Boulangeries indépendantes',
  'landing.suggestionModel': 'Modèle économique possible',
  'landing.suggestionModelValue': 'Abonnement, 14,90 € par mois',
  'landing.suggestionTime': 'Temps de réalisation',
  'landing.suggestionTimeValue': 'Quelques jours',
  'landing.suggestionCompetition': 'Concurrence',
  'landing.suggestionCompetitionValue': 'Peu d’outils dédiés',
  'landing.suggestionCta': 'Trouver des idées adaptées à mon profil',
  'landing.suggestionDisclaimer':
    "Exemple de démonstration, pas un profil réel. Le potentiel est une estimation d’Evoliia, jamais une prévision ni une garantie de revenu.",

  // ── Les trois portes d'entrée ────────────────────────────────────────────
  'landing.doorsTitle': 'Où en êtes-vous aujourd’hui ?',
  'landing.doorsBody': 'Les trois chemins mènent au même endroit : un projet à vous.',
  'landing.door1Title': 'Je n’ai aucune idée',
  'landing.door1Body':
    "Evoliia analyse votre profil et vous aide à découvrir des opportunités adaptées à vos compétences, votre temps et votre budget.",
  'landing.door1Cta': 'Trouver mon idée',
  'landing.door2Title': 'J’ai déjà une idée',
  'landing.door2Body':
    "Décrivez votre projet. Evoliia vous aide à analyser son potentiel, clarifier le concept et préparer sa création.",
  'landing.door2Cta': 'Analyser mon idée',
  'landing.door3Title': 'Je veux créer un revenu complémentaire',
  'landing.door3Body':
    "Partez de votre objectif financier et découvrez quels types de projets pourraient correspondre à votre situation.",
  'landing.door3Cta': 'Explorer les possibilités',

  // ── Ce qu'un objectif de revenu représente, en clients ───────────────────
  'landing.projectsTitle': 'Ce qu’un objectif représente, en clients',
  'landing.projectsBody':
    "Chaque idée proposée est chiffrée de la même façon : un prix, et le nombre de clients qu’il faudrait pour atteindre votre objectif.",
  'landing.projectsGoal': 'Pour 1 000 € de chiffre d’affaires mensuel',
  'landing.projectsCustomers': 'environ {count} clients',
  'landing.projectsDifficulty': 'Difficulté',
  'landing.projectsNote':
    "Exemples purement arithmétiques, calculés à partir du prix affiché. Ce ne sont ni des prévisions, ni des garanties de revenu.",
  'landing.project1Name': 'Assistant devis pour artisans',
  'landing.project2Name': 'Application de suivi d’entraînement',
  'landing.project3Name': 'Gestion de locations saisonnières',
  'landing.project4Name': 'Fiches éducatives pour les familles',
  'landing.difficultyEasy': 'Facile',
  'landing.difficultyMedium': 'Moyenne',

  // ── Un projet, pas seulement une application ─────────────────────────────
  'landing.projectTitle': 'Pas seulement une application.',
  'landing.projectTitleAccent': 'Un projet à lancer.',
  'landing.projectLead':
    "Les outils classiques commencent lorsque vous savez déjà quoi construire. Evoliia peut vous accompagner avant même que vous ayez trouvé votre idée.",
  'landing.projectLead2':
    "Il vous aide ensuite à structurer le projet, construire l’application et préparer les premières actions pour la faire connaître.",
  'landing.timeline1': 'Idée',
  'landing.timeline2': 'Validation',
  'landing.timeline3': 'Application',
  'landing.timeline4': 'Modèle économique',
  'landing.timeline5': 'Lancement',
  'landing.timeline6': 'Acquisition',
  'landing.timelineEvoliia': 'Evoliia vous accompagne sur toute cette ligne, dès l’idée.',
  'landing.timelineOthers':
    'Un générateur d’applications, lui, commence à l’étape « Application ».',

  // ── Les démonstrations ───────────────────────────────────────────────────
  'landing.showcaseTitle': 'Créé avec Evoliia, en ligne aujourd’hui',
  'landing.showcaseBody':
    "Six applications, six métiers, six styles. Chacune a été décrite en quelques phrases, construite par Evoliia, et publiée telle quelle. Ouvrez-les, cliquez partout : ce sont de vraies applications, pas des images.",
  'landing.showcaseMobileLabel': 'La même application sur téléphone',
  'landing.buildOpen': 'Voir la démo',
  'landing.buildSimilar': 'Créer la mienne',
  'landing.showcaseDemoNote': 'Exemples de démonstration créés avec Evoliia, pas des clients.',
  'landing.showcaseNote':
    "Ce sont des applications web. Sur téléphone, elles s’ajoutent à l’écran d’accueil depuis le navigateur : icône, nom, ouverture en plein écran, sans barre d’adresse. Elles ne passent pas par l’App Store ni par Google Play, où ces boutiques décident seules et où nous ne promettons rien à leur place.",

  // ── Les cinq temps du parcours ───────────────────────────────────────────
  'landing.howTitle': 'De votre première idée à votre lancement',
  'landing.howBody':
    "Cinq temps, dans cet ordre. Chacun sert à ne pas gaspiller le suivant : on ne construit qu’une fois la question du client réglée.",
  'landing.step1Title': 'Comprendre votre objectif',
  'landing.step1Body':
    'Evoliia commence par votre situation et ce que vous voulez accomplir.',
  'landing.step2Title': 'Trouver ou analyser une idée',
  'landing.step2Body':
    'Découvrez des opportunités, ou testez le potentiel de votre propre idée.',
  'landing.step3Title': 'Structurer le projet',
  'landing.step3Body': 'Cible, fonctionnalités, modèle économique et positionnement.',
  'landing.step4Title': 'Construire',
  'landing.step4Body':
    'Transformez le projet en application, sans avoir besoin de coder.',
  'landing.step5Title': 'Préparer le lancement',
  'landing.step5Body':
    'Evoliia vous aide à réfléchir au prix, au positionnement et aux premières actions marketing.',

  // ── Ce que la plateforme sait faire ──────────────────────────────────────
  'landing.featuresTitle': 'Ce qu’Evoliia sait faire',
  'landing.featuresBody':
    "Vous décrivez ce que vous voulez, en français, comme vous le diriez à quelqu’un. Evoliia construit l’application, puis vous la modifiez en continuant la conversation.",
  'landing.oneLinePromptLabel': 'Ce que vous écrivez',
  'landing.oneLinePrompt':
    'Je voudrais une application où chacun peut publier ses recettes et enregistrer ses favorites.',
  'landing.oneLineResultLabel': 'Ce qu’Evoliia a construit',
  'landing.oneLineFeature1': 'Plusieurs pages reliées entre elles',
  'landing.oneLineFeature2': 'Espace membre',
  'landing.oneLineFeature3': 'Base de données',
  'landing.oneLineFeature4': 'Recettes publiées et consultables',
  'landing.oneLineFeature5': 'Lisible sur téléphone',
  'landing.oneLineFeature6': 'Modifiable en conversation',
  'landing.oneLineEditTitle': 'Ensuite, vous continuez en parlant',
  'landing.oneLineEditBody':
    'Exemples de demandes que l’éditeur accepte. Chacune modifie l’application et crée une nouvelle version, que vous pouvez annuler.',
  'landing.oneLineEdit1': 'Mets le bouton principal en bleu.',
  'landing.oneLineEdit2': 'Ajoute une offre Premium à 9,90 € par mois.',
  'landing.oneLineEdit3': 'Ajoute une page À propos.',
  'landing.oneLineOpen': 'Ouvrir cette application',

  // ── Préparer son lancement ───────────────────────────────────────────────
  'landing.launchTitle': 'Une fois en ligne, il faut se faire connaître',
  'landing.launchBody':
    "C’est là que la plupart des projets s’arrêtent : l’application existe, et personne ne sait quoi en dire. Evoliia prépare de quoi commencer, sans vous demander de tout réécrire.",
  'landing.launchAnglesTitle': 'Vos angles marketing',
  'landing.launchAnglesBody':
    "Plusieurs façons de présenter la même application : le gain de temps, le problème évité, le résultat obtenu. Vous gardez celles qui vous ressemblent, vous écartez les autres.",
  'landing.launchIdeasTitle': 'Sept idées de publications',
  'landing.launchIdeasBody':
    "Chacune avec son accroche, ce qu’il faut montrer et dire, et la photo ou la vidéo à préparer. De quoi tenir une première semaine sans chercher quoi publier.",
  'landing.launchWeekTitle': 'Votre première semaine',
  'landing.launchWeekBody':
    "Sept publications datées, rédigées, avec leur appel à l’action. Chaque texte est modifiable directement, puis vous approuvez ce qui vous convient.",
  'landing.launchSourceTitle': 'Rien ne vous est redemandé',
  'landing.launchSourceBody':
    "Le problème que vous résolvez, votre clientèle, votre proposition de valeur, votre prix : tout vient de ce que vous avez déjà écrit pendant le parcours. Aucun formulaire de plus.",
  'landing.launchLimitTitle': 'Ce que nous ne faisons pas',
  'landing.launchLimitBody':
    "Rien n’est publié, rien n’est programmé : les réseaux sociaux ne sont pas reliés. Le kit se relit, se corrige et se copie. Aucune statistique n’est inventée, et aucun avis client n’est écrit à votre place.",
  'landing.launchSendTitle': 'Puis vous l’envoyez',
  'landing.launchSendBody':
    "Une fois la semaine approuvée, elle part en un clic dans votre espace Postelya, où vous choisissez le moment de chaque publication. Rien ne part sans votre accord. Aucune statistique n’est inventée, et aucun avis client n’est écrit à votre place.",
  'landing.launchIncluded': 'Compris à partir de l’offre Launch.',

  'landing.teamTitle': 'Votre équipe marketing,',
  'landing.teamTitleAccent': 'trois spécialistes qui lisent vos vraies données.',
  'landing.teamBody':
    'Une fois votre application en ligne, Tom, Noah et Mila la prennent en main avec vous. Chacun a son métier et son périmètre : il ne lit que ce qui le concerne dans votre projet, et il le dit quand une donnée manque plutôt que de l’inventer.',
  'landing.teamAiLabel': 'Spécialiste IA',
  'landing.teamAskLabel': 'Par exemple',
  'landing.team_socialRole': 'Réseaux sociaux',
  'landing.team_socialBody':
    'Il connaît votre kit de lancement, ce que vous avez approuvé et ce qui est déjà parti. Il prépare la suite plutôt que de recommencer.',
  'landing.team_socialAsk': 'Que devrais-je publier la semaine prochaine ?',
  'landing.team_seoRole': 'Référencement',
  'landing.team_seoBody':
    'Il lit les pages réellement publiées : leurs titres, leurs textes, leurs adresses. Il dit ce qui manque pour être trouvé.',
  'landing.team_seoAsk': 'Sur quels mots pourrais-je être trouvé ?',
  'landing.team_analyticsRole': 'Analyse',
  'landing.team_analyticsBody':
    'Elle lit vos chiffres réels : visites, pages consultées, inscriptions, données enregistrées. Elle ne devine rien.',
  'landing.team_analyticsAsk': 'Que disent mes chiffres des trente derniers jours ?',
  'landing.teamLinkTitle': 'Une équipe, pas trois guichets',
  'landing.teamLinkBody':
    'Avec l’équipe reliée, chacun reçoit la dernière conclusion de ses collègues : Mila constate qu’une page attire, Tom le sait à votre question suivante. Chaque question coûte des crédits, annoncés sur le bouton avant de la poser.',
  'landing.teamHonestTitle': 'Ce qu’ils ne font pas',
  'landing.teamHonestBody':
    'Ce sont des assistants IA, pas des personnes. Ils ne publient rien à votre place, n’inventent aucun chiffre et ne garantissent aucun résultat : quand la donnée n’existe pas encore, ils vous le disent.',
  'landing.teamCta': 'Rencontrer mon équipe',
  'landing.teamCtaNote': 'Gratuit pour commencer. L’équipe s’ouvre avec les offres qui l’incluent.',

  // ── Vitrine des modules ───────────────────────────────────────────────────
  'landing.navModules': 'Modules',
  'landing.modulesEyebrow': 'Tout ce qu’Evoliia met entre vos mains',
  'landing.modulesTitle': 'Une plateforme complète,',
  'landing.modulesTitleAccent': 'de la première idée au premier client fidèle.',
  'landing.modulesBody': 'Chaque module a été construit pour une étape précise du parcours, et tous partagent le même profil, le même projet, les mêmes crédits. Voici la vue d’ensemble, captures réelles à l’appui.',
  'landing.modulesAllPlans': 'Toutes les offres',
  'landing.modulesFrom': 'Dès l’offre {plan}',
  'landing.modulesGridTitle': 'Et le reste, module par module',
  'landing.modulesGridBody': 'Rien n’est caché derrière une démonstration commerciale : voici chaque module tel qu’il existe aujourd’hui dans l’application.',
  'landing.modRadarEyebrow': 'Radar d’opportunités',
  'landing.modRadarTitle': 'Trouvez quoi créer, avant même d’avoir une idée.',
  'landing.modRadarBody': 'Le Radar lit votre profil — métier, compétences, temps, budget, objectif — et cherche des opportunités qui vous ressemblent. Chacune est notée, expliquée, comparable et transformable en projet.',
  'landing.modRadar1': 'Un score Evoliia sur 100, avec ses cinq composantes visibles : demande, concurrence, monétisation, complexité, compatibilité avec vous',
  'landing.modRadar2': '« Pourquoi Evoliia vous propose cette opportunité » : les raisons, l’avantage clé, le risque principal, les questions à poser',
  'landing.modRadar3': 'Enregistrez, rejetez, archivez, comparez jusqu’à trois opportunités avec une synthèse par priorité',
  'landing.modRadar4': '« Analyser cette idée » et « Créer un projet » enchaînent directement sur le parcours',
  'landing.modRadarLink': 'Voir comment le score est calculé',
  'landing.modBuildEyebrow': 'Constructeur',
  'landing.modBuildTitle': 'Décrivez, et l’application existe. Parlez, et elle change.',
  'landing.modBuildBody': 'Une phrase suffit pour une première version. Ensuite, chaque demande — une couleur, une page, une offre payante — devient une nouvelle version que vous pouvez annuler. L’aperçu montre la vraie application, sur téléphone, tablette et ordinateur.',
  'landing.modBuild1': 'Design, images, fonctionnalités et monétisation réglables sans écrire une ligne',
  'landing.modBuild2': 'Comptes utilisateurs, formulaires et données, assistant intégré à votre application',
  'landing.modBuild3': 'Tests automatiques, versions, publication en un clic — installable sur l’écran d’accueil',
  'landing.modBuild4': 'Export du site complet et dossier pour les boutiques mobiles, selon l’offre',
  'landing.modLiaEyebrow': 'Lia — support client',
  'landing.modLiaTitle': 'Vos utilisateurs posent leurs questions. Lia répond, ou vous transmet.',
  'landing.modLiaBody': 'Lia s’installe dans l’application que vous avez créée. Elle ne répond qu’à partir de la base de connaissances que vous avez validée ; quand elle ne sait pas, elle le dit et transmet la demande. Vous gardez la main sur tout.',
  'landing.modLia1': 'Base de connaissances à la main ou proposée par Evoliia — publiée seulement après votre relecture',
  'landing.modLia2': 'Aucune réponse inventée : hors de la base, Lia propose « Transmettre ma demande »',
  'landing.modLia3': 'Tableau de bord : conversations, demandes classées et priorisées, satisfaction, questions sans réponse',
  'landing.modLia4': 'Quotas mensuels, plafond journalier et limites par visiteur : vos crédits sont protégés',
  'landing.modLaunchEyebrow': 'Lancement et équipe marketing',
  'landing.modLaunchTitle': 'Une fois en ligne, vous n’êtes pas seul pour la faire connaître.',
  'landing.modLaunchBody': 'Le kit de lancement part de ce que vous avez déjà écrit et prépare vos angles, sept idées de publications et votre première semaine. Puis trois spécialistes lisent vos données réelles et vous conseillent — sans jamais inventer un chiffre.',
  'landing.modLaunch1': 'Kit de lancement : angles marketing, sept publications rédigées, calendrier de la première semaine',
  'landing.modLaunch2': 'Atelier social : variations d’une publication, calendrier du mois',
  'landing.modLaunch3': 'Tom, Noah et Mila : réseaux sociaux, référencement, lecture des résultats',
  'landing.modLaunch4': 'Chacun dit ce qui manque plutôt que de le deviner',
  'landing.tileGoalTitle': 'Objectif',
  'landing.tileGoalBody': 'Votre revenu visé, votre temps, votre budget et vos compétences : le point de départ de tout le reste.',
  'landing.tileIdeasTitle': 'Idées chiffrées',
  'landing.tileIdeasBody': 'Des idées adaptées à votre profil, chacune avec un prix conseillé et le nombre de clients nécessaires.',
  'landing.tileAnalysisTitle': 'Analyse d’idée',
  'landing.tileAnalysisBody': 'Demande, concurrence, risques, coûts cachés : une étude honnête avant de construire.',
  'landing.tileSpecTitle': 'Cahier des charges',
  'landing.tileSpecBody': 'Ce que fera la première version, et ce qui attendra. Vous validez avant la construction.',
  'landing.tileBuildTitle': 'Constructeur par conversation',
  'landing.tileBuildBody': 'Décrivez en français, corrigez en parlant. Chaque demande crée une version que vous pouvez annuler.',
  'landing.tileDesignTitle': 'Design et images',
  'landing.tileDesignBody': 'Couleurs, police, arrondis, vos propres images : l’identité de votre application, sans outil graphique.',
  'landing.tileUsersTitle': 'Comptes et données',
  'landing.tileUsersBody': 'Vos utilisateurs créent un compte, remplissent des formulaires, retrouvent leurs données.',
  'landing.tileMoneyTitle': 'Monétisation',
  'landing.tileMoneyBody': 'Gratuit, abonnement, achat unique ou crédits : vous définissez les offres de votre application.',
  'landing.tileTestsTitle': 'Tests et versions',
  'landing.tileTestsBody': 'Un score de préparation avant la mise en ligne, et un historique de versions restaurables.',
  'landing.tilePublishTitle': 'Publication',
  'landing.tilePublishBody': 'Une adresse à partager, installable sur l’écran d’accueil des téléphones, avec le suivi des visites.',
  'landing.tileExportTitle': 'Export et mobile',
  'landing.tileExportBody': 'Téléchargez votre site complet, et un dossier prêt pour les boutiques d’applications.',
  'landing.tileConnectTitle': 'Connexions',
  'landing.tileConnectBody': 'Votre propre clé d’IA pour l’assistant de vos applications, votre espace Postelya pour publier. Google Drive, Sheets, Agenda, Stripe, Notion et Dropbox sont annoncés, pas encore branchés.',
  'landing.tileCoachTitle': 'Coach intégré',
  'landing.tileCoachBody': 'À chaque écran, un coach qui sait où vous en êtes et vous dit quoi faire ensuite.',
  'landing.tileDashboardTitle': 'Tableau de bord',
  'landing.tileDashboardBody': 'Votre objectif, vos crédits, votre parcours et vos applications en ligne, en un coup d’œil.',
  'landing.tileRadarTitle': 'Radar d’opportunités',
  'landing.tileRadarBody': 'Des opportunités notées et expliquées, à comparer, enregistrer ou transformer en projet.',
  'landing.tileLiaTitle': 'Lia — support client',
  'landing.tileLiaBody': 'Une assistante dans vos applications, qui répond depuis votre base de connaissances et transmet le reste.',
  'landing.tileKitTitle': 'Kit de lancement',
  'landing.tileKitBody': 'Angles, sept publications et première semaine, préparés à partir de votre projet.',
  'landing.tileTeamTitle': 'Équipe marketing',
  'landing.tileTeamBody': 'Trois spécialistes qui lisent vos données réelles : réseaux sociaux, référencement, analyse.',
  'landing.tileBlocksTitle': 'Blocs prêts à l’emploi',
  'landing.tileBlocksBody': 'Accueil, texte, fonctionnalités, FAQ, chiffres, appel à l’action, tarifs, formulaire, liste de données, compte, assistant : onze blocs que l’IA assemble et que vous réglez.',
  'landing.tileSecurityTitle': 'Sécurité et données',
  'landing.tileSecurityBody': 'Chaque compte et chaque application sont cloisonnés jusque dans la base. Vos secrets sont chiffrés côté serveur. Vous pouvez tout supprimer.',
  'landing.tileLanguagesTitle': 'Français et anglais',
  'landing.tileLanguagesBody': 'L’interface existe dans les deux langues, et votre application est créée dans celle que vous utilisez.',

  // ── Tarifs ───────────────────────────────────────────────────────────────
  'landing.pricingTitle': 'Combien ça coûte',
  'landing.pricingBody':
    "Vous ne payez qu’au moment de construire. Définir votre objectif, recevoir des idées et en faire analyser une ne coûte rien.",
  'landing.pricingFree': 'Gratuit',
  'landing.pricingPerMonth': 'par mois',
  'landing.pricingCredits': '{count} crédits par mois',
  'landing.pricingProjectsOne': 'Une application',
  'landing.pricingProjects': 'Jusqu’à {count} applications',
  'landing.pricingNoBuild': 'S’arrête avant la construction',
  'landing.pricingBuild': 'Construction et mise en ligne',
  'landing.pricingDomain': 'Adresse personnalisée',
  'landing.pricingInstall': 'Installable sur l’écran d’accueil',
  'landing.pricingImages': '{size} d’images à vous',
  'landing.pricingLaunchKit': 'Kit de lancement marketing',
  'landing.pricingExport': 'Export du code',
  'landing.pricingRadar': 'Radar d’opportunités : {count} recherche(s) par mois',
  'landing.pricingLia': 'Lia, support client dans vos applications : {count} réponses par mois',
  'landing.pricingMobile': 'Préparation pour mobile',
  'landing.pricingRecommended': 'Le plus choisi',
  'landing.pricingCtaFree': 'Commencer gratuitement',
  'landing.pricingCtaPaid': 'Créer mon compte',
  'landing.pricingPaymentNote':
    "Le paiement en ligne n’est pas encore activé sur cette installation. Créez votre compte gratuitement : vous choisirez votre offre le jour où il le sera, sans rien perdre de votre travail.",
  'landing.pricingStripeNote':
    'Paiement sécurisé par Stripe, par carte, sans engagement : vous changez ou résiliez votre offre quand vous voulez depuis votre espace.',
  'landing.pricingNote':
    "Les crédits couvrent les opérations qui font appel à l’intelligence artificielle. Une recherche d’idées en consomme une douzaine, la construction d’une application une vingtaine.",

  // ── Transparence ─────────────────────────────────────────────────────────
  'landing.honestTitle': 'Une plateforme transparente dès le départ',
  'landing.honestBody':
    "Ce que vous lisez ici est vérifiable dans le produit. Voici ce sur quoi vous pouvez compter.",
  'landing.honest1': 'Les estimations sont clairement identifiées comme telles',
  'landing.honest2': 'Les coûts externes éventuels sont expliqués avant la construction',
  'landing.honest3': 'Vous restez informé des étapes nécessaires à la publication',
  'landing.honest4':
    'Vous savez ce qui dépend d’Evoliia et ce qui dépend de services extérieurs',
  'landing.honestNote':
    "Nous ne promettons aucun revenu, et aucune acceptation par l’App Store ou Google Play : ces boutiques décident seules.",

  // ── Questions fréquentes ─────────────────────────────────────────────────
  'landing.faqTitle': 'Questions fréquentes',
  'landing.faq1Q': 'Faut-il savoir coder ?',
  'landing.faq1A':
    "Non. Vous décrivez ce que vous voulez en français, Evoliia construit l’application et vous la modifiez en écrivant vos demandes. Vous ne voyez jamais de code.",
  'landing.faq2Q': 'Que peut-on créer exactement ?',
  'landing.faq2A':
    "Des applications web : outils métier, sites d’inscription ou de réservation, catalogues, espaces membres, petits SaaS. Elles s’affichent aussi bien sur ordinateur que sur téléphone, où elles peuvent s’installer sur l’écran d’accueil comme n’importe quelle application.",
  'landing.faq3Q': 'Et si je n’ai aucune idée ?',
  'landing.faq3A':
    "C’est le cas le plus fréquent, et c’est le point de départ prévu. Evoliia part de votre objectif et de ce que vous savez faire, puis vous propose des idées chiffrées à comparer.",
  'landing.faq4Q': 'Puis-je vraiment vendre mon application ?',
  'landing.faq4A':
    "Rien ne l’empêche techniquement : vous définissez un prix et des offres. Trouver des clients reste votre travail, et aucun revenu n’est garanti.",
  'landing.faq5Q': 'Mon application sera-t-elle sur l’App Store ?',
  'landing.faq5A':
    "Pas aujourd’hui, et vos clients n’en ont pas besoin pour l’installer. Depuis le navigateur de leur téléphone, ils l’ajoutent à leur écran d’accueil : elle prend son icône, son nom, et s’ouvre en plein écran. Ni compte de développeur, ni frais annuels, ni délai de validation. La publication sur les boutiques mobiles, elle, dépend d’Apple et de Google, qui décident seuls.",
  'landing.faq6Q': 'À qui appartiennent mes données ?',
  'landing.faq6A':
    "À vous. Chaque application est isolée des autres, et les données de vos utilisateurs restent celles de votre projet.",

  // ── Dernier appel ────────────────────────────────────────────────────────
  'landing.finalTitle': 'Votre prochaine application peut commencer par une simple idée.',
  'landing.finalTitleAccent': 'Ou même par l’envie d’en trouver une.',
  'landing.finalBody':
    "Evoliia vous accompagne pour passer de « j’aimerais créer quelque chose » à un véritable projet.",
  'landing.footerTagline':
    "Evoliia accompagne les personnes qui veulent créer un revenu complémentaire sans savoir coder.",
  'landing.footerLegal': 'Mentions légales',
  'landing.footerTerms': 'Conditions d’utilisation',
  'landing.footerPrivacy': 'Confidentialité',
  'landing.footerRights': 'Tous droits réservés.',

  'auth.registerTitle': 'Créer votre compte',
  'auth.loginTitle': 'Se connecter',
  'auth.email': 'Adresse e-mail',
  'auth.password': 'Mot de passe',
  'auth.name': 'Votre prénom',
  'auth.passwordHint': 'Au moins 10 caractères, avec un chiffre ou un symbole.',
  'auth.noAccount': "Vous n'avez pas encore de compte ?",
  'auth.hasAccount': 'Vous avez déjà un compte ?',

  'dashboard.title': 'Mes applications',
  'dashboard.empty': "Vous n'avez pas encore d'application.",
  'dashboard.emptyBody': 'Commencez par décrire ce que vous aimeriez créer.',
  'dashboard.create': 'Créer une application',
  'dashboard.credits': 'Crédits restants',
  'dashboard.lastEdited': 'Modifiée',

  'status.DRAFT': 'En création',
  'status.TESTING': 'En test',
  'status.READY': 'Prête à publier',
  'status.PUBLISHED': 'Publiée',

  'create.question': 'Que souhaitez-vous créer ?',
  'create.describe': 'Décrivez votre idée',
  'create.placeholder':
    "Exemple : une application pour aider les propriétaires de chiens à trouver des promenades près de chez eux.",
  'create.noIdea': "Je n'ai pas encore d'idée",
  'create.submit': 'Analyser mon idée',

  'progress.title': 'Votre application',
  'progress.idea': 'Idée',
  'progress.design': 'Design',
  'progress.features': 'Fonctionnalités',
  'progress.tests': 'Tests',
  'progress.monetization': 'Monétisation',
  'progress.publication': 'Publication',

  'project.preview': 'Aperçu',
  'project.assistant': "Modifier avec l'IA",
  'project.design': 'Design',
  'project.features': 'Fonctionnalités',
  'project.users': 'Utilisateurs',
  'project.monetization': 'Monétisation',
  'project.tests': 'Tests',
  'project.publication': 'Publication',
  'project.settings': 'Paramètres',
  'project.versions': 'Versions',

  'editor.chatPlaceholder': 'Dites ce que vous voulez changer…',
  'editor.send': 'Envoyer',
  'editor.thinking': "L'assistant travaille…",
  'editor.devicePhone': 'Téléphone',
  'editor.deviceTablet': 'Tablette',
  'editor.deviceDesktop': 'Ordinateur',

  'versions.title': 'Historique des versions',
  'versions.restore': 'Restaurer cette version',
  'versions.restored': 'Version restaurée',

  'publish.title': 'Publier mon application',
  'publish.action': 'Publier mon application',
  'publish.published': 'Votre application est en ligne',
  'publish.readyPercent': 'Votre application est prête à {percent} %',

  'credits.insufficient':
    "Vous n'avez plus assez de crédits pour cette opération. Vos crédits se renouvellent chaque mois.",
  'ai.disabled':
    "L'assistant n'est pas configuré sur cette installation. Voir la documentation d'installation.",

  /* ── Page publique : la visibilité. ───────────────────────────────────────
   *
   * Règle d'écriture, et elle explique tout le reste : on parle du site du
   * visiteur, pas du nôtre. « Deux scores, deux publics » est une idée juste et
   * une phrase vide ; « personne ne trouve votre site » est ce qu'il vient
   * chercher. Chaque section dit donc d'abord ce qui se passe chez lui, et
   * ensuite seulement ce qu'Evoliia y fait.
   *
   * Deuxième règle : aucun chiffre sans son origine. Les nombres qui
   * apparaissent ici sont des exemples, et le mot « exemple » est écrit à côté
   * d'eux, pas en bas de page.
   */
  'vis.metaTitle': 'Evoliia | L’équipe IA qui rend votre site visible',
  'vis.metaDescription':
    'Analysez votre site, comprenez ce qui l’empêche d’être trouvé sur Google et cité par les IA, et corrigez-le. Pour les indépendants, artisans, commerçants et petites entreprises.',
  'vis.navTeam': 'L’équipe',
  'vis.navHow': 'Comment ça marche',
  'vis.navPricing': 'Tarifs',
  'vis.navStart': 'Analyser mon site',

  'vis.heroEyebrow': 'Indépendants, artisans, commerçants, petites entreprises',
  'vis.heroTitle': 'Votre équipe IA pour être visible partout.',
  'vis.heroBody':
    'Votre site est en ligne, et pourtant presque personne ne le trouve. Evoliia le lit page par page, vous dit en français ce qui cloche, classe les corrections de la plus utile à la moins urgente — et les écrit pour vous.',
  'vis.heroPlaceholder': 'https://monsite.ch',
  'vis.heroCta': 'Analyser mon site',
  'vis.heroCtaSecond': 'Voir l’équipe',
  'vis.heroNote': 'Sans carte bancaire, sans mot de passe, sans rien à installer.',
  'vis.heroScoreSeo': 'Google',
  'vis.heroScoreGeo': 'Moteurs IA',
  'vis.heroSample': 'À quoi ressemble un résultat',
  'vis.heroSampleNote': 'Un exemple, pas une prévision : vos chiffres dépendent de votre site.',
  'vis.heroPriorities': 'actions à traiter en priorité',

  'vis.pathTitle': 'Vous donnez une adresse. On s’occupe du vocabulaire.',
  'vis.pathBody':
    'Le référencement est un métier plein de mots que personne n’a envie d’apprendre. Vous n’aurez à en retenir aucun.',
  'vis.path1Title': 'Ajouter',
  'vis.path1Body':
    'Vous collez l’adresse de votre site. Pas d’accès, pas de mot de passe, rien à installer dessus.',
  'vis.path2Title': 'Analyser',
  'vis.path2Body':
    'Léa parcourt vos pages, jusqu’à cinquante, en commençant par celles qui comptent le plus.',
  'vis.path3Title': 'Comprendre',
  'vis.path3Body':
    'Deux notes sur cent, et cinq actions classées. Chaque problème est expliqué avec ce qu’il vous coûte.',
  'vis.path4Title': 'Corriger',
  'vis.path4Body':
    'Vous demandez le texte à l’agent concerné, vous le comparez à ce que vous avez, vous copiez.',
  'vis.path5Title': 'Progresser',
  'vis.path5Body':
    'Vous relancez l’analyse. Les notes se suivent dans le temps, et votre liste se vide.',

  'vis.prioTitle': 'Par quoi commencer : la seule question qui compte vraiment.',
  'vis.prioBody':
    'Un audit qui rend deux cents remarques ne sert à personne — on le referme. Evoliia classe, explique ce que chaque problème vous coûte, et s’arrête aux cinq qui changent quelque chose.',
  'vis.prioBadge': 'Priorité 1',
  'vis.prioHeadline': '14 fiches produits sans description',
  'vis.prioWhy':
    'Google n’a rien à afficher sous leur titre : il prend alors un bout de texte au hasard dans la page, souvent votre menu. C’est la phrase qui décide si l’on clique ou non.',
  'vis.prioCta': 'Corriger avec Néo',
  'vis.prioNote': 'Un exemple. Vos priorités dépendent de ce que l’analyse trouve chez vous.',

  'vis.scoresTitle': 'On vous cherche dans Google. On commence à vous demander à une IA.',
  'vis.scoresBody':
    'Les deux ne demandent pas le même travail, et un seul chiffre les mélangerait. Evoliia les mesure séparément.',
  'vis.seoTitle': 'Note Google',
  'vis.seoBody':
    'Ce qu’un moteur de recherche regarde : vos titres, vos descriptions, la structure de vos pages, vos liens entre elles, vos images, vos données structurées. Une trentaine de contrôles, tous faits par du calcul.',
  'vis.geoTitle': 'Note moteurs IA',
  'vis.geoBody':
    'Ce qu’un assistant doit trouver pour oser vous citer : des réponses directes, des faits nets, une entreprise identifiable, un texte qui tient debout même sorti de sa page.',
  'vis.geoWarning':
    'Aucune note ne garantit d’apparaître dans ChatGPT, Gemini ou Perplexity. Personne ne peut le promettre, et nous ne le promettons pas. Celle-ci mesure ce qui dépend de vous, et rien d’autre.',
  'vis.scoresHow': 'D’où sortent ces chiffres',
  'vis.scoresHowBody':
    'De règles et de pondérations appliquées à ce qui a été relevé dans vos pages. Aucune intelligence artificielle n’invente la note : elle explique ce que le calcul a trouvé, et elle rédige les corrections. Vous pouvez demander le détail de chaque point perdu.',

  'vis.teamTitle': 'Quatre spécialistes, un seul site, une seule conversation.',
  'vis.teamBody':
    'Ce qui en fait une équipe n’est pas leur prénom : chacun regarde autre chose et sait faire autre chose. Vous n’avez pas à choisir à qui parler — vous écrivez, et celui qui sait répond.',
  'vis.teamHandles': 'S’occupe de',
  'vis.teamAsk': 'On peut lui demander',
  'vis.teamSoon': 'En construction',
  'vis.teamSoonNote':
    'L’équipe est en cours de construction. Cette page décrit ce qu’elle fera ; chaque spécialiste sera ouvert le jour où il fonctionnera, pas avant.',

  'vis.checksTitle': 'Ce qui est compté, et ce qui est écrit.',
  'vis.checksBody':
    'Tout ce qui se compte est compté par du calcul : c’est exact, immédiat, et ça ne vous prend aucun crédit. L’intelligence artificielle n’intervient qu’après, pour expliquer et pour rédiger — là où elle est irremplaçable, et seulement là.',
  'vis.checks1Title': 'Ce qui s’affiche dans Google',
  'vis.checks2Title': 'Ce que vos pages disent',
  'vis.checks3Title': 'Ce qui se passe sous le capot',
  'vis.checks4Title': 'Ce que les machines lisent',

  'vis.postelyaTitle': 'Vos réseaux sociaux, c’est Postelya.',
  'vis.postelyaBody':
    'Evoliia travaille votre visibilité dans les moteurs. Postelya s’occupe de vos réseaux : il transforme vos contenus en publications, les planifie et les publie. Deux terrains, deux outils — et ce que Milo écrit ici pourra partir là-bas.',
  'vis.postelyaCta': 'Ouvrir Postelya',
  'vis.postelyaSoon': 'Le passage de l’un à l’autre est en préparation.',

  'vis.pricingTitle': 'Les crédits paient l’IA, pas l’analyse.',
  'vis.pricingBody':
    'Lire votre site et calculer vos notes ne coûte rien : c’est du calcul. Vous dépensez des crédits quand vous demandez un texte, une correction ou une explication — c’est-à-dire quand une intelligence artificielle travaille vraiment pour vous.',
  'vis.pricingCta': 'Commencer',

  'vis.honestTitle': 'Ce que nous ne vous promettrons pas.',
  'vis.honestBody':
    'Ce métier se vend avec beaucoup de certitudes. Voici les nôtres : elles sont plus courtes, et elles sont tenables.',
  'vis.honest1Title': 'Aucune position garantie',
  'vis.honest1Body':
    'Personne ne décide de votre place dans Google, et personne ne décide d’être cité par un assistant. Nous corrigeons ce qui dépend de vous ; le reste n’appartient à personne qui vous le vendrait.',
  'vis.honest2Title': 'Aucun chiffre inventé',
  'vis.honest2Body':
    'Les notes viennent de règles appliquées à des faits relevés dans vos pages. Chaque point perdu peut vous être montré, ligne par ligne, avec la page concernée.',
  'vis.honest3Title': 'Votre site n’est pas touché',
  'vis.honest3Body':
    'Evoliia le lit comme le ferait un moteur, et vous rend des textes à coller. Elle n’écrit rien chez vous, et ne vous demande ni accès ni mot de passe.',
  'vis.honest4Title': 'Aucun résultat du jour au lendemain',
  'vis.honest4Body':
    'Un moteur met des semaines à repasser sur vos pages. Ce que nous vous montrons tout de suite, c’est ce qui a changé dans votre site — pas votre trafic, que nous ne contrôlons pas.',

  'vis.faqTitle': 'Questions fréquentes',
  'vis.faq1Q': 'Je n’y connais rien au référencement. C’est un problème ?',
  'vis.faq1A':
    'C’est le point de départ du produit. Chaque problème est écrit en français courant, avec ce qu’il vous coûte et par quoi commencer. Si une explication reste obscure, vous la redemandez à l’équipe, dans la même conversation.',
  'vis.faq2Q': 'C’est quoi, exactement, les « moteurs IA » ?',
  'vis.faq2A':
    'ChatGPT, Gemini, Perplexity, les réponses générées par Google. Ils ne classent pas des liens : ils répondent, et citent leurs sources. Pour être cité, il faut être compréhensible et vérifiable — ce qui ne se joue pas tout à fait sur les mêmes points que le référencement classique.',
  'vis.faq3Q': 'Est-ce que vous modifiez mon site ?',
  'vis.faq3A':
    'Jamais. Evoliia le lit comme le ferait un moteur, et vous rend du texte à coller. Aucun accès, aucun mot de passe, aucune extension à installer.',
  'vis.faq4Q': 'Combien de pages sont analysées ?',
  'vis.faq4A':
    'Jusqu’à cinquante par analyse, en commençant par les plus importantes : votre accueil, puis ce vers quoi il pointe. Nous respectons ce que votre site autorise à explorer, et nous passons à un rythme qui ne le dérange pas.',
  'vis.faq5Q': 'Et si mon site est sur Shopify, WordPress ou Wix ?',
  'vis.faq5A':
    'Aucune importance : l’analyse lit des pages web, quelle que soit la façon dont elles ont été faites. La connexion directe à Shopify et WordPress, pour appliquer les corrections sans copier-coller, viendra plus tard.',
  'vis.faq6Q': 'Ça consomme combien de crédits ?',
  'vis.faq6A':
    'L’analyse et les notes ne consomment rien : c’est du calcul. Les crédits partent quand vous demandez un texte, une correction ou une explication à un agent, et le coût de chaque action est affiché avant que vous la lanciez.',

  'vis.signupSite': 'Site à analyser : {site}. Créez votre compte pour lancer l’analyse.',

  /* ── Nouvelles sections de la page publique ─────────────────────────────── */
  'vis.navFeatures': 'Fonctionnalités',
  'vis.navSeo': 'SEO',
  'vis.navGeo': 'GEO',

  'vis.heroBadges': 'SEO • GEO • Contenu • Réseaux sociaux',
  'vis.heroCtaHow': 'Découvrir comment ça marche',
  'vis.mockTitle': 'Votre visibilité',
  'vis.mockPages': 'pages analysées',
  'vis.mockPriorities': 'priorités',
  'vis.mockTeam': 'Léa, Néo, Gia et Milo travaillent dessus',

  'vis.painTitle': 'Être visible devient de plus en plus compliqué.',
  'vis.painBody':
    'Il fallait déjà être trouvé sur Google. Il faut désormais aussi être compris par les assistants IA, qui répondent à la place des listes de liens. Pour une petite entreprise, cela fait beaucoup de travail invisible, et personne pour dire par où commencer.',
  'vis.pain1': 'Je ne sais pas quoi améliorer.',
  'vis.pain2': 'Je n’ai pas le temps de m’occuper du SEO.',
  'vis.pain3': 'J’ignore si mon site est adapté aux moteurs IA.',
  'vis.painAnswer': 'Evoliia transforme cette complexité en une liste de choses à faire.',

  'vis.solutionTitle': 'Evoliia vous dit quoi améliorer, et comment le faire.',
  'vis.solutionBody':
    'Quatre étapes. Vous n’en faites que deux : la première et la dernière.',
  'vis.step1Title': 'Ajoutez votre site',
  'vis.step1Body': 'Vous entrez votre adresse. Rien d’autre ne vous est demandé.',
  'vis.step2Title': 'Evoliia analyse',
  'vis.step2Body': 'Vos pages sont parcourues et passées au crible, côté Google et côté IA.',
  'vis.step3Title': 'Votre équipe priorise',
  'vis.step3Body': 'Les problèmes sont classés par ce qu’ils vous coûtent réellement.',
  'vis.step4Title': 'Corrigez avec l’IA',
  'vis.step4Body': 'Vous recevez le texte corrigé, prêt à coller sur votre site.',

  'vis.teamHelp':
    'Vous n’avez pas à devenir expert : votre équipe vous explique quoi faire, étape par étape, dans une seule conversation.',

  'vis.dashTitle': 'Votre visibilité, d’un coup d’œil.',
  'vis.dashBody':
    'Deux notes, le nombre de pages analysées, les priorités du moment. Et surtout leur évolution : la seule façon de savoir si ce que vous faites sert à quelque chose.',
  'vis.dashFollow': 'Suivez vos progrès, audit après audit.',

  'vis.seoSectionTitle': 'Améliorez votre référencement Google.',
  'vis.seoSectionBody':
    'Néo passe en revue ce qui décide de votre place dans les résultats — et ce qui décide qu’on clique une fois que vous y êtes.',
  'vis.seoCta': 'Ce que Néo regarde',

  'vis.geoSectionTitle': 'Préparez votre site à la recherche assistée par IA.',
  'vis.geoSectionBody':
    'De plus en plus de gens posent leur question à un assistant plutôt qu’à un moteur. L’assistant ne classe pas des liens : il répond, et cite ce qu’il a compris. Gia analyse la clarté et la structure de vos contenus pour repérer ce qui l’en empêche.',
  'vis.geoSectionClaim':
    'L’objectif n’est pas d’« être premier dans ChatGPT » — cela ne se vend pas, parce que cela ne s’achète pas. Il est de rendre vos contenus plus clairs, mieux structurés et plus faciles à comprendre pour une machine.',

  'vis.fixTitle': 'Ne recevez pas un problème. Recevez la solution.',
  'vis.fixBody':
    'C’est toute la différence entre un audit et un outil de travail. Un audit vous dit ce qui manque ; Evoliia l’écrit.',
  'vis.fixProblem': 'Problème détecté',
  'vis.fixProblemText': 'Meta description absente',
  'vis.fixAgent': 'Corriger avec Néo',
  'vis.fixProposal': 'Proposition d’Evoliia',
  'vis.fixProposalText':
    'Bougies artisanales coulées à la main en Gruyère. Cire de soja, parfums naturels, livraison en Suisse sous 48 h.',
  'vis.fixCopy': 'Copier',
  'vis.fixNote':
    'Evoliia transforme une recommandation technique en quelque chose que vous pouvez coller tout de suite.',

  'vis.contentTitle': 'Écrivez les contenus dont votre site a réellement besoin.',
  'vis.contentBody':
    'Milo ne fabrique pas du texte au kilomètre. Il part de ce que l’analyse a trouvé chez vous : les pages sans réponse, les questions auxquelles personne ne répond, les descriptions qui manquent.',
  'vis.contentNote':
    'Le contenu naît d’un manque constaté sur votre site, jamais d’un sujet tiré au hasard.',

  'vis.bridgeEvoliia': 'Evoliia',
  'vis.bridgeEvoliiaSub': 'SEO • GEO • Contenu',
  'vis.bridgeArrow': 'Envoyer vers Postelya',
  'vis.bridgeNetworks': 'Instagram · Facebook · LinkedIn · Pinterest',

  'vis.audienceTitle': 'Pour celles et ceux qui veulent être visibles sans devenir experts.',
  'vis.audienceBody':
    'Le référencement est un métier. Vous en avez déjà un.',
  'vis.audience1': 'E-commerce',
  'vis.audience2': 'Artisans',
  'vis.audience3': 'Indépendants',
  'vis.audience4': 'Petites entreprises',
  'vis.audience5': 'Agences',
  'vis.audience6': 'Créateurs',
  'vis.audience7': 'Prestataires de services',

  'vis.diffTitle': 'Un outil de référencement fait pour les non-experts.',
  'vis.diffBody':
    'Les outils existants s’adressent à des gens dont c’est le métier. Celui-ci s’adresse à vous.',
  'vis.diff1Title': 'Des priorités, pas une liste',
  'vis.diff1Body': 'Vous savez quoi faire en premier, et pourquoi c’est celui-là.',
  'vis.diff2Title': 'Des explications lisibles',
  'vis.diff2Body': 'Aucun terme technique n’est laissé sans traduction.',
  'vis.diff3Title': 'Des corrections écrites',
  'vis.diff3Body': 'Vous repartez avec le texte, pas avec une consigne.',
  'vis.diff4Title': 'Google et les moteurs IA',
  'vis.diff4Body': 'Les deux façons d’être trouvé, mesurées séparément.',

  'vis.plansTitle': 'Trois offres, et des crédits qui ne servent qu’à l’IA.',
  'vis.plansBody':
    'Analyser votre site ne consomme rien : c’est du calcul. Les crédits partent quand un agent écrit, corrige ou explique.',
  'vis.plansPerMonth': '/ mois',
  'vis.plansPopular': 'Le plus choisi',
  'vis.plansSites': '{count} site suivi',
  'vis.plansSitesMany': '{count} sites suivis',
  'vis.plansPages': 'jusqu’à {count} pages analysées par audit',
  'vis.plansAudits': '{count} audits par mois',
  'vis.plansCredits': '{count} crédits IA par mois',
  'vis.plansTeam': 'Léa, Néo, Gia et Milo',
  'vis.plansHistory': 'Historique et comparaison des audits',
  'vis.plansPostelya': 'Connecteur Postelya',
  'vis.plansExport': 'Export des rapports',
  'vis.plansCta': 'Choisir {plan}',
  'vis.plansFreeCta': 'Essayer gratuitement',

  'vis.trialTitle': 'Commencez sans payer.',
  'vis.trialBody':
    'Un audit complet, vos deux notes et vos premières priorités, sans carte bancaire. Vous verrez ce qui manque à votre site avant de décider si cela vaut un abonnement. Les corrections rédigées et l’historique viennent avec une offre.',

  'vis.packsTitle': 'Besoin de plus de crédits ?',
  'vis.packsBody':
    'Un mois chargé ne doit pas obliger à changer d’abonnement. Vous rechargez, et ces crédits-là n’expirent pas — ils sont payés.',
  'vis.packsCredits': '{count} crédits',
  'vis.packsNote':
    'Les crédits achetés s’ajoutent à votre réserve mensuelle et restent disponibles tant que vous ne les utilisez pas.',

  'vis.costsTitle': 'Ce qui coûte, et ce qui ne coûte rien.',
  'vis.costsFree': 'Inclus, sans crédit',
  'vis.costsPaid': 'Consomme des crédits',
  'vis.costsNote':
    'Les fourchettes sont indicatives et annoncées avant chaque action. Le débit réel est mesuré sur le travail réellement fourni : personne n’est facturé sur une estimation.',

  'vis.compareTitle': 'Comparer les trois offres',
  'vis.compareSites': 'Sites suivis',
  'vis.comparePages': 'Pages par audit',
  'vis.compareAudits': 'Audits par mois',
  'vis.compareCredits': 'Crédits IA par mois',
  'vis.compareTeam': 'Équipe IA',
  'vis.compareHistory': 'Historique',
  'vis.compareContent': 'Contenu rédigé par l’IA',
  'vis.comparePostelya': 'Postelya',
  'vis.compareExports': 'Exports',
  'vis.compareYes': 'Oui',
  'vis.compareNo': '—',

  'vis.pricingCtaTitle': 'Commencez par voir ce qui limite votre visibilité.',
  'vis.pricingCtaNote': 'Aucune connaissance en référencement n’est nécessaire.',

  'vis.finalTitle': 'Découvrez ce qui limite votre visibilité.',
  'vis.finalBody':
    'Ajoutez votre site et laissez Evoliia trouver vos premières occasions de progresser, sur Google comme du côté des moteurs IA.',

  'vis.faq7Q': 'Qu’est-ce qu’un audit SEO, concrètement ?',
  'vis.faq7A':
    'Evoliia parcourt vos pages comme le ferait un moteur et vérifie une trentaine de points : ce qui s’affiche dans les résultats, la structure de vos titres, vos liens internes, vos images, vos données structurées. Il en sort une note, et surtout une liste classée de ce qui vous coûte le plus.',
  'vis.faq8Q': 'Puis-je changer d’offre en cours de route ?',
  'vis.faq8A':
    'Oui, dans les deux sens, depuis votre compte. Le changement passe par Stripe et prend effet immédiatement.',
} as const

export type MessageKey = keyof typeof fr
