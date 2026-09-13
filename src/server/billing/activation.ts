import type { PrismaClient } from '@prisma/client'
import { DEFAULT_PLANS } from './plans'

/**
 * Ouverture du Radar et de Lia dans les offres existantes.
 *
 * Le démarrage ne réécrit jamais une offre déjà en base : elle appartient à l'exploitant.
 * Cette ouverture est donc un geste à part, fait **une seule fois** : on ajoute les deux
 * fonctions selon la répartition par défaut, et on ne pose les quotas que là où ils sont
 * encore à leur valeur d'origine (1 / 0 / 0). Un quota déjà réglé depuis le back-office
 * est conservé. Relançable sans effet de bord.
 */

/** Marque, en base, que l'ouverture a été faite : le démarrage ne la refera pas. */
export const ACTIVATION_KEY = 'offres.radar-et-lia.ouvertes'

export async function activerRadarEtLia(prisma: PrismaClient): Promise<string[]> {
  const lignes: string[] = []
  for (const defaults of DEFAULT_PLANS) {
    const plan = await prisma.plan.findUnique({ where: { id: defaults.id } })
    if (plan === null) continue
    const wanted = defaults.features.filter((f) => f === 'radar' || f === 'lia_support')
    const features = [...new Set([...plan.features, ...wanted])]
    const untouched =
      plan.radarRunsPerMonth === 1 && plan.liaAnswersPerMonth === 0 && plan.liaConversationsPerMonth === 0
    const updated = await prisma.plan.update({
      where: { id: plan.id },
      data: {
        features,
        ...(untouched
          ? {
              radarRunsPerMonth: defaults.radarRunsPerMonth,
              liaAnswersPerMonth: defaults.liaAnswersPerMonth,
              liaConversationsPerMonth: defaults.liaConversationsPerMonth,
            }
          : {}),
      },
    })
    lignes.push(
      `${plan.name} : ${wanted.join(', ') || 'rien'} — Radar ${updated.radarRunsPerMonth}/mois, Lia ${updated.liaAnswersPerMonth} réponses, ${updated.liaConversationsPerMonth} conversations${untouched ? '' : ' (quotas déjà réglés, conservés)'}`,
    )
  }
  return lignes
}

/** Fait l'ouverture si elle n'a jamais été faite sur cette installation. */
export async function activerRadarEtLiaUneFois(prisma: PrismaClient): Promise<string[] | null> {
  const done = await prisma.siteSetting.findUnique({ where: { key: ACTIVATION_KEY } })
  if (done !== null) return null
  const lignes = await activerRadarEtLia(prisma)
  await prisma.siteSetting.upsert({
    where: { key: ACTIVATION_KEY },
    update: { value: new Date().toISOString() },
    create: { key: ACTIVATION_KEY, value: new Date().toISOString() },
  })
  return lignes
}
