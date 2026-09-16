import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Le parcours d'un site.
 *
 * La couche réseau est éprouvée ailleurs, contre un vrai serveur. Ici on vérifie ce qu'elle
 * ne dit pas : qu'un audit s'arrête. Un site marchand peut contenir cent mille adresses, et
 * des adresses infinies — un calendrier qui accepte n'importe quelle date, un filtre qui se
 * combine à lui-même — n'ont même pas besoin d'être nombreuses pour l'être. Sans bornes,
 * l'exploration ne rend jamais la main, et c'est le serveur d'Evoliia qui tombe.
 *
 * On vérifie aussi qu'elle explore *ce qui compte*. S'arrêter à cinquante pages n'a d'intérêt
 * que si ce sont les cinquante premières en importance, et non cinquante pages d'archives
 * atteintes en enfilant des « page suivante ».
 */

const pagesDuSite: Record<string, string> = {
  '/': `<html><head><title>Accueil</title></head><body>
    <a href="/boutique">Boutique</a>
    <a href="/contact">Contact</a>
    <a href="/panier">Panier</a>
    <a href="https://ailleurs.test/page">Un autre site</a>
    <a href="/boutique/">Boutique encore</a>
    <a href="/boutique?utm_source=post">Boutique depuis Facebook</a>
  </body></html>`,
  '/boutique': `<html><head><title>Boutique</title></head><body>
    <a href="/boutique/bougies">Bougies</a>
    <a href="/">Retour</a>
  </body></html>`,
  '/contact': `<html><head><title>Contact</title></head><body><h1>Contact</h1></body></html>`,
  '/panier': `<html><head><title>Panier</title></head><body>Panier</body></html>`,
  '/boutique/bougies': `<html><head><title>Bougies</title></head><body>
    <a href="/boutique/bougies/lavande">Lavande</a>
  </body></html>`,
  '/boutique/bougies/lavande': `<html><head><title>Lavande</title></head><body>
    <a href="/boutique/bougies/lavande/details">Détails</a>
  </body></html>`,
  '/boutique/bougies/lavande/details': `<html><head><title>Détails</title></head><body>Trop loin</body></html>`,
}

const ROBOTS = 'User-agent: *\nDisallow: /panier\nSitemap: https://exemple.test/sitemap.xml\n'
const SITEMAP = `<?xml version="1.0"?><urlset>
  <url><loc>https://exemple.test/contact</loc></url>
  <url><loc>https://exemple.test/mentions</loc></url>
</urlset>`

const demandees: string[] = []

vi.mock('@/server/audit/net', async () => {
  const reel = await vi.importActual<typeof import('@/server/audit/net')>('@/server/audit/net')
  return {
    ...reel,
    secureFetch: async (brut: string) => {
      demandees.push(brut)
      const url = new URL(brut)
      if (url.hostname !== 'exemple.test') throw new Error('hors du site')
      if (url.pathname === '/robots.txt') {
        return { url: brut, status: 200, contentType: 'text/plain', body: ROBOTS, bytes: ROBOTS.length, chain: [brut] }
      }
      if (url.pathname === '/sitemap.xml') {
        return { url: brut, status: 200, contentType: 'application/xml', body: SITEMAP, bytes: SITEMAP.length, chain: [brut] }
      }
      const corps = pagesDuSite[url.pathname]
      if (corps === undefined) {
        return { url: brut, status: 404, contentType: 'text/html', body: '<html><title>Introuvable</title></html>', bytes: 40, chain: [brut] }
      }
      return { url: brut, status: 200, contentType: 'text/html; charset=utf-8', body: corps, bytes: corps.length, chain: [brut] }
    },
  }
})

vi.mock('@/server/audit/robots', async () => {
  const reel = await vi.importActual<typeof import('@/server/audit/robots')>('@/server/audit/robots')
  // Le délai de politesse est réel en production ; le garder ici ferait durer le test
  // quarante secondes sans rien prouver de plus.
  return { ...reel, DEFAULT_DELAY_MS: 0, parseRobots: (texte: string) => ({ ...reel.parseRobots(texte), delayMs: 0 }) }
})

beforeEach(() => {
  demandees.length = 0
})

