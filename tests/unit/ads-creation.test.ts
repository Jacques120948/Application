import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  autoriseCreation,
  autoriseEnchere,
  BUDGET_MAX,
  BUDGET_MIN,
  CAMPAGNES_PAR_JOUR,
  MOTS_CLES_PAR_GROUPE,
  PLACES_CAMPAGNE,
} from '@/server/ads/garde-fous'
import {
  enchereProposee,
  plafondEnchere,
  PRIX_MINIMUM_CONNUS,
  TAUX_PLAUSIBLE,
} from '@/server/ads/mots-cles'
import { auPasFacturable, PAS_FACTURABLE } from '@/lib/pas-facturable'
import { PROFIL_VIDE } from '@/server/ads/profil'

/**
 * La création d'une campagne.
 *
 * Le seul geste d'Evoliia qui fabrique une dépense à partir de rien. Tous les autres
 * modifient quelque chose que la personne a déjà décidé d'avoir ; celui-ci fabrique la
 * décision. C'est pourquoi tout ce qui est vérifié ici l'est plus sévèrement qu'ailleurs.
 */

const MICROS = 1_000_000

function demande(champs: Record<string, unknown> = {}) {
  return {
    mode: 'assiste',
    devise: 'CHF',
    profil: { ...PROFIL_VIDE },
    faitesAujourdhui: 0,
    campagnesAujourdhui: 0,
    ...champs,
  } as Parameters<typeof autoriseCreation>[0]
}

function plan(champs: Record<string, unknown> = {}) {
  return {
    nom: 'Recherche — Citrine',
    budgetMicros: 5 * MICROS,
    urlFinale: 'https://cap-nature.ch/collections/citrine',
    motsCles: [{ texte: 'bougie citrine' }],
    titres: ['Bougies Citrine', 'Cire de Soja Suisse', 'Fabriqué en Valais'],
    descriptions: ['Des bougies coulées à la main.', 'Livraison depuis la Suisse.'],
    ...champs,
  } as Parameters<typeof autoriseCreation>[1]
}

const HOTES = ['cap-nature.ch']

