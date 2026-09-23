import type { Activite, Couts, Objectifs } from './reglages'
import type { CumulVentes, Kpi } from './metriques'

/**
 * Le pilotage : la marge, les objectifs, et ce que chaque activité doit voir d'abord.
 *
 * Tout ici repose sur ce que la personne a saisi. Une marge sans coûts n'est pas une marge,
 * c'est un chiffre d'affaires ; un objectif qu'on ne s'est pas fixé ne se « suit » pas. Ce
 * qui manque se dit, et rien n'est complété par une moyenne de secteur.
 */

function arrondi(valeur: number): number {
  return Math.round(valeur * 100) / 100
}

// ── Marge ────────────────────────────────────────────────────────────────────

export type LigneMarge = { quoi: string; montant: number }

export type Marge =
  | { etat: 'calculee'; chiffre: number; lignes: LigneMarge[]; marge: number; taux: number; manquants: string[] }
  | { etat: 'impossible'; raison: string }

export const MENTION_MARGE = 'Estimation basée sur les coûts renseignés.'

/**
 * CA − coût des produits − frais variables − dépenses publicitaires = marge estimée.
 *
 * Le coût des produits est exigé : sans lui, la « marge » serait presque tout le chiffre
 * d'affaires, et quelqu'un pourrait décider d'augmenter un budget sur un bénéfice qui
 * n'existe pas. Les autres frais sont facultatifs ; ceux qui manquent sont nommés, parce
 * qu'ils rendent l'estimation trop optimiste.
 */
export function margeEstimee(ventes: CumulVentes | null, depensesPub: number | null, couts: Couts): Marge {
  if (ventes === null) return { etat: 'impossible', raison: 'Il faut les ventes de la boutique pour estimer une marge.' }
  if (couts.coutProduitPct === undefined) {
    return { etat: 'impossible', raison: 'Renseignez au moins le coût de vos produits, en pour cent de vos ventes.' }
  }
  const ca = ventes.chiffre
  const n = ventes.commandes
  const lignes: LigneMarge[] = [{ quoi: 'Coût des produits', montant: arrondi((ca * couts.coutProduitPct) / 100) }]
  const manquants: string[] = []
  const ajouter = (quoi: string, valeur: number | undefined, calcul: (v: number) => number) => {
    if (valeur === undefined) manquants.push(quoi.toLowerCase())
    else if (valeur > 0) lignes.push({ quoi, montant: arrondi(calcul(valeur)) })
  }
  ajouter('Livraison', couts.livraisonParCommande, (v) => v * n)
  if (couts.paiementPct === undefined && couts.paiementFixe === undefined) manquants.push('frais de paiement')
  else {
    const frais = (ca * (couts.paiementPct ?? 0)) / 100 + n * (couts.paiementFixe ?? 0)
    if (frais > 0) lignes.push({ quoi: 'Frais de paiement', montant: arrondi(frais) })
  }
  ajouter('Commissions', couts.commissionPct, (v) => (ca * v) / 100)
  ajouter('Autres coûts variables', couts.autresPct, (v) => (ca * v) / 100)
  if (depensesPub !== null && depensesPub > 0) lignes.push({ quoi: 'Dépenses publicitaires', montant: arrondi(depensesPub) })

  const marge = arrondi(ca - lignes.reduce((total, ligne) => total + ligne.montant, 0))
  return { etat: 'calculee', chiffre: arrondi(ca), lignes, marge, taux: ca === 0 ? 0 : marge / ca, manquants }
}

// ── Objectifs ────────────────────────────────────────────────────────────────

export type SuiviObjectif = {
  cle: keyof Objectifs
  label: string
  format: 'argent' | 'nombre' | 'pourcent'
  objectif: number
  /** Le résultat actuel, `null` quand il ne se mesure pas encore. */
  actuel: number | null
  /** Écart au but, en pour cent de l'objectif ; positif = mieux que visé. */
  ecart: number | null
  /** Projection en fin de mois, pour les objectifs mensuels. */
  projection: number | null
  tendance: 'atteint' | 'en-avance' | 'en-retard' | 'hors-cible' | 'inconnue'
  commentaire: string
}

export type Mois = { joursEcoules: number; joursDuMois: number }

/** En deçà, une projection de fin de mois tient du hasard. */
export const JOURS_AVANT_PROJECTION = 7

function projeter(aDate: number, mois: Mois): number | null {
  if (mois.joursEcoules < JOURS_AVANT_PROJECTION) return null
  return arrondi((aDate / mois.joursEcoules) * mois.joursDuMois)
}

/**
 * Où l'on en est de chaque objectif fixé.
 *
 * Les objectifs mensuels se jugent sur le mois en cours, jusqu'à hier, avec une projection
 * au rythme actuel — dite comme une projection, pas comme une prévision. ROAS et CAC se
 * jugent sur les trente derniers jours : un plancher et un plafond, pas un cumul.
 */
