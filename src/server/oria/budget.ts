import { z } from 'zod'
import { notFound } from '@/lib/errors'
import { compteActif } from '@/server/ads/comptes'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import type { Confiance } from './signaux'
import { cumulSur, type Cumul } from './rapport'

/**
 * Le budget : ce qui est déclaré, ce qui est dépensé, et ce qu'on peut en dire.
 *
 * Tout ce module est de la lecture et de l'arithmétique. Oria n'y touche à aucun budget —
 * elle observe, et quand les chiffres le permettent, elle suggère. Changer un budget reste
 * un geste que la personne fait chez Naya ou chez MIRA, après confirmation.
 *
 * Trois règles, et chacune protège contre une façon courante de mal conseiller.
 *
 * **Pas de comparaison sur trop peu.** Comparer la rentabilité de deux régies sur quatre
 * conversions chacune, c'est comparer deux tirages au sort. En deçà d'un seuil, Oria dit
 * que les données ne suffisent pas, et ne recommande rien.
 *
 * **Une recommandation déplace peu.** Même quand une régie est nettement plus rentable,
 * on ne propose pas d'y verser tout le budget : la rentabilité observée baisse presque
 * toujours quand on augmente la dépense, et ce qui marche sur un petit budget ne marche pas
 * forcément sur un grand. Le déplacement est borné.
 *
 * **Une simulation est une fourchette sous hypothèses.** Jamais un chiffre. Elle dit sur
 * quoi elle repose, et que cette hypothèse est en général optimiste.
 */

const JOUR_MS = 24 * 60 * 60 * 1000

/** La fenêtre de lecture : un mois, en quatre semaines. */
const JOURS = 28
const SEMAINES = 4

/** En deçà, sur la fenêtre, une régie n'a pas assez converti pour être comparée. */
export const CONVERSIONS_MIN = 10
/** Au-delà, et sur quatre semaines pleines, la comparaison est solide. */
export const CONVERSIONS_SOLIDES = 30
/** En deçà de cet écart de rentabilité, deux régies se valent : rien à déplacer. */
export const ECART_SIGNIFICATIF = 0.25
/** Le plus grand déplacement proposé, en points de pourcentage du budget publicitaire. */
export const DEPLACEMENT_MAX = 20

export const POSTES = ['google', 'meta', 'contenu', 'autres'] as const
export type Poste = (typeof POSTES)[number]

export const NOM_POSTE: Record<Poste, string> = {
  google: 'Google Ads',
  meta: 'Meta Ads',
  contenu: 'Contenu',
  autres: 'Autres',
}

export type Budgets = Partial<Record<Poste, number>>

export type Plateforme = {
  poste: 'google' | 'meta'
  nom: string
  devise: string
  /** Les quatre dernières semaines, de la plus ancienne à la plus récente. */
  semaines: Cumul[]
  total: Cumul
}

// ── Budgets déclarés ─────────────────────────────────────────────────────────

export const budgetsInput = z
  .object(Object.fromEntries(POSTES.map((poste) => [poste, z.number().min(0).max(10_000_000).optional()])))
  .strict()

function budgetsValides(brut: unknown): Budgets {
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) return {}
  const sortie: Budgets = {}
  for (const poste of POSTES) {
    const valeur = Number((brut as Record<string, unknown>)[poste])
    if (Number.isFinite(valeur) && valeur >= 0) sortie[poste] = valeur
  }
  return sortie
}

export async function lireBudgets(userId: string, siteId: string): Promise<Budgets> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({ where: { id: siteId, userId, deletedAt: null }, select: { budgets: true } }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')
  return budgetsValides(site.budgets)
}

export async function enregistrerBudgets(
  userId: string,
  siteId: string,
  budgets: z.infer<typeof budgetsInput>,
): Promise<Budgets> {
  const propres = budgetsValides(budgets)
  const modifies = await withUserScope(userId, (tx) =>
    tx.site.updateMany({ where: { id: siteId, userId, deletedAt: null }, data: { budgets: propres } }),
  )
  if (modifies.count === 0) throw notFound('Ce site est introuvable.')
  logger.info('budgets déclarés', { userId, siteId, postes: Object.keys(propres).length })
  return propres
}