describe('l’exploration s’arrête', () => {
  it('respecte le nombre de pages accordé', async () => {
    const { crawl } = await import('@/server/audit/crawler')
    const exploration = await crawl('https://exemple.test', { maxPages: 3 })
    expect(exploration.pages).toHaveLength(3)
  })

  it('n’explore pas au-delà de la profondeur demandée', async () => {
    const { crawl } = await import('@/server/audit/crawler')
    const exploration = await crawl('https://exemple.test', { maxDepth: 1, maxPages: 50 })
    const chemins = exploration.pages.map((page) => page.path)
    expect(chemins).toContain('/boutique')
    // Atteignable seulement en deux clics : hors du périmètre demandé.
    expect(chemins).not.toContain('/boutique/bougies')
  })

  it('ne sort jamais du domaine', async () => {
    const { crawl } = await import('@/server/audit/crawler')
    await crawl('https://exemple.test', { maxPages: 50 })
    // Un lien sortant est relevé comme constat, jamais suivi : sans cela, un audit
    // commencé sur un site d'artisan finirait par explorer Instagram.
    expect(demandees.every((adresse) => new URL(adresse).hostname === 'exemple.test')).toBe(true)
  })

  it('ne demande jamais deux fois la même page', async () => {
    const { crawl } = await import('@/server/audit/crawler')
    await crawl('https://exemple.test', { maxPages: 50 })
    expect(new Set(demandees).size).toBe(demandees.length)
  })

  it('rend la main quand le temps accordé est écoulé', async () => {
    const { crawl } = await import('@/server/audit/crawler')
    const exploration = await crawl('https://exemple.test', { maxPages: 50, budgetMs: 0 })
    expect(exploration.skipped.some((ecartee) => ecartee.reason === 'budget_temps')).toBe(true)
  })
})

describe('l’exploration regarde ce qui compte', () => {
  it('ne compte qu’une fois trois adresses qui désignent la même page', async () => {
    const { crawl } = await import('@/server/audit/crawler')
    const exploration = await crawl('https://exemple.test', { maxPages: 50 })
    const boutiques = exploration.pages.filter((page) => page.path === '/boutique')
    // `/boutique`, `/boutique/` et `/boutique?utm_source=post` sont la même page. Les
    // compter trois fois consommerait trois des cinquante pages accordées pour rien.
    expect(boutiques).toHaveLength(1)
  })

  it('commence par l’accueil et ses voisins immédiats', async () => {
    const { crawl } = await import('@/server/audit/crawler')
    const exploration = await crawl('https://exemple.test', { maxPages: 50 })
    expect(exploration.pages[0]?.path).toBe('/')
    const profondeurs = exploration.pages.map((page) => page.depth)
    // En largeur : les profondeurs ne peuvent que croître dans l'ordre de visite.
    expect([...profondeurs].sort((a, b) => a - b)).toEqual(profondeurs)
  })

  it('se sert de la carte du site quand elle existe', async () => {
    const { crawl } = await import('@/server/audit/crawler')
    const exploration = await crawl('https://exemple.test', { maxPages: 50 })
    expect(exploration.sitemapFound).toBe(true)
    // `/mentions` n'est lié depuis aucune page : seule la carte du site la fait connaître.
    expect(demandees).toContain('https://exemple.test/mentions')
  })

  it('relève les signaux de chaque page visitée', async () => {
    const { crawl } = await import('@/server/audit/crawler')
    const exploration = await crawl('https://exemple.test', { maxPages: 50 })
    const contact = exploration.pages.find((page) => page.path === '/contact')
    expect(contact?.signals.title).toBe('Contact')
    expect(contact?.signals.h1).toEqual(['Contact'])
    expect(contact?.statusCode).toBe(200)
  })
})

describe('ce que le site interdit', () => {
  it('n’explore pas une page refusée par robots.txt', async () => {
    const { crawl } = await import('@/server/audit/crawler')
    const exploration = await crawl('https://exemple.test', { maxPages: 50 })
    expect(exploration.robots.found).toBe(true)
    expect(exploration.pages.some((page) => page.path === '/panier')).toBe(false)
    expect(exploration.skipped.some((ecartee) => ecartee.reason === 'robots')).toBe(true)
    // La page n'a même pas été demandée : un robot poli ne frappe pas à la porte fermée.
    expect(demandees).not.toContain('https://exemple.test/panier')
  })
})
