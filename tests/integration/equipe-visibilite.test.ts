import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import * as operations from '@/server/ai/operations'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * L'équipe de visibilité : ce que chacun voit, et ce que personne ne voit.
 *
 * Quatre propriétés, et chacune répond à une façon de rendre l'équipe fausse ou coûteuse.
 *
 * **Chacun a son périmètre.** Un spécialiste qui voit tout est un assistant généraliste avec
 * un prénom, et cela se sent au bout de trois échanges. Néo voit les balises, Gia voit ce
 * qu'une machine comprend, et ni l'un ni l'autre ne reçoit les constats de l'autre moteur.
 *
 * **Rien n'arrive au modèle qui ne soit mesuré.** Les faits sortent des contrôles, qui sont
 * du code. Si une note apparaissait dans le contexte sans avoir été calculée, le modèle la
 * répéterait — et personne ne pourrait refaire le calcul.
 *
 * **Les droits passent avant la dépense.** Un spécialiste fermé ne doit pas consommer un
 * appel avant d'être refusé.
 *
 * **Personne ne parle du site d'un autre.** Vérifié ici comme ailleurs.
 */

const PAGES: Record<string, string> = {
  '/': `<html lang="fr"><head><title>Accueil</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Roulin"}</script>
    </head><body><h1>Bienvenue</h1>
    <p>Notre atelier de menuiserie existe depuis 1998 et travaille le chêne massif suisse.</p>
    <a href="/agencements">Agencements</a></body></html>`,
  '/agencements': `<html lang="fr"><head><title>Agencements</title></head><body><h1>Agencements</h1>
    <ul><li>Cuisines</li><li>Dressings</li></ul>
    <p>Cuisines, dressings et bibliothèques sur mesure, posés en Gruyère et dans le canton.</p></body></html>`,
}

vi.mock('@/server/audit/net', async () => {
  const reel = await vi.importActual<typeof import('@/server/audit/net')>('@/server/audit/net')
  return {
    ...reel,
    secureFetch: async (brut: string) => {
      const url = new URL(brut)
      if (url.hostname !== 'equipe-essai.ch') throw new Error('hors du site')
      const corps = PAGES[url.pathname]
      const contenu = corps ?? '<html><head><title>Introuvable</title></head><body></body></html>'
      return {
        url: brut,
        status: corps === undefined ? 404 : 200,
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
  askVisibilityAgent: vi.fn(),
}))

const demander = vi.mocked(operations.askVisibilityAgent)

const SITE = 'https://equipe-essai.ch'
let userId: string
let autreId: string
let email: string
let autreEmail: string
let siteId: string

/** Ce qui a été réellement envoyé au modèle lors du dernier appel. */
function dernierContexte(): string {
  const appel = demander.mock.calls[demander.mock.calls.length - 1]
  return appel?.[0]?.facts ?? ''
}

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `equipe-${Date.now()}@exemple.test`
  autreEmail = `equipe-autre-${Date.now()}@exemple.test`
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
  const site = await addSite(userId, { url: SITE, about: 'Menuiserie artisanale à Bulle.' })
  siteId = site.siteId
  const audit = await startAudit(userId, siteId)
  for (let tour = 0; tour < 20; tour += 1) {
    if (!(await advanceAudit(userId, audit.auditId)).encore) break
  }

  demander.mockResolvedValue({ answer: 'Réponse du spécialiste.', takeaway: null, creditsSpent: 2 })
}, 90_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [email, autreEmail] } } })
})

