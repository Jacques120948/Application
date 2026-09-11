import type { Blueprint } from '@/server/ai/schemas'
import { chooseTemplate, TEMPLATE_LABELS } from '@/server/spec/templates'

/**
 * Construction du plan qui sert d'entrée au générateur d'application.
 *
 * Deux sources possibles, aucune n'appelle le modèle :
 *   - `blueprintFromIdea` : parcours guidé. L'idée a déjà été proposée puis analysée, tout
 *     est connu. Rappeler le modèle pour reformuler ce qu'il vient de dire serait payer
 *     deux fois et risquer une incohérence.
 *   - `heuristicBlueprint` : repli quand le copilote n'est pas configuré. L'interface
 *     indique alors explicitement que la structure vient d'un modèle de départ, jamais
 *     qu'une IA a travaillé.
 */

const THEME_BY_KIND = {
  subscription: 'confiance',
  booking: 'confiance',
  content: 'elegance',
  coaching: 'nature',
  directory: 'chaleur',
  community: 'nature',
} as const

const FEATURES_BY_KIND = {
  subscription: [
    { title: 'Espace personnel', body: 'Chaque visiteur retrouve ses propres données après connexion.' },
    { title: 'Formules tarifaires', body: 'Une version gratuite et une version payante sont présentées.' },
    { title: 'Pages de présentation', body: 'Accueil, tarifs et questions fréquentes sont prêts.' },
  ],
  booking: [
    { title: 'Demande de rendez-vous', body: 'Vos visiteurs choisissent une date et une prestation.' },
    { title: 'Suivi des demandes', body: 'Chacun retrouve ses réservations dans son espace.' },
    { title: 'Page de présentation', body: 'Votre activité est présentée clairement.' },
  ],
  content: [
    { title: 'Publications', body: 'Les contenus sont listés et consultables par tous.' },
    { title: 'Publication réservée', body: 'Seuls les comptes connectés peuvent publier.' },
    { title: 'Page à propos', body: 'Votre projet est expliqué aux visiteurs.' },
  ],
  coaching: [
    { title: 'Suivi personnel', body: 'Chaque personne note ses séances et son ressenti.' },
    { title: 'Historique privé', body: 'Les données restent visibles par leur seul propriétaire.' },
    { title: 'Présentation de la méthode', body: 'Votre approche est décrite sur la page d\'accueil.' },
  ],
  directory: [
    { title: 'Annuaire public', body: 'Toutes les fiches sont consultables sans compte.' },
    { title: 'Ajout de fiche', body: 'Les membres connectés publient leur propre fiche.' },
    { title: 'Mise en avant', body: 'Une formule payante permet de se démarquer.' },
  ],
  community: [
    { title: 'Discussions', body: 'Les membres publient et consultent les messages.' },
    { title: 'Accès réservé', body: 'La discussion est réservée aux comptes connectés.' },
    { title: 'Page d\'accueil', body: 'La communauté est présentée aux visiteurs.' },
  ],
} as const

const MONETIZATION_BY_KIND = {
  subscription: [
    { model: 'freemium' as const, label: 'Version gratuite puis abonnement', rationale: 'Les visiteurs essaient avant de payer.' },
    { model: 'subscription' as const, label: 'Abonnement mensuel', rationale: 'Revenu régulier, sans engagement pour le client.' },
  ],
  booking: [
    { model: 'free' as const, label: 'Gratuit au départ', rationale: 'Priorité au volume de réservations.' },
    { model: 'subscription' as const, label: 'Abonnement professionnel', rationale: 'Facturé au professionnel, pas au client final.' },
  ],
  content: [
    { model: 'free' as const, label: 'Gratuit', rationale: "Construire l'audience d'abord." },
    { model: 'freemium' as const, label: 'Contenu réservé aux abonnés', rationale: 'Une partie du contenu devient payante.' },
  ],
  coaching: [
    { model: 'subscription' as const, label: 'Abonnement mensuel', rationale: "L'accompagnement se paie dans la durée." },
  ],
  directory: [
    { model: 'freemium' as const, label: 'Fiche gratuite, mise en avant payante', rationale: 'Les professionnels paient pour la visibilité.' },
  ],
  community: [
    { model: 'free' as const, label: 'Gratuit', rationale: "Une communauté a besoin de membres avant de monétiser." },
  ],
} as const