describe('les bornes d’une création', () => {
  it('acceptent un plan complet et cohérent', () => {
    expect(autoriseCreation(demande(), plan(), HOTES).ok).toBe(true)
  })

  it('refusent un compte en lecture seule', () => {
    expect(autoriseCreation(demande({ mode: 'lecture' }), plan(), HOTES).ok).toBe(false)
  })

  it('n’en laissent créer qu’une par jour', () => {
    /*
     * Bien plus bas que tout le reste. Quelqu'un qui a besoin d'en créer trois dans la
     * journée a un projet particulier et le fera dans Google Ads ; une boucle qui en crée
     * trois n'a aucun projet du tout.
     */
    expect(CAMPAGNES_PAR_JOUR).toBe(1)
    expect(
      autoriseCreation(demande({ campagnesAujourdhui: CAMPAGNES_PAR_JOUR }), plan(), HOTES).ok,
    ).toBe(false)
  })

  it('refusent une page d’arrivée qui n’est pas chez la personne', () => {
    /*
     * La vérification la plus importante du fichier. Sans elle, Evoliia serait un moyen
     * d’acheter du trafic Google vers n’importe quelle page, payé par le compte de
     * quelqu’un d’autre.
     */
    const verdict = autoriseCreation(
      demande(),
      plan({ urlFinale: 'https://ailleurs.test/page' }),
      HOTES,
    )
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.raison).toContain('cap-nature.ch')
  })

  it('acceptent un sous-domaine mais pas un suffixe trompeur', () => {
    // Qui possède cap-nature.ch possède boutique.cap-nature.ch. Mais « faux-cap-nature.ch »
    // est un autre domaine, et seul le point qui précède fait la différence.
    expect(
      autoriseCreation(demande(), plan({ urlFinale: 'https://boutique.cap-nature.ch/x' }), HOTES).ok,
    ).toBe(true)
    expect(
      autoriseCreation(demande(), plan({ urlFinale: 'https://faux-cap-nature.ch/x' }), HOTES).ok,
    ).toBe(false)
  })

  it('exigent HTTPS', () => {
    expect(
      autoriseCreation(demande(), plan({ urlFinale: 'http://cap-nature.ch/x' }), HOTES).ok,
    ).toBe(false)
  })

  it('bornent le budget, en absolu et sur le profil', () => {
    expect(autoriseCreation(demande(), plan({ budgetMicros: 0.5 * MICROS }), HOTES).ok).toBe(false)
    expect(
      autoriseCreation(demande(), plan({ budgetMicros: (BUDGET_MAX + 1) * MICROS }), HOTES).ok,
    ).toBe(false)
    expect(BUDGET_MIN).toBeGreaterThan(0)

    /*
     * La borne qui compte vraiment. 60 CHF par mois font moins de 2 CHF par jour pour
     * l'ensemble des campagnes : une campagne neuve à 5 CHF priverait celles qui tournent.
     */
    const serre = demande({ profil: { ...PROFIL_VIDE, budgetMensuel: 60 } })
    const verdict = autoriseCreation(serre, plan({ budgetMicros: 5 * MICROS }), HOTES)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.raison).toContain('60')
    expect(autoriseCreation(serre, plan({ budgetMicros: 1.5 * MICROS }), HOTES).ok).toBe(true)
  })

  it('exigent ce que Google exige d’une annonce', () => {
    // En dessous, Google refuse l'annonce et le groupe n'a rien à diffuser — ce qu'il vaut
    // mieux dire avant d'avoir créé six objets.
    expect(
      autoriseCreation(demande(), plan({ titres: ['Un', 'Deux'] }), HOTES).ok,
    ).toBe(false)
    expect(
      autoriseCreation(demande(), plan({ descriptions: ['Une seule.'] }), HOTES).ok,
    ).toBe(false)
    expect(PLACES_CAMPAGNE.titresMin).toBe(3)
    expect(PLACES_CAMPAGNE.descriptionsMin).toBe(2)
  })

  it('refusent un titre que Google jetterait', () => {
    expect(
      autoriseCreation(demande(), plan({ titres: ['a'.repeat(31), 'Deux', 'Trois'] }), HOTES).ok,
    ).toBe(false)
  })

  it('refusent une campagne sans mot-clé', () => {
    const verdict = autoriseCreation(demande(), plan({ motsCles: [] }), HOTES)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.raison).toContain('diffuse')
  })

  it('refusent un groupe qui aurait perdu son thème', () => {
    const trop = Array.from({ length: MOTS_CLES_PAR_GROUPE + 1 }, (_, rang) => ({
      texte: `mot ${rang}`,
    }))
    expect(autoriseCreation(demande(), plan({ motsCles: trop }), HOTES).ok).toBe(false)
  })
})

