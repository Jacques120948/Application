import { formatPrice, type PriceInterval } from '@/server/business/economics'
import type { AppSpec } from '@/server/spec/schema'
import type { BrandContext } from '@/lib/marketing'

/**
 * Du projet Evoliia vers le contexte de marque du moteur.
 *
 * Exigence de fond : ne rien redemander. Le créateur a déjà décrit son problème, sa cible,
 * sa proposition de valeur et son prix pendant le parcours d'idée ; l'application publiée
 * porte son nom, son accroche et ses couleurs. Le moteur reçoit tout cela d'un coup.
 *
 * Fonction pure, et c'est voulu : la correspondance entre deux vocabulaires est exactement
 * le genre d'endroit où une erreur passe inaperçue jusqu'à ce qu'un texte parle du mauvais
 * produit. Elle se teste donc sans base de données.
 *
 * Un champ absent reste absent. Aucune valeur n'est inventée pour « remplir » : le moteur a
 * pour consigne de ne rien affirmer qu'on ne lui ait dit, et lui transmettre un
 * remplissage reviendrait à contourner cette consigne depuis chez nous.
 */

export type ProjectContextSource = {
  project: { name: string; idea: string; locale: string }
  spec: AppSpec | null
  idea: {
    title: string
    problem: string
    audience: string
    valueProposition: string
    features: unknown
    differentiators: unknown
    recommendedPriceCents: number
    priceInterval: string
    currency: string
  } | null
  /** Adresse publique de l'application, quand elle est en ligne. */
  publicUrl: string | null
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, max)
}

/**
 * Le ton se déduit de ce que le créateur a choisi, pas d'une supposition.
 *
 * Le thème de l'application est le seul indice d'identité dont Evoliia dispose aujourd'hui :
 * une police à empattements et un fond sombre ne donnent pas la même impression qu'un fond
 * clair et des angles arrondis. On en tire deux ou trois mots, jamais un portrait complet.
 */
export function toneFromSpec(spec: AppSpec | null): string[] {
  if (spec === null) return ['simple', 'direct']
  const tone: string[] = ['simple', 'direct']
  const byFont: Record<string, string> = {
    serif: 'posé',
    rounded: 'chaleureux',
    elegant: 'raffiné',
    geometric: 'net',
    editorial: 'posé',
    playful: 'joueur',
    bold: 'affirmé',
  }
  const fontTone = byFont[spec.theme.font]
  if (fontTone !== undefined) tone.push(fontTone)
  if (spec.theme.mode === 'dark') tone.push('sobre')
  return tone
}

const PRICE_INTERVALS: readonly string[] = ['once', 'month', 'year']

export function toBrandContext(source: ProjectContextSource): BrandContext {
  const { project, spec, idea } = source

  const interval: PriceInterval = PRICE_INTERVALS.includes(idea?.priceInterval ?? '')
    ? (idea?.priceInterval as PriceInterval)
    : 'month'

  const priceLabel =
    idea === null || idea.recommendedPriceCents <= 0
      ? null
      : formatPrice(idea.recommendedPriceCents, interval, idea.currency)

  const locale = (['fr', 'en', 'de', 'it', 'es'] as const).includes(
    project.locale as 'fr' | 'en' | 'de' | 'it' | 'es',
  )
    ? (project.locale as BrandContext['locale'])
    : 'fr'

  return {
    name: spec?.name ?? project.name,
    tagline: spec?.tagline ?? '',
    description: spec?.description ?? project.idea,
    problem: idea?.problem ?? '',
    audience: idea?.audience ?? '',
    valueProposition: idea?.valueProposition ?? '',
    // Les fonctionnalités décrites dans l'idée priment : elles sont écrites pour un humain,
    // alors que celles de la spécification sont des pages et des champs.
    features: idea === null ? pagesAsFeatures(spec) : stringList(idea.features, 20),
    differentiators: stringList(idea?.differentiators, 10),
    priceLabel,
    website: source.publicUrl,
    sector: null,
    voice: { tone: toneFromSpec(spec), forbidden: [], keywords: [] },
    locale,
  }
}

/** Repli quand le projet ne vient pas du parcours guidé : les titres de pages. */
function pagesAsFeatures(spec: AppSpec | null): string[] {
  if (spec === null) return []
  return spec.pages.map((page) => page.title).slice(0, 20)
}
