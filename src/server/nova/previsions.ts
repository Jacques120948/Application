import type { JourVentes } from './metriques'

/**
 * Les prévisions de ventes : où l'on va, au rythme d'aujourd'hui.
 *
 * Une méthode simple, dite à l'écran, et aucune autre. Chaque jour à venir vaut la moyenne
 * des huit derniers jours de la même semaine (un samedi ressemble aux samedis, pas aux
 * mardis). Quand un an d'historique existe, un facteur de saison corrige le tout : ce que
 * les mêmes semaines ont donné l'an dernier, rapporté à ce qui les précédait. La fourchette
 * vient des écarts entre les huit dernières semaines — elle dit l'incertitude qu'on a
 * observée, pas une probabilité qu'on aurait calculée.
 *
 * Ce n'est jamais une promesse : une promotion, une rupture de stock ou une campagne qui
 * s'arrête font mentir n'importe quelle moyenne. Rien n'est demandé à un modèle.
 */

export type Fourchette = { chiffre: number; bas: number; haut: number; commandes: number }

export type Prevision = {
  /** Les trente jours qui commencent aujourd'hui. */
  prochains30: Fourchette
  /** Le mois en cours, réalisé compris ; `null` si son début n'est pas couvert. */
  finDeMois: (Fourchette & { aDate: number }) | null
  /** Le facteur de saison appliqué, `null` sans année d'historique. */
  saisonnalite: number | null
  methode: string
}

/** Huit semaines d'historique au moins : en deçà, le profil de la semaine est un hasard. */
export const JOURS_HISTORIQUE = 56
/** Et assez de commandes pour que la moyenne d'un jour ait un sens. */
export const COMMANDES_MIN_PREVISION = 30
/** L'écart retenu autour de la prévision : 1,28 écart-type de ce qu'on a observé. */
const ECART = 1.28
const JOUR_MS = 24 * 60 * 60 * 1000

function decaler(jour: string, n: number): string {
  return new Date(Date.parse(`${jour}T00:00:00Z`) + n * JOUR_MS).toISOString().slice(0, 10)
}

function jourSemaine(jour: string): number {
  return new Date(`${jour}T00:00:00Z`).getUTCDay()
}

function arrondi(valeur: number): number {
  return Math.round(valeur * 100) / 100
}

export function prevoirVentes(
  jours: readonly JourVentes[],
  aujourdhui: string,
  couvertureDepuis: string | null,
): Prevision | null {
  const hier = decaler(aujourdhui, -1)
  const debutHistorique = decaler(hier, -(JOURS_HISTORIQUE - 1))
  if (couvertureDepuis === null || couvertureDepuis > debutHistorique) return null
  const parJour = new Map(jours.map((jour) => [jour.jour, jour]))
  const chiffre = (jour: string) => parJour.get(jour)?.chiffre ?? 0
  const commandes = (jour: string) => parJour.get(jour)?.commandes ?? 0

  const historique = Array.from({ length: JOURS_HISTORIQUE }, (_, i) => decaler(debutHistorique, i))
  if (historique.reduce((total, jour) => total + commandes(jour), 0) < COMMANDES_MIN_PREVISION) return null

  // Le profil de la semaine : moyenne des huit derniers lundis, mardis…
  const profil = Array.from({ length: 7 }, () => ({ chiffre: 0, commandes: 0, n: 0 }))
  for (const jour of historique) {
    const case_ = profil[jourSemaine(jour)]!
    case_.chiffre += chiffre(jour)
    case_.commandes += commandes(jour)
    case_.n += 1
  }
  const attendu = (jour: string) => {
    const case_ = profil[jourSemaine(jour)]!
    return { chiffre: case_.n === 0 ? 0 : case_.chiffre / case_.n, commandes: case_.n === 0 ? 0 : case_.commandes / case_.n }
  }

  // La saison : les trente mêmes jours l'an dernier, rapportés aux huit semaines qui les précédaient.
  let saisonnalite: number | null = null
  const anPasse = (jour: string) => decaler(jour, -364)
  const debutAnPasse = anPasse(debutHistorique)
  if (couvertureDepuis <= debutAnPasse) {
    const avant = historique.map(anPasse)
    const apres = Array.from({ length: 30 }, (_, i) => anPasse(decaler(aujourdhui, i)))
    const commandesAvant = avant.reduce((total, jour) => total + commandes(jour), 0)
    const commandesApres = apres.reduce((total, jour) => total + commandes(jour), 0)
    const rythmeAvant = avant.reduce((total, jour) => total + chiffre(jour), 0) / avant.length
    const rythmeApres = apres.reduce((total, jour) => total + chiffre(jour), 0) / apres.length
    if (commandesAvant >= 20 && commandesApres >= 10 && rythmeAvant > 0) {
      saisonnalite = Math.min(2, Math.max(0.5, rythmeApres / rythmeAvant))
    }
  }
  const facteur = saisonnalite ?? 1

  // L'incertitude observée : l'écart-type des huit dernières semaines.
  const semaines = Array.from({ length: 8 }, (_, k) =>
    Array.from({ length: 7 }, (_, i) => chiffre(decaler(debutHistorique, k * 7 + i))).reduce((a, b) => a + b, 0),
  )
  const moyenne = semaines.reduce((a, b) => a + b, 0) / semaines.length
  const ecartType = Math.sqrt(semaines.reduce((total, semaine) => total + (semaine - moyenne) ** 2, 0) / (semaines.length - 1))

  const fourchette = (liste: string[], dejaFait = 0): Fourchette => {
    const prevu = liste.reduce((total, jour) => total + attendu(jour).chiffre, 0) * facteur
    const marge = ECART * ecartType * Math.sqrt(liste.length / 7)
    return {
      chiffre: arrondi(dejaFait + prevu),
      bas: arrondi(dejaFait + Math.max(0, prevu - marge)),
      haut: arrondi(dejaFait + prevu + marge),
      commandes: Math.round(liste.reduce((total, jour) => total + attendu(jour).commandes, 0) * facteur),
    }
  }

  const prochains = Array.from({ length: 30 }, (_, i) => decaler(aujourdhui, i))
  const premier = `${aujourdhui.slice(0, 7)}-01`
  const dernier = new Date(Date.UTC(Number(aujourdhui.slice(0, 4)), Number(aujourdhui.slice(5, 7)), 0)).toISOString().slice(0, 10)
  let finDeMois: Prevision['finDeMois'] = null
  if (couvertureDepuis <= premier) {
    const faits = premier === aujourdhui ? [] : Array.from({ length: Number(hier.slice(8, 10)) }, (_, i) => decaler(premier, i))
    const aDate = arrondi(faits.reduce((total, jour) => total + chiffre(jour), 0))
    const reste = Array.from({ length: Number(dernier.slice(8, 10)) - Number(aujourdhui.slice(8, 10)) + 1 }, (_, i) => decaler(aujourdhui, i))
    finDeMois = { ...fourchette(reste, aDate), aDate }
  }

  return {
    prochains30: fourchette(prochains),
    finDeMois,
    saisonnalite,
    methode:
      'Chaque jour à venir vaut la moyenne des huit derniers jours de la même semaine' +
      (saisonnalite === null ? '' : `, corrigée de la saison de l’an dernier (×${new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 2 }).format(saisonnalite)})`) +
      '. La fourchette vient des écarts entre vos huit dernières semaines.',
  }
}
