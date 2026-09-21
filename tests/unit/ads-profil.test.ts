import { describe, expect, it } from 'vitest'
import { seuilRentabilite } from '@/lib/rentabilite'
import {
  beneficePublicitaire,
  lectureObjectifs,
  profilRenseigne,
  PROFIL_VIDE,
  rythmeBudget,
  type ProfilAds,
} from '@/server/ads/profil'
import { moisCourant } from '@/server/ads/metriques'
import type { Indicateurs } from '@/server/ads/metriques'

/**
 * Le profil publicitaire, et ce qu'on en déduit.
 *
 * Ces tests portent sur la seule partie du produit qui transforme une mesure en jugement :
 * « ROAS 245 % » devient « vous perdez cinq points ». Un jugement faux coûte un budget mal
 * placé, et il ne se voit pas — il ressemble à un chiffre.
 */

const INDICATEURS_VIDES: Indicateurs = {
  cout: 0,
  impressions: 0,
  clics: 0,
  conversions: 0,
  valeur: 0,
  roas: null,
  cpa: null,
  ctr: null,
  cpc: null,
  tauxConversion: null,
}

function profil(champs: Partial<ProfilAds> = {}): ProfilAds {
  return { ...PROFIL_VIDE, ...champs }
}

describe('seuilRentabilite', () => {
  it('déduit le seuil de la marge', () => {
    expect(seuilRentabilite(40)).toBe(250)
    expect(seuilRentabilite(20)).toBe(500)
    expect(seuilRentabilite(50)).toBe(200)
  })

  it('rend 100 % pour une marge totale : un service sans coût de revient', () => {
    expect(seuilRentabilite(100)).toBe(100)
  })

  it('refuse une marge absente, négative ou supérieure à cent', () => {
    // Zéro veut dire « non renseignée ». Le traiter comme une marge nulle ferait diviser
    // par zéro et annoncer une perte à quelqu'un qui n'a rien rempli.
    expect(seuilRentabilite(0)).toBeNull()
    expect(seuilRentabilite(-10)).toBeNull()
    expect(seuilRentabilite(120)).toBeNull()
    expect(seuilRentabilite(Number.NaN)).toBeNull()
  })
})

describe('beneficePublicitaire', () => {
  it('retranche la dépense de la marge dégagée', () => {
    // 1000 de ventes à 40 % de marge = 400, moins 250 de publicité = 150.
    expect(beneficePublicitaire(1000, 250, 40)).toBe(150)
  })

  it('rend un nombre négatif quand la publicité coûte plus qu’elle ne laisse', () => {
    expect(beneficePublicitaire(400, 250, 40)).toBe(-90)
  })

  it('ne calcule rien sans marge', () => {
    expect(beneficePublicitaire(1000, 250, 0)).toBeNull()
  })
})

describe('rythmeBudget', () => {
  it('projette la fin de mois au rythme constaté', () => {
    const rythme = rythmeBudget(400, 240, 20, 30)
    expect(rythme?.projection).toBe(360)
    expect(rythme?.consomme).toBe(60)
  })

  it('ne projette rien le premier du mois', () => {
    // Zéro jour écoulé : extrapoler donnerait « vous dépenserez 0 », une prévision fausse
    // présentée comme une lecture.
    const rythme = rythmeBudget(400, 0, 0, 30)
    expect(rythme?.projection).toBeNull()
    expect(rythme?.consomme).toBe(0)
  })

  it('n’existe pas sans budget renseigné', () => {
    expect(rythmeBudget(0, 240, 20, 30)).toBeNull()
  })

  it('laisse la part consommée dépasser cent', () => {
    // Plafonner le chiffre masquerait le dépassement, qui est précisément l'information.
    expect(rythmeBudget(400, 500, 25, 30)?.consomme).toBe(125)
  })
})

