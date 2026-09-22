import { notFound, validation } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { lireRecherches } from '@/server/audit/recherches'
import { proposerElementsAds } from '@/server/ai/operations'
import { accesCompteActif, compteActif } from './comptes'
import { autoriseEnchere, PLACES_CAMPAGNE } from './garde-fous'
import { googleAds } from './google-ads'
import {
  cpaAcceptable,
  croiser,
  enchereProposee,
  LANGUES,
  langueDominante,
  marcheDominant,
  marcheDuProfil,
  plafondEnchere,
  type RequeteSite,
} from './mots-cles'
import { lireProfil } from './profil'
import { acceptable, nettoyer, nettoyerMotif } from './redaction'

/**
 * Préparer une campagne, entièrement, avant qu'un seul appel parte chez Google.
 *
 * C'est l'étape qui manquait pour qu'une création soit décidable. Une campagne Recherche,
 * chez Google, c'est sept objets : un budget, la campagne, son pays, sa langue, un groupe
 * d'annonces, ses mots-clés, une annonce. Un formulaire qui demanderait un nom et un budget
 * puis créerait les sept en cacherait cinq — et la personne découvrirait après coup ce
 * qu'elle a accepté.
 *
 * Ici, tout est calculé, écrit en base, et montré. Le plan est un objet qui existe : la
 * personne le relit, l'abandonne ou le crée. Entre les deux, rien n'est parti.
 *
 * **Le plan vit en base, pas dans le navigateur.** C'est une garantie et non une commodité :
 * ce qui sera envoyé à Google est ce qui est écrit ici, et le navigateur ne transmet qu'un
 * identifiant. Faire l'aller-retour par le navigateur reviendrait à croire sur parole les
 * textes, les mots-clés, le budget et l'adresse d'arrivée au moment de créer.
 *
 * **La préparation coûte un appel de modèle**, pour rédiger l'annonce. Le reste — les
 * recherches, les volumes, les prix, l'enchère — est de la lecture et du calcul. Un plan
 * abandonné a donc coûté quelques crédits, ce qui est le prix d'un brouillon qu'on relit.
 */

/** Ce qu'on retient pour un groupe neuf. Plus serait ingérable, moins ne couvrirait rien. */
const MOTS_CLES_DU_PLAN = 12

/** De quoi Google fait une annonce convenable. Son minimum est de trois et deux. */
const TITRES_DU_PLAN = 8
const DESCRIPTIONS_DU_PLAN = 4

export type MotClePlan = {
  texte: string
  correspondance: 'phrase' | 'exact'
  volume: number
  coutBasMicros: number
  coutHautMicros: number
  motif: string
}

export type PlanVue = {
  id: string
  nom: string
  budgetMicros: number
  enchereMicros: number
  urlFinale: string
  marcheNom: string
  /** profil | chiffres : le pays a-t-il été déclaré, ou déduit ? Une déduction se vérifie. */
  marcheSource: string
  langueNom: string
  motsCles: MotClePlan[]
  titres: string[]
  descriptions: string[]
  etat: string
  createdAt: Date
}

function vue(ligne: {
  id: string
  nom: string
  budgetMicros: bigint
  enchereMicros: bigint
  urlFinale: string
  marcheNom: string
  marcheSource: string
  langueNom: string
  motsCles: unknown
  titres: unknown
  descriptions: unknown
  etat: string
  createdAt: Date
}): PlanVue {
  /*
   * Relu défensivement. Ces colonnes sont du JSON : elles ont été écrites par ce fichier,
   * mais une migration ratée ou une main sur la base ne doit pas casser un écran.
   */
  const textes = (valeur: unknown): string[] =>
    Array.isArray(valeur) ? valeur.filter((un): un is string => typeof un === 'string') : []

  return {
    id: ligne.id,
    nom: ligne.nom,
    budgetMicros: Number(ligne.budgetMicros),
    enchereMicros: Number(ligne.enchereMicros),
    urlFinale: ligne.urlFinale,
    marcheNom: ligne.marcheNom,
    marcheSource: ligne.marcheSource,
    langueNom: ligne.langueNom,
    motsCles: Array.isArray(ligne.motsCles) ? (ligne.motsCles as MotClePlan[]) : [],
    titres: textes(ligne.titres),
    descriptions: textes(ligne.descriptions),
    etat: ligne.etat,
    createdAt: ligne.createdAt,
  }
}

