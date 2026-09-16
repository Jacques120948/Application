import { describe, expect, it } from 'vitest'
import { relevantPages, selectEditContext, truncationLeak } from '@/server/agent/context'
import { buildTemplate } from '@/server/spec/templates'
import type { AppSpec } from '@/server/spec/schema'

/**
 * Ce qu'on montre au modèle pour modifier une application.
 *
 * Deux propriétés comptent plus que le gain de taille, et ce sont elles qui sont
 * vérifiées ici : la structure transmise reste complète — sinon les chemins indexés des
 * opérations viseraient à côté — et un texte coupé ne peut pas revenir dans l'application.
 */

const petit = buildTemplate('content', {
  name: 'Carnet de recettes',
  tagline: 'Les recettes de la maison',
  description: 'Un carnet partagé où chacun dépose ses recettes et retrouve celles des autres.',
  locale: 'fr',
})

/** Une application assez fournie pour valoir un résumé : des textes longs, partout. */
function grosseApplication(): AppSpec {
  const clone = structuredClone(petit) as AppSpec
  const pave = ' Un paragraphe volontairement long, écrit pour peser.'.repeat(30)
  for (const page of clone.pages) {
    for (const block of page.blocks) {
      const champs = block as unknown as Record<string, unknown>
      for (const [key, value] of Object.entries(champs)) {
        if (key !== 'id' && key !== 'type' && typeof value === 'string' && value.length > 20) {
          champs[key] = `${value}${pave}`
        }
      }
    }
  }
  return clone
}

describe('taille du contexte', () => {
  it('transmet une petite application telle quelle', () => {
    const contexte = selectEditContext(petit, 'change le texte du bouton')
    expect(contexte.full).toBe(true)
    expect(contexte.text).toBe(JSON.stringify(petit))
  })

  it('résume une application fournie', () => {
    const grosse = grosseApplication()
    const contexte = selectEditContext(grosse, 'change le texte du bouton')
    expect(contexte.full).toBe(false)
    expect(contexte.text.length).toBeLessThan(JSON.stringify(grosse).length)
  })

  it('transmet tout à la reprise, quelle que soit la taille', () => {
    const grosse = grosseApplication()
    const contexte = selectEditContext(grosse, 'change le texte du bouton', { full: true })
    expect(contexte.full).toBe(true)
    expect(contexte.text).toBe(JSON.stringify(grosse))
  })
})

describe('fidélité de la structure', () => {
  it('garde toutes les pages, tous les blocs et tous les identifiants', () => {
    const grosse = grosseApplication()
    const contexte = selectEditContext(grosse, 'change le texte du bouton')
    const resume = JSON.parse(contexte.text.slice(contexte.text.indexOf('{'))) as AppSpec

    expect(resume.pages).toHaveLength(grosse.pages.length)
    for (const [index, page] of grosse.pages.entries()) {
      const vue = resume.pages[index]!
      expect(vue.id).toBe(page.id)
      expect(vue.path).toBe(page.path)
      expect(vue.requiresAuth).toBe(page.requiresAuth)
      expect(vue.blocks.map((block) => block.id)).toEqual(page.blocks.map((block) => block.id))
      expect(vue.blocks.map((block) => block.type)).toEqual(page.blocks.map((block) => block.type))
    }
    // Le thème, les comptes et les modèles de données sont courts : jamais résumés.
    expect(resume.theme).toEqual(grosse.theme)
    expect(resume.dataModels).toEqual(grosse.dataModels)
  })

  it('reconnaît la page que la demande désigne', () => {
    const cible = petit.pages[1]!
    const pages = relevantPages(petit, `sur la page ${cible.title}, ajoute un bouton`)
    expect(pages.map((page) => page.path)).toContain(cible.path)
  })

  it('ne désigne aucune page quand la demande n’en nomme aucune', () => {
    expect(relevantPages(petit, 'mets le thème en bleu')).toHaveLength(0)
  })
})

describe('un texte coupé ne revient pas dans l’application', () => {
  const spec = grosseApplication()

  it('refuse une opération qui réécrirait un texte amputé', () => {
    const bloc = spec.pages[0]!.blocks[0] as unknown as Record<string, unknown>
    const long = Object.values(bloc).find(
      (value): value is string => typeof value === 'string' && value.length > 100,
    )
    expect(long).toBeDefined()
    const coupe = `${long!.slice(0, 60).trimEnd()}…`
    expect(
      truncationLeak(spec, [{ op: 'set', path: 'pages[0].blocks[0].title', value: coupe }]),
    ).not.toBeNull()
  })

  it('laisse passer des points de suspension écrits volontairement', () => {
    expect(
      truncationLeak(spec, [
        { op: 'set', path: 'pages[0].blocks[0].title', value: 'Et bien d’autres…' },
      ]),
    ).toBeNull()
  })

  it('laisse passer une opération sans texte suspect', () => {
    expect(truncationLeak(spec, [{ op: 'set', path: 'theme.mode', value: 'dark' }])).toBeNull()
  })
})
