import { notFound } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { useOAuthAccess } from '@/server/integrations/service'
import {
  inspecterUrl,
  listerProprietes,
  rafraichir,
  requetes,
} from '@/server/integrations/providers/google-search-console'
import { choisirPropriete, JOURS_LUS } from './recherches'

/**
 * Ce que Google a indexé, et ce qu'il ignore.
 *
 * C'est la question que tout le monde pose et que presque personne ne mesure : « est-ce que
 * mes pages sont dans Google ? ». Une page absente de l'index ne se classe nulle part, quel
 * que soit son contenu — et rien sur le site ne le montre.
 *
 * Quatre décisions.
 *
 * **Les suspectes se trouvent sans appeler personne.** Evoliia connaît déjà les pages du
 * site, parce qu'elle les a explorées, et elle lit déjà les pages que Google affiche. Les
 * premières moins les secondes, ce sont les candidates — et ce rapprochement est du
 * comptage. L'API n'est appelée que sur cette poignée, jamais sur le site entier.
 *
 * **Peu d'affichages ne veut pas dire pas indexée.** Une page peut être parfaitement
 * indexée et ne jamais sortir, faute de demande. C'est pour ça que la liste s'appelle
 * « suspectes » et non « absentes » : c'est Google qui tranche, page par page, et lui seul.
 *
 * **La vérification est un geste, pas un chargement.** Un écran qui interrogerait Google à
 * chaque ouverture brûlerait un quota qu'on ne connaît pas, pour quelqu'un qui passait par
 * là. La liste s'affiche gratuitement ; l'inspection se demande.
 *
 * **Rien n'est débité.** C'est du comptage et une lecture d'API gratuite, comme l'audit et
 * la surveillance. Ce qui se compte ne se paie pas.
 */

/** Ce qu'on inspecte en une fois. Borné parce que le quota de Google nous est inconnu. */
export const PAGES_INSPECTEES = 20

/** Au-delà, la liste des suspectes ne se lit plus et ne se traite plus. */
const SUSPECTES_MAX = 60

/**
 * Une adresse réduite à ce qui la rend unique.
 *
 * Sans cela, le rapprochement échoue sur des différences qui n'en sont pas : Evoliia relève
 * `https://cap-nature.ch/produits/`, Google rend `https://www.cap-nature.ch/produits`, et
 * deux fois la même page apparaîtrait comme une page jamais vue. Google lui-même ne s'est
 * pas privé de nous le montrer, en retenant l'accueil sans barre finale quand la page en
 * déclare une.
 */
export function clefUrl(adresse: string): string {
  try {
    const url = new URL(adresse)
    const hote = url.hostname.replace(/^www\./, '').toLowerCase()
    const chemin = url.pathname.replace(/\/+$/, '')
    return `${hote}${chemin}`
  } catch {
    return adresse.trim().toLowerCase()
  }
}

/**
 * Les pages du site que Google n'a jamais affichées.
 *
 * Les plus proches de l'accueil d'abord : ce sont celles qui comptent, et une page de
 * profondeur six qui ne sort pas est rarement une surprise.
 */
export function suspectes(
  duSite: readonly { url: string; path: string; depth: number }[],
  vuesParGoogle: readonly string[],
): { url: string; path: string; depth: number }[] {
  const vues = new Set(vuesParGoogle.map(clefUrl))
  return [...duSite]
    .filter((page) => !vues.has(clefUrl(page.url)))
    .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))
    .slice(0, SUSPECTES_MAX)
}

export type PageSuspecte = { url: string; path: string; depth: number }

export type VueIndexation = {
  site: { id: string; host: string; origin: string }
  /** La propriété Search Console retenue, ou `null` quand aucune ne correspond. */
  propriete: string | null
  /** Pages relevées par la dernière analyse. */
  explorees: number
  /** Pages que Google a affichées au moins une fois sur la période. */
  affichees: number
  suspectes: PageSuspecte[]
  jours: number
}

/**
 * L'état des lieux, gratuit : ce qu'Evoliia a vu, ce que Google affiche, et l'écart.
 *
 * Un seul appel à Google, pour la liste des pages affichées — le même que l'écran des
 * recherches. Le reste vient de la dernière analyse.
 */
export async function lireIndexation(userId: string, siteId: string): Promise<VueIndexation> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { id: true, host: true, origin: true },
    }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  const audit = await withUserScope(userId, (tx) =>
    tx.audit.findFirst({
      where: { siteId, userId, status: 'done' },
      orderBy: { finishedAt: 'desc' },
      select: { id: true },
    }),
  )
  const pages =
    audit === null
      ? []
      : await withUserScope(userId, (tx) =>
          tx.auditPage.findMany({
            where: { auditId: audit.id },
            orderBy: [{ depth: 'asc' }, { path: 'asc' }],
            select: { url: true, path: true, depth: true },
          }),
        )

  const acces = await useOAuthAccess(userId, 'google-search-console', rafraichir)
  if (!acces.ok) {
    return {
      site,
      propriete: null,
      explorees: pages.length,
      affichees: 0,
      suspectes: [],
      jours: JOURS_LUS,
    }
  }

  const proprietes = await listerProprietes(acces.accessToken)
  const propriete = proprietes.ok ? choisirPropriete(site.origin, proprietes.proprietes) : null
  if (propriete === null) {
    return {
      site,
      propriete: null,
      explorees: pages.length,
      affichees: 0,
      suspectes: [],
      jours: JOURS_LUS,
    }
  }

  const affichees = await requetes(acces.accessToken, propriete, 'page', JOURS_LUS)
  const vues = affichees.ok ? affichees.lignes.map((ligne) => ligne.cle) : []

  return {
    site,
    propriete,
    explorees: pages.length,
    affichees: vues.length,
    suspectes: suspectes(pages, vues),
    jours: JOURS_LUS,
  }
}

