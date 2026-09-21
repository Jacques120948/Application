import { notFound } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { seuilRentabilite } from '@/lib/rentabilite'
import { compteActif, type CompteRelie } from './comptes'
import { MICROS, moisCourant, type Indicateurs } from './metriques'

/**
 * Ce que la personne vise, et ce que ses chiffres valent au regard de ce qu'elle vise.
 *
 * Sans ce module, un tableau de bord publicitaire n'est qu'une rangée de nombres. « ROAS
 * 245 % » ne se juge pas : c'est excellent pour une librairie qui marge à 25 %, c'est une
 * perte pour un revendeur qui marge à 15 %. Ce qui tranche est la marge, et elle
 * n'appartient pas à Google — elle appartient au commerçant, qui est le seul à la connaître.
 *
 * Quatre décisions portent le fichier.
 *
 * **Le seuil de rentabilité est déduit, pas demandé.** On ne demande pas à quelqu'un « à
 * partir de quel ROAS gagnez-vous de l'argent ? » : c'est précisément la question qu'il paie
 * Evoliia pour ne plus avoir à se poser. On demande sa marge, qu'il connaît, et le seuil s'en
 * déduit par une division — cent divisé par la marge. Une marge de 40 % impose un ROAS de
 * 250 % pour rentrer dans ses frais.
 *
 * **Zéro veut dire « non renseigné », jamais « zéro ».** Une marge de 0 % n'a pas de sens
 * commercial, un ROAS cible de 0 % non plus. Les traiter comme des valeurs ferait calculer
 * un seuil infini et afficher « vous êtes en perte » à quelqu'un qui n'a simplement rien
 * rempli. Chaque champ vide se dit vide.
 *
 * **Le bénéfice est annoncé comme un calcul, pas comme un relevé bancaire.** Il vaut
 * « valeur des conversions × marge − dépense publicitaire ». Il ne tient compte ni des
 * retours, ni des frais de port, ni de la TVA, ni des ventes que la publicité a provoquées
 * sans que Google les voie. L'écran le dit ; ce module ne prétend pas le contraire.
 *
 * **Rien de ce qui est ici n'est calculé par un modèle.** Naya reçoit ces résultats et les
 * explique. Une erreur d'arithmétique sur un seuil de rentabilité ne se voit pas : elle
 * ressemble à un chiffre, et elle se paie en budget mal placé.
 */

/** Ce que la personne cherche à maximiser. Le vocabulaire reste le sien. */
export const OBJECTIFS = ['conversions', 'valeur', 'roas', 'cpa'] as const

export type Objectif = (typeof OBJECTIFS)[number]

/** Le profil tel qu'il s'affiche et se saisit : l'argent en unités, jamais en micros. */
export type ProfilAds = {
  activite: string
  pays: string
  produits: string
  panierMoyen: number
  /** Marge brute moyenne, en pourcentage entier. 0 : non renseignée. */
  margePourcent: number
  /** ROAS visé, en pourcentage entier. 0 : non renseigné. */
  roasCible: number
  /** Coût par conversion acceptable, en unités de la devise. 0 : non renseigné. */
  cpaCible: number
  /** Budget publicitaire mensuel, en unités de la devise. 0 : non renseigné. */
  budgetMensuel: number
  objectif: Objectif
}

export const PROFIL_VIDE: ProfilAds = {
  activite: '',
  pays: '',
  produits: '',
  panierMoyen: 0,
  margePourcent: 0,
  roasCible: 0,
  cpaCible: 0,
  budgetMensuel: 0,
  objectif: 'conversions',
}

/** Vrai dès qu'un chiffre a été renseigné : l'écran doit distinguer « vide » de « nul ». */
export function profilRenseigne(profil: ProfilAds): boolean {
  return (
    profil.margePourcent > 0 ||
    profil.roasCible > 0 ||
    profil.cpaCible > 0 ||
    profil.budgetMensuel > 0 ||
    profil.panierMoyen > 0 ||
    profil.activite.trim() !== '' ||
    profil.produits.trim() !== ''
  )
}

function arrondir(valeur: number, decimales: number): number {
  const facteur = 10 ** decimales
  return Math.round(valeur * facteur) / facteur
}

function estObjectif(valeur: string): valeur is Objectif {
  return (OBJECTIFS as readonly string[]).includes(valeur)
}

/*
 * Le seuil de rentabilité vit dans `@/lib/rentabilite` et non ici : le formulaire de saisie
 * l'affiche en direct pendant qu'on tape sa marge, et un composant de navigateur ne peut pas
 * importer ce fichier — il tirerait la base de données avec lui. Réexporté pour que le reste
 * du module publicitaire n'ait qu'une porte d'entrée.
 */
