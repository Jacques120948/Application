import { notFound } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { compteActif, type CompteRelie } from './comptes'
import {
  CUMUL_VIDE,
  cumuler,
  ecartEnPoints,
  fenetre,
  indicateurs,
  journeesEntre,
  variation,
  type Cumul,
  type Indicateurs,
} from './metriques'

/**
 * Le tableau de bord publicitaire.
 *
 * Tout y est calculé ici, à partir des journées conservées. Naya ne reçoit que des
 * résultats — voir `metriques.ts` pour la raison, qui tient en une phrase : une erreur
 * d'arithmétique sur un ROAS ne se voit pas, elle ressemble à un chiffre, et elle se
 * corrige le lendemain, après la dépense.
 *
 * Deux décisions structurent ce module.
 *
 * **Toute période se compare à la précédente, de même durée.** « ROAS 245 % » ne dit rien
 * — personne ne sait si c'est bon sans connaître la marge et le mois d'avant. « 245 %,
 * contre 231 % la semaine précédente » dit quelque chose. La comparaison n'est donc pas une
 * option d'affichage : elle est calculée en même temps, et vaut `null` quand il n'y a rien
 * à comparer.
 *
 * **Une campagne sans dépense sur la période est rendue quand même.** La retirer ferait
 * disparaître de l'écran une campagne en pause ou à budget épuisé, c'est-à-dire exactement
 * celles dont on veut parler.
 */

/**
 * Les périodes proposées. Des durées, pas des noms de mois : on compare toujours à égal.
 *
 * Quatre-vingt-dix jours est la plus longue, et ce n'est pas un nombre rond choisi au
 * hasard : c'est ce que la première lecture remonte chez Google. Proposer six mois
 * afficherait une moitié de courbe vide qu'on prendrait pour une chute d'activité.
 */
export const PERIODES = [1, 3, 7, 14, 30, 90] as const

export type Periode = (typeof PERIODES)[number]

export function periodeValide(valeur: unknown): Periode {
  const lu = Number(valeur)
  return (PERIODES as readonly number[]).includes(lu) ? (lu as Periode) : 7
}

/**
 * L'ordre des campagnes.
 *
 * Par dépense d'abord, et c'est délibéré : l'ordre alphabétique met en haut la campagne dont
 * le nom commence par A, ce qui n'intéresse personne. Ce qu'on veut voir en premier, c'est
 * là où part l'argent.
 */
export const TRIS = ['depense', 'roas', 'cpa', 'nom'] as const

export type Tri = (typeof TRIS)[number]

export function triValide(valeur: unknown): Tri {
  return typeof valeur === 'string' && (TRIS as readonly string[]).includes(valeur)
    ? (valeur as Tri)
    : 'depense'
}

/** Un indicateur et son mouvement. `null` des deux côtés quand la donnée manque. */
export type AvecEcart = {
  valeur: number | null
  /** Écart relatif en pourcentage, pour ce qui se compte. */
  variation: number | null
  /** Écart en points, pour ce qui est déjà un pourcentage. */
  points: number | null
}

export type CampagneVue = {
  id: string
  nom: string
  type: string
  statut: string
  budget: number
  budgetLimite: boolean
  actuel: Indicateurs
  roas: AvecEcart
  cpa: AvecEcart
  cout: AvecEcart
  /** Part de la dépense totale de la période, en pourcentage entier. */
  part: number
  /**
   * Jours où la campagne a réellement dépensé, sur la période et sur la précédente.
   *
   * Sans ce compte, une campagne relancée il y a trois jours se compare à trente jours
   * pleins et paraît s'effondrer. Ce n'est pas une chute, c'est un artefact de fenêtre — et
   * c'est le genre de faux signal qui fait mettre en pause une campagne qui va très bien.
   */
  joursActifs: number
  joursActifsAvant: number
}

/** Une journée de la période, pour la courbe. Les jours sans dépense valent zéro. */
export type JourneeVue = {
  jour: string
  cout: number
  valeur: number
  conversions: number
  clics: number
  roas: number | null
}

