import { isEmailAvailable, sendEmail } from '@/server/email/send'
import { logger } from '@/server/observability/logger'
import { notify } from '@/server/notifications/service'
import { prisma } from '@/server/db/client'
import { currentPeriod } from '@/server/radar/quota'
import { getEffectivePlan } from '@/server/billing/plans'
import { readSetting } from '@/server/settings/store'
import { recordLabel } from '@/lib/record-label'
import type { DataModel } from '@/server/spec/schema'
import type { RecordData } from './records'

/**
 * Prévenir le créateur qu'un visiteur a saisi quelque chose.
 *
 * Sans cela, un artisan doit ouvrir son application pour découvrir qu'on lui a demandé un
 * devis — et il l'apprend souvent par le client qui s'impatiente. C'est le manque qui
 * séparait le plus nettement « une application » d'« un outil de travail ».
 *
 * Quatre règles, dont trois tiennent au fait que **c'est Evoliia qui paie le courriel**.
 *
 * **La notification dans Evoliia est gratuite, donc elle a toujours lieu.** Le créateur la
 * voit dans sa cloche même quand l'e-mail n'est pas parti. Ce qui est plafonné, c'est
 * l'envoi, pas l'information.
 *
 * **Le quota mensuel vient de l'offre**, comme le Radar et Lia, et vaut zéro par défaut :
 * la fonction s'ouvre offre par offre depuis le back-office, jamais toute seule.
 *
 * **Un plafond journalier par application** double le quota mensuel. Le danger n'est pas
 * l'usage normal — il se compte en centimes — mais l'application qui s'emballe : un
 * formulaire visité par un robot enverrait mille courriels avant que quiconque s'en
 * aperçoive.
 *
 * **Une alerte qui ne part pas n'interrompt jamais le visiteur.** Il a rempli un formulaire ;
 * que le créateur soit prévenu ou non ne le regarde pas, et son enregistrement est déjà fait.
 * Toute défaillance est donc tracée et avalée.
 */

/** Plafond par application et par jour, quand rien n'est réglé. */
export const DEFAULT_DAILY_CAP = 200

export const ALERT_SETTINGS = { dailyCap: 'alerts.daily.max' } as const

export type AlertQuota = {
  used: number
  limit: number
  remaining: number
  resetsAt: Date
}

/** Ce qu'il reste d'alertes ce mois-ci. Affiché au créateur, et vérifié avant tout envoi. */
export async function alertQuota(userId: string): Promise<AlertQuota> {
  const [period, plan] = await Promise.all([currentPeriod(userId), getEffectivePlan(userId)])
  const used = await prisma.ownerAlert.count({
    where: { userId, sent: true, createdAt: { gte: period.start } },
  })
  const limit = plan.alertsPerMonth
  return { used, limit, remaining: Math.max(0, limit - used), resetsAt: period.end }
}

async function dailyCap(): Promise<number> {
  const raw = await readSetting(ALERT_SETTINGS.dailyCap)
  if (raw === null) return DEFAULT_DAILY_CAP
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.round(value) : DEFAULT_DAILY_CAP
}

/** Ce qui empêche l'envoi, ou `null` quand rien ne l'empêche. */
async function retenue(params: {
  userId: string
  projectId: string
}): Promise<string | null> {
  if (!isEmailAvailable()) return 'aucun fournisseur de courriel'

  const quota = await alertQuota(params.userId)
  if (quota.remaining <= 0) {
    return quota.limit === 0 ? 'offre sans alertes' : 'quota mensuel atteint'
  }

  const depuis = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const aujourdhui = await prisma.ownerAlert.count({
    where: { projectId: params.projectId, sent: true, createdAt: { gte: depuis } },
  })
  if (aujourdhui >= (await dailyCap())) return 'plafond journalier de l’application'

  return null
}

/**
 * Prévient le créateur d'une nouvelle fiche.
 *
 * Ne lève jamais : appelée depuis l'enregistrement d'un visiteur, elle ne doit pas pouvoir
 * faire échouer une saisie déjà validée.
 */
export async function alertOwnerOfNewRecord(params: {
  ownerId: string
  projectId: string
  appName: string
  appUrl: string
  model: DataModel
  recordId: string
  data: RecordData
}): Promise<void> {
  try {
    const motif = await retenue({ userId: params.ownerId, projectId: params.projectId })
    const titre = `${params.model.label} : ${recordLabel(params.model, params.data)}`

    // La cloche d'Evoliia ne coûte rien : elle sonne même quand le courriel est retenu.
    await notify(params.ownerId, {
      kind: 'app_record',
      title: `Nouvelle saisie sur ${params.appName}`,
      body: titre,
      href: `/fr/projets/${params.projectId}?onglet=utilisateurs`,
    })

    if (motif !== null) {
      await trace(params, false, motif)
      logger.info('alerte créateur retenue', { projectId: params.projectId, motif })
      return
    }

    const createur = await prisma.user.findUnique({
      where: { id: params.ownerId },
      select: { email: true },
    })
    if (createur === null) {
      await trace(params, false, 'créateur introuvable')
      return
    }

    await sendEmail({
      to: createur.email,
      subject: `Nouvelle saisie sur ${params.appName}`,
      text: [
        `Quelqu'un vient de remplir « ${params.model.label} » sur ${params.appName}.`,
        '',
        titre,
        '',
        `Pour la consulter : ${params.appUrl}`,
        '',
        'Vous recevez ce message parce que vous avez demandé à être prévenu des nouvelles',
        'saisies. Vous pouvez le désactiver depuis votre projet, onglet Fonctionnalités.',
      ].join('\n'),
    })
    await trace(params, true, null)
    logger.info('alerte créateur envoyée', { projectId: params.projectId })
  } catch (error) {
    // Le visiteur a rempli son formulaire : sa saisie est faite, et rien de ce qui suit ne
    // la concerne. On garde la trace de l'échec et on se tait.
    await trace(params, false, 'envoi en échec').catch(() => undefined)
    logger.error('alerte créateur impossible', {
      projectId: params.projectId,
      reason: error instanceof Error ? error.name : 'inconnu',
    })
  }
}

async function trace(
  params: { ownerId: string; projectId: string; model: DataModel; recordId: string },
  sent: boolean,
  reason: string | null,
): Promise<void> {
  await prisma.ownerAlert
    .create({
      data: {
        userId: params.ownerId,
        projectId: params.projectId,
        modelId: params.model.id,
        recordId: params.recordId,
        sent,
        reason,
      },
    })
    .catch(() => undefined)
}