export { seuilRentabilite } from '@/lib/rentabilite'

/**
 * Ce que la publicité a laissé une fois payée, sur la période.
 *
 * C'est une soustraction, pas une comptabilité : la marge dégagée par les conversions que
 * Google a vues, moins ce qu'on a payé à Google. Les retours, les frais d'expédition et les
 * ventes que Google n'attribue pas n'y sont pas — et l'écran le dit à côté du chiffre.
 */
export function beneficePublicitaire(
  valeurConversions: number,
  cout: number,
  margePourcent: number,
): number | null {
  if (margePourcent <= 0 || margePourcent > 100) return null
  return arrondir((valeurConversions * margePourcent) / 100 - cout, 2)
}

/** Le rythme de dépense du mois, confronté au budget que la personne s'est fixé. */
export type RythmeBudget = {
  budget: number
  /** Dépensé depuis le premier du mois, jusqu'à hier inclus. */
  depense: number
  joursEcoules: number
  joursDuMois: number
  /** Dépense de fin de mois au rythme constaté. `null` le premier du mois. */
  projection: number | null
  /** Part du budget déjà consommée, en pourcentage entier. */
  consomme: number
}

export function rythmeBudget(
  budget: number,
  depense: number,
  joursEcoules: number,
  joursDuMois: number,
): RythmeBudget | null {
  if (budget <= 0) return null
  /*
   * La projection ne se fait pas sur zéro jour. Le premier du mois, il n'y a rien à
   * extrapoler, et un « vous dépenserez 0 CHF ce mois-ci » serait une prévision fausse
   * présentée comme une lecture.
   */
  const projection =
    joursEcoules === 0 ? null : arrondir((depense / joursEcoules) * joursDuMois, 2)
  return {
    budget,
    depense: arrondir(depense, 2),
    joursEcoules,
    joursDuMois,
    projection,
    consomme: Math.round((depense / budget) * 100),
  }
}

/** Le verdict de rentabilité. `inconnu` tant que la marge ou la dépense manque. */
export type Verdict = 'rentable' | 'equilibre' | 'perte' | 'inconnu'

/** La lecture des chiffres d'une période au regard des objectifs. */
export type LectureObjectifs = {
  devise: string
  /** Le ROAS à partir duquel la publicité se paie, déduit de la marge. */
  seuil: number | null
  roas: number | null
  verdict: Verdict
  /** Écart en points entre le ROAS constaté et le seuil de rentabilité. */
  ecartSeuil: number | null
  /** Ce que la publicité a laissé sur la période, marge déduite de la dépense. */
  benefice: number | null
  roasCible: number | null
  /** Écart en points entre le ROAS constaté et le ROAS visé. */
  ecartCible: number | null
  cpa: number | null
  cpaCible: number | null
  /** Écart entre le coût par conversion constaté et celui qu'on s'était fixé. */
  ecartCpa: number | null
  budget: RythmeBudget | null
}

/**
 * Confronte une période aux objectifs.
 *
 * Fonction pure : elle ne lit rien, pour que ses règles soient vérifiables sans base de
 * données. Tout ce qu'elle rend peut valoir `null`, et c'est le point — un objectif non
 * renseigné ne se remplace pas par une norme de marché, il se dit absent.
 */
export function lectureObjectifs(
  profil: ProfilAds,
  total: Indicateurs,
  devise: string,
  budget: RythmeBudget | null,
): LectureObjectifs {
  const seuil = seuilRentabilite(profil.margePourcent)
  const roas = total.roas

  const verdict: Verdict =
    seuil === null || roas === null
      ? 'inconnu'
      : roas > seuil
        ? 'rentable'
        : roas < seuil
          ? 'perte'
          : 'equilibre'

  return {
    devise,
    seuil,
    roas,
    verdict,
    ecartSeuil: seuil === null || roas === null ? null : arrondir(roas - seuil, 1),
    benefice: beneficePublicitaire(total.valeur, total.cout, profil.margePourcent),
    roasCible: profil.roasCible > 0 ? profil.roasCible : null,
    ecartCible:
      profil.roasCible > 0 && roas !== null ? arrondir(roas - profil.roasCible, 1) : null,
    cpa: total.cpa,
    cpaCible: profil.cpaCible > 0 ? profil.cpaCible : null,
    ecartCpa:
      profil.cpaCible > 0 && total.cpa !== null ? arrondir(total.cpa - profil.cpaCible, 2) : null,
    budget,
  }
}

// ─────────────────────────────── Lecture et écriture ─────────────────────────

type LigneProfil = {
  activite: string
  pays: string
  produits: string
  panierMoyenMicros: bigint
  margePourcent: number
  roasCible: number
  cpaCibleMicros: bigint
  budgetMensuelMicros: bigint
  objectif: string
}

