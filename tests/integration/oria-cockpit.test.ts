import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import { lireCockpit } from '@/server/oria/cockpit'
import { lireActivite } from '@/server/oria/activite'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * Le cockpit d'Oria, sur une vraie base.
 *
 * Oria lit tout ce que l'équipe a produit : c'est l'écran du produit qui touche le plus de
 * tables à la fois, et donc celui où une fuite entre comptes se verrait le plus. Chaque
 * refus est ici apparié à une réussite — un test qui ne vérifierait que l'absence passerait
 * aussi sur un cockpit qui ne lit rien du tout.
 *
 * Et un compte qui n'a encore rien branché doit obtenir un cockpit vide, pas une erreur :
 * c'est la première chose qu'il voit.
 */

let anne: string
let bruno: string
let emailAnne: string
let emailBruno: string

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()

  emailAnne = `oria-anne-${Date.now()}@exemple.test`
  emailBruno = `oria-bruno-${Date.now()}@exemple.test`
  anne = (
    await register({ email: emailAnne, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
  bruno = (
    await register({ email: emailBruno, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
  await subscribeToTestPlan(anne)
  await subscribeToTestPlan(bruno)

  const compte = await withUserScope(anne, (tx) =>
    tx.adsAccount.create({
      data: {
        userId: anne,
        plateforme: 'meta-ads',
        compteId: '222222222222222',
        nom: 'Boutique d’Anne',
        devise: 'CHF',
        fuseau: 'Europe/Zurich',
        actif: true,
        mode: 'assiste',
        synchroAt: new Date(),
      },
      select: { id: true },
    }),
  )

  await withUserScope(anne, (tx) =>
    tx.adsRecommandation.create({
      data: {
        userId: anne,
        accountId: compte.id,
        regle: 'budget-mal-place',
        priorite: 'urgent',
        niveau: 'ensemble',
        cible: 'Ensemble A',
        cibleId: 'adset_1',
        etat: 'ouverte',
        jours: 21,
        titre: 'Un ensemble dépense sans vendre',
        consequence: 'Le budget part là où rien ne revient.',
        recommandation: 'Baisser le budget de cet ensemble.',
      },
    }),
  )

  await withUserScope(anne, (tx) =>
    tx.adsAction.create({
      data: {
        userId: anne,
        accountId: compte.id,
        quoi: 'budget-ensemble',
        resultat: 'reussi',
        mode: 'assiste',
        detail: 'Budget baissé.',
      },
    }),
  )
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [emailAnne, emailBruno] } } })
})

describe('le cockpit d’Oria', () => {
  it('classe en tête ce que MIRA a d’urgent chez Anne', async () => {
    const cockpit = await lireCockpit(anne, 'fr')
    const [premiere] = cockpit.priorites
    expect(premiere?.titre).toBe('Un ensemble dépense sans vendre')
    expect(premiere?.sources).toEqual(['meta'])
    expect(premiere?.urgence).toBe('critique')
    // Vingt et un jours de données : la confiance le dit.
    expect(premiere?.confiance).toBe('elevee')
    expect(cockpit.sourcesLues).toContain('meta')
  })

  it('ne montre rien d’Anne à Bruno', async () => {
    const cockpit = await lireCockpit(bruno, 'fr')
    expect(cockpit.signaux).toEqual([])
    expect(cockpit.sourcesLues).not.toContain('meta')
    expect(cockpit.activite).toEqual([])
  })

  it('ne ment pas à Bruno sur ce qu’il n’a pas branché', async () => {
    /*
     * Bruno n'a ni site ni compte. Son cockpit doit s'afficher — c'est la première chose
     * qu'il voit — et dire qu'il n'y a rien, canal par canal, sans en déclarer aucun en
     * bonne santé.
     */
    const cockpit = await lireCockpit(bruno, 'fr')
    expect(cockpit.canaux.every((canal) => canal.etat === 'inconnu')).toBe(true)
    expect(cockpit.equipe.find((un) => un.id === 'meta')?.statut).toBe('connexion')
    expect(cockpit.phrase).toContain('Je n’ai encore rien de mesuré')
  })

  it('ne raconte que ce qui s’est réellement passé', async () => {
    const activite = await lireActivite(anne, null)
    const phrases = activite.map((un) => un.quoi)
    expect(phrases).toContain('MIRA a relevé : Un ensemble dépense sans vendre.')
    expect(phrases).toContain(
      'MIRA a appliqué une modification validée sur le budget d’un ensemble de publicités.',
    )
    // Aucune mise en scène d'une coordination qui n'a pas eu lieu.
    expect(phrases.some((phrase) => phrase.startsWith('Oria'))).toBe(false)
  })
})
