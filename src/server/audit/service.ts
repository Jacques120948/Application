import { AppError, notFound, validation } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { getEffectivePlan } from '@/server/billing/plans'
import { logger } from '@/server/observability/logger'
import { crawl, normalizeUrl, type PageExploree } from './crawler'
import { parseTargetUrl } from './net'
import { evaluateAll, findCheck } from './scoring'
import type { PageVue, SiteVu } from './checks/types'
import type { Signaux } from './extract'

/**
 * Sites suivis et audits.
 *
 * Trois décisions valent d'être expliquées, parce qu'elles décident de la forme du reste.
 *
 * **Un audit avance par tranches.** Cinquante pages visitées une par une, avec le délai de
 * politesse dû au serveur d'en face, demandent une à trois minutes. Aucune plateforme
 * n'accorde ça à une requête, et un travail de fond lancé sans attendre est tué avec la
 * réponse chez la plupart des hébergeurs. On avance donc par paquets : chaque appel visite
 * quelques pages, les enregistre, et rend la main. L'écran rappelle, et montre en même temps
 * où l'on en est — ce qui vaut mieux qu'un sablier de trois minutes.
 *
 * **La reprise ne stocke aucun état.** Ce qui reste à visiter se déduit de ce qui a déjà été
 * enregistré : les liens relevés dans les pages connues, moins les pages déjà visitées. Un
 * état de file séparé aurait fallu le garder juste, le migrer, et le réparer quand il ment.
 * Ici il n'existe pas.
 *
 * **Les bornes viennent de l'offre, et sont figées dans l'audit.** Un audit dit ce qu'il a
 * appliqué au moment où il a tourné ; changer d'offre ensuite ne réécrit pas l'histoire.
 */

/** Pages visitées par appel. Assez pour avancer visiblement, assez peu pour rendre la main. */
export const PAGES_PAR_TRANCHE = 6

/** Temps accordé à une tranche. En dessous de la limite de toutes les plateformes connues. */
const BUDGET_TRANCHE_MS = 20_000

export type SiteResume = {
  id: string
  origin: string
  host: string
  label: string
  about: string
  updatedAt: Date
  dernierAudit: {
    id: string
    status: string
    pagesCrawled: number
    seoScore: number | null
    geoScore: number | null
    startedAt: Date
  } | null
}

/**
 * Enregistre un site à suivre.
 *
 * L'adresse passe par le même contrôle que le robot : protocole, domaine public, pas
 * d'identifiants. On n'en garde que l'origine — protocole et hôte — parce qu'un site se
 * suit dans son entier, et que `monsite.ch/boutique` et `monsite.ch` sont le même site.
 */
export async function addSite(
  userId: string,
  input: { url: string; label?: string; about?: string },
): Promise<{ siteId: string; host: string }> {
  const url = parseTargetUrl(input.url)
  const host = url.hostname.toLowerCase()
  const origin = `${url.protocol}//${host}`

  const plan = await getEffectivePlan(userId)
  const existant = await withUserScope(userId, (tx) =>
    tx.site.findFirst({ where: { userId, host, deletedAt: null }, select: { id: true } }),
  )
  if (existant !== null) return { siteId: existant.id, host }

  const suivis = await withUserScope(userId, (tx) =>
    tx.site.count({ where: { userId, deletedAt: null } }),
  )
  if (suivis >= plan.sitesMax) {
    throw new AppError(
      'PLAN_LIMIT',
      plan.sitesMax === 0
        ? "Votre offre ne permet pas encore de suivre un site."
        : `Votre offre suit ${plan.sitesMax} site${plan.sitesMax > 1 ? 's' : ''}. Changez d'offre pour en ajouter un autre.`,
    )
  }

  const site = await withUserScope(userId, (tx) =>
    tx.site.create({
      data: {
        userId,
        origin,
        host,
        label: (input.label ?? host).slice(0, 120),
        about: (input.about ?? '').slice(0, 500),
      },
      select: { id: true },
    }),
  )
  logger.info('site ajouté', { userId, host })
  return { siteId: site.id, host }
}

