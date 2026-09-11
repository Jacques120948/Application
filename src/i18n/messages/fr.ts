/** Catalogue de référence. Toute clé doit exister ici. */
export const fr = {
  'common.appName': 'AppForge',
  'common.tagline': "Décrivez votre idée. L'IA construit votre application.",
  'common.loading': 'Un instant…',
  'common.save': 'Enregistrer',
  'common.cancel': 'Annuler',
  'common.continue': 'Continuer',
  'common.back': 'Retour',
  'common.close': 'Fermer',
  'common.comingSoon': 'Bientôt disponible',
  'common.error': "Une erreur s'est produite.",
  'common.retry': 'Réessayer',

  'nav.dashboard': 'Mes applications',
  'nav.logout': 'Se déconnecter',
  'nav.login': 'Se connecter',
  'nav.register': 'Créer un compte',
  'nav.admin': 'Administration',

  'home.heroTitle': 'Votre idée devient une application.',
  'home.heroBody':
    "Décrivez ce que vous voulez créer, en français courant. L'assistant construit l'application, vous la testez, puis vous la mettez en ligne.",
  'home.cta': 'Créer mon application',
  'home.step1Title': 'Vous décrivez',
  'home.step1Body': 'Une phrase suffit. Aucune compétence technique nécessaire.',
  'home.step2Title': "L'assistant construit",
  'home.step2Body': 'Structure, design, fonctionnalités et modèle économique vous sont proposés.',
  'home.step3Title': 'Vous publiez',
  'home.step3Body': 'Votre application est en ligne, avec une adresse que vous pouvez partager.',

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
