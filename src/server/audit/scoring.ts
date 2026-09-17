import { readSetting } from '@/server/settings/store'
import { GEO_CHECKS } from './checks/geo'
import { SEO_CHECKS } from './checks/seo'
import type { Check, Contexte, PageVue, Severity, SiteVu } from './checks/types'

/**
 * Des constats, puis une note.
 *
 * Quatre décisions, et chacune répond à une façon de rendre un chiffre faux ou inutile.
 *
 * **La note est calculée, jamais devinée.** C'est la part des poids qui n'a pas été perdue.
 * Aucun modèle n'intervient : on peut reconstituer chaque point à la main, et c'est ce qui
 * permet de répondre « pourquoi 74 ? » autrement que par « c'est l'IA qui l'a dit ».
 *
 * **Ce qui ne s'applique pas ne compte pas.** Un contrôle sur les pages profondes n'a rien à
 * dire d'un site de trois pages. Le laisser dans le dénominateur ferait baisser la note d'un
 * site sans défaut, pour un défaut qu'il ne peut pas avoir.
 *
 * **Un constat est agrégé par contrôle.** « Quatorze fiches produits sans description » est
 * ce qu'il faut montrer ; quatorze lignes identiques ne diraient pas mieux et se
 * refermeraient plus vite.
 *
 * **La priorité, c'est ce qui coûte le plus.** Pas la gravité seule : un défaut « important »
 * sur quarante pages passe avant un défaut « critique » sur une seule. C'est la question que
 * se pose quelqu'un devant un audit — par quoi je commence — et le tri y répond directement.
 */

export type Constat = {
  checkId: string
  engine: 'seo' | 'geo'
  label: string
  why: string
  severity: Severity
  /** Pages concernées, et pages où le contrôle avait un sens. */
  affected: number
  examined: number
  weight: number
  /** Points perdus. Ce qui fait la note, et ce qui fait l'ordre des priorités. */
  lost: number
  /** Quelques exemples, jamais toute la liste : personne ne commence par cinquante adresses. */
  sample: { path: string; url: string; title: string }[]
}

export type Resultat = {
  /** Sur cent. Cent signifie que tout ce qui s'appliquait est passé. */
  score: number
  constats: Constat[]
}

/**
 * Les deux catalogues réunis, pour retrouver un contrôle à partir d'un constat enregistré.
 *
 * Les libellés ne sont pas en base : un constat de la semaine dernière emprunte la
 * formulation d'aujourd'hui, et réécrire une explication ne demande aucune migration.
 */
export const ALL_CHECKS: readonly Check[] = [...SEO_CHECKS, ...GEO_CHECKS]

/** Le contrôle derrière un identifiant, ou `undefined` s'il a été retiré du catalogue. */
export function findCheck(checkId: string): Check | undefined {
  return ALL_CHECKS.find((check) => check.id === checkId)
}

/** Clé de réglage : les poids, par identifiant de contrôle, en JSON. */
export const WEIGHTS_SETTING = 'audit.check.weights'

/** Au-delà, ce n'est plus un exemple, c'est la liste. */
const EXEMPLES_MAX = 5

/**
 * Les poids en vigueur.
 *
 * Réglables depuis l'administration parce qu'ils encodent un jugement — ce qui compte le
 * plus pour un site — et qu'un jugement n'a pas à passer par un déploiement. Un réglage
 * illisible ne casse rien : on retombe sur les poids du code.
 */
export async function checkWeights(): Promise<Map<string, number>> {
  const poids = new Map<string, number>()
  const brut = await readSetting(WEIGHTS_SETTING)
  if (brut === null || brut.trim() === '') return poids
  try {
    const valeur: unknown = JSON.parse(brut)
    if (valeur === null || typeof valeur !== 'object' || Array.isArray(valeur)) return poids
    for (const [cle, poids_] of Object.entries(valeur as Record<string, unknown>)) {
      const nombre = Number(poids_)
      if (Number.isFinite(nombre) && nombre >= 0) poids.set(cle, Math.round(nombre))
    }
  } catch {
    // Une saisie fautive dans le back-office ne doit pas faire disparaître la note.
  }
  return poids
}

/**
 * Ce qu'un contrôle peut consulter au-delà de sa page, calculé une fois.
 *
 * Les doublons et les pages orphelines n'existent que par comparaison : reconstruire ces
 * tables dans chaque contrôle coûterait autant de parcours que de contrôles.
 */
