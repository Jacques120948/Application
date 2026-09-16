import { describe, expect, it } from 'vitest'
import { planTargets, planVerdict } from '@/server/agent/plan'
import { buildTemplate } from '@/server/spec/templates'
import type { PatchOperation } from '@/server/spec/patch'

/**
 * Quand l'agent demande confirmation.
 *
 * Deux erreurs symétriques sont à éviter, et ce sont elles qui sont vérifiées ici.
 * Appliquer en silence une modification qui engage — c'est le défaut constaté en usage
 * réel, un champ rendu obligatoire sans le dire. Et demander confirmation pour un
 * changement de couleur, ce qui apprendrait au créateur à cliquer sans lire.
 */

const spec = buildTemplate('content', {
  name: 'Annuaire des artisans',
  tagline: 'Trouvez un artisan près de chez vous',
  description: 'Un annuaire où chaque artisan publie sa fiche et où les habitants cherchent.',
  locale: 'fr',
})

const set = (path: string, value: unknown): PatchOperation => ({ op: 'set', path, value })

describe('ce qui passe sans demander', () => {
  it('un changement de couleur', () => {
    expect(planVerdict([set('theme.colors.primary', '#2563EB')]).required).toBe(false)
  })

  it('quelques retouches sur une seule page', () => {
    const operations = [
      set('pages[0].blocks[0].title', 'Trouvez un artisan'),
      set('pages[0].blocks[0].subtitle', 'Près de chez vous'),
      set('pages[0].blocks[1].title', 'Comment ça marche'),
    ]
    expect(planVerdict(operations).required).toBe(false)
  })
})

describe('ce qui demande confirmation', () => {
  it('toucher aux données, même d’une seule opération', () => {
    const verdict = planVerdict([set('dataModels[0].fields[2].required', true)])
    expect(verdict.required).toBe(true)
    expect(verdict.reasons.join(' ')).toContain('fiches déjà saisies')
    expect(verdict.scale.models).toBe(1)
  })

  it('supprimer quelque chose', () => {
    const verdict = planVerdict([{ op: 'delete', path: 'pages[1].blocks[0]' }])
    expect(verdict.required).toBe(true)
    expect(verdict.reasons.join(' ')).toContain('supprime')
    expect(verdict.scale.deletions).toBe(1)
  })

  it('changer les comptes visiteurs', () => {
    expect(planVerdict([set('auth.allowSignup', false)]).required).toBe(true)
  })

  it('changer ce qui est vendu', () => {
    expect(planVerdict([set('monetization.model', 'subscription')]).required).toBe(true)
  })

  it('toucher trois pages à la fois', () => {
    const operations = [
      set('pages[0].blocks[0].title', 'A'),
      set('pages[1].blocks[0].title', 'B'),
      set('pages[2].blocks[0].title', 'C'),
    ]
    const verdict = planVerdict(operations)
    expect(verdict.required).toBe(true)
    expect(verdict.scale.pages).toBe(3)
  })

  it('compter beaucoup d’opérations', () => {
    const operations = Array.from({ length: 8 }, (_, index) =>
      set(`pages[0].blocks[${index}].title`, `Titre ${index}`),
    )
    const verdict = planVerdict(operations)
    expect(verdict.required).toBe(true)
    expect(verdict.reasons.join(' ')).toContain('8 modifications')
  })
})

describe('ce que le plan annonce', () => {
  it('nomme les pages et les données comme le créateur les connaît', () => {
    const cibles = planTargets(spec, [
      set('pages[0].blocks[0].title', 'A'),
      set('dataModels[0].fields[0].required', true),
      set('theme.mode', 'dark'),
    ])
    expect(cibles.some((cible) => cible.includes(spec.pages[0]!.title))).toBe(true)
    expect(cibles.some((cible) => cible.includes(spec.dataModels[0]!.labelPlural))).toBe(true)
    expect(cibles).toContain("l'apparence")
  })

  it('ne répète pas deux fois la même page', () => {
    const cibles = planTargets(spec, [
      set('pages[0].blocks[0].title', 'A'),
      set('pages[0].blocks[1].title', 'B'),
    ])
    expect(cibles).toHaveLength(1)
  })

  it('ne nomme rien d’inconnu quand l’indice n’existe pas', () => {
    expect(planTargets(spec, [set('pages[99].blocks[0].title', 'A')])).toHaveLength(0)
  })
})
