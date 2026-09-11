/** Catalogue de référence. Toute clé doit exister ici. */
export const fr = {
  'common.appName': 'AppForge',
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

  'home.heroTitle': "De votre idée à votre première application vendable.",
  'home.heroBody':
    "Vous n'avez pas besoin d'avoir une idée, ni de savoir coder. Dites-nous ce que vous visez et ce que vous savez faire : nous vous proposons quoi construire, nous le construisons avec vous, et nous vous accompagnons jusqu'à vos premiers clients.",
  'home.cta': 'Commencer par mon objectif',
  'home.step1Title': 'On cherche quoi construire',
  'home.step1Body':
    "Vous indiquez votre objectif, votre temps et vos compétences. Nous proposons des idées chiffrées, avec un prix conseillé et le nombre de clients correspondant.",
  'home.step2Title': "On vérifie avant de construire",
  'home.step2Body':
    "Demande, concurrence, prix, risques : l'idée est analysée pour éviter de travailler pour rien.",
  'home.step3Title': 'On construit et on met en ligne',
  'home.step3Body':
    "L'application est créée, testée, puis publiée à une adresse que vous pouvez partager.",
  'home.notAnotherBuilder':
    "Nous ne vous demandons pas seulement ce que vous voulez construire. Nous vous aidons à déterminer quoi construire, pourquoi, et comment le vendre.",

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
} as const

export type MessageKey = keyof typeof fr
