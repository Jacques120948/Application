import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  lireAcces,
  lireProduits,
  normaliserBoutique,
  ressembleAUnJeton,
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
 * **Aucun préfixe de jeton n'est exigé.** L'erreur a déjà été commise ici avec une clé
 * Google dont le format avait changé : le contrôle rejetait une clé parfaitement valide.
 *
 * **La version d'API se renégocie.** Shopify retire ses versions au bout d'un an. Sans
 * renégociation, le connecteur cesserait de marcher un jour, chez tout le monde en même
 * temps, avec un message que personne ne peut interpréter.
 *
 * **Le jeton ne sort jamais.** Ni dans un libellé, ni dans un indice complet, ni ailleurs
 * que dans l'en-tête de la requête.
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

describe('le jeton', () => {
  it('n’exige aucun préfixe', () => {
    /*
     * L'erreur a déjà été commise dans ce dépôt, sur une clé Google : le contrôle exigeait
     * un préfixe, le fournisseur a changé de format, et des clés valides ont été rejetées
     * avec un message affirmant qu'elles n'en étaient pas.
     */
    expect(ressembleAUnJeton('shpat_0123456789abcdef0123')).toBe(true)
    expect(ressembleAUnJeton('un-format-que-shopify-inventera-en-2030')).toBe(true)
    expect(ressembleAUnJeton('trop-court')).toBe(false)
    expect(ressembleAUnJeton('avec un espace dedans aaaaaaaaaa')).toBe(false)
  })

  it('n’appelle pas Shopify quand la saisie ne peut pas marcher', async () => {
    stubFetch([BOUTIQUE_OK])
    expect(await verifyShopifyToken('shpat_0123456789abcdef0123', 'pas une adresse')).toMatchObject({
      ok: false,
    })
    expect(await verifyShopifyToken('court', 'ma-boutique.myshopify.com')).toMatchObject({
      ok: false,
    })
    expect(appels()).toHaveLength(0)
  })
})

describe('la connexion', () => {
  it('rend le nom de la boutique, et un indice tiré du jeton et non de l’accès entier', async () => {
    stubFetch([BOUTIQUE_OK])
    const verdict = await verifyShopifyToken('shpat_0123456789abcdefWXYZ', 'contact-347')

    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.label).toBe('Cap-Nature · cap-nature.ch')

    // Ce qui est conservé est la paire : un jeton seul ne dirait pas quelle boutique ouvrir.
    const acces = lireAcces(verdict.secret ?? '')
    expect(acces?.boutique).toBe('contact-347.myshopify.com')
    expect(acces?.jeton).toBe('shpat_0123456789abcdefWXYZ')

    /*
     * L'indice porte sur le jeton. Tiré de l'accès entier, il finirait par « "} » — quatre
     * signes qui ne diraient rien à personne.
     */
    expect(verdict.hint).toBe('shpat_0123456789abcdefWXYZ')

    // Le jeton voyage dans l'en-tête, et nulle part ailleurs.
    const [appel] = appels()
    expect(appel?.url).toBe('https://contact-347.myshopify.com/admin/api/2026-07/graphql.json')
    expect(String(appel?.init.body)).not.toContain('shpat_')
  })

  it('renégocie la version d’API quand celle qu’on connaît a été retirée', async () => {
    /*
     * Shopify publie une version par trimestre et retire les anciennes au bout d'un an. Sans
     * cette renégociation, le connecteur cesserait de marcher un jour chez tout le monde en
     * même temps, avec une erreur que personne ne peut corriger de son côté.
     */
    stubFetch([
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

    const verdict = await verifyShopifyToken('shpat_0123456789abcdef0123', 'contact-347')
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return

    expect(lireAcces(verdict.secret ?? '')?.version).toBe('2027-01')
    expect(appels()[2]?.url).toContain('/admin/api/2027-01/')
  })

  it('traduit un refus de Shopify sans jamais citer le jeton', async () => {
    stubFetch([{ status: 401, body: { errors: 'Invalid API key or access token' } }])
    const verdict = await verifyShopifyToken('shpat_0123456789abcdefSECRET', 'contact-347')

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toContain('refuse ce jeton')
    expect(verdict.reason).not.toContain('SECRET')
  })
})

describe('l’accès conservé', () => {
  it('ne fait pas tomber l’écran quand il est abîmé', () => {
    expect(lireAcces('pas du json')).toBeNull()
    expect(lireAcces('{}')).toBeNull()
    expect(lireAcces(JSON.stringify({ boutique: 'x', jeton: 42 }))).toBeNull()
    // Une connexion antérieure à la version stockée retombe sur celle qu'on connaît.
    const ancien = lireAcces(JSON.stringify({ boutique: 'contact-347', jeton: 'shpat_x' }))
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
              descriptionHtml: '<p>Un descriptif.</p>',
              seo: { title: null, description: null },
            })),
            pageInfo: { hasNextPage: encore, endCursor: 'suite' },
          },
        },
      },
    })

    stubFetch([page(2, true), page(2, false)])
    const lu = await lireProduits(
      { boutique: 'contact-347.myshopify.com', jeton: 'shpat_x', version: '2026-07' },
      4,
    )
    expect(lu.pieces).toHaveLength(4)
    expect(lu.tronque).toBe(false)
    // Le descriptif n'est pas recopié : seule sa longueur, balises retirées, est gardée.
    expect(lu.pieces[0]?.descriptionLongueur).toBe('Un descriptif.'.length)

    stubFetch([page(2, true)])
    const borne = await lireProduits(
      { boutique: 'contact-347.myshopify.com', jeton: 'shpat_x', version: '2026-07' },
      2,
    )
    expect(borne.pieces).toHaveLength(2)
    expect(borne.tronque).toBe(true)
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
  it('déclare une connexion en lecture seule, sans coût pour Evoliia', () => {
    const shopify = findProvider('shopify')
    expect(shopify).toBeDefined()
    if (shopify === undefined) return

    // La règle du produit : un marchand de plus ne doit pas créer un coût de plus.
    expect(shopify.costToEvoliia).toBe('aucun')
    // Aucune autorisation d'écriture n'est demandée : un jeton accorde ce qui a été coché.
    expect(shopify.scopes).toEqual(['read_products', 'read_content'])
    expect(shopify.scopes.some((scope) => scope.startsWith('write_'))).toBe(false)
    // Le second champ est déclaré : sans lui, l'écran ne demanderait pas la boutique.
    expect(shopify.accountHelp).toBeDefined()
    expect(findVerifier('shopify')).toBeDefined()
  })
})
