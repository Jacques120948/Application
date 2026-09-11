import { describe, expect, it } from 'vitest'
import { applyPatch, parsePath } from '@/server/spec/patch'
import { buildTemplate } from '@/server/spec/templates'
import { AppError } from '@/lib/errors'

const spec = buildTemplate('content', {
  name: 'Journal',
  tagline: 'Une phrase de présentation suffisamment longue.',
  description: 'Une application de contenu pour les tests.',
  locale: 'fr',
})

describe('analyse des chemins', () => {
  it('accepte les chemins pointés avec indices', () => {
    expect(parsePath('pages[0].blocks[2].title')).toEqual([
      { kind: 'key', value: 'pages' },
      { kind: 'index', value: 0 },
      { kind: 'key', value: 'blocks' },
      { kind: 'index', value: 2 },
      { kind: 'key', value: 'title' },
    ])
  })

  it('refuse les segments qui permettraient une pollution de prototype', () => {
    for (const path of ['__proto__.pollue', 'theme.constructor.prototype', 'a.prototype.b']) {
      expect(() => parsePath(path)).toThrow(AppError)
    }
  })

  it('refuse les chemins malformés', () => {
    for (const path of ['pages[-1]', 'pages[0', '../etc', 'pages..title', '']) {
      expect(() => parsePath(path)).toThrow(AppError)
    }
  })
})

describe('application des patchs', () => {
  it('modifie une valeur simple', () => {
    const updated = applyPatch(spec, {
      summary: 'Couleur principale',
      operations: [{ op: 'set', path: 'theme.colors.primary', value: '#112233' }],
    })
    expect(updated.theme.colors.primary).toBe('#112233')
    // La spécification d'origine n'est jamais modifiée sur place.
    expect(spec.theme.colors.primary).not.toBe('#112233')
  })

  it('déplace une section dans une page', () => {
    const before = spec.pages[0]!.blocks.map((block) => block.id)
    const updated = applyPatch(spec, {
      summary: 'Section déplacée',
      operations: [{ op: 'move', path: 'pages[0].blocks', from: 0, to: 1 }],
    })
    const after = updated.pages[0]!.blocks.map((block) => block.id)
    expect(after[0]).toBe(before[1])
    expect(after[1]).toBe(before[0])
  })

  it('rejette en bloc un patch qui rendrait l’application invalide', () => {
    expect(() =>
      applyPatch(spec, {
        summary: 'Couleur cassée',
        operations: [{ op: 'set', path: 'theme.colors.primary', value: 'pas-une-couleur' }],
      }),
    ).toThrow(AppError)
  })

  it('rejette un patch qui casserait une référence interne', () => {
    expect(() =>
      applyPatch(spec, {
        summary: 'Page supprimée',
        operations: [{ op: 'delete', path: 'pages[1]' }],
      }),
    ).toThrow(AppError)
  })

  it('ne laisse aucune trace après un patch refusé', () => {
    const snapshot = JSON.stringify(spec)
    try {
      applyPatch(spec, {
        summary: 'Tentative',
        operations: [
          { op: 'set', path: 'name', value: 'Nouveau nom' },
          { op: 'set', path: 'theme.radius', value: 'inconnu' },
        ],
      })
    } catch {
      // attendu
    }
    expect(JSON.stringify(spec)).toBe(snapshot)
  })

  it('refuse une opération sur un élément inexistant', () => {
    expect(() =>
      applyPatch(spec, {
        summary: 'Hors bornes',
        operations: [{ op: 'set', path: 'pages[99].title', value: 'Titre' }],
      }),
    ).toThrow(AppError)
  })
})
