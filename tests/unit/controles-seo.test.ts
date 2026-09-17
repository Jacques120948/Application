import { describe, expect, it } from 'vitest'
import { extractSignals } from '@/server/audit/extract'
import { SEO_CHECKS } from '@/server/audit/checks/seo'
import { buildContexte, evaluate, priorities } from '@/server/audit/scoring'
import type { PageVue, SiteVu } from '@/server/audit/checks/types'

/**
 * Les contrôles de référencement.
 *
 * Ce que ces tests défendent n'est pas « le contrôle existe » mais « le contrôle dit vrai ».
 * Un audit qui signale un défaut absent fait perdre une heure ; un audit qui rate un défaut
 * réel fait perdre des mois de visibilité. Les deux erreurs se testent ici.
 *
 * Trois propriétés valent au-delà de chaque contrôle pris isolément.
 *
 * **Une page en erreur ne se juge pas sur son contenu.** Elle n'a ni titre ni texte, et la
 * compter comme fautive gonflerait dix constats d'un problème qu'elle n'a pas.
 *
 * **Ce qui ne s'applique pas ne compte pas dans la note.** Un site de trois pages n'a pas de
 * pages profondes : le lui reprocher ferait baisser la note d'un site sans défaut.
 *
 * **La priorité suit le coût, pas la gravité seule.** Un défaut « important » sur quarante
 * pages passe avant un « critique » sur une seule — c'est la réponse à « par quoi je
 * commence », et c'est ce que le tri doit produire.
 */

const SITE: SiteVu = {
  origin: 'https://exemple.ch',
  robotsFound: true,
  robotsBlocksHome: false,
  sitemapFound: true,
}

function page(url: string, html: string, extra: Partial<PageVue> = {}): PageVue {
  return {
    url,
    path: new URL(url).pathname,
    depth: 0,
    statusCode: 200,
    bytes: 20_000,
    fetchMs: 300,
    redirects: 0,
    signals: extractSignals(html, url),
    ...extra,
  }
}

/**
 * Une page correcte, dont on dérive les cas fautifs.
 *
 * La description est dérivée du titre, et ce n'est pas un détail : une première version
 * donnait la même phrase à toutes les pages, et le contrôle des doublons avait raison de le
 * signaler. Une donnée d'essai qui déclenche un vrai constat rend le test illisible.
 */
function pageSaine(url: string, titre = 'Bougies artisanales de Gruyère | Cap-Nature'): string {
  return `<!doctype html><html lang="fr"><head>
    <title>${titre}</title>
    <meta name="description" content="${titre} : coulées à la main en Gruyère, en cire de soja, avec des parfums naturels et une livraison partout en Suisse.">
    <meta name="viewport" content="width=device-width">
    <link rel="canonical" href="${url}">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Cap-Nature"}</script>
  </head><body>
    <h1>Bougies artisanales</h1>
    <h2>Nos parfums</h2>
    <p>${'Chaque bougie est coulée à la main dans notre atelier de Bulle, en cire de soja. '.repeat(12)}</p>
    <img src="/photo.jpg" alt="Une bougie allumée">
    <a href="/parfums">Nos parfums</a>
  </body></html>`
}

/** Le verdict d'un contrôle sur une page, pour les cas qui s'examinent isolément. */
function verdict(checkId: string, pages: PageVue[], site: SiteVu = SITE): boolean | null {
  const check = SEO_CHECKS.find((candidat) => candidat.id === checkId)
  if (check === undefined) throw new Error(`contrôle inconnu : ${checkId}`)
  const contexte = buildContexte(pages, site)
  if (check.scope === 'site') return check.run(site, contexte)
  const premiere = pages[0]
  if (premiere === undefined) throw new Error('aucune page')
  return check.run(premiere, contexte)
}

describe('le catalogue', () => {
  it('compte au moins vingt contrôles, tous distincts et tous pondérés', () => {
    expect(SEO_CHECKS.length).toBeGreaterThanOrEqual(20)
    const identifiants = SEO_CHECKS.map((check) => check.id)
    expect(new Set(identifiants).size).toBe(identifiants.length)
    for (const check of SEO_CHECKS) {
      expect(check.weight, check.id).toBeGreaterThan(0)
      // Chaque contrôle dit ce que le problème coûte, pas seulement ce qui manque : sans
      // cette phrase, le constat est illisible pour qui n'est pas du métier.
      expect(check.why.length, check.id).toBeGreaterThan(60)
    }
  })
})

