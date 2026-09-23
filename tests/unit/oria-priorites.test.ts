import { describe, expect, it } from 'vitest'
import {
  AMPLEURS,
  CONFIANCES,
  POIDS_DEFAUT,
  URGENCES,
  classer,
  effortDuCatalogue,
  scoreOria,
  type Signal,
} from '@/server/oria/signaux'
import {
  canauxInconnus,
  faiblessePrincipale,
  santeMarketing,
  type EntreeSante,
} from '@/server/oria/sante'

/**
 * Le classement d'Oria, et ce qu'il refuse de faire.
 *
 * Son intérêt tient à une chose : il est calculé. Un ordre demandé à un modèle changerait à
 * chaque rafraîchissement, ne s'expliquerait pas et ne se corrigerait pas. Celui-ci se
 * refait à la main, et ces tests sont la démonstration qu'il se refait à la main.
 *
 * Trois propriétés le gouvernent, et chacune répond à une façon de rendre un tri trompeur.
 *
 * **Ce qui coûte maintenant passe devant ce qui coûte lentement.** Une panne avant une
 * balise, quelles que soient leurs autres qualités.
 *
 * **Un effort important retarde, il n'annule pas.** L'effort divise : un chantier lourd et
 * décisif reste devant une broutille, et derrière ce qui se règle dans l'heure.
 *
 * **Ce qu'on ne sait pas ne se présente pas comme ce qu'on sait.** La confiance multiplie,
 * et un canal sans donnée n'est jamais annoncé en bonne santé.
 */

function signal(partiel: Partial<Signal> & { cle: string }): Signal {
  return {
    sources: ['seo'],
    titre: partiel.cle,
    pourquoi: 'Parce que.',
    quoiFaire: 'Faire.',
    mesure: 'Relevé.',
    impact: 'moyen',
    effort: 'moyen',
    urgence: 'important',
    confiance: 'elevee',
    href: '/fr/visibilite',
    ...partiel,
  }
}

describe('le score de priorité', () => {
  it('ne dépend d’aucun modèle : le même signal rend toujours le même score', () => {
    const un = signal({ cle: 'a' })
    expect(scoreOria(un, POIDS_DEFAUT)).toBe(scoreOria(un, POIDS_DEFAUT))
  })

  it('fait passer ce qui coûte maintenant devant ce qui coûte lentement', () => {
    const panne = signal({ cle: 'panne', urgence: 'critique', impact: 'eleve' })
    const balise = signal({ cle: 'balise', urgence: 'information', impact: 'eleve' })
    expect(scoreOria(panne, POIDS_DEFAUT)).toBeGreaterThan(scoreOria(balise, POIDS_DEFAUT))
  })

  it('retarde un gros effort sans l’effacer', () => {
    /*
     * La propriété qui distingue une division d'un filtre. Un chantier lourd mais décisif
     * doit rester devant une broutille : sinon la liste ne contiendrait plus que des
     * broutilles, et c'est le reproche qu'on fait aux outils qui ne montrent que les
     * « quick wins ».
     */
    const chantier = signal({ cle: 'chantier', impact: 'eleve', effort: 'eleve' })
    const rapide = signal({ cle: 'rapide', impact: 'eleve', effort: 'faible' })
    const broutille = signal({ cle: 'broutille', impact: 'faible', effort: 'faible' })

    const [premier, deuxieme, troisieme] = classer(
      [broutille, chantier, rapide],
      POIDS_DEFAUT,
    )
    expect(premier?.cle).toBe('rapide')
    expect(deuxieme?.cle).toBe('chantier')
    expect(troisieme?.cle).toBe('broutille')
  })

  it('range plus bas ce qui repose sur peu de données', () => {
    const sur = signal({ cle: 'sur', confiance: 'elevee' })
    const fragile = signal({ cle: 'fragile', confiance: 'faible' })
    expect(scoreOria(sur, POIDS_DEFAUT)).toBeGreaterThan(scoreOria(fragile, POIDS_DEFAUT))
  })

  it('suit l’objectif de l’entreprise sans jamais faire disparaître le reste', () => {
    /*
     * Quelqu'un qui cherche des ventes ne classe pas comme quelqu'un qui cherche du trafic.
     * Mais un objectif est une préférence, pas un filtre : une panne reste une panne, et un
     * biais qui l'enterrerait sous une opportunité de conversion serait un piège.
     */
    const conversion = signal({ cle: 'conversion', sources: ['cro'], urgence: 'important' })
    const panne = signal({ cle: 'panne', sources: ['audit'], urgence: 'critique', impact: 'eleve' })
    const biais = { cro: 2 }

    expect(scoreOria(conversion, POIDS_DEFAUT, biais)).toBeGreaterThan(
      scoreOria(conversion, POIDS_DEFAUT),
    )
    const [premier] = classer([conversion, panne], POIDS_DEFAUT, biais)
    expect(premier?.cle).toBe('panne')
  })

  it('donne un ordre stable à score égal', () => {
    // Sans quoi deux rafraîchissements successifs intervertiraient deux priorités.
    const a = signal({ cle: 'aaa' })
    const b = signal({ cle: 'bbb' })
    expect(classer([b, a], POIDS_DEFAUT).map((un) => un.cle)).toEqual(['aaa', 'bbb'])
    expect(classer([a, b], POIDS_DEFAUT).map((un) => un.cle)).toEqual(['aaa', 'bbb'])
  })

  it('garde un score fini sur toutes les combinaisons possibles', () => {
    for (const impact of AMPLEURS)
      for (const effort of AMPLEURS)
        for (const urgence of URGENCES)
          for (const confiance of CONFIANCES) {
            const score = scoreOria(
              signal({ cle: 'x', impact, effort, urgence, confiance }),
              POIDS_DEFAUT,
            )
            expect(Number.isFinite(score)).toBe(true)
            expect(score).toBeGreaterThan(0)
          }
  })
})

