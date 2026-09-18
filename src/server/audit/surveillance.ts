import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { notify } from '@/server/notifications/service'
import { isEnabled } from '@/server/settings/flags'
import { visiter, type PageExploree } from './crawler'
import type { Signaux } from './extract'

/**
 * La surveillance de ce qui casse.
 *
 * Un audit est une photographie : il dit l'état d'un site le jour où on l'a pris. Or les
 * pannes qui coûtent le plus cher ne se voient pas le jour où elles arrivent. Un thème qui
 * pousse une balise « noindex », un robots.txt qui se referme, un hébergeur qui tombe : le
 * site continue de s'afficher pour son propriétaire, et disparaît des moteurs pendant des
 * mois. C'est la panne la plus chère du métier, et la seule qu'on ne découvre jamais
 * soi-même.
 *
 * Quatre décisions portent ce module.
 *
 * **L'audit dit ce qui est, la surveillance dit ce qui a changé.** Un site sans description
 * depuis toujours, c'est un constat d'audit et une ligne du plan d'action ; une description
 * qui disparaît cette semaine, c'est une alerte. Sans cette règle, les deux écrans
 * répéteraient la même chose et l'on cesserait de lire les deux.
 *
 * **Un constat s'ouvre et se ferme, il ne se répète pas.** Un site en panne six semaines
 * produirait sinon six lignes identiques, et l'écran dirait « six problèmes » là où il y en
 * a un depuis six semaines — ce qui est une autre façon de mentir.
 *
 * **Le coût est borné avant d'être engagé.** Cinq pages et un robots.txt par site et par
 * semaine, quel que soit le nombre de pages du site. C'est la seule fonction du produit qui
 * consomme du réseau à la charge d'Evoliia sans qu'une personne l'ait demandé à cet instant :
 * elle doit donc coûter un nombre de requêtes qui se calcule d'avance, et non un nombre qui
 * grandit avec les sites de chacun.
 *
 * **Aucun crédit n'est débité.** Rien ici n'appelle un modèle. C'est du comptage, comme
 * l'audit, et ce qui se compte ne se paie pas.
 */

/** Pages contrôlées par site. L'accueil et les plus proches de lui. */
export const PAGES_SURVEILLEES = 5

/** Temps accordé à un site. Cinq pages et un robots.txt tiennent largement dedans. */
const BUDGET_SITE_MS = 25_000

/** On ne recontrôle pas un site plus d'une fois par semaine. */
export const JOURS_ENTRE_CONTROLES = 7

/** Sites examinés par appel du planificateur, faute de borne explicite. */
const SITES_PAR_PASSAGE = 50

/**
 * Les contrôles, et ce que chacun coûte à la personne qui l'ignore.
 *
 * La liste est courte et le restera : une surveillance qui signale quinze choses par semaine
 * ne se lit plus, et le jour où le site tombe vraiment, l'alerte se perd dans les autres.
 */
export const CONTROLES: Record<string, { label: string; why: string }> = {
  'watch.unreachable': {
    label: 'Votre site ne répond plus',
    why: "Ni vos visiteurs ni les moteurs n'y accèdent. C'est la panne la plus coûteuse, et elle passe souvent inaperçue plusieurs jours.",
  },
  'watch.robots_blocks': {
    label: 'Votre site interdit son exploration',
    why: 'Le fichier robots.txt refuse désormais les moteurs. Vos pages sortiront des résultats dans les semaines qui viennent.',
  },
  'watch.offsite_redirect': {
    label: 'Votre accueil renvoie vers un autre domaine',
    why: "Souvent le signe d'un domaine expiré ou détourné. Ce que vos visiteurs voient n'est plus votre site.",
  },
  'watch.noindex': {
    label: 'Une page demande à être désindexée',
    why: 'Une balise « noindex » est apparue depuis la dernière analyse. La page va disparaître des résultats, sans que rien ne le montre sur le site.',
  },
  'watch.title_missing': {
    label: 'Un titre de page a disparu',
    why: "La page avait un titre à la dernière analyse, elle n'en a plus. C'est la première chose qu'un moteur affiche.",
  },
  'watch.description_missing': {
    label: 'Une description de page a disparu',
    why: "La page avait une description à la dernière analyse, elle n'en a plus. Le moteur en fabriquera une, rarement à votre avantage.",
  },
}

/** Un défaut constaté pendant un passage. */
type Constat = { checkId: string; url: string; detail: string }

/** Ce qu'une page était à la dernière analyse. Sert à distinguer un manque d'une perte. */
export type Reference = {
  url: string
  avaitTitre: boolean
  avaitDescription: boolean
  etaitNoindex: boolean
}

function noindex(robotsMeta: string): boolean {
  return /\bnoindex\b/i.test(robotsMeta)
}

/** La clef d'un constat : un défaut est le même quand il porte sur la même adresse. */
function clef(constat: { checkId: string; url: string }): string {
  return `${constat.checkId}::${constat.url}`
}

