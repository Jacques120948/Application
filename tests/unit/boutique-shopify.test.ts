import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  frapperJeton,
  lireAcces,
  decoderEntites,
  lireProduits,
  normaliserBoutique,
  ressembleAUnIdentifiant,
  verifyShopifyToken,
} from '@/server/integrations/providers/shopify'
import { jugerBalise } from '@/server/commerce/boutique'
import { BORNES_BALISES } from '@/server/audit/checks/seo'
import { findProvider } from '@/server/integrations/catalog'
import { findVerifier } from '@/server/integrations/verify'

/**
 * La lecture d'une boutique Shopify. Aucun appel réseau réel.
 *
 * Quatre propriétés méritent un test, et chacune répond à une façon de casser chez un
 * marchand sans qu'on s'en aperçoive ici.
 *
 * **L'adresse est acceptée telle qu'on la colle.** Personne ne tape une adresse
 * `.myshopify.com` de tête : on la copie depuis l'administrateur, avec son protocole et sa
 * barre finale, ou on ne retient que le nom.
 *
 * **Aucun format d'identifiant n'est exigé.** L'erreur a déjà été commise ici avec une clé
 * Google dont le format avait changé : le contrôle rejetait une clé parfaitement valide.
 *
 * **La version d'API se renégocie.** Shopify retire ses versions au bout d'un an. Sans
 * renégociation, le connecteur cesserait de marcher un jour, chez tout le monde en même
 * temps, avec un message que personne ne peut interpréter.
 *
 * **Le jeton se frappe, il ne se conserve pas.** Shopify a retiré la création
 * d'applications personnalisées depuis l'administrateur : le jeton permanent qu'on collait
 * n'existe plus. On conserve des identifiants, et on en tire un jeton de vingt-quatre heures
 * à chaque lecture.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Répond une fois par entrée de la liste, dans l'ordre. */
