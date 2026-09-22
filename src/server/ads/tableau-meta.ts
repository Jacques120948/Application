import { notFound } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { compteActif, type CompteRelie } from './comptes'
import { metaAds } from './meta-ads'
import { frequence } from './niveaux'
import { lireProfil, type ProfilAds } from './profil'
import {
  cumuler,
  ecartEnPoints,
  enUnites,
  fenetre,
  indicateurs,
  MICROS,
  variation,
  type Cumul,
  type Indicateurs,
} from './metriques'

/**
 * Ce que MIRA montre, et à quelles conditions elle ose en juger.
 *
 * Le tableau de Naya répond à « combien ». Celui-ci doit répondre à « et alors ? », et c'est
 * une autre exigence : un chiffre sans verdict se regarde une fois, un verdict sans fondement
 * se paie en budget mal placé.
 *
 * Trois principes, dont le dernier est le plus important.
 *
 * **Les trois étages viennent d'une seule lecture.** Campagnes, ensembles, annonces : les
 * mêmes journées, filtrées par leur niveau. Trois requêtes auraient donné trois totaux qui
 * ne se recoupent pas dès qu'une écriture passe entre les deux.
 *
 * **Rien n'est confié à un modèle.** Tout ce qui suit est arithmétique, et vérifiable. Une
 * erreur de division sur un ROAS ne se voit pas : elle ressemble à un chiffre.
 *
 * **Aucun seuil n'est universel.** « CPA de 37 francs » n'est ni bon ni mauvais : il est bon
 * à 60 % de marge sur un panier de 120 francs, et ruineux à 20 % sur un panier de 40. Le
 * verdict se fonde donc sur les objectifs que la personne a posés — et quand elle n'en a
 * posé aucun, MIRA se tait plutôt que d'appliquer une moyenne de marché qui ne décrit
 * personne.
 */

/**
 * Les fenêtres proposées, en jours.
 *
 * Toutes finissent hier. La journée en cours est absente, et c'est délibéré : la
 * synchronisation ne la lit pas, elle est incomplète par définition, et la compter ferait
 * plonger tous les indicateurs chaque matin — une chute quotidienne que personne ne
 * s'expliquerait. « Hier » est donc la fenêtre la plus courte qu'on puisse honnêtement
 * montrer.
 */
export const PERIODES_META = [1, 3, 7, 14, 30] as const

export function periodeMetaValide(valeur: unknown): number {
  const jours = typeof valeur === 'number' ? valeur : Number(valeur)
  return (PERIODES_META as readonly number[]).includes(jours) ? jours : 7
}

/** Ce qu'une période agrège chez Meta : le cumul commun, plus la portée. */
export type CumulMeta = Cumul & { portee: number }

const CUMUL_META_VIDE: CumulMeta = {
  coutMicros: 0,
  impressions: 0,
  clics: 0,
  conversions: 0,
  valeurConversion: 0,
  portee: 0,
}

/**
 * Les indicateurs d'une période Meta.
 *
 * Ceux de Naya, plus trois que Google ne donne pas. Le CPM est calculé plutôt que lu : une
 * valeur dérivée conservée finit par contredire celles dont elle vient.
 */
export type IndicateursMeta = Indicateurs & {
  /** Ce que coûtent mille affichages, en unités de la devise. */
  cpm: number | null
  /** Personnes distinctes atteintes. */
  portee: number
  /** Combien de fois, en moyenne, chacune a vu la publicité. 0 : portée inconnue. */
  frequence: number
}

export function indicateursMeta(cumul: CumulMeta): IndicateursMeta {
  const base = indicateurs(cumul)
  const cout = enUnites(cumul.coutMicros)
  return {
    ...base,
    cpm:
      cumul.impressions === 0
        ? null
        : Math.round((cout / cumul.impressions) * 1000 * 100) / 100,
    portee: cumul.portee,
    /*
     * La portée d'une période n'est pas la somme des portées quotidiennes : la même personne
     * vue lundi et mardi est comptée deux fois. Meta ne rend pas la portée dédoublonnée d'une
     * période arbitraire, et l'additionner la surestime. La fréquence qui en découle est donc
     * un plancher — elle sous-estime la répétition réelle, ce qui est le bon sens de l'erreur
     * pour une alerte de saturation : on ne crie pas au loup.
     */
    frequence: frequence(cumul.impressions, cumul.portee),
  }
}

