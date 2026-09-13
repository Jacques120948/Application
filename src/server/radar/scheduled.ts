import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { isAiAvailable } from '@/server/ai/client'
import { isEmailAvailable, sendEmail } from '@/server/email/send'
import { logger } from '@/server/observability/logger'
import { isEnabled } from '@/server/settings/flags'
import { notify } from '@/server/notifications/service'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'
import { currentPeriod, radarQuota } from './quota'
import { getEntitlements } from '@/server/billing/entitlements'
import { RADAR_FEATURE, runRadar } from './service'

/**
 * La recherche périodique du Radar (V2).
 *
 * Une fois par mois, pour chaque personne qui l'a demandé et dont l'offre le permet, le
 * Radar cherche seul et prévient s'il a trouvé. Trois verrous, tous fermés par défaut :
 * le drapeau `radarV2`, le jeton du planificateur (sans lui, la route n'existe pas), et le
 * choix de la personne (`radarAlerts`).
 *
 * Ce que ça coûte, et à qui : chaque recherche débite les crédits de la personne, comme
 * une recherche manuelle, et consomme une de ses recherches du mois. Elle n'a jamais lieu
 * si le quota ou le solde ne le permettent pas, ni deux fois dans la même période. Une
 * recherche qui ne trouve rien de neuf ne crée aucune idée et n'avertit personne.
 */

export type ScheduledOutcome = {
  examined: number
  ran: number
  notified: number
  skipped: Array<{ userId: string; reason: string }>
}

export async function runScheduledRadar(options: { limit?: number } = {}): Promise<ScheduledOutcome> {
  const outcome: ScheduledOutcome = { examined: 0, ran: 0, notified: 0, skipped: [] }
  if (!(await isEnabled('radarV2'))) {
    logger.info('radar périodique : drapeau radarV2 fermé, rien à faire')
    return outcome
  }
  if (!isAiAvailable()) {
    logger.warn('radar périodique : copilote non configuré')
    return outcome
  }

  // Le profil est cloisonné : on ne peut pas filtrer dessus d'ici, on le lit pour chaque
  // personne dans sa propre portée, avant tout le reste.
  const candidates = await prisma.user.findMany({
    where: { radarAlerts: true, disabledAt: null },
    select: { id: true, email: true, name: true, locale: true },
    orderBy: { createdAt: 'asc' },
    take: options.limit ?? 50,
  })

  for (const user of candidates) {
    outcome.examined += 1
    try {
      const profile = await withUserScope(user.id, (tx) =>
        tx.creatorProfile.findUnique({ where: { userId: user.id }, select: { completedAt: true } }),
      )
      if (profile === null || profile.completedAt === null) {
        outcome.skipped.push({ userId: user.id, reason: 'no_profile' })
        continue
      }
      const period = await currentPeriod(user.id)
      const already = await withUserScope(user.id, (tx) =>
        tx.radarRun.count({ where: { userId: user.id, trigger: 'scheduled', createdAt: { gte: period.start } } }),
      )
      if (already > 0) {
        outcome.skipped.push({ userId: user.id, reason: 'already_ran_this_period' })
        continue
      }
      const entitlements = await getEntitlements(user.id)
      if (!entitlements.granted.includes(RADAR_FEATURE)) {
        outcome.skipped.push({ userId: user.id, reason: 'not_in_plan' })
        continue
      }
      const quota = await radarQuota(user.id)
      if (quota.remaining <= 0) {
        outcome.skipped.push({ userId: user.id, reason: quota.limit === 0 ? 'not_in_plan' : 'quota_reached' })
        continue
      }

      const result = await runRadar(user.id, user.locale, 'scheduled')
      outcome.ran += 1
      if (result.opportunities.length === 0) continue

      const href = `/${user.locale}/radar`
      const count = result.opportunities.length
      await notify(user.id, {
        kind: 'radar_new',
        title: `${count} nouvelle${count > 1 ? 's' : ''} opportunité${count > 1 ? 's' : ''} dans votre Radar`,
        body: result.opportunities.map((o) => o.title).join(' · '),
        href,
      })
      outcome.notified += 1

      if (isEmailAvailable()) {
        await sendEmail({
          to: user.email,
          subject: `Evoliia — ${count} nouvelle${count > 1 ? 's' : ''} opportunité${count > 1 ? 's' : ''} pour vous`,
          text: [
            `Bonjour${user.name ? ` ${user.name}` : ''},`,
            '',
            'Le Radar a cherché ce mois-ci et a trouvé :',
            ...result.opportunities.map((o) => `— ${o.title} (score ${o.opportunityScore}/100, une estimation)`),
            '',
            `Les voir : ${env.appUrl.replace(/\/$/, '')}${href}`,
            '',
            'Vous pouvez arrêter ces recherches automatiques depuis la page du Radar.',
          ].join('\n'),
        })
      }
    } catch (error) {
      const reason = error instanceof AppError ? error.code : 'error'
      outcome.skipped.push({ userId: user.id, reason })
      logger.warn('radar périodique : personne ignorée', { userId: user.id, reason })
    }
  }

  logger.info('radar périodique : terminé', {
    examined: outcome.examined,
    ran: outcome.ran,
    notified: outcome.notified,
    skipped: outcome.skipped.length,
  })
  return outcome
}