/** Ce que Google dit d'une page, traduit en ce qui se décide. */
export type EtatPage = {
  url: string
  /** `PASS`, `PARTIAL`, `FAIL` ou `NEUTRAL`, tel que Google le rend. */
  verdict: string
  /** Le motif, en français, tel que Google l'écrit. */
  etat: string
  /** Dernier passage du robot, ou `null` s'il n'est jamais venu. */
  vueLe: string | null
  robots: string
  /** L'adresse que Google a retenue, quand elle diffère de celle déclarée par la page. */
  canoniqueDivergent: string | null
  /** Le lien vers l'écran d'inspection de Google, pour aller plus loin. */
  lien: string | null
}

type Inspection = {
  inspectionResult?: {
    inspectionResultLink?: string
    indexStatusResult?: {
      verdict?: string
      coverageState?: string
      robotsTxtState?: string
      lastCrawlTime?: string
      googleCanonical?: string
      userCanonical?: string
    }
  }
}

/** Ce que rend l'inspection, y compris quand Google refuse. */
export type Inspecte =
  | { ok: true; pages: EtatPage[] }
  | { ok: false; raison: string }

/**
 * Demande à Google l'état de quelques pages.
 *
 * Borné à `PAGES_INSPECTEES` par appel, et c'est délibéré : le quota de l'API d'inspection
 * n'est pas connu de ce code. Une borne basse tenue est préférable à une borne haute qu'on
 * découvrirait en la franchissant, un lundi, sur le compte de quelqu'un d'autre.
 *
 * Les pages sont demandées en série, pas en parallèle. Une rafale de vingt appels
 * simultanés est exactement ce qu'une limite par minute est faite pour refuser.
 */
export async function inspecter(
  userId: string,
  siteId: string,
  urls: readonly string[],
): Promise<Inspecte> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { origin: true },
    }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  const acces = await useOAuthAccess(userId, 'google-search-console', rafraichir)
  if (!acces.ok) return { ok: false, raison: acces.raison }

  const proprietes = await listerProprietes(acces.accessToken)
  if (!proprietes.ok) return { ok: false, raison: proprietes.raison }

  const propriete = choisirPropriete(site.origin, proprietes.proprietes)
  if (propriete === null) {
    return { ok: false, raison: 'Aucune propriété Search Console ne correspond à ce site.' }
  }

  /*
   * Les adresses viennent du navigateur : on ne garde que celles de ce site. Sans ce
   * filtre, cette route inspecterait n'importe quelle adresse du web sur le quota de la
   * personne, et renseignerait sur des sites qui ne sont pas les siens.
   */
  const origine = clefUrl(site.origin)
  const retenues = urls
    .filter((url) => clefUrl(url).startsWith(origine))
    .slice(0, PAGES_INSPECTEES)

  const pages: EtatPage[] = []
  for (const url of retenues) {
    const brut = await inspecterUrl(acces.accessToken, propriete, url)
    if (brut.status === 429) {
      logger.warn('inspection : quota Google atteint', { faites: pages.length })
      return pages.length === 0
        ? { ok: false, raison: 'Google limite les inspections aujourd’hui. Réessayez demain.' }
        : { ok: true, pages }
    }
    if (brut.status !== 200) {
      logger.warn('inspection refusée', { status: brut.status })
      continue
    }

    const resultat = (brut.corps as Inspection).inspectionResult
    const etat = resultat?.indexStatusResult
    if (etat === undefined) continue

    const googleCanonical = etat.googleCanonical ?? ''
    const userCanonical = etat.userCanonical ?? ''
    pages.push({
      url,
      verdict: etat.verdict ?? 'VERDICT_UNSPECIFIED',
      etat: etat.coverageState ?? 'Sans réponse de Google',
      vueLe: etat.lastCrawlTime ?? null,
      robots: etat.robotsTxtState ?? '',
      /*
       * La barre finale ne compte pas : Google rend l'accueil sans, quand la page en
       * déclare une. La signaler ferait crier au loup sur tous les sites.
       */
      canoniqueDivergent:
        googleCanonical !== '' &&
        userCanonical !== '' &&
        clefUrl(googleCanonical) !== clefUrl(userCanonical)
          ? googleCanonical
          : null,
      lien: resultat?.inspectionResultLink ?? null,
    })
  }

  logger.info('indexation inspectée', { demandees: retenues.length, rendues: pages.length })
  return { ok: true, pages }
}
