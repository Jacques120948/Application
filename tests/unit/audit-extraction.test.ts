import { describe, expect, it } from 'vitest'
import { extractSignals } from '@/server/audit/extract'
import { parseRobots, MAX_DELAY_MS } from '@/server/audit/robots'
import { normalizeUrl } from '@/server/audit/crawler'

/**
 * Ce qu'on relève d'une page, et ce qu'on a le droit d'explorer.
 *
 * Tout ce qui est vérifié ici est fait par du code, jamais par un modèle. C'est la règle qui
 * décide de la marge du produit : compter des H1 et mesurer un titre sont des opérations
 * exactes et gratuites, et les confier à une IA les rendrait lentes, chères et
 * approximatives. Ces tests sont donc aussi la garantie qu'on n'aura jamais besoin de le
 * faire autrement.
 */

const PAGE = `<!doctype html>
<html lang="fr-CH">
<head>
  <title>Bougies artisanales suisses | Cap-Nature</title>
  <meta name="description" content="Des bougies coulées à la main en Gruyère.">
  <meta name="viewport" content="width=device-width">
  <link rel="canonical" href="https://exemple.test/bougies">
  <meta property="og:title" content="Bougies artisanales">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@graph":[
    {"@type":"Organization","name":"Cap-Nature","author":{"@type":"Person","name":"Mireille"}},
    {"@type":"BreadcrumbList"}
  ]}
  </script>
  <script type="application/ld+json">{ ceci n'est pas du JSON }</script>
</head>
<body>
  <h1>Bougies artisanales</h1>
  <h2>Nos parfums</h2>
  <h2>Livraison</h2>
  <h3>Délais</h3>
  <p>Chaque bougie est coulée à la main dans notre atelier de Bulle.</p>
  <ul><li>Lavande</li><li>Cèdre</li></ul>
  <table><tr><td>Poids</td><td>180 g</td></tr></table>
  <img src="/photo.jpg" alt="Une bougie allumée">
  <img src="/deco.jpg">
  <img src="/vide.jpg" alt="">
  <a href="/parfums">Nos parfums</a>
  <a href="/panier" rel="nofollow">Panier</a>
  <a href="https://instagram.com/capnature">Instagram</a>
  <a href="#haut">Haut de page</a>
  <script>const cache = "ce texte ne doit pas être compté";</script>
</body>
</html>`

const signaux = extractSignals(PAGE, 'https://exemple.test/bougies')

describe('ce qu’on relève d’une page', () => {
  it('relève le titre, la description, la langue et le lien canonique', () => {
    expect(signaux.title).toBe('Bougies artisanales suisses | Cap-Nature')
    expect(signaux.description).toBe('Des bougies coulées à la main en Gruyère.')
    expect(signaux.lang).toBe('fr-CH')
    expect(signaux.canonical).toBe('https://exemple.test/bougies')
    expect(signaux.hasViewport).toBe(true)
    expect(signaux.openGraph['og:title']).toBe('Bougies artisanales')
  })

  it('relève la structure des titres, niveau par niveau', () => {
    expect(signaux.h1).toEqual(['Bougies artisanales'])
    expect(signaux.headings.filter((titre) => titre.level === 2)).toHaveLength(2)
    expect(signaux.headings.filter((titre) => titre.level === 3)).toHaveLength(1)
  })

  it('distingue un ALT absent d’un ALT vide', () => {
    // La différence compte : un ALT vide est une décision (image décorative), un ALT absent
    // est un oubli. Les confondre ferait signaler les deux ou n'en signaler aucun.
    const parSource = new Map(signaux.images.map((image) => [image.src, image.alt]))
    expect(parSource.get('/photo.jpg')).toBe('Une bougie allumée')
    expect(parSource.get('/deco.jpg')).toBeNull()
    expect(parSource.get('/vide.jpg')).toBe('')
  })

  it('sépare les liens internes des liens sortants, et ignore les ancres', () => {
    const internes = signaux.links.filter((lien) => lien.interne)
    const sortants = signaux.links.filter((lien) => !lien.interne)
    expect(internes.map((lien) => lien.url)).toEqual([
      'https://exemple.test/parfums',
      'https://exemple.test/panier',
    ])
    expect(sortants).toHaveLength(1)
    expect(internes[1]?.nofollow).toBe(true)
  })

  it('lit les données structurées, y compris dans un graphe', () => {
    // Un `@graph` est la façon normale de déclarer plusieurs entités. Ne regarder que le
    // premier niveau annoncerait « aucune donnée structurée » aux sites les mieux équipés.
    expect(signaux.schemaTypes).toContain('Organization')
    expect(signaux.schemaTypes).toContain('BreadcrumbList')
    expect(signaux.author).toBe('Mireille')
    // Un bloc illisible est compté : un moteur ne le lira pas davantage.
    expect(signaux.jsonLdBroken).toBe(1)
  })

  it('compte le texte visible, sans les scripts', () => {
    expect(signaux.text).toContain('coulée à la main')
    expect(signaux.text).not.toContain('ce texte ne doit pas être compté')
    expect(signaux.wordCount).toBeGreaterThan(10)
    expect(signaux.lists).toBe(1)
    expect(signaux.listItems).toBe(2)
    expect(signaux.tables).toBe(1)
  })

  it('ne s’effondre pas sur une page vide ou cassée', () => {
    for (const html of ['', '<html>', '<p>bonjour', '<<<>>>']) {
      const vide = extractSignals(html, 'https://exemple.test/')
      expect(vide.title).toBe('')
      expect(vide.h1).toEqual([])
      expect(vide.links).toEqual([])
    }
  })
})

