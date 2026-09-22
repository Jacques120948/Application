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
import { aRafraichir, lireVolumes, rafraichirVolumes } from './volumes'
import {
  ouvrirPassage,
  plateformesSuivies,
  poursuivrePassage,
  soldeCouvre,
} from './visibilite-ia'
import { noterPourEquipe } from '@/server/agents/memoire'
import { fairePoint } from './point'
import { synchroniserTous } from '@/server/ads/synchro'
import { synchroniserTousMeta } from '@/server/ads/synchro-meta'
import { synchroniserCreatifs } from '@/server/ads/creatif'
import { evaluerTous } from '@/server/ads/recommandations'
import { evaluerTousMeta } from '@/server/ads/recommandations-meta'
import { recompterConnecteurs } from '@/server/admin/compteurs'

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
  /** Poser chaque semaine les questions suivies aux assistants. Dépense des crédits. */
  assistants: boolean
  /** Le point hebdomadaire de Léa sur l'ensemble du site. Dépense des crédits. */
  point: boolean
  blogId: string
  parPeriode: number
  periode: 'semaine' | 'mois'
  indexeAt: Date | null
  releveAt: Date | null
  redigeAt: Date | null
  assistantsAt: Date | null
  pointAt: Date | null
}

/** Tout à « non ». C'est l'état d'un site dont personne n'a rien demandé. */
const AU_DEPART: Reglages = {
  indexation: false,
  releve: false,
  redaction: false,
  depot: false,
  assistants: false,
  point: false,
  blogId: '',
  parPeriode: 1,
  periode: 'semaine',
  indexeAt: null,
  releveAt: null,
  redigeAt: null,
  assistantsAt: null,
  pointAt: null,
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
    assistants: ligne.assistants,
    point: ligne.point,
    blogId: ligne.blogId,
    parPeriode: ligne.parPeriode,
    periode: periodeValide(ligne.periode),
    indexeAt: ligne.indexeAt,
    releveAt: ligne.releveAt,
    redigeAt: ligne.redigeAt,
    assistantsAt: ligne.assistantsAt,
    pointAt: ligne.pointAt,
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
  patch: Partial<Omit<Reglages, 'indexeAt' | 'releveAt' | 'redigeAt' | 'assistantsAt' | 'pointAt'>>,
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
    assistants: patch.assistants ?? actuel.assistants,
    point: patch.point ?? actuel.point,
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

/**
 * Le relevé dans les assistants est-il dû ?
 *
 * Hebdomadaire, et non quotidien. Ce qu'un assistant répond lundi et mardi est la même
 * chose, à son aléa près : payer sept fois pour une information qui change au mois est une
 * dépense sans contrepartie. Deux relevés par question et par semaine font vingt-six mesures
 * par trimestre, largement de quoi voir une tendance.
 *
 * Comme pour la rédaction, le retard ne se rattrape pas : trois semaines sans tournée
 * donnent un relevé, pas trois.
 */
export function assistantsDus(reglages: Reglages, maintenant: Date): boolean {
  if (!reglages.assistants) return false
  if (reglages.assistantsAt === null) return true
  return maintenant.getTime() - reglages.assistantsAt.getTime() >= 7 * 24 * 60 * 60 * 1000
}

/**
 * Le point hebdomadaire est-il dû ?
 *
 * Même cadence et même règle que le reste : une fois par semaine, et le retard ne se
 * rattrape pas. Trois semaines sans tournée donnent un point, pas trois — un point
 * hebdomadaire écrit trois fois d'affilée sur les mêmes chiffres ne dirait rien de plus et
 * coûterait trois fois.
 */
export function pointDu(reglages: Reglages, maintenant: Date): boolean {
  if (!reglages.point) return false
  if (reglages.pointAt === null) return true
  return maintenant.getTime() - reglages.pointAt.getTime() >= 7 * 24 * 60 * 60 * 1000
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
  /** Questions posées aux assistants, toutes plateformes confondues. */
  questionsIa: number
  /** Points hebdomadaires écrits. */
  points: number
  /** Comptes publicitaires synchronisés. */
  comptesAds: number
  /** Recommandations publicitaires ouvertes cette nuit. */
  recommandationsAds: number
  /** Comptes dont le créatif a été relu — une fois par semaine, pas chaque nuit. */
  creatifsAds: number
  /**
   * Les comptes publicitaires qui ont échoué, comptés à part des sites.
   *
   * Séparés, et la séparation est utile deux fois. Pour lire le bilan d'abord : « trois
   * échecs » ne dit pas s'il faut aller voir des sites ou des autorisations expirées, qui ne
   * se réparent ni au même endroit ni par la même personne. Et parce que la tournée
   * publicitaire balaie **tous** les comptes de la base là où la tournée des sites suit son
   * curseur : additionner les deux faisait dépendre le bilan d'un site de l'état des comptes
   * de quelqu'un d'autre.
   */
  echecsAds: number
  /** Sites dont les volumes de recherche ont été rafraîchis. Environ un par mois et par site. */
  volumes?: number
  echecs: number
  /** Combien de sites auraient dépensé. Rempli seulement à blanc. */
  redactionsDues?: number
  relevesIaDus?: number
  pointsDus?: number
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
          OR: [
            { indexation: true },
            { releve: true },
            { redaction: true },
            { assistants: true },
            { point: true },
          ],
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
): Promise<{ ecrit: boolean; depose: boolean; sujet: string }> {
  const solde = await availableCredits(userId)
  if (solde <= 0) {
    logger.info('rédaction automatique différée : solde insuffisant', { site: siteId })
    return { ecrit: false, depose: false, sujet: '' }
  }

  const vue = await lireCalendrier(userId, siteId, {
    parPeriode: reglages.parPeriode,
    periode: reglages.periode,
    periodes: 1,
  })
  const creneau = vue.creneaux[0]
  if (creneau === undefined) return { ecrit: false, depose: false, sujet: '' }

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
  return { ecrit: true, depose, sujet: creneau.requete }
}

/**
 * La tournée de la nuit.
 *
 * Appelée par le planificateur, une fois par jour. Elle ne lève jamais : un site qui échoue
 * est compté et la tournée continue, sans quoi une boutique injoignable priverait tous les
 * comptes suivants de leur nuit.
 */
export async function tournerQuotidien(
  limite = SITES_PAR_NUIT,
  /**
   * À blanc : tout se fait sauf écrire.
   *
   * Sert à vérifier que la tournée fonctionne sans attendre trois heures du matin, et
   * sans dépenser un crédit. Elle dit alors combien de sites auraient écrit, ce qui est
   * l'information qu'on cherche — la machinerie de rédaction, elle, est déjà éprouvée au
   * clic.
   */
  sansRedaction = false,
): Promise<Bilan> {
  const bilan: Bilan = {
    sites: 0,
    indexations: 0,
    releves: 0,
    echecsAds: 0,
    articles: 0,
    depots: 0,
    questionsIa: 0,
    points: 0,
    comptesAds: 0,
    recommandationsAds: 0,
    creatifsAds: 0,
    echecs: 0,
  }
  if (sansRedaction) {
    bilan.redactionsDues = 0
    bilan.relevesIaDus = 0
    bilan.pointsDus = 0
  }
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
      const fait: {
        indexeAt?: Date
        releveAt?: Date
        redigeAt?: Date
        assistantsAt?: Date
        pointAt?: Date
      } = {}

      if (reglages.indexation) {
        const vue = await lireIndexation(candidat.userId, candidat.siteId)
        const urls = vue.suspectes.slice(0, PAGES_PAR_NUIT).map((page) => page.url)
        if (urls.length > 0) {
          const resultat = await inspecter(candidat.userId, candidat.siteId, urls)
          if (resultat.ok) {
            bilan.indexations += resultat.pages.length
            /*
             * Seules les pages absentes de l'index sont retenues pour l'équipe. Dire
             * chaque nuit « vingt pages vérifiées, tout va bien » noierait en une semaine
             * les phrases que les spécialistes ont jugées utiles.
             */
            const absentes = resultat.pages.filter(
              (page) => page.verdict !== 'PASS' && page.verdict !== 'NEUTRAL',
            ).length
            if (absentes > 0) {
              await noterPourEquipe(
                candidat.userId,
                candidat.siteId,
                'seo',
                `${absentes} page(s) vérifiée(s) cette nuit ne sont pas dans l'index de Google.`,
              )
            }
          }
        }
        fait.indexeAt = maintenant
      }

      if (reglages.releve && (await relever(candidat.userId, candidat.siteId, site.origin))) {
        bilan.releves += 1
        fait.releveAt = maintenant

        /*
         * Les volumes de recherche suivent le relevé, et seulement quand les anciens ont
         * plus d'un mois. Un volume est une moyenne mensuelle : le redemander chaque nuit
         * réécrirait le même nombre en usant le quota d'appels d'Evoliia, partagé par tous
         * ses utilisateurs. À ce rythme, un site coûte un appel par mois.
         *
         * L'échec ne compte pas comme une panne de la nuit : la plupart des sites n'ont
         * aucun compte publicitaire relié, et c'est un état ordinaire, pas une erreur.
         */
        const connus = await lireVolumes(candidat.userId, candidat.siteId)
        if (aRafraichir(connus, maintenant)) {
          const issue = await rafraichirVolumes(
            candidat.userId,
            candidat.siteId,
            site.origin,
            'fr',
          ).catch(() => ({ ok: false as const, raison: '' }))
          if (issue.ok) bilan.volumes = (bilan.volumes ?? 0) + 1
        }
      }

      if (redactionDue(reglages, maintenant)) {
        if (sansRedaction) {
          // À blanc : on compte, on n'écrit pas, et le reste de la nuit se fait quand même.
          bilan.redactionsDues = (bilan.redactionsDues ?? 0) + 1
        } else {
          const issue = await rediger(candidat.userId, candidat.siteId, reglages, 'fr')
          if (issue.ecrit) {
            bilan.articles += 1
            fait.redigeAt = maintenant
            await noterPourEquipe(
              candidat.userId,
              candidat.siteId,
              'content',
              issue.sujet === ''
                ? 'Un article a été écrit automatiquement cette nuit.'
                : `Article écrit cette nuit sur « ${issue.sujet} »${issue.depose ? ', déposé en brouillon dans Shopify' : ''}.`,
            )
          }
          if (issue.depose) bilan.depots += 1
        }
      }

      if (assistantsDus(reglages, maintenant)) {
        if (sansRedaction) {
          bilan.relevesIaDus = (bilan.relevesIaDus ?? 0) + 1
        } else {
          /*
           * Le solde est vérifié avant d'interroger quoi que ce soit. `releverVisibilite`
           * réserve et refuse de lui-même quand il manque, mais ce refus est une exception
           * qui compterait comme un échec de tournée — alors qu'un compte à sec est un état
           * ordinaire, pas une panne.
           */
          const questions = await withUserScope(candidat.userId, (tx) =>
            tx.promptIA.count({ where: { siteId: candidat.siteId, userId: candidat.userId, actif: true } }),
          )
          /*
           * Les assistants suivis, et non tous ceux qui sont disponibles : le prix se compte
           * par question et par assistant depuis que chacun choisit les siens, et vérifier
           * le solde sur une liste plus large ferait renoncer à un passage qu'on pouvait
           * s'offrir.
           */
          const assistants = await plateformesSuivies(candidat.userId, candidat.siteId)
          if (questions > 0 && (await soldeCouvre(candidat.userId, questions, assistants.length))) {
            /*
             * La nuit ouvre le passage et le mène à bout dans la foulée : personne ne
             * regarde, et rien ne presse. Si la tournée est coupée, le passage reste
             * ouvert et se reprend — à la nuit suivante, ou dès que la personne ouvre
             * l'écran.
             */
            await ouvrirPassage(candidat.userId, candidat.siteId)
            const releve = await poursuivrePassage(candidat.userId, candidat.siteId)
            bilan.questionsIa += releve.questions
            fait.assistantsAt = maintenant
            if (releve.questions > 0) {
              await noterPourEquipe(
                candidat.userId,
                candidat.siteId,
                'geo',
                `Relevé chez les assistants : ${releve.mentions} mention(s) sur ${releve.releves} réponses, pour ${releve.questions} question(s).`,
              )
            }
          } else if (questions > 0) {
            logger.info('relevé assistants différé : solde insuffisant', { site: candidat.siteId })
          }
        }
      }

      /*
       * Le point vient en dernier, et ce n'est pas un détail d'ordre : il lit ce que la
       * nuit vient de produire. Le faire d'abord raconterait la semaine passée en ignorant
       * le travail des dix minutes précédentes.
       */
      if (pointDu(reglages, maintenant)) {
        if (sansRedaction) {
          bilan.pointsDus = (bilan.pointsDus ?? 0) + 1
        } else if ((await availableCredits(candidat.userId)) > 0) {
          await fairePoint(candidat.userId, candidat.siteId, 'fr')
          bilan.points += 1
          fait.pointAt = maintenant
        } else {
          logger.info('point hebdomadaire différé : solde insuffisant', { site: candidat.siteId })
        }
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

  /*
   * La lecture des campagnes ferme la nuit, et elle ne demande aucun réglage : relier un
   * compte Google Ads est l'accord. Faire cocher une case de plus après avoir traversé
   * l'écran de consentement de Google reviendrait à demander deux fois la même chose, et la
   * seconde serait celle qu'on oublie — le compte resterait relié, la page resterait vide,
   * et la panne serait cherchée du côté de Google.
   *
   * Elle est gratuite : ce sont des lectures, aucun crédit, aucun appel à un modèle. À
   * blanc, on ne la fait pas — elle écrit en base, et une sonde ne doit rien écrire.
   */
  if (!sansRedaction) {
    const publicite = await synchroniserTous().catch(() => null)
    if (publicite !== null) {
      bilan.comptesAds = publicite.comptes
      bilan.echecsAds += publicite.echecs
    }

    /*
     * Meta suit la même tournée, dans le même bilan. Les deux plateformes ne se distinguent
     * pas ici : un compte publicitaire lu est un compte publicitaire lu, et séparer les
     * compteurs ferait croire à deux mécaniques là où il n'y en a qu'une.
     */
    const meta = await synchroniserTousMeta().catch(() => null)
    if (meta !== null) {
      bilan.comptesAds += meta.comptes
      bilan.echecsAds += meta.echecs
    }

    /*
     * Les règles passent après la lecture, sur les chiffres qui viennent d'être écrits.
     * Gratuites aussi : ni requête chez Google, ni crédit, ni modèle. C'est ce qui permet
     * de les passer chaque nuit pour tout le monde sans que la nuit coûte quelque chose.
     */
    /*
     * Le créatif se relit une fois par semaine, pas chaque nuit : les dépenses changent tous
     * les jours, les titres d'une annonce changent une fois par trimestre. Le filtre de
     * fraîcheur est dans la tournée elle-même — sans lui, trois appels de plus par compte et
     * par nuit sur un plafond partagé pour apprendre chaque fois la même chose.
     */
    const creatif = await synchroniserCreatifs().catch(() => null)
    if (creatif !== null) {
      bilan.creatifsAds = creatif.comptes
      bilan.echecsAds += creatif.echecs
    }

    const regles = await evaluerTous().catch(() => null)
    if (regles !== null) {
      bilan.recommandationsAds = regles.ouvertes
      bilan.echecsAds += regles.echecs
    }

    /*
     * Celles de MIRA, dans le même compteur et pour la même raison que la lecture : un
     * constat publicitaire est un constat publicitaire. Elles passent après la tournée Meta,
     * sur les chiffres qui viennent d'être écrits, et ne coûtent rien de plus.
     */
    const reglesMeta = await evaluerTousMeta().catch(() => null)
    if (reglesMeta !== null) {
      bilan.recommandationsAds += reglesMeta.ouvertes
      bilan.echecsAds += reglesMeta.echecs
    }

    /*
     * Le relevé des connecteurs, pour l'exploitant. Il passe chez chaque utilisateur parce
     * que ces tables sont cloisonnées et qu'on ne contourne pas le cloisonnement : c'est le
     * seul endroit du produit où l'on traverse tout le monde, et la nuit est le bon moment.
     *
     * Son échec n'est pas une panne de la nuit : personne n'attend ce chiffre à la minute.
     */
    await recompterConnecteurs().catch(() => null)
  }

  logger.info('automatisation quotidienne passée', { ...bilan })
  return bilan
}
