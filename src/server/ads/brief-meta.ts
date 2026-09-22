import { withUserScope } from '@/server/db/scope'
import { compteActif } from './comptes'
import { metaAds } from './meta-ads'
import { fenetre } from './metriques'

/**
 * Le brief quotidien de MIRA : ce qui s'est passé hier sur la publicité.
 *
 * **Il ne coûte rien, et ce n'est pas un détail de tarification.** La règle du produit est
 * écrite ailleurs et vaut ici : ce qui se compte ne se paie pas. Un brief quotidien rédigé
 * par un modèle coûterait trois à six crédits par jour, quatre-vingt-dix à cent quatre-vingts
 * par mois — davantage que tout le reste de la publicité réunie — pour dire des chiffres
 * qu'on sait additionner. Les faits sont ici, et l'interprétation est déjà le travail des
 * règles, qui elles aussi comptent sans appeler personne.
 *
 * **Il compare hier à la semaine d'avant, pas à avant-hier.** Une dépense varie d'un jour à
 * l'autre pour des raisons qui n'apprennent rien — un samedi n'est pas un mardi. La
 * moyenne des sept jours précédents donne un repère qui ne s'affole pas, et un écart qui
 * dépasse ce repère veut alors dire quelque chose.
 *
 * **Il ne dit pas « tout va bien ».** Il dit ce qui est mesuré, et se tait quand rien n'a
 * bougé. Un brief qui rassure tous les matins finit par n'être plus lu, et c'est le matin
 * où il aurait fallu le lire qu'on ne le lit pas.
 *
 * **Hier, jamais aujourd'hui.** La journée en cours est incomplète par définition : la
 * compter ferait annoncer chaque matin un effondrement de la dépense.
 */

/** En deçà, un écart n'est que du bruit de mesure et ne mérite pas d'être signalé. */
const ECART_NOTABLE = 0.25

/** La fenêtre de comparaison. Sept jours couvrent une semaine entière, week-end compris. */
const JOURS_REPERE = 7

export type ChiffreJour = {
  /** En unités de monnaie, pas en micros : ce qui sort d'ici s'affiche. */
  depense: number
  conversions: number
  valeur: number
  impressions: number
  clics: number
}

export type BriefMeta = {
  /** Le jour couvert, au format ISO court, dans le fuseau du compte. */
  jour: string
  devise: string
  hier: ChiffreJour
  /** La moyenne quotidienne des sept jours qui précèdent. Sert de repère, pas d'objectif. */
  repere: ChiffreJour
  /**
   * L'écart de dépense en proportion du repère : 0,4 pour quarante pour cent de plus.
   * `null` quand le repère est nul — on ne divise pas par rien, et on ne l'invente pas.
   */
  ecartDepense: number | null
  /** Vrai quand cet écart dépasse ce qu'on tient pour du bruit. */
  ecartNotable: boolean
  /** Ce que MIRA a modifié dans les vingt-quatre dernières heures. */
  modifications: number
  /** Constats urgents encore ouverts. */
  urgences: number
  /**
   * Vrai quand il n'y a rien eu du tout : aucune dépense hier, aucune la semaine d'avant.
   * L'écran dit alors que rien ne diffuse, au lieu d'aligner des zéros.
   */
  silencieux: boolean
}

const VIDE: ChiffreJour = { depense: 0, conversions: 0, valeur: 0, impressions: 0, clics: 0 }

/** Additionne des relevés de niveau campagne. Voir le commentaire de `lireBriefMeta`. */
function cumuler(
  lignes: readonly {
    coutMicros: bigint
    conversions: number
    valeurConversion: number
    impressions: bigint
    clics: bigint
  }[],
): ChiffreJour {
  return lignes.reduce<ChiffreJour>(
    (somme, ligne) => ({
      depense: somme.depense + Number(ligne.coutMicros) / 1_000_000,
      conversions: somme.conversions + ligne.conversions,
      valeur: somme.valeur + ligne.valeurConversion,
      impressions: somme.impressions + Number(ligne.impressions),
      clics: somme.clics + Number(ligne.clics),
    }),
    { ...VIDE },
  )
}

/** La moyenne quotidienne d'un cumul étalé sur plusieurs jours. */
function parJour(total: ChiffreJour, jours: number): ChiffreJour {
  const diviseur = Math.max(1, jours)
  return {
    depense: total.depense / diviseur,
    conversions: total.conversions / diviseur,
    valeur: total.valeur / diviseur,
    impressions: total.impressions / diviseur,
    clics: total.clics / diviseur,
  }
}

/**
 * L'écart relatif entre hier et le repère, ou `null` quand le repère est nul.
 *
 * Pure, et exportée pour cela : c'est le seul calcul du brief qui puisse se tromper
 * silencieusement. Une division par zéro rendrait l'infini, qui s'afficherait comme un
 * écart colossal le lendemain du premier jour de diffusion — exactement le matin où il ne
 * faut pas affoler quelqu'un.
 */
export function ecartRelatif(hier: number, repere: number): number | null {
  if (repere <= 0) return null
  return (hier - repere) / repere
}

/**
 * Le brief du compte Meta suivi. `null` quand il n'y a aucun compte : il n'y a alors rien à
 * dire, et une structure vide ferait afficher un brief qui parle de rien.
 */
export async function lireBriefMeta(userId: string): Promise<BriefMeta | null> {
  const compte = await compteActif(userId, metaAds.id)
  if (compte === null) return null

  const bornes = fenetre(1, compte.fuseau)
  const repere = fenetre(JOURS_REPERE + 1, compte.fuseau)
  const veille = new Date(`${bornes.depuis}T00:00:00Z`)

  /*
   * Seuls les relevés de niveau campagne sont additionnés. Les mêmes journées existent au
   * niveau de l'ensemble et de l'annonce : les prendre toutes compterait chaque franc trois
   * fois, et le brief annoncerait le triple de la dépense réelle — l'erreur la plus alarmante
   * qu'on puisse commettre dans un texte qui parle d'argent.
   */
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsReleve.findMany({
      where: {
        userId,
        accountId: compte.id,
        groupeId: '',
        annonceId: '',
        jour: {
          gte: new Date(`${repere.depuis}T00:00:00Z`),
          lte: new Date(`${bornes.jusqua}T00:00:00Z`),
        },
      },
      select: {
        jour: true,
        coutMicros: true,
        conversions: true,
        valeurConversion: true,
        impressions: true,
        clics: true,
      },
    }),
  )

  const dHier = lignes.filter((une) => une.jour.getTime() === veille.getTime())
  const avant = lignes.filter((une) => une.jour.getTime() < veille.getTime())

  const hier = cumuler(dHier)
  const moyenne = parJour(cumuler(avant), JOURS_REPERE)
  const ecart = ecartRelatif(hier.depense, moyenne.depense)

  const depuisHier = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [modifications, urgences] = await withUserScope(userId, async (tx) => [
    await tx.adsAction.count({
      where: { userId, accountId: compte.id, createdAt: { gte: depuisHier } },
    }),
    await tx.adsRecommandation.count({
      where: { userId, accountId: compte.id, etat: 'ouverte', priorite: 'urgent' },
    }),
  ])

  return {
    jour: bornes.depuis,
    devise: compte.devise,
    hier,
    repere: moyenne,
    ecartDepense: ecart,
    ecartNotable: ecart !== null && Math.abs(ecart) >= ECART_NOTABLE,
    modifications,
    urgences,
    silencieux: hier.depense === 0 && moyenne.depense === 0,
  }
}
