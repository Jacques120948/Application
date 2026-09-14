import { describe, expect, it } from 'vitest'
import { blockSchema, BLOCK_TYPES, type Block } from '@/server/spec/schema'
import { checkIntegrity, parseAppSpec } from '@/server/spec/validate'
import { assembleSpec } from '@/server/spec/assemble'
import { imageSlots, runChecks } from '@/server/spec/checks'
import { buildTemplate, DEFAULT_THEME } from '@/server/spec/templates'
import { renderPage, renderStylesheet } from '@/server/export/site'
import { pageContentSchemaFor } from '@/server/ai/schemas'
import { ICON_NAMES, iconSvg } from '@/lib/icons'
import { FONT_PAIRINGS, fontFiles } from '@/lib/fonts'
import { STYLE_PRESETS } from '@/lib/style-presets'

/**
 * Les sections riches : ce qu'elles acceptent, ce qu'elles refusent, et ce qui en sort
 * à l'export. Un jeu d'icônes fermé, des vidéos d'hôtes connus seulement, des images
 * jamais inventées par le modèle.
 */

const base = buildTemplate('content', {
  name: 'Atelier',
  tagline: 'Une phrase de présentation suffisamment longue.',
  description: 'Une application de test pour les sections.',
  locale: 'fr',
})

function withBlocks(blocks: Block[]) {
  const spec = structuredClone(base)
  spec.pages[0]!.blocks.push(...blocks)
  return spec
}

