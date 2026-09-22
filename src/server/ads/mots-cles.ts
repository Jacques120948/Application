import { auPasFacturable } from '@/lib/pas-facturable'
import { chercheASavoir, classer, type Intention } from '@/server/audit/intentions'
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
  /**
   * La langue de la requête, lue sur la page qui la sert. Vide quand elle est inconnue.
   *
   * Un site suisse en sert trois, et c'est la donnée qui manquait le plus : les volumes et
   * les prix n'ont de sens que demandés dans la bonne langue, et un mot-clé italien déposé
   * dans un groupe d'annonces français ferait voir aux gens une annonce dans une langue
   * qu'ils n'ont pas cherchée.
   */
  langue: string
}

/** Pourquoi ce mot-clé est dans la liste, en un mot. */
export type Verdict = 'occasion' | 'a-tester' | 'exigeante' | 'informative'

export type Candidat = {
  texte: string
  /** La langue de la requête, quand elle est connue. Vide sinon. */
  langue: string
  /**
   * Ce que la personne voulait : acheter, comparer, trouver près de chez elle, comprendre.
   *
   * Le classement existait déjà pour choisir les sujets d'articles ; il manquait ici, et
   * c'est ce qui faisait proposer « diaspro rosso » — trois mille six cents recherches par
   * mois, un clic à trois centimes, et des gens qui cherchent les vertus d'une pierre, pas
   * une bougie. Les chiffres étaient bons ; l'intention ne l'était pas.
   */
  intention: Intention
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
 * La langue dans laquelle une campagne doit être faite, choisie sur la demande.
 *
 * Celle qui rassemble le plus d'affichages, et non celle de l'écran. Un site suisse en sert
 * trois : décider sur la langue de l'interface ferait une campagne française pour une
 * demande italienne — des annonces que personne du bon public ne comprend, et des
 * impressions dépensées quand même.
 *
 * Une campagne ne peut en porter qu'une. Mélanger les langues dans un seul groupe
 * d'annonces revient à montrer le même texte à tout le monde : les uns le lisent, les autres
 * passent, et la moitié du budget part en affichages sans clic. Le jour où le trafic d'une
 * seconde langue le justifie, elle mérite sa propre campagne — pas une place dans celle-ci.
 *
 * `null` quand aucune requête ne porte de langue connue : l'appelant retient alors celle de
 * l'écran, ce qui est un repli et non une déduction.
 */
export function langueDominante(requetes: ReadonlyArray<RequeteSite>): string | null {
  const poids = new Map<string, number>()
  for (const requete of requetes) {
    if (requete.langue === '') continue
    poids.set(requete.langue, (poids.get(requete.langue) ?? 0) + requete.impressions)
  }

  let meilleure: string | null = null
  let sommet = 0
  for (const [langue, total] of poids) {
    if (total > sommet) {
      sommet = total
      meilleure = langue
    }
  }
  return meilleure
}

/**
 * Les façons d'écrire un pays, vers son code.
 *
 * Le champ « pays » du profil publicitaire est une phrase libre : quelqu'un y écrit
 * « Suisse », « CH », « Schweiz » ou « Suisse romande ». Une table de noms vaut mieux qu'un
 * appel à un modèle — c'est instantané, gratuit, et quelqu'un qui conteste le pays retenu
 * peut voir exactement ce qui l'a produit.
 */
const NOMS_DE_PAYS: Record<string, string> = {
  suisse: 'che', ch: 'che', schweiz: 'che', svizzera: 'che', switzerland: 'che',
  helvetia: 'che', 'suisse romande': 'che',
  france: 'fra', fr: 'fra', belgique: 'bel', be: 'bel', belgium: 'bel',
  luxembourg: 'lux', lu: 'lux',
  allemagne: 'deu', de: 'deu', deutschland: 'deu', germany: 'deu',
  autriche: 'aut', at: 'aut', osterreich: 'aut',
  italie: 'ita', it: 'ita', italia: 'ita', italy: 'ita',
  espagne: 'esp', es: 'esp', espana: 'esp', spain: 'esp',
  portugal: 'prt', pt: 'prt',
  'pays-bas': 'nld', nl: 'nld', nederland: 'nld',
  'royaume-uni': 'gbr', uk: 'gbr', gb: 'gbr', 'united kingdom': 'gbr', angleterre: 'gbr',
  'etats-unis': 'usa', usa: 'usa', us: 'usa', 'united states': 'usa',
  canada: 'can', ca: 'can',
}

/**
 * Le marché déclaré dans le profil publicitaire, ou `null`.
 *
 * C'est la source qui doit primer, et l'avoir oubliée a produit une vraie faute : une
 * boutique suisse s'est vu proposer une campagne ciblant l'Italie, parce que ses pages
 * italiennes reçoivent plus d'affichages que ses pages françaises. Le pays d'où viennent
 * les curieux n'est pas celui où l'on vend — et pour une boutique suisse, vendre en Italie
 * veut dire des frais de douane sur chaque colis.
 *
 * Les chiffres restent le repli quand le profil est vide : mieux vaut un pays constaté
 * qu'aucun pays du tout.
 */
export function marcheDuProfil(pays: string): { code: string; geo: string; nom: string } | null {
  const propre = pays
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
  if (propre === '') return null

  const code = NOMS_DE_PAYS[propre] ?? NOMS_DE_PAYS[propre.replace(/[^a-z ]/gu, '')]
  if (code === undefined) return null
  const marche = MARCHES[code]
  return marche === undefined ? null : { code, ...marche }
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
 * Le coût par clic au-delà duquel l'objectif devient invraisemblable, en micros.
 *
 * C'est le même calcul que `tauxNecessaire`, pris dans l'autre sens : à quel prix du clic
 * faudrait-il convertir plus de visiteurs qu'une boutique n'en convertit ? Zéro quand
 * l'objectif est inconnu — auquel cas l'écran se tait plutôt que d'afficher un repère qui
 * n'en est pas un.
 *
 * Ce n'est pas une interdiction. La personne connaît son marché mieux que ce seuil, et un
 * mot-clé très qualifié peut convertir bien au-delà. C'est un repère chiffré sur ses propres
 * nombres, ce qui vaut mieux qu'une fourchette de marché dont personne ne sait d'où elle
 * sort.
 */
export function plafondEnchere(cpa: number): number {
  if (cpa <= 0) return 0
  return auPasFacturable(((cpa * TAUX_PLAUSIBLE) / 100) * MICROS)
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
/** En dessous de ce nombre de prix connus, la médiane ne décrit rien et on se tait. */
export const PRIX_MINIMUM_CONNUS = 3

export function enchereProposee(
  motsCles: ReadonlyArray<{ coutBasMicros: number; coutHautMicros: number }>,
  cpa: number,
): number {
  /*
   * Le milieu de la fourchette, et non son bas. J'avais pris le bas en me disant qu'on
   * pouvait monter en voyant les chiffres : c'est faux, à un centime il n'y a rien à voir.
   * Le « bas de fourchette » de Google est le minimum pour apparaître *parfois* en haut de
   * page — un plancher, pas une enchère de travail. Une campagne qui démarre dessus ne
   * s'affiche jamais, et son silence passe pour une panne.
   */
  const prix = motsCles
    .map((mot) =>
      mot.coutHautMicros > 0 ? (mot.coutBasMicros + mot.coutHautMicros) / 2 : mot.coutBasMicros,
    )
    .filter((montant) => montant > 0)
    .sort((une, autre) => une - autre)

  /*
   * En dessous de trois prix connus, la médiane ne décrit rien. Un plan où quatre mots sur
   * douze ont un prix a rendu trois centimes : vrai pour ces quatre-là, et inexploitable —
   * à ce niveau, Google sert ceux qui enchérissent plus et la campagne ne s'affiche jamais.
   * Mieux vaut demander le montant que d'en proposer un qui ne diffusera pas.
   */
  if (prix.length < PRIX_MINIMUM_CONNUS) return 0

  /*
   * Aucun prix connu — le planificateur n'a rien rendu. On ne devine pas : l'appelant
   * demandera le montant à la personne plutôt qu'inventer un chiffre qui aurait l'air
   * calculé.
   */
  const milieu = Math.floor(prix.length / 2)
  const mediane =
    prix.length % 2 === 1
      ? (prix[milieu] ?? 0)
      : ((prix[milieu - 1] ?? 0) + (prix[milieu] ?? 0)) / 2

  const plafond = plafondEnchere(cpa)
  /*
   * Arrondie au centime : Google refuse un montant qui n'est pas un multiple de l'unité
   * facturable, et une médiane ne tombe pas sur un centime rond.
   */
  return auPasFacturable(plafond === 0 ? mediane : Math.min(mediane, plafond))
}

/**
 * Une clé insensible à l'ordre des mots.
 *
 * « opaline pierre » et « pierre opaline » sont le même achat : Google leur rend les mêmes
 * chiffres, et les acheter tous les deux occupe deux emplacements pour une seule recherche.
 * Trier les mots les ramène à une clé unique — ce que la comparaison littérale ne voyait
 * pas.
 */
function clePermutee(texte: string): string {
  return normaliser(texte).split(' ').sort().join(' ')
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

const LANGUES_LISIBLES: Record<string, string> = {
  fr: 'en français',
  de: 'en allemand',
  it: 'en italien',
  en: 'en anglais',
  es: 'en espagnol',
}

function phrase(
  candidat: Omit<Candidat, 'motif' | 'verdict'>,
  taux: number | null,
  cpa: number,
  devise: string,
): string {
  const morceaux: string[] = []
  const langue = LANGUES_LISIBLES[candidat.langue]
  if (langue !== undefined) morceaux.push(`Recherche ${langue}`)
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
  /*
   * Mise en dernier et formulée comme un avertissement, pas comme une étiquette. Les
   * chiffres qui précèdent peuvent être excellents — c'est précisément ce qui rend ce
   * mot-clé dangereux, et ce qui justifie de le dire après eux plutôt qu'avant.
   */
  if (candidat.intention === 'information') {
    morceaux.push(
      'mais ces gens cherchent à comprendre, pas à acheter : vous paieriez des visites curieuses',
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
  for (const present of dejaPresents) exclus.add(clePermutee(present))

  const parTexte = new Map(idees.map((idee) => [normaliser(idee.texte), idee]))
  /*
   * Les variantes que Google regroupe, ramenées à la forme qu'il a nommée. C'est lui qui
   * sait : « quartz rose » et « quartzrose » ne se ressemblent pas assez pour qu'un
   * rapprochement textuel les réunisse, et il les compte pourtant comme une seule recherche.
   */
  const canoniques = new Map<string, string>()
  for (const idee of idees) {
    /*
     * La forme canonique passe par la même clé que tout le reste. Une première version
     * gardait le texte brut : « noir obsidienne » pointait alors vers « obsidienne noire »
     * pendant que « obsidienne noire » se rangeait sous « noire obsidienne », et les deux
     * survivaient. Deux identités pour un même mot ne dédupliquent rien.
     */
    const canon = clePermutee(idee.texte)
    for (const variante of idee.variantes) {
      const cle = normaliser(variante)
      if (cle !== '' && !canoniques.has(cle)) canoniques.set(cle, canon)
    }
  }

  /** La forme sous laquelle ce texte compte, quelles que soient ses orthographes. */
  const identite = (texte: string): string => {
    const brut = normaliser(texte)
    return canoniques.get(brut) ?? clePermutee(brut)
  }

  const retenus = new Set<string>()
  const candidats: Candidat[] = []
  let dejaGagnees = 0

  const ajouter = (
    brut: Omit<Candidat, 'motif' | 'verdict'>,
    verdict: Verdict,
  ): void => {
    const taux = tauxNecessaire(brut.coutHautMicros, cpa)
    /*
     * L'ordre des signaux est l'ordre du risque : une recherche qui veut comprendre coûte
     * de l'argent à coup sûr et ne vend presque jamais. Une enchère chère sur une intention
     * d'achat reste un pari discutable ; un clic à trois centimes sur « les vertus du jaspe
     * rouge » est une dépense sans issue.
     *
     * Le marqueur explicite, et non le repli de `classer`. La différence a été une vraie
     * faute : `classer` doit toujours trancher, et range en « information » tout ce qui ne
     * porte aucun marqueur — ce qui étiquetait « bougie citrine » comme un curieux. Ici on
     * n'affirme que ce qu'on voit, et un signal rare est un signal qu'on lit.
     */
    const informative = chercheASavoir(brut.texte)
    const exigeante = taux !== null && taux > TAUX_PLAUSIBLE
    candidats.push({
      ...brut,
      verdict: informative ? 'informative' : exigeante ? 'exigeante' : verdict,
      motif: phrase(brut, taux, cpa, devise),
    })
  }

  for (const requete of requetes) {
    const brut = normaliser(requete.texte)
    const cle = identite(requete.texte)
    if (brut === '' || exclus.has(brut) || exclus.has(cle) || retenus.has(cle)) continue
    /*
     * Marqué vu quoi qu'il advienne, y compris quand la requête est écartée. C'est la
     * correction d'un vrai défaut : sans cette ligne, une requête déjà gagnée ressortait
     * par la seconde boucle, celle du planificateur — qui la connaît aussi — et se
     * retrouvait proposée à l'achat avec « position 0 », c'est-à-dire en affirmant que le
     * site ne sort pas dessus. Le contraire exact de ce qu'on venait de constater.
     */
    retenus.add(cle)
    const idee = parTexte.get(brut)
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
          langue: requete.langue,
          intention: classer(requete.texte),
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
        langue: requete.langue,
        intention: classer(requete.texte),
        ...mesures,
      },
      'occasion',
    )
  }

  for (const idee of idees) {
    const brut = normaliser(idee.texte)
    const cle = identite(idee.texte)
    if (brut === '' || exclus.has(brut) || exclus.has(cle) || retenus.has(cle)) continue
    // Sans volume, l'idée ne repose sur rien : ni demande constatée, ni marché mesuré.
    if (idee.volume <= 0) continue
    retenus.add(cle)
    ajouter(
      {
        texte: idee.texte.trim(),
        position: 0,
        impressions: 0,
        clics: 0,
        /*
         * Aucune langue : une idée du planificateur ne vient d'aucune page du site. C'est
         * une inconnue assumée — l'écran ne dira rien plutôt que de deviner sur les mots.
         */
        langue: '',
        intention: classer(idee.texte),
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
  const rang: Record<Verdict, number> = {
    occasion: 0,
    'a-tester': 1,
    exigeante: 2,
    informative: 3,
  }
  candidats.sort((une, autre) => {
    if (rang[une.verdict] !== rang[autre.verdict]) return rang[une.verdict] - rang[autre.verdict]
    const poidsUne = une.impressions > 0 ? une.impressions : une.volume
    const poidsAutre = autre.impressions > 0 ? autre.impressions : autre.volume
    return poidsAutre - poidsUne
  })

  return { candidats: candidats.slice(0, CANDIDATS_MAX), dejaGagnees }
}
