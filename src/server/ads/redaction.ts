import { notFound, validation } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { proposerElementsAds } from '@/server/ai/operations'
import { recherchesPourArticle } from '@/server/audit/recherches'
import { compteActif } from './comptes'
import { lireProfil } from './profil'

/**
 * Naya écrit des titres et des descriptions, et ce qu'elle écrit est vérifié avant d'être
 * montré.
 *
 * Le modèle sait formuler ; il ne sait pas compter. Un titre de trente et un caractères est
 * refusé par Google sans explication utile, et une personne qui en dépose douze d'un coup
 * découvre le problème trois jours plus tard, quand son annonce ne diffuse pas. Toute
 * proposition passe donc par un couperet, ici, avant d'atteindre l'écran.
 *
 * Quatre règles portent ce module.
 *
 * **Les longueurs sont vérifiées, pas espérées.** Elles sont dites dans la consigne et
 * recomptées à l'arrivée. Ce qui dépasse est écarté sans rien faire échouer : onze bonnes
 * propositions sur douze valent mieux qu'un appel perdu.
 *
 * **Un doublon n'est pas une proposition.** Ni des textes déjà chez Google, ni des
 * propositions déjà faites. Google refuse les doublons dans un contenant, et proposer le
 * seizième synonyme de « bougie artisanale » n'aide personne.
 *
 * **On ne propose que ce qui manque.** Le nombre demandé se déduit de ce que Google accepte
 * moins ce qui est en place. Demander quinze titres à une annonce qui en a neuf donnerait
 * six textes utiles et neuf à jeter, payés au même prix.
 *
 * **Rien n'est déposé.** Ce module écrit en base d'Evoliia, jamais chez Google. Le dépôt est
 * un geste séparé, avec sa confirmation et son journal.
 */

/** Ce que Google accepte au maximum, par genre de contenant et par champ. */
export const MAXIMUMS: Record<string, Record<string, number>> = {
  annonces: { titre: 15, 'titre-long': 0, description: 4 },
  elements: { titre: 15, 'titre-long': 5, description: 5 },
}

/** Le couperet de Google, en caractères. Un texte qui dépasse est jeté sans être lu. */
export const LONGUEURS: Record<string, number> = {
  titre: 30,
  'titre-long': 90,
  description: 90,
}

/**
 * Au-delà, on paierait pour des textes qu'on ne lira pas.
 *
 * Même quand un contenant est vide, douze propositions suffisent à choisir : au-delà, la
 * liste se parcourt au lieu de se lire, et les derniers textes ne sont jamais retenus.
 */
const PROPOSITIONS_MAX = 12

/** Les caractères que Google refuse dans une annonce, et qui ne se voient pas à la lecture. */
const INTERDITS = /[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}]/u

export type PropositionVue = {
  id: string
  champ: string
  texte: string
  motif: string
  longueur: number
  maximum: number
  createdAt: Date
}

/**
 * Nettoie un texte venu du modèle.
 *
 * Les espaces en trop et les guillemets d'encadrement sont fréquents et invisibles à la
 * lecture ; ils comptent pourtant dans les trente caractères, et un titre rejeté pour un
 * espace final serait une mauvaise façon de perdre un appel.
 */
function nettoyer(texte: string): string {
  return texte
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^["«»\s]+|["«»\s]+$/gu, '')
    .trim()
}

/** Vrai quand ce texte peut être montré. Le refus est silencieux : il en reste d'autres. */
function acceptable(champ: string, texte: string): boolean {
  const maximum = LONGUEURS[champ]
  if (maximum === undefined) return false
  if (texte.length === 0 || texte.length > maximum) return false
  // Google refuse les annonces qui portent un emoji, et le refus arrive après le dépôt.
  if (INTERDITS.test(texte)) return false
  // Un point d'exclamation par annonce au maximum chez Google : on n'en propose aucun.
  if (texte.includes('!')) return false
  return true
}

