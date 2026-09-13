/**
 * Catalogue des services connectables.
 *
 * Chaque entrée porte sa fiche économique. Ce n'est pas de la documentation décorative :
 * la règle du produit est qu'un utilisateur de plus ne doit pas créer de coût de plus pour
 * Evoliia, et cette fiche est ce qui permet de le vérifier avant d'écrire une ligne de
 * connecteur. Un fournisseur reste `planned` tant que sa fiche n'a pas été validée.
 *
 * Les chiffres et conditions cités sont ceux relevés à la date indiquée. Ils changent :
 * `reviewedOn` dit quand ils ont été vérifiés pour la dernière fois.
 */

export type IntegrationCategory =
  | 'google'
  | 'stockage'
  | 'productivite'
  | 'commerce'
  | 'ia'
  | 'social'

/** Qui paie quoi. C'est la seule question qui décide si une intégration est acceptable. */
export type CostToEvoliia =
  /** Aucun coût variable : le créateur consomme son propre compte. */
  | 'aucun'
  /** Gratuit aujourd'hui, mais adossé à une ressource dont Evoliia est titulaire. */
  | 'quota-partage'
  /** Evoliia serait facturée à l'usage. Interdit sans décision explicite. */
  | 'facture'

export type CostToCreator =
  | 'gratuit'
  | 'compte-gratuit-suffisant'
  | 'selon-usage'
  | 'abonnement-externe'

export type IntegrationProvider = {
  id: string
  name: string
  category: IntegrationCategory
  /** Une phrase, pour quelqu'un qui ne connaît pas le service. */
  summary: string
  /** À quoi servirait la connexion, en clair. */
  usage: string
  /** `available` : connectable aujourd'hui. `planned` : fiche écrite, connecteur à venir. */
  status: 'available' | 'planned'
  /** OAuth quand le fournisseur le propose ; clé du créateur sinon. */
  credential: 'OAUTH' | 'API_KEY'
  /**
   * Qui se sert de la connexion. `EVOLIIA` : l'atelier, pendant que le créateur construit.
   * `APP` : les applications qu'il a publiées, donc ses visiteurs. Ce n'est pas au
   * navigateur de trancher — le catalogue le déclare, le gestionnaire l'impose.
   */
  connectionTarget: 'EVOLIIA' | 'APP'
  /** Autorisations minimales envisagées. Le principe est de n'en demander aucune de plus. */
  scopes: readonly string[]
  costToEvoliia: CostToEvoliia
  costToCreator: CostToCreator
  /** Ce que le créateur doit savoir avant de connecter, en une phrase. */
  costNotice: string
  /** Quota gratuit connu, ou ce qui en tient lieu. */
  freeQuota: string
  /** Le fournisseur notifie-t-il les changements, ou faut-il l'interroger en boucle ? */
  webhooks: boolean
  /** Vérification ou validation exigée par le fournisseur avant mise en production. */
  providerReview: string
  /** Ce qui peut mal tourner, dit franchement. */
  risk: string
  /** Comment le créateur obtient sa clé. Absent pour les fournisseurs en OAuth. */
  keyHelp?: { label: string; hint: string }
  reviewedOn: string
}