describe('chacun voit ce qui le regarde', () => {
  it('donne à Néo les balises et les constats de référencement, pas ceux des moteurs IA', async () => {
    const { askVisibility } = await import('@/server/agents/visibility-service')
    await askVisibility(userId, { siteId, agent: 'seo', question: 'Mes titres sont-ils bons ?', history: [] }, 'fr')

    const contexte = dernierContexte()
    expect(contexte).toContain('equipe-essai.ch')
    // Les balises réelles, que lui seul reçoit sous cette forme.
    expect(contexte).toContain('title:')
    expect(contexte).toContain('description:')
    // Et pas le vocabulaire du périmètre de Gia.
    expect(contexte).not.toContain('données structurées:')
  }, 30_000)

  it('donne à Gia ce qu’une machine comprend, pas les balises de Néo', async () => {
    const { askVisibility } = await import('@/server/agents/visibility-service')
    await askVisibility(userId, { siteId, agent: 'geo', question: 'Que comprend une IA ?', history: [] }, 'fr')

    const contexte = dernierContexte()
    expect(contexte).toContain('données structurées:')
    expect(contexte).toContain('intertitres-questions:')
    expect(contexte).not.toContain('| description:')
  }, 30_000)

  it('donne à Milo le texte des pages, que les autres ne voient pas', async () => {
    const { askVisibility } = await import('@/server/agents/visibility-service')
    await askVisibility(userId, { siteId, agent: 'content', question: 'Réécris mon accueil.', history: [] }, 'fr')

    const contexte = dernierContexte()
    expect(contexte).toContain('mots |')
    expect(contexte).toContain('début:')
  }, 30_000)

  it('donne à Oria les constats de ses collègues, et jamais leur matière première', async () => {
    /*
     * La règle qui fait la différence entre une directrice et un généraliste avec un
     * prénom. On lui donne des constats déjà rendus, déjà classés, avec le nom de celui qui
     * les a rendus. Lui donner les pages, les balises ou les campagnes la ferait refaire le
     * travail de ses spécialistes — plus mal, plus cher, et parfois en les contredisant sur
     * l'écran d'à côté.
     *
     * La seconde moitié compte autant : elle doit savoir de qui elle n'a pas de nouvelles.
     * Sans compte publicitaire relié, un silence serait comblé par une supposition.
     */
    const { askVisibility } = await import('@/server/agents/visibility-service')
    await askVisibility(
      userId,
      { siteId, agent: 'oria', question: 'Par quoi je commence ?', history: [] },
      'fr',
    )

    const contexte = dernierContexte()
    // L'état de chaque canal, et l'ordre déjà fait.
    expect(contexte).toContain('État de chaque canal')
    // Elle sait qui n'a rien dit : aucun compte publicitaire n'est relié sur ce compte.
    expect(contexte).toContain('SOURCES ABSENTES')
    expect(contexte).toContain('Naya')
    // Et rien de la matière première des autres.
    expect(contexte).not.toContain('Pages relevées')
    expect(contexte).not.toContain('données structurées:')
    expect(contexte).not.toContain('| description:')
  }, 30_000)

  it('donne à Cleo ce que la page offre pour décider, et lui dit qu’elle ne voit aucune vente', async () => {
    /*
     * Sa branche a bien failli ne pas exister : sans elle, Cleo tombait dans le périmètre de
     * Milo et recevait le texte des pages avec les constats des trois moteurs. Un
     * spécialiste qui voit tout répond à côté, et celui-ci aurait commenté du référencement
     * sous le titre « conversion ».
     *
     * La seconde assertion compte autant : Cleo porte un nom qui évoque la mesure des
     * ventes, et aucune n'est reliée. Si le contexte ne le dit pas, le modèle comble — et il
     * comble avec un taux de conversion inventé.
     */
    const { askVisibility } = await import('@/server/agents/visibility-service')
    await askVisibility(
      userId,
      { siteId, agent: 'cro', question: 'Pourquoi personne n’achète ?', history: [] },
      'fr',
    )

    const contexte = dernierContexte()
    expect(contexte).toContain('boutons:')
    expect(contexte).toContain('réassurance:')
    expect(contexte).toContain('AUCUNE DONNÉE DE VENTE')
    // Ni les balises de Néo, ni le vocabulaire de Gia, ni le texte de Milo.
    expect(contexte).not.toContain('| description:')
    expect(contexte).not.toContain('données structurées:')
    expect(contexte).not.toContain('début:')
  }, 30_000)

  it('donne à Léa les deux moteurs, et pas le détail des pages', async () => {
    const { askVisibility } = await import('@/server/agents/visibility-service')
    await askVisibility(userId, { siteId, agent: 'audit', question: 'Par quoi je commence ?', history: [] }, 'fr')

    const contexte = dernierContexte()
    // Elle dit par quoi commencer : elle voit les constats, pas les balises à réécrire.
    expect(contexte).toContain('Constats mesurés')
    expect(contexte).not.toContain('Pages relevées')
  }, 30_000)
})

