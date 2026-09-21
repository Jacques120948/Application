import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CANDIDATS_MAX,
  cpaAcceptable,
  croiser,
  IMPRESSIONS_MINIMALES,
  LANGUES,
  MARCHES,
  langueDominante,
  marcheDominant,
  marcheDuProfil,
  POSITION_GAGNEE,
  TAUX_PLAUSIBLE,
  tauxNecessaire,
} from '@/server/ads/mots-cles'
import { autoriseMotCle, MOTS_CLES_PAR_GROUPE, TEXTES_PAR_JOUR } from '@/server/ads/garde-fous'
import { PROFIL_VIDE } from '@/server/ads/profil'

/**
 * Le croisement entre ce qu'on gagne déjà gratuitement et ce que ça coûterait de l'acheter.
 *
 * L'erreur que tout ce fichier existe pour empêcher est invisible à l'usage : acheter une
 * recherche où le site sort déjà premier en organique. La campagne afficherait de bons
 * chiffres, le chiffre d'affaires serait identique, et la facture bien réelle.
 */

const MICROS = 1_000_000

function idee(texte: string, champs: { volume?: number; bas?: number; haut?: number } = {}) {
  return {
    texte,
    volume: champs.volume ?? 100,
    concurrence: 'MEDIUM',
    coutBasMicros: (champs.bas ?? 0.5) * MICROS,
    coutHautMicros: (champs.haut ?? 1) * MICROS,
  }
}

function requete(texte: string, position: number, impressions = 200, langue = 'fr') {
  return { texte, position, impressions, clics: 4, langue }
}

describe('le croisement', () => {
  it('n’achète pas une recherche déjà gagnée en organique', () => {
    /*
     * L'erreur la plus coûteuse d'un croisement naïf, et la plus invisible : on paierait
     * un clic qu'on obtient gratuitement, et tous les indicateurs de la campagne seraient
     * bons.
     */
    const issue = croiser(
      [requete('bougie citrine', 1), requete('bougie quartz rose', 14)],
      [idee('bougie citrine'), idee('bougie quartz rose')],
      [],
      50,
      'CHF',
    )
    expect(issue.candidats.map((un) => un.texte)).toEqual(['bougie quartz rose'])
    expect(issue.dejaGagnees).toBe(1)
  })

  it('compte les écartées plutôt que de les taire', () => {
    // C'est une bonne nouvelle, pas un filtre silencieux : sans ce nombre, une requête bien
    // visible dans les chiffres disparaîtrait de la liste sans explication.
    const issue = croiser([requete('a', 1), requete('b', 2), requete('c', 3)], [], [], 0, 'CHF')
    expect(issue.dejaGagnees).toBe(3)
    expect(issue.candidats).toHaveLength(0)
  })

  it('laisse passer la position juste au-delà du seuil', () => {
    const issue = croiser([requete('bougie ambre', POSITION_GAGNEE + 1)], [], [], 0, 'CHF')
    expect(issue.candidats).toHaveLength(1)
  })

  it('écarte la traîne qui n’apprend rien', () => {
    const issue = croiser(
      [requete('bougie rare', 15, IMPRESSIONS_MINIMALES - 1)],
      [],
      [],
      0,
      'CHF',
    )
    expect(issue.candidats).toHaveLength(0)
  })

  it('ne repropose pas ce que le groupe porte déjà', () => {
    // Les accents et la casse ne font pas deux mots-clés différents : Google les traiterait
    // comme un doublon et refuserait le dépôt.
    const issue = croiser(
      [requete('Bougie Citrine Parfumée', 12)],
      [idee('bougie citrine parfumee')],
      ['bougie citrine parfumee'],
      0,
      'CHF',
    )
    expect(issue.candidats).toHaveLength(0)
  })

  it('propose aussi ce que le marché tape et que le site ignore', () => {
    const issue = croiser([], [idee('bougie pierre naturelle', { volume: 800 })], [], 0, 'CHF')
    expect(issue.candidats[0]?.verdict).toBe('a-tester')
    expect(issue.candidats[0]?.position).toBe(0)
  })

  it('n’invente pas une idée sans volume', () => {
    // Ni demande constatée, ni marché mesuré : la proposition ne reposerait sur rien.
    const issue = croiser([], [idee('bougie introuvable', { volume: 0 })], [], 0, 'CHF')
    expect(issue.candidats).toHaveLength(0)
  })

  it('signale ce qui exigerait un taux de conversion invraisemblable', () => {
    /*
     * Ce n'est pas un refus : la personne connaît son marché mieux que ce seuil. C'est un
     * signal, et il porte le chiffre qui permet d'en juger.
     */
    const issue = croiser([requete('bougie luxe', 12)], [idee('bougie luxe', { haut: 5 })], [], 25, 'CHF')
    expect(issue.candidats[0]?.verdict).toBe('exigeante')
    expect(issue.candidats[0]?.motif).toContain('%')
  })

  it('fait passer une occasion constatée devant un volume de marché', () => {
    const issue = croiser(
      [requete('bougie citrine', 12, 50)],
      [idee('bougie citrine'), idee('bougie parfumee', { volume: 90_000 })],
      [],
      0,
      'CHF',
    )
    expect(issue.candidats[0]?.texte).toBe('bougie citrine')
  })

  it('borne ce qu’il propose d’un coup', () => {
    const beaucoup = Array.from({ length: CANDIDATS_MAX + 10 }, (_, rang) =>
      requete(`bougie ${rang}`, 12),
    )
    expect(croiser(beaucoup, [], [], 0, 'CHF').candidats).toHaveLength(CANDIDATS_MAX)
  })
})

