import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import { lireCockpit } from '@/server/oria/cockpit'
import { lireActivite } from '@/server/oria/activite'
import { enregistrerObjectifs, lireObjectifs } from '@/server/oria/objectifs'
import { dernierResume, ecrireResume } from '@/server/oria/resume'
import { deleguer } from '@/server/oria/delegation'
import { enregistrerBudgets, lireBudgets } from '@/server/oria/budget'
import * as operations from '@/server/ai/operations'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

vi.mock('@/server/ai/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/ai/operations')>()),
  resumerOria: vi.fn(),
  askVisibilityAgent: vi.fn(),
}))

const resumer = vi.mocked(operations.resumerOria)
const demander = vi.mocked(operations.askVisibilityAgent)

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
let siteAnne: string

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

  siteAnne = (
    await withUserScope(anne, (tx) =>
      tx.site.create({
        data: { userId: anne, origin: 'https://anne-oria.ch', host: 'anne-oria.ch', label: 'Anne' },
        select: { id: true },
      }),
    )
  ).id
  /*
   * Une analyse terminée, sans constat. Oria ne regarde un site qu'une fois analysé : avant,
   * elle n'a rien à classer, et ses objectifs n'ont rien à incliner.
   */
  await withUserScope(anne, (tx) =>
    tx.audit.create({
      data: {
        userId: anne,
        siteId: siteAnne,
        status: 'done',
        pagesCrawled: 3,
        seoScore: 90,
        geoScore: 90,
        croScore: 90,
        finishedAt: new Date(),
      },
    }),
  )

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