/**
 * Ce qu'on contrôle sur un site, tiré de sa dernière analyse terminée.
 *
 * Sans analyse, pas de surveillance : il n'y a rien à quoi comparer, et contrôler l'accueil
 * seul dirait à quelqu'un qui n'a jamais lancé d'analyse que tout va bien — ce qu'on ne sait
 * pas.
 */
async function reperes(userId: string, siteId: string): Promise<Reference[]> {
  const audit = await withUserScope(userId, (tx) =>
    tx.audit.findFirst({
      where: { siteId, userId, status: 'done' },
      orderBy: { finishedAt: 'desc' },
      select: { id: true },
    }),
  )
  if (audit === null) return []

  const pages = await withUserScope(userId, (tx) =>
    tx.auditPage.findMany({
      where: { auditId: audit.id, statusCode: { gte: 200, lt: 300 } },
      orderBy: [{ depth: 'asc' }, { path: 'asc' }],
      take: PAGES_SURVEILLEES,
      select: { url: true, title: true, description: true, signals: true },
    }),
  )

  return pages.map((page) => {
    const signaux = page.signals as unknown as Signaux | null
    return {
      url: page.url,
      avaitTitre: page.title.trim() !== '',
      avaitDescription: page.description.trim() !== '',
      etaitNoindex: noindex(signaux?.robotsMeta ?? ''),
    }
  })
}

/** Les constats d'un passage, sans rien écrire. Séparé pour être vérifiable sans base. */
export function comparer(
  reference: readonly Reference[],
  vues: readonly PageExploree[],
  origin: string,
): Constat[] {
  const constats: Constat[] = []
  const parUrl = new Map(vues.map((page) => [page.url, page]))

  for (const repere of reference) {
    const page = parUrl.get(repere.url)
    if (page === undefined) continue

    /*
     * L'accueil qui déclare appartenir à un autre domaine est traité à part : c'est le seul
     * cas où la page répond parfaitement tout en n'étant plus la bonne.
     */
    if (repere.url === origin || repere.url === `${origin}/`) {
      const declare = page.signals.canonical
      if (declare !== '' && !declare.startsWith(origin)) {
        constats.push({
          checkId: 'watch.offsite_redirect',
          url: page.url,
          detail: `L’accueil déclare appartenir à ${declare}.`,
        })
      }
    }

    // Ce qui suit ne se déclenche que sur une perte : un manque de toujours est un constat
    // d'audit, pas une alerte.
    if (!repere.etaitNoindex && noindex(page.signals.robotsMeta)) {
      constats.push({ checkId: 'watch.noindex', url: page.url, detail: page.path })
    }
    if (repere.avaitTitre && page.signals.title.trim() === '') {
      constats.push({ checkId: 'watch.title_missing', url: page.url, detail: page.path })
    }
    if (repere.avaitDescription && page.signals.description.trim() === '') {
      constats.push({ checkId: 'watch.description_missing', url: page.url, detail: page.path })
    }
  }

  return constats
}

export type PassageSite = { constats: number; ouverts: number; fermes: number }

/**
 * Contrôle un site et met ses constats à jour.
 *
 * Ne lève pas sur un site injoignable : c'est précisément ce qu'on cherche à détecter. Seule
 * une erreur inattendue remonte, et le planificateur la note sans arrêter les autres sites.
 */
export async function surveillerSite(userId: string, siteId: string): Promise<PassageSite> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { id: true, origin: true, host: true, label: true },
    }),
  )
  if (site === null) return { constats: 0, ouverts: 0, fermes: 0 }

  const reference = await reperes(userId, siteId)
  if (reference.length === 0) {
    logger.info('surveillance sans repère : site jamais analysé', { siteId })
    return { constats: 0, ouverts: 0, fermes: 0 }
  }

  const constats: Constat[] = []

  const passage = await visiter(
    site.origin,
    reference.map((repere) => ({ url: repere.url, depth: 0 })),
    { budgetMs: BUDGET_SITE_MS },
  )

  /*
   * `visiter` lit robots.txt une fois et écarte ce qu'il interdit. Une page écartée pour
   * cette raison est donc le signe que le fichier s'est refermé depuis l'analyse.
   */
  if (passage.skipped.some((ecartee) => ecartee.reason === 'robots')) {
    constats.push({
      checkId: 'watch.robots_blocks',
      url: site.origin,
      detail: `Le fichier robots.txt de ${site.host} refuse désormais des pages qu’il autorisait.`,
    })
  }

  const lisibles = passage.pages.filter((page) => page.statusCode >= 200 && page.statusCode < 300)
  if (lisibles.length === 0 && constats.length === 0) {
    constats.push({
      checkId: 'watch.unreachable',
      url: site.origin,
      detail: `Aucune des ${reference.length} pages contrôlées n’a répondu correctement.`,
    })
  } else {
    constats.push(...comparer(reference, lisibles, site.origin))
  }

  const { ouverts, fermes } = await enregistrer(userId, siteId, constats)

  await withUserScope(userId, (tx) =>
    tx.site.update({ where: { id: siteId }, data: { watchedAt: new Date() } }),
  )

  if (ouverts > 0) {
    const premier = constats[0]?.checkId ?? ''
    await notify(userId, {
      kind: 'site_watch',
      title: `${site.label} : ${ouverts} ${ouverts > 1 ? 'problèmes repérés' : 'problème repéré'}`,
      body: CONTROLES[premier]?.label ?? 'Voyez le détail sur votre tableau de bord.',
      href: `/fr/visibilite?siteId=${siteId}`,
    }).catch(() => undefined)
  }

  logger.info('site surveillé', { siteId, constats: constats.length, ouverts, fermes })
  return { constats: constats.length, ouverts, fermes }
}