/** La répartition déclarée, en parts du total. Vide quand rien n'est déclaré. */
export function repartition(budgets: Budgets): { poste: Poste; montant: number; part: number }[] {
  const total = POSTES.reduce((somme, poste) => somme + (budgets[poste] ?? 0), 0)
  if (total <= 0) return []
  return POSTES.filter((poste) => (budgets[poste] ?? 0) > 0).map((poste) => ({
    poste,
    montant: budgets[poste] ?? 0,
    part: (budgets[poste] ?? 0) / total,
  }))
}

// ── Ce que les régies ont réellement fait ─────────────────────────────────────

/** Les régies reliées, lues sur les relevés déjà en base. Aucun appel aux plateformes. */
export async function lirePlateformes(userId: string, maintenant = new Date()): Promise<Plateforme[]> {
  const jour = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate()))
  const plateformes: Plateforme[] = []
  for (const [poste, plateforme, nom] of [
    ['google', 'google-ads', 'Google Ads'],
    ['meta', 'meta-ads', 'Meta Ads'],
  ] as const) {
    const compte = await compteActif(userId, plateforme).catch(() => null)
    if (compte === null) continue
    const semaines: Cumul[] = []
    for (let rang = SEMAINES; rang >= 1; rang -= 1) {
      const depuis = new Date(+jour - rang * 7 * JOUR_MS)
      const jusqua = new Date(+depuis + 7 * JOUR_MS)
      semaines.push(await cumulSur(userId, compte.id, depuis, jusqua))
    }
    const total = semaines.reduce<Cumul>(
      (somme, semaine) => ({
        cout: somme.cout + semaine.cout,
        clics: somme.clics + semaine.clics,
        conversions: somme.conversions + semaine.conversions,
        valeur: somme.valeur + semaine.valeur,
      }),
      { cout: 0, clics: 0, conversions: 0, valeur: 0 },
    )
    plateformes.push({ poste, nom, devise: compte.devise, semaines, total })
  }
  return plateformes
}

// ── Comparer les rentabilités ─────────────────────────────────────────────────

export type Comparaison =
  | {
      possible: true
      /** « roas » quand les deux régies remontent une valeur de vente, « cpa » sinon. */
      mesure: 'roas' | 'cpa'
      /** Efficacité de chaque régie : plus c'est haut, mieux c'est (ROAS, ou 1 / CPA). */
      efficacite: Record<'google' | 'meta', number>
      meilleure: 'google' | 'meta' | null
      confiance: Confiance
      /** La phrase qui dit sur quoi repose la comparaison. */
      fondement: string
    }
  | { possible: false; raison: string }

/**
 * Laquelle des deux régies rapporte le plus par franc dépensé, quand on peut le dire.
 *
 * Le ROAS quand les deux remontent la valeur de leurs ventes : c'est la mesure qui compte.
 * Le coût par conversion sinon, en le disant — il ignore qu'une vente peut valoir plus
 * qu'une autre.
 */
export function comparer(plateformes: readonly Plateforme[]): Comparaison {
  const google = plateformes.find((un) => un.poste === 'google')
  const meta = plateformes.find((un) => un.poste === 'meta')
  if (google === undefined || meta === undefined) {
    return { possible: false, raison: 'Il faut les deux régies reliées pour les comparer.' }
  }
  if (google.devise !== meta.devise) {
    return { possible: false, raison: 'Les deux comptes ne sont pas dans la même devise.' }
  }
  for (const regie of [google, meta]) {
    if (regie.total.conversions < CONVERSIONS_MIN) {
      return {
        possible: false,
        raison: `${regie.nom} n’a enregistré que ${Math.round(regie.total.conversions)} conversion${regie.total.conversions >= 2 ? 's' : ''} sur ${JOURS} jours : il en faut au moins ${CONVERSIONS_MIN} de chaque côté pour comparer sans tirer au sort.`,
      }
    }
  }

  const avecValeur = google.total.valeur > 0 && meta.total.valeur > 0
  const efficacite = avecValeur
    ? { google: google.total.valeur / google.total.cout, meta: meta.total.valeur / meta.total.cout }
    : { google: google.total.conversions / google.total.cout, meta: meta.total.conversions / meta.total.cout }

  const [haute, basse] = efficacite.google >= efficacite.meta ? ['google', 'meta'] as const : ['meta', 'google'] as const
  const ecart = efficacite[basse] > 0 ? efficacite[haute] / efficacite[basse] - 1 : Infinity
  const meilleure = ecart >= ECART_SIGNIFICATIF ? haute : null

  const semainesPleines = [google, meta].every((regie) => regie.semaines.every((semaine) => semaine.cout > 0))
  const solide =
    semainesPleines && google.total.conversions >= CONVERSIONS_SOLIDES && meta.total.conversions >= CONVERSIONS_SOLIDES

  return {
    possible: true,
    mesure: avecValeur ? 'roas' : 'cpa',
    efficacite,
    meilleure,
    confiance: solide ? 'elevee' : 'moyenne',
    fondement: `${JOURS} derniers jours : ${Math.round(google.total.conversions)} conversions chez Google Ads, ${Math.round(meta.total.conversions)} chez Meta Ads${avecValeur ? ', avec la valeur des ventes' : ' — sans valeur de vente remontée, la comparaison se fait au coût par conversion'}.`,
  }
}

