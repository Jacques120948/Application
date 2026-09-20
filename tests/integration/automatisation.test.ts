import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { addSite } from '@/server/audit/service'
import { ecrireReglages, lireReglages, tournerQuotidien } from '@/server/audit/automatisation'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * La tournée quotidienne, de bout en bout.
 *
 * Une propriété domine, et elle a déjà coûté cher une fois. `Site` est sous Row Level
 * Security forcé : une lecture faite hors de la portée d'un propriétaire ne lève pas
 * d'erreur — elle rend zéro ligne. La surveillance hebdomadaire est morte ainsi pendant des
 * semaines, en répondant 200 et en ne surveillant rien.
 *
 * Ce test tourne sous le rôle applicatif, donc sous les mêmes politiques que la production.
 * Une tournée qui lirait la table directement trouverait zéro site et passerait pour
 * réussie ; ici elle échouerait.
 */

let email: string
let userId: string
let siteId: string

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `auto-${Date.now()}@exemple.test`
  userId = (
    await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
  await subscribeToTestPlan(userId)
  siteId = (await addSite(userId, { url: 'https://tournee-essai.ch' })).siteId
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('ce qui tourne tout seul', () => {
  it('n’a rien d’allumé tant que personne ne l’a allumé', async () => {
    const reglages = await lireReglages(userId, siteId)
    expect(reglages.indexation).toBe(false)
    expect(reglages.releve).toBe(false)
    expect(reglages.redaction).toBe(false)
    expect(reglages.depot).toBe(false)
  })

  it('borne le rythme côté serveur, quoi qu’envoie le navigateur', async () => {
    /*
     * Le rythme décide d'une dépense. Une borne d'écran n'est pas une borne : ce qui
     * arrive ici est revalidé, sinon un appel direct autoriserait trente articles par
     * semaine sur le compte de quelqu'un.
     */
    const abusif = await ecrireReglages(userId, siteId, { parPeriode: 99, periode: 'siecle' as never })
    expect(abusif.parPeriode).toBe(3)
    expect(abusif.periode).toBe('semaine')

    const negatif = await ecrireReglages(userId, siteId, { parPeriode: 0 })
    expect(negatif.parPeriode).toBe(1)
  })

  it('trouve les sites à traiter en passant par la portée de leur propriétaire', async () => {
    /*
     * Le test qui compte. Avec une lecture non cloisonnée, `sites` vaut zéro et la tournée
     * se déclare passée — exactement la panne silencieuse qu'a connue la surveillance.
     */
    await ecrireReglages(userId, siteId, { releve: true })

    const bilan = await tournerQuotidien(50)
    expect(bilan.sites).toBeGreaterThan(0)
  })

  it('ne relève rien quand Google n’est pas relié, et ne casse pas pour autant', async () => {
    /*
     * Un site sans Search Console est un état ordinaire, pas une panne. La tournée le
     * traverse sans rien écrire et sans lever : sinon une boutique non reliée priverait
     * tous les comptes suivants de leur nuit.
     */
    const bilan = await tournerQuotidien(50)
    expect(bilan.releves).toBe(0)
    expect(bilan.echecs).toBe(0)
  })
})
