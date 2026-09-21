import type { IdeeMotCle } from './provider'
import type { ProfilAds } from './profil'

/**
 * Croiser ce qu'on obtient déjà gratuitement avec ce que ça coûterait de l'acheter.
 *
 * C'est le cœur de l'étape, et la raison pour laquelle elle ne pouvait pas se faire avec
 * Search Console seul. Search Console dit ce que les gens ont tapé **pour trouver ce
 * site-là** : une demande réelle, mais vue par le petit bout, et sans aucun prix. Le
 * planificateur de Google dit le volume du marché et la fourchette de coût par clic, mais
 * ignore tout de la position organique. L'un sans l'autre donne une liste plausible et
 * fausse.
 *
 * Trois décisions portent ce fichier.
 *
 * **Une requête déjà gagnée n'est pas un candidat.** Sortir en première position en
 * organique et payer pour la même recherche revient à acheter un clic qu'on a gratuitement.
 * C'est l'erreur la plus coûteuse qu'un croisement naïf produirait, et la plus invisible :
 * les chiffres de la campagne seraient bons, et le chiffre d'affaires identique.
 *
 * **Le coût est rapporté à ce que la personne peut se permettre.** « 2,10 CHF le clic » ne
 * dit rien à personne. « Il faudrait convertir un visiteur sur douze pour tenir votre
 * objectif de 25 CHF par vente » dit tout, et se vérifie.
 *
 * **Rien n'est décidé ici.** Ce module classe et explique ; il n'écrit nulle part et
 * n'appelle personne. C'est ce qui permet de le vérifier entièrement sans réseau ni base.
 */

/** Ce que Search Console sait d'une requête sur le site. */
export type RequeteSite = {
  texte: string
  /** La position moyenne dans les résultats naturels. */
  position: number
  impressions: number
  clics: number
}

/** Pourquoi ce mot-clé est dans la liste, en un mot. */
export type Verdict = 'occasion' | 'a-tester' | 'exigeante'

export type Candidat = {
  texte: string
  /** La position organique, ou 0 : la requête ne figure pas dans Search Console. */
  position: number
  impressions: number
  clics: number
  volume: number
  coutBasMicros: number
  coutHautMicros: number
  concurrence: string
  verdict: Verdict
  /** La phrase qui rend le candidat discutable plutôt qu'à prendre ou à laisser. */
  motif: string
}

const MICROS = 1_000_000

/**
 * Au-dessus de cette position, la requête est déjà gagnée sans payer.
 *
 * Trois, et non un : la première position organique capte l'essentiel des clics, mais la
 * deuxième et la troisième en captent assez pour qu'acheter la même recherche revienne
 * surtout à se racheter soi-même. C'est le seuil au-delà duquel la publicité ajoute
 * vraiment quelque chose.
 */
export const POSITION_GAGNEE = 3

/**
 * En dessous de ce nombre d'affichages sur la période, la requête est du bruit.
 *
 * Search Console rend des milliers de lignes vues une ou deux fois. Les proposer noierait
 * les vraies occasions sous une traîne qui n'apprend rien.
 */
export const IMPRESSIONS_MINIMALES = 30

/**
 * Le taux de conversion au-delà duquel un mot-clé devient invraisemblable.
 *
 * Cinq pour cent est déjà un très bon taux pour une boutique. Un mot-clé qui en exigerait
 * davantage pour tenir l'objectif n'est pas interdit — il est signalé, parce que la personne
 * connaît son marché mieux que ce seuil.
 */
export const TAUX_PLAUSIBLE = 5

/** Ce qu'on propose d'un coup. Au-delà, un groupe d'annonces cesse d'avoir un thème. */
export const CANDIDATS_MAX = 20

/**
 * Les marchés que Naya sait viser, et leur constante chez Google.
 *
 * L'identifiant suit une règle — deux mille plus le code ISO 3166 numérique du pays — mais
 * la table est écrite en toutes lettres plutôt que calculée : une erreur de calcul rendrait
 * les volumes d'un autre pays sans rien signaler, et personne ne s'en apercevrait avant de
 * voir la facture d'une campagne ciblée à côté.
 */
