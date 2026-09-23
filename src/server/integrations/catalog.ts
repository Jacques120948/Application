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
  /**
   * Les champs à demander en plus de la clé, quand celle-ci ne suffit pas.
   *
   * Shopify en réclame deux : l'adresse de la boutique, parce que rien dans les
   * identifiants ne dit laquelle, et l'identifiant public de l'application, qui n'est pas un
   * secret et se saisit donc en clair — une valeur tapée de travers derrière des points se
   * corrige mal. Ordonnés : l'écran les affiche dans cet ordre, avant le champ secret.
   */
  extraFields?: readonly { name: string; label: string; hint: string; placeholder: string }[]
  /**
   * Le mode d'emploi, pas à pas, pour quelqu'un qui n'a jamais ouvert le site du
   * fournisseur. Écrit ici plutôt que dans l'écran : c'est du contenu, il se relit et se
   * corrige comme une fiche.
   */
  guide?: ProviderGuide
  reviewedOn: string
}

export type ProviderGuide = {
  /** Où aller, en https, et comment nommer ce lien. */
  url: string
  urlLabel: string
  /** Les étapes, dans l'ordre, une phrase chacune. */
  steps: readonly string[]
  /** Ce qu'il faut savoir avant de payer ou de donner une clé. */
  caution?: string
}