function cumulerMeta(lignes: readonly CumulMeta[]): CumulMeta {
  const base = cumuler(lignes)
  return { ...base, portee: lignes.reduce((somme, ligne) => somme + ligne.portee, 0) }
}

// ═══════════════════════════ Le verdict, et ses conditions ═══════════════════

/** bon | surveiller | agir | insuffisant — les quatre états du code couleur. */
export type Verdict = 'bon' | 'surveiller' | 'agir' | 'insuffisant'

/**
 * Ce qu'il faut avoir vu avant d'oser juger.
 *
 * Ces seuils sont les nôtres, ils sont discutables, et ils vivent ici pour être discutés.
 * Le principe, lui, ne l'est pas : une campagne jugée sur trois cents affichages et deux
 * francs ne dit rien de plus qu'un jet de dé, et lui coller une pastille rouge ferait
 * éteindre une campagne qui n'a pas eu le temps d'exister.
 *
 * Meta ajoute sa propre raison d'attendre : après chaque changement, ses campagnes
 * traversent une phase d'apprentissage dont les chiffres décrivent l'apprentissage, pas la
 * campagne.
 */
export const SEUILS = {
  /** En unités de la devise. En deçà, la dépense n'a rien acheté de mesurable. */
  depense: 20,
  /** En deçà, la publicité n'a pas été montrée assez pour qu'un taux veuille dire quelque chose. */
  impressions: 1_000,
  /** En deçà, un CPA ou un ROAS repose sur trop peu de ventes pour être stable. */
  conversions: 3,
}

/**
 * La tolérance autour de l'objectif, avant de passer du vert à l'orange.
 *
 * Vingt pour cent. Un objectif n'est pas une falaise : un ROAS à 240 % pour une cible de
 * 250 % n'appelle pas la même chose qu'un ROAS à 90 %. Sans cette bande, tout ce qui n'est
 * pas atteint devient rouge, et une liste tout en rouge ne désigne plus rien.
 */
const TOLERANCE = 0.2

export type Jugement = {
  verdict: Verdict
  /** Ce qui a décidé, en une phrase. Jamais un chiffre nu : l'écran doit pouvoir l'afficher. */
  motif: string
}

/**
 * Le verdict d'une ligne, fondé sur les objectifs de la personne et sur rien d'autre.
 *
 * L'ordre des tests est le fond du sujet. On vérifie d'abord qu'il y a matière à juger,
 * ensuite qu'on dépense sans rien obtenir — le seul cas qui se passe d'objectif — et
 * seulement après on compare à une cible. Comparer d'abord ferait déclarer « CPA excellent »
 * une campagne à zéro vente, parce qu'un CPA sans conversion est `null` et qu'un `null` se
 * laisse facilement lire comme « rien à signaler ».
 */