export function suivreObjectifs(
  objectifs: Objectifs,
  mesure: {
    mois: Mois
    /** Ventes du mois à date, `null` si la boutique ne les couvre pas. */
    ventesMois: CumulVentes | null
    roas30: number | null
    cac30: number | null
  },
): SuiviObjectif[] {
  const suivis: SuiviObjectif[] = []
  const mensuel = (
    cle: 'caMensuel' | 'commandesMensuelles',
    label: string,
    format: 'argent' | 'nombre',
    objectif: number | undefined,
    aDate: number | null,
  ) => {
    if (objectif === undefined || objectif <= 0) return
    const projection = aDate === null ? null : projeter(aDate, mesure.mois)
    const tendance: SuiviObjectif['tendance'] =
      aDate === null ? 'inconnue' : aDate >= objectif ? 'atteint' : projection === null ? 'inconnue' : projection >= objectif ? 'en-avance' : 'en-retard'
    suivis.push({
      cle,
      label,
      format,
      objectif,
      actuel: aDate,
      ecart: aDate === null ? null : arrondi(((aDate - objectif) / objectif) * 100),
      projection,
      tendance,
      commentaire:
        aDate === null
          ? 'Les ventes du mois ne sont pas encore lues.'
          : projection === null
            ? `Mois entamé depuis ${mesure.mois.joursEcoules} jour${mesure.mois.joursEcoules > 1 ? 's' : ''} : trop tôt pour projeter.`
            : 'Projection au rythme actuel, pas une prévision.',
    })
  }
  mensuel('caMensuel', 'Chiffre d’affaires du mois', 'argent', objectifs.caMensuel, mesure.ventesMois?.chiffre ?? null)
  mensuel('commandesMensuelles', 'Commandes du mois', 'nombre', objectifs.commandesMensuelles, mesure.ventesMois?.commandes ?? null)

  if (objectifs.roasMin !== undefined) {
    const actuel = mesure.roas30
    suivis.push({
      cle: 'roasMin',
      label: 'ROAS minimum',
      format: 'pourcent',
      objectif: objectifs.roasMin,
      actuel,
      ecart: actuel === null ? null : arrondi(((actuel - objectifs.roasMin) / objectifs.roasMin) * 100),
      projection: null,
      tendance: actuel === null ? 'inconnue' : actuel >= objectifs.roasMin ? 'atteint' : 'hors-cible',
      commentaire: 'Sur les 30 derniers jours, revenu déclaré par les régies.',
    })
  }
  if (objectifs.cacMax !== undefined) {
    const actuel = mesure.cac30
    suivis.push({
      cle: 'cacMax',
      label: 'CAC maximum',
      format: 'argent',
      objectif: objectifs.cacMax,
      actuel,
      // Pour un plafond, être en dessous est mieux : l'écart est compté dans ce sens.
      ecart: actuel === null || objectifs.cacMax === 0 ? null : arrondi(((objectifs.cacMax - actuel) / objectifs.cacMax) * 100),
      projection: null,
      tendance: actuel === null ? 'inconnue' : actuel <= objectifs.cacMax ? 'atteint' : 'hors-cible',
      commentaire: actuel === null ? 'Données insuffisantes pour calculer votre CAC.' : 'Sur les 30 derniers jours.',
    })
  }
  return suivis
}

// ── Indicateurs par activité ─────────────────────────────────────────────────

/** L'ordre des cartes : ce que chaque activité regarde en premier. */
export function ordreIndicateurs(activite: Activite | ''): Kpi['cle'][] {
  if (activite === 'services') return ['depenses', 'cpa', 'chiffre', 'roas', 'mer', 'commandes', 'cac', 'panier', 'conversion']
  if (activite === 'saas') return ['chiffre', 'cac', 'depenses', 'roas', 'mer', 'commandes', 'cpa', 'panier', 'conversion']
  return ['chiffre', 'roas', 'cac', 'commandes', 'depenses', 'mer', 'cpa', 'panier', 'conversion']
}

/** Ce que l'activité voudrait voir et qu'aucune source reliée ne donne encore. */
export function indicateursAVenir(activite: Activite | ''): string | null {
  if (activite === 'saas') {
    return 'MRR, churn et LTV d’un abonnement demandent vos paiements récurrents : Stripe n’est pas encore relié à Nova.'
  }
  if (activite === 'services') {
    return 'Leads, coût par lead et taux lead → client demandent vos formulaires ou votre CRM : ils ne sont pas encore reliés à Nova. En attendant, le coût par conversion de chaque régie en tient lieu.'
  }
  return null
}
