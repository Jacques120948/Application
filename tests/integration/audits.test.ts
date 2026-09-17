import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { DEFAULT_PLANS, FREE_PLAN_ID } from '@/server/billing/plans'
import { withUserScope } from '@/server/db/scope'

/**
 * Ajouter un site, l'analyser, recommencer.
 *
 * Quatre propriétés méritent un test, et chacune répond à une façon de rendre un résultat
 * faux ou de coûter de l'argent à quelqu'un.
 *
 * **Un audit avance par tranches et finit.** C'est toute la mécanique : sans reprise, une
 * analyse de cinquante pages ne tiendrait dans aucune requête ; sans fin, elle tournerait
 * pour toujours.
 *
 * **Un site illisible ne donne pas un audit réussi.** Un serveur qui répond « interdit »
 * rend tout de même une page, avec un titre et des octets. L'enregistrer et annoncer
 * « terminé » serait la pire réponse : fausse, et d'apparence satisfaisante.
 *
 * **Les bornes de l'offre tiennent.** Les sites suivis et les audits du mois sont ce
 * qu'Evoliia paie réellement : un parcours de pages sur le réseau, à sa charge.
 *
 * **Personne ne voit l'audit d'un autre.** Vérifié ici comme ailleurs, parce que c'est la
 * garantie qui ne souffre aucune exception.
 */

const PAGES: Record<string, string> = {
  '/': `<html><head><title>Accueil</title><meta name="description" content="La maison"></head>
    <body><h1>Bienvenue</h1>
      <a href="/boutique">Boutique</a><a href="/contact">Contact</a><a href="/blog">Blog</a>
    </body></html>`,
  '/boutique': `<html><head><title>Boutique</title></head><body><h1>Boutique</h1>
      <a href="/boutique/bougies">Bougies</a><a href="/">Accueil</a></body></html>`,
  '/contact': `<html><head><title>Contact</title></head><body><h1>Contact</h1></body></html>`,
  '/blog': `<html><head><title>Blog</title></head><body><h1>Blog</h1>
      <a href="/blog/lavande">Lavande</a><a href="/blog/cire">Cire</a></body></html>`,
  '/boutique/bougies': `<html><head><title>Bougies</title></head><body><h1>Bougies</h1>
      <a href="/boutique/savons">Savons</a><a href="/boutique/coffrets">Coffrets</a></body></html>`,
  '/boutique/savons': `<html><head><title>Savons</title></head><body><h1>Savons</h1></body></html>`,
  '/boutique/coffrets': `<html><head><title>Coffrets</title></head><body><h1>Coffrets</h1></body></html>`,
  '/blog/lavande': `<html><head><title>Lavande</title></head><body><h1>Lavande</h1></body></html>`,
  '/blog/cire': `<html><head><title>Cire</title></head><body><h1>Cire</h1></body></html>`,
}

/** Ce que le faux serveur répond pour l'accueil. Modifié par le test des sites illisibles. */
let statutAccueil = 200

vi.mock('@/server/audit/net', async () => {
  const reel = await vi.importActual<typeof import('@/server/audit/net')>('@/server/audit/net')
  return {
    ...reel,
    secureFetch: async (brut: string) => {
      const url = new URL(brut)
      if (url.hostname !== 'exemple-audit.ch') throw new Error('hors du site')
      if (url.pathname === '/robots.txt' || url.pathname === '/sitemap.xml') {
        return { url: brut, status: 404, contentType: 'text/plain', body: '', bytes: 0, chain: [brut] }
      }
      const corps = PAGES[url.pathname]
      const status = url.pathname === '/' ? statutAccueil : corps === undefined ? 404 : 200
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
  // Le délai de politesse est réel en production ; ici il ferait durer le test pour rien.
  return { ...reel, DEFAULT_DELAY_MS: 0, ROBOTS_OUVERT: { ...reel.ROBOTS_OUVERT, delayMs: 0 } }
})

const SITE = 'https://exemple-audit.ch'
let userId: string
let autreId: string
let email: string
let autreEmail: string

beforeAll(async () => {
  clearAll()
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {},
      create: { ...plan, features: [...plan.features], interval: 'month' },
    })
  }
  // L'essai n'accorde qu'un audit : les tests en lancent plusieurs, on ouvre ce qu'il faut.
  await prisma.plan.update({
    where: { id: FREE_PLAN_ID },
    data: { sitesMax: 1, pagesPerAudit: 9, auditsPerMonth: 8 },
  })

  email = `audit-${Date.now()}@exemple.test`
  autreEmail = `audit-autre-${Date.now()}@exemple.test`
  userId = (
    await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
  autreId = (
    await register({ email: autreEmail, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [email, autreEmail] } } })
  await prisma.plan.update({
    where: { id: FREE_PLAN_ID },
    data: {
      sitesMax: DEFAULT_PLANS.find((plan) => plan.id === FREE_PLAN_ID)?.sitesMax ?? 1,
      pagesPerAudit: DEFAULT_PLANS.find((plan) => plan.id === FREE_PLAN_ID)?.pagesPerAudit ?? 20,
      auditsPerMonth: DEFAULT_PLANS.find((plan) => plan.id === FREE_PLAN_ID)?.auditsPerMonth ?? 1,
    },
  })
})

