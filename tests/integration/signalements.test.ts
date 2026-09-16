import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import { recordUnmetRequest, reportProblem } from '@/server/support/creator'
import { withUserScope } from '@/server/db/scope'
import { DEMO_APPS } from '@/server/demos/catalog'

/**
 * Les deux chemins entre un créateur et l'exploitant.
 *
 * Ce qui mérite d'être tenu par un test n'est pas qu'une ligne s'écrive — c'est ce qui rend
 * ces lignes utiles quand on les lira.
 *
 * **Le contexte part avec le message.** Un signalement sans l'offre ni les échecs récents
 * coûte trois allers-retours avant de commencer à comprendre, et c'est exactement ce que ce
 * mécanisme existe pour éviter.
 *
 * **L'exploitant est prévenu.** Un signalement que personne ne voit ne vaut pas mieux que
 * pas de signalement du tout.
 *
 * **Une statistique manquée ne casse jamais une réponse rendue.** L'enregistrement des
 * demandes sans suite a lieu après coup ; il ne doit pas pouvoir transformer une réponse
 * réussie en erreur.
 */

let userId: string
let adminId: string
let email: string
let adminEmail: string
let projectId: string

beforeAll(async () => {
  clearAll()
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {},
      create: { ...plan, features: [...plan.features], currency: 'EUR', interval: 'month' },
    })
  }
  email = `bloque-${Date.now()}@exemple.test`
  adminEmail = `exploitant-${Date.now()}@exemple.test`
  userId = (
    await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
  adminId = (
    await register(
      { email: adminEmail, password: 'motdepasse-2026-solide', locale: 'fr' },
      { ip: randomUUID() },
    )
  ).userId
  await prisma.user.update({ where: { id: adminId }, data: { role: 'ADMIN' } })

  const projet = await withUserScope(userId, (tx) =>
    tx.project.create({
      data: {
        ownerId: userId,
        name: 'Projet',
        slug: `signal-${Math.random().toString(36).slice(2, 10)}`,
        idea: 'une idée',
        draftSpec: DEMO_APPS[0]!.spec as unknown as object,
      },
      select: { id: true },
    }),
  )
  projectId = projet.id
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [email, adminEmail] } } })
})

describe('un signalement', () => {
  it('joint les faits que l’exploitant aurait demandés', async () => {
    await reportProblem({
      userId,
      screen: 'projet',
      message: "J'ai voulu publier et il ne se passe rien du tout.",
      projectId,
    })

    const report = await prisma.creatorReport.findFirst({ where: { userId } })
    expect(report?.status).toBe('open')
    expect(report?.screen).toBe('projet')
    // L'offre et le solde sont dans le contexte : les demander au créateur serait lui
    // demander ce qu'il ne sait pas, et retarder d'autant la compréhension.
    expect(report?.context).toMatch(/Offre :/)
    expect(report?.context).toMatch(/Crédits disponibles :/)
  })

  it('prévient l’exploitant, pas le créateur', async () => {
    const pourLExploitant = await withUserScope(adminId, (tx) =>
      tx.notification.count({ where: { userId: adminId, kind: 'creator_report' } }),
    )
    expect(pourLExploitant).toBeGreaterThan(0)

    // Le créateur n'a pas à recevoir sa propre alerte dans sa cloche.
    const pourLeCreateur = await withUserScope(userId, (tx) =>
      tx.notification.count({ where: { userId, kind: 'creator_report' } }),
    )
    expect(pourLeCreateur).toBe(0)
  })

  it('refuse un message trop court pour dire quoi que ce soit', async () => {
    await expect(
      reportProblem({ userId, screen: 'projet', message: 'bug' }),
    ).rejects.toThrow(/une phrase/i)
  })
})

describe('une demande restée sans suite', () => {
  it('distingue ce qui est hors périmètre du reste', async () => {
    await recordUnmetRequest({
      userId,
      projectId,
      request: 'Envoie un SMS à mes clients',
      reply: "Evoliia ne sait pas envoyer de SMS.",
      explicit: true,
    })
    await recordUnmetRequest({
      userId,
      projectId,
      request: 'Combien de pages ai-je ?',
      reply: 'Votre application a quatre pages.',
      explicit: false,
    })

    const rows = await prisma.unmetRequest.findMany({ where: { userId } })
    expect(rows).toHaveLength(2)
    // La distinction est ce qui rend l'écran lisible : mêler les deux ferait passer une
    // question ordinaire pour une fonction qui manque.
    expect(rows.filter((row) => row.explicit)).toHaveLength(1)
  })

  it('ne lève jamais, même sur un projet qui n’existe pas', async () => {
    await expect(
      recordUnmetRequest({
        userId,
        projectId: '00000000-0000-4000-8000-000000000000',
        request: 'peu importe',
        reply: 'peu importe',
        explicit: false,
      }),
    ).resolves.toBeUndefined()
  })
})
