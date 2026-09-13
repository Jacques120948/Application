import { describe, expect, it } from 'vitest'
import {
  missingPrecisions,
  radarProfileInput,
  toRadarProfile,
  type ProfileRow,
} from '@/server/radar/profile'

/**
 * Le profil du Radar : rien n'est redemandé, tout le reste est facultatif.
 *
 * Deux règles à tenir. Un choix explicite n'est pas un manque : « je ne sais pas » compte
 * comme une réponse. Et rien de sensible n'entre : les sept précisions sont des réglages
 * de filtre, pas un portrait.
 */

const BASE: ProfileRow = {
  monthlyGoalCents: 50_000,
  weeklyHours: 8,
  budgetCents: 30_000,
  currency: 'CHF',
  country: 'Suisse',
  skills: 'menuiserie',
  interests: 'bois',
  sector: 'artisanat',
  audience: 'professionnels',
  ambition: 'simple',
  preferredModel: 'subscription',
  experienceYears: null,
  knownSectors: '',
  technicalLevel: 'debutant',
  entrepreneurExperience: 'aucune',
  marketScope: 'francophone',
  productPreference: 'indifferent',
  willingToProspect: null,
}

describe('profil Radar', () => {
  it('transmet au modèle le profil de base et les précisions, rien de plus', () => {
    const vu = toRadarProfile(BASE)
    expect(vu.monthlyGoalCents).toBe(50_000)
    expect(vu.currency).toBe('CHF')
    expect(vu.technicalLevel).toBe('debutant')
    expect(vu.willingToProspect).toBeNull()
    // Aucune clé inattendue : ce qui part vers le modèle est une liste fermée.
    expect(Object.keys(vu).sort()).toEqual(
      [
        'ambition', 'audience', 'budgetCents', 'country', 'currency', 'entrepreneurExperience',
        'experienceYears', 'interests', 'knownSectors', 'marketScope', 'monthlyGoalCents',
        'preferredModel', 'productPreference', 'sector', 'skills', 'technicalLevel',
        'weeklyHours', 'willingToProspect',
      ].sort(),
    )
  })

  it('ne compte comme manquant que ce qui n’a jamais été renseigné', () => {
    expect(missingPrecisions(BASE).sort()).toEqual(
      ['experienceYears', 'knownSectors', 'willingToProspect'].sort(),
    )
    // Un « non » explicite n'est pas un manque.
    expect(missingPrecisions({ ...BASE, willingToProspect: false })).not.toContain('willingToProspect')
    expect(missingPrecisions({ ...BASE, experienceYears: 0 })).not.toContain('experienceYears')
  })

  it('accepte une mise à jour partielle et refuse une valeur hors liste', () => {
    expect(radarProfileInput.safeParse({}).success).toBe(true)
    expect(radarProfileInput.safeParse({ technicalLevel: 'avance' }).success).toBe(true)
    expect(radarProfileInput.safeParse({ technicalLevel: 'expert' }).success).toBe(false)
    expect(radarProfileInput.safeParse({ marketScope: 'lunaire' }).success).toBe(false)
  })

  it('borne les années d’expérience à quelque chose d’humain', () => {
    expect(radarProfileInput.safeParse({ experienceYears: 12 }).success).toBe(true)
    expect(radarProfileInput.safeParse({ experienceYears: -1 }).success).toBe(false)
    expect(radarProfileInput.safeParse({ experienceYears: 120 }).success).toBe(false)
    expect(radarProfileInput.safeParse({ experienceYears: null }).success).toBe(true)
  })
})