// ── Répartition recommandée ──────────────────────────────────────────────────

export type Recommandation = {
  /** Les parts proposées pour les postes publicitaires, le reste inchangé. */
  parts: { poste: Poste; actuelle: number; proposee: number }[]
  pourquoi: string
  confiance: Confiance
}

/**
 * Une répartition recommandée, quand la comparaison le permet — et seulement alors.
 *
 * Le contenu et le reste ne bougent pas : rien ne mesure ce qu'ils rapportent, et Oria ne
 * déplace pas un budget qu'elle ne sait pas évaluer. Entre les deux régies, la part se
 * rapproche de leur efficacité relative, sans jamais bouger de plus de vingt points.
 */
export function recommander(budgets: Budgets, plateformes: readonly Plateforme[], comparaison: Comparaison): Recommandation | null {
  if (!comparaison.possible || comparaison.meilleure === null) return null

  // La base : le budget déclaré s'il l'est, la dépense réelle sinon.
  const google = budgets.google ?? plateformes.find((un) => un.poste === 'google')?.total.cout ?? 0
  const meta = budgets.meta ?? plateformes.find((un) => un.poste === 'meta')?.total.cout ?? 0
  const pub = google + meta
  if (pub <= 0) return null

  const actuelleGoogle = google / pub
  const cibleGoogle =
    comparaison.efficacite.google / (comparaison.efficacite.google + comparaison.efficacite.meta)
  const pas = Math.max(-DEPLACEMENT_MAX / 100, Math.min(DEPLACEMENT_MAX / 100, cibleGoogle - actuelleGoogle))
  const proposeeGoogle = actuelleGoogle + pas

  const autres = (budgets.contenu ?? 0) + (budgets.autres ?? 0)
  const total = pub + autres
  const enPartDuTotal = (valeur: number) => (total > 0 ? valeur / total : 0)

  const parts: Recommandation['parts'] = [
    { poste: 'google', actuelle: enPartDuTotal(google), proposee: enPartDuTotal(pub * proposeeGoogle) },
    { poste: 'meta', actuelle: enPartDuTotal(meta), proposee: enPartDuTotal(pub * (1 - proposeeGoogle)) },
    ...(['contenu', 'autres'] as const)
      .filter((poste) => (budgets[poste] ?? 0) > 0)
      .map((poste) => ({ poste, actuelle: enPartDuTotal(budgets[poste] ?? 0), proposee: enPartDuTotal(budgets[poste] ?? 0) })),
  ]

  const nomMeilleure = comparaison.meilleure === 'google' ? 'Google Ads' : 'Meta Ads'
  const mesure = comparaison.mesure === 'roas' ? 'rapporte davantage par franc dépensé' : 'obtient ses conversions moins cher'
  return {
    parts,
    confiance: comparaison.confiance,
    pourquoi: `${nomMeilleure} ${mesure} sur la période. ${comparaison.fondement} Le déplacement est limité à ${DEPLACEMENT_MAX} points : la rentabilité baisse en général quand on augmente un budget, et le contenu n’est pas touché parce que rien ne mesure encore ce qu’il rapporte.`,
  }
}

// ── Simulation ───────────────────────────────────────────────────────────────

