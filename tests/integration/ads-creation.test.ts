import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { IdeeMotCle, Lecture } from '@/server/ads/provider'

/*
 * Ce qui est vérifié ici : le plan vit en base, il ne se crée pas deux fois, il ne traverse
 * pas d'un compte à l'autre, et la création refuse ce qu'elle doit refuser. L'appel à Google
 * est remplacé — on vérifie ce qu'Evoliia décide, pas que Google réponde.
 */
const ideesDeMotsCles = vi.fn<() => Promise<Lecture<IdeeMotCle[]>>>()
const lireRecherches = vi.fn()
const proposerElementsAds = vi.fn()
const creerCampagneComplete = vi.fn()
const supprimerCampagne = vi.fn()
const supprimerBudget = vi.fn()

vi.mock('@/server/ads/google-ads', async (original) => {
  const vrai = await original<typeof import('@/server/ads/google-ads')>()
  return { ...vrai, googleAds: { ...vrai.googleAds, ideesDeMotsCles } }
})

vi.mock('@/server/audit/recherches', async (original) => {
  const vrai = await original<typeof import('@/server/audit/recherches')>()
  return { ...vrai, lireRecherches }
})

vi.mock('@/server/ai/operations', async (original) => {
  const vrai = await original<typeof import('@/server/ai/operations')>()
  return { ...vrai, proposerElementsAds }
})

vi.mock('@/server/ads/google-ads-ecriture', async (original) => {
  const vrai = await original<typeof import('@/server/ads/google-ads-ecriture')>()
  return { ...vrai, creerCampagneComplete, supprimerCampagne, supprimerBudget }
})

vi.mock('@/server/settings/flags', async (original) => {
  const vrai = await original<typeof import('@/server/settings/flags')>()
  return { ...vrai, isEnabled: async () => true }
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
const { abandonnerPlan, fixerEnchere, lirePlans, preparerCampagne } = await import(
  '@/server/ads/creation',
)
const { creerCampagne, restaurer } = await import('@/server/ads/actions')
const { ensureTestPlan, subscribeToTestPlan } = await import('../helpers/plan')

let email: string
let userId: string

const HOTES = ['cap-nature.ch']

const VUE = {
  pays: [{ code: 'che', impressions: 900, clics: 40 }],
  occasionsDeRequetes: [
    { cle: 'bougie quartz rose', position: 14, impressions: 320, clics: 3 },
    { cle: 'bougie citrine parfumée', position: 22, impressions: 180, clics: 1 },
  ],
  requetes: [{ cle: 'cap nature bougie', position: 1, impressions: 800, clics: 190 }],
}

const IDEES: IdeeMotCle[] = [
  { texte: 'bougie quartz rose', volume: 260, concurrence: 'LOW', coutBasMicros: 400_000, coutHautMicros: 900_000 },
  { texte: 'bougie citrine parfumée', volume: 90, concurrence: 'MEDIUM', coutBasMicros: 600_000, coutHautMicros: 1_200_000 },
]

const TEXTES = {
  value: {
    elements: [
      { champ: 'titre', texte: 'Bougies Quartz Rose', motif: 'Reprend la recherche' },
      { champ: 'titre', texte: 'Cire de Soja Suisse', motif: 'Produit' },
      { champ: 'titre', texte: 'Coulées à la Main', motif: 'Produit' },
      { champ: 'titre', texte: 'Pierre Semi-Précieuse', motif: 'Produit' },
      { champ: 'description', texte: 'Des bougies coulées à la main en Valais.', motif: 'Activité' },
      { champ: 'description', texte: 'Chaque bougie révèle une pierre naturelle.', motif: 'Produit' },
    ],
  },
  creditsSpent: 2,
  balance: 100,
}

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `creation-${Date.now()}@exemple.test`
  userId = (
    await register(
      { email, password: 'motdepasse-2026-solide', locale: 'fr' },
      { ip: randomUUID() },
    )
  ).userId
  await subscribeToTestPlan(userId)

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
          mode: 'assiste',
          synchroAt: new Date(),
        },
      }),
  )
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