export function juger(indics: IndicateursMeta, profil: ProfilAds): Jugement {
  if (indics.impressions < SEUILS.impressions) {
    return {
      verdict: 'insuffisant',
      motif: `Moins de ${SEUILS.impressions.toLocaleString('fr-CH')} affichages : trop peu pour juger.`,
    }
  }
  if (indics.cout < SEUILS.depense) {
    return { verdict: 'insuffisant', motif: 'Dépense trop faible sur la période pour juger.' }
  }

  /*
   * Dépenser sans rien obtenir est le seul constat qui ne demande aucun objectif. Une
   * campagne de notoriété n'a pas d'achats et ce n'est pas un défaut — mais elle n'a pas non
   * plus d'objectif de vente renseigné, et c'est le test suivant qui la laissera tranquille.
   */
  if (indics.conversions === 0) {
    const vise = profil.roasCible > 0 || profil.cpaCible > 0
    if (vise) {
      return {
        verdict: 'agir',
        motif: `${indics.cout.toLocaleString('fr-CH')} dépensés sans aucune vente mesurée.`,
      }
    }
    return { verdict: 'insuffisant', motif: 'Aucune vente mesurée, et aucun objectif à viser.' }
  }

  if (indics.conversions < SEUILS.conversions) {
    return {
      verdict: 'insuffisant',
      motif: `Moins de ${SEUILS.conversions} ventes : un CPA sur si peu n’est pas stable.`,
    }
  }

  /*
   * Le ROAS prime sur le CPA quand les deux sont posés : il tient compte de la valeur des
   * ventes, là où le CPA traite une vente à dix francs comme une vente à trois cents.
   */
  if (profil.roasCible > 0 && indics.roas !== null) {
    if (indics.roas >= profil.roasCible) {
      return { verdict: 'bon', motif: `ROAS de ${indics.roas} % pour un objectif de ${profil.roasCible} %.` }
    }
    if (indics.roas >= profil.roasCible * (1 - TOLERANCE)) {
      return {
        verdict: 'surveiller',
        motif: `ROAS de ${indics.roas} %, un peu sous l’objectif de ${profil.roasCible} %.`,
      }
    }
    return {
      verdict: 'agir',
      motif: `ROAS de ${indics.roas} % pour un objectif de ${profil.roasCible} %.`,
    }
  }

  const cpaCible = profil.cpaCible
  if (cpaCible > 0 && indics.cpa !== null) {
    if (indics.cpa <= cpaCible) {
      return { verdict: 'bon', motif: `Coût par vente de ${indics.cpa} pour un objectif de ${cpaCible}.` }
    }
    if (indics.cpa <= cpaCible * (1 + TOLERANCE)) {
      return {
        verdict: 'surveiller',
        motif: `Coût par vente de ${indics.cpa}, un peu au-dessus de l’objectif de ${cpaCible}.`,
      }
    }
    return {
      verdict: 'agir',
      motif: `Coût par vente de ${indics.cpa} pour un objectif de ${cpaCible}.`,
    }
  }

  /*
   * Aucun objectif posé. On ne juge pas — et c'est la règle la plus importante de ce module :
   * « CPA de 37 francs » n'est ni bon ni mauvais tant qu'on ignore la marge et le panier.
   */
  return {
    verdict: 'insuffisant',
    motif: 'Aucun objectif renseigné : MIRA n’a rien à quoi comparer.',
  }
}

// ═══════════════════════════ La lecture ══════════════════════════════════════

export type LigneMeta = {
  /** Identifiant interne, pour les gestes à venir. */
  id: string
  nom: string
  statut: string
  /** Le budget quotidien porté à ce niveau, en unités. 0 : il vit ailleurs. */
  budget: number
  actuel: IndicateursMeta
  precedent: IndicateursMeta
  /** Les écarts, déjà calculés : une variation en pour cent, un ROAS en points. */
  ecarts: { cout: number | null; conversions: number | null; roas: number | null; cpa: number | null }
  jugement: Jugement
}

export type VueMeta = {
  compte: CompteRelie
  jours: number
  profil: ProfilAds
  total: IndicateursMeta
  totalPrecedent: IndicateursMeta
  ecarts: { cout: number | null; conversions: number | null; roas: number | null; cpa: number | null }
  campagnes: LigneMeta[]
  ensembles: LigneMeta[]
  annonces: LigneMeta[]
}

/**
 * Ce que MIRA dit en une phrase, avant tout tableau.
 *
 * Écrite par du code, pas par un modèle — et c'est provisoire à dessein : quand MIRA saura
 * parler, elle remplacera ce texte par le sien, à partir des mêmes chiffres. En attendant,
 * une synthèse déterministe vaut mieux qu'un écran qui commence par une grille : on ouvre
 * cette page pour savoir si tout va bien, et cette question mérite une phrase, pas un
 * tableau à déchiffrer.
 *
 * Aucun chiffre n'y est inventé, aucun jugement n'y est porté que ceux déjà rendus ligne
 * par ligne. C'est une lecture à voix haute, pas une opinion de plus.
 */
