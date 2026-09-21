import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { IdeeMotCle, Lecture } from '@/server/ads/provider'

/*
 * Les deux lectures extérieures sont remplacées : Search Console et le planificateur de
 * Google. Ce qui est vérifié ici est ce qu'Evoliia range et ce qu'elle refuse — le
 * cloisonnement entre deux comptes, le refus d'une Performance Max, la borne du contenant.
 * C'est là qu'une erreur ne se verrait pas à l'écran.
 */
const ideesDeMotsCles = vi.fn<() => Promise<Lecture<IdeeMotCle[]>>>()
const metriquesDeMotsCles = vi.fn<() => Promise<Lecture<IdeeMotCle[]>>>()
const lireRecherches = vi.fn()

vi.mock('@/server/ads/google-ads', async (original) => {
  const vrai = await original<typeof import('@/server/ads/google-ads')>()
  return { ...vrai, googleAds: { ...vrai.googleAds, ideesDeMotsCles, metriquesDeMotsCles } }
})

vi.mock('@/server/audit/recherches', async (original) => {
  const vrai = await original<typeof import('@/server/audit/recherches')>()
  return { ...vrai, lireRecherches }
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
const { lireMotsCles, motsClesDuCompte, proposerMotsCles, ecarterMotCle } = await import(
  '@/server/ads/ciblage'
)
const { MOTS_CLES_PAR_GROUPE } = await import('@/server/ads/garde-fous')
const { ensureTestPlan, subscribeToTestPlan } = await import('../helpers/plan')

let email: string
let userId: string
let accountId: string
let recherche: string
let groupeAnnonces: string
let groupeElements: string

const VUE = {
  pays: [
    { code: 'che', impressions: 900, clics: 40 },
    { code: 'fra', impressions: 60, clics: 2 },
  ],
  occasionsDeRequetes: [
    { cle: 'bougie quartz rose', position: 14, impressions: 320, clics: 3 },
    { cle: 'bougie citrine parfumée', position: 22, impressions: 180, clics: 1 },
  ],
  requetes: [
    // Déjà gagnée : la payer rachèterait un clic qu'on obtient gratuitement.
    { cle: 'cap nature bougie', position: 1, impressions: 800, clics: 190 },
    { cle: 'bougie quartz rose', position: 14, impressions: 320, clics: 3 },
    // La version italienne du site travaille : ce n'est pas du trafic égaré.
    { cle: 'candela diaspro rosso', position: 12, impressions: 240, clics: 2 },
  ],
  /*
   * La langue vient de la page qui sert la requête, pas des mots. Une boutique suisse en
   * sert trois, et les volumes n'ont de sens que demandés dans la bonne.
   */
  langues: {
    'bougie quartz rose': 'fr',
    'bougie citrine parfumée': 'fr',
    'cap nature bougie': 'fr',
    'candela diaspro rosso': 'it',
  },
}

const IDEES: IdeeMotCle[] = [
  { texte: 'bougie quartz rose', volume: 260, concurrence: 'LOW', coutBasMicros: 400_000, coutHautMicros: 900_000 },
  { texte: 'bougie citrine parfumée', volume: 90, concurrence: 'MEDIUM', coutBasMicros: 500_000, coutHautMicros: 1_200_000 },
  // Le planificateur connaît aussi la requête déjà gagnée : elle ne doit pas revenir par là.
  { texte: 'cap nature bougie', volume: 500, concurrence: 'LOW', coutBasMicros: 200_000, coutHautMicros: 400_000 },
  { texte: 'bougie pierre naturelle', volume: 1_300, concurrence: 'HIGH', coutBasMicros: 800_000, coutHautMicros: 2_100_000 },
]

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `ciblage-${Date.now()}@exemple.test`
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

  groupeAnnonces = (
    await withUserScope(userId, (tx) =>
      tx.adsGroupe.create({
        data: {
          userId,
          accountId,
          campagneId: recherche,
          groupeId: 'g1',
          nom: 'Quartz rose',
          genre: 'annonces',
        },
      }),
    )
  ).id

  groupeElements = (
    await withUserScope(userId, (tx) =>
      tx.adsGroupe.create({
        data: {
          userId,
          accountId,
          campagneId: recherche,
          groupeId: 'g2',
          nom: 'PMax',
          genre: 'elements',
        },
      }),
    )
  ).id
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

beforeEach(async () => {
  ideesDeMotsCles.mockReset()
  lireRecherches.mockReset()
  metriquesDeMotsCles.mockReset()
  ideesDeMotsCles.mockResolvedValue({ ok: true, valeur: IDEES })
  metriquesDeMotsCles.mockResolvedValue({ ok: true, valeur: IDEES })
  lireRecherches.mockResolvedValue({ ok: true, vue: VUE })
  await withUserScope(userId, (tx) => tx.adsMotCle.deleteMany({ where: { userId } }))
})

describe('la proposition de mots-clés', () => {
  it('range ce qu’elle retient et compte ce qu’elle écarte', async () => {
    const bilan = await proposerMotsCles(userId, groupeAnnonces, 'https://cap-nature.ch', 'fr')

    expect(bilan.marche).toBe('Suisse')
    expect(bilan.langue).toBe('français')
    expect(bilan.dejaGagnees).toBe(1)

    const proposes = await lireMotsCles(userId, groupeAnnonces)
    const textes = proposes.map((un) => un.texte)
    expect(textes).toContain('bougie quartz rose')
    /*
     * Le planificateur la connaît aussi, et une première version la reproposait par cette
     * seconde porte — en affirmant « position 0 », c'est-à-dire le contraire exact de ce
     * qu'on venait de constater.
     */
    expect(textes).not.toContain('cap nature bougie')
    expect(bilan.proposes).toBe(proposes.length)
  })

  it('conserve les chiffres plutôt que de les relire', async () => {
    // Le planificateur consomme le quota d'API partagé par tous les utilisateurs d'Evoliia :
    // rouvrir un écran ne doit pas le rappeler.
    await proposerMotsCles(userId, groupeAnnonces, 'https://cap-nature.ch', 'fr')
    const quartz = (await lireMotsCles(userId, groupeAnnonces)).find(
      (un) => un.texte === 'bougie quartz rose',
    )
    expect(quartz?.volume).toBe(260)
    expect(quartz?.coutHautMicros).toBe(900_000)
    expect(quartz?.position).toBe(14)
    expect(quartz?.correspondance).toBe('phrase')

    const avant = ideesDeMotsCles.mock.calls.length + metriquesDeMotsCles.mock.calls.length
    await lireMotsCles(userId, groupeAnnonces)
    await motsClesDuCompte(userId, accountId)
    expect(ideesDeMotsCles.mock.calls.length + metriquesDeMotsCles.mock.calls.length).toBe(avant)
  })

  it('refuse une Performance Max, qui n’achète pas de mots-clés', async () => {
    await expect(
      proposerMotsCles(userId, groupeElements, 'https://cap-nature.ch', 'fr'),
    ).rejects.toThrow(/Performance Max/u)
    expect(ideesDeMotsCles).not.toHaveBeenCalled()
  })

  it('refuse sans Search Console plutôt que de supposer', async () => {
    /*
     * Ce n'est pas une source d'appoint : sans elle, il ne resterait que les idées du
     * planificateur, qui ignore tout de ce que ce site gagne déjà gratuitement.
     */
    await expect(proposerMotsCles(userId, groupeAnnonces, null, 'fr')).rejects.toThrow(
      /Search Console/u,
    )
    lireRecherches.mockResolvedValue({ ok: false, etat: 'refus', raison: 'jeton expiré' })
    await expect(
      proposerMotsCles(userId, groupeAnnonces, 'https://cap-nature.ch', 'fr'),
    ).rejects.toThrow(/Search Console/u)
    expect(ideesDeMotsCles).not.toHaveBeenCalled()
  })

  it('refuse un pays qu’elle ne sait pas viser', async () => {
    // Un volume de recherche sans pays est vrai et inutilisable.
    lireRecherches.mockResolvedValue({
      ok: true,
      vue: { ...VUE, pays: [{ code: 'zzz', impressions: 900, clics: 1 }] },
    })
    await expect(
      proposerMotsCles(userId, groupeAnnonces, 'https://cap-nature.ch', 'fr'),
    ).rejects.toThrow(/pays/u)
    expect(ideesDeMotsCles).not.toHaveBeenCalled()
  })

  it('n’appelle pas le planificateur pour un contenant déjà plein', async () => {
    // Un appel qui ne peut rien produire d'utile ne doit pas consommer le quota partagé.
    await withUserScope(userId, (tx) =>
      tx.adsElement.createMany({
        data: Array.from({ length: MOTS_CLES_PAR_GROUPE }, (_, rang) => ({
          userId,
          accountId,
          groupeId: groupeAnnonces,
          champ: 'mot-cle',
          texte: `mot ${rang}`,
        })),
      }),
    )
    await expect(
      proposerMotsCles(userId, groupeAnnonces, 'https://cap-nature.ch', 'fr'),
    ).rejects.toThrow(/déjà/u)
    expect(ideesDeMotsCles).not.toHaveBeenCalled()

    await withUserScope(userId, (tx) =>
      tx.adsElement.deleteMany({ where: { userId, groupeId: groupeAnnonces } }),
    )
  })

  it('ne repropose pas ce que le contenant porte déjà', async () => {
    await withUserScope(userId, (tx) =>
      tx.adsElement.create({
        data: {
          userId,
          accountId,
          groupeId: groupeAnnonces,
          champ: 'mot-cle',
          texte: 'bougie quartz rose',
        },
      }),
    )
    await proposerMotsCles(userId, groupeAnnonces, 'https://cap-nature.ch', 'fr')
    const textes = (await lireMotsCles(userId, groupeAnnonces)).map((un) => un.texte)
    expect(textes).not.toContain('bougie quartz rose')

    await withUserScope(userId, (tx) =>
      tx.adsElement.deleteMany({ where: { userId, groupeId: groupeAnnonces } }),
    )
  })

  it('écarte sans supprimer, et ne réapparaît pas', async () => {
    await proposerMotsCles(userId, groupeAnnonces, 'https://cap-nature.ch', 'fr')
    const premier = (await lireMotsCles(userId, groupeAnnonces))[0]
    expect(premier).toBeDefined()
    if (premier === undefined) return

    await ecarterMotCle(userId, premier.id)
    const restants = await lireMotsCles(userId, groupeAnnonces)
    expect(restants.map((un) => un.id)).not.toContain(premier.id)

    // La ligne survit à l'écart : c'est elle qui empêchera de la reproposer.
    const ligne = await withUserScope(userId, (tx) =>
      tx.adsMotCle.findFirst({ where: { id: premier.id, userId }, select: { etat: true } }),
    )
    expect(ligne?.etat).toBe('ecartee')
  })
})

describe('quand Google ferme son planificateur', () => {
  it('propose quand même, sans prix, et dit pourquoi', async () => {
    /*
     * Le cas réel : une application en accès « Explorer » lit ses campagnes mais ne peut
     * pas interroger les volumes de recherche. Refuser entièrement ferait perdre une
     * demande réelle et mesurée au motif que Google n'ouvre pas un outil annexe. La
     * protection qui compte — ne pas acheter ce qu'on gagne déjà gratuitement — vient de la
     * position organique, que Search Console donne.
     */
    const ferme = {
      ok: false as const,
      raison: 'Le planificateur de mots-clés de Google n’est pas ouvert à votre application',
    }
    ideesDeMotsCles.mockResolvedValue(ferme)
    metriquesDeMotsCles.mockResolvedValue(ferme)

    const bilan = await proposerMotsCles(userId, groupeAnnonces, 'https://cap-nature.ch', 'fr')
    expect(bilan.proposes).toBeGreaterThan(0)
    expect(bilan.sansPrix).toContain('planificateur')
    expect(bilan.dejaGagnees).toBe(1)

    const proposes = await lireMotsCles(userId, groupeAnnonces)
    const textes = proposes.map((un) => un.texte)
    // La demande constatée passe ; ce qu'on gagne déjà gratuitement reste écarté.
    expect(textes).toContain('bougie quartz rose')
    expect(textes).not.toContain('cap nature bougie')
    // Et rien n'invente un volume ni un prix que Google n'a pas donnés.
    const quartz = proposes.find((un) => un.texte === 'bougie quartz rose')
    expect(quartz?.volume).toBe(0)
    expect(quartz?.coutHautMicros).toBe(0)
  })
})

describe('le cloisonnement', () => {
  it('ne laisse pas une autre personne lire ni écarter ces mots-clés', async () => {
    await proposerMotsCles(userId, groupeAnnonces, 'https://cap-nature.ch', 'fr')
    const cible = (await lireMotsCles(userId, groupeAnnonces))[0]
    expect(cible).toBeDefined()
    if (cible === undefined) return

    const autreEmail = `ciblage-autre-${Date.now()}@exemple.test`
    const autre = (
      await register(
        { email: autreEmail, password: 'motdepasse-2026-solide', locale: 'fr' },
        { ip: randomUUID() },
      )
    ).userId

    try {
      expect(await lireMotsCles(autre, groupeAnnonces)).toHaveLength(0)
      expect((await motsClesDuCompte(autre, accountId)).size).toBe(0)
      await expect(ecarterMotCle(autre, cible.id)).rejects.toThrow()

      // Et la ligne de l'un n'a pas bougé.
      const ligne = await withUserScope(userId, (tx) =>
        tx.adsMotCle.findFirst({ where: { id: cible.id, userId }, select: { etat: true } }),
      )
      expect(ligne?.etat).toBe('proposee')
    } finally {
      await prisma.user.deleteMany({ where: { email: autreEmail } })
    }
  })
})
