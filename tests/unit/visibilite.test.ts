import { describe, expect, it } from 'vitest'
import {
  appLlmsTxt,
  isIndexable,
  jsonLd,
  pageDescription,
  pageTitle,
  structuredData,
} from '@/server/seo/visibility'
import { appSpecSchema, type AppSpec, type Page } from '@/server/spec/schema'
import { buildTemplate } from '@/server/spec/templates'
import { HOME_PATH } from '@/server/spec/validate'

/**
 * Comment une application se présente aux moteurs.
 *
 * Quatre propriétés méritent un test, et chacune répond à une façon de se rendre invisible
 * ou de mentir sans le vouloir.
 *
 * **Chaque page se présente pour elle-même.** Douze pages au même titre, ce sont onze pages
 * qui ne seront trouvées sur rien.
 *
 * **On n'affirme que ce qui est déclaré.** Une donnée structurée inventée coûte plus cher
 * qu'une donnée structurée absente.
 *
 * **Une spécification ne peut pas refermer la balise qui la porte.** C'est la seule voie
 * par laquelle du texte de créateur pourrait devenir du code dans une page publiée.
 *
 * **Ce qui est hors index l'est partout.** Une page écartée du plan du site mais laissée
 * indexable dans ses propres balises serait écartée à moitié, donc pas du tout.
 */

const base = buildTemplate('content', {
  name: 'Carnet de recettes',
  tagline: 'Les recettes de la maison, au même endroit',
  description: 'Un carnet partagé où chacun dépose ses recettes et retrouve celles des autres.',
  locale: 'fr',
})

function accueil(spec: AppSpec): Page {
  const page = spec.pages.find((candidate) => candidate.path === HOME_PATH)
  if (page === undefined) throw new Error("le modèle d'essai n'a pas de page d'accueil")
  return page
}

describe('compatibilité ascendante', () => {
  it('valide une spécification écrite avant la visibilité', () => {
    // Le cas qui compte : les applications déjà publiées n'ont aucun de ces champs et
    // doivent continuer de se charger sans la moindre migration.
    expect(() => appSpecSchema.parse(base)).not.toThrow()
    expect(base.visibility).toBeUndefined()
  })

  it('refuse un champ de visibilité inconnu', () => {
    const spec = { ...base, visibility: { entityType: 'LocalBusiness', siret: '123' } }
    expect(() => appSpecSchema.parse(spec)).toThrow()
  })

  it('refuse un titre de page trop long pour être affiché en entier', () => {
    const page = { ...accueil(base), seo: { title: 'a'.repeat(71) } }
    const spec = { ...base, pages: [page, ...base.pages.slice(1)] }
    expect(() => appSpecSchema.parse(spec)).toThrow()
  })
})

describe('chaque page se présente pour elle-même', () => {
  it('donne à l’accueil le nom du site, et aux autres leur propre titre', () => {
    const autres = base.pages.filter((page) => page.path !== HOME_PATH)
    expect(pageTitle(base, accueil(base))).toBe(base.name)
    for (const page of autres) {
      expect(pageTitle(base, page)).toBe(`${page.title} · ${base.name}`)
    }
    // Deux pages ne doivent pas se présenter de la même façon.
    const titres = base.pages.map((page) => pageTitle(base, page))
    expect(new Set(titres).size).toBe(titres.length)
  })

  it('préfère ce que le créateur a écrit', () => {
    const page: Page = { ...accueil(base), seo: { title: 'Recettes de famille à Bulle' } }
    expect(pageTitle(base, page)).toBe('Recettes de famille à Bulle')
    // Sans description propre, l'accroche de l'application : imprécise, mais vraie.
    expect(pageDescription(base, page)).toBe(base.tagline)
  })
})

describe('ce qui reste hors des index', () => {
  it('écarte une page réservée et une page mise hors index', () => {
    const reservee = base.pages.find((page) => page.requiresAuth)
    expect(reservee).toBeDefined()
    expect(isIndexable(reservee as Page)).toBe(false)

    const publique = accueil(base)
    expect(isIndexable(publique)).toBe(true)
    expect(isIndexable({ ...publique, seo: { noindex: true } })).toBe(false)
  })
})

