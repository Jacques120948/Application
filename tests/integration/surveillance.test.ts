import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'
import {
  GET as cronSurveillanceGet,
  POST as cronSurveillancePost,
} from '@/app/api/cron/surveillance/route'

/**
 * La surveillance, de bout en bout.
 *
 * Trois propriétés, et chacune répond à une façon de rendre une alerte inutile.
 *
 * **Un constat s'ouvre une fois et se ferme quand il a disparu.** Un site en panne six
 * semaines produirait sinon six lignes identiques, et l'écran dirait « six problèmes » là où
 * il y en a un depuis six semaines.
 *
 * **Rien ne se surveille sans analyse préalable.** Il n'y aurait rien à quoi comparer, et
 * dire « tout va bien » à quelqu'un dont on n'a jamais lu le site serait faux.
 *
 * **Aucun crédit n'est débité.** C'est du comptage. Si un seul crédit partait là, la
 * promesse commerciale du produit serait fausse — et ce test le verrait.
 */

/** Ce que le faux serveur répond. Modifié par les tests pour simuler une panne. */
let titreAccueil = '<title>Menuiserie Duval</title>'
let metaRobots = ''

vi.mock('@/server/audit/net', async () => {
  const reel = await vi.importActual<typeof import('@/server/audit/net')>('@/server/audit/net')
  return {
    ...reel,
    secureFetch: async (brut: string) => {
      const url = new URL(brut)
      if (url.hostname !== 'veille-essai.ch') throw new Error('hors du site')
      if (url.pathname === '/robots.txt' || url.pathname === '/sitemap.xml') {
        return { url: brut, status: 404, contentType: 'text/plain', body: '', bytes: 0, chain: [brut] }
      }
      const corps = `<html lang="fr"><head>${titreAccueil}
        <meta name="description" content="Menuiserie artisanale en Gruyère depuis 1998.">
        ${metaRobots}</head><body><h1>Menuiserie</h1>
        <p>Notre atelier travaille le chêne massif suisse depuis bientôt trente ans.</p>
        </body></html>`
      return {
        url: brut,
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: corps,
        bytes: corps.length,
        chain: [brut],
      }
    },
  }
})

vi.mock('@/server/audit/robots', async () => {
  const reel = await vi.importActual<typeof import('@/server/audit/robots')>('@/server/audit/robots')
  return { ...reel, DEFAULT_DELAY_MS: 0, ROBOTS_OUVERT: { ...reel.ROBOTS_OUVERT, delayMs: 0 } }
})

const SITE = 'https://veille-essai.ch'
let email: string
let userId: string
let siteId: string

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `veille-${Date.now()}@exemple.test`
  userId = (
    await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
  await subscribeToTestPlan(userId)

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
  await prisma.user.deleteMany({ where: { email } })
})

describe('un constat s’ouvre une fois et se ferme quand il a disparu', () => {
  it('ouvre au premier passage, n’empile pas au second, ferme quand c’est réparé', async () => {
    const { surveillerSite, listWatches } = await import('@/server/audit/surveillance')

    // Tout va bien : rien à signaler.
    const sain = await surveillerSite(userId, siteId)
    expect(sain.ouverts).toBe(0)
    expect(await listWatches(userId, siteId)).toEqual([])

    // Le thème pousse une balise « noindex ». C'est invisible depuis le site.
    metaRobots = '<meta name="robots" content="noindex, follow">'
    const casse = await surveillerSite(userId, siteId)
    expect(casse.ouverts).toBeGreaterThan(0)

    const ouverts = await listWatches(userId, siteId)
    expect(ouverts.map((constat) => constat.checkId)).toContain('watch.noindex')
    // Le constat dit ce que ça coûte, pas seulement ce que c'est.
    expect(ouverts[0]?.why.length).toBeGreaterThan(40)

    /*
     * Deuxième passage, même panne. Rien ne doit s'ouvrir de plus : c'est le même problème
     * qui dure, pas un problème de plus.
     */
    const encore = await surveillerSite(userId, siteId)
    expect(encore.ouverts).toBe(0)
    expect(await listWatches(userId, siteId)).toHaveLength(ouverts.length)

    // Réparé : le constat se ferme, l'écran redevient propre.
    metaRobots = ''
    const repare = await surveillerSite(userId, siteId)
    expect(repare.fermes).toBeGreaterThan(0)
    expect(await listWatches(userId, siteId)).toEqual([])

    // Et l'historique garde la trace de ce qui s'est passé.
    const trace = await withUserScope(userId, (tx) =>
      tx.siteWatch.count({ where: { siteId, checkId: 'watch.noindex' } }),
    )
    expect(trace).toBe(1)
  }, 60_000)
})