export const MARCHES: Record<string, { geo: string; nom: string }> = {
  che: { geo: 'geoTargetConstants/2756', nom: 'Suisse' },
  fra: { geo: 'geoTargetConstants/2250', nom: 'France' },
  bel: { geo: 'geoTargetConstants/2056', nom: 'Belgique' },
  lux: { geo: 'geoTargetConstants/2442', nom: 'Luxembourg' },
  deu: { geo: 'geoTargetConstants/2276', nom: 'Allemagne' },
  aut: { geo: 'geoTargetConstants/2040', nom: 'Autriche' },
  ita: { geo: 'geoTargetConstants/2380', nom: 'Italie' },
  esp: { geo: 'geoTargetConstants/2724', nom: 'Espagne' },
  prt: { geo: 'geoTargetConstants/2620', nom: 'Portugal' },
  nld: { geo: 'geoTargetConstants/2528', nom: 'Pays-Bas' },
  gbr: { geo: 'geoTargetConstants/2826', nom: 'Royaume-Uni' },
  usa: { geo: 'geoTargetConstants/2840', nom: 'États-Unis' },
  can: { geo: 'geoTargetConstants/2124', nom: 'Canada' },
}

/** Les langues, dans le vocabulaire de Google. Les codes sont les siens, pas des ISO. */
export const LANGUES: Record<string, { code: string; nom: string }> = {
  fr: { code: 'languageConstants/1002', nom: 'français' },
  en: { code: 'languageConstants/1000', nom: 'anglais' },
  de: { code: 'languageConstants/1001', nom: 'allemand' },
  it: { code: 'languageConstants/1004', nom: 'italien' },
  es: { code: 'languageConstants/1003', nom: 'espagnol' },
}

/**
 * Le marché à viser, choisi sur les chiffres et non sur une préférence.
 *
 * C'est le pays d'où viennent le plus d'affichages dans Search Console : le seul fait
 * disponible. `null` quand ce pays n'est pas dans la table — auquel cas l'écran le dit et
 * ne propose rien, plutôt que de rendre les volumes du monde entier pour une boutique qui
 * livre en Suisse.
 */
export function marcheDominant(
  pays: Array<{ code: string; impressions: number }>,
): { code: string; geo: string; nom: string } | null {
  let meilleur: { code: string; impressions: number } | null = null
  for (const ligne of pays) {
    if (meilleur === null || ligne.impressions > meilleur.impressions) meilleur = ligne
  }
  if (meilleur === null) return null
  const marche = MARCHES[meilleur.code.toLowerCase()]
  return marche === undefined ? null : { code: meilleur.code.toLowerCase(), ...marche }
}

/**
 * Ce qu'une vente peut coûter au maximum.
 *
 * L'objectif de coût par conversion quand il est renseigné ; sinon la marge brute du panier
 * moyen, qui est le point mort : au-delà, chaque vente supplémentaire perd de l'argent.
 * Zéro quand ni l'un ni l'autre n'est connu — et l'écran cesse alors de parler de
 * rentabilité plutôt que d'inventer un seuil.
 */
export function cpaAcceptable(profil: ProfilAds): number {
  if (profil.cpaCible > 0) return profil.cpaCible
  if (profil.panierMoyen > 0 && profil.margePourcent > 0) {
    return Math.round((profil.panierMoyen * profil.margePourcent) / 100)
  }
  return 0
}

/**
 * Le taux de conversion qu'il faudrait atteindre pour tenir l'objectif, en pourcentage.
 *
 * C'est la seule façon honnête de rendre un coût par clic parlant. « 2,10 CHF le clic » ne
 * dit rien ; « il faudrait convertir 8,4 % des visiteurs » se compare à ce que la personne
 * constate déjà sur sa boutique. `null` quand l'un des deux chiffres manque : mieux vaut ne
 * rien dire qu'un pourcentage calculé sur un objectif absent.
 */
export function tauxNecessaire(coutMicros: number, cpa: number): number | null {
  if (coutMicros <= 0 || cpa <= 0) return null
  return Math.round((100 * (coutMicros / MICROS)) / cpa * 10) / 10
}