describe('deux adresses pour la même page n’en font qu’une', () => {
  it('retire l’ancre, la barre finale et les paramètres de suivi', () => {
    const attendu = 'https://exemple.test/boutique'
    for (const brut of [
      'https://exemple.test/boutique',
      'https://exemple.test/boutique/',
      'https://exemple.test/boutique#avis',
      'https://exemple.test/boutique?utm_source=facebook&utm_medium=post',
      'https://exemple.test/boutique/?fbclid=abc123',
    ]) {
      expect(normalizeUrl(brut), brut).toBe(attendu)
    }
  })

  it('garde les paramètres qui changent le contenu', () => {
    // `?produit=12` est une autre page ; la confondre avec la première ferait passer un
    // catalogue entier pour une seule fiche.
    expect(normalizeUrl('https://exemple.test/f?produit=12')).toBe('https://exemple.test/f?produit=12')
  })

  it('refuse ce qui n’est pas une adresse web', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('pas une adresse')).toBeNull()
  })
})

describe('ce que le site nous autorise à lire', () => {
  it('applique les interdictions du groupe générique', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /panier\nDisallow: /compte\n')
    expect(robots.allows('/boutique')).toBe(true)
    expect(robots.allows('/panier')).toBe(false)
    expect(robots.allows('/panier/etape-2')).toBe(false)
  })

  it('laisse le motif le plus long décider', () => {
    // La façon normale d'ouvrir une seule partie d'un site fermé. S'y tromper reviendrait
    // à n'explorer aucune page d'un site parfaitement explorable.
    const robots = parseRobots('User-agent: *\nDisallow: /\nAllow: /boutique\n')
    expect(robots.allows('/boutique')).toBe(true)
    expect(robots.allows('/boutique/bougies')).toBe(true)
    expect(robots.allows('/admin')).toBe(false)
  })

  it('comprend * et $', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /a/*/prive\n')
    expect(robots.allows('/notice.pdf')).toBe(false)
    expect(robots.allows('/notice.pdf.html')).toBe(true)
    expect(robots.allows('/a/x/prive')).toBe(false)
    expect(robots.allows('/a/x/public')).toBe(true)
  })

  it('préfère le groupe qui nous nomme au groupe générique', () => {
    const robots = parseRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: EvoliiaBot\nDisallow: /panier\n',
    )
    expect(robots.allows('/boutique')).toBe(true)
    expect(robots.allows('/panier')).toBe(false)
  })

  it('plafonne un délai qui immobiliserait l’audit', () => {
    const robots = parseRobots('User-agent: *\nCrawl-delay: 3600\n')
    expect(robots.delayMs).toBe(MAX_DELAY_MS)
  })

  it('relève les cartes de site', () => {
    const robots = parseRobots('Sitemap: https://exemple.test/sitemap.xml\nUser-agent: *\n')
    expect(robots.sitemaps).toEqual(['https://exemple.test/sitemap.xml'])
  })

  it('ne ferme rien quand le fichier est vide ou illisible', () => {
    // La règle du format, et le cas de la plupart des sites de nos utilisateurs.
    for (const texte of ['', '# rien\n', 'n’importe quoi']) {
      expect(parseRobots(texte).allows('/boutique'), texte).toBe(true)
    }
  })
})
