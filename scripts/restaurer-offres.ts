import { readFile } from 'node:fs/promises'
import { prisma } from '@/server/db/client'

/**
 * Remet en base des offres retirées.
 *
 *   npx tsx scripts/restaurer-offres.ts docs/sauvegardes/offres-retirees-2026-09-17.json
 *
 * Il n'écrase jamais une offre existante, et c'est la même règle que le semis : une offre
 * déjà en base appartient à l'exploitant, qui a pu la régler depuis. Une restauration remet
 * ce qui manque, elle ne défait rien.
 */

type OffreSauvegardee = Record<string, unknown> & { id: string }

async function main(): Promise<void> {
  const chemin = process.argv[2]
  if (chemin === undefined) {
    console.error('Usage : npx tsx scripts/restaurer-offres.ts <fichier.json>')
    process.exitCode = 1
    return
  }

  const brut = await readFile(chemin, 'utf8')
  const offres = JSON.parse(brut) as OffreSauvegardee[]
  if (!Array.isArray(offres)) {
    console.error('Ce fichier ne contient pas une liste d’offres.')
    process.exitCode = 1
    return
  }

  let remises = 0
  for (const offre of offres) {
    const existante = await prisma.plan.findUnique({ where: { id: offre.id } })
    if (existante !== null) {
      console.log(`${offre.id} … déjà en base, laissée telle quelle`)
      continue
    }
    await prisma.plan.create({ data: offre as never })
    remises += 1
    console.log(`${offre.id} … remise en base`)
  }
  console.log(`\n${remises} offre(s) remise(s) sur ${offres.length}.`)
}

void main()