/**
 * L'enchère à proposer pour un groupe neuf, en micros.
 *
 * La médiane du bas de fourchette des mots-clés retenus, plafonnée par ce que l'objectif
 * permet. Trois raisons à ces deux choix.
 *
 * **La médiane, et non la moyenne** : un seul mot-clé très disputé tirerait la moyenne vers
 * le haut et ferait payer son prix à tous les autres.
 *
 * **Le bas de fourchette, et non le haut** : c'est l'enchère minimale pour apparaître en
 * haut de page. On peut la monter en voyant les chiffres ; on ne récupère pas ce qu'on a
 * dépensé en démarrant trop haut.
 *
 * **Le plafond de l'objectif** : le prix du clic au-delà duquel il faudrait un taux de
 * conversion invraisemblable. Sans lui, une campagne pourrait démarrer sur une enchère que
 * la marge ne peut pas absorber, et les chiffres mettraient trois semaines à le dire.
 */
export function enchereProposee(
  motsCles: ReadonlyArray<{ coutBasMicros: number }>,
  cpa: number,
): number {
  const prix = motsCles
    .map((mot) => mot.coutBasMicros)
    .filter((montant) => montant > 0)
    .sort((une, autre) => une - autre)

  /*
   * Aucun prix connu — le planificateur n'a rien rendu. On ne devine pas : l'appelant
   * demandera le montant à la personne plutôt qu'inventer un chiffre qui aurait l'air
   * calculé.
   */
  if (prix.length === 0) return 0

  const milieu = Math.floor(prix.length / 2)
  const mediane =
    prix.length % 2 === 1
      ? (prix[milieu] ?? 0)
      : ((prix[milieu - 1] ?? 0) + (prix[milieu] ?? 0)) / 2

  if (cpa <= 0) return Math.round(mediane)
  const plafond = (cpa * TAUX_PLAUSIBLE) / 100 * MICROS
  return Math.round(Math.min(mediane, plafond))
}

/** Une clé de comparaison : les accents et la casse ne font pas deux mots-clés différents. */
function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Un montant en micros, écrit comme on l'écrit sur une facture. */
function montant(micros: number, devise: string): string {
  return `${(micros / MICROS).toFixed(2)} ${devise}`
}

function phrase(
  candidat: Omit<Candidat, 'motif' | 'verdict'>,
  taux: number | null,
  cpa: number,
  devise: string,
): string {
  const morceaux: string[] = []
  if (candidat.position > 0) {
    morceaux.push(
      `Position ${candidat.position} dans les résultats naturels, ${candidat.impressions} affichages sur 28 jours`,
    )
  }
  if (candidat.volume > 0) morceaux.push(`${candidat.volume} recherches par mois`)
  if (candidat.coutHautMicros > 0) {
    morceaux.push(
      `${montant(candidat.coutBasMicros, devise)} à ${montant(candidat.coutHautMicros, devise)} le clic`,
    )
  }
  if (taux !== null) {
    morceaux.push(
      `il faudrait convertir ${String(taux).replace('.', ',')} % des visiteurs pour tenir ${cpa} ${devise} par vente`,
    )
  }
  if (morceaux.length === 0) return 'Google ne donne ni volume ni prix pour cette recherche.'
  return `${morceaux.join(' · ')}.`
}

/**
 * Le croisement proprement dit.
 *
 * `dejaPresents` sont les mots-clés que le groupe porte déjà, chez Google ou en attente de
 * dépôt : les reproposer ferait cliquer sur un bouton qui ne peut qu'échouer.
 *
 * Le second membre du retour compte les requêtes écartées parce qu'elles sont déjà gagnées
 * en organique. Ce nombre est affiché : c'est une bonne nouvelle, pas un filtre silencieux,
 * et il explique pourquoi une requête que la personne voit dans ses chiffres n'apparaît pas
 * dans la liste.
 */
