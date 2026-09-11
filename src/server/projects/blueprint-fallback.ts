import type { Blueprint } from '@/server/ai/schemas'
import { chooseTemplate, TEMPLATE_LABELS } from '@/server/spec/templates'

/**
 * Plan d'application construit sans IA.
 *
 * Utilisé uniquement lorsque l'assistant n'est pas configuré sur l'installation.
 * L'interface indique alors explicitement que la structure vient d'un modèle de départ
 * et non de l'assistant : on ne fait jamais passer une heuristique pour de l'IA.
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