/** Ce qu'il manque à un contenant pour atteindre ce que Google accepte. */
export function manques(
  genre: string,
  existants: readonly { champ: string }[],
  deja: readonly { champ: string }[],
): Array<{ champ: string; combien: number }> {
  const maximums = MAXIMUMS[genre] ?? MAXIMUMS.annonces
  if (maximums === undefined) return []

  const compter = (liste: readonly { champ: string }[], champ: string) =>
    liste.filter((une) => une.champ === champ).length

  /*
   * Les propositions en attente comptent dans le remplissage : sans cela, relancer la
   * rédaction trois fois donnerait trois fois le même nombre de textes pour les mêmes
   * places, et la personne paierait trois appels pour en garder un.
   */
  const places = new Map<string, number>()
  for (const [champ, maximum] of Object.entries(maximums)) {
    if (maximum === 0) continue
    const place = maximum - compter(existants, champ) - compter(deja, champ)
    if (place > 0) places.set(champ, place)
  }

  /*
   * La répartition tourne d'un champ à l'autre plutôt que de remplir le premier. Un groupe
   * d'éléments vide appelle vingt-cinq textes pour un budget de douze : servir les titres
   * d'abord donnerait douze titres et aucune description — or un groupe sans description
   * est refusé par Google. Ce qui manque le plus n'est pas ce qu'il faut demander en
   * premier ; ce qu'il faut, c'est de quoi faire une annonce complète.
   */
  const donnes = new Map<string, number>()
  let restant = PROPOSITIONS_MAX
  let progresse = true
  while (restant > 0 && progresse) {
    progresse = false
    for (const [champ, place] of places) {
      if (restant <= 0) break
      const deja_donne = donnes.get(champ) ?? 0
      if (deja_donne >= place) continue
      donnes.set(champ, deja_donne + 1)
      restant -= 1
      progresse = true
    }
  }

  return [...donnes.entries()]
    .filter(([, combien]) => combien > 0)
    .map(([champ, combien]) => ({ champ, combien }))
}

/** Les propositions ouvertes d'un contenant, les plus récentes en tête. */
export async function lirePropositions(
  userId: string,
  groupeId: string,
): Promise<PropositionVue[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsProposition.findMany({
      where: { userId, groupeId, etat: 'proposee' },
      orderBy: [{ champ: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, champ: true, texte: true, motif: true, createdAt: true },
    }),
  )
  return lignes.map((ligne) => ({
    id: ligne.id,
    champ: ligne.champ,
    texte: ligne.texte,
    motif: ligne.motif,
    longueur: ligne.texte.length,
    maximum: LONGUEURS[ligne.champ] ?? 0,
    createdAt: ligne.createdAt,
  }))
}

/** Toutes les propositions ouvertes du compte, pour l'écran d'ensemble. */
export async function propositionsDuCompte(
  userId: string,
  accountId: string,
): Promise<Map<string, PropositionVue[]>> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsProposition.findMany({
      where: { userId, accountId, etat: 'proposee' },
      orderBy: [{ champ: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        groupeId: true,
        champ: true,
        texte: true,
        motif: true,
        createdAt: true,
      },
    }),
  )

  const parGroupe = new Map<string, PropositionVue[]>()
  for (const ligne of lignes) {
    const vue: PropositionVue = {
      id: ligne.id,
      champ: ligne.champ,
      texte: ligne.texte,
      motif: ligne.motif,
      longueur: ligne.texte.length,
      maximum: LONGUEURS[ligne.champ] ?? 0,
      createdAt: ligne.createdAt,
    }
    const deja = parGroupe.get(ligne.groupeId)
    if (deja === undefined) parGroupe.set(ligne.groupeId, [vue])
    else deja.push(vue)
  }
  return parGroupe
}

/** Écarte une proposition. Elle ne revient pas : Naya en écrira d'autres si on le demande. */
export async function ecarterProposition(userId: string, id: string): Promise<void> {
  const touchees = await withUserScope(userId, (tx) =>
    tx.adsProposition.updateMany({
      where: { id, userId, etat: 'proposee' },
      data: { etat: 'ecartee', closedAt: new Date() },
    }),
  )
  if (touchees.count === 0) throw notFound('Cette proposition est introuvable.')
}

export type BilanRedaction = {
  proposees: number
  /** Écartées à l'arrivée : trop longues, en doublon, ou porteuses d'un caractère refusé. */
  rejetees: number
  credits: number
}

