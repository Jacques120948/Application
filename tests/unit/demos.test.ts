import { describe, expect, it } from 'vitest'
import { DEMO_APPS } from '@/server/demos/catalog'
import { parseAppSpec } from '@/server/spec/validate'
import { runChecks } from '@/server/spec/checks'

/**
 * Les démonstrations de la page d'accueil ne sont pas des maquettes : ce sont de vraies
 * AppSpec, servies par le moteur de la plateforme. Elles doivent donc passer exactement
 * les mêmes contrôles qu'une application de créateur, sans quoi la page d'accueil
 * montrerait quelque chose que le produit ne sait pas produire.
 */
describe('applications de démonstration', () => {
  it('en propose assez pour montrer la diversité', () => {
    expect(DEMO_APPS.length).toBeGreaterThanOrEqual(6)
  })

  it('utilise des adresses uniques', () => {
    const slugs = DEMO_APPS.map((demo) => demo.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  for (const demo of DEMO_APPS) {
    describe(demo.slug, () => {
      it('est une AppSpec valide', () => {
        expect(() => parseAppSpec(demo.spec)).not.toThrow()
      })

      it('passe les contrôles de cohérence de la plateforme', () => {
        const report = runChecks(parseAppSpec(demo.spec))
        const errors = report.results.filter((check) => check.status === 'error')
        expect(errors.map((check) => check.label)).toEqual([])
      })

      it("n'ouvre pas l'inscription : une démonstration publique n'est pas une boîte à spam", () => {
        expect(demo.spec.auth.allowSignup).toBe(false)
      })

      it('a bien une page d’accueil', () => {
        expect(demo.spec.pages.some((page) => page.path === 'accueil')).toBe(true)
      })
    })
  }

  it('montre des styles différents les uns des autres', () => {
    const themes = DEMO_APPS.map(
      (demo) => `${demo.spec.theme.mode}-${demo.spec.theme.font}-${demo.spec.theme.radius}`,
    )
    // Au moins quatre combinaisons distinctes : sinon toutes les captures se ressemblent.
    expect(new Set(themes).size).toBeGreaterThanOrEqual(4)
    expect(DEMO_APPS.some((demo) => demo.spec.theme.mode === 'dark')).toBe(true)
  })
})