export type TableauAds = {
  compte: CompteRelie
  jours: Periode
  /** Bornes réellement lues, dans le fuseau du compte. */
  depuis: string
  jusqua: string
  total: Indicateurs
  ecarts: {
    cout: AvecEcart
    conversions: AvecEcart
    valeur: AvecEcart
    roas: AvecEcart
    cpa: AvecEcart
    ctr: AvecEcart
    cpc: AvecEcart
  }
  campagnes: CampagneVue[]
  /** Une entrée par journée de la période, y compris les journées sans dépense. */
  serie: JourneeVue[]
  tri: Tri
  /** Faux tant qu'aucune synchronisation n'a eu lieu : l'écran doit le dire, pas afficher zéro. */
  synchronise: boolean
}

function compte(valeur: number | null, precedent: number | null): AvecEcart {
  return { valeur, variation: variation(valeur, precedent), points: null }
}

function pourcentage(valeur: number | null, precedent: number | null): AvecEcart {
  return { valeur, variation: null, points: ecartEnPoints(valeur, precedent) }
}

type LigneReleve = {
  campagneId: string
  jour: Date
  coutMicros: bigint
  impressions: bigint
  clics: bigint
  conversions: number
  valeurConversion: number
}

/**
 * Le nombre de journées où quelque chose a été dépensé.
 *
 * Une journée sans dépense n'est pas une journée de diffusion : une campagne en pause
 * produit des lignes à zéro comme une campagne qui n'existe pas en produit aucune. C'est
 * la dépense qui fait foi.
 */
function joursAvecDepense(lignes: readonly LigneReleve[]): number {
  const jours = new Set<number>()
  for (const ligne of lignes) {
    if (Number(ligne.coutMicros) > 0) jours.add(ligne.jour.getTime())
  }
  return jours.size
}

/** Une ligne de base vers un cumul. Les entiers longs redeviennent des nombres ici, une fois. */
function enCumul(ligne: LigneReleve): Cumul {
  return {
    coutMicros: Number(ligne.coutMicros),
    impressions: Number(ligne.impressions),
    clics: Number(ligne.clics),
    conversions: ligne.conversions,
    valeurConversion: ligne.valeurConversion,
  }
}

/**
 * Le tableau de bord d'une période.
 *
 * La période précédente est lue dans la même requête, et c'est délibéré : deux allers-retours
 * pour deux moitiés de la même phrase seraient deux occasions de les désynchroniser.
 */