/** Ouvre ce qui est nouveau, ferme ce qui a disparu. */
async function enregistrer(
  userId: string,
  siteId: string,
  constats: readonly Constat[],
): Promise<{ ouverts: number; fermes: number }> {
  return withUserScope(userId, async (tx) => {
    const avant = await tx.siteWatch.findMany({
      where: { siteId, userId, closedAt: null },
      select: { id: true, checkId: true, url: true },
    })
    const connus = new Set(avant.map(clef))
    const maintenant = new Set(constats.map(clef))

    let ouverts = 0
    for (const constat of constats) {
      if (connus.has(clef(constat))) continue
      await tx.siteWatch.create({
        data: { siteId, userId, checkId: constat.checkId, url: constat.url, detail: constat.detail },
      })
      ouverts += 1
    }

    const aFermer = avant.filter((ligne) => !maintenant.has(clef(ligne))).map((ligne) => ligne.id)
    if (aFermer.length > 0) {
      await tx.siteWatch.updateMany({
        where: { id: { in: aFermer } },
        data: { closedAt: new Date() },
      })
    }

    return { ouverts, fermes: aFermer.length }
  })
}

export type ConstatVu = {
  checkId: string
  label: string
  why: string
  url: string
  detail: string
  openedAt: Date
}

/** Ce qui est cassé en ce moment sur un site. Gratuit à relire, autant de fois qu'on veut. */
export async function listWatches(userId: string, siteId: string): Promise<ConstatVu[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.siteWatch.findMany({
      where: { siteId, userId, closedAt: null },
      orderBy: { openedAt: 'asc' },
      select: { checkId: true, url: true, detail: true, openedAt: true },
    }),
  )

  const vus: ConstatVu[] = []
  for (const ligne of lignes) {
    const controle = CONTROLES[ligne.checkId]
    if (controle === undefined) continue
    vus.push({ ...ligne, label: controle.label, why: controle.why })
  }
  return vus
}

export type PassageSurveillance = {
  examines: number
  controles: number
  ouverts: number
  ecartes: Array<{ siteId: string; raison: string }>
}

/**
 * Le passage du planificateur.
 *
 * Trois verrous, tous fermés par défaut : le drapeau `surveillance`, le jeton du
 * planificateur (sans lui la route n'existe pas), et le délai d'une semaine entre deux
 * contrôles d'un même site. Le nombre de sites examinés par appel est borné : un
 * planificateur qui appellerait dix fois ne coûterait pas dix fois plus.
 */
export async function runScheduledWatch(
  options: { limit?: number } = {},
): Promise<PassageSurveillance> {
  const passage: PassageSurveillance = { examines: 0, controles: 0, ouverts: 0, ecartes: [] }

  if (!(await isEnabled('surveillance'))) {
    logger.info('surveillance : drapeau fermé, rien à faire')
    return passage
  }

  const depuis = new Date(Date.now() - JOURS_ENTRE_CONTROLES * 24 * 60 * 60 * 1000)
  /*
   * Les sites sont cloisonnés : cette lecture ne sert qu'à savoir lesquels contrôler et pour
   * qui. Tout ce qui suit repasse par la portée de leur propriétaire.
   */
  const candidats = await prisma.site.findMany({
    where: {
      deletedAt: null,
      OR: [{ watchedAt: null }, { watchedAt: { lt: depuis } }],
      user: { disabledAt: null },
    },
    select: { id: true, userId: true },
    orderBy: [{ watchedAt: 'asc' }, { createdAt: 'asc' }],
    take: options.limit ?? SITES_PAR_PASSAGE,
  })

  for (const site of candidats) {
    passage.examines += 1
    try {
      const resultat = await surveillerSite(site.userId, site.id)
      passage.controles += 1
      passage.ouverts += resultat.ouverts
    } catch (error) {
      passage.ecartes.push({
        siteId: site.id,
        raison: error instanceof Error ? error.name : 'inconnue',
      })
    }
  }

  logger.info('surveillance passée', {
    examines: passage.examines,
    controles: passage.controles,
    ouverts: passage.ouverts,
  })
  return passage
}