export function buildContexte(pages: readonly PageVue[], site: SiteVu): Contexte {
  const entrants = new Map<string, number>()
  const titres = new Map<string, number>()
  const descriptions = new Map<string, number>()
  const connues = new Map<string, number>()

  for (const page of pages) {
    connues.set(page.url, page.statusCode)
    const titre = page.signals.title.trim().toLowerCase()
    if (titre !== '') titres.set(titre, (titres.get(titre) ?? 0) + 1)
    const description = page.signals.description.trim().toLowerCase()
    if (description !== '') descriptions.set(description, (descriptions.get(description) ?? 0) + 1)
  }

  for (const page of pages) {
    for (const lien of page.signals.links) {
      if (!lien.interne || lien.url === '') continue
      // Un lien d'une page vers elle-même ne la rend pas atteignable.
      if (lien.url === page.url) continue
      entrants.set(lien.url, (entrants.get(lien.url) ?? 0) + 1)
    }
  }

  return { pages, site, entrants, titres, descriptions, connues }
}

/** Applique un contrôle et rend son constat, ou `null` s'il ne s'appliquait nulle part. */
function appliquer(check: Check, contexte: Contexte, poids: number): Constat | null {
  let affected = 0
  let examined = 0
  const sample: Constat['sample'] = []

  if (check.scope === 'site') {
    const verdict = check.run(contexte.site, contexte)
    if (verdict === null) return null
    examined = 1
    affected = verdict ? 1 : 0
  } else {
    for (const page of contexte.pages) {
      const verdict = check.run(page, contexte)
      if (verdict === null) continue
      examined += 1
      if (!verdict) continue
      affected += 1
      if (sample.length < EXEMPLES_MAX) {
        sample.push({ path: page.path, url: page.url, title: page.signals.title.slice(0, 120) })
      }
    }
  }

  if (examined === 0) return null

  /*
   * Les points perdus sont proportionnels à l'étendue du problème. Un titre manquant sur une
   * page parmi cinquante ne doit pas coûter autant que sur les cinquante : c'est le même
   * défaut, ce n'est pas le même travail ni le même dommage.
   */
  const lost = Math.round((poids * affected) / examined)

  return {
    checkId: check.id,
    engine: check.engine,
    label: check.label,
    why: check.why,
    severity: check.severity,
    affected,
    examined,
    weight: poids,
    lost,
    sample,
  }
}

/**
 * Note un audit.
 *
 * Rend aussi les contrôles réussis : ils ne pèsent rien dans la note mais ils disent ce qui
 * va, et un audit qui ne montre que des défauts donne une image fausse d'un site correct.
 */
export async function evaluate(
  pages: readonly PageVue[],
  site: SiteVu,
  checks: readonly Check[] = SEO_CHECKS,
): Promise<Resultat> {
  return noter(checks, buildContexte(pages, site), await checkWeights())
}

/**
 * Les deux notes d'un même audit, en un seul passage.
 *
 * Le référencement et la visibilité dans les assistants répondent à deux questions
 * distinctes et méritent deux notes : un site peut être irréprochable pour Google et
 * inexploitable par un assistant, et une note unique masquerait exactement ce qu'on veut
 * montrer. Le contexte et les poids, eux, ne se calculent qu'une fois : ce sont les mêmes
 * pages.
 *
 * La note GEO mesure une aptitude à être repris, jamais une présence obtenue. Aucun écran ne
 * doit la présenter comme une garantie d'apparaître dans ChatGPT, Gemini ou Perplexity :
 * personne ne connaît leurs critères, et ils changent.
 */
export async function evaluateAll(
  pages: readonly PageVue[],
  site: SiteVu,
): Promise<{ seo: Resultat; geo: Resultat }> {
  const reglages = await checkWeights()
  const contexte = buildContexte(pages, site)
  return {
    seo: noter(SEO_CHECKS, contexte, reglages),
    geo: noter(GEO_CHECKS, contexte, reglages),
  }
}

/** Applique un catalogue à un contexte déjà construit. */
function noter(
  checks: readonly Check[],
  contexte: Contexte,
  reglages: Map<string, number>,
): Resultat {
  const constats: Constat[] = []
  let total = 0
  let perdu = 0

  for (const check of checks) {
    const poids = reglages.get(check.id) ?? check.weight
    const constat = appliquer(check, contexte, poids)
    if (constat === null) continue
    constats.push(constat)
    total += poids
    perdu += constat.lost
  }

  /*
   * Aucun contrôle applicable : la note est vide, pas nulle. Zéro se lirait comme un site
   * catastrophique, alors qu'il n'y a simplement rien eu à mesurer.
   */
  const score = total === 0 ? 100 : Math.max(0, Math.round(100 * (1 - perdu / total)))

  // Les plus coûteux d'abord : c'est l'ordre dans lequel on veut les traiter.
  constats.sort((a, b) => b.lost - a.lost || b.weight - a.weight)

  return { score, constats }
}

/** Les constats à traiter, du plus coûteux au moins. Les réussites n'y figurent pas. */
export function priorities(resultat: Resultat, combien = 5): Constat[] {
  return resultat.constats.filter((constat) => constat.affected > 0).slice(0, combien)
}