describe('l’effort d’un constat d’audit', () => {
  it('vient de ce que le catalogue déclare, jamais de la gravité', () => {
    /*
     * Une première version rangeait tout constat critique non déclaré en « effort élevé ».
     * Un titre manquant — grave, corrigé en deux minutes — passait alors derrière tout le
     * reste. Non déclaré veut dire qu'on ne sait pas.
     */
    expect(effortDuCatalogue(true)).toBe('faible')
    expect(effortDuCatalogue(false)).toBe('eleve')
    expect(effortDuCatalogue(null)).toBe('moyen')
  })
})

function entree(partiel: Partial<EntreeSante> = {}): EntreeSante {
  return {
    seoScore: 80,
    geoScore: 80,
    croScore: 80,
    siteAnalyse: true,
    pannes: 0,
    ads: { relie: true, urgents: 0, aSurveiller: 0 },
    meta: { relie: true, urgents: 0, aSurveiller: 0 },
    ...partiel,
  }
}

describe('la santé marketing', () => {
  it('n’annonce jamais en bonne santé un canal qu’elle n’a pas regardé', () => {
    /*
     * Le test le plus important de ce fichier. Sans compte Meta relié, « Meta : bon » serait
     * un mensonge confortable, et c'est exactement le reproche qu'on fait aux tableaux de
     * bord : ils rassurent sur ce qu'ils ignorent.
     */
    const canaux = santeMarketing(
      entree({
        croScore: null,
        ads: { relie: false, urgents: 0, aSurveiller: 0 },
        meta: { relie: false, urgents: 0, aSurveiller: 0 },
      }),
    )
    for (const id of ['cro', 'ads', 'meta']) {
      const canal = canaux.find((un) => un.id === id)
      expect(canal?.etat, id).toBe('inconnu')
    }
    // Et elle dit comment cesser d'ignorer.
    expect(canauxInconnus(canaux).map((un) => un.aRelier)).toContain('Meta Ads')
  })

  it('ne compte pas un canal inconnu comme une faiblesse', () => {
    /*
     * Ne pas savoir n'est pas aller mal. Les confondre ferait dire à Oria que la publicité
     * est le point faible de quelqu'un qui n'en fait pas.
     */
    const canaux = santeMarketing(
      entree({
        seoScore: 40,
        ads: { relie: false, urgents: 0, aSurveiller: 0 },
        meta: { relie: false, urgents: 0, aSurveiller: 0 },
      }),
    )
    expect(faiblessePrincipale(canaux)?.id).toBe('seo')
  })

  it('n’a pas de faiblesse à nommer quand tout va bien', () => {
    expect(faiblessePrincipale(santeMarketing(entree()))).toBeNull()
  })

  it('cite le chiffre qui a décidé de l’état', () => {
    // « À renforcer » sans raison est un verdict ; avec le chiffre, c'est un constat.
    const canaux = santeMarketing(entree({ croScore: 38, pannes: 2 }))
    expect(canaux.find((un) => un.id === 'cro')?.pourquoi).toContain('38/100')
    expect(canaux.find((un) => un.id === 'technique')?.pourquoi).toContain('2 problèmes')
  })

  it('met un constat urgent publicitaire au-dessus d’un point à surveiller', () => {
    const urgent = santeMarketing(entree({ meta: { relie: true, urgents: 1, aSurveiller: 4 } }))
    expect(urgent.find((un) => un.id === 'meta')?.etat).toBe('renforcer')
    const tiede = santeMarketing(entree({ meta: { relie: true, urgents: 0, aSurveiller: 2 } }))
    expect(tiede.find((un) => un.id === 'meta')?.etat).toBe('surveiller')
  })
})