export const INTEGRATION_PROVIDERS: readonly IntegrationProvider[] = [
  {
    id: 'google-search-console',
    name: 'Google Search Console',
    category: 'google',
    summary: 'Ce que les gens tapent sur Google avant d’arriver chez vous — ou de ne pas y arriver.',
    usage:
      'Lire vos chiffres de recherche : les mots tapés, les pages qui sortent, la position moyenne. C’est la demande réelle, mesurée par Google sur vos propres pages, et non une estimation.',
    status: 'available',
    credential: 'OAUTH',
    connectionTarget: 'EVOLIIA',
    /*
     * Une seule portée, et elle ne permet aucune écriture : ni soumettre une page, ni
     * demander une réindexation, ni toucher à un réglage. C'est ce que Google affiche à la
     * personne sur son écran de consentement, et elle doit pouvoir le croire.
     */
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    costToEvoliia: 'aucun',
    costToCreator: 'gratuit',
    costNotice:
      'Search Console est gratuit, et c’est votre compte Google qui est interrogé. Evoliia ne paie rien, vous non plus.',
    freeQuota:
      'Sans frais. Google borne le nombre d’appels par jour et par propriété ; Evoliia en fait trois par consultation, très loin de la limite.',
    webhooks: false,
    providerReview:
      'L’écran de consentement Google doit être vérifié avant d’ouvrir la connexion à d’autres comptes que ceux déclarés en test. La portée en lecture seule est la plus légère des portées Search Console.',
    risk:
      'Evoliia lit vos chiffres, elle ne peut rien changer chez Google. Vous pouvez révoquer l’accès à tout moment depuis votre compte Google, et la connexion s’éteint sans que rien d’autre ne casse.',
    guide: {
      url: 'https://search.google.com/search-console',
      urlLabel: 'Ouvrir Search Console',
      steps: [
        'Votre site doit d’abord être déclaré dans Search Console, et la propriété vérifiée. Sans cela, Google n’a aucun chiffre à donner.',
        'Revenez ici et cliquez « Connecter Google Search Console ».',
        'Google vous demande d’autoriser la lecture. C’est chez Google que vous vous identifiez : Evoliia ne voit jamais votre mot de passe.',
        'De retour, vos chiffres de recherche apparaissent dans Visibilité.',
      ],
      caution:
        'Les chiffres de Search Console ont deux à trois jours de retard : c’est le délai de Google, pas celui d’Evoliia.',
    },
    reviewedOn: '2026-09-19',
  },
  {
    id: 'google-analytics',
    name: 'Google Analytics 4',
    category: 'google',
    summary: 'Vos visites : combien, d’où elles viennent, sur quel appareil, et combien achètent.',
    usage:
      'Lire vos visites par canal, par appareil et par page d’entrée, pour que Nova calcule votre vrai taux de conversion et repère les pages qui vendent. Des totaux par jour, jamais un visiteur.',
    status: 'available',
    credential: 'OAUTH',
    connectionTarget: 'EVOLIIA',
    // Lecture seule : ni événement créé, ni propriété modifiée, ni utilisateur ajouté.
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    costToEvoliia: 'aucun',
    costToCreator: 'gratuit',
    costNotice:
      'Google Analytics et son interface de données sont gratuits, et c’est votre propriété qui est interrogée. Evoliia ne paie rien, vous non plus.',
    freeQuota:
      'Sans frais. Google borne les demandes par propriété et par jour ; Evoliia lit une fois toutes les douze heures au plus, très loin de la limite.',
    webhooks: false,
    providerReview:
      'Même écran de consentement Google que Search Console. La portée en lecture seule doit y être ajoutée, et l’écran vérifié avant d’ouvrir la connexion à d’autres comptes que ceux déclarés en test.',
    risk:
      'Evoliia lit des totaux, elle ne peut rien changer dans Analytics. Vous pouvez révoquer l’accès à tout moment depuis votre compte Google.',
    guide: {
      url: 'https://analytics.google.com/',
      urlLabel: 'Ouvrir Google Analytics',
      steps: [
        'Votre site doit envoyer ses visites à une propriété Google Analytics 4. Pour une boutique Shopify, c’est l’application Google & YouTube qui s’en charge.',
        'Revenez ici et cliquez « Connecter Google Analytics 4 ».',
        'Google vous demande d’autoriser la lecture. C’est chez Google que vous vous identifiez : Evoliia ne voit jamais votre mot de passe.',
        'Nova choisit la propriété qui correspond à votre site ; vous pouvez en changer depuis son écran.',
      ],
      caution: 'Les chiffres de la veille se complètent dans la journée chez Google : Nova les relit au plus tard douze heures après.',
    },
    reviewedOn: '2026-09-23',
  },
  {
    id: 'google-ads',
    name: 'Google Ads',
    category: 'google',
    summary: 'Vos campagnes publicitaires : ce que vous dépensez, et ce que ça rapporte.',
    usage:
      'Lire vos campagnes, vos budgets et vos résultats, pour que Naya vous dise où part votre argent et ce qu’il faut ajuster. Aucune modification n’est faite sans votre accord explicite.',
    status: 'available',
    credential: 'OAUTH',
    connectionTarget: 'EVOLIIA',
    /*
     * Une seule portée, et Google n'en propose pas de version en lecture seule : demander à
     * lire, c'est obtenir le droit de modifier. On ne peut donc pas compter sur Google pour
     * empêcher une écriture accidentelle, et c'est dit ici plutôt que caché. La garantie
     * vient du code : le connecteur ne contient aucune fonction d'écriture, et n'en
     * contiendra qu'avec ses confirmations.
     */
    scopes: ['https://www.googleapis.com/auth/adwords'],
    costToEvoliia: 'quota-partage',
    costToCreator: 'gratuit',
    costNotice:
      'L’API Google Ads est gratuite, et c’est votre compte qui est interrogé. Evoliia ne paie rien, vous non plus — vous continuez de payer vos campagnes à Google, comme avant.',
    /*
     * Le plafond appartient au projet Google Cloud d'Evoliia, donc à l'exploitant, et il est
     * partagé par tous les utilisateurs. C'est la seule intégration du produit dans ce cas :
     * un utilisateur de plus consomme une ressource commune, ce qui est la raison même de
     * la fiche économique. Au palier Explorateur, 2 880 opérations par jour sur les comptes
     * de production — largement de quoi une synchronisation nocturne par compte, et à
     * surveiller quand le nombre de comptes reliés grandira.
     */
    freeQuota:
      'Sans frais. Le plafond quotidien est celui du projet Evoliia et se partage entre tous les comptes reliés : une synchronisation par nuit et par compte, jamais une par campagne.',
    webhooks: false,
    providerReview:
      'La portée `adwords` est sensible chez Google et devra être justifiée à la vérification, comme celle de Search Console. Elle couvre la lecture et l’écriture : Google n’en publie pas de version restreinte.',
    risk:
      'L’autorisation que Google vous montre dit « voir, modifier, créer et supprimer » : c’est la seule qui existe pour cette API. Evoliia ne s’en sert que pour lire, et toute modification future demandera votre confirmation, avec la valeur d’avant conservée pour pouvoir revenir en arrière. Vous pouvez révoquer l’accès à tout moment depuis votre compte Google.',
    guide: {
      url: 'https://ads.google.com',
      urlLabel: 'Ouvrir Google Ads',
      steps: [
        'Vous devez avoir un compte Google Ads avec des campagnes, et vous y connecter avec le compte Google qui y a accès.',
        'Revenez ici et cliquez « Connecter Google Ads ».',
        'Google vous demande d’autoriser l’accès. C’est chez Google que vous vous identifiez : Evoliia ne voit jamais votre mot de passe.',
        'Si vous avez plusieurs comptes publicitaires, choisissez celui que Naya doit suivre.',
      ],
      caution:
        'Les chiffres de Google Ads bougent pendant quelques jours : une conversion peut être comptée après coup. C’est le délai de Google, pas celui d’Evoliia.',
    },
    reviewedOn: '2026-09-21',
  },
  {
    id: 'meta-ads',
    name: 'Meta Ads',
    category: 'social',
    summary: 'Vos campagnes Facebook et Instagram : ce que vous dépensez, et ce que ça rapporte.',
    usage:
      'Lire vos campagnes, vos ensembles de publicités et vos résultats, pour que MIRA vous dise où part votre argent et ce qu’il faut ajuster. Aucune modification n’est faite sans votre accord explicite.',
    status: 'available',
    credential: 'OAUTH',
    connectionTarget: 'EVOLIIA',
    /*
     * Deux portées, et Meta ne propose pas mieux. `ads_read` seule suffirait à tout lire —
     * c'est d'ailleurs le mode Observateur — mais aucune modification ne serait possible,
     * pas même après confirmation. `ads_management` couvre la lecture et l'écriture : Meta
     * n'en publie pas de version intermédiaire. La garantie vient donc du code, pas de la
     * portée : le mode par défaut est la lecture, et rien ne part sans confirmation.
     *
     * `business_management` a été retirée après vérification. Elle sert à parcourir les
     * Business Manager eux-mêmes, ce qu'Evoliia ne fait pas : la liste des comptes rend déjà
     * ceux qu'une personne atteint à travers son entreprise, du moment qu'elle y a un rôle.
     * La demander aurait alourdi la revue de Meta pour une donnée dont personne ne se sert.
     */
    scopes: ['ads_read', 'ads_management'],
    costToEvoliia: 'quota-partage',
    costToCreator: 'gratuit',
    costNotice:
      'L’API Marketing de Meta est gratuite, et c’est votre compte qui est interrogé. Evoliia ne paie rien, vous non plus — vous continuez de payer vos publicités à Meta, comme avant.',
    /*
     * Meta compte ses appels par application ET par compte publicitaire, avec un budget qui
     * se reconstitue à l'heure. Le plafond appartient donc à l'application d'Evoliia et se
     * partage entre tous les comptes reliés — même situation que Google Ads, et même
     * discipline : une synchronisation par nuit et par compte, des chiffres gardés en base,
     * jamais un appel par affichage d'écran.
     */
    freeQuota:
      'Sans frais. Le plafond horaire est celui de l’application Evoliia et se partage entre tous les comptes reliés : les chiffres sont gardés et rafraîchis une fois par nuit, jamais à chaque ouverture d’écran.',
    webhooks: false,
    providerReview:
      'Meta exige une vérification d’entreprise et une revue de l’application avant d’autoriser `ads_read` et `ads_management` sur les comptes d’autrui, avec démonstration filmée du produit en fonctionnement. Comptez plusieurs semaines. Sans cette revue, la connexion ne fonctionne que sur les comptes dont vous êtes vous-même administrateur.',
    risk:
      'L’autorisation que Meta vous montre couvre la lecture et la gestion de vos publicités : c’est la seule qui existe pour cette API. Evoliia s’en sert pour lire, et toute modification demande votre confirmation, avec la valeur d’avant conservée pour pouvoir revenir en arrière. Vous pouvez révoquer l’accès à tout moment depuis les réglages de votre compte Facebook.',
    guide: {
      url: 'https://business.facebook.com',
      urlLabel: 'Ouvrir le gestionnaire Meta',
      steps: [
        'Vous devez avoir un compte publicitaire Meta avec des campagnes, et vous connecter avec le compte Facebook qui y a accès.',
        'Revenez ici et cliquez « Connecter Meta Ads ».',
        'Meta vous demande d’autoriser l’accès. C’est chez Meta que vous vous identifiez : Evoliia ne voit jamais votre mot de passe.',
        'Si vous avez plusieurs comptes publicitaires, choisissez celui que MIRA doit suivre.',
      ],
      caution:
        'Les chiffres de Meta bougent pendant quelques jours : un achat peut être attribué après coup, et la fenêtre d’attribution du compte décide de ce qui est compté. C’est le délai de Meta, pas celui d’Evoliia.',
    },
    reviewedOn: '2026-09-23',
  },
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
    guide: {
      url: 'https://dashboard.stripe.com/register',
      urlLabel: 'Ouvrir Stripe',
      steps: [
        'Cliquez sur « Connecter Stripe » ci-dessous : Evoliia vous envoie sur une page d’inscription Stripe à ses couleurs.',
        'Si vous avez déjà un compte Stripe, connectez-vous avec ; sinon créez-le sur place avec votre adresse e-mail.',
        'Stripe vous demande votre activité, l’identité du responsable et l’IBAN qui recevra vos ventes. Préparez une pièce d’identité.',
        'À la fin, Stripe vous ramène automatiquement sur Evoliia : la carte passe à « Connecté ».',
        'Si vous fermez la fenêtre à mi-chemin, revenez ici et cliquez sur « Reprendre la connexion » : rien n’est perdu.',
      ],
      caution:
        'Les paiements de vos clients arrivent sur votre compte Stripe, jamais sur celui d’Evoliia. Stripe prélève sa commission sur chaque vente ; Evoliia ne prend rien par défaut.',
    },
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
    guide: {
      url: 'https://console.anthropic.com/settings/keys',
      urlLabel: 'Ouvrir la console Anthropic',
      steps: [
        'Créez un compte sur console.anthropic.com, ou connectez-vous.',
        'Dans « Billing », ajoutez un petit crédit prépayé : c’est ce crédit que l’assistant de votre application consommera.',
        'Dans « Limits », fixez un plafond mensuel de dépense. Il vous protège en cas d’usage imprévu.',
        'Dans « API keys », cliquez « Create Key », nommez-la « Evoliia » et validez.',
        'Copiez la clé affichée une seule fois : elle commence par « sk-ant- ».',
        'Revenez ici, cliquez « Connecter » et collez-la. Evoliia la vérifie, puis la chiffre.',
      ],
      caution:
        'Chaque réponse de l’assistant de votre application sera facturée sur ce compte, à leur tarif, sans passer par vos crédits Evoliia.',
    },
    reviewedOn: '2026-09-12',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'ia',
    summary: 'Votre propre clé OpenAI, pour créer des images.',
    usage:
      'Depuis l’onglet Images de votre application, décrivez une image : elle est générée avec votre clé et se pose dans vos sections.',
    status: 'available',
    credential: 'API_KEY',
    connectionTarget: 'EVOLIIA',
    scopes: [],
    costToEvoliia: 'aucun',
    costToCreator: 'selon-usage',
    costNotice:
      'Chaque image générée est facturée sur votre compte OpenAI, quelques centimes l’image selon leur tarif. Evoliia ne prend rien et ne dépense rien.',
    freeQuota: 'Aucun. Le compte fonctionne par crédits prépayés, avec un plafond mensuel réglable.',
    webhooks: false,
    providerReview:
      'Aucune validation à obtenir : la clé se crée en deux minutes. Elle est vérifiée auprès d’OpenAI avant d’être enregistrée.',
    risk:
      'Une clé confiée est une clé à protéger : chiffrée au repos, jamais renvoyée au navigateur, jamais journalisée. Le nombre d’images par jour est plafonné pour qu’une boucle ne vide pas votre compte.',
    keyHelp: {
      label: 'Votre clé OpenAI',
      hint: 'Elle se crée sur platform.openai.com, dans « API keys ». Posez-y une limite de dépense mensuelle : c’est votre compte qui paie. La clé est chiffrée et ne vous sera plus jamais réaffichée.',
    },
    guide: {
      url: 'https://platform.openai.com/api-keys',
      urlLabel: 'Ouvrir la plateforme OpenAI',
      steps: [
        'Créez un compte sur platform.openai.com, ou connectez-vous. C’est le site développeurs, distinct de ChatGPT.',
        'Dans « Billing », ajoutez un moyen de paiement et un petit crédit prépayé, par exemple cinq dollars : une image coûte quelques centimes.',
        'Dans « Limits », fixez un plafond mensuel de dépense. Il vous protège en cas d’usage imprévu.',
        'Dans « API keys », cliquez « Create new secret key », nommez-la « Evoliia » et validez.',
        'Copiez la clé affichée une seule fois : elle commence par « sk- ».',
        'Revenez ici, cliquez « Connecter » et collez-la. Evoliia la vérifie, puis la chiffre.',
      ],
      caution:
        'Chaque image créée dans vos applications sera facturée sur ce compte. Evoliia plafonne à vingt images par jour pour vous protéger.',
    },
    reviewedOn: '2026-09-14',
  },
  {
    id: 'google-gemini',
    name: 'Google Gemini',
    category: 'ia',
    summary: 'Votre propre clé Google AI, pour créer des images.',
    usage:
      'Depuis l’onglet Images de votre application, décrivez une image : elle est générée avec votre clé et se pose dans vos sections.',
    status: 'available',
    credential: 'API_KEY',
    connectionTarget: 'EVOLIIA',
    scopes: [],
    costToEvoliia: 'aucun',
    costToCreator: 'selon-usage',
    costNotice:
      'Chaque image générée est facturée sur votre compte Google AI, quelques centimes l’image selon leur tarif. Evoliia ne prend rien et ne dépense rien.',
    freeQuota: 'Un palier gratuit limité existe chez Google ; au-delà, facturation à l’image.',
    webhooks: false,
    providerReview:
      'Aucune validation à obtenir : la clé se crée dans Google AI Studio. Elle est vérifiée auprès de Google avant d’être enregistrée.',
    risk:
      'Une clé confiée est une clé à protéger : chiffrée au repos, jamais renvoyée au navigateur, jamais journalisée. Le nombre d’images par jour est plafonné pour qu’une boucle ne vide pas votre compte.',
    keyHelp: {
      label: 'Votre clé Google AI',
      hint: 'Elle se crée sur aistudio.google.com, « Get API key ». Restreignez-la à l’API Generative Language. La clé est chiffrée et ne vous sera plus jamais réaffichée.',
    },
    guide: {
      url: 'https://aistudio.google.com/apikey',
      urlLabel: 'Ouvrir Google AI Studio',
      steps: [
        'Ouvrez aistudio.google.com et connectez-vous avec un compte Google.',
        'Cliquez « Get API key », puis « Create API key ». Google peut vous demander de choisir ou de créer un projet : acceptez la proposition par défaut.',
        'Copiez la clé affichée : elle commence par « AIza ».',
        'Conseillé : dans la console Google Cloud, restreignez la clé à l’API « Generative Language » et fixez une alerte de budget.',
        'Revenez ici, cliquez « Connecter » et collez-la. Evoliia la vérifie, puis la chiffre.',
      ],
      caution:
        'Google offre un palier gratuit limité ; au-delà, chaque image est facturée sur votre compte. Evoliia plafonne à vingt images par jour.',
    },
    reviewedOn: '2026-09-14',
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
    guide: {
      url: 'https://postelya.com',
      urlLabel: 'Ouvrir Postelya',
      steps: [
        'Connectez-vous à votre espace Postelya.',
        'Ouvrez « Réglages », puis « Relier un service ».',
        'Cliquez « Générer un code de liaison » : un code court s’affiche, valable un quart d’heure, utilisable une seule fois.',
        'Revenez ici, cliquez « Connecter » et collez ce code avant qu’il expire.',
        'Evoliia l’échange contre une autorisation durable : vous n’aurez pas à recommencer.',
      ],
      caution:
        'Evoliia dépose vos publications en brouillon dans Postelya. Rien ne part sur un réseau social sans que vous l’ayez validé là-bas.',
    },
    reviewedOn: '2026-09-12',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'commerce',
    summary: 'Votre boutique Shopify : fiches produits et articles de blog.',
    usage:
      'Lire vos fiches produits et vos articles pour voir ce qui leur manque côté référencement, et déposer les articles rédigés en brouillon dans votre blog — que vous relisez et publiez vous-même.',
    status: 'available',
    /*
     * Par identifiants d'application, et non par autorisation en un clic.
     *
     * Shopify a retiré en cours de route la création d'applications personnalisées depuis
     * l'administrateur de la boutique — le jeton collé une fois n'existe plus pour les
     * nouvelles installations. Son remplaçant, pour une boutique qu'on possède, est
     * l'échange d'identifiants contre un jeton de vingt-quatre heures. L'autorisation en un
     * clic, elle, suppose une application publique : revue de Shopify, webhooks de
     * conformité, adresse publique déclarée, et des semaines avant qu'un marchand puisse
     * s'en servir.
     */
    credential: 'API_KEY',
    connectionTarget: 'EVOLIIA',
    /*
     * En lecture seule, et la liste est littérale : ce sont les portées à déclarer dans le
     * Dev Dashboard. Rien ici ne permet d'écrire dans la boutique.
     */
    /*
     * `write_content` est la seule portée d'écriture, et elle ne sert qu'à déposer un
     * brouillon d'article. Rien dans le code ne publie : `isPublished` vaut `false` en dur
     * dans le connecteur. La portée permettrait de publier ; le produit ne le fait pas, et
     * c'est une décision qui se relit dans src/server/commerce/publication.ts.
     */
    scopes: ['read_products', 'read_content', 'write_content', 'read_orders'],
    costToEvoliia: 'aucun',
    costToCreator: 'gratuit',
    costNotice:
      'L’interface de gestion de Shopify est comprise dans votre abonnement Shopify. Evoliia ne paie rien, et vous non plus en plus de ce que vous payez déjà.',
    freeQuota:
      'Sans supplément, quelle que soit votre offre Shopify. Le débit est limité par Shopify, ce qui ralentit une lecture massive mais ne la facture pas.',
    webhooks: false,
    providerReview:
      'Aucune validation à obtenir : l’application reste privée et ne sert que vos propres boutiques. Une application publique, nécessaire pour figurer sur la place de marché Shopify, demanderait en revanche une revue de Shopify.',
    risk:
      'Evoliia lit vos fiches, vos articles et vos commandes — pour en tirer des totaux par jour, sans jamais conserver le nom, l’adresse ou le courriel d’un client —, et dépose les articles rédigés en brouillon non publié. Elle ne publie jamais : c’est vous qui relisez et publiez dans Shopify. La portée d’écriture qu’elle demande permettrait techniquement de publier — c’est le code qui s’y refuse, pas la permission. Ne déclarez aucune autre portée d’écriture sur cette application : Evoliia en hériterait.',
    extraFields: [
      {
        name: 'boutique',
        label: 'L’adresse de votre boutique',
        hint: 'Celle en .myshopify.com, visible dans Paramètres puis « Domaines ». Ce n’est pas l’adresse que voient vos clients.',
        placeholder: 'ma-boutique.myshopify.com',
      },
      {
        name: 'clientId',
        label: 'L’identifiant client de l’application',
        hint: 'Dans le Dev Dashboard, onglet « Settings » de votre application. Ce n’est pas un secret : il se saisit en clair.',
        placeholder: '0123456789abcdef0123456789abcdef',
      },
    ],
    keyHelp: {
      label: 'Le secret client de l’application',
      hint: 'Juste sous l’identifiant client, dans le même écran. Celui-là est un secret : Evoliia le chiffre et ne le réaffiche jamais.',
    },
    guide: {
      url: 'https://shopify.dev/dashboard',
      urlLabel: 'Ouvrir le Dev Dashboard',
      steps: [
        'Ouvrez le Dev Dashboard de Shopify et connectez-vous. Un compte partenaire gratuit suffit.',
        'Créez une application : donnez-lui un nom, par exemple « Evoliia ».',
        'Ouvrez l’onglet « Versions », déclarez les portées read_products, read_content, write_content et read_orders — cette dernière permet à Nova de lire vos ventes —, et rien d’autre, puis cliquez « Release ».',
        'Pour que Nova lise vos ventes : dans « API access », demandez l’accès aux « Protected customer data ». Nova n’a besoin d’aucun nom, courriel ni adresse de client.',
        'Revenez sur « Home », faites défiler jusqu’à « Install app » et installez l’application sur votre boutique.',
        'Ouvrez l’onglet « Settings » : l’identifiant client et le secret client s’y trouvent.',
        'Revenez ici et collez l’adresse de votre boutique, l’identifiant client et le secret client.',
      ],
      caution:
        'write_content est la seule portée d’écriture à déclarer : elle sert à déposer un brouillon d’article, rien d’autre. N’en ajoutez aucune autre — une application n’accorde que ce que vous avez déclaré, et Evoliia hériterait de tout ce qui figure là.',
    },
    reviewedOn: '2026-09-20',
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    category: 'commerce',
    summary: 'Votre boutique WooCommerce : ventes, canaux et produits, pour Nova.',
    usage:
      'Lire vos commandes pour que Nova calcule votre chiffre d’affaires réel, vos ventes par canal et par produit. En lecture seule : Evoliia ne modifie rien dans votre boutique.',
    status: 'available',
    credential: 'API_KEY',
    connectionTarget: 'EVOLIIA',
    scopes: ['read'],
    costToEvoliia: 'aucun',
    costToCreator: 'gratuit',
    costNotice: 'L’API REST est incluse dans WooCommerce. Evoliia ne paie rien, et vous non plus.',
    freeQuota: 'Sans limite facturée : c’est votre propre serveur qui répond. Nova le lit au plus toutes les douze heures.',
    webhooks: false,
    providerReview: 'Aucune validation : la clé est créée par vous, dans votre boutique, et se révoque d’un clic.',
    risk:
      'Evoliia lit vos commandes pour en tirer des totaux par jour — sans nom, courriel ni adresse de client, qu’elle ne demande même pas. Choisissez la permission « Lecture » : une clé « Lecture/Écriture » permettrait de modifier votre boutique, et Evoliia n’en a pas besoin.',
    extraFields: [
      {
        name: 'boutique',
        label: 'L’adresse de votre boutique',
        hint: 'Celle que voient vos clients, en https. Si WordPress est dans un sous-dossier, indiquez-le aussi.',
        placeholder: 'https://ma-boutique.ch',
      },
      {
        name: 'cle',
        label: 'La clé consommateur',
        hint: 'Elle commence par « ck_ ». Elle identifie la clé ; le secret, lui, se colle en dessous.',
        placeholder: 'ck_0123456789abcdef…',
      },
    ],
    keyHelp: {
      label: 'Le secret consommateur',
      hint: 'Il commence par « cs_ ». WooCommerce ne l’affiche qu’une fois : Evoliia le chiffre et ne le réaffiche jamais.',
    },
    guide: {
      url: 'https://woocommerce.com/document/woocommerce-rest-api/',
      urlLabel: 'Documentation WooCommerce',
      steps: [
        'Dans l’administration WordPress, ouvrez WooCommerce → Réglages → Avancé → API REST.',
        'Cliquez « Ajouter une clé ». Description : « Evoliia ». Utilisateur : vous. Permissions : « Lecture ».',
        'Cliquez « Générer une clé API » : la clé consommateur (ck_…) et le secret (cs_…) s’affichent une seule fois.',
        'Revenez ici et collez l’adresse de votre boutique, la clé et le secret.',
      ],
      caution: 'Permission « Lecture » uniquement. Evoliia n’écrit jamais dans WooCommerce.',
    },
    reviewedOn: '2026-09-23',
  },
  {
    id: 'stripe-revenus',
    name: 'Stripe (revenus et abonnements)',
    category: 'commerce',
    summary: 'Vos encaissements et vos abonnements Stripe, pour Nova : MRR, churn, valeur d’un abonné.',
    usage:
      'Lire vos abonnements pour que Nova calcule votre revenu mensuel récurrent, vos départs et vos cohortes, et vos paiements quand vous n’avez pas de boutique reliée. En lecture seule.',
    status: 'available',
    credential: 'API_KEY',
    connectionTarget: 'EVOLIIA',
    scopes: ['Subscriptions : lecture', 'Charges : lecture'],
    costToEvoliia: 'aucun',
    costToCreator: 'gratuit',
    costNotice: 'L’API de Stripe est gratuite. Evoliia ne paie rien, et vous non plus.',
    freeQuota: 'Sans limite facturée. Nova lit au plus toutes les douze heures.',
    webhooks: false,
    providerReview: 'Aucune validation : la clé restreinte est créée par vous et se supprime d’un clic.',
    risk:
      'Evoliia n’accepte qu’une clé restreinte en lecture : une clé secrète complète (sk_…) permettrait de rembourser et de virer, elle est refusée. Ce qui est gardé : des totaux (MRR, nombre d’abonnés, encaissements par jour) — aucun client, aucun identifiant.',
    keyHelp: {
      label: 'La clé restreinte Stripe',
      hint: 'Elle commence par « rk_live_ ». Evoliia la chiffre et ne la réaffiche jamais.',
    },
    guide: {
      url: 'https://dashboard.stripe.com/apikeys',
      urlLabel: 'Ouvrir les clés API Stripe',
      steps: [
        'Dans Stripe, ouvrez Développeurs → Clés API, puis « Créer une clé restreinte ».',
        'Nom : « Evoliia ». Laissez tout sur « Aucun », sauf « Subscriptions » et « Charges » : « Lecture ».',
        'Créez la clé et copiez-la : elle commence par « rk_live_ ».',
        'Revenez ici et collez-la.',
      ],
      caution: 'Jamais la clé secrète (sk_…) : elle donne tous les droits sur votre compte. Evoliia la refuse.',
    },
    reviewedOn: '2026-09-23',
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