describe('l’enchère proposée', () => {
  /** Une fourchette de prix, en micros. */
  function mot(bas: number, haut: number) {
    return { coutBasMicros: bas * MICROS, coutHautMicros: haut * MICROS }
  }

  it('se tait quand trop peu de prix sont connus', () => {
    /*
     * Un plan où quatre mots sur douze avaient un prix a rendu trois centimes : vrai pour
     * ces quatre-là, et inexploitable — à ce niveau Google sert ceux qui enchérissent plus,
     * et la campagne ne s'affiche jamais. Mieux vaut demander le montant.
     */
    expect(PRIX_MINIMUM_CONNUS).toBeGreaterThan(1)
    expect(enchereProposee([mot(0.4, 0.8), mot(0.6, 1)], 0)).toBe(0)
  })

  it('prend la médiane du milieu de fourchette', () => {
    /*
     * La médiane et non la moyenne : un seul mot-clé très disputé tirerait la moyenne vers
     * le haut et ferait payer son prix à tous les autres.
     *
     * Le milieu et non le bas, et c'est une correction. Le « bas de fourchette » de Google
     * est le minimum pour apparaître *parfois* en haut de page : un plancher, pas une
     * enchère de travail. Un plan a démarré à un centime — la campagne ne se serait jamais
     * affichée, et son silence serait passé pour une panne.
     */
    const mots = [mot(0.2, 0.6), mot(0.4, 0.8), mot(4, 6)]
    // Milieux : 0.40, 0.60, 5.00 — médiane 0.60.
    expect(enchereProposee(mots, 0)).toBe(0.6 * MICROS)
  })

  it('plafonne à ce que l’objectif permet', () => {
    // À 20 CHF par vente et 5 % de conversion plausible, le clic ne peut pas dépasser 1 CHF.
    const mots = [mot(2, 4), mot(2, 4), mot(2, 4)]
    expect(enchereProposee(mots, 20)).toBe(((20 * TAUX_PLAUSIBLE) / 100) * MICROS)
  })

  it('se contente du bas quand le haut manque', () => {
    // Google ne rend pas toujours les deux bornes : mieux vaut le bas que rien.
    const mots = [mot(0.5, 0), mot(0.5, 0), mot(0.5, 0)]
    expect(enchereProposee(mots, 0)).toBe(0.5 * MICROS)
  })

  it('ne devine pas quand Google n’a donné aucun prix', () => {
    // Un chiffre inventé aurait l'air calculé. L'écran demandera le montant.
    expect(enchereProposee([mot(0, 0), mot(0, 0), mot(0, 0)], 25)).toBe(0)
    expect(enchereProposee([], 25)).toBe(0)
  })
})

describe('l’unité facturable', () => {
  it('arrondit au centime, parce que Google refuse le reste', () => {
    /*
     * « Value must be a multiple of billable unit. » Une médiane ne tombe pas sur un centime
     * rond : une enchère calculée à 0,375 CHF faisait refuser la création entière.
     */
    expect(PAS_FACTURABLE).toBe(10_000)
    expect(auPasFacturable(375_000)).toBe(380_000)
    expect(auPasFacturable(374_999)).toBe(370_000)
    expect(auPasFacturable(500_000)).toBe(500_000)
  })

  it('ne rend jamais de montant négatif ni absurde', () => {
    expect(auPasFacturable(-1)).toBe(0)
    expect(auPasFacturable(Number.NaN)).toBe(0)
  })

  it('s’applique à l’enchère calculée', () => {
    // Milieux : 0.35, 0.375, 0.40 — médiane 0.375, qui doit sortir arrondie.
    const mots = [
      { coutBasMicros: 300_000, coutHautMicros: 400_000 },
      { coutBasMicros: 350_000, coutHautMicros: 400_000 },
      { coutBasMicros: 350_000, coutHautMicros: 450_000 },
    ]
    const enchere = enchereProposee(mots, 0)
    expect(enchere % PAS_FACTURABLE).toBe(0)
  })

  it('s’applique au repère affiché', () => {
    // 17 CHF par vente à 5 % font 0,85 CHF — mais 13 CHF feraient 0,65 et 7 CHF, 0,35.
    for (const cpa of [7, 13, 17, 23]) {
      expect(plafondEnchere(cpa) % PAS_FACTURABLE).toBe(0)
    }
  })
})

