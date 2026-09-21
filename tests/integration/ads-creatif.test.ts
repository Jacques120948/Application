import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { ElementAds, GroupeAds, Lecture, TermeAds } from '@/server/ads/provider'

/*
 * Les deux lectures chez Google sont remplacées : on vérifie ce qu'Evoliia range, pas que
 * Google réponde. Le reste — le cloisonnement, l'unicité, la disparition de ce qui n'existe
 * plus — se joue en base, et c'est là qu'une erreur ne se verrait pas.
 */
const lireCreatif = vi.fn<
  () => Promise<Lecture<{ groupes: GroupeAds[]; elements: ElementAds[] }>>
>()
const lireTermes = vi.fn<() => Promise<Lecture<TermeAds[]>>>()

vi.mock('@/server/ads/google-ads', async (original) => {
  const vrai = await original<typeof import('@/server/ads/google-ads')>()
  return { ...vrai, googleAds: { ...vrai.googleAds, lireCreatif, lireTermes } }
})

vi.mock('@/server/ads/comptes', async (original) => {
  const vrai = await original<typeof import('@/server/ads/comptes')>()
  return {
    ...vrai,
    accesCompteActif: async (userId: string) => {
      const compte = await vrai.compteActif(userId)
      return compte === null
        ? { ok: false as const, raison: 'aucun compte' }
        : {
            ok: true as const,
            acces: { accessToken: 'jeton-de-test', compteId: compte.compteId },
            compte,
          }
    },
  }
})

const { prisma } = await import('@/server/db/client')
const { clearAll } = await import('@/server/auth/rate-limit')
const { register } = await import('@/server/auth/service')
const { withUserScope } = await import('@/server/db/scope')
const { lireCreatifDuCompte, synchroniserCreatif } = await import('@/server/ads/creatif')
const { ensureTestPlan, subscribeToTestPlan } = await import('../helpers/plan')

/**
 * La lecture du contenu des campagnes.
 *
 * Trois propriétés, toutes invisibles à l'écran et toutes coûteuses si elles se perdent : un
 * titre partagé par deux annonces d'un même groupe ne doit compter qu'une fois, un titre
 * retiré chez Google doit disparaître d'ici, et un échec sur les termes ne doit pas emporter
 * le créatif qui, lui, a été lu.
 */

let email: string
let userId: string
let accountId: string
let pmax: string
let recherche: string

const GROUPES: GroupeAds[] = [
  { groupeId: 'g1', campagneId: '111', nom: 'Bougies — annonces', genre: 'annonces', statut: 'ENABLED' },
  { groupeId: 'g2', campagneId: '222', nom: 'PMax — éléments', genre: 'elements', statut: 'ENABLED' },
]

const ELEMENTS: ElementAds[] = [
  // Ce que le contenant cible : la borne du sujet, et jamais un morceau d'annonce.
  { groupeId: 'g1', champ: 'mot-cle', texte: 'bougie quartz rose', elementId: '', performance: '' },
  { groupeId: 'g1', champ: 'titre', texte: 'Bougies artisanales suisses', elementId: '', performance: 'BEST' },
  { groupeId: 'g1', champ: 'titre', texte: 'Cire de soja naturelle', elementId: '', performance: 'GOOD' },
  // Le même titre, porté par une seconde annonce du même groupe : il ne doit compter qu'une fois.
  { groupeId: 'g1', champ: 'titre', texte: 'Bougies artisanales suisses', elementId: '', performance: 'BEST' },
  { groupeId: 'g1', champ: 'description', texte: 'Fabriquées à la main en Valais.', elementId: '', performance: 'LOW' },
  { groupeId: 'g2', champ: 'image', texte: 'https://exemple.test/image.jpg', elementId: '9001', performance: 'GOOD' },
]

const TERMES: TermeAds[] = [
  { campagneId: '111', terme: 'bougie pierre semi précieuse', impressions: 420, clics: 31, conversions: 2, coutMicros: 18_400_000 },
  { campagneId: '111', terme: 'acheter bougie artisanale', impressions: 180, clics: 12, conversions: 1, coutMicros: 7_100_000 },
]

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `creatif-${Date.now()}@exemple.test`
  userId = (
    await register(
      { email, password: 'motdepasse-2026-solide', locale: 'fr' },
      { ip: randomUUID() },
    )
  ).userId
  await subscribeToTestPlan(userId)

  accountId = (
    await withUserScope(userId, (tx) =>
      tx.adsAccount.create({
        data: {
          userId,
          plateforme: 'google-ads',
          compteId: '1869511296',
          nom: 'Cap Nature',
          devise: 'CHF',
          fuseau: 'Europe/Zurich',
          actif: true,
          synchroAt: new Date(),
        },
      }),
    )
  ).id

  recherche = (
    await withUserScope(userId, (tx) =>
      tx.adsCampagne.create({
        data: { userId, accountId, campagneId: '111', nom: 'Recherche', type: 'SEARCH', statut: 'ENABLED' },
      }),
    )
  ).id
  pmax = (
    await withUserScope(userId, (tx) =>
      tx.adsCampagne.create({
        data: { userId, accountId, campagneId: '222', nom: 'PMax', type: 'PERFORMANCE_MAX', statut: 'ENABLED' },
      }),
    )
  ).id
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

beforeEach(() => {
  lireCreatif.mockReset()
  lireTermes.mockReset()
  lireCreatif.mockResolvedValue({ ok: true, valeur: { groupes: GROUPES, elements: ELEMENTS } })
  lireTermes.mockResolvedValue({ ok: true, valeur: TERMES })
})

