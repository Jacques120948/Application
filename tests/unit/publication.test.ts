import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { auteur, choisirBlog, enHtml } from '@/server/commerce/publication'
import { deposerBrouillon } from '@/server/integrations/providers/shopify'

/**
 * La conversion d'un article vers le HTML que reçoit une boutique en ligne.
 *
 * C'est le seul endroit où du texte produit par un modèle part vers un site public. Un
 * convertisseur Markdown complet accepterait le HTML brut mêlé au texte, et donc tout ce
 * qu'un modèle pourrait produire — une balise de script, un cadre, un pixel de suivi.
 * Celui-ci ne connaît que quatre formes, et échappe tout le reste.
 */

const SANS_IMAGES: never[] = []

describe('le corps d’un article en HTML', () => {
  it('rend les intertitres, les paragraphes et les listes', () => {
    const html = enHtml('## Origine\n\nUn verre volcanique.\n\n- dur\n- tranchant', SANS_IMAGES)
    expect(html).toContain('<h2>Origine</h2>')
    expect(html).toContain('<p>Un verre volcanique.</p>')
    expect(html).toContain('<ul><li>dur</li><li>tranchant</li></ul>')
  })

  it('échappe ce qui ressemble à du HTML, au lieu de le laisser passer', () => {
    /*
     * La règle qui compte. Ce texte vient d'un modèle et part sur une boutique : rien de ce
     * qu'il écrit ne doit pouvoir devenir une balise.
     */
    const html = enHtml('## <script>alert(1)</script>\n\nUn "essai" & une <b>balise</b>', SANS_IMAGES)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&lt;b&gt;')
  })

  it('place la photo sous l’intertitre de sa section', () => {
    const html = enHtml('## Une\n\nTexte.\n\n## Deux\n\nTexte.', [
      {
        section: 1,
        image: 'https://cdn.shopify.com/bougie.jpg',
        alt: 'Bougie obsidienne',
        lien: 'https://cap-nature.ch/products/bougie',
      },
    ])
    const apresDeux = html.slice(html.indexOf('<h2>Deux</h2>'))
    expect(apresDeux).toContain('<img src="https://cdn.shopify.com/bougie.jpg"')
    expect(apresDeux).toContain('alt="Bougie obsidienne"')
    expect(apresDeux).toContain('<a href="https://cap-nature.ch/products/bougie">')
    // La première section n'a pas d'image : la photo ne doit pas remonter.
    expect(html.slice(0, html.indexOf('<h2>Deux</h2>'))).not.toContain('<img')
  })

  it('échappe aussi les adresses, qui pourraient fermer un attribut', () => {
    const html = enHtml('## Une\n\nTexte.', [
      { section: 0, image: 'https://x/"onerror="alert(1)', alt: 'a"b', lien: null },
    ])
    expect(html).not.toContain('onerror="alert')
    expect(html).toContain('&quot;')
  })

  it('n’invente rien quand il n’y a pas d’image', () => {
    expect(enHtml('## Une\n\nTexte.', SANS_IMAGES)).not.toContain('<img')
  })
})