describe('l’intention derrière la recherche', () => {
  it('signale une recherche d’information, si beaux que soient ses chiffres', () => {
    /*
     * Le cas réel : « diaspro rosso proprietà », mille affichages, un clic à trois
     * centimes. Tous les indicateurs au vert — et des gens qui cherchent les vertus d'une
     * pierre, pas une bougie suisse. Le classement d'intention existait déjà pour les
     * articles ; il n'était pas branché ici.
     */
    const issue = croiser(
      [requete('diaspro rosso proprietà', 5.8, 1056, 'it')],
      [idee('diaspro rosso proprietà', { volume: 3600, bas: 0.03, haut: 0.56 })],
      [],
      20,
      'CHF',
    )
    expect(issue.candidats[0]?.verdict).toBe('informative')
    expect(issue.candidats[0]?.motif).toContain('pas à acheter')
  })

  it('ne signale pas une requête qui ne dit rien de son intention', () => {
    /*
     * Choix délibéré, et il a coûté une correction. Le classement général range en
     * « information » tout ce qui ne porte aucun marqueur : appliqué ici, il étiquetait
     * « bougie citrine » et « diaspro rosso » comme des curieux. Un avertissement sur
     * presque tout devient du bruit qu'on apprend à ignorer, et il aurait alors masqué les
     * vrais cas. On préfère se taire : personne ne peut dire si « diaspro rosso » cherche
     * une pierre à acheter ou son histoire.
     */
    for (const texte of ['diaspro rosso', 'bougie citrine', 'quartz rose']) {
      const issue = croiser([requete(texte, 12)], [], [], 0, 'CHF')
      expect(issue.candidats[0]?.verdict).not.toBe('informative')
    }
  })

  it('laisse passer une intention d’achat', () => {
    const issue = croiser([requete('acheter bougie citrine', 12)], [], [], 0, 'CHF')
    expect(issue.candidats[0]?.verdict).toBe('occasion')
    expect(issue.candidats[0]?.intention).toBe('achat')
  })

  it('reconnaît l’achat dans les quatre langues du site', () => {
    // « comprare » et « kaufen » comptent autant qu'« acheter » : une boutique suisse
    // reçoit les trois, et n'en reconnaître qu'une rangerait les autres en information.
    for (const texte of ['comprare diaspro rosso', 'kerzen kaufen', 'acheter bougie']) {
      const issue = croiser([requete(texte, 12)], [], [], 0, 'CHF')
      expect(issue.candidats[0]?.intention).toBe('achat')
    }
  })

  it('signale sans exclure, et range l’information en dernier', () => {
    const issue = croiser(
      [requete('vertus du jaspe', 12, 5000), requete('acheter jaspe', 12, 100)],
      [],
      [],
      0,
      'CHF',
    )
    expect(issue.candidats).toHaveLength(2)
    expect(issue.candidats[0]?.texte).toBe('acheter jaspe')
    expect(issue.candidats[1]?.texte).toBe('vertus du jaspe')
  })
})

