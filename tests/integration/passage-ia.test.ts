import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { addSite } from '@/server/audit/service'
import { ajouterPrompt, etatPassage, ouvrirPassage } from '@/server/audit/visibilite-ia'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * Un relevé qu'on peut quitter.
 *
 * Interroger trois assistants sur quatorze questions prend plusieurs minutes. Exiger que la
 * page reste ouverte pendant ce temps est une contrainte que personne n'accepte : on ferme
 * l'onglet, on change d'écran, et le travail payé se perd au milieu.
 *
 * Ce qui est protégé ici est la mécanique qui rend ce travail reprenable — l'ouverture d'un
 * passage, et le refus d'en ouvrir un second par-dessus. Un double clic ne doit pas
 * relancer, sans quoi le premier passage serait payé deux fois.
 */

let email: string
let userId: string
let siteId: string

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `passage-${Date.now()}@exemple.test`
  userId = (
    await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
  await subscribeToTestPlan(userId)
  siteId = (await addSite(userId, { url: 'https://passage-essai.ch' })).siteId
  await ajouterPrompt(userId, siteId, 'Quelle bougie naturelle offrir ?', 'Conseils')
  await ajouterPrompt(userId, siteId, 'Quelles sont les vertus du jaspe rouge ?', 'Conseils')
}, 60_000)

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('un passage de relevé', () => {
  it('n’existe pas tant que personne ne l’a demandé', async () => {
    const etat = await etatPassage(userId, siteId)
    expect(etat.enCours).toBe(false)
    expect(etat.fait).toBe(0)
  })

  it('ne s’ouvre pas quand aucun assistant n’est configuré', async () => {
    /*
     * Sans clé, aucune plateforme n'est interrogeable. Ouvrir un passage reviendrait à
     * promettre un travail qui ne partira jamais — et à laisser l'écran afficher « en
     * cours » pour toujours.
     */
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('PERPLEXITY_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', '')

    const etat = await ouvrirPassage(userId, siteId)
    expect(etat.enCours).toBe(false)
  })

  it('s’ouvre une fois, et un second clic ne le relance pas', async () => {
    /*
     * La propriété qui protège le portefeuille. Un double clic, un rafraîchissement, un
     * retour arrière : aucun ne doit ouvrir un second passage par-dessus le premier, sinon
     * le même travail est payé deux fois.
     */
    vi.stubEnv('GEMINI_API_KEY', 'x'.repeat(40))

    const premier = await ouvrirPassage(userId, siteId)
    expect(premier.enCours).toBe(true)
    expect(premier.attendu).toBe(2)
    expect(premier.fait).toBe(0)

    const second = await ouvrirPassage(userId, siteId)
    expect(second.enCours).toBe(true)
    expect(second.attendu).toBe(2)

    // Et l'état lu séparément dit la même chose : l'avancement se compte sur les relevés.
    const relu = await etatPassage(userId, siteId)
    expect(relu.enCours).toBe(true)
    expect(relu.fait).toBe(0)
  })
})
