import { withUserScope } from '@/server/db/scope'

/**
 * Ce que les avis apprennent au Radar.
 *
 * « Pas pour moi » avec une raison, « ça m'intéresse », une opportunité enregistrée ou
 * devenue projet : autant d'indices sur ce que la personne veut vraiment, plus fiables que
 * son profil déclaré. On n'en fait pas un modèle de préférences ; on les résume en
 * quelques phrases transmises au modèle comme données, pour qu'il évite ce qui a été
 * écarté et s'approche de ce qui a plu. Sans avis, rien n'est transmis.
 */

const REASON_LABELS: Record<string, string> = {
  too_complex: 'trop complexe à construire',
  not_my_sector: 'hors de son secteur',
  too_competitive: 'trop concurrentiel',
  too_expensive: 'trop coûteux à faire tourner',
  no_b2b: 'ne veut pas vendre à des entreprises',
  other: 'autre raison',
}

export async function readPreferenceHints(userId: string): Promise<string[]> {
  const [feedback, kept] = await withUserScope(userId, async (tx) =>
    Promise.all([
      tx.radarFeedback.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: { verdict: true, reason: true, idea: { select: { title: true, rejectReason: true } } },
      }),
      tx.idea.findMany({
        where: { userId, source: { in: ['radar', 'radar_projet'] }, status: { in: ['SAVED', 'SELECTED'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { title: true, status: true },
      }),
    ]),
  )

  const hints: string[] = []

  const reasons = new Map<string, number>()
  for (const entry of feedback) {
    if (entry.verdict !== 'not_for_me') continue
    const reason = entry.reason ?? entry.idea.rejectReason ?? 'other'
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
  }
  for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
    const label = REASON_LABELS[reason] ?? reason
    hints.push(`A écarté ${count} opportunité${count > 1 ? 's' : ''} : ${label}.`)
  }

  const liked = feedback.filter((entry) => entry.verdict === 'interested').map((entry) => entry.idea.title)
  if (liked.length > 0) hints.push(`A trouvé intéressant : ${liked.slice(0, 5).join(' ; ')}.`)

  const saved = kept.filter((row) => row.status === 'SAVED').map((row) => row.title)
  if (saved.length > 0) hints.push(`A enregistré : ${saved.slice(0, 5).join(' ; ')}.`)
  const built = kept.filter((row) => row.status === 'SELECTED').map((row) => row.title)
  if (built.length > 0) hints.push(`A transformé en projet : ${built.slice(0, 3).join(' ; ')}.`)

  return hints
}
