import { deflateRawSync } from 'node:zlib'

/**
 * Écriture d'archives ZIP, en une centaine de lignes.
 *
 * Le format est ancien, court et parfaitement documenté ; une dépendance n'apporterait ici
 * qu'une surface de plus à surveiller, pour trois structures binaires. Ce qui est écrit est
 * le sous-ensemble que lisent tous les systèmes : une entrée par fichier, compression
 * `deflate` ou stockage brut, et un répertoire central en fin d'archive.
 *
 * Deux limites assumées, suffisantes pour un export de site. Pas de ZIP64 : au-delà de
 * quatre gigaoctets ou de soixante-cinq mille fichiers, il faudrait un autre format, et un
 * site exporté n'en approche jamais. Et les noms sont encodés en UTF-8 avec le drapeau qui
 * l'annonce, sans quoi un fichier « données.csv » s'ouvrirait sous un nom illisible.
 */

export type ZipEntry = {
  /** Chemin dans l'archive, séparé par des barres obliques. */
  path: string
  content: Buffer | string
}

/** Table CRC-32, calculée une fois. C'est la somme de contrôle exigée par le format. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let bit = 0; bit < 8; bit++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Date au format MS-DOS, sur deux entiers de seize bits.
 *
 * Le format ne connaît rien avant 1980 et ne stocke les secondes que par paires. On fige
 * la date à la seconde près la plus proche plutôt que d'inventer une précision absente.
 */
function dosDateTime(date: Date): { time: number; date: number } {
  const annee = Math.max(1980, date.getUTCFullYear())
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
    date: ((annee - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  }
}

const FLAG_UTF8 = 0x0800
const METHOD_DEFLATE = 8
const METHOD_STORE = 0

export function createZip(entries: readonly ZipEntry[], now = new Date()): Buffer {
  const { time, date } = dosDateTime(now)
  const locaux: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nom = Buffer.from(entry.path, 'utf8')
    const brut = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8')
    const compresse = deflateRawSync(brut)

    // Une image déjà compressée grossit souvent en repassant dans deflate : on garde alors
    // les octets tels quels.
    const gagne = compresse.length < brut.length
    const methode = gagne ? METHOD_DEFLATE : METHOD_STORE
    const donnees = gagne ? compresse : brut
    const somme = crc32(brut)

    const enTete = Buffer.alloc(30)
    enTete.writeUInt32LE(0x04034b50, 0)
    enTete.writeUInt16LE(20, 4) // version minimale
    enTete.writeUInt16LE(FLAG_UTF8, 6)
    enTete.writeUInt16LE(methode, 8)
    enTete.writeUInt16LE(time, 10)
    enTete.writeUInt16LE(date, 12)
    enTete.writeUInt32LE(somme, 14)
    enTete.writeUInt32LE(donnees.length, 18)
    enTete.writeUInt32LE(brut.length, 22)
    enTete.writeUInt16LE(nom.length, 26)
    enTete.writeUInt16LE(0, 28)

    locaux.push(enTete, nom, donnees)

    const fiche = Buffer.alloc(46)
    fiche.writeUInt32LE(0x02014b50, 0)
    fiche.writeUInt16LE(20, 4) // version d'écriture
    fiche.writeUInt16LE(20, 6) // version minimale de lecture
    fiche.writeUInt16LE(FLAG_UTF8, 8)
    fiche.writeUInt16LE(methode, 10)
    fiche.writeUInt16LE(time, 12)
    fiche.writeUInt16LE(date, 14)
    fiche.writeUInt32LE(somme, 16)
    fiche.writeUInt32LE(donnees.length, 20)
    fiche.writeUInt32LE(brut.length, 24)
    fiche.writeUInt16LE(nom.length, 28)
    fiche.writeUInt16LE(0, 30) // champ supplémentaire
    fiche.writeUInt16LE(0, 32) // commentaire
    fiche.writeUInt16LE(0, 34) // numéro de disque
    fiche.writeUInt16LE(0, 36) // attributs internes
    fiche.writeUInt32LE(0, 38) // attributs externes
    fiche.writeUInt32LE(offset, 42)

    central.push(fiche, nom)
    offset += enTete.length + nom.length + donnees.length
  }

  const repertoire = Buffer.concat(central)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0)
  fin.writeUInt16LE(0, 4) // disque courant
  fin.writeUInt16LE(0, 6) // disque du répertoire
  fin.writeUInt16LE(entries.length, 8)
  fin.writeUInt16LE(entries.length, 10)
  fin.writeUInt32LE(repertoire.length, 12)
  fin.writeUInt32LE(offset, 16)
  fin.writeUInt16LE(0, 20) // commentaire

  return Buffer.concat([...locaux, repertoire, fin])
}
