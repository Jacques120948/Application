import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import * as operations from '@/server/ai/operations'
import { SEUILS_REDACTION } from '@/server/audit/checks/geo'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * Les articles rédigés par l'équipe.
 *
 * C'est l'action la plus chère du produit — quinze à trente crédits — et chacune des
 * propriétés testées ici répond à une façon de facturer quelqu'un pour rien.
 *
 * **Le brief vient de l'analyse, pas du vide.** C'est toute la fonctionnalité : « Milo écrit
 * en fonction de ce que l'analyse relève ». Un appel parti sans les constats ni les pages du
 * site produirait un article générique, payé au prix d'un article sur mesure.
 *
 * **On n'appelle pas le modèle quand il n'y a rien à lui dire.** Sans analyse, ou sans
 * analyse ni sujet, l'appel est refusé avant d'être facturé.
 *
 * **Les seuils donnés au rédacteur sont ceux du moteur de contrôle.** Un article écrit sous
 * d'autres chiffres serait mal noté par Evoliia elle-même, qui l'a pourtant vendu.
 *
 * **Ce qui est payé est conservé.** Relire est gratuit, et personne d'autre ne le lit.
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
      if (url.hostname !== 'articles-essai.ch') throw new Error('hors du site')
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
  writeArticle: vi.fn(),
}))

const ecrire = vi.mocked(operations.writeArticle)

/** Ce qu'un modèle rend, dans la forme exacte du schéma de rédaction. */
function articleRendu() {
  return {
    value: {
      sujet: 'Choisir entre une fenêtre bois et une fenêtre bois-métal',
      fondement:
        'Aucune de vos pages ne traite ce choix, et l’analyse relève qu’aucune ne pose de question.',
      titre: 'Fenêtre bois ou bois-métal : comment choisir',
      chapo:
        'Une fenêtre bois-métal protège le bois des intempéries côté extérieur, là où une fenêtre bois demande un entretien tous les cinq à huit ans selon l’exposition.',
      sections: [
        { titre: 'Ce qui les distingue', corps: 'Le bois seul respire.\n\n- Entretien régulier\n- Coût plus bas' },
        { titre: 'Durées d’entretien', corps: 'Comptez cinq à huit ans entre deux reprises.' },
      ],
      questions: [
        { question: 'Combien de temps dure une fenêtre bois ?', reponse: 'Entre trente et cinquante ans.' },
        { question: 'Le bois-métal est-il plus cher ?', reponse: 'Oui, de vingt à trente pour cent.' },
      ],
      metaTitle: 'Fenêtre bois ou bois-métal : comment choisir',
      metaDescription:
        'Entretien, durée de vie et coût : ce qui sépare une fenêtre bois d’une fenêtre bois-métal, et comment trancher.',
    },
    creditsSpent: 18,
    balance: 0,
  }
}

const SITE = 'https://articles-essai.ch'
let userId: string
let autreId: string
let email: string
let autreEmail: string
let siteId: string

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `articles-${Date.now()}@exemple.test`
  autreEmail = `articles-autre-${Date.now()}@exemple.test`
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

describe('le brief vient de l’analyse', () => {
  it('donne au rédacteur les manques relevés, les pages du site, et les seuils du moteur', async () => {
    /*
     * C'est toute la fonctionnalité : « en fonction de ce que l'analyse relève ». Un appel
     * parti sans les constats ni les pages produirait un article générique, facturé au prix
     * d'un article sur mesure — et personne ne le verrait, puisque le texte serait plausible.
     */
    const { redigerArticle, listManquesDeContenu } = await import('@/server/audit/articles')

    const manques = await listManquesDeContenu(userId, siteId)
    expect(manques.length).toBeGreaterThan(0)

    ecrire.mockResolvedValueOnce(articleRendu())
    await redigerArticle(userId, siteId, '', 'fr')

    expect(ecrire).toHaveBeenCalledTimes(1)
    const appel = ecrire.mock.calls[0]?.[0]
    expect(appel).toBeDefined()
    if (appel === undefined) return

    // Les constats de l'analyse, avec ce qu'ils coûtent et combien de pages ils touchent.
    expect(appel.constats.length).toBe(manques.length)
    expect(appel.constats[0]?.affected).toBeGreaterThan(0)

    // Les pages déjà en ligne : sans elles, l'article refait une page qui existe.
    expect(appel.pages.map((page) => page.path)).toContain('/fenetres')

    /*
     * Et les seuils du moteur de contrôle, pas des chiffres recopiés : un article écrit sous
     * d'autres bornes serait mal noté par l'analyse qui l'a pourtant fait écrire.
     */
    expect(appel.seuils).toEqual(SEUILS_REDACTION)
  })
})

describe('un article payé est conservé', () => {
  it('assemble le corps, compte les mots, et se relit sans repasser par le modèle', async () => {
    const { redigerArticle, listArticles, readArticle } = await import('@/server/audit/articles')

    ecrire.mockResolvedValueOnce(articleRendu())
    const article = await redigerArticle(userId, siteId, 'Les fenêtres en bois', 'fr')

    expect(article.creditsSpent).toBe(18)
    expect(article.demande).toBe('Les fenêtres en bois')
    // Les intertitres sont dans le corps : c'est ce qui rend l'article parcourable.
    expect(article.corps).toContain('## Ce qui les distingue')
    expect(article.corps).toContain('## Durées d’entretien')
    expect(article.wordCount).toBeGreaterThan(0)
    expect(article.questions.length).toBe(2)

    const avant = ecrire.mock.calls.length
    const relu = await readArticle(userId, article.id)
    expect(relu.titre).toBe(article.titre)
    expect(ecrire.mock.calls.length).toBe(avant)

    const liste = await listArticles(userId, siteId)
    expect(liste.some((ligne) => ligne.id === article.id)).toBe(true)
  })

  it('reste invisible aux autres, et se retire quand on le décide', async () => {
    const { redigerArticle, readArticle, listArticles, supprimerArticle } = await import(
      '@/server/audit/articles'
    )

    ecrire.mockResolvedValueOnce(articleRendu())
    const article = await redigerArticle(userId, siteId, 'Un sujet à moi', 'fr')

    // Un article non publié porte le métier de la personne : personne d'autre ne le lit.
    await expect(readArticle(autreId, article.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await listArticles(autreId, siteId)).toEqual([])

    await supprimerArticle(userId, article.id)
    await expect(readArticle(userId, article.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('on n’appelle pas le modèle quand il n’y a rien à lui dire', () => {
  it('refuse un article sur un site jamais analysé, sans rien facturer', async () => {
    const { addSite } = await import('@/server/audit/service')
    const { redigerArticle } = await import('@/server/audit/articles')

    const autre = await addSite(autreId, { url: 'https://jamais-analyse.ch' })
    const avant = ecrire.mock.calls.length

    // Un site sans analyse n'est pas introuvable : il n'a simplement rien à dire au rédacteur.
    await expect(redigerArticle(autreId, autre.siteId, '', 'fr')).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    expect(ecrire.mock.calls.length).toBe(avant)
  })

  it('refuse un site qui n’appartient pas à la personne', async () => {
    const { redigerArticle } = await import('@/server/audit/articles')
    const avant = ecrire.mock.calls.length

    await expect(redigerArticle(autreId, siteId, 'Peu importe', 'fr')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(ecrire.mock.calls.length).toBe(avant)
  })
})