/** Un montant écrit comme on l'écrit en Suisse romande : « 31,82 ». */
function montant(valeur: number): string {
  return new Intl.NumberFormat('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valeur)
}

export type Simulation =
  | {
      possible: true
      /** Dépense mensuelle en plus (ou en moins). */
      ecartDepense: number
      /** Conversions en plus (ou en moins) par mois : une fourchette, jamais un chiffre. */
      conversions: { bas: number; haut: number }
      devise: string
      hypotheses: string[]
      confiance: Confiance
    }
  | { possible: false; raison: string }

/**
 * Et si l'on changeait ce budget de tant ?
 *
 * La fourchette vient des coûts par conversion observés semaine par semaine sur le mois :
 * le meilleur et le moins bon. C'est tout ce que les chiffres permettent, et c'est dit.
 * La confiance ne dépasse jamais « moyenne » : une projection n'est jamais sûre, et une
 * hausse de budget fait presque toujours monter le coût de chaque conversion.
 */
export function simuler(plateforme: Plateforme, pourcent: number): Simulation {
  const semainesUtiles = plateforme.semaines.filter((semaine) => semaine.conversions > 0 && semaine.cout > 0)
  if (plateforme.total.cout <= 0) {
    return { possible: false, raison: `${plateforme.nom} n’a rien dépensé ces ${JOURS} derniers jours.` }
  }
  if (semainesUtiles.length < 2 || plateforme.total.conversions < CONVERSIONS_MIN) {
    return {
      possible: false,
      raison: `Trop peu de conversions chez ${plateforme.nom} ces ${JOURS} derniers jours pour estimer quoi que ce soit : il en faut au moins ${CONVERSIONS_MIN}, réparties sur deux semaines.`,
    }
  }

  const couts = semainesUtiles.map((semaine) => semaine.cout / semaine.conversions)
  const cpaBas = Math.min(...couts)
  const cpaHaut = Math.max(...couts)
  const ecartDepense = (plateforme.total.cout * pourcent) / 100
  const bornes = [ecartDepense / cpaHaut, ecartDepense / cpaBas].sort((a, b) => a - b)

  const hausse = pourcent > 0
  const hypotheses = [
    `Le coût par conversion resterait entre ${montant(cpaBas)} et ${montant(cpaHaut)} ${plateforme.devise}, comme ces ${semainesUtiles.length} dernières semaines.`,
    hausse
      ? 'C’est une hypothèse optimiste : en augmentant un budget, on atteint des personnes moins intéressées, et chaque conversion coûte généralement plus cher.'
      : 'En baissant un budget, la plateforme garde en général les meilleures occasions : la perte réelle est souvent un peu moindre que cette fourchette.',
    'Rien d’autre ne changerait : ni les annonces, ni le site, ni la saison.',
  ]

  return {
    possible: true,
    ecartDepense,
    conversions: { bas: Math.round(bornes[0] ?? 0), haut: Math.round(bornes[1] ?? 0) },
    devise: plateforme.devise,
    hypotheses,
    confiance: plateforme.total.conversions >= CONVERSIONS_SOLIDES && semainesUtiles.length === SEMAINES ? 'moyenne' : 'faible',
  }
}

/**
 * L'observation du cahier des charges : « 75 % de votre budget va à Meta alors que Google
 * rapporte davantage ». Une phrase, pas une consigne — et seulement quand la comparaison
 * est possible et qu'une régie ressort nettement.
 */
export function observer(budgets: Budgets, comparaison: Comparaison): string | null {
  if (!comparaison.possible || comparaison.meilleure === null) return null
  const parts = repartition(budgets)
  const autre = comparaison.meilleure === 'google' ? 'meta' : 'google'
  const partAutre = parts.find((un) => un.poste === autre)?.part ?? 0
  const partMeilleure = parts.find((un) => un.poste === comparaison.meilleure)?.part ?? 0
  if (partAutre <= partMeilleure) return null
  const mesure = comparaison.mesure === 'roas' ? 'rapporte davantage par franc dépensé' : 'obtient ses conversions moins cher'
  return `${Math.round(partAutre * 100)} % de votre budget déclaré va à ${NOM_POSTE[autre]}, alors que ${NOM_POSTE[comparaison.meilleure]} ${mesure} sur les ${JOURS} derniers jours. C’est une observation : aucun budget n’est modifié sans vous.`
}