/** Les sites d'une personne, avec l'état de leur dernier audit. */
export async function listSites(userId: string): Promise<SiteResume[]> {
  const sites = await withUserScope(userId, (tx) =>
    tx.site.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        origin: true,
        host: true,
        label: true,
        about: true,
        updatedAt: true,
        audits: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            pagesCrawled: true,
            seoScore: true,
            geoScore: true,
            startedAt: true,
          },
        },
      },
    }),
  )
  return sites.map((site) => ({
    id: site.id,
    origin: site.origin,
    host: site.host,
    label: site.label,
    about: site.about,
    updatedAt: site.updatedAt,
    dernierAudit: site.audits[0] ?? null,
  }))
}

/** Le mois en cours, celui du renouvellement des crédits, comme partout ailleurs. */
function debutDuMois(): Date {
  const maintenant = new Date()
  return new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1))
}

/**
 * Ouvre un audit.
 *
 * Il démarre vide, à l'état « en attente ». Rien n'est visité ici : c'est l'avancement par
 * tranches qui travaille, et il faut que l'écran existe avant que le travail commence, sans
 * quoi personne ne voit rien pendant une minute.
 */
export async function startAudit(userId: string, siteId: string): Promise<{ auditId: string }> {
  const plan = await getEffectivePlan(userId)
  if (plan.auditsPerMonth <= 0) {
    throw new AppError('PLAN_LIMIT', "Votre offre ne comprend pas d'audit.")
  }

  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({ where: { id: siteId, userId, deletedAt: null }, select: { id: true } }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  /*
   * La reprise passe avant le quota, et l'ordre inverse était un piège.
   *
   * Un audit déjà en cours a été compté au moment où il a été ouvert. Vérifier le quota
   * d'abord revenait à le compter une seconde fois : quelqu'un au plafond de son offre dont
   * l'analyse s'était interrompue — un onglet fermé suffit — se voyait refuser sa propre
   * reprise, et perdait l'audit qu'il avait déjà payé. Reprendre n'est pas commencer.
   */
  const enCours = await withUserScope(userId, (tx) =>
    tx.audit.findFirst({
      where: { siteId, userId, status: { in: ['pending', 'running'] } },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    }),
  )
  // Deux explorations simultanées du même site, ce serait deux fois la charge chez le
  // client pour rien.
  if (enCours !== null) return { auditId: enCours.id }

  const dejaFaits = await withUserScope(userId, (tx) =>
    tx.audit.count({ where: { userId, startedAt: { gte: debutDuMois() } } }),
  )
  if (dejaFaits >= plan.auditsPerMonth) {
    throw new AppError(
      'PLAN_LIMIT',
      `Votre offre comprend ${plan.auditsPerMonth} audit${plan.auditsPerMonth > 1 ? 's' : ''} par mois. Le compteur repart au début du mois prochain.`,
    )
  }

  const audit = await withUserScope(userId, (tx) =>
    tx.audit.create({
      data: {
        siteId,
        userId,
        status: 'pending',
        trigger: 'manual',
        maxPages: plan.pagesPerAudit,
        maxDepth: 3,
      },
      select: { id: true },
    }),
  )
  logger.info('audit ouvert', { userId, siteId })
  return { auditId: audit.id }
}

export type AvancementAudit = {
  auditId: string
  status: string
  pagesCrawled: number
  pagesSkipped: number
  maxPages: number
  /** Vrai tant qu'il reste du travail : l'écran rappelle. */
  encore: boolean
}

/** Ce qui reste à visiter, déduit de ce qui a déjà été enregistré. */
function frontiere(
  pages: readonly { url: string; depth: number; signals: unknown }[],
  origin: string,
  maxDepth: number,
): { url: string; depth: number }[] {
  const vues = new Set(pages.map((page) => page.url))
  const suite: { url: string; depth: number }[] = []
  for (const page of pages) {
    if (page.depth >= maxDepth) continue
    const signaux = page.signals as Signaux | null
    for (const lien of signaux?.links ?? []) {
      if (!lien.interne || lien.url === '') continue
      const normalisee = normalizeUrl(lien.url)
      if (normalisee === null || vues.has(normalisee)) continue
      if (!normalisee.startsWith(origin)) continue
      vues.add(normalisee)
      suite.push({ url: normalisee, depth: page.depth + 1 })
    }
  }
  // En largeur : les pages proches de l'accueil d'abord, comme dans l'exploration initiale.
  return suite.sort((a, b) => a.depth - b.depth)
}

/**
 * Avance un audit d'une tranche.
 *
 * Appelée en boucle par l'écran jusqu'à ce qu'elle réponde qu'il n'y a plus rien à faire.
 * Chaque appel est indépendant : rien ne se perd si l'un échoue, il suffit de rappeler.
 */
/**
 * Termine un audit sur ce qui a déjà été exploré, et le note.
 *
 * Sert quand une tranche casse alors que des pages sont en base : mieux vaut un audit de
 * deux cent quatre-vingt-sept pages qu'aucun audit du tout. Le nombre de pages est recompté
 * plutôt que repris du compteur, qui pourrait avoir dérivé d'une tranche perdue.
 */
async function cloreAudit(
  userId: string,
  auditId: string,
  origin: string,
  ecartees: number,
): Promise<AvancementAudit> {
  const notes = await noterAudit(userId, auditId, origin)
  const total = await withUserScope(userId, (tx) => tx.auditPage.count({ where: { auditId } }))

  const apres = await withUserScope(userId, (tx) =>
    tx.audit.update({
      where: { id: auditId },
      data: {
        status: 'done',
        pagesCrawled: total,
        pagesSkipped: { increment: ecartees },
        finishedAt: new Date(),
        seoScore: notes?.seo ?? null,
        geoScore: notes?.geo ?? null,
        // L'audit est utilisable : le code d'échec n'a plus lieu d'être affiché.
        errorCode: null,
      },
      select: { status: true, pagesCrawled: true, pagesSkipped: true, maxPages: true },
    }),
  )
  return {
    auditId,
    status: apres.status,
    pagesCrawled: apres.pagesCrawled,
    pagesSkipped: apres.pagesSkipped,
    maxPages: apres.maxPages,
    encore: false,
  }
}

export async function advanceAudit(userId: string, auditId: string): Promise<AvancementAudit> {
  const audit = await withUserScope(userId, (tx) =>
    tx.audit.findFirst({
      where: { id: auditId, userId },
      select: {
        id: true,
        status: true,
        maxPages: true,
        maxDepth: true,
        pagesCrawled: true,
        pagesSkipped: true,
        site: { select: { origin: true } },
      },
    }),
  )
  if (audit === null) throw notFound('Cet audit est introuvable.')
  /*
   * Un audit terminé ne se rouvre pas. Un audit échoué qui porte des pages, si : il a été
   * clos par une erreur passagère alors que l'essentiel du travail était fait, et il n'y a
   * aucune raison de le refaire depuis le début. Celui qui n'a rien lu, lui, reste échoué.
   */
  const recuperable = audit.status === 'failed' && audit.pagesCrawled > 0
  /*
   * Un audit échoué qui porte des pages se termine tout de suite, sur ce qu'il a. Il ne
   * repart pas explorer : la personne a demandé à le terminer, et l'écran le lui a promis en
   * ces mots. Reprendre une exploration d'une heure sous un bouton qui dit « terminer »
   * serait une façon de ne pas tenir parole. Qui veut un audit plus complet en relance un.
   */
  if (recuperable) {
    logger.info('audit échoué rattrapé sur ses pages', { auditId, pages: audit.pagesCrawled })
    return cloreAudit(userId, auditId, audit.site.origin, 0)
  }
  if (audit.status === 'done' || audit.status === 'failed') {
    return {
      auditId,
      status: audit.status,
      pagesCrawled: audit.pagesCrawled,
      pagesSkipped: audit.pagesSkipped,
      maxPages: audit.maxPages,
      encore: false,
    }
  }

  const connues = await withUserScope(userId, (tx) =>
    tx.auditPage.findMany({
      where: { auditId },
      select: { url: true, depth: true, signals: true },
    }),
  )

  const origin = audit.site.origin
  let signauxDuSite: SiteVu | null = null
  let visitees: PageExploree[] = []
  let ecartees = 0
  let termine = false

  try {
    if (connues.length === 0) {
      /*
       * Première tranche : on part de l'accueil, ce qui lit aussi `robots.txt` et la carte
       * du site. Les adresses trouvées là ne sont pas gardées en mémoire — la tranche
       * suivante les retrouvera par les liens de l'accueil. C'est un peu moins complet
       * qu'une exploration d'un seul tenant, et c'est le prix de la reprise sans état.
       */
      const exploration = await crawl(origin, {
        maxPages: Math.min(PAGES_PAR_TRANCHE, audit.maxPages),
        maxDepth: audit.maxDepth,
        budgetMs: BUDGET_TRANCHE_MS,
      })
      visitees = exploration.pages
      ecartees = exploration.skipped.length
      /*
       * Ce qui ne s'observe qu'ici : robots.txt et carte du site ne sont lus qu'à la
       * première tranche, et les contrôles tournent à la dernière. Sans cette mise de côté,
       * l'information serait perdue entre les deux.
       */
      signauxDuSite = {
        origin,
        robotsFound: exploration.robots.found,
        robotsBlocksHome: exploration.robots.blocksHome,
        sitemapFound: exploration.sitemapFound,
      }

      /*
       * L'accueil doit répondre correctement, sinon il n'y a pas d'audit.
       *
       * Un serveur qui répond « interdit » ou « introuvable » rend tout de même une page, et
       * cette page a un titre, des octets, parfois des liens. Sans ce contrôle, l'audit
       * l'enregistrerait et s'annoncerait terminé — une page relevée, aucun problème trouvé —
       * pour un site qu'il n'a jamais lu. C'est la pire réponse possible : elle est fausse et
       * elle a l'air d'un succès.
       */
      const accueil = exploration.pages[0]
      if (accueil !== undefined && (accueil.statusCode < 200 || accueil.statusCode >= 300)) {
        throw validation(
          `Ce site répond « ${accueil.statusCode} » à sa page d'accueil : nous n'avons rien pu lire. ` +
            `Vérifiez l'adresse, ou qu'il n'est pas protégé par un mot de passe.`,
        )
      }
      if (exploration.robots.blocksHome) {
        throw validation(
          "Le fichier robots.txt de ce site interdit son exploration. Autorisez EvoliiaBot, ou analysez un autre site.",
        )
      }
    } else {
      const restantes = frontiere(connues, origin, audit.maxDepth)
      const place = audit.maxPages - connues.length
      if (restantes.length === 0 || place <= 0) {
        termine = true
      } else {
        const fin = Date.now() + BUDGET_TRANCHE_MS
        for (const cible of restantes.slice(0, Math.min(PAGES_PAR_TRANCHE, place))) {
          if (Date.now() > fin) break
          const exploration = await crawl(cible.url, { maxPages: 1, maxDepth: 0, budgetMs: 8_000 })
          const page = exploration.pages[0]
          if (page === undefined) {
            ecartees += 1
            continue
          }
          // La profondeur vient de la page qui a mené ici, pas de l'exploration d'une page
          // isolée, qui croit toujours être à la racine.
          visitees.push({ ...page, url: cible.url, depth: cible.depth })
        }
        if (visitees.length === 0 && ecartees === 0) termine = true
      }
    }
  } catch (error) {
    const code = error instanceof AppError ? error.code : 'CRAWL_FAILED'
    /*
     * Une tranche qui casse ne doit pas emporter tout ce qui précède.
     *
     * La première version marquait l'audit « échoué » sur n'importe quelle exception. Le cas
     * s'est produit sur un vrai site : deux cent quatre-vingt-sept pages explorées en une
     * heure, une erreur à la suivante, et tout était jeté — pas de note, pas de constats,
     * rien à reprendre. L'erreur était probablement passagère ; le travail, lui, ne l'était
     * pas.
     *
     * Deux cent quatre-vingt-sept pages font un excellent audit. On le termine donc avec ce
     * qu'on a, et on le note. Seul un site dont rien n'a pu être lu échoue vraiment : là, il
     * n'y a effectivement rien à sauver, et le dire est la seule réponse juste.
     */
    if (connues.length > 0) {
      logger.warn('tranche interrompue : audit clos sur ce qui a été exploré', {
        auditId,
        code,
        pages: connues.length,
        reason: error instanceof Error ? error.message.slice(0, 200) : 'inconnue',
      })
      return cloreAudit(userId, auditId, origin, ecartees)
    }

    await withUserScope(userId, (tx) =>
      tx.audit.update({
        where: { id: auditId },
        data: { status: 'failed', errorCode: code, finishedAt: new Date() },
      }),
    )
    logger.warn('audit interrompu', { auditId, code })
    throw error instanceof AppError
      ? error
      : validation("Ce site n'a pas pu être analysé. Vérifiez l'adresse et réessayez.")
  }

  await withUserScope(userId, async (tx) => {
    for (const page of visitees) {
      await tx.auditPage.upsert({
        where: { auditId_url: { auditId, url: page.url } },
        update: {},
        create: {
          auditId,
          url: page.url,
          path: page.path,
          depth: page.depth,
          statusCode: page.statusCode,
          bytes: page.bytes,
          fetchMs: page.fetchMs,
          redirects: page.redirects,
          title: page.signals.title.slice(0, 300),
          description: page.signals.description.slice(0, 500),
          wordCount: page.signals.wordCount,
          signals: page.signals as unknown as object,
        },
      })
    }
  })

  const total = await withUserScope(userId, (tx) => tx.auditPage.count({ where: { auditId } }))
  const fini = termine || total >= audit.maxPages

  if (signauxDuSite !== null) {
    await withUserScope(userId, (tx) =>
      tx.audit.update({
        where: { id: auditId },
        data: { siteSignals: signauxDuSite as unknown as object },
      }),
    )
  }

  // Les contrôles ne tournent qu'une fois, à la fin : ils comparent les pages entre elles,
  // et un verdict rendu sur un site à moitié exploré serait faux plutôt qu'incomplet.
  const notes = fini ? await noterAudit(userId, auditId, audit.site.origin) : null

  const apres = await withUserScope(userId, (tx) =>
    tx.audit.update({
      where: { id: auditId },
      data: {
        status: fini ? 'done' : 'running',
        pagesCrawled: total,
        pagesSkipped: { increment: ecartees },
        ...(fini
          ? { finishedAt: new Date(), seoScore: notes?.seo ?? null, geoScore: notes?.geo ?? null }
          : {}),
      },
      select: { status: true, pagesCrawled: true, pagesSkipped: true, maxPages: true },
    }),
  )

  return {
    auditId,
    status: apres.status,
    pagesCrawled: apres.pagesCrawled,
    pagesSkipped: apres.pagesSkipped,
    maxPages: apres.maxPages,
    encore: !fini,
  }
}

/**
 * Les constats d'un audit, du plus coûteux au moins.
 *
 * Le libellé et l'explication ne sont pas en base : ils vivent dans le catalogue des
 * contrôles, et c'est voulu. Les réécrire ne doit pas demander de migrer des milliers de
 * lignes, ni laisser d'anciens audits porter d'anciennes formulations.
 */
export async function listFindings(userId: string, auditId: string) {
  const constats = await withUserScope(userId, (tx) =>
    tx.auditFinding.findMany({
      where: { auditId, audit: { userId } },
      orderBy: [{ lost: 'desc' }, { weight: 'desc' }],
    }),
  )
  return constats.map((constat) => {
    const check = findCheck(constat.checkId)
    return {
      checkId: constat.checkId,
      /*
       * Le moteur vient du constat enregistré plutôt que du catalogue : c'est lui qui permet
       * à l'écran de séparer les deux notes, et il doit rester lisible même si un contrôle
       * disparaît du catalogue entre deux versions.
       */
      engine: constat.engine,
      label: check?.label ?? constat.checkId,
      why: check?.why ?? '',
      /*
       * La portée accompagne le constat : « une page sur une » n'a aucun sens pour un
       * contrôle qui porte sur le site entier — le plan de site, le protocole — et l'écran
       * doit pouvoir se taire plutôt que d'inventer un dénominateur.
       */
      scope: check?.scope ?? 'page',
      severity: constat.severity,
      affected: constat.affected,
      examined: constat.examined,
      lost: constat.lost,
      sample: (constat.sample as unknown as { path: string; url: string; title: string }[]) ?? [],
    }
  })
}

/** Le détail d'un audit, pour l'écran qui le montre. */
export async function readAudit(userId: string, auditId: string) {
  const audit = await withUserScope(userId, (tx) =>
    tx.audit.findFirst({
      where: { id: auditId, userId },
      select: {
        id: true,
        status: true,
        pagesCrawled: true,
        pagesSkipped: true,
        maxPages: true,
        seoScore: true,
        geoScore: true,
        startedAt: true,
        finishedAt: true,
        site: { select: { id: true, host: true, label: true } },
        pages: {
          orderBy: [{ depth: 'asc' }, { path: 'asc' }],
          take: 100,
          select: {
            url: true,
            path: true,
            depth: true,
            statusCode: true,
            title: true,
            description: true,
            wordCount: true,
          },
        },
      },
    }),
  )
  if (audit === null) throw notFound('Cet audit est introuvable.')
  return audit
}

/**
 * Applique les contrôles à un audit terminé, enregistre les constats, rend la note.
 *
 * Elle relit les pages depuis la base plutôt que de garder tout en mémoire d'une tranche à
 * l'autre : c'est la seule façon de juger un site complet quand son exploration s'est faite
 * en dix appels séparés.
 */
async function noterAudit(
  userId: string,
  auditId: string,
  origin: string,
): Promise<{ seo: number; geo: number } | null> {
  const audit = await withUserScope(userId, (tx) =>
    tx.audit.findFirst({
      where: { id: auditId, userId },
      select: {
        siteSignals: true,
        pages: {
          select: {
            url: true,
            path: true,
            depth: true,
            statusCode: true,
            bytes: true,
            fetchMs: true,
            redirects: true,
            signals: true,
          },
        },
      },
    }),
  )
  if (audit === null || audit.pages.length === 0) return null

  const pages: PageVue[] = audit.pages.map((page) => ({
    url: page.url,
    path: page.path,
    depth: page.depth,
    statusCode: page.statusCode,
    bytes: page.bytes,
    fetchMs: page.fetchMs,
    redirects: page.redirects,
    signals: page.signals as unknown as Signaux,
  }))

  /*
   * Sans signaux de site enregistrés — un audit d'une version antérieure, ou une première
   * tranche qui a échoué — on suppose ce qu'on ne peut pas vérifier plutôt que d'accuser :
   * un robots.txt absent serait un reproche que rien n'étaye.
   */
  const site = (audit.siteSignals as unknown as SiteVu | null) ?? {
    origin,
    robotsFound: true,
    robotsBlocksHome: false,
    sitemapFound: true,
  }

  const { seo, geo } = await evaluateAll(pages, site)
  const constats = [...seo.constats, ...geo.constats]

  await withUserScope(userId, async (tx) => {
    for (const constat of constats) {
      await tx.auditFinding.upsert({
        where: { auditId_checkId: { auditId, checkId: constat.checkId } },
        update: {
          severity: constat.severity,
          affected: constat.affected,
          examined: constat.examined,
          weight: constat.weight,
          lost: constat.lost,
          sample: constat.sample as unknown as object,
        },
        create: {
          auditId,
          checkId: constat.checkId,
          engine: constat.engine,
          severity: constat.severity,
          affected: constat.affected,
          examined: constat.examined,
          weight: constat.weight,
          lost: constat.lost,
          sample: constat.sample as unknown as object,
        },
      })
    }
  })

  logger.info('audit noté', { auditId, seo: seo.score, geo: geo.score, constats: constats.length })
  return { seo: seo.score, geo: geo.score }
}

/**
 * Tout ce que le tableau de bord montre, en une lecture.
 *
 * Trois partis pris, et chacun répond à une façon de rendre un tableau de bord inutile.
 *
 * **Deux notes, jamais une moyenne.** Le référencement et la visibilité dans les assistants
 * répondent à deux questions différentes, et un site est très souvent bon pour l'une et
 * mauvais pour l'autre. Les additionner effacerait exactement ce qu'il y a à voir.
 *
 * **L'écart plutôt que le chiffre seul.** « 69 sur 100 » ne dit pas si le travail de la
 * semaine a servi. « 69, soit quatre de plus que le 3 septembre » le dit, et c'est la seule
 * chose qui fasse revenir quelqu'un un mois plus tard.
 *
 * **Une seule requête par objet.** Le dernier audit, celui d'avant et l'historique se lisent
 * d'une même liste d'audits terminés : trois allers-retours pour trois chiffres coûteraient
 * plus que tout le reste de l'écran.
 */
export type TableauVisibilite = {
  site: { id: string; host: string; label: string; origin: string }
  audit: {
    id: string
    finishedAt: Date | null
    pagesCrawled: number
    pagesSkipped: number
    seoScore: number | null
    geoScore: number | null
  }
  /** L'audit terminé juste avant, s'il existe : c'est lui qui donne l'écart. */
  precedent: { finishedAt: Date | null; seoScore: number | null; geoScore: number | null } | null
  /** Les analyses terminées, de la plus ancienne à la plus récente. */
  historique: { finishedAt: Date | null; seoScore: number | null; geoScore: number | null }[]
  /** Les autres sites suivis, pour passer de l'un à l'autre. */
  autresSites: { id: string; host: string; label: string }[]
}

/** Au-delà, la courbe devient illisible et ne dit rien de plus qu'une tendance. */
const HISTORIQUE_MAX = 12

/**
 * Le tableau de bord d'un site, ou `null` si aucun site n'a encore été analysé jusqu'au bout.
 *
 * Sans `siteId`, on prend le site modifié le plus récemment : c'est celui qu'on vient
 * d'analyser, et donc celui qu'on est venu regarder.
 */
export async function readDashboard(
  userId: string,
  siteId?: string,
): Promise<TableauVisibilite | null> {
  const sites = await withUserScope(userId, (tx) =>
    tx.site.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, host: true, label: true, origin: true },
    }),
  )
  if (sites.length === 0) return null

  /*
   * Un identifiant venu de l'adresse est une demande, pas un droit : on le cherche parmi les
   * sites déjà filtrés par la portée. Ce qui n'y figure pas est simplement ignoré.
   */
  const site = (siteId === undefined ? undefined : sites.find((s) => s.id === siteId)) ?? sites[0]
  if (site === undefined) return null

  const audits = await withUserScope(userId, (tx) =>
    tx.audit.findMany({
      where: { siteId: site.id, userId, status: 'done' },
      orderBy: { finishedAt: 'desc' },
      take: HISTORIQUE_MAX,
      select: {
        id: true,
        finishedAt: true,
        pagesCrawled: true,
        pagesSkipped: true,
        seoScore: true,
        geoScore: true,
      },
    }),
  )
  const dernier = audits[0]
  if (dernier === undefined) return null

  return {
    site,
    audit: dernier,
    precedent: audits[1] ?? null,
    historique: audits
      .map(({ finishedAt, seoScore, geoScore }) => ({ finishedAt, seoScore, geoScore }))
      .reverse(),
    autresSites: sites
      .filter((autre) => autre.id !== site.id)
      .map(({ id, host, label }) => ({ id, host, label })),
  }
}
