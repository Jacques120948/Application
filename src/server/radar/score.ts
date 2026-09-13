/**
 * Score d'opportunité Evoliia.
 *
 * Jusqu'ici la note venait du modèle, d'un bloc, sans qu'on sache ce qu'elle pesait. Elle
 * est désormais calculée ici, à partir de composantes que le modèle qualifie mais ne
 * pondère pas. C'est ce qui la rend explicable — chaque écran peut montrer les cinq
 * curseurs — et comparable d'une recherche à l'autre, puisque la formule ne bouge pas quand
 * le modèle change d'humeur.
 *
 * **Ce qu'elle est** : un outil de comparaison entre opportunités, pour une personne
 * donnée. **Ce qu'elle n'est pas** : une probabilité de réussite, une étude de marché, une
 * promesse. L'interface le dit à côté de chaque score, et la formule ne produit rien qui
 * ressemble à un pourcentage de chance.
 *
 * Pondération, en pour cent :
 *
 *   compatibilité avec le profil   25
 *   demande estimée                25
 *   monétisation                   20
 *   concurrence (inversée)         15
 *   complexité (inversée)          15
 *
 * La compatibilité est la composante la plus lourde avec la demande, parce que c'est celle
 * qui distingue ce module d'un générateur d'idées : une opportunité excellente pour
 * quelqu'un d'autre n'en est pas une pour cette personne. Les deux composantes inversées
 * comptent moins : une forte concurrence n'interdit pas un projet, elle le rend plus
 * exigeant.
 */

import { LEVELS } from '@/server/ai/schemas'

/** Un niveau qualitatif, tel que le modèle le produit. */
export type Level = (typeof LEVELS)[number]

export const WEIGHTS = {
  profileFit: 25,
  demand: 25,
  monetization: 20,
  competition: 15,
  complexity: 15,
} as const

export type SubScores = {
  /** Sur dix. */
  profileFit: number
  demand: number
  monetization: number
  /** Sur dix, déjà inversée : dix = peu de concurrence. */
  competition: number
  /** Sur dix, déjà inversée : dix = simple à construire. */
  complexity: number
}

/** Un niveau qualitatif devient une note sur dix. Trois paliers, sans fausse précision. */
export function levelToTen(level: Level): number {
  return level === 'fort' ? 8.5 : level === 'moyen' ? 5.5 : 2.5
}

/** Même chose, inversée, pour ce qui pèse contre l'opportunité. */
export function inverseLevelToTen(level: Level): number {
  return 10 - levelToTen(level) + 1.5
}

function clamp10(value: number): number {
  return Math.max(0, Math.min(10, value))
}

/**
 * Compatibilité avec le profil, calculée par la plateforme.
 *
 * Le modèle explique *pourquoi* une idée convient ; il ne décide pas *combien*. La note
 * part d'un milieu neutre et bouge selon des faits comparables : la clientèle visée
 * correspond-elle à ce que la personne veut ? Le délai tient-il dans son temps ? Le coût
 * de fonctionnement dans son budget ? Le modèle économique est-il celui qu'elle préfère ?
 * Le secteur lui est-il familier ?
 */