function firstSentence(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trimEnd()}…`
}

function deriveName(idea: string): string {
  const words = idea
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3)
  const picked = words.slice(0, 2)
  if (picked.length === 0) return 'Mon application'
  return picked.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Plan déduit du cahier des charges approuvé.
 *
 * C'est le point de jonction entre le parcours entrepreneurial et le moteur de génération
 * qui existait déjà. Aucun second moteur n'est créé : on traduit simplement le document
 * approuvé dans le format d'entrée que le moteur attend.
 */
export function blueprintFromSpecSheet(sheet: {
  appName: string
  tagline: string
  summary: string
  problem: string
  forWho: string
  mvpFeatures: ReadonlyArray<{ title: string; why: string }>
  postponed: ReadonlyArray<{ title: string; why: string }>
  paymentModel: string
  whatIsPaid: string
  externalServices: ReadonlyArray<{ name: string; why: string; paid: boolean }>
}): Blueprint {
  const templateKind = chooseTemplate(
    `${sheet.appName} ${sheet.problem} ${sheet.tagline} ${sheet.mvpFeatures.map((f) => f.title).join(' ')}`,
  )

  const limitations = [
    ...sheet.postponed.slice(0, 4).map((item) => `Volontairement reporté : ${item.title} — ${item.why}`),
    ...sheet.externalServices
      .filter((service) => service.paid)
      .slice(0, 2)
      .map((service) => `${service.name} est un service payant : ${service.why}`),
  ]

  return {
    feasible: true,
    appName: sheet.appName.slice(0, 60),
    tagline: sheet.tagline.slice(0, 160),
    concept: sheet.problem.slice(0, 600),
    description: sheet.summary.slice(0, 1500),
    features: sheet.mvpFeatures.slice(0, 8).map((feature) => ({
      title: feature.title.slice(0, 80),
      body: feature.why.slice(0, 300),
    })),
    monetization: [
      {
        model: normaliseModel(sheet.paymentModel),
        label: MODEL_LABEL[normaliseModel(sheet.paymentModel)],
        rationale: sheet.whatIsPaid.slice(0, 300),
      },
    ],
    templateKind,
    themePreset: THEME_BY_KIND[templateKind],
    limitations: limitations.slice(0, 5),
  }
}

/** Plan déduit d'une idée analysée, quand aucun cahier des charges n'a été rédigé. */
export function blueprintFromIdea(idea: {
  title: string
  problem: string
  valueProposition: string
  audience: string
  features: readonly string[]
  businessModel: string
  differentiators: readonly string[]
  validation: {
    essentialFeatures?: readonly string[]
    featuresToAvoid?: readonly string[]
    pricingRationale?: string
  } | null
}): Blueprint {
  const description = [idea.problem, idea.valueProposition].join(' ').trim()
  const templateKind = chooseTemplate(`${idea.title} ${idea.problem} ${idea.valueProposition}`)

  // La validation prime sur la proposition initiale : c'est l'analyse la plus complète.
  const retained = idea.validation?.essentialFeatures ?? idea.features
  const features = retained.slice(0, 6).map((feature) => ({
    title: feature.slice(0, 80),
    body: `Prévu dans la première version pour ${idea.audience.slice(0, 200)}.`,
  }))

  const limitations = (idea.validation?.featuresToAvoid ?? [])
    .slice(0, 4)
    .map((feature) => `Volontairement écarté de la première version : ${feature}`)

  return {
    feasible: true,
    appName: idea.title.slice(0, 60),
    tagline: idea.valueProposition.slice(0, 160),
    concept: idea.problem.slice(0, 600),
    description: description.length > 0 ? description.slice(0, 1500) : idea.title,
    features:
      features.length >= 2
        ? features
        : [...features, { title: 'Espace personnel', body: 'Chaque utilisateur retrouve ses données.' }],
    monetization: [
      {
        model: normaliseModel(idea.businessModel),
        label: MODEL_LABEL[normaliseModel(idea.businessModel)],
        rationale:
          idea.validation?.pricingRationale?.slice(0, 300) ??
          idea.differentiators[0]?.slice(0, 300) ??
          'Modèle retenu lors de l’analyse de l’idée.',
      },
    ],
    templateKind,
    themePreset: THEME_BY_KIND[templateKind],
    limitations,
  }
}

const MODEL_LABEL = {
  free: 'Application gratuite',
  one_time: 'Paiement unique',
  subscription: 'Abonnement',
  freemium: 'Gratuit puis payant',
  credits: 'Crédits',
} as const

function normaliseModel(value: string): keyof typeof MODEL_LABEL {
  return value in MODEL_LABEL ? (value as keyof typeof MODEL_LABEL) : 'subscription'
}

export function heuristicBlueprint(idea: string): Blueprint {
  const templateKind = chooseTemplate(idea)
  return {
    feasible: true,
    appName: deriveName(idea),
    tagline: firstSentence(idea, 140),
    concept: `${TEMPLATE_LABELS[templateKind]} construite à partir de votre description.`,
    description: firstSentence(idea, 1200),
    features: [...FEATURES_BY_KIND[templateKind]],
    monetization: [...MONETIZATION_BY_KIND[templateKind]],
    templateKind,
    themePreset: THEME_BY_KIND[templateKind],
    limitations: [
      "L'assistant n'est pas configuré sur cette installation : la structure vient d'un modèle de départ, pas d'une analyse de votre idée.",
    ],
  }
}
