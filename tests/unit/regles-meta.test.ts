import { describe, expect, it } from 'vitest'
import { PROFIL_VIDE, type ProfilAds } from '@/server/ads/profil'
import { evaluerMeta, type ContexteMeta } from '@/server/ads/regles-meta'
import { indicateursMeta, juger, type CumulMeta, type LigneMeta, type VueMeta } from '@/server/ads/tableau-meta'

/**
 * Les règles de MIRA, et la seule qui justifie qu'elle existe à côté de Naya.
 *
 * Ce qui se vérifie ici n'est pas l'arithmétique mais la **retenue**. Une règle qui se
 * déclenche trop produit une liste qu'on cesse de lire ; une règle qui se déclenche sur un
 * seul signal produit des conseils qui ont l'air fondés et ne le sont pas. Chaque test ci-
 * dessous décrit un cas où MIRA doit se taire.
 */

function cumul(patch: Partial<CumulMeta> = {}): CumulMeta {
  return {
    coutMicros: 200_000_000,
    impressions: 50_000,
    clics: 800,
    conversions: 10,
    valeurConversion: 600,
    portee: 20_000,
    ...patch,
  }
}

function ligne(
  nom: string,
  actuel: Partial<CumulMeta>,
  precedent: Partial<CumulMeta> = {},
): LigneMeta {
  const maintenant = indicateursMeta(cumul(actuel))
  const avant = indicateursMeta(cumul({ ...actuel, ...precedent }))
  return {
    id: nom,
    nom,
    statut: 'ACTIVE',
    budget: 0,
    actuel: maintenant,
    precedent: avant,
    ecarts: {
      cout: null,
      conversions: null,
      roas:
        maintenant.roas === null || avant.roas === null ? null : maintenant.roas - avant.roas,
      cpa: null,
    },
    jugement: juger(maintenant, PROFIL_VIDE),
  }
}

function contexte(patch: {
  profil?: Partial<ProfilAds>
  campagnes?: LigneMeta[]
  ensembles?: LigneMeta[]
  annonces?: LigneMeta[]
  total?: Partial<CumulMeta>
}): ContexteMeta {
  const profil = { ...PROFIL_VIDE, ...patch.profil }
  const vue: VueMeta = {
    compte: { devise: 'CHF' } as VueMeta['compte'],
    jours: 7,
    profil,
    total: indicateursMeta(cumul(patch.total)),
    totalPrecedent: indicateursMeta(cumul()),
    ecarts: { cout: null, conversions: null, roas: null, cpa: null },
    campagnes: patch.campagnes ?? [],
    ensembles: patch.ensembles ?? [],
    annonces: patch.annonces ?? [],
  }
  return { devise: 'CHF', profil, vue }
}

describe('la fatigue publicitaire', () => {
  /*
   * La règle propre à Meta : chez Google, une requête ne se lasse pas de rien. Elle exige
   * trois signaux ensemble, et chacun des tests suivants en retire un seul.
   */
  const fatiguee = () =>
    contexte({
      annonces: [
        ligne(
          'Vidéo bougie',
          { impressions: 90_000, portee: 25_000, clics: 400 },
          { impressions: 45_000, portee: 25_000, clics: 900, coutMicros: 60_000_000 },
        ),
      ],
    })

  it('se déclenche quand la fréquence monte, le clic baisse et l’affichage coûte plus cher', () => {
    const constats = evaluerMeta(fatiguee())
    const trouve = constats.find((un) => un.regle === 'meta.creative.fatigue')

    expect(trouve).toBeDefined()
    expect(trouve?.niveau).toBe('annonce')
    // Les quatre temps sont remplis : sans eux, le constat ne fait agir personne.
    expect(trouve?.observation.length).toBeGreaterThan(30)
    expect(trouve?.pourquoi.length).toBeGreaterThan(30)
    expect(trouve?.consequence.length).toBeGreaterThan(30)
    expect(trouve?.recommandation.length).toBeGreaterThan(30)
  })

  it('se tait quand la fréquence est basse, même si le clic baisse', () => {
    /*
     * Un taux de clic baisse pour dix raisons. Sans répétition, ce n'est pas de la fatigue —
     * et le dire ferait changer un visuel qui n'a rien fait.
     */
    const sansRepetition = contexte({
      annonces: [
        ligne(
          'Vidéo bougie',
          { impressions: 40_000, portee: 38_000, clics: 400 },
          { impressions: 40_000, portee: 38_000, clics: 900, coutMicros: 60_000_000 },
        ),
      ],
    })

    expect(evaluerMeta(sansRepetition).some((un) => un.regle === 'meta.creative.fatigue')).toBe(
      false,
    )
  })

  it('se tait quand le taux de clic tient, malgré la répétition', () => {
    // Une campagne de notoriété peut viser la répétition : ce n'est pas un défaut.
    const repeteeMaisEfficace = contexte({
      annonces: [
        ligne(
          'Vidéo bougie',
          { impressions: 90_000, portee: 25_000, clics: 1_800 },
          { impressions: 45_000, portee: 25_000, clics: 900, coutMicros: 60_000_000 },
        ),
      ],
    })

    expect(
      evaluerMeta(repeteeMaisEfficace).some((un) => un.regle === 'meta.creative.fatigue'),
    ).toBe(false)
  })

  it('ne demande aucun objectif : elle constate un mécanisme, elle ne juge pas', () => {
    const constats = evaluerMeta(fatiguee())
    expect(constats.some((un) => un.regle === 'meta.creative.fatigue')).toBe(true)
  })
})

