import { describe, expect, it } from 'vitest'
import { isPrivateAddress, parseTargetUrl } from '@/server/audit/net'

/**
 * La porte d'entrée du crawler.
 *
 * C'est le seul endroit du produit où Evoliia émet une requête vers une adresse choisie par
 * quelqu'un d'autre. Tout ce qui passe ici sans être vérifié devient une façon d'atteindre,
 * depuis l'extérieur, ce que seul le serveur peut joindre — la base de données, les services
 * internes de l'hébergeur, et l'adresse où un fournisseur de cloud range les jetons de la
 * machine.
 *
 * Les cas listés plus bas ne sont pas théoriques : ce sont les contournements ordinaires,
 * ceux qu'on trouve dans n'importe quel guide. Un filtre qui ne les couvre pas ne filtre
 * rien.
 */

describe('les adresses que le serveur ne doit pas joindre', () => {
  it('refuse la boucle locale, le privé, le lien-local et les métadonnées d’instance', () => {
    const interdites = [
      '127.0.0.1',
      '127.1.2.3',
      '0.0.0.0',
      '10.0.0.7',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      // Celle-ci en particulier : c'est là que vivent les jetons d'identité de la machine.
      '169.254.169.254',
      '100.64.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      // Une adresse privée habillée en v6 reste une adresse privée.
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
    ]
    for (const adresse of interdites) {
      expect(isPrivateAddress(adresse), adresse).toBe(true)
    }
  })

  it('laisse passer les adresses publiques ordinaires', () => {
    for (const adresse of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(adresse), adresse).toBe(false)
    }
  })

  it('refuse ce qui n’est pas une adresse', () => {
    // Le doute ne profite jamais à la requête.
    for (const valeur of ['', 'localhost', 'pas-une-adresse', '999.999.999.999']) {
      expect(isPrivateAddress(valeur), valeur).toBe(true)
    }
  })
})

describe('les adresses acceptées en entrée', () => {
  it('accepte une adresse de site ordinaire', () => {
    expect(parseTargetUrl('https://monsite.ch').hostname).toBe('monsite.ch')
    expect(parseTargetUrl('  https://monsite.ch/boutique  ').pathname).toBe('/boutique')
  })

  it('retire l’ancre : deux adresses qui ne diffèrent que par elle sont la même page', () => {
    expect(parseTargetUrl('https://monsite.ch/a#contact').toString()).toBe('https://monsite.ch/a')
  })

  it('refuse les protocoles qui ne sont pas du web', () => {
    for (const adresse of [
      'file:///etc/passwd',
      'ftp://monsite.ch',
      'gopher://monsite.ch',
      'data:text/html,<h1>',
      'javascript:alert(1)',
    ]) {
      expect(() => parseTargetUrl(adresse), adresse).toThrow()
    }
  })

  it('refuse une adresse IP écrite en clair', () => {
    // C'est le chemin le plus court vers un service interne, et jamais un site à auditer.
    for (const adresse of ['http://127.0.0.1:5432', 'http://169.254.169.254/latest/meta-data/']) {
      expect(() => parseTargetUrl(adresse), adresse).toThrow(/nom de domaine/i)
    }
  })

  it('refuse un nom qui ne désigne rien de public', () => {
    // La vérification après résolution les refuserait de toute façon. Les écarter ici évite
    // qu'une saisie manifestement locale traverse le produit et s'affiche comme un site.
    for (const adresse of [
      'http://localhost:5432',
      'http://localhost',
      'http://serveur',
      'http://nas.local',
      'http://api.internal',
    ]) {
      expect(() => parseTargetUrl(adresse), adresse).toThrow(/publique/i)
    }
  })

  it('refuse une adresse portant des identifiants', () => {
    expect(() => parseTargetUrl('https://admin:secret@monsite.ch')).toThrow(/identifiants/i)
  })

  it('refuse ce qui n’est pas une adresse', () => {
    for (const valeur of ['', 'monsite.ch', 'bonjour']) {
      expect(() => parseTargetUrl(valeur), valeur).toThrow()
    }
  })
})