beforeEach(async () => {
  for (const espion of [
    ideesDeMotsCles,
    lireRecherches,
    proposerElementsAds,
    creerCampagneComplete,
    supprimerCampagne,
    supprimerBudget,
  ]) {
    espion.mockReset()
  }
  ideesDeMotsCles.mockResolvedValue({ ok: true, valeur: IDEES })
  lireRecherches.mockResolvedValue({ ok: true, vue: VUE })
  proposerElementsAds.mockResolvedValue(TEXTES)
  creerCampagneComplete.mockResolvedValue({
    ok: true,
    campagne: 'customers/1869511296/campaigns/777',
    budget: 'customers/1869511296/campaignBudgets/888',
  })
  supprimerCampagne.mockResolvedValue({ ok: true })
  supprimerBudget.mockResolvedValue({ ok: true })

  await withUserScope(userId, (tx) => tx.adsPlanCampagne.deleteMany({ where: { userId } }))
  await withUserScope(userId, (tx) => tx.adsAction.deleteMany({ where: { userId } }))
})

async function preparer() {
  return preparerCampagne(
    userId,
    {
      nom: 'Recherche — Quartz',
      budgetMicros: 5_000_000,
      urlFinale: 'https://cap-nature.ch/x',
      enchereMicros: 0,
    },
    'https://cap-nature.ch',
    'fr',
  )
}

describe('la préparation d’un plan', () => {
  it('compose une campagne entière sans rien envoyer', async () => {
    const bilan = await preparer()

    expect(creerCampagneComplete).not.toHaveBeenCalled()
    expect(bilan.plan.marcheNom).toBe('Suisse')
    expect(bilan.plan.langueNom).toBe('français')
    // « cap nature bougie » est en première position : on la gagne déjà sans payer.
    expect(bilan.dejaGagnees).toBe(1)
    expect(bilan.plan.motsCles.map((un) => un.texte)).not.toContain('cap nature bougie')
    expect(bilan.plan.titres.length).toBeGreaterThanOrEqual(3)
    expect(bilan.plan.descriptions.length).toBeGreaterThanOrEqual(2)
    // La médiane du bas de fourchette : 0.40 et 0.60 donnent 0.50.
    expect(bilan.plan.enchereMicros).toBe(500_000)

    const plans = await lirePlans(userId)
    expect(plans.map((un) => un.id)).toContain(bilan.plan.id)
  })

  it('refuse quand rien ne justifie une campagne', async () => {
    /*
     * Tout est déjà gagné en organique, et le planificateur ne propose rien non plus. Les
     * deux conditions comptent : une idée de marché que le site ne capte pas encore reste
     * un candidat légitime, même quand Search Console ne montre rien d'exploitable.
     */
    ideesDeMotsCles.mockResolvedValue({ ok: true, valeur: [] })
    lireRecherches.mockResolvedValue({
      ok: true,
      vue: {
        pays: VUE.pays,
        occasionsDeRequetes: [],
        requetes: [{ cle: 'cap nature', position: 1, impressions: 900, clics: 300 }],
      },
    })
    await expect(preparer()).rejects.toThrow(/gagnez déjà/u)
    expect(proposerElementsAds).not.toHaveBeenCalled()
  })

  it('refuse quand Naya n’a pas produit assez de textes', async () => {
    // En dessous du minimum de Google, l'annonce serait refusée et le groupe n'aurait rien
    // à diffuser. Mieux vaut le dire avant d'avoir créé six objets.
    proposerElementsAds.mockResolvedValue({
      value: { elements: [{ champ: 'titre', texte: 'Un seul', motif: '' }] },
      creditsSpent: 1,
      balance: 100,
    })
    await expect(preparer()).rejects.toThrow(/exige/u)
  })
})

