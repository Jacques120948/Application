import { describe, expect, it } from 'vitest'
import { contrastRatio, runChecks } from '@/server/spec/checks'
import { buildTemplate } from '@/server/spec/templates'

const spec = buildTemplate('subscription', {
  name: 'Carnet',
  tagline: 'Une phrase de présentation suffisamment longue.',
  description: 'Une application avec abonnement pour les tests.',
  locale: 'fr',
})

describe('contrôles de publication', () => {
  it('donne un score élevé à un modèle de départ', () => {
    const report = runChecks(spec)
    expect(report.counts.error).toBe(0)
    expect(report.score).toBeGreaterThanOrEqual(80)
  })

  it('signale un contraste insuffisant', () => {
    const dim = structuredClone(spec)
    dim.theme.colors.text = '#EEEEEE'
    dim.theme.colors.background = '#FFFFFF'
    const report = runChecks(dim)
    const contrast = report.results.find((result) => result.id === 'contrast')
    expect(contrast?.status).toBe('error')
  })

  it('calcule le rapport de contraste selon la formule WCAG', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
  })

  it('signale un formulaire dont les données ne sont affichées nulle part', () => {
    const writeOnly = structuredClone(spec)
    for (const page of writeOnly.pages) {
      page.blocks = page.blocks.filter((block) => block.type !== 'recordList')
    }
    const report = runChecks(writeOnly)
    expect(report.results.find((result) => result.id === 'data-visible')?.status).toBe('warn')
  })

  it('réclame une politique de confidentialité quand des données sont collectées', () => {
    const report = runChecks(spec)
    expect(report.results.find((result) => result.id === 'privacy')?.status).toBe('warn')
  })
})
