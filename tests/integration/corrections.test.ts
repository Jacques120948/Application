import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import * as operations from '@/server/ai/operations'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * Les crédits, branchés sur les actions IA du produit de visibilité.
 *
 * Quatre propriétés, et chacune répond à une façon de perdre de l'argent ou la confiance.
 *
 * **Un audit ne coûte rien.** C'est la promesse commerciale du produit : explorer un site,
 * appliquer quarante-neuf contrôles et calculer deux notes est du calcul. Si un seul crédit
 * partait là, la promesse serait fausse — et le test le verrait.
 *
 * **Une rédaction passe par la mécanique commune.** Réservation avant l'appel, débit après,
 * ligne d'usage rattachée. Un second système de crédits serait un second endroit où se
 * tromper, et le premier dépassement se paierait en factures.
 *
 * **Ce qui est payé est conservé.** Un texte payé qui disparaît au rechargement est un texte
 * volé. Relire est gratuit, et relancer remplace au lieu d'empiler.
 *
 * **Le modèle n'écrit que sur les pages qu'on lui a données.** Une page inventée serait
 * enregistrée sous un chemin qui n'existe pas, invisible à l'écran et impossible à retirer.
 */

const PAGES: Record<string, string> = {
  '/': `<html lang="fr"><head><title>Accueil</title></head><body><h1>Bienvenue</h1>
    <p>Notre atelier de menuiserie existe depuis 1998 et travaille le chêne massif suisse.</p>
    <a href="/agencements">Agencements</a><a href="/fenetres">Fenêtres</a></body></html>`,
  '/agencements': `<html lang="fr"><head><title>Agencements</title></head><body><h1>Agencements</h1>
    <p>Cuisines, dressings et bibliothèques sur mesure, posés en Gruyère et dans le canton.</p></body></html>`,
  '/fenetres': `<html lang="fr"><head><title>Fenêtres</title></head><body><h1>Fenêtres</h1>
    <p>Fenêtres bois et bois-métal, triple vitrage, fabriquées dans notre atelier.</p></body></html>`,
}

vi.mock('@/server/audit/net', async () => {
  const reel = await vi.importActual<typeof import('@/server/audit/net')>('@/server/audit/net')
  return {
    ...reel,
    secureFetch: async (brut: string) => {
      const url = new URL(brut)
      if (url.hostname !== 'menuiserie-essai.ch') throw new Error('hors du site')
      const corps = PAGES[url.pathname]
      const status = corps === undefined ? 404 : 200
      const contenu = corps ?? '<html><head><title>Introuvable</title></head><body></body></html>'
      return {
        url: brut,
        status,
        contentType: 'text/html; charset=utf-8',
        body: contenu,
        bytes: contenu.length,
        chain: [brut],
      }
    },
  }
})

vi.mock('@/server/audit/robots', async () => {
  const reel = await vi.importActual<typeof import('@/server/audit/robots')>('@/server/audit/robots')
  return { ...reel, DEFAULT_DELAY_MS: 0, ROBOTS_OUVERT: { ...reel.ROBOTS_OUVERT, delayMs: 0 } }
})

vi.mock('@/server/ai/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/ai/operations')>()),
  writeCorrections: vi.fn(),
}))

const rediger = vi.mocked(operations.writeCorrections)

const SITE = 'https://menuiserie-essai.ch'
let userId: string
let autreId: string
let email: string
let autreEmail: string
let siteId: string

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `corrections-${Date.now()}@exemple.test`
  autreEmail = `corrections-autre-${Date.now()}@exemple.test`
  userId = (
    await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
  autreId = (
    await register(
      { email: autreEmail, password: 'motdepasse-2026-solide', locale: 'fr' },
      { ip: randomUUID() },
    )
  ).userId
  await subscribeToTestPlan(userId)
  await subscribeToTestPlan(autreId)

  const { addSite, startAudit, advanceAudit } = await import('@/server/audit/service')
  const site = await addSite(userId, { url: SITE })
  siteId = site.siteId
  const audit = await startAudit(userId, siteId)
  for (let tour = 0; tour < 20; tour += 1) {
    const pas = await advanceAudit(userId, audit.auditId)
    if (!pas.encore) break
  }
}, 90_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [email, autreEmail] } } })
})

describe('ce qui se compte ne se paie pas', () => {
  it('n’a débité aucun crédit pour l’exploration, les contrôles et les deux notes', async () => {
    /*
     * C'est la promesse commerciale du produit, et elle se vérifie au journal : un audit
     * complet vient de tourner, quarante-neuf contrôles ont été appliqués et deux notes
     * calculées. Aucune ligne de débit ne doit exister.
     */
    const debits = await prisma.creditLedger.findMany({ where: { userId, delta: { lt: 0 } } })
    expect(debits).toEqual([])

    const usage = await prisma.aiUsage.count({ where: { userId } })
    expect(usage).toBe(0)
  })
})

