import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { IDS_MEMBRES, MEMBRES } from '@/lib/equipe'
import { VISIBILITY_AGENTS } from '@/server/agents/visibility'

/**
 * Une seule équipe, deux endroits qui l'affichent.
 *
 * Le menu du studio nomme les six membres, et les fiches du serveur aussi. Un composant de
 * navigateur ne pouvant pas importer une valeur du serveur, la tentation était de recopier
 * les prénoms dans le menu — et le jour où l'un change, la navigation en affiche un que le
 * reste du produit ne connaît plus. Personne ne le voit avant un client.
 *
 * L'identité vit donc dans `lib/equipe.ts`, et le serveur construit ses fiches dessus. Ce
 * fichier vérifie que la construction tient, et que le menu ne s'est pas remis à recopier.
 */

describe('l’équipe', () => {
  it('est la même des deux côtés', () => {
    expect(VISIBILITY_AGENTS.map((un) => un.id)).toEqual([...IDS_MEMBRES])

    for (const membre of MEMBRES) {
      const fiche = VISIBILITY_AGENTS.find((un) => un.id === membre.id)
      expect(fiche).toBeDefined()
      expect(fiche?.name).toBe(membre.name)
      expect(fiche?.role).toBe(membre.role)
      expect(fiche?.avatar).toBe(membre.avatar)
    }
  })

  /**
   * Ce test figeait le nombre de membres à six, et exigeait un portrait pour chacun.
   *
   * Les deux étaient des instantanés, pas des invariants : l'équipe s'agrandit — Cleo est
   * arrivée —, et un membre peut rejoindre l'équipe avant son portrait, ce que le composant
   * sait faire depuis toujours avec sa pastille à initiale.
   *
   * Ce qui doit rester vrai, en revanche, ne dépend d'aucun nombre : chacun porte un prénom
   * et une spécialité lisibles, et un portrait, quand il existe, a la forme attendue. Un
   * chemin d'image mal écrit donnerait une case vide sur tous les écrans du studio, et rien
   * ne le dirait.
   */
  it('nomme chaque membre, et n’annonce que des portraits bien formés', () => {
    expect(MEMBRES.length).toBeGreaterThanOrEqual(6)
    for (const membre of MEMBRES) {
      expect(membre.name.length).toBeGreaterThan(1)
      expect(membre.role.length).toBeGreaterThan(2)
      if (membre.avatar !== undefined) {
        expect(membre.avatar).toMatch(/^\/equipe\/.+\.webp$/u)
      }
    }
  })

  it('n’est pas recopiée dans le menu', () => {
    /*
     * La vérification qui compte, et la seule qui survive à une refonte : le menu doit tirer
     * ses prénoms du fichier partagé, jamais les écrire. Un prénom en dur passerait tous les
     * autres tests de ce fichier sans qu'ils s'en aperçoivent.
     */
    const source = readFileSync('src/components/studio/Menu.tsx', 'utf8')
    expect(source).toContain("from '@/lib/equipe'")
    for (const membre of MEMBRES) {
      expect(source).not.toContain(`'${membre.name}'`)
      expect(source).not.toContain(`>${membre.name}<`)
    }
  })
})
