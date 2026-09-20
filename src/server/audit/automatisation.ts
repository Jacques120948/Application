import { notFound } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { readSetting, writeSetting } from '@/server/settings/store'
import { availableCredits } from '@/server/billing/credits'
import { deposerDansShopify } from '@/server/commerce/publication'
import { redigerArticle } from './articles'
import { lireCalendrier } from './calendrier'
import { inspecter, lireIndexation } from './indexation'
import { lireRecherches } from './recherches'

/**
 * Ce qui tourne seul, chaque nuit.
 *
 * Jusqu'ici tout partait d'un clic. Or ce qui ne s'ouvre pas ne se sait pas, et les choses
 * qui comptent arrivent précisément les semaines où l'on n'ouvre rien : une page qui sort
 * de l'index, une requête qui perd dix places, un calendrier qu'on avait dit vouloir tenir.
 *
 * Cinq règles portent ce module, et la première n'est pas négociable.
 *
 * **Rien ne s'active tout seul.** Chaque automatisation est à « non » au départ, et la
 * personne l'allume site par site. Une fonctionnalité qui existe n'est pas une
 * fonctionnalité qu'on veut : le jour où Evoliia écrit un article que personne n'a demandé
 * et le facture, elle a perdu la confiance de quelqu'un pour toujours.
 *
 * **La dépense est bornée avant d'être engagée.** La rédaction est la seule qui coûte des
 * crédits. Elle est bornée par le rythme que la personne a choisi — un article par semaine
 * veut dire un article par semaine, pas un par nuit — et elle ne part pas si le solde ne
 * couvre pas le plafond de l'action. Un compte à découvert ne se crée pas ici.
 *
 * **Une seule chose par site et par nuit.** Même quand tout est allumé : l'indexation, le
 * relevé, et au plus un article. Une boucle qui rattrape trois semaines de retard en une
 * nuit est une facture qu'on n'a pas vue venir.
 *
 * **La tournée passe par la portée de chaque propriétaire.** `Site` est sous Row Level
 * Security forcé : une lecture hors portée ne lève pas d'erreur, elle rend zéro ligne. La
 * surveillance en est morte pendant des semaines sans que rien ne le dise. On lit donc les
 * utilisateurs, qui ne sont pas cloisonnés, puis chacun dans sa portée.
 *
 * **Un échec n'arrête pas la tournée.** Google indisponible pour un site ne doit pas priver
 * les mille suivants de leur nuit.
 */

/** Ce que la personne a accepté de laisser tourner, pour un site. */
export type Reglages = {
  indexation: boolean
  releve: boolean
  redaction: boolean
  depot: boolean
  blogId: string
  parPeriode: number
  periode: 'semaine' | 'mois'
  indexeAt: Date | null
  releveAt: Date | null
  redigeAt: Date | null
}

/** Tout à « non ». C'est l'état d'un site dont personne n'a rien demandé. */
const AU_DEPART: Reglages = {
  indexation: false,
  releve: false,
  redaction: false,
  depot: false,
  blogId: '',
  parPeriode: 1,
  periode: 'semaine',
  indexeAt: null,
  releveAt: null,
  redigeAt: null,
}

/** Les rythmes acceptés. Au-delà, ce n'est plus un calendrier éditorial. */
const PAR_PERIODE_MAX = 3

/** Pages demandées à Google par site et par nuit. Bien moins qu'au clic : la nuit est longue. */
const PAGES_PAR_NUIT = 10

/** Les requêtes gardées dans un relevé. Assez pour voir bouger, pas une base de mots-clés. */
const REQUETES_RELEVEES = 25

/** Au-delà, un relevé ne sert plus qu'à occuper de la place. */
const RELEVES_GARDES_JOURS = 180

/** Sites traités par tournée. Le curseur fait le tour des comptes, nuit après nuit. */
export const SITES_PAR_NUIT = 40

function periodeValide(valeur: string): 'semaine' | 'mois' {
  return valeur === 'mois' ? 'mois' : 'semaine'
}

/** Les réglages d'un site, ou ceux d'un site dont personne n'a rien demandé. */
export async function lireReglages(userId: string, siteId: string): Promise<Reglages> {
  const ligne = await withUserScope(userId, (tx) =>
    tx.siteAutomatisation.findFirst({ where: { siteId, userId } }),
  )
  if (ligne === null) return { ...AU_DEPART }
  return {
    indexation: ligne.indexation,
    releve: ligne.releve,
    redaction: ligne.redaction,
    depot: ligne.depot,
    blogId: ligne.blogId,
    parPeriode: ligne.parPeriode,
    periode: periodeValide(ligne.periode),
    indexeAt: ligne.indexeAt,
    releveAt: ligne.releveAt,
    redigeAt: ligne.redigeAt,
  }
}

