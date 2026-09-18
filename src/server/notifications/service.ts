import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'

/**
 * Notifications internes.
 *
 * Une ligne par événement qui mérite l'attention d'une personne quand elle n'est pas
 * devant l'écran : une opportunité trouvée par le Radar périodique, un ticket ouvert par
 * Lia, une question restée sans réponse. Le tableau de bord les affiche ; l'e-mail, quand
 * il est configuré, ne fait que les doubler pour les personnes qui l'ont demandé.
 *
 * Aucun contenu personnel d'un tiers n'y est copié : un titre, une phrase, un lien.
 */

export type NotificationKind =
  | 'radar_new'
  | 'support_ticket'
  | 'support_insight'
  | 'support_unanswered'
  /** Un visiteur vient de saisir une fiche dans une application publiée. */
  | 'app_record'
  /** Un créateur signale un problème qu'il n'a pas pu résoudre. Adressée à l'exploitant. */
  | 'creator_report'
  /** La surveillance a repéré qu'un site suivi a cessé de fonctionner ou d'être indexable. */
  | 'site_watch'

export type NotificationView = {
  id: string
  kind: NotificationKind
  title: string
  body: string
  href: string | null
  readAt: string | null
  createdAt: string
}

export async function notify(
  userId: string,
  input: { kind: NotificationKind; title: string; body?: string; href?: string },
): Promise<void> {
  await withUserScope(userId, (tx) =>
    tx.notification.create({
      data: { userId, kind: input.kind, title: input.title, body: input.body ?? '', href: input.href ?? null },
    }),
  )
  logger.info('notification créée', { userId, kind: input.kind })
}

export async function listNotifications(userId: string, take = 20): Promise<NotificationView[]> {
  const rows = await withUserScope(userId, (tx) =>
    tx.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take }),
  )
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }))
}

export async function countUnread(userId: string): Promise<number> {
  return withUserScope(userId, (tx) => tx.notification.count({ where: { userId, readAt: null } }))
}

/** Marque tout comme lu, ou seulement les identifiants donnés. */
export async function markRead(userId: string, ids?: string[]): Promise<void> {
  await withUserScope(userId, (tx) =>
    tx.notification.updateMany({
      where: { userId, readAt: null, ...(ids === undefined ? {} : { id: { in: ids } }) },
      data: { readAt: new Date() },
    }),
  )
}
