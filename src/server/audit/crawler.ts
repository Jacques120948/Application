import { logger } from '@/server/observability/logger'
import { extractSignals, type Signaux } from './extract'
import { parseRobots, ROBOTS_OUVERT, type Robots } from './robots'
import { parseTargetUrl, secureFetch, type Reponse } from './net'

/**
 * L'exploration d'un site.
 *
 * Elle part de l'accueil, suit les liens internes, et s'arrête. Ce dernier mot est le plus
 * important du fichier : un site marchand peut contenir cent mille adresses, et des adresses
 * infinies — un calendrier qui accepte n'importe quelle date, un filtre qui se combine à
 * lui-même — n'ont même pas besoin d'être nombreuses pour l'être. Sans bornes, cette
 * fonction ne rend jamais la main.
 *
 * Quatre bornes, et chacune arrête un scénario différent.
 *
 * **Le nombre de pages** arrête le gros site : cinquante pages en V1, réglable.
 * **La profondeur** arrête ce qui s'éloigne : au-delà de trois clics, on n'est plus dans ce
 * qui compte pour la visibilité.
 * **Le domaine** arrête la fuite vers l'extérieur : un lien sortant est relevé, jamais suivi.
 * **Le temps total** arrête le site lent : mille pages à dix secondes feraient trois heures.
 *
 * Deux choix de méthode.
 *
 * **En largeur, pas en profondeur.** L'accueil, puis tout ce qu'il pointe, puis tout ce que
 * ceux-là pointent. C'est l'ordre d'importance d'un site : si l'on doit s'arrêter à
 * cinquante pages, autant que ce soient les cinquante qui comptent, et non cinquante pages
 * d'archives atteintes en enfilant des « page suivante ».
 *
 * **Une requête à la fois.** Un audit n'est pas pressé, et un robot qui ouvre dix connexions
 * simultanées sur le serveur d'un artisan se fait bloquer — ou le fait tomber.
 */

export type PageExploree = {
  url: string
  path: string
  depth: number
  statusCode: number
  bytes: number
  fetchMs: number
  /** Sauts traversés pour arriver ici. Chacun coûte un aller-retour au visiteur. */
  redirects: number
  signals: Signaux
}

export type Exploration = {
  pages: PageExploree[]
  /** Pages écartées, et pourquoi. Sert aux contrôles autant qu'au journal. */
  skipped: { url: string; reason: string }[]
  robots: {
    /** Le fichier a été trouvé et lu. */
    found: boolean
    /** Le fichier nous interdit l'accueil : l'audit n'a alors rien pu voir. */
    blocksHome: boolean
    sitemaps: readonly string[]
    /** Les assistants que le fichier écarte nommément. */
    aiBlocked: readonly string[]
  }
  /** Une carte de site a été trouvée et elle est lisible. */
  sitemapFound: boolean
}

export type OptionsExploration = {
  maxPages?: number
  maxDepth?: number
  /** Temps total accordé. Au-delà, on rend ce qui a été vu. */
  budgetMs?: number
}

export const DEFAULT_MAX_PAGES = 50
export const DEFAULT_MAX_DEPTH = 3
export const DEFAULT_BUDGET_MS = 4 * 60 * 1000

/**
 * Deux adresses qui désignent la même page doivent n'en faire qu'une.
 *
 * Sans cela, `/boutique`, `/boutique/` et `/boutique?utm_source=facebook` consommeraient
 * trois des cinquante pages accordées et produiraient trois fois les mêmes constats.
 *
 * Les paramètres de suivi sont retirés parce qu'ils ne changent jamais le contenu ; les
 * autres sont gardés, parce qu'ils le changent souvent — `?produit=12` est une page à part
 * entière.
 */
const PARAMETRES_DE_SUIVI = /^(utm_|fbclid$|gclid$|msclkid$|mc_cid$|mc_eid$|_ga$|ref$)/i

export function normalizeUrl(brut: string): string | null {
  let url: URL
  try {
    url = new URL(brut)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.hash = ''
  const aRetirer = [...url.searchParams.keys()].filter((cle) => PARAMETRES_DE_SUIVI.test(cle))
  for (const cle of aRetirer) url.searchParams.delete(cle)
  url.searchParams.sort()
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1)
  }
  return url.toString()
}

/** Ce qui ne sera jamais une page web à auditer, reconnu à son extension. */
const EXTENSIONS_IGNOREES =
  /\.(jpg|jpeg|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|pdf|zip|rar|gz|mp4|webm|mp3|wav|woff2?|ttf|eot)$/i

async function lireRobots(origin: string): Promise<{ robots: Robots; found: boolean }> {
  try {
    const reponse = await secureFetch(`${origin}/robots.txt`)
    if (reponse.status !== 200 || reponse.body.trim() === '') {
      return { robots: ROBOTS_OUVERT, found: false }
    }
    return { robots: parseRobots(reponse.body), found: true }
  } catch {
    /*
     * Pas de fichier, ou injoignable : tout est permis. C'est la règle du format, et c'est
     * le cas de l'immense majorité des sites de nos utilisateurs. Refuser d'explorer faute
     * de `robots.txt` rendrait le produit inutilisable pour la plupart d'entre eux.
     */
    return { robots: ROBOTS_OUVERT, found: false }
  }
}