/**
 * Fait écrire Naya pour un contenant.
 *
 * `origin` est l'adresse du site, qui sert à lire les recherches réelles. Facultative : sans
 * elle, la rédaction se fait sur les produits et l'activité, ce qui est moins bon mais
 * fonctionne — et faire échouer une rédaction parce qu'une source d'appoint manque serait
 * indéfendable.
 */
export async function redigerPourGroupe(
  userId: string,
  groupeId: string,
  origin: string | null,
): Promise<BilanRedaction> {
  const compte = await compteActif(userId)
  if (compte === null) throw notFound('Aucun compte publicitaire n’est suivi.')

  const groupe = await withUserScope(userId, (tx) =>
    tx.adsGroupe.findFirst({
      where: { id: groupeId, userId, accountId: compte.id },
      select: {
        id: true,
        nom: true,
        genre: true,
        campagne: { select: { nom: true } },
        elements: { select: { champ: true, texte: true } },
        propositions: {
          where: { etat: 'proposee' },
          select: { champ: true, texte: true },
        },
      },
    }),
  )
  if (groupe === null) throw notFound('Ce contenant est introuvable.')

  const aFaire = manques(groupe.genre, groupe.elements, groupe.propositions)
  if (aFaire.length === 0) {
    /*
     * Refusé avant l'appel, et non après : un appel qui ne peut rien produire d'utile ne
     * doit pas être payé. C'est aussi la seule façon d'empêcher qu'un clic répété vide un
     * compte de crédits sur un contenant déjà plein.
     */
    throw validation(
      'Ce contenant est complet, propositions en attente comprises. Déposez-en ou écartez-en avant d’en demander d’autres.',
    )
  }

  const profil = await lireProfil(userId, compte.id)
  const recherches = origin === null ? [] : await recherchesPourArticle(userId, origin)

  /*
   * Un appel qui échoue lève : la comptabilité des crédits est déjà faite en amont —
   * réservation, débit au coût constaté, libération en cas d'échec — et la route au-dessus
   * traduit l'erreur en phrase. Intercepter ici ferait un second endroit où décider de ce
   * qu'on dit d'une panne de modèle.
   */
  const issue = await proposerElementsAds({
    userId,
    genre: groupe.genre,
    nomGroupe: groupe.nom,
    campagne: groupe.campagne.nom,
    activite: profil.activite,
    produits: profil.produits,
    pays: profil.pays,
    existants: groupe.elements.map((element) => ({
      champ: element.champ,
      texte: element.texte,
    })),
    recherches,
    fiches: [],
    manques: aFaire,
  })
  /*
   * Le couperet. Le modèle sait formuler, il ne sait pas compter : ce qui dépasse trente
   * caractères est écarté ici plutôt que refusé par Google trois jours plus tard, quand
   * l'annonce ne diffuse pas et que personne ne comprend pourquoi.
   */
  const interdits = new Set(
    [...groupe.elements, ...groupe.propositions].map(
      (une) => `${une.champ}::${nettoyer(une.texte).toLowerCase()}`,
    ),
  )
  const places = new Map(aFaire.map((manque) => [manque.champ, manque.combien]))

  const retenues: Array<{ champ: string; texte: string; motif: string }> = []
  let rejetees = 0
  for (const element of issue.value.elements) {
    const texte = nettoyer(element.texte)
    const place = places.get(element.champ) ?? 0
    const cle = `${element.champ}::${texte.toLowerCase()}`
    if (place <= 0 || !acceptable(element.champ, texte) || interdits.has(cle)) {
      rejetees += 1
      continue
    }
    interdits.add(cle)
    places.set(element.champ, place - 1)
    retenues.push({ champ: element.champ, texte, motif: nettoyer(element.motif) })
  }

  if (retenues.length > 0) {
    await withUserScope(userId, (tx) =>
      tx.adsProposition.createMany({
        data: retenues.map((une) => ({
          userId,
          accountId: compte.id,
          groupeId: groupe.id,
          champ: une.champ,
          texte: une.texte,
          motif: une.motif,
        })),
        skipDuplicates: true,
      }),
    )
  }

  const bilan: BilanRedaction = {
    proposees: retenues.length,
    rejetees,
    credits: issue.creditsSpent,
  }
  logger.info('propositions publicitaires écrites', { ...bilan })
  return bilan
}
