import { describe, expect, it } from 'vitest'
import { buildTemplate, chooseTemplate, TEMPLATE_KINDS } from '@/server/spec/templates'
import { appSpecSchema } from '@/server/spec/schema'
import { checkIntegrity, parseAppSpec } from '@/server/spec/validate'
import { AppError } from '@/lib/errors'

const options = {
  name: 'Mon application',
  tagline: 'Une phrase de présentation suffisamment longue.',
  description: "Description complète de l'application de test.",
  locale: 'fr' as const,
}

describe('modèles de départ', () => {
  it('produit une AppSpec valide et cohérente pour chaque modèle', () => {
    for (const kind of TEMPLATE_KINDS) {
      const spec = buildTemplate(kind, options)
      expect(appSpecSchema.safeParse(spec).success).toBe(true)
      expect(checkIntegrity(spec)).toEqual([])
    }
  })

  it('choisit un modèle cohérent avec les mots de l’idée', () => {
    expect(chooseTemplate('Je veux une application de réservation de créneaux')).toBe('booking')
    expect(chooseTemplate('Une application de coaching sportif avec suivi')).toBe('coaching')
    expect(chooseTemplate('Un annuaire des artisans près de chez moi')).toBe('directory')
  })
})

describe('validation du schéma', () => {
  it('refuse une propriété inconnue', () => {
    const spec = buildTemplate('content', options) as Record<string, unknown>
    expect(() => parseAppSpec({ ...spec, scriptInjecte: '<script>' })).toThrow(AppError)
  })

  it('refuse un lien qui n’est pas https ou mailto', () => {
    const spec = buildTemplate('content', options)
    const page = spec.pages[0]!
    const withBadLink = structuredClone(spec)
    withBadLink.pages[0]!.blocks.push({
      id: 'lien-dangereux',
      type: 'cta',
      title: 'Cliquez',
      label: 'Ici',
      href: 'javascript:alert(1)',
    })
    expect(page.id).toBeTruthy()
    expect(() => parseAppSpec(withBadLink)).toThrow(AppError)
  })

  it('refuse une couleur qui n’est pas au format hexadécimal', () => {
    const spec = structuredClone(buildTemplate('content', options)) as unknown as {
      theme: { colors: { primary: string } }
    }
    spec.theme.colors.primary = 'red'
    expect(() => parseAppSpec(spec)).toThrow(AppError)
  })

  it('détecte un menu qui pointe vers une page inexistante', () => {
    const spec = structuredClone(buildTemplate('content', options))
    spec.navigation.items[0]!.pageId = 'page-fantome'
    const issues = checkIntegrity(spec)
    expect(issues.some((issue) => issue.path.startsWith('navigation.items'))).toBe(true)
  })

  it('détecte une liste qui affiche un champ inexistant', () => {
    const spec = structuredClone(buildTemplate('content', options))
    for (const page of spec.pages) {
      for (const block of page.blocks) {
        if (block.type === 'recordList') block.titleField = 'champ-absent'
      }
    }
    expect(checkIntegrity(spec).length).toBeGreaterThan(0)
  })

  it("exige une page d'accueil", () => {
    const spec = structuredClone(buildTemplate('content', options))
    spec.pages[0]!.path = 'ailleurs'
    expect(checkIntegrity(spec).some((issue) => issue.path === 'pages')).toBe(true)
  })
})