export async function lireTableauAds(
  userId: string,
  jours: Periode,
  tri: Tri = 'depense',
): Promise<TableauAds> {
  const actif = await compteActif(userId)
  if (actif === null) throw notFound('Aucun compte publicitaire n’est suivi.')

  const bornes = fenetre(jours, actif.fuseau)
  const precedentes = fenetre(jours * 2, actif.fuseau)

  const lignes = await withUserScope(userId, (tx) =>
    tx.adsReleve.findMany({
      where: {
        userId,
        accountId: actif.id,
        jour: {
          gte: new Date(`${precedentes.depuis}T00:00:00Z`),
          lte: new Date(`${bornes.jusqua}T00:00:00Z`),
        },
      },
      select: {
        campagneId: true,
        jour: true,
        coutMicros: true,
        impressions: true,
        clics: true,
        conversions: true,
        valeurConversion: true,
      },
    }),
  )

  const debutActuel = new Date(`${bornes.depuis}T00:00:00Z`)
  const dansActuel = (ligne: LigneReleve) => ligne.jour >= debutActuel
  const actuelles = lignes.filter(dansActuel)
  const anciennes = lignes.filter((ligne: LigneReleve) => !dansActuel(ligne))

  const total = indicateurs(cumuler(actuelles.map(enCumul)))
  const avant = indicateurs(cumuler(anciennes.map(enCumul)))

  const campagnes = await withUserScope(userId, (tx) =>
    tx.adsCampagne.findMany({
      where: { userId, accountId: actif.id, statut: { not: 'REMOVED' } },
      orderBy: { nom: 'asc' },
      select: {
        id: true,
        nom: true,
        type: true,
        statut: true,
        budgetMicros: true,
        budgetLimite: true,
      },
    }),
  )

  const depenseTotale = total.cout

  const vues: CampagneVue[] = campagnes.map((campagne) => {
    const siennes = actuelles.filter((ligne: LigneReleve) => ligne.campagneId === campagne.id)
    const siennesAvant = anciennes.filter((ligne: LigneReleve) => ligne.campagneId === campagne.id)
    const maintenant = indicateurs(
      siennes.length === 0 ? { ...CUMUL_VIDE } : cumuler(siennes.map(enCumul)),
    )
    const hier = indicateurs(
      siennesAvant.length === 0 ? { ...CUMUL_VIDE } : cumuler(siennesAvant.map(enCumul)),
    )
    return {
      id: campagne.id,
      nom: campagne.nom,
      type: campagne.type,
      statut: campagne.statut,
      budget: Number(campagne.budgetMicros) / 1_000_000,
      budgetLimite: campagne.budgetLimite,
      actuel: maintenant,
      roas: pourcentage(maintenant.roas, hier.roas),
      cpa: compte(maintenant.cpa, hier.cpa),
      cout: compte(maintenant.cout, hier.cout),
      /*
       * La part se calcule sur la dépense de la période affichée, pas sur le budget : ce
       * qu'on veut savoir est où l'argent est parti, pas où il était prévu d'aller.
       */
      part: depenseTotale === 0 ? 0 : Math.round((maintenant.cout / depenseTotale) * 100),
      joursActifs: joursAvecDepense(siennes),
      joursActifsAvant: joursAvecDepense(siennesAvant),
    }
  })

  ordonner(vues, tri)

  /*
   * La courbe est construite à partir de toutes les journées de la fenêtre, pas des seules
   * qui ont une ligne en base. Une journée sans dépense n'a pas de relevé ; la sauter
   * rapprocherait deux barres séparées par une semaine de silence.
   */
  const parJour = new Map<string, Cumul[]>()
  for (const ligne of actuelles) {
    const jour = ligne.jour.toISOString().slice(0, 10)
    const deja = parJour.get(jour)
    if (deja === undefined) parJour.set(jour, [enCumul(ligne)])
    else deja.push(enCumul(ligne))
  }

  const serie: JourneeVue[] = journeesEntre(bornes.depuis, bornes.jusqua).map((jour) => {
    const journee = indicateurs(cumuler(parJour.get(jour) ?? []))
    return {
      jour,
      cout: journee.cout,
      valeur: journee.valeur,
      conversions: journee.conversions,
      clics: journee.clics,
      roas: journee.roas,
    }
  })

  return {
    compte: actif,
    jours,
    depuis: bornes.depuis,
    jusqua: bornes.jusqua,
    total,
    ecarts: {
      cout: compte(total.cout, avant.cout),
      conversions: compte(total.conversions, avant.conversions),
      valeur: compte(total.valeur, avant.valeur),
      roas: pourcentage(total.roas, avant.roas),
      cpa: compte(total.cpa, avant.cpa),
      ctr: pourcentage(total.ctr, avant.ctr),
      cpc: compte(total.cpc, avant.cpc),
    },
    campagnes: vues,
    serie,
    tri,
    synchronise: actif.synchroAt !== null,
  }
}

/**
 * Range les campagnes selon ce qu'on cherche.
 *
 * Une campagne dont l'indicateur n'existe pas descend en bas, quel que soit le tri : trier
 * par ROAS en mettant en tête celles qui n'ont pas de ROAS ferait passer pour meilleures
 * celles qui n'ont simplement rien dépensé.
 */
function ordonner(vues: CampagneVue[], tri: Tri): void {
  const dernier = (valeur: number | null, decroissant: boolean) =>
    valeur === null ? (decroissant ? -Infinity : Infinity) : valeur

  if (tri === 'nom') {
    vues.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
    return
  }
  if (tri === 'roas') {
    vues.sort((a, b) => dernier(b.actuel.roas, true) - dernier(a.actuel.roas, true))
    return
  }
  if (tri === 'cpa') {
    // Un coût par vente se lit du moins cher au plus cher : c'est le sens de la bonne nouvelle.
    vues.sort((a, b) => dernier(a.actuel.cpa, false) - dernier(b.actuel.cpa, false))
    return
  }
  vues.sort((a, b) => b.actuel.cout - a.actuel.cout)
}