/**
 * Enregistre ce que la personne vient d'autoriser.
 *
 * Le rythme est borné ici, côté serveur, et pas seulement dans le menu qui l'a envoyé : ce
 * qui vient du navigateur décide d'une dépense, et une borne d'écran n'est pas une borne.
 */
export async function ecrireReglages(
  userId: string,
  siteId: string,
  patch: Partial<Omit<Reglages, 'indexeAt' | 'releveAt' | 'redigeAt'>>,
): Promise<Reglages> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({ where: { id: siteId, userId, deletedAt: null }, select: { id: true } }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  const actuel = await lireReglages(userId, siteId)
  const voulu = {
    indexation: patch.indexation ?? actuel.indexation,
    releve: patch.releve ?? actuel.releve,
    redaction: patch.redaction ?? actuel.redaction,
    depot: patch.depot ?? actuel.depot,
    blogId: (patch.blogId ?? actuel.blogId).slice(0, 200),
    parPeriode: Math.min(PAR_PERIODE_MAX, Math.max(1, Math.trunc(patch.parPeriode ?? actuel.parPeriode))),
    periode: periodeValide(patch.periode ?? actuel.periode),
  }

  await withUserScope(userId, (tx) =>
    tx.siteAutomatisation.upsert({
      where: { siteId },
      create: { siteId, userId, ...voulu },
      update: voulu,
    }),
  )
  return { ...actuel, ...voulu }
}

/**
 * Le prochain article est-il dû ?
 *
 * Un rythme est une borne, pas un objectif à rattraper : si trois semaines ont passé sans
 * que rien ne tourne, on écrit un article, pas trois. Le retard ne se rattrape jamais en
 * dépensant plus vite que ce qui a été autorisé.
 */
export function redactionDue(reglages: Reglages, maintenant: Date): boolean {
  if (!reglages.redaction) return false
  if (reglages.redigeAt === null) return true
  const jours = reglages.periode === 'mois' ? 30 : 7
  const intervalle = (jours / reglages.parPeriode) * 24 * 60 * 60 * 1000
  return maintenant.getTime() - reglages.redigeAt.getTime() >= intervalle
}