const RICH: Block[] = [
  { id: 'it', type: 'imageText', title: 'Notre atelier', body: 'Ligne un.\nLigne deux.', imagePosition: 'right' },
  { id: 'ga', type: 'gallery', title: 'En images', items: [{ caption: 'Un' }, { caption: 'Deux' }, {}] },
  { id: 'te', type: 'testimonials', items: [{ quote: 'Formidable.', author: 'Anne', role: 'Cliente' }] },
  { id: 'st', type: 'steps', title: 'Comment ça marche', items: [{ title: 'Un', body: 'Premier.', icon: 'calendar' }, { title: 'Deux', body: 'Second.' }] },
  { id: 'tm', type: 'team', members: [{ name: 'Jean Dupont', role: 'Fondateur' }] },
  { id: 'lo', type: 'logos', title: 'Ils nous font confiance', items: [{ name: 'Alpha' }, { name: 'Bêta' }] },
  { id: 'co', type: 'contact', title: 'Nous trouver', email: 'contact@exemple.ch', phone: '+41 21 000 00 00', address: 'Rue du Lac 1, Lausanne' },
  { id: 'vi', type: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', caption: 'Présentation' },
  { id: 'cp', type: 'comparison', columns: ['Nous', 'Autres'], rows: [{ label: 'Rapide', values: ['✓', '—'] }] },
  { id: 'ba', type: 'banner', text: 'Ouvert tout l’été', label: 'Voir', href: 'https://exemple.ch' },
]

describe('sections riches', () => {
  it('accepte toutes les nouvelles sections dans une application valide', () => {
    const spec = withBlocks(RICH)
    expect(() => parseAppSpec(spec)).not.toThrow()
    expect(checkIntegrity(spec)).toEqual([])
  })

  it('n’accepte une vidéo que depuis YouTube ou Vimeo, en https', () => {
    const video = (url: string) => blockSchema.safeParse({ id: 'v', type: 'video', url }).success
    expect(video('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
    expect(video('https://vimeo.com/123456789')).toBe(true)
    expect(video('http://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false)
    expect(video('https://exemple.ch/video.mp4')).toBe(false)
    expect(video('javascript:alert(1)')).toBe(false)
  })

  it('refuse une icône hors du jeu fermé', () => {
    const parsed = blockSchema.safeParse({
      id: 'f',
      type: 'features',
      items: [{ title: 'A', body: 'B', icon: '<script>' }],
    })
    expect(parsed.success).toBe(false)
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(30)
    for (const name of ICON_NAMES) expect(iconSvg(name)).toContain('<svg')
  })

  it('exige une valeur par colonne dans un tableau comparatif', () => {
    const spec = withBlocks([
      { id: 'cp', type: 'comparison', columns: ['A', 'B', 'C'], rows: [{ label: 'x', values: ['✓', '—'] }] },
    ])
    expect(checkIntegrity(spec).map((issue) => issue.path)).toContain('pages[0].blocks[2].rows[0].values')
  })

  it('exige au moins un moyen de contact', () => {
    const spec = withBlocks([{ id: 'co', type: 'contact', title: 'Contact' }])
    expect(checkIntegrity(spec)).toHaveLength(1)
  })

  it('signale un bouton d’image et texte qui ne mène nulle part', () => {
    const spec = withBlocks([
      { id: 'it', type: 'imageText', title: 'T', body: 'B', imagePosition: 'left', ctaLabel: 'Voir' },
    ])
    expect(checkIntegrity(spec)).toHaveLength(1)
  })
})

describe('assemblage des sections riches', () => {
  const input = {
    name: 'Atelier',
    tagline: 'Une phrase de présentation suffisamment longue.',
    description: 'Description.',
    locale: 'fr' as const,
    theme: DEFAULT_THEME,
    auth: { enabled: false, allowSignup: false },
    dataModels: [],
    navigation: { style: 'topbar' as const, items: [{ pageId: 'accueil', label: 'Accueil' }] },
    monetization: { model: 'free' as const, currency: 'EUR' as const, plans: [] },
    pages: [{ id: 'accueil', title: 'Accueil', path: 'accueil', requiresAuth: false }],
  }

  it('retire les images que le modèle aurait inventées', () => {
    const invented = '11111111-1111-4111-8111-111111111111'
    const spec = assembleSpec({
      ...input,
      blocksByPage: new Map([
        [
          'accueil',
          [
            { id: 'hero', type: 'hero', title: 'T', subtitle: 'S', imageId: invented, layout: 'split' },
            { id: 'ga', type: 'gallery', items: [{ imageId: invented }, { caption: 'x' }] },
            { id: 'tm', type: 'team', members: [{ name: 'A', role: 'B', imageId: invented }] },
          ] as Block[],
        ],
      ]),
    })
    const json = JSON.stringify(spec)
    expect(json).not.toContain(invented)
    expect(spec.pages[0]!.blocks[0]).toMatchObject({ type: 'hero', layout: 'split' })
  })

  it('garde une image que le projet possède réellement', () => {
    const known = '22222222-2222-4222-8222-222222222222'
    const spec = assembleSpec({
      ...input,
      knownImageIds: new Set([known]),
      blocksByPage: new Map([
        ['accueil', [{ id: 'it', type: 'imageText', title: 'T', body: 'B', imagePosition: 'left', imageId: known }] as Block[]],
      ]),
    })
    expect(JSON.stringify(spec)).toContain(known)
  })

  it('complète ou coupe les lignes d’un tableau comparatif', () => {
    const spec = assembleSpec({
      ...input,
      blocksByPage: new Map([
        [
          'accueil',
          [
            {
              id: 'cp',
              type: 'comparison',
              columns: ['A', 'B'],
              rows: [
                { label: 'court', values: ['✓'] },
                { label: 'long', values: ['✓', '—', 'trop'] },
              ],
            },
          ] as Block[],
        ],
      ]),
    })
    const block = spec.pages[0]!.blocks[0]!
    expect(block.type).toBe('comparison')
    if (block.type === 'comparison') {
      expect(block.rows[0]!.values).toEqual(['✓', '—'])
      expect(block.rows[1]!.values).toEqual(['✓', '—'])
    }
  })

  it('écarte une section contact sans aucune coordonnée', () => {
    const spec = assembleSpec({
      ...input,
      blocksByPage: new Map([
        ['accueil', [{ id: 'h', type: 'hero', title: 'T', subtitle: 'S' }, { id: 'co', type: 'contact', title: 'X' }] as Block[]],
      ]),
    })
    expect(spec.pages[0]!.blocks.map((block) => block.type)).toEqual(['hero'])
  })
})

describe('contrôles et export des sections riches', () => {
  it('compte les emplacements d’image et avertit quand une galerie est vide', () => {
    const spec = withBlocks(RICH)
    expect(imageSlots(spec.pages[0]!.blocks.find((block) => block.type === 'gallery')!)).toEqual({ total: 3, filled: 0 })
    const report = runChecks(spec)
    expect(report.results.find((result) => result.id === 'images')?.status).toBe('warn')
    expect(runChecks(base).results.find((result) => result.id === 'images')?.status).toBe('ok')
  })

  it('exporte chaque section en HTML sans script, avec les icônes inline', () => {
    const spec = withBlocks(RICH)
    const html = renderPage(spec, spec.pages[0]!, new Map())
    expect(html).toContain('class="bloc image-texte image-droite"')
    expect(html).toContain('class="galerie"')
    expect(html).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(html).toContain('<svg')
    expect(html).toContain('mailto:contact@exemple.ch')
    expect(html).toContain('class="bandeau"')
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain('image-vide')
  })

  it('reprend la paire de polices dans la feuille de style exportée', () => {
    const spec = structuredClone(base)
    spec.theme.font = 'elegant'
    const css = renderStylesheet(spec)
    expect(css).toContain("'Playfair Display Variable'")
    expect(css).toContain('fonts/playfair-display-latin-wght-normal.woff2')
    expect(fontFiles('elegant').map((font) => font.pkg)).toEqual(['playfair-display', 'dm-sans'])
    expect(fontFiles('system')).toEqual([])
  })
})

describe('styles et polices', () => {
  it('propose des styles qui sont tous des thèmes valides et distincts', () => {
    const seen = new Set<string>()
    for (const preset of STYLE_PRESETS) {
      const spec = structuredClone(base)
      spec.theme = preset.theme
      expect(() => parseAppSpec(spec)).not.toThrow()
      expect(runChecks(spec).results.find((result) => result.id === 'contrast')?.status).toBe('ok')
      seen.add(`${preset.theme.font}-${preset.theme.mode}-${preset.theme.pattern}-${preset.theme.radius}`)
    }
    expect(seen.size).toBe(STYLE_PRESETS.length)
    expect(STYLE_PRESETS.some((preset) => preset.theme.mode === 'dark')).toBe(true)
  })

  it('a une paire de polices pour chaque identifiant accepté par le schéma', () => {
    const ids = FONT_PAIRINGS.map((pairing) => pairing.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(8)
  })

  it('restreint le contrat d’une page aux sections que le plan a prévues', () => {
    const schema = pageContentSchemaFor(['hero', 'steps'])
    expect(schema.safeParse({ blocks: [{ id: 'h', type: 'hero', title: 'T', subtitle: 'S' }] }).success).toBe(true)
    expect(schema.safeParse({ blocks: [{ id: 'f', type: 'faq', items: [{ question: 'Q', answer: 'R' }] }] }).success).toBe(false)
    expect(pageContentSchemaFor(BLOCK_TYPES)).toBeDefined()
  })
})