const CHAMPS = {
  id: true,
  nom: true,
  budgetMicros: true,
  enchereMicros: true,
  urlFinale: true,
  marcheNom: true,
  marcheSource: true,
  langueNom: true,
  motsCles: true,
  titres: true,
  descriptions: true,
  etat: true,
  createdAt: true,
} as const

/**
 * Le repère à afficher à côté du champ d'enchère, en micros. Zéro : rien à dire.
 *
 * Calculé sur les nombres de la personne — son objectif de coût par vente, ou la marge de
 * son panier moyen — et non sur une fourchette de marché dont personne ne saurait d'où elle
 * sort. Un repère qu'on peut vérifier vaut mieux qu'un repère plausible.
 */
export async function reperEnchere(userId: string): Promise<number> {
  const compte = await compteActif(userId)
  if (compte === null) return 0
  return plafondEnchere(cpaAcceptable(await lireProfil(userId, compte.id)))
}

/** Les plans en attente de décision. Un plan créé ou abandonné ne s'affiche plus. */
export async function lirePlans(userId: string): Promise<PlanVue[]> {
  const compte = await compteActif(userId)
  if (compte === null) return []
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsPlanCampagne.findMany({
      where: { userId, accountId: compte.id, etat: 'prepare' },
      orderBy: { createdAt: 'desc' },
      select: CHAMPS,
    }),
  )
  return lignes.map(vue)
}

export async function abandonnerPlan(userId: string, id: string): Promise<void> {
  const touchees = await withUserScope(userId, (tx) =>
    tx.adsPlanCampagne.updateMany({
      where: { id, userId, etat: 'prepare' },
      data: { etat: 'abandonne', closedAt: new Date() },
    }),
  )
  if (touchees.count === 0) throw notFound('Ce plan est introuvable.')
}

/**
 * Fixe l'enchère d'un plan déjà composé.
 *
 * Séparé de la préparation, et c'est le point : recomposer un plan pour corriger un seul
 * nombre referait rédiger l'annonce, donc coûterait des crédits pour rien. Ici, rien n'est
 * recalculé — ni les mots-clés, ni les textes. Seul le chiffre change.
 */
export async function fixerEnchere(
  userId: string,
  planId: string,
  enchereMicros: number,
): Promise<{ ok: true; plan: PlanVue } | { ok: false; raison: string }> {
  const ligne = await withUserScope(userId, (tx) =>
    tx.adsPlanCampagne.findFirst({
      where: { id: planId, userId, etat: 'prepare' },
      select: { id: true, budgetMicros: true },
    }),
  )
  if (ligne === null) throw notFound('Ce plan est introuvable.')

  const verdict = autoriseEnchere(enchereMicros, Number(ligne.budgetMicros))
  if (!verdict.ok) return verdict

  const misAJour = await withUserScope(userId, (tx) =>
    tx.adsPlanCampagne.update({
      where: { id: ligne.id },
      data: { enchereMicros: BigInt(Math.round(enchereMicros)) },
      select: CHAMPS,
    }),
  )
  return { ok: true, plan: vue(misAJour) }
}

/**
 * Retire un mot-clé d'un plan, et recalcule ce qui en dépend.
 *
 * Sans lui, un seul mot indésirable obligeait à abandonner le plan entier et à tout
 * recomposer — ce qui refait rédiger l'annonce, donc repaie des crédits pour écarter un
 * mot. Ici rien n'est recomposé : la liste rétrécit, et l'enchère se recalcule sur ce qui
 * reste, parce qu'elle est une médiane des prix et que retirer un prix la déplace.
 *
 * Le retrait porte sur le texte et non sur un rang : un identifiant de position serait faux
 * dès que deux écrans regardent le même plan.
 */