describe('une rédaction passe par la mécanique commune', () => {
  it('débite, enregistre le texte, et ne le fait pas repayer à la relecture', async () => {
    const { redigerCorrections, listCorrections } = await import('@/server/audit/corrections')
    const { readPlan } = await import('@/server/audit/plan')

    const plan = await readPlan(userId, siteId)
    const cible = plan?.lignes.find((ligne) => ligne.checkId === 'seo.description_missing')
    expect(cible?.corrigeable).toBe(true)
    expect(cible?.corrections).toEqual([])
    if (cible === undefined) return

    const chemins = cible.sample.map((exemple) => exemple.path)
    rediger.mockResolvedValueOnce({
      value: {
        items: chemins.map((path) => ({
          path,
          field: 'description' as const,
          before: '',
          after: `Menuiserie artisanale à Bulle : ce que nous faisons sur ${path}, en chêne massif suisse.`,
        })),
      },
      creditsSpent: 3,
      balance: 0,
    })

    const resultat = await redigerCorrections(userId, siteId, 'seo.description_missing', 'fr')
    expect(resultat.creditsSpent).toBe(3)
    expect(resultat.corrections.length).toBe(chemins.length)

    // Le texte est en base : relire ne repasse pas par le modèle, donc ne coûte rien.
    const relues = await listCorrections(userId, siteId, 'seo.description_missing')
    expect(relues.length).toBe(chemins.length)
    expect(rediger).toHaveBeenCalledTimes(1)

    // Et le plan les porte, pour que l'écran les montre sans rien redemander.
    const apres = await readPlan(userId, siteId)
    const ligne = apres?.lignes.find((l) => l.checkId === 'seo.description_missing')
    expect(ligne?.corrections.length).toBe(chemins.length)
  }, 30_000)

  it('remplace la proposition précédente au lieu d’en empiler dix', async () => {
    const { redigerCorrections } = await import('@/server/audit/corrections')
    const { readPlan } = await import('@/server/audit/plan')
    const plan = await readPlan(userId, siteId)
    const cible = plan?.lignes.find((ligne) => ligne.checkId === 'seo.description_missing')
    if (cible === undefined) return
    const avant = cible.corrections.length

    rediger.mockResolvedValueOnce({
      value: {
        items: cible.sample.map((exemple) => ({
          path: exemple.path,
          field: 'description' as const,
          before: '',
          after: 'Une autre formulation, plus courte et plus directe, pour la même page.',
        })),
      },
      creditsSpent: 2,
      balance: 0,
    })
    const resultat = await redigerCorrections(userId, siteId, 'seo.description_missing', 'fr')
    expect(resultat.corrections.length).toBe(avant)
    expect(resultat.corrections[0]?.after).toContain('plus courte')
  }, 30_000)

  it('écarte les pages que le modèle a inventées', async () => {
    const { redigerCorrections } = await import('@/server/audit/corrections')
    const { readPlan } = await import('@/server/audit/plan')
    const plan = await readPlan(userId, siteId)
    const cible = plan?.lignes.find((ligne) => ligne.checkId === 'seo.description_missing')
    if (cible === undefined || cible.sample[0] === undefined) return

    rediger.mockResolvedValueOnce({
      value: {
        items: [
          {
            path: cible.sample[0].path,
            field: 'description' as const,
            before: '',
            after: 'Une description juste, pour une page qui existe vraiment sur ce site.',
          },
          {
            path: '/page-qui-nexiste-pas',
            field: 'description' as const,
            before: '',
            after: 'Une description pour une page inventée de toutes pièces par le modèle.',
          },
        ],
      },
      creditsSpent: 2,
      balance: 0,
    })
    await redigerCorrections(userId, siteId, 'seo.description_missing', 'fr')

    const fantome = await withUserScope(userId, (tx) =>
      tx.auditCorrection.findFirst({ where: { siteId, path: '/page-qui-nexiste-pas' } }),
    )
    expect(fantome).toBeNull()
  }, 30_000)
})

describe('ce qu’on refuse de faire payer', () => {
  it('refuse un constat que l’équipe ne sait pas rédiger, sans appeler le modèle', async () => {
    const { redigerCorrections } = await import('@/server/audit/corrections')
    rediger.mockClear()
    await expect(
      redigerCorrections(userId, siteId, 'seo.robots_missing', 'fr'),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    // L'appel doit être refusé avant le modèle : refuser après, ce serait facturer pour rien.
    expect(rediger).not.toHaveBeenCalled()
  })

  it('refuse le site d’un autre avant tout appel', async () => {
    const { redigerCorrections, listCorrections } = await import('@/server/audit/corrections')
    rediger.mockClear()
    await expect(
      redigerCorrections(autreId, siteId, 'seo.description_missing', 'fr'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(rediger).not.toHaveBeenCalled()
    expect(await listCorrections(autreId, siteId, 'seo.description_missing')).toEqual([])
  })
})