/** Fait tourner un audit jusqu'au bout, comme le ferait l'écran. */
async function jusquAuBout(auditId: string): Promise<{ tranches: number; pages: number }> {
  const { advanceAudit } = await import('@/server/audit/service')
  let tranches = 0
  for (;;) {
    const pas = await advanceAudit(userId, auditId)
    tranches += 1
    if (!pas.encore) return { tranches, pages: pas.pagesCrawled }
    if (tranches > 20) throw new Error("l'audit ne s'arrête pas")
  }
}

describe('ajouter un site', () => {
  it('n’en garde que l’origine, et ne le compte qu’une fois', async () => {
    const { addSite } = await import('@/server/audit/service')
    const premier = await addSite(userId, { url: `${SITE}/boutique?utm_source=x` })
    expect(premier.host).toBe('exemple-audit.ch')

    // La même adresse écrite autrement désigne le même site : on ne le double pas.
    const second = await addSite(userId, { url: `${SITE}/contact` })
    expect(second.siteId).toBe(premier.siteId)
  })

  it('refuse au-delà de ce que l’offre accorde', async () => {
    const { addSite } = await import('@/server/audit/service')
    await expect(addSite(userId, { url: 'https://autre-site.ch' })).rejects.toMatchObject({
      code: 'PLAN_LIMIT',
    })
  })

  it('refuse une adresse qui ne mène nulle part de public', async () => {
    const { addSite } = await import('@/server/audit/service')
    for (const adresse of ['http://127.0.0.1:5432', 'http://localhost', 'file:///etc/passwd']) {
      await expect(addSite(userId, { url: adresse }), adresse).rejects.toThrow()
    }
  })
})

describe('l’audit avance par tranches, et finit', () => {
  it('visite le site en plusieurs fois et s’arrête à la borne de l’offre', async () => {
    statutAccueil = 200
    const { addSite, startAudit } = await import('@/server/audit/service')
    const site = await addSite(userId, { url: SITE })
    const audit = await startAudit(userId, site.siteId)

    const resultat = await jusquAuBout(audit.auditId)
    // Neuf pages accordées, et une tranche en visite six : il en faut donc au moins deux.
    expect(resultat.pages).toBe(9)
    expect(resultat.tranches).toBeGreaterThan(1)

    /*
     * La lecture passe par le scope, et pas par le client nu : les tables d'audit sont
     * cloisonnées dans la base, et une requête sans identité ne voit rien. C'est le
     * comportement voulu — ce test l'a découvert en échouant.
     */
    const fini = await withUserScope(userId, (tx) =>
      tx.audit.findFirstOrThrow({ where: { id: audit.auditId } }),
    )
    expect(fini.status).toBe('done')
    expect(fini.finishedAt).not.toBeNull()
  }, 60_000)

  it('relève ce qu’il faut pour juger chaque page', async () => {
    const pages = await withUserScope(userId, (tx) =>
      tx.auditPage.findMany({ where: { audit: { userId } }, orderBy: { depth: 'asc' } }),
    )
    const accueil = pages.find((page) => page.path === '/')
    expect(accueil?.title).toBe('Accueil')
    expect(accueil?.description).toBe('La maison')
    expect(accueil?.depth).toBe(0)
    // Les signaux détaillés sont là aussi : c'est d'eux que vivront les contrôles.
    expect((accueil?.signals as { h1?: string[] } | null)?.h1).toEqual(['Bienvenue'])
    // L'exploration part de l'accueil : ses voisins immédiats sont vus avant les autres.
    expect(pages.some((page) => page.path === '/boutique')).toBe(true)
  })

  it('reprend un audit déjà ouvert au lieu d’en lancer un second', async () => {
    const { addSite, startAudit } = await import('@/server/audit/service')
    const site = await addSite(userId, { url: SITE })
    // Le précédent est terminé : celui-ci est donc neuf.
    const premier = await startAudit(userId, site.siteId)
    /*
     * Tant qu'il n'a pas fini, un second clic rend le même audit. Deux explorations
     * simultanées du même site, ce serait deux fois la charge chez le client pour rien.
     */
    const second = await startAudit(userId, site.siteId)
    expect(second.auditId).toBe(premier.auditId)
  })
})