export function synthese(
  vue: VueMeta,
  /*
   * La forme est décrite ici plutôt qu'importée du moteur de règles : ce module n'a pas à
   * dépendre de celui qui le lit. Seule la priorité compte pour compter.
   */
  constats: readonly { priorite: 'urgent' | 'surveiller' | 'opportunite' | 'information' }[],
): string {
  const quand =
    vue.jours === 1 ? 'Hier' : `Sur les ${vue.jours} derniers jours`
  const devise = vue.compte.devise === '' ? '' : ` ${vue.compte.devise}`

  if (vue.total.cout === 0) {
    return `${quand}, aucune de vos campagnes Meta n’a dépensé. Il n’y a rien à analyser — vos campagnes sont peut-être en pause, ou leur budget est épuisé.`
  }

  const depense = `${quand}, vous avez dépensé ${vue.total.cout.toLocaleString('fr-CH')}${devise}`
  const rendement =
    vue.total.roas === null
      ? '.'
      : ` pour un retour de ${vue.total.roas} %${
          vue.total.conversions > 0
            ? ` et ${vue.total.conversions} vente${vue.total.conversions > 1 ? 's' : ''}`
            : ''
        }.`

  const sansObjectif = vue.profil.roasCible === 0 && vue.profil.cpaCible === 0
  if (sansObjectif) {
    return `${depense}${rendement} Je ne peux pas dire si c’est bon : sans votre marge ni votre coût par vente acceptable, ces chiffres ne se comparent à rien.`
  }

  const aTraiter = constats.filter((un) => un.priorite === 'urgent').length
  const aSurveiller = constats.filter((un) => un.priorite === 'surveiller').length
  const occasions = constats.filter((un) => un.priorite === 'opportunite').length

  if (aTraiter + aSurveiller + occasions === 0) {
    return `${depense}${rendement} Rien ne s’écarte de vos objectifs : il n’y a pas de geste à faire aujourd’hui.`
  }

  const morceaux: string[] = []
  if (aTraiter > 0) {
    morceaux.push(`${aTraiter} ${aTraiter > 1 ? 'demandent' : 'demande'} une décision`)
  }
  if (aSurveiller > 0) {
    morceaux.push(`${aSurveiller} ${aSurveiller > 1 ? 'sont' : 'est'} à surveiller`)
  }
  if (occasions > 0) {
    morceaux.push(
      `${occasions} ${occasions > 1 ? 'méritent' : 'mérite'} d’être ${
        occasions > 1 ? 'reprises' : 'reprise'
      }`,
    )
  }

  return `${depense}${rendement} ${morceaux.join(', et ')} — la liste est juste en dessous.`
}

type Releve = {
  campagneId: string
  groupeId: string
  annonceId: string
  jour: Date
  coutMicros: bigint
  impressions: bigint
  clics: bigint
  portee: bigint
  conversions: number
  valeurConversion: number
}

function enCumul(ligne: Releve): CumulMeta {
  return {
    coutMicros: Number(ligne.coutMicros),
    impressions: Number(ligne.impressions),
    clics: Number(ligne.clics),
    portee: Number(ligne.portee),
    conversions: ligne.conversions,
    valeurConversion: ligne.valeurConversion,
  }
}

function ecartsDe(actuel: IndicateursMeta, precedent: IndicateursMeta) {
  return {
    cout: variation(actuel.cout, precedent.cout),
    conversions: variation(actuel.conversions, precedent.conversions),
    /* Un ROAS est déjà un pourcentage : il varie en points, jamais « de x % ». */
    roas: ecartEnPoints(actuel.roas, precedent.roas),
    cpa: variation(actuel.cpa, precedent.cpa),
  }
}

/** Regroupe des relevés par une clé, et en fait une ligne jugée. */
function grouper(
  lignes: readonly Releve[],
  cle: (ligne: Releve) => string,
  noms: Map<string, { id: string; nom: string; statut: string; budgetMicros: number }>,
  bornes: { depuis: Date },
  profil: ProfilAds,
): LigneMeta[] {
  const actuels = new Map<string, CumulMeta[]>()
  const precedents = new Map<string, CumulMeta[]>()

  for (const ligne of lignes) {
    const identifiant = cle(ligne)
    if (identifiant === '') continue
    const table = ligne.jour >= bornes.depuis ? actuels : precedents
    const liste = table.get(identifiant) ?? []
    liste.push(enCumul(ligne))
    table.set(identifiant, liste)
  }

  const resultats: LigneMeta[] = []
  for (const [identifiant, cumuls] of actuels) {
    const objet = noms.get(identifiant)
    if (objet === undefined) continue
    const actuel = indicateursMeta(cumulerMeta(cumuls))
    const precedent = indicateursMeta(cumulerMeta(precedents.get(identifiant) ?? [CUMUL_META_VIDE]))
    resultats.push({
      id: objet.id,
      nom: objet.nom,
      statut: objet.statut,
      budget: objet.budgetMicros / MICROS,
      actuel,
      precedent,
      ecarts: ecartsDe(actuel, precedent),
      jugement: juger(actuel, profil),
    })
  }

  /* Par dépense décroissante : c'est là que va l'argent, donc là que se pose la question. */
  return resultats.sort((une, autre) => autre.actuel.cout - une.actuel.cout)
}

