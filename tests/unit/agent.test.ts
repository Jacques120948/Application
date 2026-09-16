import { describe, expect, it } from 'vitest'
import { canContinue, DEFAULT_AGENT_LIMITS, newBudget } from '@/server/agent/limits'
import { AGENT_TOOLS, newWorkspace, outline, runTool } from '@/server/agent/tools'
import { buildTemplate } from '@/server/spec/templates'

/**
 * L'agent, sans réseau.
 *
 * Deux choses se vérifient ici, et ce sont les deux qui comptent : ses bornes l'arrêtent,
 * et ses outils ne peuvent pas abîmer l'application. Le reste — la qualité de ses
 * décisions — ne se teste pas ainsi ; il se mesure sur des demandes réelles.
 */

const spec = buildTemplate('content', {
  name: 'Carnet de recettes',
  tagline: 'Les recettes de la maison',
  description: 'Un carnet partagé où chacun dépose ses recettes et retrouve celles des autres.',
  locale: 'fr',
})

describe('bornes', () => {
  it('laisse démarrer une exécution neuve', () => {
    expect(canContinue(newBudget(), DEFAULT_AGENT_LIMITS).ok).toBe(true)
  })

  it('arrête au nombre d’étapes', () => {
    const budget = { ...newBudget(), steps: DEFAULT_AGENT_LIMITS.maxSteps }
    const verdict = canContinue(budget, DEFAULT_AGENT_LIMITS)
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toContain('étapes')
  })

  it('arrête au nombre de jetons', () => {
    const budget = { ...newBudget(), tokens: DEFAULT_AGENT_LIMITS.maxTokens }
    expect(canContinue(budget, DEFAULT_AGENT_LIMITS).ok).toBe(false)
  })

  it('arrête au plafond de crédits', () => {
    const budget = { ...newBudget(), credits: DEFAULT_AGENT_LIMITS.maxCredits }
    const verdict = canContinue(budget, DEFAULT_AGENT_LIMITS)
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toContain('crédits')
  })

  it('arrête à la durée', () => {
    const budget = { ...newBudget(), startedAt: Date.now() - DEFAULT_AGENT_LIMITS.maxDurationMs - 1 }
    expect(canContinue(budget, DEFAULT_AGENT_LIMITS).ok).toBe(false)
  })
})

describe('plan de l’application', () => {
  const texte = outline(spec)

  it('nomme chaque page avec son indice et son chemin', () => {
    for (const [index, page] of spec.pages.entries()) {
      expect(texte).toContain(`[${index}] « ${page.title} »`)
      expect(texte).toContain(`chemin « ${page.path} »`)
    }
  })

  it('donne l’indice de chaque section : les opérations s’en servent', () => {
    const premiere = spec.pages[0]!
    for (const [position, block] of premiere.blocks.entries()) {
      expect(texte).toContain(`[${position}] ${block.type}`)
    }
  })

  it('reste bien plus court que l’application entière', () => {
    expect(texte.length).toBeLessThan(JSON.stringify(spec).length)
  })
})