describe('l’enchère saisie à la main', () => {
  it('refuse une enchère qui épuiserait la journée en un clic', () => {
    /*
     * La seule borne dure, et elle n'est pas là où on l'attend. Ce n'est pas le rapport à la
     * marge — la personne connaît son marché mieux qu'un seuil — c'est le rapport au budget :
     * une enchère au-dessus du budget du jour n'est pas une stratégie, c'est une faute de
     * frappe.
     */
    const verdict = autoriseEnchere(6 * MICROS, 5 * MICROS)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.raison).toContain('un seul clic')
    expect(autoriseEnchere(5 * MICROS, 5 * MICROS).ok).toBe(true)
  })

  it('refuse un montant qui n’est pas au centime', () => {
    // Google le refuserait, et son message ne nomme pas le champ sans qu'on le lui demande.
    expect(autoriseEnchere(375_000, 5 * MICROS).ok).toBe(false)
    expect(autoriseEnchere(380_000, 5 * MICROS).ok).toBe(true)
  })

  it('refuse un montant absent ou absurde', () => {
    expect(autoriseEnchere(0, 5 * MICROS).ok).toBe(false)
    expect(autoriseEnchere(-1, 5 * MICROS).ok).toBe(false)
    expect(autoriseEnchere(Number.NaN, 5 * MICROS).ok).toBe(false)
  })

  it('ne borne pas sur la marge, qui n’est qu’un repère', () => {
    // Un mot-clé très qualifié peut convertir bien au-delà de ce qu'une moyenne prévoit.
    // Le repère s'affiche ; il n'interdit rien.
    expect(autoriseEnchere(4 * MICROS, 5 * MICROS).ok).toBe(true)
  })

  it('calcule un repère sur les nombres de la personne', () => {
    // À 22 CHF par vente et 5 % de conversion plausible, le clic ne peut pas dépasser 1.10.
    expect(plafondEnchere(22)).toBe(((22 * TAUX_PLAUSIBLE) / 100) * MICROS)
    // Sans objectif ni marge, on se tait plutôt que d'inventer une fourchette de marché.
    expect(plafondEnchere(0)).toBe(0)
  })
})