describe('ce qui s’affiche dans les résultats', () => {
  it('voit un titre absent, trop court, trop long', () => {
    const sans = page('https://exemple.ch/a', '<html><head></head><body><p>x</p></body></html>')
    expect(verdict('seo.title_missing', [sans])).toBe(true)

    const court = page('https://exemple.ch/b', pageSaine('https://exemple.ch/b', 'Accueil'))
    expect(verdict('seo.title_short', [court])).toBe(true)
    expect(verdict('seo.title_long', [court])).toBe(false)

    const long = page('https://exemple.ch/c', pageSaine('https://exemple.ch/c', 'A'.repeat(90)))
    expect(verdict('seo.title_long', [long])).toBe(true)

    const bon = page('https://exemple.ch/d', pageSaine('https://exemple.ch/d'))
    expect(verdict('seo.title_missing', [bon])).toBe(false)
    expect(verdict('seo.title_short', [bon])).toBe(false)
    expect(verdict('seo.title_long', [bon])).toBe(false)
  })

  it('ne juge pas la longueur d’un titre qui n’existe pas', () => {
    // Sinon un titre absent compterait trois fois : absent, trop court, et sans description.
    const sans = page('https://exemple.ch/a', '<html><head></head><body><p>x</p></body></html>')
    expect(verdict('seo.title_short', [sans])).toBeNull()
  })

  it('repère deux pages qui se présentent de la même façon', () => {
    const a = page('https://exemple.ch/a', pageSaine('https://exemple.ch/a'))
    const b = page('https://exemple.ch/b', pageSaine('https://exemple.ch/b'))
    expect(verdict('seo.title_duplicate', [a, b])).toBe(true)
    expect(verdict('seo.description_duplicate', [a, b])).toBe(true)

    const c = page('https://exemple.ch/c', pageSaine('https://exemple.ch/c', 'Nos parfums naturels et leur fabrication'))
    expect(verdict('seo.title_duplicate', [c, a])).toBe(false)
  })
})

describe('une page en erreur ne se juge pas sur son contenu', () => {
  it('sort du dénominateur de tout ce qui parle de contenu', () => {
    const cassee = page('https://exemple.ch/perdue', '<html><head><title>Introuvable</title></head><body></body></html>', {
      statusCode: 404,
    })
    expect(verdict('seo.http_error', [cassee])).toBe(true)
    for (const controle of [
      'seo.title_missing',
      'seo.description_missing',
      'seo.h1_missing',
      'seo.thin_content',
      'seo.viewport_missing',
      'seo.jsonld_missing',
    ]) {
      expect(verdict(controle, [cassee]), controle).toBeNull()
    }
  })
})

describe('la structure et le contenu', () => {
  it('voit l’absence de titre principal, et sa multiplication', () => {
    const sans = page('https://exemple.ch/a', '<html><head><title>Titre suffisamment long pour passer</title></head><body><p>x</p></body></html>')
    expect(verdict('seo.h1_missing', [sans])).toBe(true)

    const deux = page('https://exemple.ch/b', '<html><head><title>Titre suffisamment long pour passer</title></head><body><h1>Un</h1><h1>Deux</h1></body></html>')
    expect(verdict('seo.h1_multiple', [deux])).toBe(true)
    expect(verdict('seo.h1_missing', [deux])).toBe(false)
  })

  it('voit un niveau de titre sauté', () => {
    const saut = page('https://exemple.ch/a', '<html><head><title>Titre suffisamment long pour passer</title></head><body><h1>Un</h1><h3>Trois</h3></body></html>')
    expect(verdict('seo.heading_gap', [saut])).toBe(true)

    const suite = page('https://exemple.ch/b', '<html><head><title>Titre suffisamment long pour passer</title></head><body><h1>Un</h1><h2>Deux</h2><h3>Trois</h3></body></html>')
    expect(verdict('seo.heading_gap', [suite])).toBe(false)
  })

  it('voit une page presque vide, et laisse tranquille une page nourrie', () => {
    const vide = page('https://exemple.ch/a', '<html><head><title>Titre suffisamment long pour passer</title></head><body><h1>Un</h1><p>Trois mots ici.</p></body></html>')
    expect(verdict('seo.thin_content', [vide])).toBe(true)
    expect(verdict('seo.thin_content', [page('https://exemple.ch/b', pageSaine('https://exemple.ch/b'))])).toBe(false)
  })

  it('distingue une image sans ALT d’une image décorative', () => {
    const oubli = page('https://exemple.ch/a', '<html><head><title>Titre suffisamment long pour passer</title></head><body><img src="/a.jpg"></body></html>')
    expect(verdict('seo.image_alt_missing', [oubli])).toBe(true)

    // Un ALT vide est une décision, pas un oubli : le signaler serait un faux positif.
    const decorative = page('https://exemple.ch/b', '<html><head><title>Titre suffisamment long pour passer</title></head><body><img src="/a.jpg" alt=""></body></html>')
    expect(verdict('seo.image_alt_missing', [decorative])).toBe(false)

    // Une page sans image n'a rien à se reprocher.
    const aucune = page('https://exemple.ch/c', '<html><head><title>Titre suffisamment long pour passer</title></head><body><p>x</p></body></html>')
    expect(verdict('seo.image_alt_missing', [aucune])).toBeNull()
  })
})

