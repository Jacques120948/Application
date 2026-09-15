import { afterEach, describe, expect, it } from 'vitest'
import {
  appBasePath,
  appHost,
  appsDomain,
  publicAppUrl,
  servedFromAppHost,
  slugFromHost,
} from '@/lib/apps-domain'
import { slugify } from '@/server/projects/service'

/**
 * L'adresse propre d'une application.
 *
 * Deux invariants tiennent cette fonction debout, et ce sont eux qu'on vérifie ici :
 * sans domaine configuré rien ne change du tout, et un hôte qui n'est pas exactement
 * `<nom-court>.<domaine>` ne désigne jamais une application.
 */

const DOMAINE = 'evoliia.app'

function avecDomaine<T>(valeur: string | undefined, faire: () => T): T {
  const avant = process.env.APPS_DOMAIN
  if (valeur === undefined) delete process.env.APPS_DOMAIN
  else process.env.APPS_DOMAIN = valeur
  try {
    return faire()
  } finally {
    if (avant === undefined) delete process.env.APPS_DOMAIN
    else process.env.APPS_DOMAIN = avant
  }
}

afterEach(() => {
  delete process.env.APPS_DOMAIN
})

describe('adresse propre d’une application', () => {
  it('ne change rien tant qu’aucun domaine n’est configuré', () => {
    avecDomaine(undefined, () => {
      expect(appsDomain()).toBeNull()
      expect(appHost('mon-appli-a1b2c3')).toBeNull()
      expect(slugFromHost('mon-appli-a1b2c3.evoliia.app')).toBeNull()
      expect(appBasePath('mon-appli-a1b2c3.evoliia.app', 'mon-appli-a1b2c3')).toBe('/a/mon-appli-a1b2c3')
      expect(publicAppUrl('mon-appli-a1b2c3')).toMatch(/\/a\/mon-appli-a1b2c3$/)
    })
  })

  it('sert l’application à la racine de son sous-domaine', () => {
    avecDomaine(DOMAINE, () => {
      expect(appHost('mon-appli-a1b2c3')).toBe('mon-appli-a1b2c3.evoliia.app')
      expect(slugFromHost('mon-appli-a1b2c3.evoliia.app')).toBe('mon-appli-a1b2c3')
      expect(servedFromAppHost('mon-appli-a1b2c3.evoliia.app', 'mon-appli-a1b2c3')).toBe(true)
      expect(appBasePath('mon-appli-a1b2c3.evoliia.app', 'mon-appli-a1b2c3')).toBe('')
    })
  })

  it('garde l’ancienne adresse valable quand la requête arrive sur le domaine partagé', () => {
    avecDomaine(DOMAINE, () => {
      expect(slugFromHost('evoliia.com')).toBeNull()
      expect(appBasePath('evoliia.com', 'mon-appli-a1b2c3')).toBe('/a/mon-appli-a1b2c3')
    })
  })

  it('refuse tout hôte qui n’est pas exactement un sous-domaine du domaine', () => {
    avecDomaine(DOMAINE, () => {
      // Le domaine nu n'est pas une application.
      expect(slugFromHost('evoliia.app')).toBeNull()
      // Un niveau de plus non plus : « a.b.evoliia.app » n'est le nom court de personne.
      expect(slugFromHost('a.b.evoliia.app')).toBeNull()
      // Un domaine qui se termine par les mêmes lettres sans le point est étranger.
      expect(slugFromHost('fauxevoliia.app')).toBeNull()
      // Un hôte d'un autre domaine, même bien formé.
      expect(slugFromHost('mon-appli.exemple.test')).toBeNull()
      expect(slugFromHost(null)).toBeNull()
      expect(slugFromHost('')).toBeNull()
    })
  })

  it('lit l’hôte sans se laisser tromper par le port ni par les majuscules', () => {
    avecDomaine(DOMAINE, () => {
      expect(slugFromHost('Mon-Appli-A1B2C3.Evoliia.App:3000')).toBe('mon-appli-a1b2c3')
    })
  })

  it('refuse une étiquette qui ne serait pas un nom d’hôte valide', () => {
    avecDomaine(DOMAINE, () => {
      expect(slugFromHost('-debut.evoliia.app')).toBeNull()
      expect(slugFromHost('fin-.evoliia.app')).toBeNull()
      expect(slugFromHost('avec_underscore.evoliia.app')).toBeNull()
      expect(slugFromHost(`${'x'.repeat(64)}.evoliia.app`)).toBeNull()
    })
  })

  /*
   * L'invariant qui rend la fonction sûre sans champ ni migration : tout nom court produit
   * par la plateforme est déjà une étiquette de nom d'hôte valide. Si `slugify` changeait,
   * ce test tomberait avant que des adresses cassées n'atteignent la production.
   */
  it('accepte tout nom court que la plateforme sait produire', () => {
    avecDomaine(DOMAINE, () => {
      const exemples = [
        'Mes Recettes Faciles',
        'Lueur d’Événement',
        'Über Café & Thé',
        'a',
        '???',
        'Un nom vraiment très long qui dépasse largement la limite fixée par la plateforme',
      ]
      for (const nom of exemples) {
        const court = `${slugify(nom)}-a1b2c3`
        expect(slugFromHost(`${court}.${DOMAINE}`)).toBe(court)
      }
    })
  })
})
