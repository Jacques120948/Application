import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'

/**
 * Réglages d'exploitation, en base plutôt que dans le code.
 *
 * `SiteSetting` est une table clé-valeur globale, déjà utilisée par les interrupteurs de
 * fonctions et l'identité légale. Ce module lui donne un accès commun : lire une clé, en
 * lire plusieurs, en écrire une. Rien de plus — une clé absente vaut `null`, et c'est à
 * l'appelant de décider ce que signifie l'absence.
 *
 * Une lecture qui échoue renvoie l'absence plutôt qu'une exception : un réglage
 * indisponible doit faire retomber l'appelant sur sa valeur de secours, pas interrompre
 * une opération que l'utilisateur a payée.
 */

export async function readSetting(key: string): Promise<string | null> {
  const row = await prisma.siteSetting
    .findUnique({ where: { key }, select: { value: true } })
    .catch(() => null)
  return row?.value ?? null
}

/** Lit plusieurs clés d'un coup. Les clés absentes n'apparaissent pas dans le résultat. */
export async function readSettings(keys: readonly string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {}
  const rows = await prisma.siteSetting
    .findMany({ where: { key: { in: [...keys] } }, select: { key: true, value: true } })
    .catch(() => [])
  return Object.fromEntries(rows.map((row) => [row.key, row.value]))
}

export async function writeSetting(key: string, value: string): Promise<void> {
  await prisma.siteSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
  logger.info('réglage modifié', { key })
}
