import { describe, expect, it } from 'vitest'
import {
  fingerprint,
  fingerprintTokens,
  inverseLevelToTen,
  levelToTen,
  looksAlike,
  opportunityScore,
  profileFit,
  subScores,
  WEIGHTS,
} from '@/server/radar/score'

/**
 * Le score d'opportunité, vérifié plutôt que promis.
 *
 * La règle qui compte : c'est la plateforme qui note, pas le modèle. La formule doit donc
 * être stable, bornée, et sensible aux faits du profil dans le sens attendu — une personne
 * qui veut vendre aux entreprises doit voir monter une idée pour artisans, pas descendre.
 */

const PROFIL = {
  weeklyHours: 10,
  budgetCents: 50_000,
  audience: 'les-deux',
  preferredModel: 'indifferent',
  sector: '',
  knownSectors: '',
  technicalLevel: 'intermediaire',
  productPreference: 'indifferent',
}

const IDEE = {
  audience: 'Particuliers qui cuisinent chez eux',
  timeToMarketWeeks: 6,
  runningCostCents: 1_500,
  businessModel: 'subscription',
  complexityLevel: 'moyen' as const,
  title: 'Carnet de recettes partagé',
  problem: 'Retrouver ses recettes et celles de ses proches',
}

describe('pondération', () => {
  it('somme à cent, sans quoi le score ne serait pas sur cent', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('traduit les niveaux de façon monotone, et les inverse pour ce qui pèse contre', () => {
    expect(levelToTen('faible')).toBeLessThan(levelToTen('moyen'))
    expect(levelToTen('moyen')).toBeLessThan(levelToTen('fort'))
    expect(inverseLevelToTen('fort')).toBeLessThan(inverseLevelToTen('faible'))
  })

  it('reste entre zéro et cent quoi qu’on lui donne', () => {
    const plancher = subScores({
      profileFit: 0,
      demandLevel: 'faible',
      monetizationLevel: 'faible',
      competitionLevel: 'fort',
      complexityLevel: 'fort',
    })
    const plafond = subScores({
      profileFit: 10,
      demandLevel: 'fort',
      monetizationLevel: 'fort',
      competitionLevel: 'faible',
      complexityLevel: 'faible',
    })
    expect(opportunityScore(plancher)).toBeGreaterThanOrEqual(0)
    expect(opportunityScore(plafond)).toBeLessThanOrEqual(100)
    expect(opportunityScore(plafond)).toBeGreaterThan(opportunityScore(plancher))
  })

  it('ne produit jamais un chiffre qui ressemble à une probabilité certaine', () => {
    // Même le meilleur des cas ne touche pas cent : les composantes plafonnent avant.
    const plafond = subScores({
      profileFit: 10,
      demandLevel: 'fort',
      monetizationLevel: 'fort',
      competitionLevel: 'faible',
      complexityLevel: 'faible',
    })
    expect(opportunityScore(plafond)).toBeLessThan(100)
  })
})

describe('compatibilité avec le profil', () => {
  it('monte quand la clientèle visée correspond à ce que la personne veut', () => {
    const pro = { ...IDEE, audience: 'Artisans du bâtiment', problem: 'Devis pour artisans' }
    const veutPro = profileFit({ profile: { ...PROFIL, audience: 'professionnels' }, idea: pro })
    const veutParticuliers = profileFit({
      profile: { ...PROFIL, audience: 'particuliers' },
      idea: pro,
    })
    expect(veutPro).toBeGreaterThan(veutParticuliers)
  })

  it('descend quand le délai dépasse le temps disponible', () => {
    const peuDeTemps = { ...PROFIL, weeklyHours: 3 }
    const rapide = profileFit({ profile: peuDeTemps, idea: { ...IDEE, timeToMarketWeeks: 3 } })
    const long = profileFit({ profile: peuDeTemps, idea: { ...IDEE, timeToMarketWeeks: 12 } })
    expect(rapide).toBeGreaterThan(long)
  })

  it('descend quand le coût de fonctionnement dépasse le budget', () => {
    const tient = profileFit({ profile: PROFIL, idea: { ...IDEE, runningCostCents: 1_000 } })
    const deborde = profileFit({ profile: PROFIL, idea: { ...IDEE, runningCostCents: 90_000 } })
    expect(tient).toBeGreaterThan(deborde)
  })

  it('monte quand le secteur est familier', () => {
    const inconnu = profileFit({ profile: PROFIL, idea: IDEE })
    const familier = profileFit({
      profile: { ...PROFIL, knownSectors: 'cuisine, restauration' },
      idea: IDEE,
    })
    expect(familier).toBeGreaterThan(inconnu)
  })

  it('descend pour une personne débutante devant une idée complexe', () => {
    const debutant = { ...PROFIL, technicalLevel: 'debutant' }
    const simple = profileFit({ profile: debutant, idea: { ...IDEE, complexityLevel: 'faible' } })
    const complexe = profileFit({ profile: debutant, idea: { ...IDEE, complexityLevel: 'fort' } })
    expect(simple).toBeGreaterThan(complexe)
  })

  it('reste entre zéro et dix', () => {
    const pire = profileFit({
      profile: { ...PROFIL, audience: 'professionnels', weeklyHours: 2, budgetCents: 0, preferredModel: 'one_time', technicalLevel: 'debutant' },
      idea: { ...IDEE, timeToMarketWeeks: 20, runningCostCents: 5_000, complexityLevel: 'fort' },
    })
    expect(pire).toBeGreaterThanOrEqual(0)
    expect(pire).toBeLessThanOrEqual(10)
  })
})

describe('empreinte et déduplication', () => {
  it('ignore les accents, les pluriels et les mots vides', () => {
    const a = fingerprintTokens('Carnets de recettes partagés', 'Retrouver ses recettes')
    const b = fingerprintTokens('Carnet de recette partage', 'Retrouver sa recette')
    expect(a).toEqual(b)
  })

  it('tient deux formulations de la même idée pour identiques', () => {
    const a = fingerprint('Calculateur de marges pour boulangeries', 'Les boulangers ne connaissent pas leurs marges')
    const b = fingerprint('Marges et coûts des boulangeries', 'Un boulanger ignore sa marge réelle')
    expect(looksAlike(a, b)).toBe(true)
  })

  it('distingue deux idées vraiment différentes', () => {
    const a = fingerprint('Calculateur de marges pour boulangeries', 'Connaître ses marges')
    const b = fingerprint('Réservation de séances pour coachs sportifs', 'Remplir son agenda')
    expect(looksAlike(a, b)).toBe(false)
  })

  it('est symétrique et refuse le vide', () => {
    const a = fingerprint('Carnet de recettes partagé', 'Retrouver ses recettes')
    const b = fingerprint('Recettes partagées en famille', 'Garder les recettes des proches')
    expect(looksAlike(a, b)).toBe(looksAlike(b, a))
    expect(looksAlike('', a)).toBe(false)
  })
})