describe('on n’affirme que ce qui est déclaré', () => {
  it('n’émet aucune entité quand rien n’est renseigné', () => {
    const donnees = structuredData(base, 'carnet-a1b2c3', accueil(base))
    // `WebSite` est un fait : ce site existe, il porte ce nom, il répond à cette adresse.
    expect(donnees.map((donnee) => donnee['@type'])).toEqual(['WebSite'])
  })

  it('décrit l’entreprise une fois qu’elle est déclarée', () => {
    const spec: AppSpec = {
      ...base,
      visibility: {
        entityType: 'LocalBusiness',
        legalName: 'Chez Mireille Sàrl',
        address: { locality: 'Bulle', postalCode: '1630', country: 'CH' },
        phone: '+41 26 912 00 00',
        areaServed: ['Bulle', 'la Gruyère'],
        sameAs: ['https://www.facebook.com/chezmireille'],
      },
    }
    const donnees = structuredData(spec, 'carnet-a1b2c3', accueil(spec))
    const entite = donnees.find((donnee) => donnee['@type'] === 'LocalBusiness')
    expect(entite).toMatchObject({
      name: 'Carnet de recettes',
      legalName: 'Chez Mireille Sàrl',
      telephone: '+41 26 912 00 00',
      address: { '@type': 'PostalAddress', addressLocality: 'Bulle', addressCountry: 'CH' },
    })
    // Les clés vides ne sont pas émises : une fiche à moitié remplie se lit mal.
    expect(entite).not.toHaveProperty('email')
  })

  it('ne fait pas passer les faits du créateur pour des données vérifiées', () => {
    const spec: AppSpec = {
      ...base,
      visibility: { entityType: 'LocalBusiness', facts: ['Ouvert depuis 1998.'] },
    }
    const donnees = structuredData(spec, 'carnet-a1b2c3', accueil(spec))
    // Ils n'ont rien à faire dans schema.org, où aucun robot ne peut les recouper.
    expect(JSON.stringify(donnees)).not.toContain('1998')
    // Leur place est le fichier des machines, où ils sont lus comme des affirmations.
    expect(appLlmsTxt(spec, 'carnet-a1b2c3')).toContain('Ouvert depuis 1998.')
  })
})

describe('une spécification ne devient jamais du code', () => {
  it('échappe ce qui refermerait la balise', () => {
    const spec: AppSpec = {
      ...base,
      name: '</script><script>alert(1)</script>',
      visibility: { entityType: 'Organization' },
    }
    const rendu = jsonLd(structuredData(spec, 'carnet-a1b2c3', accueil(spec)))
    expect(rendu).not.toContain('</script>')
    expect(rendu).not.toContain('<')
    expect(rendu).not.toContain('>')
    // La donnée reste intacte : c'est l'écriture qui change, pas le contenu.
    const relu = JSON.parse(rendu) as Array<{ name?: string }> | { name?: string }
    const premier = Array.isArray(relu) ? relu[0] : relu
    expect(premier?.name).toBe('</script><script>alert(1)</script>')
  })
})

describe('le fichier destiné aux machines', () => {
  it('annonce le site, son identité et ses pages ouvertes', () => {
    const spec: AppSpec = {
      ...base,
      visibility: {
        entityType: 'LocalBusiness',
        address: { locality: 'Bulle', country: 'CH' },
        areaServed: ['la Gruyère'],
      },
    }
    const texte = appLlmsTxt(spec, 'carnet-a1b2c3')
    expect(texte.startsWith(`# ${spec.name}`)).toBe(true)
    expect(texte).toContain(spec.tagline)
    expect(texte).toContain('Bulle')
    expect(texte).toContain('la Gruyère')
    for (const page of spec.pages.filter(isIndexable)) {
      expect(texte).toContain(page.title)
    }
  })

  it('n’annonce jamais une page réservée', () => {
    const reservees = base.pages.filter((page) => page.requiresAuth)
    const texte = appLlmsTxt(base, 'carnet-a1b2c3')
    expect(reservees.length).toBeGreaterThan(0)
    for (const page of reservees) {
      expect(texte).not.toContain(`/${page.path})`)
    }
  })
})
