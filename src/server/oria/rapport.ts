import { compteActif } from '@/server/ads/comptes'
import { listAudits, readPlan } from '@/server/audit/plan'
import { withUserScope } from '@/server/db/scope'
import { lireActivite, type Evenement } from './activite'
import { construirePlan, type ActionPlan } from './plan-marketing'
import { lireSignaux, type Consolidation } from './signaux'

/**
 * Le rapport de la semaine.
 *
 * Il répond à cinq questions — qu'est-ce qui a progressé, qu'est-ce qui a baissé, que
 * faut-il surveiller, qu'a-t-on fait, que faire ensuite — et il y répond par du calcul. Le
 * rapport entier est gratuit : seul le résumé en quelques phrases, s'il est demandé,
 * passe par un modèle.
 *
 * Trois règles.
 *
 * **Une comparaison n'existe que si ses deux termes existent.** Une semaine de dépense
 * sans semaine précédente ne « progresse » pas : elle commence. L'écart n'est calculé que
 * sur un repère non nul, comme dans le brief de MIRA — une division par zéro afficherait
 * l'infini, et l'infini se lit comme une catastrophe.
 *
 * **Ce qui bouge peu ne bouge pas.** En deçà d'un quart d'écart, une dépense ou un nombre
 * de clics d'une semaine sur l'autre est du bruit. Le rapport l'affiche, il ne le célèbre
 * ni ne le déplore.
 *
 * **Aucune action n'est déclarée cause d'un résultat.** Les actions et les résultats sont
 * listés côte à côte ; personne ne peut isoler l'effet d'une modification sur sept jours,
 * et le rapport ne le prétend pas.
 */

const JOUR_MS = 24 * 60 * 60 * 1000

/** Une semaine : les sept jours qui précèdent le rapport. */
const JOURS_SEMAINE = 7

/** En deçà, un écart d'une semaine sur l'autre est du bruit. Le même seuil que MIRA. */
export const ECART_NOTABLE = 0.25

export type Sens = 'mieux' | 'moins-bien' | 'stable' | 'neutre' | 'nouveau'

export type Resultat = {
  /** Ce qui est mesuré, avec sa source : « Meta Ads — conversions ». */
  quoi: string
  avant: number | null
  apres: number | null
  /** Écart relatif, ou `null` quand le repère est nul ou absent. */
  ecart: number | null
  sens: Sens
  /** L'unité d'affichage : un montant porte sa devise. */
  unite: string
}

export type RapportSemaine = {
  /** Le site regardé, le même que celui du cockpit. `null` : aucun site analysé. */
  site: { id: string; host: string } | null
  depuis: Date
  jusqua: Date
  resultats: Resultat[]
  victoires: string[]
  attention: string[]
  actions: Evenement[]
  priorites: ActionPlan[]
  /** Ce qu'Oria n'a pas pu lire, pour le dire plutôt que de le taire. */
  absents: string[]
}

/**
 * Le sens d'un écart, selon ce que la mesure veut dire.
 *
 * Plus de conversions, c'est mieux. Un coût par conversion plus élevé, c'est moins bien.
 * Une dépense plus élevée n'est ni l'un ni l'autre : c'est une décision, pas un résultat,
 * et le rapport ne la juge pas.
 */
export function sensDe(
  avant: number | null,
  apres: number | null,
  plusEstMieux: boolean | null,
): { ecart: number | null; sens: Sens } {
  if (apres === null) return { ecart: null, sens: 'neutre' }
  if (avant === null || avant <= 0) return { ecart: null, sens: apres > 0 ? 'nouveau' : 'neutre' }
  const ecart = (apres - avant) / avant
  if (plusEstMieux === null) return { ecart, sens: 'neutre' }
  if (Math.abs(ecart) < ECART_NOTABLE) return { ecart, sens: 'stable' }
  const monte = ecart > 0
  return { ecart, sens: monte === plusEstMieux ? 'mieux' : 'moins-bien' }
}

export type Cumul = { cout: number; clics: number; conversions: number; valeur: number }

