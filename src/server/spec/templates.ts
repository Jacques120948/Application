import { SPEC_VERSION, type AppSpec, type Theme } from './schema'
import { parseAppSpec, HOME_PATH } from './validate'

/**
 * Modèles de départ.
 *
 * Deux usages (exigence 21) :
 *   1. point de départ solide que l'IA personnalise ensuite ;
 *   2. chemin de repli déterministe lorsque l'assistant n'est pas configuré sur
 *      l'installation — l'interface indique alors clairement que la structure a été
 *      choisie par correspondance de mots-clés et non par l'assistant.
 *
 * Peu de modèles, mais complets et réellement fonctionnels.
 */

export const TEMPLATE_KINDS = [
  'subscription',
  'booking',
  'content',
  'coaching',
  'directory',
  'community',
] as const

export type TemplateKind = (typeof TEMPLATE_KINDS)[number]

export const TEMPLATE_LABELS: Record<TemplateKind, string> = {
  subscription: 'Application avec abonnement',
  booking: 'Application de réservation',
  content: 'Application de contenu',
  coaching: 'Application de coaching',
  directory: 'Annuaire ou catalogue',
  community: 'Application communautaire',
}

export { STYLE_PRESETS, STYLE_PRESET_IDS, THEME_PRESETS, type StylePreset } from '@/lib/style-presets'
import { THEME_PRESETS } from '@/lib/style-presets'

export const DEFAULT_THEME = THEME_PRESETS.confiance as Theme

export type TemplateOptions = {
  name: string
  tagline: string
  description: string
  locale: AppSpec['locale']
  theme?: Theme
}

type Builder = (options: Required<Pick<TemplateOptions, 'name' | 'tagline' | 'description'>>) => {
  dataModels: AppSpec['dataModels']
  pages: AppSpec['pages']
  navigation: AppSpec['navigation']
  monetization: AppSpec['monetization']
  auth: AppSpec['auth']
}