describe('les objectifs', () => {
  it('s’enregistrent dans l’ordre choisi, et Oria les relit', async () => {
    await enregistrerObjectifs(anne, siteAnne, { objectifs: ['ventes', 'trafic-seo'], activite: 'boutique' })
    const vue = await lireObjectifs(anne, siteAnne)
    expect(vue.objectifs).toEqual(['ventes', 'trafic-seo'])
    expect(vue.activite).toBe('boutique')
    expect(vue.deduite).toBe(false)

    const cockpit = await lireCockpit(anne, 'fr', siteAnne)
    expect(cockpit.objectifs.objectifs).toEqual(['ventes', 'trafic-seo'])
  })

  it('refusent un objectif qu’aucun agent ne sait encore servir', async () => {
    await expect(
      enregistrerObjectifs(anne, siteAnne, { objectifs: ['reseaux-sociaux'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(
      enregistrerObjectifs(anne, siteAnne, { objectifs: ['invente'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('ne laissent pas Bruno régler ceux d’Anne, ni les lire', async () => {
    await expect(
      enregistrerObjectifs(bruno, siteAnne, { objectifs: ['leads'] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(lireObjectifs(bruno, siteAnne)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    // Et ceux d'Anne n'ont pas bougé.
    expect((await lireObjectifs(anne, siteAnne)).objectifs).toEqual(['ventes', 'trafic-seo'])
  })
})

describe('le résumé d’Oria', () => {
  it('s’écrit sur demande, se conserve, et ne se paie pas deux fois dans la minute', async () => {
    resumer.mockReset()
    resumer.mockResolvedValue({
      value: { phrases: ['MIRA constate qu’un ensemble dépense sans vendre.', 'Commencez par là.'] },
      creditsSpent: 3,
      balance: 100,
    })

    const premier = await ecrireResume(anne, 'jour', 'fr', siteAnne)
    expect(premier.phrases).toHaveLength(2)
    expect(premier.creditsSpent).toBe(3)

    // Un second clic rend le premier au lieu d'en payer un autre.
    const second = await ecrireResume(anne, 'jour', 'fr', siteAnne)
    expect(second.createdAt).toEqual(premier.createdAt)
    expect(resumer).toHaveBeenCalledTimes(1)

    // Et il se relit gratuitement.
    expect((await dernierResume(anne, 'jour', siteAnne))?.phrases).toEqual(premier.phrases)
  })

  it('ne transmet au modèle que des faits, sans adresse ni identifiant', async () => {
    const faits = JSON.stringify(resumer.mock.calls[0]?.[0]?.faits ?? {})
    expect(faits).toContain('Un ensemble dépense sans vendre')
    expect(faits).not.toContain(siteAnne)
    expect(faits).not.toContain('/fr/')
  })

  it('ne laisse pas Bruno lire le résumé d’Anne', async () => {
    expect(await dernierResume(bruno, 'jour', siteAnne)).toBeNull()
    await expect(ecrireResume(bruno, 'jour', 'fr', siteAnne)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('refuse avant tout appel quand l’offre n’ouvre pas Oria', async () => {
    resumer.mockClear()
    await prisma.subscription.deleteMany({ where: { userId: bruno } })
    await expect(ecrireResume(bruno, 'jour', 'fr')).rejects.toMatchObject({ code: 'PLAN_LIMIT' })
    expect(resumer).not.toHaveBeenCalled()
    await subscribeToTestPlan(bruno)
  })
})

describe('la délégation d’Oria', () => {
  it('transmet à Cleo le point de MIRA, avec une question écrite côté serveur', async () => {
    demander.mockReset()
    demander.mockResolvedValue({ answer: 'La page n’affiche pas de livraison.', takeaway: null, creditsSpent: 2 })

    const cockpit = await lireCockpit(anne, 'fr', siteAnne)
    const point = cockpit.signaux.find((un) => un.sources.includes('meta'))
    expect(point).toBeDefined()

    const note = await deleguer(anne, { siteId: siteAnne, cle: point?.cle ?? '', agent: 'cro' }, 'fr')
    expect(note.agent).toBe('cro')
    expect(note.answer).toBe('La page n’affiche pas de livraison.')

    const appel = demander.mock.calls[0]?.[0]
    expect(appel?.agent).toBe('cro')
    expect(appel?.question).toContain('MIRA a relevé')
    // Cleo répond avec son propre contexte, pas celui d'Oria.
    expect(appel?.facts).toContain('AUCUNE DONNÉE DE VENTE')
    expect(appel?.facts).not.toContain('SOURCES ABSENTES')

    // Et la délégation est tracée comme telle.
    const trace = await withUserScope(anne, (tx) =>
      tx.visibilityNote.findFirst({ where: { id: note.id }, select: { demandePar: true } }),
    )
    expect(trace?.demandePar).toBe('oria')
  })

  it('le raconte, vrai, dans le fil d’activité', async () => {
    const activite = await lireActivite(anne, siteAnne)
    expect(activite.map((un) => un.quoi)).toContain('Oria a transmis une priorité à Cleo, qui a répondu.')
  })

  it('refuse un destinataire qu’elle ne propose pas pour ce point', async () => {
    demander.mockClear()
    const cockpit = await lireCockpit(anne, 'fr', siteAnne)
    const point = cockpit.signaux.find((un) => un.sources.includes('meta'))
    await expect(
      deleguer(anne, { siteId: siteAnne, cle: point?.cle ?? '', agent: 'geo' }, 'fr'),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(demander).not.toHaveBeenCalled()
  })

  it('ne laisse pas Bruno transmettre un point d’Anne', async () => {
    demander.mockClear()
    const cockpit = await lireCockpit(anne, 'fr', siteAnne)
    const point = cockpit.signaux.find((un) => un.sources.includes('meta'))
    await expect(
      deleguer(bruno, { siteId: siteAnne, cle: point?.cle ?? '', agent: 'cro' }, 'fr'),
    ).rejects.toBeDefined()
    expect(demander).not.toHaveBeenCalled()
  })
})

describe('les budgets déclarés', () => {
  it('s’enregistrent pour Anne, et Bruno ne peut ni les lire ni les changer', async () => {
    await enregistrerBudgets(anne, siteAnne, { google: 300, meta: 700 })
    expect(await lireBudgets(anne, siteAnne)).toEqual({ google: 300, meta: 700 })

    await expect(lireBudgets(bruno, siteAnne)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(enregistrerBudgets(bruno, siteAnne, { meta: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await lireBudgets(anne, siteAnne)).toEqual({ google: 300, meta: 700 })
  })
})
