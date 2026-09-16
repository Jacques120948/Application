import { describe, expect, it } from 'vitest'
import { appRobots, appSitemap, evoliiaSitemap, PRIVATE_PATHS, sitemapXml } from '@/server/seo/sitemap'
import { SUPPORTED_LOCALES } from '@/i18n/config'
import { buildTemplate } from '@/server/spec/templates'

/**
 * Ce que les moteurs ont le droit de lire.
 *
 * Deux règles se vérifient ici plus qu'ailleurs : un brouillon ou une page réservée ne
 * doit jamais entrer dans un index, et une application ne doit être annoncée qu'à une
 * seule adresse — deux adresses feraient d'elle deux sites concurrents.
 */

const spec = buildTemplate('content', {
  name: 'Carnet de recettes',
  tagline: 'Les recettes de la maison, au même endroit',
  description: "Un carnet partagé où chacun dépose ses recettes et retrouve celles des autres.",
  locale: 'fr',
})
const publique = spec.pages.filter((page) => !page.requiresAuth)
const reservee = spec.pages.filter((page) => page.requiresAuth)

// Sans les deux sortes de pages, les vérifications ci-dessous passeraient à vide.
it('le modèle d’essai contient bien des pages publiques et des pages réservées', () => {
  expect(publique.length).toBeGreaterThan(0)
  expect(reservee.length).toBeGreaterThan(0)
})

describe('plan du site d’Evoliia', () => {
  const entrees = evoliiaSitemap('https://evoliia.com')

  it('annonce chaque page publique dans chaque langue', () => {
    expect(entrees.length).toBe(SUPPORTED_LOCALES.length * 6)
    expect(entrees.map((entree) => entree.url)).toContain('https://evoliia.com/fr')
    expect(entrees.map((entree) => entree.url)).toContain('https://evoliia.com/en/inscription')
  })

  it('n’annonce aucune page de l’atelier ni aucun aperçu', () => {
    const adresses = entrees.map((entree) => entree.url).join(' ')
    for (const prive of PRIVATE_PATHS) expect(adresses).not.toContain(`/${prive}`)
    expect(adresses).not.toContain('/preview/')
  })

  it('relie chaque page à ses traductions', () => {
    const accueil = entrees.find((entree) => entree.url === 'https://evoliia.com/fr')
    expect(Object.keys(accueil?.alternates?.languages ?? {})).toEqual([...SUPPORTED_LOCALES])
    expect(accueil?.alternates?.languages.de).toBe('https://evoliia.com/de')
  })

  it('supporte une adresse de base terminée par une barre oblique', () => {
    expect(evoliiaSitemap('https://evoliia.com/')[0]?.url).toBe('https://evoliia.com/fr')
  })
})

describe('plan du site d’une application', () => {
  const entrees = appSitemap(spec, 'carnet-a1b2c3', new Date('2026-09-16T00:00:00.000Z'))

  it('n’annonce que les pages publiques', () => {
    expect(entrees).toHaveLength(publique.length)
    for (const page of reservee) {
      expect(entrees.map((entree) => entree.url)).not.toContain(
        `http://localhost:3000/a/carnet-a1b2c3/${page.path}`,
      )
    }
  })

  it('annonce une seule adresse, celle qui fait foi', () => {
    // Sans domaine d'applications configuré, l'adresse canonique reste celle d'Evoliia.
    for (const entree of entrees) expect(entree.url).toContain('/a/carnet-a1b2c3/')
  })

  it('donne la date de la dernière publication', () => {
    expect(entrees[0]?.lastModified?.toISOString()).toBe('2026-09-16T00:00:00.000Z')
  })
})

describe('robots d’une application', () => {
  const texte = appRobots(spec, 'carnet-a1b2c3')

  it('laisse explorer l’application et désigne son plan', () => {
    expect(texte).toContain('User-agent: *')
    expect(texte).toContain('Allow: /')
    expect(texte).toContain('Sitemap: http://localhost:3000/a/carnet-a1b2c3/sitemap.xml')
  })

  it('tient les pages réservées hors de l’index', () => {
    for (const page of reservee) expect(texte).toContain(`Disallow: /${page.path}`)
    for (const page of publique) expect(texte).not.toContain(`Disallow: /${page.path}`)
  })
})

describe('rendu XML', () => {
  it('produit un document bien formé', () => {
    const xml = sitemapXml([
      {
        url: 'https://exemple.test/a',
        lastModified: new Date('2026-01-01T00:00:00.000Z'),
        changeFrequency: 'weekly',
        priority: 1,
      },
    ])
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<loc>https://exemple.test/a</loc>')
    expect(xml).toContain('<lastmod>2026-01-01T00:00:00.000Z</lastmod>')
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true)
  })

  it('échappe les caractères qui casseraient le document', () => {
    expect(sitemapXml([{ url: 'https://exemple.test/?a=1&b=2' }])).toContain('a=1&amp;b=2')
  })
})