const builders: Record<TemplateKind, Builder> = {
  subscription: ({ name, tagline, description }) => ({
    auth: { enabled: true, allowSignup: true },
    dataModels: [
      {
        id: 'element',
        label: 'Élément',
        labelPlural: 'Mes éléments',
        scope: 'user',
        fields: [
          { id: 'titre', label: 'Titre', type: 'text', required: true },
          { id: 'note', label: 'Note', type: 'longText', required: false },
          { id: 'echeance', label: 'Échéance', type: 'date', required: false },
        ],
      },
    ],
    pages: [
      {
        id: 'accueil',
        title: 'Accueil',
        path: HOME_PATH,
        requiresAuth: false,
        blocks: [
          {
            id: 'hero',
            type: 'hero',
            title: name,
            subtitle: tagline,
            ctaLabel: 'Commencer',
            ctaPageId: 'compte',
          },
          {
            id: 'atouts',
            type: 'features',
            title: 'Ce que vous pouvez faire',
            items: [
              { title: 'Tout au même endroit', body: 'Retrouvez vos éléments depuis n\'importe quel appareil.', icon: 'home' },
              { title: 'Simple à utiliser', body: 'Une interface claire, sans réglage compliqué.', icon: 'spark' },
              { title: 'Vos données vous appartiennent', body: 'Chaque compte ne voit que ses propres données.', icon: 'lock' },
            ],
          },
          { id: 'presentation', type: 'richText', title: 'À propos', body: description },
        ],
      },
      {
        id: 'tarifs',
        title: 'Tarifs',
        path: 'tarifs',
        requiresAuth: false,
        blocks: [
          { id: 'prix', type: 'pricing', title: 'Choisissez votre formule' },
          {
            id: 'questions',
            type: 'faq',
            title: 'Questions fréquentes',
            items: [
              { question: 'Puis-je arrêter à tout moment ?', answer: 'Oui, l\'abonnement est sans engagement.' },
              { question: 'Mes données sont-elles privées ?', answer: 'Oui, seul votre compte y a accès.' },
            ],
          },
        ],
      },
      {
        id: 'compte',
        title: 'Mon espace',
        path: 'mon-espace',
        requiresAuth: true,
        blocks: [
          {
            id: 'ajout',
            type: 'recordForm',
            title: 'Ajouter un élément',
            modelId: 'element',
            submitLabel: 'Enregistrer',
            successMessage: 'C\'est enregistré.',
          },
          {
            id: 'liste',
            type: 'recordList',
            title: 'Mes éléments',
            modelId: 'element',
            titleField: 'titre',
            subtitleField: 'note',
            emptyText: 'Vous n\'avez encore rien enregistré.',
            allowDelete: true,
            allowEdit: true,
            searchable: true,
            sort: 'recent' as const,
            sumKind: 'somme' as const,
          },
        ],
      },
      {
        id: 'connexion',
        title: 'Connexion',
        path: 'connexion',
        requiresAuth: false,
        blocks: [
          {
            id: 'auth',
            type: 'auth',
            title: 'Accéder à mon espace',
            body: 'Créez un compte ou connectez-vous pour retrouver vos éléments.',
          },
        ],
      },
    ],
    navigation: {
      style: 'topbar',
      items: [
        { pageId: 'accueil', label: 'Accueil' },
        { pageId: 'tarifs', label: 'Tarifs' },
        { pageId: 'compte', label: 'Mon espace' },
        { pageId: 'connexion', label: 'Connexion' },
      ],
    },
    monetization: {
      model: 'freemium',
      currency: 'EUR',
      plans: [
        { id: 'free', name: 'Gratuit', priceCents: 0, interval: 'month', features: ['Usage de base'], highlighted: false },
        {
          id: 'pro',
          name: 'Pro',
          priceCents: 990,
          interval: 'month',
          features: ['Éléments illimités', 'Support prioritaire'],
          highlighted: true,
        },
      ],
      note: 'Potentiel de monétisation : abonnement mensuel avec une version gratuite d\'entrée.',
    },
  }),

  booking: ({ name, tagline, description }) => ({
    auth: { enabled: true, allowSignup: true },
    dataModels: [
      {
        id: 'reservation',
        label: 'Réservation',
        labelPlural: 'Mes réservations',
        scope: 'user',
        fields: [
          { id: 'nom', label: 'Votre nom', type: 'text', required: true },
          { id: 'date', label: 'Date souhaitée', type: 'date', required: true },
          {
            id: 'prestation',
            label: 'Prestation',
            type: 'select',
            required: true,
            options: ['Première visite', 'Suivi', 'Urgence'],
          },
          { id: 'message', label: 'Précisions', type: 'longText', required: false },
        ],
      },
    ],
    pages: [
      {
        id: 'accueil',
        title: 'Accueil',
        path: HOME_PATH,
        requiresAuth: false,
        blocks: [
          {
            id: 'hero',
            type: 'hero',
            title: name,
            subtitle: tagline,
            ctaLabel: 'Réserver',
            ctaPageId: 'reserver',
          },
          { id: 'presentation', type: 'richText', title: 'Présentation', body: description },
          {
            id: 'etapes',
            type: 'steps',
            title: 'Comment ça marche',
            items: [
              { title: 'Choisissez un créneau', body: 'Indiquez la date qui vous convient.', icon: 'calendar' },
              { title: 'Confirmez', body: 'Vous recevez une confirmation immédiate.', icon: 'check' },
              { title: 'Venez', body: 'Un rappel vous est envoyé la veille.', icon: 'bell' },
            ],
          },
        ],
      },
      {
        id: 'reserver',
        title: 'Réserver',
        path: 'reserver',
        requiresAuth: true,
        blocks: [
          {
            id: 'formulaire',
            type: 'recordForm',
            title: 'Demander un rendez-vous',
            modelId: 'reservation',
            submitLabel: 'Envoyer ma demande',
            successMessage: 'Votre demande est enregistrée. Vous recevrez une confirmation.',
          },
          {
            id: 'mes-reservations',
            type: 'recordList',
            title: 'Mes demandes',
            modelId: 'reservation',
            titleField: 'prestation',
            subtitleField: 'date',
            emptyText: 'Vous n\'avez pas encore de demande.',
            allowDelete: true,
            allowEdit: true,
            searchable: true,
            sort: 'recent' as const,
            sumKind: 'somme' as const,
          },
        ],
      },
      {
        id: 'connexion',
        title: 'Connexion',
        path: 'connexion',
        requiresAuth: false,
        blocks: [
          { id: 'auth', type: 'auth', title: 'Accéder à mon espace', body: 'Connectez-vous pour réserver.' },
        ],
      },
    ],
    navigation: {
      style: 'topbar',
      items: [
        { pageId: 'accueil', label: 'Accueil' },
        { pageId: 'reserver', label: 'Réserver' },
        { pageId: 'connexion', label: 'Connexion' },
      ],
    },
    monetization: {
      model: 'free',
      currency: 'EUR',
      plans: [],
      note: 'Potentiel de monétisation : commission par réservation ou abonnement professionnel.',
    },
  }),

  content: ({ name, tagline, description }) => ({
    auth: { enabled: true, allowSignup: true },
    dataModels: [
      {
        id: 'publication',
        label: 'Publication',
        labelPlural: 'Publications',
        scope: 'shared',
        fields: [
          { id: 'titre', label: 'Titre', type: 'text', required: true },
          { id: 'resume', label: 'Résumé', type: 'text', required: false },
          { id: 'contenu', label: 'Contenu', type: 'longText', required: true },
        ],
      },
    ],
    pages: [
      {
        id: 'accueil',
        title: 'Accueil',
        path: HOME_PATH,
        requiresAuth: false,
        blocks: [
          { id: 'hero', type: 'hero', title: name, subtitle: tagline, ctaLabel: 'Voir les publications', ctaPageId: 'publications' },
          { id: 'presentation', type: 'richText', title: 'À propos', body: description },
        ],
      },
      {
        id: 'publications',
        title: 'Publications',
        path: 'publications',
        requiresAuth: false,
        blocks: [
          {
            id: 'liste',
            type: 'recordList',
            title: 'Dernières publications',
            modelId: 'publication',
            titleField: 'titre',
            subtitleField: 'resume',
            emptyText: 'Aucune publication pour le moment.',
            allowDelete: false,
            allowEdit: true,
            searchable: true,
            sort: 'recent' as const,
            sumKind: 'somme' as const,
          },
        ],
      },
      {
        id: 'publier',
        title: 'Publier',
        path: 'publier',
        requiresAuth: true,
        blocks: [
          {
            id: 'formulaire',
            type: 'recordForm',
            title: 'Nouvelle publication',
            modelId: 'publication',
            submitLabel: 'Publier',
            successMessage: 'Votre publication est en ligne.',
          },
        ],
      },
      {
        id: 'connexion',
        title: 'Connexion',
        path: 'connexion',
        requiresAuth: false,
        blocks: [{ id: 'auth', type: 'auth', title: 'Se connecter' }],
      },
    ],
    navigation: {
      style: 'topbar',
      items: [
        { pageId: 'accueil', label: 'Accueil' },
        { pageId: 'publications', label: 'Publications' },
        { pageId: 'publier', label: 'Publier' },
        { pageId: 'connexion', label: 'Connexion' },
      ],
    },
    monetization: {
      model: 'free',
      currency: 'EUR',
      plans: [],
      note: 'Potentiel de monétisation : publicité, affiliation ou contenu réservé aux abonnés.',
    },
  }),

  coaching: ({ name, tagline, description }) => ({
    auth: { enabled: true, allowSignup: true },
    dataModels: [
      {
        id: 'seance',
        label: 'Séance',
        labelPlural: 'Mes séances',
        scope: 'user',
        fields: [
          { id: 'objectif', label: 'Objectif', type: 'text', required: true },
          { id: 'date', label: 'Date', type: 'date', required: true },
          { id: 'ressenti', label: 'Ressenti', type: 'longText', required: false },
        ],
      },
    ],
    pages: [
      {
        id: 'accueil',
        title: 'Accueil',
        path: HOME_PATH,
        requiresAuth: false,
        blocks: [
          { id: 'hero', type: 'hero', title: name, subtitle: tagline, ctaLabel: 'Commencer', ctaPageId: 'suivi' },
          {
            id: 'methode',
            type: 'features',
            title: 'La méthode',
            items: [
              { title: 'Fixez un objectif', body: 'Un objectif clair, atteignable, à votre rythme.', icon: 'target' },
              { title: 'Suivez vos séances', body: 'Notez ce que vous faites et comment vous vous sentez.' },
              { title: 'Mesurez vos progrès', body: 'Votre historique reste disponible à tout moment.' },
            ],
          },
          { id: 'presentation', type: 'richText', title: 'À propos', body: description },
        ],
      },
      {
        id: 'suivi',
        title: 'Mon suivi',
        path: 'mon-suivi',
        requiresAuth: true,
        blocks: [
          {
            id: 'ajout',
            type: 'recordForm',
            title: 'Ajouter une séance',
            modelId: 'seance',
            submitLabel: 'Enregistrer',
            successMessage: 'Séance enregistrée.',
          },
          {
            id: 'liste',
            type: 'recordList',
            title: 'Mes séances',
            modelId: 'seance',
            titleField: 'objectif',
            subtitleField: 'date',
            emptyText: 'Aucune séance enregistrée pour le moment.',
            allowDelete: true,
            allowEdit: true,
            searchable: true,
            sort: 'recent' as const,
            sumKind: 'somme' as const,
          },
        ],
      },
      {
        id: 'connexion',
        title: 'Connexion',
        path: 'connexion',
        requiresAuth: false,
        blocks: [{ id: 'auth', type: 'auth', title: 'Accéder à mon suivi' }],
      },
    ],
    navigation: {
      style: 'tabs',
      items: [
        { pageId: 'accueil', label: 'Accueil' },
        { pageId: 'suivi', label: 'Mon suivi' },
        { pageId: 'connexion', label: 'Connexion' },
      ],
    },
    monetization: {
      model: 'subscription',
      currency: 'EUR',
      plans: [
        {
          id: 'mensuel',
          name: 'Accompagnement',
          priceCents: 990,
          interval: 'month',
          features: ['Suivi illimité', 'Historique complet'],
          highlighted: true,
        },
      ],
      note: 'Potentiel de monétisation : abonnement mensuel d\'accompagnement.',
    },
  }),

  directory: ({ name, tagline, description }) => ({
    auth: { enabled: true, allowSignup: true },
    dataModels: [
      {
        id: 'fiche',
        label: 'Fiche',
        labelPlural: 'Fiches',
        scope: 'shared',
        fields: [
          { id: 'nom', label: 'Nom', type: 'text', required: true },
          { id: 'ville', label: 'Ville', type: 'text', required: true },
          { id: 'presentation', label: 'Présentation', type: 'longText', required: false },
          { id: 'contact', label: 'Contact', type: 'email', required: false },
        ],
      },
    ],
    pages: [
      {
        id: 'accueil',
        title: 'Accueil',
        path: HOME_PATH,
        requiresAuth: false,
        blocks: [
          { id: 'hero', type: 'hero', title: name, subtitle: tagline, ctaLabel: 'Parcourir', ctaPageId: 'annuaire' },
          { id: 'presentation', type: 'richText', title: 'À propos', body: description },
        ],
      },
      {
        id: 'annuaire',
        title: 'Annuaire',
        path: 'annuaire',
        requiresAuth: false,
        blocks: [
          {
            id: 'liste',
            type: 'recordList',
            title: 'Toutes les fiches',
            modelId: 'fiche',
            titleField: 'nom',
            subtitleField: 'ville',
            emptyText: 'Aucune fiche pour le moment.',
            allowDelete: false,
            allowEdit: true,
            searchable: true,
            sort: 'recent' as const,
            sumKind: 'somme' as const,
          },
        ],
      },
      {
        id: 'inscrire',
        title: 'Ajouter une fiche',
        path: 'ajouter',
        requiresAuth: true,
        blocks: [
          {
            id: 'formulaire',
            type: 'recordForm',
            title: 'Ajouter votre fiche',
            modelId: 'fiche',
            submitLabel: 'Publier ma fiche',
            successMessage: 'Votre fiche est en ligne.',
          },
        ],
      },
      {
        id: 'connexion',
        title: 'Connexion',
        path: 'connexion',
        requiresAuth: false,
        blocks: [{ id: 'auth', type: 'auth', title: 'Se connecter' }],
      },
    ],
    navigation: {
      style: 'topbar',
      items: [
        { pageId: 'accueil', label: 'Accueil' },
        { pageId: 'annuaire', label: 'Annuaire' },
        { pageId: 'inscrire', label: 'Ajouter une fiche' },
        { pageId: 'connexion', label: 'Connexion' },
      ],
    },
    monetization: {
      model: 'freemium',
      currency: 'EUR',
      plans: [
        { id: 'base', name: 'Fiche simple', priceCents: 0, interval: 'month', features: ['Fiche publiée'], highlighted: false },
        {
          id: 'mise-en-avant',
          name: 'Mise en avant',
          priceCents: 1490,
          interval: 'month',
          features: ['Fiche mise en avant', 'Contact direct'],
          highlighted: true,
        },
      ],
      note: 'Potentiel de monétisation : mise en avant payante des fiches.',
    },
  }),

  community: ({ name, tagline, description }) => ({
    auth: { enabled: true, allowSignup: true },
    dataModels: [
      {
        id: 'message',
        label: 'Message',
        labelPlural: 'Messages',
        scope: 'shared',
        fields: [
          { id: 'sujet', label: 'Sujet', type: 'text', required: true },
          { id: 'contenu', label: 'Votre message', type: 'longText', required: true },
        ],
      },
    ],
    pages: [
      {
        id: 'accueil',
        title: 'Accueil',
        path: HOME_PATH,
        requiresAuth: false,
        blocks: [
          { id: 'hero', type: 'hero', title: name, subtitle: tagline, ctaLabel: 'Rejoindre', ctaPageId: 'connexion' },
          { id: 'presentation', type: 'richText', title: 'Notre communauté', body: description },
        ],
      },
      {
        id: 'discussions',
        title: 'Discussions',
        path: 'discussions',
        requiresAuth: true,
        blocks: [
          {
            id: 'formulaire',
            type: 'recordForm',
            title: 'Publier un message',
            modelId: 'message',
            submitLabel: 'Publier',
            successMessage: 'Votre message est publié.',
          },
          {
            id: 'liste',
            type: 'recordList',
            title: 'Derniers messages',
            modelId: 'message',
            titleField: 'sujet',
            subtitleField: 'contenu',
            emptyText: 'Aucun message pour le moment.',
            allowDelete: false,
            allowEdit: true,
            searchable: true,
            sort: 'recent' as const,
            sumKind: 'somme' as const,
          },
        ],
      },
      {
        id: 'connexion',
        title: 'Connexion',
        path: 'connexion',
        requiresAuth: false,
        blocks: [{ id: 'auth', type: 'auth', title: 'Rejoindre la communauté' }],
      },
    ],
    navigation: {
      style: 'tabs',
      items: [
        { pageId: 'accueil', label: 'Accueil' },
        { pageId: 'discussions', label: 'Discussions' },
        { pageId: 'connexion', label: 'Connexion' },
      ],
    },
    monetization: {
      model: 'free',
      currency: 'EUR',
      plans: [],
      note: 'Potentiel de monétisation : espace réservé aux membres ou partenariats.',
    },
  }),
}