describe('la mécanique de la création', () => {
  it('crée les sept objets en un seul envoi indivisible', () => {
    /*
     * La leçon directe de l'image orpheline : créer l'un après l'autre marcherait
     * quatre-vingt-dix-neuf fois sur cent, et la centième laisserait un budget sans
     * campagne dans le compte de quelqu'un.
     */
    const source = readFileSync('src/server/ads/google-ads-ecriture.ts', 'utf8')
    const corps = source.slice(source.indexOf('export async function creerCampagneComplete'))
    expect(corps).toContain('googleAds:mutate')
    expect(corps).toContain('partialFailure: false')
  })

  it('naît en pause, sans réglage possible', () => {
    const source = readFileSync('src/server/ads/google-ads-ecriture.ts', 'utf8')
    const corps = source.slice(source.indexOf('export async function creerCampagneComplete'))
    const fin = corps.indexOf('export async function supprimerCampagne')
    expect(corps.slice(0, fin)).toContain("status: 'PAUSED'")
  })

  it('déclare l’absence de publicité politique, et le dit à l’écran', () => {
    /*
     * Google l'exige depuis la v21 : sans cette déclaration, la création entière est
     * refusée. Mais c'est une déclaration légale au nom de la personne, pas un réglage
     * technique — la poser en silence reviendrait à la faire signer sans la lui montrer.
     */
    const source = readFileSync('src/server/ads/google-ads-ecriture.ts', 'utf8')
    expect(source).toContain("containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING'")

    const ecran = readFileSync('src/components/studio/CreerCampagne.tsx', 'utf8')
    expect(ecran).toContain('publicité politique')
    expect(ecran).toContain('en votre nom')
  })

  it('coupe le Display, les partenaires, et l’intérêt géographique', () => {
    /*
     * Les trois réglages par lesquels un petit budget se vide sans qu'on comprenne. Le
     * défaut de Google est « présence ou intérêt » : l'annonce s'affiche pour quelqu'un
     * qui, depuis n'importe où, a manifesté de l'intérêt pour la Suisse.
     */
    const source = readFileSync('src/server/ads/google-ads-ecriture.ts', 'utf8')
    const corps = source.slice(source.indexOf('export async function creerCampagneComplete'))
    expect(corps).toContain('targetContentNetwork: false')
    expect(corps).toContain('targetPartnerSearchNetwork: false')
    expect(corps).toContain('targetSearchNetwork: false')
    expect(corps).toContain("positiveGeoTargetType: 'PRESENCE'")
  })

  it('ne lit le plan que depuis la base', () => {
    /*
     * Le navigateur ne transmet qu'un identifiant. Si le plan faisait l'aller-retour, il
     * suffirait d'une page modifiée pour créer une campagne avec un autre budget et une
     * autre adresse d'arrivée.
     */
    const route = readFileSync('src/app/api/ads/campagne/route.ts', 'utf8')
    /*
     * « Préparer » reçoit bien un budget et une adresse : c'est la personne qui les saisit,
     * et ils sont écrits en base après validation. C'est « créer » qui ne doit rien recevoir
     * d'autre qu'un identifiant — sans quoi une page modifiée créerait la campagne de son
     * choix à partir d'un plan que personne n'a relu.
     */
    expect(route).toContain("z.object({ action: z.literal('creer'), planId: z.string().uuid() })")
    expect(route).toContain('creerCampagne(user.id, demande.planId, hotes)')

    // Et rien du contenu du plan ne franchit la frontière au moment de créer.
    const creation = route.slice(route.indexOf("if (demande.action === 'creer')"))
    for (const champ of ['budget', 'titres', 'motsCles', 'urlFinale']) {
      expect(creation.slice(0, creation.indexOf('return ok({ ok: true, action'))).not.toContain(
        champ,
      )
    }
  })

  it('arrondit les montants là où ils naissent, pas seulement à l’envoi', () => {
    /*
     * Le connecteur d'écriture arrondit aussi, mais c'est un filet. S'y fier laisserait un
     * plan afficher 5,555 CHF pour une campagne créée à 5,56 — et ce que la personne relit
     * doit être exactement ce qui part chez Google.
     *
     * Ce test existe parce qu'une édition de cette règle avait silencieusement échoué : elle
     * était écrite dans le commit, absente du code, et tout marchait quand même grâce au
     * filet.
     */
    const route = readFileSync('src/app/api/ads/campagne/route.ts', 'utf8')
    expect(route).toContain('budgetMicros: auPasFacturable(')
    expect(route).not.toContain('budgetMicros: Math.round(')
    expect(route).not.toContain('enchere * 1_000_000)\n')
  })

  it('calcule les domaines permis côté serveur', () => {
    // Les demander au navigateur reviendrait à faire valider l'adresse d'arrivée par la
    // page qui la propose.
    const route = readFileSync('src/app/api/ads/campagne/route.ts', 'utf8')
    expect(route).toContain('const hotes = site === null ? [] : [site.site.host]')
  })

  it('supprime le budget avec la campagne au retour arrière', () => {
    // Le budget est un objet à part chez Google : il survivrait à la campagne qu'il servait.
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    expect(source).toContain('supprimerBudget(')
    expect(source).toContain('supprimerCampagne(')
  })

  it('compte les créations à part des autres gestes', () => {
    /*
     * Mêler les compteurs ferait refuser une création parce qu'on a ajouté cinq titres le
     * matin — ou, bien pire, l'inverse.
     */
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    const corps = source.slice(source.indexOf('async function campagnesAujourdhui'))
    expect(corps.slice(0, corps.indexOf('\n}\n'))).toContain("quoi: 'campagne'")
  })

  it('ne recompose pas un plan pour corriger un seul nombre', () => {
    /*
     * Recomposer referait rédiger l'annonce, donc coûterait des crédits pour rien. Fixer
     * l'enchère ne touche ni aux mots-clés ni aux textes.
     */
    const source = readFileSync('src/server/ads/creation.ts', 'utf8')
    const corps = source.slice(source.indexOf('export async function fixerEnchere'))
    const fin = corps.indexOf('\n}\n')
    const fonction = corps.slice(0, fin)
    expect(fonction).toContain('data: { enchereMicros:')
    for (const recalcul of ['proposerElementsAds', 'ideesDeMotsCles', 'lireRecherches']) {
      expect(fonction).not.toContain(recalcul)
    }
  })

  it('ne crée rien depuis le module de préparation', () => {
    // La préparation écrit en base et ne touche pas à Google. La séparation est la garantie.
    const source = readFileSync('src/server/ads/creation.ts', 'utf8')
    for (const ecriture of ['google-ads-ecriture', ':mutate', 'creerCampagneComplete']) {
      expect(source).not.toContain(ecriture)
    }
  })
})
