import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'

/**
 * Interrupteurs d'exploitation.
 *
 * Certaines fonctions dépendent d'une autorisation extérieure qui arrive à sa date, pas à
 * la nôtre. Les coder en dur obligerait à un déploiement le jour où elle tombe, et à un
 * autre le jour où elle est retirée. Elles se règlent donc depuis le back-office.
 *
 * À ne pas confondre avec les droits par abonnement, qui disent ce qu'une offre ouvre. Un
 * interrupteur dit si la fonction existe du tout sur cette installation. Une fonction
 * éteinte reste éteinte pour tout le monde, quelle que soit l'offre.
 */

export const FLAGS = {
  /**
   * Envoi de publications vers l'espace Postelya d'un créateur.
   *
   * Éteint tant que Postelya n'a pas obtenu l'accord de Meta : sans lui, un créateur
   * pourrait relier son espace et y déposer des semaines entières sans jamais pouvoir les
   * publier. Mieux vaut une fonction annoncée comme à venir qu'une fonction qui déçoit.
   */
  socialPublishing: {
    key: 'flag.social.publishing',
    label: 'Envoi vers Postelya',
    help: "Relier un espace Postelya et y déposer les semaines préparées. À n'activer qu'une fois Postelya autorisé par Meta à publier sur les comptes de vos créateurs.",
    /** Par défaut éteint : une fonction s'allume quand elle marche, pas avant. */
    fallback: false,
  },
} as const

export type FlagName = keyof typeof FLAGS

export async function isEnabled(name: FlagName): Promise<boolean> {
  const flag = FLAGS[name]
  const row = await prisma.siteSetting
    .findUnique({ where: { key: flag.key }, select: { value: true } })
    .catch(() => null)
  if (row === null) return flag.fallback
  return row.value === 'on'
}

/** État de tous les interrupteurs, pour l'écran d'administration. */
export async function readFlags(): Promise<Record<FlagName, boolean>> {
  const rows = await prisma.siteSetting.findMany({
    where: { key: { in: Object.values(FLAGS).map((flag) => flag.key) } },
    select: { key: true, value: true },
  })
  const byKey = new Map(rows.map((row) => [row.key, row.value]))
  const names = Object.keys(FLAGS) as FlagName[]
  return Object.fromEntries(
    names.map((name) => [name, (byKey.get(FLAGS[name].key) ?? null) === null
      ? FLAGS[name].fallback
      : byKey.get(FLAGS[name].key) === 'on']),
  ) as Record<FlagName, boolean>
}

export async function setFlag(name: FlagName, enabled: boolean): Promise<void> {
  const flag = FLAGS[name]
  await prisma.siteSetting.upsert({
    where: { key: flag.key },
    update: { value: enabled ? 'on' : 'off' },
    create: { key: flag.key, value: enabled ? 'on' : 'off' },
  })
  logger.info('interrupteur modifié', { flag: flag.key, enabled })
}
