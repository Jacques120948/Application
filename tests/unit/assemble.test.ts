import { describe, expect, it } from 'vitest'
import { assembleSpec, slugifyId, type AssembleInput } from '@/server/spec/assemble'
import { DEFAULT_THEME } from '@/server/spec/templates'
import type { Block } from '@/server/spec/schema'
import { AppError } from '@/lib/errors'

/**
 * L'assemblage est la couture entre plusieurs appels au modèle. Chaque appel est valide
 * isolément ; ces tests vérifient que les incohérences *entre* appels sont réparées de
 * façon déterministe plutôt que de faire échouer la génération.
 */

function baseInput(overrides: Partial<AssembleInput> = {}): AssembleInput {
  return {
    name: 'Balade Canine',
    tagline: 'Trouvez les meilleures promenades pour votre chien.',
    description: 'Annuaire collaboratif de promenades adaptées aux chiens.',
    locale: 'fr',
    theme: DEFAULT_THEME,
    auth: { enabled: false, allowSignup: false },
    dataModels: [
      {
        id: 'promenade',
        label: 'Promenade',
        labelPlural: 'Promenades',
        scope: 'shared',
        fields: [
          { id: 'nom', label: 'Nom', type: 'text', required: true },
          { id: 'ville', label: 'Ville', type: 'text', required: true },
        ],
      },
    ],
    navigation: { style: 'topbar', items: [{ pageId: 'accueil', label: 'Accueil' }] },
    monetization: { model: 'free', currency: 'EUR', plans: [] },
    pages: [{ id: 'accueil', title: 'Accueil', path: 'accueil', requiresAuth: false }],
    blocksByPage: new Map<string, Block[]>([
      [
        'accueil',
        [{ id: 'accueil-hero', type: 'hero', title: 'Bienvenue', subtitle: 'Des balades pour votre chien.' }],
      ],
    ]),
    ...overrides,
  }
}