/** Les adresses d'une carte de site, relevées sans y croire aveuglément. */
function adressesDeSitemap(xml: string, origin: string): string[] {
  const trouvees: string[] = []
  const motif = /<loc>\s*([^<\s]+)\s*<\/loc>/gi
  let correspondance = motif.exec(xml)
  while (correspondance !== null && trouvees.length < 500) {
    const normalisee = normalizeUrl(correspondance[1] as string)
    if (normalisee !== null && normalisee.startsWith(origin)) trouvees.push(normalisee)
    correspondance = motif.exec(xml)
  }
  return trouvees
}

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Explore un site et rend ce qui a été vu.
 *
 * Ne lève pas quand une page échoue : une page en erreur est un constat d'audit, pas un
 * échec d'audit. Ne lève que si l'accueil lui-même est inatteignable, parce qu'il n'y a
 * alors rien à analyser et qu'il vaut mieux le dire franchement que rendre un score calculé
 * sur rien.
 */
export async function crawl(
  siteUrl: string,
  options: OptionsExploration = {},
): Promise<Exploration> {
  const depart = parseTargetUrl(siteUrl)
  const origin = depart.origin
  const maxPages = Math.max(1, Math.min(200, options.maxPages ?? DEFAULT_MAX_PAGES))
  const maxDepth = Math.max(0, Math.min(5, options.maxDepth ?? DEFAULT_MAX_DEPTH))
  const finAvant = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS)

  const { robots, found: robotsFound } = await lireRobots(origin)

  const pages: PageExploree[] = []
  const skipped: { url: string; reason: string }[] = []
  const vues = new Set<string>()
  const file: { url: string; depth: number }[] = []

  const accueil = normalizeUrl(depart.toString()) ?? depart.toString()
  vues.add(accueil)
  file.push({ url: accueil, depth: 0 })

  const cheminAccueil = new URL(accueil).pathname
  const blocksHome = !robots.allows(cheminAccueil)

  /*
   * La carte de site est consultée avant de suivre le moindre lien. C'est la liste que le
   * site fait lui-même de ce qui compte : bien meilleure qu'un parcours de liens, qui tombe
   * d'abord sur les mentions légales et le panier.
   */
  let sitemapFound = false
  if (!blocksHome) {
    const candidats = robots.sitemaps.length > 0 ? robots.sitemaps : [`${origin}/sitemap.xml`]
    for (const adresse of candidats.slice(0, 2)) {
      try {
        const reponse = await secureFetch(adresse)
        if (reponse.status !== 200 || !/<loc>/i.test(reponse.body)) continue
        sitemapFound = true
        for (const trouvee of adressesDeSitemap(reponse.body, origin)) {
          if (vues.has(trouvee) || file.length >= maxPages * 2) continue
          vues.add(trouvee)
          file.push({ url: trouvee, depth: 1 })
        }
      } catch {
        // Une carte injoignable est un constat, pas une raison d'arrêter.
      }
    }
  }

  while (file.length > 0 && pages.length < maxPages) {
    if (Date.now() > finAvant) {
      skipped.push({ url: '', reason: 'budget_temps' })
      break
    }
    const suivante = file.shift()
    if (suivante === undefined) break
    const { url, depth } = suivante

    const chemin = new URL(url).pathname
    if (!robots.allows(chemin)) {
      skipped.push({ url, reason: 'robots' })
      continue
    }
    if (EXTENSIONS_IGNOREES.test(chemin)) {
      skipped.push({ url, reason: 'pas_une_page' })
      continue
    }

    let reponse: Reponse
    const avant = Date.now()
    try {
      reponse = await secureFetch(url)
    } catch (error) {
      skipped.push({ url, reason: 'injoignable' })
      if (pages.length === 0 && url === accueil) {
        // L'accueil est le seul échec qui arrête tout : sans lui, il n'y a pas d'audit.
        throw error
      }
      continue
    }
    const fetchMs = Date.now() - avant

    if (!/text\/html|application\/xhtml/i.test(reponse.contentType) && reponse.body === '') {
      skipped.push({ url, reason: 'pas_du_html' })
      continue
    }

    const signals = extractSignals(reponse.body, reponse.url)
    pages.push({
      url,
      path: chemin,
      depth,
      statusCode: reponse.status,
      bytes: reponse.bytes,
      fetchMs,
      // La chaîne comprend l'adresse de départ : le nombre de sauts est donc un de moins.
      redirects: Math.max(0, reponse.chain.length - 1),
      signals,
    })

    if (depth < maxDepth) {
      for (const lien of signals.links) {
        if (!lien.interne || lien.url === '') continue
        const normalisee = normalizeUrl(lien.url)
        if (normalisee === null || vues.has(normalisee)) continue
        if (!normalisee.startsWith(origin)) continue
        vues.add(normalisee)
        file.push({ url: normalisee, depth: depth + 1 })
      }
    }

    // La politesse due au serveur d'en face, et la seule chose qui empêche un audit de
    // ressembler à une attaque pour celui qui le reçoit.
    if (file.length > 0 && pages.length < maxPages) await attendre(robots.delayMs)
  }

  logger.info('exploration terminée', {
    host: depart.hostname,
    pages: pages.length,
    ecartees: skipped.length,
  })

  return {
    pages,
    skipped,
    robots: {
      found: robotsFound,
      blocksHome,
      sitemaps: robots.sitemaps,
      aiBlocked: robots.aiBlocked,
    },
    sitemapFound,
  }
}
