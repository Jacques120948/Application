import { describe, expect, it } from 'vitest'
import { AUCUN_DROIT, droitsDepuisPortees } from '@/server/ads/droits-meta'
import { PORTEES } from '@/server/ads/meta-ads'

/**
 * Ce que Meta a accordé, et ce qu'on en conclut.
 *
 * Une porte de cette importance se ferme par défaut. Le dossier de connexion enregistrait
 * jusqu'ici les portées **demandées** par Evoliia, ce qui n'est pas ce que la personne a
 * accordé : l'écran de consentement de Meta permet de décocher une permission à la volée.
 * Conclure au droit d'écrire sur une liste vide, une liste inconnue ou une liste absente
 * ferait afficher un bouton qui ne peut qu'échouer.
 */

describe('les droits déduits des portées', () => {
  it('ouvrent l’écriture quand Meta l’a accordée', () => {
    const droits = droitsDepuisPortees(['ads_read', 'ads_management'])
    expect(droits.lire).toBe(true)
    expect(droits.ecrire).toBe(true)
    expect(droits.manquantes).toEqual([])
  })

  it('distinguent la lecture seule, et nomment ce qui manque', () => {
    const droits = droitsDepuisPortees(['ads_read'])
    expect(droits.lire).toBe(true)
    expect(droits.ecrire).toBe(false)
    // Nommer ce qui manque permet de le dire à la personne plutôt que de le deviner.
    expect(droits.manquantes).toEqual(['ads_management'])
  })

  it('se ferment sur une liste vide ou inconnue', () => {
    for (const portees of [[], ['public_profile'], ['ads_manage']]) {
      const droits = droitsDepuisPortees(portees)
      expect(droits.lire).toBe(false)
      expect(droits.ecrire).toBe(false)
    }
  })

  it('valent le repli fermé quand aucune connexion n’existe', () => {
    expect(AUCUN_DROIT.ecrire).toBe(false)
    expect(AUCUN_DROIT.lire).toBe(false)
    expect(AUCUN_DROIT.manquantes).toEqual([...PORTEES])
  })
})
