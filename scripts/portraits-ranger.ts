import { readdir, mkdir, writeFile } from 'node:fs/promises'
import { join, parse } from 'node:path'
import sharp from 'sharp'

/**
 * Range des portraits téléchargés à la main.
 *
 * Il existe parce que la génération et le dépôt ne sont pas au même endroit : les images
 * sortent d'un service, le dépôt les attend dans un format et une taille précis, et faire ce
 * pont à la main — redimensionner, recadrer, convertir, renommer — est le genre de tâche
 * qu'on rate une fois sur quatre.
 *
 *   1. Déposez les quatre images dans public/equipe/source/, nommées lea, neo, gia, milo
 *      (n'importe quelle extension : png, jpg, webp).
 *   2. npx tsx scripts/portraits-ranger.ts
 *
 * Il écrit public/equipe/<nom>.webp, carré, recadré au centre. Le dossier source n'est pas
 * versionné : ce sont les originaux, le dépôt n'a besoin que du résultat.
 */

const SOURCE = 'public/equipe/source'
const CIBLE = 'public/equipe'

/** Deux fois la plus grande taille affichée, pour les écrans fins. */
const COTE = 320

const ATTENDUS = ['lea', 'neo', 'gia', 'milo']
const FORMATS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif'])

async function main(): Promise<void> {
  await mkdir(SOURCE, { recursive: true })
  const fichiers = await readdir(SOURCE).catch(() => [])

  const trouves = new Map<string, string>()
  for (const fichier of fichiers) {
    const { name, ext } = parse(fichier)
    if (!FORMATS.has(ext.toLowerCase())) continue
    const nom = name.toLowerCase()
    if (ATTENDUS.includes(nom)) trouves.set(nom, join(SOURCE, fichier))
  }

  if (trouves.size === 0) {
    console.log(
      `Aucune image dans ${SOURCE}.\n` +
        `Déposez-y les portraits nommés ${ATTENDUS.join(', ')} (png, jpg ou webp), puis relancez.`,
    )
    return
  }

  for (const nom of ATTENDUS) {
    const source = trouves.get(nom)
    if (source === undefined) {
      console.log(`· ${nom} : absent, laissé tel quel`)
      continue
    }
    /*
     * Recadré au centre plutôt que déformé : un portrait livré dans un autre format perd de
     * la marge, jamais ses proportions. C'est ce qui permet de déposer n'importe quel export
     * sans se soucier de sa taille.
     */
    const image = await sharp(source)
      .resize(COTE, COTE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 88 })
      .toBuffer()
    await writeFile(join(CIBLE, `${nom}.webp`), image)
    console.log(`✓ ${nom}.webp (${Math.round(image.length / 1024)} Ko)`)
  }

  console.log('\nRelancez l’application pour les voir, puis committez public/equipe.')
}

await main()
