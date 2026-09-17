import { describe, expect, it } from 'vitest'
import { GEO_CHECKS } from '@/server/audit/checks/geo'
import type { PageVue, SiteVu } from '@/server/audit/checks/types'
import { extractSignals } from '@/server/audit/extract'
import { parseRobots } from '@/server/audit/robots'
import { buildContexte, evaluate, evaluateAll } from '@/server/audit/scoring'

/**
 * Les contrôles de visibilité dans les assistants.
 *
 * Ce que ces tests défendent va au-delà de « le contrôle existe ». Un moteur GEO est plus
 * exposé qu'un moteur SEO à deux dérives, et chacune se teste ici.
 *
 * **Il ne doit rien promettre.** Aucune explication ne doit laisser entendre qu'un bon score
 * fait apparaître le site dans ChatGPT ou Perplexity. Personne ne connaît leurs critères ;
 * un produit qui le promet ment, et un test le vérifie sur les dix-huit contrôles.
 *
 * **Il ne doit pas reprocher aux anciens audits ce qu'ils ne pouvaient pas relever.** Les
 * signaux sont conservés tels qu'ils ont été mesurés. Un audit antérieur à un champ ne le
 * porte pas, et le lire comme un zéro ferait chuter des notes pour une raison inventée.
 *
 * **Il ne doit pas redire le référencement.** Les deux catalogues se croisent forcément —
 * mais les identifiants ne se recouvrent pas, et les deux notes se calculent séparément.
 */