/**
 * Le tableau de MIRA, sur une fenêtre et celle qui la précède.
 *
 * Une seule lecture en base couvre les deux périodes et les trois étages : la comparaison
 * est la moitié de ce que cet écran dit, et la faire en deux requêtes exposerait à ce qu'une
 * synchronisation passe entre les deux.
 */
export async function lireTableauMeta(userId: string, jours: number): Promise<VueMeta> {
  const compte = await compteActif(userId, metaAds.id)
  if (compte === null) throw notFound('Aucun compte Meta n’est suivi.')

  const profil = await lireProfil(userId, compte.id)
  const bornes = fenetre(jours, compte.fuseau)
  const precedentes = fenetre(jours * 2, compte.fuseau)
  const debut = new Date(`${bornes.depuis}T00:00:00Z`)

  const [lignes, campagnes, ensembles, annonces] = await Promise.all([
    withUserScope(userId, (tx) =>
      tx.adsReleve.findMany({
        where: {
          userId,
          accountId: compte.id,
          jour: {
            gte: new Date(`${precedentes.depuis}T00:00:00Z`),
            lte: new Date(`${bornes.jusqua}T00:00:00Z`),
          },
        },
        select: {
          campagneId: true,
          groupeId: true,
          annonceId: true,
          jour: true,
          coutMicros: true,
          impressions: true,
          clics: true,
          portee: true,
          conversions: true,
          valeurConversion: true,
        },
      }),
    ),
    withUserScope(userId, (tx) =>
      tx.adsCampagne.findMany({
        where: { accountId: compte.id },
        select: { id: true, nom: true, statut: true, budgetMicros: true },
      }),
    ),
    withUserScope(userId, (tx) =>
      tx.adsGroupe.findMany({
        where: { accountId: compte.id },
        select: { id: true, groupeId: true, nom: true, statut: true, budgetMicros: true },
      }),
    ),
    withUserScope(userId, (tx) =>
      tx.adsAnnonce.findMany({
        where: { accountId: compte.id },
        select: { id: true, annonceId: true, nom: true, statut: true },
      }),
    ),
  ])

  const nomsCampagnes = new Map(
    campagnes.map((une) => [
      une.id,
      { id: une.id, nom: une.nom, statut: une.statut, budgetMicros: Number(une.budgetMicros) },
    ]),
  )
  const nomsEnsembles = new Map(
    ensembles.map((un) => [
      un.groupeId,
      { id: un.id, nom: un.nom, statut: un.statut, budgetMicros: Number(un.budgetMicros) },
    ]),
  )
  const nomsAnnonces = new Map(
    annonces.map((une) => [
      une.annonceId,
      { id: une.id, nom: une.nom, statut: une.statut, budgetMicros: 0 },
    ]),
  )

  /*
   * Les lignes de campagne seules pour le total. Sans ce filtre, la dépense du compte
   * additionnerait la campagne, ses ensembles et ses annonces — trois fois la même.
   */
  const deCampagne = lignes.filter((une) => une.groupeId === '' && une.annonceId === '')
  const total = indicateursMeta(
    cumulerMeta(deCampagne.filter((une) => une.jour >= debut).map(enCumul)),
  )
  const totalPrecedent = indicateursMeta(
    cumulerMeta(deCampagne.filter((une) => une.jour < debut).map(enCumul)),
  )

  return {
    compte,
    jours,
    profil,
    total,
    totalPrecedent,
    ecarts: ecartsDe(total, totalPrecedent),
    campagnes: grouper(deCampagne, (une) => une.campagneId, nomsCampagnes, { depuis: debut }, profil),
    ensembles: grouper(
      lignes.filter((une) => une.groupeId !== '' && une.annonceId === ''),
      (une) => une.groupeId,
      nomsEnsembles,
      { depuis: debut },
      profil,
    ),
    annonces: grouper(
      lignes.filter((une) => une.annonceId !== ''),
      (une) => une.annonceId,
      nomsAnnonces,
      { depuis: debut },
      profil,
    ),
  }
}