export async function retirerDuPlan(
  userId: string,
  planId: string,
  texte: string,
): Promise<{ ok: true; plan: PlanVue } | { ok: false; raison: string }> {
  const compte = await compteActif(userId)
  if (compte === null) throw notFound('Aucun compte publicitaire n’est suivi.')

  const ligne = await withUserScope(userId, (tx) =>
    tx.adsPlanCampagne.findFirst({
      where: { id: planId, userId, accountId: compte.id, etat: 'prepare' },
      select: { id: true, motsCles: true, enchereMicros: true },
    }),
  )
  if (ligne === null) throw notFound('Ce plan est introuvable.')

  const cible = texte.trim().toLowerCase()
  const actuels = Array.isArray(ligne.motsCles) ? (ligne.motsCles as MotClePlan[]) : []
  const restants = actuels.filter((mot) => mot.texte.trim().toLowerCase() !== cible)

  if (restants.length === actuels.length) {
    return { ok: false, raison: 'Ce mot-clé n’est pas dans ce plan.' }
  }
  if (restants.length === 0) {
    return {
      ok: false,
      raison:
        'Une campagne Recherche sans mot-clé ne diffuse sur rien. Abandonnez le plan si aucun ne vous convient.',
    }
  }

  /*
   * L'enchère se recalcule, mais seulement si elle avait été calculée. Une enchère saisie à
   * la main est un choix de la personne : la remplacer par une médiane parce qu'elle a
   * retiré un mot reviendrait à défaire sa décision sans le dire.
   */
  const profil = await lireProfil(userId, compte.id)
  const calculee = enchereProposee(restants, cpaAcceptable(profil))
  const ancienneCalculee = enchereProposee(actuels, cpaAcceptable(profil))
  const saisie = Number(ligne.enchereMicros) !== ancienneCalculee
  const enchere = saisie ? Number(ligne.enchereMicros) : calculee

  const misAJour = await withUserScope(userId, (tx) =>
    tx.adsPlanCampagne.update({
      where: { id: ligne.id },
      data: { motsCles: restants, enchereMicros: BigInt(Math.round(enchere)) },
      select: CHAMPS,
    }),
  )
  return { ok: true, plan: vue(misAJour) }
}

export type BilanPreparation = {
  plan: PlanVue
  /** Écartées parce qu'on sort déjà en tête sans payer. Une bonne nouvelle, pas un filtre. */
  dejaGagnees: number
  credits: number
}

/**
 * Compose le plan d'une campagne Recherche à partir de ce que les gens tapent.
 *
 * Rien n'est envoyé. Le résultat est une ligne en base que la personne relit.
 *
 * L'enchère est proposée mais peut être nulle : quand le planificateur ne rend aucun prix,
 * Evoliia ne devine pas. L'écran demande alors le montant plutôt que d'afficher un chiffre
 * qui aurait l'air calculé.
 */