describe('la langue de la recherche', () => {
  it('voyage jusqu’au candidat', () => {
    /*
     * Lue sur la page qui sert la requête, jamais devinée sur les mots. Un mot-clé italien
     * déposé dans un groupe d'annonces français ferait voir aux gens une annonce dans une
     * langue qu'ils n'ont pas cherchée.
     */
    const issue = croiser([requete('diaspro rosso proprietà', 12, 1056, 'it')], [], [], 0, 'CHF')
    expect(issue.candidats[0]?.langue).toBe('it')
    expect(issue.candidats[0]?.motif).toContain('en italien')
  })

  it('n’invente pas de langue pour une idée du planificateur', () => {
    // Elle ne vient d'aucune page du site : l'inconnue est assumée plutôt que devinée.
    const issue = croiser([], [idee('kerzen kaufen', { volume: 500 })], [], 0, 'CHF')
    expect(issue.candidats[0]?.langue).toBe('')
  })
})

describe('le coût rapporté à ce qu’on peut se permettre', () => {
  it('traduit un prix par clic en taux de conversion nécessaire', () => {
    // « 2,50 CHF le clic » ne dit rien ; « il faudrait convertir 10 % des visiteurs » se
    // compare à ce que la personne constate déjà sur sa boutique.
    expect(tauxNecessaire(2.5 * MICROS, 25)).toBe(10)
  })

  it('ne dit rien plutôt qu’un chiffre calculé sur un objectif absent', () => {
    expect(tauxNecessaire(2.5 * MICROS, 0)).toBeNull()
    expect(tauxNecessaire(0, 25)).toBeNull()
  })

  it('prend l’objectif quand il existe, le point mort sinon', () => {
    expect(cpaAcceptable({ ...PROFIL_VIDE, cpaCible: 30 })).toBe(30)
    // 40 CHF de panier à 55 % de marge : au-delà de 22 CHF, la vente perd de l'argent.
    expect(cpaAcceptable({ ...PROFIL_VIDE, panierMoyen: 40, margePourcent: 55 })).toBe(22)
    expect(cpaAcceptable({ ...PROFIL_VIDE })).toBe(0)
  })

  it('garde un seuil de vraisemblance discutable, pas définitif', () => {
    expect(TAUX_PLAUSIBLE).toBeGreaterThan(0)
    expect(TAUX_PLAUSIBLE).toBeLessThan(20)
  })
})

describe('le pays où l’on vend', () => {
  it('lit le profil avant les chiffres', () => {
    /*
     * La faute que ce test existe pour empêcher : une boutique suisse s'est vu proposer
     * une campagne ciblant l'Italie, parce que ses pages italiennes reçoivent plus
     * d'affichages que ses pages françaises. Le pays d'où viennent les curieux n'est pas
     * celui où l'on vend — et depuis la Suisse, vendre en Italie veut dire des frais de
     * douane sur chaque colis.
     */
    expect(marcheDuProfil('Suisse')?.code).toBe('che')
    expect(marcheDuProfil('Suisse')?.geo).toBe('geoTargetConstants/2756')
  })

  it('accepte les façons ordinaires d’écrire un pays', () => {
    // Le champ est une phrase libre : quelqu'un y écrit « CH », « Schweiz » ou « Svizzera ».
    for (const ecriture of ['suisse', 'SUISSE', ' Suisse ', 'CH', 'Schweiz', 'Svizzera']) {
      expect(marcheDuProfil(ecriture)?.code).toBe('che')
    }
  })

  it('ne devine pas un pays qu’elle ne reconnaît pas', () => {
    // Mieux vaut retomber sur les chiffres, et le dire, que de viser au hasard.
    expect(marcheDuProfil('')).toBeNull()
    expect(marcheDuProfil('quelque part en Europe')).toBeNull()
  })
})