describe('les liens entre les pages', () => {
  it('voit une page vers laquelle rien ne pointe', () => {
    const accueil = page('https://exemple.ch/', '<html><head><title>Titre suffisamment long pour passer</title></head><body><a href="/a">A</a></body></html>')
    const liee = page('https://exemple.ch/a', pageSaine('https://exemple.ch/a'), { depth: 1 })
    const orpheline = page('https://exemple.ch/z', pageSaine('https://exemple.ch/z'), { depth: 1 })

    const contexte = buildContexte([accueil, liee, orpheline], SITE)
    const check = SEO_CHECKS.find((candidat) => candidat.id === 'seo.orphan')
    if (check === undefined || check.scope !== 'page') throw new Error('contrôle manquant')

    expect(check.run(liee, contexte)).toBe(false)
    expect(check.run(orpheline, contexte)).toBe(true)
    // L'accueil n'est orphelin de personne : c'est le point d'entrée.
    expect(check.run(accueil, contexte)).toBeNull()
  })

  it('voit un lien interne qui mène à une erreur, sans accuser une adresse non explorée', () => {
    const source = page('https://exemple.ch/', '<html><head><title>Titre suffisamment long pour passer</title></head><body><a href="/cassee">Cassée</a><a href="/jamais-vue">Autre</a></body></html>')
    const cassee = page('https://exemple.ch/cassee', '<html><head><title>Introuvable</title></head><body></body></html>', { statusCode: 404, depth: 1 })

    expect(verdict('seo.broken_internal_link', [source, cassee])).toBe(true)
    // Sans la page cassée dans l'audit, rien n'est affirmé : on ne juge que ce qu'on a vu.
    expect(verdict('seo.broken_internal_link', [source])).toBe(false)
  })
})

describe('ce qu’une machine comprend', () => {
  it('attend une identité sur l’accueil, et pas ailleurs', () => {
    const accueilNu = page('https://exemple.ch/', '<html><head><title>Titre suffisamment long pour passer</title></head><body><h1>x</h1></body></html>')
    expect(verdict('seo.organization_missing', [accueilNu])).toBe(true)

    const accueilIdentifie = page('https://exemple.ch/', pageSaine('https://exemple.ch/'))
    expect(verdict('seo.organization_missing', [accueilIdentifie])).toBe(false)

    const interieure = page('https://exemple.ch/a', accueilNu.signals.text === '' ? '' : '<html><head><title>Titre suffisamment long pour passer</title></head><body><h1>x</h1></body></html>', { depth: 2 })
    expect(verdict('seo.organization_missing', [interieure])).toBeNull()
  })

  it('compte un bloc de données structurées illisible', () => {
    const casse = page('https://exemple.ch/a', '<html><head><title>Titre suffisamment long pour passer</title><script type="application/ld+json">{ pas du json }</script></head><body><h1>x</h1></body></html>')
    expect(verdict('seo.jsonld_broken', [casse])).toBe(true)
  })
})

describe('la note', () => {
  it('rend cent quand tout ce qui s’applique est correct', async () => {
    const pages = [
      page('https://exemple.ch/', pageSaine('https://exemple.ch/')),
      page('https://exemple.ch/parfums', pageSaine('https://exemple.ch/parfums', 'Nos parfums naturels et leur fabrication'), { depth: 1 }),
    ]
    const resultat = await evaluate(pages, SITE)
    const restants = resultat.constats.filter((constat) => constat.affected > 0)
    // Si la note n'est pas de cent, les constats restants disent lesquels ont échoué.
    expect(restants.map((constat) => constat.checkId)).toEqual([])
    expect(resultat.score).toBe(100)
  })

  it('baisse à mesure que les défauts s’étendent, sans jamais passer sous zéro', async () => {
    const nue = '<html><head></head><body><p>x</p></body></html>'
    const une = await evaluate([page('https://exemple.ch/', nue)], SITE)
    const dix = await evaluate(
      Array.from({ length: 10 }, (_, index) =>
        page(`https://exemple.ch/p${index}`, nue, { depth: index === 0 ? 0 : 1 }),
      ),
      { ...SITE, robotsFound: false, sitemapFound: false, origin: 'http://exemple.ch' },
    )
    expect(dix.score).toBeLessThan(une.score)
    expect(dix.score).toBeGreaterThanOrEqual(0)
  })

  it('ne reproche pas à un petit site ce qu’il ne peut pas avoir', async () => {
    const pages = [page('https://exemple.ch/', pageSaine('https://exemple.ch/'))]
    const resultat = await evaluate(pages, SITE)
    // Le fil d'Ariane ne concerne que les pages profondes : il ne doit pas figurer du tout.
    expect(resultat.constats.some((constat) => constat.checkId === 'seo.breadcrumb_missing')).toBe(false)
  })

  it('met en tête ce qui coûte le plus, pas ce qui est le plus grave', async () => {
    const sansDescription = '<html><head><title>Un titre correct et suffisamment long ici</title><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://exemple.ch/x"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"}</script></head><body><h1>Titre</h1><h2>Suite</h2><p>' + 'du contenu bien fourni pour cette page '.repeat(40) + '</p><a href="/">Accueil</a></body></html>'
    const pages = [
      page('https://exemple.ch/', pageSaine('https://exemple.ch/')),
      ...Array.from({ length: 20 }, (_, index) =>
        page(`https://exemple.ch/p${index}`, sansDescription, { depth: 1 }),
      ),
    ]
    const resultat = await evaluate(pages, SITE)
    const tete = priorities(resultat, 3).map((constat) => constat.checkId)
    expect(tete[0]).toBe('seo.description_missing')
  })
})
