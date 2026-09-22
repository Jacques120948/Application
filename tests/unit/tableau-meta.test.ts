import { describe, expect, it } from 'vitest'
import { PROFIL_VIDE, type ProfilAds } from '@/server/ads/profil'
import {
  indicateursMeta,
  juger,
  periodeMetaValide,
  PERIODES_META,
  SEUILS,
  synthese,
  type CumulMeta,
  type VueMeta,
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

describe('ce que MIRA dit en une phrase', () => {
  function vue(patch: Partial<VueMeta> = {}): VueMeta {
    const total = indicateursMeta(cumul())
    return {
      compte: { devise: 'CHF' } as VueMeta['compte'],
      jours: 7,
      profil: profil({ roasCible: 250 }),
      total,
      totalPrecedent: total,
      ecarts: { cout: null, conversions: null, roas: null, cpa: null },
      campagnesTotal: 0,
      campagnesActives: 0,
      derniereDepense: null,
      campagnes: [],
      ensembles: [],
      annonces: [],
      ...patch,
    }
  }

  it('n’invente aucun chiffre : ceux qu’elle cite sont ceux du tableau', () => {
    const dit = synthese(vue(), [])

    expect(dit).toContain('200')
    expect(dit).toContain('300 %')
    expect(dit).toContain('CHF')
  })

  it('dit qu’elle ne peut pas juger sans objectif, plutôt que de se taire', () => {
    const dit = synthese(vue({ profil: profil() }), [])

    expect(dit).toContain('marge')
    expect(dit).not.toContain('objectifs : il n’y a pas de geste')
  })

  it('annonce le nombre de lignes à traiter et à surveiller', () => {
    const dit = synthese(vue(), [
      { priorite: 'urgent' },
      { priorite: 'urgent' },
      { priorite: 'surveiller' },
    ])

    expect(dit).toContain('2 demandent une décision')
    expect(dit).toContain('1 est à surveiller')
  })

  it('dit le silence plutôt que de le laisser deviner', () => {
    expect(synthese(vue(), [])).toContain('pas de geste à faire')
  })

  /*
   * Une fenêtre vide se lit comme une panne si l'écran ne sait pas dire pourquoi elle l'est.
   *
   * Le cas s'est produit en production : cent vingt-cinq campagnes en pause depuis deux
   * semaines, et un tableau de bord qui affichait des zéros en suggérant qu'elles étaient
   * « peut-être » en pause. Le produit connaissait la réponse et ne la donnait pas. Ces
   * trois vérifications figent la distinction entre « rien », « je ne sais pas » et « ça ne
   * va pas ».
   */
  const RIEN = indicateursMeta({ ...cumul(), coutMicros: 0, conversions: 0, valeurConversion: 0 })

  it('ne parle pas de rendement quand rien n’a été dépensé', () => {
    const dit = synthese(vue({ total: RIEN, campagnesTotal: 4, campagnesActives: 0 }), [])
    expect(dit).toContain('n’a dépensé')
    expect(dit).not.toContain('retour de')
  })

  it('dit que les campagnes dorment, plutôt que de le supposer', () => {
    const dit = synthese(
      vue({
        total: RIEN,
        campagnesTotal: 125,
        campagnesActives: 0,
        derniereDepense: new Date('2026-09-05T00:00:00Z'),
      }),
      [],
    )
    expect(dit).toContain('125 campagnes sont toutes en pause')
    // La date de la dernière dépense évite de chercher une panne là où il n'y en a pas.
    expect(dit).toContain('5 septembre')
    expect(dit).toContain('Rien n’est cassé')
    expect(dit).not.toContain('peut-être')
  })

  it('alerte quand des campagnes actives ne dépensent rien', () => {
    const dit = synthese(vue({ total: RIEN, campagnesTotal: 3, campagnesActives: 3 }), [])
    // Là, c'est un vrai problème : actives et muettes ne vont pas ensemble.
    expect(dit).toContain('3 sont actives')
    expect(dit).toContain('gestionnaire de publicités')
  })

  it('ne parle pas de pause quand le compte n’a aucune campagne', () => {
    const dit = synthese(vue({ total: RIEN, campagnesTotal: 0, campagnesActives: 0 }), [])
    expect(dit).toContain('aucune campagne')
    expect(dit).not.toContain('en pause')
  })

  it('accorde le singulier pour une seule journée', () => {
    expect(synthese(vue({ jours: 1 }), [])).toContain('Hier')
  })
})
