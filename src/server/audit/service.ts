import { AppError, notFound, validation } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { getEffectivePlan } from '@/server/billing/plans'
import { logger } from '@/server/observability/logger'
import { crawl, normalizeUrl, type PageExploree } from './crawler'
import { parseTargetUrl } from './net'
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

  const dejaFaits = await withUserScope(userId, (tx) =>
    tx.audit.count({ where: { userId, startedAt: { gte: debutDuMois() } } }),
  )
  if (dejaFaits >= plan.auditsPerMonth) {
    throw new AppError(
      'PLAN_LIMIT',
      `Votre offre comprend ${plan.auditsPerMonth} audit${plan.auditsPerMonth > 1 ? 's' : ''} par mois. Le compteur repart au début du mois prochain.`,
    )
  }

  // Un audit déjà en cours sur ce site est repris plutôt que doublé : deux explorations
  // simultanées du même site, c'est deux fois la charge chez le client pour rien.
  const enCours = await withUserScope(userId, (tx) =>
    tx.audit.findFirst({
      where: { siteId, userId, status: { in: ['pending', 'running'] } },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    }),
  )
  if (enCours !== null) return { auditId: enCours.id }

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
  const apres = await withUserScope(userId, (tx) =>
    tx.audit.update({
      where: { id: auditId },
      data: {
        status: fini ? 'done' : 'running',
        pagesCrawled: total,
        pagesSkipped: { increment: ecartees },
        ...(fini ? { finishedAt: new Date() } : {}),
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
