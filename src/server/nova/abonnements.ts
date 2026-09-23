import type { Abonnement } from '@/server/integrations/providers/stripe-lecture'

/**
 * Les abonnements : ce qu'une activité récurrente regarde avant tout le reste.
 *
 * Tout est calculé ici, par du code, depuis la liste des abonnements Stripe : le MRR (revenu
 * mensuel récurrent), les abonnés, ce qui entre et ce qui part chaque mois, le churn, la
 * valeur d'un abonné, les cohortes. Rien n'est demandé au modèle.
 *
 * Deux approximations, dites à l'écran. Le montant d'un abonnement est son prix **actuel** :
 * Stripe ne garde pas l'historique des prix d'un abonnement, un changement de formule se
 * reporte donc sur les mois passés. Les remises ne sont pas déduites.
 */

export type MoisAbonnements = {
  /** AAAA-MM */
  mois: string
  /** MRR en fin de mois, en unités de la devise. */
  mrr: number
  /** Abonnés payants en fin de mois. */
  actifs: number
  nouveaux: number
  perdus: number
  mrrNouveau: number
  mrrPerdu: number
}

export type Cohorte = {
  /** Le mois où ces abonnés ont commencé à payer. */
  mois: string
  depart: number
  /** Part encore abonnée à la fin de chaque mois suivant (0 = le mois de départ), de 0 à 1. */
  restants: number[]
}

export type InstantaneAbonnements = {
  au: string
  devise: string
  mrr: number
  actifs: number
  /** En essai gratuit : ni dans le MRR, ni dans les actifs. */
  essais: number
  /** Abonnements à prix variable (paliers, usage) : comptés comme actifs, absents du MRR. */
  nonChiffres: number
  /** Abonnements dans une autre devise, écartés des totaux. */
  autresDevises: number
  serie: MoisAbonnements[]
  cohortes: Cohorte[]
}

/** Les mois affichés : l'année écoulée et le mois en cours. */
export const MOIS_SERIE = 13
/** En deçà, une cohorte est une anecdote. */
export const COHORTE_MIN = 3

function moisDe(jour: string): string {
  return jour.slice(0, 7)
}

function decalerMois(mois: string, n: number): string {
  const [annee, m] = mois.split('-').map(Number) as [number, number]
  const date = new Date(Date.UTC(annee, m - 1 + n, 1))
  return date.toISOString().slice(0, 7)
}

/** Le dernier jour d'un mois, ou aujourd'hui pour le mois en cours. */
function finDeMois(mois: string, aujourdhui: string): string {
  const dernier = new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)), 0)).toISOString().slice(0, 10)
  return dernier < aujourdhui ? dernier : aujourdhui
}

function actifLe(abonnement: Abonnement, jour: string): boolean {
  return abonnement.debut <= jour && (abonnement.fin === null || abonnement.fin > jour)
}

function arrondi(valeur: number): number {
  return Math.round(valeur * 100) / 100
}

