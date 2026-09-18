import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'

/**
 * Ce que l'administration peut compter, et ce qu'elle ne peut pas.
 *
 * Le cas s'est produit en production : « Sites suivis » et « Analyses ce mois » affichaient
 * zéro alors que la base en contenait. `Site` et `Audit` sont sous cloisonnement forcé, et
 * leur règle exige une identité ; une administration ne parle au nom de personne, donc un
 * comptage ordinaire ne voit rien. Un chiffre faux et d'apparence normale, ce qui est la
 * pire espèce — personne ne va vérifier un zéro.
 *
 * Ce test garde la raison vivante. Il ne vérifie pas un affichage : il vérifie que le
 * cloisonnement tient toujours pour une lecture sans portée, et que les tables faites pour
 * l'exploitant, elles, se lisent. Si le premier se mettait un jour à rendre le bon nombre,
 * c'est que la garantie aurait cédé — et mieux vaut un test rouge qu'un compteur qui
 * « marche enfin ».
 */

let email: string
let userId: string

beforeAll(async () => {
  clearAll()
  email = `compteurs-${Date.now()}@exemple.test`
  userId = (
    await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId

  const site = await withUserScope(userId, (tx) =>
    tx.site.create({
      data: {
        userId,
        origin: 'https://compteurs-essai.ch',
        host: 'compteurs-essai.ch',
        label: 'Essai',
      },
      select: { id: true },
    }),
  )
  await withUserScope(userId, (tx) =>
    tx.audit.create({ data: { siteId: site.id, userId, status: 'done' } }),
  )
  await prisma.aiUsage.create({
    data: { userId, operation: 'visibilityAsk', model: 'essai', success: true },
  })
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('ce que l’administration peut compter', () => {
  it('ne voit pas les sites ni les audits sans portée, et c’est la garantie qui tient', async () => {
    /*
     * Un site et un audit viennent d'être créés. Lus sans portée — ce que fait tout écran
     * d'administration, qui ne parle au nom de personne — ils n'existent pas. C'est pour
     * cela que ces deux nombres ne figurent pas en tête de l'administration : les afficher
     * demanderait d'ouvrir à tout le code la lecture des lignes de tout le monde.
     */
    expect(await prisma.site.count({ where: { deletedAt: null } })).toBe(0)
    expect(await prisma.audit.count()).toBe(0)

    // Sous la portée de son propriétaire, la même lecture les voit.
    expect(await withUserScope(userId, (tx) => tx.site.count({ where: { userId } }))).toBe(1)
    expect(await withUserScope(userId, (tx) => tx.audit.count({ where: { userId } }))).toBe(1)
  })

  it('voit en revanche les tables faites pour l’exploitant', async () => {
    /*
     * `AiUsage` n'est pas cloisonnée, et délibérément : elle n'existe que pour être lue par
     * l'exploitant, aucun écran de client ne la relit. C'est ce qui permet aux deux chiffres
     * de tête de dire quelque chose de vrai — ce qu'Evoliia dépense chez son fournisseur.
     */
    const appels = await prisma.aiUsage.count({ where: { userId } })
    expect(appels).toBeGreaterThanOrEqual(1)
  })
})