describe('un site illisible ne donne pas un audit réussi', () => {
  it('échoue clairement quand l’accueil ne répond pas correctement', async () => {
    statutAccueil = 403
    const { addSite, startAudit, advanceAudit } = await import('@/server/audit/service')
    const site = await addSite(userId, { url: SITE })
    const audit = await startAudit(userId, site.siteId)

    await expect(advanceAudit(userId, audit.auditId)).rejects.toThrow(/403/)
    const echoue = await withUserScope(userId, (tx) =>
      tx.audit.findFirstOrThrow({ where: { id: audit.auditId } }),
    )
    expect(echoue.status).toBe('failed')
    // Aucune page n'est retenue : un « terminé, une page » pour un site jamais lu serait
    // faux et aurait l'air d'un succès.
    const retenues = await withUserScope(userId, (tx) =>
      tx.auditPage.count({ where: { auditId: audit.auditId } }),
    )
    expect(retenues).toBe(0)
    statutAccueil = 200
  }, 30_000)
})

describe('cloisonnement', () => {
  it('ne laisse personne voir ni faire avancer l’audit d’un autre', async () => {
    const { readAudit, advanceAudit } = await import('@/server/audit/service')
    const audit = await withUserScope(userId, (tx) =>
      tx.audit.findFirstOrThrow({ where: { userId } }),
    )
    await expect(readAudit(autreId, audit.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(advanceAudit(autreId, audit.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('l’audit rend une note et des constats', () => {
  it('note le site, enregistre les constats, et met les plus coûteux en tête', async () => {
    statutAccueil = 200
    const { addSite, startAudit, readAudit } = await import('@/server/audit/service')
    const site = await addSite(userId, { url: SITE })
    const audit = await startAudit(userId, site.siteId)
    await jusquAuBout(audit.auditId)

    const fini = await readAudit(userId, audit.auditId)
    /*
     * Le site factice est volontairement pauvre — aucune description, aucune donnée
     * structurée, presque pas de texte. Une note parfaite signifierait que les contrôles ne
     * regardent rien.
     */
    expect(fini.seoScore).not.toBeNull()
    expect(fini.seoScore as number).toBeLessThan(100)
    expect(fini.seoScore as number).toBeGreaterThanOrEqual(0)

    const constats = await withUserScope(userId, (tx) =>
      tx.auditFinding.findMany({ where: { auditId: audit.auditId }, orderBy: { lost: 'desc' } }),
    )
    expect(constats.length).toBeGreaterThan(10)

    // Les descriptions manquent sur toutes les pages : le constat doit exister et porter
    // quelques exemples, jamais la liste entière.
    const description = constats.find((constat) => constat.checkId === 'seo.description_missing')
    expect(description?.affected).toBeGreaterThan(0)
    expect((description?.sample as unknown[]).length).toBeGreaterThan(0)
    expect((description?.sample as unknown[]).length).toBeLessThanOrEqual(5)

    // Le plus coûteux en premier : c'est la réponse à « par quoi je commence ».
    const premier = constats[0]
    expect(premier?.lost).toBeGreaterThanOrEqual(constats[1]?.lost ?? 0)
  }, 60_000)

  it('ne note pas un audit tant qu’il n’est pas terminé', async () => {
    statutAccueil = 200
    const { addSite, startAudit, advanceAudit } = await import('@/server/audit/service')
    const site = await addSite(userId, { url: SITE })
    const audit = await startAudit(userId, site.siteId)

    const premiere = await advanceAudit(userId, audit.auditId)
    expect(premiere.encore).toBe(true)

    /*
     * Une note rendue sur un site à moitié exploré serait fausse plutôt qu'incomplète : les
     * doublons et les pages orphelines se jugent par comparaison avec ce qui n'a pas encore
     * été visité.
     */
    const enCours = await withUserScope(userId, (tx) =>
      tx.audit.findFirstOrThrow({ where: { id: audit.auditId } }),
    )
    expect(enCours.seoScore).toBeNull()
  }, 60_000)
})

describe('le tableau de bord', () => {
  it('rend les deux notes, l’écart avec l’analyse précédente et l’historique', async () => {
    statutAccueil = 200
    const { addSite, startAudit, readDashboard } = await import('@/server/audit/service')
    const site = await addSite(userId, { url: SITE })
    const audit = await startAudit(userId, site.siteId)
    await jusquAuBout(audit.auditId)

    const tableau = await readDashboard(userId)
    expect(tableau).not.toBeNull()
    if (tableau === null) return

    expect(tableau.site.host).toBe('exemple-audit.ch')
    /*
     * Deux notes, jamais une seule. Le site factice est pauvre pour les deux moteurs — ni
     * description, ni données structurées, ni contenu : une note pleine d'un côté ou de
     * l'autre voudrait dire que les contrôles ne regardent rien.
     */
    expect(tableau.audit.seoScore).not.toBeNull()
    expect(tableau.audit.geoScore).not.toBeNull()
    expect(tableau.audit.geoScore as number).toBeLessThan(100)

    // Une analyse précédente existe : c'est elle qui permet d'afficher un écart plutôt
    // qu'un chiffre nu, et c'est la seule chose qui fasse revenir quelqu'un.
    expect(tableau.precedent).not.toBeNull()
    expect(tableau.historique.length).toBeGreaterThanOrEqual(2)

    // De la plus ancienne à la plus récente : une courbe qui descend le temps se lit à
    // l'envers, et personne ne le remarque avant d'avoir conclu que son site s'effondre.
    const dates = tableau.historique.map((mesure) => mesure.finishedAt?.getTime() ?? 0)
    expect([...dates].sort((a, b) => a - b)).toEqual(dates)
    expect(dates[dates.length - 1]).toBe(tableau.audit.finishedAt?.getTime())
  }, 60_000)

  it('ne montre rien du site d’un autre, ni par défaut ni sur demande', async () => {
    const { readDashboard } = await import('@/server/audit/service')
    const mien = await readDashboard(userId)
    expect(mien).not.toBeNull()

    // Sans site à soi, il n'y a rien à montrer — et surtout pas celui du voisin.
    expect(await readDashboard(autreId)).toBeNull()
    // Un identifiant demandé n'ouvre aucune porte : il est cherché parmi ses propres sites.
    expect(await readDashboard(autreId, mien?.site.id)).toBeNull()
  })
})

describe('le plan d’action', () => {
  it('garde l’état d’un constat d’une analyse à l’autre', async () => {
    /*
     * C'est toute la raison d'être du plan. Un état attaché à l'audit repartirait de zéro
     * chaque mois, et le tri serait à refaire à chaque fois : ce ne serait plus un plan,
     * juste un rapport avec des cases.
     */
    statutAccueil = 200
    const { addSite, startAudit } = await import('@/server/audit/service')
    const { readPlan, setActionState } = await import('@/server/audit/plan')

    const site = await addSite(userId, { url: SITE })
    const premier = await readPlan(userId, site.siteId)
    expect(premier).not.toBeNull()
    const cible = premier?.lignes[0]
    expect(cible?.state).toBe('todo')
    if (cible === undefined) return

    await setActionState(userId, site.siteId, cible.checkId, 'doing', 'commencé sur l’accueil')
    const apresMarquage = await readPlan(userId, site.siteId)
    const marquee = apresMarquage?.lignes.find((ligne) => ligne.checkId === cible.checkId)
    expect(marquee?.state).toBe('doing')
    expect(marquee?.note).toBe('commencé sur l’accueil')

    // Une nouvelle analyse du même site : l'état doit avoir survécu.
    const audit = await startAudit(userId, site.siteId)
    await jusquAuBout(audit.auditId)
    const apresAudit = await readPlan(userId, site.siteId)
    expect(apresAudit?.auditId).toBe(audit.auditId)
    const survivante = apresAudit?.lignes.find((ligne) => ligne.checkId === cible.checkId)
    expect(survivante?.state).toBe('doing')
  }, 60_000)

  it('refuse un contrôle inventé et le site d’un autre', async () => {
    const { setActionState, readPlan } = await import('@/server/audit/plan')
    const site = await withUserScope(userId, (tx) =>
      tx.site.findFirstOrThrow({ where: { userId } }),
    )
    // Un identifiant inventé ferait une ligne fantôme, visible nulle part et inretirable.
    await expect(
      setActionState(userId, site.id, 'seo.inexistant', 'done'),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    // Et le site d'un autre reste celui d'un autre, même avec son identifiant en main.
    await expect(
      setActionState(autreId, site.id, 'seo.title_missing', 'done'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await readPlan(autreId, site.id)).toBeNull()
  })
})

describe('l’historique', () => {
  it('rend les analyses de la plus récente à la plus ancienne, avec leur écart', async () => {
    const { listAudits } = await import('@/server/audit/plan')
    const site = await withUserScope(userId, (tx) =>
      tx.site.findFirstOrThrow({ where: { userId } }),
    )
    const analyses = await listAudits(userId, site.id)
    expect(analyses.length).toBeGreaterThanOrEqual(2)

    const dates = analyses.map((analyse) => analyse.finishedAt?.getTime() ?? 0)
    expect([...dates].sort((a, b) => b - a)).toEqual(dates)

    // La plus ancienne de la liste n'a rien derrière elle : pas d'écart inventé.
    expect(analyses[analyses.length - 1]?.seoDelta).toBeNull()
    // Les autres comparent bien à la ligne suivante, qui est l'analyse précédente.
    const avant = analyses[1]
    const apres = analyses[0]
    if (avant?.seoScore !== null && avant !== undefined && apres?.seoScore !== null && apres !== undefined) {
      expect(apres.seoDelta).toBe((apres.seoScore ?? 0) - (avant.seoScore ?? 0))
    }
  })

  it('ne nomme que ce qui a bougé entre deux analyses', async () => {
    const { compareAudits, listAudits } = await import('@/server/audit/plan')
    const site = await withUserScope(userId, (tx) =>
      tx.site.findFirstOrThrow({ where: { userId } }),
    )
    const analyses = await listAudits(userId, site.id)
    const avant = analyses[1]
    const apres = analyses[0]
    if (avant === undefined || apres === undefined) throw new Error('deux analyses attendues')

    const comparaison = await compareAudits(userId, avant.id, apres.id)
    /*
     * Un contrôle identique des deux côtés ne figure pas : une comparaison qui liste trente
     * lignes dont vingt-huit identiques cache les deux qui comptent.
     */
    for (const mouvement of comparaison.mouvements) {
      expect(mouvement.avant, mouvement.checkId).not.toBe(mouvement.apres)
    }
    expect(comparaison.mesurable).toBe(true)

    // Comparée à elle-même, une analyse n'a rien bougé du tout.
    const immobile = await compareAudits(userId, apres.id, apres.id)
    expect(immobile.mouvements).toEqual([])
    expect(immobile.mesurable).toBe(true)
  })

  it('refuse de comparer avec une analyse qui n’a jamais été notée', async () => {
    /*
     * Les audits menés avant que les contrôles n'existent ont été explorés et enregistrés,
     * mais jamais notés. Les confronter à un audit récent ferait passer chaque constat pour
     * une apparition : un site stable se lirait comme un site qui vient de s'effondrer.
     */
    const { compareAudits, listAudits } = await import('@/server/audit/plan')
    const site = await withUserScope(userId, (tx) =>
      tx.site.findFirstOrThrow({ where: { userId } }),
    )
    const recent = (await listAudits(userId, site.id))[0]
    if (recent === undefined) throw new Error('une analyse attendue')

    const muet = await withUserScope(userId, (tx) =>
      tx.audit.create({
        data: {
          siteId: site.id,
          userId,
          status: 'done',
          pagesCrawled: 4,
          finishedAt: new Date(Date.now() - 90 * 86_400_000),
        },
      }),
    )

    const comparaison = await compareAudits(userId, muet.id, recent.id)
    expect(comparaison.mesurable).toBe(false)
    expect(comparaison.mouvements).toEqual([])

    await withUserScope(userId, (tx) => tx.audit.delete({ where: { id: muet.id } }))
  })

  it('ne compare pas les analyses d’un autre', async () => {
    const { compareAudits, listAudits } = await import('@/server/audit/plan')
    const site = await withUserScope(userId, (tx) =>
      tx.site.findFirstOrThrow({ where: { userId } }),
    )
    const analyses = await listAudits(userId, site.id)
    const [apres, avant] = analyses
    if (avant === undefined || apres === undefined) throw new Error('deux analyses attendues')
    await expect(compareAudits(autreId, avant.id, apres.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(await listAudits(autreId, site.id)).toEqual([])
  })
})