describe('dépenser sans vendre', () => {
  const muet = (profil: Partial<ProfilAds>) =>
    contexte({
      profil,
      ensembles: [ligne('Prospection', { conversions: 0, valeurConversion: 0 })],
    })

  it('se signale au niveau de l’ensemble, là où vit le budget chez Meta', () => {
    const trouve = evaluerMeta(muet({ cpaCible: 25 })).find(
      (un) => un.regle === 'meta.sans.vente',
    )

    expect(trouve?.niveau).toBe('ensemble')
    // Remonter à la campagne éteindrait aussi ce qui marche.
    expect(trouve?.action.type).toBe('pause-ensemble')
  })

  it('invite à vérifier le suivi avant de mettre en pause', () => {
    /*
     * Une vente non comptée ressemble exactement à une vente inexistante. Conseiller la
     * pause sans le dire ferait éteindre une campagne qui vend.
     */
    const trouve = evaluerMeta(muet({ cpaCible: 25 })).find(
      (un) => un.regle === 'meta.sans.vente',
    )

    expect(trouve?.recommandation).toContain('suivi')
  })

  it('se tait quand aucun objectif n’est posé', () => {
    expect(evaluerMeta(muet({})).some((un) => un.regle === 'meta.sans.vente')).toBe(false)
  })

  it('se tait sous le plancher de dépense', () => {
    const miette = contexte({
      profil: { cpaCible: 25 },
      ensembles: [ligne('Test', { coutMicros: 5_000_000, conversions: 0, valeurConversion: 0 })],
    })

    expect(evaluerMeta(miette).some((un) => un.regle === 'meta.sans.vente')).toBe(false)
  })
})

describe('les bonnes nouvelles', () => {
  it('signale une créative nettement au-dessus du compte', () => {
    /*
     * Un tableau de bord qui ne signale que les problèmes apprend à ne chercher que des
     * problèmes. Ce qui marche mérite d'être vu : c'est là qu'il y a à reproduire.
     */
    const gagnante = contexte({
      profil: { roasCible: 250 },
      total: { valeurConversion: 600 },
      annonces: [ligne('Carrousel pierres', { valeurConversion: 1_200 })],
    })

    const trouve = evaluerMeta(gagnante).find((un) => un.regle === 'meta.creative.gagnante')
    expect(trouve?.priorite).toBe('opportunite')
    expect(trouve?.recommandation).toContain('Déclinez')
  })

  it('n’attribue rien à une créative qui n’a pas assez vendu', () => {
    const coincidence = contexte({
      profil: { roasCible: 250 },
      annonces: [ligne('Coup de chance', { conversions: 1, valeurConversion: 1_200 })],
    })

    expect(
      evaluerMeta(coincidence).some((un) => un.regle === 'meta.creative.gagnante'),
    ).toBe(false)
  })
})

describe('la liste dans son ensemble', () => {
  it('ne répète pas le même problème sous deux noms', () => {
    /*
     * Un ensemble qui ne vend rien n'a pas, en plus, « un coût par vente trop élevé » : c'est
     * le même argent et le même problème. Une liste qui répète est une liste qu'on cesse de
     * lire.
     */
    const constats = evaluerMeta(
      contexte({
        profil: { cpaCible: 25 },
        ensembles: [ligne('Prospection', { conversions: 0, valeurConversion: 0 })],
      }),
    )

    expect(constats.filter((un) => un.cibleId === 'Prospection')).toHaveLength(1)
  })

  it('classe l’urgent avant l’opportunité, et l’opportunité avant l’information', () => {
    const constats = evaluerMeta(
      contexte({
        profil: { roasCible: 250, cpaCible: 25 },
        total: { valeurConversion: 600 },
        ensembles: [ligne('Muet', { conversions: 0, valeurConversion: 0 })],
        annonces: [ligne('Championne', { valeurConversion: 1_200 })],
      }),
    )

    const rangs = constats.map((un) => un.priorite)
    expect(rangs.indexOf('urgent')).toBeLessThan(rangs.indexOf('opportunite'))
  })

  it('ne rend rien sur un compte vide, plutôt que d’inventer', () => {
    expect(evaluerMeta(contexte({}))).toEqual([])
  })
})