describe('la création', () => {
  it('envoie le plan de la base, en une fois, et garde les deux poignées', async () => {
    const { plan } = await preparer()
    const issue = await creerCampagne(userId, plan.id, HOTES)
    expect(issue.ok).toBe(true)

    expect(creerCampagneComplete).toHaveBeenCalledTimes(1)
    const envoye = creerCampagneComplete.mock.calls[0]?.[1] as Record<string, unknown>
    expect(envoye.nom).toBe('Recherche — Quartz')
    expect(envoye.budgetMicros).toBe(5_000_000)
    expect(envoye.marcheGeo).toBe('geoTargetConstants/2756')

    const ligne = await withUserScope(userId, (tx) =>
      tx.adsPlanCampagne.findFirst({
        where: { id: plan.id, userId },
        select: { etat: true, campagneRessource: true, budgetRessource: true },
      }),
    )
    expect(ligne?.etat).toBe('cree')
    expect(ligne?.campagneRessource).toContain('campaigns/777')
    expect(ligne?.budgetRessource).toContain('campaignBudgets/888')

    // Et le plan ne s'affiche plus : il n'y a plus de décision à prendre.
    expect((await lirePlans(userId)).map((un) => un.id)).not.toContain(plan.id)
  })

  it('ne crée pas deux fois le même plan', async () => {
    const { plan } = await preparer()
    expect((await creerCampagne(userId, plan.id, HOTES)).ok).toBe(true)
    await expect(creerCampagne(userId, plan.id, HOTES)).rejects.toThrow()
    expect(creerCampagneComplete).toHaveBeenCalledTimes(1)
  })

  it('n’en crée qu’une par jour', async () => {
    const premier = await preparer()
    expect((await creerCampagne(userId, premier.plan.id, HOTES)).ok).toBe(true)

    const second = await preparer()
    const issue = await creerCampagne(userId, second.plan.id, HOTES)
    expect(issue.ok).toBe(false)
    if (!issue.ok) expect(issue.raison).toContain('une campagne par jour')
    expect(creerCampagneComplete).toHaveBeenCalledTimes(1)
  })

  it('refuse une adresse d’arrivée qui n’est pas chez la personne', async () => {
    const { plan } = await preparer()
    const issue = await creerCampagne(userId, plan.id, ['ailleurs.test'])
    expect(issue.ok).toBe(false)
    expect(creerCampagneComplete).not.toHaveBeenCalled()

    // Et le plan reste utilisable : le refus ne l'a pas consommé.
    expect((await lirePlans(userId)).map((un) => un.id)).toContain(plan.id)
  })

  it('n’écrit rien quand Google refuse', async () => {
    creerCampagneComplete.mockResolvedValue({
      ok: false,
      raison: 'Google refuse : budget invalide.',
      technique: 'x',
    })
    const { plan } = await preparer()
    const issue = await creerCampagne(userId, plan.id, HOTES)
    expect(issue.ok).toBe(false)

    const ligne = await withUserScope(userId, (tx) =>
      tx.adsPlanCampagne.findFirst({ where: { id: plan.id, userId }, select: { etat: true } }),
    )
    expect(ligne?.etat).toBe('prepare')
  })
})

