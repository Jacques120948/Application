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

  it('pose sous la photo une légende cliquable vers la fiche', () => {
    /*
     * L'image était déjà un lien, mais rien ne le disait : il fallait la survoler pour le
     * découvrir. Et pour un moteur, l'ancre d'un lien-image se réduit à son texte
     * alternatif — la légende lui donne une ancre écrite.
     */
    const html = enHtml('## Origine\n\nTexte.', [
      {
        section: 0,
        image: 'https://cdn.shopify.com/obsidienne.jpg',
        alt: 'Bougie à l’obsidienne',
        titre: 'Bougie Obsidienne noire',
        lien: 'https://cap-nature.ch/products/obsidienne',
      },
    ])
    expect(html).toContain(
      '<p><em><a href="https://cap-nature.ch/products/obsidienne">Bougie Obsidienne noire</a></em></p>',
    )
  })

  it('garde la légende sans lien quand la fiche n’est pas en ligne', () => {
    const html = enHtml('## Origine\n\nTexte.', [
      {
        section: 0,
        image: 'https://cdn.shopify.com/obsidienne.jpg',
        alt: 'Bougie',
        titre: 'Bougie Obsidienne noire',
        lien: null,
      },
    ])
    expect(html).toContain('<p><em>Bougie Obsidienne noire</em></p>')
    expect(html).not.toContain('<a href')
  })

  it('échappe la légende, qui vient elle aussi de la boutique', () => {
    const html = enHtml('## Origine\n\nTexte.', [
      {
        section: 0,
        image: 'https://cdn.shopify.com/x.jpg',
        alt: 'x',
        titre: 'Bougie <script>alert(1)</script>',
        lien: null,
      },
    ])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
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

  /**
   * Le connecteur ne doit gagner un pouvoir d'écriture que délibérément.
   *
   * Le test comptait les mutations et en exigeait une seule. Il a fait son travail le jour
   * où une seconde est apparue — le téléversement d'une image créée dans les fichiers de la
   * boutique. Elle est légitime : sans elle, le blog du marchand pointerait indéfiniment
   * vers une adresse d'Evoliia. Mais elle devait être vue, discutée, et nommée ici.
   *
   * La liste remplace donc le compte. Un simple relèvement du nombre aurait laissé passer
   * la troisième sans que personne ne la remarque, et c'est exactement ce qu'un garde-fou
   * ne doit jamais permettre : la prochaine échouera encore, et il faudra encore l'écrire.
   */
  it('n’expose que les deux écritures nommées ici', () => {
    const source = readFileSync('src/server/integrations/providers/shopify.ts', 'utf8')
    const AUTORISEES = ['articleCreate', 'fileCreate']

    const mutations = source.match(/mutation\s*\(/gu) ?? []
    expect(mutations).toHaveLength(AUTORISEES.length)
    for (const permise of AUTORISEES) expect(source).toContain(permise)

    /*
     * Les interdites, nommées une à une. Tout ce qui modifie ou supprime ce que le marchand
     * a écrit lui-même est hors de portée du connecteur : Evoliia ajoute un brouillon et
     * une image, elle ne touche à rien d'existant.
     */
    const INTERDITES = [
      'productUpdate',
      'productDelete',
      'productCreate',
      'articleDelete',
      'articleUpdate',
      'blogCreate',
      'blogDelete',
      'fileDelete',
      'fileUpdate',
      'publishablePublish',
    ]
    for (const interdite of INTERDITES) expect(source).not.toContain(interdite)
  })

  /**
   * Le téléversement copie, il ne remplace rien.
   *
   * Une image créée pour un article part chez le marchand pour que son blog cesse de
   * dépendre d'Evoliia. Ce geste ne doit jamais devenir une porte d'entrée vers ses
   * fichiers existants : on en crée, on n'en relit pas, on n'en efface pas.
   */
  /**
   * L'incertitude doit empêcher, jamais autoriser.
   *
   * `articleExisteEncore` sert à décider si l'on peut redéposer un article. Confondre « il
   * n'y est plus » avec « je ne sais pas » créerait un doublon dans la boutique d'un
   * marchand, à côté du brouillon qu'il est peut-être en train de relire. Le code doit
   * donc distinguer trois réponses, et le refus doit être le comportement par défaut.
   */
  it('distingue « disparu » de « je ne sais pas » avant d’autoriser un second dépôt', () => {
    const source = readFileSync('src/server/integrations/providers/shopify.ts', 'utf8')
    // Trois issues nommées, dont le « null » d'incertitude.
    expect(source).toContain('Promise<boolean | null>')

    const publication = readFileSync('src/server/commerce/publication.ts', 'utf8')
    /*
     * La condition est écrite « différent de false » et non « égal à true » : la nuance est
     * tout le test. `=== true` laisserait passer le cas inconnu.
     */
    expect(publication).toContain('encoreLa !== false')
    expect(publication).not.toMatch(/encoreLa\s*===\s*false/u)
  })

  it('ne fait qu’ajouter des fichiers, jamais en toucher d’autres', () => {
    const source = readFileSync('src/server/integrations/providers/shopify.ts', 'utf8')
    expect(source).toContain('fileCreate')
    // La relecture d'un fichier se limite à celui qu'on vient de créer, par son identifiant.
    expect(source).toContain('query($id: ID!)')
    expect(source).not.toMatch(/files\s*\(\s*query:/u)
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
