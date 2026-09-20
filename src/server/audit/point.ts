import { notFound } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { writePoint } from '@/server/ai/operations'
import { noterPourEquipe } from '@/server/agents/memoire'
import type { VisibilityAgentId } from '@/server/agents/visibility'
import { listWatches } from './surveillance'
import { lireRecherches } from './recherches'
import { listArticles } from './articles'
import { tableauIA } from './visibilite-ia'

/**
 * Le point hebdomadaire de Léa.
 *
 * Le produit mesure beaucoup et range dans autant d'écrans : une note d'audit, des pannes
 * ouvertes, des pages hors de l'index, des recherches qui montent, des articles publiés,
 * une fréquence chez les assistants. Chacun de ces écrans est juste, et personne ne les
 * ouvre tous. Ce qui manque n'est pas une mesure de plus — c'est quelqu'un qui regarde
 * l'ensemble et dise par quoi commencer.
 *
 * Quatre décisions portent ce module.
 *
 * **C'est Léa, pas un cinquième personnage.** Elle est déjà celle qui constate et priorise ;
 * ce qui lui manquait n'était pas une collègue mais la vue complète. Ajouter un superviseur
 * au-dessus de quatre spécialistes aurait créé une hiérarchie là où il fallait une fenêtre.
 *
 * **Une source qui manque est nommée comme manquante.** On ne retire pas la ligne : on
 * écrit que la source n'est pas là. Un modèle à qui l'on cache un trou le comble, et une
 * supposition dans un point hebdomadaire devient une décision.
 *
 * **Aucune source ne peut faire échouer le point.** Chaque lecture est protégée : Google
 * indisponible un lundi ne doit pas priver la personne de tout le reste.
 *
 * **Ce que Léa retient va dans la mémoire de l'équipe.** C'est ce qui referme la boucle :
 * les trois autres travaillent ensuite avec ses conclusions, au lieu de redécouvrir la
 * situation chacun de leur côté.
 */

/** La fenêtre de lecture. Une semaine de recul, la même que la cadence. */
const JOURS = 30

export type ActionPoint = {
  quoi: string
  pourquoi: string
  qui: VisibilityAgentId
}

export type Point = {
  id: string
  etat: string
  actions: ActionPoint[]
  createdAt: Date
  creditsSpent: number
}

/** Une lecture qui ne peut pas faire tomber le point. */
async function sans<T>(lecture: Promise<T>): Promise<T | null> {
  return lecture.catch(() => null)
}

/**
 * Ce qui est mesuré, source par source.
 *
 * Volontairement résumé ici plutôt qu'envoyé brut : un modèle à qui l'on donne trois cents
 * lignes de constats en choisit trois au hasard. Ce qui compte, c'est le chiffre et son
 * mouvement.
 */