function vue(ligne: LigneProfil): ProfilAds {
  return {
    activite: ligne.activite,
    pays: ligne.pays,
    produits: ligne.produits,
    panierMoyen: Number(ligne.panierMoyenMicros) / MICROS,
    margePourcent: ligne.margePourcent,
    roasCible: ligne.roasCible,
    cpaCible: Number(ligne.cpaCibleMicros) / MICROS,
    budgetMensuel: Number(ligne.budgetMensuelMicros) / MICROS,
    objectif: estObjectif(ligne.objectif) ? ligne.objectif : 'conversions',
  }
}

/** Le profil du compte suivi. Vide plutôt qu'absent : l'écran a toujours quoi afficher. */
export async function lireProfil(userId: string, accountId: string): Promise<ProfilAds> {
  const ligne = await withUserScope(userId, (tx) =>
    tx.adsProfil.findFirst({ where: { userId, accountId } }),
  )
  return ligne === null ? { ...PROFIL_VIDE } : vue(ligne)
}

/** Des unités vers des micros, en entier. L'argent ne repart jamais en virgule flottante. */
function enMicros(unites: number): bigint {
  return BigInt(Math.round(unites * MICROS))
}

/**
 * Enregistre le profil du compte suivi.
 *
 * Le compte n'est pas choisi par le navigateur : il est celui que Naya suit. Laisser
 * l'identifiant voyager dans la requête donnerait une case de plus à vérifier pour rien —
 * la personne n'a qu'un compte actif, et c'est celui dont elle parle.
 */
export async function enregistrerProfil(
  userId: string,
  saisie: ProfilAds,
): Promise<{ profil: ProfilAds; compte: CompteRelie }> {
  const compte = await compteActif(userId)
  if (compte === null) throw notFound('Aucun compte publicitaire n’est suivi.')

  const donnees = {
    activite: saisie.activite.trim(),
    pays: saisie.pays.trim(),
    produits: saisie.produits.trim(),
    panierMoyenMicros: enMicros(saisie.panierMoyen),
    margePourcent: saisie.margePourcent,
    roasCible: saisie.roasCible,
    cpaCibleMicros: enMicros(saisie.cpaCible),
    budgetMensuelMicros: enMicros(saisie.budgetMensuel),
    objectif: saisie.objectif,
  }

  const ligne = await withUserScope(userId, (tx) =>
    tx.adsProfil.upsert({
      where: { accountId: compte.id },
      create: { userId, accountId: compte.id, ...donnees },
      update: donnees,
    }),
  )

  return { profil: vue(ligne), compte }
}

/**
 * La dépense du mois en cours, jusqu'à hier.
 *
 * Lue à part du tableau de bord parce qu'elle ne suit pas la même fenêtre : le tableau
 * glisse sur sept ou trente jours, le budget se compte par mois calendaire. Les confondre
 * ferait dire « vous avez consommé 80 % de votre budget » le 3 du mois.
 */
export async function depenseDuMois(
  userId: string,
  accountId: string,
  fuseau: string,
  maintenant = new Date(),
): Promise<{ depense: number; joursEcoules: number; joursDuMois: number }> {
  const mois = moisCourant(fuseau, maintenant)
  if (mois.hier === null) {
    return { depense: 0, joursEcoules: 0, joursDuMois: mois.joursDuMois }
  }

  const somme = await withUserScope(userId, (tx) =>
    tx.adsReleve.aggregate({
      where: {
        userId,
        accountId,
        jour: {
          gte: new Date(`${mois.premier}T00:00:00Z`),
          lte: new Date(`${mois.hier}T00:00:00Z`),
        },
      },
      _sum: { coutMicros: true },
    }),
  )

  return {
    depense: Number(somme._sum.coutMicros ?? 0n) / MICROS,
    joursEcoules: mois.joursEcoules,
    joursDuMois: mois.joursDuMois,
  }
}

/** Le profil et la lecture d'une période, prêts pour l'écran comme pour Naya. */
export async function objectifsDuCompte(
  userId: string,
  compte: CompteRelie,
  total: Indicateurs,
  maintenant = new Date(),
): Promise<{ profil: ProfilAds; lecture: LectureObjectifs; renseigne: boolean }> {
  const profil = await lireProfil(userId, compte.id)
  const mois = await depenseDuMois(userId, compte.id, compte.fuseau, maintenant)
  const budget = rythmeBudget(
    profil.budgetMensuel,
    mois.depense,
    mois.joursEcoules,
    mois.joursDuMois,
  )
  return {
    profil,
    lecture: lectureObjectifs(profil, total, compte.devise, budget),
    renseigne: profilRenseigne(profil),
  }
}
