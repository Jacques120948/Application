import { prisma } from '@/server/db/client'
import { activerRadarEtLia } from '@/server/billing/activation'

/**
 * Ouvre le Radar et Lia dans les offres, à la main :
 *
 *     npx tsx scripts/activer-radar-et-lia.ts
 *
 * Le démarrage (`prisma/seed.ts`) fait la même chose une seule fois, automatiquement, à la
 * mise en ligne suivante. Ce script reste utile pour rejouer l'ouverture après avoir
 * retiré une fonction par erreur. Il conserve les quotas déjà réglés.
 */
async function main() {
  for (const ligne of await activerRadarEtLia(prisma)) console.log(ligne)
  await prisma.$disconnect()
}

void main()