describe('sans les prix de Google', () => {
  it('compose quand même, sans enchère, et la création refuse', async () => {
    /*
     * Le cas d'un compte dont l'application n'a pas encore l'accès au planificateur. La
     * demande constatée suffit à composer une campagne ; le prix du clic, lui, ne s'invente
     * pas. Créer avec une enchère nulle ferait une campagne qui ne diffuse sur rien.
     */
    ideesDeMotsCles.mockResolvedValue({ ok: false, raison: 'accès Explorer' })

    const { plan } = await preparer()
    expect(plan.motsCles.length).toBeGreaterThan(0)
    expect(plan.enchereMicros).toBe(0)
    expect(plan.motsCles.every((un) => un.volume === 0)).toBe(true)

    const issue = await creerCampagne(userId, plan.id, HOTES)
    expect(issue.ok).toBe(false)
    if (!issue.ok) expect(issue.raison).toContain('coût par clic')
    expect(creerCampagneComplete).not.toHaveBeenCalled()
  })

  it('accepte l’enchère saisie, sans rien recomposer', async () => {
    ideesDeMotsCles.mockResolvedValue({ ok: false, raison: 'accès Explorer' })
    const { plan } = await preparer()
    const appelsAvant = proposerElementsAds.mock.calls.length

    expect((await fixerEnchere(userId, plan.id, 800_000)).ok).toBe(true)
    // Ni l'annonce ni les mots-clés n'ont été redemandés : c'eût été payer pour rien.
    expect(proposerElementsAds.mock.calls.length).toBe(appelsAvant)

    const [relu] = await lirePlans(userId)
    expect(relu?.enchereMicros).toBe(800_000)
    expect(relu?.titres).toEqual(plan.titres)

    const issue = await creerCampagne(userId, plan.id, HOTES)
    expect(issue.ok).toBe(true)
    expect(creerCampagneComplete.mock.calls[0]?.[1]).toMatchObject({ enchereMicros: 800_000 })
  })

  it('refuse une enchère qui épuiserait la journée en un clic', async () => {
    ideesDeMotsCles.mockResolvedValue({ ok: false, raison: 'accès Explorer' })
    const { plan } = await preparer()
    // Le budget du plan est de 5 CHF par jour.
    const issue = await fixerEnchere(userId, plan.id, 6_000_000)
    expect(issue.ok).toBe(false)

    const [relu] = await lirePlans(userId)
    expect(relu?.enchereMicros).toBe(0)
  })

  it('prend l’enchère saisie dès la composition', async () => {
    ideesDeMotsCles.mockResolvedValue({ ok: false, raison: 'accès Explorer' })
    const bilan = await preparerCampagne(
      userId,
      {
        nom: 'Recherche — Quartz',
        budgetMicros: 5_000_000,
        urlFinale: 'https://cap-nature.ch/x',
        enchereMicros: 700_000,
      },
      'https://cap-nature.ch',
      'fr',
    )
    expect(bilan.plan.enchereMicros).toBe(700_000)
  })
})

describe('le retour arrière', () => {
  it('supprime la campagne et son budget', async () => {
    /*
     * Le budget est un objet à part chez Google : il survivrait à la campagne qu'il
     * servait, et resterait dans le compte sans que rien ne le signale.
     */
    const { plan } = await preparer()
    const issue = await creerCampagne(userId, plan.id, HOTES)
    expect(issue.ok).toBe(true)
    if (!issue.ok) return

    const retour = await restaurer(userId, issue.action.id)
    expect(retour.ok).toBe(true)
    expect(supprimerCampagne).toHaveBeenCalledWith(
      expect.anything(),
      'customers/1869511296/campaigns/777',
    )
    expect(supprimerBudget).toHaveBeenCalledWith(
      expect.anything(),
      'customers/1869511296/campaignBudgets/888',
    )
  })
})

describe('le cloisonnement', () => {
  it('ne laisse pas une autre personne lire, abandonner ni créer ce plan', async () => {
    const { plan } = await preparer()

    const autreEmail = `creation-autre-${Date.now()}@exemple.test`
    const autre = (
      await register(
        { email: autreEmail, password: 'motdepasse-2026-solide', locale: 'fr' },
        { ip: randomUUID() },
      )
    ).userId

    try {
      expect(await lirePlans(autre)).toHaveLength(0)
      await expect(abandonnerPlan(autre, plan.id)).rejects.toThrow()
      /*
       * Un refus, et non une exception : cette personne n'a aucun compte publicitaire, donc
       * l'ouverture s'arrête avant même d'aller chercher le plan. Le cloisonnement tient de
       * toute façon — rien n'est parti et le plan de l'autre n'a pas bougé.
       */
      expect((await creerCampagne(autre, plan.id, HOTES)).ok).toBe(false)
      expect(creerCampagneComplete).not.toHaveBeenCalled()

      const ligne = await withUserScope(userId, (tx) =>
        tx.adsPlanCampagne.findFirst({ where: { id: plan.id, userId }, select: { etat: true } }),
      )
      expect(ligne?.etat).toBe('prepare')
    } finally {
      await prisma.user.deleteMany({ where: { email: autreEmail } })
    }
  })
})