function stubFetch(reponses: readonly { status: number; body: unknown }[]) {
  let rang = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const reponse = reponses[Math.min(rang, reponses.length - 1)]
      rang += 1
      return new Response(JSON.stringify(reponse?.body ?? {}), {
        status: reponse?.status ?? 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

function appels(): { url: string; init: RequestInit }[] {
  const mock = (globalThis.fetch as unknown as { mock?: { calls: [string, RequestInit][] } }).mock
  return (mock?.calls ?? []).map(([url, init]) => ({ url, init }))
}

const JETON_OK = { status: 200, body: { access_token: 'shpat_frappe_pour_cette_lecture' } }

const BOUTIQUE_OK = {
  status: 200,
  body: {
    data: {
      shop: {
        name: 'Cap-Nature',
        myshopifyDomain: 'contact-347.myshopify.com',
        primaryDomain: { host: 'cap-nature.ch' },
      },
    },
  },
}

describe('l’adresse de la boutique', () => {
  it('accepte ce que les gens collent réellement', () => {
    const attendu = 'ma-boutique.myshopify.com'
    expect(normaliserBoutique('ma-boutique.myshopify.com')).toBe(attendu)
    expect(normaliserBoutique('https://ma-boutique.myshopify.com')).toBe(attendu)
    expect(normaliserBoutique('https://ma-boutique.myshopify.com/admin')).toBe(attendu)
    expect(normaliserBoutique('  MA-BOUTIQUE.myshopify.com  ')).toBe(attendu)
    // Le seul nom de la boutique : c'est ce que beaucoup retiennent.
    expect(normaliserBoutique('ma-boutique')).toBe(attendu)
  })

  it('refuse ce qui n’est pas une boutique, plutôt que d’en bricoler une', () => {
    expect(normaliserBoutique('')).toBeNull()
    expect(normaliserBoutique('   ')).toBeNull()
    expect(normaliserBoutique('-mauvais-debut')).toBeNull()
    expect(normaliserBoutique('avec espace')).toBeNull()
    expect(normaliserBoutique('pas_un_nom!')).toBeNull()
  })
})

const IDS = { boutique: 'contact-347', clientId: '0123456789abcdef0123456789abcdef' }
const SECRET = 'fedcba9876543210fedcba9876543210'

describe('les identifiants', () => {
  it('n’exigent aucun format précis', () => {
    /*
     * L'erreur a déjà été commise dans ce dépôt, sur une clé Google : le contrôle exigeait
     * un préfixe, le fournisseur a changé de format, et des clés valides ont été rejetées
     * avec un message affirmant qu'elles n'en étaient pas.
     */
    expect(ressembleAUnIdentifiant('0123456789abcdef0123456789abcdef')).toBe(true)
    expect(ressembleAUnIdentifiant('un-format-que-shopify-inventera-en-2030')).toBe(true)
    expect(ressembleAUnIdentifiant('trop-court')).toBe(false)
    expect(ressembleAUnIdentifiant('avec un espace dedans aaaaaaaaaa')).toBe(false)
  })

  it('n’appellent pas Shopify quand la saisie ne peut pas marcher', async () => {
    stubFetch([JETON_OK, BOUTIQUE_OK])
    expect(
      await verifyShopifyToken(SECRET, { ...IDS, boutique: 'pas une adresse' }),
    ).toMatchObject({ ok: false })
    expect(await verifyShopifyToken('court', IDS)).toMatchObject({ ok: false })
    expect(await verifyShopifyToken(SECRET, { ...IDS, clientId: 'court' })).toMatchObject({
      ok: false,
    })
    expect(appels()).toHaveLength(0)
  })
})

describe('la connexion', () => {
  it('frappe un jeton, lit la boutique, et tire son indice du secret client', async () => {
    stubFetch([JETON_OK, BOUTIQUE_OK])
    const verdict = await verifyShopifyToken(SECRET, IDS)

    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.label).toBe('Cap-Nature · cap-nature.ch')

    /*
     * Ce qui est conservé est le triplet : des identifiants seuls ne disent pas à quelle
     * boutique ils s'appliquent.
     */
    const acces = lireAcces(verdict.secret ?? '')
    expect(acces?.boutique).toBe('contact-347.myshopify.com')
    expect(acces?.clientId).toBe(IDS.clientId)
    expect(acces?.clientSecret).toBe(SECRET)
    // Aucun jeton frappé n'est conservé : il vaut vingt-quatre heures et se redemande.
    expect(verdict.secret).not.toContain('shpat_')

    /*
     * L'indice porte sur le secret client. Tiré de l'accès entier, il finirait par « "} » —
     * quatre signes qui ne diraient rien à personne.
     */
    expect(verdict.hint).toBe(SECRET)

    // Deux appels : l'échange d'identifiants, puis la lecture avec le jeton frappé.
    const [echange, lecture] = appels()
    expect(echange?.url).toBe('https://contact-347.myshopify.com/admin/oauth/access_token')
    expect(String(echange?.init.body)).toContain('client_credentials')
    expect(lecture?.url).toBe('https://contact-347.myshopify.com/admin/api/2026-07/graphql.json')
    // Le secret ne sert qu'à l'échange : il ne repart pas avec les requêtes de lecture.
    expect(String(lecture?.init.body)).not.toContain(SECRET)
  })

  it('renégocie la version d’API quand celle qu’on connaît a été retirée', async () => {
    /*
     * Shopify publie une version par trimestre et retire les anciennes au bout d'un an. Sans
     * cette renégociation, le connecteur cesserait de marcher un jour chez tout le monde en
     * même temps, avec une erreur que personne ne peut corriger de son côté.
     */
    stubFetch([
      JETON_OK,
      { status: 404, body: {} },
      {
        status: 200,
        body: {
          data: {
            publicApiVersions: [
              { handle: '2026-04', supported: true },
              { handle: '2027-01', supported: true },
              { handle: 'unstable', supported: false },
              // Une version plus récente mais non supportée ne doit pas être choisie.
              { handle: '2027-04', supported: false },
            ],
          },
        },
      },
      BOUTIQUE_OK,
    ])

    const verdict = await verifyShopifyToken(SECRET, IDS)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return

    expect(lireAcces(verdict.secret ?? '')?.version).toBe('2027-01')
    expect(appels()[3]?.url).toContain('/admin/api/2027-01/')
  })

  it('traduit un refus de Shopify sans jamais citer le secret', async () => {
    /*
     * Un refus d'identifiants ne passe pas par GraphQL : la couche d'administration répond
     * avant, et rend « error » comme chaîne et non comme liste. Supposer la liste faisait
     * échouer la lecture et annonçait « Shopify injoignable » — le mauvais diagnostic sur
     * la panne la plus courante.
     */
    stubFetch([{ status: 401, body: { error: 'invalid_client' } }])
    const verdict = await verifyShopifyToken(SECRET, IDS)

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toContain('refuse ces identifiants')
    expect(verdict.reason).not.toContain(SECRET)
  })

  it('frappe un jeton neuf à chaque lecture, sans en conserver aucun', async () => {
    stubFetch([JETON_OK])
    const frappe = await frapperJeton({
      boutique: 'contact-347.myshopify.com',
      clientId: IDS.clientId,
      clientSecret: SECRET,
      version: '2026-07',
    })
    expect(frappe.ok).toBe(true)
    if (!frappe.ok) return
    expect(frappe.jeton).toBe('shpat_frappe_pour_cette_lecture')

    const envoye = JSON.parse(String(appels()[0]?.init.body)) as Record<string, string>
    expect(envoye.grant_type).toBe('client_credentials')
    expect(envoye.client_id).toBe(IDS.clientId)
    expect(envoye.client_secret).toBe(SECRET)
  })
})

describe('l’accès conservé', () => {
  it('ne fait pas tomber l’écran quand il est abîmé', () => {
    expect(lireAcces('pas du json')).toBeNull()
    expect(lireAcces('{}')).toBeNull()
    expect(lireAcces(JSON.stringify({ boutique: 'x', clientId: 42 }))).toBeNull()
    /*
     * Une connexion au format révolu — un jeton permanent, du temps où Shopify en délivrait —
     * est écartée plutôt que rafistolée : elle ne peut plus frapper de jeton, et l'écran
     * demandera une reconnexion.
     */
    expect(lireAcces(JSON.stringify({ boutique: 'contact-347', jeton: 'shpat_x' }))).toBeNull()
    // Une connexion sans version stockée retombe sur celle qu'on connaît.
    const ancien = lireAcces(
      JSON.stringify({ boutique: 'contact-347', clientId: 'a'.repeat(32), clientSecret: 'b'.repeat(32) }),
    )
    expect(ancien?.version).toBe('2026-07')
  })
})

describe('la lecture des fiches', () => {
  it('suit la pagination et dit ce qu’elle a tronqué', async () => {
    const page = (nodes: number, encore: boolean) => ({
      status: 200,
      body: {
        data: {
          products: {
            nodes: Array.from({ length: nodes }, (_, rang) => ({
              id: `gid://shopify/Product/${rang}`,
              title: `Produit ${rang}`,
              handle: `produit-${rang}`,
              status: 'ACTIVE',
              onlineStoreUrl: null,
              apercu: rang === 0 ? '' : 'Un descriptif\u2026',
              seo: { title: null, description: null },
            })),
            pageInfo: { hasNextPage: encore, endCursor: 'suite' },
          },
        },
      },
    })

    const acces = {
      boutique: 'contact-347.myshopify.com',
      clientId: IDS.clientId,
      clientSecret: SECRET,
      version: '2026-07',
    }

    stubFetch([page(2, true), page(2, false)])
    const lu = await lireProduits(acces, 'shpat_frappe', 4)
    expect(lu.pieces).toHaveLength(4)
    expect(lu.tronque).toBe(false)
    /*
     * Le descriptif n'est pas rapatrié : on ne garde que la réponse à la seule question
     * qu'on lui pose. Tiré en entier sur mille fiches, il ferait plusieurs mégaoctets —
     * l'erreur qui a arrêté l'exploration de sites à deux cent quatre-vingt-sept pages.
     */
    expect(lu.pieces[0]?.descriptionVide).toBe(true)
    expect(lu.pieces[1]?.descriptionVide).toBe(false)

    stubFetch([page(2, true)])
    const borne = await lireProduits(acces, 'shpat_frappe', 2)
    expect(borne.pieces).toHaveLength(2)
    expect(borne.tronque).toBe(true)
  })
})

describe('les entités des balises', () => {
  it('rend le texte tel qu’un moteur le lira', () => {
    /*
     * Vu en production : une description contenant « Pirate &amp; Coccinelle » s'affichait
     * telle quelle à l'écran, ce qui fait douter de tout le reste — et surtout comptait
     * quatre signes de trop par esperluette. À cent soixante-deux signes affichés contre
     * cent cinquante-huit réels, on est de part et d'autre de la borne, donc de part et
     * d'autre du verdict.
     */
    expect(decoderEntites('Pirate &amp; Coccinelle')).toBe('Pirate & Coccinelle')
    expect(decoderEntites('L&#39;atelier')).toBe('L\u2019atelier'.replace('\u2019', "'"))
    expect(decoderEntites('30&#x20ac; la pièce')).toBe('30\u20ac la pièce')
    expect(decoderEntites('caf&eacute;')).toBe('café')
  })

  it('ne décode qu’une fois, et laisse tel quel ce qu’il ne connaît pas', () => {
    // `&amp;amp;` rend `&amp;` : c'est ce que le visiteur verra, et non `&`.
    expect(decoderEntites('&amp;amp;')).toBe('&amp;')
    expect(decoderEntites('&pasuneentite; reste')).toBe('&pasuneentite; reste')
    // Une moitié de paire de substitution ferait lever `fromCodePoint` : on la laisse.
    expect(decoderEntites('&#xD800;')).toBe('&#xD800;')
    expect(decoderEntites('&#0;')).toBe('&#0;')
  })
})

describe('le jugement d’une balise', () => {
  it('distingue une balise vide d’une balise courte', () => {
    /*
     * L'une se remplit, l'autre se reprend. Les confondre rangerait cent fiches jamais
     * renseignées avec trois fiches perfectibles.
     */
    const bornes = { min: BORNES_BALISES.descriptionMin, max: BORNES_BALISES.descriptionMax }
    expect(jugerBalise('', bornes)).toBe('manquant')
    expect(jugerBalise('   ', bornes)).toBe('manquant')
    expect(jugerBalise('Trop court.', bornes)).toBe('court')
    expect(jugerBalise('x'.repeat(BORNES_BALISES.descriptionMax + 1), bornes)).toBe('long')
    expect(jugerBalise('x'.repeat(BORNES_BALISES.descriptionMin), bornes)).toBeNull()
  })

  it('juge une description tronquée par un thème, comme celles vues en production', () => {
    /*
     * Cas réel : un thème remplit la balise en coupant le descriptif et en collant le nom de
     * la boutique à la fin. Cent soixante-huit signes, phrase coupée en plein milieu.
     */
    const fabriquee =
      'Ce cabas en velours est à la fois spacieux et élégant, conçu pour celles qui aiment allier style et fonctionnalité. Son design raffiné et ses détails  - Cap-Nature'
    expect(fabriquee.length).toBeGreaterThan(BORNES_BALISES.descriptionMax)
    expect(
      jugerBalise(fabriquee, {
        min: BORNES_BALISES.descriptionMin,
        max: BORNES_BALISES.descriptionMax,
      }),
    ).toBe('long')
  })
})

describe('la fiche du catalogue', () => {
  it('ne demande qu’une seule autorisation d’écriture, et sans coût pour Evoliia', () => {
    const shopify = findProvider('shopify')
    expect(shopify).toBeDefined()
    if (shopify === undefined) return

    // La règle du produit : un marchand de plus ne doit pas créer un coût de plus.
    expect(shopify.costToEvoliia).toBe('aucun')
    /*
     * Une application n'accorde que ce qui a été coché, et ce qui est coché ici sera accordé
     * pour de bon. `write_content` sert à déposer un brouillon d'article — rien d'autre.
     * Toute portée d'écriture supplémentaire élargirait ce qu'Evoliia pourrait faire dans la
     * boutique de quelqu'un, et c'est une décision qui ne se prend pas en passant.
     */
    expect(shopify.scopes).toEqual(['read_products', 'read_content', 'write_content'])
    expect(shopify.scopes.filter((scope) => scope.startsWith('write_'))).toEqual([
      'write_content',
    ])
    /*
     * Les deux champs supplémentaires sont déclarés : sans eux, l'écran ne demanderait ni la
     * boutique ni l'identifiant client, et la connexion n'aurait nulle part où s'appliquer.
     */
    expect(shopify.extraFields?.map((champ) => champ.name)).toEqual(['boutique', 'clientId'])
    expect(findVerifier('shopify')).toBeDefined()
  })
})
