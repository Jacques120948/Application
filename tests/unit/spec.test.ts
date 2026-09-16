import { describe, expect, it } from 'vitest'
import { buildTemplate, chooseTemplate, TEMPLATE_KINDS } from '@/server/spec/templates'
import { appSpecSchema, blockSchema, dataFieldSchema } from '@/server/spec/schema'
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

describe('liste de données', () => {
  /*
   * Le drapeau de correction est arrivé après la mise en ligne : les applications déjà
   * publiées portent une spécification figée qui ne le contient pas. Sans valeur par
   * défaut, leur relecture échouerait et elles cesseraient d'être servies.
   */
  it('reste relisible quand la spécification est antérieure à la correction de fiches', () => {
    const bloc = {
      id: 'liste',
      type: 'recordList' as const,
      modelId: 'fiches',
      titleField: 'titre',
      emptyText: 'Rien pour le moment.',
      allowDelete: true,
    }
    const relu = blockSchema.parse(bloc)
    expect(relu.type).toBe('recordList')
    if (relu.type !== 'recordList') return
    expect(relu.allowEdit).toBe(true)
    expect(relu.searchable).toBe(true)
    expect(relu.sort).toBe('recent')
  })

  it('refuse un filtre posé sur un champ où les valeurs ne se répètent pas', () => {
    const spec = buildTemplate('booking', options)
    const model = spec.dataModels[0]
    const texte = model?.fields.find((field) => field.type === 'text')
    if (model === undefined || texte === undefined) return

    const page = spec.pages.find((candidate) =>
      candidate.blocks.some((block) => block.type === 'recordList'),
    )
    if (page === undefined) return
    const fautif = {
      ...spec,
      pages: spec.pages.map((candidate) =>
        candidate.id !== page.id
          ? candidate
          : {
              ...candidate,
              blocks: candidate.blocks.map((block) =>
                block.type === 'recordList' ? { ...block, filterField: texte.id } : block,
              ),
            },
      ),
    }
    const soucis = checkIntegrity(fautif)
    expect(soucis.some((souci) => souci.path.endsWith('.filterField'))).toBe(true)

    // Un champ à choix, lui, passe.
    const choix = model.fields.find((field) => field.type === 'select')
    if (choix === undefined) return
    const bon = {
      ...fautif,
      pages: fautif.pages.map((candidate) => ({
        ...candidate,
        blocks: candidate.blocks.map((block) =>
          block.type === 'recordList' ? { ...block, filterField: choix.id } : block,
        ),
      })),
    }
    expect(checkIntegrity(bon).some((souci) => souci.path.endsWith('.filterField'))).toBe(false)
  })

  it('refuse un renvoi qui pointe vers des données inexistantes', () => {
    const spec = buildTemplate('booking', options)
    const model = spec.dataModels[0]
    if (model === undefined) return

    const avecRenvoi = (cible: string) => ({
      ...spec,
      dataModels: [
        {
          ...model,
          fields: [
            ...model.fields,
            {
              id: 'renvoi',
              label: 'Renvoi',
              type: 'reference' as const,
              required: false,
              referenceModelId: cible,
            },
          ],
        },
        ...spec.dataModels.slice(1),
      ],
    })

    expect(
      checkIntegrity(avecRenvoi('modele-absent')).some((souci) =>
        souci.path.endsWith('.referenceModelId'),
      ),
    ).toBe(true)
    // Un renvoi du modèle vers lui-même est légitime : une tâche peut avoir une tâche mère.
    expect(
      checkIntegrity(avecRenvoi(model.id)).some((souci) => souci.path.endsWith('.referenceModelId')),
    ).toBe(false)
  })

  it('refuse de totaliser un champ qui n’est pas un nombre', () => {
    const spec = buildTemplate('booking', options)
    const model = spec.dataModels[0]
    const texte = model?.fields.find((field) => field.type === 'text')
    if (model === undefined || texte === undefined) return

    const avecTotal = (champ: string) => ({
      ...spec,
      pages: spec.pages.map((page) => ({
        ...page,
        blocks: page.blocks.map((block) =>
          block.type === 'recordList' ? { ...block, sumField: champ } : block,
        ),
      })),
    })
    expect(checkIntegrity(avecTotal(texte.id)).some((souci) => souci.path.endsWith('.sumField'))).toBe(true)

    const nombre = model.fields.find((field) => field.type === 'number')
    if (nombre === undefined) return
    expect(checkIntegrity(avecTotal(nombre.id)).some((souci) => souci.path.endsWith('.sumField'))).toBe(false)
  })

  it('respecte le choix explicite du créateur', () => {
    const relu = blockSchema.parse({
      id: 'liste',
      type: 'recordList',
      modelId: 'fiches',
      titleField: 'titre',
      emptyText: 'Rien pour le moment.',
      allowDelete: false,
      allowEdit: false,
    })
    if (relu.type !== 'recordList') throw new Error('bloc inattendu')
    expect(relu.allowEdit).toBe(false)
  })
})

describe('assistant intégré à une application', () => {
  const block = {
    id: 'aide',
    type: 'assistant' as const,
    title: 'Une question ?',
    role: "Tu réponds uniquement aux questions sur la livraison et les délais.",
    placeholder: 'Posez votre question',
  }

  it('accepte une section assistant complète', () => {
    expect(() => blockSchema.parse(block)).not.toThrow()
  })

  it('exige un rôle assez précis pour cadrer les réponses', () => {
    expect(() => blockSchema.parse({ ...block, role: 'aide' })).toThrow()
  })

  it('borne la longueur du rôle', () => {
    expect(() => blockSchema.parse({ ...block, role: 'a'.repeat(2_001) })).toThrow()
  })

  it("n'accepte aucun champ inconnu", () => {
    expect(() => blockSchema.parse({ ...block, apiKey: 'secret' })).toThrow()
  })
})

describe('étapes et calculs', () => {
  const champ = (extra: Record<string, unknown>) =>
    dataFieldSchema.safeParse({ id: 'statut', label: 'Statut', required: false, ...extra })

  it('accepte des étapes sur un champ à choix', () => {
    expect(
      champ({ type: 'select', options: ['Brouillon', 'Envoyé'], workflow: true }).success,
    ).toBe(true)
  })

  it('refuse des étapes ailleurs que sur un champ à choix', () => {
    expect(champ({ type: 'text', workflow: true }).success).toBe(false)
  })

  it('refuse des étapes ouvertes : une suite fermée n’accepte pas l’imprévu', () => {
    expect(
      champ({ type: 'select', options: ['A', 'B'], workflow: true, allowOther: true }).success,
    ).toBe(false)
  })

  it('exige sa formule sur un champ calculé', () => {
    expect(champ({ type: 'computed' }).success).toBe(false)
    expect(champ({ type: 'computed', formula: 'prix * 2' }).success).toBe(true)
  })

  it('refuse un champ calculé obligatoire : il ne se saisit pas', () => {
    expect(
      dataFieldSchema.safeParse({
        id: 'total',
        label: 'Total',
        type: 'computed',
        required: true,
        formula: 'prix * 2',
      }).success,
    ).toBe(false)
  })
})
