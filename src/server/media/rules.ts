/**
 * Règles de traitement des images téléversées.
 *
 * Deux principes, et tout le reste en découle.
 *
 * **Ce qui est accepté est décidé par les octets, pas par le navigateur.** Un fichier
 * annoncé « image/png » peut contenir n'importe quoi ; on lit donc sa signature binaire.
 *
 * **Ce qui est stocké n'est jamais ce qui a été reçu.** L'image est ré-encodée par la
 * bibliothèque de traitement, ce qui laisse tomber au passage tout ce qu'un fichier
 * d'image peut transporter d'autre : scripts, données de position GPS, nom de l'appareil,
 * profils exotiques. Le créateur téléverse une photo de son atelier, il ne publie pas les
 * coordonnées de son domicile sans le savoir.
 */

/** Poids maximal accepté à l'entrée. Au-delà, le fichier est refusé sans être lu. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

/** Largeur maximale conservée. Au-delà, personne ne voit la différence sur un écran. */
export const MAX_WIDTH = 1600

/** Largeur des vignettes affichées dans l'atelier. */
export const THUMB_WIDTH = 400

export type AcceptedFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif'

/**
 * Signatures binaires des formats acceptés.
 *
 * Volontairement court : chaque format de plus est une surface d'attaque de plus dans la
 * bibliothèque de décodage. Ces cinq-là couvrent ce qu'un téléphone produit.
 */
const SIGNATURES: Array<{ format: AcceptedFormat; offset: number; bytes: number[] }> = [
  { format: 'jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { format: 'png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // WEBP : "RIFF" puis, quatre octets plus loin, "WEBP".
  { format: 'webp', offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
  { format: 'avif', offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
  { format: 'gif', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
]

function matches(data: Uint8Array, offset: number, bytes: number[]): boolean {
  if (data.length < offset + bytes.length) return false
  return bytes.every((byte, index) => data[offset + index] === byte)
}

/** Format réel du fichier, d'après ses octets. `null` si ce n'est pas une image acceptée. */
export function detectFormat(data: Uint8Array): AcceptedFormat | null {
  for (const signature of SIGNATURES) {
    if (!matches(data, signature.offset, signature.bytes)) continue
    if (signature.format === 'webp') {
      // "RIFF" sert aussi pour l'audio : il faut vérifier le second marqueur.
      const isWebp = matches(data, 8, [0x57, 0x45, 0x42, 0x50])
      if (!isWebp) continue
    }
    return signature.format
  }
  return null
}

export const ACCEPTED_MIME = 'image/jpeg,image/png,image/webp,image/avif,image/gif'

/** Ce qui sort du traitement, quel que soit ce qui est entré. */
export const STORED_MIME = 'image/webp'

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}