describe('la lecture du créatif', () => {
  it('range les contenants et leurs morceaux, sans compter deux fois le même titre', async () => {
    const issue = await synchroniserCreatif(userId)
    expect(issue.ok).toBe(true)

    const vu = await lireCreatifDuCompte(userId)
    expect(vu?.lu).toBe(true)
    expect(vu?.groupes).toHaveLength(2)

    const annonces = vu?.groupes.find((groupe) => groupe.genre === 'annonces')
    // Trois titres envoyés, deux distincts : Google refuse les doublons dans un contenant.
    expect(annonces?.titres).toHaveLength(2)
    /*
     * Le mot-clé est rangé avec les morceaux mais n'en est pas un : le compter ferait croire
     * un contenant plus rempli qu'il n'est, et dirait « 3 titres sur 15 » pour deux titres.
     */
    expect(annonces?.motsCles).toEqual(['bougie quartz rose'])
    expect(annonces?.descriptions).toHaveLength(1)
    expect(annonces?.campagne).toBe('Recherche')

    const elements = vu?.groupes.find((groupe) => groupe.genre === 'elements')
    expect(elements?.images).toHaveLength(1)
    expect(elements?.typeCampagne).toBe('PERFORMANCE_MAX')
  })

  it('classe les termes par intention, comme le référencement', async () => {
    const vu = await lireCreatifDuCompte(userId)
    const achat = vu?.termes.find((terme) => terme.terme.startsWith('acheter'))
    expect(achat?.intention).toBe('achat')
    expect(vu?.termes).toHaveLength(2)
  })

  it('efface ce qui n’existe plus chez Google', async () => {
    /*
     * Un titre retiré d'une annonce n'a pas d'histoire à raconter. Le garder ferait proposer
     * des améliorations à un texte qui ne diffuse plus — et c'est le genre de conseil qui
     * fait perdre confiance sans qu'on sache pourquoi.
     */
    lireCreatif.mockResolvedValue({
      ok: true,
      valeur: {
        groupes: [GROUPES[0] as GroupeAds],
        // Un titre, pas le mot-clé : c'est le remplissage qu'on vérifie ici.
        elements: [ELEMENTS[1] as ElementAds],
      },
    })
    lireTermes.mockResolvedValue({ ok: true, valeur: [TERMES[0] as TermeAds] })

    await synchroniserCreatif(userId, new Date(Date.now() + 1000))

    const vu = await lireCreatifDuCompte(userId)
    expect(vu?.groupes).toHaveLength(1)
    expect(vu?.groupes[0]?.titres).toHaveLength(1)
    expect(vu?.termes).toHaveLength(1)
  })

  it('garde le créatif quand seuls les termes échouent', async () => {
    // Deux informations distinctes : perdre l'une parce que l'autre a échoué ferait deux
    // pannes d'une seule.
    lireTermes.mockResolvedValue({ ok: false, raison: 'Google est injoignable.' })

    const issue = await synchroniserCreatif(userId, new Date(Date.now() + 2000))
    expect(issue.ok).toBe(true)

    const vu = await lireCreatifDuCompte(userId)
    expect(vu?.groupes.length).toBeGreaterThan(0)
    // Les termes d'avant sont conservés : on ne les efface pas sur un échec de lecture.
    expect(vu?.termes).toHaveLength(1)
  })

  it('abandonne tout quand le créatif lui-même échoue', async () => {
    lireCreatif.mockResolvedValue({ ok: false, raison: 'Google est injoignable.' })
    const issue = await synchroniserCreatif(userId, new Date(Date.now() + 3000))
    expect(issue.ok).toBe(false)
    // Rien n'a été effacé : un refus de Google n'est pas une campagne vidée.
    expect((await lireCreatifDuCompte(userId))?.groupes.length).toBeGreaterThan(0)
  })

  it('reste invisible au voisin', async () => {
    const autre = `voisin-creatif-${Date.now()}@exemple.test`
    const voisin = (
      await register(
        { email: autre, password: 'motdepasse-2026-solide', locale: 'fr' },
        { ip: randomUUID() },
      )
    ).userId

    // Sous RLS forcé, une lecture hors portée ne lève rien : elle rend zéro ligne.
    const chezLeVoisin = await withUserScope(voisin, (tx) =>
      tx.adsElement.findMany({ where: { accountId } }),
    )
    expect(chezLeVoisin).toHaveLength(0)

    await prisma.user.deleteMany({ where: { email: autre } })
  })
})

describe('les campagnes visées', () => {
  it('ignore un contenant dont la campagne n’est pas connue', async () => {
    /*
     * Une campagne créée entre deux lectures : son groupe arrive avant elle. L'inventer à
     * partir d'un numéro sans nom ni type donnerait une ligne fantôme dans tous les écrans.
     */
    lireCreatif.mockResolvedValue({
      ok: true,
      valeur: {
        groupes: [
          ...GROUPES,
          { groupeId: 'g9', campagneId: '999', nom: 'Inconnue', genre: 'annonces', statut: 'ENABLED' },
        ],
        elements: ELEMENTS,
      },
    })
    await synchroniserCreatif(userId, new Date(Date.now() + 4000))
    const vu = await lireCreatifDuCompte(userId)
    expect(vu?.groupes.map((groupe) => groupe.nom)).not.toContain('Inconnue')
  })
})

describe('les identifiants', () => {
  it('rattachent chaque contenant à la bonne campagne', async () => {
    const lignes = await withUserScope(userId, (tx) =>
      tx.adsGroupe.findMany({ where: { userId, accountId }, select: { groupeId: true, campagneId: true } }),
    )
    expect(lignes.find((une) => une.groupeId === 'g1')?.campagneId).toBe(recherche)
    expect(lignes.find((une) => une.groupeId === 'g2')?.campagneId).toBe(pmax)
  })
})
