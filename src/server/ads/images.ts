import sharp from 'sharp'
import { notFound, validation } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { secureFetchBytes } from '@/server/audit/net'
import { lireVitrinePourArticle } from '@/server/commerce/boutique'
import { normaliser } from '@/server/commerce/illustrations'
import { detectFormat } from '@/server/media/rules'
import type { VitrineShopify } from '@/server/integrations/providers/shopify'

/**
 * Les images d'une annonce, prises dans la boutique plutôt qu'inventées.
 *
 * C'est la décision qui tient tout ce module, et elle n'est pas technique. Une image de
 * bougie produite par une intelligence artificielle montrerait, dans une annonce Google, un
 * produit qui n'existe pas dans la boutique. Quelqu'un clique sur une bougie qu'il ne
 * trouvera nulle part. C'est mauvais commercialement, et c'est exactement ce que Google
 * sanctionne sous le nom de représentation trompeuse.
 *
 * Or le commerçant a déjà mieux : ses photos. Elles montrent ce qu'il vend, elles ne coûtent
 * rien, et elles ont été faites pour ça. Naya ne fabrique donc pas d'image — elle choisit
 * celle du catalogue qui correspond au sujet du contenant, et la met au format.
 *
 * Trois règles portent le reste.
 *
 * **Le recadrage prend le centre, et il est annoncé.** Google impose trois proportions
 * exactes ; une photo carrée ne devient pas un paysage sans perdre le haut et le bas. Le
 * dire avant vaut mieux que de le découvrir sur l'annonce, et c'est pourquoi l'écran nomme
 * chaque format et ce qu'il coupe.
 *
 * **Ce qui arrive du réseau est traité comme hostile.** L'adresse vient du catalogue d'une
 * boutique, donc d'ailleurs. Elle passe par le même client protégé que le robot d'audit, et
 * le format réel est lu dans les octets, jamais dans l'en-tête annoncé.
 *
 * **Rien n'est envoyé qui n'ait été re-encodé.** Sharp réécrit l'image, ce qui laisse tomber
 * au passage tout ce qu'un fichier d'image peut transporter d'autre : scripts, position GPS,
 * profils exotiques. Le commerçant dépose une photo de bougie, il ne publie pas les
 * coordonnées de son atelier.
 */

/**
 * Les trois proportions que Google accepte, et ce qu'elles coupent.
 *
 * Les dimensions sont celles que Google recommande, pas ses minimums : une image déposée au
 * minimum est acceptée puis affichée floue sur un grand écran, ce qui est pire qu'un refus
 * parce que personne ne le voit.
 */
export const FORMATS = {
  paysage: {
    nom: 'Paysage',
    largeur: 1200,
    hauteur: 628,
    champGoogle: 'MARKETING_IMAGE',
    coupe: 'Coupe le haut et le bas d’une photo carrée.',
  },
  carre: {
    nom: 'Carré',
    largeur: 1200,
    hauteur: 1200,
    champGoogle: 'SQUARE_MARKETING_IMAGE',
    coupe: 'Conserve une photo carrée telle quelle.',
  },
  portrait: {
    nom: 'Portrait',
    largeur: 960,
    hauteur: 1200,
    champGoogle: 'PORTRAIT_MARKETING_IMAGE',
    coupe: 'Coupe les côtés d’une photo carrée.',
  },
} as const

export type Format = keyof typeof FORMATS

export function formatValide(valeur: unknown): Format | null {
  return typeof valeur === 'string' && valeur in FORMATS ? (valeur as Format) : null
}

/** Ce que Google accepte au maximum par fichier. Au-delà, il refuse sans le lire. */
const POIDS_MAX = 5 * 1024 * 1024

/** Ce qu'on accepte de télécharger. Plus large que ce que Google prend, avant recadrage. */
const TELECHARGEMENT_MAX = 12 * 1024 * 1024

/** Au-delà, la liste se parcourt au lieu de se lire, et les dernières ne sont jamais prises. */
const PHOTOS_MAX = 8

export type PhotoVue = {
  handle: string
  titre: string
  image: string
  alt: string
  /** Mots du sujet retrouvés dans la fiche. C'est ce qui rend le choix contestable. */
  motifs: string[]
}

/**
 * Classe les fiches par proximité avec le sujet du contenant.
 *
 * Le même principe que les illustrations d'articles : des mots en commun, pondérés par leur
 * rareté dans le catalogue. Pas d'appel à un modèle — ce serait un prix de plus pour une
 * question qui se tranche en comptant, et une seconde occasion de se tromper.
 */