const SITE: SiteVu = {
  origin: 'https://exemple.ch',
  robotsFound: true,
  robotsBlocksHome: false,
  sitemapFound: true,
  aiBlocked: [],
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

/** Un paragraphe de la longueur voulue, en mots distincts pour rester lisible à l'œil. */
function mots(combien: number, graine = 'atelier'): string {
  return Array.from({ length: combien }, (_, index) => `${graine}${index}`).join(' ')
}

/**
 * Une page qu'un assistant peut réellement exploiter.
 *
 * Elle porte tout ce que le catalogue attend : une identité complète, une introduction qui
 * annonce le sujet, des intertitres qui posent des questions déclarées comme telles, une
 * liste, des chiffres, un auteur, une date. Les cas fautifs s'en dérivent.
 *
 * L'introduction est dérivée du titre, et ce n'est pas un détail : une première version
 * donnait la même ouverture à toutes les pages, et le contrôle des introductions jumelles
 * avait raison de le signaler. Une donnée d'essai qui déclenche un vrai constat rend le test
 * illisible.
 */
function pageExploitable(url: string, titre = 'Choisir une bougie en cire de soja'): string {
  return `<!doctype html><html lang="fr"><head>
    <title>${titre} | Cap-Nature</title>
    <meta name="description" content="${titre} : nos critères, nos tarifs et nos durées de combustion.">
    <link rel="canonical" href="${url}">
    <meta name="author" content="Camille Perret">
    <meta property="article:published_time" content="2026-02-11">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
      {"@type":"Organization","name":"Cap-Nature","telephone":"+41 26 000 00 00","address":{"@type":"PostalAddress","addressLocality":"Bulle"},"sameAs":["https://www.linkedin.com/company/cap-nature"]},
      {"@type":"BlogPosting","headline":"${titre}","datePublished":"2026-02-11","author":{"@type":"Person","name":"Camille Perret"}},
      {"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Combien de temps brûle une bougie ?"}]}
    ]}</script>
  </head><body>
    <h1>${titre}</h1>
    <p>${titre} : une bougie de 180 grammes en cire de soja brûle entre 35 et 40 heures, contre 22 heures pour une paraffine de même poids, et c'est le premier critère à regarder avant le parfum.</p>
    <h2>Combien de temps brûle une bougie de 180 g ?</h2>
    <p>${mots(110)}</p>
    <h2>Pourquoi la cire de soja plutôt que la paraffine ?</h2>
    <p>${mots(110)}</p>
    <h2>Quel parfum choisir pour une pièce de 20 m² ?</h2>
    <p>${mots(110)}</p>
    <ul><li>Durée de combustion : 40 heures</li><li>Poids : 180 grammes</li><li>Prix : 29 francs</li></ul>
    <dl><dt>Mèche en coton</dt><dd>${mots(20)}</dd></dl>
    <a href="mailto:bonjour@exemple.ch">Nous écrire</a>
  </body></html>`
}

/** Le verdict d'un contrôle, sur la première page ou sur le site. */
function verdict(checkId: string, pages: PageVue[], site: SiteVu = SITE): boolean | null {
  const check = GEO_CHECKS.find((candidat) => candidat.id === checkId)
  if (check === undefined) throw new Error(`contrôle inconnu : ${checkId}`)
  const contexte = buildContexte(pages, site)
  if (check.scope === 'site') return check.run(site, contexte)
  const premiere = pages[0]
  if (premiere === undefined) throw new Error('aucune page')
  return check.run(premiere, contexte)
}

describe('le catalogue', () => {
  it('compte entre quinze et vingt-cinq contrôles, tous distincts et tous pondérés', () => {
    expect(GEO_CHECKS.length).toBeGreaterThanOrEqual(15)
    expect(GEO_CHECKS.length).toBeLessThanOrEqual(25)
    const identifiants = GEO_CHECKS.map((check) => check.id)
    expect(new Set(identifiants).size).toBe(identifiants.length)
    for (const check of GEO_CHECKS) {
      expect(check.engine, check.id).toBe('geo')
      expect(check.id.startsWith('geo.'), check.id).toBe(true)
      expect(check.weight, check.id).toBeGreaterThan(0)
      expect(check.why.length, check.id).toBeGreaterThan(60)
    }
  })

  it('ne promet jamais une apparition dans un assistant', () => {
    /*
     * La règle du produit, tenue par un test parce qu'elle se perdrait autrement à la
     * première réécriture : le score dit une aptitude à être repris, jamais un résultat
     * obtenu. Ces tournures sont celles par lesquelles une promesse se glisse.
     */
    const promesses =
      /(garanti|garantit|garantie|assure que|vous apparaîtrez|fera apparaître|vous serez cité|permet d'apparaître|vous place dans)/i
    for (const check of GEO_CHECKS) {
      expect(promesses.test(check.why), `${check.id} : ${check.why}`).toBe(false)
      expect(promesses.test(check.label), check.id).toBe(false)
    }
  })

  it('n’emprunte aucun identifiant au catalogue de référencement', async () => {
    const { SEO_CHECKS } = await import('@/server/audit/checks/seo')
    const seo = new Set(SEO_CHECKS.map((check) => check.id))
    for (const check of GEO_CHECKS) expect(seo.has(check.id), check.id).toBe(false)
  })
})

describe('le droit de lire', () => {
  it('lit dans robots.txt les assistants écartés nommément', () => {
    const robots = parseRobots(
      'User-agent: GPTBot\nDisallow: /\n\nUser-agent: anthropic-ai\nDisallow: /\n\nUser-agent: *\nDisallow: /panier\n',
    )
    expect(robots.aiBlocked).toEqual(['Claude', 'ChatGPT'].sort())
    // Le reste du site nous reste ouvert : bloquer une IA n'est pas bloquer l'exploration.
    expect(robots.allows('/')).toBe(true)
    expect(verdict('geo.ai_blocked', [], { ...SITE, aiBlocked: robots.aiBlocked })).toBe(true)
  })

  it('ne conclut rien d’un fichier qui laisse entrer les assistants', () => {
    const robots = parseRobots('User-agent: GPTBot\nAllow: /\n\nUser-agent: *\nDisallow: /admin\n')
    expect(robots.aiBlocked).toEqual([])
    expect(verdict('geo.ai_blocked', [], { ...SITE, aiBlocked: [] })).toBe(false)
  })

  it('s’abstient quand l’audit est antérieur à ce relevé', () => {
    const ancien: SiteVu = {
      origin: 'https://exemple.ch',
      robotsFound: true,
      robotsBlocksHome: false,
      sitemapFound: true,
    }
    expect(verdict('geo.ai_blocked', [], ancien)).toBeNull()
  })

  it('repère une page marquée comme à ne pas réutiliser', () => {
    const refus = page(
      'https://exemple.ch/a',
      '<html><head><meta name="robots" content="index, noai"></head><body><p>texte</p></body></html>',
    )
    expect(verdict('geo.noai_meta', [refus])).toBe(true)
    expect(
      verdict('geo.noai_meta', [
        page('https://exemple.ch/b', pageExploitable('https://exemple.ch/b')),
      ]),
    ).toBe(false)
  })
})

describe('savoir qui parle', () => {
  it('signale une identité déclarée mais sans point d’ancrage', () => {
    const nue = page(
      'https://exemple.ch/',
      '<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Cap-Nature"}</script></head><body><p>texte</p></body></html>',
    )
    expect(verdict('geo.entity_incomplete', [nue])).toBe(true)
    expect(
      verdict('geo.entity_incomplete', [
        page('https://exemple.ch/a', pageExploitable('https://exemple.ch/a')),
      ]),
    ).toBe(false)
  })

  it('laisse le référencement s’occuper d’une identité absente', () => {
    // Deux catalogues ne doivent pas reprocher deux fois la même chose au même site.
    const sans = page('https://exemple.ch/', '<html><head></head><body><p>texte</p></body></html>')
    expect(verdict('geo.entity_incomplete', [sans])).toBeNull()
  })

  it('cherche un moyen de contact dans les liens comme dans les adresses', () => {
    const muette = page(
      'https://exemple.ch/a',
      '<html><head></head><body><p>texte</p></body></html>',
    )
    expect(verdict('geo.no_contact', [muette])).toBe(true)
    expect(
      verdict('geo.no_contact', [
        page('https://exemple.ch/a', pageExploitable('https://exemple.ch/a')),
      ]),
    ).toBe(false)
    expect(
      verdict('geo.no_contact', [
        muette,
        page('https://exemple.ch/contact', '<html><body><p>x</p></body></html>'),
      ]),
    ).toBe(false)
  })

  it('cherche une page qui raconte qui vous êtes', () => {
    const muet = page('https://exemple.ch/a', '<html><body><p>texte</p></body></html>')
    expect(verdict('geo.no_about', [muet])).toBe(true)
    expect(
      verdict('geo.no_about', [
        muet,
        page('https://exemple.ch/qui-sommes-nous', '<html><body><p>x</p></body></html>'),
      ]),
    ).toBe(false)
  })

  it('réclame un auteur et une date sur les contenus de fond, pas sur les autres', () => {
    const long = `<html><head><title>Un guide</title></head><body><h1>Un guide</h1>${('<p>' + mots(100) + '</p>').repeat(8)}</body></html>`
    const anonyme = page('https://exemple.ch/guide', long)
    expect(verdict('geo.author_missing', [anonyme])).toBe(true)
    expect(verdict('geo.date_missing', [anonyme])).toBe(true)
    expect(verdict('geo.article_not_marked', [anonyme])).toBe(true)

    const courte = page('https://exemple.ch/a', `<html><body><p>${mots(80)}</p></body></html>`)
    expect(verdict('geo.author_missing', [courte])).toBeNull()
    expect(verdict('geo.date_missing', [courte])).toBeNull()
    expect(verdict('geo.article_not_marked', [courte])).toBeNull()
  })
})

describe('répondre à quelque chose', () => {
  it('reconnaît une question à sa forme comme à son mot d’attaque', () => {
    const avec = page('https://exemple.ch/a', pageExploitable('https://exemple.ch/a'))
    expect(verdict('geo.no_questions', [avec])).toBe(false)

    const sans = page(
      'https://exemple.ch/b',
      `<html><body><h1>Nos bougies</h1><h2>Nos parfums</h2><p>${mots(60)}</p></body></html>`,
    )
    expect(verdict('geo.no_questions', [sans])).toBe(true)
  })

  it('signale des questions posées mais non déclarées, et se tait quand elles le sont', () => {
    const nonDeclarees = page(
      'https://exemple.ch/a',
      `<html><body><h1>Nos bougies</h1><h2>Combien de temps brûle une bougie ?</h2><p>${mots(60)}</p><h2>Pourquoi la cire de soja ?</h2><p>${mots(60)}</p></body></html>`,
    )
    expect(verdict('geo.faq_not_declared', [nonDeclarees])).toBe(true)
    expect(
      verdict('geo.faq_not_declared', [
        page('https://exemple.ch/b', pageExploitable('https://exemple.ch/b')),
      ]),
    ).toBe(false)
  })

  it('ne réclame pas de déclaration de FAQ à une page qui ne pose pas de question', () => {
    const sans = page(
      'https://exemple.ch/a',
      `<html><body><h1>Nos bougies</h1><h2>Nos parfums</h2><p>${mots(60)}</p></body></html>`,
    )
    expect(verdict('geo.faq_not_declared', [sans])).toBeNull()
  })

  it('voit une page qui accueille au lieu d’annoncer son sujet', () => {
    const accueillante = page(
      'https://exemple.ch/a',
      `<html><body><h1>Nos bougies</h1><p>Bienvenue chez nous, ravis de vous voir sur notre site !</p><p>${mots(400)}</p></body></html>`,
    )
    expect(verdict('geo.no_intro', [accueillante])).toBe(true)
    expect(
      verdict('geo.no_intro', [
        page('https://exemple.ch/b', pageExploitable('https://exemple.ch/b')),
      ]),
    ).toBe(false)
  })

  it('signale plusieurs pages qui ouvrent sur le même paragraphe', () => {
    const meme = (url: string) =>
      page(
        url,
        `<html><body><h1>${url}</h1><p>Notre atelier de Bulle coule ses bougies à la main depuis 2014, en cire de soja exclusivement, avec des mèches en coton et des parfums d'origine naturelle.</p><p>${mots(400)}</p></body></html>`,
      )
    const a = meme('https://exemple.ch/a')
    const b = meme('https://exemple.ch/b')
    expect(verdict('geo.duplicate_intro', [a, b])).toBe(true)
    expect(verdict('geo.duplicate_intro', [a])).toBe(false)
  })
})

describe('un texte exploitable', () => {
  it('signale un long texte sans liste ni tableau, et pas un texte court', () => {
    const pave = page(
      'https://exemple.ch/a',
      `<html><body><h1>Guide</h1><p>${mots(500)}</p></body></html>`,
    )
    expect(verdict('geo.wall_of_text', [pave])).toBe(true)
    expect(
      verdict('geo.wall_of_text', [
        page('https://exemple.ch/b', `<html><body><p>${mots(100)}</p></body></html>`),
      ]),
    ).toBeNull()
    expect(
      verdict('geo.wall_of_text', [
        page('https://exemple.ch/c', pageExploitable('https://exemple.ch/c')),
      ]),
    ).toBe(false)
  })

  it('mesure le plus long paragraphe, pas la page entière', () => {
    const decoupe = `<html><body><h1>Guide</h1>${'<p>' + mots(60) + '</p>'.repeat(1)}${('<p>' + mots(60) + '</p>').repeat(8)}</body></html>`
    expect(verdict('geo.long_paragraphs', [page('https://exemple.ch/a', decoupe)])).toBe(false)

    const bloc = page(
      'https://exemple.ch/b',
      `<html><body><h1>Guide</h1><p>${mots(300)}</p></body></html>`,
    )
    expect(verdict('geo.long_paragraphs', [bloc])).toBe(true)
  })

  it('s’abstient sur un audit qui n’a pas relevé les paragraphes', () => {
    const ancienne = page('https://exemple.ch/a', `<html><body><p>${mots(300)}</p></body></html>`)
    const signaux = { ...ancienne.signals } as Record<string, unknown>
    delete signaux['longestParagraphWords']
    delete signaux['definitions']
    const sansReleve = {
      ...ancienne,
      signals: signaux as unknown as typeof ancienne.signals,
    }
    expect(verdict('geo.long_paragraphs', [sansReleve])).toBeNull()
    expect(verdict('geo.no_definitions', [sansReleve])).toBe(true)
  })

  it('compte les données chiffrées, et ne se contente pas d’un numéro de téléphone', () => {
    const sansChiffres = page(
      'https://exemple.ch/a',
      `<html><body><h1>Sur mesure</h1><p>${mots(400, 'qualite')}</p></body></html>`,
    )
    expect(verdict('geo.no_figures', [sansChiffres])).toBe(false)

    const vraimentSansChiffres = page(
      'https://exemple.ch/b',
      `<html><body><h1>Sur mesure</h1><p>${'rapide sur mesure et de qualité pour votre intérieur '.repeat(60)}</p></body></html>`,
    )
    expect(verdict('geo.no_figures', [vraimentSansChiffres])).toBe(true)
    expect(
      verdict('geo.no_figures', [
        page('https://exemple.ch/c', pageExploitable('https://exemple.ch/c')),
      ]),
    ).toBe(false)
  })

  it('cherche une explication du vocabulaire, en liste ou en intertitre', () => {
    const rien = page(
      'https://exemple.ch/a',
      `<html><body><h1>Nos bougies</h1><p>${mots(100)}</p></body></html>`,
    )
    expect(verdict('geo.no_definitions', [rien])).toBe(true)

    const enTitre = page(
      'https://exemple.ch/b',
      `<html><body><h2>Qu’est-ce que la cire de soja ?</h2><p>${mots(60)}</p></body></html>`,
    )
    expect(verdict('geo.no_definitions', [enTitre])).toBe(false)
    expect(
      verdict('geo.no_definitions', [
        page('https://exemple.ch/c', pageExploitable('https://exemple.ch/c')),
      ]),
    ).toBe(false)
  })

  it('voit un titre qui n’apprend rien hors du site', () => {
    const muet = page(
      'https://exemple.ch/',
      `<html><body><h1>Bienvenue</h1><p>${mots(300)}</p></body></html>`,
    )
    expect(verdict('geo.title_generic', [muet])).toBe(true)
    expect(
      verdict('geo.title_generic', [
        page('https://exemple.ch/a', pageExploitable('https://exemple.ch/a')),
      ]),
    ).toBe(false)
  })

  it('signale une page trop courte pour alimenter une réponse', () => {
    expect(
      verdict('geo.not_quotable', [
        page('https://exemple.ch/a', `<html><body><p>${mots(100)}</p></body></html>`),
      ]),
    ).toBe(true)
    expect(
      verdict('geo.not_quotable', [
        page('https://exemple.ch/b', pageExploitable('https://exemple.ch/b')),
      ]),
    ).toBe(false)
  })
})

describe('une page en erreur ne se juge pas sur son contenu', () => {
  it('sort du dénominateur de tout ce qui parle de contenu', () => {
    const cassee = page(
      'https://exemple.ch/perdue',
      '<html><head><title>Introuvable</title></head><body></body></html>',
      {
        statusCode: 404,
      },
    )
    for (const controle of [
      'geo.noai_meta',
      'geo.no_intro',
      'geo.wall_of_text',
      'geo.long_paragraphs',
      'geo.not_quotable',
      'geo.no_figures',
      'geo.title_generic',
      'geo.author_missing',
      'geo.date_missing',
      'geo.article_not_marked',
      'geo.faq_not_declared',
      'geo.duplicate_intro',
    ]) {
      expect(verdict(controle, [cassee]), controle).toBeNull()
    }
  })
})

describe('les deux notes', () => {
  it('rend cent en GEO quand tout ce qui s’applique est correct', async () => {
    const pages = [
      page('https://exemple.ch/', pageExploitable('https://exemple.ch/')),
      page(
        'https://exemple.ch/qui-sommes-nous',
        pageExploitable('https://exemple.ch/qui-sommes-nous', 'Notre atelier de Bulle depuis 2014'),
        { depth: 1 },
      ),
    ]
    const resultat = await evaluate(pages, SITE, GEO_CHECKS)
    const restants = resultat.constats.filter((constat) => constat.affected > 0)
    expect(restants.map((constat) => constat.checkId)).toEqual([])
    expect(resultat.score).toBe(100)
  })

  it('sépare les deux notes d’un même audit', async () => {
    /*
     * Un site peut être correct pour Google et inexploitable par un assistant : des méta
     * complètes, un texte suffisant, et rien de ce qui permet de le citer. C'est exactement
     * ce que deux notes distinctes servent à montrer, et une note unique le masquerait.
     */
    const propreMaisMuette = `<!doctype html><html lang="fr"><head>
      <title>Bougies artisanales de Gruyère | Cap-Nature</title>
      <meta name="description" content="Des bougies coulées à la main en Gruyère, en cire de soja, avec des parfums naturels et une livraison partout en Suisse.">
      <meta name="viewport" content="width=device-width">
      <link rel="canonical" href="https://exemple.ch/">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Cap-Nature"}</script>
    </head><body><h1>Bienvenue</h1><h2>Nos parfums</h2><p>${'rapide sur mesure et de qualité pour votre intérieur '.repeat(60)}</p><img src="/p.jpg" alt="Une bougie"><a href="/parfums">Nos parfums</a></body></html>`

    const pages = [page('https://exemple.ch/', propreMaisMuette)]
    const { seo, geo } = await evaluateAll(pages, SITE)
    expect(geo.score).toBeLessThan(seo.score)
    expect(geo.constats.every((constat) => constat.engine === 'geo')).toBe(true)
    expect(seo.constats.every((constat) => constat.engine === 'seo')).toBe(true)
  })

  it('ne descend jamais sous zéro, même sur une page vide', async () => {
    const vide = page('https://exemple.ch/', '<html><head></head><body><p>x</p></body></html>')
    const resultat = await evaluate([vide], { ...SITE, aiBlocked: ['ChatGPT'] }, GEO_CHECKS)
    expect(resultat.score).toBeGreaterThanOrEqual(0)
    expect(resultat.score).toBeLessThan(60)
  })
})