/**
 * Les chiffres d'un compte publicitaire sur une fenêtre, lus sur les relevés déjà en base.
 *
 * Les seules lignes de campagne : Meta relève aussi par ensemble et par annonce, et tout
 * additionner compterait la même dépense trois fois.
 */
export async function cumulSur(
  userId: string,
  accountId: string,
  depuis: Date,
  jusqua: Date,
  /** Une seule campagne, quand on mesure ce qu'a donné une action sur elle. */
  campagneId?: string,
): Promise<Cumul> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsReleve.findMany({
      where: {
        userId,
        accountId,
        groupeId: '',
        annonceId: '',
        jour: { gte: depuis, lt: jusqua },
        ...(campagneId === undefined ? {} : { campagneId }),
      },
      select: { coutMicros: true, clics: true, conversions: true, valeurConversion: true },
    }),
  )
  return lignes.reduce<Cumul>(
    (total, ligne) => ({
      cout: total.cout + Number(ligne.coutMicros) / 1_000_000,
      clics: total.clics + Number(ligne.clics),
      conversions: total.conversions + ligne.conversions,
      valeur: total.valeur + ligne.valeurConversion,
    }),
    { cout: 0, clics: 0, conversions: 0, valeur: 0 },
  )
}

/** Les lignes de résultat d'une plateforme publicitaire, semaine contre semaine. */
export function resultatsPublicitaires(
  nom: string,
  devise: string,
  avant: Cumul,
  apres: Cumul,
): Resultat[] {
  const ligne = (
    quoi: string,
    a: number | null,
    b: number | null,
    plusEstMieux: boolean | null,
    unite: string,
  ): Resultat => ({ quoi: `${nom} — ${quoi}`, avant: a, apres: b, unite, ...sensDe(a, b, plusEstMieux) })

  const resultats = [
    ligne('dépense', avant.cout, apres.cout, null, devise),
    ligne('clics', avant.clics, apres.clics, true, ''),
    ligne('conversions', avant.conversions, apres.conversions, true, ''),
  ]
  /*
   * Le coût par conversion n'a de sens que si les deux semaines en ont eu : sans quoi on
   * diviserait par zéro, ou l'on comparerait un coût à une absence.
   */
  if (avant.conversions > 0 && apres.conversions > 0) {
    resultats.push(
      ligne('coût par conversion', avant.cout / avant.conversions, apres.cout / apres.conversions, false, devise),
    )
  }
  return resultats
}

/**
 * Ce qui est bon à savoir et ce qui inquiète, tiré des résultats et des signaux.
 *
 * Fonction pure, et c'est là que la prudence se vérifie : une victoire est un écart
 * favorable **notable**, jamais une variation de bruit ; un point d'attention est un écart
 * défavorable notable, une note en baisse ou un constat critique.
 */
export function lireLaSemaine(
  resultats: readonly Resultat[],
  notes: readonly { quoi: string; delta: number | null }[],
  reglees: readonly string[],
  vue: Pick<Consolidation, 'signaux' | 'canaux'>,
): { victoires: string[]; attention: string[] } {
  const victoires: string[] = []
  const attention: string[] = []

  for (const note of notes) {
    if (note.delta === null || note.delta === 0) continue
    const points = `${Math.abs(note.delta)} point${Math.abs(note.delta) > 1 ? 's' : ''}`
    if (note.delta > 0) victoires.push(`${note.quoi} : +${points} à la dernière analyse.`)
    else attention.push(`${note.quoi} : −${points} à la dernière analyse.`)
  }

  for (const titre of reglees) victoires.push(`« ${titre} » ne remonte plus dans la dernière analyse.`)

  for (const resultat of resultats) {
    if (resultat.ecart === null) continue
    const pourcent = `${Math.round(Math.abs(resultat.ecart) * 100)} %`
    if (resultat.sens === 'mieux') victoires.push(`${resultat.quoi} : ${resultat.ecart > 0 ? '+' : '−'}${pourcent} sur la semaine.`)
    if (resultat.sens === 'moins-bien') attention.push(`${resultat.quoi} : ${resultat.ecart > 0 ? '+' : '−'}${pourcent} sur la semaine.`)
  }

  for (const signal of vue.signaux.filter((un) => un.urgence === 'critique').slice(0, 3)) {
    attention.push(`${signal.titre}.`)
  }
  for (const canal of vue.canaux.filter((un) => un.etat === 'renforcer')) {
    attention.push(`${canal.nom} à renforcer : ${canal.pourquoi}`)
  }

  return { victoires, attention }
}

