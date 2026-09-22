import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { prisma } from '@/server/db/client'
import {
  bilanSupervisionMeta,
  noterSupervisionMeta,
  sansIdentifiants,
} from '@/server/ads/supervision-meta'

/**
 * Les compteurs d'exploitation de MIRA.
 *
 * Ils existent parce que le journal des clients ne peut pas servir à la supervision : il
 * est cloisonné par propriétaire, sans exception pour l'administrateur, et un comptage fait
 * depuis le back-office y rendrait zéro — en silence, ce qui est le pire. Percer le
 * cloisonnement pour le confort de la supervision rouvrirait la porte que tout le reste du
 * produit ferme.
 *
 * Ce qui se vérifie ici tient en deux points, et le second est le plus important : que les
 * compteurs comptent juste, et qu'ils ne portent **rien** d'un client.
 */

beforeEach(async () => {
  await prisma.metaSupervision.deleteMany({})
})

afterAll(async () => {
  await prisma.metaSupervision.deleteMany({})
})

describe('ce que les compteurs ne doivent jamais contenir', () => {
  /**
   * Meta cite volontiers l'objet fautif dans ses messages. Ces suites de chiffres désignent
   * le compte, l'ensemble ou l'annonce d'un client — précisément ce que cette table ne doit
   * pas contenir, puisqu'elle n'est protégée par aucun cloisonnement.
   */
  it('masque les identifiants que Meta glisse dans ses refus', () => {
    const brut = "Object with ID '120214567890123456' does not exist on act_664979634006686"
    const propre = sansIdentifiants(brut)
    expect(propre).not.toContain('120214567890123456')
    expect(propre).not.toContain('664979634006686')
    // La phrase qui reste dit ce qui cloche : c'est elle qui sert.
    expect(propre).toContain('does not exist')
  })

  it('laisse les nombres ordinaires, qui ne désignent personne', () => {
    // Un budget, un nombre de jours : les masquer rendrait le message illisible.
    expect(sansIdentifiants('Daily budget must be at least 100 cents')).toContain('100')
  })

  it('borne la longueur d’un message', () => {
    expect(sansIdentifiants('x'.repeat(5000)).length).toBeLessThanOrEqual(300)
  })

  /**
   * La garantie de fond, vérifiée sur le schéma lui-même : aucune colonne ne désigne une
   * personne, un compte ou une campagne. Le jour où l'on en ajouterait une, ce test
   * échouerait — et il faudrait alors cloisonner la table, ce qui reviendrait à admettre
   * qu'on s'est trompé de table.
   */
  it('n’a aucune colonne qui désigne un client', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    const modele = schema.slice(schema.indexOf('model MetaSupervision {'))
    const corps = modele.slice(0, modele.indexOf('\n}'))
    for (const interdite of ['userId', 'accountId', 'campagneId', 'compteId', 'email']) {
      expect(corps).not.toContain(interdite)
    }
  })
})

describe('le bilan d’exploitation', () => {
  it('ne rend que des zéros quand rien n’est parti', async () => {
    const bilan = await bilanSupervisionMeta()
    expect(bilan.total).toBe(0)
    expect(bilan.derniersRefus).toEqual([])
  })

  it('distingue les trois signaux, qui ne disent pas la même chose', async () => {
    await noterSupervisionMeta({ quoi: 'pause', resultat: 'reussi' })
    await noterSupervisionMeta({ quoi: 'budget', resultat: 'refuse', detail: 'Meta a dit non.' })
    await noterSupervisionMeta({ quoi: 'pause', resultat: 'reussi', retour: true })
    await noterSupervisionMeta({ quoi: 'budget', resultat: 'prevu' })

    const bilan = await bilanSupervisionMeta()
    expect(bilan.total).toBe(4)
    expect(bilan.reussies).toBe(2)
    expect(bilan.refusees).toBe(1)
    expect(bilan.retours).toBe(1)
    // Une écriture coupée en plein vol : partie sans qu'on sache si elle est arrivée.
    expect(bilan.inconnues).toBe(1)
  })

  it('garde la réponse de Meta sur un refus : c’est elle qui dit quoi corriger', async () => {
    await noterSupervisionMeta({
      quoi: 'budget',
      resultat: 'refuse',
      detail: "Object with ID '120214567890123456' does not exist",
    })
    const bilan = await bilanSupervisionMeta()
    expect(bilan.derniersRefus[0]?.detail).toContain('does not exist')
    expect(bilan.derniersRefus[0]?.detail).not.toContain('120214567890123456')
  })

  /*
   * Ce sont des compteurs, pas des garde-fous. Une panne ici doit coûter une statistique,
   * jamais un geste : l'appelant est en train d'écrire chez Meta.
   */
  it('ne lève jamais, quoi qu’on lui donne', async () => {
    await expect(
      noterSupervisionMeta({ quoi: 'x'.repeat(10_000), resultat: 'reussi' }),
    ).resolves.toBeUndefined()
  })
})

describe('l’entrée du back-office', () => {
  /**
   * Le contrôle de rôle se vérifie sur le texte du service : `getCurrentUser` lit un cookie,
   * et rien de ce fichier n'est atteignable hors d'une requête. C'est la même façon de faire
   * que pour le « jamais publié » du connecteur Shopify — ce qui compte est la ligne écrite,
   * et c'est elle qu'une modification distraite enlèverait.
   */
  it('reste derrière un contrôle de rôle', () => {
    const source = readFileSync('src/server/admin/service.ts', 'utf8')
    const entree = source.slice(source.indexOf('export async function supervisionMeta('))
    expect(entree.slice(0, entree.indexOf('\n}'))).toContain('await requireAdmin()')
  })
})