async function rassembler(
  userId: string,
  siteId: string,
  origin: string,
): Promise<Record<string, unknown>> {
  const [constats, recherches, articles, ia, releves] = await Promise.all([
    sans(listWatches(userId, siteId)),
    sans(lireRecherches(userId, origin)),
    sans(listArticles(userId, siteId)),
    sans(tableauIA(userId, siteId, JOURS)),
    sans(
      withUserScope(userId, (tx) =>
        tx.releveRecherche.findMany({
          where: { siteId, userId },
          orderBy: { jour: 'desc' },
          take: 2,
          select: { jour: true, clics: true, impressions: true },
        }),
      ),
    ),
  ])

  const sources: Record<string, unknown> = {}

  sources.pannes =
    constats === null
      ? 'Non lisible cette fois.'
      : constats.length === 0
        ? 'Aucun problème ouvert.'
        : constats.slice(0, 8).map((constat) => ({
            quoi: constat.label,
            adresse: constat.url,
            depuis: constat.openedAt,
          }))

  if (recherches === null || !recherches.ok || !('vue' in recherches)) {
    sources.recherches =
      'Google Search Console n’est pas relié pour ce site : aucun chiffre de recherche. Ne parle ni de volume, ni de position, ni de concurrence.'
  } else {
    sources.recherches = {
      jours: recherches.vue.jours,
      clics: recherches.vue.totaux.clics,
      affichages: recherches.vue.totaux.impressions,
      /*
       * Les occasions plutôt que les meilleures lignes : ce qui est déjà premier n'appelle
       * pas de travail, ce qui est en deuxième page si.
       */
      deuxieme_page: recherches.vue.occasionsDeRequetes.slice(0, 8).map((ligne) => ({
        recherche: ligne.cle,
        position: ligne.position,
        affichages: ligne.impressions,
        clics: ligne.clics,
      })),
    }
  }

  sources.mouvement =
    releves === null || releves.length < 2
      ? 'Pas assez de relevés quotidiens pour dire un mouvement. Ne prétends pas en voir un.'
      : {
          dernier: { jour: releves[0]?.jour, clics: releves[0]?.clics, affichages: releves[0]?.impressions },
          precedent: {
            jour: releves[1]?.jour,
            clics: releves[1]?.clics,
            affichages: releves[1]?.impressions,
          },
        }

  sources.articles =
    articles === null
      ? 'Non lisible cette fois.'
      : articles.length === 0
        ? 'Aucun article écrit pour l’instant.'
        : articles.slice(0, 6).map((article) => ({
            titre: article.titre,
            mots: article.wordCount,
            ecrit_le: article.createdAt,
          }))

  if (ia === null || ia.releves === 0) {
    sources.assistants =
      'Aucun relevé de visibilité dans les assistants. Ne dis rien de la présence de cette marque dans ChatGPT, Gemini ou Perplexity.'
  } else {
    sources.assistants = {
      jours: ia.jours,
      frequence_pourcent: ia.frequence,
      variation_points: ia.variation,
      mentions: ia.mentions,
      releves: ia.releves,
      questions_citees_partout: ia.citeesPartout,
      sites_cites: ia.sites.slice(0, 8).map((site) => ({
        domaine: site.domaine,
        citations: site.citations,
        le_sien: site.sien,
      })),
    }
  }

  return sources
}

/** Le dernier point d'un site, ou `null` quand il n'y en a jamais eu. */
export async function dernierPoint(userId: string, siteId: string): Promise<Point | null> {
  const ligne = await withUserScope(userId, (tx) =>
    tx.pointHebdo.findFirst({
      where: { siteId, userId },
      orderBy: { createdAt: 'desc' },
    }),
  )
  if (ligne === null) return null
  return {
    id: ligne.id,
    etat: ligne.etat,
    actions: Array.isArray(ligne.actions) ? (ligne.actions as unknown as ActionPoint[]) : [],
    createdAt: ligne.createdAt,
    creditsSpent: ligne.creditsSpent,
  }
}

/**
 * Fait le point, et le verse à l'équipe.
 *
 * Le point précédent part avec la demande : sans lui, Léa redirait chaque semaine la même
 * chose, et « ce qui a bougé » — la seule information qu'un hebdomadaire apporte — serait
 * perdue.
 */
export async function fairePoint(userId: string, siteId: string, locale: string): Promise<Point> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { host: true, origin: true },
    }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  const [sources, precedent] = await Promise.all([
    rassembler(userId, siteId, site.origin),
    dernierPoint(userId, siteId),
  ])

  const resultat = await writePoint({
    userId,
    host: site.host,
    locale,
    sources,
    precedent: precedent === null ? null : precedent.etat,
  })

  const actions = resultat.value.actions.map((action) => ({
    quoi: action.quoi.trim().slice(0, 200),
    pourquoi: action.pourquoi.trim().slice(0, 300),
    qui: action.qui as VisibilityAgentId,
  }))

  const ligne = await withUserScope(userId, (tx) =>
    tx.pointHebdo.create({
      data: {
        siteId,
        userId,
        etat: resultat.value.etat.trim().slice(0, 1200),
        actions,
        fondement: sources as object,
        creditsSpent: resultat.creditsSpent,
      },
      select: { id: true, createdAt: true },
    }),
  )

  /*
   * La boucle se referme ici. Ce que Léa retient part dans la mémoire partagée, et les
   * trois autres travailleront avec ses conclusions au lieu de redécouvrir la situation
   * chacun de leur côté — ce qui était exactement le défaut à corriger.
   */
  for (const retenu of resultat.value.retenir.slice(0, 4)) {
    await noterPourEquipe(userId, siteId, 'audit', retenu)
  }

  logger.info('point hebdomadaire écrit', { actions: actions.length })

  return {
    id: ligne.id,
    etat: resultat.value.etat.trim().slice(0, 1200),
    actions,
    createdAt: ligne.createdAt,
    creditsSpent: resultat.creditsSpent,
  }
}