describe('outils', () => {
  it('ne déclare que des outils de lecture et une proposition', () => {
    // La liste est écrite en toutes lettres pour qu'un outil de plus oblige quelqu'un à
    // relire cette ligne : un agent est défini par ses outils bien plus que par ses
    // consignes.
    expect(AGENT_TOOLS.map((tool) => tool.name).sort()).toEqual([
      'lire_controles',
      'lire_images',
      'lire_incidents',
      'lire_modele_de_donnees',
      'lire_page',
      'proposer_modifications',
    ])
    // Et la propriété, qui survit à l'ajout suivant : une seule porte écrit, les autres
    // lisent.
    const ecrivains = AGENT_TOOLS.filter((tool) => !tool.name.startsWith('lire_'))
    expect(ecrivains.map((tool) => tool.name)).toEqual(['proposer_modifications'])
  })

  it('rend une page et retient qu’elle a été lue', () => {
    const workspace = newWorkspace(spec)
    const chemin = spec.pages[0]!.path
    const result = runTool('lire_page', { chemin }, workspace)
    expect(result.isError).toBe(false)
    expect(workspace.read).toEqual([chemin])
  })

  it('dit quelles pages existent quand le chemin est faux', () => {
    const workspace = newWorkspace(spec)
    const result = runTool('lire_page', { chemin: 'page-inexistante' }, workspace)
    expect(result.isError).toBe(true)
    expect(result.text).toContain(spec.pages[0]!.path)
  })

  it('applique une modification valide sur la copie de travail', () => {
    const workspace = newWorkspace(spec)
    const result = runTool(
      'proposer_modifications',
      {
        resume: 'Thème en sombre',
        operations: [
          { op: 'set', path: 'theme.mode', valueJson: '"dark"', index: 0, from: 0, to: 0 },
        ],
      },
      workspace,
    )
    expect(result.isError).toBe(false)
    expect(workspace.spec.theme.mode).toBe('dark')
    // L'application d'origine n'est pas touchée : la copie de travail est bien une copie.
    expect(spec.theme.mode).not.toBe('dark')
    expect(workspace.applied).toHaveLength(1)
  })

  it('refuse une modification qui rendrait l’application invalide, sans rien changer', () => {
    const workspace = newWorkspace(spec)
    const avant = JSON.stringify(workspace.spec)
    const result = runTool(
      'proposer_modifications',
      {
        resume: 'Casse tout',
        operations: [{ op: 'delete', path: 'pages', valueJson: 'null', index: 0, from: 0, to: 0 }],
      },
      workspace,
    )
    expect(result.isError).toBe(true)
    expect(result.text.startsWith('Refusé')).toBe(true)
    expect(JSON.stringify(workspace.spec)).toBe(avant)
  })

  it('refuse un chemin dangereux', () => {
    const workspace = newWorkspace(spec)
    const result = runTool(
      'proposer_modifications',
      {
        resume: 'Pollution',
        operations: [
          { op: 'set', path: '__proto__.pollue', valueJson: 'true', index: 0, from: 0, to: 0 },
        ],
      },
      workspace,
    )
    expect(result.isError).toBe(true)
    expect(({} as Record<string, unknown>).pollue).toBeUndefined()
  })

  it('refuse une valeur qui n’est pas du JSON', () => {
    const workspace = newWorkspace(spec)
    const result = runTool(
      'proposer_modifications',
      {
        resume: 'Valeur illisible',
        operations: [
          { op: 'set', path: 'theme.mode', valueJson: 'pas du json', index: 0, from: 0, to: 0 },
        ],
      },
      workspace,
    )
    expect(result.isError).toBe(true)
  })

  it('refuse un outil inconnu au lieu de le tenter', () => {
    expect(runTool('supprimer_la_base', {}, newWorkspace(spec)).isError).toBe(true)
  })

  it('rend les images avec leurs identifiants, seul moyen d’en poser une', () => {
    const workspace = newWorkspace(spec, [], [
      { id: '11111111-2222-3333-4444-555555555555', filename: 'chien.webp', width: 1600, height: 900 },
    ])
    const result = runTool('lire_images', {}, workspace)
    expect(result.isError).toBe(false)
    expect(result.text).toContain('11111111-2222-3333-4444-555555555555')
    expect(result.text).toContain('chien.webp')
    // L'identifiant seul ne suffit pas : encore faut-il savoir où l'écrire.
    expect(result.text).toContain('imageId')
  })

  it('dit où en déposer quand la bibliothèque est vide', () => {
    const result = runTool('lire_images', {}, newWorkspace(spec))
    expect(result.isError).toBe(false)
    expect(result.text).toMatch(/vide/i)
    expect(result.text).toMatch(/Images/)
  })

  it('rend le rapport des contrôles', () => {
    const result = runTool('lire_controles', {}, newWorkspace(spec))
    expect(result.isError).toBe(false)
    expect(result.text.length).toBeGreaterThan(0)
  })
})
