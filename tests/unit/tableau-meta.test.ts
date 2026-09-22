import { describe, expect, it } from 'vitest'
import { PROFIL_VIDE, type ProfilAds } from '@/server/ads/profil'
import {
  indicateursMeta,
  juger,
  periodeMetaValide,
  PERIODES_META,
  SEUILS,
  type CumulMeta,
} from '@/server/ads/tableau-meta'

/**
 * Le verdict, et la seule façon dont un code couleur ment.
 *
 * Une pastille verte ou rouge est lue en une seconde et décide d'un geste. Si elle se fonde
 * sur un seuil universel, elle se trompe pour tout le monde sauf pour le commerce moyen, qui
 * n'existe pas : un CPA de 37 francs est excellent à 60 % de marge sur un panier de 120, et
 * ruineux à 20 % sur un panier de 40.
 *
 * Ce qui se vérifie ici est donc moins l'arithmétique que l'ordre des questions — et surtout
 * ce que MIRA refuse de juger.
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

function profil(patch: Partial<ProfilAds> = {}): ProfilAds {
  return { ...PROFIL_VIDE, ...patch }
}

describe('les indicateurs propres à Meta', () => {
  it('calcule le coût de mille affichages', () => {
    // 200 unités pour 50 000 affichages : quatre unités les mille.
    expect(indicateursMeta(cumul()).cpm).toBe(4)
  })

  it('n’invente pas un CPM sans affichage', () => {
    expect(indicateursMeta(cumul({ impressions: 0 })).cpm).toBeNull()
  })

  it('déduit la fréquence plutôt que de la stocker', () => {
    expect(indicateursMeta(cumul({ impressions: 60_000, portee: 20_000 })).frequence).toBe(3)
  })

  it('se tait sur la fréquence quand la portée est inconnue', () => {
    expect(indicateursMeta(cumul({ portee: 0 })).frequence).toBe(0)
  })
})

describe('ce que MIRA refuse de juger', () => {
  it('se tait quand la publicité n’a pas été assez montrée', () => {
    const jugement = juger(indicateursMeta(cumul({ impressions: 200 })), profil({ roasCible: 250 }))

    expect(jugement.verdict).toBe('insuffisant')
    expect(jugement.motif).toContain('affichages')
  })

  it('se tait quand la dépense est trop faible', () => {
    const petite = cumul({ coutMicros: 5_000_000, impressions: 50_000 })

    expect(juger(indicateursMeta(petite), profil({ roasCible: 250 })).verdict).toBe('insuffisant')
  })

  it('se tait quand trop peu de ventes soutiennent le calcul', () => {
    const rare = cumul({ conversions: SEUILS.conversions - 1 })

    expect(juger(indicateursMeta(rare), profil({ cpaCible: 25 })).verdict).toBe('insuffisant')
  })

  it('se tait quand aucun objectif n’est posé, quels que soient les chiffres', () => {
    /*
     * La règle la plus importante du module. Sans marge ni cible, « CPA de 20 francs » n'est
     * ni bon ni mauvais — et appliquer une moyenne de marché reviendrait à juger quelqu'un
     * d'après un commerce qui n'est pas le sien.
     */
    const jugement = juger(indicateursMeta(cumul()), profil())

    expect(jugement.verdict).toBe('insuffisant')
    expect(jugement.motif).toContain('objectif')
  })
})

describe('le verdict, une fois les objectifs posés', () => {
  it('met au vert ce qui atteint la cible de ROAS', () => {
    // 600 de valeur pour 200 de dépense : 300 %.
    expect(juger(indicateursMeta(cumul()), profil({ roasCible: 250 })).verdict).toBe('bon')
  })

  it('met à l’orange ce qui la frôle, plutôt qu’au rouge', () => {
    /*
     * Sans bande de tolérance, tout ce qui n'est pas atteint devient rouge — et une liste
     * tout en rouge ne désigne plus rien.
     */
    expect(juger(indicateursMeta(cumul()), profil({ roasCible: 340 })).verdict).toBe('surveiller')
  })

  it('met au rouge ce qui en est loin', () => {
    expect(juger(indicateursMeta(cumul()), profil({ roasCible: 600 })).verdict).toBe('agir')
  })

  it('juge sur le ROAS plutôt que sur le CPA quand les deux sont posés', () => {
    /*
     * Le ROAS tient compte de la valeur des ventes, là où le CPA traite une vente à dix
     * francs comme une vente à trois cents.
     */
    const avecLesDeux = profil({ roasCible: 250, cpaCible: 5 })

    // CPA réel : 20 — au-dessus de 5, donc « agir » si le CPA primait. ROAS 300 % : « bon ».
    expect(juger(indicateursMeta(cumul()), avecLesDeux).verdict).toBe('bon')
  })

  it('retombe sur le CPA quand le ROAS n’est pas visé', () => {
    expect(juger(indicateursMeta(cumul()), profil({ cpaCible: 25 })).verdict).toBe('bon')
    expect(juger(indicateursMeta(cumul()), profil({ cpaCible: 18 })).verdict).toBe('surveiller')
    expect(juger(indicateursMeta(cumul()), profil({ cpaCible: 10 })).verdict).toBe('agir')
  })
})

describe('dépenser sans rien obtenir', () => {
  it('est le seul constat qui se passe d’un objectif chiffré… presque', () => {
    /*
     * Presque : il faut tout de même que la personne vise quelque chose. Une campagne de
     * notoriété n'a pas d'achats et ce n'est pas un défaut.
     */
    const sec = cumul({ conversions: 0, valeurConversion: 0 })

    expect(juger(indicateursMeta(sec), profil({ roasCible: 250 })).verdict).toBe('agir')
    expect(juger(indicateursMeta(sec), profil({ cpaCible: 25 })).verdict).toBe('agir')
    expect(juger(indicateursMeta(sec), profil()).verdict).toBe('insuffisant')
  })

  it('n’est jamais déclaré « bon » par l’absence de CPA', () => {
    /*
     * Le piège que l'ordre des tests existe pour éviter : un CPA sans conversion vaut `null`,
     * et un `null` se laisse lire comme « rien à signaler ».
     */
    const sec = indicateursMeta(cumul({ conversions: 0, valeurConversion: 0 }))

    expect(sec.cpa).toBeNull()
    expect(juger(sec, profil({ cpaCible: 25 })).verdict).not.toBe('bon')
  })
})

describe('la période demandée', () => {
  it('accepte les fenêtres proposées et ramène le reste', () => {
    for (const periode of PERIODES_META) expect(periodeMetaValide(periode)).toBe(periode)
    for (const bruit of [undefined, null, 'tout', -5, 9999]) {
      expect(PERIODES_META).toContain(periodeMetaValide(bruit))
    }
  })

  it('ne propose pas la journée en cours', () => {
    /*
     * Elle est incomplète par définition et la synchronisation ne la lit pas. La montrer
     * ferait plonger tous les indicateurs chaque matin, d'une chute que personne ne
     * s'expliquerait.
     */
    expect(PERIODES_META[0]).toBe(1)
  })
})