export const INTEGRATION_PROVIDERS: readonly IntegrationProvider[] = [
  {
    id: 'google-drive',
    name: 'Google Drive',
    category: 'google',
    summary: 'Les fichiers que vous gardez sur Google Drive.',
    usage:
      'Choisir un fichier précis pour le donner à Evoliia : un document à analyser, une image à réutiliser.',
    status: 'planned',
    credential: 'OAUTH',
    connectionTarget: 'EVOLIIA',
    // drive.file ne donne accès qu'aux fichiers que la personne choisit elle-même. C'est le
    // seul périmètre Drive qui évite une vérification lourde côté Google.
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    costToEvoliia: 'quota-partage',
    costToCreator: 'compte-gratuit-suffisant',
    costNotice:
      'Un compte Google suffit. Vos fichiers restent chez Google, Evoliia ne les recopie pas.',
    freeQuota:
      "L'API Drive est sans frais. Le quota est compté en unités partagées par projet Google Cloud ; Google a annoncé une facturation des dépassements courant 2026.",
    webhooks: true,
    providerReview:
      "Écran de consentement Google à vérifier. Le périmètre drive.file est le plus léger ; un périmètre plus large déclencherait un audit de sécurité annuel, payant et long.",
    risk:
      "Le quota est celui du projet Google d'Evoliia, partagé par tous les créateurs. Un usage massif pénaliserait tout le monde avant de coûter de l'argent.",
    reviewedOn: '2026-09-12',
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    category: 'google',
    summary: 'Vos tableaux Google Sheets.',
    usage: 'Importer les données d’un tableau, ou écrire dans une feuille que vous désignez.',
    status: 'planned',
    credential: 'OAUTH',
    connectionTarget: 'EVOLIIA',
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    costToEvoliia: 'quota-partage',
    costToCreator: 'compte-gratuit-suffisant',
    costNotice: 'Un compte Google suffit. Le tableau reste chez Google.',
    freeQuota: "Sans frais, avec les mêmes quotas partagés que l'API Drive.",
    webhooks: false,
    providerReview: 'Même écran de consentement que Drive, même périmètre restreint.',
    risk:
      "Sans notification de changement, la tentation est d'interroger le tableau en boucle. À lire uniquement à la demande.",
    reviewedOn: '2026-09-12',
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'google',
    summary: 'Votre agenda Google.',
    usage: 'Créer un rendez-vous depuis une application de réservation, lire les créneaux occupés.',
    status: 'planned',
    credential: 'OAUTH',
    connectionTarget: 'APP',
    scopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
    costToEvoliia: 'quota-partage',
    costToCreator: 'compte-gratuit-suffisant',
    costNotice: 'Un compte Google suffit.',
    freeQuota: 'Sans frais, quotas partagés par projet Google Cloud.',
    webhooks: true,
    providerReview:
      "Les périmètres Calendar sont considérés comme sensibles par Google : une vérification est exigée avant l'ouverture au public.",
    risk: "Un agenda mal cadré expose la vie privée du créateur. À n'ouvrir qu'aux événements créés par l'application.",
    reviewedOn: '2026-09-12',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'commerce',
    summary: 'Encaisser les paiements de vos propres clients.',
    usage:
      'Votre application encaisse sur VOTRE compte Stripe. L’argent ne transite jamais par Evoliia.',
    status: 'available',
    credential: 'OAUTH',
    connectionTarget: 'APP',
    scopes: ['read_write'],
    costToEvoliia: 'aucun',
    costToCreator: 'selon-usage',
    costNotice:
      'Stripe prélève sa commission sur chaque paiement, sur votre compte. Evoliia ne prend aucune commission par défaut ; si cela changeait, vous en seriez informé avant.',
    freeQuota: 'Aucun abonnement. Stripe se rémunère à la transaction, chez le créateur.',
    webhooks: true,
    providerReview:
      "Compte de plateforme Stripe Connect, comptes connectés de type standard : le créateur reste titulaire de son compte Stripe, avec son propre tableau de bord. Les frais Stripe sont facturés au compte connecté ; Evoliia ne supporte ni frais de compte ni frais de versement.",
    risk:
      "Le vrai risque est juridique, pas technique : encaisser pour le compte d'autrui ferait d'Evoliia un intermédiaire financier. Le mode standard, où le créateur reste titulaire, l'évite.",
    reviewedOn: '2026-09-13',
  },
  {
    id: 'anthropic',
    // Le nom sert aussi d'étiquette dans « Coût <fournisseur> » : il doit rester celui du
    // service, pas une description de ce qu'on en fait.
    name: 'Anthropic',
    category: 'ia',
    summary: 'Votre propre clé, pour l’intelligence artificielle de votre application.',
    usage:
      'L’assistant de votre application publiée répond avec votre clé et votre budget, au lieu de consommer vos crédits Evoliia.',
    status: 'available',
    credential: 'API_KEY',
    connectionTarget: 'APP',
    scopes: [],
    costToEvoliia: 'aucun',
    costToCreator: 'selon-usage',
    costNotice:
      'Vos échanges sont facturés sur votre propre compte Anthropic, indépendamment de votre abonnement Evoliia.',
    freeQuota: "Aucun. Le compte fonctionne par crédits prépayés, avec un plafond mensuel réglable.",
    webhooks: false,
    providerReview:
      'Aucune validation à obtenir : la clé est créée par le créateur en deux minutes. La clé est vérifiée auprès d’Anthropic avant d’être enregistrée.',
    risk:
      "Une clé confiée est une clé à protéger. Elle est chiffrée au repos, jamais renvoyée au navigateur, jamais écrite dans un journal.",
    keyHelp: {
      label: 'Votre clé Anthropic',
      hint: 'Elle se crée sur console.anthropic.com, dans « API keys ». Posez-y un plafond mensuel : c’est votre compte qui paie. La clé est chiffrée et ne vous sera plus jamais réaffichée.',
    },
    reviewedOn: '2026-09-12',
  },
  {
    id: 'postelya',
    name: 'Postelya',
    category: 'social',
    summary: 'Votre espace Postelya, pour publier sur vos réseaux sociaux.',
    usage:
      'Envoyer vos publications préparées dans votre espace Postelya, où vous les relisez, les programmez et les publiez sur vos comptes.',
    status: 'available',
    credential: 'API_KEY',
    connectionTarget: 'EVOLIIA',
    scopes: [],
    costToEvoliia: 'aucun',
    costToCreator: 'abonnement-externe',
    costNotice:
      'Postelya est un produit distinct, avec son propre abonnement. Evoliia y dépose vos contenus, elle ne publie rien elle-même.',
    freeQuota: "Selon l'offre de votre espace Postelya.",
    webhooks: false,
    providerReview:
      'Aucune validation à obtenir pour relier un espace. Publier sur Instagram et Facebook exige en revanche que Postelya ait obtenu l’accord de Meta, ce qui ne dépend pas d’Evoliia.',
    risk:
      "Evoliia dépose des brouillons, elle ne publie pas. Rien ne part sur un réseau social sans que vous l'ayez relu et validé dans Postelya.",
    keyHelp: {
      label: 'Votre code de liaison',
      hint: 'Il se génère dans Postelya, Réglages puis « Relier un service ». Il est valable un quart d’heure et ne sert qu’une fois.',
    },
    reviewedOn: '2026-09-12',
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'productivite',
    summary: 'Vos pages et bases Notion.',
    usage: 'Importer le contenu d’une page ou d’une base que vous désignez.',
    status: 'planned',
    credential: 'OAUTH',
    connectionTarget: 'EVOLIIA',
    scopes: [],
    costToEvoliia: 'aucun',
    costToCreator: 'compte-gratuit-suffisant',
    costNotice: 'Un compte Notion gratuit suffit.',
    freeQuota: 'À vérifier avant implémentation.',
    webhooks: true,
    providerReview: 'Intégration à déclarer chez Notion. Fiche à compléter avant décision.',
    risk: 'Fiche incomplète : ne pas implémenter en l’état.',
    reviewedOn: '2026-09-12',
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    category: 'stockage',
    summary: 'Vos fichiers Dropbox.',
    usage: 'Choisir un fichier à donner à Evoliia.',
    status: 'planned',
    credential: 'OAUTH',
    connectionTarget: 'EVOLIIA',
    scopes: [],
    costToEvoliia: 'aucun',
    costToCreator: 'compte-gratuit-suffisant',
    costNotice: 'Un compte Dropbox gratuit suffit.',
    freeQuota: 'À vérifier avant implémentation.',
    webhooks: true,
    providerReview: 'Application à déclarer chez Dropbox. Fiche à compléter avant décision.',
    risk: 'Fiche incomplète : ne pas implémenter en l’état.',
    reviewedOn: '2026-09-12',
  },
]

export function findProvider(providerId: string): IntegrationProvider | undefined {
  return INTEGRATION_PROVIDERS.find((provider) => provider.id === providerId)
}

export const CATEGORY_LABEL: Record<IntegrationCategory, string> = {
  google: 'Google',
  stockage: 'Stockage de fichiers',
  productivite: 'Productivité',
  commerce: 'Commerce et paiement',
  ia: 'Intelligence artificielle',
  social: 'Réseaux sociaux',
}

export const COST_LABEL: Record<CostToCreator, string> = {
  gratuit: 'Gratuit',
  'compte-gratuit-suffisant': 'Compte gratuit suffisant',
  'selon-usage': 'Frais possibles selon votre usage',
  'abonnement-externe': 'Abonnement externe nécessaire',
}