export function profileFit(params: {
  profile: {
    weeklyHours: number
    budgetCents: number
    audience: string
    preferredModel: string
    sector: string
    knownSectors: string
    technicalLevel: string
    productPreference: string
  }
  idea: {
    audience: string
    timeToMarketWeeks: number
    runningCostCents: number
    businessModel: string
    complexityLevel: Level
    title: string
    problem: string
  }
}): number {
  const { profile, idea } = params
  let note = 5.5

  // Clientèle : « professionnels » chez la personne et une idée qui parle d'entreprises,
  // d'artisans ou de cabinets vont ensemble ; « particuliers » et une idée grand public aussi.
  const cible = `${idea.audience} ${idea.problem}`.toLowerCase()
  const pro = /entreprise|artisan|cabinet|professionnel|indépendant|commer|agence|b2b/.test(cible)
  if (profile.audience === 'professionnels') note += pro ? 1.5 : -1.5
  if (profile.audience === 'particuliers') note += pro ? -1.5 : 1.5

  // Temps disponible : à moins de cinq heures par semaine, un délai long est un obstacle.
  if (profile.weeklyHours < 5) note += idea.timeToMarketWeeks <= 4 ? 1 : -1.5
  else if (profile.weeklyHours >= 15) note += 0.5

  // Budget : le coût de fonctionnement mensuel doit tenir dans le budget de départ.
  if (idea.runningCostCents > profile.budgetCents) note -= 1.5
  else if (idea.runningCostCents * 6 <= profile.budgetCents) note += 0.5

  // Modèle économique préféré.
  if (profile.preferredModel !== 'indifferent') {
    note += profile.preferredModel === idea.businessModel ? 1 : -0.5
  }

  // Secteur familier : les mots du secteur ou des secteurs connus dans l'idée.
  const familiers = `${profile.sector} ${profile.knownSectors}`
    .toLowerCase()
    .split(/[\s,;/]+/)
    .filter((mot) => mot.length >= 4)
  const texte = `${idea.title} ${idea.problem} ${idea.audience}`.toLowerCase()
  if (familiers.some((mot) => texte.includes(mot))) note += 1.5

  // Niveau technique : une personne débutante et une idée complexe ne vont pas ensemble.
  if (profile.technicalLevel === 'debutant' && idea.complexityLevel === 'fort') note -= 1

  return clamp10(Math.round(note * 10) / 10)
}

export function subScores(params: {
  profileFit: number
  demandLevel: Level
  monetizationLevel: Level
  competitionLevel: Level
  complexityLevel: Level
}): SubScores {
  return {
    profileFit: clamp10(params.profileFit),
    demand: levelToTen(params.demandLevel),
    monetization: levelToTen(params.monetizationLevel),
    competition: clamp10(inverseLevelToTen(params.competitionLevel)),
    complexity: clamp10(inverseLevelToTen(params.complexityLevel)),
  }
}

/** Le score, de 0 à 100. Somme pondérée des cinq composantes. */
export function opportunityScore(scores: SubScores): number {
  const total =
    scores.profileFit * WEIGHTS.profileFit +
    scores.demand * WEIGHTS.demand +
    scores.monetization * WEIGHTS.monetization +
    scores.competition * WEIGHTS.competition +
    scores.complexity * WEIGHTS.complexity
  return Math.round(total / 10)
}

/**
 * Empreinte d'une idée, pour ne pas la reproposer sous un autre titre.
 *
 * Ce n'est pas une similarité sémantique — celle-ci viendra avec des vecteurs en V2 — mais
 * une empreinte lexicale : les mots porteurs du titre et du problème, triés, dédoublonnés.
 * Deux idées qui partagent la moitié de ces mots sont tenues pour la même. C'est grossier
 * exprès : mieux vaut écarter une idée voisine que faire payer deux fois la même.
 */
const MOTS_VIDES = new Set([
  'pour', 'des', 'les', 'une', 'un', 'de', 'du', 'la', 'le', 'et', 'ou', 'en', 'à', 'au',
  'aux', 'sur', 'avec', 'sans', 'par', 'qui', 'que', 'leur', 'leurs', 'son', 'ses', 'ce',
  'cette', 'ces', 'application', 'outil', 'plateforme', 'service', 'petites', 'petits',
  'gestion', 'suivi', 'simple',
])

export function fingerprintTokens(title: string, problem: string): string[] {
  return [
    ...new Set(
      `${title} ${problem}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((mot) => mot.length >= 4 && !MOTS_VIDES.has(mot))
        // Un pluriel n'est pas une idée différente.
        .map((mot) => mot.replace(/(s|x)$/, '')),
    ),
  ].sort()
}

export function fingerprint(title: string, problem: string): string {
  return fingerprintTokens(title, problem).slice(0, 12).join(' ')
}

/** Vrai quand deux empreintes partagent assez de mots pour désigner la même idée. */
export function looksAlike(a: string, b: string): boolean {
  const ta = new Set(a.split(' ').filter(Boolean))
  const tb = new Set(b.split(' ').filter(Boolean))
  if (ta.size === 0 || tb.size === 0) return false
  let communs = 0
  for (const mot of ta) if (tb.has(mot)) communs += 1
  return communs / Math.min(ta.size, tb.size) >= 0.5
}