describe('la langue de la campagne', () => {
  it('suit la demande, pas l’écran', () => {
    /*
     * Un site suisse en sert trois. Décider sur la langue de l'interface ferait une
     * campagne française pour une demande italienne : des annonces que le bon public ne
     * comprend pas, et des impressions dépensées quand même.
     */
    expect(
      langueDominante([
        requete('bougie citrine', 12, 200, 'fr'),
        requete('candela diaspro rosso', 12, 900, 'it'),
        requete('kerzen quarz', 12, 100, 'de'),
      ]),
    ).toBe('it')
  })

  it('compte les affichages, pas le nombre de requêtes', () => {
    // Dix requêtes vues trois fois pèsent moins qu'une requête vue mille fois.
    expect(
      langueDominante([
        requete('un', 12, 3, 'fr'),
        requete('deux', 12, 3, 'fr'),
        requete('tre', 12, 900, 'it'),
      ]),
    ).toBe('it')
  })

  it('ne tranche pas quand aucune langue n’est connue', () => {
    // L'appelant retient alors celle de l'écran — un repli, pas une déduction.
    expect(langueDominante([requete('bougie', 12, 200, '')])).toBeNull()
    expect(langueDominante([])).toBeNull()
  })
})

describe('le marché visé', () => {
  it('se constate sur les chiffres, il ne se saisit pas', () => {
    const marche = marcheDominant([
      { code: 'fra', impressions: 80 },
      { code: 'che', impressions: 900 },
    ])
    expect(marche?.nom).toBe('Suisse')
    expect(marche?.geo).toBe('geoTargetConstants/2756')
  })

  it('refuse un pays inconnu plutôt que de lire le monde entier', () => {
    /*
     * Un volume de recherche sans pays est vrai et inutilisable. Rendre les chiffres du
     * monde entier pour une boutique suisse donnerait des prix qui n'ont aucun rapport.
     */
    expect(marcheDominant([{ code: 'zzz', impressions: 900 }])).toBeNull()
    expect(marcheDominant([])).toBeNull()
  })

  it('suit la règle des identifiants de pays de Google', () => {
    // Deux mille plus le code ISO 3166 numérique. La table est écrite plutôt que calculée,
    // mais elle doit rester cohérente : une erreur ici viserait un autre pays en silence.
    for (const [iso, attendu] of [
      ['che', 2756],
      ['fra', 2250],
      ['deu', 2276],
      ['ita', 2380],
    ] as const) {
      expect(MARCHES[iso]?.geo).toBe(`geoTargetConstants/${attendu}`)
    }
  })

  it('connaît les langues dans le vocabulaire de Google', () => {
    expect(LANGUES.fr?.code).toBe('languageConstants/1002')
    expect(LANGUES.de?.code).toBe('languageConstants/1001')
  })
})

function demande(champs: Record<string, unknown> = {}) {
  return {
    mode: 'assiste',
    devise: 'CHF',
    profil: { ...PROFIL_VIDE },
    faitesAujourdhui: 0,
    textesAujourdhui: 0,
    ...champs,
  } as Parameters<typeof autoriseMotCle>[0]
}