export async function preparerCampagne(
  userId: string,
  demande: {
    nom: string
    budgetMicros: number
    urlFinale: string
    /**
     * Le coût par clic, quand la personne le saisit. Zéro : Naya le calcule sur les prix du
     * planificateur — et reste à zéro si Google n'en donne aucun, auquel cas l'écran le
     * demande plutôt que d'inventer un chiffre qui aurait l'air calculé.
     */
    enchereMicros: number
    /**
     * Les mots-clés de départ, quand la personne les donne.
     *
     * Ils changent la nature du plan. Sans eux, Naya sème le planificateur avec les requêtes
     * de Search Console — ce que le site capte **déjà**. Avec eux, elle sème avec ce que la
     * personne **veut vendre**, ce qui est souvent plus large et parfois tout autre chose.
     * Les deux sont légitimes ; seule la personne sait laquelle des deux questions elle pose.
     */
    graines: string[]
    /**
     * La langue de la campagne, quand la personne la choisit.
     *
     * Dès qu'elle écrit ses propres mots-clés, la déduire des affichages n'a plus de sens :
     * elle vient de les taper dans une langue précise. Vide, on retombe sur la langue
     * dominante de Search Console, comme avant.
     */
    langue: string
  },
  origin: string | null,
  locale: string,
): Promise<BilanPreparation> {
  const compte = await compteActif(userId)
  if (compte === null) throw notFound('Aucun compte publicitaire n’est suivi.')

  if (origin === null) {
    throw validation(
      'Aucun site n’est suivi. Une campagne Recherche se construit sur ce que les gens tapent déjà pour vous trouver : sans Search Console, il n’y aurait que des suppositions.',
    )
  }

  const lecture = await lireRecherches(userId, origin)
  if (!lecture.ok) {
    throw validation(
      'Les chiffres de Search Console ne sont pas lisibles pour l’instant. Ce sont eux qui disent ce que les gens tapent réellement.',
    )
  }

  /*
   * Le profil prime, les chiffres ne sont qu'un repli. L'inverse a produit une vraie faute :
   * une boutique suisse s'est vu proposer une campagne ciblant l'Italie, parce que ses pages
   * italiennes reçoivent plus d'affichages que ses pages françaises. Le pays d'où viennent
   * les curieux n'est pas celui où l'on vend, et depuis la Suisse, vendre en Italie veut
   * dire des frais de douane sur chaque colis.
   */
  const profil = await lireProfil(userId, compte.id)
  const declare = marcheDuProfil(profil.pays)
  const marche = declare ?? marcheDominant(lecture.vue.pays)
  if (marche === null) {
    throw validation(
      'Naya ne sait pas quel pays viser. Indiquez-le dans votre profil publicitaire : le pays d’où viennent vos visiteurs n’est pas forcément celui où vous vendez, et une campagne sans pays diffuserait dans le monde entier.',
    )
  }
  const marcheSource = declare === null ? 'chiffres' : 'profil'
  const acces = await accesCompteActif(userId)
  if (!acces.ok) throw validation(acces.raison)

  /*
   * Une requête dont Search Console ne donne pas la page n'a pas de langue connue. La
   * laisser vide l'a fait entrer dans une campagne italienne aux côtés de mots italiens,
   * avec une annonce italienne : « quartz rose » et « obsidienne noire » se sont retrouvés
   * là, sans prix — puisqu'ils avaient été chiffrés dans une langue où cette demande
   * n'existe pas. Elle prend donc la langue du site, qui est le repli honnête : on ne sait
   * pas, on suppose la langue par défaut, et on ne la mêle pas à une autre.
   */
  const requetes: RequeteSite[] = [
    ...lecture.vue.occasionsDeRequetes,
    ...lecture.vue.requetes,
  ].map((ligne) => ({
    texte: ligne.cle,
    position: ligne.position,
    impressions: ligne.impressions,
    clics: ligne.clics,
    langue: lecture.vue.langues[ligne.cle] ?? (LANGUES[locale] === undefined ? 'fr' : locale),
  }))

  /*
   * Une campagne, une langue. C'est la contrainte qui décide de tout ce qui suit, et elle
   * n'est pas technique : mélanger les langues dans un groupe d'annonces revient à montrer
   * le même texte à tout le monde — les uns le lisent, les autres passent, et les
   * impressions sont dépensées dans les deux cas. La langue retenue est celle qui rassemble
   * le plus d'affichages, faute de quoi celle de l'écran.
   */
  const choisie = LANGUES[demande.langue] === undefined ? '' : demande.langue
  const dominante = choisie === '' ? (langueDominante(requetes) ?? locale) : choisie
  const langue = LANGUES[dominante] ?? LANGUES[locale] ?? LANGUES.fr
  if (langue === undefined) throw validation('Langue inconnue.')
  const codeLangue = LANGUES[dominante] === undefined ? locale : dominante

  /*
   * Seules les requêtes de cette langue-là servent de graines, et l'appel est fait dans
   * cette langue. Demander les volumes italiens en français rendrait des nombres vrais qui
   * ne décrivent rien.
   */
  // Strictement cette langue. Un mot d'une autre langue dans un groupe d'annonces montre
  // aux gens un texte qu'ils n'ont pas cherché, et consomme l'impression quand même.
  const dansLaLangue = requetes.filter((requete) => requete.langue === codeLangue)

  /*
   * Les mots de la personne d'abord, s'il y en a. Le planificateur rend un champ sémantique
   * autour de ce qu'on lui donne : le semer avec les requêtes du site répond à « qu'est-ce
   * qui m'amène du monde ? », le semer avec ses mots répond à « qu'est-ce que je veux
   * vendre ? ». La seconde question est la sienne, et elle ne se devine pas.
   */
  const choisies = demande.graines
    .map((mot) => mot.trim().replace(/\s+/gu, ' '))
    .filter((mot) => mot !== '')
  const graines = choisies.length > 0 ? choisies : dansLaLangue.map((requete) => requete.texte)
  const [idees, mesures] = await Promise.all([
    googleAds.ideesDeMotsCles(acces.acces, graines, marche.geo, langue.code),
    googleAds.metriquesDeMotsCles(acces.acces, graines, marche.geo, langue.code),
  ])
  /*
   * Un planificateur muet n'arrête pas la préparation, contrairement à l'écran des mots-clés
   * d'un groupe existant. La différence n'est pas un relâchement : ici, la protection qui
   * compte — ne pas acheter ce qu'on gagne déjà gratuitement — vient de la position
   * organique, que Search Console donne. On perd l'estimation de prix, pas la garantie.
   */
  const cpa = cpaAcceptable(profil)
  const chiffres = [
    ...(idees.ok ? idees.valeur : []),
    ...(mesures.ok ? mesures.valeur : []),
  ]
  const { candidats, dejaGagnees } = croiser(
    dansLaLangue,
    chiffres,
    [],
    cpa,
    compte.devise,
  )

  /*
   * Les idées du planificateur n'ont pas de langue — elles ne viennent d'aucune page du
   * site — mais elles ont été demandées dans celle-ci : c'est donc la leur. L'écrire plutôt
   * que de laisser un champ vide évite qu'un mot-clé sans langue se retrouve plus tard dans
   * une campagne d'une autre.
   */
  /*
   * Les mots demandés sont retenus quoi qu'il arrive, et en tête. Les filtres du croisement
   * existent pour trier des propositions ; ils n'ont pas à écarter un mot que la personne a
   * écrit elle-même. Elle le verra avec ses chiffres, y compris mauvais, et décidera.
   */
  const parTexte = new Map(candidats.map((un) => [un.texte.trim().toLowerCase(), un]))
  const demandes = choisies.map((texte) => {
    const trouve = parTexte.get(texte.toLowerCase())
    const mesure = chiffres.find((un) => un.texte.trim().toLowerCase() === texte.toLowerCase())
    return (
      trouve ?? {
        texte,
        langue: codeLangue,
        intention: 'achat' as const,
        position: 0,
        impressions: 0,
        clics: 0,
        volume: mesure?.volume ?? 0,
        coutBasMicros: mesure?.coutBasMicros ?? 0,
        coutHautMicros: mesure?.coutHautMicros ?? 0,
        concurrence: mesure?.concurrence ?? '',
        verdict: 'a-tester' as const,
        motif: 'Mot-clé que vous avez choisi.',
      }
    )
  })

  const dejaDemandes = new Set(demandes.map((un) => un.texte.trim().toLowerCase()))
  const retenus = [
    ...demandes,
    ...candidats.filter((un) => !dejaDemandes.has(un.texte.trim().toLowerCase())),
  ]
    .slice(0, MOTS_CLES_DU_PLAN)
    .map((un) => ({ ...un, langue: un.langue === '' ? codeLangue : un.langue }))
  if (retenus.length === 0) {
    throw validation(
      'Aucune recherche ne justifie une campagne pour l’instant : celles où vous apparaissez, vous les gagnez déjà sans payer, et les autres sont trop rares pour diffuser. Revenez quand votre site aura plus d’affichages.',
    )
  }

  const issue = await proposerElementsAds({
    userId,
    genre: 'annonces',
    nomGroupe: demande.nom,
    campagne: demande.nom,
    activite: profil.activite,
    produits: profil.produits,
    pays: profil.pays,
    cible: retenus.map((un) => un.texte),
    langue: langue.nom,
    existants: [],
    recherches: retenus.map((un) => ({
      requete: un.texte,
      impressions: un.impressions,
      clics: un.clics,
      position: un.position,
      intention: 'achat' as const,
    })),
    fiches: [],
    manques: [
      { champ: 'titre', combien: TITRES_DU_PLAN },
      { champ: 'description', combien: DESCRIPTIONS_DU_PLAN },
    ],
  })

  /*
   * Le couperet, identique à celui de la rédaction : le modèle sait formuler, il ne sait pas
   * compter. Ce qui dépasse la longueur de Google est écarté ici plutôt que refusé trois
   * jours plus tard, quand l'annonce ne diffuse pas et que personne ne comprend pourquoi.
   */
  const titres: string[] = []
  const descriptions: string[] = []
  const vus = new Set<string>()
  for (const element of issue.value.elements) {
    const texte = nettoyer(element.texte)
    const cle = `${element.champ}::${texte.toLowerCase()}`
    if (vus.has(cle) || !acceptable(element.champ, texte)) continue
    vus.add(cle)
    if (element.champ === 'titre' && titres.length < TITRES_DU_PLAN) titres.push(texte)
    if (element.champ === 'description' && descriptions.length < DESCRIPTIONS_DU_PLAN) {
      descriptions.push(texte)
    }
  }

  /*
   * En dessous du minimum de Google, l'annonce serait refusée et le groupe resterait sans
   * rien à diffuser. Mieux vaut le dire maintenant qu'après avoir créé six objets.
   */
  if (titres.length < PLACES_CAMPAGNE.titresMin || descriptions.length < PLACES_CAMPAGNE.descriptionsMin) {
    throw validation(
      `Naya n’a pas produit assez de textes utilisables : ${titres.length} titres et ${descriptions.length} descriptions, alors que Google en exige ${PLACES_CAMPAGNE.titresMin} et ${PLACES_CAMPAGNE.descriptionsMin}. Complétez votre profil — activité, produits — et réessayez.`,
    )
  }

  const motsCles: MotClePlan[] = retenus.map((un) => ({
    texte: un.texte,
    correspondance: 'phrase' as const,
    volume: un.volume,
    coutBasMicros: un.coutBasMicros,
    coutHautMicros: un.coutHautMicros,
    motif: nettoyerMotif(un.motif),
  }))

  const ligne = await withUserScope(userId, (tx) =>
    tx.adsPlanCampagne.create({
      data: {
        userId,
        accountId: compte.id,
        nom: demande.nom.trim(),
        budgetMicros: BigInt(Math.round(demande.budgetMicros)),
        enchereMicros: BigInt(
          demande.enchereMicros > 0
            ? Math.round(demande.enchereMicros)
            : enchereProposee(motsCles, cpa),
        ),
        urlFinale: demande.urlFinale.trim(),
        marcheGeo: marche.geo,
        marcheNom: marche.nom,
        marcheSource,
        langueCode: langue.code,
        langueNom: langue.nom,
        motsCles,
        titres,
        descriptions,
      },
      select: CHAMPS,
    }),
  )

  return { plan: vue(ligne), dejaGagnees, credits: issue.creditsSpent }
}