/** Minuit du jour donné, en temps universel : un relevé porte sur un jour, pas sur une heure. */
function jourDe(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export type Bilan = {
  sites: number
  indexations: number
  releves: number
  articles: number
  depots: number
  echecs: number
}

/** Où la dernière tournée s'est arrêtée. Voir `aTraiter`. */
const CURSEUR = 'automatisation.curseur'

/**
 * Les sites dont une automatisation est allumée, en passant par la portée de chacun.
 *
 * Le curseur n'est pas un luxe : quarante sites par nuit sur mille comptes, c'est un tour
 * en vingt-cinq nuits, et il faut que ce tour existe. Sans lui, les mêmes premiers comptes
 * seraient servis chaque nuit et les derniers jamais.
 */
async function aTraiter(limite: number): Promise<{ siteId: string; userId: string }[]> {
  const utilisateurs = await prisma.user.findMany({
    where: { disabledAt: null },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  if (utilisateurs.length === 0) return []

  const curseur = await readSetting(CURSEUR)
  const reprise = curseur === null ? -1 : utilisateurs.findIndex((u) => u.id === curseur)
  const depart = reprise < 0 ? 0 : reprise + 1
  const tournee = [...utilisateurs.slice(depart), ...utilisateurs.slice(0, depart)]

  const candidats: { siteId: string; userId: string }[] = []
  let dernier: string | null = null

  for (const utilisateur of tournee) {
    if (candidats.length >= limite) break
    const lignes = await withUserScope(utilisateur.id, (tx) =>
      tx.siteAutomatisation.findMany({
        where: {
          userId: utilisateur.id,
          OR: [{ indexation: true }, { releve: true }, { redaction: true }],
          site: { deletedAt: null },
        },
        select: { siteId: true },
        take: limite - candidats.length,
      }),
    )
    candidats.push(...lignes.map((ligne) => ({ siteId: ligne.siteId, userId: utilisateur.id })))
    dernier = utilisateur.id
  }

  if (dernier !== null) await writeSetting(CURSEUR, dernier)
  return candidats
}

/** Le relevé du jour, écrasé s'il existe déjà : la photographie d'un jour est unique. */
async function relever(userId: string, siteId: string, origin: string): Promise<boolean> {
  const lecture = await lireRecherches(userId, origin)
  if (!lecture.ok || !('vue' in lecture)) return false

  const jour = jourDe(new Date())
  const requetes = lecture.vue.requetes.slice(0, REQUETES_RELEVEES).map((ligne) => ({
    requete: ligne.cle,
    impressions: ligne.impressions,
    clics: ligne.clics,
    position: ligne.position,
  }))

  await withUserScope(userId, (tx) =>
    tx.releveRecherche.upsert({
      where: { siteId_jour: { siteId, jour } },
      create: {
        siteId,
        userId,
        jour,
        clics: lecture.vue.totaux.clics,
        impressions: lecture.vue.totaux.impressions,
        requetes,
      },
      update: {
        clics: lecture.vue.totaux.clics,
        impressions: lecture.vue.totaux.impressions,
        requetes,
      },
    }),
  )

  const limite = new Date(Date.now() - RELEVES_GARDES_JOURS * 24 * 60 * 60 * 1000)
  await withUserScope(userId, (tx) =>
    tx.releveRecherche.deleteMany({ where: { siteId, userId, jour: { lt: limite } } }),
  )
  return true
}

/**
 * Fait écrire l'article du calendrier, et le dépose si c'est demandé.
 *
 * Le solde est vérifié avant, et c'est la seule barrière qui compte : le débit lui-même
 * passe par la machinerie habituelle, qui réserve puis ajuste sur les jetons réellement
 * consommés. On refuse de partir plutôt que de découvrir à l'arrivée qu'on ne pouvait pas.
 */
async function rediger(
  userId: string,
  siteId: string,
  reglages: Reglages,
  locale: string,
): Promise<{ ecrit: boolean; depose: boolean }> {
  const solde = await availableCredits(userId)
  if (solde <= 0) {
    logger.info('rédaction automatique différée : solde insuffisant', { site: siteId })
    return { ecrit: false, depose: false }
  }

  const vue = await lireCalendrier(userId, siteId, {
    parPeriode: reglages.parPeriode,
    periode: reglages.periode,
    periodes: 1,
  })
  const creneau = vue.creneaux[0]
  if (creneau === undefined) return { ecrit: false, depose: false }

  const article = await redigerArticle(userId, siteId, creneau.requete, creneau.langue ?? locale)

  let depose = false
  if (reglages.depot) {
    try {
      await deposerDansShopify(userId, article.id, reglages.blogId === '' ? undefined : reglages.blogId)
      depose = true
    } catch (error) {
      // L'article est écrit et payé : un dépôt raté ne doit pas le faire disparaître.
      logger.warn('dépôt automatique refusé', {
        raison: error instanceof Error ? error.message : 'inconnu',
      })
    }
  }
  return { ecrit: true, depose }
}

/**
 * La tournée de la nuit.
 *
 * Appelée par le planificateur, une fois par jour. Elle ne lève jamais : un site qui échoue
 * est compté et la tournée continue, sans quoi une boutique injoignable priverait tous les
 * comptes suivants de leur nuit.
 */
export async function tournerQuotidien(limite = SITES_PAR_NUIT): Promise<Bilan> {
  const bilan: Bilan = { sites: 0, indexations: 0, releves: 0, articles: 0, depots: 0, echecs: 0 }
  const candidats = await aTraiter(limite)
  const maintenant = new Date()

  for (const candidat of candidats) {
    bilan.sites += 1
    try {
      const site = await withUserScope(candidat.userId, (tx) =>
        tx.site.findFirst({
          where: { id: candidat.siteId, userId: candidat.userId, deletedAt: null },
          select: { origin: true },
        }),
      )
      if (site === null) continue

      const reglages = await lireReglages(candidat.userId, candidat.siteId)
      const fait: { indexeAt?: Date; releveAt?: Date; redigeAt?: Date } = {}

      if (reglages.indexation) {
        const vue = await lireIndexation(candidat.userId, candidat.siteId)
        const urls = vue.suspectes.slice(0, PAGES_PAR_NUIT).map((page) => page.url)
        if (urls.length > 0) {
          const resultat = await inspecter(candidat.userId, candidat.siteId, urls)
          if (resultat.ok) bilan.indexations += resultat.pages.length
        }
        fait.indexeAt = maintenant
      }

      if (reglages.releve && (await relever(candidat.userId, candidat.siteId, site.origin))) {
        bilan.releves += 1
        fait.releveAt = maintenant
      }

      if (redactionDue(reglages, maintenant)) {
        const issue = await rediger(candidat.userId, candidat.siteId, reglages, 'fr')
        if (issue.ecrit) {
          bilan.articles += 1
          fait.redigeAt = maintenant
        }
        if (issue.depose) bilan.depots += 1
      }

      if (Object.keys(fait).length > 0) {
        await withUserScope(candidat.userId, (tx) =>
          tx.siteAutomatisation.updateMany({
            where: { siteId: candidat.siteId, userId: candidat.userId },
            data: fait,
          }),
        )
      }
    } catch (error) {
      bilan.echecs += 1
      // Aucune adresse, aucun identifiant : un journal se relit, se copie et s'exporte.
      logger.warn('automatisation : un site a échoué', {
        raison: error instanceof Error ? error.message.slice(0, 120) : 'inconnu',
      })
    }
  }

  logger.info('automatisation quotidienne passée', { ...bilan })
  return bilan
}