describe('les bornes d’un dépôt de mot-clé', () => {
  it('refusent la correspondance large', () => {
    /*
     * La décision la plus conséquente de ces bornes. Sur un budget de quelques francs par
     * jour, la correspondance large le dépense en un matin sur des recherches voisines que
     * personne n'a validées.
     */
    const verdict = autoriseMotCle(demande(), 'bougie citrine', 'large', 0)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.raison).toContain('large')
    expect(autoriseMotCle(demande(), 'bougie citrine', 'phrase', 0).ok).toBe(true)
    expect(autoriseMotCle(demande(), 'bougie citrine', 'exact', 0).ok).toBe(true)
  })

  it('refusent un compte en lecture seule', () => {
    expect(autoriseMotCle(demande({ mode: 'lecture' }), 'bougie', 'phrase', 0).ok).toBe(false)
  })

  it('refusent les guillemets dans le texte', () => {
    /*
     * Google accepte les deux écritures de la correspondance. Un texte qui porte déjà ses
     * guillemets se retrouve acheté guillemets compris : un mot-clé qui ne correspond à
     * aucune recherche, et qui ne dépense rien en paraissant actif.
     */
    expect(autoriseMotCle(demande(), '"bougie citrine"', 'phrase', 0).ok).toBe(false)
    expect(autoriseMotCle(demande(), '[bougie citrine]', 'exact', 0).ok).toBe(false)
  })

  it('refusent ce que Google refuserait', () => {
    expect(autoriseMotCle(demande(), 'a'.repeat(81), 'phrase', 0).ok).toBe(false)
    expect(autoriseMotCle(demande(), 'un deux trois quatre cinq six sept huit neuf dix onze', 'phrase', 0).ok).toBe(
      false,
    )
    expect(autoriseMotCle(demande(), '   ', 'phrase', 0).ok).toBe(false)
  })

  it('refusent un groupe qui a perdu son thème', () => {
    const verdict = autoriseMotCle(demande(), 'bougie', 'phrase', MOTS_CLES_PAR_GROUPE)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.raison).toContain('thème')
  })

  it('partagent le compteur quotidien des dépôts', () => {
    expect(
      autoriseMotCle(demande({ textesAujourdhui: TEXTES_PAR_JOUR }), 'bougie', 'phrase', 0).ok,
    ).toBe(false)
  })
})

describe('la mécanique du dépôt de mot-clé', () => {
  it('relit le groupe chez Google avant d’écrire', () => {
    // Pour compter — notre base a une semaine — et pour le doublon, que Google refuse sans
    // dire lequel.
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    const corps = source.slice(source.indexOf('export async function deposerMotCle'))
    const lecture = corps.indexOf('lireMotsClesDuGroupe')
    const ecriture = corps.indexOf('creerMotCle(')
    expect(lecture).toBeGreaterThan(0)
    expect(ecriture).toBeGreaterThan(lecture)
  })

  it('retire le critère au retour arrière, il ne le met pas en pause', () => {
    /*
     * Un critère en pause reste dans le groupe et continue d'apparaître dans tous les
     * rapports. Retiré, il n'y est plus.
     */
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    expect(source).toContain('retirerMotCle(')
    expect(source).toContain('critere: true, critereId')
  })

  it('n’atteint jamais la correspondance large depuis le connecteur', () => {
    const source = readFileSync('src/server/ads/google-ads-ecriture.ts', 'utf8')
    const corps = source.slice(source.indexOf('export async function creerMotCle'))
    const fin = corps.indexOf('export async function retirerMotCle')
    expect(corps.slice(0, fin)).not.toContain("'BROAD'")
  })

  it('compte tous les dépôts dans la borne quotidienne', () => {
    /*
     * Le compteur en oubliait trois — titres longs, images, mots-clés — ce qui rendait la
     * borne franchissable en changeant simplement de type d'élément.
     */
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    for (const champ of ['titre', 'titre-long', 'description', 'image', 'mot-cle']) {
      expect(source).toContain(`'${champ}', `)
    }
  })

  it('ne cherche des mots-clés que pour une campagne Recherche', () => {
    // Une Performance Max choisit elle-même où diffuser : lui proposer des mots-clés
    // donnerait un bouton qui ne peut qu'échouer.
    const source = readFileSync('src/server/ads/ciblage.ts', 'utf8')
    expect(source).toContain("groupe.genre !== 'annonces'")
  })

  it('ne propose rien sans Search Console', () => {
    /*
     * Ce n'est pas une source d'appoint ici, c'est la source principale : sans elle, le
     * planificateur proposerait d'acheter des recherches déjà gagnées gratuitement.
     */
    const source = readFileSync('src/server/ads/ciblage.ts', 'utf8')
    expect(source).toContain('origin === null')
  })

  it('ne fait appel à aucun modèle', () => {
    // Deux lectures et un calcul : facturer des crédits pour ça serait facturer du vent.
    const source = readFileSync('src/server/ads/ciblage.ts', 'utf8')
    for (const modele of ['runSingleCall', '@/server/ai/', 'anthropic']) {
      expect(source).not.toContain(modele)
    }
  })
})
