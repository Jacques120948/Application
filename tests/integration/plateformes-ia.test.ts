import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { addSite } from '@/server/audit/service'
import {
  ajouterPrompt,
  choisirPlateformes,
  plateformesSuivies,
  soldeCouvre,
} from '@/server/audit/visibilite-ia'
import { plateformesDisponibles } from '@/server/integrations/providers/assistants'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * Les assistants suivis, et ce qu'ils coûtent.
 *
 * Ce fichier protège une seule propriété, et c'est celle qui décide de la marge : **on ne
 * facture que ce qu'on interroge, et on n'interroge que ce qui a été choisi.** Tant que la
 * liste des plateformes était fixe, la question ne se posait pas. Depuis qu'elle ne l'est
 * plus, trois façons de se tromper apparaissent, et les trois coûtent de l'argent à
 * quelqu'un.
 *
 * Interroger une plateforme non choisie fait payer au client ce qu'il a refusé. Facturer
 * une plateforme non disponible lui fait payer une colonne vide. Et compter le solde sans
 * les plateformes ferait ouvrir des passages qu'on ne peut pas payer, qui s'arrêteraient au
 * milieu après avoir dépensé chez les fournisseurs.
 *
 * Le test tourne sous le rôle applicatif, donc sous Row Level Security forcé.
 */

let email: string
let userId: string
let siteId: string

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `plateformes-${Date.now()}@exemple.test`
  userId = (
    await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
  await subscribeToTestPlan(userId)
  siteId = (await addSite(userId, { url: 'https://plateformes-essai.ch' })).siteId
  await ajouterPrompt(userId, siteId, 'Quelle bougie naturelle offrir ?', 'Conseils')
}, 60_000)

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

/** Trois assistants configurés, ChatGPT absent : l'état de départ de chaque cas. */
function troisAssistants() {
  vi.stubEnv('GEMINI_API_KEY', 'x'.repeat(40))
  vi.stubEnv('ANTHROPIC_API_KEY', 'x'.repeat(40))
  vi.stubEnv('PERPLEXITY_API_KEY', 'x'.repeat(40))
  vi.stubEnv('OPENAI_API_KEY', '')
}

describe('les assistants disponibles', () => {
  it('comptent ChatGPT dès que sa clé est posée, et pas avant', async () => {
    troisAssistants()
    expect(plateformesDisponibles()).not.toContain('chatgpt')

    vi.stubEnv('OPENAI_API_KEY', 'x'.repeat(40))
    expect(plateformesDisponibles()).toContain('chatgpt')
  })
})

describe('les assistants suivis', () => {
  it('valent tous les disponibles tant qu’on n’a rien choisi', async () => {
    /*
     * C'est l'état de tous les sites existants le jour où la colonne apparaît. Si cette
     * propriété tombait, un déploiement éteindrait silencieusement le relevé de tout le
     * monde — sans erreur, sans journal, et sans que personne le voie avant des semaines.
     */
    troisAssistants()
    const suivies = await plateformesSuivies(userId, siteId)
    expect([...suivies].sort()).toEqual(['claude', 'gemini', 'perplexity'])
  })

  it('se réduisent à ce qu’on a coché', async () => {
    troisAssistants()
    expect(await choisirPlateformes(userId, siteId, ['gemini', 'perplexity'])).toEqual([
      'gemini',
      'perplexity',
    ])
    expect(await plateformesSuivies(userId, siteId)).toEqual(['gemini', 'perplexity'])
  })

  it('n’en retiennent aucune dont la clé n’est pas posée', async () => {
    /*
     * Choisir ChatGPT sans clé OpenAI ne doit ni échouer ni le faire apparaître : il serait
     * interrogé en vain à chaque tour, et surtout facturé pour une colonne vide.
     */
    troisAssistants()
    const retenues = await choisirPlateformes(userId, siteId, ['gemini', 'chatgpt'])
    expect(retenues).toEqual(['gemini'])
  })

  it('gardent le choix d’hier quand une clé disparaît', async () => {
    troisAssistants()
    await choisirPlateformes(userId, siteId, ['gemini', 'claude', 'perplexity'])

    // Perplexity tombe : le suivi continue sur les deux autres plutôt que d'échouer.
    vi.stubEnv('PERPLEXITY_API_KEY', '')
    expect(await plateformesSuivies(userId, siteId)).toEqual(['gemini', 'claude'])
  })

  it('refusent la liste vide, qui voudrait dire « toutes »', async () => {
    /*
     * Vide en base signifie « toutes les disponibles ». Accepter une liste vide venue du
     * navigateur ferait donc tripler la note de quelqu'un qui cherchait à la réduire.
     */
    troisAssistants()
    await expect(choisirPlateformes(userId, siteId, [])).rejects.toThrow()
    await expect(choisirPlateformes(userId, siteId, ['inexistant'])).rejects.toThrow()
    // Et le choix précédent tient : un refus ne doit rien changer.
    expect(await plateformesSuivies(userId, siteId)).toEqual(['gemini', 'claude', 'perplexity'])
  })

  it('refusent le site d’un autre', async () => {
    troisAssistants()
    const autre = `voisin-plateformes-${Date.now()}@exemple.test`
    const voisin = (
      await register(
        { email: autre, password: 'motdepasse-2026-solide', locale: 'fr' },
        { ip: randomUUID() },
      )
    ).userId
    await expect(choisirPlateformes(voisin, siteId, ['gemini'])).rejects.toThrow()
    await prisma.user.deleteMany({ where: { email: autre } })
  })
})

describe('le solde exigé', () => {
  it('croît avec le nombre d’assistants', async () => {
    /*
     * La propriété qui empêche d'ouvrir un passage qu'on ne peut pas payer. Sans elle, le
     * relevé partirait, dépenserait chez les fournisseurs, puis s'arrêterait à sec au
     * milieu — le pire des deux mondes.
     */
    troisAssistants()
    expect(await soldeCouvre(userId, 1, 1)).toBe(true)
    expect(await soldeCouvre(userId, 1, 100_000)).toBe(false)
  })

  it('refuse un passage sans question ou sans assistant', async () => {
    troisAssistants()
    expect(await soldeCouvre(userId, 0, 3)).toBe(false)
    expect(await soldeCouvre(userId, 5, 0)).toBe(false)
  })
})
