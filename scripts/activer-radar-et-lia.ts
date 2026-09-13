import { prisma } from '@/server/db/client'
import { DEFAULT_PLANS } from '@/server/billing/plans'

/**
 * Ouvre le Radar et Lia dans les offres existantes.
 *
 * Le démarrage (`prisma/seed.ts`) ne touche jamais aux offres déjà en base : elles
 * appartiennent à l'exploitant. Ce script est donc le geste explicite, à lancer une fois :
 *
 *     npx tsx scripts/activer-radar-et-lia.ts
 *
 * Il ajoute les deux fonctions selon la répartition des offres par défaut, et ne pose les
 * quotas que là où ils sont encore à leur valeur d'origine (1 / 0 / 0) — un quota déjà
 * réglé depuis le back-office est conservé. Relançable sans effet de bord.
 */
async function main() {
  for (const defaults of DEFAULT_PLANS) {
    const plan = await prisma.plan.findUnique({ where: { id: defaults.id } })
    if (plan === null) continue
    const wanted = defaults.features.filter((f) => f === 'radar' || f === 'lia_support')
    const features = [...new Set([...plan.features, ...wanted])]
    const untouched = plan.radarRunsPerMonth === 1 && plan.liaAnswersPerMonth === 0 && plan.liaConversationsPerMonth === 0
    await prisma.plan.update({
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
    console.log(
      `${plan.name} : ${wanted.join(', ') || 'rien'} — Radar ${untouched ? defaults.radarRunsPerMonth : plan.radarRunsPerMonth}/mois, Lia ${untouched ? defaults.liaAnswersPerMonth : plan.liaAnswersPerMonth} réponses, ${untouched ? defaults.liaConversationsPerMonth : plan.liaConversationsPerMonth} conversations${untouched ? '' : ' (quotas déjà réglés, conservés)'}`,
    )
  }
  await prisma.$disconnect()
}

void main()