describe('ce que la surveillance ne fait pas', () => {
  it('ne surveille pas un site jamais analysé', async () => {
    const { addSite } = await import('@/server/audit/service')
    const { surveillerSite } = await import('@/server/audit/surveillance')

    const autre = await addSite(userId, { url: 'https://jamais-analyse-veille.ch' })
    const passage = await surveillerSite(userId, autre.siteId)
    expect(passage).toEqual({ constats: 0, ouverts: 0, fermes: 0 })
  })

  it('trouve les sites à contrôler malgré le cloisonnement', async () => {
    /*
     * Le défaut qui a rendu la surveillance inopérante depuis son écriture. Le planificateur
     * lisait la table des sites directement ; `Site` étant sous Row Level Security forcé,
     * la requête ne levait aucune erreur et rendait zéro ligne. La tâche tournait chaque
     * semaine, répondait 200, et ne surveillait rien — la panne exacte que cette
     * fonctionnalité existe pour détecter, retournée contre elle.
     *
     * Ce test n'a de valeur que parce qu'il tourne sous le rôle applicatif, avec les
     * politiques actives. Appeler `surveillerSite` directement, comme les tests précédents,
     * passe dans une portée d'utilisateur et ne voit donc jamais le problème.
     */
    const { runScheduledWatch } = await import('@/server/audit/surveillance')
    const { setFlag } = await import('@/server/settings/flags')

    await setFlag('surveillance', true)
    try {
      // Le site a déjà été contrôlé par les tests précédents : on le rend à nouveau éligible.
      await prisma.site.updateMany({ where: { id: siteId }, data: { watchedAt: null } })
      const passage = await runScheduledWatch({ limit: 50 })
      expect(passage.examines).toBeGreaterThan(0)
    } finally {
      await setFlag('surveillance', false)
    }
  })

  it('répond au planificateur en GET comme en POST, et n’existe pas sans jeton', async () => {
    /*
     * Le GET n'est pas un confort : les tâches planifiées de Vercel n'appellent qu'ainsi,
     * sans corps. Déclarée en POST seulement, la route aurait répondu 405 chaque semaine
     * sans que rien ne le signale — et une surveillance en panne ne se plaint pas, c'est
     * exactement ce qui la rend dangereuse.
     */
    const adresse = 'http://localhost/api/cron/surveillance'

    delete process.env.CRON_SECRET
    expect((await cronSurveillanceGet(new Request(adresse))).status).toBe(404)

    process.env.CRON_SECRET = 'jeton-du-planificateur-de-plus-de-32-caracteres'
    const mauvais = await cronSurveillanceGet(
      new Request(adresse, { headers: { authorization: 'Bearer mauvais' } }),
    )
    expect(mauvais.status).toBe(401)

    const entete = { authorization: `Bearer ${process.env.CRON_SECRET}` }
    const enGet = await cronSurveillanceGet(new Request(adresse, { headers: entete }))
    const enPost = await cronSurveillancePost(
      new Request(adresse, {
        method: 'POST',
        headers: { ...entete, 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 1 }),
      }),
    )
    delete process.env.CRON_SECRET

    expect(enGet.status).toBe(200)
    expect(enPost.status).toBe(200)
  })

  it('ne débite aucun crédit', async () => {
    /*
     * C'est la promesse commerciale du produit : ce qui se compte ne se paie pas. Un audit,
     * ses contrôles et ses notes sont gratuits ; la surveillance aussi, puisqu'elle ne fait
     * que compter. Si un crédit partait là, personne ne s'en apercevrait avant la facture.
     */
    const debits = await prisma.creditLedger.count({ where: { userId, delta: { lt: 0 } } })
    expect(debits).toBe(0)
    expect(await prisma.aiUsage.count({ where: { userId } })).toBe(0)
  })
})