export function classerPhotos(
  sujet: readonly string[],
  vitrine: readonly VitrineShopify[],
): PhotoVue[] {
  if (vitrine.length === 0) return []

  const mots = vitrine.map((piece) => normaliser(`${piece.titre} ${piece.alt}`))
  const frequences = new Map<string, number>()
  for (const liste of mots) {
    for (const mot of new Set(liste)) frequences.set(mot, (frequences.get(mot) ?? 0) + 1)
  }

  const cherches = new Set(sujet.flatMap((une) => normaliser(une)))
  if (cherches.size === 0) return []

  const notees = vitrine.map((piece, index) => {
    const siens = new Set(mots[index] ?? [])
    const communs = [...cherches].filter((mot) => siens.has(mot))
    /*
     * La rareté plutôt que le nombre : « bougie » est dans toutes les fiches et ne distingue
     * rien, « citrine » en distingue une. Un comptage brut choisirait la fiche au titre le
     * plus long.
     */
    const note = communs.reduce(
      (somme, mot) => somme + (1 - (frequences.get(mot) ?? 0) / vitrine.length),
      0,
    )
    return { piece, note, communs }
  })

  return notees
    .filter((une) => une.note > 0)
    .sort((a, b) => b.note - a.note)
    .slice(0, PHOTOS_MAX)
    .map((une) => ({
      handle: une.piece.handle,
      titre: une.piece.titre,
      image: une.piece.image,
      alt: une.piece.alt,
      motifs: une.communs,
    }))
}

/** Les photos que Naya proposerait pour un contenant, déjà déposées exclues. */
export async function photosPourGroupe(userId: string, groupeId: string): Promise<PhotoVue[]> {
  const groupe = await withUserScope(userId, (tx) =>
    tx.adsGroupe.findFirst({
      where: { id: groupeId, userId },
      select: {
        nom: true,
        campagne: { select: { nom: true } },
        elements: { select: { champ: true, texte: true } },
      },
    }),
  )
  if (groupe === null) return []

  /*
   * Le sujet vient des mots-clés d'abord, du nom ensuite. Un contenant nommé « Groupe
   * d'annonces 1 » ne dit rien ; ses mots-clés disent tout.
   */
  const motsCles = groupe.elements
    .filter((element) => element.champ === 'mot-cle')
    .map((element) => element.texte)
  const sujet = motsCles.length > 0 ? motsCles : [groupe.nom, groupe.campagne.nom]

  const vitrine = await lireVitrinePourArticle(userId)
  const dejaLa = new Set(
    groupe.elements.filter((element) => element.champ === 'image').map((element) => element.texte),
  )

  return classerPhotos(sujet, vitrine).filter((photo) => !dejaLa.has(photo.image))
}

export type ImagePrete = {
  /** Les octets, encodés pour Google, qui les attend en base 64. */
  base64: string
  largeur: number
  hauteur: number
  octets: number
}

/**
 * Télécharge une photo et la met au format demandé.
 *
 * `cover` plutôt que `contain` : Google refuse les images bordées de larges bandes, et une
 * photo de produit ramenée au centre d'un cadre blanc a l'air d'une erreur. On recadre, on
 * perd des bords, et on le dit à l'écran plutôt que de le cacher.
 */
export async function preparerImage(url: string, format: Format): Promise<ImagePrete> {
  const cible = FORMATS[format]
  const telecharge = await secureFetchBytes(url, TELECHARGEMENT_MAX)

  /*
   * Le format réel est lu dans les octets, jamais dans l'en-tête : un fichier annoncé
   * « image/png » peut contenir n'importe quoi, et c'est sharp qui le décoderait.
   */
  const reel = detectFormat(new Uint8Array(telecharge.octets))
  if (reel === null) {
    throw validation('Ce fichier n’est pas une image que Evoliia sait traiter.')
  }

  const image = await sharp(telecharge.octets, { limitInputPixels: 40_000_000 })
    .resize({ width: cible.largeur, height: cible.hauteur, fit: 'cover', position: 'centre' })
    // Le JPEG : Google l'accepte partout, et il pèse la moitié d'un PNG sur une photo.
    .jpeg({ quality: 82 })
    .toBuffer()

  if (image.length > POIDS_MAX) {
    throw validation('Cette image reste trop lourde pour Google après mise au format.')
  }

  return {
    base64: image.toString('base64'),
    largeur: cible.largeur,
    hauteur: cible.hauteur,
    octets: image.length,
  }
}

/** Le nom donné à l'élément chez Google. Il n'est vu que par la personne, dans son compte. */
export function nommerImage(titre: string, format: Format): string {
  const propre = titre.replace(/\s+/gu, ' ').trim().slice(0, 60)
  const nom = `${propre === '' ? 'Photo' : propre} — ${FORMATS[format].nom} (Evoliia)`
  /*
   * Google impose des noms uniques par compte. L'horodatage évite qu'un second dépôt de la
   * même photo échoue sur un conflit que personne ne saurait interpréter.
   */
  return `${nom} ${Date.now().toString(36)}`
}

/** La photo d'une fiche, retrouvée par son identifiant. Jamais crue sur parole. */
export async function photoDeLaFiche(
  userId: string,
  handle: string,
): Promise<{ titre: string; image: string; alt: string }> {
  const vitrine = await lireVitrinePourArticle(userId)
  const piece = vitrine.find((une) => une.handle === handle)
  if (piece === undefined) {
    throw notFound('Cette fiche produit est introuvable dans votre boutique.')
  }
  logger.info('photo de boutique retenue pour une annonce')
  return { titre: piece.titre, image: piece.image, alt: piece.alt }
}