describe('assemblage du plan et des pages', () => {
  it('produit une AppSpec valide à partir de parties valides', () => {
    const spec = assembleSpec(baseInput())
    expect(spec.pages).toHaveLength(1)
    expect(spec.pages[0]?.path).toBe('accueil')
  })

  it('normalise les identifiants et les chemins', () => {
    expect(slugifyId('Mes Favoris !', 'page')).toBe('mes-favoris')
    expect(slugifyId('Évaluations', 'page')).toBe('evaluations')
    expect(slugifyId('123', 'page-1')).toBe('page-1')
  })

  it("impose une page d'accueil quand aucune n'en porte le chemin", () => {
    const spec = assembleSpec(
      baseInput({
        pages: [{ id: 'depart', title: 'Départ', path: 'depart', requiresAuth: false }],
        navigation: { style: 'topbar', items: [{ pageId: 'depart', label: 'Départ' }] },
        blocksByPage: new Map<string, Block[]>([
          ['depart', [{ id: 'b1', type: 'richText', body: 'Bonjour.' }]],
        ]),
      }),
    )
    expect(spec.pages[0]?.path).toBe('accueil')
  })

  it('écarte une liste qui vise un modèle de données inexistant', () => {
    const spec = assembleSpec(
      baseInput({
        blocksByPage: new Map<string, Block[]>([
          [
            'accueil',
            [
              { id: 'b1', type: 'richText', body: 'Bonjour.' },
              {
                id: 'b2',
                type: 'recordList',
                modelId: 'modele-fantome',
                titleField: 'nom',
                emptyText: 'Rien.',
                allowDelete: false,
                allowEdit: true,
                searchable: true,
                sort: 'recent' as const,
              },
            ],
          ],
        ]),
      }),
    )
    expect(spec.pages[0]?.blocks.map((block) => block.type)).toEqual(['richText'])
  })

  it('corrige une liste qui affiche un champ inexistant', () => {
    const spec = assembleSpec(
      baseInput({
        blocksByPage: new Map<string, Block[]>([
          [
            'accueil',
            [
              {
                id: 'b1',
                type: 'recordList',
                modelId: 'promenade',
                titleField: 'champ-absent',
                subtitleField: 'autre-absent',
                emptyText: 'Rien.',
                allowDelete: false,
                allowEdit: true,
                searchable: true,
                sort: 'recent' as const,
              },
            ],
          ],
        ]),
      }),
    )
    const block = spec.pages[0]?.blocks[0]
    expect(block?.type).toBe('recordList')
    if (block?.type === 'recordList') {
      expect(block.titleField).toBe('nom')
      expect(block.subtitleField).toBeUndefined()
    }
  })

  it('retire un bouton qui renvoie vers une page inexistante', () => {
    const spec = assembleSpec(
      baseInput({
        blocksByPage: new Map<string, Block[]>([
          [
            'accueil',
            [
              {
                id: 'b1',
                type: 'hero',
                title: 'Bienvenue',
                subtitle: 'Des balades.',
                ctaLabel: 'Voir',
                ctaPageId: 'page-fantome',
              },
            ],
          ],
        ]),
      }),
    )
    const block = spec.pages[0]?.blocks[0]
    if (block?.type === 'hero') {
      expect(block.ctaPageId).toBeUndefined()
      expect(block.ctaLabel).toBeUndefined()
    }
  })

  it('reconstruit le menu quand il ne pointe que vers des pages absentes', () => {
    const spec = assembleSpec(
      baseInput({ navigation: { style: 'topbar', items: [{ pageId: 'inconnu', label: 'Inconnu' }] } }),
    )
    expect(spec.navigation.items).toEqual([{ pageId: 'accueil', label: 'Accueil' }])
  })

  it('rend les identifiants de section uniques', () => {
    const spec = assembleSpec(
      baseInput({
        blocksByPage: new Map<string, Block[]>([
          [
            'accueil',
            [
              { id: 'bloc', type: 'richText', body: 'Premier.' },
              { id: 'bloc', type: 'richText', body: 'Second.' },
            ],
          ],
        ]),
      }),
    )
    const ids = spec.pages[0]?.blocks.map((block) => block.id) ?? []
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('active les comptes dès qu’une page est réservée', () => {
    const spec = assembleSpec(
      baseInput({
        pages: [
          { id: 'accueil', title: 'Accueil', path: 'accueil', requiresAuth: false },
          { id: 'prive', title: 'Privé', path: 'prive', requiresAuth: true },
        ],
        blocksByPage: new Map<string, Block[]>([
          ['accueil', [{ id: 'b1', type: 'richText', body: 'Bonjour.' }]],
          ['prive', [{ id: 'b2', type: 'auth', title: 'Connexion' }]],
        ]),
      }),
    )
    expect(spec.auth.enabled).toBe(true)
  })

  it('ramène à gratuit un modèle payant sans aucune formule', () => {
    const spec = assembleSpec(
      baseInput({ monetization: { model: 'subscription', currency: 'EUR', plans: [] } }),
    )
    expect(spec.monetization.model).toBe('free')
  })

  it('donne un contenu minimal à une page dont la génération a échoué', () => {
    const spec = assembleSpec(
      baseInput({
        pages: [
          { id: 'accueil', title: 'Accueil', path: 'accueil', requiresAuth: false },
          { id: 'vide', title: 'À propos', path: 'a-propos', requiresAuth: false },
        ],
        blocksByPage: new Map<string, Block[]>([
          ['accueil', [{ id: 'b1', type: 'richText', body: 'Bonjour.' }]],
        ]),
      }),
    )
    expect(spec.pages[1]?.blocks).toHaveLength(1)
    expect(spec.pages[1]?.blocks[0]?.type).toBe('richText')
  })

  it('refuse un assemblage irrécupérable plutôt que de produire une application cassée', () => {
    expect(() => assembleSpec(baseInput({ pages: [] }))).toThrow(AppError)
  })
})