/** Le rapport de la semaine qui s'achève. */
export async function lireRapport(
  userId: string,
  locale: string,
  siteId?: string,
  maintenant = new Date(),
): Promise<RapportSemaine> {
  const jusqua = maintenant
  const depuis = new Date(+jusqua - JOURS_SEMAINE * JOUR_MS)
  const avantDepuis = new Date(+depuis - JOURS_SEMAINE * JOUR_MS)

  const vue = await lireSignaux(userId, locale, siteId)
  const site = vue.site

  const [audits, plan, activite, compteAds, compteMeta, faites] = await Promise.all([
    site === null ? Promise.resolve([]) : listAudits(userId, site.id, 2).catch(() => []),
    site === null ? Promise.resolve(null) : readPlan(userId, site.id).catch(() => null),
    lireActivite(userId, site?.id ?? null, 40).catch(() => []),
    compteActif(userId, 'google-ads').catch(() => null),
    compteActif(userId, 'meta-ads').catch(() => null),
    site === null
      ? Promise.resolve([])
      : withUserScope(userId, (tx) =>
          tx.actionItem.findMany({
            where: { userId, siteId: site.id, state: 'done', updatedAt: { gte: depuis } },
            select: { checkId: true, updatedAt: true },
          }),
        ).catch(() => []),
  ])

  const resultats: Resultat[] = []
  const absents: string[] = []
  for (const [compte, nom] of [
    [compteAds, 'Google Ads'],
    [compteMeta, 'Meta Ads'],
  ] as const) {
    if (compte === null) {
      absents.push(`${nom} n’est pas relié.`)
      continue
    }
    const [avant, apres] = await Promise.all([
      cumulSur(userId, compte.id, avantDepuis, depuis).catch(() => null),
      cumulSur(userId, compte.id, depuis, jusqua).catch(() => null),
    ])
    if (avant === null || apres === null) {
      absents.push(`${nom} n’a pas pu être lu cette fois.`)
      continue
    }
    resultats.push(...resultatsPublicitaires(nom, compte.devise, avant, apres))
  }

  /*
   * Les notes : seulement si une analyse s'est terminée dans la semaine. Une analyse de
   * juillet comparée à celle de juin ne dit rien de cette semaine-ci.
   */
  const derniere = audits[0]
  const recente = derniere?.finishedAt != null && derniere.finishedAt >= depuis
  const notes = recente
    ? [
        { quoi: 'Référencement', delta: derniere.seoDelta },
        { quoi: 'Moteurs IA', delta: derniere.geoDelta },
        { quoi: 'Conversion', delta: derniere.croDelta },
      ]
    : []
  if (site !== null && !recente) absents.push('Aucune nouvelle analyse du site cette semaine.')
  if (site === null) absents.push('Aucun site analysé.')

  /*
   * Ce qui a été marqué corrigé cette semaine **et** ne remonte plus : la victoire est
   * vérifiée par l'analyse, pas seulement déclarée.
   */
  const reglesCetteSemaine = new Set(faites.map((un) => un.checkId))
  const reglees = (plan?.reglees ?? [])
    .filter((un) => un.state === 'done' && reglesCetteSemaine.has(un.checkId))
    .map((un) => un.label)

  const { victoires, attention } = lireLaSemaine(resultats, notes, reglees, vue)

  const planMarketing = construirePlan(vue.signaux)

  return {
    site,
    depuis,
    jusqua,
    resultats,
    victoires,
    attention,
    actions: activite.filter((un) => un.genre === 'action' && un.quand >= depuis),
    priorites: [...planMarketing.aujourdhui, ...planMarketing.semaine],
    absents,
  }
}
