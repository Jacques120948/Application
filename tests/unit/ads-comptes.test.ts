import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findProvider } from '@/server/integrations/catalog'
import { googleAds } from '@/server/ads/google-ads'
import { PORTEES } from '@/server/ads/google-ads'

/**
 * La connexion Google Ads, et la promesse qu'elle engage.
 *
 * Ce qui est vérifié ici n'est pas le bon fonctionnement d'un appel réseau — il se voit à
 * l'usage — mais deux propriétés qui, si elles se perdent, se perdent en silence.
 */
describe('le connecteur Google Ads', () => {
  it('ne contient aucune fonction d’écriture', () => {
    /*
     * La garantie du produit, et elle ne peut pas venir de Google : la portée `adwords`
     * ouvre l'écriture, et il n'en existe pas de version en lecture seule. Ce qui empêche
     * Evoliia de modifier une campagne aujourd'hui, c'est qu'aucune fonction ne sait le
     * faire. Le jour où le mode assisté en ajoutera une, ce test échouera — et c'est
     * exactement ce qu'on veut : que cette ligne soit franchie sciemment.
     */
    const source = readFileSync('src/server/ads/google-ads.ts', 'utf8')
    for (const ecriture of [':mutate', 'mutateCampaign', 'campaignBudgets:mutate', 'POST /v']) {
      expect(source).not.toContain(ecriture)
    }
    // Les seules opérations connues sont des lectures.
    expect(source).toContain('googleAds:searchStream')
    expect(source).toContain('customers:listAccessibleCustomers')
  })

  it('demande une seule portée, et la déclare telle quelle au catalogue', () => {
    /*
     * La fiche du catalogue est ce que la personne lit avant de cliquer. Si elle annonçait
     * moins que ce que le code demande, elle mentirait — et l'écran de consentement de
     * Google la contredirait trois secondes plus tard.
     */
    expect(PORTEES).toEqual(['https://www.googleapis.com/auth/adwords'])
    expect(findProvider('google-ads')?.scopes).toEqual([...PORTEES])
  })

  it('n’exige plus de jeton développeur pour s’ouvrir', () => {
    /*
     * Google les a supprimés le 9 septembre 2026. En faire une condition d'ouverture
     * fermerait la connexion pour tout le monde, au motif d'un jeton que plus personne ne
     * peut obtenir.
     */
    const source = readFileSync('src/server/ads/google-ads.ts', 'utf8')
    expect(source).toContain('export function estConfigureAds')
    const bloc = source.slice(source.indexOf('export function estConfigureAds'))
    expect(bloc.slice(0, 300)).not.toContain('googleAdsDeveloperToken')
  })

  it('annonce la plateforme sous un nom stable', () => {
    expect(googleAds.id).toBe('google-ads')
    expect(findProvider(googleAds.id)?.status).toBe('available')
  })
})