export function calculerAbonnements(tous: readonly Abonnement[], aujourdhui: string): InstantaneAbonnements {
  // La devise qui porte le plus de MRR fait référence ; les autres ne s'additionnent pas.
  const poids = new Map<string, number>()
  for (const abonnement of tous) {
    if (abonnement.fin === null && !abonnement.essai) poids.set(abonnement.devise, (poids.get(abonnement.devise) ?? 0) + (abonnement.mensuelCents ?? 0) + 1)
  }
  const devise = [...poids.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? tous[0]?.devise ?? ''
  const abonnements = tous.filter((un) => un.devise === devise)
  const payants = abonnements.filter((un) => !un.essai)

  const enCours = payants.filter((un) => actifLe(un, aujourdhui))
  const moisCourant = moisDe(aujourdhui)
  const serie: MoisAbonnements[] = []
  for (let k = MOIS_SERIE - 1; k >= 0; k--) {
    const mois = decalerMois(moisCourant, -k)
    const fin = finDeMois(mois, aujourdhui)
    const actifs = payants.filter((un) => actifLe(un, fin))
    const nouveaux = payants.filter((un) => moisDe(un.debut) === mois)
    const perdus = payants.filter((un) => un.fin !== null && moisDe(un.fin) === mois)
    const somme = (liste: Abonnement[]) => arrondi(liste.reduce((total, un) => total + (un.mensuelCents ?? 0), 0) / 100)
    serie.push({
      mois,
      mrr: somme(actifs),
      actifs: actifs.length,
      nouveaux: nouveaux.length,
      perdus: perdus.length,
      mrrNouveau: somme(nouveaux),
      mrrPerdu: somme(perdus),
    })
  }

  const cohortes: Cohorte[] = []
  for (let k = MOIS_SERIE - 1; k >= 1; k--) {
    const mois = decalerMois(moisCourant, -k)
    const groupe = payants.filter((un) => moisDe(un.debut) === mois)
    if (groupe.length < COHORTE_MIN) continue
    const restants: number[] = []
    for (let apres = 0; apres <= k; apres++) {
      const fin = finDeMois(decalerMois(mois, apres), aujourdhui)
      restants.push(groupe.filter((un) => actifLe(un, fin)).length / groupe.length)
    }
    cohortes.push({ mois, depart: groupe.length, restants })
  }

  return {
    au: aujourdhui,
    devise,
    mrr: arrondi(enCours.reduce((total, un) => total + (un.mensuelCents ?? 0), 0) / 100),
    actifs: enCours.length,
    essais: abonnements.filter((un) => un.essai && un.fin === null).length,
    nonChiffres: enCours.filter((un) => un.mensuelCents === null).length,
    autresDevises: tous.filter((un) => un.devise !== devise && un.fin === null).length,
    serie,
    cohortes,
  }
}

// ── Ce qu'on en tire ─────────────────────────────────────────────────────────

export type IndicateursAbonnements = {
  mrr: number
  arr: number
  actifs: number
  /** Revenu moyen par abonné et par mois. */
  arpu: number | null
  /** Churn mensuel en abonnés, moyenne des trois derniers mois terminés, de 0 à 1. */
  churn: number | null
  /** Churn mensuel en revenu (MRR perdu ÷ MRR de début de mois). */
  churnMrr: number | null
  /** Évolution du MRR sur les trois derniers mois terminés, en pour cent. */
  croissance: number | null
  /** Valeur d'un abonné : ARPU ÷ churn. `null` avec la raison quand ce n'est pas fiable. */
  ltv: number | null
  raisonLtv: string | null
  /** MRR gagné et perdu depuis le début du mois en cours. */
  mrrNouveauMois: number
  mrrPerduMois: number
}

/** En deçà, un churn mensuel ne se lit pas : un départ ferait dix points. */
export const ACTIFS_MIN_CHURN = 20

export function indicateursAbonnements(instantane: InstantaneAbonnements): IndicateursAbonnements {
  const serie = instantane.serie
  // Les trois derniers mois terminés : le mois en cours est partiel.
  const termines = serie.slice(-4, -1)
  const debuts = termines.map((mois) => serie[serie.indexOf(mois) - 1]).filter((un): un is MoisAbonnements => un !== undefined)
  const actifsDebut = debuts.reduce((total, mois) => total + mois.actifs, 0)
  const mrrDebut = debuts.reduce((total, mois) => total + mois.mrr, 0)
  const perdus = termines.reduce((total, mois) => total + mois.perdus, 0)
  const mrrPerdu = termines.reduce((total, mois) => total + mois.mrrPerdu, 0)
  const assez = debuts.length === 3 && actifsDebut / 3 >= ACTIFS_MIN_CHURN
  const churn = assez ? perdus / actifsDebut : null
  const churnMrr = assez && mrrDebut > 0 ? mrrPerdu / mrrDebut : null
  const arpu = instantane.actifs === 0 ? null : arrondi(instantane.mrr / instantane.actifs)

  let ltv: number | null = null
  let raisonLtv: string | null = null
  if (arpu === null) raisonLtv = 'Aucun abonné payant.'
  else if (churn === null) raisonLtv = `Il faut trois mois d’historique et au moins ${ACTIFS_MIN_CHURN} abonnés pour mesurer un churn.`
  else if (churn === 0) raisonLtv = 'Aucun départ sur trois mois : la valeur d’un abonné ne se calcule pas encore (elle serait infinie).'
  else ltv = arrondi(arpu / churn)

  const avant = serie.at(-4)
  const dernier = serie.at(-2)
  const croissance = avant === undefined || dernier === undefined || avant.mrr === 0 ? null : Math.round(((dernier.mrr - avant.mrr) / avant.mrr) * 100)
  const courant = serie.at(-1)
  return {
    mrr: instantane.mrr,
    arr: arrondi(instantane.mrr * 12),
    actifs: instantane.actifs,
    arpu,
    churn,
    churnMrr,
    croissance,
    ltv,
    raisonLtv,
    mrrNouveauMois: courant?.mrrNouveau ?? 0,
    mrrPerduMois: courant?.mrrPerdu ?? 0,
  }
}

/** L'instantané relu en base, vérifié : un JSON n'est pas une promesse. */
export function lireInstantaneAbonnements(brut: unknown): InstantaneAbonnements | null {
  if (brut === null || typeof brut !== 'object') return null
  const valeur = brut as Partial<InstantaneAbonnements>
  if (typeof valeur.au !== 'string' || typeof valeur.mrr !== 'number' || !Array.isArray(valeur.serie) || !Array.isArray(valeur.cohortes)) return null
  return valeur as InstantaneAbonnements
}