describe('ce que le connecteur ne fait jamais', () => {
  it('ne publie pas : isPublished est faux, en dur', () => {
    /*
     * La règle qui porte toute la fonctionnalité, et la seule qu'un réglage ne doit jamais
     * pouvoir renverser. Une intelligence artificielle qui publie seule sur une boutique
     * marchande, c'est le jour où elle publie une bêtise et où son propriétaire l'apprend
     * par un client.
     *
     * Vérifié sur le texte du connecteur plutôt que par un appel réseau : c'est la valeur
     * écrite dans le code qui compte, et c'est elle qu'une modification distraite
     * changerait.
     */
    const source = readFileSync('src/server/integrations/providers/shopify.ts', 'utf8')
    expect(source).toContain('isPublished: false')
    expect(source).not.toMatch(/isPublished:\s*(true|brouillon|params)/u)
  })

  it('n’expose aucune autre écriture que le dépôt d’article', () => {
    const source = readFileSync('src/server/integrations/providers/shopify.ts', 'utf8')
    const mutations = source.match(/mutation\s*\(/gu) ?? []
    expect(mutations).toHaveLength(1)
    expect(source).toContain('articleCreate')
    for (const interdite of ['productUpdate', 'productDelete', 'articleDelete', 'articleUpdate']) {
      expect(source).not.toContain(interdite)
    }
  })
})

describe('le dépôt du brouillon, quand Shopify refuse', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const ACCES = {
    boutique: 'cap-nature.myshopify.com',
    clientId: 'x'.repeat(32),
    clientSecret: 'y'.repeat(32),
    version: '2025-07',
  }

  const BROUILLON = {
    blogId: 'gid://shopify/Blog/1',
    titre: 'Obsidienne noire',
    auteur: 'Evoliia',
    corpsHtml: '<p>Texte.</p>',
    resume: '<p>Texte.</p>',
    metaTitle: 'Obsidienne noire',
    metaDescription: 'Une roche volcanique.',
  }

  function repond(charge: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(charge), { status: 200 })),
    )
  }

  it('rend le motif quand la portée manque, au lieu de « rien renvoyé »', async () => {
    /*
     * La forme exacte d'un refus de portée : 200, le champ à null, et le motif au sommet
     * de la réponse. Le lire seulement lorsque `data` est nul perdait la phrase — et
     * l'écran disait « Shopify n'a rien renvoyé » à quelqu'un dont la seule chose à faire
     * était d'ajouter une portée.
     */
    repond({
      data: { articleCreate: null },
      errors: [
        {
          message:
            'Access denied for articleCreate field. Required access: `write_content` access scope.',
        },
      ],
    })

    const depot = await deposerBrouillon(ACCES, 'jeton', BROUILLON)
    expect(depot.ok).toBe(false)
    if (depot.ok) return
    expect(depot.raison).toContain('write_content')
  })

  it('rend les reproches de la mutation quand elle en fait', async () => {
    repond({
      data: { articleCreate: { article: null, userErrors: [{ field: ['title'], message: 'est vide' }] } },
    })

    const depot = await deposerBrouillon(ACCES, 'jeton', BROUILLON)
    expect(depot.ok).toBe(false)
    if (depot.ok) return
    expect(depot.raison).toContain('est vide')
  })

  it('accepte un dépôt propre', async () => {
    repond({
      data: {
        articleCreate: {
          article: { id: 'gid://shopify/Article/42', handle: 'obsidienne-noire' },
          userErrors: [],
        },
      },
    })

    const depot = await deposerBrouillon(ACCES, 'jeton', BROUILLON)
    expect(depot.ok).toBe(true)
    if (!depot.ok) return
    expect(depot.article.id).toBe('gid://shopify/Article/42')
  })

  it('transmet l’image à la une quand il y en a une, et rien sinon', async () => {
    /*
     * Sans image à la une, l'article paraît nu sur la liste du blog et dans les partages.
     * Elle voyage par son adresse : Shopify va la chercher là où la boutique la sert déjà.
     */
    repond({
      data: { articleCreate: { article: { id: 'gid://shopify/Article/42' }, userErrors: [] } },
    })

    await deposerBrouillon(ACCES, 'jeton', {
      ...BROUILLON,
      image: { url: 'https://cdn.shopify.com/obsidienne.jpg', altText: 'Obsidienne noire' },
    })
    const envoye = JSON.parse(
      (vi.mocked(fetch).mock.calls[0]?.[1]?.body ?? '{}') as string,
    ) as { variables?: { article?: Record<string, unknown> } }
    expect(envoye.variables?.article?.image).toEqual({
      url: 'https://cdn.shopify.com/obsidienne.jpg',
      altText: 'Obsidienne noire',
    })

    vi.mocked(fetch).mockClear()
    await deposerBrouillon(ACCES, 'jeton', BROUILLON)
    const sansImage = JSON.parse(
      (vi.mocked(fetch).mock.calls[0]?.[1]?.body ?? '{}') as string,
    ) as { variables?: { article?: Record<string, unknown> } }
    expect(sansImage.variables?.article).not.toHaveProperty('image')
  })
})

describe('le blog qui reçoit l’article', () => {
  const BLOGS = [
    { id: 'gid://shopify/Blog/1', titre: 'Bougies' },
    { id: 'gid://shopify/Blog/2', titre: 'Minéraux' },
    { id: 'gid://shopify/Blog/3', titre: 'Bijoux' },
  ]

  it('prend celui qu’on a désigné', () => {
    expect(choisirBlog(BLOGS, 'gid://shopify/Blog/2')?.titre).toBe('Minéraux')
  })

  it('retombe sur le premier quand rien n’est demandé', () => {
    expect(choisirBlog(BLOGS, undefined)?.titre).toBe('Bougies')
    expect(choisirBlog(BLOGS, '')?.titre).toBe('Bougies')
  })

  it('refuse un identifiant qui n’est pas dans la liste', () => {
    /*
     * La règle qui compte. L'identifiant vient du navigateur ; s'il n'est pas dans ce que
     * la boutique vient de rendre, il ne désigne rien qu'on ait le droit d'écrire. Le
     * remplacer par le premier venu déposerait ailleurs que là où la personne a dit — et
     * un article déposé au mauvais endroit ne se rattrape pas.
     */
    expect(choisirBlog(BLOGS, 'gid://shopify/Blog/999')).toBeUndefined()
    expect(choisirBlog(BLOGS, 'gid://shopify/Article/1')).toBeUndefined()
  })

  it('ne rend rien quand la boutique n’a aucun blog', () => {
    expect(choisirBlog([], undefined)).toBeUndefined()
  })
})

describe('l’auteur de l’article déposé', () => {
  it('est le nom de la boutique, pas celui d’Evoliia', () => {
    /*
     * L'article paraît chez le marchand, sous sa marque. Signer du nom de l'outil qui l'a
     * mis en forme reviendrait à mettre le nom de son traitement de texte au bas de ses
     * lettres.
     */
    expect(auteur('Cap-Nature', 'cap-nature.myshopify.com')).toBe('Cap-Nature')
  })

  it('retombe sur la poignée quand Shopify ne rend pas de nom', () => {
    expect(auteur('', 'cap-nature.myshopify.com')).toBe('cap-nature')
    expect(auteur('   ', 'cap-nature.myshopify.com')).toBe('cap-nature')
  })
})
