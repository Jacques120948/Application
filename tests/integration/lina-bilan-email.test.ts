import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { findProvider } from '@/server/integrations/catalog'
import { storeConnection } from '@/server/integrations/service'
import * as courriel from '@/server/email/send'
import { FLAGS } from '@/server/settings/flags'
import { envoyerBilansLina, lireBilanEmail, reglerBilanEmail, texteBilanEmail } from '@/server/lina/bilan-email'
import { lireLina } from '@/server/lina/service'
import { ensureTestPlan, testPlanId } from '../helpers/plan'

/**
 * Le bilan de Lina par e-mail : seulement à qui l'a demandé, une fois par semaine, sans
 * aucun client dedans, et rien quand l'interrupteur est éteint. Resend n'est pas appelé.
 */

vi.mock('@/server/email/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/email/send')>()),
  isEmailAvailable: vi.fn(() => true),
  sendEmails: vi.fn(async (emails: readonly unknown[]) => emails.length),
}))

const JOUR = 24 * 60 * 60 * 1000
let abonne: string
let sansBase: string
let refus: string
const LUNDI = new Date('2026-09-21T06:00:00Z')

async function creer(): Promise<string> {
  const { userId } = await register({ email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' }, { ip: randomUUID() })
  await prisma.subscription.create({ data: { userId, planId: testPlanId(), status: 'ACTIVE' } })
  return userId
}

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  ;[abonne, sansBase, refus] = await Promise.all([creer(), creer(), creer()])
  await storeConnection(abonne, findProvider('shopify')!, {
    kind: 'API_KEY',
    secret: JSON.stringify({ boutique: 'bilan.myshopify.com', clientId: 'identifiant', clientSecret: 'secret-de-test' }),
    accountLabel: 'bilan.myshopify.com',
  })
  await withUserScope(abonne, async (tx) => {
    await tx.linaSynchro.create({ data: { userId: abonne, source: 'shopify', etat: 'ok', synchroAt: LUNDI, clients: 40, consentement: true } })
    await tx.linaClient.createMany({
      data: Array.from({ length: 40 }, (_, i) => ({
        userId: abonne,
        source: 'shopify',
        ref: String(40_000 + i),
        creeLe: new Date(+LUNDI - 400 * JOUR),
        derniereCommande: new Date(+LUNDI - (i < 20 ? 15 : 220) * JOUR),
        commandes: i < 15 ? 3 : 1,
        caCents: i < 15 ? 20_000 : 4_000,
        devise: 'CHF',
        consentement: 'oui',
      })),
    })
  })
  await reglerBilanEmail(abonne, true)
  await reglerBilanEmail(sansBase, true)
}, 60_000)

beforeEach(() => {
  vi.mocked(courriel.sendEmails).mockClear()
})

afterAll(async () => {
  await prisma.siteSetting.deleteMany({ where: { key: FLAGS.linaBilanEmail.key } })
  await prisma.user.deleteMany({ where: { id: { in: [abonne, sansBase, refus] } } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('Lina — bilan par e-mail', () => {
  it('est éteint par défaut', async () => {
    expect(await lireBilanEmail(refus)).toBe(false)
    expect(await lireBilanEmail(abonne)).toBe(true)
  })

  it('n’écrit que des totaux, avec le lien pour se désabonner', async () => {
    const vue = await lireLina(abonne, { avecNova: false, maintenant: LUNDI })
    const contenu = texteBilanEmail(vue, 'Jacques', 'https://evoliia.example', 'fr')
    expect(contenu?.subject).toMatch(/^Lina — votre bilan de la semaine/u)
    expect(contenu?.text).toContain('Bonjour Jacques,')
    expect(contenu?.text).toContain('https://evoliia.example/fr/lina/bilan')
    expect(contenu?.text).toContain('Pour ne plus recevoir ce bilan')
    expect(contenu?.text).not.toMatch(/4\d{4}/u)
    expect(texteBilanEmail({ ...vue, vierge: true }, null, 'https://evoliia.example', 'fr')).toBeNull()
  })

  it('envoie une fois par semaine, seulement à qui l’a demandé et a une base lue', async () => {
    const premiere = await envoyerBilansLina(LUNDI)
    expect(premiere.envoyes).toBe(1)
    const envoyes = vi.mocked(courriel.sendEmails).mock.calls[0]![0]
    expect(envoyes).toHaveLength(1)
    const destinataire = await prisma.user.findUniqueOrThrow({ where: { id: abonne }, select: { email: true } })
    expect(envoyes[0]!.to).toBe(destinataire.email)

    // Le lendemain, même semaine : rien de plus.
    const seconde = await envoyerBilansLina(new Date(+LUNDI + JOUR))
    expect(seconde.envoyes).toBe(0)
    expect(courriel.sendEmails).toHaveBeenCalledTimes(1)

    // La semaine suivante : de nouveau.
    const suivante = await envoyerBilansLina(new Date(+LUNDI + 7 * JOUR))
    expect(suivante.envoyes).toBe(1)
  })

  it('ne part plus quand l’interrupteur est éteint', async () => {
    await prisma.siteSetting.upsert({ where: { key: FLAGS.linaBilanEmail.key }, create: { key: FLAGS.linaBilanEmail.key, value: 'off' }, update: { value: 'off' } })
    const tournee = await envoyerBilansLina(new Date(+LUNDI + 14 * JOUR))
    expect(tournee).toMatchObject({ envoyes: 0, raison: 'interrupteur éteint' })
    expect(courriel.sendEmails).not.toHaveBeenCalled()
    await prisma.siteSetting.deleteMany({ where: { key: FLAGS.linaBilanEmail.key } })
  })

  it('s’arrête quand la personne le décoche', async () => {
    await reglerBilanEmail(abonne, false)
    const tournee = await envoyerBilansLina(new Date(+LUNDI + 21 * JOUR))
    expect(tournee.envoyes).toBe(0)
  })
})