describe('lectureObjectifs', () => {
  const total: Indicateurs = {
    ...INDICATEURS_VIDES,
    cout: 100,
    valeur: 245,
    conversions: 4,
    roas: 245,
    cpa: 25,
  }

  it('déclare une perte en dessous du seuil', () => {
    const lecture = lectureObjectifs(profil({ margePourcent: 40 }), total, 'CHF', null)
    expect(lecture.seuil).toBe(250)
    expect(lecture.verdict).toBe('perte')
    expect(lecture.ecartSeuil).toBe(-5)
  })

  it('déclare une rentabilité au-dessus du seuil', () => {
    const lecture = lectureObjectifs(profil({ margePourcent: 50 }), total, 'CHF', null)
    expect(lecture.seuil).toBe(200)
    expect(lecture.verdict).toBe('rentable')
    expect(lecture.ecartSeuil).toBe(45)
  })

  it('ne juge rien sans marge', () => {
    const lecture = lectureObjectifs(profil(), total, 'CHF', null)
    expect(lecture.verdict).toBe('inconnu')
    expect(lecture.seuil).toBeNull()
    expect(lecture.benefice).toBeNull()
  })

  it('ne juge rien sans dépense, même avec une marge', () => {
    // Une campagne qui n'a pas tourné n'est ni rentable ni à perte : elle n'a rien fait.
    const lecture = lectureObjectifs(
      profil({ margePourcent: 40 }),
      INDICATEURS_VIDES,
      'CHF',
      null,
    )
    expect(lecture.verdict).toBe('inconnu')
    expect(lecture.ecartSeuil).toBeNull()
  })

  it('compare à la cible quand elle existe, et se tait sinon', () => {
    const avec = lectureObjectifs(profil({ roasCible: 300 }), total, 'CHF', null)
    expect(avec.ecartCible).toBe(-55)

    const sans = lectureObjectifs(profil(), total, 'CHF', null)
    expect(sans.roasCible).toBeNull()
    expect(sans.ecartCible).toBeNull()
  })

  it('compare le coût par vente à celui qu’on accepte', () => {
    const lecture = lectureObjectifs(profil({ cpaCible: 20 }), total, 'CHF', null)
    expect(lecture.ecartCpa).toBe(5)
  })
})

describe('profilRenseigne', () => {
  it('distingue un profil vide d’un profil rempli', () => {
    expect(profilRenseigne(profil())).toBe(false)
    expect(profilRenseigne(profil({ margePourcent: 40 }))).toBe(true)
    expect(profilRenseigne(profil({ activite: 'Bougies artisanales' }))).toBe(true)
  })
})

describe('moisCourant', () => {
  it('compte les jours écoulés jusqu’à hier', () => {
    const mois = moisCourant('Europe/Zurich', new Date('2026-09-21T10:00:00Z'))
    expect(mois.premier).toBe('2026-09-01')
    expect(mois.hier).toBe('2026-09-20')
    expect(mois.joursEcoules).toBe(20)
    expect(mois.joursDuMois).toBe(30)
  })

  it('ne compte aucun jour le premier du mois', () => {
    const mois = moisCourant('Europe/Zurich', new Date('2026-09-01T10:00:00Z'))
    expect(mois.hier).toBeNull()
    expect(mois.joursEcoules).toBe(0)
  })

  it('connaît la longueur réelle du mois, années bissextiles comprises', () => {
    expect(moisCourant('UTC', new Date('2028-02-10T10:00:00Z')).joursDuMois).toBe(29)
    expect(moisCourant('UTC', new Date('2026-02-10T10:00:00Z')).joursDuMois).toBe(28)
    expect(moisCourant('UTC', new Date('2026-12-10T10:00:00Z')).joursDuMois).toBe(31)
  })

  it('découpe le mois dans le fuseau du compte, pas celui du serveur', () => {
    // 23h00 UTC le 30 septembre, c'est déjà le 1er octobre à Zurich : le mois a changé
    // là-bas, et c'est là-bas que la dépense est comptée.
    const zurich = moisCourant('Europe/Zurich', new Date('2026-09-30T23:00:00Z'))
    expect(zurich.premier).toBe('2026-10-01')
    expect(moisCourant('UTC', new Date('2026-09-30T23:00:00Z')).premier).toBe('2026-09-01')
  })
})