describe('rien n’arrive au modèle qui ne soit mesuré', () => {
  it('transmet les notes telles qu’elles ont été calculées, et le dit quand elles manquent', async () => {
    const { readSiteFacts } = await import('@/server/agents/visibility-context')
    const { readDashboard } = await import('@/server/audit/service')

    const tableau = await readDashboard(userId, siteId)
    const contexte = await readSiteFacts('audit', userId, siteId)
    expect(contexte).toContain(`Note de référencement ${tableau?.audit.seoScore}/100`)
    expect(contexte).toContain(`« moteurs IA » ${tableau?.audit.geoScore}/100`)
    // Ce que le créateur a écrit de son activité lui revient tel quel, jamais complété.
    expect(contexte).toContain('Menuiserie artisanale à Bulle.')
  })

  it('n’invente pas de constats pour un site jamais analysé', async () => {
    const { addSite } = await import('@/server/audit/service')
    const { readSiteFacts } = await import('@/server/agents/visibility-context')
    /*
     * Un autre domaine, et non une autre page : `addSite` dédoublonne par hôte, si bien
     * qu'une seconde adresse du même site rendrait celui qui vient d'être analysé.
     */
    const vierge = await addSite(userId, { url: 'https://jamais-analyse.ch' })
    const contexte = await readSiteFacts('seo', userId, vierge.siteId)
    /*
     * Un site sans analyse n'a aucun fait. Le dire est la seule réponse juste : un contexte
     * muet laisserait le modèle broder sur ce qu'il imagine du site.
     */
    expect(contexte).toContain('Aucune analyse terminée')
  })
})

describe('ce qui passe avant la dépense', () => {
  it('refuse un spécialiste fermé sans appeler le modèle', async () => {
    const { askVisibility } = await import('@/server/agents/visibility-service')
    // L'autre compte n'a pas d'offre qui ouvre l'équipe : le refus doit venir des droits.
    await prisma.subscription.deleteMany({ where: { userId: autreId } })
    demander.mockClear()
    await expect(
      askVisibility(autreId, { siteId, agent: 'seo', question: 'Une question.', history: [] }, 'fr'),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT' })
    expect(demander).not.toHaveBeenCalled()
  })

  it('refuse le site d’un autre avant tout appel', async () => {
    const { askVisibility, getVisibilityDesk } = await import('@/server/agents/visibility-service')
    await subscribeToTestPlan(autreId)
    demander.mockClear()
    await expect(
      askVisibility(autreId, { siteId, agent: 'seo', question: 'Une question.', history: [] }, 'fr'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(demander).not.toHaveBeenCalled()
    await expect(getVisibilityDesk(autreId, siteId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('l’équipe garde une mémoire commune', () => {
  it('transmet à un spécialiste ce que ses collègues ont retenu, jamais ce qu’il a dit lui-même', async () => {
    const { askVisibility } = await import('@/server/agents/visibility-service')

    demander.mockResolvedValueOnce({
      answer: 'Vos titres sont trop courts.',
      takeaway: 'Les titres du site font moins de vingt signes.',
      creditsSpent: 2,
    })
    await askVisibility(userId, { siteId, agent: 'seo', question: 'Mes titres ?', history: [] }, 'fr')

    demander.mockResolvedValueOnce({ answer: 'Réponse.', takeaway: null, creditsSpent: 2 })
    await askVisibility(userId, { siteId, agent: 'geo', question: 'Et pour les IA ?', history: [] }, 'fr')

    const appel = demander.mock.calls[demander.mock.calls.length - 1]?.[0]
    expect(appel?.teamMemory).toContain('moins de vingt signes')

    /*
     * Et Néo ne se relit pas lui-même : sa propre phrase n'est pas une information nouvelle,
     * et la lui renvoyer lui ferait croire qu'un collègue l'a confirmée.
     */
    demander.mockResolvedValueOnce({ answer: 'Réponse.', takeaway: null, creditsSpent: 2 })
    await askVisibility(userId, { siteId, agent: 'seo', question: 'Et maintenant ?', history: [] }, 'fr')
    const sien = demander.mock.calls[demander.mock.calls.length - 1]?.[0]
    expect(sien?.teamMemory ?? '').not.toContain('moins de vingt signes')
  }, 30_000)
})