export function croiser(
  requetes: RequeteSite[],
  idees: IdeeMotCle[],
  dejaPresents: string[],
  cpa: number,
  devise: string,
): { candidats: Candidat[]; dejaGagnees: number } {
  const exclus = new Set(dejaPresents.map(normaliser))
  const parTexte = new Map(idees.map((idee) => [normaliser(idee.texte), idee]))
  const retenus = new Set<string>()
  const candidats: Candidat[] = []
  let dejaGagnees = 0

  const ajouter = (
    brut: Omit<Candidat, 'motif' | 'verdict'>,
    verdict: Verdict,
  ): void => {
    const taux = tauxNecessaire(brut.coutHautMicros, cpa)
    const exigeante = taux !== null && taux > TAUX_PLAUSIBLE
    candidats.push({
      ...brut,
      verdict: exigeante ? 'exigeante' : verdict,
      motif: phrase(brut, taux, cpa, devise),
    })
  }

  for (const requete of requetes) {
    const cle = normaliser(requete.texte)
    if (cle === '' || exclus.has(cle) || retenus.has(cle)) continue
    /*
     * Marqué vu quoi qu'il advienne, y compris quand la requête est écartée. C'est la
     * correction d'un vrai défaut : sans cette ligne, une requête déjà gagnée ressortait
     * par la seconde boucle, celle du planificateur — qui la connaît aussi — et se
     * retrouvait proposée à l'achat avec « position 0 », c'est-à-dire en affirmant que le
     * site ne sort pas dessus. Le contraire exact de ce qu'on venait de constater.
     */
    retenus.add(cle)
    const idee = parTexte.get(cle)
    const mesures = {
      volume: idee?.volume ?? 0,
      coutBasMicros: idee?.coutBasMicros ?? 0,
      coutHautMicros: idee?.coutHautMicros ?? 0,
      concurrence: idee?.concurrence ?? '',
    }

    /*
     * Déjà gagnée : on sort en tête sans payer. Acheter la même recherche rachèterait un
     * clic qu'on obtient gratuitement — l'erreur la plus coûteuse d'un croisement naïf, et
     * la plus invisible, puisque la campagne afficherait de bons chiffres.
     */
    if (requete.position > 0 && requete.position <= POSITION_GAGNEE) {
      dejaGagnees += 1
      continue
    }

    /*
     * Peu vue sur ce site : ce n'est pas une occasion constatée. Mais si le marché la
     * cherche, c'est que le site n'y est tout simplement pas — ce qui est un candidat
     * légitime, à condition de le présenter comme tel et avec sa vraie position.
     */
    if (requete.impressions < IMPRESSIONS_MINIMALES) {
      if (mesures.volume <= 0) continue
      ajouter(
        {
          texte: requete.texte.trim(),
          position: requete.position,
          impressions: requete.impressions,
          clics: requete.clics,
          ...mesures,
        },
        'a-tester',
      )
      continue
    }

    ajouter(
      {
        texte: requete.texte.trim(),
        position: requete.position,
        impressions: requete.impressions,
        clics: requete.clics,
        ...mesures,
      },
      'occasion',
    )
  }

  for (const idee of idees) {
    const cle = normaliser(idee.texte)
    if (cle === '' || exclus.has(cle) || retenus.has(cle)) continue
    // Sans volume, l'idée ne repose sur rien : ni demande constatée, ni marché mesuré.
    if (idee.volume <= 0) continue
    retenus.add(cle)
    ajouter(
      {
        texte: idee.texte.trim(),
        position: 0,
        impressions: 0,
        clics: 0,
        volume: idee.volume,
        coutBasMicros: idee.coutBasMicros,
        coutHautMicros: idee.coutHautMicros,
        concurrence: idee.concurrence,
      },
      'a-tester',
    )
  }

  /*
   * Les occasions d'abord — une demande constatée vaut mieux qu'un volume de marché — puis
   * ce qui reste à tester, et enfin ce qui coûterait cher. À rang égal, le plus vu passe
   * devant : c'est là que la dépense a le plus de chances de rencontrer quelqu'un.
   */
  const rang: Record<Verdict, number> = { occasion: 0, 'a-tester': 1, exigeante: 2 }
  candidats.sort((une, autre) => {
    if (rang[une.verdict] !== rang[autre.verdict]) return rang[une.verdict] - rang[autre.verdict]
    const poidsUne = une.impressions > 0 ? une.impressions : une.volume
    const poidsAutre = autre.impressions > 0 ? autre.impressions : autre.volume
    return poidsAutre - poidsUne
  })

  return { candidats: candidats.slice(0, CANDIDATS_MAX), dejaGagnees }
}