export function buildTemplate(kind: TemplateKind, options: TemplateOptions): AppSpec {
  const builder = builders[kind]
  const parts = builder({
    name: options.name,
    tagline: options.tagline,
    description: options.description,
  })
  return parseAppSpec({
    specVersion: SPEC_VERSION,
    name: options.name,
    tagline: options.tagline,
    description: options.description,
    locale: options.locale,
    theme: options.theme ?? DEFAULT_THEME,
    ...parts,
  } satisfies AppSpec)
}

const KEYWORDS: ReadonlyArray<{ kind: TemplateKind; words: readonly string[] }> = [
  { kind: 'booking', words: ['réserv', 'reserv', 'rendez-vous', 'rdv', 'créneau', 'booking', 'planning', 'agenda'] },
  { kind: 'coaching', words: ['coach', 'sport', 'entraîn', 'entrain', 'habitude', 'bien-être', 'bien-etre', 'suivi', 'progrès'] },
  { kind: 'directory', words: ['annuaire', 'catalogue', 'artisan', 'trouver', 'près de chez', 'pres de chez', 'carte', 'local'] },
  { kind: 'community', words: ['communaut', 'forum', 'échange', 'echange', 'entraide', 'réseau', 'reseau', 'membre'] },
  { kind: 'content', words: ['recette', 'article', 'blog', 'contenu', 'magazine', 'cours', 'tutoriel', 'apprendre'] },
  { kind: 'subscription', words: ['abonnement', 'saas', 'outil', 'tableau de bord', 'gestion', 'premium'] },
]

/**
 * Choix de modèle par correspondance de mots-clés.
 * Utilisé uniquement quand l'assistant n'est pas disponible : ce n'est pas de l'IA, et
 * l'interface le dit.
 */
export function chooseTemplate(idea: string): TemplateKind {
  const text = idea.toLowerCase()
  let best: { kind: TemplateKind; score: number } = { kind: 'content', score: 0 }
  for (const { kind, words } of KEYWORDS) {
    const score = words.reduce((total, word) => (text.includes(word) ? total + 1 : total), 0)
    if (score > best.score) best = { kind, score }
  }
  return best.kind
}
